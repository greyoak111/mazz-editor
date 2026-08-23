// tests/contract/hotfix-w62f.test.mjs —— W62f AI 对话整理 + 产品术语契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  HARVEST_ADAPTERS, buildHarvestMarkdown, harvestScript, normalizeHarvestMessages, resolveHarvestAdapter,
} from '../../renderer/modules/browser/harvester.js';
import { productDisplayText, productFileName, productProtocolText, productText } from '../../renderer/modules/factory/terms.js';

const src = rel => fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

describe('W62f 对话采集纯内核', () => {
  test('九站适配器齐套且未知站点稳定回退通用启发式', () => {
    assert.ok(HARVEST_ADAPTERS.length >= 9);
    assert.equal(resolveHarvestAdapter('https://chatgpt.com/c/1').id, 'chatgpt');
    assert.equal(resolveHarvestAdapter('https://chat.deepseek.com/a/chat/s/1').id, 'deepseek');
    assert.equal(resolveHarvestAdapter('https://kimi.moonshot.cn/chat/1').id, 'kimi');
    assert.equal(resolveHarvestAdapter('https://www.doubao.com/chat/1').id, 'doubao');
    assert.equal(resolveHarvestAdapter('https://chatglm.cn/main/alltoolsdetail').id, 'glm');
    assert.equal(resolveHarvestAdapter('https://claude.ai/chat/1').id, 'claude');
    assert.equal(resolveHarvestAdapter('https://copilot.microsoft.com/chats/1').id, 'copilot');
    assert.equal(resolveHarvestAdapter('https://gemini.google.com/app/1').id, 'gemini');
    assert.equal(resolveHarvestAdapter('https://poe.com/s/1').id, 'poe');
    assert.equal(resolveHarvestAdapter('https://example.org/chat').id, 'generic');
  });

  test('显式角色优先，未知角色交替推断并保留问号，重复正文不冒充同一消息', () => {
    const rows = normalizeHarvestMessages([
      { text: '问题一', role: 'user' },
      { text: '回答一', role: 'assistant' },
      { text: '问题二' },
      { text: '回答二' },
      { text: '回答二' },
    ]);
    assert.deepEqual(rows.map(row => row.role), ['user', 'assistant', 'user', 'assistant', 'user']);
    assert.deepEqual(rows.map(row => row.uncertain), [false, false, true, true, true]);
    assert.equal(rows.filter(row => row.text === '回答二').length, 2, '合法的重复消息正文不得按文本静默去重');
    assert.match(rows[2].roleLabel, /\?$/);
  });

  test('滚顶脚本只返回结构化文本，导出带来源、站点、日期和角色标疑', () => {
    const script = harvestScript('https://chatgpt.com/c/1');
    assert.match(script, /scrollPasses/);
    assert.match(script, /scrollTop\s*=\s*0/);
    assert.match(script, /shadowRoot/);
    assert.equal(script.includes('outerHTML'), false);
    const md = buildHarvestMarkdown({
      site: 'ChatGPT', topic: '北向洋流', url: 'https://chatgpt.com/c/1', capturedAt: '2026-08-13T12:00:00.000Z',
    }, [
      { role: 'user', roleLabel: '用户', text: '给出证据。' },
      { role: 'assistant', roleLabel: 'AI?', uncertain: true, text: '先列来源。' },
    ]);
    assert.match(md, /^# AI 对话：北向洋流/m);
    assert.match(md, /来源：<https:\/\/chatgpt\.com\/c\/1>/);
    assert.match(md, /## 002 · AI\?/);
    assert.match(md, /先列来源。/);
  });

  test('采集脚本与运行时不按消息字符数或条数丢弃对话', () => {
    const script = harvestScript('https://chatgpt.com/c/1');
    assert.equal(script.includes('text.length > 100000'), false);
    assert.equal(script.includes('n < 100000'), false);
    const runtime = src('renderer/modules/browser/harvest-runtime.js');
    assert.equal(runtime.includes('.slice(0, 1000)'), false);
    assert.equal(runtime.includes('500_000'), false);
    assert.equal(runtime.includes('100_000'), false);
  });

  test('滚顶按自然稳定收敛并合并全部 selector 候选，不设固定轮次或首个两条短路', () => {
    const source = src('renderer/modules/browser/harvester.js');
    const script = harvestScript('https://chatgpt.com/c/1');
    assert.equal(source.includes('maxPasses ='), false);
    assert.equal(source.includes('Math.min(16'), false);
    assert.match(script, /while \(stable < \d+\)/);
    assert.match(script, /position\.key === lastPosition/);
    assert.match(script, /selectorsUsed\.add/);
    assert.match(script, /mergeRows\(collected, snapshot\.rows, true\)/);
    assert.match(script, /stableKeyOf/);
    assert.match(script, /row\.key \? 'key:' \+ row\.key : 'text:' \+ row\.text/);
    assert.doesNotMatch(script, /unique\.length >= 2\) break/);
    assert.doesNotMatch(script, /text\.length > best\.length/);
    assert.match(script, /maximal\.map\(nodeText\)\.join/);
  });

  test('自然滚顶可越过旧 16 轮并保留虚拟化期间出现的全部消息', async () => {
    const dom = new JSDOM(`<!doctype html><main role="main">
      <article data-testid="conversation-turn-current-user"><div data-message-author-role="user">重复正文</div></article>
      <article data-testid="conversation-turn-current-ai"><div data-message-author-role="assistant">重复正文</div></article>
    </main>`, { url: 'https://chatgpt.com/c/1', runScripts: 'outside-only' });
    const { window } = dom;
    window.scrollTo = () => {};
    const main = window.document.querySelector('main');
    let loaded = 0;
    Object.defineProperties(main, {
      clientHeight: { configurable: true, get: () => 200 },
      scrollHeight: { configurable: true, get: () => 1000 + loaded * 100 },
      scrollTop: { configurable: true, get: () => 0, set: () => {} },
    });
    main.addEventListener('scroll', () => {
      if (loaded >= 18) return;
      loaded++;
      const turn = window.document.createElement('article');
      turn.dataset.testid = `conversation-turn-older-${loaded}`;
      const message = window.document.createElement('div');
      message.dataset.messageAuthorRole = loaded % 2 ? 'assistant' : 'user';
      message.textContent = `历史消息 ${loaded}`;
      turn.appendChild(message);
      main.prepend(turn);
    });
    const result = await window.eval(harvestScript('https://chatgpt.com/c/1', { settleMs: 80, stablePasses: 2 }));
    assert.ok(result.scrollPasses > 16, `自然收敛被旧轮次帽截断：${result.scrollPasses}`);
    assert.equal(result.messages.length, 20);
    assert.equal(result.messages.filter(row => row.text === '重复正文').length, 2);
    dom.window.close();
  });
});

describe('W62f 面板、回喂与正式术语接线', () => {
  test('对话整理面板具备单选/批量/全选/反选、角色翻转与五条交付动作', () => {
    const panel = src('renderer/panels/harvest.html');
    assert.ok(panel.includes('data-mode="single"') && panel.includes('data-mode="batch"'));
    assert.ok(panel.includes('id="select-all"') && panel.includes('id="select-invert"'));
    assert.ok(panel.includes('data-role-flip'));
    assert.ok(panel.includes('harvestExport') && panel.includes('harvestStyle') && panel.includes('harvestMindmap') && panel.includes('harvestPromote') && panel.includes('harvestReviewPromotion'));
    assert.doesNotMatch(panel, /candidate-(?:title|statement)"\s+maxlength=|promotion-reason"\s+maxlength=|slice\(0,\s*100000\)/,
      '候选标题、正文和决定理由不得由面板字符帽截断');
  });

  test('浏览器、面板窗、文风素材与无损提炼回喂形成闭环', () => {
    const browser = src('renderer/modules/browser/index.js');
    const runtime = src('renderer/modules/browser/harvest-runtime.js');
    const panels = src('main/panel-windows.js');
    const styles = src('renderer/modules/factory/style-studio.js');
    assert.ok(browser.includes('browser.harvestAiChat') && browser.includes("kind: 'harvest'"));
    assert.ok(panels.includes("'harvest'") && panels.includes("harvest: 'AI 对话整理'"));
    assert.ok(runtime.includes('/AI对话归档') && runtime.includes('saveStyleText'));
    assert.equal(runtime.includes('/AI收割'), false);
    assert.ok(runtime.includes('markdown.distillDocumentToMindmap'));
    assert.ok(runtime.includes('promotion:promoteConversation'));
    assert.ok(runtime.includes('promotion:reviewConversationCandidate'));
    assert.ok(styles.includes('export async function saveStyleText'));
  });

  test('内部旧文件名保持兼容，所有展示词统一为产品术语', () => {
    assert.equal(productText('Factory Desk 活稿车间 · 圣经 · 判例库 · 机检打回率 · 开庭率'), '智能创作台 · 设定集 · 先例库 · 自动校验退回率 · 仲裁率');
    assert.equal(productText('骨架进入双审，红队提出质询'), '总纲进入交叉审校，反向核查提出复核');
    assert.equal(productProtocolText('W68c · M2 对点席'), '智能创作专业流程 · 节点验收席');
    assert.equal(productDisplayText('过程协议 · W68 双环审理 · Director 与 M2 对点席'), '过程协议 · 智能创作专业流程 · 流程导演 与 节点验收席');
    assert.equal(productDisplayText('过程协议 · W68c 专业流程交叉审校'), '过程协议 · 智能创作专业流程');
    assert.equal(productFileName('圣经.md'), '设定集.md');
    assert.equal(productFileName('判例库.md'), '先例库.md');
    const shell = src('renderer/shell/shell.js');
    const desk = src('renderer/modules/factory/desk.js');
    const provider = src('renderer/modules/factory/provider.js');
    const cfg = src('renderer/panels/factorycfg.html');
    const dock = src('renderer/panels/dockfloat.html');
    assert.equal(shell.includes("label: '活稿车间'"), false);
    assert.ok(desk.includes("displayName: '智能创作台'") && desk.includes('productFileName(row.name)'));
    assert.equal(provider.includes("label: '剧搭子'"), false);
    assert.ok(cfg.includes('交叉审校') && cfg.includes('智能创作执行台'));
    assert.ok(dock.includes('智能创作执行台'));
    assert.equal(dock.includes('<span>车间执行台</span>'), false);
  });
});
