import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
throw new Error('RETIRED_W87: pre-VisualComposition private _cloaked probe; use w71-overlay-zorder.mjs and w87-browser-composition-matrix.mjs');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2500);
for (let i = 0; i < 15; i++) { const n = await win.evaluate(() => document.querySelectorAll('.mazz-palette-mask').length); if (!n) break; await win.keyboard.press('Escape'); await win.waitForTimeout(250); }
await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(2000);
const r = await win.evaluate(async () => {
  const ctl = window.__activeBrowserCtl;
  const tab = ctl?.tabs?.find(t => t.id === ctl.activeId);
  const host = tab?.host;
  const r0 = host.getBoundingClientRect();
  const mk = (cls) => {
    const el = document.createElement('div');
    el.className = cls;
    el.style.cssText = 'position:fixed;left:50%;top:30%;width:300px;height:200px;transform:translateX(-50%);background:#334;z-index:99999';
    document.body.appendChild(el);
    return el;
  };
  const m = mk('mazz-menu');
  await new Promise(r => setTimeout(r, 400));
  const pts = [[r0.left + r0.width / 2, r0.top + 24], [r0.left + r0.width / 2, r0.top + r0.height / 2]];
  const stacks = pts.map(([x, y]) => document.elementsFromPoint(x, y).slice(0, 3).map(e => e.className || e.tagName));
  return { hostRect: { x: r0.left, y: r0.top, w: r0.width, h: r0.height }, winH: innerHeight, stacks, cloaked: ctl?._cloaked, throttle: 0 };
});
console.log(JSON.stringify(r, null, 1));
await app.close();
