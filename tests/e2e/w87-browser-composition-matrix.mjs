import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const ROOT = path.resolve('.');
const EXECUTABLE = process.env.MAZZ_E2E_EXECUTABLE ? path.resolve(process.env.MAZZ_E2E_EXECUTABLE) : '';
const GPU_MODE = process.env.MAZZ_BROWSER_MATRIX_GPU || 'hardware';
const RUN_TAG = String(process.env.MAZZ_BROWSER_MATRIX_RUN_TAG || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
const EVIDENCE_VARIANT = `${GPU_MODE.toUpperCase()}${RUN_TAG ? `_${RUN_TAG.toUpperCase()}` : ''}`;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87b-browser-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87b-browser-ws-'));
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence');
const logs = [];
const rendererErrors = [];
const observedPages = new WeakSet();
let app = null;

function observePage(page) {
  if (!page || observedPages.has(page)) return;
  observedPages.add(page);
  page.on('pageerror', error => rendererErrors.push(`${page.url()} pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') rendererErrors.push(`${page.url()} console.error: ${message.text()}`); });
}

const pageUrl = (label, a, b) => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<style>html,body{height:100%;margin:0;background:linear-gradient(135deg,${a},${b});color:#fff;font:700 42px system-ui}body{display:grid;place-items:center}</style>
<body><main id="marker">${label}</main><script>window.__pageMarker=${JSON.stringify(label)}</script></body>`);

function imageHealth(base64, label) {
  if (!base64 || base64.length < 1000) throw new Error(`${label} capture missing`);
  const png = PNG.sync.read(Buffer.from(base64, 'base64'));
  let white = 0, dark = 0, colorful = 0;
  for (let i = 0; i < png.data.length; i += 16) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2], a = png.data[i + 3];
    if (a < 8) continue;
    if (r > 242 && g > 242 && b > 242) white += 1;
    if (r < 28 && g < 28 && b < 28) dark += 1;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 24) colorful += 1;
  }
  const sampled = Math.max(1, Math.floor(png.data.length / 16));
  const result = { width: png.width, height: png.height, whiteRatio: white / sampled, darkRatio: dark / sampled, colorfulRatio: colorful / sampled };
  if (result.whiteRatio > 0.9 || result.colorfulRatio < 0.12) throw new Error(`${label} looks blank: ${JSON.stringify(result)}`);
  return result;
}

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
    const inst = window.MazzModules?.instances?.get(id), ctl = inst?.state;
    const tab = ctl?.tabs?.find(item => item.id === ctl.activeId) || ctl?.tabs?.[0];
    if (!tab?.viewId) return null;
    return { shellId: id, viewId: tab.viewId };
  }, shellId, { timeout: 20000 }).then(handle => handle.jsonValue());
  await page.evaluate(({ shellId, url }) => window.MazzModules.instances.get(shellId).state.openUrl(url), { shellId, url });
  await page.waitForFunction(async ({ viewId, label }) => {
    const marker = await window.mazz.invoke('bv:js', { tabId: viewId, code: 'window.__pageMarker' }).catch(() => null);
    const state = await window.mazz.invoke('bv:state', { tabId: viewId });
    return marker === label && state && !state.loading;
  }, { viewId: info.viewId, label: title }, { timeout: 20000 });
  return info;
}

async function shellWindows() {
  return app.windows().filter(page => page.url().includes('/index.html'));
}

