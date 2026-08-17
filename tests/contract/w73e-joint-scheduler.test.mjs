import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  SCHEDULER_RECORD_SCHEMA, ElasticStaffingCoordinator, createScheduleProposal,
  finalizeSchedule, normalizeCapabilityProviderSnapshot, normalizeSchedulerRequest,
  openScheduleLedger, parseSchedulerLog,
} from '../../renderer/modules/factory/joint-scheduler.js';

const NOW = '2026-08-17T04:00:00.000Z';

class MemoryIo {
  constructor() { this.files = new Map(); this.delayMs = 0; }
  async exists(path) { return this.files.has(path); }
  async read(path) { if (!this.files.has(path)) throw new Error(`ENOENT ${path}`); return this.files.get(path); }
  async write(path, content) {
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    this.files.set(path, String(content)); return true;
  }
}

function capability({ id = 'factory.w68.execute', providerId = 'runtime-a', health = 'available' } = {}) {
  return {
    schema: 'mazz.capability-provider/v0', capabilityId: id, providerId, displayName: providerId,
    inputTypes: ['factory-task'], outputTypes: ['factory-artifact'], agentUsable: false,
    execution: { mode: 'embedded' }, cost: { type: 'api', note: 'bounded by task cap' },
    health: { status: health, checkedAt: NOW, reason: 'test snapshot' }, provenance: { source: 'w72-registry-snapshot' },
  };
}

function candidate(id, overrides = {}) {
  const health = overrides.health?.status || 'available';
  return {
    candidateId: id, executorRef: `executor:${id}`, seatRefs: ['seat:factory-production'],
    capabilityProviders: [capability({ providerId: `runtime-${id}`, health })],
    certificateRef: '', qualification: { restricted: false, ok: true, code: 'QUALIFICATION_UNRESTRICTED', evidenceRef: '' },
    health: { status: health, checkedAt: NOW, reason: 'runtime health' },
    estimatedCost: { status: 'estimated', tokens: 1000, sourceRef: `evidence:${id}:cost` },
    estimatedLatency: { status: 'estimated', ms: 1000, sourceRef: `evidence:${id}:latency` },
    backpressure: { active: 0, maxActive: 2, queued: 0 }, risk: { level: 'normal', reason: '', evidenceRef: '' },
    providerRef: `provider:${id}`, modelRef: `model:${id}`, evidenceRefs: [`evidence:${id}`], confidence: 0.8,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    schema: 'mazz.scheduler-request/v0', requestId: 'request:001', runId: 'run-w73e-001', taskRef: 'factory-task:001',
    seatRequirement: 'seat:factory-production', capabilityRequirements: ['factory.w68.execute'], qualificationRequired: false,
    budget: { remainingTokens: 2000 }, priority: 70, backpressure: { active: 0, maxActive: 2, queued: 1 },
    risk: { maxLevel: 'normal' }, manualLock: {}, candidates: [candidate('a'), candidate('b', { estimatedCost: { status: 'estimated', tokens: 1500, sourceRef: 'evidence:b:cost' } })],
    evidenceWindow: { from: NOW, to: NOW, refs: ['evidence:window'] }, requestedAt: NOW, ...overrides,
  };
}

function proposalRecords(rawRequest = request()) {
  const proposal = createScheduleProposal(rawRequest);
  const decision = finalizeSchedule(proposal, { authorityRef: 'human:operator', selectedCandidateId: proposal.recommendedCandidateId, decidedAt: NOW });
  return { proposal, decision, records: [
    { recordId: `${proposal.proposalId}:proposed`, type: 'schedule-proposed', proposalId: proposal.proposalId, request: rawRequest, proposal },
    { recordId: `${proposal.proposalId}:decided`, type: 'schedule-decided', proposalId: proposal.proposalId, decision, authorityRef: decision.authorityRef },
  ] };
}

