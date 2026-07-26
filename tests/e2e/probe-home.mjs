// tests/e2e/probe-home.mjs —— 探针：主页渲染时刻与视图状态直视
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);

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
const dump = async (tag) => {
  const r = await win.evaluate(async () => {
    const ctl = window.__activeBrowserCtl;
    if (!ctl) return { no: 'ctl' };
    const st = await window.mazz.invoke('bv:state', { tabId: ctl.activeId }).catch(e => ({ err: e.message }));
    const len = await ctl.execJs(null, 'document.documentElement.outerHTML.length').catch(() => -2);
    const txt = await ctl.execJs(null, 'document.body ? document.body.textContent.slice(0, 40) : "no-body"').catch(() => -2);
    const homeLoaded = ctl.activeTab()?.homeLoaded;
    const navQ = !!ctl.activeTab()?.navQueue;
    return { st, len, txt, homeLoaded, navQ, tabUrl: ctl.activeTab()?.url };
  });
  console.log(tag, JSON.stringify(r));
};

await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(600);
await dump('600ms:');
await win.waitForTimeout(1800);
await dump('2.4s:');
await win.evaluate(() => window.MazzCommands.execute('browser.newTab'));
await win.waitForTimeout(900);
await dump('开bt-2后:');
await win.evaluate(() => { const btns = [...document.querySelectorAll('.br-tab-close')]; btns[btns.length - 1]?.click(); });
await win.waitForTimeout(600);
await dump('关bt-2回bt-1:');

await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
