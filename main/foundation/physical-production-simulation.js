'use strict';

const crypto = require('crypto');
const { deepFreeze, isPlainObject } = require('./plain-value');

const CAPABILITY_SCHEMA = 'mazz.physical-capability-contract/v0';
const PROPOSAL_SCHEMA = 'mazz.physical-production-proposal/v0';
const SAFETY_DECISION_SCHEMA = 'mazz.simulation-safety-decision/v0';
const EVIDENCE_RECORDING_SCHEMA = 'mazz.readonly-industrial-evidence-recording/v0';
const SHADOW_PLAN_SCHEMA = 'mazz.shadow-production-plan/v0';
const SIMULATION_RESULT_SCHEMA = 'mazz.physical-production-simulation-result/v0';
const SAFETY_REVIEW_GATE_SCHEMA = 'mazz.external-safety-review-gate/v0';
const WRITABLE_PROTOCOL = /^(opc|opcua|modbus|s7|ethernetip|mqtt|http|https|tcp|udp):/i;
const FORBIDDEN_KEYS = /^(command|control|endpoint|host|hostname|ip|password|plc|port|secret|token|write|writeValue)$/i;

const stable = value => Array.isArray(value) ? value.map(stable) : isPlainObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

function rejectControlSurface(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((row, index) => rejectControlSurface(row, `${trail}[${index}]`));
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) throw new Error(`W86 offline/simulation 禁止控制字段: ${trail ? `${trail}.` : ''}${key}`);
    if (typeof child === 'string' && WRITABLE_PROTOCOL.test(child)) throw new Error(`W86 offline/simulation 禁止网络/设备地址: ${child}`);
    rejectControlSurface(child, trail ? `${trail}.${key}` : key);
  }
}

function capability(input) {
  rejectControlSurface(input);
  const states = ['available', 'failed', 'maintenance', 'unknown'];
  if (input?.schema !== CAPABILITY_SCHEMA || !input.capabilityId || !input.executorRef) throw new Error('Capability Contract 不完整');
  if (!states.includes(input.state)) throw new Error(`未知 Capability state: ${input.state}`);
  if (!Array.isArray(input.canDo) || !input.canDo.length || !Array.isArray(input.failureModes)) throw new Error('Capability canDo/failureModes 不完整');
  const value = {
    schema: CAPABILITY_SCHEMA, capabilityId: String(input.capabilityId), executorRef: String(input.executorRef), executorKind: String(input.executorKind),
    canDo: [...new Set(input.canDo.map(String))].sort(), inputTypes: [...new Set((input.inputTypes || []).map(String))].sort(), outputTypes: [...new Set((input.outputTypes || []).map(String))].sort(),
    cost: Number(input.cost) || 0, latencyMinutes: Number(input.latencyMinutes) || 0, capacityPerHour: Number(input.capacityPerHour) || 0, reliability: Number(input.reliability) || 0,
    permissionRef: String(input.permissionRef || ''), safetyClass: String(input.safetyClass || ''), operatingEnvelope: { ...input.operatingEnvelope },
    evidenceRefs: [...new Set((input.evidenceRefs || []).map(String))].sort(), calibrationRef: String(input.calibrationRef || ''), certificationRef: String(input.certificationRef || ''),
    failureModes: [...new Set(input.failureModes.map(String))].sort(), recovery: String(input.recovery || ''), humanFallback: String(input.humanFallback || ''), state: input.state,
    simulationOnly: true, realDeviceIdentity: '', connectionDetailsIncluded: false,
  };
  return deepFreeze({ ...value, contractDigest: digest(value) });
}

