// tests/e2e/shot-w58b.mjs —— W58b 实证截图
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
import zlib from 'zlib';
const ROOT = path.resolve('.');
const OUT = process.env.SHOT_DIR || '/mnt/agents/output';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const JSZip = (await import(path.resolve('node_modules/jszip/dist/jszip.min.js'))).default;
const z = new JSZip();
z.file('中文名测试档.txt', 'GBK 修复实证正文');
z.file('压缩包内.md', '# 包内文档');
z.file('src/main.js', 'console.log(1)');
fs.writeFileSync(WS + '/示例压缩包.zip', await z.generateAsync({ type: 'nodebuffer' }));
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
// ① 压缩包面板（列表）
await win.evaluate((p) => {
  window.mazz.invoke('panel:action', { type: 'archiveStash', path: p }).catch(() => {});
  window.mazz.invoke('panel:open', { kind: 'archive' }).catch(() => {});
}, WS + '/示例压缩包.zip');
await win.waitForTimeout(2600);
const pw = app.windows().find(w => w.url().includes('/panels/archive.html'));
if (pw) await pw.screenshot({ path: OUT + '/w58b-压缩包面板.png' });
// ② 树右键菜单（ctxmenu 压缩包族）
await win.evaluate(() => {
  const n = [...document.querySelectorAll('.ft-node')].find(x => (x.dataset.path || '').endsWith('示例压缩包.zip'));
  if (n) { const r = n.getBoundingClientRect(); n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 40, clientY: r.y + 4 })); }
});
await win.waitForTimeout(1500);
const ctx = app.windows().find(w => w.url().includes('/panels/ctxmenu.html'));
if (ctx) await ctx.screenshot({ path: OUT + '/w58b-右键菜单.png' });
await app.close().catch(() => {});
console.log('SHOTS_DONE');
