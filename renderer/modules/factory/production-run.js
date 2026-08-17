// W73b Production Run v0：文件优先、append-only 事件语义；不持有工件正文。

export const PRODUCTION_RUN_SCHEMA = 'mazz.production-run/v0';
export const PRODUCTION_RUN_EVENT_SCHEMA = 'mazz.production-run-event/v0';
export const PRODUCTION_RUN_REFERENCES_SCHEMA = 'mazz.production-run-references/v0';

export const PRODUCTION_RUN_STATUSES = Object.freeze([
  'proposed', 'running', 'paused', 'blocked', 'failed', 'completed', 'cancelled',
]);

export const PRODUCTION_RUN_EVENT_TYPES = Object.freeze([
  'run-created', 'run-started', 'review-recorded', 'audit-recorded', 'qualification-recorded',
  'delegation-recorded', 'artifact-recorded',
  'run-paused', 'run-recovery-required', 'run-failed', 'run-completed', 'run-cancelled',
]);

const TERMINAL = new Set(['failed', 'completed', 'cancelled']);
const SECRET_KEYS = new Set([
  'apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken', 'credential', 'cookie',
]);
const RUN_KEYS = new Set([
  'schema', 'runId', 'taskId', 'projectId', 'title', 'domain', 'taskType', 'status',
  'createdAt', 'startedAt', 'endedAt', 'lastSequence', 'workflowRef', 'workflowVersion',
  'governanceProfile', 'budgetProfile', 'inputArtifactRefs', 'outputArtifactRefs',
  'gateRefs', 'findingRefs', 'reworkRefs', 'qualificationRefs', 'delegationRefs',
  'recoveryState', 'provenance', 'previousRunId',
]);
const EVENT_KEYS = new Set([
  'schema', 'eventId', 'runId', 'sequence', 'occurredAt', 'type', 'actorRef', 'authorityRef',
  'fromStatus', 'toStatus', 'reasonCode', 'message', 'artifactRefs', 'gateRefs', 'findingRefs', 'reworkRefs', 'providerBoundary',
  'qualificationRefs', 'delegationRefs',
]);
const REF_KEYS = new Set(['kind', 'id', 'path', 'type', 'version', 'role', 'sourceRef']);
const PROVIDER_KEYS = new Set(['providerId', 'model', 'role', 'outcome', 'finishReason', 'responseRef', 'observed']);

const asString = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const asArray = value => Array.isArray(value) ? value : [];
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isoNow = clock => new Date(clock()).toISOString();

function rejectUnknown(value, allowed, label) {
  if (!plainObject(value)) throw new Error(`${label} 必须是对象`);
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} 含未冻结字段：${unknown.join(', ')}`);
}

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${trail}[${index}]`));
  if (!plainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const canonical = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SECRET_KEYS.has(canonical)) throw new Error(`Production Run 禁止 secret 字段：${trail ? trail + '.' : ''}${key}`);
    rejectSecrets(item, trail ? `${trail}.${key}` : key);
  }
}

export function normalizeProductionRunReference(value = {}) {
  rejectSecrets(value);
  rejectUnknown(value, REF_KEYS, 'Artifact reference');
  const ref = {
    kind: asString(value.kind, 80),
    id: asString(value.id, 240),
    path: asString(value.path, 1200),
    type: asString(value.type, 160),
    version: asString(value.version, 240),
    role: asString(value.role, 80),
    sourceRef: asString(value.sourceRef, 600),
  };
  if (!ref.kind) throw new Error('Artifact reference 缺 kind');
  if (!ref.id && !ref.path) throw new Error('Artifact reference 必须有 id 或 path');
  return Object.freeze(ref);
}

function uniqueRefs(values = []) {
  const seen = new Set();
  const rows = [];
  for (const value of values) {
    const ref = normalizeProductionRunReference(value);
    const key = `${ref.kind}\u0000${ref.id}\u0000${ref.path}\u0000${ref.role}`;
    if (!seen.has(key)) { seen.add(key); rows.push(ref); }
  }
  return rows;
}

