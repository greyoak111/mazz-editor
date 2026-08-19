// tests/contract/w71-harness-foundation.test.mjs —— W66/W71 Agent Harness Foundation
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { ResourceLedger } = require('../../main/resource-ledger.js');
const {
  AgentHarnessRegistry,
  AgentHarnessService,
  CAPABILITY_KEYS,
  normalizeCapabilities,
  validateAdapter,
} = require('../../main/agent-harness.js');

function fakeAdapter({ id = 'fake', failSend = false } = {}) {
  return {
    id,
    displayName: `Fake ${id}`,
    async detect() { return { available: true, command: `${id}.exe`, version: '1.0.0' }; },
    async probe() { return { ok: true, auth: 'test' }; },
    async capabilities() { return { workspace: true, fileEdit: true, structuredOutput: true }; },
    async createSession(context) { return { context, emit: null, disposed: false }; },
    async events(handle, emit) { handle.emit = emit; return () => { handle.emit = null; }; },
    async send(handle, input) {
      if (failSend) { const error = new Error('boom'); error.code = 'FAKE_SEND'; throw error; }
      handle.emit('stdout', { text: String(input) }, { vendor: 'fake' });
      handle.emit('state', { state: 'waiting' });
      return { accepted: true };
    },
    async interrupt(handle) { handle.interrupted = true; },
    async dispose(handle) { handle.disposed = true; },
  };
}

const activationGate = async () => ({
  receipt: { attemptId: 'attempt-test', rulePackId: 'rule-pack:test', rulePackHash: 'a'.repeat(64), compiledRulePackHash: 'b'.repeat(64), permissionProfileRef: 'permission:test' },
  injection: { rawSource: Buffer.from('rules'), rawSourceText: 'rules', compiledView: {}, manifest: {} },
});

describe('W66 HarnessAdapter v1 契约', () => {
  test('缺少生命周期方法的 Adapter 在登记前被拒绝', () => {
    assert.throws(() => validateAdapter({ id: 'bad' }), /detect/);
    assert.throws(() => validateAdapter({ ...fakeAdapter(), id: '' }), /id 必填/);
  });

  test('Capability 固定字段完整且未知能力不污染公共契约', () => {
    const caps = normalizeCapabilities({ workspace: 1, terminal: false, vendorMagic: true });
    assert.deepEqual(Object.keys(caps), [...CAPABILITY_KEYS]);
    assert.equal(caps.workspace, true);
    assert.equal(caps.terminal, false);
    assert.equal('vendorMagic' in caps, false);
  });

  test('detect / probe 与 N Adapter Registry 不含厂商分支', async () => {
    const registry = new AgentHarnessRegistry();
    registry.register(fakeAdapter({ id: 'alpha' }));
    registry.register(fakeAdapter({ id: 'beta' }));
    assert.deepEqual((await registry.listAdapters()).map(x => x.id), ['alpha', 'beta']);
    assert.equal((await registry.detect('alpha')).available, true);
    assert.equal((await registry.probe('beta')).ok, true);
    assert.throws(() => registry.register(fakeAdapter({ id: 'alpha' })), /重复/);
  });
});

