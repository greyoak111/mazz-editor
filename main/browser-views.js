// main/browser-views.js —— 浏览器视图注册表（Min 式架构：WebContentsView 由主进程持有与摆位）
// webview 标签时代的结构性病根（guest 代理层：goBack 挂起/焦点路由丢失/全屏 top-layer 怪象/拖拽事件被吞）
// 到此终结：视图即一等公民，导航/焦点/事件全走 webContents 直连，没有 shim。
'use strict';
const { WebContentsView, BrowserWindow, session, Menu } = require('electron');

class BrowserViews {
  // 静态注册表（照 PanelWindows.all 模式）：实例跨函数作用域可达——
  // theme:broadcast 句柄与装配点不在同一函数体，局部 const 必 ReferenceError（真机实锤）
  static all = new Set();

  constructor({ bus, wm, session: defaultSession, pwList = null, themeId = null, resourceLedger = null }) {
    this.bus = bus;
    this.wm = wm;
    this.session = defaultSession;
    this.pwList = pwList || (() => []); // W48：自动填充/修改识别取数口（主进程注入，渲染永不触密钥）
    this.themeId = themeId || (() => null); // W52④ devtools 主题取数口（app 主题 id）
    this.resourceLedger = resourceLedger;
    this.views = new Map(); // tabId -> { view, partition }
    this._dtThemed = new WeakSet(); // devtools 主题已注的 wc（每 wc 只注一趟）
    BrowserViews.all.add(this);
    this.register();
  }

  emit(tabId, type, data) {
    const win = this.wm.main;
    if (win && !win.isDestroyed()) this.bus.send(win, 'bv:event', { tabId, type, data });
  }
  get(tabId) { return this.views.get(tabId)?.view || null; }

  register() {
    const bus = this.bus;
    // 视图宿主化①（新窗格「中间一小块」实锤：全宇宙只认 wm.main 一宿主）——
    // 按调用窗挂宿主：哪个窗的渲染层喊 create，就挂哪个窗的 contentView（主窗/分窗子窗各归其位）
    bus.handle('bv:create', async ({ tabId, partition, url }, event) => {
      const hostWin = BrowserWindow.fromWebContents(event?.sender) || this.wm.main;
      return this.create(tabId, partition, url, hostWin);
    });
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
    // E2E 探针口：渲染层触发主进程 emit（ctx-action 回派链全链验证用）
    bus.handle('bv:emitTest', async ({ tabId, type, data }) => { this.emit(tabId, type, data || {}); return true; });
    // E2E 探针口：直接调菜单构建弹出（CDP 合成输入进不了 WebContentsView 客页（独立 webContents）——
    // 真实右键=OS 事件 hit test 分发可进，E2E 只能经此口驱动同一函数）
    bus.handle('bv:ctxMenu', async ({ tabId, x, y }) => { this.showCtxMenu(tabId, { x: x || 0, y: y || 0, mediaType: 'none' }); return true; });
    bus.handle('bv:devtools', async ({ tabId }) => {
      const rec = this.views.get(tabId);
      if (!rec) return false;
      const wc = rec.view.webContents;
      if (wc.isDevToolsOpened()) { wc.closeDevTools(); return true; }
      wc.openDevTools({ mode: 'detach' });
      this.syncDevToolsTheme(wc).catch(() => {}); // W52④ devtools 主题跟随（三铁律③）
      return true;
    });
    // E2E 探针口：devtools 主题注入链逐步验尸（错误不许吞——catch 静默=排障睁眼瞎）
    bus.handle('bv:dtProbe', async ({ tabId }) => {
      const rec = this.views.get(tabId);
      if (!rec) return { err: 'no rec' };
      const dwc = rec.view.webContents.devToolsWebContents;
      if (!dwc) return { err: 'no dwc' };
      const out = { steps: [] };
      try { if (!dwc.debugger.isAttached()) dwc.debugger.attach('1.3'); out.steps.push('attach ok'); }
      catch (e) { out.steps.push('attach: ' + e.message); }
      try {
        await dwc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
        out.steps.push('cmd ok');
      } catch (e) { out.steps.push('cmd: ' + e.message); }
      try { out.mm = await dwc.executeJavaScript(`matchMedia('(prefers-color-scheme: dark)').matches`); }
      catch (e) { out.mmErr = String(e.message); }
      try { out.bg = await dwc.executeJavaScript(`getComputedStyle(document.body).backgroundColor`); }
      catch (e) { out.bgErr = String(e.message); }
      return out;
    });
    // E2E 抓帧口：视图内容像素级验收（白屏判定的唯一硬指标——DOM 断言够不着 WebContentsView 独立 webContents）
    bus.handle('bv:capture', async ({ tabId }) => {
      const v = this.get(tabId);
      if (!v) return null;
      try { const img = await v.webContents.capturePage(); return img.toPNG().toString('base64'); }
      catch { return null; }
    });
    bus.handle('bv:state', async ({ tabId }) => {
      const rec = this.views.get(tabId);
      if (!rec) return null;
      const wc = rec.view.webContents;
      // hidden/reviveGen/lastCtxMenuAt 入状态：白屏复活的 E2E 探针（隐→显振荡规程 + 原生菜单弹出时间戳）
      return { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canBack: wc.navigationHistory.canGoBack(), canFwd: wc.navigationHistory.canGoForward(), dead: !wc.getOSProcessId(), hidden: !!rec.hidden, reviveGen: rec._reviveGen || 0, bounds: rec.view.getBounds(), lastCtxMenuAt: rec._lastCtxMenuAt || 0, invalidateCount: rec._invalidateCount || 0 };
    });
  }