function normalizeProviderBoundary(value) {
  if (value == null) return null;
  rejectSecrets(value);
  rejectUnknown(value, PROVIDER_KEYS, 'Provider boundary');
  const row = {
    providerId: asString(value.providerId, 160), model: asString(value.model, 240), role: asString(value.role, 120),
    outcome: asString(value.outcome, 120), finishReason: asString(value.finishReason, 160),
    responseRef: asString(value.responseRef, 600), observed: value.observed === true,
  };
  if (!row.outcome) throw new Error('Provider boundary 缺 outcome');
  return Object.freeze(row);
}

export function createProductionRunId(taskId = 'task', { clock = Date.now, random = Math.random } = {}) {
  const task = asString(taskId, 80).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
  const time = new Date(clock()).toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  const tail = Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * 0xFFFFFF).toString(36).padStart(5, '0');
  return `run-${task}-${time}-${tail}`;
}

export function createProductionRunSnapshot(input = {}, { clock = Date.now } = {}) {
  rejectSecrets(input);
  rejectUnknown(input, RUN_KEYS, 'Production Run create input');
  const runId = asString(input.runId, 240);
  const taskId = asString(input.taskId, 240);
  if (!runId || !taskId) throw new Error('Production Run 缺 runId/taskId');
  const snapshot = {
    schema: PRODUCTION_RUN_SCHEMA,
    runId,
    taskId,
    projectId: asString(input.projectId || taskId, 240),
    title: asString(input.title, 500),
    domain: asString(input.domain || 'content-production', 160),
    taskType: asString(input.taskType || 'factory.single.w68', 160),
    status: 'proposed',
    createdAt: asString(input.createdAt, 80) || isoNow(clock),
    startedAt: '', endedAt: '', lastSequence: 0,
    workflowRef: asString(input.workflowRef || 'W68', 240),
    workflowVersion: asString(input.workflowVersion || 'W68a', 120),
    governanceProfile: asString(input.governanceProfile || 'light', 120),
    budgetProfile: {
      kind: 'token-cap',
      capTokens: Math.max(0, Number(input.budgetProfile?.capTokens) || 0),
      actualStatus: 'UNKNOWN',
    },
    inputArtifactRefs: uniqueRefs(input.inputArtifactRefs),
    outputArtifactRefs: [], gateRefs: [], findingRefs: [], reworkRefs: [], qualificationRefs: [], delegationRefs: [],
    recoveryState: { required: false, reasonCode: '', evidenceRef: '' },
    provenance: {
      source: asString(input.provenance?.source || 'mazz.factory', 160),
      protocol: asString(input.provenance?.protocol || 'W73b', 120),
    },
    previousRunId: asString(input.previousRunId, 240),
  };
  return snapshot;
}

export function normalizeProductionRunSnapshot(value = {}) {
  rejectSecrets(value);
  rejectUnknown(value, RUN_KEYS, 'Production Run snapshot');
  if (value.schema !== PRODUCTION_RUN_SCHEMA) throw new Error(`未知 Production Run schema：${value.schema || '空'}`);
  if (!PRODUCTION_RUN_STATUSES.includes(value.status)) throw new Error(`非法 Production Run status：${value.status}`);
  const base = createProductionRunSnapshot(value, { clock: () => Date.parse(value.createdAt) || Date.now() });
  base.status = value.status;
  base.startedAt = asString(value.startedAt, 80);
  base.endedAt = asString(value.endedAt, 80);
  base.lastSequence = Math.max(0, Number(value.lastSequence) || 0);
  base.outputArtifactRefs = uniqueRefs(value.outputArtifactRefs);
  base.gateRefs = [...new Set(asArray(value.gateRefs).map(x => asString(x, 240)).filter(Boolean))];
  base.findingRefs = [...new Set(asArray(value.findingRefs).map(x => asString(x, 360)).filter(Boolean))];
  base.reworkRefs = [...new Set(asArray(value.reworkRefs).map(x => asString(x, 360)).filter(Boolean))];
  base.qualificationRefs = [...new Set(asArray(value.qualificationRefs).map(x => asString(x, 360)).filter(Boolean))];
  base.delegationRefs = [...new Set(asArray(value.delegationRefs).map(x => asString(x, 360)).filter(Boolean))];
  base.recoveryState = {
    required: value.recoveryState?.required === true,
    reasonCode: asString(value.recoveryState?.reasonCode, 160),
    evidenceRef: asString(value.recoveryState?.evidenceRef, 800),
  };
  return base;
}

