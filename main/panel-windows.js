// main/panel-windows.js —— 衍生面板原生子窗（W43 并行进程根治：面板独立窗口独立合成，与 WebContentsView 永不相见——
// 右键菜单已走原生 Menu.popup（w34），收藏管理/密码管理器这些复杂 UI 原生菜单装不下，唯一正解=并行子窗。
// 子窗与主窗共用 preload 桥：数据经 IPC 直取（settings/pw），改动经 panel:changed 回推主窗刷新——面板永不再开渲染层 DOM 弹窗（无遮挡无隐身无白屏）
// W47 追加：主题跟随主界面（all 静态注册表收 theme:changed 广播）+ 圆角透明窗+窄拖拽条（Win10 无圆角 API 的唯一路径）
'use strict';
const path = require('path');
const { BrowserWindow, nativeTheme } = require('electron');

class PanelWindows {
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

  constructor({ bus, win }) {
    this.bus = bus;
    this.win = win; // () => 主窗
    this.panels = new Map(); // kind -> BrowserWindow（单例，再点聚焦）
    bus.handle('panel:open', async ({ kind, opts }) => this.open(kind, opts));
    bus.handle('panel:close', async ({ kind }) => {
      const p = this.panels.get(kind);
      if (p && !p.isDestroyed()) p.close();
      return true;
    });
    // 面板 → 主窗回推：数据已变（主窗浏览器模块刷新收藏/密码）与动作请求（打开网址/填充密码/工具坞命令/密码保存询问）
    bus.handle('panel:changed', async (payload) => { this.forward('panel:changed', payload); return true; });
    // W54 B10 坞拖拽手势三态（自绘拖拽：transparent+app-region 跨屏病绕开——面板页 e.screenX/Y 供屏坐标，主进程 setBounds 跟手）
    bus.handle('panel:dragStart', async ({ kind, sx, sy }) => {
      const win = this.panels.get(kind);
      if (!win || win.isDestroyed()) return false;
      const b = win.getBounds();
      this._drag = { win, dx: sx - b.x, dy: sy - b.y, w: b.width, h: b.height, lastMove: 0, snap: false };
      return true;
    });
    bus.handle('panel:move', async ({ kind, sx, sy }) => {
      // 容错补建：拖出场景（坞 bar 起拖）子窗格可能刚开未 dragStart——按现 bounds 补建会话
      if (!this._drag && kind) {
        const win = this.panels.get(kind);
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
          if (snap !== d.snap) { d.snap = snap; this.forward('dock:snapHint', { on: snap }); }
        }
      } catch {}
      return true;
    });
    bus.handle('panel:dragEnd', async ({ kind }) => {
      const d = this._drag;
      this._drag = null;
      if (!d || d.win.isDestroyed()) return false;
      this.forward('dock:snapHint', { on: false });
      if (d.snap && kind === 'dockfloat') {
        // 拽回侧载位=自动停靠：主窗联动回岗 + 子窗自闭（手势三态之拽回）
        this.forward('panel:changed', { kind: 'dockfloat', closed: true });
        try { d.win.close(); } catch {}
        return 'docked';
      }
      return true;
    });
    // W58c：标注发件面板 kind（主题快照等通用桥的回推寻址——17 面板免逐一手带 kind；视图宿主化同款思路）
    bus.handle('panel:action', async (payload, event) => {
      if (payload && !payload.kind) {
        for (const [kind, w] of this.panels) {
          if (!w.isDestroyed() && w.webContents === event?.sender) { payload.kind = kind; break; }
        }
      }
      this.forward('panel:action', payload);
      return true;
    });
    // W52③ 薄子窗回推（paletteQuery/shortcutQuery 的答案信道：主窗渲染层 → 指定面板窗）
    bus.handle('panel:push', async ({ kind, payload }) => {
      const p = this.panels.get(kind);
      if (p && !p.isDestroyed()) p.webContents.send('mazz:event', { channel: 'panel:push', payload });
      return true;
    });
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

