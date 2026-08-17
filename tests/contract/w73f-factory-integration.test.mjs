import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const [{ FactoryPanel }, { W68_PROTOCOL }, { ElasticStaffingCoordinator }] = await Promise.all([
  import('../../renderer/modules/factory/index.js'),
  import('../../renderer/modules/factory/review.js'),
  import('../../renderer/modules/factory/joint-scheduler.js'),
]);

const NOW = '2026-08-17T09:00:00.000Z';

function specimen() {
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
  panel.scheduleLedgers = new Map(); panel.economicsEvaluationLedgers = new Map();
  panel.staffingCoordinator = new ElasticStaffingCoordinator({ capacity: 1 });
  panel.concurrency = 1; panel.schedulerSequence = 0; panel.tasks = []; panel.runningTasks = new Set();
  panel.cfg = { providerId: 'provider-a', model: 'model-a', apiKey: 'TOP-SECRET-KEY' };
  panel.persistTasks = () => {};
  return { panel, files };
}

function task(overrides = {}) {
  return {
    id: 'task-w73f-integration', label: 'W73f 集成样本', folder: 'D:/Factory/W73f', mode: 'single',
    reviewProtocol: W68_PROTOCOL, reviewRitual: 'light', reviewBudgetCap: 32000, ...overrides,
  };
}

function result() {
  return {
    sealed: true, verdict: 'sealed', reason: '四闸全开',
    ritual: { requested: 'light', effective: 'light' },
    gates: { machine: true, point: true, review: true, objection: true },
    repairs: [{ round: 1 }], objections: [{ id: 'O1' }],
    budget: { capTokens: 32000, usedTokens: 2400, entries: [{ seat: 'M1', phase: 'draft', tokens: 2400, at: NOW }] },
  };
}

describe('W73f Factory same-Run integration', () => {
  test('ensure 自动建立版本目录；W68 预算只按 estimate 落账并把成本/评估引用归入 Production Run', async () => {
    const { panel, files } = specimen(); const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    const economics = panel.economicsEvaluationLedgers.get(target.id);
    assert.equal(economics.healthSnapshot().metrics, 18);
    assert.equal(economics.healthSnapshot().formulas, 18);
    const output = await panel.appendW73fEconomics(target, result(), { artifactDir: 'D:/Factory/W73f/审理工件/001', unitNo: 1 });
    assert.equal(output.health.costKinds.estimate, 1);
    assert.equal(output.health.costKinds['provider-reported'], 0);
    assert.equal(output.health.costKinds['settled-actual'], 0);
    assert.equal(output.health.evaluations, 11);
    assert.equal(run.snapshot.economicsRefs.length, 1);
    assert.equal(run.snapshot.evaluationRefs.length, 11);
    assert.equal(target.economicsCostCount, 1);
    assert.equal(target.economicsEvaluationCount, 11);
    const text = files.get(run.paths.economics);
    assert.match(text, /w68\.review-budget-char-estimate\/v0/);
    assert.doesNotMatch(text, /TOP-SECRET-KEY|settled-actual|provider-reported/);
    assert.equal([...economics.state.evaluations.values()].find(row => row.metricRef.id === 'production.raw-ability.baseline-quality').result.status, 'unknown');
    assert.equal([...economics.state.evaluations.values()].find(row => row.metricRef.id === 'production.reliability.completion-rate').result.status, 'insufficient-sample');
  });

  test('economics 损坏尾在重开时隔离并阻断同 Run；max/legacy 不被偷迁', async () => {
    const { panel, files } = specimen(); const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    const economics = panel.economicsEvaluationLedgers.get(target.id);
    await economics.dispose(); panel.economicsEvaluationLedgers.delete(target.id);
    files.set(run.paths.economics, `${files.get(run.paths.economics)}{"broken":`);
    await assert.rejects(() => panel.ensureProductionRun(target, { id: 'novel' }), error => error?.code === 'W73F_ECONOMICS_RECOVERY_REQUIRED');
    assert.equal(run.snapshot.status, 'blocked');
    assert.equal(panel.economicsEvaluationLedgers.get(target.id).healthSnapshot().recoveryRequired, true);
    assert.equal(files.has(`${run.paths.economics}.corrupt-tail.txt`), true);
    assert.equal(await panel.appendW73fEconomics(task({ mode: 'max' }), result()), null);
    assert.equal(await panel.appendW73fEconomics(task({ reviewProtocol: 'legacy' }), result()), null);
  });

  test('实现没有 One Overall Score、自动 Seat 处罚、自动改 Gate、Hub/Promotion 或第二执行器', () => {
    const source = fs.readFileSync(new URL('../../renderer/modules/factory/economics-evaluation.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /auto(?:Punish|Penalty|Gate|Promotion)|marketplace|Publication|resolveProviderRoute|chatStream|createSession|child_process/);
    assert.match(source, /不得自动处罚 Seat、改 Gate 或改方法/);
    assert.match(source, /overallScore: null/);
    assert.match(source, /estimate 不冒充 actual/);
  });
});