  create(tabId, partition, url, hostWin = null) {
    this.destroy(tabId, 'replaced');
    const host = hostWin || this.wm.main;
    const ses = partition ? session.fromPartition(partition) : this.session;
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, allowRunningInsecureContent: false,
        safeDialogs: true, // 页面循环 alert 收编（Min 同款基线）
        autoplayPolicy: 'user-gesture-required',
        // W52 地基回正：回归原生渲染（零拷贝——离屏弯路的 GPU→CPU→IPC 三重税全退）。
        // 永久反节流：遮挡剔除「面板在页面白」的误杀连根拔（deepseek 实锤方一——不设开关直接永开）
        backgroundThrottling: false,
      },
    });
    const rec = { view, partition, hostWin: host, resourceKey: null };
    this.views.set(tabId, rec); // hostWin=视图宿主窗（跨窗迁/收尸凭据）
    if (this.resourceLedger) {
      try {
        rec.resourceKey = this.resourceLedger.register({
          type: 'web-contents-view', id: String(tabId), owner: `browser-tab:${tabId}`,
          meta: { partition: partition || 'default', hostWindowId: host?.id || null },
        });
      } catch (error) {
        console.warn('[resources] WebContentsView 登记失败:', error.message || error);
      }
    }
    host.contentView.addChildView(view);
    this.wire(tabId, view);
    view.webContents.once('destroyed', () => {
      if (this.views.get(tabId) === rec) this.views.delete(tabId);
      this._releaseResource(rec, 'web-contents-destroyed');
    });
    // 帧率不设限=显示器 v-sync 自适应（用户定版：setFrameRate 只对离屏生效，原生模式合成器直管——一个闸不留）
    view.webContents.loadURL(url || 'about:blank').catch(() => {});
    return true;
  }

  /** 宿主死亡收尸：子窗 closed → 挂在它上面的视图全灭（宿主没了视图不能活——分窗幽灵同治） */
  destroyByHost(win) {
    for (const [tabId, rec] of this.views) {
      if (rec.hostWin === win) this.destroy(tabId, 'host-window-closed');
    }
  }

  _releaseResource(rec, reason) {
    if (!rec?.resourceKey || !this.resourceLedger) return;
    this.resourceLedger.release(rec.resourceKey, { reason });
    rec.resourceKey = null;
  }

  destroy(tabId, reason = 'destroyed') {
    const rec = this.views.get(tabId);
    if (!rec) return false;
    this.views.delete(tabId);
    try { (rec.hostWin || this.wm.main).contentView.removeChildView(rec.view); } catch {}
    try { rec.view.webContents.close(); } catch {}
    this._releaseResource(rec, reason);
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
      // 强制全量重绘（Electron 官方 invalidate API——deepseek 点醒：这才是恢复丢 surface 的正药，
      // 比 ±1px 振荡治本；振荡保留为双保险）
      try { rec.view.webContents.invalidate(); rec._invalidateCount = (rec._invalidateCount || 0) + 1; } catch {}
    }
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

  /** 右键菜单原生 popup（独立合成层——根治：DOM 菜单→遮挡隐身→恢复丢 surface 的白屏（真机实锤）。
   *  原生菜单由 Chromium 独立 surface 绘制，WebContentsView 全程不隐身=白屏源头切除；
   *  动作统一走 ctx-action 回渲染层 MazzCommands（命令实现零重写）。
   *  抽出成独立方法：wc context-menu 与 bv:ctxMenu（E2E 探针）共用。 */
  showCtxMenu(tabId, params = {}) {
    const rec = this.views.get(tabId);
    const b = rec?.view.getBounds() || { x: 0, y: 0 };
    const act = (command, extra = {}) => () => this.emit(tabId, 'ctx-action', { command, params, ...extra });
    const items = [
      { label: '后退', click: act('browser.navBack') },
      { label: '前进', click: act('browser.navForward') },
      { label: '刷新', click: act('browser.navReload') },
      { type: 'separator' },
      { label: '收藏', click: act('browser.bookmark') },
      { label: '页面存为笔记（剪藏）', click: act('browser.pageToLibrary') },
      { label: '填充账号密码', click: act('browser.fillPassword') },
      { label: '开发者工具', click: act('browser.devtools') },
      { label: '复制页面地址', click: act('browser.copyUrl') },
      { label: '密码管理器', click: act('browser.passwordManager') },
    ];
    if ((params.selectionText || '').trim()) {
      items.push({ type: 'separator' });
      items.push({ label: '摘录到笔记', click: act('browser.clipToNote') });
      items.push({ label: 'SearXNG 搜索选中内容', click: act('browser.searchSelection') });
    }
    // deepseek 弹药：弹出延迟到下一帧，给渲染器绘制当前帧的时间
    setTimeout(() => {
      try {
        if (!this.views.get(tabId)) return;
        rec._lastCtxMenuAt = Date.now(); // E2E 探针（bv:state 读）
        Menu.buildFromTemplate(items).popup({ window: this.wm.main, x: Math.round((params.x || 0) + b.x), y: Math.round((params.y || 0) + b.y) });
      } catch {}
    }, 16);
  }

  /** 站点匹配（与渲染层 fillPassword 同款宽松规则） */
  pwMatch(host) {
    host = String(host || '').toLowerCase();
    if (!host) return [];
    return (this.pwList() || []).filter(e => {
      const s = (e.site || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
      return s && (host === s || host.endsWith('.' + s) || host.includes(s) || s.includes(host));
    });
  }
  /** 自动填充（W48 Edge 同款：有库存站点静默填充——空字段才填，用户已输入不动） */
  autofillPw(wc) {
    const list = (this.pwList() || []);
    if (!list.length) return;
    // 单趟执行（与密码钩/bv:js 手动填充同机理——唯一被实证可行的通道）：
    // 域名匹配也在页内做（did-frame-finish-load 瞬间 getURL/location 外查全是暂态不可信——三枚实锤）
    wc.executeJavaScript(`(function(){
      try {
        var host = (location.hostname || '').toLowerCase();
        if (!host) return 'no-host';
        var list = ${JSON.stringify(list)};
        var m = null;
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          var s = (e.site || '').toLowerCase().replace(/^https?:\\/\\//, '').replace(/^www\./, '');
          if (s && (host === s || host.endsWith('.' + s) || host.includes(s) || s.includes(host))) { m = e; break; }
        }
        if (!m) return 'no-match:' + host;
        var pw = document.querySelector('input[type=password]');
        if (!pw || pw.value) return 'skip';
        var scope = pw.closest('form') || document;
        var user = scope.querySelector('input[type=email],input[type=tel],input[name*=user i],input[name*=account i],input[name*=login i],input[name*=mail i],input[type=text],input:not([type])');
        function setVal(el, v) { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
        if (user && !user.value) setVal(user, m.username || '');
        setVal(pw, m.password || '');
        return 'ok';
      } catch (e) { return 'err:' + e.message; }
    })();`).catch(() => {});
  }

  /** devtools 主题跟随（W52④：devtools 的 uiTheme 偏好注入——主界面暗系主题→dark、亮系→light；
   *  theme:changed 广播即换（开着也实时）；注入失败退回 Chromium 默认不炸（尽力而为件——devtools 原生件物理上限） */
  /** 主题变更 → 全开 devtools 重注（theme:broadcast 消费口） */
  rethemeAllDevTools(themeId) {
    for (const [, rec] of this.views) {
      const wc = rec.view.webContents;
      if (wc.isDevToolsOpened()) this.syncDevToolsTheme(wc, themeId).catch(() => {});
    }
  }

  // 六主题色调表（与 themes.css 同值——devtools 的 sys-color 注入取数；明暗两档偷懒平反）
  static DT_PALETTES = {
    paper:     { bg: '#f7f6f3', elev: '#ffffff', fg: '#2c2c2a', dim: '#83817a', accent: '#4f46e5' },
    ink:       { bg: '#16181d', elev: '#1e2128', fg: '#e2e4e9', dim: '#7d828e', accent: '#818cf8' },
    indigo:    { bg: '#101226', elev: '#191b36', fg: '#dcdff5', dim: '#7a7ea8', accent: '#7dd3fc' },
    moss:      { bg: '#1a211c', elev: '#222b25', fg: '#dce8df', dim: '#7e938a', accent: '#86c5a0' },
    sand:      { bg: '#f4ede1', elev: '#fbf7ee', fg: '#41392c', dim: '#96897a', accent: '#b45309' },
    construct: { bg: '#f0e6d2', elev: '#f8f0dd', fg: '#1a1a1a', dim: '#6b6255', accent: '#c8211b' },
  };

  async syncDevToolsTheme(wc, themeId = null) {
    const id = themeId || this.themeId() || 'ink';
    const dark = ['ink', 'indigo', 'moss'].includes(id);
    const pal = BrowserViews.DT_PALETTES[id] || BrowserViews.DT_PALETTES.paper;
    const apply = async () => {
      try {
        // 取值时机病绝育：devToolsWebContents 必须用时重取——openDevTools 后立刻取必为 null（attach 未竟）
        const dwc = wc.devToolsWebContents;
        if (!dwc) return;
        // 通道一（明暗骨架）：CDP Emulation.setEmulatedMedia——即时触发 matchMedia change，零 reload 零白闪
        // W52f catch 开闸：真机失效 E2E 全绿的病必须让错误说话（dev 模式 cmd 直见）
        try {
          if (!dwc.debugger.isAttached()) dwc.debugger.attach('1.3');
          await dwc.debugger.sendCommand('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }],
          });
        } catch (e) { console.error('[devtools-theme] emulation 注入失败:', e.message || e); }
        // 通道二（色调皮肉）：sys-color 变量注入——不依赖 debugger attach 的独立通道；
        // 六主题色调跟随（indigo 就给靛青、moss 就给苔绿——「只做明暗两档」平反）
        const css = `:root {
          --sys-color-base: ${pal.bg};
          --sys-color-surface: ${pal.bg};
          --sys-color-surface-variant: ${pal.elev};
          --sys-color-neutral-container: ${pal.elev};
          --sys-color-cdt-base-container: ${pal.bg}; /* body 背景直达变量（探针实锤：base/surface 注入纹丝不动，cdt 才是真管） */
          --sys-color-cdt-base: ${pal.elev};
          --sys-color-on-surface: ${pal.fg};
          --sys-color-on-surface-subtle: ${pal.dim};
          --sys-color-on-surface-secondary: ${pal.dim};
          --sys-color-primary: ${pal.accent};
        }
        /* dark 皮规则是直色不走变量（emulation dark 后 dark stylesheet 写死 body——变量覆盖纹丝不动实锤），直钉： */
        body { background: ${pal.bg} !important; }`
        await dwc.executeJavaScript(`(() => {
          let st = document.getElementById('mazz-dt-theme');
          if (!st) { st = document.createElement('style'); st.id = 'mazz-dt-theme'; (document.head || document.documentElement).appendChild(st); }
          st.textContent = ${JSON.stringify(css)};
          localStorage.setItem('uiTheme', ${JSON.stringify(JSON.stringify(dark ? 'dark' : 'light'))});
          return true;
        })()`).catch(e => console.error('[devtools-theme] 色调注入失败:', e.message || e));
      } catch (e) { console.error('[devtools-theme] 注入总闸异常:', e.message || e); }
    };
    // 前端加载拍（首注等 devtools attach 落地；换主题即时重注）
    if (themeId) setTimeout(apply, 300);
    else if (!this._dtThemed.has(wc)) { this._dtThemed.add(wc); setTimeout(apply, 900); }
  }

  /** 密码捕获出口：去重（站+人 30s 只问一趟）→ 转主窗渲染层询问（ Edge 同款克制——绝不静默落库） */
  onPwCapture(tabId, raw) {
    let j = null;
    try { j = JSON.parse(raw); } catch { return; }
    if (!j?.site || !j?.p) return;
    // 修改智能识别（W48）：有库存站点——密码一致=已在库静默；密码不同=询问更新（Edge 同款）
    const exist = this.pwMatch(j.site).find(e => !j.u || !e.username || e.username === j.u);
    if (exist && exist.password === j.p) return; // 已在库且一致——静默（不再问）
    if (exist) { this.emit(tabId, 'pw-changed', { id: exist.id, site: exist.site || j.site, username: j.u || exist.username || '', password: j.p }); return; }
    const key = tabId + '|' + j.site + '|' + (j.u || '');
    const now = Date.now();
    this._pwOffered = this._pwOffered || new Map();
    if ((this._pwOffered.get(key) || 0) > now - 30000) return;
    this._pwOffered.set(key, now);
    this.emit(tabId, 'pw-capture', { site: j.site, username: j.u || '', password: j.p });
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
    // devtools 每次重开都必须重注主题——_dtThemed 防的是同一会话重复注，不是重开不注；
    // 关窗即销毁 devtools webContents，emulation 状态全重置（run45 重开变白实锤）
    wc.on('devtools-opened', () => { this._dtThemed.delete(wc); this.syncDevToolsTheme(wc).catch(() => {}); });
    // 网页聚焦时按键全进 Chromium，渲染层 keymap 根本收不到（真机实锤 F12 只能走右键）——页面消费前拦截：
    // ①F12 toggle devtools；②F5/Ctrl+R 转渲染层 reloadTab 汇聚（主页是 about:blank 重写文档，wc.reload() 必白屏）
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F12') {
        event.preventDefault();
        if (wc.isDevToolsOpened()) { wc.closeDevTools(); return; }
        wc.openDevTools({ mode: 'detach' });
        this.syncDevToolsTheme(wc).catch(() => {});
        return;
      }
      if (input.key === 'F5' || ((input.control || input.meta) && String(input.key).toLowerCase() === 'r')) {
        event.preventDefault();
        this.emit(tabId, 'key-reload', {});
      }
    });
    // console-message 签名版本差防御（v33 位次参数 / 后续 details 对象）
    wc.on('console-message', (...args) => {
      const message = typeof args[1] === 'string' ? args[1] : (args[1]?.message ?? args[2] ?? '');
      if (typeof message === 'string' && message.startsWith('__MZPW__')) { this.onPwCapture(tabId, message.slice(8)); return; }
      this.emit(tabId, 'console-message', { message });
    });
    wc.on('context-menu', (_e, params) => this.showCtxMenu(tabId, params));
    // 密码智能记录（W47 Edge 同款：表单提交捕获账号密码 → 询问保存——沙箱页唯一信道=console 前缀桥）
    wc.on('did-frame-finish-load', (_e, isMainFrame) => {
      if (!isMainFrame) return;
      wc.executeJavaScript(`(function(){
        if (window.__mzPwHook) return; window.__mzPwHook = true;
        document.addEventListener('submit', function(e){
          try {
            var f = e.target, pw = f.querySelector('input[type=password]');
            if (!pw || !pw.value) return;
            var user = f.querySelector('input[type=email],input[type=tel],input[name*=user i],input[name*=account i],input[name*=login i],input[name*=mail i],input[type=text],input:not([type])');
            console.log('__MZPW__' + JSON.stringify({ site: location.hostname, u: user ? user.value : '', p: pw.value }));
          } catch (err) {}
        }, true);
      })();`).catch(() => {});
      this.autofillPw(wc);
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
