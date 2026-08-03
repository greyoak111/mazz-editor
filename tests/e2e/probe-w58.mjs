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
// ①js fp 链路
await human.evaluate(() => window.MazzCommands?.execute('file.newCode'));
await win.waitForTimeout(1600);
await human.evaluate(async (ws) => {
  const ctl = window.__activeCodeCtl;
  if (ctl?.editor) ctl.editor.setValue('console.log("X")');
  const p = ws + '/probe-run.js';
  await window.mazz.invoke('fs:writeFile', { path: p, content: 'console.log("X")' });
  await window.MazzShell?.openFile?.(p);
}, WS);
await win.waitForTimeout(1400);
const fpProbe = await human.evaluate(() => {
  const ctl = window.__activeCodeCtl;
  const tabs = [...(window.MazzShell?.tabs?.tabs?.values?.() || [])].map(t => ({ id: t.id, moduleId: t.moduleId, filePath: t.filePath }));
  return { lang: ctl?.language, fp: ctl?.filePath, tabsCount: tabs.length, tabs: tabs.slice(-3) };
});
console.log('①js fp:', JSON.stringify(fpProbe).slice(0, 400));
// ②B12 按钮 DOM
const btnProbe = await human.evaluate(() => ({
  btn: !!document.getElementById('code-lang-btn'),
  ribbonText: (document.querySelector('.ribbon')?.textContent || '').slice(0, 100),
  sel: !!document.getElementById('code-lang'),
  mod: document.querySelector('.panes')?.textContent?.includes('Monaco') || false,
}));
console.log('②B12 按钮:', JSON.stringify(btnProbe));
// ③html lang 推断
await human.evaluate(() => window.MazzCommands?.execute('file.newCode'));
await win.waitForTimeout(1400);
await human.evaluate(() => {
  const ctl = window.__activeCodeCtl;
  if (ctl?.editor) ctl.editor.setValue('<html><body><h1>W58</h1></body></html>');
});
await win.waitForTimeout(500);
const langProbe = await human.evaluate(() => ({ lang: window.__activeCodeCtl?.language }));
console.log('③html lang:', JSON.stringify(langProbe));
await app.close().catch(() => {});
