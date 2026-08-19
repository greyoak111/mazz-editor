'use strict';

const crypto = require('crypto');
const {
  assertKnownKeys,
  clonePlain,
  deepFreeze,
  isPlainObject,
  requiredString,
  stringList,
} = require('./plain-value');

const WORKFLOW_PACKAGE_SCHEMA = 'mazz.workflow-package/v0';
const ORGANIZATION_COMPILE_REQUEST_SCHEMA = 'mazz.organization-compile-request/v0';
const EXECUTION_PLAN_SCHEMA = 'mazz.execution-plan/v0';
const TRANSITION_EVIDENCE_SCHEMA = 'mazz.transition-evidence/v0';
const TRANSITION_RESULT_SCHEMA = 'mazz.transition-result/v0';
const EXPERT_CAPABILITY_SCHEMA = 'mazz.expert-capability-asset/v0';
const EXPERT_COMPOSITION_SCHEMA = 'mazz.expert-capability-composition/v0';

const SECRET_KEYS = new Set([
  'apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken',
  'credential', 'cookie', 'privatekey', 'sessiontoken',
]);
const EXECUTOR_KINDS = Object.freeze(['human', 'model', 'agent', 'script', 'tool', 'supplier']);
const EXECUTOR_STATES = Object.freeze(['available', 'degraded', 'unavailable', 'unknown']);
const ARCHAEOLOGY_DECISIONS = Object.freeze(['preserve', 'merge', 'remove']);
const ARCHAEOLOGY_REASONS = Object.freeze([
  'professional-judgment', 'authority-separation', 'independent-review', 'responsibility',
  'tool-boundary', 'regulatory', 'legacy-friction',
]);
const RESULT_STATES = Object.freeze(['passed', 'failed', 'unknown']);
const BUDGET_STATES = Object.freeze(['known', 'unknown']);

const PACKAGE_FIELDS = Object.freeze([
  'schema', 'workflowId', 'version', 'name', 'domain', 'deliverableType', 'inputContract',
  'teams', 'seats', 'artifacts', 'gates', 'authorities', 'recoveryPoints', 'routingPolicies',
  'delegationPolicy', 'archaeology', 'expertCapabilities', 'provenance',
]);
const INPUT_CONTRACT_FIELDS = Object.freeze([
  'requiredInputKinds', 'constraintTypes', 'assetTypes', 'methodRefs', 'budgetProfiles',
]);
const BUDGET_PROFILE_FIELDS = Object.freeze(['profileId', 'currency', 'maxAmount', 'status']);
const TEAM_FIELDS = Object.freeze(['teamId', 'label', 'responsibility', 'seatIds']);
const SEAT_FIELDS = Object.freeze([
  'seatId', 'teamId', 'label', 'responsibility', 'inputArtifactIds', 'outputArtifactIds',
  'gateIds', 'authorityRefs', 'requiredCapabilityIds', 'eligibleExecutorKinds', 'childSeatOf',
  'qualificationRefs', 'delegation',
]);
const SEAT_DELEGATION_FIELDS = Object.freeze([
  'allowed', 'maxDepth', 'subcontractAllowed', 'liabilityOwner', 'requiredResultArtifactIds',
  'qualificationRefs', 'authorityRefs',
]);
const ARTIFACT_FIELDS = Object.freeze([
  'artifactId', 'label', 'type', 'version', 'producedBySeatId', 'consumedBySeatIds',
  'dependsOn', 'invalidates', 'truthOwner', 'evidenceRequirements', 'licensePolicy', 'required',
]);
const GATE_FIELDS = Object.freeze([
  'gateId', 'label', 'artifactIds', 'verificationRefs', 'reviewRefs', 'evaluationRefs',
  'authorityRef', 'passState', 'failState', 'recoveryPointId', 'destructive',
  'requiresHumanAuthority',
]);
const AUTHORITY_FIELDS = Object.freeze([
  'authorityRef', 'kind', 'scope', 'decisionTypes', 'cannotDelegate', 'prohibitedSeatIds',
]);
const RECOVERY_FIELDS = Object.freeze([
  'recoveryPointId', 'label', 'resumeSeatIds', 'affectedArtifactIds', 'evidenceRequirements',
  'authorityRef',
]);
const ROUTING_POLICY_FIELDS = Object.freeze([
  'policyId', 'seatIds', 'mode', 'requiresHumanDecision', 'evidenceRequirements',
]);
const DELEGATION_POLICY_FIELDS = Object.freeze([
  'maxDepth', 'allowSubcontract', 'requireExplicitSubcontract', 'preventCycles',
  'authorityDelegable', 'qualificationDelegable', 'parentLiabilityRetained',
  'costAccounting', 'provenanceRequired', 'taskContractRequired',
]);
const ARCHAEOLOGY_FIELDS = Object.freeze([
  'sourceRole', 'decision', 'targetSeatIds', 'reasonClass', 'rationale', 'evidenceRefs',
]);
const EXPERT_FIELDS = Object.freeze([
  'schema', 'capabilityId', 'version', 'identity', 'domain', 'inputTypes', 'outputTypes',
  'evidenceTypes', 'attention', 'decisions', 'negativeKnowledge', 'gateRefs', 'exceptionPolicy',
  'authorityBoundary', 'permissionScope', 'styleIdentity', 'provenance',
]);
const REQUEST_FIELDS = Object.freeze([
  'schema', 'requestId', 'workflowRef', 'goal', 'constraints', 'assets', 'method', 'budget',
  'capabilitySnapshot', 'routingLocks', 'authorityBindings', 'provenance',
]);
const WORKFLOW_REF_FIELDS = Object.freeze(['workflowId', 'version']);
const GOAL_FIELDS = Object.freeze(['goalId', 'statement', 'deliverableType']);
const CONSTRAINT_FIELDS = Object.freeze(['constraintId', 'type', 'valueRef', 'sourceRef']);
const ASSET_FIELDS = Object.freeze(['assetId', 'type', 'version', 'sourceRef']);
const METHOD_FIELDS = Object.freeze(['methodId', 'version', 'sourceRef']);
const BUDGET_FIELDS = Object.freeze(['profileId', 'currency', 'limit', 'status']);
const CAPABILITY_SNAPSHOT_FIELDS = Object.freeze(['snapshotId', 'executors']);
const EXECUTOR_FIELDS = Object.freeze([
  'executorRef', 'kind', 'capabilityIds', 'qualificationRefs', 'harnessRef', 'toolAdapterRef',
  'providerRef', 'status', 'version', 'estimatedCost',
]);
const COST_FIELDS = Object.freeze(['status', 'currency', 'amount']);
const ROUTING_LOCK_FIELDS = Object.freeze(['seatId', 'executorRef', 'authorityRef', 'reason']);
const AUTHORITY_BINDING_FIELDS = Object.freeze(['authorityRef', 'actorRef', 'actorKind']);
const TRANSITION_FIELDS = Object.freeze([
  'schema', 'transitionId', 'gateId', 'artifactVersions', 'verificationResults',
  'reviewResults', 'evaluationResults', 'authorityDecision',
]);
const CHECK_RESULT_FIELDS = Object.freeze(['checkRef', 'status', 'evidenceRefs', 'message']);
const AUTHORITY_DECISION_FIELDS = Object.freeze([
  'authorityRef', 'actorRef', 'decision', 'evidenceRefs', 'reason',
]);
const COMPOSITION_FIELDS = Object.freeze(['schema', 'compositionId', 'bindings', 'provenance']);
const COMPOSITION_BINDING_FIELDS = Object.freeze([
  'seatId', 'capabilityId', 'requiredInputTypes', 'requiredOutputTypes',
]);

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${trail}[${index}]`));
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const canonical = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SECRET_KEYS.has(canonical)) throw new Error(`Organizational Kernel 禁止 secret 字段: ${trail ? `${trail}.` : ''}${key}`);
    rejectSecrets(item, trail ? `${trail}.${key}` : key);
  }
}

function object(value, label, fields) {
  if (!isPlainObject(value)) throw new Error(`${label} 必须是对象`);
  assertKnownKeys(value, fields, label);
  return value;
}

function required(value, label, max = 800) {
  const normalized = requiredString(value, label);
  if (normalized.length > max) throw new Error(`${label} 超过 ${max} 字符`);
  return normalized;
}

function optional(value, max = 800) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > max) throw new Error(`可选文本超过 ${max} 字符`);
  return normalized;
}

function bool(value, label, fallback = false) {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} 必须是布尔值`);
  return value;
}

