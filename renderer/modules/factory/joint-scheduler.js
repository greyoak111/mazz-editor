// W73e Joint Scheduler / Elastic Staffing v0：只做可解释提议、人工决定与 dispatch 旁路记账。
// 不执行 Provider/Harness，不取得 W68 task pool、W73f KPI 或 Router 所有权。

export const SCHEDULER_REQUEST_SCHEMA = 'mazz.scheduler-request/v0';
export const SCHEDULER_PROPOSAL_SCHEMA = 'mazz.scheduler-proposal/v0';
export const SCHEDULER_RECORD_SCHEMA = 'mazz.scheduler-record/v0';

export const SCHEDULER_RECORD_TYPES = Object.freeze([
  'schedule-proposed', 'schedule-decided', 'dispatch-started',
  'dispatch-rejected', 'dispatch-released', 'recovery-acknowledged',
]);

const HEALTH_STATES = Object.freeze(['unknown', 'available', 'degraded', 'unavailable']);
const RISK_LEVELS = Object.freeze(['low', 'normal', 'high', 'critical']);
const COST_STATES = Object.freeze(['estimated', 'bounded', 'unknown']);
const LATENCY_STATES = Object.freeze(['estimated', 'observed', 'unknown']);
const SECRET_KEYS = new Set([
  'apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken', 'credential', 'cookie', 'environment', 'env',
]);
const REQUEST_KEYS = new Set([
  'schema', 'requestId', 'runId', 'taskRef', 'seatRequirement', 'capabilityRequirements',
  'qualificationRequired', 'budget', 'priority', 'backpressure', 'risk', 'manualLock',
  'candidates', 'evidenceWindow', 'requestedAt',
]);
const CANDIDATE_KEYS = new Set([
  'candidateId', 'executorRef', 'seatRefs', 'capabilityProviders', 'certificateRef',
  'qualification', 'health', 'estimatedCost', 'estimatedLatency', 'backpressure',
  'risk', 'providerRef', 'modelRef', 'evidenceRefs', 'confidence',
]);
const CAPABILITY_PROVIDER_KEYS = new Set([
  'schema', 'capabilityId', 'providerId', 'displayName', 'inputTypes', 'outputTypes',
  'agentUsable', 'execution', 'cost', 'health', 'provenance',
]);
const RECORD_KEYS = new Set([
  'schema', 'recordId', 'type', 'sequence', 'occurredAt', 'runId', 'proposalId',
  'request', 'proposal', 'decision', 'dispatchId', 'candidateId', 'outcome',
  'reasonCode', 'message', 'authorityRef', 'evidenceRefs',
]);

const asString = (value, max = 600) => String(value ?? '').trim().slice(0, max);
const asArray = value => Array.isArray(value) ? value : [];
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const stringList = (value, max = 400) => [...new Set(asArray(value).map(item => asString(item, max)).filter(Boolean))];
const clampInt = (value, min, max, fallback = min) => {
  const numeric = Number(value);
  return Math.max(min, Math.min(max, Math.trunc(Number.isFinite(numeric) ? numeric : fallback)));
};
const isoNow = clock => new Date(clock()).toISOString();
const riskRank = value => Math.max(0, RISK_LEVELS.indexOf(value));

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
    if (SECRET_KEYS.has(canonical)) throw new Error(`Scheduler 禁止 secret 字段：${trail ? trail + '.' : ''}${key}`);
    rejectSecrets(item, trail ? `${trail}.${key}` : key);
  }
}

function normalizeHealth(value = {}) {
  rejectUnknown(value, new Set(['status', 'checkedAt', 'reason']), 'health');
  const status = asString(value.status || 'unknown', 40);
  if (!HEALTH_STATES.includes(status)) throw new Error(`非法 health.status：${status}`);
  return Object.freeze({ status, checkedAt: asString(value.checkedAt, 80), reason: asString(value.reason, 600) });
}

