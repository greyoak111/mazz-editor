// tests/e2e/shot-w59.mjs —— W59 实证截图
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const ROOT = path.resolve('.');
const OUT = process.env.SHOT_DIR || '/mnt/agents/output';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
fs.writeFileSync(WS + '/四色.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="240" height="160" fill="#e84a3c"/><rect x="240" width="240" height="160" fill="#4a86e8"/><rect y="160" width="240" height="160" fill="#3d85c6"/><rect x="240" y="160" width="240" height="160" fill="#f3f3f3"/><text x="240" y="170" font-size="42" fill="#fff" text-anchor="middle" font-family="sans-serif">W59 图片编辑</text><text x="240" y="220" font-size="22" fill="#fff" text-anchor="middle" font-family="sans-serif">裁剪·网格·变换·滤镜·绘画·取色·副本·撤销</text></svg>`);
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
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/四色.svg');
await win.waitForTimeout(2600);
await win.evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
await win.waitForTimeout(2200);
await win.screenshot({ path: OUT + '/w59-编辑模式全景.png' });
// 裁剪选框态
await win.evaluate(() => document.querySelector('[data-t=crop]')?.click());
await win.waitForTimeout(400);
const rect = await win.evaluate(() => document.querySelector('.ie-view').getBoundingClientRect().toJSON());
const sc = await win.evaluate(() => window.__activeViewerCtl?._imgEditor?._scale || 1);
await win.mouse.move(rect.left + 40 * sc, rect.top + 40 * sc);
await win.mouse.down();
await win.mouse.move(rect.left + 400 * sc, rect.top + 240 * sc, { steps: 10 });
await win.screenshot({ path: OUT + '/w59-裁剪选框.png' });
await win.mouse.up();
await app.close().catch(() => {});
console.log('SHOTS_DONE');
