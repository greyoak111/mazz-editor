// main/panel-windows.js —— 衍生面板原生子窗（W43 并行进程根治：面板独立窗口独立合成，与 WebContentsView 永不相见——
// 右键菜单已走原生 Menu.popup（w34），收藏管理/密码管理器这些复杂 UI 原生菜单装不下，唯一正解=并行子窗。
// 子窗与主窗共用 preload 桥：数据经 IPC 直取（settings/pw），改动经 panel:changed 回推主窗刷新——面板永不再开渲染层 DOM 弹窗（无遮挡无隐身无白屏）
// W47 追加：主题跟随主界面（all 静态注册表收 theme:changed 广播）+ 圆角透明窗+窄拖拽条（Win10 无圆角 API 的唯一路径）
'use strict';
const path = require('path');
const { BrowserWindow, nativeTheme, screen } = require('electron');

class PanelWindows {
  // W61a：只有预览/编辑两族允许多实例；其余面板继续严格单例。
  static MULTI_KINDS = new Set(['fpreview', 'fedit']);
  /** 静态注册表：kind -> Set<BrowserWindow>（theme:broadcast 广播面——主窗换主题全部面板跟随） */
  static all = new Map();
  static register(kind, win) {
    if (!PanelWindows.all.has(kind)) PanelWindows.all.set(kind, new Set());
    PanelWindows.all.get(kind).add(win);
    win.on('closed', () => {
      // 静态区只干静态的事（注册表注销+主题广播面）——联动逻辑全归 open() 系实例钩（军规⑫孪生钩核验：
      // dockfloat 回停靠/焦点抢回的正解在 open() closed 钩；此处调 this.forward=静态类无此法=连环 uncaught 炸真机（日志实锤）
      PanelWindows.all.get(kind)?.delete(win);
    });
  }
  static broadcastTheme(id, vars) {
    for (const set of PanelWindows.all.values()) {
      for (const w of set) if (!w.isDestroyed()) w.webContents.send('mazz:event', { channel: 'theme:changed', payload: { id, vars } });
    }
  }

