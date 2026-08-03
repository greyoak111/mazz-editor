// tests/e2e/shot-w58g.mjs —— W58g 对比同框实证（主窗/子窗滚动条同款换色）
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
// 深主题（墨黑）显换色
await win.evaluate(() => window.MazzShell?.setTheme?.('ink'));
await win.waitForTimeout(1000);
// ① 主窗滚动条（文件树右缘特写）
await win.screenshot({ path: OUT + '/w58g-主窗滚动条-ink.png', clip: { x: 0, y: 200, width: 320, height: 500 } });
// ② 子窗滚动条（help 面板滚出轨后拍右缘）
await win.evaluate(() => window.mazz.invoke('panel:open', { kind: 'help' }).catch(() => {}));
await win.waitForTimeout(2400);
const pw = app.windows().find(w => w.url().includes('/panels/help.html'));
if (pw) {
  await pw.evaluate(() => { const el = document.querySelector('.ps-scroll') || document.querySelector('.body'); if (el) el.scrollTop = 80; });
  await pw.waitForTimeout(400);
  const r = await pw.evaluate(() => { const w = window.innerWidth, h = window.innerHeight; return { x: w - 260, y: 0, width: 260, height: Math.min(h, 560) }; });
  await pw.screenshot({ path: OUT + '/w58g-子窗滚动条-ink.png', clip: r });
}
await win.evaluate(() => window.MazzShell?.setTheme?.('paper'));
await app.close().catch(() => {});
console.log('SHOTS_DONE');
