// tests/e2e/shot-w58c.mjs —— W58c 实证截图（军规⑤：自定义主题子窗/B12b 按钮/播放器栏）
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

// ① 自定义主题包 + 设置子窗（深蓝 #123456——旧版透明化平反实证）
await win.evaluate(async (ws) => {
  await window.mazz.invoke('fs:mkdir', { path: ws + '/themes' }).catch(() => {});
  await window.mazz.invoke('fs:writeFile', {
    path: ws + '/themes/w58c测.json',
    content: JSON.stringify({ name: 'W58C测', base: 'paper', vars: { bg: '#123456', fg: '#eeeeee', 'bg-elev': '#1e4a70', 'bg-hover': '#27567f', 'bg-active': '#2f6490', border: '#2a5a80', accent: '#6ab3f0', 'accent-soft': '#1e4a70', 'fg-dim': '#a8c4dd' } }),
  });
}, WS);
await win.waitForTimeout(400);
await win.evaluate(() => window.MazzShell?.setTheme?.('pack:w58c测'));
await win.waitForTimeout(1200);
await win.evaluate(() => window.mazz.invoke('panel:open', { kind: 'settings' }).catch(() => {}));
await win.waitForTimeout(2200);
const pw = app.windows().find(w => w.url().includes('/panels/settings.html'));
if (pw) await pw.screenshot({ path: OUT + '/w58c-自定义主题-设置子窗.png' });
await win.screenshot({ path: OUT + '/w58c-自定义主题-主窗.png' });

// ② B12b 工作区切换器按钮+ctxmenu（主题换回纸白再拍）
await pw?.close().catch(() => {});
await win.evaluate(() => window.MazzShell?.setTheme?.('paper'));
await win.waitForTimeout(800);
await win.evaluate(() => document.querySelector('.sb-ws-btn')?.click());
await win.waitForTimeout(1500);
const ctx = app.windows().find(w => w.url().includes('/panels/ctxmenu.html'));
if (ctx) await ctx.screenshot({ path: OUT + '/w58c-切换器-ctxmenu.png' });
await win.keyboard.press('Escape'); await win.waitForTimeout(400);
await win.screenshot({ path: OUT + '/w58c-切换器按钮-侧栏.png' });

// ③ 播放器栏全组件+倍速按钮（裁底部控制条区）
await win.evaluate(() => window.MazzCommands?.execute('file.newViewer'));
await win.waitForTimeout(1600);
const clip = await win.evaluate(() => {
  const c = document.querySelector('.mz-controls')?.getBoundingClientRect();
  return c ? { x: Math.max(0, c.x - 6), y: c.y - 6, width: Math.min(c.width + 12, 1400), height: c.height + 12 } : null;
});
await win.screenshot({ path: OUT + '/w58c-播放器栏.png', ...(clip ? { clip } : {}) });
await app.close().catch(() => {});
console.log('SHOTS_DONE');
