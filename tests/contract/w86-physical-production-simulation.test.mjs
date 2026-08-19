import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const w86 = require('../../main/foundation/physical-production-simulation.js');

const NOW = Date.parse('2026-08-19T00:00:00Z');
const cap = overrides => w86.capability({
  schema: w86.CAPABILITY_SCHEMA, capabilityId: 'cap:test', executorRef: 'machine:test', executorKind: 'machine',
  canDo: ['mill'], inputTypes: ['material'], outputTypes: ['part'], cost: 1, latencyMinutes: 1, capacityPerHour: 1, reliability: 1,
  permissionRef: 'permission:simulation', safetyClass: 'S2', operatingEnvelope: { speed: 100, temperature: 80 }, evidenceRefs: ['evidence:test'],
  calibrationRef: 'cal:test', certificationRef: 'cert:test', failureModes: ['offline'], recovery: 'stop', humanFallback: 'human inspect', state: 'available',
  ...overrides,
});
const proposal = overrides => ({
  schema: w86.PROPOSAL_SCHEMA, proposalId: 'proposal:1', sequence: 1, planVersion: 'plan:1', operation: 'mill', executorRef: 'machine:test', batchRef: 'batch:test',
  requestedEnvelope: { speed: 90, temperature: 70 }, capabilityDigest: cap({}).contractDigest, calibrationRef: 'cal:test', certificationRef: 'cert:test', evidenceRefs: ['evidence:test'],
  humanAuthorityRef: 'human:safety-owner', createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 2000).toISOString(), ...overrides,
});

test('W86a 五层责任与 Safety sidecar 明确禁止 Factory override/真实网络/设备写入', () => {
  const map = w86.createThreatModel();
  assert.deepEqual(map.layers.map(row => row.layer), ['L5', 'L4', 'L3', 'L2', 'L1', 'Safety']);
  assert.equal(map.factoryOverrideAllowed, false);
  assert.equal(map.realNetworkAuthorized, false);
  assert.equal(map.deviceWriteAuthorized, false);
  for (const threat of ['replay', 'heartbeat-loss', 'clock-drift', 'unsafe-substitution', 'old-plan-reuse']) assert.ok(map.threats.includes(threat));
});

test('W86b Hard Sample I：A 失败，C 不安全被拒，B+人工检查接替且只重排受影响工件', () => {
  const result = w86.runHardSampleI({ now: NOW });
  assert.equal(result.failedExecutor, 'machine:A');
  assert.equal(result.selectedExecutor, 'machine:B');
  assert.equal(result.candidates.find(row => row.executorRef === 'machine:C').eligible, false);
  assert.match(result.candidates.find(row => row.executorRef === 'machine:C').blockers.join(' '), /calibration|certification|safety/);
  assert.equal(result.humanInspectionRequired, true);
  assert.deepEqual(result.affectedArtifactIds, ['artifact:part-batch', 'artifact:quality-report']);
  assert.deepEqual(result.unaffectedArtifactIds, ['artifact:packaging', 'artifact:shipping']);
});

test('W86b 独立 Safety Kernel 允许安全模拟提议并拒绝越界，永不产控制命令', () => {
  const kernel = new w86.SimulationSafetyKernel({ now: () => NOW });
  const safe = kernel.evaluate(proposal({}), cap({}), { heartbeatAt: NOW, expectedPlanVersion: 'plan:1' });
  assert.equal(safe.state, 'SIMULATION_ALLOWED');
  assert.equal(safe.controllerCommandProduced, false);
  const unsafe = kernel.evaluate(proposal({ proposalId: 'proposal:2', sequence: 2, requestedEnvelope: { speed: 101 } }), cap({}), { heartbeatAt: NOW, expectedPlanVersion: 'plan:1' });
  assert.equal(unsafe.state, 'SIMULATION_DENIED');
  assert.ok(unsafe.reasons.includes('OUT_OF_ENVELOPE:speed'));
  assert.equal(unsafe.factoryOverrideAllowed, false);
});

test('W86b replay、乱序、旧计划、时钟漂移、心跳丢失、失校准均 fail-safe', () => {
  const kernel = new w86.SimulationSafetyKernel({ now: () => NOW, maxClockDriftMs: 1000, heartbeatTimeoutMs: 500 });
  const first = proposal({});
  assert.equal(kernel.evaluate(first, cap({}), { heartbeatAt: NOW, expectedPlanVersion: 'plan:1' }).state, 'SIMULATION_ALLOWED');
  const denied = kernel.evaluate({ ...first, expiresAt: new Date(NOW - 1).toISOString() }, cap({ calibrationRef: '' }), { heartbeatAt: NOW - 1000, expectedPlanVersion: 'plan:2' });
  for (const reason of ['REPLAY_OR_DUPLICATE', 'OUT_OF_ORDER_SEQUENCE', 'STALE_PLAN_VERSION', 'PROPOSAL_EXPIRED', 'HEARTBEAT_LOST', 'CALIBRATION_INVALID']) assert.ok(denied.reasons.includes(reason), reason);
});