export function normalizeCapabilityProviderSnapshot(value = {}) {
  rejectSecrets(value);
  rejectUnknown(value, CAPABILITY_PROVIDER_KEYS, 'Capability Provider snapshot');
  if (value.schema !== 'mazz.capability-provider/v0') throw new Error(`Scheduler 只接受 W72 Capability Provider v0：${value.schema || '空'}`);
  rejectUnknown(value.execution || {}, new Set(['mode']), 'Capability execution');
  rejectUnknown(value.cost || {}, new Set(['type', 'note']), 'Capability cost');
  const executionMode = asString(value.execution?.mode, 40);
  const costType = asString(value.cost?.type, 40);
  if (!['embedded', 'cli', 'service', 'external'].includes(executionMode)) throw new Error(`非法 execution.mode：${executionMode}`);
  if (!['local', 'api'].includes(costType)) throw new Error(`非法 cost.type：${costType}`);
  if (typeof value.agentUsable !== 'boolean') throw new Error('Capability Provider agentUsable 必须是布尔值');
  const capabilityId = asString(value.capabilityId, 240);
  const providerId = asString(value.providerId, 240);
  if (!capabilityId || !providerId) throw new Error('Capability Provider 缺 capabilityId/providerId');
  return Object.freeze({
    schema: 'mazz.capability-provider/v0', capabilityId, providerId,
    displayName: asString(value.displayName || providerId, 300),
    inputTypes: stringList(value.inputTypes, 160), outputTypes: stringList(value.outputTypes, 160),
    agentUsable: value.agentUsable, execution: { mode: executionMode },
    cost: { type: costType, note: asString(value.cost?.note, 400) },
    health: normalizeHealth(value.health || { status: 'unknown' }),
    provenance: plainObject(value.provenance) ? structuredClone(value.provenance) : {},
  });
}

function normalizeQualification(value = {}) {
  rejectUnknown(value, new Set(['restricted', 'ok', 'code', 'evidenceRef']), 'qualification');
  return Object.freeze({
    restricted: value.restricted === true, ok: value.ok === true,
    code: asString(value.code || (value.ok ? 'QUALIFIED' : 'QUALIFICATION_UNKNOWN'), 160),
    evidenceRef: asString(value.evidenceRef, 800),
  });
}

function normalizeEstimate(value = {}, kind = 'cost') {
  const cost = kind === 'cost';
  rejectUnknown(value, new Set(cost ? ['status', 'tokens', 'currency', 'amount', 'sourceRef'] : ['status', 'ms', 'sourceRef']), cost ? 'estimatedCost' : 'estimatedLatency');
  const status = asString(value.status || 'unknown', 40);
  if (!(cost ? COST_STATES : LATENCY_STATES).includes(status)) throw new Error(`非法 ${kind} estimate status：${status}`);
  return Object.freeze(cost ? {
    status, tokens: Math.max(0, Number(value.tokens) || 0), currency: asString(value.currency, 20),
    amount: Math.max(0, Number(value.amount) || 0), sourceRef: asString(value.sourceRef, 800),
  } : { status, ms: Math.max(0, Number(value.ms) || 0), sourceRef: asString(value.sourceRef, 800) });
}

function normalizeBackpressure(value = {}) {
  rejectUnknown(value, new Set(['active', 'maxActive', 'queued']), 'backpressure');
  return Object.freeze({
    active: Math.max(0, Math.trunc(Number(value.active) || 0)),
    maxActive: clampInt(value.maxActive, 1, 1024, 1),
    queued: Math.max(0, Math.trunc(Number(value.queued) || 0)),
  });
}

function normalizeRisk(value = {}, label = 'risk') {
  rejectUnknown(value, new Set(['level', 'maxLevel', 'reason', 'evidenceRef']), label);
  const level = asString(value.level || value.maxLevel || 'normal', 40);
  if (!RISK_LEVELS.includes(level)) throw new Error(`非法 risk level：${level}`);
  return Object.freeze({
    ...(value.maxLevel ? { maxLevel: level } : { level }),
    reason: asString(value.reason, 600), evidenceRef: asString(value.evidenceRef, 800),
  });
}

export function normalizeSchedulerCandidate(value = {}) {
  rejectSecrets(value);
  rejectUnknown(value, CANDIDATE_KEYS, 'Scheduler candidate');
  const candidateId = asString(value.candidateId, 240);
  const executorRef = asString(value.executorRef, 240);
  if (!candidateId || !executorRef) throw new Error('Scheduler candidate 缺 candidateId/executorRef');
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('Scheduler candidate confidence 应为 0–1');
  return Object.freeze({
    candidateId, executorRef, seatRefs: stringList(value.seatRefs, 240),
    capabilityProviders: asArray(value.capabilityProviders).map(normalizeCapabilityProviderSnapshot),
    certificateRef: asString(value.certificateRef, 360), qualification: normalizeQualification(value.qualification || {}),
    health: normalizeHealth(value.health || { status: 'unknown' }),
    estimatedCost: normalizeEstimate(value.estimatedCost || {}, 'cost'),
    estimatedLatency: normalizeEstimate(value.estimatedLatency || {}, 'latency'),
    backpressure: normalizeBackpressure(value.backpressure || {}), risk: normalizeRisk(value.risk || {}, 'candidate risk'),
    providerRef: asString(value.providerRef, 240), modelRef: asString(value.modelRef, 300),
    evidenceRefs: stringList(value.evidenceRefs, 800), confidence,
  });
}

