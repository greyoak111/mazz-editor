// W62f：虚拟滚动 AI 对话整理、角色翻转、导出/文风/提炼回喂与正式术语真机实证。
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Human } from './human.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const SHOT_DIR = process.env.SHOT_DIR || path.join(ROOT, 'tests/e2e/shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  if (req.url !== '/chat') { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>北向洋流证据讨论</title><style>
    body{margin:0;font:16px/1.65 sans-serif;background:#f4f5f7;color:#202124}main{max-width:780px;margin:auto;padding:24px}
    #conversation-scroll{height:300px;overflow:auto;border:1px solid #ccd1d8;border-radius:12px;background:#fff;padding:12px}
    .conversation-message{padding:12px 14px;margin:8px;border-radius:10px;background:#eef2ff}.conversation-message[data-message-author-role=assistant]{background:#ecfdf5}
    .message-content{white-space:pre-wrap}.pad{height:420px}
  </style></head><body><main><h1>北向洋流证据讨论</h1><div id="conversation-scroll" class="conversation-scroll"><div id="messages">
    <section class="conversation-message"><div class="message-content">第二问：怎样核对潮位与值班簿？</div></section>
    <section class="conversation-message"><div class="message-content">第二答：先按时间戳对齐，再检查航标记录是否形成闭环。</div></section>
    <div class="pad"></div>
  </div></div></main><script>
    const scroller=document.querySelector('#conversation-scroll'),messages=document.querySelector('#messages');let loaded=false;
    scroller.addEventListener('scroll',()=>{if(scroller.scrollTop>4||loaded)return;loaded=true;
      const box=document.createElement('div');box.innerHTML='<section class="conversation-message" data-message-author-role="user"><div class="message-content">第一问：北向洋流的证据链有哪些？</div></section><section class="conversation-message" data-message-author-role="assistant"><div class="message-content">第一答：航标、潮位和船舶值班簿需要相互校准。</div></section>';
      [...box.children].reverse().forEach(node=>messages.prepend(node));
    });setTimeout(()=>{scroller.scrollTop=scroller.scrollHeight},20);
  </script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push([name, 'PASS']); console.log(`■ ${name} ✓`); }
  catch (error) { results.push([name, 'FAIL', error.message]); console.error(`■ ${name} ✗\n${error.stack || error.message}`); }
}

console.log('[run87] 启动 Electron');
const app = await electron.launch({
  args: [ROOT],
  env: {
    ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS,
    MAZZ_E2E_FACTORY_MOCK: '1', MAZZ_E2E_DISABLE_GPU: '1', NODE_ENV: 'test',
  },
  timeout: 120000,
});
const proc = app.process?.();
proc?.stdout?.on?.('data', bytes => process.stdout.write('[electron] ' + String(bytes)));
proc?.stderr?.on?.('data', bytes => process.stderr.write('[electron:err] ' + String(bytes)));
const win = await app.firstWindow({ timeout: 120000 });
await win.waitForFunction(() => document.readyState !== 'loading');
const human = new Human(win, { tag: 'w62f' });
human.watchMain(app);
await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳初始化' });
await human.evaluate(() => Promise.all([
  window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}),
  window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }).catch(() => {}),
  window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'mock://w62f', model: 'mock-reasoning', providerId: 'deepseek' } }),
  window.mazz.invoke('secret:set', { key: 'factory.apiKey', value: 'mock-key-w62f' }),
]));
await win.waitForTimeout(700);
for (let i = 0; i < 20; i++) {
  const state = await human.evaluate(() => ({ agree: !!document.querySelector('#agree-accept'), masks: [...document.querySelectorAll('.mazz-palette-mask')].filter(node => node.getBoundingClientRect().width > 0).length }));
  if (state.agree) {
    await human.evaluate(() => { const box = document.querySelector('#agree-nomore'); if (box) box.checked = true; document.querySelector('#agree-accept')?.click(); });
    await win.waitForTimeout(120); continue;
  }
  if (!state.masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(120);
}

await human.evaluate(() => window.MazzShell.openTab('browser', { title: '浏览器', content: '' }));
await human.until(() => !!window.__activeBrowserCtl?.harvester && !!window.__activeBrowserCtl?.activeTab?.(), { timeout: 10000, msg: '浏览器对话整理桥就绪' });
await human.evaluate(url => window.__activeBrowserCtl.openUrl(url), ORIGIN + '/chat');
await human.until(async () => (await window.__activeBrowserCtl.execJs(null, 'location.href'))?.endsWith('/chat'), { timeout: 12000, msg: '对话页导航完成' });
await human.until(async () => (await window.__activeBrowserCtl.execJs(null, 'document.readyState')) === 'complete', { timeout: 12000, msg: '对话页加载完成' });

let panel = null;
async function harvestPanel() {
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    panel = app.windows().find(page => /panels\/harvest\.html/.test(page.url()));
    if (panel) return panel;
    await win.waitForTimeout(100);
  }
  throw new Error('AI 对话整理面板未打开');
}

