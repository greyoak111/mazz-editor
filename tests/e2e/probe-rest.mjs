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
// ①复刻 run56 js 场景：file.newCode 前置+openFile
await human.evaluate(() => window.MazzCommands?.execute('file.newCode'));
await win.waitForTimeout(1500);
await human.evaluate(() => { const ctl = window.__activeCodeCtl; if (ctl?.editor) ctl.editor.setValue('console.log("MAZZ_RUN_OK_"+(40+2))'); });
await human.evaluate(async (ws) => {
  const p = ws + '/probe-rest.js';
  await window.mazz.invoke('fs:writeFile', { path: p, content: 'console.log("MAZZ_RUN_OK_"+(40+2))' });
  await window.MazzShell?.openFile?.(p);
}, WS);
await win.waitForTimeout(1400);
await human.evaluate(() => window.MazzCommands?.execute('code.runFile'));
await win.waitForTimeout(3500);
const st = await human.evaluate(() => {
  const ctl = window.__activeCodeCtl;
  const rec = ctl?.terminal?.terms?.get(ctl?.terminal?.activeId);
  const buf = rec?.xterm?.buffer?.active;
  const lines = [];
  if (buf) for (let i = Math.max(0, buf.length - 10); i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) || '');
  return { fp: ctl?.filePath, activeId: ctl?.terminal?.activeId, size: ctl?.terminal?.terms?.size, bufLen: buf?.length, tail: lines.join('|').slice(-250) };
});
console.log('①js 场景复刻:', JSON.stringify(st).slice(0, 450));
// ②html 预览：读 bctl tabs[0] url
await human.evaluate(() => window.MazzCommands?.execute('file.newCode'));
await win.waitForTimeout(1400);
await human.evaluate(async (ws) => {
  const ctl = window.__activeCodeCtl;
  if (ctl?.editor) ctl.editor.setValue('<html><body><h1 id="w58mark">W58预览</h1></body></html>');
  const p = ws + '/probe-page.html';
  await window.mazz.invoke('fs:writeFile', { path: p, content: '<html><body><h1 id="w58mark">W58预览</h1></body></html>' });
  await window.MazzShell?.openFile?.(p);
}, WS);
await win.waitForTimeout(1400);
await human.evaluate(() => window.MazzCommands?.execute('code.runFile'));
await win.waitForTimeout(2200);
const pv = await human.evaluate(async () => {
  const bctl = window.__activeBrowserCtl;
  const tabs = (bctl?.tabs || []).map(t => ({ title: t.title, url: t.url }));
  const ctl = window.__activeCodeCtl;
  return { codeLang: ctl?.language, bctlTabs: tabs, activeId: bctl?.activeId };
});
console.log('②html 预览:', JSON.stringify(pv).slice(0, 400));
await app.close().catch(() => {});
