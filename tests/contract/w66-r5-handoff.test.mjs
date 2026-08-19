import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { AgentHandoffCoordinator, HANDOFF_SCHEMA } = require('../../main/agent-handoff.js');
const { AgentHarnessService } = require('../../main/agent-harness.js');

function registryFixture({ failTarget = false } = {}) {
  const sessions = new Map(); const calls = []; let sequence = 0;
  return {
    sessions, calls,
    async createSession(input) {
      calls.push(`create:${input.adapterId}`);
      if (failTarget && input.adapterId === 'codex') throw Object.assign(new Error('missing'), { code: 'CLI_NOT_INSTALLED' });
      sequence += 1;
      const value = { id: `s-${sequence}`, adapterId: input.adapterId, state: 'running', attemptId: `a-${sequence}` };
      sessions.set(value.id, value); return value;
    },
    session(id) { return sessions.get(id); },
    publicSession(row) { return { ...row }; },
    async interrupt(id) { calls.push(`interrupt:${id}`); sessions.get(id).state = 'cancelled'; },
    async dispose(id) { calls.push(`dispose:${id}`); sessions.delete(id); },
  };
}

describe('W66-R5 Attempt / Handoff / safe hot switch', () => {
  test('Run start/switch 与普通 Session 共用 Doctrine Activation Provider', async () => {
    const handlers = new Map();
    const bus = { handle(channel, fn) { handlers.set(channel, fn); } };
    const activationCalls = [];
    const service = new AgentHarnessService({
      bus,
      windowManager: { broadcast() {} },
      resourceLedger: { snapshot() { return { activeCount: 0 }; } },
      activationProvider: async profile => {
        activationCalls.push(profile);
        return { doctrineRoot: 'compiled-doctrine', attemptId: 'attempt-1', permissionPreview: { status: 'restricted', profileRef: profile } };
      },
    });
    service.handoffs.start = async (_runId, payload) => payload;
    service.handoffs.switch = async (_runId, payload) => payload;
    const started = await handlers.get('harness:startRun')({ runId: 'run-activation', permissionProfileRef: 'restricted' });
    const switched = await handlers.get('harness:switchRun')({ runId: 'run-activation', toAdapterId: 'codex', permissionProfileRef: 'restricted' });
    assert.equal(started.activation.doctrineRoot, 'compiled-doctrine');
    assert.equal(switched.activation.doctrineRoot, 'compiled-doctrine');
    assert.deepEqual(activationCalls, ['restricted', 'restricted']);
  });

  test('同 Run 顺序切换，来源释放和 Handoff 落盘先于目标 spawn', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-handoff-'));
    try {
      const registry = registryFixture();
      const coordinator = new AgentHandoffCoordinator({ registry, idFactory: () => 'fixed' });
      coordinator.createRun({ runRef: 'run-1', taskRef: 'task-1', workspace });
      const first = await coordinator.start('run-1', { adapterId: 'kimi-code' });
      const switched = await coordinator.switch('run-1', { toAdapterId: 'codex', activation: {}, snapshot: { dirtyDiffRef: 'git:diff', unresolved: ['verify'] } });
      assert.equal(switched.run.id, first.run.id);
      assert.equal(switched.run.attemptNo, 2);
      assert.notEqual(switched.session.id, first.session.id);
      assert.ok(registry.calls.indexOf(`dispose:${first.session.id}`) < registry.calls.indexOf('create:codex'));
      const handoff = JSON.parse(fs.readFileSync(switched.handoffRef, 'utf8'));
      assert.equal(handoff.schemaVersion, HANDOFF_SCHEMA);
      assert.deepEqual(handoff.unresolved, ['verify']);
    } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
  });

  test('writer lease/in-flight tool 阻断切换，目标失败仍保留恢复快照', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-handoff-fail-'));
    try {
      const registry = registryFixture({ failTarget: true });
      const coordinator = new AgentHandoffCoordinator({ registry, idFactory: () => 'fixed' });
      coordinator.createRun({ runRef: 'run-2', workspace });
      await coordinator.start('run-2', { adapterId: 'claude-code' });
      await assert.rejects(() => coordinator.switch('run-2', { toAdapterId: 'codex', snapshot: { writerLeaseHeld: true } }), error => error.code === 'HANDOFF_WRITER_LEASE_HELD');
      await assert.rejects(() => coordinator.switch('run-2', { toAdapterId: 'codex', snapshot: { unresolved: ['retry activation'] } }), error => error.code === 'CLI_NOT_INSTALLED' && fs.existsSync(error.handoffRef));
      assert.equal(coordinator.run('run-2').status, 'recovery-required');
    } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
  });
});