  constructor({ bus, win, resourceLedger = null, visualComposition = null }) {
    this.bus = bus;
    this.win = win; // () => 主窗
    this.resourceLedger = resourceLedger;
    this.visualComposition = visualComposition;
    this.panels = new Map(); // singleton: kind；multi: kind:instanceId
    bus.handle('panel:open', async ({ kind, opts } = {}, event) => {
      const host = BrowserWindow.fromWebContents(event?.sender) || this.win?.();
      return this.open(kind, opts, host);
    });
    bus.handle('panel:close', async ({ kind, instanceId }) => {
      for (const p of this._windowsFor(kind, instanceId)) if (!p.isDestroyed()) p.close();
      return true;
    });
    // 面板 → 主窗回推：数据已变（主窗浏览器模块刷新收藏/密码）与动作请求（打开网址/填充密码/工具坞命令/密码保存询问）
    bus.handle('panel:changed', async (payload, event) => {
      this.forward('panel:changed', payload, this._panelBySender(event?.sender));
      return true;
    });
    // W54 B10 坞拖拽手势三态（自绘拖拽：transparent+app-region 跨屏病绕开——面板页 e.screenX/Y 供屏坐标，主进程 setBounds 跟手）
    bus.handle('panel:dragStart', async ({ kind, instanceId, sx, sy }) => {
      const win = this._panelFor(kind, instanceId);
      if (!win || win.isDestroyed()) return false;
      const b = win.getBounds();
      this._drag = { win, dx: sx - b.x, dy: sy - b.y, w: b.width, h: b.height, lastMove: 0, snap: false };
      return true;
    });
    bus.handle('panel:move', async ({ kind, instanceId, sx, sy }) => {
      // 容错补建：拖出场景（坞 bar 起拖）子窗格可能刚开未 dragStart——按现 bounds 补建会话
      if (!this._drag && kind) {
        const win = this._panelFor(kind, instanceId);
        if (win && !win.isDestroyed()) {
          const b = win.getBounds();
          this._drag = { win, dx: sx - b.x, dy: sy - b.y, w: b.width, h: b.height, lastMove: 0, snap: false };
        }
      }
      const d = this._drag;
      if (!d || d.win.isDestroyed()) return false;
      const now = Date.now();
      if (now - d.lastMove < 12) return true; // 节流 ~80fps 上限（跟手不卡 IPC）
      d.lastMove = now;
      d.win.setBounds({ x: Math.round(sx - d.dx), y: Math.round(sy - d.dy), width: d.w, height: d.h });
      // 侧载热区：窗右缘贴主窗右缘 ±48 且纵向重叠 ≥40% → 吸附提示（进出各发一次）
      try {
        const m = typeof this.win === 'function' ? this.win() : this.win;
        if (m && !m.isDestroyed()) {
          const mb = m.getBounds(), wb = d.win.getBounds();
          const vOverlap = Math.max(0, Math.min(wb.y + wb.height, mb.y + mb.height) - Math.max(wb.y, mb.y)) / wb.height;
          const snap = Math.abs((wb.x + wb.width) - (mb.x + mb.width)) <= 48 && vOverlap >= 0.4;
          if (snap !== d.snap) { d.snap = snap; this.forward('dock:snapHint', { on: snap }, d.win); }
        }
      } catch {}
      return true;
    });
    bus.handle('panel:dragEnd', async ({ kind }) => {
      const d = this._drag;
      this._drag = null;
      if (!d || d.win.isDestroyed()) return false;
      this.forward('dock:snapHint', { on: false }, d.win);
      if (d.snap && kind === 'dockfloat') {
        // 拽回侧载位=自动停靠：主窗联动回岗 + 子窗自闭（手势三态之拽回）
        this.forward('panel:changed', { kind: 'dockfloat', closed: true }, d.win);
        try { d.win.close(); } catch {}
        return 'docked';
      }
      return true;
    });
    // W58c：标注发件面板 kind（主题快照等通用桥的回推寻址——17 面板免逐一手带 kind；视图宿主化同款思路）
    bus.handle('panel:action', async (payload, event) => {
      const sourcePanel = this._panelBySender(event?.sender);
      if (payload && !payload.kind && sourcePanel) {
        payload.kind = sourcePanel.__panelKind;
        if (sourcePanel.__panelInstanceId) payload.instanceId = sourcePanel.__panelInstanceId;
      }
      this.forward('panel:action', payload, sourcePanel);
      return true;
    });
    // W52③ 薄子窗回推（paletteQuery/shortcutQuery 的答案信道：主窗渲染层 → 指定面板窗）
    bus.handle('panel:push', async ({ kind, instanceId, payload }) => {
      for (const p of this._windowsFor(kind, instanceId)) this._send(p, payload);
      return true;
    });
    // W61b：自由拖动后，一键把同族多实例收回左右阶梯位。
    bus.handle('panel:arrange', async ({ kind }) => this.arrange(kind));
  }

