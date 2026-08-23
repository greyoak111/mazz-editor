// tests/contract/w92-factory-nonstream-integrity.test.mjs —— 非流式正文修订/审校终态 fail-closed
import './_setup.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  FACTORY_DIRECT_OUTPUT_ROLES: mainDirectOutputRoles,
  FactorySseDecoder,
  extractText: extractMainContentText,
  factoryProviderGenerationOptions: mainGenerationOptions,
} = require('../../main/factory-sse.js');
const provider = await import('../../renderer/modules/factory/provider.js');
const { buildMantra } = await import('../../renderer/modules/factory/engine.js');
const {
  REVIEW_RULES,
  buildAcceptanceSchema,
  buildFinalArbitrationEvidence,
  normalizeExternalReviewPacket,
  normalizeFinalArbitrationPacket,
  normalizeAnswerPacket,
  normalizeHearingPacket,
  normalizeReconsiderPacket,
  normalizePointReviewPacket,
  runW68Review,
} = await import('../../renderer/modules/factory/review.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function installNonStreamBridge(result) {
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

function installDeepSeekBridge({
  isElectron = true,
  response = null,
  providerId = 'deepseek',
  baseURL = 'https://api.deepseek.com',
  model = 'deepseek-v4-pro',
} = {}) {
  const calls = [];
  const providerRow = {
    id: providerId, name: 'DeepSeek', baseURL,
    model, models: [model], cards: ['reasoning', 'long-context'],
  };
  window.mazz = {
    isElectron,
    invoke: async (channel, payload = {}) => {
      calls.push({ channel, payload });
      if (channel === 'settings:get' && payload.key === 'factory.providers') return { [providerId]: providerRow };
      if (channel === 'settings:get' && payload.key === 'factory.routing') return {
        version: 1,
        default: { providerId, model },
        routes: { factory_review_a: { providerId, model } },
      };
      if (channel === 'secret:get' && payload.key === 'factory.keys') return JSON.stringify({ [providerId]: 'fixture-only' });
      if (channel === 'factory:aiChat') return response;
      if (channel === 'factory:aiCancel') return { cancelled: true };
      return null;
    },
  };
  return calls;
}

const cfg = { baseURL: 'https://factory.invalid', apiKey: 'fixture-only', model: 'fixture' };

describe('W92 Factory 非流式 Provider 完成证据', () => {
  test('详细 API 保留 stop/usage，legacy chat 仍只返回字符串', async () => {
    const response = {
      text: '完整修订稿', finishReason: 'stop', completionKind: 'finish-reason',
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, safeToCommit: true,
    };
    let calls = installNonStreamBridge(response);
    assert.deepEqual(await provider.chatDetailed({ cfg, user: 'detail' }), response);
    assert.equal(calls[0].payload.detailed, true);

    calls = installNonStreamBridge(response);
    assert.equal(await provider.chat({ cfg, user: 'legacy' }), '完整修订稿');
    assert.equal(calls[0].payload.detailed, true);
  });

  test('length/content_filter/null/中断/空响应均不可提交', async () => {
    const cases = [
      { text: '被截断', finishReason: 'length', completionKind: 'finish-reason', safeToCommit: false },
      { text: '被过滤', finishReason: 'content_filter', completionKind: 'finish-reason', safeToCommit: false },
      { text: '终态缺失', finishReason: null, completionKind: 'null-finish-reason', safeToCommit: false },
      { text: '传输 EOF 半稿', finishReason: null, completionKind: 'response-without-finish-reason', safeToCommit: false },
      { text: '中断半稿', finishReason: null, completionKind: 'interrupted', safeToCommit: false },
      { text: '', finishReason: 'stop', completionKind: 'finish-reason', safeToCommit: true },
    ];
    for (const response of cases) {
      installNonStreamBridge(response);
      const result = await provider.chatDetailed({ cfg, user: 'unsafe' });
      assert.equal(result.safeToCommit, false, `${response.finishReason}/${response.completionKind}`);
    }
  });

  test('旧主进程若意外只返字符串，详细 API 也不把它升级成可信终态', async () => {
    installNonStreamBridge('旧版字符串半稿');
    const result = await provider.chatDetailed({ cfg, user: 'compat' });
    assert.equal(result.text, '旧版字符串半稿');
    assert.equal(result.safeToCommit, false);
    assert.equal(result.completionKind, 'response-without-finish-reason');
  });

  test('DeepSeek v4 专业席显式关闭隐式思考，把 token 预算留给 final content', async () => {
    const deepSeek = {
      providerId: 'deepseek', baseURL: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro', apiKey: 'fixture-only',
    };
    const expected = { thinking: { type: 'disabled' } };
    const exactRoles = [
      'factory_skeleton', 'factory_writer', 'factory_point', 'factory_review_a',
      'factory_review_b', 'factory_arbiter', 'factory_polish',
    ];
    assert.deepEqual(provider.FACTORY_DIRECT_OUTPUT_ROLES, exactRoles);
    assert.deepEqual([...mainDirectOutputRoles], exactRoles);
    for (const role of provider.FACTORY_DIRECT_OUTPUT_ROLES) {
      assert.deepEqual(provider.factoryProviderGenerationOptions({ ...deepSeek, role }), expected);
      assert.deepEqual(mainGenerationOptions({ ...deepSeek, role }), expected);
    }
    for (const role of ['chapter', 'blueprint', 'research', '']) {
      assert.deepEqual(provider.factoryProviderGenerationOptions({ ...deepSeek, role }), {});
      assert.deepEqual(mainGenerationOptions({ ...deepSeek, role }), {});
    }
    const mismatches = [
      { ...deepSeek, baseURL: 'https://proxy.invalid' },
      { ...deepSeek, baseURL: 'http://api.deepseek.com' },
      { ...deepSeek, baseURL: 'https://api.deepseek.com.evil.invalid' },
      { ...deepSeek, providerId: 'custom' },
      { ...deepSeek, providerId: 'openai', baseURL: 'https://api.openai.com' },
      { ...deepSeek, model: 'deepseek-reasoner' },
    ];
    for (const mismatch of mismatches) {
      assert.deepEqual(provider.factoryProviderGenerationOptions({ ...mismatch, role: 'factory_review_a' }), {});
      assert.deepEqual(mainGenerationOptions({ ...mismatch, role: 'factory_review_a' }), {});
    }
  });

  test('Electron 专业席把 provider/role 交给主进程策略，普通调用不冒充专业席', async () => {
    const response = {
      text: '{"objections":[]}', finishReason: 'stop', completionKind: 'finish-reason',
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, safeToCommit: true,
    };
    const deepSeek = {
      providerId: 'deepseek', baseURL: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro', apiKey: 'fixture-only',
    };
    const calls = installDeepSeekBridge({ response });
    const result = await provider.chatDetailed({ cfg: deepSeek, role: 'factory_review_a', user: 'review' });
    assert.equal(result.safeToCommit, true);
    const chatCall = calls.find(call => call.channel === 'factory:aiChat');
    assert.equal(chatCall.payload.providerId, 'deepseek');
    assert.equal(chatCall.payload.role, 'factory_review_a');
    assert.equal(Object.prototype.hasOwnProperty.call(chatCall.payload, 'maxTokens'), false);
  });

  test('网页直连专业席也发送 thinking=disabled，仍只接受 stop + 非空 content', async () => {
    const previousFetch = globalThis.fetch;
    const previousMazz = window.mazz;
    let requestBody = null;
    installDeepSeekBridge({ isElectron: false });
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"objections":[]}', reasoning_content: '不得成为工件' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const result = await provider.chatDetailed({
        cfg: { providerId: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-pro', apiKey: 'fixture-only' },
        role: 'factory_review_a', user: 'review', maxTokens: 4096,
      });
      assert.deepEqual(requestBody.thinking, { type: 'disabled' });
      assert.equal(Object.prototype.hasOwnProperty.call(requestBody, 'max_tokens'), false);
      assert.equal(result.text, '{"objections":[]}');
      assert.equal(result.text.includes('不得成为工件'), false);
      assert.equal(result.safeToCommit, true);

      installDeepSeekBridge({ isElectron: false, baseURL: 'https://proxy.invalid' });
      await provider.chatDetailed({
        cfg: { providerId: 'deepseek', baseURL: 'https://proxy.invalid', model: 'deepseek-v4-pro', apiKey: 'fixture-only' },
        role: 'factory_review_a', user: 'review', maxTokens: 4096,
      });
      assert.equal(Object.prototype.hasOwnProperty.call(requestBody, 'thinking'), false);
    } finally {
      globalThis.fetch = previousFetch;
      window.mazz = previousMazz;
    }
  });

  test('stop + object content/text 仍为空且不可提交，数组仅接收字符串片段', async () => {
    const valid = { content: ['甲', { text: '乙' }, { text: 3 }, { text: { value: '伪正文' } }, { nope: '丙' }] };
    assert.equal(extractMainContentText(valid), '甲乙');
    assert.equal(provider.extractFactoryContentText(valid), '甲乙');
    for (const message of [
      { content: { text: '伪正文' } },
      { content: [{ text: { value: '伪正文' } }] },
    ]) {
      assert.equal(extractMainContentText(message), '');
      assert.equal(provider.extractFactoryContentText(message), '');
    }

    let decoded = '';
    const decoder = new FactorySseDecoder({ onDelta: delta => { decoded += delta; } });
    decoder.push(`data: ${JSON.stringify({ choices: [{ delta: { content: { text: '伪正文' } }, finish_reason: null }] })}\n\n`);
    decoder.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    const completion = decoder.finish();
    assert.equal(decoded, '');
    assert.equal(completion.deltaCount, 0);
    assert.equal(completion.safeToCommit, false);

    installNonStreamBridge({ text: { value: '伪正文' }, finishReason: 'stop', completionKind: 'finish-reason', safeToCommit: true });
    const electronResult = await provider.chatDetailed({ cfg, user: 'object-content' });
    assert.equal(electronResult.text, '');
    assert.equal(electronResult.safeToCommit, false);

    const previousFetch = globalThis.fetch;
    const previousMazz = window.mazz;
    installDeepSeekBridge({ isElectron: false });
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: { text: '伪正文' } }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    try {
      await assert.rejects(() => provider.chatDetailed({
        cfg: { providerId: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-pro', apiKey: 'fixture-only' },
        role: 'factory_review_a', user: 'object-content',
      }), /AI 返回为空/);
    } finally {
      globalThis.fetch = previousFetch;
      window.mazz = previousMazz;
    }
  });

  test('正文 stream 不继承专业席 thinking 策略，object delta 不能伪造正文', async () => {
    const previousFetch = globalThis.fetch;
    let requestBody = null;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(init.body);
      const body = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: { text: '伪正文' } }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: '有效正文' }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
        'data: [DONE]', '',
      ].join('\n\n');
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    try {
      const result = await provider.chatStreamDirectDetailed({
        cfg: { providerId: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-pro', apiKey: 'fixture-only' },
        role: 'factory_review_a', user: 'stream', maxTokens: 4096,
      });
      assert.equal(result.text, '有效正文');
      assert.equal(result.safeToCommit, true);
      assert.equal(Object.prototype.hasOwnProperty.call(requestBody, 'thinking'), false);
    } finally { globalThis.fetch = previousFetch; }

    const main = read('main/main.js');
    const streamStart = main.indexOf("bus.handle('factory:aiChatStream'");
    const streamEnd = main.indexOf("bus.handle('factory:ai", streamStart + 20);
    const streamHandler = main.slice(streamStart, streamEnd > streamStart ? streamEnd : main.indexOf("bus.handle('file:", streamStart));
    assert.doesNotMatch(streamHandler, /factoryProviderGenerationOptions/);
  });
});