test('W86c 只读工业证据只接受离线录制并形成 hash chain，网络/控制字段拒绝', () => {
  const recording = w86.normalizeOfflineEvidenceRecording({ schema: w86.EVIDENCE_RECORDING_SCHEMA, recordingId: 'rec:1', samples: [
    { at: '2026-08-19T00:00:00Z', measurement: 'temperature', value: 42, unit: 'C', sourceRef: 'offline:file:1', quality: 'recorded' },
    { at: '2026-08-19T00:00:01Z', measurement: 'temperature', value: 43, unit: 'C', sourceRef: 'offline:file:1', quality: 'recorded' },
  ] });
  assert.equal(recording.samples[1].previousHash, recording.samples[0].hash);
  assert.equal(recording.networkAccess, false);
  assert.equal(recording.writeCapability, false);
  assert.throws(() => w86.normalizeOfflineEvidenceRecording({ schema: w86.EVIDENCE_RECORDING_SCHEMA, recordingId: 'bad', endpoint: 'opcua://factory', samples: [] }), /禁止/);
  assert.throws(() => w86.normalizeOfflineEvidenceRecording({ schema: w86.EVIDENCE_RECORDING_SCHEMA, recordingId: 'bad', samples: [{ at: '2026-01-01', measurement: 'x', value: 1, unit: 'x', sourceRef: 'opcua://factory' }] }), /禁止/);
});

test('W86d Shadow Plan 仅比较历史与提出计划，不进入实时链或执行', () => {
  const recording = { schema: w86.EVIDENCE_RECORDING_SCHEMA, recordingId: 'shadow:1', samples: [{ at: '2026-08-19T00:00:00Z', measurement: 'throughput', value: 10, unit: 'parts/h', sourceRef: 'offline:fixture' }] };
  const plan = w86.createShadowPlan({ recording, planVersion: 'shadow:v1', authorityRef: 'human:planner', operations: [{ operationId: 'op:1', capabilityId: 'cap:sim', durationMinutes: 12, affectedArtifactIds: ['artifact:part'] }] });
  assert.equal(plan.executionAuthorized, false);
  assert.equal(plan.realTimeDecisionUse, false);
  assert.deepEqual(plan.controllerCommands, []);
  assert.equal(plan.operations[0].state, 'PROPOSED_NOT_EXECUTED');
  assert.throws(() => w86.createShadowPlan({ recording, planVersion: 'x', authorityRef: 'agent:auto', operations: [] }), /human Authority/);
});

test('W86e 固定为外部独立安全审查条件终态，模拟通过不授予现场激活', () => {
  const gate = w86.externalSafetyReviewGate();
  assert.equal(gate.state, 'CONDITIONAL_EXTERNAL_SAFETY_REVIEW');
  assert.equal(gate.automaticallySatisfiedBySimulation, false);
  assert.equal(gate.fieldActivationAuthorized, false);
  assert.equal(gate.deviceWriteAuthorized, false);
  assert.ok(gate.prerequisites.includes('independent-safety-engineer'));
});

test('W86 Foundation 无 Electron/网络/child_process/设备 SDK，产品入口只调用模拟通道', () => {
  const source = fs.readFileSync('main/foundation/physical-production-simulation.js', 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:electron|child_process|net|http|https|dgram|serialport|node-opcua)/);
  const preload = fs.readFileSync('preload/bridge.js', 'utf8');
  const ui = fs.readFileSync('renderer/modules/organization/index.js', 'utf8');
  assert.ok(preload.includes("'physicalSimulation:sampleI'") && preload.includes("'physicalSimulation:safetyReviewGate'"));
  assert.match(ui, /物理生产模拟/);
  assert.match(ui, /realDeviceWrites/);
});

test('W86 Hard Sample I 全链始终 simulation-only，真实写入和控制命令严格为零', () => {
  const result = w86.runHardSampleI({ now: NOW });
  assert.equal(result.simulationOnly, true);
  assert.equal(result.realDeviceWrites, 0);
  assert.equal(result.controllerCommandsProduced, 0);
  assert.equal(result.shadowPlan.executionAuthorized, false);
  assert.equal(result.safeDecision.simulationOnly, true);
  assert.equal(result.unsafeDecision.state, 'SIMULATION_DENIED');
});
