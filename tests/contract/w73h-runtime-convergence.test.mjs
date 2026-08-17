import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { openProductionRunLedger } from '../../renderer/modules/factory/production-run.js';
import { FactoryPanel } from '../../renderer/modules/factory/index.js';
import {
  FACTORY_RUNTIME_CONVERGENCE_SCHEMA,
  inspectFactoryRunConvergence,
  normalizeFactoryRunConvergenceCheckpoint,
  saveFactoryRunConvergenceCheckpoint,
} from '../../renderer/modules/factory/runtime-convergence.js';

const require = createRequire(import.meta.url);
const { FactoryRunOwnerRegistry } = require('../../main/factory-run-owners.js');
const { ResourceLedger } = require('../../main/resource-ledger.js');
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const clock = (() => { let now = Date.parse('2026-08-17T10:00:00.000Z'); return () => (now += 1000); })();
const diskIo = {
  exists: async target => fs.existsSync(target),
  mkdir: async target => { fs.mkdirSync(target, { recursive: true }); return true; },
  read: async target => fs.readFileSync(target, 'utf8'),
  write: async (target, content) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, target);
    return true;
  },
};

const fakeLedger = (runId, health = {}) => ({
  runId,
  healthSnapshot: () => ({ runId, activeWrites: 0, disposed: false, recoveryRequired: false, ...health }),
});

function inspect({ status = 'paused', runId = 'run-check', taskId = 'task-check', ...options } = {}) {
  const runLedger = {
    runId,
    snapshot: { runId, taskId, status, recoveryState: { required: false } },
    healthSnapshot: () => ({ runId, status, activeWrites: 0, disposed: false, requiresReload: false }),
  };
  return inspectFactoryRunConvergence({ task: { id: taskId }, runLedger, ...options });
}

