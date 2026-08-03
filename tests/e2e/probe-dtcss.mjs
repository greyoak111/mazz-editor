// tests/e2e/probe-dtcss.mjs —— devtools CSS 变量体系探活（色调注入的变量名不许猜）
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { Human } from './human.mjs';
import { seedFixtures } from './fixtures.mjs';
const ROOT = '.';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const WS2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws2-'));
await seedFixtures(WS, WS2);
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
const human = new Human(win);
await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳' });
await win.waitForTimeout(800);
await human.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
for (let i = 0; i < 20; i++) { const s = await human.evaluate(() => !!document.querySelector('#agree-accept')); if (s) { await human.click('#agree-accept').catch(()=>{}); await win.waitForTimeout(300); continue; } break; }
await human.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器' });
await win.waitForTimeout(1200);
await human.evaluate(async () => { const ctl = window.__activeBrowserCtl; const t = ctl?.tabs?.[0]; if (t) window.mazz.invoke('bv:devtools', { tabId: t.viewId }).catch(() => {}); });
let dt = null;
for (let i = 0; i < 30; i++) { await win.waitForTimeout(300); dt = app.windows().find(w => w.url().startsWith('devtools://')) || null; if (dt) break; }
await win.waitForTimeout(2500);
if (!dt) { console.log('FATAL no devtools'); process.exit(1); }
const probe = await dt.evaluate(() => {
  const cs = getComputedStyle(document.body);
  const names = [];
  // 枚举行内/全局变量：从 documentElement.style 与 stylesheets 抓 --sys-color 系列
  const out = {};
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.style) {
          for (const prop of rule.style) {
            if (prop.startsWith('--sys-color-cdt') || prop.startsWith('--sys-color') || prop.startsWith('--devtools')) {
              if (!out[prop]) out[prop] = rule.style.getPropertyValue(prop).trim().slice(0, 40);
            }
          }
        }
      }
    } catch {}
  }
  // 采样前 40 个
  const cdtKeys = Object.keys(out).filter(k => k.includes('cdt'));
  for (const k of cdtKeys) names.push('CDT:' + k + '=' + out[k]);
  const keys = Object.keys(out).filter(k => !k.includes('cdt')).slice(0, 20);
  for (const k of keys) names.push(k + '=' + out[k]);
  return { count: Object.keys(out).length, sample: names, bodyBg: cs.backgroundColor };
});
console.log('COUNT:', probe.count, 'BG:', probe.bodyBg);
// body 背景来源追查：哪条规则哪个变量在决定
const src = await dt.evaluate(() => {
  const body = document.body;
  const cs = getComputedStyle(body);
  const hits = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        const sel = rule.selectorText || '';
        if ((sel === 'body' || sel.includes('body')) && rule.style && (rule.style.backgroundColor || rule.style.background)) {
          hits.push(sel + ' -> ' + (rule.style.backgroundColor || rule.style.background).slice(0, 80));
        }
        if (sel === ':root' && rule.style) {
          const bg = rule.style.getPropertyValue('--sys-color-base');
          if (bg) hits.push(':root --sys-color-base = ' + bg.trim());
        }
      }
    } catch {}
  }
  return { bg: cs.backgroundColor, hits: hits.slice(0, 12), hasMazz: !!document.getElementById('mazz-dt-theme') };
});
console.log('BODY-SRC:', JSON.stringify(src, null, 1));
console.log(probe.sample.join('\n'));
await app.close().catch(() => {});