describe('W73e deterministic joint scheduler', () => {
  test('同一输入重算得到同一候选、排除、推荐与备选；没有 opaque overall score', () => {
    const raw = request({ candidates: [
      candidate('b', { estimatedCost: { status: 'estimated', tokens: 1500, sourceRef: 'evidence:b:cost' } }),
      candidate('off', { health: { status: 'unavailable', checkedAt: NOW, reason: 'offline' } }),
      candidate('a'),
    ] });
    const first = createScheduleProposal(raw);
    const second = createScheduleProposal(raw);
    assert.deepEqual(first, second);
    assert.equal(first.recommendedCandidateId, 'a');
    assert.deepEqual(first.alternateCandidateIds, ['b']);
    assert.equal(first.exclusions[0].candidate.candidateId, 'off');
    assert.equal(first.exclusions[0].reasons.some(row => row.code === 'HEALTH_UNAVAILABLE'), true);
    assert.equal('score' in first, false);
    assert.equal(first.candidates.every(row => Array.isArray(row.routeReasons) && row.routeReasons.length >= 5), true);
  });

  test('Seat/Capability/Qualification/Health/Budget/Backpressure/Risk/手工锁均给显式排除理由', () => {
    const rows = [
      candidate('seat', { seatRefs: ['seat:other'] }),
      candidate('cap', { capabilityProviders: [capability({ id: 'other.capability' })] }),
      candidate('qualification', { qualification: { restricted: true, ok: false, code: 'QUALIFICATION_REVOKED', evidenceRef: 'evidence:revoked' } }),
      candidate('budget', { estimatedCost: { status: 'estimated', tokens: 9999, sourceRef: 'evidence:cost' } }),
      candidate('pressure', { backpressure: { active: 2, maxActive: 2, queued: 4 } }),
      candidate('risk', { risk: { level: 'high', reason: 'unsafe', evidenceRef: 'evidence:risk' } }),
      candidate('banned'), candidate('locked-out'),
    ];
    const proposal = createScheduleProposal(request({
      qualificationRequired: true, candidates: rows, manualLock: { candidateId: 'banned', bannedProviderRefs: ['provider:banned'] },
    }));
    assert.equal(proposal.status, 'blocked');
    const codes = new Set(proposal.exclusions.flatMap(row => row.reasons.map(reason => reason.code)));
    for (const code of ['SEAT_MISMATCH', 'CAPABILITY_MISSING', 'QUALIFICATION_REVOKED', 'BUDGET_INSUFFICIENT', 'EXECUTOR_BACKPRESSURE', 'RISK_EXCEEDS_LIMIT', 'PROVIDER_BANNED', 'MANUAL_CANDIDATE_LOCK']) assert.equal(codes.has(code), true, code);
    assert.equal(proposal.reasonCode, 'NO_QUALIFIED_EXECUTOR');
  });

  test('AUTO 只提议；最终决定必须是 human，可选备选但必须写覆盖理由', () => {
    const proposal = createScheduleProposal(request());
    assert.throws(() => finalizeSchedule(proposal, { authorityRef: 'model:gpt' }), /human Authority/);
    assert.throws(() => finalizeSchedule(proposal, { authorityRef: 'human:operator' }), /显式选择/);
    assert.throws(() => finalizeSchedule(proposal, { authorityRef: 'human:operator', selectedCandidateId: 'b' }), /覆盖理由/);
    const decision = finalizeSchedule(proposal, { authorityRef: 'human:operator', selectedCandidateId: 'b', overrideReason: '本次优先验证备选', decidedAt: NOW });
    assert.equal(decision.status, 'selected');
    assert.equal(decision.override, true);
    assert.equal(decision.reasonCode, 'HUMAN_ALTERNATE_SELECTED');
    assert.throws(() => finalizeSchedule(proposal, { authorityRef: 'human:operator', selectedCandidateId: 'excluded' }), /不在可用集合/);
  });

  test('只接受 W72 Capability Provider v0；未知字段与 secret 拒绝', () => {
    assert.equal(normalizeCapabilityProviderSnapshot(capability()).schema, 'mazz.capability-provider/v0');
    assert.throws(() => normalizeCapabilityProviderSnapshot({ ...capability(), schema: 'other' }), /只接受 W72/);
    assert.throws(() => normalizeCapabilityProviderSnapshot({ ...capability(), apiKey: 'secret' }), /secret/);
    assert.throws(() => normalizeSchedulerRequest({ ...request(), magicScore: 99 }), /未冻结字段/);
  });
});

