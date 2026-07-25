import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-rx-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-rxw-'));
fs.writeFileSync(path.join(WS, '正则靶.txt'), '订单号 AB-1024 已支付\n订单号 AB-2048 待审核');
const app = await electron.launch({ args: ['.'], env: { ...process.env, MAZZ_E2E_USER_DATA: UD, MAZZ_E2E_WORKSPACE: WS } });
const win = await app.firstWindow();
await win.waitForTimeout(3000);
for (let i = 0; i < 12; i++) { const a = await win.$('#agree-accept'); if (a) { await a.click().catch(()=>{}); } else break; await win.waitForTimeout(300); }
await win.evaluate(() => window.MazzCommands?.execute('file.newSearch'));
await win.waitForTimeout(2000);
await win.evaluate(() => { const els = [...document.querySelectorAll('[data-a=rebuild]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
await win.waitForTimeout(1500);
const st = await win.evaluate(() => {
  const inputs = [...document.querySelectorAll('.gs-input')];
  const i = inputs.find(e => e.offsetParent) || inputs[0];
  i.value = 'AB-\\d+';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  const res = [...document.querySelectorAll('.gs-regex')];
  const re = res.find(c => c.offsetParent) || res[0];
  if (re && !re.checked) re.click();
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return { inputs: inputs.length, regexFound: !!re, checked: re?.checked };
});
console.log('state:', JSON.stringify(st));
await win.waitForTimeout(1200);
console.log('hits:', (await win.evaluate(() => document.querySelector('.module-view.on .gs-results, .gs-results')?.textContent || 'EMPTY')).slice(0, 120));
await app.close();
