// tests/e2e/probe-bv.mjs —— 探针：视图导航历史直视（返回落 about:blank 的根因）
import { _electron as electron } from 'playwright';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);

const srv = http.createServer((req, res) => {
  if (req.url === '/a') res.end('<html><body><h1>甲</h1><a href="/b">b</a></body></html>');
  else if (req.url === '/b') res.end('<html><body><h1>乙</h1><a href="/r">r</a></body></html>');
  else if (req.url === '/r') { res.writeHead(302, { Location: '/c' }); res.end(); }
  else res.end('<html><body><h1>丙</h1></body></html>');
});
await new Promise(r => srv.listen(18924, '127.0.0.1', r));

const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' },
  timeout: 120000,
});
const win = await app.firstWindow();
win.on('console', (m) => console.log('[c]', m.text().slice(0, 120)));
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 10; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  break;
}

await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(2500);
const A = 'http://127.0.0.1:18924/a';
const dump = async (tag) => {
  const r = await win.evaluate(async () => {
    const ctl = window.__activeBrowserCtl;
    const h = await window.mazz.invoke('bv:navHistory', { tabId: ctl.activeId });
    return { active: ctl.activeId, url: ctl.activeTab()?.url, h: h ? { i: h.activeIndex, e: h.entries.map(x => x.url) } : null };
  });
  console.log(tag, JSON.stringify(r));
};

await win.evaluate((u) => { const c = window.__activeBrowserCtl; c.addrEl.value = u; c.addrEl.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, A);
await win.waitForTimeout(1600);
await dump('载A后:');
await win.evaluate(async () => { await window.__activeBrowserCtl.execJs(null, `document.querySelector('a').click()`); });
await win.waitForTimeout(1500);
await dump('点链B后:');
await win.evaluate(async () => { await window.__activeBrowserCtl.execJs(null, `document.querySelector('a').click()`); });
await win.waitForTimeout(1800);
await dump('302到C后:');
await win.evaluate(() => { [...document.querySelectorAll('[data-a=back]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
await win.waitForTimeout(1200);
await dump('返回1后:');


await win.evaluate(async () => { const id = window.__activeBrowserCtl.activeId; await window.mazz.invoke('bv:nav', { tabId: id, action: 'back' }); });
await win.waitForTimeout(800);
await dump('直调back 1次后:');
// goToOffset(-1) 现代 API 对照
await win.evaluate(async () => { const id = window.__activeBrowserCtl.activeId; await window.mazz.invoke('bv:nav', { tabId: id, action: 'forward' }); });
await win.waitForTimeout(700);
await win.evaluate(async () => { const id = window.__activeBrowserCtl.activeId; await window.mazz.invoke('bv:nav', { tabId: id, action: 'forward' }); });
await win.waitForTimeout(700);
await win.evaluate(async () => { const id = window.__activeBrowserCtl.activeId; await window.mazz.invoke('bv:nav', { tabId: id, action: 'forward' }); });
await win.waitForTimeout(900);
await dump('三次前进回C后:');
await win.evaluate(async () => { const id = window.__activeBrowserCtl.activeId; await window.mazz.invoke('bv:nav', { tabId: id, action: 'offset', url: -1 }); });
await win.waitForTimeout(800);
await dump('goToOffset(-1)后:');

srv.close();
await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });

// —— 追加：直调 bv:nav 绕开 historyNav，分离产品接线与 Chromium 行为 ——
