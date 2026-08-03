// tests/e2e/probe-devtools-theme.mjs —— devtools 主题机制探活（哪把钥匙开哪把锁，不许猜）
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Human } from './human.mjs';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const WS2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws2-'));
await seedFixtures(WS, WS2);

const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' },
  timeout: 120000,
});
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
const human = new Human(win);
await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳初始化' });
await win.waitForTimeout(600);
await human.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
for (let i = 0; i < 20; i++) {
  const state = await human.evaluate(() => ({ agree: !!document.querySelector('#agree-accept') }));
  if (state.agree) { await human.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  break;
}

await human.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
await win.waitForTimeout(1500);
await human.evaluate(async () => {
  const ctl = window.__activeBrowserCtl;
  const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
  if (t) window.mazz.invoke('bv:devtools', { tabId: t.viewId }).catch(() => {});
});
let dtWin = null;
for (let i = 0; i < 30; i++) {
  await win.waitForTimeout(300);
  dtWin = app.windows().find(w => w.url().startsWith('devtools://')) || null;
  if (dtWin) break;
}
if (!dtWin) { console.log('FATAL: devtools 未开'); process.exit(1); }
await win.waitForTimeout(2500);

const dump = await dtWin.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    out[k] = (localStorage.getItem(k) || '').slice(0, 300);
  }
  return out;
});
console.log('=== devtools localStorage 全键 ===');
for (const [k, v] of Object.entries(dump)) console.log(`${k} = ${v}`);

// 实验：devtoolsPreferences 里改 uiTheme → reload → 界面是否转 dark（Computed background 实证）
await dtWin.evaluate(() => {
  const raw = localStorage.getItem('devtoolsPreferences');
  let obj = {};
  try { obj = JSON.parse(raw || '{}'); } catch {}
  obj.uiTheme = '"dark"';
  localStorage.setItem('devtoolsPreferences', JSON.stringify(obj));
  localStorage.setItem('uiTheme', '"dark"');
});
await win.waitForTimeout(400);
await dtWin.evaluate(() => location.reload());
await win.waitForTimeout(3000);
const bgProbe = await dtWin.evaluate(() => {
  const bg = getComputedStyle(document.body).backgroundColor;
  return { bg, uiTheme: localStorage.getItem('uiTheme'), pref: (localStorage.getItem('devtoolsPreferences') || '').slice(0, 200) };
});
console.log('=== 实验后 ===', JSON.stringify(bgProbe));
await dtWin.screenshot({ path: '/mnt/agents/output/probe-devtools-dark.png' }).catch(() => {});
await app.close().catch(() => {});
