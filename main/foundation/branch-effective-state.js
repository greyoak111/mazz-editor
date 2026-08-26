'use strict';

// W94E: Branch manifests are intentionally small identity/revision facts.  This
// module is pure: it never reads a workspace, chooses an authority, or writes a
// current value on behalf of an agent.
const crypto = require('node:crypto');
const {
  assertKnownKeys, clonePlain, deepFreeze, isPlainObject, optionalString,
  requiredString, stringList,
} = require('./plain-value');

const BRANCH_MANIFEST_SCHEMA = 'mazz.branch-manifest/v0';
const BRANCH_REVISION_SCHEMA = 'mazz.branch-revision/v0';
const EFFECTIVE_STATE_SCHEMA = 'mazz.branch-effective-state/v0';
const DOMAINS = new Set(['factory', 'library', 'player', 'calc', 'chart', 'canvas', 'blender', 'world']);
const REVISION_STATUSES = new Set(['current', 'superseded', 'deleted', 'restored', 'unknown', 'pending']);
const SECRET_KEY = /(?:api.?key|secret|token|authorization|password|credential|private.?key|cookie)/i;
const PATH_VALUE = /(?:^|[\\/])\.\.?(?:[\\/]|$)|^(?:[A-Za-z]:[\\/]|\\\\|\/)|^(?:https?|file|ws|wss):\/\//i;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex');
}

function assertNoSecrets(value, label, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SECRET_KEY.test(key)) throw new Error(`${label} 禁止 secret 字段: ${childPath}`);
    assertNoSecrets(child, label, childPath);
  }
}

function safeRef(value, label, prefix = '') {
  const ref = requiredString(value, label);
  if (PATH_VALUE.test(ref) || /[\r\n\t]/.test(ref) || /\s/.test(ref)) throw new Error(`${label} 不得包含路径或空白`);
  if (ref.includes('://') || ref.includes('..')) throw new Error(`${label} 不得包含网络定位器或路径片段`);
  if (prefix && !ref.startsWith(prefix)) throw new Error(`${label} 必须以 ${prefix} 开头`);
  return ref;
}

function safeRefList(value, label, prefix = '') {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const rows = value.map((item, index) => safeRef(item, `${label}[${index}]`, prefix));
  if (new Set(rows).size !== rows.length) throw new Error(`${label} 不能重复`);
  return rows;
}

function logicalKey(domain, artifactRef) {
  const suffix = String(artifactRef).startsWith('artifact:') ? String(artifactRef).slice('artifact:'.length) : String(artifactRef);
  return `${domain}:${suffix}`;
}

function normalizeProvenance(input, label = 'provenance') {
  if (!isPlainObject(input)) throw new Error(`${label} 必须是对象`);
  assertNoSecrets(input, label);
  const inspect = (value, at = label) => {
    if (typeof value === 'string' && (PATH_VALUE.test(value) || value.includes('://'))) throw new Error(`${label} 禁止路径或网络定位器: ${at}`);
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) inspect(child, `${at}.${key}`);
  };
  inspect(input);
  return clonePlain(input, label);
}

function normalizeRevision(input, index = 0) {
  if (!isPlainObject(input)) throw new Error(`revision[${index}] 必须是对象`);
  assertKnownKeys(input, ['schema', 'domain', 'artifactRef', 'revision', 'status'], `revision[${index}]`);
  assertNoSecrets(input, `revision[${index}]`);
  if (input.schema != null && input.schema !== BRANCH_REVISION_SCHEMA) throw new Error(`不支持的 Branch Revision schema: ${input.schema}`);
  const domain = requiredString(input.domain, `revision[${index}].domain`);
  if (!DOMAINS.has(domain)) throw new Error(`revision[${index}].domain 非法: ${domain}`);
  const status = optionalString(input.status) || 'current';
  if (!REVISION_STATUSES.has(status)) throw new Error(`revision[${index}].status 非法: ${status}`);
  return deepFreeze({
    schema: BRANCH_REVISION_SCHEMA,
    domain,
    artifactRef: safeRef(input.artifactRef, `revision[${index}].artifactRef`, 'artifact:'),
    revision: safeRef(input.revision, `revision[${index}].revision`, 'rev:'),
    status,
  });
}

