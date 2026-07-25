// tests/e2e/probe-ghost.mjs —— 探针：分屏后"神秘框框"真身（dump 全部 fixed/absolute 定位元素）
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
fs.writeFileSync(WS + '/甲.md', '# 甲\n');

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

// 开两个 tab（表格+文档），拖表格 tab 到右区分屏
await win.evaluate(() => window.MazzCommands?.execute('file.newSheet'));
await win.waitForTimeout(1500);
await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/甲.md']);
await win.waitForTimeout(800);

const tabBox = await win.evaluate(() => {
  const t = [...document.querySelectorAll('.tab')].find(x => x.textContent.includes('mazzsheet'));
  const r = t?.getBoundingClientRect();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
});
const pane = await win.evaluate(() => { const r = document.querySelector('.pane').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });

await win.mouse.move(tabBox.x, tabBox.y);
await win.mouse.down();
await win.mouse.move(pane.x + pane.w * 0.5, pane.y + pane.h * 0.5, { steps: 10 });
await win.mouse.move(pane.x + pane.w * 0.85, pane.y + pane.h * 0.5, { steps: 10 });
await win.waitForTimeout(400);
await win.mouse.up();
await win.waitForTimeout(1200);
await win.screenshot({ path: 'tests/e2e/shots/probe-ghost-split.png' });

const dump = await win.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 10) continue;
    if (r.width > 1400 && r.height > 900) continue; // 全屏 backdrop 跳过
    out.push({
      tag: el.tagName + '.' + String(el.className).replace(/ /g, '.'),
      pos: cs.position, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      z: cs.zIndex, text: (el.textContent || '').trim().slice(0, 40),
    });
  }
  return out;
});
console.log('fixed/absolute 元素：', JSON.stringify(dump, null, 1));
await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