function createThreatModel() {
  return deepFreeze({
    schema: 'mazz.w86-threat-responsibility-map/v0',
    layers: [
      { layer: 'L5', owner: 'W82 Organizational Compiler', may: ['goal', 'organization', 'recompile-proposal'], mayNot: ['realtime-control', 'safety-override'] },
      { layer: 'L4', owner: 'W86 Production Runtime', may: ['simulation-state', 'schedule', 'recovery-proposal'], mayNot: ['controller-command'] },
      { layer: 'L3', owner: 'Capability Adapter', may: ['typed evidence', 'declared capability'], mayNot: ['bypass-safety'] },
      { layer: 'L2', owner: 'Certified deterministic controller', may: ['certified-control'], mayNot: ['accept-unsigned-ai-command'] },
      { layer: 'L1', owner: 'Physical process authority', may: ['physical-state'], mayNot: ['infer-completion-from-model'] },
      { layer: 'Safety', owner: 'Independent Safety Kernel', may: ['allow', 'deny', 'degrade', 'emergency-stop'], mayNot: ['delegate-override-to-factory'] },
    ],
    threats: ['replay', 'duplicate', 'out-of-order', 'heartbeat-loss', 'clock-drift', 'stale-calibration', 'unsafe-substitution', 'single-sensor-self-certification', 'network-partition', 'old-plan-reuse'],
    factoryOverrideAllowed: false, realNetworkAuthorized: false, deviceWriteAuthorized: false,
  });
}

function proposal(input) {
  rejectControlSurface(input);
  if (input?.schema !== PROPOSAL_SCHEMA || !input.proposalId || !input.planVersion || !input.operation || !input.executorRef) throw new Error('Production Proposal 不完整');
  return deepFreeze({
    schema: PROPOSAL_SCHEMA, proposalId: String(input.proposalId), sequence: Number(input.sequence), planVersion: String(input.planVersion), operation: String(input.operation), executorRef: String(input.executorRef),
    batchRef: String(input.batchRef), requestedEnvelope: { ...input.requestedEnvelope }, capabilityDigest: String(input.capabilityDigest), calibrationRef: String(input.calibrationRef), certificationRef: String(input.certificationRef),
    evidenceRefs: [...new Set((input.evidenceRefs || []).map(String))].sort(), humanAuthorityRef: String(input.humanAuthorityRef || ''), createdAt: String(input.createdAt), expiresAt: String(input.expiresAt),
    simulationOnly: true, controllerCommandIncluded: false,
  });
}

class SimulationSafetyKernel {
  constructor({ now = () => Date.now(), maxClockDriftMs = 5000, heartbeatTimeoutMs = 3000 } = {}) {
    this.now = now;
    this.maxClockDriftMs = maxClockDriftMs;
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    this.lastSequence = 0;
    this.seen = new Set();
  }

  evaluate(proposalInput, capabilityInput, { heartbeatAt, expectedPlanVersion }) {
    const item = proposal(proposalInput);
    const cap = capability(capabilityInput);
    const reasons = [];
    const now = this.now();
    if (this.seen.has(item.proposalId)) reasons.push('REPLAY_OR_DUPLICATE');
    if (!Number.isInteger(item.sequence) || item.sequence <= this.lastSequence) reasons.push('OUT_OF_ORDER_SEQUENCE');
    if (item.planVersion !== expectedPlanVersion) reasons.push('STALE_PLAN_VERSION');
    if (Math.abs(now - Date.parse(item.createdAt)) > this.maxClockDriftMs) reasons.push('CLOCK_DRIFT');
    if (Date.parse(item.expiresAt) <= now) reasons.push('PROPOSAL_EXPIRED');
    if (now - Number(heartbeatAt) > this.heartbeatTimeoutMs) reasons.push('HEARTBEAT_LOST');
    if (cap.state !== 'available') reasons.push(`CAPABILITY_${cap.state.toUpperCase()}`);
    if (!cap.canDo.includes(item.operation)) reasons.push('CAPABILITY_MISMATCH');
    if (cap.executorRef !== item.executorRef || cap.contractDigest !== item.capabilityDigest) reasons.push('CAPABILITY_IDENTITY_MISMATCH');
    if (!cap.calibrationRef || cap.calibrationRef !== item.calibrationRef) reasons.push('CALIBRATION_INVALID');
    if (!cap.certificationRef || cap.certificationRef !== item.certificationRef) reasons.push('CERTIFICATION_INVALID');
    if (!item.humanAuthorityRef.startsWith('human:')) reasons.push('HUMAN_AUTHORITY_MISSING');
    for (const [key, requested] of Object.entries(item.requestedEnvelope)) {
      const allowed = cap.operatingEnvelope[key];
      if (typeof requested === 'number' && typeof allowed === 'number' && requested > allowed) reasons.push(`OUT_OF_ENVELOPE:${key}`);
    }
    const allowed = reasons.length === 0;
    if (allowed) { this.seen.add(item.proposalId); this.lastSequence = item.sequence; }
    return deepFreeze({ schema: SAFETY_DECISION_SCHEMA, proposalId: item.proposalId, state: allowed ? 'SIMULATION_ALLOWED' : 'SIMULATION_DENIED', reasons: [...new Set(reasons)].sort(), factoryOverrideAllowed: false, controllerCommandProduced: false, simulationOnly: true });
  }
}

