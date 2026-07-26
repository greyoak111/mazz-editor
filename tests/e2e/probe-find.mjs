// tests/e2e/probe-find.mjs —— 探针：bv:find 查找链路直视
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

const srv = http.createServer((req, res) => res.end('<html><body><h1>乙页</h1><p>乙页内容乙页</p></body></html>'));
await new Promise(r => srv.listen(18925, '127.0.0.1', r));

const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' },
  timeout: 120000,
});
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 10; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  break;
}
await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(2500);
await win.evaluate(() => { const c = window.__activeBrowserCtl; c.addrEl.value = 'http://127.0.0.1:18925/b'; c.addrEl.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
await win.waitForTimeout(1800);
const u = await win.evaluate(async () => await window.__activeBrowserCtl.execJs(null, 'location.href + " | " + document.body.textContent.slice(0, 20)'));
console.log('落地:', u);
const r0 = await win.evaluate(async () => {
  const ctl = window.__activeBrowserCtl;
  const reqId = await window.mazz.invoke('bv:find', { tabId: ctl.activeId, text: '乙页' });
  return { reqId, activeId: ctl.activeId };
});
console.log('findInPage 调用:', JSON.stringify(r0));
for (const t of [500, 1200, 2500]) {
  await win.waitForTimeout(t === 500 ? 500 : t - (t === 1200 ? 500 : 1200));
  const cnt = await win.evaluate(() => document.querySelector('.br-find-count')?.textContent || '(空)');
  console.log(`t=${t}ms 计数:`, cnt);
}

srv.close();
await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
