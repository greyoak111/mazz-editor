import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { makeMobi } from './mobi-encoder.mjs';
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-mp-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-mpw-'));
fs.mkdirSync(path.join(WS, '书库'), { recursive: true });
const novel = ['第一章 渡口', '', '暮色压着水面，渡船离岸。', '第二章 灯火', '', '她把灯举过头顶。'];
fs.writeFileSync(path.join(WS, '书库', '渡口集.mobi'), makeMobi({ title: '渡口集', text: novel.join('\n') }));
const app = await electron.launch({ args: ['.'], env: { ...process.env, MAZZ_E2E_USER_DATA: UD, MAZZ_E2E_WORKSPACE: WS } });
const win = await app.firstWindow();
await win.waitForTimeout(3000);
for (let i = 0; i < 12; i++) { const a = await win.$('#agree-accept'); if (a) { await a.click().catch(()=>{}); } else break; await win.waitForTimeout(300); }
await win.evaluate(async ([p]) => {
  const books = [{ id: 'b1', title: '渡口集', author: '测试', cover: '', path: p, format: 'mobi', category: '未分类', addedAt: Date.now() }];
  await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
}, [WS + '/书库/渡口集.mobi']);
await win.evaluate(() => window.MazzCommands?.execute('file.newLibrary'));
await win.waitForTimeout(2000);
await win.evaluate(() => { const c = document.querySelector('.lib-card'); c?.click(); });
await win.waitForTimeout(2500);
console.log('reader:', await win.evaluate(() => !!document.querySelector('.lib-reader-bar')));
console.log('pageText:', (await win.evaluate(() => document.querySelector('.lib-page')?.textContent || 'EMPTY')).slice(0, 80));
console.log('pos:', await win.evaluate(() => document.querySelector('.lib-pos')?.textContent));
await app.close();