export function normalizeSchedulerRequest(value = {}) {
  rejectSecrets(value);
  rejectUnknown(value, REQUEST_KEYS, 'Scheduler request');
  if (value.schema != null && value.schema !== SCHEDULER_REQUEST_SCHEMA) throw new Error(`未知 Scheduler request schema：${value.schema}`);
  const requestId = asString(value.requestId, 260);
  const runId = asString(value.runId, 240);
  const taskRef = asString(value.taskRef, 360);
  if (!requestId || !runId || !taskRef) throw new Error('Scheduler request 缺 requestId/runId/taskRef');
  rejectUnknown(value.budget || {}, new Set(['remainingTokens', 'currency', 'amount']), 'budget');
  rejectUnknown(value.manualLock || {}, new Set(['candidateId', 'executorRef', 'bannedProviderRefs']), 'manualLock');
  rejectUnknown(value.evidenceWindow || {}, new Set(['from', 'to', 'refs']), 'evidenceWindow');
  const requestedAt = asString(value.requestedAt, 80);
  if (!requestedAt || !Number.isFinite(Date.parse(requestedAt))) throw new Error('Scheduler request requestedAt 必须是 ISO 时间');
  const from = asString(value.evidenceWindow?.from || requestedAt, 80);
  const to = asString(value.evidenceWindow?.to || requestedAt, 80);
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(to) < Date.parse(from)) throw new Error('Scheduler evidenceWindow 非法');
  return Object.freeze({
    schema: SCHEDULER_REQUEST_SCHEMA, requestId, runId, taskRef,
    seatRequirement: asString(value.seatRequirement, 240),
    capabilityRequirements: stringList(value.capabilityRequirements, 240),
    qualificationRequired: value.qualificationRequired === true,
    budget: {
      remainingTokens: Math.max(0, Number(value.budget?.remainingTokens) || 0),
      currency: asString(value.budget?.currency, 20), amount: Math.max(0, Number(value.budget?.amount) || 0),
    },
    priority: clampInt(value.priority, 0, 100, 50),
    backpressure: normalizeBackpressure(value.backpressure || {}),
    risk: normalizeRisk({ maxLevel: value.risk?.maxLevel || 'normal', reason: value.risk?.reason, evidenceRef: value.risk?.evidenceRef }, 'request risk'),
    manualLock: {
      candidateId: asString(value.manualLock?.candidateId, 240), executorRef: asString(value.manualLock?.executorRef, 240),
      bannedProviderRefs: stringList(value.manualLock?.bannedProviderRefs, 240),
    },
    candidates: asArray(value.candidates).map(normalizeSchedulerCandidate),
    evidenceWindow: { from, to, refs: stringList(value.evidenceWindow?.refs, 800) }, requestedAt,
  });
}

function candidateView(candidate, routeReasons = []) {
  return Object.freeze({
    candidateId: candidate.candidateId, executorRef: candidate.executorRef, providerRef: candidate.providerRef,
    modelRef: candidate.modelRef, certificateRef: candidate.certificateRef,
    capabilityProviderRefs: candidate.capabilityProviders.map(row => `${row.capabilityId}@${row.providerId}`),
    health: candidate.health, estimatedCost: candidate.estimatedCost, estimatedLatency: candidate.estimatedLatency,
    backpressure: candidate.backpressure, risk: candidate.risk, confidence: candidate.confidence,
    evidenceRefs: candidate.evidenceRefs, routeReasons,
  });
}

function exclusion(code, message, refs = []) {
  return Object.freeze({ code, message, evidenceRefs: stringList(refs, 800) });
}

