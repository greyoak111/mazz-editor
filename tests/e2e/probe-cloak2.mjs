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
await human.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
await win.waitForTimeout(800);
const pre = await human.evaluate(async () => {
  const ctl = window.__activeBrowserCtl, tab = ctl?.tabs?.find(item => item.id === ctl.activeId) || ctl?.tabs?.[0];
  return { hasCtl: !!ctl, hasSync: typeof ctl?.__sync, dragCloak: ctl?._dragCloak, state: tab ? await window.mazz.invoke('bv:state', { tabId: tab.viewId }) : null };
});
console.log('拖前:', JSON.stringify(pre));
await human.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('mazz/tab', 't1');
  document.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
  window.__dt = dt;
});
await human.until(() => ['active', 'degraded-visible'].includes(window.__mazzSplitProxyState?.phase), { timeout: 15000, msg: 'W87d 代理事务' });
const post = await human.evaluate(async () => {
  const ctl = window.__activeBrowserCtl, tab = ctl?.tabs?.find(item => item.id === ctl.activeId) || ctl?.tabs?.[0];
  const node = document.querySelector('.mazz-split-surface-proxy');
  const frame = document.querySelector('.mazz-split-surface-frame');
  const rect = frame?.getBoundingClientRect();
  return {
    phase: window.__mazzSplitProxyState?.phase,
    dragCloak: ctl?._dragCloak,
    dragging: document.body.classList.contains('tab-dragging'),
    frames: document.querySelectorAll('.mazz-split-surface-frame').length,
    pointerEvents: node ? getComputedStyle(node).pointerEvents : null,
    hitPane: rect ? !!document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest?.('.pane') : false,
    state: tab ? await window.mazz.invoke('bv:state', { tabId: tab.viewId }) : null,
  };
});
console.log('拖后:', JSON.stringify(post));
if (post.phase === 'active' && !(post.frames > 0 && post.pointerEvents === 'none' && post.hitPane && post.dragCloak && post.state?.hidden)) {
  throw new Error(`active proxy transaction unhealthy: ${JSON.stringify(post)}`);
}
if (post.phase === 'degraded-visible' && (post.dragCloak || post.state?.hidden)) throw new Error(`fail-visible violated: ${JSON.stringify(post)}`);
await human.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
await human.until(() => window.__mazzSplitProxyState?.phase === 'idle' && !document.querySelector('.mazz-split-surface-proxy'), { timeout: 15000, msg: 'W87d 收尸' });
const restored = await human.evaluate(async () => {
  const ctl = window.__activeBrowserCtl, tab = ctl?.tabs?.find(item => item.id === ctl.activeId) || ctl?.tabs?.[0];
  const state = tab ? await window.mazz.invoke('bv:state', { tabId: tab.viewId }) : null;
  const pixels = tab ? await window.mazz.invoke('bv:capture', { tabId: tab.viewId }) : null;
  return { state, pixelBytes: pixels?.length || 0 };
});
if (!restored.state || restored.state.hidden || restored.state.occluded || restored.pixelBytes < 1000) throw new Error(`restore unhealthy: ${JSON.stringify(restored)}`);
await app.close().catch(() => {});
