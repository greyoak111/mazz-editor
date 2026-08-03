// tests/e2e/probe-home-cap.mjs —— 主页抓帧实测探针（阈值不拍脑袋，先探活）
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
  const state = await human.evaluate(() => {
    const masks = [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0);
    const acc = document.querySelector('#agree-accept');
    return { masks: masks.length, agree: !!acc };
  });
  if (state.agree) { await human.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  if (state.masks === 0) break;
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
}

await human.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
await win.waitForTimeout(2500);

const probe = async (label) => {
  const r = await human.evaluate(async () => {
    const ctl = window.__activeBrowserCtl;
    const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
    if (!t) return { len: 0, url: '(无标签)' };
    const b64 = await window.mazz.invoke('bv:capture', { tabId: t.viewId }).catch(() => null);
    const st = await window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null);
    return { len: b64?.length || 0, url: st?.url, bounds: st?.bounds, hidden: st?.hidden, b64: b64 || '' };
  });
  console.log(`${label}: base64 长=${r.len} url=${r.url} bounds=${JSON.stringify(r.bounds)} hidden=${r.hidden}`);
  if (r.b64) fs.writeFileSync(`/mnt/agents/output/probe-home-${label}.png`, Buffer.from(r.b64, 'base64'));
  return r.len;
};

await probe('主页打开');
await human.evaluate(() => window.MazzCommands?.execute('browser.navReload'));
await win.waitForTimeout(1500);
await probe('命令刷新后');
// 全白对照：直接导航 about:blank 抓一帧
await human.evaluate(async () => {
  const ctl = window.__activeBrowserCtl;
  const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
  if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: 'about:blank' }).catch(() => {});
});
await win.waitForTimeout(800);
await probe('全白对照');

await app.close().catch(() => {});
