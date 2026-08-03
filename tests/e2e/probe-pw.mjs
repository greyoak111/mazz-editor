import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2500);
for (let i = 0; i < 15; i++) { const n = await win.evaluate(() => document.querySelectorAll('.mazz-palette-mask').length); if (!n) break; await win.keyboard.press('Escape'); await win.waitForTimeout(250); }
await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(1500);
import('http').then(() => {});
const http = await import('http');
const srv = http.createServer((req, res) => { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<html><body><form id="f" action="/done"><input name="user" value="mazz@test.com"><input type="password" value="TopS3cret"><button type="submit">登录</button></form></body></html>'); });
const port = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const r = await win.evaluate(async (u) => {
  const ctl = window.__activeBrowserCtl;
  const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
  if (!t) return { err: 'no tab', tabs: ctl?.tabs?.length };
  await window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(e => 'nav err:' + e);
  await new Promise(r => setTimeout(r, 1800));
  const st = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "({hook: !!window.__mzPwHook, form: !!document.querySelector('form'), loc: location.href.slice(0,30)})" }).catch(e => 'js err:' + e);
  // 监听主窗 bv:event 一网打尽
  window.__evts = [];
  window.mazz.on('bv:event', (p) => window.__evts.push(p?.type));
  // 控制台桥全监听（含 console-message 转流）
  window.__cm = [];
  window.mazz.on('bv:event', (p) => window.__cm.push(p?.type + ':' + JSON.stringify(p?.data).slice(0, 80)));
  await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "document.querySelector('form').requestSubmit()" }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  return { viewId: t.viewId, st, evts: window.__evts, cm: window.__cm, toasts: [...document.querySelectorAll('[class*=toast]')].map(e => e.textContent) };
}, `http://127.0.0.1:${port}/form.html`);
console.log(JSON.stringify(r, null, 1));
await app.close();