function evaluateCandidate(request, candidate) {
  const reasons = [];
  const excluded = [];
  const lock = request.manualLock;
  if (lock.candidateId && candidate.candidateId !== lock.candidateId) excluded.push(exclusion('MANUAL_CANDIDATE_LOCK', `已锁定候选 ${lock.candidateId}`));
  if (lock.executorRef && candidate.executorRef !== lock.executorRef) excluded.push(exclusion('MANUAL_EXECUTOR_LOCK', `已锁定执行器 ${lock.executorRef}`));
  if (candidate.providerRef && lock.bannedProviderRefs.includes(candidate.providerRef)) excluded.push(exclusion('PROVIDER_BANNED', `Provider 已禁用：${candidate.providerRef}`));
  if (request.seatRequirement && !candidate.seatRefs.includes(request.seatRequirement)) excluded.push(exclusion('SEAT_MISMATCH', `不满足 Seat：${request.seatRequirement}`));
  else if (request.seatRequirement) reasons.push(`SEAT_MATCH:${request.seatRequirement}`);
  const healthyCapabilities = new Set(candidate.capabilityProviders.filter(row => ['available', 'degraded'].includes(row.health.status)).map(row => row.capabilityId));
  const missing = request.capabilityRequirements.filter(ref => !healthyCapabilities.has(ref));
  if (missing.length) excluded.push(exclusion('CAPABILITY_MISSING', `缺少健康 Capability：${missing.join(', ')}`));
  else if (request.capabilityRequirements.length) reasons.push(`CAPABILITY_MATCH:${request.capabilityRequirements.join(',')}`);
  if (request.qualificationRequired && !candidate.qualification.ok) excluded.push(exclusion(candidate.qualification.code || 'QUALIFICATION_REQUIRED', '资格门禁未通过', [candidate.qualification.evidenceRef]));
  else reasons.push(request.qualificationRequired ? 'QUALIFICATION_VERIFIED' : 'QUALIFICATION_UNRESTRICTED');
  if (!['available', 'degraded'].includes(candidate.health.status)) excluded.push(exclusion(`HEALTH_${candidate.health.status.toUpperCase()}`, `执行器健康状态：${candidate.health.status}`, [candidate.health.reason]));
  else reasons.push(`HEALTH_${candidate.health.status.toUpperCase()}`);
  if (candidate.backpressure.active >= candidate.backpressure.maxActive) excluded.push(exclusion('EXECUTOR_BACKPRESSURE', '执行器已达并发上限'));
  else reasons.push(`CAPACITY:${candidate.backpressure.active}/${candidate.backpressure.maxActive}`);
  if (request.backpressure.active >= request.backpressure.maxActive) excluded.push(exclusion('POOL_BACKPRESSURE', 'Factory worker pool 已达并发上限'));
  // Token 数只作供应商成本观测，不参与候选排除。上下文与输出能力由 Provider 自己负责。
  reasons.push(candidate.estimatedCost.status === 'unknown' ? 'COST_UNKNOWN' : 'COST_RECORDED_NOT_GATED');
  if (riskRank(candidate.risk.level) > riskRank(request.risk.maxLevel)) excluded.push(exclusion('RISK_EXCEEDS_LIMIT', `风险 ${candidate.risk.level} 超过上限 ${request.risk.maxLevel}`, [candidate.risk.evidenceRef]));
  else reasons.push(`RISK_WITHIN_LIMIT:${candidate.risk.level}`);
  return { candidate, reasons, excluded };
}

function compareCandidates(left, right) {
  const health = { available: 0, degraded: 1, unknown: 2, unavailable: 3 };
  const a = left.candidate; const b = right.candidate;
  const values = [
    (health[a.health.status] || 0) - (health[b.health.status] || 0),
    riskRank(a.risk.level) - riskRank(b.risk.level),
    (a.backpressure.active / a.backpressure.maxActive) - (b.backpressure.active / b.backpressure.maxActive),
    (a.estimatedLatency.status === 'unknown' ? 1 : 0) - (b.estimatedLatency.status === 'unknown' ? 1 : 0),
    a.estimatedLatency.ms - b.estimatedLatency.ms,
    b.confidence - a.confidence,
  ];
  return values.find(value => value !== 0) || a.candidateId.localeCompare(b.candidateId);
}

