import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const [{ FactoryPanel }, { W68_PROTOCOL }] = await Promise.all([
  import('../../renderer/modules/factory/index.js'),
  import('../../renderer/modules/factory/review.js'),
]);

const EVIDENCE = [{ kind: 'evidence', id: 'probe-evidence', path: 'D:/Factory/probe.json', type: 'application/json', role: 'probe-result' }];

function specimen() {
  const files = new Map();
  const directories = new Set();
  const harnessCalls = [];
  window.mazz = {
    invoke: async (channel, payload = {}) => {
      if (channel === 'fs:stat') return files.has(payload.path)
        ? { exists: true, isDir: false, size: files.get(payload.path).length }
        : { exists: directories.has(payload.path), isDir: directories.has(payload.path) };
      if (channel === 'fs:readFile') {
        if (!files.has(payload.path)) throw new Error(`ENOENT ${payload.path}`);
        return files.get(payload.path);
      }
      if (channel === 'fs:writeFile') { files.set(payload.path, String(payload.content)); return true; }
      if (channel === 'fs:mkdir') { directories.add(payload.path); return true; }
      if (channel === 'factory:runAcquire') return { ok: true, code: 'ACQUIRED', leaseId: `lease:${payload.runId}` };
      if (channel === 'factory:runRelease') return { ok: true, code: 'RELEASED' };
      if (channel === 'harness:adapters') { harnessCalls.push([channel]); return []; }
      if (channel.startsWith('harness:')) { harnessCalls.push([channel, payload]); throw new Error(`unexpected harness execution ${channel}`); }
      throw new Error(`unexpected channel ${channel}`);
    },
  };
  const panel = Object.create(FactoryPanel.prototype);
  panel.productionRunLedgers = new Map(); panel.reworkAuditLedgers = new Map();
  panel.productionRunOwnerLeases = new Map();
  panel.qualificationLedgers = new Map(); panel.delegationLedgers = new Map();
  panel.qualificationDelegationServices = new Map();
  panel.cfg = { providerId: 'provider-a', model: 'model-a', apiKey: 'TOP-SECRET-KEY' };
  panel.persistTasks = () => {};
  return { panel, files, directories, harnessCalls };
}

function task(overrides = {}) {
  return {
    id: 'task-w73d-integration', label: 'W73d 集成样本', folder: 'D:/Factory/W73d', mode: 'single',
    reviewProtocol: W68_PROTOCOL, reviewRitual: 'light', reviewBudgetCap: 32000, ...overrides,
  };
}

function qualificationRows({
  suffix = 'internal', executorRef = 'agent-runtime:closed', seatRef = 'seat:restricted-editor',
} = {}) {
  return [
    {
      recordId: `definition:${suffix}:defined`, type: 'qualification-defined', definitionId: `definition:${suffix}`,
      seatRefs: [seatRef], probePackRef: `asset:probe-pack/${suffix}`, probePackVersion: '1.0.0', passingScore: 80,
      actorRef: 'human:maintainer', authorityRef: 'human:maintainer',
    },
    {
      recordId: `attempt:${suffix}:recorded`, type: 'qualification-attempt-recorded', definitionId: `definition:${suffix}`,
      attemptId: `attempt:${suffix}`, executorRef, score: 95, outcome: 'passed', evidenceRefs: EVIDENCE,
      startedAt: '2026-08-16T00:00:00.000Z', completedAt: '2026-08-16T00:30:00.000Z',
    },
    {
      recordId: `certificate:${suffix}:issued`, type: 'qualification-certificate-issued', definitionId: `definition:${suffix}`,
      attemptId: `attempt:${suffix}`, certificateId: `certificate:${suffix}`, executorRef, seatRefs: [seatRef],
      authorityRef: 'human:maintainer', evidenceRefs: EVIDENCE, issuedAt: '2026-08-16T01:00:00.000Z',
      validFrom: '2026-08-16T01:00:00.000Z', expiresAt: '2027-08-16T01:00:00.000Z',
    },
  ];
}

