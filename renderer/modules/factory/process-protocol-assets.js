// W73g Director / Process Protocol Assets：可读、可 diff、可版本化；不执行、不调度、不持有 Run 真相。
import { normalizeProductionRunReference } from './production-run.js';

export const FACTORY_PROCESS_PROTOCOL_SCHEMA = 'mazz.factory-process-protocol/v0';
export const FACTORY_PROCESS_PROJECTION_SCHEMA = 'mazz.factory-process-protocol-projection/v0';
export const FACTORY_PROCESS_PROTOCOL_ASSET_TYPE = 'application/vnd.mazz.factory-process-protocol+json';
export const FACTORY_PROCESS_PROJECTION_ASSET_TYPE = 'application/vnd.mazz.factory-process-protocol-projection+json';
export const W72_ASSET_ENVELOPE_SCHEMA = 'mazz.asset-envelope/v0';
export const W68_FACTORY_PROCESS_PROTOCOL_ID = 'w68-governed-review';
export const W68_FACTORY_PROCESS_PROTOCOL_VERSION = '1.0.0';

const SECRET_KEYS = new Set([
  'apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken', 'credential', 'cookie',
]);
const PROTOCOL_KEYS = new Set([
  'schema', 'protocolId', 'version', 'title', 'status', 'domain', 'workflowRef', 'workflowVersion',
  'directorTable', 'handoffs', 'exceptions', 'artifactChain', 'gateRecoveryProjection', 'provenance',
]);
const DIRECTOR_KEYS = new Set([
  'stageId', 'label', 'directorRef', 'responsibility', 'authorityScope', 'inputArtifactRoles',
  'outputArtifactRoles', 'gateRefs', 'exceptionRefs',
]);
const HANDOFF_KEYS = new Set([
  'handoffId', 'fromStage', 'toStage', 'trigger', 'requiredArtifactRoles', 'acceptanceGateRef',
  'rejectionTarget', 'evidenceRequired', 'authorityRef',
]);
const EXCEPTION_KEYS = new Set([
  'exceptionId', 'trigger', 'state', 'authorityRef', 'evidenceRequirements', 'recoveryPointId', 'automaticFallback',
]);
const ARTIFACT_KEYS = new Set([
  'role', 'type', 'producedBy', 'consumedBy', 'predecessorRoles', 'required', 'truthOwner',
]);
const GATE_RECOVERY_KEYS = new Set(['gates', 'recoveryPoints']);
const GATE_KEYS = new Set([
  'gateRef', 'label', 'stageId', 'inputArtifactRoles', 'passState', 'failState', 'authorityRef', 'recoveryPointId',
]);
const RECOVERY_KEYS = new Set([
  'recoveryPointId', 'triggeredBy', 'state', 'resumeStage', 'authorityRef', 'evidenceRequirements',
]);
const PROVENANCE_KEYS = new Set(['source', 'protocol', 'owner', 'boundary']);
const PROJECTION_KEYS = new Set([
  'schema', 'projectionId', 'version', 'protocolRef', 'runRef', 'artifactRefs', 'gateRefs', 'findingRefs',
  'reworkRefs', 'recovery', 'projectedAt', 'provenance',
]);
const PROTOCOL_REF_KEYS = new Set(['id', 'version', 'path', 'envelopePath']);
const RUN_REF_KEYS = new Set(['runId', 'taskId', 'projectId', 'path', 'status', 'sequence']);
const RECOVERY_STATE_KEYS = new Set(['required', 'reasonCode', 'evidenceRef']);

const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 800) => String(value ?? '').trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];
const stringList = (value, label, { allowEmpty = true } = {}) => {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const rows = value.map((item, index) => {
    const normalized = text(item, 300);
    if (!normalized) throw new Error(`${label}[${index}] 必填`);
    return normalized;
  });
  if (!allowEmpty && !rows.length) throw new Error(`${label} 不得为空`);
  if (new Set(rows).size !== rows.length) throw new Error(`${label} 不能重复`);
  return rows;
};

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
    if (SECRET_KEYS.has(canonical)) throw new Error(`Process Protocol 禁止 secret 字段：${trail ? `${trail}.` : ''}${key}`);
    rejectSecrets(item, trail ? `${trail}.${key}` : key);
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function required(value, label, max = 800) {
  const normalized = text(value, max);
  if (!normalized) throw new Error(`${label} 必填`);
  return normalized;
}

function normalizeProvenance(value) {
  rejectUnknown(value, PROVENANCE_KEYS, 'provenance');
  const row = {
    source: required(value.source, 'provenance.source', 300),
    protocol: required(value.protocol, 'provenance.protocol', 120),
    owner: required(value.owner, 'provenance.owner', 160),
    boundary: required(value.boundary, 'provenance.boundary', 800),
  };
  return row;
}

function normalizeDirector(value, index) {
  rejectUnknown(value, DIRECTOR_KEYS, `directorTable[${index}]`);
  return {
    stageId: required(value.stageId, `directorTable[${index}].stageId`, 120),
    label: required(value.label, `directorTable[${index}].label`, 200),
    directorRef: required(value.directorRef, `directorTable[${index}].directorRef`, 240),
    responsibility: required(value.responsibility, `directorTable[${index}].responsibility`, 800),
    authorityScope: required(value.authorityScope, `directorTable[${index}].authorityScope`, 120),
    inputArtifactRoles: stringList(value.inputArtifactRoles, `directorTable[${index}].inputArtifactRoles`),
    outputArtifactRoles: stringList(value.outputArtifactRoles, `directorTable[${index}].outputArtifactRoles`),
    gateRefs: stringList(value.gateRefs, `directorTable[${index}].gateRefs`),
    exceptionRefs: stringList(value.exceptionRefs, `directorTable[${index}].exceptionRefs`),
  };
}