describe('W92 W68 修订与封存门', () => {
  const pointDraft = '清晨的风沿着河岸移动，旧桥下的水面映着灰蓝天色。远处列车穿过树林，站台广播随后响起。街角店铺刚刚开门，城市在钟声里逐渐醒来。';
  const completion = text => ({
    text: typeof text === 'string' ? text : JSON.stringify(text),
    finishReason: 'stop', completionKind: 'finish-reason', safeToCommit: true,
  });

  function pointAsk(pointReply, counters = {}) {
    return async req => {
      if (req.system.includes('MAZZ_W68_POINT')) {
        counters.point = (counters.point || 0) + 1;
        const value = typeof pointReply === 'function' ? pointReply(counters.point) : pointReply;
        return completion(value);
      }
      if (req.system.includes('MAZZ_W68_REPAIR')) {
        counters.repair = (counters.repair || 0) + 1;
        return completion(pointDraft);
      }
      if (req.system.includes('MAZZ_W68_REVIEW')) {
        counters.review = (counters.review || 0) + 1;
        return completion({ objections: [] });
      }
      if (req.system.includes('MAZZ_W68_FINAL')) {
        counters.final = (counters.final || 0) + 1;
        return completion({ decision: 'pass', reason: '四闸通过' });
      }
      return completion({});
    };
  }

  test('M2 optional-only 建议缺失归一 pass，不进入三轮空回炉', async () => {
    const schema = buildAcceptanceSchema({ blueprint: '普通蓝图', outline: '第1节：河岸晨景' });
    const optionalFinding = {
      severity: 'warning', reasonCode: 'OPTIONAL_ANCHOR_MISSING',
      message: '建议锚未出现', artifactRef: 'skeleton:outline-anchor', ruleRef: REVIEW_RULES.machineBeforePoint,
    };
    const optionalRepair = {
      error: '建议锚未出现', change: '补入建议锚',
      position: 'skeleton:outline-anchor', reason: REVIEW_RULES.machineBeforePoint,
    };
    const packet = normalizePointReviewPacket({
      decision: 'adjust',
      findings: [optionalFinding, { ...optionalFinding }],
      repairItems: [optionalRepair],
    }, schema);
    assert.equal(packet.decision, 'pass');
    assert.equal(packet.valid, true);
    assert.equal(packet.normalization, 'optional-outline-anchor-advisory');

    const counters = {};
    const result = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景',
      requireCompletionMetadata: true,
      ask: pointAsk({
        decision: 'adjust',
        findings: [optionalFinding, { ...optionalFinding }],
        repairItems: [optionalRepair],
      }, counters),
    });
    assert.equal(counters.point, 1);
    assert.equal(counters.repair || 0, 0);
    assert.equal(result.pointReports.length, 1);
    assert.equal(result.repairs.length, 0);
    assert.equal(result.point.decision, 'pass');
    assert.match(result.artifacts.point, /节点验收席原始决定：adjust/);
    assert.match(result.artifacts.point, /系统归一决定：pass/);
    assert.match(result.artifacts.point, /归一规则：optional-outline-anchor-advisory/);
    assert.match(result.artifacts.point, /A1｜级别=warning｜代码=OPTIONAL_ANCHOR_MISSING/);
    assert.match(result.artifacts.point, /工件=skeleton:outline-anchor｜规则=W68-R1/);
    assert.match(result.artifacts.point, /AR1｜问题=建议锚未出现｜修改=补入建议锚/);
    assert.equal(result.sealed, true);
    assert.equal(result.transitions.some(item => /^repair:/.test(item)), false);
  });

  test('M2 empty-adjust 是无效包并 fail-closed，不生成空修订单或循环', async () => {
    const schema = buildAcceptanceSchema({ blueprint: '普通蓝图', outline: '第1节：河岸晨景' });
    const packet = normalizePointReviewPacket({ decision: 'adjust', findings: [], repairItems: [] }, schema);
    assert.equal(packet.decision, 'invalid');
    assert.equal(packet.valid, false);
    assert.equal(packet.invalidReason, 'adjust-without-actionable-cited-item');

    const counters = {};
    const result = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景',
      requireCompletionMetadata: true,
      ask: pointAsk({ decision: 'adjust', findings: [], repairItems: [] }, counters),
    });
    assert.equal(counters.point, 1);
    assert.equal(counters.repair || 0, 0);
    assert.equal(result.verdict, 'point-invalid');
    assert.equal(result.sealed, false);
    assert.equal(result.repairs.length, 0);
    assert.match(result.artifacts.point, /节点验收席原始决定：adjust/);
    assert.match(result.artifacts.point, /系统归一决定：invalid/);
    assert.match(result.artifacts.point, /归一规则：fail-closed/);
    assert.match(result.artifacts.point, /包有效性：无效/);
    assert.match(result.artifacts.point, /无效原因：adjust-without-actionable-cited-item/);
    assert(result.transitions.includes('point-invalid:1'));
    assert.equal(result.transitions.some(item => /^repair:/.test(item)), false);
  });

  test('独立 critical semantic finding 保留 adjust；return_skeleton 只认 required 契约冲突', async () => {
    const optionalSchema = buildAcceptanceSchema({ blueprint: '普通蓝图', outline: '第1节：河岸晨景' });
    const semantic = {
      severity: 'critical', reasonCode: 'SEMANTIC_MISMATCH', message: '因果顺序冲突',
      artifactRef: 'draft:第1句', ruleRef: 'SEM-CAUSE-1',
    };
    const adjusted = normalizePointReviewPacket({ decision: 'adjust', findings: [semantic], repairItems: [] }, optionalSchema);
    assert.equal(adjusted.decision, 'adjust');
    assert.equal(adjusted.valid, true);

    const contradictoryPass = normalizePointReviewPacket({ decision: 'pass', findings: [semantic], repairItems: [] }, optionalSchema);
    assert.equal(contradictoryPass.decision, 'invalid');
    assert.equal(contradictoryPass.valid, false);
    assert.equal(contradictoryPass.invalidReason, 'pass-with-blocking-finding');
    const contradictoryRepair = normalizePointReviewPacket({
      decision: 'pass', findings: [],
      repairItems: [{
        error: '因果顺序冲突', change: '交换两句顺序',
        position: 'draft:第1句', reason: 'SEM-CAUSE-1',
      }],
    }, optionalSchema);
    assert.equal(contradictoryRepair.decision, 'invalid');
    assert.equal(contradictoryRepair.valid, false);
    assert.equal(contradictoryRepair.invalidReason, 'pass-with-actionable-repair');
    const warningPass = normalizePointReviewPacket({
      decision: 'pass',
      findings: [{ ...semantic, severity: 'warning' }],
      repairItems: [],
    }, optionalSchema);
    assert.equal(warningPass.decision, 'invalid');
    assert.equal(warningPass.valid, false);
    assert.equal(warningPass.invalidReason, 'pass-with-non-advisory-items');
    const optionalPass = normalizePointReviewPacket({
      decision: 'pass',
      findings: [{
        severity: 'warning', reasonCode: 'OPTIONAL_ANCHOR_MISSING', message: '建议锚未出现',
        artifactRef: 'skeleton:outline-anchor', ruleRef: REVIEW_RULES.machineBeforePoint,
      }],
      repairItems: [{
        error: '建议锚未出现', change: '补入建议锚',
        position: 'skeleton:outline-anchor', reason: REVIEW_RULES.machineBeforePoint,
      }],
    }, optionalSchema);
    assert.equal(optionalPass.decision, 'pass');
    assert.equal(optionalPass.valid, true);
    assert.equal(optionalPass.normalization, 'optional-outline-anchor-advisory');
    const emptyPass = normalizePointReviewPacket({ decision: 'pass', findings: [], repairItems: [] }, optionalSchema);
    assert.equal(emptyPass.decision, 'pass');
    assert.equal(emptyPass.valid, true);

    const requiredSchema = buildAcceptanceSchema({ blueprint: '- [必达] destination::抵达星港::星港' });
    const returned = normalizePointReviewPacket({
      decision: 'return_skeleton',
      findings: [{ ...semantic, reasonCode: 'REQUIRED_CONTRACT_CONFLICT', artifactRef: 'skeleton:destination' }],
    }, requiredSchema);
    assert.equal(returned.decision, 'return_skeleton');
    assert.equal(returned.valid, true);
    const optionalReturn = normalizePointReviewPacket({
      decision: 'return_skeleton',
      findings: [{ ...semantic, reasonCode: 'REQUIRED_CONTRACT_CONFLICT', artifactRef: 'skeleton:outline-anchor' }],
    }, optionalSchema);
    assert.equal(optionalReturn.decision, 'invalid');
    assert.equal(optionalReturn.invalidReason, 'return-skeleton-without-required-contract-failure');

    const counters = {};
    const result = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景',
      requireCompletionMetadata: true,
      ask: pointAsk(round => round === 1
        ? { decision: 'adjust', findings: [semantic], repairItems: [] }
        : { decision: 'pass', findings: [], repairItems: [] }, counters),
    });
    assert.equal(counters.point, 2);
    assert.equal(counters.repair, 1);
    assert.equal(result.repairs.length, 1);
    assert(result.transitions.includes('repair:1'));
    assert.equal(result.sealed, true);
  });

  test('M2 prompt 钉住建议/adjust/return_skeleton 的结构化边界', () => {
    const review = read('renderer/modules/factory/review.js');
    assert.match(review, /\[建议\].*不得成为 adjust 或 return_skeleton 的唯一理由/);
    assert.match(review, /adjust 必须至少带一项可执行且可引用的独立 finding\/repairItem/);
    assert.match(review, /return_skeleton 只用于显式 \[必达\]\/锁定契约互相矛盾或不可满足/);
    assert.match(review, /REQUIRED_CONTRACT_CONFLICT\|REQUIRED_CONTRACT_UNSATISFIABLE/);
  });

  test('立项字段里的独立必达行经真实母版路径成为显式验收点', () => {
    const anchor = '固定验收点如下：\n[必达] live-fixed-body::固定验收正文::清晨的风沿着河岸缓慢移动|城市在钟声里逐渐醒来';
    const tpl = {
      id: 'w92-contract-flow', name: '真实链路验收', description: '契约路径',
      input_fields: [
        { id: 'title', label: '项目名称', type: 'text', required: true },
        { id: 'review_anchor', label: '专业流程验收点', type: 'textarea', required: false },
      ],
      system_prompt: '按验收点输出正文。', meta_vars: {}, quality_checks: [],
      output_rules: { format: 'markdown', max_length: 200, structure: '固定正文' },
    };
    const mantra = buildMantra(tpl, { title: 'W92真实链路验收', review_anchor: anchor });
    const schema = buildAcceptanceSchema({ blueprint: mantra.doc });
    const row = schema.requiredBeats.find(item => item.id === 'live-fixed-body');
    assert.equal(schema.source, 'explicit');
    assert.equal(row?.required, true);
    assert.deepEqual(row?.patterns, ['清晨的风沿着河岸缓慢移动', '城市在钟声里逐渐醒来']);
  });

  test('节点验收与交叉审校只接受显式结构包，空对象/数组/非 JSON 不得伪装通过', async () => {
    assert.equal(normalizeExternalReviewPacket({ objections: [] }).valid, true);
    assert.equal(normalizeExternalReviewPacket({}).invalidReason, 'review-objections-missing');
    assert.equal(normalizeExternalReviewPacket({ objections: {} }).invalidReason, 'review-objections-not-array');
    assert.equal(normalizeExternalReviewPacket({ parseWarning: true }).invalidReason, 'review-packet-unparseable');
    assert.equal(normalizeExternalReviewPacket({ objections: [{}] }).invalidReason, 'review-objection-1-invalid');
    assert.equal(normalizeExternalReviewPacket({ objections: [null] }).invalidReason, 'review-objection-1-invalid');
    assert.equal(normalizeExternalReviewPacket({ objections: [{ id: 'O1', severity: 'major', claim: '问题', artifactRef: ['draft:第1句'], ruleRef: 'R1' }] }).invalidReason, 'review-objection-1-invalid');

    const emptyPoint = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景',
      requireCompletionMetadata: true,
      ask: pointAsk({}),
    });
    assert.equal(emptyPoint.sealed, false);
    assert.equal(emptyPoint.verdict, 'point-invalid');
    assert.equal(emptyPoint.point.invalidReason, 'unknown-point-decision');

    const invalidReview = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景',
      requireCompletionMetadata: true,
      ask: async req => {
        if (req.system.includes('MAZZ_W68_POINT')) return completion({ decision: 'pass', findings: [], repairItems: [] });
        if (req.system.includes('MAZZ_W68_REVIEW')) return completion('not-json');
        return completion({});
      },
    });
    assert.equal(invalidReview.sealed, false);
    assert.equal(invalidReview.verdict, 'review-invalid');
    assert.equal(invalidReview.gates.review, false);
    assert.match(invalidReview.artifacts.review, /包有效性：无效/);
    assert.match(invalidReview.artifacts.review, /review-packet-unparseable/);
    assert.match(invalidReview.artifacts.verdict, /裁决包有效性：未执行/);

    for (const malformedRow of [{}, null]) {
      const invalidRowReview = await runW68Review({
        draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景',
        requireCompletionMetadata: true,
        ask: async req => {
          if (req.system.includes('MAZZ_W68_POINT')) return completion({ decision: 'pass', findings: [], repairItems: [] });
          if (req.system.includes('MAZZ_W68_REVIEW')) return completion({ objections: [malformedRow] });
          return completion({});
        },
      });
      assert.equal(invalidRowReview.sealed, false);
      assert.equal(invalidRowReview.verdict, 'review-invalid');
      assert.match(invalidRowReview.artifacts.review, /review-objection-1-invalid/);
    }

    const arrayPoint = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景',
      requireCompletionMetadata: true,
      ask: pointAsk([]),
    });
    assert.equal(arrayPoint.verdict, 'point-invalid');
    assert.equal(arrayPoint.point.invalidReason, 'point-packet-unparseable');
  });

  test('庭审包非法时一律 fail-closed，major 质询不得被默认 overrule', async () => {
    const malformed = normalizeHearingPacket({ parseWarning: true });
    assert.equal(malformed.valid, false);
    assert.equal(malformed.decision, 'sustain');
    assert.equal(malformed.invalidReason, 'hearing-packet-unparseable');
    assert.equal(normalizeHearingPacket({ decision: 'overrule', reason: '证据成立', ruleRef: 'R1' }).valid, true);

    const hearingUsers = [];
    const result = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景',
      unitIndex: 1, ritual: 'full', budgetCap: 40000, requireCompletionMetadata: true,
      ask: async req => {
        if (req.system.includes('MAZZ_W68_POINT') && !req.system.includes('ANSWER')) {
          return completion({ decision: 'pass', findings: [], repairItems: [] });
        }
        if (req.system.includes('MAZZ_W68_REVIEW')) {
          return completion({ objections: [{
            id: 'O-major', severity: 'major', claim: '证据仍有冲突',
            artifactRef: 'draft:第1句', ruleRef: 'R-major',
          }] });
        }
        if (req.system.includes('MAZZ_W68_ANSWER')) return completion({ answer: '见正文', evidenceRef: 'draft:第1句', outcome: 'withdraw' });
        if (req.system.includes('MAZZ_W68_RECONSIDER')) return completion({ outcome: 'hold', reason: '仍未撤回' });
        if (req.system.includes('MAZZ_W68_HEARING')) {
          hearingUsers.push(req.user);
          return completion({});
        }
        if (req.system.includes('MAZZ_W68_FINAL')) {
          return completion({
            decision: 'block', reasonCode: 'UNRESOLVED_OBJECTION', reason: '庭审包无效，质询仍成立',
            artifactRef: 'objection:M4-O-major', ruleRef: 'W68-OBJECTION',
          });
        }
        return completion({});
      },
    });
    assert.equal(result.sealed, false);
    assert.equal(result.gates.objection, false);
    assert.equal(result.objections[0].status, 'sustained');
    assert.equal(result.objections[0].severity, 'critical');
    assert.equal(result.objections[0].originalSeverity, 'major');
    assert.equal(result.objections[0].hearing.valid, false);
    assert.equal(result.finalArbitration.artifactRef, 'objection:M4-O-major');
    assert.deepEqual(result.objections.map(row => row.id), ['M4-O-major', 'M5-O-major']);
    assert(result.objections.every(row => row.sourceId === 'O-major'));
    assert.equal(hearingUsers.length, 2);
    assert.match(hearingUsers[0], /M4-O-major/);
    assert.doesNotMatch(hearingUsers[0], /M5-O-major/);
    assert.match(hearingUsers[1], /M5-O-major/);
    assert.doesNotMatch(hearingUsers[1], /M4-O-major/);
    assert(hearingUsers.every(user => !user.includes('requestedOutcome')));
    assert.match(result.artifacts.objection, /原始级别：major/);
    assert.match(result.artifacts.objection, /系统级别：critical/);
    assert.match(result.artifacts.objection, /庭审系统决定：sustain/);
    assert.match(result.artifacts.objection, /庭审包有效性：无效/);
    assert.match(result.artifacts.objection, /庭审无效原因：hearing-decision-invalid/);

    let validReviewCalls = 0;
    const validSustain = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景',
      unitIndex: 1, ritual: 'full', budgetCap: 40000, requireCompletionMetadata: true,
      ask: async req => {
        if (req.system.includes('MAZZ_W68_POINT') && !req.system.includes('ANSWER')) {
          return completion({ decision: 'pass', findings: [], repairItems: [] });
        }
        if (req.system.includes('MAZZ_W68_REVIEW')) {
          validReviewCalls += 1;
          return completion(validReviewCalls === 1 ? { objections: [{
            id: 'O-sustain', severity: 'major', claim: '证据冲突成立',
            artifactRef: 'draft:第1句', ruleRef: 'R-sustain',
          }] } : { objections: [] });
        }
        if (req.system.includes('MAZZ_W68_ANSWER')) return completion({ answer: '见正文', evidenceRef: 'draft:第1句' });
        if (req.system.includes('MAZZ_W68_RECONSIDER')) return completion({ outcome: 'hold', reason: '仍未撤回' });
        if (req.system.includes('MAZZ_W68_HEARING')) return completion({ decision: 'sustain', reason: '质询成立', ruleRef: 'R-sustain' });
        if (req.system.includes('MAZZ_W68_FINAL')) {
          return completion({
            decision: 'block', reasonCode: 'UNRESOLVED_OBJECTION', reason: '质询已获维持',
            artifactRef: 'objection:M4-O-sustain', ruleRef: 'W68-OBJECTION',
          });
        }
        return completion({});
      },
    });
    assert.equal(validSustain.sealed, false);
    assert.equal(validSustain.gates.objection, false);
    assert.equal(validSustain.objections[0].status, 'sustained');
    assert.equal(validSustain.objections[0].hearing.valid, true);
  });

  test('答辩证据与原席复议必须结构完整，伪引用或缺理由不得撤销质询', async () => {
    assert.equal(normalizeAnswerPacket({ evidenceRef: 'draft:第1句' }, { evidenceRefs: ['draft:第1句'] }).invalidReason, 'answer-text-missing');
    assert.equal(normalizeAnswerPacket({ answer: '见正文', evidenceRef: 'nonsense' }, { evidenceRefs: ['draft:第1句'] }).invalidReason, 'answer-evidence-ref-invalid');
    assert.equal(normalizeAnswerPacket({ answer: '见正文', evidenceRef: 'draft:第9999段' }, { evidenceRefs: ['draft:第1句'] }).invalidReason, 'answer-evidence-ref-unresolved');
    assert.equal(normalizeAnswerPacket({ answer: '见正文', evidenceRef: 'draft:第1句' }, { evidenceRefs: ['draft:第1句'] }).valid, true);
    assert.equal(normalizeAnswerPacket({ answer: {}, evidenceRef: 'draft:第1句' }, { evidenceRefs: ['draft:第1句'] }).invalidReason, 'answer-text-missing');
    const unauthorizedAnswer = normalizeAnswerPacket({ answer: '见正文', evidenceRef: 'draft:第1句', outcome: 'withdraw' }, { evidenceRefs: ['draft:第1句'] });
    assert.equal(unauthorizedAnswer.valid, true);
    assert.equal(unauthorizedAnswer.requestedOutcome, 'withdraw');
    assert.equal(unauthorizedAnswer.normalization, 'answer-outcome-ignored');
    assert.equal(normalizeAnswerPacket({ raw: 'not-json', parseWarning: true }, { evidenceRefs: ['draft:第1句'] }).rawSummary, 'not-json');
    assert.equal(normalizeReconsiderPacket({ outcome: 'withdraw' }).invalidReason, 'reconsider-reason-missing');
    assert.equal(normalizeReconsiderPacket({ outcome: 'withdraw', reason: '证据充分' }).valid, true);
    assert.equal(normalizeReconsiderPacket({ outcome: 'withdraw', reason: {} }).invalidReason, 'reconsider-reason-missing');
    assert.equal(normalizeReconsiderPacket({ raw: 'not-json', parseWarning: true }).rawSummary, 'not-json');
    assert.equal(normalizeHearingPacket({ decision: 'overrule', reason: {}, ruleRef: 'R1' }).invalidReason, 'hearing-citation-missing');

    let reviewCalls = 0;
    let answerCalls = 0;
    const result = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景',
      unitIndex: 1, ritual: 'full', budgetCap: 40000, requireCompletionMetadata: true,
      ask: async req => {
        if (req.system.includes('MAZZ_W68_POINT') && !req.system.includes('ANSWER')) {
          return completion({ decision: 'pass', findings: [], repairItems: [] });
        }
        if (req.system.includes('MAZZ_W68_REVIEW')) {
          reviewCalls += 1;
          return completion(reviewCalls === 1 ? { objections: [{
            id: 'O-answer', severity: 'critical', claim: '证据链仍有缺口',
            artifactRef: 'draft:第1句', ruleRef: 'R-answer',
          }] } : { objections: [] });
        }
        if (req.system.includes('MAZZ_W68_ANSWER')) {
          answerCalls += 1;
          return answerCalls === 2
            ? completion('not-json')
            : completion({ answer: '证据在此', evidenceRef: 'draft:第9999段', outcome: 'withdraw' });
        }
        if (req.system.includes('MAZZ_W68_RECONSIDER')) return completion({ outcome: 'withdraw' });
        if (req.system.includes('MAZZ_W68_HEARING')) return completion({ decision: 'sustain', reason: '答辩无有效证据', ruleRef: 'R-answer' });
        if (req.system.includes('MAZZ_W68_FINAL')) {
          return completion({
            decision: 'block', reasonCode: 'UNRESOLVED_OBJECTION', reason: '质询未撤',
            artifactRef: 'objection:M4-O-answer', ruleRef: 'W68-OBJECTION',
          });
        }
        return completion({});
      },
    });
    assert.equal(result.sealed, false);
    assert.equal(result.answers.length, 2);
    assert(result.answers.every(row => row.answerValid === false && row.outcome === 'hold' && row.reconsider === null));
    assert.equal(result.objections[0].status, 'sustained');
    assert.match(result.artifacts.answer, /答辩包有效性：无效/);
    assert.match(result.artifacts.answer, /答辩无效原因：answer-evidence-ref-unresolved/);
    assert.match(result.artifacts.answer, /模型原始撤回请求：withdraw/);
    assert.match(result.artifacts.answer, /答辩系统权限结果：保持质询，不进入原席复议/);
    assert.match(result.artifacts.answer, /答辩解析降级：是/);
    assert.match(result.artifacts.answer, /答辩原始摘要：not-json/);
    assert.match(result.artifacts.answer, /原席原始决定：未执行/);

    let reasonlessReviewCalls = 0;
    let reconsiderUser = '';
    const reasonless = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景',
      unitIndex: 1, ritual: 'full', budgetCap: 40000, requireCompletionMetadata: true,
      ask: async req => {
        if (req.system.includes('MAZZ_W68_POINT') && !req.system.includes('ANSWER')) return completion({ decision: 'pass', findings: [], repairItems: [] });
        if (req.system.includes('MAZZ_W68_REVIEW')) {
          reasonlessReviewCalls += 1;
          return completion(reasonlessReviewCalls === 1 ? { objections: [{
            id: 'O-reconsider', severity: 'critical', claim: '仍需复核', artifactRef: 'draft:第1句', ruleRef: 'R-reconsider',
          }] } : { objections: [] });
        }
        if (req.system.includes('MAZZ_W68_ANSWER')) return completion({ answer: '见正文', evidenceRef: 'draft:第1句' });
        if (req.system.includes('MAZZ_W68_RECONSIDER')) {
          reconsiderUser = req.user;
          return completion({ outcome: 'withdraw' });
        }
        if (req.system.includes('MAZZ_W68_HEARING')) return completion({ decision: 'sustain', reason: '撤回包缺理由', ruleRef: 'R-reconsider' });
        if (req.system.includes('MAZZ_W68_FINAL')) return completion({
          decision: 'block', reasonCode: 'UNRESOLVED_OBJECTION', reason: '质询未撤',
          artifactRef: 'objection:M4-O-reconsider', ruleRef: 'W68-OBJECTION',
        });
        return completion({});
      },
    });
    assert.equal(reasonless.sealed, false);
    assert(reasonless.answers.every(row => row.answerValid === true && row.reconsider?.valid === false && row.outcome === 'hold'));
    assert.match(reasonless.artifacts.answer, /复议包有效性：无效/);
    assert.match(reasonless.artifacts.answer, /reconsider-reason-missing/);
    assert.doesNotMatch(reconsiderUser, /"outcome"/);
  });

  test('四闸安静路径不调用仲裁席，原始意见与证据权威理由分离', async () => {
    const evidence = buildFinalArbitrationEvidence({
      gates: { machine: true, point: true, review: true, objection: true },
      machine: { pass: true, blocking: [] }, point: { valid: true, decision: 'pass' },
      reviews: [{ seat: 'M4', packet: { valid: true, objections: [] } }],
      bible: '', initialUnit: true,
    });
    assert.equal(evidence.bibleAudit.state, 'not-applicable-initial-unit');
    assert.deepEqual(evidence.unresolvedBlockers, []);
    const normalized = normalizeFinalArbitrationPacket({
      decision: 'block', reason: '缺少实质审查依据', reasonCode: 'CLOSED_GATE', gateRef: 'gate:review',
    }, evidence);
    assert.equal(normalized.decision, 'pass');
    assert.equal(normalized.valid, true);
    assert.equal(normalized.rawReason, '缺少实质审查依据');
    assert.match(normalized.reason, /四闸全开/);
    assert.equal(normalized.normalization, 'quiet-path-deterministic');

    const counters = {};
    const result = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第1节：河岸晨景', unitIndex: 1,
      requireCompletionMetadata: true,
      ask: pointAsk({ decision: 'pass', findings: [], repairItems: [] }, counters),
    });
    assert.equal(result.sealed, true);
    assert.equal(counters.final || 0, 0);
    assert(result.transitions.includes('final:not-required'));
    assert.equal(result.finalArbitration.requestedDecision, 'not-invoked');
    assert.match(result.reason, /四闸全开/);
    assert.match(result.artifacts.verdict, /仲裁席原始决定：not-invoked/);
    assert.match(result.artifacts.verdict, /系统归一决定：pass/);
  });

  test('后续单元缺设定集是工件完整性阻断，仲裁只能引用真实 blocker', async () => {
    const closedEvidence = buildFinalArbitrationEvidence({
      gates: { machine: true, point: true, review: true, objection: false },
      bible: '已有设定集', initialUnit: false,
    });
    const falsePass = normalizeFinalArbitrationPacket({ decision: 'pass', reason: '忽略关闭闸' }, closedEvidence);
    assert.equal(falsePass.valid, false);
    assert.equal(falsePass.invalidReason, 'pass-with-unresolved-gate-or-conflict');
    const citedBlock = normalizeFinalArbitrationPacket({
      decision: 'block', reasonCode: 'CLOSED_GATE', reason: '质询闸未关闭',
      gateRef: 'gate:objection', ruleRef: 'W68-GATE',
    }, closedEvidence);
    assert.equal(citedBlock.valid, true);
    assert.equal(citedBlock.decision, 'block');
    const uncitedDetails = normalizeFinalArbitrationPacket({
      decision: 'block', reasonCode: 'CLOSED_GATE', gateRef: 'gate:objection',
    }, closedEvidence);
    assert.equal(uncitedDetails.valid, false);
    assert.equal(uncitedDetails.invalidReason, 'block-citation-details-missing');

    let finalCalls = 0;
    const result = await runW68Review({
      draft: pointDraft, blueprint: '普通蓝图', outline: '第2节：河岸暮色',
      bible: '', unitRef: '第002节', unitIndex: 2, requireCompletionMetadata: true,
      ask: async req => {
        if (req.system.includes('MAZZ_W68_POINT')) return completion({ decision: 'pass', findings: [], repairItems: [] });
        if (req.system.includes('MAZZ_W68_REVIEW')) return completion({ objections: [] });
        if (req.system.includes('MAZZ_W68_FINAL')) {
          finalCalls += 1;
          return completion({
            decision: 'block', reasonCode: 'ARTIFACT_INTEGRITY', reason: '后续单元缺少项目设定集',
            artifactRef: 'artifact:bible', ruleRef: 'W68-INTEGRITY',
          });
        }
        return completion({});
      },
    });
    assert.equal(finalCalls, 1);
    assert.equal(result.sealed, false);
    assert.equal(result.verdict, 'block');
    assert.equal(result.finalEvidence.bibleAudit.state, 'missing-required-project-bible');
    assert(result.finalEvidence.unresolvedBlockers.includes('artifact:bible'));
    assert.equal(result.finalArbitration.artifactRef, 'artifact:bible');
  });

  test('修订席收到 length 时保留原正文并明确 blocked，不进入 seal', async () => {
    const original = '本文已通过所有校验。原始正文不得被截断半稿替换。';
    const result = await runW68Review({
      draft: original,
      blueprint: '# 蓝图\n\n- [必达] original::原始正文::原始正文',
      outline: '原始正文',
      requireCompletionMetadata: true,
      ask: async () => ({
        text: '截断修订稿', finishReason: 'length', completionKind: 'finish-reason',
        usage: { inputTokens: 8, outputTokens: 16, totalTokens: 24 }, safeToCommit: false,
      }),
    });
    assert.equal(result.sealed, false);
    assert.equal(result.verdict, 'provider-unsafe');
    assert.equal(result.text, original);
    assert.equal(result.unsafeCompletion.finishReason, 'length');
    assert.ok(result.transitions.includes('provider-unsafe'));
  });

  test('生产调用拒绝没有终态元数据的旧字符串审校结果', async () => {
    const result = await runW68Review({
      draft: '本文已通过所有校验。',
      requireCompletionMetadata: true,
      ask: async () => '看似完整但没有终态证据',
    });
    assert.equal(result.sealed, false);
    assert.equal(result.verdict, 'provider-unsafe');
    assert.equal(result.unsafeCompletion.completionKind, 'legacy-string');
  });

  test('产品接线只允许 detailed 结果替换正文并驱动专业流程', () => {
    const index = read('renderer/modules/factory/index.js');
    const main = read('main/main.js');
    assert.match(index, /ask:\s*req\s*=>\s*chatDetailed/);
    assert.match(index, /requireCompletionMetadata:\s*true/);
    assert.ok((index.match(/chatForArtifactCommit\(/g) || []).length >= 4);
    assert.match(main, /detailed\s*=\s*false/);
    assert.match(main, /classifyFactoryCompletion\(\{\s*finishReason,\s*completionKind\s*\}\)/);
    assert.match(main, /factoryProviderGenerationOptions\(\{\s*providerId,\s*baseURL,\s*model,\s*role\s*\}\)/);
    assert.match(index, /ask:\s*req\s*=>\s*chatDetailed\(\{\s*cfg:\s*this\.cfg,\s*signal:\s*this\.taskSignal\(task\),\s*\.\.\.req\s*\}\)/);
    const artifactWriter = index.slice(index.indexOf('async writeW68Artifacts('), index.indexOf('async appendW68FinalReview('));
    assert.match(artifactWriter, /if \(result\.sealed === true\)/);
    assert.match(artifactWriter, /if \(result\.precedent\)/);
    assert(artifactWriter.indexOf('if (result.sealed === true)') < artifactWriter.indexOf('`${folder}\/圣经.md`'));
  });

  test('纠偏与状态快照均 fail-closed，unsafe 不得污染后续上下文或覆盖旧快照', () => {
    const index = read('renderer/modules/factory/index.js');
    assert.match(index, /correctionDirective\s*=\s*await chatForArtifactCommit\(/);
    assert.match(index, /const nextStateSummary\s*=\s*await chatForArtifactCommit\(/);
    assert.match(index, /stateSummary\s*=\s*nextStateSummary/);
    assert.match(index, /const snap\s*=\s*await chatForArtifactCommit\(/);
    assert.match(index, /纠偏未收到安全终态，已忽略/);
    assert.match(index, /状态快照未收到安全终态，沿用上一份快照/);
    assert.match(index, /快照未收到安全终态，保留旧快照/);
    assert.doesNotMatch(index, /stateSummary\s*=\s*await chat\s*\(/);
    assert.doesNotMatch(index, /const snap\s*=\s*await chat\s*\(/);
  });

  test('审校只在正文为空时暂停；短正文不再被字符门限阻断', () => {
    const index = read('renderer/modules/factory/index.js');
    const maxStart = index.indexOf('async runMaxTask(');
    const reasonAt = index.indexOf("reasonCode: 'POST_REVIEW_BODY_EMPTY'", maxStart);
    const branchAt = index.lastIndexOf("if (!String(text || '').trim())", reasonAt);
    const snapshotAt = index.indexOf('// 滚动叙事状态快照', reasonAt);
    assert(reasonAt > 0 && branchAt > 0 && snapshotAt > reasonAt, '缺少审校后空正文 fail-closed 分支');
    const branch = index.slice(branchAt, snapshotAt);
    assert.match(branch, /await flushCkpt\(\)/);
    assert.match(branch, /task\.status\s*=\s*'paused'/);
    assert.match(branch, /await stateFor\('stopped', i - 1\)/);
    assert.match(branch, /reasonCode:\s*'POST_REVIEW_BODY_EMPTY'/);
    assert.match(branch, /return;/);
    assert.doesNotMatch(branch, /stateFor\('running'/);

    const singleStart = index.indexOf('async runSingleTask(');
    const single = index.slice(singleStart, maxStart);
    assert.match(single, /const originalBody\s*=\s*stripTokenDeclaration\(completion\.text\)/);
    assert.match(single, /if \(!String\(text \|\| ''\)\.trim\(\)\)/);
    assert.match(single, /content:\s*originalBody/);
    assert.match(single, /reasonCode:\s*'POST_REVIEW_BODY_EMPTY'/);
    assert.match(single, /status:\s*'stopped',\s*currentChapter:\s*0/);
    assert.doesNotMatch(single, /length\s*<\s*10|POST_REVIEW_BODY_TOO_SHORT/);
  });
});

describe('W92 发布证据原子边界', () => {
  test('deterministic/live wrapper 必须先原子失效旧 PASS，全部坐标成功后才能发布新 PASS', () => {
    for (const relative of [
      'tests/e2e/w92-factory-release.mjs',
      'tests/e2e/w92-factory-live-release.mjs',
    ]) {
      const source = read(relative);
      const runningAt = source.indexOf("result: 'RUNNING'");
      const artifactAt = source.indexOf('const releaseArtifacts = collectW92Artifacts');
      const passAt = source.lastIndexOf("result: 'PASS'");
      assert(runningAt >= 0 && artifactAt > runningAt, `${relative} 应在制品校验或产品启动前写 RUNNING`);
      assert(passAt > runningAt, `${relative} 只有完成后才能写 PASS`);
      assert.match(source, /fs\.writeFileSync\(temporary,[\s\S]*fs\.renameSync\(temporary, file\)/);
      assert.match(source, /const manifestPath = path\.join\(evidenceDir,/);
    }
  });

  test('live release 保持单次 fail-fast，真实工作流用 UI 事件锁定 121 字单篇收据', () => {
    const release = read('tests/e2e/w92-factory-live-release.mjs');
    assert.doesNotMatch(release, /MAX_ATTEMPTS|classifyRetryableTransport|runWithRetry|attemptAudit/);
    assert.match(release, /stdio: 'inherit'/);

    const source = read('tests/e2e/w92-factory-live-workflow.mjs');
    const body = source.match(/const LIVE_BODY = '([^']+)'/)?.[1] || '';
    assert.equal(body.length, 121, '真实单篇 fixture 必须保持 121 个 JavaScript 字符');
    assert.match(source, /await panel\.uncheck\('#pj-max'\)|\['#pj-max', '#pj-dual', '#pj-autopreview'\]/);
    assert.match(source, /panel\.locator\(selector\)\.dispatchEvent\('change'\)/);
    assert.match(source, /await panel\.selectOption\('#pj-review-ritual', 'light'\)/);
    assert.doesNotMatch(source, /pj-review-budget|reviewBudgetCap/, '真实链路门不得重新注入产品 Token 预算');
    assert.match(source, /await waitForStableProjectControls\(panel, LIVE_PROJECT_COORDINATES/);
    assert.doesNotMatch(source, /querySelector\('#pj-(?:max|dual|autopreview)'\)\.checked\s*=/, '不得裸改 checked 绕过产品 change 生命周期');
    assert.doesNotMatch(source, /querySelector\('#pj-review-ritual'\)\.value\s*=/, '不得裸改审校坐标');
    assert.match(source, /matchesProjectCoordinates\(submittedProjectControls\.dom, LIVE_PROJECT_COORDINATES\)/);
    assert.match(source, /matchesProjectCoordinates\(submittedProjectControls\.authoritative, LIVE_PROJECT_COORDINATES\)/);
    assert.match(source, /receiptCoordinates\.mode === 'single'/);
    assert.match(source, /maxMode: task\.mode === 'max'/);
    assert.match(source, /dualLoop: task\.dualLoop === true/);
    assert.match(source, /autoPreview: task\.autoPreview === true/);
    assert.match(source, /reviewRitual: String\(task\.reviewRitual \|\| ''\)/);
    assert.match(source, /maxChapters:\s*0/);
    assert.match(source, /matchesProjectCoordinates\(receiptCoordinates, LIVE_PROJECT_COORDINATES\)/);
    assert.match(source, /matchesProjectCoordinates\(terminalCoordinates, LIVE_PROJECT_COORDINATES\)/);
    assert.match(source, /professionalArtifactsComplete: true/);
    assert.match(source, /requiredProfessionalArtifacts: \[\.\.\.REQUIRED_PROFESSIONAL_ARTIFACTS\]/);
    assert.match(source, /presentProfessionalArtifacts/);
    assert.match(source, /providerMaxBlueprintExpected === false/);
    assert.match(source, /providerMaxBlueprintExpected: false/);
    assert.match(source, /__w92LiveModeDispatchDiagnostic/);
    assert.match(source, /modeDispatchDiagnostic\.singleCalls === 1 && modeDispatchDiagnostic\.maxCalls === 0/);
    assert.match(source, /providerMaxBlueprintInvoked: false/);
    assert.match(source, /projectMantraArtifactPresent === true/);
    assert.match(source, /projectMantraArtifactPresent: true/);
    assert.match(source, /singleUnitOutlineArtifactPresent === true/);
    assert.match(source, /singleUnitOutlineArtifactPresent: true/);
    assert.match(source, /singleUnitOutlineMatchesReceipt: true/);
    assert.match(source, /singleUnitOutline === `第1节：\$\{task\.label\}`/);
    const factoryIndex = read('renderer/modules/factory/index.js');
    const singleStart = factoryIndex.indexOf('async runSingleTask(');
    const maxStart = factoryIndex.indexOf('async runMaxTask(');
    const singleRunner = factoryIndex.slice(singleStart, maxStart);
    const maxRunner = factoryIndex.slice(maxStart);
    assert.doesNotMatch(singleRunner, /role:\s*'blueprint'/, '单篇执行器不得调用 Provider 蓝图席');
    assert.match(singleRunner, /章节大纲\.md/);
    assert.match(maxRunner, /role:\s*'blueprint'/);
    for (const name of [
      '01-骨架与验收点.md', '02-扩写稿.md', '02b-润色记录.md', '03-机检报告.md',
      '04-对点报告.md', '05-修订单.md', '06-请示单.md', '07-审理表.md',
      '08-质询单.md', '09-答辩书.md', '10-裁决书.md', '工件清单.json',
    ]) assert.match(source, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(source, /professionalGates: professionalGateStatus/);
    assert.match(source, /Object\.values\(professionalGateStatus\)\.every\(Boolean\)/);
    assert.doesNotMatch(source, /artifactCount\s*[:=]\s*42/, '专业工件只校验协议必达集，不锁死偶然数量');
  });

  test('制品坐标绑定文件监视修复与已安装 Chokidar close-race 补丁', () => {
    const helper = read('tests/e2e/w92-evidence-artifacts.mjs');
    assert.match(helper, /'main\/file-watcher\.js'/);
    assert.match(helper, /'preload\/bridge\.js'/);
    assert.match(helper, /'node_modules\/chokidar\/lib\/nodefs-handler\.js'/);
    assert.match(helper, /'patches', 'chokidar\+3\.6\.0\.patch'/);
    assert.match(helper, /Chokidar close-race patch is not installed/);
  });

  test('每个叶子门在启动与结束核验唯一健康 watcher，并在发布 PASS 前完成 shutdown 审计', () => {
    const cases = [
      {
        relative: 'tests/e2e/w92-factory-workflow.mjs',
        close: 'await closeApp();',
        check: 'assert(runtimeErrors.length === 0',
      },
      {
        relative: 'tests/e2e/w92-factory-live-provider.mjs',
        close: 'await app.close();',
        check: 'if (fatal.length)',
      },
      {
        relative: 'tests/e2e/w92-factory-live-workflow.mjs',
        close: 'await app.close();',
        check: 'assert(errors.length === 0',
      },
    ];
    for (const { relative, close, check } of cases) {
      const source = read(relative);
      const appReadyAt = source.indexOf("document.documentElement.dataset.appReady === '1'");
      const directSnapshotAt = source.indexOf("window.mazz.invoke('resources:snapshot')", appReadyAt);
      const stableSnapshotAt = source.indexOf('await waitForStableResourceSnapshot(', appReadyAt);
      const firstSnapshotAt = [directSnapshotAt, stableSnapshotAt].filter(index => index >= 0).sort((a, b) => a - b)[0] ?? -1;
      assert(appReadyAt >= 0 && firstSnapshotAt > appReadyAt, `${relative} 必须在正式 appReady 后采样 watcher 健康`);
      assert.match(source, /filter\(entry => entry\?\.type === 'file-watcher'\)/, `${relative} 缺少 watcher 单一 owner 门`);
      assert.match(source, /watcher\.state === 'watching'/, `${relative} 缺少 watcher 健康状态门`);
      assert.match(source, /\[file-watcher\\\]\.\*\(\?:degraded\|fatal\)/i, `${relative} stderr 未把 watcher 降级当失败`);
      const closeAt = source.lastIndexOf(close);
      const checkAt = source.lastIndexOf(check);
      const evidenceAt = source.lastIndexOf('const evidence = {');
      assert(closeAt >= 0 && checkAt > closeAt, `${relative} 必须先完成 shutdown 再判断运行时错误`);
      assert(evidenceAt > checkAt, `${relative} 必须在 shutdown 审计通过后才生成 PASS evidence`);
    }
  });

  test('live 叶子门以稳定身份基线拒绝新 owner，同时允许旧 owner 退休', () => {
    const cases = [
      {
        relative: 'tests/e2e/w92-factory-live-provider.mjs',
        close: 'await app.close();',
        fatal: 'if (fatal.length)',
      },
      {
        relative: 'tests/e2e/w92-factory-live-workflow.mjs',
        close: 'await app.close();',
        fatal: 'assert(errors.length === 0',
      },
    ];
    for (const { relative, close, fatal } of cases) {
      const source = read(relative);
      assert.match(source, /async function waitForStableResourceSnapshot\(/, `${relative} 缺少稳定资源终态门`);
      assert.match(source, /consecutive = 3/, `${relative} 必须要求连续资源快照`);
      assert.match(source, /signature === stableSignature \? stableCount \+ 1 : 1/, `${relative} 未要求连续相同的稳定快照`);
      assert.match(source, /current\.activeCount > initial\.activeCount/, `${relative} 未拒绝总资源增长`);
      assert.match(source, /current\.active\.length !== current\.activeCount \|\| initial\.active\.length !== initial\.activeCount/, `${relative} 未拒绝身份账与总数不一致`);
      assert.match(source, /every\(entry => entry\.key && entry\.type\)/, `${relative} 未对缺失 key\/type 的身份账 fail-closed`);
      assert.match(source, /Object\.entries\(current\.byType\)\.every\(\(\[type, count\]\) => count <= \(initial\.byType\[type\] \|\| 0\)\)/, `${relative} 未拒绝新类型或类型内增长`);
      assert.match(source, /baselineIdentities\.has\(`\$\{entry\.type\}\\u0000\$\{entry\.key\}`\)/, `${relative} 未拒绝新 owner 或等量身份替换`);
      assert.match(source, /currentTypes\['factory-ai-request'\][\s\S]*currentTypes\['factory-run-owner'\]/, `${relative} 未明确核对 Factory request/run owner 归零`);
      const stableCalls = [...source.matchAll(/await waitForStableResourceSnapshot\(/g)].map(match => match.index);
      assert(stableCalls.length >= 2, `${relative} 必须分别形成启动稳定基线并在结束时精确回线`);
      const baselineAt = stableCalls[0];
      const stableAt = stableCalls.at(-1);
      const watcherAt = source.lastIndexOf('assertHealthyFileWatcher(finalResources');
      const closeAt = source.lastIndexOf(close);
      const drainAt = source.indexOf('await sleep(500);', closeAt);
      const fatalAt = source.lastIndexOf(fatal);
      const evidenceAt = source.lastIndexOf('const evidence = {');
      assert(baselineAt >= 0 && stableAt > baselineAt && watcherAt > stableAt, `${relative} watcher 终检必须晚于启动基线和终态回线门`);
      assert(closeAt > watcherAt && drainAt > closeAt && fatalAt > drainAt && evidenceAt > fatalAt, `${relative} 必须按资源→watcher→shutdown→drain→fatal→evidence 排序`);
      assert.match(source, /baseline: \{ activeCount: (?:baseline|initialResources)\.activeCount, byType: (?:baseline|initialResources)\.byType \}/);
      assert.match(source, /final: \{ activeCount: finalResources\.activeCount, byType: finalResources\.byType \}/);
      assert.match(source, /retiredCount: (?:baseline|initialResources)\.activeCount - finalResources\.activeCount/);
      assert.match(source, /stableNoGrowth: true/);
      assert.match(source, /resourceBoundaryPassed: true/);
      assert.doesNotMatch(source, /returnedToBaseline:/, `${relative} 不得把允许退休的 no-growth 伪称为精确回线`);
    }
  });
});
