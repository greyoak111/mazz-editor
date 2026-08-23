import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  COST_KINDS, METRIC_AXES, SCORECARDS, aggregateCosts, buildW68EconomicsEvaluationBatch,
  computeParetoFrontier, createLocalEvaluation, normalizeCostRecord, normalizeMetricDefinition,
  normalizeMetricFormula, openEconomicsEvaluationLedger, parseEconomicsLog,
  standardEconomicsMetricRecords,
} from '../../renderer/modules/factory/economics-evaluation.js';

const NOW = '2026-08-17T08:00:00.000Z';
const RUN_ID = 'run-w73f-001';

class MemoryIo {
  constructor() { this.files = new Map(); this.delayMs = 0; }
  async exists(path) { return this.files.has(path); }
  async read(path) { if (!this.files.has(path)) throw new Error(`ENOENT ${path}`); return this.files.get(path); }
  async write(path, content) {
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    this.files.set(path, String(content)); return true;
  }
}

function estimate(id = 'estimate-1') {
  return {
    costId: id, runId: RUN_ID, taskRef: 'factory-task:1', kind: 'estimate', category: 'review',
    usage: { status: 'estimated', totalTokens: 1200, version: 'char-estimate/v0', sourceRef: 'artifact:cost-ledger' },
    amount: { status: 'unknown' }, priceRef: {}, observedAt: NOW,
    reason: '字符折算，不是供应商回报', evidenceRefs: ['artifact:cost-ledger'],
  };
}

function metric(overrides = {}) {
  return normalizeMetricDefinition({
    metricId: 'production.quality', version: '1.0.0', label: '生产质量', axis: 'final-quality',
    direction: 'up', unit: 'percent', scorecard: 'production', applicableContexts: ['factory.single.w68'],
    sampleWindow: { kind: 'run', minSamples: 1 }, effectiveFrom: NOW, systemHealthOnly: false,
    description: 'transparent', ...overrides,
  });
}

function formula(overrides = {}) {
  return normalizeMetricFormula({
    formulaId: 'production.quality.mean', version: '1.0.0',
    metricRef: { id: 'production.quality', version: '1.0.0' }, operation: 'passthrough',
    missingPolicy: 'fail-closed', precision: 2, effectiveFrom: NOW, description: 'transparent', ...overrides,
  });
}

function sample(overrides = {}) {
  return {
    sampleId: 'sample:1', runId: RUN_ID, taskRef: 'factory-task:1',
    artifactRefs: ['artifact:final'], findingRefs: ['finding:1'], gateRefs: ['gate:quality:pass'],
    humanDecisionRefs: ['decision:seal'], evidenceRefs: ['artifact:final'], observedAt: NOW,
    status: 'measured', value: 87.126, reason: '', ...overrides,
  };
}