describe('W66 Session lifecycle 与资源收敛', () => {
  test('create/send/wait/interrupt/dispose 全链进入统一事件和资源账本', async () => {
    let seq = 0;
    const events = [];
    const ledger = new ResourceLedger({ now: () => ++seq });
    const registry = new AgentHarnessRegistry({
      onEvent: event => events.push(event), resourceLedger: ledger,
      now: () => ++seq, idFactory: () => 'session-1', activationGate,
    });
    registry.register(fakeAdapter());
    const created = await registry.createSession({ adapterId: 'fake', workspace: 'D:/workspace', instruction: 'do it' });
    assert.equal(created.state, 'running');
    assert.equal(ledger.snapshot().activeCount, 1);
    await registry.send(created.id, 'hello');
    assert.equal(registry.listSessions()[0].state, 'waiting');
    assert.deepEqual(events.map(x => x.type), ['rule-pack-loaded', 'started', 'stdout', 'state']);
    assert.equal(events[2].raw.vendor, 'fake', '厂商原始事件只保留在 raw');
    await registry.interrupt(created.id);
    assert.equal(registry.listSessions()[0].state, 'cancelled');
    await registry.dispose(created.id, 'test-finished');
    assert.equal(registry.listSessions().length, 0);
    const released = ledger.snapshot({ includeReleased: true });
    assert.equal(released.activeCount, 0);
    assert.equal(released.released[0].releaseReason, 'test-finished');
  });

  test('send 错误归一进入 failed，仍可 dispose 收尸', async () => {
    const events = [];
    const registry = new AgentHarnessRegistry({ onEvent: event => events.push(event), idFactory: () => 'session-fail', activationGate });
    registry.register(fakeAdapter({ failSend: true }));
    await registry.createSession({ adapterId: 'fake' });
    await assert.rejects(() => registry.send('session-fail', 'bad'), /boom/);
    assert.equal(registry.listSessions()[0].state, 'failed');
    assert.equal(events.at(-1).payload.code, 'FAKE_SEND');
    await registry.dispose('session-fail');
    assert.equal(registry.listSessions().length, 0);
  });

  test('在飞 send 被 interrupt 后保持 cancelled，不被迟到 CLI_CANCELLED 改写成 failed', async () => {
    let rejectSend;
    const adapter = fakeAdapter({ id: 'cancel-race' });
    adapter.send = async () => new Promise((_resolve, reject) => { rejectSend = reject; });
    adapter.interrupt = async handle => {
      handle.emit('completed', { status: 'cancelled' });
      const error = Object.assign(new Error('cancelled'), { code: 'CLI_CANCELLED' });
      rejectSend(error);
    };
    const registry = new AgentHarnessRegistry({ idFactory: () => 'session-cancel-race', activationGate });
    registry.register(adapter);
    await registry.createSession({ adapterId: adapter.id });
    const pending = registry.send('session-cancel-race', 'slow turn');
    await Promise.resolve();
    await registry.interrupt('session-cancel-race');
    await assert.rejects(() => pending, error => error.code === 'CLI_CANCELLED');
    assert.equal(registry.listSessions()[0].state, 'cancelled');
    await registry.dispose('session-cancel-race');
    assert.equal(registry.listSessions().length, 0);
  });

  test('createSession 半途失败会释放已建 handle 与资源，不留幽灵 Session', async () => {
    const ledger = new ResourceLedger();
    const adapter = fakeAdapter({ id: 'broken-events' });
    let disposed = false;
    adapter.events = async () => { throw new Error('subscribe failed'); };
    adapter.dispose = async handle => { handle.disposed = true; disposed = true; };
    const registry = new AgentHarnessRegistry({ resourceLedger: ledger, idFactory: () => 'session-start-fail', activationGate });
    registry.register(adapter);
    await assert.rejects(() => registry.createSession({ adapterId: adapter.id }), /subscribe failed/);
    assert.equal(disposed, true);
    assert.equal(registry.listSessions().length, 0);
    assert.equal(ledger.snapshot().activeCount, 0);
  });
});

describe('主进程 IPC 与 Preload 白名单', () => {
  test('Foundation 通道完整接线且应用退出有统一收尸口', () => {
    const handlers = new Map();
    const bus = { handle: (name, fn) => handlers.set(name, fn) };
    const windowManager = { broadcast() {} };
    const ledger = new ResourceLedger();
    const service = new AgentHarnessService({ bus, windowManager, resourceLedger: ledger });
    for (const channel of ['harness:adapters', 'harness:detect', 'harness:probe', 'harness:createSession', 'harness:send', 'harness:interrupt', 'harness:dispose', 'harness:sessions', 'resources:snapshot']) {
      assert.equal(typeof handlers.get(channel), 'function', `${channel} 未注册`);
    }
    assert.equal(typeof service.killAll, 'function');

    const preload = fs.readFileSync(path.resolve('preload/bridge.js'), 'utf8');
    const main = fs.readFileSync(path.resolve('main/main.js'), 'utf8');
    assert.ok(preload.includes("'harness:event'"));
    assert.ok(main.includes('new AgentHarnessService'));
    assert.ok(main.includes('new CliSupervisor'));
    assert.ok(main.includes('harness.killAll()'));
    assert.ok(main.includes('event.preventDefault()'), '应用退出必须等待 Harness 异步收尸');
  });
});
