'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  BRANCH_MANIFEST_SCHEMA, normalizeManifest, normalizeRevision, normalizeResolution,
  computeEffectiveState,
} = require('./foundation/branch-effective-state');
const { assertKnownKeys, clonePlain, deepFreeze, isPlainObject, requiredString } = require('./foundation/plain-value');
const { workspaceId } = require('./workspace-event-service');

const STORE_SCHEMA = 'mazz.branch-store/v0';
const SNAPSHOT_SCHEMA = 'mazz.branch-store-snapshot/v0';

function slash(value) { return String(value || '').replace(/\\/g, '/'); }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function nowIso(now) { return new Date(typeof now === 'function' ? now() : now || Date.now()).toISOString(); }

function normalizeEnvelope(input, expectedWorkspaceId) {
  if (!isPlainObject(input)) throw new Error('Branch Store 必须是对象');
  assertKnownKeys(input, ['schema', 'workspaceId', 'revision', 'previousHash', 'stateHash', 'manifests', 'resolutions'], 'Branch Store');
  if (input.schema !== STORE_SCHEMA) throw new Error(`不支持的 Branch Store schema: ${input.schema}`);
  if (input.workspaceId !== expectedWorkspaceId) throw new Error('Branch Store Workspace identity 不匹配');
  const revision = Number(input.revision);
  if (!Number.isInteger(revision) || revision < 0) throw new Error('Branch Store revision 非法');
  if (typeof input.previousHash !== 'string' || typeof input.stateHash !== 'string') throw new Error('Branch Store hash 不完整');
  if (!Array.isArray(input.manifests) || !Array.isArray(input.resolutions)) throw new Error('Branch Store manifests/resolutions 必须是数组');
  const manifests = input.manifests.map(normalizeManifest);
  if (manifests.some(row => row.workspaceId !== expectedWorkspaceId)) throw new Error('Branch Manifest Workspace identity 不匹配');
  if (new Set(manifests.map(row => row.branchId)).size !== manifests.length) throw new Error('Branch Store branchId 不能重复');
  const resolutions = input.resolutions.map(normalizeResolution);
  const body = { schema: STORE_SCHEMA, workspaceId: expectedWorkspaceId, revision, previousHash: input.previousHash, manifests, resolutions };
  if (digest(body) !== input.stateHash) throw new Error('Branch Store stateHash 校验失败');
  return { ...body, stateHash: input.stateHash };
}

class BranchEffectiveStateService {
  constructor({ rootProvider, fsImpl = fs, now = () => Date.now() } = {}) {
    if (typeof rootProvider !== 'function') throw new Error('BranchEffectiveStateService 依赖 rootProvider');
    this.rootProvider = rootProvider; this.fs = fsImpl; this.now = now; this.cache = null; this.cacheRoot = '';
  }

  root() { return path.resolve(this.rootProvider()); }
  id() { return workspaceId(this.root()); }
  folder() { return path.join(this.root(), '.mazz', 'branches'); }
  file() { return path.join(this.folder(), 'store.json'); }

  empty() {
    const body = { schema: STORE_SCHEMA, workspaceId: this.id(), revision: 0, previousHash: '', manifests: [], resolutions: [] };
    return { ...body, stateHash: digest(body) };
  }

  read() {
    const root = this.root();
    const file = this.file();
    if (!this.fs.existsSync(file)) { this.cacheRoot = root; return (this.cache = this.empty()); }
    let raw;
    try { raw = JSON.parse(this.fs.readFileSync(file, 'utf8')); }
    catch (error) { throw new Error(`Branch Store 损坏；原始文件保留（${slash(file)}）: ${error.message}`); }
    try {
      this.cacheRoot = root;
      return (this.cache = normalizeEnvelope(raw, this.id()));
    } catch (error) {
      throw new Error(`Branch Store 校验失败；原始文件保留（${slash(file)}）: ${error.message}`);
    }
  }

  write(next, expectedRevision) {
    const current = this.read();
    if (expectedRevision == null || Number(expectedRevision) !== current.revision) {
      const error = new Error(`Branch Store CAS 冲突：期望 ${expectedRevision}，当前 ${current.revision}`);
      error.code = 'BRANCH_CAS_MISMATCH'; throw error;
    }
    const body = { schema: STORE_SCHEMA, workspaceId: this.id(), revision: current.revision + 1, previousHash: current.stateHash, manifests: next.manifests, resolutions: next.resolutions };
    const candidate = normalizeEnvelope({ ...body, stateHash: digest(body) }, this.id());
    this.fs.mkdirSync(this.folder(), { recursive: true });
    const temp = `${this.file()}.${process.pid}.${Date.now()}.tmp`;
    try {
      this.fs.writeFileSync(temp, JSON.stringify(candidate, null, 2), 'utf8');
      this.fs.renameSync(temp, this.file());
    } catch (error) {
      try { this.fs.unlinkSync(temp); } catch {}
      throw error;
    }
    this.cache = candidate; this.cacheRoot = this.root();
    return candidate;
  }