describe('W73f versioned economics and local evaluation protocol', () => {
  test('四类成本严格分桶；W68 只认 Provider usage，unknown 不补零', () => {
    assert.deepEqual(COST_KINDS, ['estimate', 'provider-reported', 'settled-actual', 'unknown']);
    const rows = [
      estimate(),
      normalizeCostRecord({
        costId: 'reported-1', runId: RUN_ID, taskRef: 'factory-task:1', kind: 'provider-reported',
        providerRef: 'provider:a', usage: { status: 'reported', totalTokens: 900, version: 'provider-usage/v2', sourceRef: 'response:r1' },
        amount: { status: 'unknown' }, priceRef: {}, observedAt: NOW, evidenceRefs: ['response:r1'],
      }),
      normalizeCostRecord({
        costId: 'settled-1', runId: RUN_ID, taskRef: 'factory-task:1', kind: 'settled-actual',
        usage: { status: 'unknown' }, amount: { status: 'settled', currency: 'USD', value: 1.25 },
        priceRef: {}, observedAt: NOW, evidenceRefs: ['invoice:1'],
      }),
      normalizeCostRecord({
        costId: 'unknown-1', runId: RUN_ID, taskRef: 'factory-task:1', kind: 'unknown',
        usage: { status: 'unknown' }, amount: { status: 'unknown' }, priceRef: {}, observedAt: NOW,
        reason: '供应商没有 usage 与账单', evidenceRefs: [],
      }),
    ];
    const summary = aggregateCosts(rows);
    assert.equal(summary.buckets.estimate.tokens, 1200);
    assert.equal(summary.buckets['provider-reported'].tokens, 900);
    assert.equal(summary.buckets['settled-actual'].amountsByCurrency.USD, 1.25);
    assert.equal(summary.buckets.unknown.count, 1);
    assert.equal(summary.combinedTotal, null);
    assert.throws(() => normalizeCostRecord({ ...estimate('lie'), kind: 'provider-reported' }), /reported usage/);
    assert.throws(() => normalizeCostRecord({ ...estimate('secret'), apiKey: 'TOP-SECRET' }), /secret/);
  });

  test('标准目录覆盖九轴与四类 scorecard；系统 KPI 只观察健康，不施加自动后果', () => {
    const records = standardEconomicsMetricRecords(RUN_ID, { at: NOW });
    const definitions = records.filter(row => row.type === 'metric-defined').map(row => row.metric);
    assert.deepEqual(new Set(definitions.map(row => row.axis)), new Set(METRIC_AXES));
    assert.deepEqual(new Set(definitions.map(row => row.scorecard)), new Set(SCORECARDS));
    const health = definitions.filter(row => row.scorecard === 'system-health');
    assert.equal(health.length, 7);
    assert.equal(health.every(row => row.systemHealthOnly && /不得自动处罚/.test(row.description)), true);
    assert.equal(records.some(row => /overall/i.test(row.metric?.metricId || row.formula?.formulaId || '')), false);
  });

  test('公式版本可重算并保留旧输出；未知、N/A、样本不足均不伪造数值', () => {
    const m = metric(); const f = formula();
    const first = createLocalEvaluation({
      metric: m, formula: f, evaluationId: 'evaluation:v1', runId: RUN_ID, taskRef: 'factory-task:1',
      context: { domain: 'content-production', workflow: 'W68a', governanceProfile: 'light', artifactType: 'text' },
      evidenceWindow: { from: NOW, to: NOW }, samples: [sample()], createdAt: NOW,
    });
    assert.equal(first.result.value, 87.13);
    const f2 = formula({ formulaId: 'production.quality.mean-v2', version: '2.0.0', precision: 0 });
    const second = createLocalEvaluation({
      metric: m, formula: f2, evaluationId: 'evaluation:v2', supersedesEvaluationId: first.evaluationId,
      runId: RUN_ID, taskRef: 'factory-task:1', context: first.context, evidenceWindow: first.evidenceWindow,
      samples: first.samples, createdAt: NOW,
    });
    assert.equal(first.result.value, 87.13);
    assert.equal(second.result.value, 87);
    const unknown = createLocalEvaluation({
      metric: m, formula: f, evaluationId: 'evaluation:unknown', runId: RUN_ID, taskRef: 'factory-task:1',
      context: first.context, evidenceWindow: first.evidenceWindow,
      samples: [sample({ status: 'unknown', value: null, reason: '没有人工决定' })], createdAt: NOW,
    });
    assert.equal(unknown.result.status, 'unknown'); assert.equal(unknown.result.value, null);
    const insufficient = createLocalEvaluation({
      metric: metric({ sampleWindow: { kind: 'rolling-run', minSamples: 5 } }), formula: formula({ operation: 'mean' }),
      evaluationId: 'evaluation:small', runId: RUN_ID, taskRef: 'factory-task:1', context: first.context,
      evidenceWindow: first.evidenceWindow, samples: [sample()], createdAt: NOW,
    });
    assert.equal(insufficient.result.status, 'insufficient-sample');
  });

  test('Pareto 只给非支配前沿；缺轴显式排除，不生成 One Overall Score', () => {
    const result = computeParetoFrontier([
      { profileId: 'balanced', metrics: { quality: 90, cost: 10 }, evidenceRefs: ['run:1'] },
      { profileId: 'cheap', metrics: { quality: 80, cost: 5 }, evidenceRefs: ['run:2'] },
      { profileId: 'dominated', metrics: { quality: 70, cost: 12 }, evidenceRefs: ['run:3'] },
      { profileId: 'unknown', metrics: { quality: { status: 'unknown', value: null } } },
    ], [{ metricId: 'quality', direction: 'up' }, { metricId: 'cost', direction: 'down' }]);
    assert.deepEqual(result.frontier.map(row => row.profileId), ['balanced', 'cheap']);
    assert.deepEqual(result.dominated[0], { profileId: 'dominated', dominatedBy: ['balanced', 'cheap'] });
    assert.equal(result.excluded[0].profileId, 'unknown');
    assert.equal(result.overallScore, null);
  });
});

