// tests/contract/hotfix-w62a.test.mjs —— W62a 指令台/AI 路由器契约
import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { CommandRegistry } from '../../renderer/core/command-registry.js';
import {
  AgentRuntime, appendLedger, decideAgentCommand, frequentLedgerInputs, ledgerToMarkdown,
  normalizeLedger, parseAgentDecision, resolveLedgerInput, validateAgentArgs,
} from '../../renderer/modules/factory/agent.js';

const src = rel => fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');
const factorySrc = src('renderer/modules/factory/index.js');
const registrySrc = src('renderer/core/command-registry.js');

describe('W62a 命令工具卡闭集', () => {
  test('注册表只导出脱敏工具卡，危险命令代码判定', () => {
    const registry = new CommandRegistry();
    registry.register('demo.safe', { title: '安全动作', run: () => 1 });
    registry.register('demo.delete', { title: '删除记录', run: () => 2 });
    registry.register('demo.hidden', { title: '内部动作', agent: false, run: () => 3 });
    const cards = registry.toolCards();
    assert.deepEqual(new Set(cards.map(x => x.id)), new Set(['demo.delete', 'demo.safe']));
    assert.equal(cards.find(x => x.id === 'demo.delete').danger, true);
    assert.equal(cards.find(x => x.id === 'demo.safe').argsSchema.additionalProperties, false);
    assert.equal(cards.some(x => 'run' in x), false);
  });

  test('JSON 决策拒绝闭集外命令、坏形状和坏参数类型', () => {
    const cards = [{ id: 'demo.echo', title: '回显', danger: false, argsSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } }, additionalProperties: false } }];
    assert.deepEqual(parseAgentDecision('{"command":"demo.echo","args":{"text":"好"}}', cards), { command: 'demo.echo', args: { text: '好' } });
    assert.throws(() => parseAgentDecision('{"command":"demo.fake","args":{}}', cards), /闭集/);
    assert.throws(() => parseAgentDecision('{"command":"demo.echo","args":{"text":1}}', cards), /类型/);
    assert.throws(() => validateAgentArgs({ text: '好', extra: 1 }, cards[0].argsSchema), /未声明/);
  });

  test('不合格输出只重试一次后收取合格 JSON', async () => {
    let calls = 0, systemSeen = '';
    const result = await decideAgentCommand({
      input: '测试', cards: [{ id: 'demo.echo', title: '回显', danger: false, argsSchema: { type: 'object' } }], ledger: normalizeLedger(),
      ask: async req => { systemSeen = req.system; return ++calls === 1 ? '我建议先看看' : '{"command":"demo.echo","args":{}}'; },
    });
    assert.equal(calls, 2);
    assert.equal(result.command, 'demo.echo');
    assert.match(systemSeen, /demo\.echo[\s\S]*args=\{"type":"object"\}/);
  });
});

