'use strict';

const crypto = require('node:crypto');
const {
  assertKnownKeys, clonePlain, deepFreeze, isPlainObject, optionalString, requiredString, stringList,
} = require('./plain-value');

const WORKSPACE_EVENT_SCHEMA = 'mazz.workspace-event/v0';
const EVENT_RECORD_SCHEMA = 'mazz.workspace-event-record/v0';
const EPISODE_RESULT_SCHEMA = 'mazz.workspace-episode/v0';
const LIFECYCLE_RESULT_SCHEMA = 'mazz.concept-lifecycle/v0';
const ACTOR_TYPES = new Set(['human', 'factory', 'agent', 'system']);
const OUTCOMES = new Set(['success', 'cancelled', 'failed', 'partial', 'unknown']);
const PRIVACY_CLASSES = new Set(['operational', 'private-metadata', 'sensitive-reference']);
const RETENTION_CLASSES = new Set(['session', '30d', '1y', 'keep']);
const RETENTION_MS = Object.freeze({ session: 0, '30d': 30 * 24 * 60 * 60 * 1000, '1y': 365 * 24 * 60 * 60 * 1000, keep: Infinity });
const SECRET_KEY = /(?:api.?key|secret|token|authorization|password|credential|private.?key)/i;
const FORBIDDEN_DETAIL_KEY = /(?:body|content|clipboard|keystroke|commandText|terminalInput|environment|prompt|transcript)/i;

function assertNoSecrets(value, label, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SECRET_KEY.test(key) || FORBIDDEN_DETAIL_KEY.test(key)) throw new Error(`${label} 禁止敏感/正文字段: ${childPath}`);
    assertNoSecrets(child, label, childPath);
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex'); }
function iso(value, label) {
  const text = requiredString(value, label);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new Error(`${label} 必须是 ISO 时间`);
  return new Date(time).toISOString();
}

function normalizeWorkspaceEvent(input) {
  if (!isPlainObject(input)) throw new Error('Workspace Event 必须是对象');
  assertKnownKeys(input, [
    'schema', 'eventId', 'idempotencyKey', 'workspaceId', 'occurredAt', 'recordedAt', 'actorType',
    'sourceModule', 'action', 'subjectRefs', 'objectRefs', 'contextRefs', 'outcome', 'provenance',
    'privacyClass', 'retentionClass', 'payloadRef', 'summary', 'clockStatus',
  ], 'Workspace Event');
  assertNoSecrets(input, 'Workspace Event');
  if (input.schema != null && input.schema !== WORKSPACE_EVENT_SCHEMA) throw new Error(`不支持的 Workspace Event schema: ${input.schema}`);
  const actorType = requiredString(input.actorType, 'actorType');
  if (!ACTOR_TYPES.has(actorType)) throw new Error(`actorType 非法: ${actorType}`);
  const outcome = optionalString(input.outcome) || 'unknown';
  if (!OUTCOMES.has(outcome)) throw new Error(`outcome 非法: ${outcome}`);
  const privacyClass = optionalString(input.privacyClass) || 'operational';
  if (!PRIVACY_CLASSES.has(privacyClass)) throw new Error(`privacyClass 非法: ${privacyClass}`);
  const retentionClass = optionalString(input.retentionClass) || '1y';
  if (!RETENTION_CLASSES.has(retentionClass)) throw new Error(`retentionClass 非法: ${retentionClass}`);
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  const occurredAt = iso(input.occurredAt, 'occurredAt');
  const recordedAt = iso(input.recordedAt || new Date().toISOString(), 'recordedAt');
  const row = {
    idempotencyKey: requiredString(input.idempotencyKey, 'idempotencyKey'),
    workspaceId: requiredString(input.workspaceId, 'workspaceId'),
    occurredAt, actorType,
    sourceModule: requiredString(input.sourceModule, 'sourceModule'),
    action: requiredString(input.action, 'action'),
    subjectRefs: stringList(input.subjectRefs || [], 'subjectRefs'),
    objectRefs: stringList(input.objectRefs || [], 'objectRefs'),
    contextRefs: stringList(input.contextRefs || [], 'contextRefs'),
    outcome,
  };
  if (!row.subjectRefs.length && !row.objectRefs.length) throw new Error('Event 至少需要 subjectRefs 或 objectRefs');
  const expectedId = `event:${digest(row)}`;
  const eventId = optionalString(input.eventId) || expectedId;
  if (eventId !== expectedId) throw new Error('eventId 与幂等事件内容不匹配');
  const skewMs = Date.parse(recordedAt) - Date.parse(occurredAt);
  return deepFreeze({
    schema: WORKSPACE_EVENT_SCHEMA, eventId, ...row, recordedAt,
    provenance: clonePlain(input.provenance, 'provenance'),
    privacyClass, retentionClass,
    payloadRef: optionalString(input.payloadRef),
    summary: optionalString(input.summary).slice(0, 240),
    clockStatus: skewMs < -300000 ? 'ANOMALOUS_RECORDED_BEFORE_OCCURRED' : 'NORMAL',
  });
}

