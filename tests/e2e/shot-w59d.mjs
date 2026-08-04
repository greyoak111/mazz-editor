// tests/e2e/shot-w59d.mjs —— 59d 军规⑤取证：查看态纵/横滚动条、编辑态窄分屏双轴条
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const ROOT = path.resolve('.');
const OUT = process.env.SHOT_DIR || '/mnt/agents/output';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
fs.writeFileSync(WS + '/高塔.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2500"><rect width="800" height="1250" fill="#4a86e8"/><rect y="1250" width="800" height="1250" fill="#e84a3c"/><circle cx="400" cy="2300" r="120" fill="#f3f3f3"/></svg>`);
fs.writeFileSync(WS + '/宽幕.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="800"><rect width="1250" height="800" fill="#3d85c6"/><rect x="1250" width="1250" height="800" fill="#e8a33c"/></svg>`);
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
// ① 查看态高图纵条（原尺寸+滚到中段落定）
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/高塔.svg');
await win.waitForTimeout(2400);
await win.evaluate(() => document.querySelector('[data-a=actual]')?.click());
await win.waitForTimeout(700);
await win.evaluate(() => { document.querySelector('.viewer-body').scrollTop = 700; });
await win.waitForTimeout(400);
await win.screenshot({ path: OUT + '/59d-查看态纵向滚动条.png' });
// ② 查看态宽幕横条（滚到右段落定）
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/宽幕.svg');
await win.waitForTimeout(2400);
await win.evaluate(() => document.querySelector('[data-a=actual]')?.click());
await win.waitForTimeout(700);
await win.evaluate(() => { document.querySelector('.viewer-body').scrollLeft = 900; });
await win.waitForTimeout(400);
await win.screenshot({ path: OUT + '/59d-查看态横向滚动条.png' });
// ③ 编辑态窄分屏双轴条
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/高塔.svg');
await win.waitForTimeout(2400);
await win.evaluate(() => {
  const pt = window.MazzShell?.paneTree;
  const leaf = pt?.active;
  pt.split(leaf, 'row'); pt.setActive(leaf); pt.split(leaf, 'row'); pt.setActive(leaf);
});
await win.waitForTimeout(900);
await win.evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
await win.waitForTimeout(2200);
await win.evaluate(() => { const s = document.querySelector('.ie-stage'); s.scrollTop = 300; s.scrollLeft = 30; });
await win.waitForTimeout(400);
await win.screenshot({ path: OUT + '/59d-编辑态双轴滚动条.png' });
await app.close().catch(() => {});
console.log('SHOTS_DONE');
