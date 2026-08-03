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
const r = await win.evaluate(async () => {
  const errs = [];
  try { window.addEventListener('error', (e) => errs.push(e.message)); } catch {}
  window.MazzCommands?.execute('file.newViewer');
  await new Promise(r => setTimeout(r, 1500));
  const ctl = window.__activeViewerCtl;
  return {
    errs,
    ctl: !!ctl, player: !!ctl?._player, mzRoot: !!document.querySelector('.mz-player'),
    empty: !!document.querySelector('.mz-empty'),
    bodyKids: ctl?.body?.children?.length,
    tabs: window.MazzShell?.tabs?.tabs?.map(t => ({ m: t.moduleId, title: t.title })),
  };
});
console.log(JSON.stringify(r, null, 1));
await app.close();
