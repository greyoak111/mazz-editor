// tests/e2e/shot-w59c.mjs —— 59c 军规⑤取证：高图滚动条/贴底自滚/50%缩放选框贴手
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const ROOT = path.resolve('.');
const OUT = process.env.SHOT_DIR || '/mnt/agents/output';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
fs.writeFileSync(WS + '/高塔.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2500"><rect width="800" height="1250" fill="#4a86e8"/><rect y="1250" width="800" height="1250" fill="#e84a3c"/><circle cx="400" cy="2300" r="120" fill="#f3f3f3"/></svg>`);
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 15; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  const n = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length);
  if (!n) break; await win.keyboard.press('Escape'); await win.waitForTimeout(250);
}
// ① 高图编辑态：纵向滚动条在场
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/高塔.svg');
await win.waitForTimeout(2600);
await win.evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
await win.waitForTimeout(2000);
await win.screenshot({ path: OUT + '/59c-高图编辑态滚动条.png' });
// ② 裁剪贴底沿自滚中（按住不松定格）
await win.evaluate(() => document.querySelector('[data-t=crop]')?.click());
await win.waitForTimeout(500);
const geo = await win.evaluate(() => ({ vr: document.querySelector('.ie-view').getBoundingClientRect().toJSON(), sr: document.querySelector('.ie-stage').getBoundingClientRect().toJSON() }));
await win.mouse.move(geo.vr.left + geo.vr.width / 2, Math.min(geo.vr.top + 200, geo.sr.bottom - 260));
await win.mouse.down();
await win.mouse.move(geo.vr.left + geo.vr.width / 2 + 120, geo.sr.bottom - 12, { steps: 14 });
await win.waitForTimeout(400);
await win.screenshot({ path: OUT + '/59c-贴底沿自滚.png' });
await win.mouse.up();
await win.evaluate(() => { const ed = window.__activeViewerCtl?._imgEditor; if (ed && ed.mode !== 'normal') ed._setMode('normal'); });
// ③ 全局 50%：选框贴手
await win.evaluate(() => window.MazzShell?.setZoom?.(0.5));
await win.waitForTimeout(700);
await win.evaluate(() => { document.querySelector('.ie-stage').scrollTop = 0; });
await win.evaluate(() => { const ed = window.__activeViewerCtl?._imgEditor; if (ed && ed.mode !== 'cropping') document.querySelector('[data-t=crop]')?.click(); });
await win.waitForTimeout(500);
const r2 = await win.evaluate(() => document.querySelector('.ie-view').getBoundingClientRect().toJSON());
await win.mouse.move(r2.left + 60, r2.top + 200);
await win.mouse.down();
await win.mouse.move(r2.left + 200, r2.top + 360, { steps: 10 });
await win.screenshot({ path: OUT + '/59c-全局50选框贴手.png' });
await win.mouse.up();
await app.close().catch(() => {});
console.log('SHOTS_DONE');
