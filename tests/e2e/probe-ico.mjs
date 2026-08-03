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
// 开坞（停靠）
await human.evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
await human.until(() => { const d = document.querySelector('.side-dock'); return d && d.getBoundingClientRect().width > 0; }, { timeout: 8000, msg: '坞开' });
await human.evaluate(() => { document.querySelector('.side-dock .sd-tab[data-t="tools"]')?.click(); });
await win.waitForTimeout(900);
const docked = await human.evaluate(() => {
  const card = document.querySelector('.side-dock .sd-tool-card');
  if (!card) return { has: false };
  const ico = card.querySelector('.sd-tool-ico');
  return { has: true, html: (ico?.innerHTML || '').slice(0, 90), svgCount: document.querySelectorAll('.sd-tool-ico svg').length, cardCount: document.querySelectorAll('.sd-tool-card').length };
});
console.log('停靠坞工具卡:', JSON.stringify(docked));
// 开方式页
await human.evaluate(() => { document.querySelector('.side-dock .sd-tab[data-t="openwith"]')?.click(); });
await win.waitForTimeout(500);
const ow = await human.evaluate(() => {
  const card = document.querySelector('.side-dock .w-ow-card');
  return { html: (card?.innerHTML || '').slice(0, 120), svgCount: document.querySelectorAll('.w-ow-card svg').length };
});
console.log('停靠坞打开方式:', JSON.stringify(ow));
// 浮出 dockfloat
await human.evaluate(() => { document.querySelector('.side-dock [data-a="float"]')?.click(); });
await win.waitForTimeout(1800);
const df = app.windows().find(w => w.url().includes('/panels/dockfloat.html'));
if (df) {
  await df.evaluate(() => document.querySelector('[data-t="tools"]').click());
  await win.waitForTimeout(900);
  const dfl = await df.evaluate(() => {
    const card = document.querySelector('.tg-card');
    const ico = card?.querySelector('.i');
    const svg = ico?.querySelector('svg');
    const r = svg?.getBoundingClientRect?.();
    return { html: (ico?.innerHTML || '').slice(0, 90), svgCount: document.querySelectorAll('.tg-card svg').length, svgSize: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '(无svg)' };
  });
  console.log('dockfloat 工具卡:', JSON.stringify(dfl));
} else console.log('dockfloat 未开');
await app.close().catch(() => {});