function normalizeOfflineEvidenceRecording(input) {
  rejectControlSurface(input);
  if (input?.schema !== EVIDENCE_RECORDING_SCHEMA || !input.recordingId || !Array.isArray(input.samples)) throw new Error('Read-only recording 不完整');
  let previous = '';
  const samples = input.samples.map((row, index) => {
    if (!isPlainObject(row) || !row.at || !row.measurement || typeof row.value !== 'number' || !row.unit || !row.sourceRef) throw new Error(`samples[${index}] 不完整`);
    const value = { sequence: index + 1, at: new Date(row.at).toISOString(), measurement: String(row.measurement), value: row.value, unit: String(row.unit), sourceRef: String(row.sourceRef), quality: String(row.quality || 'recorded'), previousHash: previous };
    value.hash = digest(value); previous = value.hash; return value;
  });
  return deepFreeze({ schema: EVIDENCE_RECORDING_SCHEMA, recordingId: String(input.recordingId), source: 'offline-recording-fixture', samples, tailHash: previous, readOnly: true, networkAccess: false, writeCapability: false, simulationEvidenceOnly: true });
}

function createShadowPlan({ recording, planVersion, operations, authorityRef }) {
  const evidence = normalizeOfflineEvidenceRecording(recording);
  if (!String(authorityRef || '').startsWith('human:')) throw new Error('Shadow Plan 需要 human Authority');
  const plan = {
    schema: SHADOW_PLAN_SCHEMA, planVersion: String(planVersion), evidenceRef: `recording:${evidence.recordingId}:${evidence.tailHash}`,
    operations: operations.map((row, index) => ({ operationId: String(row.operationId || `shadow:${index + 1}`), capabilityId: String(row.capabilityId), earliestMinute: Number(row.earliestMinute) || 0, durationMinutes: Number(row.durationMinutes) || 0, affectedArtifactIds: [...new Set((row.affectedArtifactIds || []).map(String))].sort(), state: 'PROPOSED_NOT_EXECUTED' })),
    authorityRef: String(authorityRef), executionAuthorized: false, controllerCommands: [], realTimeDecisionUse: false, simulationOnly: true,
  };
  return deepFreeze({ ...plan, planDigest: digest(plan) });
}