function createEventRecord(eventInput, { sequence, previousHash = '' } = {}) {
  const event = normalizeWorkspaceEvent(eventInput);
  const seq = Number(sequence);
  if (!Number.isInteger(seq) || seq < 1) throw new Error('sequence 必须是正整数');
  const recordHash = `sha256:${digest({ sequence: seq, previousHash, event })}`;
  return deepFreeze({ schema: EVENT_RECORD_SCHEMA, sequence: seq, previousHash, event, recordHash });
}

function verifyEventRecords(records) {
  const normalized = [];
  let previousHash = '';
  for (let i = 0; i < (records || []).length; i++) {
    const raw = records[i];
    if (!isPlainObject(raw)) throw new Error(`Event Record ${i + 1} 非法`);
    assertKnownKeys(raw, ['schema', 'sequence', 'previousHash', 'event', 'recordHash'], `Event Record ${i + 1}`);
    if (raw.schema !== EVENT_RECORD_SCHEMA) throw new Error(`Event Record ${i + 1} schema 非法`);
    const expected = createEventRecord(raw.event, { sequence: i + 1, previousHash });
    if (raw.sequence !== expected.sequence || raw.previousHash !== expected.previousHash || raw.recordHash !== expected.recordHash) throw new Error(`Event Record ${i + 1} hash chain 非法`);
    normalized.push(expected); previousHash = expected.recordHash;
  }
  return deepFreeze(normalized);
}

function refSet(event) { return new Set([...event.subjectRefs, ...event.objectRefs, ...event.contextRefs]); }
function intersects(left, right) { for (const item of left) if (right.has(item)) return true; return false; }
function episodeLabel(events) {
  const corpus = events.flatMap(event => [event.summary, event.action, event.sourceModule, ...event.objectRefs, ...event.contextRefs]).join(' ').toLocaleLowerCase('zh-CN');
  if (/package|packaged|electron|abi|license|许可|安装包/.test(corpus)) return 'Windows packaged runtime 排查';
  const modules = [...new Set(events.map(event => event.sourceModule))];
  return `${modules.join(' → ')} 工作片段`;
}

function buildEpisodes(eventInputs, { maxGapMs = 45 * 60 * 1000 } = {}) {
  const events = eventInputs.map(normalizeWorkspaceEvent).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId));
  const groups = [];
  for (const event of events) {
    const previous = groups.at(-1);
    const last = previous?.events.at(-1);
    const gap = last ? Date.parse(event.occurredAt) - Date.parse(last.occurredAt) : Infinity;
    const shared = last ? intersects(refSet(event), refSet(last)) : false;
    const sameWorkspace = last?.workspaceId === event.workspaceId;
    if (!previous || !sameWorkspace || gap > maxGapMs || (!shared && gap > 10 * 60 * 1000)) groups.push({ events: [event], reasons: ['episode:start'] });
    else {
      previous.events.push(event);
      previous.reasons.push(shared ? 'shared-reference' : 'temporal-proximity');
    }
  }
  return deepFreeze(groups.map(group => {
    const refs = [...new Set(group.events.flatMap(event => [...event.subjectRefs, ...event.objectRefs]))].sort();
    const contexts = [...new Set(group.events.flatMap(event => event.contextRefs))].sort();
    const reasons = [...new Set(group.reasons)];
    const row = { workspaceId: group.events[0].workspaceId, eventRefs: group.events.map(event => event.eventId), startedAt: group.events[0].occurredAt, endedAt: group.events.at(-1).occurredAt };
    return {
      schema: EPISODE_RESULT_SCHEMA,
      episodeId: `episode:${digest(row)}`,
      label: episodeLabel(group.events),
      workspaceRef: group.events[0].workspaceId,
      startedAt: row.startedAt, endedAt: row.endedAt,
      eventRefs: row.eventRefs, anchorRefs: refs, contextRefs: contexts,
      confidence: Math.min(0.95, 0.55 + Math.max(0, group.events.length - 1) * 0.08 + (reasons.includes('shared-reference') ? 0.12 : 0)),
      reasons, rebuildable: true,
    };
  }));
}

