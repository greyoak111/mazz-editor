'use strict';

// W94Ga: local-first World orchestration.  Branch identity/effective-state
// semantics remain owned by BranchEffectiveStateService; this layer only
// persists World/Canon proposal facts and coordinates explicit human review.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertKnownKeys, clonePlain, deepFreeze, isPlainObject, requiredString, stringList,
} = require('./foundation/plain-value');
const { normalizeRevision } = require('./foundation/branch-effective-state');
const { workspaceId } = require('./workspace-event-service');

const WORLD_STORE_SCHEMA = 'mazz.world-store/v0';
const WORLD_SNAPSHOT_SCHEMA = 'mazz.world-snapshot/v0';
const PROPOSAL_SCHEMA = 'mazz.world-canon-proposal/v0';
const REVIEW_SCHEMA = 'mazz.world-canon-review/v0';
const MERGE_SCHEMA = 'mazz.world-canon-merge/v0';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SECRET_KEY = /(?:api.?key|secret|token|authorization|password|credential|private.?key|cookie|transcript|prompt|clipboard|keystroke)/i;
const URL_OR_PATH = /(?:^[A-Za-z]:[\\/]|^\\\\|^\/|(?:https?|file|ws|wss):\/\/|\.\.(?:[\\/]|$))/i;
const CHANGE_FIELDS = ['domain', 'artifactRef', 'revision', 'status'];

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function codedError(code, message) { return Object.assign(new Error(message), { code }); }

function safeId(value, label, prefix = '') {
  const text = requiredString(value, label);
  if (!ID.test(text) || (prefix && !text.startsWith(prefix))) {
    throw codedError('WORLD_INVALID', `${label} 非法`);
  }
  return text;
}

function safeRef(value, label, prefixes = []) {
  const text = safeId(value, label);
  if (prefixes.length && !prefixes.some(prefix => text.startsWith(prefix))) {
    throw codedError('WORLD_INVALID', `${label} 引用类型非法`);
  }
  return text;
}

function rejectPrivate(value, label = 'World value', trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectPrivate(item, label, `${trail}[${index}]`));
  if (!isPlainObject(value)) {
    if (typeof value === 'string' && URL_OR_PATH.test(value)) throw codedError('WORLD_PRIVATE_VALUE', `${label} 不得包含路径或网络定位器`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const at = trail ? `${trail}.${key}` : key;
    if (SECRET_KEY.test(key)) throw codedError('WORLD_PRIVATE_VALUE', `${label} 禁止私有字段: ${at}`);
    rejectPrivate(child, label, at);
  }
}

function nowIso(now) { return new Date(typeof now === 'function' ? now() : now || Date.now()).toISOString(); }

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try { fs.renameSync(temporary, filePath); }
  catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
}

function normalizeChange(input, index = 0) {
  if (!isPlainObject(input)) throw codedError('WORLD_INVALID', `proposal.changes[${index}] 必须是对象`);
  assertKnownKeys(input, CHANGE_FIELDS, `proposal.changes[${index}]`);
  const normalized = normalizeRevision({ ...input, schema: undefined });
  rejectPrivate(normalized, `proposal.changes[${index}]`);
  return normalized;
}

