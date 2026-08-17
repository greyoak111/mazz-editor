// W73d Qualification / Delegation v0：持证门禁与委托事实；不承担 W73e 调度。

import { normalizeProductionRunReference } from './production-run.js';

export const QUALIFICATION_RECORD_SCHEMA = 'mazz.qualification-record/v0';
export const DELEGATION_RECORD_SCHEMA = 'mazz.delegation-record/v0';

export const QUALIFICATION_RECORD_TYPES = Object.freeze([
  'qualification-defined', 'qualification-attempt-recorded',
  'qualification-certificate-issued', 'qualification-certificate-revoked',
]);
export const QUALIFICATION_OUTCOMES = Object.freeze(['passed', 'failed', 'invalid']);
export const DELEGATION_RECORD_TYPES = Object.freeze([
  'assignment-created', 'delegation-started', 'delegation-blocked',
  'delegation-completed', 'delegation-failed', 'delegation-cancelled', 'delegation-disposed',
]);
export const DELEGATION_CHANNELS = Object.freeze(['internal-agent-runtime', 'external-harness']);

const QUALIFICATION_KEYS = new Set([
  'schema', 'recordId', 'sequence', 'occurredAt', 'type', 'actorRef', 'authorityRef',
  'definitionId', 'attemptId', 'certificateId', 'executorRef', 'runId', 'seatRefs',
  'probePackRef', 'probePackVersion', 'passingScore', 'score', 'outcome', 'evidenceRefs',
  'startedAt', 'completedAt', 'issuedAt', 'validFrom', 'expiresAt', 'revokedAt',
  'revocationReason', 'message',
]);
const DELEGATION_KEYS = new Set([
  'schema', 'recordId', 'runId', 'sequence', 'occurredAt', 'type', 'actorRef', 'authorityRef',
  'delegationId', 'taskRef', 'seatRef', 'executorRef', 'certificateRef', 'restricted',
  'channel', 'status', 'instructionRef', 'evidenceRefs', 'harnessAdapterRef',
  'harnessSessionRef', 'resultRef', 'errorCode', 'message', 'cancelRef', 'disposeRef',
]);
const SECRET_KEYS = new Set([
  'apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken',
  'credential', 'cookie', 'token', 'baseurl', 'endpoint',
]);
const TERMINAL_DELEGATION = new Set(['blocked', 'completed', 'failed', 'cancelled', 'disposed']);
const asString = (value, max = 800) => String(value ?? '').trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const uniqueStrings = (value, max = 320) => [...new Set(list(value).map(item => asString(item, max)).filter(Boolean))];
const isoNow = clock => new Date(clock()).toISOString();

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${trail}[${index}]`));
  if (!plainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const canonical = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SECRET_KEYS.has(canonical)) throw new Error(`W73d Ledger 禁止 secret 字段：${trail ? trail + '.' : ''}${key}`);
    rejectSecrets(item, trail ? `${trail}.${key}` : key);
  }
}

function rejectUnknown(value, allowed, label) {
  if (!plainObject(value)) throw new Error(`${label} 必须是对象`);
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} 含未冻结字段：${unknown.join(', ')}`);
}

function refs(values) {
  const seen = new Set();
  const rows = [];
  for (const value of list(values)) {
    const ref = normalizeProductionRunReference(value);
    const key = `${ref.kind}\u0000${ref.id}\u0000${ref.path}\u0000${ref.role}`;
    if (!seen.has(key)) { seen.add(key); rows.push(ref); }
  }
  return rows;
}

function assertIso(value, label, { optional = false } = {}) {
  if (!value && optional) return '';
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`${label} 必须是 ISO 时间`);
  return value;
}

function assertHumanAuthority(value, label = '资格证书') {
  if (!/^human:[^\s]+$/i.test(value)) throw new Error(`${label} 必须由 human Authority 签发或撤销`);
}

function semanticRecord(record) {
  const { sequence, occurredAt, ...rest } = record;
  return JSON.stringify(rest);
}

