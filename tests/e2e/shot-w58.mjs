// tests/e2e/shot-w58.mjs —— W58 实证截图（军规⑤：语言按钮/ctxmenu/html预览/js终端）
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

// ① js 文件开进编辑器（ribbon 模块页=语言按钮位）
await win.evaluate(async (ws) => {
  const p = ws + '/演示.js';
  await window.mazz.invoke('fs:writeFile', { path: p, content: "console.log('MAZZ_SHOT_OK');\n" });
  await window.MazzShell?.openFile?.(p);
}, WS);
await win.waitForTimeout(1800);
await win.screenshot({ path: OUT + '/w58-语言按钮.png' });

// ② 语言 ctxmenu（B12 子窗格选择格）
await win.evaluate(() => document.getElementById('code-lang-btn')?.click());
await win.waitForTimeout(1200);
const ctx = app.windows().find(w => w.url().includes('/panels/ctxmenu.html'));
if (ctx) {
  const b = await ctx.evaluate(() => JSON.stringify(document.body.getBoundingClientRect()));
  await ctx.screenshot({ path: OUT + '/w58-语言ctxmenu.png' });
  console.log('ctx shot ok', b);
  await win.keyboard.press('Escape'); await win.waitForTimeout(400);
} else console.log('ctx window NOT FOUND');

// ③ js 直跑终端出字
await win.evaluate(() => window.MazzCommands?.execute('code.runFile'));
await win.waitForTimeout(4500);
await win.screenshot({ path: OUT + '/w58-js终端出字.png' });

// ④ html 预览（bv:capture 视图层直拍）
await win.evaluate(async (ws) => {
  const p = ws + '/演示页.html';
  await window.mazz.invoke('fs:writeFile', { path: p, content: '<html><body style="margin:0;background:linear-gradient(135deg,#1e293b,#312e81);color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font:32px sans-serif"><h1 id="w58mark">W58 预览 · html 直跑</h1></body></html>' });
  await window.MazzShell?.openFile?.(p);
}, WS);
await win.waitForTimeout(1500);
await win.evaluate(() => window.MazzCommands?.execute('code.runFile'));
await win.waitForTimeout(3500);
await win.screenshot({ path: OUT + '/w58-html预览-壳.png' });
const b64 = await win.evaluate(async () => {
  const bctl = window.__activeBrowserCtl;
  const t = bctl?.tabs?.find(x => x.id === bctl.activeId) || bctl?.tabs?.[0];
  return t ? await window.mazz.invoke('bv:capture', { tabId: t.viewId }).catch(() => null) : null;
});
if (b64) { fs.writeFileSync(OUT + '/w58-html预览-视图.png', Buffer.from(b64, 'base64')); console.log('view shot ok'); }
else console.log('view capture null');
await app.close().catch(() => {});
console.log('SHOTS_DONE');
