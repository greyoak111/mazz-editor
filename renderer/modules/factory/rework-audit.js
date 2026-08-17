// W73c Rework / Finding / AuditFlag v0：消费 W68 结果，不重写审理引擎。

import { normalizeProductionRunReference } from './production-run.js';

export const REWORK_AUDIT_RECORD_SCHEMA = 'mazz.rework-audit-record/v0';

export const REWORK_AUDIT_RECORD_TYPES = Object.freeze([
  'finding-raised', 'finding-status-changed', 'rework-recorded',
  'human-escalation-requested', 'audit-recovery-required',
]);

export const FINDING_KINDS = Object.freeze([
  'rule-violation', 'audit-flag', 'missing-source', 'wrong-source', 'stale-source',
  'authority-mismatch', 'dead-proposal-revival', 'self-certification',
]);

export const HALLUCINATED_ANCHOR_KINDS = Object.freeze([
  'missing-source', 'wrong-source', 'stale-source',
  'authority-mismatch', 'dead-proposal-revival', 'self-certification',
]);

export const FINDING_STATUSES = Object.freeze(['open', 'accepted', 'disputed', 'resolved', 'waived']);
export const REWORK_STAGES = Object.freeze(['skeleton', 'draft', 'point', 'review', 'final']);
export const REWORK_STATUSES = Object.freeze(['required', 'in-progress', 'completed', 'blocked', 'cancelled']);

