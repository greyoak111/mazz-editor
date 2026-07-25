// tests/e2e/probe-fs.mjs —— 探针：播放器全屏快捷键失效根因实证
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);

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

// 打开 wav 播放器
await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/测试音.wav']);
await win.waitForTimeout(2200);

const probe = () => win.evaluate(() => {
  const fsEl = document.fullscreenElement;
  const pl = fsEl?.closest?.('.mz-player') || fsEl?.parentElement?.closest?.('.mz-player')
    || [...document.querySelectorAll('.mz-player')].find(p => p.getBoundingClientRect().width > 0)
    || (fsEl ? fsEl.parentElement : null);
  const v = (fsEl || document).querySelector?.('video, audio') || document.querySelector('video, audio');
  const anyPl = document.querySelector('.mz-player');
  return {
    found: !!pl,
    fsEl: !!fsEl,
    fsTag: fsEl?.className || '',
    rootRect: anyPl ? JSON.stringify(anyPl.getBoundingClientRect()) : 'none',
    muted: v?.muted,
  };
});

console.log('窗口态:', JSON.stringify(await probe()));
// 按 M（窗口态基线）
await win.keyboard.press('m');
await win.waitForTimeout(300);
console.log('窗口态按M后 muted:', JSON.stringify((await probe()).muted));
await win.keyboard.press('m'); // 还原
await win.waitForTimeout(200);

// F 全屏
await win.keyboard.press('f');
await win.waitForTimeout(800);
console.log('全屏态:', JSON.stringify(await probe()));
// 全屏按 M
await win.keyboard.press('m');
await win.waitForTimeout(300);
const after = await probe();
console.log('全屏按M后 muted:', JSON.stringify(after.muted), after.muted ? '✅ 快捷键活' : '❌ 快捷键死');

await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
