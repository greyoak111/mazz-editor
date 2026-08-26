'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const retrieval = require('./foundation/relation-retrieval');
const events = require('./foundation/workspace-events');
const contextGraph = require('./foundation/context-relations');
const { assertKnownKeys, clonePlain, deepFreeze, isPlainObject, requiredString } = require('./foundation/plain-value');
const { workspaceId } = require('./workspace-event-service');

const SERVICE_SCHEMA = 'mazz.relation-retrieval/v1';
const REJECTION_SCHEMA = 'mazz.relation-rejection-ledger/v0';
const BAD_REF = /(?:^|[\\/])\.\.?(?:[\\/]|$)|^(?:[A-Za-z]:[\\/]|\\\\|\/)|^(?:https?|file|ws|wss):\/\//i;

function slash(value) { return String(value || '').replace(/\\/g, '/'); }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function cleanRef(value, label) {
  const ref = requiredString(value, label);
  if (BAD_REF.test(ref) || ref.includes('://') || ref.includes('..') || /[\r\n\t\s]/.test(ref)) throw new Error(`${label} 不得包含路径、网络定位器或空白`);
  return ref;
}
function cleanRefList(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} 必须是数组`);
  const rows = values.map((value, index) => cleanRef(value, `${label}[${index}]`));
  if (new Set(rows).size !== rows.length) throw new Error(`${label} 不能重复`);
  return rows;
}

function normalizeRejection(input) {
  if (!isPlainObject(input)) throw new Error('rejected candidate 必须是对象');
  assertKnownKeys(input, ['queryId', 'candidateRef', 'authorityRef', 'reason'], 'rejected candidate');
  const authorityRef = cleanRef(input.authorityRef, 'authorityRef');
  if (!authorityRef.startsWith('human:')) throw new Error('拒绝候选需要 human:* Authority');
  return deepFreeze({ queryId: requiredString(input.queryId, 'queryId'), candidateRef: cleanRef(input.candidateRef, 'candidateRef'), authorityRef, reason: requiredString(input.reason, 'reason') });
}

class RelationRetrievalService {
  constructor({ rootProvider, eventService, contextService, fsImpl = fs } = {}) {
    if (typeof rootProvider !== 'function' || !eventService || !contextService) throw new Error('RelationRetrievalService 依赖 root/event/context service');
    this.rootProvider = rootProvider; this.eventService = eventService; this.contextService = contextService; this.fs = fsImpl; this.cache = null; this.cacheRoot = '';
  }
  root() { return path.resolve(this.rootProvider()); }
  id() { return workspaceId(this.root()); }
  folder() { return path.join(this.root(), '.mazz', 'relations'); }
  file() { return path.join(this.folder(), 'rejections.json'); }

  readRejections() {
    const root = this.root();
    const file = this.file();
    if (!this.fs.existsSync(file)) { this.cacheRoot = root; return (this.cache = { schema: REJECTION_SCHEMA, workspaceId: this.id(), entries: [] }); }
    let raw;
    try { raw = JSON.parse(this.fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`Relation rejection ledger 损坏；原始文件保留（${slash(file)}）: ${error.message}`); }
    try {
      if (!isPlainObject(raw) || raw.schema !== REJECTION_SCHEMA || raw.workspaceId !== this.id() || !Array.isArray(raw.entries)) throw new Error('schema/workspace/entries 非法');
      const entries = raw.entries.map(normalizeRejection);
      this.cacheRoot = root; return (this.cache = { schema: REJECTION_SCHEMA, workspaceId: this.id(), entries });
    } catch (error) { throw new Error(`Relation rejection ledger 校验失败；原始文件保留（${slash(file)}）: ${error.message}`); }
  }
  writeRejections(entries) {
    const next = { schema: REJECTION_SCHEMA, workspaceId: this.id(), entries: entries.map(normalizeRejection) };
    this.fs.mkdirSync(this.folder(), { recursive: true });
    const temp = `${this.file()}.${process.pid}.${Date.now()}.tmp`;
    try { this.fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8'); this.fs.renameSync(temp, this.file()); }
    catch (error) { try { this.fs.unlinkSync(temp); } catch {} throw error; }
    this.cache = next; this.cacheRoot = this.root(); return next;
  }

  sourceEvents() {
    if (typeof this.eventService.list === 'function') return this.eventService.list();
    const snapshot = this.eventService.snapshot?.() || {};
    return Array.isArray(snapshot.events) ? snapshot.events : [];
  }
  sourceGraph() {
    const raw = typeof this.contextService.read === 'function' ? this.contextService.read() : contextGraph.emptyGraph();
    return contextGraph.normalizeGraph(raw);
  }
  query(input = {}) {
    if (!isPlainObject(input)) throw new Error('Relation query payload 必须是对象');
    if (input.workspaceId != null && input.workspaceId !== this.id()) throw new Error('Relation query Workspace identity 不匹配');
    let rawQuery;
    if (isPlainObject(input.query)) {
      assertKnownKeys(input, ['query', 'workspaceId'], 'Relation query payload');
      rawQuery = input.query;
    } else {
      const direct = { ...input }; delete direct.workspaceId;
      rawQuery = direct;
    }
    const query = retrieval.normalizeQuery(rawQuery);
    const explicitLimit = Object.prototype.hasOwnProperty.call(rawQuery, 'limit');
    for (const [key, values] of Object.entries({ episodeRefs: query.episodeRefs, relationRefs: query.relationRefs, currentContextRefs: query.currentContextRefs, rejectedCandidateRefs: query.rejectedCandidateRefs })) cleanRefList(values, `query.${key}`);
    const rejectionSet = new Set(this.readRejections().entries.filter(row => row.queryId === query.queryId).map(row => row.candidateRef));
    const effectiveQuery = retrieval.normalizeQuery({ ...query, rejectedCandidateRefs: [...new Set([...query.rejectedCandidateRefs, ...rejectionSet])] });
    const rawEvents = this.sourceEvents();
    const normalizedEvents = [];
    for (const row of rawEvents) { try { const event = events.normalizeWorkspaceEvent(row); if (event.workspaceId === this.id()) normalizedEvents.push(event); } catch {} }
    const rawEpisodes = events.buildEpisodes(normalizedEvents);
    const episodes = rawEpisodes.map((episode, index) => retrieval.normalizeEpisode({
      episodeId: episode.episodeId, label: `${episode.eventRefs.length} event workspace episode`, workspaceRef: this.id(),
      startedAt: episode.startedAt, endedAt: episode.endedAt, anchorRefs: episode.anchorRefs.filter(ref => !BAD_REF.test(ref) && !ref.includes('://')),
      eventRefs: episode.eventRefs, contextRefs: episode.contextRefs.filter(ref => !BAD_REF.test(ref) && !ref.includes('://')),
      provenance: { source: 'workspace-event-ledger', episodeIndex: index }, rebuildable: true,
    }));
    const episodeByEvent = new Map(episodes.flatMap(episode => episode.eventRefs.map(ref => [ref, episode.episodeId])));
    const candidates = normalizedEvents.map(event => {
      const refs = [...event.subjectRefs, ...event.objectRefs].filter(ref => !BAD_REF.test(ref) && !ref.includes('://') && !/[\r\n\t\s]/.test(ref));
      const anchorRef = refs[0] || event.eventId;
      const terms = [...new Set([event.sourceModule, event.action, ...event.objectRefs, ...event.contextRefs].filter(value => typeof value === 'string' && value && !BAD_REF.test(value) && !/[\s]/.test(value)))];
      return { candidateRef: event.eventId, anchorRef, episodeRefs: episodeByEvent.has(event.eventId) ? [episodeByEvent.get(event.eventId)] : [], occurredAt: event.occurredAt, speaker: event.actorType, itemType: event.action, terms, relationRefs: [], contextRefs: event.contextRefs.filter(ref => !BAD_REF.test(ref) && !ref.includes('://')), importance: 'normal', preview: '' };
    });
    const graph = this.sourceGraph();
    const edges = [...graph.shadowEdges, ...graph.promotedEdges];
    // An omitted limit means “all currently indexed candidates”; an explicit
    // limit remains a caller preference.  The legacy pure kernel keeps its
    // backwards-compatible default, while this Workspace service does not add
    // a hidden result-count gate.
    const queryForRecollection = explicitLimit ? effectiveQuery : retrieval.normalizeQuery({ ...effectiveQuery, limit: Math.max(1, candidates.length) });
    const result = retrieval.recollect({ query: queryForRecollection, candidates, episodes, edges });
    const sourceRefs = new Set([this.id(), ...effectiveQuery.episodeRefs, ...effectiveQuery.relationRefs, ...effectiveQuery.currentContextRefs]);
    for (const row of result.candidates) { sourceRefs.add(row.candidateRef); sourceRefs.add(row.anchorRef); row.reasons.forEach(reason => reason.split(':').slice(1).forEach(ref => { if (ref) sourceRefs.add(ref); })); }
    return deepFreeze({ schema: SERVICE_SCHEMA, workspaceId: this.id(), query: queryForRecollection, candidates: result.candidates, relations: edges, episodes, explanations: result.candidates.map(row => ({ candidateRef: row.candidateRef, anchorRef: row.anchorRef, reasons: row.reasons, sourceRefs: [row.candidateRef, row.anchorRef] })), supersession: graph.promotions.filter(row => row.supersedes).map(row => ({ supersedes: row.supersedes, replacement: row.promotedEdgeId, sourceRefs: [row.promotionId] })), sourceRefs: [...sourceRefs].filter(ref => !BAD_REF.test(ref) && !ref.includes('://')).sort(), rebuildable: true });
  }

  rejectCandidate(input = {}) {
    const rejection = normalizeRejection(input);
    const current = this.readRejections();
    if (current.entries.some(row => row.queryId === rejection.queryId && row.candidateRef === rejection.candidateRef)) return { rejected: false, duplicate: true, entry: rejection };
    this.writeRejections([...current.entries, rejection]);
    return { rejected: true, duplicate: false, entry: rejection };
  }
  snapshot() {
    const graph = this.sourceGraph(); const eventsList = this.sourceEvents(); const rejections = this.readRejections();
    return deepFreeze({ schema: 'mazz.relation-retrieval-snapshot/v1', workspaceId: this.id(), eventCount: eventsList.length, episodeCount: events.buildEpisodes(eventsList).length, relationCount: graph.shadowEdges.length + graph.promotedEdges.length, rejectedCandidateCount: rejections.entries.length, localOnly: true, rebuildable: true });
  }
  rebuild() { this.cache = null; this.cacheRoot = ''; return this.snapshot(); }
}

module.exports = { RelationRetrievalService, SERVICE_SCHEMA, REJECTION_SCHEMA, normalizeRejection };
