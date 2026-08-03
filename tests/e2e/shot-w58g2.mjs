import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const ROOT = path.resolve('.');
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
await win.evaluate(() => window.MazzShell?.setTheme?.('ink'));
await win.waitForTimeout(900);
for (let i = 0; i < 60; i++) fs.writeFileSync(WS + `/填充文件${String(i).padStart(2, '0')}.md`, '# 填充\n');
await win.waitForTimeout(1500);
await win.waitForTimeout(2200);
await win.evaluate(() => { const s = document.querySelector('.ProseMirror')?.parentElement || document.querySelector('[class*=editor]'); if (s) s.scrollTop = 200; });
await win.waitForTimeout(500);
await win.waitForTimeout(600);
await win.screenshot({ path: '/mnt/agents/output/w58g-主窗滚动条-ink.png', clip: { x: 0, y: 250, width: 245, height: 560 } });
await app.close().catch(() => {});
console.log('DONE');
