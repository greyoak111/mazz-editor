// tests/e2e/shot-w59e.mjs —— 59e 军规⑤取证：编辑态 Ctrl+滚轮缩图片（编辑栏纹丝不动）
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
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/高塔.svg');
await win.waitForTimeout(2400);
await win.evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
await win.waitForTimeout(2200);
// ① 缩放前（适配态）
await win.screenshot({ path: OUT + '/59e-Ctrl滚轮缩放前.png' });
// ② Ctrl+滚轮连放三级：图片胀出溢出条，编辑栏原尺寸
const geo = await win.evaluate(() => document.querySelector('.ie-stage').getBoundingClientRect().toJSON());
await win.keyboard.down('Control');
await win.mouse.move(geo.left + geo.width / 2, geo.top + geo.height / 2);
for (let i = 0; i < 3; i++) { await win.mouse.wheel(0, -120); await win.waitForTimeout(280); }
await win.keyboard.up('Control');
await win.waitForTimeout(500);
await win.screenshot({ path: OUT + '/59e-Ctrl滚轮缩放后.png' });
await app.close().catch(() => {});
console.log('SHOTS_DONE');