export function normalizeQualificationRecord(value = {}, context = {}) {
  rejectSecrets(value);
  rejectUnknown(value, QUALIFICATION_KEYS, 'Qualification record');
  const type = asString(value.type, 100);
  if (!QUALIFICATION_RECORD_TYPES.includes(type)) throw new Error(`非法 Qualification type：${type || '空'}`);
  const record = {
    schema: QUALIFICATION_RECORD_SCHEMA,
    recordId: asString(value.recordId || context.recordId, 360),
    sequence: Math.max(1, Number(value.sequence || context.sequence) || 0),
    occurredAt: asString(value.occurredAt || context.occurredAt, 80),
    type,
    actorRef: asString(value.actorRef || 'factory:qualification', 240),
    authorityRef: asString(value.authorityRef, 240),
    definitionId: asString(value.definitionId, 320),
    attemptId: asString(value.attemptId, 320),
    certificateId: asString(value.certificateId, 320),
    executorRef: asString(value.executorRef, 320),
    runId: asString(value.runId, 240),
    seatRefs: uniqueStrings(value.seatRefs, 240),
    probePackRef: asString(value.probePackRef, 800),
    probePackVersion: asString(value.probePackVersion, 160),
    passingScore: value.passingScore == null || value.passingScore === '' ? null : Number(value.passingScore),
    score: value.score == null || value.score === '' ? null : Number(value.score),
    outcome: asString(value.outcome, 40),
    evidenceRefs: refs(value.evidenceRefs),
    startedAt: asString(value.startedAt, 80),
    completedAt: asString(value.completedAt, 80),
    issuedAt: asString(value.issuedAt, 80),
    validFrom: asString(value.validFrom, 80),
    expiresAt: asString(value.expiresAt, 80),
    revokedAt: asString(value.revokedAt, 80),
    revocationReason: asString(value.revocationReason, 320),
    message: asString(value.message, 1200),
  };
  if (!record.recordId || !record.occurredAt) throw new Error('Qualification record 缺 recordId/occurredAt');
  assertIso(record.occurredAt, 'Qualification occurredAt');

  if (type === 'qualification-defined') {
    if (!record.definitionId || !record.seatRefs.length) throw new Error('QualificationDefinition 缺 definitionId/seatRefs');
    if (!record.probePackRef || !record.probePackVersion) throw new Error('QualificationDefinition 缺 probe pack/version');
    if (!Number.isFinite(record.passingScore) || record.passingScore < 0 || record.passingScore > 100) throw new Error('QualificationDefinition passingScore 应为 0–100');
  }
  if (type === 'qualification-attempt-recorded') {
    if (!record.attemptId || !record.definitionId || !record.executorRef) throw new Error('QualificationAttempt 缺 attempt/definition/executor');
    if (!QUALIFICATION_OUTCOMES.includes(record.outcome)) throw new Error('QualificationAttempt outcome 非法');
    if (!Number.isFinite(record.score) || record.score < 0 || record.score > 100) throw new Error('QualificationAttempt score 应为 0–100');
    if (!record.evidenceRefs.length) throw new Error('QualificationAttempt 必须有 evidence');
    assertIso(record.startedAt, 'QualificationAttempt startedAt');
    assertIso(record.completedAt, 'QualificationAttempt completedAt');
    if (Date.parse(record.completedAt) < Date.parse(record.startedAt)) throw new Error('QualificationAttempt 完成时间早于开始时间');
  }
  if (type === 'qualification-certificate-issued') {
    if (!record.certificateId || !record.definitionId || !record.attemptId || !record.executorRef || !record.seatRefs.length) throw new Error('QualificationCertificate 身份字段不完整');
    assertHumanAuthority(record.authorityRef);
    assertIso(record.issuedAt, 'QualificationCertificate issuedAt');
    assertIso(record.validFrom, 'QualificationCertificate validFrom');
    assertIso(record.expiresAt, 'QualificationCertificate expiresAt');
    if (Date.parse(record.expiresAt) <= Date.parse(record.validFrom)) throw new Error('QualificationCertificate expiresAt 必须晚于 validFrom');
    if (!record.evidenceRefs.length) throw new Error('QualificationCertificate 必须引用签发 evidence');
  }
  if (type === 'qualification-certificate-revoked') {
    if (!record.certificateId || !record.revocationReason) throw new Error('Certificate revocation 缺 certificateId/reason');
    assertHumanAuthority(record.authorityRef, '资格证书撤销');
    assertIso(record.revokedAt, 'QualificationCertificate revokedAt');
    if (!record.evidenceRefs.length) throw new Error('Certificate revocation 必须引用 evidence');
  }
  return Object.freeze(record);
}

export function parseQualificationLog(text) {
  const lines = String(text || '').split(/\r?\n/);
  const records = [];
  let corruptTail = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const record = normalizeQualificationRecord(JSON.parse(line));
      if (record.sequence !== records.length + 1) throw new Error('sequence 不连续');
      records.push(record);
    } catch (error) {
      if (lines.slice(index + 1).some(item => item.trim())) throw new Error(`Qualification 中段损坏（第 ${index + 1} 行）：${error.message}`);
      corruptTail = line;
      break;
    }
  }
  return { records, corruptTail };
}