  _instanceId(value) {
    return String(value || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'default';
  }
  _key(kind, instanceId) {
    return PanelWindows.MULTI_KINDS.has(kind) ? `${kind}:${this._instanceId(instanceId)}` : kind;
  }
  _panelFor(kind, instanceId) {
    return this.panels.get(this._key(String(kind || ''), instanceId));
  }
  _panelBySender(sender) {
    if (!sender) return null;
    return [...this.panels.values()].find(win => !win.isDestroyed() && win.webContents === sender) || null;
  }
  _windowsFor(kind, instanceId) {
    kind = String(kind || '');
    if (!PanelWindows.MULTI_KINDS.has(kind) || instanceId != null) {
      const one = this._panelFor(kind, instanceId);
      return one && !one.isDestroyed() ? [one] : [];
    }
    return [...this.panels.values()].filter(w => !w.isDestroyed() && w.__panelKind === kind);
  }
  _send(win, payload) {
    if (!win || win.isDestroyed()) return;
    if (!win.__panelReady) { (win.__panelQueue ||= []).push(payload); return; }
    win.webContents.send('mazz:event', { channel: 'panel:push', payload });
  }
  _prepare(win, kind, instanceId, key, host = null) {
    win.__panelKind = kind;
    win.__panelInstanceId = PanelWindows.MULTI_KINDS.has(kind) ? this._instanceId(instanceId) : '';
    win.__panelKey = key;
    win.__panelReady = false;
    win.__panelQueue = [];
    win.__panelHost = host || win.getParentWindow?.() || this.win?.();
    this.visualComposition?.registerPanel?.(win, {
      kind,
      instanceId: win.__panelInstanceId || null,
      hostWindowId: win.__panelHost?.id || null,
    });
    if (this.resourceLedger) {
      try {
        const ledgerKey = this.resourceLedger.register({
          type: 'panel-window', id: String(win.id), owner: `panel:${kind}`,
          meta: { kind, instanceId: win.__panelInstanceId || null, panelKey: key },
        });
        win.__resourceLedgerKey = ledgerKey;
        win.once('closed', () => {
          this.resourceLedger.release(ledgerKey, { reason: 'panel-closed' });
          if (win.__resourceLedgerKey === ledgerKey) win.__resourceLedgerKey = null;
        });
      } catch (error) {
        console.warn('[resources] PanelWindow 登记失败:', error.message || error);
      }
    }
    win.webContents.on('did-finish-load', () => {
      if (win.isDestroyed()) return;
      win.__panelReady = true;
      const queue = win.__panelQueue.splice(0);
      for (const payload of queue) this._send(win, payload);
    });
  }
  _nextStairIndex(kind) {
    const used = new Set([...this.panels.values()].filter(w => !w.isDestroyed() && w.__panelKind === kind).map(w => w.__stairIndex));
    let n = 0;
    while (used.has(n)) n++;
    return n;
  }
  _stairBounds(parent, width, height, index, side = 'right') {
    const anchor = parent?.getBounds?.() || { x: 0, y: 0, width: 1440, height: 900 };
    const area = screen.getDisplayMatching(anchor).workArea;
    const step = 44;
    const rows = Math.max(1, Math.floor((area.height - height - 32) / step) + 1);
    const row = index % rows, col = Math.floor(index / rows);
    return {
      x: side === 'left'
        ? Math.min(area.x + area.width - width, area.x + 16 + col * step)
        : Math.max(area.x, area.x + area.width - width - 16 - col * step),
      y: Math.min(area.y + area.height - height, area.y + 16 + row * step),
    };
  }
  arrange(kind) {
    kind = String(kind || '');
    if (!PanelWindows.MULTI_KINDS.has(kind)) return { error: '仅多实例窗可收拢' };
    const parent = this.win?.();
    const side = kind === 'fedit' ? 'left' : 'right';
    const wins = [...this.panels.values()].filter(w => !w.isDestroyed() && w.__panelKind === kind)
      .sort((a, b) => (a.__stairIndex ?? 0) - (b.__stairIndex ?? 0));
    wins.forEach((win, index) => {
      win.__stairIndex = index;
      const b = win.getBounds();
      const pos = this._stairBounds(parent, b.width, b.height, index, side);
      win.setBounds({ ...pos, width: b.width, height: b.height });
    });
    return { ok: true, kind, count: wins.length, side };
  }
  /** 批注墨迹子窗（W52④：透明 alwaysOnTop 全屏罩——下层浏览器视图全程活着，墨迹画布只管收笔画） */
  openAnnotate(parent) {
    const exist = this.panels.get('annotate');
    if (exist && !exist.isDestroyed()) { exist.show(); return { already: true }; }
    const b = parent ? parent.getBounds() : { x: 0, y: 0, width: 1200, height: 800 };
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      parent: parent || undefined,
      transparent: true, frame: false, hasShadow: false,
      alwaysOnTop: true, skipTaskbar: true, focusable: true,
      resizable: false, minimizable: false, maximizable: false, closable: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'bridge.js'),
        contextIsolation: true, sandbox: false, nodeIntegration: false, spellcheck: false,
      },
    });
    this._prepare(win, 'annotate', '', 'annotate', parent);
    this.panels.set('annotate', win);
    win.on('closed', () => { this.panels.delete('annotate'); this._unfollow(parent, win); });
    PanelWindows.register('annotate', win);
    win.loadURL('mazz-res://app/panels/annotate.html');
    this._follow(parent, win);
    return { ok: true };
  }
  /** 主窗移动/缩放 → 墨迹窗同 bounds 跟随（「纹身」级贴合） */
  _follow(parent, win) {
    if (!parent) return;
    const sync = () => { if (!win.isDestroyed()) win.setBounds(parent.getBounds()); };
    parent.on('move', sync);
    parent.on('resize', sync);
    win._followSync = sync;
  }
  _unfollow(parent, win) {
    if (!parent || !win?._followSync) return;
    try { parent.removeListener('move', win._followSync); parent.removeListener('resize', win._followSync); } catch {}
  }

  forward(channel, payload, panelWin = null) {
    const ownedHost = panelWin?.__panelHost;
    const w = ownedHost && !ownedHost.isDestroyed() ? ownedHost : this.win?.();
    if (w && !w.isDestroyed()) this.bus.send(w, channel, payload);
  }
  open(kind, opts = {}, hostWin = null) {
    kind = String(kind || '');
    if (!/^(favmgr|pwmgr|palette|shortcuts|annotate|settings|agreement|help|translate|plugins|recorder|dockfloat|bookmark|ctxmenu|splitpreview|sync|notif|factorycfg|newfile|picklist|fpreview|fedit|harvest|archive)$/.test(kind)) return { error: '未知面板' };
    const instanceId = PanelWindows.MULTI_KINDS.has(kind) ? this._instanceId(opts.instanceId) : '';
    const panelKey = this._key(kind, instanceId);
    const exist = this.panels.get(panelKey);
    const parent = hostWin && !hostWin.isDestroyed() ? hostWin : this.win?.();
    if (exist && !exist.isDestroyed()) {
      if (parent && exist.__panelHost !== parent) {
        try { exist.setParentWindow(parent); } catch {}
        exist.__panelHost = parent;
        this.visualComposition?.updatePanelHost?.(exist, parent);
      }
      exist.show(); exist.focus();
      return { already: true, hostWindowId: exist.__panelHost?.id || null };
    }
    if (kind === 'annotate') return this.openAnnotate(parent);
    if (kind === 'splitpreview') {
      // W55④ 分屏预览罩：全透无边跟随主窗（annotate 同款——预览框永不被浏览器视图压，样式主窗算好推来）
      const win = new BrowserWindow({
        transparent: true, frame: false, backgroundColor: '#00000000',
        alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: false,
        resizable: false, movable: false, minimizable: false, maximizable: false, closable: true,
        show: false, parent: parent || undefined,
        webPreferences: { preload: path.join(__dirname, '..', 'preload', 'bridge.js'), contextIsolation: true, sandbox: false, nodeIntegration: false },
      });
      const host = parent || (typeof this.win === 'function' ? this.win() : this.win);
      const follow = () => { if (!win.isDestroyed() && host && !host.isDestroyed()) win.setBounds(host.getBounds()); };
      follow(); win.showInactive();
      if (host) { host.on('move', follow); host.on('resize', follow); win.on('closed', () => { try { host.off('move', follow); host.off('resize', follow); } catch {} }); }
      this._prepare(win, kind, '', panelKey, host);
      this.panels.set(panelKey, win);
      PanelWindows.register(panelKey, win);
      win.loadURL('mazz-res://app/panels/splitpreview.html');
      return { ok: true };
    }
    const panelWidth = kind === 'fpreview' ? (opts.w || 760) : kind === 'fedit' ? (opts.w || 820)
      : kind === 'ctxmenu' ? (opts.w || 240)
        : kind === 'picklist' ? (opts.w || 340)
        : kind === 'palette' ? 720 : kind === 'shortcuts' ? 720 : kind === 'favmgr' ? 780 : kind === 'harvest' ? 880
        : kind === 'help' ? 860 : kind === 'settings' ? 760 : kind === 'plugins' ? 740
        : kind === 'recorder' ? 720 : kind === 'dockfloat' ? 400 : kind === 'notif' ? 520 : kind === 'bookmark' ? 520 : kind === 'factorycfg' ? 920 : 700;
    const panelHeight = kind === 'fpreview' ? (opts.h || 640) : kind === 'fedit' ? (opts.h || 700)
      : kind === 'ctxmenu' ? (opts.h || 300)
        : kind === 'picklist' ? (opts.h || 420)
        : kind === 'palette' ? 540 : kind === 'dockfloat' ? 620 : kind === 'notif' ? 650 : kind === 'agreement' ? 600 : kind === 'bookmark' ? 380 : kind === 'factorycfg' ? 720 : kind === 'harvest' ? 700 : 560;
    const stairIndex = PanelWindows.MULTI_KINDS.has(kind) ? this._nextStairIndex(kind) : -1;
    const stairSide = kind === 'fedit' ? 'left' : 'right';
    const stair = PanelWindows.MULTI_KINDS.has(kind) ? this._stairBounds(parent, panelWidth, panelHeight, stairIndex, stairSide) : {};
    const transientPanel = kind === 'ctxmenu' || kind === 'picklist';
    const win = new BrowserWindow({
      width: panelWidth,
      height: panelHeight,
      minWidth: kind === 'ctxmenu' ? 160 : kind === 'picklist' ? 240 : kind === 'fpreview' ? 560 : kind === 'fedit' ? 620 : 480,
      minHeight: kind === 'ctxmenu' ? 60 : kind === 'picklist' ? 200 : kind === 'fpreview' ? 420 : kind === 'fedit' ? 440 : 360,
      // W55 右键菜单子窗格：屏坐标定位（主窗内容区坐标→屏坐标）+防出屏翻边（W58i picklist 字体/字号格同例）
      ...stair,
      ...((kind === 'ctxmenu' || kind === 'picklist') ? (() => {
        const cb = (parent || (typeof this.win === 'function' ? this.win() : this.win))?.getContentBounds?.() || { x: 0, y: 0, width: 1440, height: 900 };
        let x = Math.round(cb.x + (opts.x || 0)), y = Math.round(cb.y + (opts.y || 0));
        const w = opts.w || (kind === 'picklist' ? 340 : 240), h = opts.h || (kind === 'picklist' ? 420 : 300);
        if (x + w > cb.x + cb.width) x = cb.x + cb.width - w - 4; // 右出屏左翻
        if (y + h > cb.y + cb.height) y = cb.y + cb.height - h - 4; // 下出屏上翻
        return { x, y };
      })() : {}),
      parent: parent || undefined,
      title: opts.title || { favmgr: '收藏管理', pwmgr: '密码管理器', palette: 'Quick Switcher', shortcuts: '快捷键速查',
        settings: '设置', agreement: '用户服务协议及隐私政策', help: '使用指南', translate: '翻译',
        plugins: '插件管理（预览）', recorder: '全局内录（预览）', dockfloat: '工具坞', bookmark: '收藏当前页', ctxmenu: '菜单', sync: '局域网同步', notif: '通知中心', factorycfg: '项目立项 · AI 服务 · 创作模板', newfile: '新建文件', picklist: '选择', archive: '压缩包', fpreview: '生成预览', fedit: '章节编辑', harvest: 'AI 对话整理' }[kind] || '面板',
      autoHideMenuBar: true,
      // W47 圆角+拖拽：transparent+圆角体（Win10 原生无圆角 API 的唯一路径；拖拽=页面顶窄拖拽条 app-region:drag，
      // 窗控三键=页面右上角小件（非全套标题栏——用户定版）。thickFrame 默认保留=边框缩放在 Win10 仍有抓手
      transparent: true, frame: false,
      backgroundColor: '#00000000',
      // 瞬时菜单必须等首帧就绪后再显现并获取焦点；若创建即显示，前一面板的收尾
      // focus() 可能在加载期制造一次假 blur，导致菜单尚未绘制就自闭。
      show: !transientPanel,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'bridge.js'),
        contextIsolation: true, sandbox: false, nodeIntegration: false, spellcheck: false,
      },
    });
    this._prepare(win, kind, instanceId, panelKey, parent);
    win.__stairIndex = stairIndex;
    win.__stairSide = stairSide;
    this.panels.set(panelKey, win);
    if (transientPanel) {
      win.__dismissOnBlurArmed = false;
      win.once('ready-to-show', () => {
        if (win.isDestroyed()) return;
        win.show();
        win.focus();
        setImmediate(() => { if (!win.isDestroyed()) win.__dismissOnBlurArmed = true; });
      });
      win.on('blur', () => {
        if (!win.__dismissOnBlurArmed) return;
        try { win.close(); } catch {}
      }); // 菜单惯例：真正显示并获得焦点后，失焦才收。
    }
    win.on('closed', () => {
      this.panels.delete(panelKey);
      // 坞浮动子窗格关闭 → 主窗联动坞回停靠（W53 纯原生浮动——关窗即收队；open() 系真钩，15 行那个是 annotate 系）
      if (kind === 'dockfloat') this.forward('panel:changed', { kind: 'dockfloat', closed: true }, win);
      // 焦点抢回：子窗一关焦点归主窗（防流浪到 cmd 等 Z 序下一位）
      try { const m = typeof this.win === 'function' ? this.win() : this.win; if (m && !m.isDestroyed()) { m.show(); m.focus(); } } catch {}
    });
    PanelWindows.register(panelKey, win); // 主题广播面；多实例按 kind:instanceId 注册
    win.loadURL(`mazz-res://app/panels/${kind}.html`);
    return { ok: true, kind, instanceId: instanceId || undefined, key: panelKey, bounds: win.getBounds() };
  }
}
module.exports = PanelWindows;
