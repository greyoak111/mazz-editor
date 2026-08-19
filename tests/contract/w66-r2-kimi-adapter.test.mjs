import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { CliSupervisor } = require('../../main/agent-cli-supervisor.js');
const { KimiCodeAdapter, acpEvent } = require('../../main/adapters/kimi-code-adapter.js');

function activationInput() {
  return { workspace: process.cwd(), instruction: 'finish task', modelTarget: { requestedModel: 'kimi-fixture-model' }, rulePackInjection: { rawSource: Buffer.from('FULL RULES'), compiledView: { rawSource: { injection: 'REQUIRED_FULL_BYTES' } } }, permissionProfileRef: 'restricted' };
}

describe('W66-R2 Kimi Code ACP Adapter', () => {
  test('真实子进程完成 initialize/session/new/prompt 并规范化事件', async () => {
    const adapter = new KimiCodeAdapter({ supervisor: new CliSupervisor(), executablePath: process.execPath, launchArgs: ['tests/fixtures/fake-acp-agent.cjs'], idFactory: () => 'kimi-local' });
    const detected = await adapter.detect();
    assert.equal(detected.available, true);
    const probed = await adapter.probe();
    assert.equal(probed.ok, true);
    const handle = await adapter.createSession(activationInput());
    assert.equal(adapter.sessions.get(handle.id).resolvedModel, 'kimi-fixture-model');
    const events = [];
    const unsubscribe = await adapter.events(handle, (type, payload) => events.push({ type, payload }));
    const sent = await adapter.send(handle, 'hello');
    assert.equal(sent.stopReason, 'end_turn');
    assert.ok(events.some(row => row.type === 'message' && row.payload.text.startsWith('received:')));
    assert.ok(events.some(row => row.type === 'result'));
    await unsubscribe();
    await adapter.dispose(handle);
    assert.equal(adapter.sessions.size, 0);
  });

  test('没有完整 Raw + Compiled Doctrine 时零 spawn', async () => {
    const supervisor = new CliSupervisor();
    const adapter = new KimiCodeAdapter({ supervisor, executablePath: process.execPath, launchArgs: ['tests/fixtures/fake-acp-agent.cjs'] });
    await assert.rejects(() => adapter.createSession({ workspace: process.cwd() }), error => error.code === 'RULE_PACK_REQUIRED');
    assert.equal(supervisor.activeCount(), 0);
  });

  test('ACP event 保留统一语义而不外泄 vendor 原文', () => {
    assert.equal(acpEvent({ sessionUpdate: 'tool_call', title: 'Read' })[0], 'tool');
    assert.equal(acpEvent({ sessionUpdate: 'agent_message_chunk', content: { text: 'ok' } })[0], 'message');
  });
});