function normalizeWorld(input, expectedWorkspaceId, at) {
  if (!isPlainObject(input)) throw codedError('WORLD_INVALID', 'World 必须是对象');
  assertKnownKeys(input, [
    'schema', 'worldId', 'workspaceId', 'name', 'description', 'rootBranchId', 'branchIds', 'canonVersion',
    'contextRefs', 'lockedFacts', 'timeline', 'characters', 'locations', 'institutions',
    'relations', 'rules', 'provenance', 'createdAt', 'updatedAt',
  ], 'World');
  if (input.schema != null && input.schema !== 'mazz.world/v0') throw codedError('WORLD_INVALID', 'World schema 不支持');
  const worldId = safeId(input.worldId, 'worldId', 'world:');
  const rootBranchId = safeId(input.rootBranchId, 'rootBranchId', 'branch:');
  const branchIds = stringList(input.branchIds || [rootBranchId], 'branchIds').map((value, index) => safeId(value, `branchIds[${index}]`, 'branch:'));
  if (!branchIds.includes(rootBranchId)) throw codedError('WORLD_INVALID', 'branchIds 必须包含 rootBranchId');
  const description = String(input.description || '');
  const name = requiredString(input.name, 'World.name');
  const canonVersion = safeId(input.canonVersion || 'canon:0', 'canonVersion', 'canon:');
  const contextRefs = stringList(input.contextRefs || [], 'contextRefs').map((value, index) => safeRef(value, `contextRefs[${index}]`));
  const provenance = isPlainObject(input.provenance) ? clonePlain(input.provenance, 'provenance') : { source: 'world-runtime' };
  const createdAt = nowIso(input.createdAt || at);
  const updatedAt = nowIso(input.updatedAt || createdAt);
  const world = {
    schema: 'mazz.world/v0', worldId, workspaceId: expectedWorkspaceId, name, description,
    rootBranchId, branchIds, canonVersion, contextRefs,
    lockedFacts: clonePlain(input.lockedFacts || [], 'lockedFacts'),
    timeline: clonePlain(input.timeline || [], 'timeline'),
    characters: clonePlain(input.characters || [], 'characters'),
    locations: clonePlain(input.locations || [], 'locations'),
    institutions: clonePlain(input.institutions || [], 'institutions'),
    relations: clonePlain(input.relations || [], 'relations'),
    rules: clonePlain(input.rules || [], 'rules'), provenance, createdAt, updatedAt,
  };
  rejectPrivate(world, 'World');
  return deepFreeze(world);
}

function normalizeStore(input, expectedWorkspaceId) {
  if (!isPlainObject(input) || input.schema !== WORLD_STORE_SCHEMA) throw codedError('WORLD_STORE_CORRUPT', 'World Store schema 非法');
  assertKnownKeys(input, ['schema', 'workspaceId', 'revision', 'previousHash', 'stateHash', 'worlds', 'proposals', 'reviews', 'merges'], 'World Store');
  if (input.workspaceId !== expectedWorkspaceId) throw codedError('WORLD_STORE_CORRUPT', 'World Store Workspace identity 不匹配');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw codedError('WORLD_STORE_CORRUPT', 'World Store revision 非法');
  if (typeof input.previousHash !== 'string' || typeof input.stateHash !== 'string') throw codedError('WORLD_STORE_CORRUPT', 'World Store hash 不完整');
  for (const key of ['worlds', 'proposals', 'reviews', 'merges']) if (!Array.isArray(input[key])) throw codedError('WORLD_STORE_CORRUPT', `${key} 必须是数组`);
  const body = { schema: WORLD_STORE_SCHEMA, workspaceId: expectedWorkspaceId, revision: input.revision, previousHash: input.previousHash, worlds: input.worlds, proposals: input.proposals, reviews: input.reviews, merges: input.merges };
  if (digest(body) !== input.stateHash) throw codedError('WORLD_STORE_CORRUPT', 'World Store stateHash 校验失败');
  rejectPrivate(body, 'World Store');
  return deepFreeze({ ...body, stateHash: input.stateHash });
}

class WorldRuntimeService {
  constructor({ rootProvider, branchService, eventService = null, fsImpl = fs, now = () => Date.now() } = {}) {
    if (typeof rootProvider !== 'function' || !branchService) throw new TypeError('WorldRuntimeService 需要 rootProvider 与 Branch service');
    this.rootProvider = rootProvider; this.branchService = branchService; this.eventService = eventService; this.fs = fsImpl; this.now = now;
  }

  root() { return path.resolve(requiredString(this.rootProvider(), 'workspacePath')); }
  workspaceId() { return workspaceId(this.root()); }
  folder() { return path.join(this.root(), '.mazz', 'world'); }
  file() { return path.join(this.folder(), 'store.json'); }

  empty() {
    const body = { schema: WORLD_STORE_SCHEMA, workspaceId: this.workspaceId(), revision: 0, previousHash: '', worlds: [], proposals: [], reviews: [], merges: [] };
    return { ...body, stateHash: digest(body) };
  }

