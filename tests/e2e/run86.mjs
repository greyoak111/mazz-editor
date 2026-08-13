// W62b 入站桥补强：图片本地化、图片页 OCR、收藏 2 并发队列、临时 LAN 链真机实证。
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
const PIXEL = fs.readFileSync(path.join(ROOT, 'resources/icons/app.png'));
let activeBatch = 0, maxBatch = 0;
const articleText = '北向洋流的观测记录已经复核，航标、潮位与值班簿三类证据能够互相校准。'.repeat(26);
const server = http.createServer((req, res) => {
  if (req.url === '/asset.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PIXEL); return; }
  if (req.url === '/image-page') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>W62b 图片化页面</title><article><h1>图页</h1><img src="/asset.png" width="900" height="1200" alt="扫描稿"></article>');
    return;
  }
  if (/^\/batch-[12]$/.test(req.url || '')) {
    activeBatch++; maxBatch = Math.max(maxBatch, activeBatch);
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>W62b ${req.url.slice(1)}</title><article><h1>${req.url.slice(1)}</h1><p>${articleText}</p></article>`);
      activeBatch--;
    }, 420);
    return;
  }
  res.writeHead(404); res.end('not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push([name, 'PASS']); console.log(`■ ${name} ✓`); }
  catch (error) { results.push([name, 'FAIL', error.message]); console.error(`■ ${name} ✗\n${error.stack || error.message}`); }
}

console.log('[run86] 启动 Electron');
const app = await electron.launch({
  args: [ROOT],
  env: {
    ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS,
    MAZZ_E2E_RESEARCH_ORIGIN: ORIGIN, MAZZ_E2E_FACTORY_MOCK: '1', MAZZ_E2E_DISABLE_GPU: '1', NODE_ENV: 'test',
  },
  timeout: 120000,
});
const proc = app.process?.();
proc?.stdout?.on?.('data', bytes => process.stdout.write('[electron] ' + String(bytes)));
proc?.stderr?.on?.('data', bytes => process.stderr.write('[electron:err] ' + String(bytes)));
const win = await app.firstWindow({ timeout: 120000 });
await win.waitForFunction(() => document.readyState !== 'loading');
const human = new Human(win, { tag: 'w62b' });
human.watchMain(app);
await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳初始化' });
await human.evaluate(() => Promise.all([
  window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}),
  window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }).catch(() => {}),
]));
await win.waitForTimeout(700); // 协议模块是 boot 后懒导入，给首启竞态一次收口机会
for (let i = 0; i < 20; i++) {
  const state = await human.evaluate(() => ({ agree: !!document.querySelector('#agree-accept'), masks: [...document.querySelectorAll('.mazz-palette-mask')].filter(node => node.getBoundingClientRect().width > 0).length }));
  if (state.agree) {
    await human.evaluate(() => { const box = document.querySelector('#agree-nomore'); if (box) box.checked = true; document.querySelector('#agree-accept')?.click(); });
    await win.waitForTimeout(120); continue;
  }
  if (!state.masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(120);
}

async function openBrowser(url) {
  const marker = 'old-' + Date.now() + '-' + Math.random();
  await human.evaluate(mark => {
    if (window.__activeBrowserCtl) window.__activeBrowserCtl.__e2eMarker = mark;
    window.MazzShell.openTab('browser', { title: '浏览器', content: '' });
  }, marker);
  await human.until(() => !!window.__activeBrowserCtl?.clipper && !!window.__activeBrowserCtl?.activeTab?.() && !window.__activeBrowserCtl.__e2eMarker, { timeout: 10000, msg: '新浏览器剪藏桥就绪' });
  await human.evaluate(target => window.__activeBrowserCtl.openUrl(target), url);
  await human.until(async () => (await window.__activeBrowserCtl.execJs(null, 'location.href'))?.includes('/image-page'), { timeout: 12000, msg: '图片页导航完成' });
  await human.until(async () => (await window.__activeBrowserCtl.execJs(null, 'document.readyState')) === 'complete', { timeout: 12000, msg: '图片页加载完成' });
}

await scenario('图片本地化 + BrowserView 抓帧 visionChat OCR 兜底', async () => {
  await human.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'mock://w62b', model: 'mock-vision', providerId: 'deepseek' } });
    await window.mazz.invoke('secret:set', { key: 'factory.apiKey', value: 'mock-key-w62b' });
  });
  await openBrowser(ORIGIN + '/image-page');
  await human.evaluate(() => window.MazzCommands.execute('browser.pageToLibrary'));
  await human.until(async () => {
    const ws = await window.mazz.invoke('workspace:get');
    const rows = await window.mazz.invoke('fs:listDir', { path: ws + '/网页剪藏' }).catch(() => []);
    return rows.some(row => /W62b 图片化页面.*\.md$/.test(row.name));
  }, { timeout: 20000, msg: '图片页剪藏落盘' });
  const clipDir = path.join(WS, '网页剪藏');
  const mdName = fs.readdirSync(clipDir).find(name => /W62b 图片化页面.*\.md$/.test(name));
  const mdPath = path.join(clipDir, mdName);
  const markdown = fs.readFileSync(mdPath, 'utf8');
  await human.assert(/图片页 OCR[\s\S]*测试响应/.test(markdown), '图片化页面必须经 visionChat 补入 OCR 正文');
  await human.assert(/页面图片（已本地化）[\s\S]*assets\//.test(markdown), 'Markdown 必须改写为本地 assets 引用');
  await human.assert(fs.readdirSync(path.join(clipDir, 'assets')).some(name => name.endsWith('.png')), '页面图片必须写入 网页剪藏/assets');
  await human.evaluate(target => window.MazzCommands.execute('file.openPath', { path: target }), mdPath);
  await human.until(() => window.MazzShell.tabs.active?.title?.includes('W62b 图片化页面'), { timeout: 8000, msg: '剪藏成品打开' });
  await win.screenshot({ path: path.join(SHOT_DIR, 'w62b-image-clip-ocr.png') });
});

await scenario('收藏管理整批入口复用严格 2 并发队列', async () => {
  await openBrowser(ORIGIN + '/image-page');
  await human.evaluate(async (origin) => {
    const ctl = window.__activeBrowserCtl;
    ctl.bookmarks = [
      { title: '批次甲', name: '批次甲', url: origin + '/batch-1', folder: 'default' },
      { title: '批次乙', name: '批次乙', url: origin + '/batch-2', folder: 'default' },
    ];
    await window.mazz.invoke('settings:set', { key: 'browser.bookmarks', value: ctl.bookmarks });
    await window.mazz.invoke('panel:open', { kind: 'favmgr' });
  }, ORIGIN);
  let panel = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 10000 && !panel) {
    panel = app.windows().find(page => /panels\/favmgr\.html/.test(page.url()));
    if (!panel) await win.waitForTimeout(100);
  }
  if (!panel) throw new Error('收藏管理子窗未打开');
  await panel.waitForSelector('#clipall:not([disabled])', { timeout: 8000 });
  await panel.click('#clipall');
  await panel.waitForFunction(() => document.querySelector('#st')?.textContent.includes('完成：成功 2，失败 0'), null, { timeout: 25000 });
  await human.assert(maxBatch === 2, `收藏抓取并发峰值必须为 2（实测 ${maxBatch}）`);
  const names = fs.readdirSync(path.join(WS, '网页剪藏'));
  await human.assert(names.some(name => /W62b batch-1.*\.md$/.test(name)) && names.some(name => /W62b batch-2.*\.md$/.test(name)), '两件收藏必须分别落成 Markdown');
  await panel.screenshot({ path: path.join(SHOT_DIR, 'w62b-batch-queue.png') });
  await panel.close();
});

await scenario('当前网页一键生成 10 分钟局域网链接', async () => {
  await openBrowser(ORIGIN + '/image-page');
  await human.evaluate(() => window.MazzCommands.execute('browser.shareLocal'));
  await win.waitForSelector('.mazz-palette-mask input[readonly]', { timeout: 10000 });
  const url = await win.locator('.mazz-palette-mask input[readonly]').inputValue();
  const body = await (await fetch(url)).text();
  await human.assert(/^http:\/\/(?:10\.|192\.168\.|172\.|127\.)/.test(url), `必须返回局域网/回环 HTTP 链接（${url}）`);
  await human.assert(body.includes('/image-page') && body.includes('到期后链接自动失效'), `临时页面必须可访问并带当前页来源与到期声明（${body.slice(0, 80)}）`);
  await win.screenshot({ path: path.join(SHOT_DIR, 'w62b-lan-share.png') });
  await win.keyboard.press('Escape');
});

await scenario('异常警察·W62b 全程零主进程/渲染异常', async () => {
  await human.finish({ allow: ['ERR_ABORTED', 'net::ERR_FILE_NOT_FOUND', 'favicon'] });
});

const passed = results.filter(row => row[1] === 'PASS').length;
console.log(`W62b 实证批：${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
await app.close().catch(() => {});
await new Promise(resolve => server.close(resolve));
process.exit(process.exitCode || 0);