export function createScheduleProposal(rawRequest = {}) {
  const request = normalizeSchedulerRequest(rawRequest);
  const evaluated = request.candidates.map(candidate => evaluateCandidate(request, candidate));
  const included = evaluated.filter(row => !row.excluded.length).sort(compareCandidates);
  const excluded = evaluated.filter(row => row.excluded.length).map(row => Object.freeze({
    candidate: candidateView(row.candidate), reasons: row.excluded,
  })).sort((a, b) => a.candidate.candidateId.localeCompare(b.candidate.candidateId));
  const candidates = included.map(row => candidateView(row.candidate, row.reasons));
  const recommended = candidates[0] || null;
  const onlyBackpressure = !candidates.length && excluded.length > 0 && excluded.every(row => row.reasons.every(reason => /BACKPRESSURE$/.test(reason.code)));
  const status = recommended ? 'ready' : 'blocked';
  return Object.freeze({
    schema: SCHEDULER_PROPOSAL_SCHEMA, proposalId: `proposal:${request.requestId}`,
    requestId: request.requestId, runId: request.runId, taskRef: request.taskRef, status,
    reasonCode: recommended ? 'CANDIDATE_RECOMMENDED' : (onlyBackpressure ? 'BACKPRESSURE' : 'NO_QUALIFIED_EXECUTOR'),
    candidates, exclusions: excluded,
    recommendedCandidateId: recommended?.candidateId || '',
    alternateCandidateIds: candidates.slice(1).map(row => row.candidateId),
    evidenceWindow: request.evidenceWindow,
    estimatedCost: recommended?.estimatedCost || normalizeEstimate({}, 'cost'),
    estimatedLatency: recommended?.estimatedLatency || normalizeEstimate({}, 'latency'),
    confidence: recommended?.confidence ?? 0,
    userOptions: Object.freeze({ canSelectAlternate: candidates.length > 1, canChangeBudget: true, canBanProvider: true, canLockExecutor: true }),
    createdAt: request.requestedAt,
  });
}

export function finalizeSchedule(proposal, decision = {}) {
  rejectSecrets(decision);
  rejectUnknown(decision, new Set(['authorityRef', 'selectedCandidateId', 'overrideReason', 'decidedAt']), 'Schedule decision');
  if (!plainObject(proposal) || proposal.schema !== SCHEDULER_PROPOSAL_SCHEMA) throw new Error('Schedule decision 缺合法 proposal');
  const authorityRef = asString(decision.authorityRef, 240);
  if (!authorityRef.startsWith('human:')) throw new Error('Schedule final decision 必须由 human Authority 作出');
  const decidedAt = asString(decision.decidedAt || proposal.createdAt, 80);
  if (proposal.status === 'blocked') return Object.freeze({
    status: 'blocked', selectedCandidateId: '', authorityRef, override: false, overrideReason: '',
    reasonCode: proposal.reasonCode, decidedAt,
  });
  const explicitCandidateId = asString(decision.selectedCandidateId, 240);
  if (proposal.candidates.length > 1 && !explicitCandidateId) throw new Error('多个可用候选必须由人类显式选择；AUTO 只能提议');
  const selectedCandidateId = explicitCandidateId || proposal.recommendedCandidateId;
  if (!proposal.candidates.some(row => row.candidateId === selectedCandidateId)) throw new Error(`最终候选不在可用集合：${selectedCandidateId}`);
  const override = selectedCandidateId !== proposal.recommendedCandidateId;
  const overrideReason = asString(decision.overrideReason, 600);
  if (override && !overrideReason) throw new Error('选择备选时必须记录人工覆盖理由');
  return Object.freeze({
    status: 'selected', selectedCandidateId, authorityRef, override, overrideReason,
    reasonCode: override ? 'HUMAN_ALTERNATE_SELECTED' : 'HUMAN_ACCEPTED_RECOMMENDATION', decidedAt,
  });
}

function normalizeFinalDecision(value = {}) {
  rejectSecrets(value);
  rejectUnknown(value, new Set(['status', 'selectedCandidateId', 'authorityRef', 'override', 'overrideReason', 'reasonCode', 'decidedAt']), 'Schedule final decision');
  const status = asString(value.status, 40);
  const authorityRef = asString(value.authorityRef, 240);
  const decidedAt = asString(value.decidedAt, 80);
  if (!['selected', 'blocked'].includes(status)) throw new Error(`非法 Schedule decision status：${status}`);
  if (!authorityRef.startsWith('human:')) throw new Error('Schedule final decision 必须由 human Authority 作出');
  if (!Number.isFinite(Date.parse(decidedAt))) throw new Error('Schedule decision decidedAt 非法');
  const selectedCandidateId = asString(value.selectedCandidateId, 240);
  if (status === 'selected' && !selectedCandidateId) throw new Error('selected decision 缺 selectedCandidateId');
  if (status === 'blocked' && selectedCandidateId) throw new Error('blocked decision 不得携带 selectedCandidateId');
  return Object.freeze({
    status, selectedCandidateId, authorityRef, override: value.override === true,
    overrideReason: asString(value.overrideReason, 600), reasonCode: asString(value.reasonCode, 160), decidedAt,
  });
}

