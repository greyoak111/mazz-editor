// tests/e2e/probe-playerbar.mjs —— 探针：播放器底栏几何直视（多宽度）
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 12; i++) { const acc = await win.evaluate(() => !!document.querySelector('#agree-accept')); if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; } break; }
await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
await win.evaluate(() => window.MazzCommands?.execute('file.newViewer'));
await win.waitForTimeout(2000);
// 播放列表开（模拟真机）
await win.evaluate(() => document.querySelector('[data-a=list]')?.click()).catch(() => {});
await win.waitForTimeout(800);

for (const w of [1920, 1600, 1366, 1280, 1080]) {
  await win.setViewportSize({ width: w, height: 900 }).catch(() => {});
  await win.waitForTimeout(500);
  const st = await win.evaluate(() => {
    const ctr = document.querySelector('.mz-controls');
    const bar = document.querySelector('.mz-bar');
    const stage = document.querySelector('.mz-stage');
    const side = document.querySelector('.mz-side');
    const sb = document.querySelector('.sidebar');
    if (!ctr || !bar) return { fatal: 'no controls' };
    const cr = ctr.getBoundingClientRect(), br = bar.getBoundingClientRect(), sr = stage?.getBoundingClientRect(), pr = side?.getBoundingClientRect();
    const cs = getComputedStyle(ctr), bs = getComputedStyle(bar);
    return {
      controlsRect: { l: Math.round(cr.left), r: Math.round(cr.right), w: Math.round(cr.width) },
      barRect: { l: Math.round(br.left), r: Math.round(br.right), w: Math.round(br.width) },
      stageW: Math.round(sr?.width || 0), sideW: Math.round(pr?.width || 0), sbW: Math.round(sb?.getBoundingClientRect().width || 0),
      opacity: cs.opacity, fade: ctr.classList.contains('fade'), barMinW: bs.minWidth, barOverflowX: bs.overflowX,
      stageOverflow: getComputedStyle(stage).overflow,
    };
  });
  console.log(`W${w}:`, JSON.stringify(st));
}
await app.close().catch(() => {});
process.exit(0);
