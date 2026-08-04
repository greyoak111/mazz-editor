import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const ROOT = path.resolve('.');
const OUT = process.env.SHOT_DIR || '/mnt/agents/output';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
fs.writeFileSync(WS + '/四色.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="400" height="250" fill="#e84a3c"/><rect x="400" width="400" height="250" fill="#4a86e8"/><rect y="250" width="400" height="250" fill="#3d85c6"/><rect x="400" y="250" width="400" height="250" fill="#f3f3f3"/></svg>`);
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
// ① 裁剪贴图（拖已知框）
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/四色.svg');
await win.waitForTimeout(2600);
await win.evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
await win.waitForTimeout(2000);
await win.evaluate(() => document.querySelector('[data-t=crop]')?.click());
await win.waitForTimeout(500);
const rect = await win.evaluate(() => document.querySelector('.ie-view').getBoundingClientRect().toJSON());
await win.mouse.move(rect.left + 80, rect.top + 60);
await win.mouse.down();
await win.mouse.move(rect.left + 620, rect.top + 400, { steps: 12 });
await win.screenshot({ path: OUT + '/w66-裁剪贴合.png' });
await win.mouse.up();
// ② 坞卡（压缩包 SVG 卡）
await win.evaluate(() => { const sb = document.querySelector('.sidebar'); if (sb) sb.scrollTo(0, sb.scrollHeight); });
await win.waitForTimeout(500);
await win.screenshot({ path: OUT + '/w66-坞卡压缩包.png' });
// ③ 面板空态开门
await win.evaluate(() => { const c = [...document.querySelectorAll('.sd-tool-card, .w-ow-card')].find(x => x.textContent.includes('压缩包')); c?.click(); });
await win.waitForTimeout(2200);
const pw = app.windows().find(w => w.url().includes('/panels/archive.html'));
if (pw) await pw.screenshot({ path: OUT + '/w66-面板空态开门.png' });
await app.close().catch(() => {});
console.log('SHOTS_DONE');