describe('W62a 最小 agent 环', () => {
  test('多步链每步执行结果都会喂回下一轮', async () => {
    const registry = new CommandRegistry();
    const ran = [], seen = [];
    registry.register('demo.one', { title: '第一步', run: async () => { ran.push('one'); return '结果一'; } });
    registry.register('demo.two', { title: '第二步', run: async () => { ran.push('two'); return '结果二'; } });
    const decisions = [
      { command: 'demo.one', args: {} }, { command: 'demo.two', args: {} },
      { command: 'agent.finish', args: { message: '两步完成' } },
    ];
    let saved;
    const runtime = new AgentRuntime({
      registry, ledger: normalizeLedger(), saveLedger: async x => { saved = x; },
      decide: async ctx => { seen.push(ctx.transcript.map(x => x.result)); return decisions.shift(); },
    });
    const out = await runtime.submit('先一再二');
    assert.deepEqual(ran, ['one', 'two']);
    assert.deepEqual(seen[1], ['结果一']);
    assert.deepEqual(seen[2], ['结果一', '结果二']);
    assert.equal(out.status, 'done');
    assert.equal(saved.entries.filter(x => x.type === 'tool').length, 2);
  });

  test('危险命令暂停为确认卡，取消前绝不执行', async () => {
    const registry = new CommandRegistry(); let ran = 0; const events = [];
    registry.register('demo.delete', { title: '删除', run: () => { ran++; } });
    const runtime = new AgentRuntime({ registry, ledger: normalizeLedger(), decide: async () => ({ command: 'demo.delete', args: { id: 1 } }), onEvent: e => events.push(e) });
    await runtime.submit('删掉它');
    assert.equal(ran, 0);
    assert.equal(runtime.pending.type, 'confirm');
    assert(events.some(x => x.type === 'confirm'));
    await runtime.cancel();
    assert.equal(ran, 0);
  });

  test('澄清卡严格 A/B，回答后才恢复执行链', async () => {
    const registry = new CommandRegistry(); const seen = [];
    registry.register('demo.echo', { title: '回显', run: () => 'ok' });
    const queue = [
      { command: 'agent.clarify', args: { question: '选哪种？', options: [{ label: 'A案', value: 'A' }, { label: 'B案', value: 'B' }] } },
      { command: 'demo.echo', args: {} }, { command: 'agent.finish', args: { message: '完成' } },
    ];
    const runtime = new AgentRuntime({ registry, ledger: normalizeLedger(), decide: async ctx => { seen.push(ctx.transcript); return queue.shift(); } });
    await runtime.submit('不明确的任务');
    assert.equal(runtime.pending.type, 'clarify');
    await runtime.answer('B');
    assert.equal(seen[1][0].result, '用户选择：B');
  });

  test('W73d 委托等待澄清/确认后的真实终态，不把 pending 冒充完成', async () => {
    const registry = new CommandRegistry();
    const queue = [
      { command: 'agent.clarify', args: { question: '继续吗？', options: [{ label: '继续', value: 'yes' }, { label: '停止', value: 'no' }] } },
      { command: 'agent.finish', args: { message: '澄清后完成' } },
    ];
    const runtime = new AgentRuntime({ registry, ledger: normalizeLedger(), decide: async () => queue.shift() });
    let settled = false;
    const delegated = runtime.submitForDelegation('需要澄清的委托').then(result => { settled = true; return result; });
    for (let i = 0; i < 5 && !runtime.pending; i++) await Promise.resolve();
    assert.equal(runtime.pending?.type, 'clarify');
    assert.equal(settled, false);
    await runtime.answer('yes');
    const result = await delegated;
    assert.equal(result.status, 'done');
    assert.equal(settled, true);
  });
});

describe('W62a 台账、指代与车间落点', () => {
  test('再来一次/它/高频 chips/Markdown 索引稿均由台账确定', () => {
    let ledger = normalizeLedger();
    ledger = appendLedger(ledger, { type: 'user', input: '打开报告' });
    ledger = appendLedger(ledger, { type: 'tool', command: 'file.openPath', focus: 'D:/报告.md', result: 'ok', status: 'done' });
    ledger = appendLedger(ledger, { type: 'user', input: '打开报告' });
    assert.equal(resolveLedgerInput('再来一次', ledger).input, '打开报告');
    assert.match(resolveLedgerInput('保存它', ledger).input, /它=D:\/报告\.md/);
    assert.deepEqual(frequentLedgerInputs(ledger), [{ input: '打开报告', count: 2 }]);
    assert.match(ledgerToMarkdown(ledger), /Mazz 指令台台账[\s\S]*file\.openPath/);
  });

  test('指令台并入工厂车间流，不新增 agent 子窗', () => {
    for (const pin of ['fc-command-dock', 'fc-agent-input', 'AgentRuntime', 'persistAgentLedger', '交办台账.md', "aiRolePicker('agent'"]) assert(factorySrc.includes(pin), `车间指令台缺 ${pin}`);
    assert(!factorySrc.includes("kind: 'agent'"), '不得另开 agent 子窗');
    assert(registrySrc.includes('toolCards(') && registrySrc.includes('danger:'), '命令表未提供受控工具卡');
  });
});
