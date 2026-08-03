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
await win.evaluate(() => window.MazzCommands?.execute('file.newViewer'));
await win.waitForTimeout(2000);
await win.evaluate(() => document.querySelector('[data-a=list]')?.click()).catch(() => {});
await win.waitForTimeout(600);
const g = await win.evaluate(() => { const r = document.querySelector('.mz-side-grip').getBoundingClientRect(); return { x: r.x + 2, y: r.y + 40 }; });
await win.mouse.move(g.x, g.y);
await win.mouse.down();
for (let i = 1; i <= 10; i++) await win.mouse.move(g.x - i * 140, g.y, { steps: 2 });
await win.mouse.up();
await win.waitForTimeout(700);
await win.screenshot({ path: '/mnt/agents/output/w58h-极限拖拽贴合.png' });
await app.close().catch(() => {});
console.log('DONE');