  read() {
    if (!this.fs.existsSync(this.file())) return this.empty();
    try { return normalizeStore(JSON.parse(this.fs.readFileSync(this.file(), 'utf8')), this.workspaceId()); }
    catch (error) { throw codedError(error.code || 'WORLD_STORE_CORRUPT', `World Store 损坏；原文件保留: ${error.message}`); }
  }

  write(next, expectedRevision) {
    const current = this.read();
    this._assertExpectedRevision(current, expectedRevision);
    const body = { schema: WORLD_STORE_SCHEMA, workspaceId: this.workspaceId(), revision: current.revision + 1, previousHash: current.stateHash, worlds: next.worlds, proposals: next.proposals, reviews: next.reviews, merges: next.merges };
    const candidate = normalizeStore({ ...body, stateHash: digest(body) }, this.workspaceId());
    atomicWrite(this.file(), candidate);
    return candidate;
  }

  _assertExpectedRevision(current, expectedRevision) {
    if (expectedRevision == null || Number(expectedRevision) !== current.revision) {
      throw codedError('WORLD_CAS_MISMATCH', `World Store CAS 冲突：期望 ${expectedRevision}，当前 ${current.revision}`);
    }
  }

  _capture(action, subjectRefs, objectRefs, outcome = 'success') {
    if (!this.eventService?.capture) return { recorded: false, reason: 'UNAVAILABLE' };
    try {
      return this.eventService.capture({
        idempotencyKey: `world:${action}:${subjectRefs.join('|')}:${objectRefs.join('|')}`,
        occurredAt: nowIso(this.now), actorType: 'human', sourceModule: 'world', action,
        subjectRefs, objectRefs, contextRefs: ['domain:world'], outcome,
        provenance: { producer: 'W94Ga-world-runtime' }, summary: `World ${action}`,
        retentionClass: 'keep',
      });
    } catch { return { recorded: false, reason: 'CAPTURE_FAILED' }; }
  }

  _world(store, worldId) {
    const world = store.worlds.find(row => row.worldId === worldId);
    if (!world) throw codedError('WORLD_NOT_FOUND', `World 不存在: ${worldId}`);
    return world;
  }

