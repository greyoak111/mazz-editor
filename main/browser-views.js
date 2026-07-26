// main/browser-views.js —— 浏览器视图注册表（Min 式架构：WebContentsView 由主进程持有与摆位）
// webview 标签时代的结构性病根（guest 代理层：goBack 挂起/焦点路由丢失/全屏 top-layer 怪象/拖拽事件被吞）
// 到此终结：视图即一等公民，导航/焦点/事件全走 webContents 直连，没有 shim。
'use strict';
const { WebContentsView, session } = require('electron');

class BrowserViews {
  constructor({ bus, wm, session: defaultSession }) {
    this.bus = bus;
    this.wm = wm;
    this.session = defaultSession;
    this.views = new Map(); // tabId -> { view, partition }
    this.register();
  }

  emit(tabId, type, data) {
    const win = this.wm.main;
    if (win && !win.isDestroyed()) this.bus.send(win, 'bv:event', { tabId, type, data });
  }
  get(tabId) { return this.views.get(tabId)?.view || null; }

  register() {
    const bus = this.bus;
    bus.handle('bv:create', async ({ tabId, partition, url }) => this.create(tabId, partition, url));
    bus.handle('bv:destroy', async ({ tabId }) => this.destroy(tabId));
    bus.handle('bv:bounds', async ({ tabId, rect, visible }) => this.setBounds(tabId, rect, visible));
    bus.handle('bv:focus', async ({ tabId }) => { const v = this.get(tabId); if (v) v.webContents.focus(); return !!v; });
    bus.handle('bv:nav', async ({ tabId, action, url }) => this.nav(tabId, action, url));
    bus.handle('bv:js', async ({ tabId, code, userGesture }) => {
      const v = this.get(tabId);
      if (!v) return null;
      try { return await v.webContents.executeJavaScript(code, userGesture === true); }
      catch (e) { return { __err: String(e.message || e) }; }
    });
    bus.handle('bv:zoom', async ({ tabId, factor }) => { const v = this.get(tabId); if (v && factor > 0) v.webContents.setZoomFactor(factor); return !!v; });
    bus.handle('bv:find', async ({ tabId, text, opts }) => {
      const v = this.get(tabId);
      if (!v) return null;
      if (text) return v.webContents.findInPage(text, opts || {});
      v.webContents.stopFindInPage('clearSelection');
      return null;
    });
    bus.handle('bv:navHistory', async ({ tabId }) => {
      const v = this.get(tabId);
      if (!v) return null;
      const h = v.webContents.navigationHistory;
      return { entries: h.getAllEntries(), activeIndex: h.getActiveIndex() };
    });
    bus.handle('bv:state', async ({ tabId }) => {
      const rec = this.views.get(tabId);
      if (!rec) return null;
      const wc = rec.view.webContents;
      // hidden/reviveGen 入状态：白屏复活的 E2E 探针（隐→显振荡是否按规程触发）
      return { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canBack: wc.navigationHistory.canGoBack(), canFwd: wc.navigationHistory.canGoForward(), dead: !wc.getOSProcessId(), hidden: !!rec.hidden, reviveGen: rec._reviveGen || 0, bounds: rec.view.getBounds() };
    });
  }

