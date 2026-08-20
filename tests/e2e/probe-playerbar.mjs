// tests/e2e/probe-playerbar.mjs —— W87e Player Control Surface 几何/可达性探针（多宽度）
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

const samples = [];
for (const w of [1920, 1600, 1366, 1280, 1080, 900, 760]) {
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
    const visible = [...bar.children].filter(el => {
      const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });
    const rects = visible.map(el => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.a || el.dataset.playerLabel || el.className, l: r.left, r: r.right, t: r.top, b: r.bottom };
    });
    const overlaps = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1) overlaps.push([a.id, b.id]);
    }
    const out = rects.filter(r => r.l < br.left - 1 || r.r > br.right + 1).map(r => r.id);
    return {
      controlsRect: { l: Math.round(cr.left), r: Math.round(cr.right), w: Math.round(cr.width) },
      barRect: { l: Math.round(br.left), r: Math.round(br.right), w: Math.round(br.width) },
      stageW: Math.round(sr?.width || 0), sideW: Math.round(pr?.width || 0), sbW: Math.round(sb?.getBoundingClientRect().width || 0),
      opacity: cs.opacity, fade: ctr.classList.contains('fade'), barMinW: bs.minWidth, barOverflowX: bs.overflowX,
      clientW: bar.clientWidth, scrollW: bar.scrollWidth, density: ctr.dataset.density,
      inline: document.querySelector('.mz-player')?.__playerControlSurface?.snapshot?.().inline || [],
      overflow: document.querySelector('.mz-player')?.__playerControlSurface?.snapshot?.().overflow || [],
      moreVisible: getComputedStyle(bar.querySelector('[data-a=more-controls]')).display !== 'none', out, overlaps,
      stageOverflow: getComputedStyle(stage).overflow,
    };
  });
  console.log(`W${w}:`, JSON.stringify(st));
  if (st.scrollW > st.clientW + 1 || st.out.length || st.overlaps.length) throw new Error(`W${w} player controls overflow: ${JSON.stringify(st)}`);
  samples.push({ viewport: w, ...st });
}

// 窄级 More 必须打开在 stage 内，且同一真实控件仍可操作。
await win.evaluate(() => document.querySelector('[data-a=more-controls]')?.click());
await win.waitForTimeout(200);
const more = await win.evaluate(() => {
  const stage = document.querySelector('.mz-stage');
  const panel = document.querySelector('.mz-control-center');
  const sr = stage.getBoundingClientRect(), pr = panel.getBoundingClientRect();
  return {
    open: !panel.hidden,
    withinStage: pr.left >= sr.left - 1 && pr.right <= sr.right + 1 && pr.top >= sr.top - 1 && pr.bottom <= sr.bottom + 1,
    actions: [...panel.querySelectorAll('[data-a]')].map(el => el.dataset.a),
    expanded: document.querySelector('[data-a=more-controls]')?.getAttribute('aria-expanded'),
  };
});
console.log('MORE:', JSON.stringify(more));
const lastInline = samples.at(-1)?.inline || [];
if (!more.open || !more.withinStage || more.expanded !== 'true' || !(more.actions.includes('fullscreen') || lastInline.includes('fullscreen')) || !more.actions.includes('loop')) throw new Error(`More control center failed: ${JSON.stringify({ more, lastInline })}`);
await app.close().catch(() => {});
process.exit(0);