export function replayQualificationRecords(values = []) {
  const definitions = new Map();
  const attempts = new Map();
  const certificates = new Map();
  const recordIds = new Set();
  let sequence = 0;
  for (const value of values) {
    const record = normalizeQualificationRecord(value);
    if (record.sequence !== sequence + 1) throw new Error(`Qualification sequence 不连续：${sequence}→${record.sequence}`);
    if (recordIds.has(record.recordId)) throw new Error(`Qualification recordId 重复：${record.recordId}`);
    sequence = record.sequence;
    recordIds.add(record.recordId);
    if (record.type === 'qualification-defined') {
      if (definitions.has(record.definitionId)) throw new Error(`QualificationDefinition 重复：${record.definitionId}`);
      definitions.set(record.definitionId, record);
    } else if (record.type === 'qualification-attempt-recorded') {
      const definition = definitions.get(record.definitionId);
      if (!definition) throw new Error(`QualificationAttempt 引用不存在的 Definition：${record.definitionId}`);
      if (attempts.has(record.attemptId)) throw new Error(`QualificationAttempt 重复：${record.attemptId}`);
      const expected = record.score >= definition.passingScore ? 'passed' : 'failed';
      if (record.outcome !== 'invalid' && record.outcome !== expected) throw new Error(`QualificationAttempt 分数与 outcome 不一致：${record.score}/${definition.passingScore}`);
      attempts.set(record.attemptId, record);
    } else if (record.type === 'qualification-certificate-issued') {
      const definition = definitions.get(record.definitionId);
      const attempt = attempts.get(record.attemptId);
      if (!definition || !attempt || attempt.outcome !== 'passed') throw new Error('QualificationCertificate 只能引用已通过 Attempt');
      if (attempt.definitionId !== record.definitionId || attempt.executorRef !== record.executorRef) throw new Error('QualificationCertificate 与 Attempt 身份不一致');
      if (record.seatRefs.some(seat => !definition.seatRefs.includes(seat))) throw new Error('QualificationCertificate Seat 超出 Definition 适用范围');
      if (certificates.has(record.certificateId)) throw new Error(`QualificationCertificate 重复：${record.certificateId}`);
      certificates.set(record.certificateId, { ...record, revokedAt: '', revocationReason: '', revokedBy: '' });
    } else if (record.type === 'qualification-certificate-revoked') {
      const certificate = certificates.get(record.certificateId);
      if (!certificate) throw new Error(`撤销不存在的 QualificationCertificate：${record.certificateId}`);
      if (certificate.revokedAt) throw new Error(`QualificationCertificate 已撤销：${record.certificateId}`);
      certificates.set(record.certificateId, {
        ...certificate, revokedAt: record.revokedAt, revocationReason: record.revocationReason,
        revokedBy: record.authorityRef, revocationEvidenceRefs: record.evidenceRefs,
      });
    }
  }
  return { sequence, recordIds, definitions, attempts, certificates };
}

export function evaluateQualification(state, {
  restricted = true, certificateRef = '', executorRef = '', seatRef = '', at = Date.now(),
} = {}) {
  if (!restricted) return Object.freeze({ ok: true, code: 'QUALIFICATION_NOT_REQUIRED', certificate: null });
  const certificate = state?.certificates?.get?.(asString(certificateRef, 320));
  if (!certificate) return Object.freeze({ ok: false, code: 'QUALIFICATION_REQUIRED', certificate: null });
  if (certificate.executorRef !== asString(executorRef, 320)) return Object.freeze({ ok: false, code: 'QUALIFICATION_EXECUTOR_MISMATCH', certificate });
  if (!certificate.seatRefs.includes(asString(seatRef, 240))) return Object.freeze({ ok: false, code: 'QUALIFICATION_SEAT_MISMATCH', certificate });
  if (certificate.revokedAt) return Object.freeze({ ok: false, code: 'QUALIFICATION_REVOKED', certificate });
  const now = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(now)) return Object.freeze({ ok: false, code: 'QUALIFICATION_TIME_INVALID', certificate });
  if (now < Date.parse(certificate.validFrom)) return Object.freeze({ ok: false, code: 'QUALIFICATION_NOT_YET_VALID', certificate });
  if (now >= Date.parse(certificate.expiresAt)) return Object.freeze({ ok: false, code: 'QUALIFICATION_EXPIRED', certificate });
  return Object.freeze({ ok: true, code: 'QUALIFIED', certificate });
}

