'use strict';

const crypto = require('node:crypto');
const {
  assertKnownKeys, clonePlain, deepFreeze, isPlainObject, optionalString, requiredString, stringList,
} = require('./plain-value');

const COGNITION_SCHEMA = 'mazz.cognition/v0';
const SOURCE_REF_SCHEMA = 'mazz.source-ref/v0';
const STAGE_SUMMARY_SCHEMA = 'mazz.stage-summary/v0';
const MARKER_START = '<!-- mazz-cognition';
const MARKER_END = '-->';
const TYPES = new Set(['Concept', 'Finding', 'Question', 'Evidence', 'Analysis', 'Solution', 'Decision', 'Pattern', 'Playbook', 'Method', 'StageSummary']);
const MATURITY = new Set(['SEED', 'DEVELOPING', 'STABLE', 'CANONICAL']);
const VALIDITY = new Set(['UNKNOWN', 'PROPOSED', 'SUPPORTED', 'DISPUTED', 'REFUTED']);
const IMPLEMENTATION = new Set(['NOT_APPLICABLE', 'NOT_STARTED', 'IN_PROGRESS', 'IMPLEMENTED', 'VERIFIED']);
const LIFECYCLE = new Set(['ACTIVE', 'SUPERSEDED', 'RETIRED']);
const AUTHORITY = new Set(['CANDIDATE', 'HUMAN_APPROVED']);
const SOURCE_HEALTH = new Set(['HEALTHY', 'MISSING', 'STALE', 'AMBIGUOUS', 'UNKNOWN']);
const SECRET_KEY = /(?:api.?key|secret|token|authorization|password|credential|private.?key|cookie)$/i;

function digest(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function iso(value, label) { const text = requiredString(value, label); const at = Date.parse(text); if (!Number.isFinite(at)) throw new Error(`${label} 必须是 ISO 时间`); return new Date(at).toISOString(); }
function assertNoSecrets(value, label, prefix = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const at = prefix ? `${prefix}.${key}` : key;
    if (SECRET_KEY.test(key)) throw new Error(`${label} 禁止 secret 字段: ${at}`);
    assertNoSecrets(child, label, at);
  }
}

function normalizeSourceRef(input, index = 0) {
  if (!isPlainObject(input)) throw new Error(`sourceRefs[${index}] 必须是对象`);
  assertKnownKeys(input, ['schemaVersion', 'ref', 'kind', 'hash', 'observedAt', 'health', 'evidenceRefs', 'provenance'], `sourceRefs[${index}]`);
  assertNoSecrets(input, `sourceRefs[${index}]`);
  if (input.schemaVersion != null && input.schemaVersion !== SOURCE_REF_SCHEMA) throw new Error(`sourceRefs[${index}] schemaVersion 非法`);
  const health = requiredString(input.health || 'UNKNOWN', `sourceRefs[${index}].health`).toUpperCase();
  if (!SOURCE_HEALTH.has(health)) throw new Error(`sourceRefs[${index}].health 非法`);
  return deepFreeze({
    schemaVersion: SOURCE_REF_SCHEMA, ref: requiredString(input.ref, `sourceRefs[${index}].ref`),
    kind: requiredString(input.kind, `sourceRefs[${index}].kind`), hash: optionalString(input.hash),
    observedAt: iso(input.observedAt, `sourceRefs[${index}].observedAt`), health,
    evidenceRefs: stringList(input.evidenceRefs || [], `sourceRefs[${index}].evidenceRefs`),
    provenance: clonePlain(input.provenance || {}, `sourceRefs[${index}].provenance`),
  });
}