export function normalizeSchedulerRecord(value = {}, context = {}) {
  rejectSecrets(value);
  rejectUnknown(value, RECORD_KEYS, 'Scheduler record');
  const type = asString(value.type, 120);
  if (!SCHEDULER_RECORD_TYPES.includes(type)) throw new Error(`非法 Scheduler record type：${type || '空'}`);
  const record = {
    schema: SCHEDULER_RECORD_SCHEMA, recordId: asString(value.recordId || context.recordId, 320), type,
    sequence: Math.max(1, Number(value.sequence || context.sequence) || 0),
    occurredAt: asString(value.occurredAt || context.occurredAt, 80), runId: asString(value.runId || context.runId, 240),
    proposalId: asString(value.proposalId, 320), request: value.request ? normalizeSchedulerRequest(value.request) : null,
    proposal: value.proposal || null, decision: value.decision ? normalizeFinalDecision(value.decision) : null,
    dispatchId: asString(value.dispatchId, 320), candidateId: asString(value.candidateId, 240),
    outcome: asString(value.outcome, 120), reasonCode: asString(value.reasonCode, 160),
    message: asString(value.message, 1000), authorityRef: asString(value.authorityRef, 240),
    evidenceRefs: stringList(value.evidenceRefs, 800),
  };
  if (!record.recordId || !record.occurredAt || !record.runId) throw new Error('Scheduler record 缺 recordId/occurredAt/runId');
  if (!Number.isFinite(Date.parse(record.occurredAt))) throw new Error('Scheduler record occurredAt 非法');
  if (type === 'schedule-proposed') {
    if (!record.request || !plainObject(record.proposal) || record.proposal.schema !== SCHEDULER_PROPOSAL_SCHEMA) throw new Error('schedule-proposed 缺 request/proposal');
    if (record.proposalId !== record.proposal.proposalId || record.runId !== record.request.runId) throw new Error('schedule-proposed 身份不一致');
    const canonical = createScheduleProposal(record.request);
    if (JSON.stringify(canonical) !== JSON.stringify(record.proposal)) throw new Error('schedule-proposed 不是 request 的确定性结果');
  }
  if (type === 'schedule-decided') {
    if (!record.proposalId || !plainObject(record.decision) || !record.decision.authorityRef?.startsWith?.('human:')) throw new Error('schedule-decided 缺人类决定');
  }
  if (type === 'dispatch-started' && (!record.proposalId || !record.dispatchId || !record.candidateId)) throw new Error('dispatch-started 身份不完整');
  if (type === 'dispatch-rejected' && (!record.proposalId || !record.dispatchId || !record.reasonCode)) throw new Error('dispatch-rejected 身份不完整');
  if (type === 'dispatch-released' && (!record.dispatchId || !record.outcome)) throw new Error('dispatch-released 缺 dispatchId/outcome');
  if (type === 'recovery-acknowledged' && (!record.authorityRef.startsWith('human:') || !record.evidenceRefs.length)) throw new Error('恢复确认必须有 human Authority 与 evidence');
  return Object.freeze(record);
}

export function parseSchedulerLog(text, { runId = '' } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const records = [];
  let corruptTail = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const record = normalizeSchedulerRecord(JSON.parse(line));
      if (runId && record.runId !== runId) throw new Error('runId 不匹配');
      if (record.sequence !== records.length + 1) throw new Error('sequence 不连续');
      records.push(record);
    } catch (error) {
      if (lines.slice(index + 1).some(item => item.trim())) throw new Error(`Scheduler 中段损坏（第 ${index + 1} 行）：${error.message}`);
      corruptTail = line;
      break;
    }
  }
  return { records, corruptTail };
}