function compatibleCandidates(operation, candidates) {
  return candidates.map(capability).filter(row => row.canDo.includes(operation)).map(row => {
    const blockers = [];
    if (row.state !== 'available') blockers.push(`state:${row.state}`);
    if (!row.calibrationRef) blockers.push('calibration-missing');
    if (!row.certificationRef) blockers.push('certification-missing');
    if (!row.safetyClass) blockers.push('safety-class-missing');
    return { capability: row, eligible: blockers.length === 0, blockers };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.capability.reliability - a.capability.reliability || a.capability.executorRef.localeCompare(b.capability.executorRef));
}

function runHardSampleI({ now = Date.parse('2026-08-19T00:00:00Z') } = {}) {
  const base = { schema: CAPABILITY_SCHEMA, canDo: ['mill-part'], inputTypes: ['material'], outputTypes: ['part'], cost: 10, latencyMinutes: 5, capacityPerHour: 10, reliability: 0.95, permissionRef: 'permission:simulation', safetyClass: 'S2', operatingEnvelope: { speed: 100, temperature: 80 }, evidenceRefs: ['evidence:fixture'], failureModes: ['offline'], recovery: 'replace executor', humanFallback: 'human inspection', simulationOnly: true };
  const machineA = capability({ ...base, capabilityId: 'cap:mill-a', executorRef: 'machine:A', executorKind: 'machine', calibrationRef: 'cal:A', certificationRef: 'cert:A', state: 'failed' });
  const machineB = capability({ ...base, capabilityId: 'cap:mill-b', executorRef: 'machine:B', executorKind: 'machine', calibrationRef: 'cal:B', certificationRef: 'cert:B', state: 'available', reliability: 0.9 });
  const machineC = capability({ ...base, capabilityId: 'cap:mill-c', executorRef: 'machine:C', executorKind: 'machine', calibrationRef: '', certificationRef: '', state: 'available', reliability: 0.99, safetyClass: '' });
  const candidates = compatibleCandidates('mill-part', [machineA, machineB, machineC]);
  const selected = candidates.find(row => row.eligible)?.capability;
  const recording = normalizeOfflineEvidenceRecording({ schema: EVIDENCE_RECORDING_SCHEMA, recordingId: 'sample-i', samples: [{ at: new Date(now - 1000).toISOString(), measurement: 'machine-a-health', value: 0, unit: 'boolean', sourceRef: 'offline:fixture', quality: 'recorded' }] });
  const shadowPlan = createShadowPlan({ recording, planVersion: 'plan:2', authorityRef: 'human:simulation-owner', operations: [{ operationId: 'op:mill', capabilityId: selected.capabilityId, durationMinutes: 8, affectedArtifactIds: ['artifact:part-batch'], earliestMinute: 0 }, { operationId: 'op:human-inspection', capabilityId: 'cap:human-inspection', durationMinutes: 5, affectedArtifactIds: ['artifact:quality-report'], earliestMinute: 8 }] });
  const safety = new SimulationSafetyKernel({ now: () => now });
  const safeProposal = { schema: PROPOSAL_SCHEMA, proposalId: 'proposal:safe', sequence: 1, planVersion: 'plan:2', operation: 'mill-part', executorRef: selected.executorRef, batchRef: 'batch:fixture', requestedEnvelope: { speed: 90, temperature: 70 }, capabilityDigest: selected.contractDigest, calibrationRef: selected.calibrationRef, certificationRef: selected.certificationRef, evidenceRefs: [recording.tailHash], humanAuthorityRef: 'human:simulation-owner', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 2000).toISOString() };
  const safeDecision = safety.evaluate(safeProposal, selected, { heartbeatAt: now, expectedPlanVersion: 'plan:2' });
  const unsafeDecision = safety.evaluate({ ...safeProposal, proposalId: 'proposal:unsafe', sequence: 2, requestedEnvelope: { speed: 200, temperature: 70 } }, selected, { heartbeatAt: now, expectedPlanVersion: 'plan:2' });
  const result = { schema: SIMULATION_RESULT_SCHEMA, failedExecutor: machineA.executorRef, candidates: candidates.map(row => ({ executorRef: row.capability.executorRef, eligible: row.eligible, blockers: row.blockers })), selectedExecutor: selected.executorRef, humanInspectionRequired: true, shadowPlan, safeDecision, unsafeDecision, affectedArtifactIds: ['artifact:part-batch', 'artifact:quality-report'], unaffectedArtifactIds: ['artifact:packaging', 'artifact:shipping'], factoryOverrideAllowed: false, controllerCommandsProduced: 0, realDeviceWrites: 0, simulationOnly: true };
  return deepFreeze({ ...result, resultDigest: digest(result) });
}

function externalSafetyReviewGate() {
  return deepFreeze({ schema: SAFETY_REVIEW_GATE_SCHEMA, state: 'CONDITIONAL_EXTERNAL_SAFETY_REVIEW', prerequisites: ['independent-safety-engineer', 'industry-responsible-entity', 'regulatory-analysis', 'certified-device', 'isolated-network', 'verified-fail-safe', 'human-final-authority'], automaticallySatisfiedBySimulation: false, fieldActivationAuthorized: false, deviceWriteAuthorized: false, responsibleDecisionRequired: true });
}

module.exports = {
  CAPABILITY_SCHEMA, PROPOSAL_SCHEMA, SAFETY_DECISION_SCHEMA, EVIDENCE_RECORDING_SCHEMA,
  SHADOW_PLAN_SCHEMA, SIMULATION_RESULT_SCHEMA, SAFETY_REVIEW_GATE_SCHEMA,
  createThreatModel, capability, proposal, SimulationSafetyKernel, normalizeOfflineEvidenceRecording,
  createShadowPlan, compatibleCandidates, runHardSampleI, externalSafetyReviewGate, digest,
};
