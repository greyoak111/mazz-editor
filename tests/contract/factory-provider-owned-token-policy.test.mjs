// Factory sends no product-defined output cap. The provider owns its native
// window; Factory only judges the provider's actual completion evidence.
import './_setup.mjs';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { classifyFactoryCompletion: classifyMainCompletion } = require('../../main/factory-sse.js');
const provider = await import('../../renderer/modules/factory/provider.js');
const {
  ReviewBudgetLedger,
  planReviewRitual,
  runDeterministicInspection,
  runW68Review,
} = await import('../../renderer/modules/factory/review.js');
const { evaluateBudgetCap } = await import('../../renderer/modules/factory/command-gate.js');

const cfg = {
  providerId: 'custom',
  baseURL: 'https://factory.invalid',
  apiKey: 'fixture-only',
  model: 'fixture',
};

function safeCompletion(text = '完整结果', usage = null) {
  return {
    text,
    finishReason: 'stop',
    completionKind: 'finish-reason',
    safeToCommit: true,
    usage,
  };
}

function installElectronBridge(result = safeCompletion()) {
  const calls = [];
  window.mazz = {
    isElectron: true,
    invoke: async (channel, payload = {}) => {
      calls.push({ channel, payload });
      if (channel === 'factory:aiChat') return result;
      if (channel === 'factory:aiCancel') return { cancelled: true };
      return null;
    },
  };
  return calls;
}

