import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const [{ FactoryPanel }, { W68_PROTOCOL }, { ElasticStaffingCoordinator }] = await Promise.all([
  import('../../renderer/modules/factory/index.js'),
  import('../../renderer/modules/factory/review.js'),
  import('../../renderer/modules/factory/joint-scheduler.js'),
]);

const NOW = '2026-08-17T05:00:00.000Z';
const EVIDENCE = [{ kind: 'evidence', id: 'probe', path: 'D:/Factory/probe.json', type: 'application/json', role: 'probe-result' }];

function specimen({ configured = true } = {}) {
  const files = new Map(); const directories = new Set();
  window.mazz = { invoke: async (channel, payload = {}) => {
    if (channel === 'fs:stat') return files.has(payload.path)
      ? { exists: true, isDir: false, size: files.get(payload.path).length }
      : { exists: directories.has(payload.path), isDir: directories.has(payload.path) };
    if (channel === 'fs:readFile') { if (!files.has(payload.path)) throw new Error(`ENOENT ${payload.path}`); return files.get(payload.path); }
    if (channel === 'fs:writeFile') { files.set(payload.path, String(payload.content)); return true; }
    if (channel === 'fs:mkdir') { directories.add(payload.path); return true; }
    if (channel === 'factory:runAcquire') return { ok: true, code: 'ACQUIRED', leaseId: `lease:${payload.runId}` };
    if (channel === 'factory:runRelease') return { ok: true, code: 'RELEASED' };
    if (channel === 'harness:adapters') return [];
    throw new Error(`unexpected channel ${channel}`);
  } };
  const panel = Object.create(FactoryPanel.prototype);
  panel.productionRunLedgers = new Map(); panel.reworkAuditLedgers = new Map();
  panel.productionRunOwnerLeases = new Map();
  panel.qualificationLedgers = new Map(); panel.delegationLedgers = new Map(); panel.qualificationDelegationServices = new Map();
  panel.scheduleLedgers = new Map(); panel.staffingCoordinator = new ElasticStaffingCoordinator({ capacity: 2 });
  panel.concurrency = 2; panel.schedulerSequence = 0; panel.tasks = []; panel.runningTasks = new Set();
  panel.cfg = configured ? { providerId: 'provider-a', baseURL: 'https://provider.example/v1', model: 'model-a', apiKey: 'TOP-SECRET-KEY' } : null;
  panel.persistTasks = () => {};
  return { panel, files, directories };
}

function task(overrides = {}) {
  return {
    id: 'task-w73e-integration', label: 'W73e 集成样本', folder: 'D:/Factory/W73e', mode: 'single',
    reviewProtocol: W68_PROTOCOL, reviewRitual: 'light', reviewBudgetCap: 32000, ...overrides,
  };
}

function qualificationRows() {
  return [
    { recordId: 'definition:runtime:defined', type: 'qualification-defined', definitionId: 'definition:runtime', seatRefs: ['seat:factory-production'], probePackRef: 'asset:probe-pack/runtime', probePackVersion: '1.0.0', passingScore: 80, authorityRef: 'human:maintainer' },
    { recordId: 'attempt:runtime:recorded', type: 'qualification-attempt-recorded', definitionId: 'definition:runtime', attemptId: 'attempt:runtime', executorRef: 'factory-runtime:w68', score: 95, outcome: 'passed', evidenceRefs: EVIDENCE, startedAt: '2026-08-16T00:00:00.000Z', completedAt: '2026-08-16T00:30:00.000Z' },
    { recordId: 'certificate:runtime:issued', type: 'qualification-certificate-issued', definitionId: 'definition:runtime', attemptId: 'attempt:runtime', certificateId: 'certificate:runtime', executorRef: 'factory-runtime:w68', seatRefs: ['seat:factory-production'], authorityRef: 'human:maintainer', evidenceRefs: EVIDENCE, issuedAt: '2026-08-16T01:00:00.000Z', validFrom: '2026-08-16T01:00:00.000Z', expiresAt: '2027-08-16T01:00:00.000Z' },
  ];
}

