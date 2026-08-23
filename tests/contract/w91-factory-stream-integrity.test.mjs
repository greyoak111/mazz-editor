// tests/contract/w91-factory-stream-integrity.test.mjs —— Provider 终止语义与原生声明 fail-closed
import './_setup.mjs';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  FactorySseDecoder,
  classifyFactoryCompletion: classifyMainCompletion,
  joinFactoryAiEndpoint,
  normalizeFactoryModelsResponse,
} = require('../../main/factory-sse.js');
const provider = await import('../../renderer/modules/factory/provider.js');
const engine = await import('../../renderer/modules/factory/engine.js');

function sseLine(value) {
  return `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
}

function decodeFactory(parts) {
  let text = '';
  const decoder = new FactorySseDecoder({ onDelta: delta => { text += delta; } });
  for (const part of parts) decoder.push(part);
  return { text, ...decoder.finish() };
}

describe('W91 Factory SSE 终止语义', () => {
  test('stop 无需 DONE 也保留精确 reason 并安全完成', () => {
    const result = decodeFactory([
      sseLine({ choices: [{ delta: { content: '完整正文' }, finish_reason: null }] }),
      sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } }),
    ]);
    assert.equal(result.text, '完整正文');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.completionKind, 'finish-reason');
    assert.equal(result.safeToCommit, true);
    assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 5, totalTokens: 8 });
  });

  test('length/content_filter/null 均不可提交，即使随后出现 DONE', () => {
    for (const finishReason of ['length', 'content_filter']) {
      const result = decodeFactory([
        sseLine({ choices: [{ delta: { content: '半稿' }, finish_reason: finishReason }] }),
        sseLine('[DONE]'),
      ]);
      assert.equal(result.finishReason, finishReason);
      assert.equal(result.completionKind, 'finish-reason+done-marker');
      assert.equal(result.safeToCommit, false);
    }
    const nullResult = decodeFactory([
      sseLine({ choices: [{ delta: { content: '没有原生终止原因' }, finish_reason: null }] }),
      sseLine('[DONE]'),
    ]);
    assert.equal(nullResult.finishReason, null);
    assert.equal(nullResult.completionKind, 'null-finish-reason+done-marker');
    assert.equal(nullResult.safeToCommit, false);
  });

  test('一旦出现 unsafe finish reason，后到 stop 与 DONE 也不得把流升级为完整', async () => {
    const stream = [
      sseLine({ choices: [{ delta: { content: '半稿' }, finish_reason: 'length' }] }),
      sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      sseLine('[DONE]'),
    ].join('');
    const mainResult = decodeFactory([stream]);
    assert.equal(mainResult.finishReason, 'length');
    assert.equal(mainResult.completionKind, 'finish-reason+done-marker');
    assert.equal(mainResult.safeToCommit, false);

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    try {
      const directResult = await provider.chatStreamDirectDetailed({
        cfg: { baseURL: 'https://factory.invalid', apiKey: 'fixture-only', model: 'fixture' },
        user: 'test',
      });
      assert.equal(directResult.finishReason, 'length');
      assert.equal(directResult.completionKind, 'finish-reason+done-marker');
      assert.equal(directResult.safeToCommit, false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('裸 DONE 可安全完成；丢失 finish reason 与 DONE 必须报中断', () => {
    const done = decodeFactory([
      sseLine({ choices: [{ delta: { content: '兼容流' } }] }),
      sseLine('[DONE]'),
    ]);
    assert.equal(done.completionKind, 'done-marker');
    assert.equal(done.safeToCommit, true);

    const truncated = new FactorySseDecoder();
    truncated.push(sseLine({ choices: [{ delta: { content: '被截断' }, finish_reason: null }] }));
    assert.throws(() => truncated.finish(), /意外中断/);
  });

  test('推理通道不得混入作品正文', () => {
    const result = decodeFactory([
      sseLine({ choices: [{ delta: { reasoning_content: '内部推理不得外泄' }, finish_reason: null }] }),
      sseLine({ choices: [{ delta: { content: '连接正常\n[本次续写字数：4]' }, finish_reason: null }] }),
      sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      sseLine('[DONE]'),
    ]);
    assert.equal(result.text, '连接正常\n[本次续写字数：4]');
    assert.equal(result.text.includes('内部推理'), false);
    assert.equal(result.safeToCommit, true);
  });

  test('空 final content 的错误也不得串出 reasoning payload', async () => {
    const [main, renderer] = await Promise.all([
      readFile(path.resolve('main/main.js'), 'utf8'),
      readFile(path.resolve('renderer/modules/factory/provider.js'), 'utf8'),
    ]);
    for (const source of [main, renderer]) {
      assert.equal(/AI 返回为空[^\n]+JSON\.stringify\(data\)/.test(source), false);
      assert.equal(source.includes('未收到可提交的最终 content'), true);
    }
  });

  test('主/渲染 classifier 对 stop、截断与中断给出同一结论', () => {
    const cases = [
      [{ finishReason: 'stop', completionKind: 'finish-reason' }, true],
      [{ finishReason: 'length', completionKind: 'finish-reason+done-marker' }, false],
      [{ finishReason: 'content_filter', completionKind: 'finish-reason' }, false],
      [{ finishReason: null, completionKind: 'null-finish-reason+done-marker' }, false],
      [{ finishReason: null, completionKind: 'transport-end' }, false],
      [{ finishReason: null, completionKind: 'interrupted', interrupted: true }, false],
    ];
    for (const [input, expected] of cases) {
      assert.equal(classifyMainCompletion(input).safeToCommit, expected);
      assert.equal(provider.classifyFactoryCompletion(input).safeToCommit, expected);
    }
  });
});

describe('W91 Provider endpoint 与模型列表兼容', () => {
  test('已有 v1/v2/v3/v4/v1beta 的 base 不重复版本', () => {
    const cases = [
      ['https://api.openai.com', 'chat/completions', 'https://api.openai.com/v1/chat/completions'],
      ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'chat/completions', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
      ['https://open.bigmodel.cn/api/paas/v4/', 'chat/completions', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
      ['https://qianfan.baidubce.com/v2', 'models', 'https://qianfan.baidubce.com/v2/models'],
      ['https://generativelanguage.googleapis.com/v1beta/openai', 'chat/completions', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
      ['https://api.example.test/v1/chat/completions', 'chat/completions', 'https://api.example.test/v1/chat/completions'],
    ];
    for (const [base, endpoint, expected] of cases) {
      assert.equal(joinFactoryAiEndpoint(base, endpoint), expected);
      assert.equal(provider.joinProviderAiEndpoint(base, endpoint), expected);
      assert.equal(joinFactoryAiEndpoint(base, endpoint).includes('/v1/v1/'), false);
    }
  });

  test('array / data / models 三种返回形态统一且去重', () => {
    const payloads = [
      ['a', { id: 'b' }, 'a'],
      { data: [{ id: 'a' }, { id: 'b' }] },
      { models: [{ name: 'models/a' }, { model: 'b' }] },
    ];
    for (const payload of payloads) {
      assert.deepEqual(provider.normalizeProviderModelsResponse(payload), ['a', 'b']);
      assert.deepEqual(normalizeFactoryModelsResponse(payload).data.map(row => row.id), ['a', 'b']);
    }
  });
});

function installDetailedBridge() {
  const calls = [];
  const listeners = new Set();
  window.mazz = {
    isElectron: true,
    on(channel, callback) {
      assert.equal(channel, 'factory:aiChunk');
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    invoke(channel, payload = {}) {
      calls.push({ channel, payload });
      if (channel === 'factory:aiChatStream') return new Promise(() => {});
      if (channel === 'factory:aiCancel') return Promise.resolve({ cancelled: true });
      return Promise.resolve(null);
    },
  };
  return {
    calls,
    listeners,
    emit(payload) { for (const callback of [...listeners]) callback(payload); },
  };
}

describe('W91 renderer detailed API', () => {
  test('最后一块把 finishReason/completionKind/usage 原样交给事务调用者', async () => {
    const bridge = installDetailedBridge();
    const cfg = { baseURL: 'https://factory.invalid/v3', apiKey: 'fixture-only', model: 'fixture' };
    const pending = provider.chatStreamDetailed({ cfg, user: 'test' });
    await new Promise(resolve => setImmediate(resolve));
    const requestId = bridge.calls.find(call => call.channel === 'factory:aiChatStream').payload.requestId;
    bridge.emit({ requestId, delta: '完整正文' });
    bridge.emit({
      requestId,
      done: true,
      finishReason: 'stop',
      completionKind: 'finish-reason+done-marker',
      usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6 },
      safeToCommit: true,
    });
    assert.deepEqual(await pending, {
      text: '完整正文',
      finishReason: 'stop',
      completionKind: 'finish-reason+done-marker',
      usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6 },
      safeToCommit: true,
    });
    assert.equal(bridge.listeners.size, 0);
  });

  test('legacy chatStream 仍返回字符串，而详细 API 对 length fail-closed', async () => {
    let bridge = installDetailedBridge();
    const cfg = { baseURL: 'https://factory.invalid', apiKey: 'fixture-only', model: 'fixture' };
    const legacy = provider.chatStream({ cfg, user: 'legacy' });
    await new Promise(resolve => setImmediate(resolve));
    let requestId = bridge.calls.find(call => call.channel === 'factory:aiChatStream').payload.requestId;
    bridge.emit({ requestId, delta: '旧调用正文' });
    bridge.emit({ requestId, done: true, finishReason: 'stop', completionKind: 'finish-reason', safeToCommit: true });
    assert.equal(await legacy, '旧调用正文');

    bridge = installDetailedBridge();
    const detailed = provider.chatStreamDetailed({ cfg, user: 'truncated' });
    await new Promise(resolve => setImmediate(resolve));
    requestId = bridge.calls.find(call => call.channel === 'factory:aiChatStream').payload.requestId;
    bridge.emit({ requestId, delta: '被截断半稿' });
    bridge.emit({ requestId, done: true, finishReason: 'length', completionKind: 'finish-reason+done-marker', safeToCommit: false });
    const result = await detailed;
    assert.equal(result.text, '被截断半稿');
    assert.equal(result.finishReason, 'length');
    assert.equal(result.safeToCommit, false);
  });
});

describe('W91 旧字数声明迁移与术语收口', () => {
  test('提交只依赖 Provider 安全终态和非空正文；旧声明仅作诊断', () => {
    const valid = engine.validateNativeContinuationDeclaration('正文甲乙\n[本次续写字数：4]', { safeToCommit: true });
    assert.equal(valid.safeToCommit, true);
    assert.equal(valid.text, '正文甲乙');
    assert.equal(valid.actualCharacters, 4);

    const missing = engine.validateNativeContinuationDeclaration('正文甲乙', { safeToCommit: true });
    assert.equal(missing.safeToCommit, true);
    assert.equal(missing.declarationPresent, false);
    const mismatch = engine.validateNativeContinuationDeclaration('正文甲乙\n[本次续写字数：3]', { safeToCommit: true });
    assert.equal(mismatch.safeToCommit, true);
    assert.equal(mismatch.declarationMatches, false);
    assert.equal(engine.validateNativeContinuationDeclaration('正文甲乙\n[本次续写字数：4]', { safeToCommit: false }).reason, 'provider-unsafe');
  });

  test('旧任务合并清理声明后继续，不把字符数字带入正式正文', () => {
    const merged = engine.mergeDeclaredContinuation('前文', '正文甲乙\n[本次续写字数：4]');
    assert.equal(merged.declared, 4);
    assert.equal(engine.tokenDeclarationOf(merged.text), null);
    assert.equal(merged.text, '前文正文甲乙');
    assert.equal(merged.complete, false);
  });

  test('状态写失败不再被空 catch 吞掉', async () => {
    window.mazz = { invoke: async () => { throw new Error('fixture write failed'); } };
    await assert.rejects(
      () => engine.writeTaskState('D:/workspace/Output/task', { status: 'running' }),
      error => error?.code === 'FACTORY_TASK_STATE_WRITE_FAILED' && /fixture write failed/.test(error.message),
    );
  });

  test('专业流程对外只显示职能名，内部 role id 不变', () => {
    const roles = provider.AI_ROLES.filter(role => role.id.startsWith('factory_'));
    for (const role of roles) assert.equal(/\bM\d+\b/.test(role.label), false, role.label);
    for (const id of ['factory_skeleton', 'factory_point', 'factory_writer', 'factory_review_a', 'factory_review_b', 'factory_arbiter']) {
      assert.ok(roles.some(role => role.id === id), `缺内部 role id：${id}`);
    }
  });
});
