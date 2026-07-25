// tests/e2e/probe-wheel.mjs —— 探针：全屏 ctrl+滚轮事件链密集诊断
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

await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/测试音.wav']);
await win.waitForTimeout(2200);

// 埋探针：root 上捕获/冒泡双相监听 + window 监听
await win.evaluate(() => {
  window.__probe = [];
  const pl = document.querySelector('.mz-player');
  pl.addEventListener('wheel', (e) => window.__probe.push(['root-bubble', e.ctrlKey, e.deltaY]), false);
  pl.addEventListener('wheel', (e) => window.__probe.push(['root-capture', e.ctrlKey, e.deltaY]), true);
  window.addEventListener('wheel', (e) => window.__probe.push(['window', e.ctrlKey, e.target.className?.slice?.(0, 20) || e.target.tagName]), true);
});

// 全屏
await win.evaluate(() => document.querySelector('.mz-stage').requestFullscreen());
await win.waitForTimeout(700);
console.log('全屏元素:', await win.evaluate(() => document.fullscreenElement?.className));

// 真实 ctrl+滚轮
const box = await win.evaluate(() => { const r = (document.fullscreenElement || document.querySelector('.mz-stage')).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await win.mouse.move(box.x, box.y);
await win.keyboard.down('Control');
await win.mouse.wheel(0, -240);
await win.keyboard.up('Control');
await win.waitForTimeout(500);

console.log('探针记录:', JSON.stringify(await win.evaluate(() => window.__probe)));
console.log('media transform:', await win.evaluate(() => document.querySelector('.mz-media')?.style.transform || '(空)'));
console.log('zoomFactor:', await win.evaluate(() => { const wv = document.querySelector('webview'); return 'n/a'; }));

await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
