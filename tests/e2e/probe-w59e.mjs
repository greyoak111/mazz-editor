// tests/e2e/probe-w59e.mjs —— 59e 双触发探针（一次性侦查）
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
await win.evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
await win.waitForTimeout(2200);
await win.evaluate(() => {
  const ed = window.__activeViewerCtl?._imgEditor;
  window.__wheelLog = [];
  const orig = ed._zoomBy.bind(ed);
  ed._zoomBy = (f, ev) => { window.__wheelLog.push(['zoomBy', f, ev?.deltaY, ev?.ctrlKey]); orig(f, ev); };
  ed.stage.addEventListener('wheel', (e) => window.__wheelLog.push(['stageWheel', e.deltaY, e.ctrlKey, e.defaultPrevented]), { capture: true });
  const ols = ed._localScale.bind(ed);
  ed._localScale = () => { const r = ols(); window.__wheelLog.push(['localScale', r, ed.view.offsetWidth, ed.view.style.width]); return r; };
  const ocr = ed._cropRender.bind(ed);
  ed._cropRender = (a, b) => { window.__wheelLog.push(['cropRender', JSON.stringify(a), JSON.stringify(b)]); const w = Math.abs(a.x - b.x) * ed._localScale(); window.__wheelLog.push(['expectW', w]); ocr(a, b); window.__wheelLog.push(['cropElAfter', ed.cropEl.style.width, 'sameEl', ed.cropEl === document.querySelector('.ie-crop'), 'cropCount', document.querySelectorAll('.ie-crop').length, 'rootCount', document.querySelectorAll('.ie-root').length]); };
});
const geo = await win.evaluate(() => document.querySelector('.ie-stage').getBoundingClientRect().toJSON());
await win.keyboard.down('Control');
await win.mouse.move(geo.left + geo.width / 2, geo.top + geo.height / 2);
await win.mouse.wheel(0, -120);
await win.keyboard.up('Control');
await win.waitForTimeout(500);
console.log(JSON.stringify(await win.evaluate(() => ({
  log: window.__wheelLog,
  uz: window.__activeViewerCtl?._imgEditor?.userZoom,
  viewOW: document.querySelector('.ie-view').offsetWidth,
  viewStyleW: document.querySelector('.ie-view').style.width,
  scale: window.__activeViewerCtl?._imgEditor?._scale,
}))));
// 第二轮：拖选区后再滚一次
await win.evaluate(() => { document.querySelector('.ie-stage').scrollTop = 0; document.querySelector('[data-t=crop]')?.click(); });
await win.waitForTimeout(400);
const r2 = await win.evaluate(() => document.querySelector('.ie-view').getBoundingClientRect().toJSON());
await win.mouse.move(r2.left + 100, r2.top + 100);
await win.mouse.down();
await win.mouse.move(r2.left + 300, r2.top + 260, { steps: 8 });
await win.mouse.up();
await win.waitForTimeout(400);
console.log('c0=' + JSON.stringify(await win.evaluate(() => ({
  uz: window.__activeViewerCtl?._imgEditor?.userZoom,
  viewOW: document.querySelector('.ie-view').offsetWidth,
  cropElW: document.querySelector('.ie-crop').style.width,
}))));
await win.keyboard.down('Control');
await win.mouse.move(r2.left + 400, r2.top + 200);
await win.mouse.wheel(0, -120);
await win.keyboard.up('Control');
await win.waitForTimeout(500);
console.log('c1=' + JSON.stringify(await win.evaluate(() => ({
  log: window.__wheelLog.slice(-4),
  uz: window.__activeViewerCtl?._imgEditor?.userZoom,
  viewOW: document.querySelector('.ie-view').offsetWidth,
  viewStyleW: document.querySelector('.ie-view').style.width,
  cropElW: document.querySelector('.ie-crop').style.width,
  cropElRectW: Math.round(document.querySelector('.ie-crop').getBoundingClientRect().width),
}))));
await app.close().catch(() => {});
process.exit(0);