export function normalizeProductionRunEvent(value = {}, context = {}) {
  rejectSecrets(value);
  rejectUnknown(value, EVENT_KEYS, 'Production Run event');
  const type = asString(value.type, 120);
  const fromStatus = asString(value.fromStatus || context.fromStatus, 40);
  const toStatus = asString(value.toStatus || context.toStatus || fromStatus, 40);
  if (!PRODUCTION_RUN_EVENT_TYPES.includes(type)) throw new Error(`非法 Production Run event type：${type}`);
  if (fromStatus && !PRODUCTION_RUN_STATUSES.includes(fromStatus)) throw new Error(`非法 fromStatus：${fromStatus}`);
  if (toStatus && !PRODUCTION_RUN_STATUSES.includes(toStatus)) throw new Error(`非法 toStatus：${toStatus}`);
  const event = {
    schema: PRODUCTION_RUN_EVENT_SCHEMA,
    eventId: asString(value.eventId || context.eventId, 260),
    runId: asString(value.runId || context.runId, 240),
    sequence: Math.max(1, Number(value.sequence || context.sequence) || 0),
    occurredAt: asString(value.occurredAt || context.occurredAt, 80),
    type,
    actorRef: asString(value.actorRef || 'factory:runtime', 240),
    authorityRef: asString(value.authorityRef, 240),
    fromStatus,
    toStatus,
    reasonCode: asString(value.reasonCode, 160),
    message: asString(value.message, 1200),
    artifactRefs: uniqueRefs(value.artifactRefs),
    gateRefs: [...new Set(asArray(value.gateRefs).map(x => asString(x, 240)).filter(Boolean))],
    findingRefs: [...new Set(asArray(value.findingRefs).map(x => asString(x, 360)).filter(Boolean))],
    reworkRefs: [...new Set(asArray(value.reworkRefs).map(x => asString(x, 360)).filter(Boolean))],
    qualificationRefs: [...new Set(asArray(value.qualificationRefs).map(x => asString(x, 360)).filter(Boolean))],
    delegationRefs: [...new Set(asArray(value.delegationRefs).map(x => asString(x, 360)).filter(Boolean))],
    providerBoundary: normalizeProviderBoundary(value.providerBoundary),
  };
  if (!event.eventId || !event.runId || !event.occurredAt) throw new Error('Production Run event 缺 eventId/runId/occurredAt');
  return Object.freeze(event);
}

