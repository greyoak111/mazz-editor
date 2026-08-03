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
await human.evaluate(async (ws) => {
  const p = ws + '/probe-term.js';
  await window.mazz.invoke('fs:writeFile', { path: p, content: 'console.log("TERM_OK")' });
  await window.MazzShell?.openFile?.(p);
}, WS);
await win.waitForTimeout(1500);
await human.evaluate(() => window.MazzCommands?.execute('code.runFile'));
await win.waitForTimeout(3500);
const st = await human.evaluate(() => {
  const ctl = window.__activeCodeCtl;
  const term = ctl?.terminal;
  const rec = term?.terms?.get(term.activeId);
  const buf = rec?.xterm?.buffer?.active;
  const lines = [];
  if (buf) for (let i = 0; i < Math.min(buf.length, 14); i++) lines.push(buf.getLine(i)?.translateToString(true) || '');
  return { lang: ctl?.language, fp: ctl?.filePath, hasTerm: !!term, activeId: term?.activeId, size: term?.terms?.size, bufLen: buf?.length, lines: lines.join('|').slice(-300) };
});
console.log('term:', JSON.stringify(st).slice(0, 500));
await app.close().catch(() => {});
