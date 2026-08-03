import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import http from 'http';
import { seedFixtures } from './fixtures.mjs';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const srv = http.createServer((req, res) => { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<html><body style="margin:0"><div style="background:#d03030;height:120px;color:#fff;font-size:36px;padding:16px">红色头块</div><div style="background:#2060c0;height:400px;color:#fff;font-size:24px;padding:16px">蓝色底块</div></body></html>'); });
const port = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2500);
for (let i = 0; i < 15; i++) { const n = await win.evaluate(() => document.querySelectorAll('.mazz-palette-mask').length); if (!n) break; await win.keyboard.press('Escape'); await win.waitForTimeout(250); }
await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(1500);
await win.evaluate((u) => {
  const ctl = window.__activeBrowserCtl;
  const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
  if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
}, `http://127.0.0.1:${port}/page`);
await win.waitForTimeout(1500);
await win.evaluate(() => window.MazzCommands?.execute('annotate.toggle'));
await win.waitForTimeout(1200);
let anWin = null;
for (const w of app.windows()) if (w.url().includes('/panels/annotate.html')) { anWin = w; break; }
await anWin.mouse.move(300, 300);
await anWin.mouse.down();
await anWin.mouse.move(700, 500, { steps: 16 });
await anWin.mouse.move(400, 200, { steps: 8 });
await anWin.mouse.up();
await anWin.waitForTimeout(400);
const dataUrl = await anWin.evaluate(() => {
  const cv = document.getElementById('cv');
  const c2 = document.createElement('canvas');
  c2.width = cv.width; c2.height = cv.height;
  const x = c2.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c2.width, c2.height);
  x.drawImage(cv, 0, 0);
  return c2.toDataURL('image/png');
});
fs.writeFileSync('/mnt/agents/output/w52d-实证-墨迹画布.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('INKSHOT_SAVED');
srv.close(); await app.close();