function searchOperationalHistory(eventInputs, query, { limit = 20 } = {}) {
  const terms = requiredString(query, 'query').toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
  const episodes = buildEpisodes(eventInputs);
  const byId = new Map(eventInputs.map(input => { const event = normalizeWorkspaceEvent(input); return [event.eventId, event]; }));
  const rows = [];
  for (const episode of episodes) {
    const events = episode.eventRefs.map(id => byId.get(id)).filter(Boolean);
    const corpus = [episode.label, ...episode.anchorRefs, ...episode.contextRefs, ...events.flatMap(event => [event.summary, event.action, event.sourceModule])].join(' ').toLocaleLowerCase('zh-CN');
    const hits = terms.filter(term => corpus.includes(term));
    if (hits.length) rows.push({ episodeId: episode.episodeId, label: episode.label, score: hits.length / terms.length + episode.confidence, reasons: hits.map(term => `term:${term}`), eventRefs: episode.eventRefs, startedAt: episode.startedAt, endedAt: episode.endedAt });
  }
  rows.sort((a, b) => b.score - a.score || b.endedAt.localeCompare(a.endedAt) || a.episodeId.localeCompare(b.episodeId));
  return deepFreeze(rows.slice(0, limit));
}

function aggregateConceptLifecycle(eventInputs, ref) {
  const target = requiredString(ref, 'ref');
  const events = eventInputs.map(normalizeWorkspaceEvent).filter(event => [...event.subjectRefs, ...event.objectRefs].includes(target)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const contexts = new Set(events.flatMap(event => event.contextRefs));
  const actions = new Set(events.map(event => event.action));
  let stage = 'idea';
  if (events.length >= 3) stage = 'repeated-revisit';
  if (contexts.size >= 2) stage = 'cross-context-association';
  if ([...actions].some(action => /decide|review|accept|reject/.test(action))) stage = 'formal-discussion';
  if ([...actions].some(action => /implement|build|execute|save/.test(action))) stage = 'implementation-artifact';
  if ([...actions].some(action => /promote/.test(action))) stage = 'promoted-specification';
  return deepFreeze({ schema: LIFECYCLE_RESULT_SCHEMA, ref: target, stage, eventRefs: events.map(event => event.eventId), contextRefs: [...contexts].sort(), inferred: true, authorityGranted: false, explanationRequired: true });
}

function partitionByRetention(eventInputs, { now = new Date().toISOString() } = {}) {
  const instant = Date.parse(iso(now, 'now'));
  const keep = [], expire = [];
  for (const input of eventInputs) {
    const event = normalizeWorkspaceEvent(input);
    const ttl = RETENTION_MS[event.retentionClass];
    const ageMs = Math.max(0, instant - Date.parse(event.occurredAt));
    (ttl === Infinity || ageMs < ttl ? keep : expire).push(event);
  }
  return deepFreeze({ now: new Date(instant).toISOString(), keep, expire, policy: { session: 'until-explicit-retention', '30d': RETENTION_MS['30d'], '1y': RETENTION_MS['1y'], keep: 'forever' } });
}

module.exports = {
  WORKSPACE_EVENT_SCHEMA, EVENT_RECORD_SCHEMA, EPISODE_RESULT_SCHEMA, LIFECYCLE_RESULT_SCHEMA,
  normalizeWorkspaceEvent, createEventRecord, verifyEventRecords, buildEpisodes, searchOperationalHistory, aggregateConceptLifecycle, partitionByRetention,
};