function normalizeHandoff(value, index) {
  rejectUnknown(value, HANDOFF_KEYS, `handoffs[${index}]`);
  return {
    handoffId: required(value.handoffId, `handoffs[${index}].handoffId`, 160),
    fromStage: required(value.fromStage, `handoffs[${index}].fromStage`, 120),
    toStage: required(value.toStage, `handoffs[${index}].toStage`, 120),
    trigger: required(value.trigger, `handoffs[${index}].trigger`, 300),
    requiredArtifactRoles: stringList(value.requiredArtifactRoles, `handoffs[${index}].requiredArtifactRoles`),
    acceptanceGateRef: text(value.acceptanceGateRef, 240),
    rejectionTarget: text(value.rejectionTarget, 120),
    evidenceRequired: value.evidenceRequired !== false,
    authorityRef: text(value.authorityRef, 240),
  };
}

function normalizeException(value, index) {
  rejectUnknown(value, EXCEPTION_KEYS, `exceptions[${index}]`);
  const automaticFallback = value.automaticFallback === true;
  if (automaticFallback) throw new Error(`exceptions[${index}] 不得启用 automaticFallback`);
  return {
    exceptionId: required(value.exceptionId, `exceptions[${index}].exceptionId`, 160),
    trigger: required(value.trigger, `exceptions[${index}].trigger`, 500),
    state: required(value.state, `exceptions[${index}].state`, 80),
    authorityRef: required(value.authorityRef, `exceptions[${index}].authorityRef`, 240),
    evidenceRequirements: stringList(value.evidenceRequirements, `exceptions[${index}].evidenceRequirements`, { allowEmpty: false }),
    recoveryPointId: required(value.recoveryPointId, `exceptions[${index}].recoveryPointId`, 160),
    automaticFallback: false,
  };
}

function normalizeArtifact(value, index) {
  rejectUnknown(value, ARTIFACT_KEYS, `artifactChain[${index}]`);
  return {
    role: required(value.role, `artifactChain[${index}].role`, 120),
    type: required(value.type, `artifactChain[${index}].type`, 200),
    producedBy: required(value.producedBy, `artifactChain[${index}].producedBy`, 120),
    consumedBy: stringList(value.consumedBy, `artifactChain[${index}].consumedBy`),
    predecessorRoles: stringList(value.predecessorRoles, `artifactChain[${index}].predecessorRoles`),
    required: value.required !== false,
    truthOwner: required(value.truthOwner, `artifactChain[${index}].truthOwner`, 160),
  };
}

function normalizeGate(value, index) {
  rejectUnknown(value, GATE_KEYS, `gateRecoveryProjection.gates[${index}]`);
  return {
    gateRef: required(value.gateRef, `gateRecoveryProjection.gates[${index}].gateRef`, 240),
    label: required(value.label, `gateRecoveryProjection.gates[${index}].label`, 200),
    stageId: required(value.stageId, `gateRecoveryProjection.gates[${index}].stageId`, 120),
    inputArtifactRoles: stringList(value.inputArtifactRoles, `gateRecoveryProjection.gates[${index}].inputArtifactRoles`, { allowEmpty: false }),
    passState: required(value.passState, `gateRecoveryProjection.gates[${index}].passState`, 120),
    failState: required(value.failState, `gateRecoveryProjection.gates[${index}].failState`, 120),
    authorityRef: required(value.authorityRef, `gateRecoveryProjection.gates[${index}].authorityRef`, 240),
    recoveryPointId: required(value.recoveryPointId, `gateRecoveryProjection.gates[${index}].recoveryPointId`, 160),
  };
}

function normalizeRecoveryPoint(value, index) {
  rejectUnknown(value, RECOVERY_KEYS, `gateRecoveryProjection.recoveryPoints[${index}]`);
  return {
    recoveryPointId: required(value.recoveryPointId, `gateRecoveryProjection.recoveryPoints[${index}].recoveryPointId`, 160),
    triggeredBy: stringList(value.triggeredBy, `gateRecoveryProjection.recoveryPoints[${index}].triggeredBy`, { allowEmpty: false }),
    state: required(value.state, `gateRecoveryProjection.recoveryPoints[${index}].state`, 80),
    resumeStage: required(value.resumeStage, `gateRecoveryProjection.recoveryPoints[${index}].resumeStage`, 120),
    authorityRef: required(value.authorityRef, `gateRecoveryProjection.recoveryPoints[${index}].authorityRef`, 240),
    evidenceRequirements: stringList(value.evidenceRequirements, `gateRecoveryProjection.recoveryPoints[${index}].evidenceRequirements`, { allowEmpty: false }),
  };
}

function uniqueBy(rows, key, label) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row[key])) throw new Error(`${label} 身份重复：${row[key]}`);
    seen.add(row[key]);
  }
  return rows;
}

