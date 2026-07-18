// main/window-manager.js —— 窗口管理器：主窗（自绘标题栏）+ 快速笔记窗 + 窗口状态记忆
'use strict';
const { BrowserWindow, screen, nativeTheme } = require('electron');
const path = require('path');

class WindowManager {
  constructor({ store, iconPath }) {
    this.store = store;
    this.iconPath = iconPath;
    this.main = null;
    this.quickNote = null;
    this.children = new Set();
    this.onCloseRequest = null; // 由 main.js 注入：关闭行为（询问/托盘/退出）
    this.forceClose = false;
  }

  createMain() {
    const state = this.store.get('windowState', { width: 1440, height: 900 });
    // 防离屏：记忆坐标不在任何显示器范围内时丢弃（多屏拔插/远程桌面常见）
    if (state.x != null && state.y != null) {
      const onScreen = screen.getAllDisplays().some(d => {
        const b = d.bounds;
        return state.x >= b.x - 100 && state.x < b.x + b.width
          && state.y >= b.y - 100 && state.y < b.y + b.height;
      });
      if (!onScreen) { delete state.x; delete state.y; }
    }
    const win = new BrowserWindow({
      width: state.width, height: state.height, x: state.x, y: state.y,
      minWidth: 960, minHeight: 600,
      show: false,
      icon: this.iconPath,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f8fafc',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      titleBarOverlay: process.platform === 'win32'
        ? { color: '#00000000', symbolColor: '#94a3b8', height: 36 } : false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'bridge.js'),
        contextIsolation: true, sandbox: false, nodeIntegration: false,
        spellcheck: true, webviewTag: true, // 隐私浏览器模块需要 webview
      },
    });
    this.main = win;

    if (state.maximized) win.maximize();

    // 显示策略：ready-to-show 优先；超时/加载失败兜底强显（绝不做"透明人"）
    let shown = false;
    const forceShow = (why) => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      console.warn('[window] 强制显示:', why);
      try { win.show(); win.focus(); } catch {}
    };
    win.once('ready-to-show', () => {
      if (shown) return;
      shown = true;
      win.show();
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('[window] 加载失败:', code, desc, url);
      forceShow('did-fail-load');
    });
    setTimeout(() => forceShow('ready-to-show 超时 (4s)'), 4000);
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    // 窗口状态记忆
    const saveState = () => {
      if (win.isDestroyed()) return;
      const b = win.getNormalBounds();
      this.store.set('windowState', { ...b, maximized: win.isMaximized() });
    };
    win.on('close', saveState);
    win.on('closed', () => { this.main = null; });

    // 关闭行为可配：退出 / 最小化到托盘（默认询问一次后记住）
    win.on('close', (e) => {
      if (this.forceClose) return;
      if (this.onCloseRequest && this.onCloseRequest(win) === 'prevent') e.preventDefault();
    });

    // 渲染进程崩溃自愈（配合 crash-recovery）
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[window] renderer gone:', details.reason);
      if (details.reason !== 'clean-exit' && details.reason !== 'killed') {
        setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 400);
      }
    });
    return win;
  }

  /** 分窗（多窗口）：标签拖拽出屏 / 移到新窗口 用，与主窗同壳 */
  createChild() {
    const state = { width: 1100, height: 720 };
    const win = new BrowserWindow({
      width: state.width, height: state.height,
      minWidth: 640, minHeight: 420,
      show: false,
      icon: this.iconPath,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f8fafc',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      titleBarOverlay: process.platform === 'win32'
        ? { color: '#00000000', symbolColor: '#94a3b8', height: 36 } : false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'bridge.js'),
        contextIsolation: true, sandbox: false, nodeIntegration: false,
        spellcheck: true, webviewTag: true,
      },
    });
    this.children.add(win);
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    win.on('closed', () => { this.children.delete(win); });
    win.webContents.on('render-process-gone', (_e, details) => {
      if (details.reason !== 'clean-exit' && details.reason !== 'killed') {
        setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 400);
      }
    });
    return win;
  }

  /** 快速笔记窗：420×260 小窗，Esc 关闭 */
  toggleQuickNote(initialText = '') {
    if (this.quickNote && !this.quickNote.isDestroyed()) {
      if (this.quickNote.isVisible()) { this.quickNote.hide(); return; }
      this.quickNote.show(); this.quickNote.focus();
      this.quickNote.webContents.send('mazz:event', { channel: 'quicknote:focus', payload: { initialText } });
      return;
    }
    const disp = screen.getPrimaryDisplay().workAreaSize;
    const win = new BrowserWindow({
      width: 420, height: 260,
      x: Math.round(disp.width / 2 - 210), y: Math.round(disp.height / 3 - 130),
      frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e293b' : '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'quicknote-preload.js'),
        contextIsolation: true, sandbox: false, nodeIntegration: false, spellcheck: true,
      },
    });
    this.quickNote = win;
    win.loadFile(path.join(__dirname, '..', 'renderer', 'quicknote.html'));
    win.once('ready-to-show', () => {
      win.show();
      win.webContents.send('mazz:event', { channel: 'quicknote:focus', payload: { initialText } });
    });
    win.on('closed', () => { this.quickNote = null; });
  }

  toggleMain() {
    if (!this.main) { this.createMain(); return; }
    if (this.main.isVisible() && this.main.isFocused()) this.main.hide();
    else { this.main.show(); this.main.focus(); }
  }

  broadcast(channel, payload) {
    if (this.main && !this.main.isDestroyed()) {
      this.main.webContents.send('mazz:event', { channel, payload });
    }
  }
}
module.exports = WindowManager;
