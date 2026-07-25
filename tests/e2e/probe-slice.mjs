// tests/e2e/probe-slice.mjs —— 探针：切片错位（单页显示双栏）根因
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
  if (!books.find(b => b.id === 'e2e-slice-epub')) {
    books.push({ id: 'e2e-slice-epub', title: '潮声集', author: '测试', cover: '', path: p, format: 'epub', category: '未分类', addedAt: Date.now() });
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
await win.waitForTimeout(700);

const dump = () => win.evaluate(() => {
  const w = [...document.querySelectorAll('.lib-flow-wrap')].find(e => e.getBoundingClientRect().width > 0);
  const flow = w?.querySelector('.lib-flow');
  if (!w || !flow) return { err: 'no-flow' };
  const pageEl = w.parentElement;
  // 实际栏数：内容第一行文字的栏分布（取前几个 block 的 offsetLeft 分桶）
  const kids = [...flow.children].slice(0, 12).map(k => Math.round(k.offsetLeft));
  return {
    wrapW: w.clientWidth,
    wrapStyleW: w.style.width,
    pageElW: pageEl?.clientWidth,
    colW: flow.style.columnWidth,
    flowScrollW: flow.scrollWidth,
    flowTransform: flow.style.transform,
    estCols: w.clientWidth > 0 ? Math.round(flow.scrollWidth / w.clientWidth) : 0,
    kidsOffsetLeft: kids,
    pageW: window.__activeLibraryCtl?._pageW,
    flowOffset: window.__activeLibraryCtl?._flowOffset,
  };
});

console.log('单页(自适应70%):', JSON.stringify(await dump(), null, 1));
await win.screenshot({ path: 'tests/e2e/shots/probe-slice-single.png' });

// 双页对照
await win.evaluate(() => { const s = [...document.querySelectorAll('.lib-mode')].find(e => e.getBoundingClientRect().width > 0); if (s) { s.value = 'double'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
await win.waitForTimeout(1000);
console.log('双页:', JSON.stringify(await dump(), null, 1));

await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