const RECORD_KEYS = new Set([
  'schema', 'recordId', 'runId', 'sequence', 'occurredAt', 'type', 'actorRef', 'authorityRef',
  'findingId', 'findingKind', 'severity', 'status', 'fromStatus', 'toStatus', 'artifactRefs',
  'anchorRef', 'sourceRef', 'evidenceRefs', 'ruleRef', 'resolutionRef', 'message',
  'reworkId', 'triggerFindingRefs', 'stage', 'reasonCode', 'affectedArtifactRefs',
  'protectionRefs', 'assignedSeatRef', 'verifiedByRef', 'attempt', 'parentReworkRef',
  'beforeRefs', 'afterRefs', 'verificationRefs',
]);
const SECRET_KEYS = new Set(['apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken', 'credential', 'cookie']);
const ALLOWED_FINDING_TRANSITIONS = Object.freeze({
  open: ['accepted', 'disputed', 'resolved', 'waived'],
  disputed: ['accepted', 'resolved', 'waived'],
  accepted: ['resolved', 'waived'],
  resolved: [], waived: [],
});
const asString = (value, max = 800) => String(value ?? '').trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const uniqueStrings = (value, max = 320) => [...new Set(list(value).map(item => asString(item, max)).filter(Boolean))];
const slug = value => asString(value, 160).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'item';
const isoNow = clock => new Date(clock()).toISOString();

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${trail}[${index}]`));
  if (!plainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const canonical = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SECRET_KEYS.has(canonical)) throw new Error(`Rework Audit 禁止 secret 字段：${trail ? trail + '.' : ''}${key}`);
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

export function normalizeReworkAuditRecord(value = {}, context = {}) {
  rejectSecrets(value);
  rejectUnknown(value, RECORD_KEYS, 'Rework Audit record');
  const type = asString(value.type, 100);
  if (!REWORK_AUDIT_RECORD_TYPES.includes(type)) throw new Error(`非法 Rework Audit type：${type || '空'}`);
  const record = {
    schema: REWORK_AUDIT_RECORD_SCHEMA,
    recordId: asString(value.recordId || context.recordId, 360),
    runId: asString(value.runId || context.runId, 240),
    sequence: Math.max(1, Number(value.sequence || context.sequence) || 0),
    occurredAt: asString(value.occurredAt || context.occurredAt, 80),
    type,
    actorRef: asString(value.actorRef || 'factory:w68-adapter', 240),
    authorityRef: asString(value.authorityRef, 240),
    findingId: asString(value.findingId, 360),
    findingKind: asString(value.findingKind, 100),
    severity: asString(value.severity, 40),
    status: asString(value.status, 40),
    fromStatus: asString(value.fromStatus, 40),
    toStatus: asString(value.toStatus, 40),
    artifactRefs: refs(value.artifactRefs),
    anchorRef: asString(value.anchorRef, 600),
    sourceRef: asString(value.sourceRef, 600),
    evidenceRefs: refs(value.evidenceRefs),
    ruleRef: asString(value.ruleRef, 240),
    resolutionRef: asString(value.resolutionRef, 1000),
    message: asString(value.message, 1600),
    reworkId: asString(value.reworkId, 360),
    triggerFindingRefs: uniqueStrings(value.triggerFindingRefs, 360),
    stage: asString(value.stage, 40),
    reasonCode: asString(value.reasonCode, 160),
    affectedArtifactRefs: refs(value.affectedArtifactRefs),
    protectionRefs: refs(value.protectionRefs),
    assignedSeatRef: asString(value.assignedSeatRef, 240),
    verifiedByRef: asString(value.verifiedByRef, 240),
    attempt: Math.max(0, Number(value.attempt) || 0),
    parentReworkRef: asString(value.parentReworkRef, 360),
    beforeRefs: refs(value.beforeRefs),
    afterRefs: refs(value.afterRefs),
    verificationRefs: refs(value.verificationRefs),
  };
  if (!record.recordId || !record.runId || !record.occurredAt) throw new Error('Rework Audit record 缺 recordId/runId/occurredAt');
  if (type === 'finding-raised') {
    if (!record.findingId || !FINDING_KINDS.includes(record.findingKind)) throw new Error('finding-raised 缺 findingId/kind');
    if (!['critical', 'major', 'minor', 'warning', 'info'].includes(record.severity)) throw new Error('finding-raised severity 非法');
    if (record.status !== 'open') throw new Error('finding-raised 必须从 open 开始');
    if (!record.artifactRefs.length || !record.evidenceRefs.length) throw new Error('finding-raised 必须引用工件与证据');
    if (HALLUCINATED_ANCHOR_KINDS.includes(record.findingKind) && (!record.sourceRef || !record.anchorRef || !record.evidenceRefs.length)) {
      throw new Error('幻锚 Finding 必须同时有 sourceRef/anchorRef/evidenceRefs');
    }
  }
  if (type === 'finding-status-changed') {
    if (!record.findingId || !FINDING_STATUSES.includes(record.fromStatus) || !FINDING_STATUSES.includes(record.toStatus)) throw new Error('finding-status-changed 状态非法');
    if (!ALLOWED_FINDING_TRANSITIONS[record.fromStatus]?.includes(record.toStatus)) throw new Error(`Finding 状态不允许 ${record.fromStatus}→${record.toStatus}`);
    if (!record.authorityRef || !record.resolutionRef || !record.evidenceRefs.length) throw new Error('Finding 状态改变必须有 authority/resolution/evidence');
  }
  if (type === 'rework-recorded') {
    if (!record.reworkId || !REWORK_STAGES.includes(record.stage) || !REWORK_STATUSES.includes(record.status)) throw new Error('rework-recorded 身份/阶段/状态非法');
    if (!record.triggerFindingRefs.length || !record.reasonCode || !record.affectedArtifactRefs.length) throw new Error('rework-recorded 缺触发 Finding、原因或影响集合');
    if (!record.assignedSeatRef || !record.verifiedByRef || record.attempt < 1) throw new Error('rework-recorded 缺执行/复验/attempt');
    if (!record.beforeRefs.length || !record.afterRefs.length || !record.verificationRefs.length) throw new Error('rework-recorded 必须有改前、改后与复验证据');
  }
  if (type === 'human-escalation-requested' && (!record.reasonCode || !record.evidenceRefs.length)) throw new Error('人工升级必须有原因与证据');
  if (type === 'audit-recovery-required' && (!record.reasonCode || !record.evidenceRefs.length)) throw new Error('审计恢复必须有原因与证据');
  return Object.freeze(record);
}

export function parseReworkAuditLog(text, { runId = '' } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const records = [];
  let corruptTail = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const record = normalizeReworkAuditRecord(JSON.parse(line));
      if (runId && record.runId !== runId) throw new Error('runId 不匹配');
      if (record.sequence !== records.length + 1) throw new Error('sequence 不连续');
      records.push(record);
    } catch (error) {
      if (lines.slice(index + 1).some(item => item.trim())) throw new Error(`Rework Audit 中段损坏（第 ${index + 1} 行）：${error.message}`);
      corruptTail = line;
      break;
    }
  }
  return { records, corruptTail };
}

export function replayReworkAudit(records = [], { runId = '' } = {}) {
  const findings = new Map();
  const reworks = new Map();
  const escalations = [];
  let recoveryRequired = false;
  const recordIds = new Set();
  let sequence = 0;
  for (const value of records) {
    const record = normalizeReworkAuditRecord(value);
    if (runId && record.runId !== runId) throw new Error('Rework Audit runId 不匹配');
    if (record.sequence !== sequence + 1) throw new Error(`Rework Audit sequence 不连续：${sequence}→${record.sequence}`);
    if (recordIds.has(record.recordId)) throw new Error(`Rework Audit recordId 重复：${record.recordId}`);
    recordIds.add(record.recordId);
    sequence = record.sequence;
    if (record.type === 'finding-raised') {
      if (findings.has(record.findingId)) throw new Error(`Finding 重复提出：${record.findingId}`);
      findings.set(record.findingId, { ...record, status: 'open', history: [record.recordId] });
    } else if (record.type === 'finding-status-changed') {
      const current = findings.get(record.findingId);
      if (!current || current.status !== record.fromStatus) throw new Error(`Finding 状态漂移：${record.findingId}`);
      findings.set(record.findingId, { ...current, status: record.toStatus, authorityRef: record.authorityRef, resolutionRef: record.resolutionRef, history: [...current.history, record.recordId] });
    } else if (record.type === 'rework-recorded') {
      if (reworks.has(record.reworkId)) throw new Error(`Rework 重复：${record.reworkId}`);
      for (const findingRef of record.triggerFindingRefs) if (!findings.has(findingRef)) throw new Error(`Rework 引用了不存在的 Finding：${findingRef}`);
      reworks.set(record.reworkId, record);
    } else if (record.type === 'human-escalation-requested') escalations.push(record);
    else if (record.type === 'audit-recovery-required') recoveryRequired = true;
  }
  const unresolvedFindingIds = [...findings.values()].filter(row => !['resolved', 'waived'].includes(row.status)).map(row => row.findingId);
  return { sequence, recordIds, findings, reworks, escalations, recoveryRequired, unresolvedFindingIds };
}

function findingKindOf(finding = {}) {
  const id = asString(finding.id, 200);
  if (/^source-/.test(id)) return 'missing-source';
  if (/^freeze-/.test(id)) return 'authority-mismatch';
  if (id === 'self-certification') return 'self-certification';
  return 'rule-violation';
}

function severityOf(value) {
  const severity = asString(value, 40);
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'warning';
  if (severity === 'major' || severity === 'minor' || severity === 'info') return severity;
  return 'major';
}

function artifactRef(path, id, role, type = 'text/markdown') {
  return { kind: 'artifact', id, path, type, role };
}

function findingIdentity(runId, unitTag, channel, rawId) {
  return `finding:${runId}:${unitTag}:${channel}:${slug(rawId)}`;
}

function semanticRecord(record) {
  const { sequence, occurredAt, ...rest } = record;
  return JSON.stringify(rest);
}

export function buildW68AuditBatch({ runId = '', result = {}, artifactDir = '', unitNo = 1, clock = Date.now, redact = value => value } = {}) {
  const normalizedRunId = asString(runId, 240);
  const root = asString(artifactDir, 1200).replace(/\\/g, '/').replace(/\/$/, '');
  if (!normalizedRunId || !root) throw new Error('W68 Audit batch 缺 runId/artifactDir');
  const unitTag = `u${String(Math.max(1, Number(unitNo) || 1)).padStart(3, '0')}`;
  const at = isoNow(clock);
  const machinePath = `${root}/03-机检报告.md`;
  const pointPath = `${root}/04-对点报告.md`;
  const repairPath = `${root}/05-修订单.md`;
  const answerPath = `${root}/09-答辩书.md`;
  const verdictPath = `${root}/10-裁决书.md`;
  const draftPath = `${root}/02-扩写稿.md`;
  const records = [];
  const artifactsToWrite = [];
  const findingIds = new Map();
  const findingMessageIds = new Map();
  const findingStates = new Map();
  const safeMessage = value => asString(redact(asString(value, 1600)), 1600);
  const add = record => records.push({ occurredAt: at, ...record });
  const raise = ({ rawId, channel, kind = 'rule-violation', severity = 'major', artifactPath = draftPath, evidencePath = machinePath, anchorRef = '', sourceRef = '', ruleRef = '', message = '', actorRef = 'inspector:deterministic' }) => {
    const key = `${channel}:${rawId}`;
    if (findingIds.has(key)) return findingIds.get(key);
    const findingId = findingIdentity(normalizedRunId, unitTag, channel, rawId);
    findingIds.set(key, findingId);
    const messageKey = `${channel}:${asString(message, 1600)}`;
    if (asString(message, 1600)) {
      if (!findingMessageIds.has(messageKey)) findingMessageIds.set(messageKey, new Set());
      findingMessageIds.get(messageKey).add(findingId);
    }
    findingStates.set(findingId, 'open');
    add({
      recordId: `${findingId}:raised`, runId: normalizedRunId, type: 'finding-raised', actorRef,
      findingId, findingKind: kind, severity: severityOf(severity), status: 'open',
      artifactRefs: [artifactRef(artifactPath, `${unitTag}:draft`, 'affected-artifact')],
      anchorRef: anchorRef || `${channel}:${rawId}`,
      sourceRef: sourceRef || `rule:${ruleRef || 'W68'}`,
      evidenceRefs: [artifactRef(evidencePath, `${unitTag}:${channel}:evidence`, 'finding-evidence')],
      ruleRef, message: safeMessage(message),
    });
    return findingId;
  };
  const transition = (findingId, toStatus, { authorityRef, resolutionRef, evidencePath, actorRef = 'factory:w68-adapter', message = '' } = {}) => {
    const fromStatus = findingStates.get(findingId);
    if (!fromStatus || fromStatus === toStatus || ['resolved', 'waived'].includes(fromStatus)) return;
    add({
      recordId: `${findingId}:${fromStatus}-to-${toStatus}`, runId: normalizedRunId, type: 'finding-status-changed', actorRef,
      authorityRef, findingId, fromStatus, toStatus, resolutionRef, message: safeMessage(message),
      evidenceRefs: [artifactRef(evidencePath, `${findingId}:${toStatus}`, 'resolution-evidence')],
    });
    findingStates.set(findingId, toStatus);
  };

  for (const history of list(result.machineHistory)) {
    for (const finding of list(history?.report?.findings)) {
      const kind = findingKindOf(finding);
      const rawId = asString(finding.id, 200) || `machine-${findingIds.size + 1}`;
      raise({
        rawId, channel: 'machine', kind, severity: finding.severity,
        anchorRef: asString(finding.artifactRef, 600) || `draft:${rawId}`,
        sourceRef: kind === 'missing-source' ? `missing:${asString(finding.artifactRef, 600) || rawId}` : `rule:${asString(finding.ruleRef, 240) || 'W68'}`,
        ruleRef: finding.ruleRef, message: finding.message,
      });
    }
  }
  for (const report of list(result.pointReports)) {
    for (const [index, finding] of list(report?.findings).entries()) {
      const rawId = asString(finding?.id, 200) || `round-${report.round}-${index + 1}`;
      raise({
        rawId, channel: 'point', kind: 'audit-flag', severity: finding?.severity || 'major',
        artifactPath: draftPath, evidencePath: pointPath, anchorRef: asString(finding?.artifactRef, 600) || `point:${report.round}:${index + 1}`,
        sourceRef: `rule:${asString(finding?.ruleRef, 240) || 'W68-R1'}`, ruleRef: finding?.ruleRef,
        message: finding?.message || asString(finding, 1200), actorRef: 'seat:M2',
      });
    }
  }
  for (const [index, objection] of list(result.objections).entries()) {
    const rawId = asString(objection?.id, 200) || `objection-${index + 1}`;
    const findingId = raise({
      rawId, channel: 'objection', kind: 'audit-flag', severity: objection?.severity || 'major',
      artifactPath: draftPath, evidencePath: `${root}/08-质询单.md`, anchorRef: objection?.artifactRef || `objection:${rawId}`,
      sourceRef: `rule:${objection?.ruleRef || 'W68-R8'}`, ruleRef: objection?.ruleRef,
      message: objection?.claim || '审理席提出质询', actorRef: `seat:${objection?.reviewer || 'M4'}`,
    });
    const relatedAnswers = list(result.answers).filter(answer => answer?.objectionId === objection?.id);
    if (relatedAnswers.length) transition(findingId, 'disputed', {
      authorityRef: `seat:${objection?.reviewer || 'M4'}`, resolutionRef: `${answerPath}#${rawId}`,
      evidencePath: answerPath, actorRef: 'seat:M2', message: '答辩已提交，旗语进入争议态',
    });
    if (objection?.status === 'closed') transition(findingId, 'resolved', {
      authorityRef: `seat:${objection?.reviewer || 'M4'}`, resolutionRef: `${answerPath}#${rawId}`,
      evidencePath: answerPath, message: '原质询席依证撤回',
    });
    if (objection?.status === 'overruled') transition(findingId, 'waived', {
      authorityRef: 'seat:M6', resolutionRef: `${verdictPath}#${rawId}`,
      evidencePath: verdictPath, message: '庭审席驳回质询',
    });
    if (objection?.status === 'sustained') transition(findingId, 'accepted', {
      authorityRef: 'seat:M6', resolutionRef: `${verdictPath}#${rawId}`,
      evidencePath: verdictPath, message: '庭审席维持质询',
    });
  }

  let parentReworkRef = '';
  for (const [index, rework] of list(result.reworkHistory).entries()) {
    const attempt = Math.max(1, Number(rework?.attempt) || index + 1);
    const reworkId = `rework:${normalizedRunId}:${unitTag}:${String(attempt).padStart(2, '0')}`;
    const beforePath = `${root}/回炉记录/R${String(attempt).padStart(2, '0')}-改前.md`;
    const afterPath = `${root}/回炉记录/R${String(attempt).padStart(2, '0')}-改后.md`;
    const verificationPath = `${root}/回炉记录/R${String(attempt).padStart(2, '0')}-复验.json`;
    artifactsToWrite.push(
      { path: beforePath, content: String(rework?.beforeText ?? '') },
      { path: afterPath, content: String(rework?.afterText ?? '') },
      { path: verificationPath, content: JSON.stringify(rework?.residueReport || {}, null, 2) },
    );
    const sourceChannel = String(rework?.source || '').startsWith('point:') ? 'point' : 'machine';
    let triggerFindingRefs = uniqueStrings(list(rework?.order?.items).flatMap(item => [
      ...(findingMessageIds.get(`${sourceChannel}:${asString(item?.error, 1600)}`) || []),
    ]), 360);
    if (!triggerFindingRefs.length) {
      const syntheticRawId = `rework-${attempt}`;
      triggerFindingRefs = [raise({
        rawId: syntheticRawId, channel: 'repair-order', kind: 'audit-flag', severity: 'major',
        artifactPath: draftPath, evidencePath: repairPath, anchorRef: `repair:${attempt}`,
        sourceRef: `rule:${rework?.order?.items?.[0]?.reason || 'W68-R1'}`, ruleRef: rework?.order?.items?.[0]?.reason || 'W68-R1',
        message: `修订单第 ${attempt} 次回炉`, actorRef: String(rework?.source || '').startsWith('point:') ? 'seat:M2' : 'inspector:deterministic',
      })];
    }
    const protectionRefs = list(rework?.order?.protectionList).map((_, itemIndex) => ({
      kind: 'protection', id: `${reworkId}:p${itemIndex + 1}`, sourceRef: `${repairPath}#protection-${itemIndex + 1}`, role: 'protected-content',
    }));
    const status = rework?.residueReport?.pass === true ? 'completed' : 'blocked';
    add({
      recordId: `${reworkId}:recorded`, runId: normalizedRunId, type: 'rework-recorded', actorRef: 'factory:w68-adapter',
      reworkId, triggerFindingRefs, stage: REWORK_STAGES.includes(rework?.stage) ? rework.stage : 'draft',
      reasonCode: rework?.reasonCode || 'W68_REWORK', status,
      affectedArtifactRefs: [artifactRef(draftPath, `${unitTag}:draft`, 'affected-artifact')], protectionRefs,
      assignedSeatRef: rework?.assignedSeatRef || 'seat:M3', verifiedByRef: 'inspector:deterministic', attempt,
      parentReworkRef, beforeRefs: [artifactRef(beforePath, `${reworkId}:before`, 'before')],
      afterRefs: [artifactRef(afterPath, `${reworkId}:after`, 'after')],
      verificationRefs: [artifactRef(verificationPath, `${reworkId}:verification`, 'residue-scan', 'application/json')],
      message: status === 'completed' ? '回炉后 residue scan 通过' : '回炉后 residue scan 仍有未结问题',
    });
    parentReworkRef = reworkId;
  }

  const finalFindingIds = new Set(list(result.machine?.findings).map(finding => asString(finding?.id, 200)));
  for (const [key, findingId] of findingIds.entries()) {
    if (!key.startsWith('machine:')) continue;
    const rawId = key.slice('machine:'.length);
    if (!finalFindingIds.has(rawId)) transition(findingId, 'resolved', {
      authorityRef: 'inspector:deterministic', resolutionRef: `${machinePath}#final`,
      evidencePath: machinePath, message: '最终 residue scan 未再命中',
    });
  }
  if (result.point?.decision === 'pass') {
    for (const [key, findingId] of findingIds.entries()) if (key.startsWith('point:')) transition(findingId, 'resolved', {
      authorityRef: 'seat:M2', resolutionRef: `${pointPath}#final`, evidencePath: pointPath, message: '最终对点复审通过',
    });
  }
  if (result.verdict === 'return-skeleton' || list(result.transitions).includes('nonconvergence:skeleton')) {
    add({
      recordId: `escalation:${normalizedRunId}:${unitTag}:nonconvergence`, runId: normalizedRunId,
      type: 'human-escalation-requested', actorRef: 'factory:w68-adapter', authorityRef: 'human:required',
      reasonCode: 'THREE_ROUND_NONCONVERGENCE', message: safeMessage(result.reason || '三轮未收敛，退骨并请求人工决定'),
      evidenceRefs: [artifactRef(verdictPath, `${unitTag}:verdict`, 'escalation-evidence')],
    });
  }
  return {
    records,
    artifactsToWrite,
    findingRefs: [...new Set(records.map(record => record.findingId).filter(Boolean))],
    reworkRefs: [...new Set(records.map(record => record.reworkId).filter(Boolean))],
  };
}

