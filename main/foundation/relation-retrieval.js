'use strict';

const {
  assertKnownKeys,
  clonePlain,
  deepFreeze,
  isPlainObject,
  optionalString,
  requiredString,
  stringList,
} = require('./plain-value');

const RELATION_EDGE_SCHEMA = 'mazz.relation-edge/v0';
const EPISODE_SCHEMA = 'mazz.context-episode/v0';
const RECOLLECTION_QUERY_SCHEMA = 'mazz.recollection-query/v0';
const RECOLLECTION_RESULT_SCHEMA = 'mazz.recollection-result/v0';
const EDGE_KINDS = new Set(['deterministic', 'observed', 'inferred', 'promoted']);
const SECRET_KEY = /(?:api.?key|secret|token|authorization|password|credential|private.?key)/i;

function assertNoSecrets(value, label, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SECRET_KEY.test(key)) throw new Error(`${label} 禁止 secret 字段: ${childPath}`);
    assertNoSecrets(child, label, childPath);
  }
}

function normalizeEdge(input) {
  if (!isPlainObject(input)) throw new Error('Relation Edge 必须是对象');
  assertKnownKeys(input, ['schema', 'edgeId', 'kind', 'relationType', 'fromRef', 'toRef', 'confidence', 'evidenceRefs', 'provenance', 'status', 'authorityRef'], 'Relation Edge');
  assertNoSecrets(input, 'Relation Edge');
  if (input.schema != null && input.schema !== RELATION_EDGE_SCHEMA) throw new Error(`不支持的 Relation schema: ${input.schema}`);
  const kind = requiredString(input.kind, 'kind');
  if (!EDGE_KINDS.has(kind)) throw new Error(`非法 Relation kind: ${kind}`);
  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('confidence 必须在 0–1');
  const authorityRef = optionalString(input.authorityRef);
  if (kind === 'promoted' && !authorityRef.startsWith('human:')) throw new Error('Promoted relation 必须由 human:* Authority 确认');
  if (kind !== 'promoted' && authorityRef) throw new Error('Shadow relation 不得伪装 Authority');
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  const fromRef = requiredString(input.fromRef, 'fromRef');
  const toRef = requiredString(input.toRef, 'toRef');
  if (fromRef === toRef) throw new Error('Relation Edge 不能自环');
  return deepFreeze({
    schema: RELATION_EDGE_SCHEMA,
    edgeId: requiredString(input.edgeId, 'edgeId'),
    kind,
    relationType: requiredString(input.relationType, 'relationType'),
    fromRef,
    toRef,
    confidence,
    evidenceRefs: stringList(input.evidenceRefs || [], 'evidenceRefs'),
    provenance: clonePlain(input.provenance, 'provenance'),
    status: optionalString(input.status) || 'active',
    authorityRef,
  });
}

function normalizeEpisode(input) {
  if (!isPlainObject(input)) throw new Error('Episode 必须是对象');
  assertKnownKeys(input, ['schema', 'episodeId', 'label', 'workspaceRef', 'startedAt', 'endedAt', 'anchorRefs', 'eventRefs', 'contextRefs', 'provenance', 'rebuildable'], 'Episode');
  assertNoSecrets(input, 'Episode');
  if (input.schema != null && input.schema !== EPISODE_SCHEMA) throw new Error(`不支持的 Episode schema: ${input.schema}`);
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  return deepFreeze({
    schema: EPISODE_SCHEMA,
    episodeId: requiredString(input.episodeId, 'episodeId'),
    label: requiredString(input.label, 'label'),
    workspaceRef: requiredString(input.workspaceRef, 'workspaceRef'),
    startedAt: requiredString(input.startedAt, 'startedAt'),
    endedAt: requiredString(input.endedAt, 'endedAt'),
    anchorRefs: stringList(input.anchorRefs || [], 'anchorRefs'),
    eventRefs: stringList(input.eventRefs || [], 'eventRefs'),
    contextRefs: stringList(input.contextRefs || [], 'contextRefs'),
    provenance: clonePlain(input.provenance, 'provenance'),
    rebuildable: input.rebuildable !== false,
  });
}

function normalizeQuery(input) {
  if (!isPlainObject(input)) throw new Error('Recollection Query 必须是对象');
  assertKnownKeys(input, ['schema', 'queryId', 'episodeRefs', 'speaker', 'itemType', 'semanticHints', 'relationRefs', 'currentContextRefs', 'before', 'after', 'direction', 'limit', 'rejectedCandidateRefs'], 'Recollection Query');
  assertNoSecrets(input, 'Recollection Query');
  if (input.schema != null && input.schema !== RECOLLECTION_QUERY_SCHEMA) throw new Error(`不支持的 Query schema: ${input.schema}`);
  const direction = optionalString(input.direction) || 'any';
  if (!['any', 'earlier', 'later'].includes(direction)) throw new Error('direction 非法');
  const limit = Number(input.limit ?? 5);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit 必须是正整数');
  return deepFreeze({
    schema: RECOLLECTION_QUERY_SCHEMA,
    queryId: requiredString(input.queryId, 'queryId'),
    episodeRefs: stringList(input.episodeRefs || [], 'episodeRefs'),
    speaker: optionalString(input.speaker),
    itemType: optionalString(input.itemType),
    semanticHints: stringList(input.semanticHints || [], 'semanticHints'),
    relationRefs: stringList(input.relationRefs || [], 'relationRefs'),
    currentContextRefs: stringList(input.currentContextRefs || [], 'currentContextRefs'),
    before: optionalString(input.before),
    after: optionalString(input.after),
    direction,
    limit,
    rejectedCandidateRefs: stringList(input.rejectedCandidateRefs || [], 'rejectedCandidateRefs'),
  });
}