describe('W73e Factory 单路径集成', () => {
  test('ensure 在同一 W68 Run 打开 scheduling ledger，不替换 W73b–d 账', async () => {
    const { panel, files } = specimen(); const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    assert.equal(files.has(run.paths.scheduling), true);
    assert.equal(files.has(run.paths.qualifications), true);
    assert.equal(files.has(run.paths.delegations), true);
    assert.equal(panel.scheduleLedgers.get(target.id).runId, run.runId);
    assert.equal(run.snapshot.status, 'running');
  });

  test('W72 capability snapshot→可解释提议→human 决定→dispatch→release 全部挂回同一 Run', async () => {
    const { panel, files } = specimen(); const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    const scheduled = await panel.scheduleFactoryTask(target, { requestId: 'request:integration', requestedAt: NOW, authorityRef: 'human:operator' });
    assert.equal(scheduled.status, 'selected');
    assert.equal(scheduled.proposal.recommendedCandidateId, 'candidate:factory-runtime:w68');
    assert.equal(scheduled.proposal.candidates[0].capabilityProviderRefs[0], 'factory.w68.execute@mazz.factory.w68-runtime');
    assert.equal(scheduled.decision.authorityRef, 'human:operator');
    assert.ok(run.snapshot.scheduleRefs.includes(scheduled.proposal.proposalId));
    assert.match(files.get(run.paths.scheduling), /mazz\.capability-provider\/v0/);
    assert.match(files.get(run.paths.scheduling), /human:operator/);
    assert.doesNotMatch(files.get(run.paths.scheduling), /TOP-SECRET-KEY|overallScore|Publication|Canon/);
    assert.equal(panel.staffing().healthSnapshot().active, 1);
    await panel.releaseFactorySchedule(target, scheduled, 'completed');
    assert.equal(panel.staffing().healthSnapshot().active, 0);
    assert.equal(panel.scheduleLedgers.get(target.id).healthSnapshot().activeDispatches, 0);
  });

  test('Factory 集成层不得替多候选自动接受推荐，必须收到人工显式选择', async () => {
    const { panel } = specimen(); const target = task();
    await panel.ensureProductionRun(target, { id: 'novel' });
    const first = panel.buildSchedulerCandidates(target, { candidateId: 'candidate:runtime:a', executorRef: 'factory-runtime:a' }, NOW)[0];
    const second = { ...first, candidateId: 'candidate:runtime:b', executorRef: 'factory-runtime:b', confidence: 0.8 };
    await assert.rejects(() => panel.scheduleFactoryTask(target, {
      requestId: 'request:explicit-human-selection', requestedAt: NOW, authorityRef: 'human:operator', candidates: [first, second],
    }), /多个可用候选必须由人类显式选择/);
    assert.equal(panel.scheduleLedgers.get(target.id).healthSnapshot().proposals, 0);
  });

  test('dispatch 释放记账失败也必须收掉内存 lease，并留下可恢复的账本孤儿', async () => {
    const { panel } = specimen(); const target = task();
    await panel.ensureProductionRun(target, { id: 'novel' });
    const scheduled = await panel.scheduleFactoryTask(target, { requestId: 'request:release-fault', requestedAt: NOW, authorityRef: 'human:operator' });
    const ledger = panel.scheduleLedgers.get(target.id);
    ledger.appendBatch = async () => { throw new Error('simulated disk failure'); };
    await assert.rejects(() => panel.releaseFactorySchedule(target, scheduled, 'completed'), /simulated disk failure/);
    assert.equal(panel.staffing().healthSnapshot().active, 0);
    assert.equal(ledger.healthSnapshot().activeDispatches, 1);
  });

  test('未配置 Provider 或无合格 executor 时合法 BLOCKED，不暗降任意模型', async () => {
    const { panel, files } = specimen({ configured: false }); const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    const scheduled = await panel.scheduleFactoryTask(target, { requestId: 'request:blocked', requestedAt: NOW, authorityRef: 'human:operator' });
    assert.equal(scheduled.status, 'blocked');
    assert.equal(scheduled.code, 'NO_QUALIFIED_EXECUTOR');
    assert.equal(run.snapshot.status, 'blocked');
    assert.equal(scheduled.proposal.exclusions[0].reasons.some(row => row.code === 'HEALTH_UNAVAILABLE'), true);
    assert.doesNotMatch(files.get(run.paths.scheduling), /fallback|provider-success|arbitrary-model/i);
    assert.equal(panel.staffing().healthSnapshot().active, 0);
  });

  test('受限 Seat 直接消费 W73d certificate；撤销/过期仍由原资格门决定', async () => {
    const { panel } = specimen(); const target = task();
    await panel.ensureProductionRun(target, { id: 'novel' });
    await panel.appendQualificationRecords(target, qualificationRows());
    const scheduled = await panel.scheduleFactoryTask(target, {
      requestId: 'request:qualified', requestedAt: NOW, authorityRef: 'human:operator',
      qualificationRequired: true, certificateRef: 'certificate:runtime', executorRef: 'factory-runtime:w68',
    });
    assert.equal(scheduled.status, 'selected');
    assert.equal(scheduled.proposal.candidates[0].certificateRef, 'certificate:runtime');
    await panel.releaseFactorySchedule(target, scheduled, 'completed');
    await panel.appendQualificationRecords(target, [{ recordId: 'certificate:runtime:revoked', type: 'qualification-certificate-revoked', certificateId: 'certificate:runtime', authorityRef: 'human:maintainer', revokedAt: '2026-08-17T05:30:00.000Z', revocationReason: 'evidence invalidated', evidenceRefs: EVIDENCE }]);
    const blocked = await panel.scheduleFactoryTask(target, {
      requestId: 'request:revoked', requestedAt: '2026-08-17T06:00:00.000Z', authorityRef: 'human:operator',
      qualificationRequired: true, certificateRef: 'certificate:runtime', executorRef: 'factory-runtime:w68',
    });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.proposal.exclusions[0].reasons.some(row => row.code === 'QUALIFICATION_REVOKED'), true);
  });

  test('旧 task pool 保持 owner，但队列按显式 priority 稳定排序并服从现有并发槽', async () => {
    const { panel } = specimen(); const order = [];
    panel.runTask = async target => { order.push(target.id); return true; };
    await panel.runTaskPool([
      { id: 'low', schedulerPriority: 10 }, { id: 'high-a', schedulerPriority: 90 },
      { id: 'high-b', schedulerPriority: 90 }, { id: 'mid', schedulerPriority: 50 },
    ]);
    assert.deepEqual(order, ['high-a', 'high-b', 'mid', 'low']);
    assert.equal(panel.runningTasks.size, 0);
    assert.equal(panel.concurrency, 2);
  });

  test('孤儿 dispatch 重开后阻断 Run；max/legacy 仍不迁移', async () => {
    const { panel } = specimen(); const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    const scheduled = await panel.scheduleFactoryTask(target, { requestId: 'request:orphan', requestedAt: NOW, authorityRef: 'human:operator' });
    const scheduling = panel.scheduleLedgers.get(target.id);
    await scheduling.dispose(); panel.scheduleLedgers.delete(target.id);
    panel.staffing().release(scheduled.dispatchId, 'simulated-crash');
    await assert.rejects(() => panel.ensureProductionRun(target, { id: 'novel' }), error => error?.code === 'W73E_SCHEDULER_RECOVERY_REQUIRED');
    assert.equal(run.snapshot.status, 'blocked');
    assert.equal(panel.scheduleLedgers.get(target.id).healthSnapshot().orphanDispatches, 1);
    assert.equal(await panel.scheduleFactoryTask(task({ mode: 'max' })), null);
    assert.equal(await panel.scheduleFactoryTask(task({ reviewProtocol: 'legacy' })), null);
  });

  test('W73e 没有偷渡 W73f KPI、Router、Hub、Promotion 或第二执行器', () => {
    const source = fs.readFileSync(new URL('../../renderer/modules/factory/joint-scheduler.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /overallScore|leaderboard|marketplace|autoPromotion|Publication|Canon/);
    assert.doesNotMatch(source, /chatStream|resolveProviderRoute|fetch\s*\(|WebSocket|createSession|child_process/);
    assert.match(source, /AUTO 只提议|human Authority/);
    assert.match(source, /不取得 W68 task pool/);
  });
});
