import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
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
await win.evaluate(() => window.MazzShell?.setTheme?.('construct'));
await win.waitForTimeout(400);
await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(3000);
await win.screenshot({ path: 'tests/e2e/shots/probe-home-construct.png' });
const info = await win.evaluate(async () => {
  const wv = [...document.querySelectorAll('webview')].find(v => v.getBoundingClientRect().width > 0);
  if (!wv) return { err: 'no-webview' };
  return await wv.executeJavaScript(`(() => {
    const W = innerWidth, H = innerHeight;
    const big = [...document.querySelectorAll('body *')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > W * 0.6 && r.height > H * 0.25;
    }).map(el => ({ tag: el.tagName, cls: String(el.className).slice(0,40), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), bg: getComputedStyle(el).background.slice(0,80) }));
    return { innerW: W, innerH: H, big };
  })()`);
});
console.log(JSON.stringify(info, null, 1));
await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
