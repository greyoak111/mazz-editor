// tests/e2e/shot-w58f.mjs —— W58f 实证截图
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const ROOT = path.resolve('.');
const OUT = process.env.SHOT_DIR || '/mnt/agents/output';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
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
await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
// ① 播放器窗口态底栏常驻（等 3.2s 旧隐藏窗后拍）
await win.evaluate(() => window.MazzCommands?.execute('file.newViewer'));
await win.waitForTimeout(2000);
await win.evaluate(() => document.querySelector('[data-a=list]')?.click()).catch(() => {});
await win.waitForTimeout(3400);
await win.screenshot({ path: OUT + '/w58f-播放器底栏常驻.png' });
// ② 新建文件窗控归位+压窗内滚（外飘轨绝育）
await win.evaluate(() => window.MazzCommands?.execute('fileTree.newFile'));
await win.waitForTimeout(2200);
const nf = app.windows().find(w => w.url().includes('/panels/newfile.html'));
if (nf) {
  await nf.setViewportSize({ width: 560, height: 420 }).catch(() => {});
  await nf.waitForTimeout(600);
  await nf.evaluate(() => { const b = document.querySelector('.body'); if (b) b.scrollTop = 60; });
  await nf.waitForTimeout(400);
  await nf.screenshot({ path: OUT + '/w58f-新建文件归位内滚.png' });
}
await app.close().catch(() => {});
console.log('SHOTS_DONE');
