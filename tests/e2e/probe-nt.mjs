import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { Human } from './human.mjs';
import { seedFixtures } from './fixtures.mjs';
const ROOT = '.';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const WS2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws2-'));
await seedFixtures(WS, WS2);
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
const human = new Human(win);
await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳' });
await win.waitForTimeout(800);
await human.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
for (let i = 0; i < 20; i++) { const s = await human.evaluate(() => !!document.querySelector('#agree-accept')); if (s) { await human.click('#agree-accept').catch(()=>{}); await win.waitForTimeout(300); continue; } break; }
const probe = async (label) => {
  const dark = await human.evaluate(() => window.mazz.invoke('theme:isDark').catch(() => '(err)'));
  const mm = await human.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  console.log(`${label}: shouldUseDarkColors=${dark} matchMediaDark=${mm}`);
};
await probe('初始(paper)');
await human.evaluate(() => window.MazzShell?.setTheme?.('ink'));
await win.waitForTimeout(800);
await probe('换 ink 后');
// 开 devtools 看皮
await human.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器' });
await win.waitForTimeout(1200);
await human.evaluate(async () => { const ctl = window.__activeBrowserCtl; const t = ctl?.tabs?.[0]; if (t) window.mazz.invoke('bv:devtools', { tabId: t.viewId }).catch(() => {}); });
let dt = null;
for (let i = 0; i < 30; i++) { await win.waitForTimeout(300); dt = app.windows().find(w => w.url().startsWith('devtools://')) || null; if (dt) break; }
await win.waitForTimeout(2500);
if (dt) {
  const bg = await dt.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const mmDt = await dt.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  console.log(`devtools 皮=${bg} devtools内matchMediaDark=${mmDt}`);
}
await app.close().catch(() => {});