export function normalizeFactoryProcessProtocol(value = {}) {
  rejectSecrets(value);
  rejectUnknown(value, PROTOCOL_KEYS, 'Factory Process Protocol');
  if (value.schema !== FACTORY_PROCESS_PROTOCOL_SCHEMA) throw new Error(`未知 Process Protocol schema：${value.schema || '空'}`);
  const gateRecovery = value.gateRecoveryProjection;
  rejectUnknown(gateRecovery, GATE_RECOVERY_KEYS, 'gateRecoveryProjection');
  const protocol = {
    schema: FACTORY_PROCESS_PROTOCOL_SCHEMA,
    protocolId: required(value.protocolId, 'protocolId', 160),
    version: required(value.version, 'version', 80),
    title: required(value.title, 'title', 300),
    status: required(value.status, 'status', 80),
    domain: required(value.domain, 'domain', 160),
    workflowRef: required(value.workflowRef, 'workflowRef', 240),
    workflowVersion: required(value.workflowVersion, 'workflowVersion', 120),
    directorTable: uniqueBy(list(value.directorTable).map(normalizeDirector), 'stageId', 'directorTable'),
    handoffs: uniqueBy(list(value.handoffs).map(normalizeHandoff), 'handoffId', 'handoffs'),
    exceptions: uniqueBy(list(value.exceptions).map(normalizeException), 'exceptionId', 'exceptions'),
    artifactChain: uniqueBy(list(value.artifactChain).map(normalizeArtifact), 'role', 'artifactChain'),
    gateRecoveryProjection: {
      gates: uniqueBy(list(gateRecovery.gates).map(normalizeGate), 'gateRef', 'gates'),
      recoveryPoints: uniqueBy(list(gateRecovery.recoveryPoints).map(normalizeRecoveryPoint), 'recoveryPointId', 'recoveryPoints'),
    },
    provenance: normalizeProvenance(value.provenance),
  };
  if (!protocol.directorTable.length || !protocol.handoffs.length || !protocol.artifactChain.length || !protocol.gateRecoveryProjection.gates.length) {
    throw new Error('Process Protocol 必须包含 Director、handoff、artifact chain 与 gate/recovery');
  }
  const stages = new Set(protocol.directorTable.map(row => row.stageId));
  const artifacts = new Set(protocol.artifactChain.map(row => row.role));
  const gates = new Set(protocol.gateRecoveryProjection.gates.map(row => row.gateRef));
  const exceptions = new Set(protocol.exceptions.map(row => row.exceptionId));
  const recoveries = new Set(protocol.gateRecoveryProjection.recoveryPoints.map(row => row.recoveryPointId));
  for (const row of protocol.directorTable) {
    row.inputArtifactRoles.concat(row.outputArtifactRoles).forEach(role => { if (!artifacts.has(role)) throw new Error(`Director 引用未知工件角色：${role}`); });
    row.gateRefs.forEach(ref => { if (!gates.has(ref)) throw new Error(`Director 引用未知 Gate：${ref}`); });
    row.exceptionRefs.forEach(ref => { if (!exceptions.has(ref)) throw new Error(`Director 引用未知 Exception：${ref}`); });
  }
  for (const row of protocol.handoffs) {
    if (!stages.has(row.fromStage) || !stages.has(row.toStage)) throw new Error(`handoff 引用未知 stage：${row.handoffId}`);
    row.requiredArtifactRoles.forEach(role => { if (!artifacts.has(role)) throw new Error(`handoff 引用未知工件角色：${role}`); });
    if (row.acceptanceGateRef && !gates.has(row.acceptanceGateRef)) throw new Error(`handoff 引用未知 Gate：${row.acceptanceGateRef}`);
    if (row.rejectionTarget && !stages.has(row.rejectionTarget)) throw new Error(`handoff 引用未知 rejectionTarget：${row.rejectionTarget}`);
  }
  for (const row of protocol.exceptions) if (!recoveries.has(row.recoveryPointId)) throw new Error(`Exception 引用未知恢复点：${row.recoveryPointId}`);
  for (const row of protocol.gateRecoveryProjection.gates) {
    if (!stages.has(row.stageId)) throw new Error(`Gate 引用未知 stage：${row.stageId}`);
    row.inputArtifactRoles.forEach(role => { if (!artifacts.has(role)) throw new Error(`Gate 引用未知工件角色：${role}`); });
    if (!recoveries.has(row.recoveryPointId)) throw new Error(`Gate 引用未知恢复点：${row.recoveryPointId}`);
  }
  return deepFreeze(protocol);
}