describe('W73f append-only ledger and W68 adapter', () => {
  test('目录→估算→评估可重开，精确重复幂等且 Run/Task/Artifact/Finding/Gate/Decision 可下钻', async () => {
    const io = new MemoryIo(); const path = 'D:/Factory/.mazz/runs/run-w73f-001/economics.ndjson';
    const ledger = await openEconomicsEvaluationLedger({ io, path, runId: RUN_ID, clock: () => Date.parse(NOW) });
    const catalog = standardEconomicsMetricRecords(RUN_ID, { at: NOW });
    await ledger.appendBatch(catalog);
    const batch = buildW68EconomicsEvaluationBatch({
      runId: RUN_ID, taskId: '1', artifactDir: 'D:/Factory/审理工件/001', unitNo: 1, at: NOW,
      result: { sealed: true, gates: { machine: true, point: true, review: true, objection: true }, repairs: [], objections: [{ id: 'O1' }], budget: { usedTokens: 2100 }, ritual: { effective: 'light' } },
      metricState: ledger.state,
    });
    await ledger.appendBatch(batch); await ledger.appendBatch(batch);
    assert.equal(ledger.healthSnapshot().costs, 1);
    assert.equal(ledger.healthSnapshot().evaluations, 11);
    const quality = [...ledger.state.evaluations.values()].find(row => row.metricRef.id === 'production.final-quality.seal-rate');
    assert.equal(quality.result.value, 100);
    const drill = quality.samples[0];
    assert.equal(drill.runId, RUN_ID); assert.equal(drill.taskRef, 'factory-task:1');
    assert.equal(drill.artifactRefs.length > 0, true); assert.equal(drill.findingRefs.length > 0, true);
    assert.equal(drill.gateRefs.length > 0, true); assert.equal(Array.isArray(drill.humanDecisionRefs), true);
    const recordedCost = ledger.state.costs.values().next().value;
    assert.equal(recordedCost.kind, 'unknown');
    assert.match(recordedCost.reason, /不按字符数估算/);
    await ledger.dispose();
    const reopened = await openEconomicsEvaluationLedger({ io, path, runId: RUN_ID });
    assert.equal(reopened.healthSnapshot().evaluations, 11);
    await assert.rejects(() => reopened.appendBatch([{ ...batch[0], cost: { ...batch[0].cost, reason: 'conflict' } }]), /幂等键冲突/);
  });

  test('损坏尾隔离、中段损坏拒绝；恢复必须 human+evidence；dispose 等待在飞写', async () => {
    const io = new MemoryIo(); const path = 'D:/Factory/.mazz/runs/run-w73f-001/economics.ndjson';
    const ledger = await openEconomicsEvaluationLedger({ io, path, runId: RUN_ID, clock: () => Date.parse(NOW), idFactory: () => 'recover' });
    await ledger.appendBatch(standardEconomicsMetricRecords(RUN_ID, { at: NOW })); await ledger.dispose();
    io.files.set(path, `${io.files.get(path)}{"broken":`);
    const recovered = await openEconomicsEvaluationLedger({ io, path, runId: RUN_ID, idFactory: () => 'recover' });
    assert.equal(recovered.healthSnapshot().recoveryRequired, true);
    assert.equal(io.files.get(`${path}.corrupt-tail.txt`), '{"broken":');
    await assert.rejects(() => recovered.appendBatch([]), /恢复阻断态/);
    await assert.rejects(() => recovered.resolveRecovery({ authorityRef: 'model:gpt', evidenceRefs: ['evidence:review'] }), /human Authority/);
    await recovered.resolveRecovery({ authorityRef: 'human:maintainer', evidenceRefs: ['evidence:review'] });
    assert.equal(recovered.healthSnapshot().recoveryRequired, false);
    const first = io.files.get(path).split(/\r?\n/).find(Boolean);
    assert.throws(() => parseEconomicsLog(`${first}\n{"broken":\n${first}\n`, { runId: RUN_ID }), /中段损坏/);
    const io2 = new MemoryIo(); const writingLedger = await openEconomicsEvaluationLedger({ io: io2, path: 'D:/slow.ndjson', runId: RUN_ID, clock: () => Date.parse(NOW) });
    io2.delayMs = 5; const writing = writingLedger.appendBatch(standardEconomicsMetricRecords(RUN_ID, { at: NOW }));
    await Promise.resolve(); const health = await writingLedger.dispose(); await writing;
    assert.equal(health.activeWrites, 0); assert.equal(health.disposed, true);
  });
});