function normalizeCognitionItem(input) {
  if (!isPlainObject(input)) throw new Error('Cognition item 必须是对象');
  assertKnownKeys(input, [
    'schemaVersion', 'cognitionId', 'identityKey', 'type', 'title', 'sourceRefs', 'sourceHealth',
    'maturity', 'validity', 'implementation', 'lifecycle', 'authorityState', 'authorityRef',
    'supersedes', 'supersededBy', 'createdAt', 'updatedAt', 'provenance',
  ], 'Cognition item');
  assertNoSecrets(input, 'Cognition item');
  if (input.schemaVersion != null && input.schemaVersion !== COGNITION_SCHEMA) throw new Error('Cognition schemaVersion 非法');
  const type = requiredString(input.type, 'type'); if (!TYPES.has(type)) throw new Error(`Cognition type 非法: ${type}`);
  const identityKey = requiredString(input.identityKey, 'identityKey');
  const expectedId = `cognition:${digest(identityKey)}`;
  const cognitionId = optionalString(input.cognitionId) || expectedId;
  if (cognitionId !== expectedId) throw new Error('cognitionId 与 identityKey 不匹配');
  const sourceRefs = (input.sourceRefs || []).map(normalizeSourceRef);
  const maturity = requiredString(input.maturity || 'SEED', 'maturity').toUpperCase(); if (!MATURITY.has(maturity)) throw new Error('maturity 非法');
  const validity = requiredString(input.validity || 'UNKNOWN', 'validity').toUpperCase(); if (!VALIDITY.has(validity)) throw new Error('validity 非法');
  const implementation = requiredString(input.implementation || 'NOT_APPLICABLE', 'implementation').toUpperCase(); if (!IMPLEMENTATION.has(implementation)) throw new Error('implementation 非法');
  const lifecycle = requiredString(input.lifecycle || 'ACTIVE', 'lifecycle').toUpperCase(); if (!LIFECYCLE.has(lifecycle)) throw new Error('lifecycle 非法');
  const authorityState = requiredString(input.authorityState || 'CANDIDATE', 'authorityState').toUpperCase(); if (!AUTHORITY.has(authorityState)) throw new Error('authorityState 非法');
  const authorityRef = optionalString(input.authorityRef);
  if (authorityState === 'HUMAN_APPROVED' && !authorityRef.startsWith('human:')) throw new Error('HUMAN_APPROVED 必须 human:* Authority');
  const supersedes = stringList(input.supersedes || [], 'supersedes'); const supersededBy = optionalString(input.supersededBy);
  if (supersedes.length && authorityState !== 'HUMAN_APPROVED') throw new Error('supersedes 生效必须 Human Approved');
  if (lifecycle === 'SUPERSEDED' && !supersededBy) throw new Error('SUPERSEDED 必须指向 supersededBy');
  const sourceHealth = sourceRefs.some(row => row.health === 'MISSING') ? 'MISSING'
    : sourceRefs.some(row => ['STALE', 'AMBIGUOUS'].includes(row.health)) ? 'DEGRADED'
      : sourceRefs.length && sourceRefs.every(row => row.health === 'HEALTHY') ? 'HEALTHY' : 'UNKNOWN';
  if (input.sourceHealth != null && input.sourceHealth !== sourceHealth) throw new Error('sourceHealth 必须由 sourceRefs 推导');
  return deepFreeze({
    schemaVersion: COGNITION_SCHEMA, cognitionId, identityKey, type, title: requiredString(input.title, 'title'),
    sourceRefs, sourceHealth, maturity, validity, implementation, lifecycle, authorityState, authorityRef,
    supersedes, supersededBy, createdAt: iso(input.createdAt, 'createdAt'), updatedAt: iso(input.updatedAt, 'updatedAt'),
    provenance: clonePlain(input.provenance || {}, 'provenance'),
  });
}

function serializeCognitionMarkdown(itemInput, body = '') {
  const item = normalizeCognitionItem(itemInput);
  const content = String(body || '').replace(/^\s+/, '');
  return `${MARKER_START}\n${JSON.stringify(item, null, 2)}\n${MARKER_END}\n\n# ${item.title}\n\n${content}`.trimEnd() + '\n';
}

function parseCognitionMarkdown(markdown) {
  const text = String(markdown || '');
  if (!text.startsWith(MARKER_START)) throw new Error('不是 W70 Cognition Markdown');
  const end = text.indexOf(MARKER_END, MARKER_START.length); if (end < 0) throw new Error('Cognition marker 未闭合');
  let raw; try { raw = JSON.parse(text.slice(MARKER_START.length, end).trim()); } catch (error) { throw new Error(`Cognition metadata 损坏: ${error.message}`); }
  const item = normalizeCognitionItem(raw);
  const after = text.slice(end + MARKER_END.length).replace(/^\s*#\s+[^\r\n]+\r?\n?/, '').replace(/^\s+/, '');
  return deepFreeze({ item, body: after.trimEnd() });
}

function buildStageSummary(itemInputs, { stageRef, generatedAt = new Date().toISOString() } = {}) {
  const items = itemInputs.map(normalizeCognitionItem).filter(item => item.lifecycle === 'ACTIVE');
  const ids = rows => rows.map(item => item.cognitionId).sort();
  const approved = items.filter(item => item.authorityState === 'HUMAN_APPROVED');
  return deepFreeze({
    schemaVersion: STAGE_SUMMARY_SCHEMA, stageRef: requiredString(stageRef, 'stageRef'), generatedAt: iso(generatedAt, 'generatedAt'),
    confirmedFacts: ids(approved.filter(item => item.type === 'Evidence' && item.validity === 'SUPPORTED')),
    repairedProblems: ids(approved.filter(item => item.type === 'Finding' && ['IMPLEMENTED', 'VERIFIED'].includes(item.implementation))),
    currentHypotheses: ids(items.filter(item => ['Analysis', 'Concept', 'Solution'].includes(item.type) && item.validity === 'PROPOSED')),
    decisions: ids(approved.filter(item => item.type === 'Decision')),
    patterns: ids(approved.filter(item => ['Pattern', 'Playbook', 'Method'].includes(item.type))),
    blockedQuestions: ids(items.filter(item => item.type === 'Question' && item.validity === 'DISPUTED')),
    unresolved: ids(items.filter(item => item.type === 'Finding' && !['IMPLEMENTED', 'VERIFIED'].includes(item.implementation))),
    futureCandidates: ids(items.filter(item => item.authorityState === 'CANDIDATE')),
    sources: [...new Set(items.flatMap(item => item.sourceRefs.map(source => source.ref)))].sort(),
    supersedes: [...new Set(items.flatMap(item => item.supersedes))].sort(),
    authorityGrantedBySummary: false,
  });
}

module.exports = {
  COGNITION_SCHEMA, SOURCE_REF_SCHEMA, STAGE_SUMMARY_SCHEMA, TYPES, MATURITY, VALIDITY, IMPLEMENTATION, LIFECYCLE, AUTHORITY, SOURCE_HEALTH,
  normalizeSourceRef, normalizeCognitionItem, serializeCognitionMarkdown, parseCognitionMarkdown, buildStageSummary,
};
