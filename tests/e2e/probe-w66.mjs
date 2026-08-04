// tests/e2e/probe-w66.mjs —— W66 探针：真机路径复现（右键打包/面板开门/裁剪坐标）
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
fs.mkdirSync(WS + '/打包料', { recursive: true });
fs.writeFileSync(WS + '/打包料/a.txt', '甲');
fs.writeFileSync(WS + '/打包料/b.txt', '乙');

const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
win.on('console', m => console.log('[c]', m.text().slice(0, 160)));
win.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 240)));
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 15; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  const n = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length);
  if (!n) break; await win.keyboard.press('Escape'); await win.waitForTimeout(250);
}
await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));

// —— ① 右键「压缩为 zip」全真路径 ——
const nodeFound = await win.evaluate(() => {
  const n = [...document.querySelectorAll('.ft-node')].find(x => (x.dataset.path || '').endsWith('打包料'));
  if (!n) return false;
  const r = n.getBoundingClientRect();
  n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 40, clientY: r.y + 4 }));
  return true;
});
console.log('节点右键:', nodeFound, 'selected:', await win.evaluate(() => window.MazzShell?.fileTree?.selected?.path || 'NULL'));
await win.waitForTimeout(1400);
const ctx = app.windows().find(w => w.url().includes('/panels/ctxmenu.html'));
console.log('ctxmenu 开:', !!ctx);
if (ctx) {
  const items = await ctx.evaluate(() => [...document.querySelectorAll('.mi .t, .mi')].map(x => x.textContent.trim()));
  console.log('菜单项:', JSON.stringify(items));
  const picked = await ctx.evaluate(() => {
    for (const el of document.querySelectorAll('.mi')) {
      if (el.textContent.includes('压缩为 zip')) { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); return el.textContent.trim(); }
    }
    return null;
  });
  console.log('点选:', picked);
}
await win.waitForTimeout(2500);
const packResult = await win.evaluate(async (ws) => {
  const toasts = [...document.querySelectorAll('.mazz-toast, [class*=toast]')].map(t => t.textContent.slice(0, 80)).filter(Boolean);
  const z1 = await window.mazz.invoke('fs:stat', { path: ws + '/打包料.zip' }).then(s => s?.size || 0).catch(() => 0);
  const z2 = await window.mazz.invoke('fs:stat', { path: ws + '/打包料-1.zip' }).then(s => s?.size || 0).catch(() => 0);
  return { toasts, z1, z2, selNow: window.MazzShell?.fileTree?.selected?.path || 'NULL' };
}, WS);
console.log('打包结果:', JSON.stringify(packResult));

// —— ② 面板开门路径清点 ——
console.log('archive.view 命令在:', await win.evaluate(() => !!window.MazzCommands?.get?.('archive.view')));
console.log('dock 工具里搜 压缩/包:', await win.evaluate(() => {
  const cards = [...document.querySelectorAll('.w-ow-card, .sd-card, [class*=card]')].map(x => x.textContent.slice(0, 30));
  return cards.filter(t => t.includes('压缩') || t.includes('包')).slice(0, 6);
}));

await app.close().catch(() => {});
process.exit(0);