function manifestIdentity(input) {
  return {
    workspaceId: input.workspaceId,
    baseBranchId: input.baseBranchId || '',
    parentBranchIds: [...(input.parentBranchIds || [])].sort(),
    contextRefs: [...(input.contextRefs || [])].sort(),
    relationRefs: [...(input.relationRefs || [])].sort(),
    eventCursor: input.eventCursor || '',
    revisions: (input.revisions || []).map(row => ({ domain: row.domain, artifactRef: row.artifactRef, revision: row.revision, status: row.status })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    supersedes: [...(input.supersedes || [])].sort(),
  };
}

function normalizeManifest(input = {}) {
  if (!isPlainObject(input)) throw new Error('Branch Manifest 必须是对象');
  assertKnownKeys(input, ['schema', 'branchId', 'workspaceId', 'baseBranchId', 'parentBranchIds', 'contextRefs', 'relationRefs', 'eventCursor', 'revisions', 'supersedes', 'provenance', 'createdAt', 'updatedAt'], 'Branch Manifest');
  assertNoSecrets(input, 'Branch Manifest');
  if (input.schema != null && input.schema !== BRANCH_MANIFEST_SCHEMA) throw new Error(`不支持的 Branch Manifest schema: ${input.schema}`);
  const workspaceId = safeRef(input.workspaceId, 'workspaceId', 'workspace:');
  const baseBranchId = optionalString(input.baseBranchId);
  if (baseBranchId) safeRef(baseBranchId, 'baseBranchId', 'branch:');
  const parentBranchIds = safeRefList(input.parentBranchIds || [], 'parentBranchIds', 'branch:');
  const contextRefs = safeRefList(input.contextRefs || [], 'contextRefs');
  const relationRefs = safeRefList(input.relationRefs || [], 'relationRefs');
  const eventCursor = optionalString(input.eventCursor);
  if (eventCursor) safeRef(eventCursor, 'eventCursor', 'event:');
  const revisions = (input.revisions || []).map(normalizeRevision);
  const revisionKeys = revisions.map(row => logicalKey(row.domain, row.artifactRef));
  if (new Set(revisionKeys).size !== revisionKeys.length) throw new Error('Branch Manifest revisions 同一 domain/artifactRef 不能重复');
  const supersedes = safeRefList(input.supersedes || [], 'supersedes');
  const provenance = normalizeProvenance(input.provenance || { source: 'branch-manifest' });
  const createdAt = requiredString(input.createdAt || new Date(0).toISOString(), 'createdAt');
  const updatedAt = requiredString(input.updatedAt || createdAt, 'updatedAt');
  const draft = { schema: BRANCH_MANIFEST_SCHEMA, workspaceId, baseBranchId, parentBranchIds, contextRefs, relationRefs, eventCursor, revisions, supersedes, provenance, createdAt, updatedAt };
  const expectedId = `branch:${digest(manifestIdentity(draft))}`;
  const branchId = optionalString(input.branchId) || expectedId;
  safeRef(branchId, 'branchId', 'branch:');
  if (baseBranchId === branchId || parentBranchIds.includes(branchId)) throw new Error('Branch parent/base 不得自环');
  return deepFreeze({ ...draft, branchId });
}

function normalizeFact(input, index = 0) {
  if (!isPlainObject(input)) throw new Error(`effective fact[${index}] 必须是对象`);
  assertKnownKeys(input, ['key', 'domain', 'artifactRef', 'revision', 'status', 'sourceRefs', 'supersedes'], `effective fact[${index}]`);
  assertNoSecrets(input, `effective fact[${index}]`);
  const domain = requiredString(input.domain, `effective fact[${index}].domain`);
  if (!DOMAINS.has(domain)) throw new Error(`effective fact[${index}].domain 非法: ${domain}`);
  const artifactRef = safeRef(input.artifactRef, `effective fact[${index}].artifactRef`, 'artifact:');
  const revision = safeRef(input.revision, `effective fact[${index}].revision`, 'rev:');
  const status = optionalString(input.status) || 'current';
  if (!REVISION_STATUSES.has(status)) throw new Error(`effective fact[${index}].status 非法: ${status}`);
  const key = optionalString(input.key) || logicalKey(domain, artifactRef);
  safeRef(key, `effective fact[${index}].key`);
  const sourceRefs = safeRefList(input.sourceRefs || [], `effective fact[${index}].sourceRefs`);
  const supersedes = safeRefList(input.supersedes || [], `effective fact[${index}].supersedes`);
  return { key, domain, artifactRef, revision, status, sourceRefs, supersedes };
}

function normalizeResolution(input, index = 0) {
  if (!isPlainObject(input)) throw new Error(`resolution[${index}] 必须是对象`);
  assertKnownKeys(input, ['key', 'resolvedRevision', 'previousRevisions', 'authorityRef', 'reason', 'sourceRefs'], `resolution[${index}]`);
  assertNoSecrets(input, `resolution[${index}]`);
  const authorityRef = safeRef(input.authorityRef, `resolution[${index}].authorityRef`, 'human:');
  const previousRevisions = safeRefList(input.previousRevisions || [], `resolution[${index}].previousRevisions`, 'rev:');
  const resolvedRevision = safeRef(input.resolvedRevision, `resolution[${index}].resolvedRevision`, 'rev:');
  const sourceRefs = safeRefList(input.sourceRefs || [], `resolution[${index}].sourceRefs`);
  const reason = requiredString(input.reason, `resolution[${index}].reason`);
  return { key: safeRef(input.key, `resolution[${index}].key`), resolvedRevision, previousRevisions, authorityRef, reason, sourceRefs };
}

function manifestRows(manifest, depth, sourceBranch, out, seen) {
  if (!manifest) return;
  const normalized = normalizeManifest(manifest);
  const visitKey = `${normalized.branchId}@${depth}`;
  if (seen.has(visitKey)) return;
  seen.add(visitKey);
  for (const revision of normalized.revisions) out.push({ ...revision, key: logicalKey(revision.domain, revision.artifactRef), depth, sourceBranch, sourceRefs: [normalized.branchId] });
}

function computeEffectiveState(input = {}) {
  if (!isPlainObject(input)) throw new Error('Effective State input 必须是对象');
  assertKnownKeys(input, ['manifest', 'parents', 'facts', 'resolutions'], 'Effective State input');
  assertNoSecrets(input, 'Effective State input');
  const manifest = normalizeManifest(input.manifest);
  const parents = Array.isArray(input.parents) ? input.parents : [];
  const parentMap = new Map();
  for (const parent of parents) {
    const row = normalizeManifest(parent);
    if (row.workspaceId !== manifest.workspaceId) throw new Error('Effective State parent Workspace identity 不匹配');
    parentMap.set(row.branchId, row);
  }
  const rows = [];
  const seen = new Set();
  manifestRows(manifest, 0, manifest.branchId, rows, seen);
  const walk = (parentId, depth, stack = new Set()) => {
    if (stack.has(parentId)) throw new Error('Branch parent 不得形成环');
    const parent = parentMap.get(parentId);
    if (!parent) return;
    manifestRows(parent, depth, parent.branchId, rows, seen);
    const next = new Set(stack); next.add(parentId);
    for (const id of parent.parentBranchIds) walk(id, depth + 1, next);
  };
  for (const id of manifest.parentBranchIds) walk(id, 1);
  const suppliedFacts = (input.facts || []).map(normalizeFact);
  const factByRevision = new Map(suppliedFacts.map(fact => [fact.revision, fact]));
  const grouped = new Map();
  for (const row of rows) { if (!grouped.has(row.key)) grouped.set(row.key, []); grouped.get(row.key).push(row); }
  const facts = [], unknown = [], conflicts = [], sourceRefs = new Set([manifest.branchId, ...manifest.contextRefs, ...manifest.relationRefs, ...(manifest.eventCursor ? [manifest.eventCursor] : [])]);
  for (const [key, candidates] of grouped) {
    const unique = new Map();
    for (const row of candidates) {
      const evidence = factByRevision.get(row.revision);
      if (evidence && evidence.status === 'unknown') continue;
      if (row.status === 'unknown' || row.status === 'pending') continue;
      if (row.status === 'superseded') continue;
      const existing = unique.get(row.revision);
      if (existing) existing.sourceRefs = [...new Set([...existing.sourceRefs, ...row.sourceRefs])];
      else unique.set(row.revision, { ...row, sourceRefs: [...new Set([...(evidence?.sourceRefs || []), ...row.sourceRefs])] });
      for (const ref of evidence?.sourceRefs || []) sourceRefs.add(ref);
    }
    const active = [...unique.values()];
    const superseded = new Set(manifest.supersedes);
    for (const row of suppliedFacts) for (const ref of row.supersedes) superseded.add(ref);
    const remaining = active.filter(row => !superseded.has(row.revision));
    if (!remaining.length) { unknown.push({ key, reason: 'missing-evidence', sourceRefs: [] }); continue; }
    const minDepth = Math.min(...remaining.map(row => row.depth));
    const nearest = remaining.filter(row => row.depth === minDepth);
    const revisions = [...new Set(nearest.map(row => row.revision))].sort();
    if (revisions.length > 1) {
      conflicts.push({ key, revisions, reason: 'concurrent-parent', sourceRefs: [...new Set(nearest.flatMap(row => row.sourceRefs))] });
      nearest.forEach(row => row.sourceRefs.forEach(ref => sourceRefs.add(ref)));
      continue;
    }
    const row = nearest[0];
    const fact = { key, domain: row.domain, artifactRef: row.artifactRef, revision: row.revision, status: row.status === 'deleted' ? 'deleted' : 'current', sourceRefs: [...new Set(row.sourceRefs)] };
    facts.push(fact); fact.sourceRefs.forEach(ref => sourceRefs.add(ref));
  }
  for (const resolutionInput of (input.resolutions || [])) {
    const resolution = normalizeResolution(resolutionInput);
    const conflict = conflicts.find(item => item.key === resolution.key);
    if (!conflict || !conflict.revisions.every(revision => resolution.previousRevisions.includes(revision)) || !conflict.revisions.includes(resolution.resolvedRevision)) continue;
    const winner = rows.find(row => row.key === resolution.key && row.revision === resolution.resolvedRevision);
    if (!winner) continue;
    const index = facts.findIndex(item => item.key === resolution.key);
    const fact = { key: resolution.key, domain: winner.domain, artifactRef: winner.artifactRef, revision: winner.revision, status: 'current', sourceRefs: [...new Set([...(winner.sourceRefs || []), ...resolution.sourceRefs, resolution.authorityRef])] };
    if (index >= 0) facts[index] = fact; else facts.push(fact);
    conflicts.splice(conflicts.indexOf(conflict), 1);
    sourceRefs.add(resolution.authorityRef); resolution.sourceRefs.forEach(ref => sourceRefs.add(ref));
  }
  const result = {
    schema: EFFECTIVE_STATE_SCHEMA,
    branchId: manifest.branchId,
    facts: facts.sort((a, b) => a.key.localeCompare(b.key)),
    unknown: unknown.sort((a, b) => a.key.localeCompare(b.key)),
    conflicts: conflicts.sort((a, b) => a.key.localeCompare(b.key)),
    sourceRefs: [...sourceRefs].sort(),
    resolutionRequired: conflicts.length > 0 || unknown.length > 0,
    authorityGranted: false,
  };
  return deepFreeze(result);
}

const reduceEffectiveState = computeEffectiveState;

module.exports = {
  BRANCH_MANIFEST_SCHEMA, BRANCH_REVISION_SCHEMA, EFFECTIVE_STATE_SCHEMA, DOMAINS,
  normalizeRevision, normalizeManifest, normalizeFact, normalizeResolution,
  computeEffectiveState, reduceEffectiveState,
};
