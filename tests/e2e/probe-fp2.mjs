import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { Human } from './human.mjs';
import { seedFixtures } from './fixtures.mjs';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const WS2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws2-'));
await seedFixtures(WS, WS2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
const human = new Human(win);
await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳' });
await win.waitForTimeout(800);
await human.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
for (let i = 0; i < 20; i++) { const s = await human.evaluate(() => !!document.querySelector('#agree-accept')); if (s) { await human.click('#agree-accept').catch(()=>{}); await win.waitForTimeout(300); continue; } break; }
await human.evaluate(() => window.MazzCommands?.execute('file.newCode'));
await win.waitForTimeout(1500);
await human.evaluate(async (ws) => {
  const p = ws + '/probe2.js';
  await window.mazz.invoke('fs:writeFile', { path: p, content: 'console.log(1)' });
  await window.MazzShell?.openFile?.(p);
}, WS);
await win.waitForTimeout(1200);
const st = await human.evaluate(() => {
  const ctl = window.__activeCodeCtl;
  const tabs = [...(window.MazzShell?.tabs?.tabs?.values?.() || [])].map(t => ({ id: t.id, mod: t.moduleId, fp: t.filePath, active: t.id === (window.MazzShell?.tabs?.activeId || window.MazzShell?.tabs?.active?.id) }));
  return { ctlFp: ctl?.filePath, tabs };
});
console.log('fp2:', JSON.stringify(st).slice(0, 400));
// B12：showPage 后按钮
await win.waitForTimeout(600);
const btn = await human.evaluate(() => ({
  btn: !!document.getElementById('code-lang-btn'),
  activeTab: [...document.querySelectorAll('.ribbon-tab')].find(t => t.classList.contains('on'))?.textContent,
}));
console.log('btn:', JSON.stringify(btn));
await app.close().catch(() => {});
