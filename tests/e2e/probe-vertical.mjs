// tests/e2e/probe-vertical.mjs —— 探针：vertical-rl + CSS 分栏的溢出几何实测（竖排切片轴向判定）
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
await win.waitForTimeout(2500);
for (let i = 0; i < 10; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  break;
}

const r = await win.evaluate(() => {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:800px;height:500px;z-index:9999;background:#fff';
  document.body.appendChild(host);
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-same-origin');
  f.style.cssText = 'width:100%;height:100%;border:0';
  host.appendChild(f);
  const d = f.contentDocument;
  d.body.innerHTML = `<div id="wrap" style="height:100%;overflow:hidden;margin:0 auto"><div id="flow" style="height:100%;box-sizing:border-box;padding:18px 0"></div></div>`;
  const flow = d.querySelector('#flow');
  const H = d.documentElement.clientHeight; // ~500
  const W = d.documentElement.clientWidth;  // ~800
  // koodo 竖排公式：column-width 映射到纵向尺寸（书写模式感知）
  const gap = 40;
  const pageH = Math.floor((H - gap) / 1); // 单页：栏高=视口高-gap
  const wrap = d.querySelector('#wrap');
  wrap.style.width = W + 'px';
  d.body.style.cssText = `margin:0;writing-mode:vertical-rl;text-orientation:mixed;height:${H}px;width:${W}px;overflow:hidden;box-sizing:border-box;column-fill:auto;column-gap:${gap}px;column-width:${pageH}px;`;
  flow.innerHTML = Array.from({ length: 60 }, (_, i) => `<p id="p${i}" style="margin:0 0 1em">竖排测试段落 ${i + 1}：夜色从河面上升起来，老城在潮声里缓慢翻了个身，他沿着堤岸走了很久。</p>`).join('');
  const m = (el) => ({ l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  return {
    W, H, pageH, gap,
    bodyScrollW: d.body.scrollWidth, bodyScrollH: d.body.scrollHeight,
    flowScrollW: flow.scrollWidth, flowScrollH: flow.scrollHeight,
    bodyClientW: d.body.clientWidth, bodyClientH: d.body.clientHeight,
    p0: m(d.querySelector('#p0')), p10: m(d.querySelector('#p10')), p30: m(d.querySelector('#p30')), p59: m(d.querySelector('#p59')),
  };
});
console.log('竖排几何:', JSON.stringify(r, null, 1));

await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