function normalizeCandidate(input, index) {
  if (!isPlainObject(input)) throw new Error(`candidate[${index}] 必须是对象`);
  assertKnownKeys(input, ['candidateRef', 'anchorRef', 'episodeRefs', 'occurredAt', 'speaker', 'itemType', 'terms', 'relationRefs', 'contextRefs', 'importance', 'preview'], `candidate[${index}]`);
  assertNoSecrets(input, `candidate[${index}]`);
  return {
    candidateRef: requiredString(input.candidateRef, `candidate[${index}].candidateRef`),
    anchorRef: requiredString(input.anchorRef, `candidate[${index}].anchorRef`),
    episodeRefs: stringList(input.episodeRefs || [], `candidate[${index}].episodeRefs`),
    occurredAt: requiredString(input.occurredAt, `candidate[${index}].occurredAt`),
    speaker: optionalString(input.speaker),
    itemType: optionalString(input.itemType),
    terms: stringList(input.terms || [], `candidate[${index}].terms`),
    relationRefs: stringList(input.relationRefs || [], `candidate[${index}].relationRefs`),
    contextRefs: stringList(input.contextRefs || [], `candidate[${index}].contextRefs`),
    importance: optionalString(input.importance) || 'normal',
    preview: optionalString(input.preview),
  };
}

function overlap(left, right) {
  const set = new Set(left.map(value => value.toLocaleLowerCase('zh-CN')));
  return right.filter(value => set.has(value.toLocaleLowerCase('zh-CN')));
}

function recollect(input) {
  if (!isPlainObject(input)) throw new Error('Recollection input 必须是对象');
  assertKnownKeys(input, ['query', 'candidates', 'episodes', 'edges'], 'Recollection input');
  const query = normalizeQuery(input.query);
  const candidates = (input.candidates || []).map(normalizeCandidate);
  const episodes = (input.episodes || []).map(normalizeEpisode);
  const edges = (input.edges || []).map(normalizeEdge);
  if (new Set(candidates.map(item => item.candidateRef)).size !== candidates.length) throw new Error('candidateRef 不能重复');
  if (new Set(episodes.map(item => item.episodeId)).size !== episodes.length) throw new Error('episodeId 不能重复');
  if (new Set(edges.map(item => item.edgeId)).size !== edges.length) throw new Error('edgeId 不能重复');
  const episodeIds = new Set(episodes.map(item => item.episodeId));
  const edgeIds = new Set(edges.map(item => item.edgeId));
  const rejected = new Set(query.rejectedCandidateRefs);
  const results = [];

  for (const candidate of candidates) {
    if (rejected.has(candidate.candidateRef)) continue;
    let score = 0;
    const reasons = [];
    const episodeHits = overlap(candidate.episodeRefs, query.episodeRefs).filter(id => episodeIds.has(id));
    if (episodeHits.length) { score += 35 + Math.min(episodeHits.length - 1, 2) * 4; reasons.push(`episode:${episodeHits.join(',')}`); }
    if (query.speaker && candidate.speaker === query.speaker) { score += 16; reasons.push(`speaker:${candidate.speaker}`); }
    if (query.itemType && candidate.itemType === query.itemType) { score += 12; reasons.push(`type:${candidate.itemType}`); }
    const semanticHits = overlap(candidate.terms, query.semanticHints);
    if (semanticHits.length) { score += Math.min(semanticHits.length * 9, 27); reasons.push(`semantic:${semanticHits.join(',')}`); }
    const relationHits = overlap(candidate.relationRefs, query.relationRefs).filter(id => edgeIds.has(id));
    if (relationHits.length) { score += 15; reasons.push(`relation:${relationHits.join(',')}`); }
    const contextHits = overlap(candidate.contextRefs, query.currentContextRefs);
    if (contextHits.length) { score += Math.min(contextHits.length * 7, 14); reasons.push(`context:${contextHits.join(',')}`); }
    if (query.before && candidate.occurredAt < query.before) { score += 8; reasons.push('temporal:before'); }
    if (query.after && candidate.occurredAt > query.after) { score += 8; reasons.push('temporal:after'); }
    if (query.direction === 'earlier' && query.before && candidate.occurredAt < query.before) { score += 4; reasons.push('direction:earlier'); }
    if (query.direction === 'later' && query.after && candidate.occurredAt > query.after) { score += 4; reasons.push('direction:later'); }
    if (candidate.importance === 'low' && query.itemType === 'question') { score += 3; reasons.push('importance:low-question'); }
    if (score > 0) results.push({ candidateRef: candidate.candidateRef, anchorRef: candidate.anchorRef, score, reasons, preview: candidate.preview });
  }

  results.sort((a, b) => b.score - a.score || a.candidateRef.localeCompare(b.candidateRef));
  return deepFreeze({
    schema: RECOLLECTION_RESULT_SCHEMA,
    queryId: query.queryId,
    candidates: results.slice(0, query.limit),
    explanationRequired: true,
    sourceOfTruth: 'anchors-and-domain-events',
    indexRebuildable: true,
  });
}

module.exports = {
  RELATION_EDGE_SCHEMA,
  EPISODE_SCHEMA,
  RECOLLECTION_QUERY_SCHEMA,
  RECOLLECTION_RESULT_SCHEMA,
  normalizeEdge,
  normalizeEpisode,
  normalizeQuery,
  recollect,
};