function finite(value, label, { min = 0 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) throw new Error(`${label} 必须是 >= ${min} 的有限数值`);
  return number;
}

function enumValue(value, allowed, label) {
  const normalized = required(value, label, 120);
  if (!allowed.includes(normalized)) throw new Error(`${label} 不支持: ${normalized}`);
  return normalized;
}

function strings(value, label, { allowEmpty = true } = {}) {
  const rows = stringList(value, label);
  if (!allowEmpty && !rows.length) throw new Error(`${label} 不得为空`);
  return rows.sort((a, b) => a.localeCompare(b));
}

function rows(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function unique(items, key, label) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item[key])) throw new Error(`${label} 身份重复: ${item[key]}`);
    seen.add(item[key]);
  }
  return items.sort((a, b) => a[key].localeCompare(b[key]));
}

function stableCopy(value) {
  if (Array.isArray(value)) return value.map(stableCopy);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableCopy(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableCopy(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function normalizeBudgetProfile(value, index) {
  object(value, `inputContract.budgetProfiles[${index}]`, BUDGET_PROFILE_FIELDS);
  const status = enumValue(value.status, BUDGET_STATES, `inputContract.budgetProfiles[${index}].status`);
  return {
    profileId: required(value.profileId, `inputContract.budgetProfiles[${index}].profileId`, 160),
    currency: required(value.currency, `inputContract.budgetProfiles[${index}].currency`, 24),
    maxAmount: status === 'known' ? finite(value.maxAmount, `inputContract.budgetProfiles[${index}].maxAmount`) : null,
    status,
  };
}

function normalizeInputContract(value) {
  object(value, 'inputContract', INPUT_CONTRACT_FIELDS);
  const requiredInputKinds = strings(value.requiredInputKinds, 'inputContract.requiredInputKinds', { allowEmpty: false });
  const exact = ['assets', 'budget', 'constraints', 'goal', 'method'];
  if (stableStringify(requiredInputKinds) !== stableStringify(exact)) {
    throw new Error('inputContract 必须显式包含 goal/constraints/assets/method/budget 五类输入');
  }
  return {
    requiredInputKinds,
    constraintTypes: strings(value.constraintTypes, 'inputContract.constraintTypes', { allowEmpty: false }),
    assetTypes: strings(value.assetTypes, 'inputContract.assetTypes', { allowEmpty: false }),
    methodRefs: strings(value.methodRefs, 'inputContract.methodRefs', { allowEmpty: false }),
    budgetProfiles: unique(rows(value.budgetProfiles, 'inputContract.budgetProfiles').map(normalizeBudgetProfile), 'profileId', 'budgetProfiles'),
  };
}

function normalizeTeam(value, index) {
  object(value, `teams[${index}]`, TEAM_FIELDS);
  return {
    teamId: required(value.teamId, `teams[${index}].teamId`, 160),
    label: required(value.label, `teams[${index}].label`, 240),
    responsibility: required(value.responsibility, `teams[${index}].responsibility`, 1000),
    seatIds: strings(value.seatIds, `teams[${index}].seatIds`, { allowEmpty: false }),
  };
}

function normalizeSeatDelegation(value, index) {
  object(value, `seats[${index}].delegation`, SEAT_DELEGATION_FIELDS);
  const allowed = bool(value.allowed, `seats[${index}].delegation.allowed`);
  return {
    allowed,
    maxDepth: Number.isInteger(value.maxDepth) && value.maxDepth >= 0 ? value.maxDepth : (() => { throw new Error(`seats[${index}].delegation.maxDepth 必须是非负整数`); })(),
    subcontractAllowed: bool(value.subcontractAllowed, `seats[${index}].delegation.subcontractAllowed`),
    liabilityOwner: required(value.liabilityOwner, `seats[${index}].delegation.liabilityOwner`, 240),
    requiredResultArtifactIds: strings(value.requiredResultArtifactIds, `seats[${index}].delegation.requiredResultArtifactIds`),
    qualificationRefs: strings(value.qualificationRefs, `seats[${index}].delegation.qualificationRefs`),
    authorityRefs: strings(value.authorityRefs, `seats[${index}].delegation.authorityRefs`),
  };
}

function normalizeSeat(value, index) {
  object(value, `seats[${index}]`, SEAT_FIELDS);
  return {
    seatId: required(value.seatId, `seats[${index}].seatId`, 160),
    teamId: required(value.teamId, `seats[${index}].teamId`, 160),
    label: required(value.label, `seats[${index}].label`, 240),
    responsibility: required(value.responsibility, `seats[${index}].responsibility`, 1000),
    inputArtifactIds: strings(value.inputArtifactIds, `seats[${index}].inputArtifactIds`),
    outputArtifactIds: strings(value.outputArtifactIds, `seats[${index}].outputArtifactIds`, { allowEmpty: false }),
    gateIds: strings(value.gateIds, `seats[${index}].gateIds`),
    authorityRefs: strings(value.authorityRefs, `seats[${index}].authorityRefs`),
    requiredCapabilityIds: strings(value.requiredCapabilityIds, `seats[${index}].requiredCapabilityIds`, { allowEmpty: false }),
    eligibleExecutorKinds: strings(value.eligibleExecutorKinds, `seats[${index}].eligibleExecutorKinds`, { allowEmpty: false })
      .map(kind => enumValue(kind, EXECUTOR_KINDS, `seats[${index}].eligibleExecutorKinds`)),
    childSeatOf: optional(value.childSeatOf, 160),
    qualificationRefs: strings(value.qualificationRefs, `seats[${index}].qualificationRefs`),
    delegation: normalizeSeatDelegation(value.delegation, index),
  };
}

function normalizeArtifact(value, index) {
  object(value, `artifacts[${index}]`, ARTIFACT_FIELDS);
  return {
    artifactId: required(value.artifactId, `artifacts[${index}].artifactId`, 160),
    label: required(value.label, `artifacts[${index}].label`, 240),
    type: required(value.type, `artifacts[${index}].type`, 240),
    version: required(value.version, `artifacts[${index}].version`, 120),
    producedBySeatId: optional(value.producedBySeatId, 160),
    consumedBySeatIds: strings(value.consumedBySeatIds, `artifacts[${index}].consumedBySeatIds`),
    dependsOn: strings(value.dependsOn, `artifacts[${index}].dependsOn`),
    invalidates: strings(value.invalidates, `artifacts[${index}].invalidates`),
    truthOwner: required(value.truthOwner, `artifacts[${index}].truthOwner`, 240),
    evidenceRequirements: strings(value.evidenceRequirements, `artifacts[${index}].evidenceRequirements`, { allowEmpty: false }),
    licensePolicy: required(value.licensePolicy, `artifacts[${index}].licensePolicy`, 500),
    required: bool(value.required, `artifacts[${index}].required`, true),
  };
}

function normalizeGate(value, index) {
  object(value, `gates[${index}]`, GATE_FIELDS);
  return {
    gateId: required(value.gateId, `gates[${index}].gateId`, 160),
    label: required(value.label, `gates[${index}].label`, 240),
    artifactIds: strings(value.artifactIds, `gates[${index}].artifactIds`, { allowEmpty: false }),
    verificationRefs: strings(value.verificationRefs, `gates[${index}].verificationRefs`, { allowEmpty: false }),
    reviewRefs: strings(value.reviewRefs, `gates[${index}].reviewRefs`, { allowEmpty: false }),
    evaluationRefs: strings(value.evaluationRefs, `gates[${index}].evaluationRefs`),
    authorityRef: required(value.authorityRef, `gates[${index}].authorityRef`, 240),
    passState: required(value.passState, `gates[${index}].passState`, 120),
    failState: required(value.failState, `gates[${index}].failState`, 120),
    recoveryPointId: required(value.recoveryPointId, `gates[${index}].recoveryPointId`, 160),
    destructive: bool(value.destructive, `gates[${index}].destructive`),
    requiresHumanAuthority: bool(value.requiresHumanAuthority, `gates[${index}].requiresHumanAuthority`, true),
  };
}

function normalizeAuthority(value, index) {
  object(value, `authorities[${index}]`, AUTHORITY_FIELDS);
  const kind = enumValue(value.kind, ['human', 'system', 'external-entity'], `authorities[${index}].kind`);
  return {
    authorityRef: required(value.authorityRef, `authorities[${index}].authorityRef`, 240),
    kind,
    scope: required(value.scope, `authorities[${index}].scope`, 500),
    decisionTypes: strings(value.decisionTypes, `authorities[${index}].decisionTypes`, { allowEmpty: false }),
    cannotDelegate: bool(value.cannotDelegate, `authorities[${index}].cannotDelegate`, true),
    prohibitedSeatIds: strings(value.prohibitedSeatIds, `authorities[${index}].prohibitedSeatIds`),
  };
}

function normalizeRecovery(value, index) {
  object(value, `recoveryPoints[${index}]`, RECOVERY_FIELDS);
  return {
    recoveryPointId: required(value.recoveryPointId, `recoveryPoints[${index}].recoveryPointId`, 160),
    label: required(value.label, `recoveryPoints[${index}].label`, 240),
    resumeSeatIds: strings(value.resumeSeatIds, `recoveryPoints[${index}].resumeSeatIds`, { allowEmpty: false }),
    affectedArtifactIds: strings(value.affectedArtifactIds, `recoveryPoints[${index}].affectedArtifactIds`, { allowEmpty: false }),
    evidenceRequirements: strings(value.evidenceRequirements, `recoveryPoints[${index}].evidenceRequirements`, { allowEmpty: false }),
    authorityRef: required(value.authorityRef, `recoveryPoints[${index}].authorityRef`, 240),
  };
}

function normalizeRoutingPolicy(value, index) {
  object(value, `routingPolicies[${index}]`, ROUTING_POLICY_FIELDS);
  const mode = enumValue(value.mode, ['human-lock', 'proposal-only'], `routingPolicies[${index}].mode`);
  const requiresHumanDecision = bool(value.requiresHumanDecision, `routingPolicies[${index}].requiresHumanDecision`, true);
  if (!requiresHumanDecision) throw new Error('W82a routing policy 不得隐藏 AUTO decision');
  return {
    policyId: required(value.policyId, `routingPolicies[${index}].policyId`, 160),
    seatIds: strings(value.seatIds, `routingPolicies[${index}].seatIds`, { allowEmpty: false }),
    mode,
    requiresHumanDecision: true,
    evidenceRequirements: strings(value.evidenceRequirements, `routingPolicies[${index}].evidenceRequirements`, { allowEmpty: false }),
  };
}

function normalizeDelegationPolicy(value) {
  object(value, 'delegationPolicy', DELEGATION_POLICY_FIELDS);
  const policy = {
    maxDepth: Number.isInteger(value.maxDepth) && value.maxDepth >= 0 ? value.maxDepth : (() => { throw new Error('delegationPolicy.maxDepth 必须是非负整数'); })(),
    allowSubcontract: bool(value.allowSubcontract, 'delegationPolicy.allowSubcontract'),
    requireExplicitSubcontract: bool(value.requireExplicitSubcontract, 'delegationPolicy.requireExplicitSubcontract', true),
    preventCycles: bool(value.preventCycles, 'delegationPolicy.preventCycles', true),
    authorityDelegable: bool(value.authorityDelegable, 'delegationPolicy.authorityDelegable'),
    qualificationDelegable: bool(value.qualificationDelegable, 'delegationPolicy.qualificationDelegable'),
    parentLiabilityRetained: bool(value.parentLiabilityRetained, 'delegationPolicy.parentLiabilityRetained', true),
    costAccounting: enumValue(value.costAccounting, ['full-chain'], 'delegationPolicy.costAccounting'),
    provenanceRequired: bool(value.provenanceRequired, 'delegationPolicy.provenanceRequired', true),
    taskContractRequired: bool(value.taskContractRequired, 'delegationPolicy.taskContractRequired', true),
  };
  if (!policy.preventCycles || policy.authorityDelegable || policy.qualificationDelegable
    || !policy.parentLiabilityRetained || !policy.provenanceRequired || !policy.taskContractRequired) {
    throw new Error('delegationPolicy 违反 cycle/Authority/Qualification/liability/provenance/Task Contract 硬边界');
  }
  if (policy.allowSubcontract && !policy.requireExplicitSubcontract) throw new Error('subcontract 必须显式授权');
  return policy;
}

function normalizeArchaeology(value, index) {
  object(value, `archaeology[${index}]`, ARCHAEOLOGY_FIELDS);
  const decision = enumValue(value.decision, ARCHAEOLOGY_DECISIONS, `archaeology[${index}].decision`);
  const reasonClass = enumValue(value.reasonClass, ARCHAEOLOGY_REASONS, `archaeology[${index}].reasonClass`);
  const targetSeatIds = strings(value.targetSeatIds, `archaeology[${index}].targetSeatIds`);
  if (decision === 'remove' && targetSeatIds.length) throw new Error('移除的历史岗位不能继续指向 Seat');
  if (decision !== 'remove' && !targetSeatIds.length) throw new Error('保留/合并的历史岗位必须指向 Seat');
  if (decision === 'remove' && reasonClass !== 'legacy-friction') throw new Error('只有旧技术/交易摩擦可直接移除');
  return {
    sourceRole: required(value.sourceRole, `archaeology[${index}].sourceRole`, 240),
    decision,
    targetSeatIds,
    reasonClass,
    rationale: required(value.rationale, `archaeology[${index}].rationale`, 1000),
    evidenceRefs: strings(value.evidenceRefs, `archaeology[${index}].evidenceRefs`, { allowEmpty: false }),
  };
}

function normalizeExpertCapability(value, index = 0) {
  object(value, `expertCapabilities[${index}]`, EXPERT_FIELDS);
  if (value.schema !== EXPERT_CAPABILITY_SCHEMA) throw new Error(`未知 Expert Capability schema: ${value.schema || '空'}`);
  return {
    schema: EXPERT_CAPABILITY_SCHEMA,
    capabilityId: required(value.capabilityId, `expertCapabilities[${index}].capabilityId`, 200),
    version: required(value.version, `expertCapabilities[${index}].version`, 120),
    identity: required(value.identity, `expertCapabilities[${index}].identity`, 240),
    domain: required(value.domain, `expertCapabilities[${index}].domain`, 200),
    inputTypes: strings(value.inputTypes, `expertCapabilities[${index}].inputTypes`, { allowEmpty: false }),
    outputTypes: strings(value.outputTypes, `expertCapabilities[${index}].outputTypes`, { allowEmpty: false }),
    evidenceTypes: strings(value.evidenceTypes, `expertCapabilities[${index}].evidenceTypes`, { allowEmpty: false }),
    attention: strings(value.attention, `expertCapabilities[${index}].attention`, { allowEmpty: false }),
    decisions: strings(value.decisions, `expertCapabilities[${index}].decisions`, { allowEmpty: false }),
    negativeKnowledge: strings(value.negativeKnowledge, `expertCapabilities[${index}].negativeKnowledge`, { allowEmpty: false }),
    gateRefs: strings(value.gateRefs, `expertCapabilities[${index}].gateRefs`),
    exceptionPolicy: required(value.exceptionPolicy, `expertCapabilities[${index}].exceptionPolicy`, 1000),
    authorityBoundary: required(value.authorityBoundary, `expertCapabilities[${index}].authorityBoundary`, 1000),
    permissionScope: strings(value.permissionScope, `expertCapabilities[${index}].permissionScope`, { allowEmpty: false }),
    styleIdentity: required(value.styleIdentity, `expertCapabilities[${index}].styleIdentity`, 240),
    provenance: clonePlain(object(value.provenance, `expertCapabilities[${index}].provenance`, Object.keys(value.provenance || {})), `expertCapabilities[${index}].provenance`),
  };
}

function assertRefs(values, known, label) {
  for (const value of values) if (!known.has(value)) throw new Error(`${label} 引用未知身份: ${value}`);
}

function assertAcyclic(items, idKey, edges, label) {
  const map = new Map(items.map(item => [item[idKey], item]));
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) throw new Error(`${label} 存在 cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of edges(map.get(id))) visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of map.keys()) visit(id);
}

function topologicalArtifacts(artifacts) {
  const byId = new Map(artifacts.map(item => [item.artifactId, item]));
  const remaining = new Map(artifacts.map(item => [item.artifactId, new Set(item.dependsOn)]));
  const order = [];
  while (remaining.size) {
    const ready = [...remaining.entries()].filter(([, deps]) => !deps.size).map(([id]) => id).sort();
    if (!ready.length) throw new Error('Artifact DAG 存在 cycle');
    for (const id of ready) {
      order.push(id);
      remaining.delete(id);
      for (const deps of remaining.values()) deps.delete(id);
    }
  }
  return order.map(id => byId.get(id));
}

function normalizeWorkflowPackage(input) {
  rejectSecrets(input);
  object(input, 'Workflow Package', PACKAGE_FIELDS);
  if (input.schema !== WORKFLOW_PACKAGE_SCHEMA) throw new Error(`未知 Workflow Package schema: ${input.schema || '空'}`);
  const workflow = {
    schema: WORKFLOW_PACKAGE_SCHEMA,
    workflowId: required(input.workflowId, 'workflowId', 200),
    version: required(input.version, 'version', 120),
    name: required(input.name, 'name', 300),
    domain: required(input.domain, 'domain', 200),
    deliverableType: required(input.deliverableType, 'deliverableType', 240),
    inputContract: normalizeInputContract(input.inputContract),
    teams: unique(rows(input.teams, 'teams').map(normalizeTeam), 'teamId', 'teams'),
    seats: unique(rows(input.seats, 'seats').map(normalizeSeat), 'seatId', 'seats'),
    artifacts: unique(rows(input.artifacts, 'artifacts').map(normalizeArtifact), 'artifactId', 'artifacts'),
    gates: unique(rows(input.gates, 'gates').map(normalizeGate), 'gateId', 'gates'),
    authorities: unique(rows(input.authorities, 'authorities').map(normalizeAuthority), 'authorityRef', 'authorities'),
    recoveryPoints: unique(rows(input.recoveryPoints, 'recoveryPoints').map(normalizeRecovery), 'recoveryPointId', 'recoveryPoints'),
    routingPolicies: unique(rows(input.routingPolicies, 'routingPolicies').map(normalizeRoutingPolicy), 'policyId', 'routingPolicies'),
    delegationPolicy: normalizeDelegationPolicy(input.delegationPolicy),
    archaeology: unique(rows(input.archaeology, 'archaeology').map(normalizeArchaeology), 'sourceRole', 'archaeology'),
    expertCapabilities: unique(rows(input.expertCapabilities, 'expertCapabilities').map(normalizeExpertCapability), 'capabilityId', 'expertCapabilities'),
    provenance: clonePlain(object(input.provenance, 'provenance', Object.keys(input.provenance || {})), 'provenance'),
  };
  if (!workflow.teams.length || !workflow.seats.length || !workflow.artifacts.length || !workflow.gates.length
    || !workflow.authorities.length || !workflow.recoveryPoints.length || !workflow.routingPolicies.length || !workflow.archaeology.length) {
    throw new Error('Workflow Package 缺 Team/Seat/Artifact/Gate/Authority/Recovery/Routing/Archaeology 必需结构');
  }
  const teams = new Map(workflow.teams.map(item => [item.teamId, item]));
  const seats = new Map(workflow.seats.map(item => [item.seatId, item]));
  const artifacts = new Map(workflow.artifacts.map(item => [item.artifactId, item]));
  const gates = new Map(workflow.gates.map(item => [item.gateId, item]));
  const authorities = new Map(workflow.authorities.map(item => [item.authorityRef, item]));
  const recoveries = new Map(workflow.recoveryPoints.map(item => [item.recoveryPointId, item]));
  for (const team of workflow.teams) {
    assertRefs(team.seatIds, new Set(seats.keys()), `Team ${team.teamId}`);
    for (const seatId of team.seatIds) if (seats.get(seatId).teamId !== team.teamId) throw new Error(`Seat ${seatId} 的 teamId 与 Team 清单不一致`);
  }
  for (const seat of workflow.seats) {
    const memberships = workflow.teams.filter(team => team.seatIds.includes(seat.seatId));
    if (memberships.length !== 1 || memberships[0].teamId !== seat.teamId) {
      throw new Error(`Seat ${seat.seatId} 必须且只能属于声明的一个 Team`);
    }
  }
  for (const seat of workflow.seats) {
    if (!teams.has(seat.teamId)) throw new Error(`Seat ${seat.seatId} 引用未知 Team`);
    assertRefs(seat.inputArtifactIds.concat(seat.outputArtifactIds, seat.delegation.requiredResultArtifactIds), new Set(artifacts.keys()), `Seat ${seat.seatId}`);
    assertRefs(seat.gateIds, new Set(gates.keys()), `Seat ${seat.seatId}`);
    assertRefs(seat.authorityRefs.concat(seat.delegation.authorityRefs), new Set(authorities.keys()), `Seat ${seat.seatId}`);
    if (seat.delegation.maxDepth > workflow.delegationPolicy.maxDepth) throw new Error(`Seat ${seat.seatId} 委托深度超过 Workflow 上限`);
    if (seat.delegation.subcontractAllowed && !workflow.delegationPolicy.allowSubcontract) throw new Error(`Seat ${seat.seatId} 未获 subcontract 权限`);
    if (seat.childSeatOf) {
      if (!seats.has(seat.childSeatOf)) throw new Error(`Child Seat ${seat.seatId} 引用未知 Parent Seat`);
      if (!seat.inputArtifactIds.length || !seat.outputArtifactIds.length || !seat.gateIds.length || !seat.authorityRefs.length || !seat.responsibility) {
        throw new Error(`Child Seat ${seat.seatId} 缺独立职责/输入/Artifact/Gate/Authority`);
      }
    }
  }
  assertAcyclic(workflow.seats, 'seatId', seat => seat.childSeatOf ? [seat.childSeatOf] : [], 'Child Seat graph');
  for (const artifact of workflow.artifacts) {
    if (artifact.producedBySeatId && !seats.has(artifact.producedBySeatId)) throw new Error(`Artifact ${artifact.artifactId} 引用未知 producer Seat`);
    assertRefs(artifact.consumedBySeatIds, new Set(seats.keys()), `Artifact ${artifact.artifactId}`);
    assertRefs(artifact.dependsOn.concat(artifact.invalidates), new Set(artifacts.keys()), `Artifact ${artifact.artifactId}`);
    if (artifact.dependsOn.includes(artifact.artifactId) || artifact.invalidates.includes(artifact.artifactId)) throw new Error(`Artifact ${artifact.artifactId} 不得自引用`);
  }
  topologicalArtifacts(workflow.artifacts);
  for (const gate of workflow.gates) {
    assertRefs(gate.artifactIds, new Set(artifacts.keys()), `Gate ${gate.gateId}`);
    if (!authorities.has(gate.authorityRef)) throw new Error(`Gate ${gate.gateId} 引用未知 Authority`);
    if (!recoveries.has(gate.recoveryPointId)) throw new Error(`Gate ${gate.gateId} 引用未知 Recovery`);
    const authority = authorities.get(gate.authorityRef);
    if ((gate.destructive || gate.requiresHumanAuthority) && authority.kind !== 'human') throw new Error(`Gate ${gate.gateId} 必须由 Human Authority 持有`);
    if (gate.requiresHumanAuthority && !authority.cannotDelegate) throw new Error(`Gate ${gate.gateId} 的 Human Authority 必须不可委托`);
  }
  for (const recovery of workflow.recoveryPoints) {
    assertRefs(recovery.resumeSeatIds, new Set(seats.keys()), `Recovery ${recovery.recoveryPointId}`);
    assertRefs(recovery.affectedArtifactIds, new Set(artifacts.keys()), `Recovery ${recovery.recoveryPointId}`);
    if (!authorities.has(recovery.authorityRef)) throw new Error(`Recovery ${recovery.recoveryPointId} 引用未知 Authority`);
  }
  for (const authority of workflow.authorities) {
    assertRefs(authority.prohibitedSeatIds, new Set(seats.keys()), `Authority ${authority.authorityRef}`);
  }
  for (const policy of workflow.routingPolicies) assertRefs(policy.seatIds, new Set(seats.keys()), `Routing ${policy.policyId}`);
  for (const seat of workflow.seats) {
    const policies = workflow.routingPolicies.filter(policy => policy.seatIds.includes(seat.seatId));
    if (policies.length !== 1) throw new Error(`Seat ${seat.seatId} 必须且只能属于一个 Routing Policy`);
  }
  const explained = new Set(workflow.archaeology.flatMap(item => item.targetSeatIds));
  for (const row of workflow.archaeology) assertRefs(row.targetSeatIds, new Set(seats.keys()), `Archaeology ${row.sourceRole}`);
  for (const seat of workflow.seats) if (!explained.has(seat.seatId)) throw new Error(`Seat ${seat.seatId} 缺组织考古来源与理由`);
  for (const capability of workflow.expertCapabilities) {
    assertRefs(capability.gateRefs, new Set(gates.keys()), `Expert Capability ${capability.capabilityId}`);
  }
  return deepFreeze(workflow);
}

function normalizeCost(value, label) {
  object(value, label, COST_FIELDS);
  const status = enumValue(value.status, BUDGET_STATES, `${label}.status`);
  return {
    status,
    currency: required(value.currency, `${label}.currency`, 24),
    amount: status === 'known' ? finite(value.amount, `${label}.amount`) : null,
  };
}

function normalizeExecutor(value, index) {
  object(value, `capabilitySnapshot.executors[${index}]`, EXECUTOR_FIELDS);
  const kind = enumValue(value.kind, EXECUTOR_KINDS, `capabilitySnapshot.executors[${index}].kind`);
  const row = {
    executorRef: required(value.executorRef, `capabilitySnapshot.executors[${index}].executorRef`, 240),
    kind,
    capabilityIds: strings(value.capabilityIds, `capabilitySnapshot.executors[${index}].capabilityIds`, { allowEmpty: false }),
    qualificationRefs: strings(value.qualificationRefs, `capabilitySnapshot.executors[${index}].qualificationRefs`),
    harnessRef: optional(value.harnessRef, 240),
    toolAdapterRef: optional(value.toolAdapterRef, 240),
    providerRef: optional(value.providerRef, 240),
    status: enumValue(value.status, EXECUTOR_STATES, `capabilitySnapshot.executors[${index}].status`),
    version: required(value.version, `capabilitySnapshot.executors[${index}].version`, 160),
    estimatedCost: normalizeCost(value.estimatedCost, `capabilitySnapshot.executors[${index}].estimatedCost`),
  };
  if (kind === 'agent' && !row.harnessRef) throw new Error(`Agent Executor ${row.executorRef} 必须声明 Harness`);
  if (kind === 'tool' && !row.toolAdapterRef) throw new Error(`Tool Executor ${row.executorRef} 必须声明 Tool Adapter`);
  if (kind === 'model' && !row.providerRef) throw new Error(`Model Executor ${row.executorRef} 必须声明 Provider`);
  return row;
}

function normalizeCompileRequest(input, workflow) {
  rejectSecrets(input);
  object(input, 'Compile Request', REQUEST_FIELDS);
  if (input.schema !== ORGANIZATION_COMPILE_REQUEST_SCHEMA) throw new Error(`未知 Compile Request schema: ${input.schema || '空'}`);
  const workflowRef = object(input.workflowRef, 'workflowRef', WORKFLOW_REF_FIELDS);
  const goal = object(input.goal, 'goal', GOAL_FIELDS);
  const method = object(input.method, 'method', METHOD_FIELDS);
  const budget = object(input.budget, 'budget', BUDGET_FIELDS);
  const capabilitySnapshot = object(input.capabilitySnapshot, 'capabilitySnapshot', CAPABILITY_SNAPSHOT_FIELDS);
  const request = {
    schema: ORGANIZATION_COMPILE_REQUEST_SCHEMA,
    requestId: required(input.requestId, 'requestId', 200),
    workflowRef: {
      workflowId: required(workflowRef.workflowId, 'workflowRef.workflowId', 200),
      version: required(workflowRef.version, 'workflowRef.version', 120),
    },
    goal: {
      goalId: required(goal.goalId, 'goal.goalId', 200),
      statement: required(goal.statement, 'goal.statement', 2000),
      deliverableType: required(goal.deliverableType, 'goal.deliverableType', 240),
    },
    constraints: unique(rows(input.constraints, 'constraints').map((row, index) => {
      object(row, `constraints[${index}]`, CONSTRAINT_FIELDS);
      return {
        constraintId: required(row.constraintId, `constraints[${index}].constraintId`, 200),
        type: required(row.type, `constraints[${index}].type`, 160),
        valueRef: required(row.valueRef, `constraints[${index}].valueRef`, 500),
        sourceRef: required(row.sourceRef, `constraints[${index}].sourceRef`, 500),
      };
    }), 'constraintId', 'constraints'),
    assets: unique(rows(input.assets, 'assets').map((row, index) => {
      object(row, `assets[${index}]`, ASSET_FIELDS);
      return {
        assetId: required(row.assetId, `assets[${index}].assetId`, 240),
        type: required(row.type, `assets[${index}].type`, 240),
        version: required(row.version, `assets[${index}].version`, 160),
        sourceRef: required(row.sourceRef, `assets[${index}].sourceRef`, 500),
      };
    }), 'assetId', 'assets'),
    method: {
      methodId: required(method.methodId, 'method.methodId', 240),
      version: required(method.version, 'method.version', 160),
      sourceRef: required(method.sourceRef, 'method.sourceRef', 500),
    },
    budget: {
      profileId: required(budget.profileId, 'budget.profileId', 160),
      currency: required(budget.currency, 'budget.currency', 24),
      limit: budget.status === 'known' ? finite(budget.limit, 'budget.limit') : null,
      status: enumValue(budget.status, BUDGET_STATES, 'budget.status'),
    },
    capabilitySnapshot: {
      snapshotId: required(capabilitySnapshot.snapshotId, 'capabilitySnapshot.snapshotId', 240),
      executors: unique(rows(capabilitySnapshot.executors, 'capabilitySnapshot.executors').map(normalizeExecutor), 'executorRef', 'executors'),
    },
    routingLocks: unique(rows(input.routingLocks, 'routingLocks').map((row, index) => {
      object(row, `routingLocks[${index}]`, ROUTING_LOCK_FIELDS);
      return {
        seatId: required(row.seatId, `routingLocks[${index}].seatId`, 160),
        executorRef: required(row.executorRef, `routingLocks[${index}].executorRef`, 240),
        authorityRef: required(row.authorityRef, `routingLocks[${index}].authorityRef`, 240),
        reason: required(row.reason, `routingLocks[${index}].reason`, 800),
      };
    }), 'seatId', 'routingLocks'),
    authorityBindings: unique(rows(input.authorityBindings, 'authorityBindings').map((row, index) => {
      object(row, `authorityBindings[${index}]`, AUTHORITY_BINDING_FIELDS);
      return {
        authorityRef: required(row.authorityRef, `authorityBindings[${index}].authorityRef`, 240),
        actorRef: required(row.actorRef, `authorityBindings[${index}].actorRef`, 240),
        actorKind: enumValue(row.actorKind, ['human', 'system', 'external-entity'], `authorityBindings[${index}].actorKind`),
      };
    }), 'authorityRef', 'authorityBindings'),
    provenance: clonePlain(object(input.provenance, 'provenance', Object.keys(input.provenance || {})), 'provenance'),
  };
  if (!request.constraints.length || !request.assets.length) throw new Error('Compile Request 必须提供非空 Constraints 与 Assets');
  if (request.workflowRef.workflowId !== workflow.workflowId || request.workflowRef.version !== workflow.version) throw new Error('Compile Request 的 Workflow 身份/版本不匹配');
  if (request.goal.deliverableType !== workflow.deliverableType) throw new Error('目标交付物类型不匹配 Workflow');
  const constraintTypes = new Set(workflow.inputContract.constraintTypes);
  for (const item of request.constraints) if (!constraintTypes.has(item.type)) throw new Error(`约束类型未获 Workflow 允许: ${item.type}`);
  const assetTypes = new Set(workflow.inputContract.assetTypes);
  for (const item of request.assets) if (!assetTypes.has(item.type)) throw new Error(`资产类型未获 Workflow 允许: ${item.type}`);
  if (!workflow.inputContract.methodRefs.includes(request.method.methodId)) throw new Error(`Method 未获 Workflow 允许: ${request.method.methodId}`);
  const budgetProfile = workflow.inputContract.budgetProfiles.find(row => row.profileId === request.budget.profileId);
  if (!budgetProfile) throw new Error(`Budget Profile 不存在: ${request.budget.profileId}`);
  if (budgetProfile.currency !== request.budget.currency) throw new Error('Budget 币种与 Profile 不一致');
  if (budgetProfile.status === 'known' && request.budget.status === 'known' && request.budget.limit > budgetProfile.maxAmount) throw new Error('Budget 超过 Workflow Profile 上限');
  const seatIds = new Set(workflow.seats.map(item => item.seatId));
  const executorRefs = new Set(request.capabilitySnapshot.executors.map(item => item.executorRef));
  const authorityRefs = new Set(workflow.authorities.map(item => item.authorityRef));
  for (const lock of request.routingLocks) {
    if (!seatIds.has(lock.seatId)) throw new Error(`Routing Lock 引用未知 Seat: ${lock.seatId}`);
    if (!executorRefs.has(lock.executorRef)) throw new Error(`Routing Lock 引用未知 Executor: ${lock.executorRef}`);
    if (!authorityRefs.has(lock.authorityRef)) throw new Error(`Routing Lock 引用未知 Authority: ${lock.authorityRef}`);
    const routingAuthority = workflow.authorities.find(item => item.authorityRef === lock.authorityRef);
    if (routingAuthority.kind !== 'human' || !routingAuthority.decisionTypes.includes('routing')) throw new Error(`Routing Lock 必须来自具 routing 权限的 Human Authority: ${lock.authorityRef}`);
  }
  for (const binding of request.authorityBindings) {
    const authority = workflow.authorities.find(item => item.authorityRef === binding.authorityRef);
    if (!authority) throw new Error(`Authority Binding 引用未知 Authority: ${binding.authorityRef}`);
    if (authority.kind !== binding.actorKind) throw new Error(`Authority Binding 类型不匹配: ${binding.authorityRef}`);
  }
  return deepFreeze(request);
}

function executorDecision(seat, executors, lock) {
  const candidates = executors.filter(executor => {
    if (!seat.eligibleExecutorKinds.includes(executor.kind)) return false;
    if (!seat.requiredCapabilityIds.every(id => executor.capabilityIds.includes(id))) return false;
    if (!seat.qualificationRefs.every(id => executor.qualificationRefs.includes(id))) return false;
    return ['available', 'degraded'].includes(executor.status);
  }).map(executor => executor.executorRef).sort();
  if (!lock) return { candidates, selectedExecutorRef: null, blocker: 'ROUTING_DECISION_REQUIRED' };
  if (!candidates.includes(lock.executorRef)) return { candidates, selectedExecutorRef: null, blocker: 'LOCKED_EXECUTOR_INELIGIBLE' };
  return { candidates, selectedExecutorRef: lock.executorRef, blocker: '' };
}

function compileOrganization(workflowInput, requestInput) {
  const workflow = normalizeWorkflowPackage(workflowInput);
  const request = normalizeCompileRequest(requestInput, workflow);
  const locks = new Map(request.routingLocks.map(item => [item.seatId, item]));
  const bindings = new Map(request.authorityBindings.map(item => [item.authorityRef, item]));
  const blockers = [];
  const warnings = [];
  const seatInstances = workflow.seats.map(seat => {
    const decision = executorDecision(seat, request.capabilitySnapshot.executors, locks.get(seat.seatId));
    if (decision.blocker) blockers.push({ code: decision.blocker, subjectRef: seat.seatId, detail: decision.candidates.length ? '需要显式人工 routing lock' : '无合格 Executor' });
    return {
      seatInstanceId: `${request.requestId}:seat:${seat.seatId}`,
      seatId: seat.seatId,
      teamId: seat.teamId,
      responsibility: seat.responsibility,
      childSeatOf: seat.childSeatOf,
      candidates: decision.candidates,
      selectedExecutorRef: decision.selectedExecutorRef,
      delegation: seat.delegation,
      runtimeOwner: 'W73',
    };
  });
  for (const authority of workflow.authorities) {
    const binding = bindings.get(authority.authorityRef);
    if (!binding) blockers.push({ code: 'AUTHORITY_UNBOUND', subjectRef: authority.authorityRef, detail: 'Authority 未绑定责任主体' });
    else if (authority.kind === 'human' && !binding.actorRef.startsWith('human:')) blockers.push({ code: 'HUMAN_AUTHORITY_REQUIRED', subjectRef: authority.authorityRef, detail: 'Human Authority 必须绑定 human:* actor' });
    else {
      for (const seatId of authority.prohibitedSeatIds) {
        const selectedExecutor = seatInstances.find(item => item.seatId === seatId)?.selectedExecutorRef;
        if (selectedExecutor && selectedExecutor === binding.actorRef) blockers.push({ code: 'AUTHORITY_SEPARATION_VIOLATION', subjectRef: authority.authorityRef, detail: `Authority actor 同时占据禁止席位 ${seatId}` });
      }
    }
  }
  const selected = new Map(seatInstances.filter(item => item.selectedExecutorRef).map(item => [item.seatId, item.selectedExecutorRef]));
  const executorsByRef = new Map(request.capabilitySnapshot.executors.map(item => [item.executorRef, item]));
  const selectedCosts = [...selected.values()].map(ref => executorsByRef.get(ref).estimatedCost);
  let costStatus = request.budget.status;
  let estimatedAmount = 0;
  if (request.budget.status === 'unknown' || selectedCosts.some(item => item.status === 'unknown')) {
    costStatus = 'unknown';
    estimatedAmount = null;
    warnings.push({ code: 'BUDGET_UNKNOWN', subjectRef: request.budget.profileId, detail: '缺失成本不得补零' });
  } else {
    const mismatched = selectedCosts.find(item => item.currency !== request.budget.currency);
    if (mismatched) blockers.push({ code: 'BUDGET_CURRENCY_MISMATCH', subjectRef: request.budget.profileId, detail: 'Executor 成本币种不一致' });
    else {
      estimatedAmount = selectedCosts.reduce((sum, item) => sum + item.amount, 0);
      if (estimatedAmount > request.budget.limit) blockers.push({ code: 'BUDGET_EXCEEDED', subjectRef: request.budget.profileId, detail: `${estimatedAmount} > ${request.budget.limit}` });
    }
  }
  const artifactDag = topologicalArtifacts(workflow.artifacts).map((artifact, index) => ({
    sequence: index + 1,
    artifactId: artifact.artifactId,
    type: artifact.type,
    version: artifact.version,
    producerSeatInstanceId: artifact.producedBySeatId ? `${request.requestId}:seat:${artifact.producedBySeatId}` : null,
    consumerSeatInstanceIds: artifact.consumedBySeatIds.map(id => `${request.requestId}:seat:${id}`),
    dependsOn: artifact.dependsOn,
    invalidates: artifact.invalidates,
    truthOwner: artifact.truthOwner,
    required: artifact.required,
  }));
  const planCore = {
    schema: EXECUTION_PLAN_SCHEMA,
    requestId: request.requestId,
    workflowRef: request.workflowRef,
    inputSnapshot: {
      goal: request.goal,
      constraints: request.constraints,
      assets: request.assets,
      method: request.method,
      budget: request.budget,
      capabilitySnapshotId: request.capabilitySnapshot.snapshotId,
    },
    teamInstances: workflow.teams.map(team => ({
      teamInstanceId: `${request.requestId}:team:${team.teamId}`,
      teamId: team.teamId,
      responsibility: team.responsibility,
      seatInstanceIds: team.seatIds.map(id => `${request.requestId}:seat:${id}`),
    })),
    seatInstances,
    artifactDag,
    gateSchedule: workflow.gates.map((gate, index) => ({
      sequence: index + 1,
      gateId: gate.gateId,
      artifactIds: gate.artifactIds,
      layers: {
        verification: gate.verificationRefs,
        review: gate.reviewRefs,
        evaluation: gate.evaluationRefs,
        authority: gate.authorityRef,
      },
      authorityBinding: bindings.get(gate.authorityRef) || null,
      automaticAuthority: false,
      passState: gate.passState,
      failState: gate.failState,
      recoveryPointId: gate.recoveryPointId,
    })),
    authoritySchedule: workflow.authorities.map(authority => ({ ...authority, binding: bindings.get(authority.authorityRef) || null })),
    routing: seatInstances.map(item => ({
      seatId: item.seatId,
      candidates: item.candidates,
      selectedExecutorRef: item.selectedExecutorRef,
      lock: locks.get(item.seatId) || null,
      automaticSelection: false,
    })),
    budgetEnvelope: {
      profileId: request.budget.profileId,
      currency: request.budget.currency,
      limit: request.budget.limit,
      status: costStatus,
      estimatedAmount,
    },
    recoveryPoints: workflow.recoveryPoints,
    delegationPolicy: workflow.delegationPolicy,
    blockers: blockers.sort((a, b) => `${a.code}:${a.subjectRef}`.localeCompare(`${b.code}:${b.subjectRef}`)),
    warnings: warnings.sort((a, b) => `${a.code}:${a.subjectRef}`.localeCompare(`${b.code}:${b.subjectRef}`)),
    compilerBoundary: {
      compilerOwner: 'W82',
      runtimeOwner: 'W73',
      agentHarnessOwner: 'W66',
      externalToolOwner: 'W79',
      executes: false,
      publishes: false,
    },
    provenance: {
      workflowDigest: digest(workflow),
      requestDigest: digest(request),
      source: request.provenance,
    },
  };
  const status = blockers.length ? 'BLOCKED' : warnings.some(item => item.code === 'BUDGET_UNKNOWN') ? 'UNKNOWN' : 'READY';
  const planDigest = digest({ ...planCore, status });
  return deepFreeze({ ...planCore, status, planId: `plan:sha256:${planDigest}`, planDigest });
}

function normalizeCheckResult(value, label) {
  object(value, label, CHECK_RESULT_FIELDS);
  return {
    checkRef: required(value.checkRef, `${label}.checkRef`, 240),
    status: enumValue(value.status, RESULT_STATES, `${label}.status`),
    evidenceRefs: strings(value.evidenceRefs, `${label}.evidenceRefs`, { allowEmpty: false }),
    message: optional(value.message, 1000),
  };
}

function evaluateEvidenceBackedTransition(gateInput, input) {
  const gate = normalizeGate(gateInput, 0);
  rejectSecrets(input);
  object(input, 'Transition Evidence', TRANSITION_FIELDS);
  if (input.schema !== TRANSITION_EVIDENCE_SCHEMA) throw new Error(`未知 Transition Evidence schema: ${input.schema || '空'}`);
  if (input.gateId !== gate.gateId) throw new Error('Transition Evidence gateId 不匹配');
  const transitionId = required(input.transitionId, 'transitionId', 240);
  const artifactVersions = clonePlain(object(input.artifactVersions, 'artifactVersions', Object.keys(input.artifactVersions || {})), 'artifactVersions');
  for (const artifactId of gate.artifactIds) if (!required(artifactVersions[artifactId], `artifactVersions.${artifactId}`, 160)) throw new Error(`缺 Artifact version: ${artifactId}`);
  const groups = {
    verification: rows(input.verificationResults, 'verificationResults').map((item, index) => normalizeCheckResult(item, `verificationResults[${index}]`)),
    review: rows(input.reviewResults, 'reviewResults').map((item, index) => normalizeCheckResult(item, `reviewResults[${index}]`)),
    evaluation: rows(input.evaluationResults, 'evaluationResults').map((item, index) => normalizeCheckResult(item, `evaluationResults[${index}]`)),
  };
  const reasons = [];
  for (const [kind, requiredRefs] of [['verification', gate.verificationRefs], ['review', gate.reviewRefs], ['evaluation', gate.evaluationRefs]]) {
    const byRef = new Map(groups[kind].map(item => [item.checkRef, item]));
    for (const ref of requiredRefs) {
      const result = byRef.get(ref);
      if (!result) reasons.push(`${kind.toUpperCase()}_MISSING:${ref}`);
      else if (result.status === 'failed') reasons.push(`${kind.toUpperCase()}_FAILED:${ref}`);
      else if (result.status === 'unknown') reasons.push(`${kind.toUpperCase()}_UNKNOWN:${ref}`);
    }
  }
  let authorityDecision = null;
  if (input.authorityDecision != null) {
    object(input.authorityDecision, 'authorityDecision', AUTHORITY_DECISION_FIELDS);
    authorityDecision = {
      authorityRef: required(input.authorityDecision.authorityRef, 'authorityDecision.authorityRef', 240),
      actorRef: required(input.authorityDecision.actorRef, 'authorityDecision.actorRef', 240),
      decision: enumValue(input.authorityDecision.decision, ['approve', 'reject'], 'authorityDecision.decision'),
      evidenceRefs: strings(input.authorityDecision.evidenceRefs, 'authorityDecision.evidenceRefs', { allowEmpty: false }),
      reason: required(input.authorityDecision.reason, 'authorityDecision.reason', 1000),
    };
    if (authorityDecision.authorityRef !== gate.authorityRef) reasons.push('AUTHORITY_MISMATCH');
    if (gate.requiresHumanAuthority && !authorityDecision.actorRef.startsWith('human:')) reasons.push('HUMAN_AUTHORITY_REQUIRED');
  } else reasons.push('AUTHORITY_REQUIRED');
  const failed = reasons.some(reason => reason.includes('_FAILED') || ['AUTHORITY_MISMATCH', 'HUMAN_AUTHORITY_REQUIRED'].includes(reason));
  const unknown = reasons.some(reason => reason.includes('_MISSING') || reason.includes('_UNKNOWN') || reason === 'AUTHORITY_REQUIRED');
  let status = failed ? 'BLOCKED' : unknown ? 'UNKNOWN' : authorityDecision.decision === 'reject' ? 'BLOCKED' : 'APPROVED';
  if (authorityDecision?.decision === 'reject') reasons.push('AUTHORITY_REJECTED');
  const result = {
    schema: TRANSITION_RESULT_SCHEMA,
    transitionId,
    gateId: gate.gateId,
    status,
    nextState: status === 'APPROVED' ? gate.passState : gate.failState,
    recoveryPointId: status === 'APPROVED' ? '' : gate.recoveryPointId,
    reasons: [...new Set(reasons)].sort(),
    evidence: groups,
    authorityDecision,
    automaticAuthority: false,
  };
  return deepFreeze(result);
}

function affectedArtifacts(workflowOrPlan, changedArtifactIds) {
  const artifacts = workflowOrPlan.schema === EXECUTION_PLAN_SCHEMA ? workflowOrPlan.artifactDag : normalizeWorkflowPackage(workflowOrPlan).artifacts;
  const known = new Set(artifacts.map(item => item.artifactId));
  const changed = strings(changedArtifactIds, 'changedArtifactIds', { allowEmpty: false });
  assertRefs(changed, known, 'changedArtifactIds');
  const affected = new Set(changed);
  let moved = true;
  while (moved) {
    moved = false;
    for (const artifact of artifacts) {
      if (!affected.has(artifact.artifactId)) continue;
      for (const target of artifact.invalidates || []) {
        if (!affected.has(target)) {
          affected.add(target);
          moved = true;
        }
      }
    }
    for (const artifact of artifacts) {
      if (affected.has(artifact.artifactId)) continue;
      if ((artifact.dependsOn || []).some(id => affected.has(id))) {
        affected.add(artifact.artifactId);
        moved = true;
      }
    }
  }
  return Object.freeze(artifacts.map(item => item.artifactId).filter(id => affected.has(id)));
}

function composeExpertCapabilities(workflowInput, input) {
  const workflow = normalizeWorkflowPackage(workflowInput);
  rejectSecrets(input);
  object(input, 'Expert Composition', COMPOSITION_FIELDS);
  if (input.schema !== EXPERT_COMPOSITION_SCHEMA) throw new Error(`未知 Expert Composition schema: ${input.schema || '空'}`);
  const seats = new Map(workflow.seats.map(item => [item.seatId, item]));
  const capabilities = new Map(workflow.expertCapabilities.map(item => [item.capabilityId, item]));
  const bindings = unique(rows(input.bindings, 'bindings').map((row, index) => {
    object(row, `bindings[${index}]`, COMPOSITION_BINDING_FIELDS);
    const binding = {
      seatId: required(row.seatId, `bindings[${index}].seatId`, 160),
      capabilityId: required(row.capabilityId, `bindings[${index}].capabilityId`, 200),
      requiredInputTypes: strings(row.requiredInputTypes, `bindings[${index}].requiredInputTypes`, { allowEmpty: false }),
      requiredOutputTypes: strings(row.requiredOutputTypes, `bindings[${index}].requiredOutputTypes`, { allowEmpty: false }),
    };
    const seat = seats.get(binding.seatId);
    const capability = capabilities.get(binding.capabilityId);
    if (!seat) throw new Error(`Expert Composition 引用未知 Seat: ${binding.seatId}`);
    if (!capability) throw new Error(`Expert Composition 引用未知 Capability: ${binding.capabilityId}`);
    assertRefs(binding.requiredInputTypes, new Set(capability.inputTypes), `Capability ${binding.capabilityId} input`);
    assertRefs(binding.requiredOutputTypes, new Set(capability.outputTypes), `Capability ${binding.capabilityId} output`);
    return binding;
  }), 'seatId', 'bindings');
  const components = bindings.map(binding => {
    const capability = capabilities.get(binding.capabilityId);
    return {
      seatId: binding.seatId,
      capabilityId: capability.capabilityId,
      version: capability.version,
      identity: capability.identity,
      styleIdentity: capability.styleIdentity,
      permissionScope: capability.permissionScope,
      authorityBoundary: capability.authorityBoundary,
      implementationEmbedded: false,
    };
  });
  const result = {
    schema: EXPERT_COMPOSITION_SCHEMA,
    compositionId: required(input.compositionId, 'compositionId', 240),
    workflowRef: { workflowId: workflow.workflowId, version: workflow.version },
    bindings,
    components,
    permissionsExpanded: false,
    identitiesMerged: false,
    provenance: clonePlain(object(input.provenance, 'provenance', Object.keys(input.provenance || {})), 'provenance'),
  };
  return deepFreeze({ ...result, compositionDigest: digest(result) });
}

module.exports = {
  WORKFLOW_PACKAGE_SCHEMA,
  ORGANIZATION_COMPILE_REQUEST_SCHEMA,
  EXECUTION_PLAN_SCHEMA,
  TRANSITION_EVIDENCE_SCHEMA,
  TRANSITION_RESULT_SCHEMA,
  EXPERT_CAPABILITY_SCHEMA,
  EXPERT_COMPOSITION_SCHEMA,
  normalizeWorkflowPackage,
  compileOrganization,
  evaluateEvidenceBackedTransition,
  affectedArtifacts,
  composeExpertCapabilities,
  stableStringify,
};