export function createW68FactoryProcessProtocol() {
  return normalizeFactoryProcessProtocol({
    schema: FACTORY_PROCESS_PROTOCOL_SCHEMA,
    protocolId: W68_FACTORY_PROCESS_PROTOCOL_ID,
    version: W68_FACTORY_PROCESS_PROTOCOL_VERSION,
    title: 'W68 双环审理 · Director 与过程协议',
    status: 'active',
    domain: 'content-production',
    workflowRef: 'W68',
    workflowVersion: 'W68a/W68c',
    directorTable: [
      { stageId: 'intake', label: '立项与运行确认', directorRef: 'seat:factory-director', responsibility: '确认目标、锁定材料、治理仪式与预算边界；只协调，不代替 Gate 或人工签发。', authorityScope: 'coordinate', inputArtifactRoles: ['blueprint'], outputArtifactRoles: ['skeleton', 'draft'], gateRefs: [], exceptionRefs: ['exception:no-qualified-executor', 'exception:budget-stop', 'exception:provider-unavailable'] },
      { stageId: 'm1-machine', label: 'M1 确定性机检', directorRef: 'seat:m1-inspector', responsibility: '对草稿执行确定性检查并提出可定位 Finding；不得自批正文。', authorityScope: 'inspect', inputArtifactRoles: ['draft'], outputArtifactRoles: ['machine'], gateRefs: ['w68:machine'], exceptionRefs: ['exception:authority-mismatch'] },
      { stageId: 'm2-point', label: 'M2 语义对点', directorRef: 'seat:m2-reviewer', responsibility: '依据骨架、锁定材料与机检证据判断方向，生成对点结论；不得兼任回炉执行。', authorityScope: 'recommend', inputArtifactRoles: ['skeleton', 'draft', 'machine'], outputArtifactRoles: ['point', 'repair'], gateRefs: ['w68:point'], exceptionRefs: ['exception:three-round-nonconvergence'] },
      { stageId: 'm3-rework', label: 'M3 定向回炉', directorRef: 'seat:m3-reviser', responsibility: '只按修订单修改受影响集合并保护锁定项，留下改前、改后与复验证据。', authorityScope: 'revise', inputArtifactRoles: ['draft', 'repair'], outputArtifactRoles: ['draft', 'machine'], gateRefs: [], exceptionRefs: ['exception:three-round-nonconvergence'] },
      { stageId: 'm4-m5-review', label: 'M4/M5 背靠背审理', directorRef: 'seat:independent-review-cell', responsibility: '两席独立审理且互不偷看，把意见和质询作为工件交付，不代替仲裁。', authorityScope: 'inspect', inputArtifactRoles: ['draft', 'machine', 'point'], outputArtifactRoles: ['review', 'objection', 'answer'], gateRefs: ['w68:review', 'w68:objection'], exceptionRefs: ['exception:authority-mismatch'] },
      { stageId: 'm6-arbitration', label: 'M6 仲裁', directorRef: 'seat:m6-arbitrator', responsibility: '仅对未撤质询与证据冲突作裁决，保留引用与 Authority，不改写历史意见。', authorityScope: 'arbitrate', inputArtifactRoles: ['review', 'objection', 'answer'], outputArtifactRoles: ['verdict', 'manifest'], gateRefs: ['w68:objection'], exceptionRefs: ['exception:authority-mismatch'] },
      { stageId: 'human-final', label: '人工终审与封存处置', directorRef: 'human:factory-operator', responsibility: '对终审卡作入库、打回或暂存决定；Factory seal 不等于 Promotion、Publication 或 Canon。', authorityScope: 'human-final', inputArtifactRoles: ['verdict', 'manifest'], outputArtifactRoles: ['final-output'], gateRefs: [], exceptionRefs: ['exception:ledger-recovery-required'] },
    ],
    handoffs: [
      { handoffId: 'handoff:intake-to-m1', fromStage: 'intake', toStage: 'm1-machine', trigger: '草稿与骨架已落为可引用工件', requiredArtifactRoles: ['blueprint', 'skeleton', 'draft'], acceptanceGateRef: '', rejectionTarget: 'intake', evidenceRequired: true, authorityRef: 'seat:factory-director' },
      { handoffId: 'handoff:m1-to-m2', fromStage: 'm1-machine', toStage: 'm2-point', trigger: '机检报告已形成', requiredArtifactRoles: ['draft', 'machine'], acceptanceGateRef: 'w68:machine', rejectionTarget: 'm3-rework', evidenceRequired: true, authorityRef: 'seat:m1-inspector' },
      { handoffId: 'handoff:m2-to-m3', fromStage: 'm2-point', toStage: 'm3-rework', trigger: '对点或机检未通过并生成修订单', requiredArtifactRoles: ['draft', 'point', 'repair'], acceptanceGateRef: 'w68:point', rejectionTarget: 'intake', evidenceRequired: true, authorityRef: 'seat:m2-reviewer' },
      { handoffId: 'handoff:m3-to-m1', fromStage: 'm3-rework', toStage: 'm1-machine', trigger: '回炉改后稿与保护项复验证据已保存', requiredArtifactRoles: ['draft', 'repair', 'machine'], acceptanceGateRef: '', rejectionTarget: 'intake', evidenceRequired: true, authorityRef: 'seat:m3-reviser' },
      { handoffId: 'handoff:m2-to-m4m5', fromStage: 'm2-point', toStage: 'm4-m5-review', trigger: '机检与对点均通过', requiredArtifactRoles: ['draft', 'machine', 'point'], acceptanceGateRef: 'w68:point', rejectionTarget: 'm3-rework', evidenceRequired: true, authorityRef: 'seat:m2-reviewer' },
      { handoffId: 'handoff:m4m5-to-m6', fromStage: 'm4-m5-review', toStage: 'm6-arbitration', trigger: '存在两轮未撤质询或审理冲突', requiredArtifactRoles: ['review', 'objection', 'answer'], acceptanceGateRef: 'w68:review', rejectionTarget: 'm3-rework', evidenceRequired: true, authorityRef: 'seat:independent-review-cell' },
      { handoffId: 'handoff:m6-to-human', fromStage: 'm6-arbitration', toStage: 'human-final', trigger: '裁决与 manifest 可下钻', requiredArtifactRoles: ['verdict', 'manifest'], acceptanceGateRef: 'w68:objection', rejectionTarget: 'm3-rework', evidenceRequired: true, authorityRef: 'seat:m6-arbitrator' },
    ],
    exceptions: [
      { exceptionId: 'exception:budget-stop', trigger: '预算硬闸不足或明确停摆', state: 'blocked', authorityRef: 'human:factory-operator', evidenceRequirements: ['成本台账或预算 Gate 引用', '降级/停摆决定'], recoveryPointId: 'recovery:budget-decision', automaticFallback: false },
      { exceptionId: 'exception:no-qualified-executor', trigger: '没有满足 Seat 与资格要求的执行者', state: 'blocked', authorityRef: 'human:factory-operator', evidenceRequirements: ['调度排除理由', '资格或健康证据'], recoveryPointId: 'recovery:executor-selection', automaticFallback: false },
      { exceptionId: 'exception:provider-unavailable', trigger: 'Provider 或真实 Harness/Executor 不可用', state: 'blocked', authorityRef: 'human:factory-operator', evidenceRequirements: ['边界失败记录', '恢复或改派决定'], recoveryPointId: 'recovery:provider-restored', automaticFallback: false },
      { exceptionId: 'exception:three-round-nonconvergence', trigger: '三轮回炉仍不收敛', state: 'blocked', authorityRef: 'human:factory-operator', evidenceRequirements: ['三轮 Rework 引用', '退骨或人工升级决定'], recoveryPointId: 'recovery:skeleton-revision', automaticFallback: false },
      { exceptionId: 'exception:ledger-recovery-required', trigger: 'Run、审计、委托、调度或评价账损坏/孤儿', state: 'recovery-required', authorityRef: 'human:factory-operator', evidenceRequirements: ['损坏尾或孤儿引用', '人工核对证据'], recoveryPointId: 'recovery:ledger-reviewed', automaticFallback: false },
      { exceptionId: 'exception:authority-mismatch', trigger: '提出者、复验者、仲裁者或签发者越权/自证', state: 'blocked', authorityRef: 'human:factory-operator', evidenceRequirements: ['Authority mismatch Finding', '更正后的责任主体'], recoveryPointId: 'recovery:authority-corrected', automaticFallback: false },
    ],
    artifactChain: [
      { role: 'blueprint', type: 'text/markdown', producedBy: 'intake', consumedBy: ['m1-machine', 'm2-point'], predecessorRoles: [], required: true, truthOwner: 'domain-file' },
      { role: 'skeleton', type: 'text/markdown', producedBy: 'intake', consumedBy: ['m2-point'], predecessorRoles: ['blueprint'], required: true, truthOwner: 'domain-file' },
      { role: 'draft', type: 'text/markdown', producedBy: 'intake', consumedBy: ['m1-machine', 'm2-point', 'm3-rework', 'm4-m5-review'], predecessorRoles: ['blueprint', 'skeleton'], required: true, truthOwner: 'domain-file' },
      { role: 'machine', type: 'text/markdown', producedBy: 'm1-machine', consumedBy: ['m2-point', 'm4-m5-review'], predecessorRoles: ['draft'], required: true, truthOwner: 'domain-file' },
      { role: 'point', type: 'text/markdown', producedBy: 'm2-point', consumedBy: ['m3-rework', 'm4-m5-review'], predecessorRoles: ['skeleton', 'draft', 'machine'], required: true, truthOwner: 'domain-file' },
      { role: 'repair', type: 'text/markdown', producedBy: 'm2-point', consumedBy: ['m3-rework'], predecessorRoles: ['point'], required: false, truthOwner: 'domain-file' },
      { role: 'review', type: 'text/markdown', producedBy: 'm4-m5-review', consumedBy: ['m6-arbitration'], predecessorRoles: ['draft', 'machine', 'point'], required: true, truthOwner: 'domain-file' },
      { role: 'objection', type: 'text/markdown', producedBy: 'm4-m5-review', consumedBy: ['m4-m5-review', 'm6-arbitration'], predecessorRoles: ['review'], required: false, truthOwner: 'domain-file' },
      { role: 'answer', type: 'text/markdown', producedBy: 'm4-m5-review', consumedBy: ['m6-arbitration'], predecessorRoles: ['objection'], required: false, truthOwner: 'domain-file' },
      { role: 'verdict', type: 'text/markdown', producedBy: 'm6-arbitration', consumedBy: ['human-final'], predecessorRoles: ['review', 'objection', 'answer'], required: true, truthOwner: 'domain-file' },
      { role: 'manifest', type: 'application/json', producedBy: 'm6-arbitration', consumedBy: ['human-final'], predecessorRoles: ['machine', 'point', 'review', 'verdict'], required: true, truthOwner: 'domain-file' },
      { role: 'final-output', type: 'text/markdown', producedBy: 'human-final', consumedBy: [], predecessorRoles: ['verdict', 'manifest'], required: true, truthOwner: 'domain-file' },
    ],
    gateRecoveryProjection: {
      gates: [
        { gateRef: 'w68:machine', label: '确定性机检', stageId: 'm1-machine', inputArtifactRoles: ['draft', 'machine'], passState: 'continue:m2-point', failState: 'rework:m3-rework', authorityRef: 'seat:m1-inspector', recoveryPointId: 'recovery:skeleton-revision' },
        { gateRef: 'w68:point', label: '语义对点', stageId: 'm2-point', inputArtifactRoles: ['skeleton', 'draft', 'machine', 'point'], passState: 'continue:m4-m5-review', failState: 'rework:m3-rework', authorityRef: 'seat:m2-reviewer', recoveryPointId: 'recovery:skeleton-revision' },
        { gateRef: 'w68:review', label: '背靠背审理', stageId: 'm4-m5-review', inputArtifactRoles: ['draft', 'review'], passState: 'continue:m6-arbitration', failState: 'rework:m3-rework', authorityRef: 'seat:independent-review-cell', recoveryPointId: 'recovery:authority-corrected' },
        { gateRef: 'w68:objection', label: '质询与仲裁', stageId: 'm6-arbitration', inputArtifactRoles: ['objection', 'answer', 'verdict'], passState: 'continue:human-final', failState: 'blocked:human-escalation', authorityRef: 'seat:m6-arbitrator', recoveryPointId: 'recovery:authority-corrected' },
      ],
      recoveryPoints: [
        { recoveryPointId: 'recovery:budget-decision', triggeredBy: ['exception:budget-stop'], state: 'blocked', resumeStage: 'intake', authorityRef: 'human:factory-operator', evidenceRequirements: ['预算决定引用'] },
        { recoveryPointId: 'recovery:executor-selection', triggeredBy: ['exception:no-qualified-executor'], state: 'blocked', resumeStage: 'intake', authorityRef: 'human:factory-operator', evidenceRequirements: ['资格与改派证据'] },
        { recoveryPointId: 'recovery:provider-restored', triggeredBy: ['exception:provider-unavailable'], state: 'blocked', resumeStage: 'intake', authorityRef: 'human:factory-operator', evidenceRequirements: ['可用性复核证据'] },
        { recoveryPointId: 'recovery:skeleton-revision', triggeredBy: ['exception:three-round-nonconvergence', 'w68:machine', 'w68:point'], state: 'blocked', resumeStage: 'intake', authorityRef: 'human:factory-operator', evidenceRequirements: ['退骨/回炉工件引用', '恢复决定'] },
        { recoveryPointId: 'recovery:ledger-reviewed', triggeredBy: ['exception:ledger-recovery-required'], state: 'recovery-required', resumeStage: 'intake', authorityRef: 'human:factory-operator', evidenceRequirements: ['损坏证据', '人工核对决定'] },
        { recoveryPointId: 'recovery:authority-corrected', triggeredBy: ['exception:authority-mismatch', 'w68:review', 'w68:objection'], state: 'blocked', resumeStage: 'm4-m5-review', authorityRef: 'human:factory-operator', evidenceRequirements: ['Authority 修正证据'] },
      ],
    },
    provenance: {
      source: 'mazz.factory.w68', protocol: 'W73g', owner: 'W73 Factory Runtime',
      boundary: 'Definition only: no execution, scheduling, automatic Gate mutation, Promotion, Publication or Canon authority.',
    },
  });
}