function assertTransition(snapshot, event) {
  if (event.type === 'run-created') {
    if (snapshot.lastSequence !== 0 || event.fromStatus || event.toStatus !== 'proposed') throw new Error('run-created 必须是首事件并进入 proposed');
    return;
  }
  if (TERMINAL.has(snapshot.status)) throw new Error(`Production Run 已终态：${snapshot.status}`);
  if (event.fromStatus !== snapshot.status) throw new Error(`Production Run 状态漂移：期望 ${snapshot.status}，收到 ${event.fromStatus || '空'}`);
  const allowed = {
    'run-started': ['running'],
    'review-recorded': [snapshot.status],
    'audit-recorded': [snapshot.status],
    'qualification-recorded': [snapshot.status],
    'delegation-recorded': [snapshot.status],
    'artifact-recorded': [snapshot.status],
    'run-paused': ['paused'],
    'run-recovery-required': ['blocked'],
    'run-failed': ['failed'],
    'run-completed': ['completed'],
    'run-cancelled': ['cancelled'],
  }[event.type] || [];
  if (!allowed.includes(event.toStatus)) throw new Error(`${event.type} 不允许 ${event.fromStatus}→${event.toStatus}`);
  if (event.type === 'run-started' && !['proposed', 'paused', 'blocked'].includes(event.fromStatus)) throw new Error(`run-started 不允许从 ${event.fromStatus} 开始`);
  if (event.type === 'run-completed' && event.fromStatus !== 'running') throw new Error('run-completed 只能从 running 进入');
}

export function reduceProductionRun(snapshotValue, eventValue) {
  const snapshot = normalizeProductionRunSnapshot(snapshotValue);
  const event = normalizeProductionRunEvent(eventValue);
  if (event.runId !== snapshot.runId) throw new Error('Production Run event runId 不匹配');
  if (event.sequence !== snapshot.lastSequence + 1) throw new Error(`Production Run sequence 不连续：${snapshot.lastSequence}→${event.sequence}`);
  assertTransition(snapshot, event);
  const next = normalizeProductionRunSnapshot({ ...snapshot });
  next.status = event.toStatus || snapshot.status;
  next.lastSequence = event.sequence;
  if (event.type === 'run-started' && !next.startedAt) next.startedAt = event.occurredAt;
  if (TERMINAL.has(next.status)) next.endedAt = event.occurredAt;
  next.gateRefs = [...new Set([...next.gateRefs, ...event.gateRefs])];
  next.findingRefs = [...new Set([...next.findingRefs, ...event.findingRefs])];
  next.reworkRefs = [...new Set([...next.reworkRefs, ...event.reworkRefs])];
  next.qualificationRefs = [...new Set([...next.qualificationRefs, ...event.qualificationRefs])];
  next.delegationRefs = [...new Set([...next.delegationRefs, ...event.delegationRefs])];
  if (event.type === 'run-completed' || event.type === 'artifact-recorded') {
    next.outputArtifactRefs = uniqueRefs([...next.outputArtifactRefs, ...event.artifactRefs]);
  }
  if (event.type === 'run-recovery-required') {
    next.recoveryState = { required: true, reasonCode: event.reasonCode || 'RECOVERY_REQUIRED', evidenceRef: event.artifactRefs[0]?.path || '' };
  } else if (event.type === 'run-started' && snapshot.status === 'blocked') {
    next.recoveryState = { required: false, reasonCode: '', evidenceRef: snapshot.recoveryState?.evidenceRef || '' };
  }
  return next;
}

export function parseProductionRunEventLog(text, { runId = '' } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const events = [];
  let corruptTail = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const event = normalizeProductionRunEvent(JSON.parse(line));
      if (runId && event.runId !== runId) throw new Error('runId 不匹配');
      if (event.sequence !== events.length + 1) throw new Error('sequence 不连续');
      events.push(event);
    } catch (error) {
      const later = lines.slice(index + 1).some(value => value.trim());
      if (later) throw new Error(`Production Run event log 中段损坏（第 ${index + 1} 行）：${error.message}`);
      corruptTail = line;
      break;
    }
  }
  return { events, corruptTail };
}

function replaySnapshot(staticSnapshot, events) {
  let snapshot = normalizeProductionRunSnapshot({
    ...staticSnapshot, status: 'proposed', startedAt: '', endedAt: '', lastSequence: 0,
    outputArtifactRefs: [], gateRefs: [], findingRefs: [], reworkRefs: [], qualificationRefs: [], delegationRefs: [],
    recoveryState: { required: false, reasonCode: '', evidenceRef: '' },
  });
  for (const event of events) snapshot = reduceProductionRun(snapshot, event);
  return snapshot;
}

