import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import http from 'http';
import { seedFixtures } from './fixtures.mjs';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const srv = http.createServer((req, res) => { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<html><body><form id="f" action="/done"><input name="user" value=""><input type="password" value=""><button type="submit">登录</button></form></body></html>'); });
const port = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2500);
for (let i = 0; i < 15; i++) { const n = await win.evaluate(() => document.querySelectorAll('.mazz-palette-mask').length); if (!n) break; await win.keyboard.press('Escape'); await win.waitForTimeout(250); }
await win.evaluate(() => window.mazz.invoke('pw:save', { entry: { site: '127.0.0.1', username: 'mazz@test.com', password: 'OldPass123' } }));
await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(2000);
const r = await win.evaluate(async (u) => {
  const ctl = window.__activeBrowserCtl;
  const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
  window.__cm = [];
  window.mazz.on('bv:event', (p) => { if (p?.type === 'console-message') window.__cm.push(JSON.stringify(p?.data).slice(0, 60)); });
  await window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
  await new Promise(r => setTimeout(r, 6000));
  const st = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "({hook: !!window.__mzPwHook, u: document.querySelector('[name=user]')?.value, p: document.querySelector('[type=password]')?.value, loc: location.hostname})" });
  const list = await window.mazz.invoke('pw:list').catch(() => []);
  const manual = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: `(function(){
    var pw = document.querySelector('input[type=password]');
    if (!pw || pw.value) return 'skip';
    var scope = pw.closest('form') || document;
    var user = scope.querySelector('input[type=email],input[type=tel],input[name*=user i],input[name*=account i],input[name*=login i],input[name*=mail i],input[type=text],input:not([type])');
    function setVal(el, v) { el.focus(); el.value = v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
    if (user && !user.value) setVal(user, "mazz@test.com");
    setVal(pw, "OldPass123");
    return 'ok';
  })();` }).catch(e => 'err:' + e);
  const after = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "({u: document.querySelector('[name=user]')?.value, p: document.querySelector('[type=password]')?.value})" });
  return { st, listN: list.length, listSite: list[0]?.site, manual, after, cm: window.__cm };
}, `http://127.0.0.1:${port}/login`);
console.log(JSON.stringify(r, null, 1));
srv.close(); await app.close();