export function normalizeDelegationRecord(value = {}, context = {}) {
  rejectSecrets(value);
  rejectUnknown(value, DELEGATION_KEYS, 'Delegation record');
  const type = asString(value.type, 100);
  if (!DELEGATION_RECORD_TYPES.includes(type)) throw new Error(`非法 Delegation type：${type || '空'}`);
  const record = {
    schema: DELEGATION_RECORD_SCHEMA,
    recordId: asString(value.recordId || context.recordId, 360),
    runId: asString(value.runId || context.runId, 240),
    sequence: Math.max(1, Number(value.sequence || context.sequence) || 0),
    occurredAt: asString(value.occurredAt || context.occurredAt, 80),
    type,
    actorRef: asString(value.actorRef || 'factory:delegation', 240),
    authorityRef: asString(value.authorityRef, 240),
    delegationId: asString(value.delegationId, 320),
    taskRef: asString(value.taskRef, 500),
    seatRef: asString(value.seatRef, 240),
    executorRef: asString(value.executorRef, 320),
    certificateRef: asString(value.certificateRef, 320),
    restricted: value.restricted === true,
    channel: asString(value.channel, 80),
    status: asString(value.status, 40),
    instructionRef: asString(value.instructionRef, 800),
    evidenceRefs: refs(value.evidenceRefs),
    harnessAdapterRef: asString(value.harnessAdapterRef, 320),
    harnessSessionRef: asString(value.harnessSessionRef, 320),
    resultRef: asString(value.resultRef, 800),
    errorCode: asString(value.errorCode, 160),
    message: asString(value.message, 1200),
    cancelRef: asString(value.cancelRef, 800),
    disposeRef: asString(value.disposeRef, 800),
  };
  if (!record.recordId || !record.runId || !record.occurredAt || !record.delegationId) throw new Error('Delegation record 缺 recordId/runId/occurredAt/delegationId');
  assertIso(record.occurredAt, 'Delegation occurredAt');
  if (!record.taskRef || !record.seatRef || !record.executorRef || !DELEGATION_CHANNELS.includes(record.channel)) throw new Error('Delegation 缺 task/seat/executor/channel');
  if (record.restricted && type === 'assignment-created' && !record.certificateRef) throw new Error('受限 Seat assignment 必须引用 QualificationCertificate');
  const expectedStatus = {
    'assignment-created': 'assigned', 'delegation-started': 'running', 'delegation-blocked': 'blocked',
    'delegation-completed': 'completed', 'delegation-failed': 'failed',
    'delegation-cancelled': 'cancelled', 'delegation-disposed': 'disposed',
  }[type];
  if (record.status !== expectedStatus) throw new Error(`${type} status 必须是 ${expectedStatus}`);
  if (type === 'delegation-started' && record.channel === 'external-harness' && (!record.harnessAdapterRef || !record.harnessSessionRef)) throw new Error('外部 Delegation 启动必须有 Adapter/Session');
  if (type === 'delegation-completed' && !record.resultRef) throw new Error('Delegation 完成必须有 result provenance');
  if (['delegation-blocked', 'delegation-failed'].includes(type) && !record.errorCode) throw new Error(`${type} 必须有 errorCode`);
  if (type === 'delegation-cancelled' && !record.cancelRef) throw new Error('Delegation 取消必须有 cancel provenance');
  if (type === 'delegation-disposed' && !record.disposeRef) throw new Error('Delegation dispose 必须有 dispose provenance');
  return Object.freeze(record);
}

export function parseDelegationLog(text, { runId = '' } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const records = [];
  let corruptTail = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const record = normalizeDelegationRecord(JSON.parse(line));
      if (runId && record.runId !== runId) throw new Error('runId 不匹配');
      if (record.sequence !== records.length + 1) throw new Error('sequence 不连续');
      records.push(record);
    } catch (error) {
      if (lines.slice(index + 1).some(item => item.trim())) throw new Error(`Delegation 中段损坏（第 ${index + 1} 行）：${error.message}`);
      corruptTail = line;
      break;
    }
  }
  return { records, corruptTail };
}

