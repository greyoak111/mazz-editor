// tests/e2e/shot-w58e.mjs —— W58e 实证截图（新建文件子窗/设置 SVG/滚动条）
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
// ① 新建文件子窗（18 卡五组）
await win.evaluate(() => window.MazzCommands?.execute('fileTree.newFile'));
await win.waitForTimeout(2400);
const nf = app.windows().find(w => w.url().includes('/panels/newfile.html'));
if (nf) await nf.screenshot({ path: OUT + '/w58e-新建文件子窗.png' });
// ② 设置面板 SVG 五钮区（主题包行特写）
await win.evaluate(() => window.mazz.invoke('panel:open', { kind: 'settings' }).catch(() => {}));
await win.waitForTimeout(2400);
const st = app.windows().find(w => w.url().includes('/panels/settings.html'));
if (st) {
  await st.screenshot({ path: OUT + '/w58e-设置面板SVG.png' });
  // ③ 滚动条实证（内容顶出滚动条后拍右缘）
  await st.evaluate(() => { const el = document.querySelector('.body, .pwin'); if (el) el.scrollTop = 40; });
  await st.waitForTimeout(400);
  await st.screenshot({ path: OUT + '/w58e-滚动条统一.png' });
}
await app.close().catch(() => {});
console.log('SHOTS_DONE');