  snapshot() {
    const store = this.read();
    const manifests = store.manifests.map(row => clonePlain(row));
    const parentMap = new Map(manifests.map(row => [row.branchId, row]));
    const effectiveStates = manifests.map(manifest => computeEffectiveState({
      manifest,
      parents: [...parentMap.values()].filter(row => row.branchId !== manifest.branchId),
      resolutions: store.resolutions,
    }));
    return deepFreeze({ schema: SNAPSHOT_SCHEMA, workspaceId: store.workspaceId, revision: store.revision, branches: manifests, resolutions: store.resolutions.map(row => clonePlain(row)), effectiveStates, localOnly: true, authorityGranted: false });
  }

  create(input = {}) {
    if (!isPlainObject(input)) throw new Error('Branch create payload 必须是对象');
    assertKnownKeys(input, ['schema', 'manifest', 'branchId', 'baseBranchId', 'parentBranchIds', 'contextRefs', 'relationRefs', 'eventCursor', 'revisions', 'supersedes', 'provenance', 'createdAt', 'updatedAt', 'expectedRevision'], 'Branch create payload');
    const at = nowIso(this.now);
    const source = isPlainObject(input.manifest) ? input.manifest : input;
    const manifestInput = { ...source };
    delete manifestInput.expectedRevision; delete manifestInput.manifest;
    const manifest = normalizeManifest({ ...manifestInput, workspaceId: this.id(), createdAt: source.createdAt || at, updatedAt: source.updatedAt || at, schema: BRANCH_MANIFEST_SCHEMA });
    const current = this.read();
    if (current.manifests.some(row => row.branchId === manifest.branchId)) throw new Error('Branch 已存在');
    if (manifest.parentBranchIds.some(parentId => !current.manifests.some(row => row.branchId === parentId))) throw new Error('Branch parent 不存在');
    for (const parentId of manifest.parentBranchIds) if (this._wouldCycle(current.manifests, manifest.branchId, parentId)) throw new Error('Branch parent 不得形成环');
    const next = this.write({ manifests: [...current.manifests, manifest], resolutions: current.resolutions }, input.expectedRevision == null ? current.revision : input.expectedRevision);
    return { branch: manifest, revision: next.revision };
  }

  update(branchId, mutator, expectedRevision) {
    const current = this.read();
    const index = current.manifests.findIndex(row => row.branchId === branchId);
    if (index < 0) throw new Error(`Branch 不存在: ${branchId}`);
    const draft = clonePlain(current.manifests[index]);
    mutator(draft, current);
    draft.workspaceId = this.id(); draft.updatedAt = nowIso(this.now);
    const manifest = normalizeManifest(draft);
    const manifests = [...current.manifests]; manifests[index] = manifest;
    const next = this.write({ manifests, resolutions: current.resolutions }, expectedRevision == null ? current.revision : expectedRevision);
    return { branch: manifest, revision: next.revision };
  }

  _wouldCycle(manifests, branchId, parentBranchId) {
    const byId = new Map(manifests.map(row => [row.branchId, row]));
    const seen = new Set();
    const visit = id => {
      if (id === branchId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return (byId.get(id)?.parentBranchIds || []).some(visit);
    };
    return visit(parentBranchId);
  }

  attachParent({ branchId, parentBranchId, expectedRevision } = {}) {
    requiredString(branchId, 'branchId'); requiredString(parentBranchId, 'parentBranchId');
    return this.update(branchId, (draft, current) => {
      if (parentBranchId === branchId) throw new Error('Branch parent 不得自环');
      if (!current.manifests.some(row => row.branchId === parentBranchId)) throw new Error('Branch parent 不存在');
      if (this._wouldCycle(current.manifests, branchId, parentBranchId)) throw new Error('Branch parent 不得形成环');
      if (!draft.parentBranchIds.includes(parentBranchId)) draft.parentBranchIds.push(parentBranchId);
    }, expectedRevision);
  }

  setRevision({ branchId, revision, expectedRevision } = {}) {
    const normalized = normalizeRevision(revision || {});
    return this.update(branchId, draft => {
      const key = `${normalized.domain}:${normalized.artifactRef}`;
      const old = draft.revisions.find(row => `${row.domain}:${row.artifactRef}` === key);
      if (old && old.revision !== normalized.revision && old.status === 'current') draft.supersedes = [...new Set([...draft.supersedes, old.revision])];
      draft.revisions = [...draft.revisions.filter(row => `${row.domain}:${row.artifactRef}` !== key), normalized];
    }, expectedRevision);
  }

  resolveConflict(input = {}) {
    const { expectedRevision, ...resolutionInput } = input || {};
    const resolution = normalizeResolution(resolutionInput);
    const current = this.read();
    if (current.resolutions.some(row => row.key === resolution.key && row.resolvedRevision === resolution.resolvedRevision)) throw new Error('resolution 已存在');
    const next = this.write({ manifests: current.manifests, resolutions: [...current.resolutions, resolution] }, expectedRevision == null ? current.revision : expectedRevision);
    return { resolution, revision: next.revision };
  }

  rebuild() { return this.snapshot(); }
}

module.exports = { BranchEffectiveStateService, STORE_SCHEMA, SNAPSHOT_SCHEMA, normalizeEnvelope };