export function replayDelegationRecords(values = [], { runId = '' } = {}) {
  const delegations = new Map();
  const recordIds = new Set();
  let sequence = 0;
  for (const value of values) {
    const record = normalizeDelegationRecord(value);
    if (runId && record.runId !== runId) throw new Error('Delegation runId 不匹配');
    if (record.sequence !== sequence + 1) throw new Error(`Delegation sequence 不连续：${sequence}→${record.sequence}`);
    if (recordIds.has(record.recordId)) throw new Error(`Delegation recordId 重复：${record.recordId}`);
    sequence = record.sequence;
    recordIds.add(record.recordId);
    const current = delegations.get(record.delegationId);
    if (record.type === 'assignment-created') {
      if (current) throw new Error(`Delegation assignment 重复：${record.delegationId}`);
      delegations.set(record.delegationId, { ...record, history: [record.recordId], terminalStatus: '' });
      continue;
    }
    if (record.type === 'delegation-blocked' && !current) {
      delegations.set(record.delegationId, { ...record, history: [record.recordId], terminalStatus: 'blocked' });
      continue;
    }
    if (!current) throw new Error(`Delegation 状态事件缺 assignment：${record.delegationId}`);
    const allowed = {
      assigned: ['delegation-started', 'delegation-blocked', 'delegation-failed', 'delegation-cancelled'],
      running: ['delegation-completed', 'delegation-failed', 'delegation-cancelled'],
      completed: ['delegation-disposed'], failed: ['delegation-disposed'], cancelled: ['delegation-disposed'],
    }[current.status] || [];
    if (!allowed.includes(record.type)) throw new Error(`Delegation 状态不允许 ${current.status}→${record.type}`);
    const terminalStatus = record.type === 'delegation-disposed' ? current.terminalStatus || current.status
      : TERMINAL_DELEGATION.has(record.status) ? record.status : current.terminalStatus;
    delegations.set(record.delegationId, { ...current, ...record, history: [...current.history, record.recordId], terminalStatus });
  }
  return { sequence, recordIds, delegations };
}

class AppendOnlyLedger {
  constructor({ io, path, clock, idFactory, records, replay, normalize, corruptTailPath = '' }) {
    this.io = io; this.path = path; this.clock = clock; this.idFactory = idFactory;
    this.records = records; this.replay = replay; this.normalize = normalize;
    this.corruptTailPath = corruptTailPath;
    this.state = replay(records);
    this.queue = Promise.resolve(); this.activeWrites = 0; this.disposed = false; this.recoveryRequired = false;
  }

  _text(records = this.records) { return records.length ? records.map(record => JSON.stringify(record)).join('\n') + '\n' : ''; }