await scenario('虚拟滚动全量采集 + 推断角色问号与人工翻转', async () => {
  await human.evaluate(() => window.MazzCommands.execute('browser.harvestAiChat'));
  const p = await harvestPanel();
  await p.waitForFunction(() => document.querySelector('#count')?.textContent.includes('4 / 4'), null, { timeout: 15000 });
  const before = await p.locator('.role').allTextContents();
  await human.assert(before.filter(text => text.endsWith('?')).length === 2, `未知角色必须保留两个问号（${before.join(',')}）`);
  await p.locator('.msg').nth(2).locator('[data-role-flip]').click();
  const after = await p.locator('.msg').nth(2).locator('.role').textContent();
  await human.assert(after === 'AI', `角色翻转后应为 AI 且问号消失（${after}）`);
  await p.screenshot({ path: path.join(SHOT_DIR, 'w62f-dialog-harvest.png') });
});

await scenario('按选择导出带来源的 Markdown', async () => {
  await panel.locator('.msg').nth(3).locator('input').uncheck();
  await panel.locator('#export').click();
  await panel.waitForFunction(() => document.querySelector('#status')?.textContent.startsWith('已导出：'), null, { timeout: 12000 });
  const dir = path.join(WS, 'AI对话归档');
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.md'));
  await human.assert(files.length === 1, `应导出一个 Markdown（${files.join(',')}）`);
  const markdown = fs.readFileSync(path.join(dir, files[0]), 'utf8');
  await human.assert(markdown.includes(ORIGIN + '/chat') && markdown.includes('消息数量：3'), '导出必须保留来源且只含三条选中消息');
  await human.assert(markdown.includes('第二问：怎样核对潮位与值班簿？') && !markdown.includes('第二答：先按时间戳对齐'), '未勾选消息不得混入导出');
});

await scenario('选定 AI 回复加入文风素材', async () => {
  await panel.locator('#select-all').click();
  await panel.locator('#style').click();
  await panel.waitForFunction(() => document.querySelector('#status')?.textContent.startsWith('已加入文风素材：'), null, { timeout: 12000 });
  const styles = await human.evaluate(() => window.mazz.invoke('settings:get', { key: 'mazz.factory.styles' }));
  await human.assert(styles?.[0]?.type === 'harvest' && /第一答|第二问/.test(styles[0].text || ''), '文风素材必须登记为 harvest 并只取当前角色为 AI 的选定消息');
});

await scenario('回喂无损提炼预览并生成导图', async () => {
  await panel.locator('#mindmap').click();
  await win.waitForSelector('.distill-preview-modal', { timeout: 20000 });
  const note = await win.locator('.distill-contract-note').textContent();
  await human.assert(/只能调整行序/.test(note || ''), '必须复用 W62d 无损提炼预览');
  await win.screenshot({ path: path.join(SHOT_DIR, 'w62f-distill-preview.png') });
  await win.locator('.distill-action[data-act="new"]').click();
  await human.until(() => window.MazzShell.tabs.active?.moduleId === 'mindmap', { timeout: 8000, msg: 'AI 对话导图生成' });
});

await scenario('智能创作台正式术语 + 异常警察', async () => {
  await human.evaluate(() => window.MazzCommands.execute('factory.openDesk'));
  await human.until(() => !!document.querySelector('.factory-desk'), { timeout: 8000, msg: '智能创作台打开' });
  await human.evaluate(() => document.querySelector('.factory-desk [data-a=health]')?.click());
  const text = await human.evaluate(() => document.querySelector('.factory-desk')?.innerText || '');
  await human.assert(/智能创作台/.test(text) && /创作流全景/.test(text) && /设定集/.test(text) && /先例库/.test(text) && /运行看板/.test(text), '正式产品术语必须同屏');
  await human.assert(!/活稿车间|车间全景|圣经|判例库|健康看板/.test(text), `界面不得残留内部黑话：${text.slice(0, 240)}`);
  await win.screenshot({ path: path.join(SHOT_DIR, 'w62f-product-terminology.png') });
  await human.finish({ allow: ['ERR_ABORTED', 'net::ERR_FILE_NOT_FOUND', 'favicon'] });
});

const passed = results.filter(row => row[1] === 'PASS').length;
console.log(`W62f 实证批：${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
await app.close().catch(() => {});
await new Promise(resolve => server.close(resolve));
process.exit(process.exitCode || 0);
