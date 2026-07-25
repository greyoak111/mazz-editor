// tests/e2e/probe-fscut.mjs —— 探针：切歌强制退全屏（requestFullscreen 非手势拒绝实证）
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
// 再造两个音频文件让播放列表有下一条
fs.copyFileSync(WS + '/测试音.wav', WS + '/测试音2.wav');
fs.copyFileSync(WS + '/测试音.wav', WS + '/测试音3.wav');

const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' },
  timeout: 120000,
});
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2800);
for (let i = 0; i < 10; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  const masks = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length);
  if (!masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
}

await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/测试音.wav']);
await win.waitForTimeout(2200);

// F 全屏（真实按键）
await win.keyboard.press('f');
await win.waitForTimeout(700);
const fs1 = await win.evaluate(() => ({ el: document.fullscreenElement?.className || null }));
console.log('全屏后:', JSON.stringify(fs1));

// 埋点：监听 wasFs 恢复与 requestFullscreen 结果
await win.evaluate(() => {
  window.__fsLog = [];
  const orig = Element.prototype.requestFullscreen;
  Element.prototype.requestFullscreen = function (...a) {
    window.__fsLog.push('rFS:' + (this.className || this.tagName));
    return orig.apply(this, a).catch(e => { window.__fsLog.push('rFS-REJECT:' + e.message.slice(0, 40)); throw e; });
  };
  document.addEventListener('fullscreenchange', () => window.__fsLog.push('fsChange:' + (document.fullscreenElement?.className || 'null')));
});

// 模拟切歌（点"下一个"按钮）
await win.evaluate(() => { const b = [...document.querySelectorAll('[data-a=next]')].find(x => x.getBoundingClientRect().width > 0 || document.fullscreenElement); b?.click(); });
await win.waitForTimeout(2500);

const after = await win.evaluate(() => ({
  fsEl: document.fullscreenElement?.className || null,
  log: window.__fsLog,
}));
console.log('切歌后:', JSON.stringify(after, null, 1));
await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
