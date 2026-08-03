import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { Human } from './human.mjs';
import { seedFixtures } from './fixtures.mjs';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const WS2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws2-'));
await seedFixtures(WS, WS2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
const human = new Human(win);
await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳' });
await win.waitForTimeout(800);
await human.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
for (let i = 0; i < 20; i++) { const s = await human.evaluate(() => !!document.querySelector('#agree-accept')); if (s) { await human.click('#agree-accept').catch(()=>{}); await win.waitForTimeout(300); continue; } break; }
// 点 ribbon 更多
await human.evaluate(() => {
  const btn = [...document.querySelectorAll('.rb-more, [class*=more]')].find(b => b.getBoundingClientRect().width > 0);
  btn?.click();
});
let pw = null;
for (let i = 0; i < 20; i++) { await win.waitForTimeout(300); pw = app.windows().find(w => w.url().includes('/panels/ctxmenu.html')); if (pw) break; }
if (!pw) { console.log('FATAL: 更多子窗格未开'); process.exit(1); }
await win.waitForTimeout(800);
const st = await pw.evaluate(() => ({
  items: document.querySelectorAll('.mi').length,
  svgs: document.querySelectorAll('.mi svg').length,
  firstSvgSize: (() => { const s = document.querySelector('.mi svg'); const r = s?.getBoundingClientRect?.(); return r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '(无)'; })(),
}));
console.log('更多菜单:', JSON.stringify(st));
await pw.screenshot({ path: '/mnt/agents/output/w57b-更多-带svg.png' }).catch(() => {});
await app.close().catch(() => {});