describe('W73h cross-ledger convergence contract', () => {
  test('状态闭集、未知字段和 secret fail closed', () => {
    const valid = inspect();
    assert.equal(valid.schema, FACTORY_RUNTIME_CONVERGENCE_SCHEMA);
    assert.equal(valid.status, 'QUIESCENT');
    assert.throws(() => normalizeFactoryRunConvergenceCheckpoint({ ...valid, magic: true }), /未冻结字段/);
    assert.throws(() => normalizeFactoryRunConvergenceCheckpoint({ ...valid, provenance: { ...valid.provenance, apiKey: 'secret' } }), /禁止 secret/);
  });

  test('恢复、跨 Run、幽灵 running、终态活动与未结 Finding 都不能封板', () => {
    assert.equal(inspect({ auditLedger: fakeLedger('run-check', { recoveryRequired: true }) }).status, 'RECOVERY_REQUIRED');
    assert.equal(inspect({ auditLedger: fakeLedger('run-other') }).status, 'INCONSISTENT');
    assert.equal(inspect({ status: 'running' }).blockers[0].code, 'GHOST_RUNNING_RUN');
    assert.equal(inspect({ status: 'completed', ownerHeld: true }).blockers[0].code, 'TERMINAL_WITH_ACTIVITY');
    const unresolved = inspect({ status: 'completed', auditLedger: fakeLedger('run-check', { unresolvedFindings: 1 }) });
    assert.equal(unresolved.status, 'INCONSISTENT');
    assert.equal(unresolved.safeToSeal, false);
  });

  test('20 轮 create/start/pause/reopen/resume/complete 均可重放并回到零资源基线', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w73h-soak-'));
    const resources = new ResourceLedger({ historyLimit: 100 });
    let leaseSequence = 0;
    const owners = new FactoryRunOwnerRegistry({ resourceLedger: resources, idFactory: () => `soak-${++leaseSequence}` });
    try {
      for (let index = 0; index < 20; index++) {
        const runId = `run-soak-${String(index + 1).padStart(2, '0')}`;
        const taskId = `task-soak-${index + 1}`;
        const folder = path.join(base, taskId);
        const firstOwner = owners.acquire({ runId, taskId, ownerId: 'renderer-a' });
        let ledger = await openProductionRunLedger({ io: diskIo, folder, runId, taskId, clock });
        await ledger.append({ type: 'run-started', toStatus: 'running', reasonCode: 'SOAK_START' });
        assert.equal(inspectFactoryRunConvergence({ task: { id: taskId }, runLedger: ledger, taskActive: true, controllerActive: true, ownerHeld: true }).status, 'ACTIVE');
        await ledger.append({ type: 'run-paused', toStatus: 'paused', reasonCode: 'WINDOW_CLOSE' });
        await ledger.dispose();
        owners.release({ runId, leaseId: firstOwner.leaseId, ownerId: 'renderer-a', reason: 'window-close' });

        const secondOwner = owners.acquire({ runId, taskId, ownerId: 'renderer-b' });
        ledger = await openProductionRunLedger({ io: diskIo, folder, runId, taskId, clock, recoverOrphaned: true });
        assert.equal(ledger.snapshot.status, 'paused');
        await ledger.append({ type: 'run-started', toStatus: 'running', reasonCode: 'EXPLICIT_RESUME' });
        await ledger.append({ type: 'run-completed', toStatus: 'completed', reasonCode: 'SOAK_COMPLETE', artifactRefs: [{ kind: 'artifact', path: `${folder}/final.md`, role: 'final-output' }] });
        owners.release({ runId, leaseId: secondOwner.leaseId, ownerId: 'renderer-b', reason: 'task-completed' });
        const checkpoint = inspectFactoryRunConvergence({ task: { id: taskId }, runLedger: ledger });
        assert.equal(checkpoint.status, 'CONVERGED');
        assert.equal(checkpoint.safeToSeal, true);
        const saved = await saveFactoryRunConvergenceCheckpoint({ io: diskIo, runFolder: ledger.paths.root, checkpoint });
        assert.equal(JSON.parse(fs.readFileSync(saved.path, 'utf8')).status, 'CONVERGED');
        const disposed = await ledger.dispose();
        assert.equal(disposed.activeWrites, 0);
        assert.equal(resources.snapshot().activeCount, 0);
      }
      assert.equal(owners.healthSnapshot().activeOwners, 0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('cancel/fail 是可重开的明确终态，但都不能冒充 seal', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w73h-terminal-'));
    try {
      for (const terminal of [
        { type: 'run-cancelled', toStatus: 'cancelled', reasonCode: 'TASK_DELETED' },
        { type: 'run-failed', toStatus: 'failed', reasonCode: 'PROVIDER_REFUSED' },
      ]) {
        const taskId = `task-${terminal.toStatus}`; const runId = `run-${terminal.toStatus}`;
        const folder = path.join(base, taskId);
        let ledger = await openProductionRunLedger({ io: diskIo, folder, runId, taskId, clock });
        await ledger.append({ type: 'run-started', toStatus: 'running' });
        await ledger.append(terminal);
        const checkpoint = inspectFactoryRunConvergence({ task: { id: taskId }, runLedger: ledger });
        assert.equal(checkpoint.status, 'CONVERGED');
        assert.equal(checkpoint.safeToSeal, false);
        await ledger.dispose();
        ledger = await openProductionRunLedger({ io: diskIo, folder, runId, taskId, clock, recoverOrphaned: true });
        assert.equal(ledger.snapshot.status, terminal.toStatus);
        await ledger.dispose();
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('FactoryPanel dispose 等待任务后先收 Harness Session，再收承接终态的账本', async () => {
    const order = [];
    const panel = Object.create(FactoryPanel.prototype);
    panel.disposed = false; panel.disposePromise = null; panel.runningTasks = new Set(); panel.taskControllers = new Map();
    panel.taskSettlements = new Map([['task-1', Promise.resolve().then(() => order.push('task-settled'))]]);
    panel.productionRunOwnerLeases = new Map(); panel.workshopWrites = new Map();
    panel.qualificationDelegationServices = new Map([['task-1', { dispose: async () => { order.push('service-disposed'); } }]]);
    panel.staffingCoordinator = { dispose: () => order.push('staffing-disposed'), healthSnapshot: () => ({ active: 0 }) };
    const ledger = name => ({ dispose: async () => { order.push(name); } });
    panel.scheduleLedgers = new Map([['task-1', ledger('schedule-ledger')]]);
    panel.economicsEvaluationLedgers = new Map([['task-1', ledger('economics-ledger')]]);
    panel.reworkAuditLedgers = new Map([['task-1', ledger('audit-ledger')]]);
    panel.delegationLedgers = new Map([['task-1', ledger('delegation-ledger')]]);
    panel.qualificationLedgers = new Map([['task-1', ledger('qualification-ledger')]]);
    panel.productionRunLedgers = new Map([['task-1', ledger('production-ledger')]]);
    panel.requestStopAll = () => order.push('stop-requested');
    panel.taskUpdateListener = () => {}; panel.beforeUnloadListener = () => {};
    const health = await panel.dispose();
    assert.equal(health.disposed, true);
    assert.ok(order.indexOf('task-settled') < order.indexOf('service-disposed'));
    assert.ok(order.indexOf('service-disposed') < order.indexOf('delegation-ledger'));
    assert.equal(panel.productionRunLedgers.size, 0);
    assert.equal(panel.taskSettlements.size, 0);
    assert.equal(panel.claimTask({ id: 'late-task' }), false);
  });

  test('renderer/main/preload 已形成 owner、取消、恢复和有序 dispose 闭环且未创建第二 Factory', () => {
    const main = fs.readFileSync(path.join(root, 'main/main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(root, 'preload/bridge.js'), 'utf8');
    const panel = fs.readFileSync(path.join(root, 'renderer/modules/factory/index.js'), 'utf8');
    const owners = fs.readFileSync(path.join(root, 'main/factory-run-owners.js'), 'utf8');
    assert.match(main, /factory:runAcquire/);
    assert.match(main, /releaseOwner\(ownerId, 'renderer-gone'\)/);
    assert.match(main, /factoryRunOwners\.destroy\('app-quit'\)/);
    assert.match(preload, /factory:runAcquire.*factory:runRelease/s);
    assert.ok(panel.indexOf("await this.acquireProductionRunOwner(task, task.productionRunId)") < panel.indexOf('recoverOrphaned: true'));
    assert.ok(panel.indexOf("await attempt('delegation-service'") < panel.indexOf("await attempt('delegation-ledger'"));
    assert.match(panel, /W73F_ECONOMICS_RECOVERY_REQUIRED/);
    assert.match(panel, /type: 'run-cancelled'.*TASK_DELETED/s);
    assert.doesNotMatch(owners, /BrowserWindow|registerModule|runW68Review|chatStream|child_process|automaticFallback/);
  });
});