function installRoutedBrowserBridge({ maxTokens = null } = {}) {
  const providerRow = {
    id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro', models: ['deepseek-v4-pro'],
    ...(maxTokens == null ? {} : { max_tokens: maxTokens }),
  };
  window.mazz = {
    isElectron: false,
    invoke: async (channel, payload = {}) => {
      if (channel === 'settings:get' && payload.key === 'factory.providers') return { deepseek: providerRow };
      if (channel === 'settings:get' && payload.key === 'factory.routing') return {
        version: 1,
        default: { providerId: 'deepseek', model: 'deepseek-v4-pro' },
        routes: { factory_review_a: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
      };
      if (channel === 'secret:get' && payload.key === 'factory.keys') return JSON.stringify({ deepseek: 'fixture-only' });
      return null;
    },
  };
}

describe('Factory 不发送产品 Token 上限', () => {
  test('旧调用方 maxTokens 被忽略，非流式与视觉请求都不再获得产品默认帽', async () => {
    const calls = installElectronBridge();
    await provider.chatDetailed({ cfg, user: '正文', maxTokens: 1 });
    await provider.visionChat({ cfg, role: '', prompt: '识别', imageDataUrl: 'data:image/png;base64,AA==', maxTokens: 2 });
    const requests = calls.filter(row => row.channel === 'factory:aiChat');
    assert.equal(requests.length, 2);
    for (const { payload } of requests) {
      assert.equal(Object.prototype.hasOwnProperty.call(payload, 'maxTokens'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload, 'providerMaxTokens'), false);
    }
  });

  test('旧请求参数和旧 Provider 配置里的帽都不透传', async () => {
    const calls = installElectronBridge();
    await provider.chatDetailed({ cfg: { ...cfg, providerOptions: { max_tokens: 777.9 } }, user: '正文', maxTokens: 1 });
    const electronPayload = calls.find(row => row.channel === 'factory:aiChat').payload;
    assert.equal(Object.prototype.hasOwnProperty.call(electronPayload, 'maxTokens'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(electronPayload, 'providerMaxTokens'), false);

    const previousFetch = globalThis.fetch;
    const previousMazz = window.mazz;
    let requestBody = null;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"objections":[]}' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      installRoutedBrowserBridge({ maxTokens: 901.8 });
      const result = await provider.chatDetailed({
        cfg,
        role: 'factory_review_a',
        user: '审理',
        maxTokens: 1,
      });
      assert.equal(Object.prototype.hasOwnProperty.call(requestBody, 'max_tokens'), false);
      assert.deepEqual(requestBody.thinking, { type: 'disabled' });
      assert.equal(result.safeToCommit, true);

      installRoutedBrowserBridge();
      await provider.chatDetailed({ cfg, role: 'factory_review_a', user: '审理', maxTokens: 1 });
      assert.equal(Object.prototype.hasOwnProperty.call(requestBody, 'max_tokens'), false);
    } finally {
      globalThis.fetch = previousFetch;
      window.mazz = previousMazz;
    }
  });

  test('流式直连同样忽略 legacy/request/Provider 配置帽', async () => {
    const previousFetch = globalThis.fetch;
    let requestBody = null;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(init.body);
      const body = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: '完整流' }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
        'data: [DONE]', '',
      ].join('\n\n');
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    try {
      let result = await provider.chatStreamDirectDetailed({
        cfg, user: '正文', maxTokens: 1, providerMaxTokens: 2,
      });
      assert.equal(result.safeToCommit, true);
      assert.equal(Object.prototype.hasOwnProperty.call(requestBody, 'max_tokens'), false);

      result = await provider.chatStreamDirectDetailed({
        cfg: { ...cfg, generation: { maxTokens: 456.7 } },
        user: '正文', maxTokens: 1, providerMaxTokens: 2,
      });
      assert.equal(result.safeToCommit, true);
      assert.equal(Object.prototype.hasOwnProperty.call(requestBody, 'max_tokens'), false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('主进程 Factory 请求体也没有 max_tokens，厂商 length/content_filter 仍 fail-closed', () => {
    assert.equal(classifyMainCompletion({ finishReason: 'stop', completionKind: 'finish-reason' }).safeToCommit, true);
    assert.equal(classifyMainCompletion({ finishReason: 'length', completionKind: 'finish-reason' }).safeToCommit, false);
    assert.equal(classifyMainCompletion({ finishReason: 'content_filter', completionKind: 'finish-reason' }).safeToCommit, false);

    const mainSource = fs.readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8');
    const providerSource = fs.readFileSync(new URL('../../renderer/modules/factory/provider.js', import.meta.url), 'utf8');
    const nonStreamStart = mainSource.indexOf("bus.handle('factory:aiChat'");
    const streamStart = mainSource.indexOf("bus.handle('factory:aiChatStream'");
    const nonStreamHandler = mainSource.slice(nonStreamStart, mainSource.indexOf("bus.handle('factory:aiModels'", nonStreamStart));
    const streamHandler = mainSource.slice(streamStart, mainSource.indexOf("bus.handle('app:getAutoLaunch'", streamStart));
    for (const source of [providerSource, nonStreamHandler, streamHandler]) {
      assert.equal(/\b(?:max_tokens|maxTokens|providerMaxTokens)\b/.test(source), false);
    }
  });
});

describe('W68 不再用估算字数/Token 控制流程', () => {
  test('旧预算阈值全部只保留兼容状态，不降级、不硬停', () => {
    assert.deepEqual(planReviewRitual('full', 0), {
      requested: 'full', effective: 'full', downgraded: false, stopped: false, reason: '',
    });
    for (const budget of [
      { capTokens: 0, usedTokens: 0, requestedRitual: 'full' },
      { capTokens: 7999, usedTokens: 0, requestedRitual: 'light' },
      { capTokens: 17999, usedTokens: 0, requestedRitual: 'full' },
      { capTokens: 20000, usedTokens: 18001, requestedRitual: 'full' },
      { capTokens: 20000, usedTokens: 19500, requestedRitual: 'full' },
    ]) {
      const state = evaluateBudgetCap(budget);
      assert.equal(state.status, 'ok');
      assert.deepEqual(state.actions, []);
      assert.equal(state.enforcement, 'provider-native');
    }
  });

  test('账本不再用字符除四伪造 Token，只记录 Provider usage 且不设 cap', () => {
    const ledger = new ReviewBudgetLedger(1);
    assert.equal(ledger.canSpend(999999), true);
    assert.equal(ledger.charge({ seat: 'M2', phase: 'point', input: '很长'.repeat(1000), output: '结果', estimatedTokens: 5000 }), 0);
    assert.equal(ledger.charge({ seat: 'M2', phase: 'point', usage: { inputTokens: 11, outputTokens: 7, totalTokens: 19 } }), 19);
    assert.deepEqual(ledger.summary(), {
      capTokens: null,
      usedTokens: 19,
      remainingTokens: null,
      bySeat: { M2: 19 },
      perUnit: 19,
      per10k: 0,
      entries: ledger.entries,
      source: 'provider-reported',
      enforced: false,
    });
  });

  test('句数、句长方差与每万字心理词只做指纹观测，不再生成 finding 或压力闸', () => {
    const text = Array.from({ length: 8 }, () => '他觉得风冷。').join('');
    const report = runDeterministicInspection(text, {});
    assert(report.metrics.sentenceCount >= 8);
    assert(report.metrics.sentenceStdDev < 6);
    assert(report.metrics.psychologyPer10k > 45);
    assert.equal(report.findings.some(row => ['style-flat', 'style-psychology', 'style-rhythm'].includes(row.id)), false);
    assert.equal(report.pressureStages.find(row => row.id === 'density').pass, true);
    assert.equal(report.pass, true);
  });

  test('零旧预算仍完整跑全仪式，短润色稿只要非空且机检通过即可采用', async () => {
    const roles = [];
    const usage = { inputTokens: 2, outputTokens: 3, totalTokens: 7 };
    const result = await runW68Review({
      draft: '这是一段原文。',
      ritual: 'full',
      budgetCap: 0,
      requireCompletionMetadata: true,
      ask: async request => {
        roles.push(request.role);
        if (request.role === 'factory_polish') return safeCompletion('短', usage);
        if (request.role === 'factory_point') return safeCompletion('{"decision":"pass","findings":[],"repairItems":[],"consultation":{}}', usage);
        if (request.role === 'factory_review_a' || request.role === 'factory_review_b') return safeCompletion('{"objections":[]}', usage);
        throw new Error(`unexpected role: ${request.role}`);
      },
    });
    assert.equal(result.sealed, true);
    assert.equal(result.ritual.effective, 'full');
    assert.equal(result.polishRecord.accepted, true);
    assert.equal(result.text, '短');
    assert.deepEqual(roles, ['factory_polish', 'factory_point', 'factory_review_a', 'factory_review_b']);
    assert.equal(result.budget.capTokens, null);
    assert.equal(result.budget.remainingTokens, null);
    assert.equal(result.budget.usedTokens, 28);
  });

  test('拆预算闸不放宽 Provider 终态：length 正文仍不可进入封存', async () => {
    const result = await runW68Review({
      draft: '正文。',
      budgetCap: 0,
      requireCompletionMetadata: true,
      ask: async () => ({
        text: '{"decision":"pass","findings":[]}',
        finishReason: 'length',
        completionKind: 'finish-reason',
        safeToCommit: false,
      }),
    });
    assert.equal(result.sealed, false);
    assert.equal(result.verdict, 'provider-unsafe');
  });
});
