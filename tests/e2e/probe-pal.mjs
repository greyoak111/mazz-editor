import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2500);
for (let i = 0; i < 15; i++) { const n = await win.evaluate(() => document.querySelectorAll('.mazz-palette-mask').length); if (!n) break; await win.keyboard.press('Escape'); await win.waitForTimeout(250); }
// 模拟 run5 场景：先开一个 markdown 编辑页（Monaco 抢焦）
await win.evaluate(() => window.MazzHost?.openTab('markdown', { title: 'x.md', content: '# t\nabc' }));
await win.waitForTimeout(800);
const r = await win.evaluate(async () => {
  await window.MazzCommands.execute('app.commandPalette');
  await new Promise(r2 => setTimeout(r2, 1500));
  const panels = [];
  return { invoked: true };
});
await win.waitForTimeout(1500);
const wins = app.windows().map(w => w.url());
const r2 = await win.evaluate(() => window.mazz.invoke('panel:open', { kind: 'palette' }).then(x => x).catch(e => 'ERR:' + e.message));
console.log(JSON.stringify({ wins, directInvoke: r2 }, null, 1));
await app.close();
