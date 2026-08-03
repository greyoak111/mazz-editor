import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import http from 'http';
import { seedFixtures } from './fixtures.mjs';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const srv = http.createServer((req, res) => { res.writeHead(200, {'Content-Type':'text/html'}); if (req.url === '/target') res.end('<html><body>T</body></html>'); else res.end('<html><body><a id="go" href="/target">GO</a></body></html>'); });
const port = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2500);
for (let i = 0; i < 15; i++) { const n = await win.evaluate(() => document.querySelectorAll('.mazz-palette-mask').length); if (!n) break; await win.keyboard.press('Escape'); await win.waitForTimeout(250); }
await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(1500);
const r = await win.evaluate(async (u) => {
  const ctl = window.__activeBrowserCtl;
  const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
  await window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
  await new Promise(r2 => setTimeout(r2, 1500));
  const probe = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "({go: !!document.getElementById('go'), ready: document.readyState, loc: location.pathname})" }).catch(e => 'ERR:' + e.message);
  const click = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "document.getElementById('go')?.click(); 'clicked'" }).catch(e => 'ERR:' + e.message);
  await new Promise(r2 => setTimeout(r2, 1000));
  const after = await window.mazz.invoke('bv:state', { tabId: t.viewId }).then(s => s?.url).catch(() => null);
  return { probe, click, after };
}, `http://127.0.0.1:${port}/page`);
console.log(JSON.stringify(r, null, 1));
srv.close(); await app.close();