export class ReworkAuditLedger {
  static async open({ io, path, runId, clock = Date.now, idFactory = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}` } = {}) {
    if (!io || typeof io.read !== 'function' || typeof io.write !== 'function' || typeof io.exists !== 'function') throw new Error('Rework Audit IO 不完整');
    const target = asString(path, 1400);
    const id = asString(runId, 240);
    if (!target || !id) throw new Error('Rework Audit 缺 path/runId');
    let records = [];
    let corruptTail = '';
    if (await io.exists(target)) {
      const parsed = parseReworkAuditLog(await io.read(target), { runId: id });
      records = parsed.records;
      corruptTail = parsed.corruptTail;
    } else await io.write(target, '');
    const ledger = new ReworkAuditLedger({ io, path: target, runId: id, clock, idFactory, records });
    if (corruptTail) {
      const tailPath = target.replace(/findings\.ndjson$/i, 'findings-corrupt-tail.txt');
      await io.write(tailPath, corruptTail);
      await io.write(target, ledger._text());
      await ledger.appendBatch([{
        recordId: `audit-recovery:${id}:${ledger.state.sequence + 1}`, type: 'audit-recovery-required',
        actorRef: 'factory:audit-recovery', authorityRef: 'human:required', reasonCode: 'CORRUPT_AUDIT_TAIL',
        message: '审计账尾损坏已隔离；未结旗语保留，须人工检查后继续',
        evidenceRefs: [{ kind: 'evidence', path: tailPath, type: 'text/plain', role: 'corrupt-audit-tail' }],
      }], { allowRecoveryRecord: true });
    }
    return ledger;
  }

  constructor({ io, path, runId, clock, idFactory, records }) {
    this.io = io;
    this.path = path;
    this.runId = runId;
    this.clock = clock;
    this.idFactory = idFactory;
    this.records = records;
    this.state = replayReworkAudit(records, { runId });
    this.queue = Promise.resolve();
    this.activeWrites = 0;
    this.disposed = false;
  }

  _text(records = this.records) {
    return records.length ? records.map(record => JSON.stringify(record)).join('\n') + '\n' : '';
  }

  appendBatch(inputs = [], { allowRecoveryRecord = false } = {}) {
    if (this.disposed) return Promise.reject(new Error('Rework Audit Ledger 已释放'));
    const operation = this.queue.then(async () => {
      if (this.state.recoveryRequired && !allowRecoveryRecord) throw new Error('Rework Audit 处于恢复阻断态');
      this.activeWrites += 1;
      try {
        let records = [...this.records];
        let state = this.state;
        for (const input of list(inputs)) {
          const existing = records.find(record => record.recordId === input.recordId);
          if (existing) {
            const candidate = normalizeReworkAuditRecord(input, { runId: this.runId, sequence: existing.sequence, occurredAt: existing.occurredAt, recordId: existing.recordId });
            if (semanticRecord(existing) !== semanticRecord(candidate)) throw new Error(`Rework Audit 幂等键冲突：${input.recordId}`);
            continue;
          }
          const record = normalizeReworkAuditRecord(input, {
            runId: this.runId,
            sequence: records.length + 1,
            occurredAt: isoNow(this.clock),
            recordId: input.recordId || `${this.runId}:audit:${records.length + 1}:${this.idFactory()}`,
          });
          records.push(record);
          state = replayReworkAudit(records, { runId: this.runId });
        }
        await this.io.write(this.path, this._text(records));
        this.records = records;
        this.state = state;
        return this.healthSnapshot();
      } finally {
        this.activeWrites -= 1;
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  healthSnapshot() {
    return Object.freeze({
      runId: this.runId, records: this.records.length, findings: this.state.findings.size,
      unresolvedFindings: this.state.unresolvedFindingIds.length, reworks: this.state.reworks.size,
      escalations: this.state.escalations.length, recoveryRequired: this.state.recoveryRequired,
      activeWrites: this.activeWrites, disposed: this.disposed,
    });
  }

  async dispose() {
    if (this.disposed) return this.healthSnapshot();
    await this.queue;
    this.disposed = true;
    return this.healthSnapshot();
  }
}

export const openReworkAuditLedger = options => ReworkAuditLedger.open(options);