async function waitChild(main) {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    const pages = await shellWindows();
    const child = pages.find(page => page !== main && page.url().includes('role=child'));
    if (child) {
      await child.waitForFunction(() => document.documentElement.dataset.appReady === '1' && !!window.MazzShell, null, { timeout: 20000 });
      return child;
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('workspace child did not appear');
}

async function waitPanel(kind) {
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    const panel = app.windows().find(page => page.url().includes(`/panels/${kind}.html`));
    if (panel) { await panel.waitForLoadState('domcontentloaded'); return panel; }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(`${kind} panel did not appear`);
}

async function assertMarkers(page, pairs, phase) {
  const values = await page.evaluate(async pairs => Promise.all(pairs.map(async ([id, expected]) => ({
    id, expected,
    marker: await window.mazz.invoke('bv:js', { tabId: id, code: 'window.__pageMarker' }),
    state: await window.mazz.invoke('bv:state', { tabId: id }),
  }))), pairs);
  const drifted = values.filter(value => value.marker !== value.expected);
  if (drifted.length) throw new Error(`browser marker drift at ${phase}: ${JSON.stringify(values)}`);
  return values;
}

try {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  app = await electron.launch({
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : { args: [ROOT] }),
    env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, MAZZ_GPU_MODE: GPU_MODE, NODE_ENV: 'test' },
    timeout: 120000,
  });
  app.on('window', observePage);
  const proc = app.process?.();
  proc?.stdout?.on?.('data', bytes => logs.push(String(bytes)));
  proc?.stderr?.on?.('data', bytes => logs.push(String(bytes)));

  const main = await app.firstWindow({ timeout: 120000 });
  observePage(main);
  await main.waitForFunction(() => document.documentElement.dataset.appReady === '1' && !!window.MazzShell, null, { timeout: 30000 });
  await main.evaluate(() => window.MazzBoot);
  await dismissAgreement(main);
  await app.evaluate(({ BrowserWindow }) => {
    const mainWin = BrowserWindow.getAllWindows().find(win => !win.getParentWindow() && !win.__panelKind);
    mainWin.setSize(1360, 840); mainWin.center(); mainWin.show(); mainWin.focus();
  });

  const mainA = await openBrowser(main, 'W87B-MAIN-A', pageUrl('W87B-MAIN-A', '#1d4ed8', '#0f766e'));
  const childSource = await openBrowser(main, 'W87B-CHILD-B', pageUrl('W87B-CHILD-B', '#7c3aed', '#be123c'));
  await main.evaluate(id => window.MazzShell.moveTabToNewWindow(id), childSource.shellId);
  const child = await waitChild(main);
  const childB = await child.waitForFunction(() => {
    for (const [shellId, inst] of window.MazzModules?.instances || []) {
      if (inst.name !== 'browser') continue;
      const ctl = inst.state, tab = ctl.tabs?.find(item => item.id === ctl.activeId) || ctl.tabs?.[0];
      if (tab?.viewId) return { shellId, viewId: tab.viewId };
    }
    return null;
  }, null, { timeout: 20000 }).then(handle => handle.jsonValue());
  if (mainA.viewId === childB.viewId) throw new Error(`cross-window WebContentsView id collision: ${mainA.viewId}`);
  const hostIds = await app.evaluate(({ BrowserWindow }) => {
    const shells = BrowserWindow.getAllWindows().filter(win => !win.__panelKind && win.webContents.getURL().includes('/index.html'));
    return shells.map(win => ({ id: win.id, role: win.webContents.getURL().includes('role=child') ? 'child' : 'main' }));
  });
  const mainStateAfterChild = await main.evaluate(id => window.mazz.invoke('bv:state', { tabId: id }), mainA.viewId);
  const mainHost = hostIds.find(item => item.role === 'main')?.id;
  if (!mainStateAfterChild || mainStateAfterChild.hostWindowId !== mainHost) throw new Error(`main browser ownership lost after child: ${JSON.stringify({ mainA, mainStateAfterChild, hostIds })}`);
  const mainMarker = await main.evaluate(id => window.mazz.invoke('bv:js', { tabId: id, code: 'window.__pageMarker' }), mainA.viewId);
  const childMarker = await child.evaluate(id => window.mazz.invoke('bv:js', { tabId: id, code: 'window.__pageMarker' }), childB.viewId);
  if (mainMarker !== 'W87B-MAIN-A' || childMarker !== 'W87B-CHILD-B') throw new Error(`handoff markers drifted: ${JSON.stringify({ mainMarker, childMarker })}`);

  // 真实“子窗盖顶”循环：主/子工作台交替置顶，两个独立宿主的 WCV 都不得被对方销毁、隐藏或写回旧几何。
  const focusCycles = [];
  for (let cycle = 1; cycle <= 5; cycle++) {
    for (const role of ['main', 'child']) {
      await app.evaluate(({ BrowserWindow }, target) => {
        const win = BrowserWindow.getAllWindows().find(item => !item.__panelKind
          && item.webContents.getURL().includes('/index.html')
          && (item.webContents.getURL().includes('role=child') ? 'child' : 'main') === target);
        if (!win) throw new Error(`missing ${target} workspace window`);
        win.show(); win.focus();
      }, role);
      await main.waitForTimeout(70);
    }
    const mainCycle = await assertMarkers(main, [[mainA.viewId, 'W87B-MAIN-A']], `focus-cycle-${cycle}-main`);
    const childCycle = await assertMarkers(child, [[childB.viewId, 'W87B-CHILD-B']], `focus-cycle-${cycle}-child`);
    if (mainCycle[0].state.hidden || childCycle[0].state.hidden) throw new Error(`focus cycle hid a live browser: ${JSON.stringify({ cycle, mainCycle, childCycle })}`);
    focusCycles.push({ cycle, mainCompositionGen: mainCycle[0].state.compositionGen, childCompositionGen: childCycle[0].state.compositionGen });
  }

  const mainC = await openBrowser(main, 'W87B-MAIN-C', pageUrl('W87B-MAIN-C', '#b45309', '#9f1239'));
  await assertMarkers(main, [[mainA.viewId, 'W87B-MAIN-A'], [mainC.viewId, 'W87B-MAIN-C']], 'after-open-C');
  await main.evaluate(id => window.MazzShell.splitWithTab(id, 'right'), mainC.shellId);
  await main.waitForFunction(() => document.querySelectorAll('.pane').length >= 2);
  await assertMarkers(main, [[mainA.viewId, 'W87B-MAIN-A'], [mainC.viewId, 'W87B-MAIN-C']], 'after-initial-split');
  await main.evaluate(async ids => {
    await window.mazz.invoke('bv:js', { tabId: ids[0], code: 'window.__splitKeep="A"' });
    await window.mazz.invoke('bv:js', { tabId: ids[1], code: 'window.__splitKeep="C"' });
  }, [mainA.viewId, mainC.viewId]);

  await main.evaluate(({ shellId }) => {
    const leaf = window.MazzShell.paneTree.leaves()[0];
    const target = leaf.el.querySelector('.editor-area');
    const rect = target.getBoundingClientRect();
    const tab = [...document.querySelectorAll('.tab')].find(node => node.querySelector('.t-label')?.textContent === 'W87B-MAIN-C');
    if (!tab) throw new Error('drag source tab missing');
    const dt = new DataTransfer(); dt.setData('mazz/tab', shellId);
    tab.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('dragover', {
      dataTransfer: dt, clientX: rect.left + rect.width * 0.84, clientY: rect.top + rect.height * 0.5,
      bubbles: true, cancelable: true,
    }));
    window.__w87bDrag = { dt, target, x: rect.left + rect.width * 0.84, y: rect.top + rect.height * 0.5 };
  }, { shellId: mainC.shellId });
  await main.waitForTimeout(250);
  const duringDrag = await main.evaluate(async ids => ({
    states: await Promise.all(ids.map(id => window.mazz.invoke('bv:state', { tabId: id }))),
    visual: await window.mazz.invoke('visual:snapshot'),
    renderer: window.MazzVisualComposition.snapshot(),
  }), [mainA.viewId, mainC.viewId]);
  if (!duringDrag.states.every(state => state?.hidden)) throw new Error(`drag did not cloak every browser in host: ${JSON.stringify(duringDrag)}`);
  if (!duringDrag.visual.hosts.some(host => host.hostWindowId === mainHost && host.occluded)) throw new Error(`split drag missing host occlusion token: ${JSON.stringify(duringDrag.visual)}`);
  await main.screenshot({ path: path.join(EVIDENCE, `W87B_BROWSER_DRAG_${EVIDENCE_VARIANT}.png`) });

  await main.evaluate(() => {
    const drag = window.__w87bDrag;
    drag.target.dispatchEvent(new DragEvent('drop', { dataTransfer: drag.dt, clientX: drag.x, clientY: drag.y, bubbles: true, cancelable: true }));
  });
  await main.waitForFunction(async ids => {
    const states = await Promise.all(ids.map(id => window.mazz.invoke('bv:state', { tabId: id })));
    const visual = await window.mazz.invoke('visual:snapshot');
    return states.every(state => state && !state.hidden && !state.occluded && state.bounds.width > 100) && visual.overlayCount === 0;
  }, [mainA.viewId, mainC.viewId], { timeout: 15000 });
  await assertMarkers(main, [[mainA.viewId, 'W87B-MAIN-A'], [mainC.viewId, 'W87B-MAIN-C']], 'after-drag-split');
  const keep = await main.evaluate(async ids => Promise.all(ids.map(id => window.mazz.invoke('bv:js', { tabId: id, code: 'window.__splitKeep' }))), [mainA.viewId, mainC.viewId]);
  if (keep[0] !== 'A' || keep[1] !== 'C') throw new Error(`split migration reloaded page state: ${JSON.stringify(keep)}`);
  const geometry = await main.evaluate(async ids => {
    const expected = {};
    for (const [, inst] of window.MazzModules.instances) {
      if (inst.name !== 'browser') continue;
      for (const tab of inst.state.tabs || []) if (ids.includes(tab.viewId)) {
        const b = tab.host.getBoundingClientRect(); expected[tab.viewId] = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
      }
    }
    const actual = Object.fromEntries(await Promise.all(ids.map(async id => [id, (await window.mazz.invoke('bv:state', { tabId: id })).bounds])));
    return { expected, actual };
  }, [mainA.viewId, mainC.viewId]);
  for (const id of [mainA.viewId, mainC.viewId]) {
    const a = geometry.actual[id], e = geometry.expected[id];
    if (!a || !e || Math.max(...['x', 'y', 'width', 'height'].map(key => Math.abs(a[key] - e[key]))) > 2) throw new Error(`stale native bounds after split for ${id}: ${JSON.stringify({ a, e })}`);
  }

  await child.evaluate(() => window.mazz.invoke('panel:open', { kind: 'settings' }));
  const settings = await waitPanel('settings');
  const topology = await app.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find(win => win.__panelKind === 'settings');
    return panel ? { parentId: panel.getParentWindow()?.id, hostId: panel.__panelHost?.id, visible: panel.isVisible() } : null;
  });
  const childHost = hostIds.find(item => item.role === 'child')?.id;
  if (!topology?.visible || topology.parentId !== childHost || topology.hostId !== childHost) throw new Error(`settings did not top the child host: ${JSON.stringify({ topology, hostIds })}`);
  const childUnderPanel = await child.evaluate(async id => ({
    marker: await window.mazz.invoke('bv:js', { tabId: id, code: 'window.__pageMarker' }),
    state: await window.mazz.invoke('bv:state', { tabId: id }),
  }), childB.viewId);
  const panelReady = await settings.evaluate(() => ({
    readyState: document.readyState,
    textLength: (document.body?.innerText || '').trim().length,
    background: getComputedStyle(document.body).backgroundColor,
  }));
  if (childUnderPanel.marker !== 'W87B-CHILD-B' || childUnderPanel.state?.hidden || panelReady.readyState !== 'complete' || panelReady.textLength < 20) {
    throw new Error(`child/panel top composition unhealthy: ${JSON.stringify({ childUnderPanel, panelReady })}`);
  }
  // 先挂关闭监听再发 IPC；panel:close 在主进程内同步 close，反序会错过已发生的 close 事件。
  const settingsClosed = settings.waitForEvent('close', { timeout: 8000 });
  await child.evaluate(() => window.mazz.invoke('panel:close', { kind: 'settings' }));
  await settingsClosed;
  await child.waitForTimeout(180);
  const focused = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id || null);
  if (focused !== childHost) throw new Error(`panel close focused wrong host: ${JSON.stringify({ focused, childHost, mainHost })}`);
  const childKeep = await child.evaluate(id => window.mazz.invoke('bv:js', { tabId: id, code: 'window.__pageMarker' }), childB.viewId);
  if (childKeep !== 'W87B-CHILD-B') throw new Error(`child browser blanked after panel cover: ${childKeep}`);

  const captures = {};
  for (const [label, page, id] of [['mainA', main, mainA.viewId], ['mainC', main, mainC.viewId], ['childB', child, childB.viewId]]) {
    const frame = await page.evaluate(viewId => window.mazz.invoke('bv:capture', { tabId: viewId }), id);
    if (frame) fs.writeFileSync(path.join(EVIDENCE, `W87B_BROWSER_SURFACE_${label.toUpperCase()}_${EVIDENCE_VARIANT}.png`), Buffer.from(frame, 'base64'));
    captures[label] = imageHealth(frame, label);
  }
  await main.screenshot({ path: path.join(EVIDENCE, `W87B_BROWSER_MAIN_${EVIDENCE_VARIANT}.png`) });
  await child.screenshot({ path: path.join(EVIDENCE, `W87B_BROWSER_CHILD_${EVIDENCE_VARIANT}.png`) });
  const fatal = logs.filter(line => /uncaught|unhandled|TypeError|ReferenceError|SyntaxError|FATAL|\bError\b/i.test(line) && !/ERR_ABORTED|favicon/i.test(line));
  if (fatal.length || rendererErrors.length) throw new Error(`runtime errors: ${JSON.stringify({ fatal, rendererErrors }).slice(0, 4000)}`);
  const report = { generatedAt: new Date().toISOString(), runtimeMode: EXECUTABLE ? 'packaged' : 'source', gpuMode: GPU_MODE, runTag: RUN_TAG || null, hostIds, ids: { mainA: mainA.viewId, mainC: mainC.viewId, childB: childB.viewId }, focusCycles, duringDrag, geometry, topology, childUnderPanel, panelReady, focusedAfterPanelClose: focused, captures, fatalMainLogs: 0, rendererErrors: 0 };
  fs.writeFileSync(path.join(EVIDENCE, `W87B_BROWSER_COMPOSITION_${report.runtimeMode.toUpperCase()}_${EVIDENCE_VARIANT}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, runtimeMode: report.runtimeMode, gpuMode: GPU_MODE, runTag: report.runTag, ids: report.ids, captures }));
} finally {
  if (app) await app.close().catch(() => {});
  for (const target of [USER_DATA, WS]) {
    const resolved = path.resolve(target), tempRoot = path.resolve(os.tmpdir());
    if (resolved.startsWith(tempRoot + path.sep) && path.basename(resolved).startsWith('mazz-w87b-')) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
    }
  }
}
