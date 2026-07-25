// tests/e2e/probe-drag.mjs —— 探针：真实拖拽 tab 到窗格右区，悬停截图看分屏预览真容 + 松手后查残留
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
fs.writeFileSync(WS + '/甲.md', '# 甲文档\n内容甲\n');
fs.writeFileSync(WS + '/乙.md', '# 乙文档\n内容乙\n');

const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' },
  timeout: 120000,
});
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(3000);

// 清协议弹窗
for (let i = 0; i < 10; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  const masks = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length);
  if (!masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
}

// 开两个 tab
await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/甲.md']);
await win.waitForTimeout(800);
await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/乙.md']);
await win.waitForTimeout(1000);

// 找 tab 位置
const tabBox = await win.evaluate(() => {
  const t = [...document.querySelectorAll('.tab')].find(x => x.textContent.includes('甲.md'));
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log('tab 位置:', JSON.stringify(tabBox));

const pane = await win.evaluate(() => {
  const p = document.querySelector('.pane');
  const r = p.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log('窗格:', JSON.stringify(pane));

// 真实拖拽：拖到窗格右 1/3 区，悬停不松手
await win.mouse.move(tabBox.x, tabBox.y);
await win.mouse.down();
await win.mouse.move(pane.x + pane.w * 0.5, pane.y + pane.h * 0.5, { steps: 12 });
await win.waitForTimeout(200);
await win.mouse.move(pane.x + pane.w * 0.85, pane.y + pane.h * 0.5, { steps: 12 });
await win.waitForTimeout(600); // 悬停让 overlay 出来
await win.screenshot({ path: 'tests/e2e/shots/probe-拖拽悬停.png' });
console.log('悬停截图已存');

// 检查 overlay 样式
const ov = await win.evaluate(() => {
  const els = [...document.querySelectorAll('body > div')].filter(d => d.style.position === 'fixed' && d.style.pointerEvents === 'none');
  return els.map(d => ({ border: d.style.border, borderRight: d.style.borderRight, bg: d.style.background.slice(0, 80), w: d.style.width, h: d.style.height }));
});
console.log('overlay 元素:', JSON.stringify(ov, null, 1));

// 松手 drop
await win.mouse.up();
await win.waitForTimeout(1000);
await win.screenshot({ path: 'tests/e2e/shots/probe-分屏后.png' });

// 查残留：漂浮 tab 幻影 / 多余 overlay
const residue = await win.evaluate(() => {
  const fixed = [...document.querySelectorAll('body > div')].filter(d => d.style.position === 'fixed' && d.style.pointerEvents === 'none');
  const panes = document.querySelectorAll('.pane').length;
  const tabs = [...document.querySelectorAll('.tab')].map(t => t.textContent.trim().slice(0, 20));
  const stray = [...document.querySelectorAll('.tab')].filter(t => !t.closest('.tabbar')).map(t => t.outerHTML.slice(0, 100));
  return { fixedOverlays: fixed.length, panes, tabs, strayTabs: stray };
});
console.log('松手后残留:', JSON.stringify(residue, null, 1));

await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