  create(input = {}) {
    if (!isPlainObject(input)) throw codedError('WORLD_INVALID', 'World create payload 必须是对象');
    assertKnownKeys(input, ['schema', 'worldId', 'name', 'description', 'rootBranchId', 'branchIds', 'canonVersion', 'contextRefs', 'lockedFacts', 'timeline', 'characters', 'locations', 'institutions', 'relations', 'rules', 'provenance', 'createdAt', 'updatedAt', 'expectedRevision'], 'World create payload');
    const current = this.read();
    const at = nowIso(this.now);
    this._assertExpectedRevision(current, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const { expectedRevision: ignoredExpectedRevision, ...worldPayload } = input;
    const world = normalizeWorld({ ...worldPayload, worldId: input.worldId, rootBranchId: input.rootBranchId || `branch:${String(input.worldId || '').replace(/[^A-Za-z0-9._-]/g, '-')}-root`, createdAt: input.createdAt || at, updatedAt: input.updatedAt || at }, this.workspaceId(), at);
    if (current.worlds.some(row => row.worldId === world.worldId)) throw codedError('WORLD_EXISTS', 'World 已存在');
    const branches = this.branchService.snapshot();
    if (branches.branches.some(row => row.branchId === world.rootBranchId)) throw codedError('WORLD_BRANCH_EXISTS', 'World root branch 已存在');
    const branch = this.branchService.create({ branchId: world.rootBranchId, revisions: [], provenance: { source: 'W94Ga-world', worldId: world.worldId }, expectedRevision: branches.revision });
    const next = this.write({ worlds: [...current.worlds, world], proposals: current.proposals, reviews: current.reviews, merges: current.merges }, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const event = this._capture('create', [world.worldId], [world.rootBranchId]);
    return deepFreeze({ world, branch: branch.branch, revision: next.revision, event });
  }

  fork(input = {}) {
    if (!isPlainObject(input)) throw codedError('WORLD_INVALID', 'World fork payload 必须是对象');
    assertKnownKeys(input, ['schema', 'worldId', 'sourceBranchId', 'branchId', 'baseCanonVersion', 'forkPoint', 'provenance', 'expectedRevision'], 'World fork payload');
    const current = this.read();
    this._assertExpectedRevision(current, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const world = this._world(current, safeId(input.worldId, 'worldId', 'world:'));
    const sourceBranchId = safeId(input.sourceBranchId, 'sourceBranchId', 'branch:');
    const branchId = safeId(input.branchId, 'branchId', 'branch:');
    if (!world.branchIds.includes(sourceBranchId)) throw codedError('WORLD_BRANCH_NOT_FOUND', 'source branch 不属于该 World');
    if (world.branchIds.includes(branchId)) throw codedError('WORLD_BRANCH_EXISTS', '目标 branch 已存在');
    const branchSnapshot = this.branchService.snapshot();
    if (!branchSnapshot.branches.some(row => row.branchId === sourceBranchId)) throw codedError('WORLD_BRANCH_NOT_FOUND', 'source branch 不存在');
    const branch = this.branchService.create({ branchId, parentBranchIds: [sourceBranchId], revisions: [], provenance: { source: 'W94Ga-world-fork', worldId: world.worldId, forkPoint: input.forkPoint || '' }, expectedRevision: branchSnapshot.revision });
    const updatedWorld = normalizeWorld({ ...world, branchIds: [...world.branchIds, branchId], updatedAt: nowIso(this.now) }, this.workspaceId(), this.now);
    const next = this.write({ worlds: current.worlds.map(row => row.worldId === world.worldId ? updatedWorld : row), proposals: current.proposals, reviews: current.reviews, merges: current.merges }, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const event = this._capture('fork', [world.worldId, branchId], [sourceBranchId]);
    return deepFreeze({ world: updatedWorld, branch: branch.branch, revision: next.revision, event });
  }

  propose(input = {}) {
    if (!isPlainObject(input)) throw codedError('WORLD_INVALID', 'Canon proposal payload 必须是对象');
    assertKnownKeys(input, ['schema', 'worldId', 'branchId', 'changes', 'evidenceRefs', 'proposedBy', 'proposedAt', 'expectedRevision'], 'Canon proposal payload');
    const current = this.read();
    this._assertExpectedRevision(current, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const world = this._world(current, safeId(input.worldId, 'worldId', 'world:'));
    const branchId = safeId(input.branchId, 'branchId', 'branch:');
    if (!world.branchIds.includes(branchId)) throw codedError('WORLD_BRANCH_NOT_FOUND', 'proposal branch 不属于该 World');
    if (!Array.isArray(input.changes) || !input.changes.length) throw codedError('WORLD_INVALID', 'proposal 至少需要一个 change');
    const changes = input.changes.map(normalizeChange);
    const evidenceRefs = stringList(input.evidenceRefs || [], 'evidenceRefs').map((value, index) => safeRef(value, `evidenceRefs[${index}]`, ['artifact:', 'receipt:', 'event:']));
    const proposedBy = safeRef(input.proposedBy, 'proposedBy', ['human:', 'agent:', 'system:']);
    const proposedAt = nowIso(input.proposedAt || this.now);
    const proposalId = `proposal:${digest({ worldId: world.worldId, branchId, changes, evidenceRefs, proposedBy, proposedAt })}`;
    if (current.proposals.some(row => row.proposalId === proposalId)) throw codedError('WORLD_PROPOSAL_EXISTS', '相同 Canon proposal 已存在');
    const proposal = { schema: PROPOSAL_SCHEMA, proposalId, worldId: world.worldId, branchId, baseCanonVersion: world.canonVersion, changes, evidenceRefs, proposedBy, proposedAt, status: 'proposed', reviewRefs: [], mergedRevisions: [] };
    rejectPrivate(proposal, 'Canon proposal');
    const next = this.write({ worlds: current.worlds, proposals: [...current.proposals, deepFreeze(proposal)], reviews: current.reviews, merges: current.merges }, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const event = this._capture('canon-propose', [proposalId, world.worldId], [branchId]);
    return deepFreeze({ proposal, revision: next.revision, event });
  }

  review(input = {}) {
    if (!isPlainObject(input)) throw codedError('WORLD_INVALID', 'Canon review payload 必须是对象');
    assertKnownKeys(input, ['schema', 'proposalId', 'action', 'authorityRef', 'reason', 'decidedAt', 'expectedRevision'], 'Canon review payload');
    const current = this.read();
    this._assertExpectedRevision(current, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const proposalId = safeId(input.proposalId, 'proposalId', 'proposal:');
    const proposal = current.proposals.find(row => row.proposalId === proposalId);
    if (!proposal) throw codedError('WORLD_PROPOSAL_NOT_FOUND', 'Canon proposal 不存在');
    if (!['accept', 'reject'].includes(input.action)) throw codedError('WORLD_INVALID', 'review action 只能 accept/reject');
    if (!['proposed', 'under-review'].includes(proposal.status)) throw codedError('WORLD_PROPOSAL_STATE', 'proposal 当前状态不可 review');
    const authorityRef = safeRef(input.authorityRef, 'authorityRef', ['human:']);
    const reason = requiredString(input.reason, 'reason');
    const decidedAt = nowIso(input.decidedAt || this.now);
    const reviewId = `review:${digest({ proposalId, action: input.action, authorityRef, reason, decidedAt })}`;
    const review = { schema: REVIEW_SCHEMA, reviewId, proposalId, action: input.action, authorityRef, reason, decidedAt };
    const status = input.action === 'accept' ? 'accepted' : 'rejected';
    const nextProposal = { ...proposal, status, reviewRefs: [...proposal.reviewRefs, reviewId] };
    const next = this.write({ worlds: current.worlds, proposals: current.proposals.map(row => row.proposalId === proposalId ? nextProposal : row), reviews: [...current.reviews, review], merges: current.merges }, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const event = this._capture(`canon-review-${input.action}`, [proposalId], [authorityRef], input.action === 'accept' ? 'approval' : 'failed');
    return deepFreeze({ proposal: nextProposal, review, revision: next.revision, event });
  }

  merge(input = {}) {
    if (!isPlainObject(input)) throw codedError('WORLD_INVALID', 'Canon merge payload 必须是对象');
    assertKnownKeys(input, ['schema', 'proposalId', 'acceptedRevisions', 'authorityRef', 'reason', 'mergedAt', 'expectedRevision'], 'Canon merge payload');
    const current = this.read();
    this._assertExpectedRevision(current, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const proposalId = safeId(input.proposalId, 'proposalId', 'proposal:');
    const proposal = current.proposals.find(row => row.proposalId === proposalId);
    if (!proposal || !['accepted', 'partially-merged'].includes(proposal.status)) throw codedError('WORLD_PROPOSAL_STATE', '只有 accepted proposal 才能 merge');
    const world = this._world(current, proposal.worldId);
    const authorityRef = safeRef(input.authorityRef, 'authorityRef', ['human:']);
    const reason = requiredString(input.reason, 'reason');
    const requested = input.acceptedRevisions === undefined ? proposal.changes.map(row => row.revision) : stringList(input.acceptedRevisions, 'acceptedRevisions').map((value, index) => safeId(value, `acceptedRevisions[${index}]`, 'rev:'));
    const already = new Set(proposal.mergedRevisions || []);
    const selected = proposal.changes.filter(change => requested.includes(change.revision) && !already.has(change.revision));
    if (!selected.length || requested.some(revision => !proposal.changes.some(change => change.revision === revision))) throw codedError('WORLD_MERGE_SELECTION_INVALID', 'merge 选择必须来自 proposal 且不可重复');
    const branchSnapshot = this.branchService.snapshot();
    const root = branchSnapshot.branches.find(row => row.branchId === world.rootBranchId);
    if (!root) throw codedError('WORLD_BRANCH_NOT_FOUND', 'World root branch 不存在');
    const selectedKeys = new Set(selected.map(row => `${row.domain}:${row.artifactRef}`));
    const supersedes = new Set(root.supersedes || []);
    const nextRevisions = [...root.revisions];
    for (const change of selected) {
      const key = `${change.domain}:${change.artifactRef}`;
      const old = nextRevisions.find(row => `${row.domain}:${row.artifactRef}` === key);
      if (old && old.revision !== change.revision && old.status === 'current') supersedes.add(old.revision);
      for (let index = nextRevisions.length - 1; index >= 0; index -= 1) if (`${nextRevisions[index].domain}:${nextRevisions[index].artifactRef}` === key) nextRevisions.splice(index, 1);
      nextRevisions.push(change);
    }
    const updatedBranch = this.branchService.update(world.rootBranchId, draft => { draft.revisions = nextRevisions; draft.supersedes = [...supersedes]; }, branchSnapshot.revision);
    const mergedRevisions = [...new Set([...already, ...selected.map(row => row.revision)])].sort();
    const remaining = proposal.changes.some(row => !mergedRevisions.includes(row.revision));
    const canonVersion = `canon:${digest({ worldId: world.worldId, previous: world.canonVersion, proposalId, mergedRevisions })}`;
    const updatedWorld = normalizeWorld({ ...world, canonVersion, updatedAt: nowIso(this.now) }, this.workspaceId(), this.now);
    const mergeId = `merge:${digest({ proposalId, mergedRevisions, canonVersion })}`;
    const merge = { schema: MERGE_SCHEMA, mergeId, proposalId, worldId: world.worldId, rootBranchId: world.rootBranchId, acceptedRevisions: selected.map(row => row.revision), authorityRef, reason, canonVersion, mergedAt: nowIso(input.mergedAt || this.now), status: remaining ? 'partially-merged' : 'merged' };
    const nextProposal = { ...proposal, status: remaining ? 'partially-merged' : 'merged', mergedRevisions };
    const next = this.write({ worlds: current.worlds.map(row => row.worldId === world.worldId ? updatedWorld : row), proposals: current.proposals.map(row => row.proposalId === proposalId ? nextProposal : row), reviews: current.reviews, merges: [...current.merges, merge] }, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const event = this._capture('canon-merge', [proposalId, world.worldId], [world.rootBranchId, authorityRef], 'approval');
    return deepFreeze({ world: updatedWorld, proposal: nextProposal, merge, branch: updatedBranch.branch, revision: next.revision, event });
  }

  snapshot({ worldId: selectedWorldId } = {}) {
    const store = this.read();
    const worlds = selectedWorldId ? [this._world(store, safeId(selectedWorldId, 'worldId', 'world:'))] : store.worlds;
    const branches = this.branchService.snapshot();
    const worldIds = new Set(worlds.map(row => row.worldId));
    return deepFreeze({ schema: WORLD_SNAPSHOT_SCHEMA, workspaceId: store.workspaceId, revision: store.revision, worlds: worlds.map(row => clonePlain(row)), proposals: store.proposals.filter(row => worldIds.has(row.worldId)).map(row => clonePlain(row)), reviews: store.reviews.filter(row => store.proposals.some(proposal => proposal.reviewRefs.includes(row.reviewId) && worldIds.has(proposal.worldId))).map(row => clonePlain(row)), merges: store.merges.filter(row => worldIds.has(row.worldId)).map(row => clonePlain(row)), branches: branches.branches.filter(row => worlds.some(world => world.branchIds.includes(row.branchId))), effectiveStates: branches.effectiveStates.filter(row => worlds.some(world => world.branchIds.includes(row.branchId))), localOnly: true, authorityGranted: false });
  }

  rebuild(options = {}) { return this.snapshot(options); }
}

module.exports = { WorldRuntimeService, WORLD_STORE_SCHEMA, WORLD_SNAPSHOT_SCHEMA, PROPOSAL_SCHEMA, REVIEW_SCHEMA, MERGE_SCHEMA, _forTests: { canonical, digest, normalizeWorld, normalizeStore, normalizeChange, rejectPrivate } };