describe('W73d Factory 单路径集成', () => {
  test('ensure 在同一 W68 Production Run 旁路打开项目资格账与单 Run 委托账', async () => {
    const { panel, files } = specimen();
    const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    assert.equal(files.has(run.paths.qualifications), true);
    assert.equal(files.has(run.paths.delegations), true);
    assert.equal(target.productionRunStatus, 'running');
    assert.equal(panel.qualificationLedgers.get(target.id).path, run.paths.qualifications);
    assert.equal(panel.delegationLedgers.get(target.id).runId, run.runId);
    assert.equal(panel.qualificationDelegationServices.has(target.id), true);
  });

  test('人工签证、内部闭集 AgentRuntime 与 Production Run 引用在一条事实链', async () => {
    const { panel, files } = specimen();
    const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    await panel.appendQualificationRecords(target, qualificationRows());
    const runtime = { submit: async () => ({ status: 'done', message: '闭集命令执行完成' }) };
    const result = await panel.delegateInternalAgent(target, '执行已登记命令', {
      runtime, restricted: true, seatRef: 'seat:restricted-editor', executorRef: 'agent-runtime:closed',
      certificateRef: 'certificate:internal', instructionRef: 'artifact:instruction#internal', resultRef: 'artifact:result#internal',
    });
    assert.equal(result.status, 'completed');
    assert.ok(run.snapshot.qualificationRefs.includes('certificate:internal'));
    assert.ok(run.snapshot.delegationRefs.includes(result.delegationId));
    assert.match(files.get(run.paths.delegations), /internal-agent-runtime/);
    assert.doesNotMatch(files.get(run.paths.delegations), /TOP-SECRET-KEY|providerBoundary|providerRef|modelRef/);
    assert.equal(target.qualificationCertificateCount, 1);
    assert.equal(target.delegationCount, 1);
  });

  test('产品登记 Adapter=0 时外部委托只报 HARNESS_UNAVAILABLE，不调用 Session', async () => {
    const { panel, files, harnessCalls } = specimen();
    const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    await panel.appendQualificationRecords(target, qualificationRows({ suffix: 'external', executorRef: 'harness-executor:none', seatRef: 'seat:external-agent' }));
    const result = await panel.delegateExternalAgent(target, '外部任务', {
      restricted: true, seatRef: 'seat:external-agent', executorRef: 'harness-executor:none',
      certificateRef: 'certificate:external', instructionRef: 'artifact:instruction#external',
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.code, 'HARNESS_UNAVAILABLE');
    assert.equal(result.message, 'BLOCKED: HARNESS_UNAVAILABLE');
    assert.deepEqual(harnessCalls.map(row => row[0]), ['harness:adapters']);
    assert.match(files.get(run.paths.delegations), /HARNESS_UNAVAILABLE/);
    assert.ok(run.snapshot.delegationRefs.includes(result.delegationId));
  });

  test('受限 Seat 无证先由资格门阻断，不尝试 Harness 或 AgentRuntime', async () => {
    const { panel, harnessCalls } = specimen();
    const target = task();
    await panel.ensureProductionRun(target, { id: 'novel' });
    let internalRuns = 0;
    const internal = await panel.delegateInternalAgent(target, '不可执行', {
      runtime: { submit: async () => { internalRuns++; } }, restricted: true,
      seatRef: 'seat:restricted-editor', executorRef: 'agent-runtime:closed',
    });
    assert.equal(internal.code, 'QUALIFICATION_REQUIRED');
    assert.equal(internalRuns, 0);
    const external = await panel.delegateExternalAgent(target, '不可执行', {
      restricted: true, seatRef: 'seat:external-agent', executorRef: 'harness-executor:none',
    });
    assert.equal(external.code, 'QUALIFICATION_REQUIRED');
    assert.equal(harnessCalls.length, 0);
  });

  test('资格/委托尾损坏会让 Run 保持 blocked，max/legacy 仍不迁移', async () => {
    const { panel, files } = specimen();
    const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    const delegation = panel.delegationLedgers.get(target.id);
    await panel.qualificationDelegationServices.get(target.id).dispose();
    panel.qualificationDelegationServices.delete(target.id);
    await delegation.dispose();
    panel.delegationLedgers.delete(target.id);
    files.set(run.paths.delegations, '{"broken":');
    await assert.rejects(() => panel.ensureProductionRun(target, { id: 'novel' }), error => error?.code === 'W73D_LEDGER_RECOVERY_REQUIRED');
    assert.equal(run.snapshot.status, 'blocked');
    assert.equal(panel.delegationLedgers.get(target.id).healthSnapshot().recoveryRequired, true);
    assert.equal(await panel.appendQualificationRecords(task({ mode: 'max' }), qualificationRows()), null);
    assert.equal(await panel.delegateInternalAgent(task({ reviewProtocol: 'legacy' }), 'ignored'), null);
  });

  test('W73d 没有偷渡 W73e Scheduler、KPI、Router、Hub 或 Promotion', () => {
    const source = fs.readFileSync(new URL('../../renderer/modules/factory/qualification-delegation.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /candidateSet|backpressure|overallScore|marketplace|Promotion|Publication|Canon/);
    assert.doesNotMatch(source, /providerBoundary|resolveProviderRoute|chatStream|fetch\s*\(|WebSocket|localStorage/);
    const main = fs.readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8');
    assert.match(main, /new AgentHarnessService\(\{[\s\S]*bus, windowManager: wm, resourceLedger, cliSupervisor, adapters,[\s\S]*activationProvider:/);
    assert.match(main, /new CliSupervisor\(\{ resourceLedger \}\)/);
    assert.match(main, /new KimiCodeAdapter\(\{ supervisor: cliSupervisor \}\)/);
    assert.match(main, /new ClaudeCodeAdapter\(\{ supervisor: cliSupervisor \}\)/);
    assert.match(main, /new CodexAdapter\(\{ supervisor: cliSupervisor \}\)/);
  });
});