  appendBatch(inputs = []) {
    if (this.disposed) return Promise.reject(new Error('W73d Ledger 已释放'));
    const operation = this.queue.then(async () => {
      if (this.recoveryRequired) throw new Error('W73d Ledger 处于损坏恢复阻断态');
      this.activeWrites += 1;
      try {
        let records = [...this.records];
        let state = this.state;
        for (const input of list(inputs)) {
          const existing = records.find(record => record.recordId === input.recordId);
          if (existing) {
            const candidate = this.normalize(input, {
              sequence: existing.sequence, occurredAt: existing.occurredAt,
              recordId: existing.recordId, runId: existing.runId,
            });
            if (semanticRecord(existing) !== semanticRecord(candidate)) throw new Error(`W73d 幂等键冲突：${input.recordId}`);
            continue;
          }
          const record = this.normalize(input, {
            sequence: records.length + 1, occurredAt: isoNow(this.clock),
            recordId: input.recordId || `w73d:${records.length + 1}:${this.idFactory()}`,
          });
          records.push(record);
          state = this.replay(records);
        }
        await this.io.write(this.path, this._text(records));
        this.records = records; this.state = state;
        return this.healthSnapshot();
      } finally { this.activeWrites -= 1; }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  healthSnapshot() {
    return Object.freeze({ path: this.path, records: this.records.length, activeWrites: this.activeWrites, disposed: this.disposed, recoveryRequired: this.recoveryRequired });
  }

  async dispose() {
    if (this.disposed) return this.healthSnapshot();
    await this.queue; this.disposed = true;
    return this.healthSnapshot();
  }
}

function validateIo(io) {
  for (const method of ['read', 'write', 'exists']) if (typeof io?.[method] !== 'function') throw new Error(`W73d IO 缺 ${method}`);
  return io;
}

async function openLedger({ io, path, clock, idFactory, parse, replay, normalize, corruptTailPath }) {
  validateIo(io);
  const target = asString(path, 1400);
  if (!target) throw new Error('W73d Ledger 缺 path');
  let records = [];
  let corruptTail = '';
  if (await io.exists(target)) ({ records, corruptTail } = parse(await io.read(target)));
  else await io.write(target, '');
  const ledger = new AppendOnlyLedger({ io, path: target, clock, idFactory, records, replay, normalize, corruptTailPath });
  if (corruptTail) {
    await io.write(corruptTailPath, corruptTail);
    await io.write(target, ledger._text());
    ledger.recoveryRequired = true;
  }
  return ledger;
}

export class QualificationLedger extends AppendOnlyLedger {
  static async open({ io, path, clock = Date.now, idFactory = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}` } = {}) {
    const ledger = await openLedger({
      io, path, clock, idFactory, parse: parseQualificationLog,
      replay: replayQualificationRecords, normalize: normalizeQualificationRecord,
      corruptTailPath: `${path}.corrupt-tail.txt`,
    });
    Object.setPrototypeOf(ledger, QualificationLedger.prototype);
    return ledger;
  }

  healthSnapshot() {
    return Object.freeze({
      ...super.healthSnapshot(), definitions: this.state.definitions.size,
      attempts: this.state.attempts.size, certificates: this.state.certificates.size,
      activeCertificates: [...this.state.certificates.values()].filter(row => !row.revokedAt).length,
    });
  }
}

export class DelegationLedger extends AppendOnlyLedger {
  static async open({ io, path, runId, clock = Date.now, idFactory = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}` } = {}) {
    const id = asString(runId, 240);
    if (!id) throw new Error('Delegation Ledger 缺 runId');
    const ledger = await openLedger({
      io, path, clock, idFactory,
      parse: text => parseDelegationLog(text, { runId: id }),
      replay: records => replayDelegationRecords(records, { runId: id }),
      normalize: (value, context) => normalizeDelegationRecord(value, { ...context, runId: id }),
      corruptTailPath: `${path}.corrupt-tail.txt`,
    });
    Object.setPrototypeOf(ledger, DelegationLedger.prototype);
    ledger.runId = id;
    return ledger;
  }

  healthSnapshot() {
    const rows = [...this.state.delegations.values()];
    return Object.freeze({
      ...super.healthSnapshot(), runId: this.runId, delegations: rows.length,
      activeDelegations: rows.filter(row => ['assigned', 'running'].includes(row.status)).length,
      blockedDelegations: rows.filter(row => row.status === 'blocked' || row.terminalStatus === 'blocked').length,
    });
  }
}

function publicError(error, fallback = 'DELEGATION_FAILED') {
  return { code: asString(error?.code || fallback, 160), message: asString(error?.message || error || fallback, 1000) };
}

export class QualificationDelegationService {
  constructor({ qualificationLedger, delegationLedger, harnessClient = null, clock = Date.now, idFactory = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}` } = {}) {
    if (!qualificationLedger || !delegationLedger) throw new Error('QualificationDelegationService 缺 Ledger');
    this.qualificationLedger = qualificationLedger;
    this.delegationLedger = delegationLedger;
    this.harnessClient = harnessClient;
    this.clock = clock;
    this.idFactory = idFactory;
    this.activeExternal = new Map();
    this.disposed = false;
  }

  nextDelegationId() { return `delegation:${this.delegationLedger.runId}:${this.idFactory()}`; }

  async _block(input, errorCode, message) {
    const delegationId = input.delegationId || this.nextDelegationId();
    await this.delegationLedger.appendBatch([{
      recordId: `${delegationId}:blocked:${errorCode}`, type: 'delegation-blocked', delegationId,
      taskRef: input.taskRef, seatRef: input.seatRef, executorRef: input.executorRef,
      certificateRef: input.certificateRef, restricted: input.restricted === true,
      channel: input.channel, status: 'blocked', instructionRef: input.instructionRef,
      evidenceRefs: input.evidenceRefs, errorCode, message,
    }]);
    return Object.freeze({ delegationId, status: 'blocked', code: errorCode, message });
  }

  async _assign(input) {
    if (this.disposed) throw new Error('QualificationDelegationService 已释放');
    const delegationId = input.delegationId || this.nextDelegationId();
    const decision = evaluateQualification(this.qualificationLedger.state, {
      restricted: input.restricted !== false, certificateRef: input.certificateRef,
      executorRef: input.executorRef, seatRef: input.seatRef, at: this.clock(),
    });
    const normalized = { ...input, delegationId, restricted: input.restricted !== false };
    if (!decision.ok) return { blocked: await this._block(normalized, decision.code, `BLOCKED: ${decision.code}`), input: normalized };
    await this.delegationLedger.appendBatch([{
      recordId: `${delegationId}:assigned`, type: 'assignment-created', delegationId,
      taskRef: input.taskRef, seatRef: input.seatRef, executorRef: input.executorRef,
      certificateRef: input.certificateRef, restricted: normalized.restricted,
      channel: input.channel, status: 'assigned', instructionRef: input.instructionRef,
      evidenceRefs: input.evidenceRefs, authorityRef: input.authorityRef,
    }]);
    return { blocked: null, input: normalized };
  }

  async delegateInternal(input = {}) {
    const assigned = await this._assign({ ...input, channel: 'internal-agent-runtime' });
    if (assigned.blocked) return assigned.blocked;
    const value = assigned.input;
    const runtime = input.runtime;
    if (!runtime || typeof runtime.submit !== 'function') return this._block(value, 'AGENT_RUNTIME_UNAVAILABLE', 'BLOCKED: AGENT_RUNTIME_UNAVAILABLE');
    await this.delegationLedger.appendBatch([{
      recordId: `${value.delegationId}:started`, type: 'delegation-started', delegationId: value.delegationId,
      taskRef: value.taskRef, seatRef: value.seatRef, executorRef: value.executorRef,
      certificateRef: value.certificateRef, restricted: value.restricted, channel: value.channel,
      status: 'running', instructionRef: value.instructionRef, evidenceRefs: value.evidenceRefs,
    }]);
    try {
      const result = typeof runtime.submitForDelegation === 'function'
        ? await runtime.submitForDelegation(input.instruction)
        : await runtime.submit(input.instruction);
      if (result?.status === 'failed') throw Object.assign(new Error(result.message || 'AgentRuntime failed'), { code: 'AGENT_RUNTIME_FAILED' });
      const resultRef = asString(input.resultRef || `${value.instructionRef || value.taskRef}#agent-result`, 800);
      await this.delegationLedger.appendBatch([{
        recordId: `${value.delegationId}:completed`, type: 'delegation-completed', delegationId: value.delegationId,
        taskRef: value.taskRef, seatRef: value.seatRef, executorRef: value.executorRef,
        certificateRef: value.certificateRef, restricted: value.restricted, channel: value.channel,
        status: 'completed', instructionRef: value.instructionRef, evidenceRefs: value.evidenceRefs,
        resultRef, message: asString(result?.message || result?.status || 'AgentRuntime completed', 1000),
      }]);
      return Object.freeze({ delegationId: value.delegationId, status: 'completed', code: 'INTERNAL_COMPLETED', resultRef, result });
    } catch (error) {
      const failure = publicError(error, 'AGENT_RUNTIME_FAILED');
      await this.delegationLedger.appendBatch([{
        recordId: `${value.delegationId}:failed`, type: 'delegation-failed', delegationId: value.delegationId,
        taskRef: value.taskRef, seatRef: value.seatRef, executorRef: value.executorRef,
        certificateRef: value.certificateRef, restricted: value.restricted, channel: value.channel,
        status: 'failed', instructionRef: value.instructionRef, evidenceRefs: value.evidenceRefs,
        errorCode: failure.code, message: failure.message,
      }]);
      return Object.freeze({ delegationId: value.delegationId, status: 'failed', ...failure });
    }
  }

  async delegateExternal(input = {}) {
    const assigned = await this._assign({ ...input, channel: 'external-harness' });
    if (assigned.blocked) return assigned.blocked;
    const value = assigned.input;
    let adapters = [];
    try { adapters = list(await this.harnessClient?.listAdapters?.()); } catch { adapters = []; }
    const adapter = input.adapterId ? adapters.find(row => row?.id === input.adapterId) : adapters[0];
    if (!adapter) return this._block(value, 'HARNESS_UNAVAILABLE', 'BLOCKED: HARNESS_UNAVAILABLE');
    let session = null;
    let activeSession = null;
    try {
      session = await this.harnessClient.createSession({
        adapterId: adapter.id, workspace: input.workspace || '', instruction: input.instruction || '',
        context: { runId: this.delegationLedger.runId, taskRef: value.taskRef, delegationId: value.delegationId },
      });
      const sessionRef = asString(session?.id, 320);
      if (!sessionRef) throw Object.assign(new Error('Harness 未返回 Session id'), { code: 'HARNESS_SESSION_INVALID' });
      activeSession = { delegationId: value.delegationId, sessionId: sessionRef, value, cancelled: false, disposed: false };
      this.activeExternal.set(value.delegationId, activeSession);
      await this.delegationLedger.appendBatch([{
        recordId: `${value.delegationId}:started`, type: 'delegation-started', delegationId: value.delegationId,
        taskRef: value.taskRef, seatRef: value.seatRef, executorRef: value.executorRef,
        certificateRef: value.certificateRef, restricted: value.restricted, channel: value.channel,
        status: 'running', instructionRef: value.instructionRef, evidenceRefs: value.evidenceRefs,
        harnessAdapterRef: `harness-adapter:${adapter.id}`, harnessSessionRef: `harness-session:${sessionRef}`,
      }]);
      const result = await this.harnessClient.send(sessionRef, input.payload ?? input.instruction ?? '');
      if (activeSession.cancelled) return Object.freeze({ delegationId: value.delegationId, status: 'cancelled', code: 'DELEGATION_CANCELLED' });
      const resultRef = asString(input.resultRef || `harness-session:${sessionRef}#result`, 800);
      await this.delegationLedger.appendBatch([{
        recordId: `${value.delegationId}:completed`, type: 'delegation-completed', delegationId: value.delegationId,
        taskRef: value.taskRef, seatRef: value.seatRef, executorRef: value.executorRef,
        certificateRef: value.certificateRef, restricted: value.restricted, channel: value.channel,
        status: 'completed', instructionRef: value.instructionRef, evidenceRefs: value.evidenceRefs,
        harnessAdapterRef: `harness-adapter:${adapter.id}`, harnessSessionRef: `harness-session:${sessionRef}`,
        resultRef, message: 'Harness Session returned a result reference',
      }]);
      return Object.freeze({ delegationId: value.delegationId, status: 'completed', code: 'HARNESS_COMPLETED', resultRef, result });
    } catch (error) {
      if (activeSession?.cancelled) return Object.freeze({ delegationId: value.delegationId, status: 'cancelled', code: 'DELEGATION_CANCELLED' });
      const failure = publicError(error, session ? 'HARNESS_EXECUTION_FAILED' : 'HARNESS_SESSION_FAILED');
      await this.delegationLedger.appendBatch([{
        recordId: `${value.delegationId}:failed`, type: 'delegation-failed', delegationId: value.delegationId,
        taskRef: value.taskRef, seatRef: value.seatRef, executorRef: value.executorRef,
        certificateRef: value.certificateRef, restricted: value.restricted, channel: value.channel,
        status: 'failed', instructionRef: value.instructionRef, evidenceRefs: value.evidenceRefs,
        harnessAdapterRef: adapter ? `harness-adapter:${adapter.id}` : '',
        harnessSessionRef: session?.id ? `harness-session:${session.id}` : '',
        errorCode: failure.code, message: failure.message,
      }]);
      return Object.freeze({ delegationId: value.delegationId, status: 'failed', ...failure });
    } finally {
      const active = this.activeExternal.get(value.delegationId);
      if (active && !active.disposed) await this._disposeExternal(active, 'delegate-finished');
    }
  }

  async _disposeExternal(active, reason) {
    if (active.disposed) return;
    active.disposed = true;
    try { await this.harnessClient.dispose(active.sessionId, reason); }
    finally {
      await this.delegationLedger.appendBatch([{
        recordId: `${active.delegationId}:disposed`, type: 'delegation-disposed', delegationId: active.delegationId,
        taskRef: active.value.taskRef, seatRef: active.value.seatRef, executorRef: active.value.executorRef,
        certificateRef: active.value.certificateRef, restricted: active.value.restricted, channel: active.value.channel,
        status: 'disposed', instructionRef: active.value.instructionRef, evidenceRefs: active.value.evidenceRefs,
        harnessSessionRef: `harness-session:${active.sessionId}`,
        disposeRef: `harness-session:${active.sessionId}#dispose:${reason}`, message: reason,
      }]);
      this.activeExternal.delete(active.delegationId);
    }
  }

  async cancel(delegationId, reason = 'user-cancel') {
    const active = this.activeExternal.get(asString(delegationId, 320));
    if (!active) return Object.freeze({ delegationId, status: 'not-active' });
    active.cancelled = true;
    await this.harnessClient.interrupt(active.sessionId);
    await this.delegationLedger.appendBatch([{
      recordId: `${active.delegationId}:cancelled`, type: 'delegation-cancelled', delegationId: active.delegationId,
      taskRef: active.value.taskRef, seatRef: active.value.seatRef, executorRef: active.value.executorRef,
      certificateRef: active.value.certificateRef, restricted: active.value.restricted, channel: active.value.channel,
      status: 'cancelled', instructionRef: active.value.instructionRef, evidenceRefs: active.value.evidenceRefs,
      harnessSessionRef: `harness-session:${active.sessionId}`,
      cancelRef: `harness-session:${active.sessionId}#interrupt:${reason}`, message: reason,
    }]);
    await this._disposeExternal(active, reason);
    return Object.freeze({ delegationId: active.delegationId, status: 'cancelled' });
  }

  healthSnapshot() {
    return Object.freeze({ activeExternal: this.activeExternal.size, disposed: this.disposed });
  }

  async dispose() {
    if (this.disposed) return this.healthSnapshot();
    for (const id of [...this.activeExternal.keys()]) await this.cancel(id, 'service-dispose').catch(() => {});
    this.disposed = true;
    return this.healthSnapshot();
  }
}

export const openQualificationLedger = options => QualificationLedger.open(options);
export const openDelegationLedger = options => DelegationLedger.open(options);