export function replaySchedulerRecords(values = []) {
  const recordIds = new Set(); const proposals = new Map(); const dispatches = new Map();
  let sequence = 0;
  for (const value of values) {
    const record = normalizeSchedulerRecord(value);
    if (record.sequence !== sequence + 1) throw new Error(`Scheduler sequence 不连续：${sequence}→${record.sequence}`);
    if (recordIds.has(record.recordId)) throw new Error(`Scheduler recordId 重复：${record.recordId}`);
    recordIds.add(record.recordId); sequence = record.sequence;
    if (record.type === 'schedule-proposed') {
      if (proposals.has(record.proposalId)) throw new Error(`Scheduler proposal 重复：${record.proposalId}`);
      proposals.set(record.proposalId, { request: record.request, proposal: record.proposal, decision: null });
    } else if (record.type === 'schedule-decided') {
      const row = proposals.get(record.proposalId);
      if (!row || row.decision) throw new Error(`Scheduler decision 引用非法 proposal：${record.proposalId}`);
      const expected = finalizeSchedule(row.proposal, {
        authorityRef: record.decision.authorityRef, selectedCandidateId: record.decision.selectedCandidateId,
        overrideReason: record.decision.overrideReason, decidedAt: record.decision.decidedAt,
      });
      if (JSON.stringify(expected) !== JSON.stringify(record.decision)) throw new Error('Scheduler decision 与 proposal 不一致');
      row.decision = record.decision;
    } else if (record.type === 'dispatch-started') {
      const row = proposals.get(record.proposalId);
      if (!row?.decision || row.decision.status !== 'selected' || row.decision.selectedCandidateId !== record.candidateId) throw new Error('dispatch-started 未引用已决定候选');
      if (dispatches.has(record.dispatchId)) throw new Error(`Scheduler dispatch 重复：${record.dispatchId}`);
      dispatches.set(record.dispatchId, { ...record, status: 'active' });
    } else if (record.type === 'dispatch-rejected') {
      if (!proposals.has(record.proposalId)) throw new Error('dispatch-rejected 引用未知 proposal');
    } else if (record.type === 'dispatch-released') {
      const active = dispatches.get(record.dispatchId);
      if (!active || active.status !== 'active') throw new Error(`释放不存在的 active dispatch：${record.dispatchId}`);
      dispatches.set(record.dispatchId, { ...active, status: 'released', outcome: record.outcome, releasedAt: record.occurredAt });
    }
  }
  return { sequence, recordIds, proposals, dispatches };
}

function semanticRecord(record) {
  const { sequence, occurredAt, ...rest } = record;
  return JSON.stringify(rest);
}

