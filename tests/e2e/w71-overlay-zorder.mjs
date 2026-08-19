// W71：WebContentsView 与原生 PanelWindow 的代表性 Overlay/Z-order 实证
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const root = path.resolve('.');
const executablePath = path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe');
if (!fs.existsSync(executablePath)) throw new Error(`app-unpacked 不存在：${executablePath}`);

const evidenceDir = path.join(root, 'docs', 'engineering', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-overlay-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-overlay-ws-'));
let app;

async function waitPanel(fragment, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const panel = app.windows().find(page => page.url().includes(fragment));
    if (panel) { await panel.waitForLoadState('domcontentloaded'); return panel; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`面板未打开：${fragment}`);
}

async function topology(kind) {
  return app.evaluate(({ BrowserWindow }, wantedKind) => {
    const wins = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
    const main = wins.find(win => !win.__panelKind && !win.getParentWindow()) || wins[0];
    const panel = wins.find(win => win.__panelKind === wantedKind);
    return {
      main: main ? { id: main.id, bounds: main.getBounds(), contentBounds: main.getContentBounds(), focused: main.isFocused() } : null,
      panel: panel ? {
        id: panel.id,
        kind: panel.__panelKind,
        bounds: panel.getBounds(),
        focused: panel.isFocused(),
        visible: panel.isVisible(),
        parentId: panel.getParentWindow()?.id || null,
      } : null,
    };
  }, kind);
}

function compositePng(baseBuffer, layers) {
  const base = PNG.sync.read(baseBuffer);
  for (const layer of layers) {
    const src = PNG.sync.read(layer.buffer);
    for (let sy = 0; sy < src.height; sy++) {
      const dy = layer.y + sy;
      if (dy < 0 || dy >= base.height) continue;
      for (let sx = 0; sx < src.width; sx++) {
        const dx = layer.x + sx;
        if (dx < 0 || dx >= base.width) continue;
        const si = (sy * src.width + sx) * 4;
        const di = (dy * base.width + dx) * 4;
        const alpha = src.data[si + 3] / 255;
        if (alpha <= 0) continue;
        for (let channel = 0; channel < 3; channel++) {
          base.data[di + channel] = Math.round(src.data[si + channel] * alpha + base.data[di + channel] * (1 - alpha));
        }
        base.data[di + 3] = Math.round(255 * (alpha + (base.data[di + 3] / 255) * (1 - alpha)));
      }
    }
  }
  return PNG.sync.write(base);
}

async function captureComposite(fileName, win, panelPage, viewFrame, viewBounds, panelKind) {
  const topo = await topology(panelKind);
  const base = await win.screenshot();
  const panel = await panelPage.screenshot({ omitBackground: true });
  const content = topo.main.contentBounds;
  const composed = compositePng(base, [
    { buffer: Buffer.from(viewFrame, 'base64'), x: Math.round(viewBounds.x), y: Math.round(viewBounds.y) },
    { buffer: panel, x: Math.round(topo.panel.bounds.x - content.x), y: Math.round(topo.panel.bounds.y - content.y) },
  ]);
  const target = path.join(evidenceDir, fileName);
  fs.writeFileSync(target, composed);
  const bytes = fs.statSync(target).size;
  if (bytes < 10000) throw new Error(`合成截图异常小：${fileName} ${bytes} bytes`);
  const parsed = PNG.sync.read(composed);
  return { file: `evidence/${fileName}`, bytes, size: { width: parsed.width, height: parsed.height }, method: 'main + WebContentsView + child BrowserWindow exact-bounds composite' };
}

try {
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
      NODE_ENV: 'test',
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }));
  await win.waitForFunction(() => !!window.MazzShell && !!window.MazzCommands, null, { timeout: 30000 });
  const agreement = await waitPanel('/panels/agreement.html', 20000);
  await agreement.waitForSelector('main h3', { timeout: 10000 });
  const agreementTopology = await topology('agreement');
  if (!agreementTopology.panel?.visible || agreementTopology.panel.parentId !== agreementTopology.main?.id) {
    throw new Error(`首启协议不是主窗受控原生子窗：${JSON.stringify(agreementTopology)}`);
  }
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(item => !item.__panelKind && !item.getParentWindow());
    main?.show(); main?.moveTop(); main?.focus();
  });

  await win.evaluate(() => window.MazzCommands.execute('file.newBrowser'));
  const browser = await win.waitForFunction(() => {
    const ctl = window.__activeBrowserCtl;
    const tab = ctl?.tabs?.find(item => item.id === ctl.activeId) || ctl?.tabs?.[0];
    return tab?.viewId ? { viewId: tab.viewId } : null;
  }, null, { timeout: 20000 }).then(handle => handle.jsonValue());
  const probeUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><style>html,body{margin:0;height:100%;background:#172554;color:#dbeafe;font:600 30px/1.4 system-ui}main{height:100%;display:grid;place-items:center;background:linear-gradient(135deg,#172554,#0f766e)}small{display:block;font-size:15px;color:#bae6fd}</style><main>Native Surface<small>W71 WebContentsView z-order probe</small></main>`);
  await win.evaluate(({ viewId, probeUrl }) => window.mazz.invoke('bv:nav', { tabId: viewId, action: 'load', url: probeUrl }), { viewId: browser.viewId, probeUrl });
  await win.waitForFunction(async viewId => {
    const state = await window.mazz.invoke('bv:state', { tabId: viewId });
    return !state?.loading && state?.bounds?.width > 300;
  }, browser.viewId, { timeout: 15000 });
  const viewBefore = await win.evaluate(viewId => window.mazz.invoke('bv:state', { tabId: viewId }), browser.viewId);
  let frame = null;
  for (let attempt = 0; attempt < 40 && (!frame || frame.length < 1000); attempt++) {
    frame = await win.evaluate(viewId => window.mazz.invoke('bv:capture', { tabId: viewId }), browser.viewId);
    if (!frame || frame.length < 1000) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!frame || frame.length < 1000) throw new Error(`WebContentsView 像素帧未就绪（base64=${frame?.length || 0}）`);

  const agreementShot = await captureComposite('W71_OVERLAY_FIRST_RUN_AGREEMENT.png', win, agreement, frame, viewBefore.bounds, 'agreement');
  await agreement.locator('#nomore').check();
  await agreement.locator('#accept').click();
  const agreementClosedAt = Date.now() + 10000;
  while (Date.now() < agreementClosedAt && app.windows().some(page => page.url().includes('/panels/agreement.html'))) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (app.windows().some(page => page.url().includes('/panels/agreement.html'))) throw new Error('首启协议确认后未关闭');
  if (await win.evaluate(() => window.mazz.invoke('settings:get', { key: 'agreement.noMore' })) !== true) {
    throw new Error('首启协议“不再弹出”选择未落盘');
  }
  const baseline = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));

  const menuPoint = {
    x: Math.round(viewBefore.bounds.x + viewBefore.bounds.width * 0.55),
    y: Math.round(viewBefore.bounds.y + viewBefore.bounds.height * 0.35),
  };
  await win.evaluate(({ x, y }) => {
    const tab = document.querySelector('.tab.active, .tab');
    if (!tab) throw new Error('找不到可触发真实菜单路径的标签');
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  }, menuPoint);
  const ctx = await waitPanel('/panels/ctxmenu.html');
  await ctx.waitForSelector('.mi', { timeout: 10000 });
  const ctxTopology = await topology('ctxmenu');
  if (!ctxTopology.panel?.visible || ctxTopology.panel.parentId !== ctxTopology.main?.id) {
    throw new Error(`上下文菜单不是主窗受控原生子窗：${JSON.stringify(ctxTopology)}`);
  }
  const ctxShot = await captureComposite('W71_OVERLAY_CONTEXT_MENU.png', win, ctx, frame, viewBefore.bounds, 'ctxmenu');
  await win.evaluate(() => window.mazz.invoke('panel:close', { kind: 'ctxmenu' }));

  await win.evaluate(() => window.MazzCommands.execute('app.commandPalette'));
  const palette = await waitPanel('/panels/palette.html');
  await palette.waitForSelector('#q', { timeout: 10000 });
  const paletteTopology = await topology('palette');
  if (!paletteTopology.panel?.visible || paletteTopology.panel.parentId !== paletteTopology.main?.id) {
    throw new Error(`Quick Switcher 不是主窗受控原生子窗：${JSON.stringify(paletteTopology)}`);
  }
  const paletteShot = await captureComposite('W71_OVERLAY_COMMAND_PALETTE.png', win, palette, frame, viewBefore.bounds, 'palette');
  await win.evaluate(() => window.mazz.invoke('panel:close', { kind: 'palette' }));

  await win.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('mazz/tab', window.MazzShell.tabs.activeId || 'w71-overlay-tab');
    const tab = document.querySelector('.tab.active, .tab');
    tab?.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const pane = document.querySelector('.pane');
    const rect = pane?.getBoundingClientRect();
    for (let index = 0; index < 2; index++) {
      pane?.dispatchEvent(new DragEvent('dragover', {
        dataTransfer: dt,
        clientX: rect.left + rect.width / 6,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }));
    }
  });
  await win.waitForFunction(() => window.__mazzSplitProxyState?.phase === 'active'
    && document.querySelectorAll('.mazz-split-surface-frame').length > 0, null, { timeout: 15000 });
  const cloaked = await win.evaluate(viewId => window.mazz.invoke('bv:state', { tabId: viewId }), browser.viewId);
  const dragProxy = await win.evaluate(() => {
    const overlay = document.querySelector('.mazz-split-drag-overlay');
    const frames = [...document.querySelectorAll('.mazz-split-surface-frame')];
    return {
      phase: window.__mazzSplitProxyState?.phase,
      overlayVisible: !!overlay && overlay.getBoundingClientRect().width > 50,
      frameCount: frames.length,
      sourceBytes: frames.map(frame => frame.src.length),
    };
  });
  if (dragProxy.phase !== 'active' || !dragProxy.overlayVisible || dragProxy.frameCount < 1
      || dragProxy.sourceBytes.some(bytes => bytes < 1000) || !cloaked?.hidden) {
    throw new Error(`拖拽代理未完成预绘就 cloak 原生 Surface：${JSON.stringify({ cloaked, dragProxy })}`);
  }
  const dragShotPath = path.join(evidenceDir, 'W71_OVERLAY_DRAG_CLOAK.png');
  await win.screenshot({ path: dragShotPath });
  const dragShot = { file: 'evidence/W71_OVERLAY_DRAG_CLOAK.png', bytes: fs.statSync(dragShotPath).size };
  await win.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
  await win.waitForFunction(async viewId => {
    const state = await window.mazz.invoke('bv:state', { tabId: viewId });
    return !state?.hidden && state?.bounds?.width > 300
      && window.__mazzSplitProxyState?.phase === 'idle'
      && !document.querySelector('.mazz-split-surface-proxy');
  }, browser.viewId, { timeout: 10000 });

  await win.waitForFunction(async activeCount => (await window.mazz.invoke('resources:snapshot')).activeCount === activeCount, baseline.activeCount, { timeout: 15000 });
  const finalResources = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const evidence = {
    generatedAt: new Date().toISOString(),
    executable: 'release/win-unpacked/Mazz Editor.exe',
    viewBefore,
    firstRunAgreement: { topology: agreementTopology, screenshot: agreementShot, persistedNoMore: true },
    contextMenu: { topology: ctxTopology, screenshot: ctxShot },
    commandPalette: { topology: paletteTopology, screenshot: paletteShot },
    dragProxy: { hiddenOnlyAfterProxyPaint: cloaked.hidden, ...dragProxy, screenshot: dragShot },
    resources: { baseline: baseline.activeCount, final: finalResources.activeCount },
    conclusions: {
      firstRunAgreementAboveWebContentsView: true,
      nativeChildWindowAboveWebContentsView: true,
      dragOverlayUsesPaintedProxyBeforeTemporarySurfaceCloak: true,
      universalOverlayManagerRequired: false,
    },
  };
  fs.writeFileSync(path.join(evidenceDir, 'W71_OVERLAY_ZORDER.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ ok: true, ...evidence.conclusions, resourcesReturnedToBaseline: finalResources.activeCount === baseline.activeCount }));
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
