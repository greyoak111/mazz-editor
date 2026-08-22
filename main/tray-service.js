// main/tray-service.js —— 托盘全家桶：亮暗双套图标 / 菜单（快速笔记·最近文件·设置·退出）
'use strict';
const { Tray, Menu, nativeTheme, app } = require('electron');
const path = require('path');
const { trayAssetName } = require('./system-ui-theme');

class TrayService {
  constructor({ windowManager, store, onCommand }) {
    this.wm = windowManager;
    this.store = store;
    this.onCommand = onCommand; // (commandId, payload) => void  转发给渲染进程命令注册表
    this.tray = null;
    this.themeListenerAttached = false;
    this.onNativeThemeUpdated = () => {
      if (this.tray) this.tray.setImage(this.iconForTheme());
    };
  }

  iconForTheme() {
    const name = trayAssetName(nativeTheme, process.platform);
    return path.join(__dirname, '..', 'resources', 'icons', name);
  }

  create() {
    if (this.tray) return;
    this.tray = new Tray(this.iconForTheme());
    this.tray.setToolTip('Mazz Editor — 一站式超级编辑器');
    this.tray.on('click', () => this.wm.toggleMain());
    if (!this.themeListenerAttached) {
      nativeTheme.on('updated', this.onNativeThemeUpdated);
      this.themeListenerAttached = true;
    }
    this.refreshMenu();
  }

  refreshMenu() {
    if (!this.tray) return;
    const recent = (this.store.get('recentFiles', []) || []).slice(0, 10);
    const menu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => this.wm.toggleMain() },
      { label: '快速笔记', accelerator: 'Control+Alt+N', click: () => this.wm.toggleQuickNote() },
      {
        label: '最近文件', submenu: recent.length
          ? recent.map(f => ({ label: f.length > 42 ? '…' + f.slice(-41) : f, click: () => this.onCommand('file.openPath', { path: f }) }))
          : [{ label: '（空）', enabled: false }],
      },
      { type: 'separator' },
      { label: '设置', click: () => this.onCommand('app.openSettings') },
      { label: '退出 Mazz Editor', click: () => { this.wm.forceClose = true; app.quit(); } },
    ]);
    this.tray.setContextMenu(menu);
  }

  destroy() {
    if (this.themeListenerAttached) {
      nativeTheme.removeListener('updated', this.onNativeThemeUpdated);
      this.themeListenerAttached = false;
    }
    if (this.tray) { this.tray.destroy(); this.tray = null; }
  }
}
module.exports = TrayService;