  create(tabId, partition, url) {
    this.destroy(tabId);
    const ses = partition ? session.fromPartition(partition) : this.session;
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, allowRunningInsecureContent: false,
        safeDialogs: true, // 页面循环 alert 收编（Min 同款基线）
        autoplayPolicy: 'user-gesture-required',
      },
    });
    this.views.set(tabId, { view, partition });
    this.wm.main.contentView.addChildView(view);
    this.wire(tabId, view);
    view.webContents.loadURL(url || 'about:blank').catch(() => {});
    return true;
  }

  destroy(tabId) {
    const rec = this.views.get(tabId);
    if (!rec) return false;
    try { this.wm.main.contentView.removeChildView(rec.view); } catch {}
    try { rec.view.webContents.close(); } catch {}
    this.views.delete(tabId);
    return true;
  }

  setBounds(tabId, rect, visible = true) {
    const rec = this.views.get(tabId);
    if (!rec) return false;
    if (!visible || !rect || rect.width < 2 || rect.height < 2) {
      rec.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      rec.view.setVisible(false);
      rec.hidden = true;
      return true;
    }
    const R = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    // 隐→显转换：Windows D3D 合成器下 WebContentsView 隐身再显示常丢 surface 不重绘（右键菜单/ribbon 弹层后白屏实锤）——
    // 恢复显示走「正矩形 + 次帧 ±1px 双帧振荡」强制重新合成（Chromium 对同值 setBounds 会跳过）
    const reviving = !!rec.hidden;
    rec.hidden = false;
    rec.view.setVisible(true);
    rec.view.setBounds(R);
    if (reviving) {
      rec._reviveGen = (rec._reviveGen || 0) + 1;
      const gen = rec._reviveGen;
      setTimeout(() => {
        if (rec._reviveGen !== gen || rec.hidden) return; // 期间又隐身/又恢复：只认最新一趟
        try { rec.view.setBounds({ ...R, width: Math.max(1, R.width - 1) }); rec.view.setBounds(R); } catch {}
      }, 60);
      setTimeout(() => { // 第二帧兜底（个别 D3D 窗口一帧不吃）
        if (rec._reviveGen !== gen || rec.hidden) return;
        try { rec.view.setBounds({ ...R, height: Math.max(1, R.height - 1) }); rec.view.setBounds(R); } catch {}
      }, 180);
    }
    return true;
  }

  async nav(tabId, action, url) {
    const v = this.get(tabId);
    if (!v) return false;
    const wc = v.webContents;
    try {
      if (action === 'load') await wc.loadURL(url).catch(() => {});
      // 本代 Chromium 的 goBack/goForward 会跳越中间条目直达首个条目（探针实锤 3→0），
      // goToOffset 行为正确（逐条进退）——导航一律走 offset 路线
      else if (action === 'back') { if (wc.navigationHistory.canGoBack()) wc.goToOffset(-1); }
      else if (action === 'forward') { if (wc.navigationHistory.canGoForward()) wc.goToOffset(1); }
      else if (action === 'reload') wc.reload();
      else if (action === 'stop') wc.stop();
      else if (action === 'offset') wc.goToOffset(url | 0);
    } catch { return false; }
    return true;
  }

  wire(tabId, view) {
    const wc = view.webContents;
    wc.on('did-navigate', (_e, url, httpResponseCode, httpStatusText) => this.emit(tabId, 'did-navigate', { url, httpResponseCode, httpStatusText }));
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => this.emit(tabId, 'did-navigate-in-page', { url, isMainFrame }));
    wc.on('page-title-updated', (_e, title) => this.emit(tabId, 'page-title-updated', { title }));
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => this.emit(tabId, 'did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame }));
    wc.on('did-stop-loading', () => this.emit(tabId, 'did-stop-loading', {}));
    wc.on('dom-ready', () => this.emit(tabId, 'dom-ready', {}));
    wc.on('render-process-gone', (_e, details) => this.emit(tabId, 'render-process-gone', { reason: details?.reason }));
    wc.on('unresponsive', () => this.emit(tabId, 'unresponsive', {}));
    wc.on('found-in-page', (_e, result) => this.emit(tabId, 'found-in-page', { result }));
    // console-message 签名版本差防御（v33 位次参数 / 后续 details 对象）
    wc.on('console-message', (...args) => {
      const message = typeof args[1] === 'string' ? args[1] : (args[1]?.message ?? args[2] ?? '');
      this.emit(tabId, 'console-message', { message });
    });
    wc.on('context-menu', (_e, params) => {
      const b = this.views.get(tabId)?.view.getBounds() || { x: 0, y: 0 };
      // 客页坐标系 → 主窗坐标系（右键菜单在主窗 DOM 里摆）
      this.emit(tabId, 'context-menu', { ...params, x: (params.x || 0) + b.x, y: (params.y || 0) + b.y });
    });
    wc.on('enter-html-full-screen', () => this.emit(tabId, 'enter-html-full-screen', {}));
    wc.on('leave-html-full-screen', () => this.emit(tabId, 'leave-html-full-screen', {}));
    wc.setWindowOpenHandler(({ url }) => {
      // 新窗审批：转渲染层在当前标签体系内开标签（防弹窗逃逸——webview 时代纪律平移）
      this.emit(tabId, 'open-url', { url });
      return { action: 'deny' };
    });
  }
}

module.exports = BrowserViews;
