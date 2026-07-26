// tests/e2e/probe-w20fix.mjs —— 探针：书库恢复决策 + 浏览器页签增删 execJs 直视
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
await win.waitForTimeout(2600);
for (let i = 0; i < 10; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  const masks = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length);
  if (!masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
}

// —— A：书库进度恢复直视 ——
await win.evaluate(async ([p]) => {
  const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
  books.push({ id: 'e2e-probe-txt', title: '夜航西飞', author: '测试', cover: '', path: p, format: 'txt', category: '未分类', addedAt: Date.now() });
  await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
  await window.MazzCommands.execute('file.newLibrary');
}, [WS + '/书库/夜航西飞.txt']);
await win.waitForTimeout(1500);
await win.evaluate(() => { [...document.querySelectorAll('.lib-card')].find(c => c.getBoundingClientRect().width > 0 && c.textContent.includes('夜航西飞'))?.click(); });
await win.waitForTimeout(1800);
await win.evaluate(() => {
  const c = window.__activeLibraryCtl;
  const flow = c._flowWrap.querySelector('.lib-flow');
  const max = flow.scrollWidth - c._flowWrap.clientWidth;
  c._applyOffset(0.5 * max);
});
await win.waitForTimeout(1100);
const rec = await win.evaluate(async () => await window.mazz.invoke('settings:get', { key: 'library.progress' }));
console.log('A 进度记录:', JSON.stringify(rec?.['e2e-probe-txt']));
await win.evaluate(() => { const b = [...document.querySelectorAll('[data-a=back]')].find(e => e.getBoundingClientRect().width > 0); b?.click(); });
await win.waitForTimeout(700);
await win.evaluate(() => { [...document.querySelectorAll('.lib-card')].find(c => c.getBoundingClientRect().width > 0 && c.textContent.includes('夜航西飞'))?.click(); });
await win.waitForTimeout(1800);
const after = await win.evaluate(() => {
  const c = window.__activeLibraryCtl;
  const flow = c._flowWrap?.querySelector('.lib-flow');
  const max = Math.max(1, (flow?.scrollWidth || 1) - (c._flowWrap?.clientWidth || 1));
  return { off: c._flowOffset, max, ratio: (c._flowOffset || 0) / max, pageIdx: c.pageIdx };
});
console.log('A 重开恢复:', JSON.stringify(after));

// —— B：浏览器页签增删直视 ——
await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(2200);
await win.evaluate(() => window.MazzCommands.execute('browser.newTab'));
await win.waitForTimeout(900);
await win.evaluate(() => { const btns = [...document.querySelectorAll('.br-tab-close')]; btns[btns.length - 1]?.click(); });
await win.waitForTimeout(600);
const b = await win.evaluate(async () => {
  const ctl = window.__activeBrowserCtl;
  const out = { hasCtl: !!ctl, tabs: ctl?.tabs?.length, activeId: ctl?.activeId, viewId: ctl?.activeTab()?.viewId };
  try {
    const r = await ctl.execJs(null, 'document.body ? document.body.textContent.length : -1');
    out.r = r; out.rType = typeof r;
  } catch (e) { out.err = e.message.slice(0, 120); }
  return out;
});
console.log('B 页签增删:', JSON.stringify(b));

await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