function refsDocument(runId, refs) {
  return { schema: PRODUCTION_RUN_REFERENCES_SCHEMA, runId, refs: uniqueRefs(refs) };
}

function ledgerPaths(folder, runId) {
  const base = String(folder || '').replace(/\\/g, '/').replace(/\/$/, '');
  if (!base) throw new Error('Production Run 缺 folder');
  if (!/^[a-zA-Z0-9_-]{3,240}$/.test(runId)) throw new Error('Production Run runId 含非法路径字符');
  const root = `${base}/.mazz/runs/${runId}`;
  return Object.freeze({
    root,
    snapshot: `${root}/run.json`,
    events: `${root}/events.ndjson`,
    findings: `${root}/findings.ndjson`,
    economics: `${root}/economics.ndjson`,
    qualifications: `${base}/.mazz/qualifications.ndjson`,
    delegations: `${root}/delegations.ndjson`,
    references: `${root}/references.json`,
    corruptTail: `${root}/corrupt-tail.txt`,
  });
}

function validateIo(io) {
  for (const method of ['read', 'write', 'mkdir', 'exists']) if (typeof io?.[method] !== 'function') throw new Error(`Production Run IO 缺 ${method}`);
  return io;
}

export class ProductionRunLedger {
  static async open(options = {}) {
    const io = validateIo(options.io);
    const clock = options.clock || Date.now;
    const idFactory = options.idFactory || (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);
    let runId = asString(options.runId, 240);
    if (!runId) runId = createProductionRunId(options.taskId, { clock, random: options.random || Math.random });
    const paths = ledgerPaths(options.folder, runId);
    await io.mkdir(paths.root);
    const exists = await io.exists(paths.snapshot);
    let snapshot;
    let events = [];
    let refs = [];
    let corruptTail = '';
    if (!exists) {
      snapshot = createProductionRunSnapshot({
        runId, taskId: options.taskId, projectId: options.projectId, title: options.title,
        domain: options.domain, taskType: options.taskType, createdAt: options.createdAt,
        workflowRef: options.workflowRef, workflowVersion: options.workflowVersion,
        governanceProfile: options.governanceProfile, budgetProfile: options.budgetProfile,
        inputArtifactRefs: options.inputArtifactRefs, provenance: options.provenance,
        previousRunId: options.previousRunId,
      }, { clock });
      await io.write(paths.snapshot, JSON.stringify(snapshot, null, 2));
      await io.write(paths.events, '');
      await io.write(paths.findings, '');
      await io.write(paths.economics, '');
      await io.write(paths.references, JSON.stringify(refsDocument(runId, snapshot.inputArtifactRefs), null, 2));
    } else {
      snapshot = normalizeProductionRunSnapshot(JSON.parse(await io.read(paths.snapshot)));
      if (snapshot.runId !== runId) throw new Error('Production Run snapshot 路径与 runId 不一致');
      const parsed = parseProductionRunEventLog(await io.read(paths.events), { runId });
      events = parsed.events;
      corruptTail = parsed.corruptTail;
      try {
        const document = JSON.parse(await io.read(paths.references));
        if (document.schema === PRODUCTION_RUN_REFERENCES_SCHEMA && document.runId === runId) refs = uniqueRefs(document.refs);
      } catch { refs = []; }
      snapshot = replaySnapshot(snapshot, events);
      refs = uniqueRefs([...refs, ...snapshot.inputArtifactRefs, ...snapshot.outputArtifactRefs, ...events.flatMap(event => event.artifactRefs)]);
      await io.write(paths.snapshot, JSON.stringify(snapshot, null, 2));
      await io.write(paths.references, JSON.stringify(refsDocument(runId, refs), null, 2));
    }
    const ledger = new ProductionRunLedger({ io, clock, idFactory, paths, snapshot, events, refs });
    if (!exists) {
      await ledger.append({ type: 'run-created', fromStatus: '', toStatus: 'proposed', reasonCode: 'RUN_CREATED', message: 'W73b local production run created' });
    }
    if (corruptTail) {
      await io.write(paths.corruptTail, corruptTail);
      await io.write(paths.events, ledger._eventsText());
      if (!TERMINAL.has(ledger.snapshot.status)) {
        await ledger.append({
          type: 'run-recovery-required', toStatus: 'blocked', reasonCode: 'CORRUPT_TAIL_RECOVERED',
          message: '事件尾损坏已隔离；须显式恢复后继续',
          artifactRefs: [{ kind: 'evidence', path: paths.corruptTail, type: 'text/plain', role: 'corrupt-tail' }],
        });
      }
    } else if (exists && options.recoverOrphaned === true && ledger.snapshot.status === 'running') {
      await ledger.append({
        type: 'run-recovery-required', toStatus: 'blocked', reasonCode: 'ORPHANED_RUNNING_RUN',
        message: '重开时发现未闭合运行；已转入恢复态',
      });
    }
    return ledger;
  }

