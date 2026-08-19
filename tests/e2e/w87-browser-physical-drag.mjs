// W87d Windows 输入 Gate：默认只搭建两块真实 WebContentsView，等待 SendInput/人工鼠标
// 完成一次标签分屏；可显式用 MAZZ_W87D_INPUT=cdp 验证 Chromium 指针生命周期。
// CDP 不合成 DragEvent，但也绝不冒充 Win32/人工物理输入证据。
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87d-physical-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87d-physical-ws-'));
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence');
const INPUT_MODE = String(process.env.MAZZ_W87D_INPUT || 'physical').toLowerCase();
const logs = [];
const errors = [];
let app = null;

const pageUrl = (label, a, b) => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<style>html,body{height:100%;margin:0;background:linear-gradient(135deg,${a},${b});color:#fff;font:700 42px system-ui}body{display:grid;place-items:center}</style>
<body><main>${label}</main><script>window.__pageMarker=${JSON.stringify(label)}</script></body>`);

async function dismissAgreement(main) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const agreement = app.windows().find(page => page.url().includes('/panels/agreement.html'));
    if (!agreement) break;
    await agreement.waitForLoadState('domcontentloaded');
    await agreement.locator('#nomore').check().catch(() => {});
    await agreement.locator('#accept').click().catch(() => {});
    await main.waitForTimeout(120);
  }
  await main.evaluate(() => Promise.all([
    window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
    window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
  ]));
}

async function openBrowser(page, title, url) {
  const shellId = await page.evaluate(({ title }) => window.MazzHost.openTab('browser', { title, content: '' }).tab.id, { title });
  const info = await page.waitForFunction(id => {
    const ctl = window.MazzModules?.instances?.get(id)?.state;
    const tab = ctl?.tabs?.find(item => item.id === ctl.activeId) || ctl?.tabs?.[0];
    return tab?.viewId ? { shellId: id, viewId: tab.viewId } : null;
  }, shellId, { timeout: 20000 }).then(handle => handle.jsonValue());
  await page.evaluate(({ shellId, url }) => window.MazzModules.instances.get(shellId).state.openUrl(url), { shellId, url });
  await page.waitForFunction(async ({ viewId, title }) => {
    const marker = await window.mazz.invoke('bv:js', { tabId: viewId, code: 'window.__pageMarker' }).catch(() => null);
    return marker === title;
  }, { viewId: info.viewId, title }, { timeout: 20000 });
  return info;
}

try {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, MAZZ_GPU_MODE: 'hardware', NODE_ENV: 'test' },
    timeout: 120000,
  });
  const proc = app.process?.();
  proc?.stdout?.on?.('data', bytes => logs.push(String(bytes)));
  proc?.stderr?.on?.('data', bytes => logs.push(String(bytes)));
  const main = await app.firstWindow({ timeout: 120000 });
  main.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  main.on('console', message => { if (message.type() === 'error') errors.push(`console.error: ${message.text()}`); });
  await main.waitForFunction(() => document.documentElement.dataset.appReady === '1' && !!window.MazzShell, null, { timeout: 30000 });
  await main.evaluate(() => window.MazzBoot);
  await dismissAgreement(main);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(item => !item.getParentWindow() && !item.__panelKind);
    win.setSize(1360, 840); win.center(); win.show(); win.focus();
  });

  const left = await openBrowser(main, 'W87D-PHYSICAL-A', pageUrl('W87D-PHYSICAL-A', '#1d4ed8', '#0f766e'));
  const right = await openBrowser(main, 'W87D-PHYSICAL-C', pageUrl('W87D-PHYSICAL-C', '#b45309', '#9f1239'));
  await main.evaluate(id => window.MazzShell.splitWithTab(id, 'right'), right.shellId);
  await main.waitForFunction(() => window.MazzShell.paneTree.leaves().length === 2);
  await main.waitForTimeout(300);

  const ready = await main.evaluate(() => {
    const source = [...document.querySelectorAll('.tab')].find(node => node.querySelector('.t-label')?.textContent === 'W87D-PHYSICAL-C');
    const target = window.MazzShell.paneTree.leaves()[0]?.el.querySelector('.editor-area');
    if (!source || !target) throw new Error('physical drag source/target not found');
    const s = source.getBoundingClientRect(), t = target.getBoundingClientRect();
    return {
      source: { x: Math.round(s.left + s.width / 2), y: Math.round(s.top + s.height / 2) },
      target: { x: Math.round(t.left + t.width * 0.84), y: Math.round(t.top + t.height / 2) },
      paneCount: window.MazzShell.paneTree.leaves().length,
    };
  });
  const inputLabel = INPUT_MODE === 'cdp' ? 'CDP_POINTER' : 'PHYSICAL';
  console.log(`W87D_${inputLabel}_READY ${JSON.stringify(ready)}`);

  let duringDrag = null;
  if (INPUT_MODE === 'cdp') {
    // 比 dispatchEvent 更接近用户链：由 Chromium 输入管线从真实 draggable tab 产生
    // dragstart/dragover/drop；但它仍是 CDP 注入，不冒充 Win32 SendInput 证据。
    await main.mouse.move(ready.source.x, ready.source.y);
    await main.mouse.down();
    await main.mouse.move(ready.source.x - 12, ready.source.y + 4, { steps: 4 });
    await main.mouse.move(ready.target.x, ready.target.y, { steps: 28 });
    await main.waitForFunction(() => window.__mazzSplitProxyState?.phase === 'active'
      && document.querySelectorAll('.mazz-split-surface-frame').length === 2
      && document.querySelector('.mazz-split-drag-overlay')?.getBoundingClientRect().width > 50,
    null, { timeout: 15000 });
    duringDrag = await main.evaluate(async ids => {
      const overlay = document.querySelector('.mazz-split-drag-overlay');
      const proxy = document.querySelector('.mazz-split-surface-proxy');
      const plane = document.getElementById('mazz-overlay-plane');
      const rect = overlay.getBoundingClientRect();
      return {
        phase: window.__mazzSplitProxyState?.phase,
        frames: document.querySelectorAll('.mazz-split-surface-frame').length,
        pointerEvents: getComputedStyle(proxy).pointerEvents,
        overlay: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        overlayInline: { left: overlay.style.left, top: overlay.style.top, width: overlay.style.width, height: overlay.style.height },
        zooms: {
          body: getComputedStyle(document.body).zoom,
          plane: getComputedStyle(plane).zoom,
          overlay: getComputedStyle(overlay).zoom,
          activeEditor: getComputedStyle(document.querySelector('.pane.active .editor-area')).zoom,
        },
        states: await Promise.all(ids.map(tabId => window.mazz.invoke('bv:state', { tabId }))),
      };
    }, [left.viewId, right.viewId]);
    if (duringDrag.phase !== 'active' || duringDrag.frames !== 2 || duringDrag.pointerEvents !== 'none'
        || duringDrag.overlay.width <= 50 || !duringDrag.states.every(state => state?.hidden)) {
      throw new Error(`CDP pointer drag did not enter painted proxy transaction: ${JSON.stringify(duringDrag)}`);
    }
    await main.screenshot({ path: path.join(EVIDENCE, 'W87D_BROWSER_CDP_POINTER_DURING_DRAG_HARDWARE.png') });
    await main.mouse.up();
  }

  await main.waitForFunction(() => window.MazzShell.paneTree.leaves().length === 3, null, { timeout: 120000 });
  await main.waitForFunction(() => window.__mazzSplitProxyState?.phase === 'idle'
    && !document.querySelector('.mazz-split-surface-proxy, .mazz-split-drag-overlay'), null, { timeout: 30000 });
  const result = await main.evaluate(async ids => ({
    paneCount: window.MazzShell.paneTree.leaves().length,
    owners: window.MazzShell.paneTree.leaves().filter(leaf => !!leaf.tabs.get(ids.shellId)).length,
    states: await Promise.all(ids.views.map(tabId => window.mazz.invoke('bv:state', { tabId }))),
    pixels: await Promise.all(ids.views.map(tabId => window.mazz.invoke('bv:capture', { tabId }))),
    proxy: window.__mazzSplitProxyState,
    visual: await window.mazz.invoke('visual:snapshot'),
  }), { shellId: right.shellId, views: [left.viewId, right.viewId] });
  if (result.paneCount !== 3 || result.owners !== 1
      || result.states.some(state => !state || state.hidden || state.occluded || state.bounds.width <= 2 || state.bounds.height <= 2)
      || result.pixels.some(png => typeof png !== 'string' || png.length < 1000)
      || result.visual.overlayCount !== 0 || errors.length) {
    throw new Error(`physical drag did not converge: ${JSON.stringify({ ...result, pixels: result.pixels.map(png => png?.length || 0), errors })}`);
  }
  const evidenceStem = INPUT_MODE === 'cdp'
    ? 'W87D_BROWSER_CDP_POINTER_AFTER_DROP_HARDWARE'
    : 'W87D_BROWSER_PHYSICAL_DRAG_HARDWARE';
  const screenshot = path.join(EVIDENCE, `${evidenceStem}.png`);
  await main.screenshot({ path: screenshot });
  const report = {
    ok: true,
    verdict: 'PASS',
    generatedAt: new Date().toISOString(),
    input: INPUT_MODE === 'cdp' ? 'Playwright CDP pointer path (not Win32 SendInput)' : 'Windows SendInput / physical mouse path',
    ready, paneCount: result.paneCount, owners: result.owners,
    duringDrag,
    states: result.states, pixelBytes: result.pixels.map(png => png.length),
    proxy: result.proxy, overlayCount: result.visual.overlayCount, errors: 0,
  };
  fs.writeFileSync(path.join(EVIDENCE, `${evidenceStem}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`W87D_${inputLabel}_PASS ${JSON.stringify({ paneCount: result.paneCount, owners: result.owners, pixelBytes: report.pixelBytes })}`);
} finally {
  if (app) await app.close().catch(() => {});
  for (const target of [USER_DATA, WS]) {
    const resolved = path.resolve(target), tempRoot = path.resolve(os.tmpdir());
    if (resolved.startsWith(tempRoot + path.sep) && path.basename(resolved).startsWith('mazz-w87d-physical-')) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
    }
  }
}