function normalizeProjectionRef(value) {
  rejectUnknown(value, PROTOCOL_REF_KEYS, 'protocolRef');
  return {
    id: required(value.id, 'protocolRef.id', 240), version: required(value.version, 'protocolRef.version', 80),
    path: required(value.path, 'protocolRef.path', 1200), envelopePath: required(value.envelopePath, 'protocolRef.envelopePath', 1200),
  };
}

function normalizeRunRef(value) {
  rejectUnknown(value, RUN_REF_KEYS, 'runRef');
  return {
    runId: required(value.runId, 'runRef.runId', 240), taskId: required(value.taskId, 'runRef.taskId', 240),
    projectId: required(value.projectId, 'runRef.projectId', 240), path: required(value.path, 'runRef.path', 1200),
    status: required(value.status, 'runRef.status', 80), sequence: Math.max(0, Math.trunc(Number(value.sequence) || 0)),
  };
}

function normalizeRecovery(value) {
  rejectUnknown(value, RECOVERY_STATE_KEYS, 'recovery');
  return { required: value.required === true, reasonCode: text(value.reasonCode, 160), evidenceRef: text(value.evidenceRef, 1200) };
}

function uniqueStrings(values, max = 360) {
  return [...new Set(list(values).map(value => text(value, max)).filter(Boolean))];
}