  constructor({ io, clock, idFactory, paths, snapshot, events, refs }) {
    this.io = io;
    this.clock = clock;
    this.idFactory = idFactory;
    this.paths = paths;
    this.snapshot = snapshot;
    this.events = events;
    this.refs = refs;
    this.activeWrites = 0;
    this.disposed = false;
    this.requiresReload = false;
    this.queue = Promise.resolve();
  }

  get runId() { return this.snapshot.runId; }

  _eventsText(events = this.events) {
    return events.length ? events.map(event => JSON.stringify(event)).join('\n') + '\n' : '';
  }

  append(input = {}) {
    if (this.disposed) return Promise.reject(new Error('Production Run Ledger 已释放'));
    const operation = this.queue.then(async () => {
      if (this.requiresReload) throw new Error('Production Run 上次写入状态不确定，必须重开后继续');
      this.activeWrites += 1;
      let eventCommitted = false;
      try {
        const event = normalizeProductionRunEvent(input, {
          runId: this.runId,
          sequence: this.snapshot.lastSequence + 1,
          occurredAt: isoNow(this.clock),
          eventId: `${this.runId}:e${String(this.snapshot.lastSequence + 1).padStart(5, '0')}:${this.idFactory()}`,
          fromStatus: input.type === 'run-created' ? '' : this.snapshot.status,
          toStatus: input.toStatus || this.snapshot.status,
        });
        const next = reduceProductionRun(this.snapshot, event);
        const events = [...this.events, event];
        const refs = uniqueRefs([...this.refs, ...event.artifactRefs, ...next.inputArtifactRefs, ...next.outputArtifactRefs]);
        // 事件先落盘；快照/引用写失败时，重开可由事件重放恢复，不伪造成功。
        await this.io.write(this.paths.events, this._eventsText(events));
        eventCommitted = true;
        await this.io.write(this.paths.snapshot, JSON.stringify(next, null, 2));
        await this.io.write(this.paths.references, JSON.stringify(refsDocument(this.runId, refs), null, 2));
        this.events = events;
        this.snapshot = next;
        this.refs = refs;
        return event;
      } catch (error) {
        if (eventCommitted) this.requiresReload = true;
        throw error;
      } finally {
        this.activeWrites -= 1;
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  healthSnapshot() {
    return Object.freeze({ runId: this.runId, status: this.snapshot.status, activeWrites: this.activeWrites, disposed: this.disposed, requiresReload: this.requiresReload, lastSequence: this.snapshot.lastSequence });
  }

  async dispose() {
    if (this.disposed) return this.healthSnapshot();
    await this.queue;
    this.disposed = true;
    return this.healthSnapshot();
  }
}

export const openProductionRunLedger = options => ProductionRunLedger.open(options);
