import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-v2-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-v2ws-'));
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForFunction(() => !!(window.MazzCommands && window.MazzShell), null, { timeout: 30000 });
await win.waitForTimeout(600);
await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
for (let i = 0; i < 20; i++) {
  const st = await win.evaluate(() => ({ masks: [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length, agree: !!document.querySelector('#agree-accept') }));
  if (st.agree) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  if (st.masks === 0) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
}
await win.evaluate(() => window.MazzCommands?.execute('file.newSlide'));
await win.waitForTimeout(1500);
const r = await win.evaluate(() => {
  const out = { active: !!window.__activeSlideCtl };
  if (window.__activeSlideCtl) {
    const c = window.__activeSlideCtl;
    out.isV2 = c.isV2; out.doc2v = c.doc2?.v; out.side = !!c.v2Side; out.sideDisplay = c.v2?.style.display;
    out.frames = c.doc2?.layouts?.main?.frames?.length;
  }
  const reg = window.MazzModulesReal || window.MazzModules;
  out.regKind = reg ? (reg.constructor?.name || typeof reg) : 'none';
  out.instIsMap = reg?.instances instanceof Map;
  out.instKeys = reg?.instances ? [...reg.instances.keys()].slice(0, 6) : [];
  out.instTypes = reg?.instances ? [...reg.instances.values()].map(v => ({ name: v?.name ?? v?.def?.name ?? v?.constructor?.name, isV2: !!(v?.state?.isV2 ?? v?.isV2) })) : [];
  return out;
});
console.log(JSON.stringify(r, null, 1));
await app.close().catch(() => {});