function uniqueArtifactRefs(values) {
  const seen = new Set();
  return list(values).map(normalizeProductionRunReference).filter(ref => {
    const key = `${ref.kind}\u0000${ref.id}\u0000${ref.path}\u0000${ref.role}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function normalizeFactoryProcessProjection(value = {}) {
  rejectSecrets(value);
  rejectUnknown(value, PROJECTION_KEYS, 'Factory Process Projection');
  if (value.schema !== FACTORY_PROCESS_PROJECTION_SCHEMA) throw new Error(`未知 Process Projection schema：${value.schema || '空'}`);
  const projection = {
    schema: FACTORY_PROCESS_PROJECTION_SCHEMA,
    projectionId: required(value.projectionId, 'projectionId', 260),
    version: required(value.version, 'version', 80),
    protocolRef: normalizeProjectionRef(value.protocolRef),
    runRef: normalizeRunRef(value.runRef),
    artifactRefs: uniqueArtifactRefs(value.artifactRefs),
    gateRefs: uniqueStrings(value.gateRefs),
    findingRefs: uniqueStrings(value.findingRefs),
    reworkRefs: uniqueStrings(value.reworkRefs),
    recovery: normalizeRecovery(value.recovery),
    projectedAt: required(value.projectedAt, 'projectedAt', 80),
    provenance: normalizeProvenance(value.provenance),
  };
  return deepFreeze(projection);
}

export function buildFactoryRunProtocolProjection({ protocolAsset, ledger, projectedAt = '' } = {}) {
  const snapshot = ledger?.snapshot;
  if (!snapshot || !ledger?.paths?.root) throw new Error('Process Projection 缺 Production Run Ledger');
  const protocolRef = normalizeProjectionRef(protocolAsset);
  const sequence = Math.max(0, Number(snapshot.lastSequence) || 0);
  const lastEventAt = ledger.events?.at?.(-1)?.occurredAt || snapshot.startedAt || snapshot.createdAt;
  return normalizeFactoryProcessProjection({
    schema: FACTORY_PROCESS_PROJECTION_SCHEMA,
    projectionId: `asset:factory-process-projection:${snapshot.runId}`,
    version: `run-seq-${String(sequence).padStart(6, '0')}`,
    protocolRef,
    runRef: {
      runId: snapshot.runId, taskId: snapshot.taskId, projectId: snapshot.projectId,
      path: ledger.paths.root, status: snapshot.status, sequence,
    },
    artifactRefs: ledger.refs || [], gateRefs: snapshot.gateRefs || [], findingRefs: snapshot.findingRefs || [],
    reworkRefs: snapshot.reworkRefs || [], recovery: snapshot.recoveryState || {},
    projectedAt: projectedAt || lastEventAt,
    provenance: {
      source: 'mazz.production-run/v0', protocol: 'W73g', owner: 'W73 Factory Runtime',
      boundary: 'Read-only projection of existing Run references; deleting the view or projection never deletes Run or domain facts.',
    },
  });
}

function safeSegment(value, label) {
  const normalized = required(value, label, 240);
  if (!/^[a-zA-Z0-9._-]+$/.test(normalized) || normalized === '.' || normalized === '..') throw new Error(`${label} 含非法路径字符`);
  return normalized;
}

function slash(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

export function factoryProcessProtocolPaths(projectFolder, protocol = createW68FactoryProcessProtocol()) {
  const base = slash(projectFolder); if (!base) throw new Error('Process Protocol 缺 projectFolder');
  const root = `${base}/.mazz/protocols/${safeSegment(protocol.protocolId, 'protocolId')}/${safeSegment(protocol.version, 'version')}`;
  return deepFreeze({ root, json: `${root}/protocol.json`, envelope: `${root}/asset-envelope.json`, markdown: `${root}/README.md` });
}

export function factoryProcessProjectionPaths(runFolder, projection) {
  const base = slash(runFolder); if (!base) throw new Error('Process Projection 缺 runFolder');
  const root = `${base}/process-protocol/${safeSegment(projection.version, 'projection.version')}`;
  return deepFreeze({ root, json: `${root}/projection.json`, envelope: `${root}/asset-envelope.json`, markdown: `${root}/README.md` });
}

function createAssetEnvelope({ id, path, type, version, sourceRef, provenance, status = 'active', relations = [] }) {
  const envelope = { schema: W72_ASSET_ENVELOPE_SCHEMA, id, path, type, version, sourceRef: clone(sourceRef), provenance: clone(provenance), status, relations: clone(relations) };
  rejectSecrets(envelope);
  return deepFreeze(envelope);
}

function validateIo(io) {
  for (const method of ['exists', 'read', 'write', 'mkdir']) if (typeof io?.[method] !== 'function') throw new Error(`Process Protocol IO 缺 ${method}`);
  return io;
}

async function writeIfChanged(io, path, content) {
  if (await io.exists(path)) {
    const before = await io.read(path);
    if (String(before) === String(content)) return false;
  }
  await io.write(path, content); return true;
}

function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function joinList(values) { return values?.length ? values.join('、') : '—'; }

export function renderFactoryProcessProtocolMarkdown(protocolValue) {
  const p = normalizeFactoryProcessProtocol(protocolValue);
  const director = p.directorTable.map(row => `| ${row.stageId} | ${row.label} | ${row.directorRef} | ${row.authorityScope} | ${row.responsibility} |`).join('\n');
  const handoffs = p.handoffs.map(row => `| ${row.handoffId} | ${row.fromStage} → ${row.toStage} | ${row.trigger} | ${joinList(row.requiredArtifactRoles)} | ${row.acceptanceGateRef || '—'} |`).join('\n');
  const exceptions = p.exceptions.map(row => `| ${row.exceptionId} | ${row.trigger} | ${row.state} | ${row.authorityRef} | ${row.recoveryPointId} |`).join('\n');
  const artifacts = p.artifactChain.map(row => `| ${row.role} | ${row.type} | ${row.producedBy} | ${joinList(row.consumedBy)} | ${joinList(row.predecessorRoles)} | ${row.truthOwner} |`).join('\n');
  const gates = p.gateRecoveryProjection.gates.map(row => `| ${row.gateRef} | ${row.label} | ${row.stageId} | ${row.passState} | ${row.failState} | ${row.recoveryPointId} |`).join('\n');
  const recovery = p.gateRecoveryProjection.recoveryPoints.map(row => `| ${row.recoveryPointId} | ${joinList(row.triggeredBy)} | ${row.state} | ${row.resumeStage} | ${row.authorityRef} |`).join('\n');
  return `# ${p.title}\n\n> Protocol Asset \`${p.protocolId}@${p.version}\` · ${p.status}\n>\n> 只描述职责、交接、异常、工件链、Gate 与恢复；不执行、不调度、不改 Gate，不取得 Promotion / Publication / Canon 权力。\n\n## Director table\n\n| Stage | 名称 | Director / Seat | Authority scope | 职责 |\n|---|---|---|---|---|\n${director}\n\n## Handoff\n\n| Handoff | 流向 | 触发 | 必需工件 | Acceptance Gate |\n|---|---|---|---|---|\n${handoffs}\n\n## Exception\n\n| Exception | 触发 | 状态 | Authority | Recovery |\n|---|---|---|---|---|\n${exceptions}\n\n所有异常均为 \`automaticFallback=false\`；未知、无资格、越权或损坏时合法结果是 BLOCKED / recovery-required。\n\n## Artifact chain\n\n| Role | Type | Producer | Consumers | Predecessors | Truth owner |\n|---|---|---|---|---|---|\n${artifacts}\n\n## Gate projection\n\n| Gate | 名称 | Stage | Pass | Fail | Recovery |\n|---|---|---|---|---|---|\n${gates}\n\n## Recovery points\n\n| Recovery | Triggered by | State | Resume stage | Authority |\n|---|---|---|---|---|\n${recovery}\n`;
}

export function renderFactoryProcessProjectionMarkdown(projectionValue) {
  const p = normalizeFactoryProcessProjection(projectionValue);
  const artifacts = p.artifactRefs.length ? p.artifactRefs.map(ref => `- \`${ref.role || ref.kind}\` · ${ref.id || '—'} · ${ref.path || '—'}`).join('\n') : '- 尚无已登记工件引用';
  const gates = p.gateRefs.length ? p.gateRefs.map(ref => `- \`${ref}\``).join('\n') : '- 尚无 Gate 结果引用';
  const findings = p.findingRefs.length ? p.findingRefs.map(ref => `- \`${ref}\``).join('\n') : '- 尚无 Finding 引用';
  const reworks = p.reworkRefs.length ? p.reworkRefs.map(ref => `- \`${ref}\``).join('\n') : '- 尚无 Rework 引用';
  return `# Factory Process Projection\n\n> ${p.projectionId}@${p.version}\n>\n> 这是 Production Run 的只读引用投影。删除 Factory Desk 视图或本投影，不会删除 Run、工件、Finding、Gate 或领域文件。\n\n- Protocol：\`${p.protocolRef.id}@${p.protocolRef.version}\`\n- Run：\`${p.runRef.runId}\`\n- Task：\`${p.runRef.taskId}\`\n- Status：\`${p.runRef.status}\`\n- Sequence：\`${p.runRef.sequence}\`\n- Projected at：${p.projectedAt}\n\n## Artifact references\n\n${artifacts}\n\n## Gate references\n\n${gates}\n\n## Finding references\n\n${findings}\n\n## Rework references\n\n${reworks}\n\n## Recovery\n\n- required：\`${p.recovery.required}\`\n- reason：\`${p.recovery.reasonCode || '—'}\`\n- evidence：${p.recovery.evidenceRef || '—'}\n`;
}

export async function saveFactoryProcessProtocolAsset({ io: rawIo, projectFolder, protocol: input = createW68FactoryProcessProtocol() } = {}) {
  const io = validateIo(rawIo); const protocol = normalizeFactoryProcessProtocol(input); const paths = factoryProcessProtocolPaths(projectFolder, protocol);
  await io.mkdir(paths.root);
  const serialized = json(protocol);
  if (await io.exists(paths.json)) {
    let existing;
    try { existing = normalizeFactoryProcessProtocol(JSON.parse(await io.read(paths.json))); }
    catch (error) { throw Object.assign(new Error(`既有 Process Protocol 无法重开：${error.message}`), { code: 'W73G_PROTOCOL_REOPEN_FAILED' }); }
    if (json(existing) !== serialized) throw Object.assign(new Error(`同一 protocolId/version 内容冲突：${protocol.protocolId}@${protocol.version}`), { code: 'W73G_PROTOCOL_VERSION_CONFLICT' });
  } else await io.write(paths.json, serialized);
  const asset = {
    id: `asset:factory-process-protocol:${protocol.protocolId}`, version: protocol.version,
    path: paths.json, envelopePath: paths.envelope,
  };
  const envelope = createAssetEnvelope({
    id: asset.id, path: paths.json, type: FACTORY_PROCESS_PROTOCOL_ASSET_TYPE, version: protocol.version,
    sourceRef: { workflowRef: protocol.workflowRef, workflowVersion: protocol.workflowVersion },
    provenance: { kind: 'first-party', producer: 'mazz.factory.w73g', source: protocol.provenance.source },
    relations: [{ type: 'describesWorkflow', targetId: `workflow:${protocol.workflowRef}`, sourceRef: { version: protocol.workflowVersion }, provenance: { protocol: 'W73g' } }],
  });
  await writeIfChanged(io, paths.envelope, json(envelope));
  await writeIfChanged(io, paths.markdown, renderFactoryProcessProtocolMarkdown(protocol));
  return deepFreeze({ protocol, asset, envelope, paths });
}

export async function openFactoryProcessProtocolAsset({ io: rawIo, path } = {}) {
  const io = validateIo(rawIo);
  return normalizeFactoryProcessProtocol(JSON.parse(await io.read(required(path, 'path', 1200))));
}

export async function saveFactoryProcessProjectionAsset({ io: rawIo, runFolder, projection: input } = {}) {
  const io = validateIo(rawIo); const projection = normalizeFactoryProcessProjection(input); const paths = factoryProcessProjectionPaths(runFolder, projection);
  await io.mkdir(paths.root);
  const serialized = json(projection);
  if (await io.exists(paths.json)) {
    let existing;
    try { existing = normalizeFactoryProcessProjection(JSON.parse(await io.read(paths.json))); }
    catch (error) { throw Object.assign(new Error(`既有 Process Projection 无法重开：${error.message}`), { code: 'W73G_PROJECTION_REOPEN_FAILED' }); }
    if (json(existing) !== serialized) throw Object.assign(new Error(`同一 projection/version 内容冲突：${projection.projectionId}@${projection.version}`), { code: 'W73G_PROJECTION_VERSION_CONFLICT' });
  } else await io.write(paths.json, serialized);
  const envelope = createAssetEnvelope({
    id: projection.projectionId, path: paths.json, type: FACTORY_PROCESS_PROJECTION_ASSET_TYPE, version: projection.version,
    sourceRef: { runId: projection.runRef.runId, sequence: projection.runRef.sequence },
    provenance: { kind: 'derived', producer: 'mazz.factory.w73g', source: 'mazz.production-run/v0' },
    relations: [
      { type: 'projectsRun', targetId: `production-run:${projection.runRef.runId}`, sourceRef: { path: projection.runRef.path }, provenance: { protocol: 'W73g' } },
      { type: 'usesProtocol', targetId: projection.protocolRef.id, sourceRef: { version: projection.protocolRef.version }, provenance: { protocol: 'W73g' } },
    ],
  });
  await writeIfChanged(io, paths.envelope, json(envelope));
  await writeIfChanged(io, paths.markdown, renderFactoryProcessProjectionMarkdown(projection));
  return deepFreeze({ projection, asset: { id: projection.projectionId, version: projection.version, path: paths.json, envelopePath: paths.envelope }, envelope, paths });
}

export async function openFactoryProcessProjectionAsset({ io: rawIo, path } = {}) {
  const io = validateIo(rawIo);
  return normalizeFactoryProcessProjection(JSON.parse(await io.read(required(path, 'path', 1200))));
}

export function factoryProcessDeskEvent({ task, protocolBundle, projectionBundle } = {}) {
  const projection = projectionBundle?.projection;
  if (!projection || !protocolBundle?.protocol) throw new Error('Factory Desk protocol event 缺资产');
  const recovery = projection.recovery.required ? `需要恢复：${projection.recovery.reasonCode || 'RECOVERY_REQUIRED'}` : '无需恢复';
  return deepFreeze({
    id: `w73g-protocol-${projection.runRef.runId}-${projection.version}`,
    type: 'system', title: `过程协议 · ${protocolBundle.protocol.title}`,
    content: [
      `- 协议：\`${protocolBundle.asset.id}@${protocolBundle.asset.version}\``,
      `- Run 投影：\`${projection.projectionId}@${projection.version}\``,
      `- Director stages：${protocolBundle.protocol.directorTable.length}`,
      `- Handoffs：${protocolBundle.protocol.handoffs.length}`,
      `- Exceptions：${protocolBundle.protocol.exceptions.length}`,
      `- Artifact roles：${protocolBundle.protocol.artifactChain.length}`,
      `- Gate refs：${projection.gateRefs.length}`,
      `- ${recovery}`,
      '', '协议只描述职责与证据边界；现有 W68/W73 Runtime 继续拥有执行与 Run 真相。',
      '', `可读协议：${protocolBundle.paths.markdown}`, `本 Run 投影：${projectionBundle.paths.markdown}`,
    ].join('\n'),
    stage: 'process-protocol', artifactPath: projectionBundle.paths.markdown,
    card: {
      kind: 'process-protocol-asset', taskId: task?.id || projection.runRef.taskId,
      protocolPath: protocolBundle.paths.json, projectionPath: projectionBundle.paths.json,
      protocolEnvelopePath: protocolBundle.paths.envelope, projectionEnvelopePath: projectionBundle.paths.envelope,
    },
    progress: 100,
  });
}
