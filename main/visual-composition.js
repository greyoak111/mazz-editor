'use strict';

const { BrowserWindow } = require('electron');
const { VisualCompositionKernel, normalizeBounds } = require('./visual-composition-kernel');

class VisualCompositionRuntime {
  constructor({ bus, wm = null }) {
    this.bus = bus;
    this.wm = wm;
    this.browserViews = null;
    this.panelWindows = null;
    this.kernel = new VisualCompositionKernel();
    this.sourceHooks = new Map();
    this.registerIpc();
  }

  attachWindowManager(wm) { this.wm = wm; }
  attachBrowserViews(browserViews) { this.browserViews = browserViews; }
  attachPanelWindows(panelWindows) { this.panelWindows = panelWindows; }
  isHostOccluded(hostWindowId) { return this.kernel.occlusionState(hostWindowId).occluded; }

  registerIpc() {
    this.bus.handle('visual:overlayBegin', async (payload = {}, event) => {
      const source = event?.sender;
      const host = BrowserWindow.fromWebContents(source) || this.wm?.main;
      if (!host || host.isDestroyed()) throw new Error('visual overlay host unavailable');
      if (payload.kind === 'split-drag' && !this.browserViews?.validateHostCoverage?.(host, payload.coveredViews)) {
        throw new Error('split drag proxy coverage no longer matches visible host surfaces');
      }
      this.watchSource(source);
      const state = this.kernel.beginOverlay({
        ...payload,
        hostWindowId: host.id,
        sourceWebContentsId: source?.id,
        bounds: normalizeBounds(payload.bounds),
      });
      this.applyHostOcclusion(host, state.occluded);
      return { ...state, protocol: 'mazz.visual-composition/v1' };
    });
    this.bus.handle('visual:overlayUpdate', async ({ token, bounds } = {}) => {
      return this.kernel.updateOverlay(token, { bounds: normalizeBounds(bounds) });
    });
    this.bus.handle('visual:overlayEnd', async ({ token } = {}) => {
      const state = this.kernel.endOverlay(token);
      if (state) this.applyHostOcclusion(this.windowById(state.hostWindowId), state.occluded);
      return state || { ended: false };
    });
    this.bus.handle('visual:snapshot', async () => this.snapshot());
    this.bus.handle('visual:focus', async ({ surfaceId } = {}) => this.focusSurface(surfaceId));
  }

  watchSource(webContents) {
    if (!webContents || this.sourceHooks.has(webContents.id)) return;
    const cleanup = () => this.cleanupSource(webContents.id);
    const navigation = (_event, _url, _isInPlace, isMainFrame) => { if (isMainFrame !== false) cleanup(); };
    webContents.once('destroyed', cleanup);
    webContents.on('did-start-navigation', navigation);
    this.sourceHooks.set(webContents.id, { webContents, cleanup, navigation });
  }

  cleanupSource(sourceWebContentsId) {
    const states = this.kernel.endOverlaysBySource(sourceWebContentsId);
    for (const state of states) this.applyHostOcclusion(this.windowById(state.hostWindowId), state.occluded);
    const hook = this.sourceHooks.get(sourceWebContentsId);
    if (hook) {
      try { hook.webContents.removeListener('did-start-navigation', hook.navigation); } catch {}
      this.sourceHooks.delete(sourceWebContentsId);
    }
  }

  windowById(id) {
    return BrowserWindow.getAllWindows().find(win => win.id === Number(id)) || null;
  }

  applyHostOcclusion(host, occluded) {
    if (!host || host.isDestroyed()) return;
    this.browserViews?.setHostOccluded(host, occluded);
    this.kernel.updateSurface(`window:${host.id}`, { metadata: { transientOcclusion: !!occluded } });
  }

  refreshHost(host, reason = 'native-window-transition') {
    if (!host || host.isDestroyed()) return 0;
    const changed = this.browserViews?.recomposeHost?.(host, reason) || 0;
    // Win10 合成器在子窗 show/close 的后一帧才完成 Z 序提交；第二次只做本地 invalidate/bounds 振荡，绝不 reload 网络页面。
    setTimeout(() => {
      if (!host.isDestroyed()) this.browserViews?.recomposeHost?.(host, `${reason}:settled`);
    }, 90);
    return changed;
  }

  registerWindow(win, { kind = 'window', owner = 'window-manager', layer = 'workspace' } = {}) {
    if (!win || win.isDestroyed()) return null;
    const id = `window:${win.id}`;
    this.kernel.registerSurface({
      id, kind: kind === 'panel-window' ? 'panel-window' : 'window', layer, owner,
      hostWindowId: win.getParentWindow?.()?.id || win.id,
      sourceWebContentsId: win.webContents?.id,
      bounds: win.getBounds?.(), visible: win.isVisible?.() !== false, focused: win.isFocused?.() === true,
      metadata: { nativeWindowId: win.id },
    });
    const update = () => {
      if (win.isDestroyed()) return;
      this.kernel.updateSurface(id, { bounds: win.getBounds(), visible: win.isVisible(), focused: win.isFocused() });
    };
    win.on('move', update);
    win.on('resize', update);
    win.on('show', update);
    win.on('hide', update);
    win.on('focus', update);
    win.on('blur', update);
    win.once('closed', () => this.kernel.unregisterSurface(id));
    return id;
  }

  registerPanel(win, { kind, instanceId, hostWindowId } = {}) {
    const id = this.registerWindow(win, {
      kind: 'panel-window', layer: 'system', owner: `panel:${kind || 'unknown'}${instanceId ? `:${instanceId}` : ''}`,
    });
    if (id && hostWindowId) this.kernel.updateSurface(id, { hostWindowId: Number(hostWindowId) });
    return id;
  }

  updatePanelHost(win, host) {
    if (!win || win.isDestroyed()) return null;
    return this.kernel.updateSurface(`window:${win.id}`, { hostWindowId: host?.id || null });
  }

  registerView(tabId, rec) {
    const id = `view:${String(tabId)}`;
    this.kernel.registerSurface({
      id, kind: 'web-contents-view', layer: 'native-content', owner: `browser-tab:${tabId}`,
      hostWindowId: rec?.hostWin?.id, sourceWebContentsId: rec?.view?.webContents?.id,
      bounds: rec?.view?.getBounds?.(), visible: !rec?.hidden, desiredVisible: rec?.desiredVisible !== false,
      occluded: rec?.occluded === true, metadata: { tabId: String(tabId), partition: rec?.partition || 'default' },
    });
    return id;
  }

  updateView(tabId, patch) { return this.kernel.updateSurface(`view:${String(tabId)}`, patch); }
  unregisterView(tabId) { return this.kernel.unregisterSurface(`view:${String(tabId)}`); }

  focusSurface(surfaceId) {
    const surface = this.kernel.surfaces.get(String(surfaceId || ''));
    if (!surface) return false;
    if (surface.kind === 'web-contents-view') {
      const tabId = surface.metadata?.tabId;
      const view = this.browserViews?.get(tabId);
      if (view && !view.webContents.isDestroyed()) { view.webContents.focus(); return true; }
      return false;
    }
    const win = this.windowById(surface.metadata?.nativeWindowId || surface.hostWindowId);
    if (!win || win.isDestroyed()) return false;
    win.show(); win.focus();
    return true;
  }

  snapshot() {
    const snapshot = this.kernel.snapshot();
    return {
      ...snapshot,
      invariants: {
        registeredVisualSovereignty: true,
        hostOwnedOcclusion: true,
        rendererGeometrySanitized: true,
        workaroundRemovalAuthorized: false,
      },
    };
  }
}

module.exports = VisualCompositionRuntime;
