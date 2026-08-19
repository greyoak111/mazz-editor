'use strict';

const crypto = require('node:crypto');
const {
  assertKnownKeys, clonePlain, deepFreeze, isPlainObject, optionalString, requiredString, stringList,
} = require('./plain-value');

const CONTEXT_PACKAGE_SCHEMA = 'mazz.context-package/v0';
const COVERAGE_SNAPSHOT_SCHEMA = 'mazz.coverage-snapshot/v0';
const COVERAGE_REPORT_SCHEMA = 'mazz.coverage-report/v0';
const SOURCE_STATES = new Set(['CURRENT', 'SUPERSEDED', 'HISTORICAL', 'PROPOSED', 'REJECTED', 'INFERRED']);
const OBLIGATION_STATES = new Set(['REGISTERED', 'NOT_AUTHORIZED', 'READY', 'IN_PROGRESS', 'BLOCKED', 'EVIDENCED', 'WAIVED', 'SUPERSEDED']);
const CANDIDATE_KINDS = new Set(['retrieval-candidate', 'workspace-event', 'episode', 'shadow-relation']);
const SECRET_KEY = /(?:api.?key|api.?token|access.?token|auth.?token|secret|authorization|password|credential|private.?key|cookie)$/i;
const RAW_HISTORY_KEY = /(?:chatHistory|conversationDump|keystrokes|clipboardBody|terminalInput|environment|prompt|transcript)/i;

