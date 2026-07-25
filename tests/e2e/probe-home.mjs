// tests/e2e/probe-home.mjs —— 探针：浏览器主页巨大装饰图形真身
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));

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

await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(3000);
await win.screenshot({ path: 'tests/e2e/shots/probe-home.png' });

// 查 webview 内部文档的 SVG 尺寸
const info = await win.evaluate(async () => {
  const wv = [...document.querySelectorAll('webview')].find(v => v.getBoundingClientRect().width > 0);
  if (!wv) return { err: 'no-webview' };
  try {
    return await wv.executeJavaScript(`
      (() => {
        const svgs = [...document.querySelectorAll('svg')].map(s => {
          const r = s.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), cls: s.getAttribute('class'), inH1: !!s.closest('h1'), inBtn: !!s.closest('button') };
        });
        const big = [...document.querySelectorAll('body *')].filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 800 && r.height > 400 && !['BODY','HTML'].includes(el.tagName);
        }).map(el => ({ tag: el.tagName, cls: el.className, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }));
        return { svgCount: svgs.length, svgs: svgs.slice(0, 12), bigElements: big.slice(0, 6), zoom: (window.devicePixelRatio || 1) };
      })()
    `);
  } catch (e) { return { err: e.message.slice(0, 120) }; }
});
console.log(JSON.stringify(info, null, 1));
await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
