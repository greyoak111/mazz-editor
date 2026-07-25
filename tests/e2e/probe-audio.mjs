// tests/e2e/probe-audio.mjs —— 探针：音频播放器阴间比例 DOM 实锤
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);

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
await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/测试音.wav']);
await win.waitForTimeout(2500);

const info = await win.evaluate(() => {
  const body = document.querySelector('.viewer-body');
  if (!body) return { err: 'no-body' };
  const dump = (el, depth = 0) => {
    if (!el || depth > 5) return [];
    const r = el.getBoundingClientRect?.() || {};
    const cs = getComputedStyle(el);
    return [{
      tag: el.tagName + (el.className ? '.' + String(el.className).replace(/ /g, '.') : ''),
      w: Math.round(r.width || 0), h: Math.round(r.height || 0), x: Math.round(r.x || 0),
      display: cs.display, pos: cs.position, flex: cs.flex,
    }, ...[...el.children].flatMap(c => dump(c, depth + 1))];
  };
  return {
    bodyRect: JSON.stringify(body.getBoundingClientRect()),
    childCount: body.children.length,
    tree: dump(body),
  };
});
console.log(JSON.stringify(info, null, 1).slice(0, 2600));
await win.screenshot({ path: 'tests/e2e/shots/probe-audio.png' });
await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