function digest(value) {
  const canonical = current => Array.isArray(current) ? current.map(canonical)
    : isPlainObject(current) ? Object.fromEntries(Object.keys(current).sort().map(key => [key, canonical(current[key])])) : current;
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex');
}
function finite(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label} 非法`);
  return number;
}
function iso(value, label) {
  const text = requiredString(value, label); const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new Error(`${label} 必须是 ISO 时间`);
  return new Date(time).toISOString();
}
function assertNoSecrets(value, label, at = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const field = at ? `${at}.${key}` : key;
    if (SECRET_KEY.test(key) || RAW_HISTORY_KEY.test(key)) throw new Error(`${label} 禁止敏感或原始会话字段: ${field}`);
    assertNoSecrets(child, label, field);
  }
}
function optionalIso(value, label) { return value ? iso(value, label) : ''; }

function normalizeContextSource(input, index = 0) {
  if (!isPlainObject(input)) throw new Error(`sources[${index}] 必须是对象`);
  assertKnownKeys(input, [
    'sourceRef', 'kind', 'title', 'topicRef', 'status', 'authorityRef', 'effectiveAt', 'replacementRef',
    'supersessionReason', 'version', 'mtime', 'hash', 'tokenEstimate', 'relevance', 'authorityLevel',
    'summary', 'excerpt', 'sensitivity', 'provenance', 'mandatory',
  ], `sources[${index}]`);
  assertNoSecrets(input, `sources[${index}]`);
  let status = requiredString(input.status, `sources[${index}].status`).toUpperCase();
  if (!SOURCE_STATES.has(status)) throw new Error(`sources[${index}].status 非法`);
  const kind = requiredString(input.kind, `sources[${index}].kind`);
  const authorityRef = optionalString(input.authorityRef);
  if (CANDIDATE_KINDS.has(kind)) status = 'INFERRED';
  if (status === 'CURRENT' && !authorityRef) throw new Error(`sources[${index}] CURRENT 必须有 Authority`);
  if (status === 'SUPERSEDED') {
    if (!optionalString(input.replacementRef) || !input.effectiveAt || !authorityRef || !optionalString(input.supersessionReason)) {
      throw new Error(`sources[${index}] SUPERSEDED 必须有 replacement/effectiveAt/Authority/reason`);
    }
  }
  const row = {
    sourceRef: requiredString(input.sourceRef, `sources[${index}].sourceRef`), kind,
    title: requiredString(input.title, `sources[${index}].title`), topicRef: optionalString(input.topicRef),
    status, authorityRef: CANDIDATE_KINDS.has(kind) ? '' : authorityRef,
    effectiveAt: optionalIso(input.effectiveAt, `sources[${index}].effectiveAt`),
    replacementRef: optionalString(input.replacementRef), supersessionReason: optionalString(input.supersessionReason),
    version: optionalString(input.version), mtime: optionalIso(input.mtime, `sources[${index}].mtime`),
    hash: requiredString(input.hash, `sources[${index}].hash`),
    tokenEstimate: Math.ceil(finite(input.tokenEstimate, `sources[${index}].tokenEstimate`, { min: 0, max: 10_000_000 })),
    relevance: finite(input.relevance, `sources[${index}].relevance`, { min: 0, max: 1 }),
    authorityLevel: Math.floor(finite(input.authorityLevel ?? 0, `sources[${index}].authorityLevel`, { min: 0, max: 100 })),
    summary: optionalString(input.summary).slice(0, 1000), excerpt: optionalString(input.excerpt).slice(0, 12000),
    sensitivity: stringList(input.sensitivity || [], `sources[${index}].sensitivity`),
    provenance: clonePlain(input.provenance || {}, `sources[${index}].provenance`), mandatory: input.mandatory === true,
  };
  return deepFreeze(row);
}

function normalizeObligation(input, index = 0) {
  if (!isPlainObject(input)) throw new Error(`obligations[${index}] 必须是对象`);
  assertKnownKeys(input, ['obligationId', 'title', 'status', 'dependencyIds', 'gateRefs', 'evidenceRefs', 'authorityRef', 'reason', 'impact', 'replacementId', 'updatedAt', 'scopeRef'], `obligations[${index}]`);
  assertNoSecrets(input, `obligations[${index}]`);
  const status = requiredString(input.status, `obligations[${index}].status`).toUpperCase();
  if (!OBLIGATION_STATES.has(status)) throw new Error(`obligations[${index}].status 非法`);
  const row = {
    obligationId: requiredString(input.obligationId, `obligations[${index}].obligationId`),
    title: requiredString(input.title, `obligations[${index}].title`), status,
    dependencyIds: stringList(input.dependencyIds || [], `obligations[${index}].dependencyIds`),
    gateRefs: stringList(input.gateRefs || [], `obligations[${index}].gateRefs`),
    evidenceRefs: stringList(input.evidenceRefs || [], `obligations[${index}].evidenceRefs`),
    authorityRef: optionalString(input.authorityRef), reason: optionalString(input.reason), impact: optionalString(input.impact),
    replacementId: optionalString(input.replacementId), updatedAt: iso(input.updatedAt, `obligations[${index}].updatedAt`),
    scopeRef: optionalString(input.scopeRef),
  };
  if (status === 'EVIDENCED' && !row.evidenceRefs.length) throw new Error(`${row.obligationId} EVIDENCED 必须引用证据`);
  if (status === 'WAIVED' && (!row.authorityRef.startsWith('human:') || !row.reason || !row.impact)) throw new Error(`${row.obligationId} WAIVED 必须有 human Authority/reason/impact`);
  if (status === 'SUPERSEDED' && (!row.replacementId || !row.authorityRef || !row.reason)) throw new Error(`${row.obligationId} SUPERSEDED 必须有 replacement/Authority/reason`);
  return deepFreeze(row);
}

function createCoverageSnapshot(obligationInputs) {
  const obligations = (obligationInputs || []).map(normalizeObligation);
  const ids = new Set();
  for (const row of obligations) {
    if (ids.has(row.obligationId)) throw new Error(`obligationId 重复: ${row.obligationId}`);
    ids.add(row.obligationId);
  }
  for (const row of obligations) {
    for (const dependencyId of row.dependencyIds) if (!ids.has(dependencyId)) throw new Error(`${row.obligationId} 引用未知 dependency: ${dependencyId}`);
    if (row.replacementId && !ids.has(row.replacementId)) throw new Error(`${row.obligationId} 引用未知 replacement: ${row.replacementId}`);
  }
  const counts = Object.fromEntries([...OBLIGATION_STATES].map(status => [status, obligations.filter(item => item.status === status).length]));
  return deepFreeze({ schema: COVERAGE_SNAPSHOT_SCHEMA, total: obligations.length, counts, obligations, silentlyDropped: 0 });
}

function transitionObligation(currentInput, patch = {}) {
  const current = normalizeObligation(currentInput);
  const allowed = {
    REGISTERED: ['NOT_AUTHORIZED', 'READY', 'SUPERSEDED'], NOT_AUTHORIZED: ['READY', 'WAIVED', 'SUPERSEDED'],
    READY: ['IN_PROGRESS', 'BLOCKED', 'WAIVED', 'SUPERSEDED'], IN_PROGRESS: ['BLOCKED', 'EVIDENCED', 'WAIVED', 'SUPERSEDED'],
    BLOCKED: ['READY', 'IN_PROGRESS', 'WAIVED', 'SUPERSEDED'], EVIDENCED: ['SUPERSEDED'], WAIVED: ['SUPERSEDED'], SUPERSEDED: [],
  };
  const nextStatus = requiredString(patch.status, 'patch.status').toUpperCase();
  if (!(allowed[current.status] || []).includes(nextStatus)) throw new Error(`Coverage 非法状态迁移: ${current.status} → ${nextStatus}`);
  return normalizeObligation({ ...current, ...patch, status: nextStatus, obligationId: current.obligationId, updatedAt: patch.updatedAt || new Date().toISOString() });
}

function sourceConflictMap(sources) {
  const byTopic = new Map();
  for (const source of sources.filter(item => item.status === 'CURRENT' && item.topicRef)) {
    const list = byTopic.get(source.topicRef) || []; list.push(source); byTopic.set(source.topicRef, list);
  }
  return [...byTopic.entries()].flatMap(([topicRef, rows]) => {
    const hashes = new Set(rows.map(row => row.hash));
    return hashes.size > 1 ? [{ conflictId: `conflict:${digest({ topicRef, refs: rows.map(row => row.sourceRef).sort() })}`, topicRef, sourceRefs: rows.map(row => row.sourceRef).sort(), reason: 'MULTIPLE_CURRENT_CLAIMS', resolution: 'REQUIRES_AUTHORITY' }] : [];
  });
}
function statusRank(status) { return ({ CURRENT: 6, PROPOSED: 5, INFERRED: 4, HISTORICAL: 3, SUPERSEDED: 2, REJECTED: 1 })[status] || 0; }

function compileContextPackage(input = {}) {
  if (!isPlainObject(input)) throw new Error('Context compile request 必须是对象');
  assertKnownKeys(input, ['taskId', 'seatId', 'checkpointId', 'compilerVersion', 'policyVersion', 'budget', 'sources', 'obligations', 'constraints', 'recentDelta', 'unknowns', 'seatPolicy', 'compiledAt'], 'Context compile request');
  assertNoSecrets(input, 'Context compile request');
  const budget = Math.floor(finite(input.budget, 'budget', { min: 1, max: 2_000_000 }));
  const sources = (input.sources || []).map(normalizeContextSource);
  const sourceIds = new Set();
  for (const source of sources) { if (sourceIds.has(source.sourceRef)) throw new Error(`sourceRef 重复: ${source.sourceRef}`); sourceIds.add(source.sourceRef); }
  const seatPolicy = isPlainObject(input.seatPolicy) ? input.seatPolicy : {};
  assertKnownKeys(seatPolicy, ['allowedSensitivity', 'deniedKinds', 'maxSourceTokens'], 'seatPolicy');
  const allowedSensitivity = new Set(stringList(seatPolicy.allowedSensitivity || ['public', 'internal'], 'seatPolicy.allowedSensitivity'));
  const deniedKinds = new Set(stringList(seatPolicy.deniedKinds || [], 'seatPolicy.deniedKinds'));
  const maxSourceTokens = Math.floor(finite(seatPolicy.maxSourceTokens ?? budget, 'seatPolicy.maxSourceTokens', { min: 1, max: budget }));
  const exclusions = [], eligible = [];
  for (const source of sources) {
    const deniedLabel = source.sensitivity.find(label => !allowedSensitivity.has(label));
    if (deniedLabel) exclusions.push({ ref: source.sourceRef, reason: `SEAT_PERMISSION:${deniedLabel}` });
    else if (deniedKinds.has(source.kind)) exclusions.push({ ref: source.sourceRef, reason: 'SEAT_KIND_DENIED' });
    else if (source.status === 'REJECTED') exclusions.push({ ref: source.sourceRef, reason: 'REJECTED' });
    else eligible.push(source);
  }
  eligible.sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || statusRank(b.status) - statusRank(a.status) || b.authorityLevel - a.authorityLevel || b.relevance - a.relevance || a.sourceRef.localeCompare(b.sourceRef));
  const selected = []; let used = 0; let overflow = false;
  for (const source of eligible) {
    const sourceCost = source.tokenEstimate;
    if (!source.mandatory && sourceCost > maxSourceTokens) exclusions.push({ ref: source.sourceRef, reason: 'SOURCE_TOKEN_LIMIT' });
    else if (source.mandatory || used + sourceCost <= budget) {
      selected.push(source); used += sourceCost; if (used > budget || source.tokenEstimate > maxSourceTokens) overflow = true;
    } else exclusions.push({ ref: source.sourceRef, reason: 'BUDGET_EXCEEDED' });
  }
  const coverageSnapshot = createCoverageSnapshot(input.obligations || []);
  const conflicts = sourceConflictMap(sources);
  const constraints = stringList(input.constraints || [], 'constraints');
  const recentDelta = stringList(input.recentDelta || [], 'recentDelta');
  const unknowns = stringList(input.unknowns || [], 'unknowns');
  const base = {
    taskId: requiredString(input.taskId, 'taskId'), seatId: requiredString(input.seatId, 'seatId'),
    checkpointId: requiredString(input.checkpointId, 'checkpointId'), compilerVersion: requiredString(input.compilerVersion, 'compilerVersion'),
    policyVersion: requiredString(input.policyVersion, 'policyVersion'), budget, used, overflow,
    authoritativeRefs: selected.filter(source => source.status === 'CURRENT' && !CANDIDATE_KINDS.has(source.kind)),
    relevantRefs: selected.filter(source => source.status !== 'CURRENT' || CANDIDATE_KINDS.has(source.kind)),
    recentDelta, constraints, knownConflicts: conflicts, unknowns,
    excludedRefs: exclusions.sort((a, b) => a.ref.localeCompare(b.ref)), coverageSnapshot,
    provenance: { sourceCount: sources.length, selectedCount: selected.length, candidateAuthorityGranted: false, compiler: 'deterministic-local', conversationHistoryUsed: false },
    compiledAt: iso(input.compiledAt || new Date().toISOString(), 'compiledAt'),
  };
  const contextPackageId = `context-package:${digest(base)}`;
  return deepFreeze({ schema: CONTEXT_PACKAGE_SCHEMA, contextPackageId, ...base });
}

function createCoverageReport(snapshotInput, { authorizedScopeRefs = [], changedRefs = [], evidenceRefs = [] } = {}) {
  const snapshot = snapshotInput?.schema === COVERAGE_SNAPSHOT_SCHEMA ? snapshotInput : createCoverageSnapshot(snapshotInput?.obligations || snapshotInput || []);
  const authorized = new Set(authorizedScopeRefs); const evidence = new Set(evidenceRefs);
  const authorizedObligations = snapshot.obligations.filter(item => !authorized.size || authorized.has(item.scopeRef));
  const changedWithoutCoverage = changedRefs.filter(ref => !snapshot.obligations.some(item => item.evidenceRefs.includes(ref) || item.scopeRef === ref));
  const evidencedWithoutKnownArtifact = snapshot.obligations.filter(item => item.status === 'EVIDENCED' && evidence.size && !item.evidenceRefs.some(ref => evidence.has(ref))).map(item => item.obligationId);
  return deepFreeze({
    schema: COVERAGE_REPORT_SCHEMA, total: snapshot.total, authorizedCount: authorizedObligations.length,
    open: authorizedObligations.filter(item => !['EVIDENCED', 'WAIVED', 'SUPERSEDED'].includes(item.status)).map(item => item.obligationId),
    blocked: authorizedObligations.filter(item => item.status === 'BLOCKED').map(item => item.obligationId),
    notAuthorized: snapshot.obligations.filter(item => item.status === 'NOT_AUTHORIZED').map(item => item.obligationId),
    evidenced: snapshot.obligations.filter(item => item.status === 'EVIDENCED').map(item => item.obligationId),
    drift: { changedWithoutCoverage, evidencedWithoutKnownArtifact }, silentlyDropped: snapshot.silentlyDropped,
  });
}

module.exports = {
  CONTEXT_PACKAGE_SCHEMA, COVERAGE_SNAPSHOT_SCHEMA, COVERAGE_REPORT_SCHEMA, SOURCE_STATES, OBLIGATION_STATES,
  normalizeContextSource, normalizeObligation, createCoverageSnapshot, transitionObligation, compileContextPackage, createCoverageReport,
};
