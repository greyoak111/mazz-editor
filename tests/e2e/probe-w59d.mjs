// tests/e2e/probe-w59d.mjs —— 59d 分屏宽度探针（一次性侦查）
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
fs.writeFileSync(WS + '/高塔.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2500"><rect width="800" height="1250" fill="#4a86e8"/><rect y="1250" width="800" height="1250" fill="#e84a3c"/></svg>`);
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
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/高塔.svg');
await win.waitForTimeout(2400);
const probe = (tag) => win.evaluate((t) => {
  const panes = [...document.querySelectorAll('.pane')].map(p => ({ w: Math.round(p.getBoundingClientRect().width), tabs: p.querySelectorAll('.pt-tab, .pane-tab, [class*=tab]').length }));
  const sh = window.MazzShell;
  return { t, panes, splitFn: typeof sh?.splitRight, tree: !!sh?.paneTree };
}, tag);
console.log(JSON.stringify(await probe('开图后')));
await win.evaluate(() => {
  const pt = window.MazzShell?.paneTree;
  const leaf = pt?.active;
  pt.split(leaf, 'row'); pt.setActive(leaf); pt.split(leaf, 'row'); pt.setActive(leaf);
});
await win.waitForTimeout(900);
console.log(JSON.stringify(await probe('原生分裂2')));
await win.evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
await win.waitForTimeout(2200);
console.log(JSON.stringify(await win.evaluate(() => {
  const s = document.querySelector('.ie-stage');
  const host = document.querySelector('.viewer-body');
  const v = document.querySelector('.ie-view');
  const ed = window.__activeViewerCtl?._imgEditor;
  const panes = [...document.querySelectorAll('.pane')].map(p => Math.round(p.getBoundingClientRect().width));
  return { panes, hostW: host?.clientWidth, stageClientW: s?.clientWidth, stageScrollW: s?.scrollWidth, viewStyleW: v?.style.width, viewOffsetW: v?.offsetWidth, scale: ed?._scale, local: ed?._localScale?.() };
})));
await app.close().catch(() => {});
process.exit(0);
