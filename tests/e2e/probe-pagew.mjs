// tests/e2e/probe-pagew.mjs —— 探针：epub 页宽选定 vs 超宽实证
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
await win.evaluate(async ([p]) => {
  const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
  if (!books.find(b => b.id === 'e2e-pw-epub')) {
    books.push({ id: 'e2e-pw-epub', title: '潮声集', author: '测试', cover: '', path: p, format: 'epub', category: '未分类', addedAt: Date.now() });
    await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
  }
  await window.MazzCommands.execute('file.newLibrary');
}, [WS + '/电子书/潮声集.epub']);
await win.waitForTimeout(1500);
await win.evaluate(() => { [...document.querySelectorAll('.lib-card')].find(c => c.getBoundingClientRect().width > 0 && c.textContent.includes('潮声集'))?.click(); });
await win.waitForFunction(() => {
  const w = [...document.querySelectorAll('.lib-flow-wrap')].find(e => e.getBoundingClientRect().width > 0);
  return w && w.scrollWidth > 0;
}, { timeout: 9000 }).catch(() => {});
await win.waitForTimeout(600);

const read = () => win.evaluate(() => {
  const w = [...document.querySelectorAll('.lib-flow-wrap')].find(e => e.getBoundingClientRect().width > 0);
  const flow = w?.querySelector('.lib-flow');
  return w ? { wrapW: w.clientWidth, colW: parseFloat(flow?.style.columnWidth) || 0, scrollW: w.scrollWidth } : null;
});

console.log('自适应(默认):', JSON.stringify(await read()));
// 切单页 + 页宽 320
await win.evaluate(() => { const s = [...document.querySelectorAll('.lib-mode')].find(e => e.getBoundingClientRect().width > 0); if (s) { s.value = 'single'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
await win.waitForTimeout(800);
await win.selectOption('.lib-pagew', '320').catch(e => console.log('selectOption 320 失败:', e.message.slice(0, 60)));
await win.waitForTimeout(900);
// 绕过 change 事件链，手动设置验证 layOut 通路
await win.evaluate(() => { const c = window.__activeLibraryCtl; if (c) { c.pageWidth = 320; c._flowLayout?.(); } });
await win.waitForTimeout(500);
const diag = await win.evaluate(() => ({
  pw: window.__activeLibraryCtl?.pageWidth,
  hasFlowLayout: typeof window.__activeLibraryCtl?._flowLayout,
  selVal: document.querySelector('.lib-pagew')?.value,
}));
console.log('手动设320后诊断:', JSON.stringify(diag));
const r320 = await read();
console.log('页宽320:', JSON.stringify(r320));
console.log(r320 && Math.abs(r320.colW - 320) < 4 && r320.colW <= r320.wrapW ? '✅ 320 选定生效且不超宽' : '❌ 仍异常');
// 切页宽 450
await win.evaluate(() => { const s = [...document.querySelectorAll('.lib-pagew')].find(e => e.getBoundingClientRect().width > 0); if (s) { s.value = '450'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
await win.waitForTimeout(900);
const r450 = await read();
console.log('页宽450:', JSON.stringify(r450), r450 && Math.abs(r450.colW - 450) < 4 ? '✅' : '❌');
await win.screenshot({ path: 'tests/e2e/shots/probe-pagew.png' });
await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
