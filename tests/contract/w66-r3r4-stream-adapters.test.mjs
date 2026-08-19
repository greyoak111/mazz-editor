import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { CliSupervisor } = require('../../main/agent-cli-supervisor.js');
const { ClaudeCodeAdapter } = require('../../main/adapters/claude-code-adapter.js');
const { CodexAdapter } = require('../../main/adapters/codex-adapter.js');

const activation = adapter => ({ workspace: process.cwd(), instruction: 'task', modelTarget: { requestedModel: 'fixture' }, permissionProfileRef: 'restricted', rulePackInjection: { rawSource: Buffer.from('FULL RULES'), compiledView: { id: 'compiled' } }, adapter });

function fixture(Adapter, kind) {
  return new Adapter({ supervisor: new CliSupervisor(), executablePath: process.execPath, commandPrefix: ['tests/fixtures/fake-jsonl-agent.cjs', `${kind}-fixture`], idFactory: () => `${kind}-local` });
}

describe('W66-R3 Claude Code Adapter', () => {
  test('stream-json 事件、Session ID、usage 与受限权限参数完成闭环', async () => {
    const adapter = fixture(ClaudeCodeAdapter, 'claude');
    assert.equal((await adapter.probe()).auth.status, 'authenticated');
    const handle = await adapter.createSession(activation(adapter));
    const events = [];
    await adapter.events(handle, (type, payload) => events.push({ type, payload }));
    const result = await adapter.send(handle, 'hello');
    assert.equal(result.vendorSessionId, 'claude-session');
    assert.ok(events.some(row => row.type === 'message' && row.payload.text.startsWith('claude:')));
    assert.ok(events.some(row => row.type === 'tool'));
    assert.ok(events.some(row => row.type === 'usage' && row.payload.outputTokens === 4));
    await adapter.dispose(handle);
  });
});

describe('W66-R4 Codex Adapter', () => {
  test('exec JSONL、thread resume 引用、usage 与 WindowsApps 拒绝策略完成闭环', async () => {
    const adapter = fixture(CodexAdapter, 'codex');
    assert.equal((await adapter.probe()).auth.status, 'authenticated');
    const handle = await adapter.createSession(activation(adapter));
    const events = [];
    await adapter.events(handle, (type, payload) => events.push({ type, payload }));
    const result = await adapter.send(handle, 'hello');
    assert.equal(result.vendorSessionId, 'codex-thread');
    assert.ok(events.some(row => row.type === 'message' && row.payload.text.startsWith('codex:')));
    assert.ok(events.some(row => row.type === 'usage' && row.payload.inputTokens === 5));
    await adapter.dispose(handle);
  });

  test('三家均缺 Rule Pack 时在 spawn 前失败', async () => {
    const adapter = fixture(CodexAdapter, 'codex');
    await assert.rejects(() => adapter.createSession({ workspace: process.cwd() }), error => error.code === 'RULE_PACK_REQUIRED');
    assert.equal(adapter.supervisor.activeCount(), 0);
  });

  test('Codex 不使用 bypass/auto approval，受限档明确 read-only', () => {
    const adapter = fixture(CodexAdapter, 'codex');
    const args = adapter.buildArgs({ input: activation(adapter), vendorSessionId: '', handle: { id: 'x' } });
    assert.ok(args.includes('read-only'));
    assert.equal(args.some(value => /bypass|approve-for-me|ask-for-approval/i.test(value)), false);
  });
});