  forward(channel, payload) {
    const w = this.win?.();
    if (w && !w.isDestroyed()) this.bus.send(w, channel, payload);
  }
  open(kind, opts = {}) {
    if (!/^(favmgr|pwmgr|palette|shortcuts|annotate|settings|agreement|help|translate|plugins|quickopen|recorder|dockfloat|bookmark|ctxmenu|splitpreview|sync|factorycfg|newfile|picklist|archive)$/.test(String(kind || ''))) return { error: '未知面板' };
    const exist = this.panels.get(kind);
    if (exist && !exist.isDestroyed()) { exist.show(); exist.focus(); return { already: true }; }
    const parent = this.win?.();
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
      this.panels.set(kind, win);
      PanelWindows.register(kind, win);
      win.loadURL('mazz-res://app/panels/splitpreview.html');
      return { ok: true };
    }
    const win = new BrowserWindow({
      width: kind === 'ctxmenu' ? (opts.w || 240)
        : kind === 'picklist' ? (opts.w || 340)
        : kind === 'palette' ? 640 : kind === 'shortcuts' ? 720 : kind === 'favmgr' ? 780
        : kind === 'help' ? 860 : kind === 'settings' ? 760 : kind === 'plugins' ? 740
        : kind === 'recorder' ? 720 : kind === 'dockfloat' ? 400 : kind === 'quickopen' ? 640 : kind === 'bookmark' ? 520 : 700,
      height: kind === 'ctxmenu' ? (opts.h || 300)
        : kind === 'picklist' ? (opts.h || 420)
        : kind === 'palette' ? 480 : kind === 'quickopen' ? 480 : kind === 'dockfloat' ? 620 : kind === 'agreement' ? 600 : kind === 'bookmark' ? 380 : 560,
      minWidth: kind === 'ctxmenu' ? 160 : kind === 'picklist' ? 240 : 480, minHeight: kind === 'ctxmenu' ? 60 : kind === 'picklist' ? 200 : 360,
      // W55 右键菜单子窗格：屏坐标定位（主窗内容区坐标→屏坐标）+防出屏翻边（W58i picklist 字体/字号格同例）
      ...((kind === 'ctxmenu' || kind === 'picklist') ? (() => {
        const cb = (parent || (typeof this.win === 'function' ? this.win() : this.win))?.getContentBounds?.() || { x: 0, y: 0, width: 1440, height: 900 };
        let x = Math.round(cb.x + (opts.x || 0)), y = Math.round(cb.y + (opts.y || 0));
        const w = opts.w || (kind === 'picklist' ? 340 : 240), h = opts.h || (kind === 'picklist' ? 420 : 300);
        if (x + w > cb.x + cb.width) x = cb.x + cb.width - w - 4; // 右出屏左翻
        if (y + h > cb.y + cb.height) y = cb.y + cb.height - h - 4; // 下出屏上翻
        return { x, y };
      })() : {}),
      parent: parent || undefined,
      title: { favmgr: '收藏管理', pwmgr: '密码管理器', palette: '命令面板', shortcuts: '快捷键速查',
        settings: '设置', agreement: '用户服务协议及隐私政策', help: '使用指南', translate: '翻译',
        plugins: '插件管理', quickopen: '快速跳转', recorder: '全局内录', dockfloat: '工具坞', bookmark: '收藏当前页', ctxmenu: '菜单', sync: '局域网同步 · 更新', factorycfg: 'AI 服务 · 创作模板', newfile: '新建文件', picklist: '选择', archive: '压缩包' }[kind] || '面板',
      autoHideMenuBar: true,
      // W47 圆角+拖拽：transparent+圆角体（Win10 原生无圆角 API 的唯一路径；拖拽=页面顶窄拖拽条 app-region:drag，
      // 窗控三键=页面右上角小件（非全套标题栏——用户定版）。thickFrame 默认保留=边框缩放在 Win10 仍有抓手
      transparent: true, frame: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'bridge.js'),
        contextIsolation: true, sandbox: false, nodeIntegration: false, spellcheck: false,
      },
    });
    this.panels.set(kind, win);
    if (kind === 'ctxmenu' || kind === 'picklist') win.on('blur', () => { try { win.close(); } catch {} }); // 菜单惯例：失焦即收（W58i picklist 字体/字号选择格同例）
    win.on('closed', () => {
      this.panels.delete(kind);
      // 坞浮动子窗格关闭 → 主窗联动坞回停靠（W53 纯原生浮动——关窗即收队；open() 系真钩，15 行那个是 annotate 系）
      if (kind === 'dockfloat') this.forward('panel:changed', { kind: 'dockfloat', closed: true });
      // 焦点抢回：子窗一关焦点归主窗（防流浪到 cmd 等 Z 序下一位）
      try { const m = typeof this.win === 'function' ? this.win() : this.win; if (m && !m.isDestroyed()) { m.show(); m.focus(); } } catch {}
    });
    PanelWindows.register(kind, win); // 主题广播面
    win.loadURL(`mazz-res://app/panels/${kind}.html`);
    return { ok: true };
  }
}
module.exports = PanelWindows;