export class ScheduleLedger {
  static async open({ io, path, runId, clock = Date.now, idFactory = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}` } = {}) {
    for (const name of ['exists', 'read', 'write']) if (typeof io?.[name] !== 'function') throw new Error(`ScheduleLedger IO 缺 ${name}`);
    if (!asString(path, 1600) || !asString(runId, 240)) throw new Error('ScheduleLedger 缺 path/runId');
    if (!(await io.exists(path))) await io.write(path, '');
    const parsed = parseSchedulerLog(await io.read(path), { runId });
    if (parsed.corruptTail) {
      await io.write(`${path}.corrupt-tail.txt`, parsed.corruptTail);
      await io.write(path, parsed.records.map(row => JSON.stringify(row)).join('\n') + (parsed.records.length ? '\n' : ''));
    }
    const ledger = new ScheduleLedger({ io, path, runId, clock, idFactory, records: parsed.records });
    ledger.corruptTail = parsed.corruptTail;
    ledger.orphanDispatchIds = new Set([...ledger.state.dispatches.values()].filter(row => row.status === 'active').map(row => row.dispatchId));
    ledger.recoveryRequired = !!parsed.corruptTail || ledger.orphanDispatchIds.size > 0;
    return ledger;
  }

  constructor({ io, path, runId, clock, idFactory, records }) {
    this.io = io; this.path = path; this.runId = runId; this.clock = clock; this.idFactory = idFactory;
    this.records = records; this.state = replaySchedulerRecords(records); this.queue = Promise.resolve();
    this.activeWrites = 0; this.disposed = false; this.recoveryRequired = false; this.corruptTail = ''; this.orphanDispatchIds = new Set();
  }

  _text(records = this.records) { return records.map(row => JSON.stringify(row)).join('\n') + (records.length ? '\n' : ''); }

  async _appendBatch(values, { allowRecovery = false } = {}) {
    if (this.disposed) throw new Error('ScheduleLedger 已释放');
    if (this.recoveryRequired && !allowRecovery) throw new Error('ScheduleLedger 处于恢复阻断态');
    const operation = this.queue.then(async () => {
      this.activeWrites++;
      try {
        let nextRecords = [...this.records]; let nextState = this.state;
        for (const input of values) {
          const existing = nextRecords.find(row => row.recordId === input.recordId);
          const candidate = normalizeSchedulerRecord(input, {
            sequence: existing?.sequence || nextRecords.length + 1,
            occurredAt: existing?.occurredAt || isoNow(this.clock), runId: this.runId,
          });
          if (existing) {
            if (semanticRecord(existing) !== semanticRecord(candidate)) throw new Error(`W73e 幂等键冲突：${input.recordId}`);
            continue;
          }
          nextRecords.push(candidate); nextState = replaySchedulerRecords(nextRecords);
        }
        await this.io.write(this.path, this._text(nextRecords));
        this.records = nextRecords; this.state = nextState;
        return this.healthSnapshot();
      } finally { this.activeWrites--; }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  appendBatch(values = []) { return this._appendBatch(values); }

  async resolveRecovery({ authorityRef, evidenceRefs = [], reason = 'scheduler-recovery-reviewed' } = {}) {
    if (!asString(authorityRef, 240).startsWith('human:')) throw new Error('Scheduler 恢复必须由 human Authority 确认');
    if (!stringList(evidenceRefs, 800).length) throw new Error('Scheduler 恢复必须有 evidence');
    const records = [{
      recordId: `recovery:${this.runId}:${this.idFactory()}`, type: 'recovery-acknowledged',
      authorityRef, evidenceRefs, reasonCode: 'W73E_RECOVERY_ACKNOWLEDGED', message: reason,
    }];
    for (const dispatchId of this.orphanDispatchIds) records.push({
      recordId: `${dispatchId}:recovered-release`, type: 'dispatch-released', dispatchId,
      outcome: 'recovered-abandoned', reasonCode: 'ORPHAN_DISPATCH_ABANDONED', authorityRef, evidenceRefs,
    });
    await this._appendBatch(records, { allowRecovery: true });
    this.orphanDispatchIds.clear(); this.corruptTail = ''; this.recoveryRequired = false;
    return this.healthSnapshot();
  }

  healthSnapshot() {
    return Object.freeze({
      runId: this.runId, records: this.records.length, proposals: this.state.proposals.size,
      activeDispatches: [...this.state.dispatches.values()].filter(row => row.status === 'active').length,
      orphanDispatches: this.orphanDispatchIds.size, recoveryRequired: this.recoveryRequired,
      activeWrites: this.activeWrites, disposed: this.disposed,
    });
  }

  async dispose() {
    if (this.disposed) return this.healthSnapshot();
    await this.queue; this.disposed = true;
    return this.healthSnapshot();
  }
}

export class ElasticStaffingCoordinator {
  constructor({ capacity = 1 } = {}) { this.capacity = clampInt(capacity, 1, 4, 1); this.leases = new Map(); this.disposed = false; }
  setCapacity(value) { this.capacity = clampInt(value, 1, 4, 1); return this.healthSnapshot(); }
  acquire({ dispatchId, candidateId, taskRef = '' } = {}) {
    if (this.disposed) throw new Error('ElasticStaffingCoordinator 已释放');
    const id = asString(dispatchId, 320);
    if (!id || !asString(candidateId, 240)) throw new Error('Staffing lease 缺 dispatchId/candidateId');
    if (this.leases.has(id)) return Object.freeze({ ok: true, code: 'IDEMPOTENT', lease: this.leases.get(id) });
    if (this.leases.size >= this.capacity) return Object.freeze({ ok: false, code: 'BACKPRESSURE', message: 'BLOCKED: BACKPRESSURE' });
    const lease = Object.freeze({ dispatchId: id, candidateId: asString(candidateId, 240), taskRef: asString(taskRef, 360) });
    this.leases.set(id, lease);
    return Object.freeze({ ok: true, code: 'ACQUIRED', lease });
  }
  release(dispatchId, outcome = 'released') {
    const id = asString(dispatchId, 320); const lease = this.leases.get(id) || null;
    if (lease) this.leases.delete(id);
    return Object.freeze({ released: !!lease, dispatchId: id, outcome: asString(outcome, 120), health: this.healthSnapshot() });
  }
  cancel(dispatchId) { return this.release(dispatchId, 'cancelled'); }
  healthSnapshot() { return Object.freeze({ capacity: this.capacity, active: this.leases.size, available: Math.max(0, this.capacity - this.leases.size), overcommitted: this.leases.size > this.capacity, disposed: this.disposed }); }
  dispose() { const abandoned = [...this.leases.keys()]; this.leases.clear(); this.disposed = true; return Object.freeze({ ...this.healthSnapshot(), abandoned }); }
}

export const openScheduleLedger = options => ScheduleLedger.open(options);