describe('W73e elastic staffing and schedule ledger', () => {
  test('弹性容量只约束新 lease；缩容不强杀在途，释放/取消/dispose 归零', () => {
    const staffing = new ElasticStaffingCoordinator({ capacity: 2 });
    assert.equal(staffing.acquire({ dispatchId: 'd1', candidateId: 'a', taskRef: 't1' }).ok, true);
    assert.equal(staffing.acquire({ dispatchId: 'd2', candidateId: 'b', taskRef: 't2' }).ok, true);
    assert.equal(staffing.acquire({ dispatchId: 'd3', candidateId: 'c', taskRef: 't3' }).code, 'BACKPRESSURE');
    const shrunk = staffing.setCapacity(1);
    assert.equal(shrunk.active, 2);
    assert.equal(shrunk.overcommitted, true);
    staffing.cancel('d1'); staffing.release('d2', 'completed');
    assert.equal(staffing.healthSnapshot().active, 0);
    staffing.acquire({ dispatchId: 'd4', candidateId: 'a' });
    const disposed = staffing.dispose();
    assert.deepEqual(disposed.abandoned, ['d4']);
    assert.equal(disposed.active, 0);
  });

  test('proposal→human decision→dispatch→release 可重开，精确重复幂等', async () => {
    const io = new MemoryIo();
    const path = 'D:/Factory/.mazz/runs/run-w73e-001/scheduling.ndjson';
    const ledger = await openScheduleLedger({ io, path, runId: 'run-w73e-001', clock: () => Date.parse(NOW), idFactory: () => 'id' });
    const { proposal, records } = proposalRecords();
    const dispatch = { recordId: 'dispatch:001:started', type: 'dispatch-started', proposalId: proposal.proposalId, dispatchId: 'dispatch:001', candidateId: proposal.recommendedCandidateId };
    await ledger.appendBatch([...records, dispatch]);
    await ledger.appendBatch([...records, dispatch]);
    assert.equal(ledger.records.length, 3);
    await ledger.appendBatch([{ recordId: 'dispatch:001:released', type: 'dispatch-released', dispatchId: 'dispatch:001', outcome: 'completed' }]);
    assert.equal(ledger.records.every(row => row.schema === SCHEDULER_RECORD_SCHEMA), true);
    await ledger.dispose();
    const reopened = await openScheduleLedger({ io, path, runId: 'run-w73e-001' });
    assert.equal(reopened.healthSnapshot().proposals, 1);
    assert.equal(reopened.healthSnapshot().activeDispatches, 0);
    assert.equal(reopened.healthSnapshot().recoveryRequired, false);
    await assert.rejects(() => reopened.appendBatch([{ ...records[0], request: request({ priority: 1 }) }]), /幂等键冲突/);
  });

  test('损坏尾隔离、中段损坏拒绝；孤儿 dispatch 须 human+evidence 显式收口', async () => {
    const io = new MemoryIo(); const path = 'D:/Factory/.mazz/runs/run-w73e-001/scheduling.ndjson';
    const ledger = await openScheduleLedger({ io, path, runId: 'run-w73e-001', clock: () => Date.parse(NOW), idFactory: () => 'recover' });
    const { proposal, records } = proposalRecords();
    await ledger.appendBatch([...records, { recordId: 'dispatch:orphan:started', type: 'dispatch-started', proposalId: proposal.proposalId, dispatchId: 'dispatch:orphan', candidateId: proposal.recommendedCandidateId }]);
    await ledger.dispose();
    io.files.set(path, `${io.files.get(path)}{"broken":`);
    const recovered = await openScheduleLedger({ io, path, runId: 'run-w73e-001', idFactory: () => 'recover' });
    assert.equal(recovered.healthSnapshot().recoveryRequired, true);
    assert.equal(recovered.healthSnapshot().orphanDispatches, 1);
    assert.equal(io.files.get(`${path}.corrupt-tail.txt`), '{"broken":');
    await assert.rejects(() => recovered.appendBatch([]), /恢复阻断态/);
    await assert.rejects(() => recovered.resolveRecovery({ authorityRef: 'model:gpt', evidenceRefs: ['evidence:review'] }), /human Authority/);
    const health = await recovered.resolveRecovery({ authorityRef: 'human:maintainer', evidenceRefs: ['evidence:review'] });
    assert.equal(health.recoveryRequired, false);
    assert.equal(health.activeDispatches, 0);
    const validLine = io.files.get(path).split(/\r?\n/).find(Boolean);
    assert.throws(() => parseSchedulerLog(`${validLine}\n{"broken":\n${validLine}\n`, { runId: 'run-w73e-001' }), /中段损坏/);
  });

  test('dispose 等待在飞写并回到 activeWrites=0', async () => {
    const io = new MemoryIo(); const path = 'D:/Factory/.mazz/runs/run-w73e-001/scheduling.ndjson';
    const ledger = await openScheduleLedger({ io, path, runId: 'run-w73e-001', clock: () => Date.parse(NOW) });
    io.delayMs = 5;
    const writing = ledger.appendBatch(proposalRecords().records);
    await Promise.resolve();
    const health = await ledger.dispose();
    await writing;
    assert.equal(health.activeWrites, 0);
    assert.equal(health.disposed, true);
  });
});
