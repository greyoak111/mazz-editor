// main/global-shortcuts.js —— 全局快捷键（应用未聚焦也生效）：主窗唤起 / 快速笔记
'use strict';
const { globalShortcut, clipboard } = require('electron');

class GlobalShortcuts {
  constructor({ windowManager, store }) {
    this.wm = windowManager;
    this.store = store;
    this.registered = [];
  }
  registerAll() {
    const map = this.store.get('globalShortcuts', {
      toggleMain: 'Control+Alt+M',
      quickNote: 'Control+Alt+N',
    });
    this._reg(map.toggleMain, () => this.wm.toggleMain());
    this._reg(map.quickNote, () => {
      // 支持全局选中文本后唤起自动带入（尽力读取剪贴板）
      let initial = '';
      try { initial = clipboard.readText().slice(0, 2000); } catch {}
      this.wm.toggleQuickNote(initial);
    });
  }
  _reg(accelerator, fn) {
    if (!accelerator) return;
    try {
      if (globalShortcut.register(accelerator, fn)) this.registered.push(accelerator);
      else console.warn('[globalShortcut] 占用冲突:', accelerator);
    } catch (e) { console.error('[globalShortcut] 注册失败:', accelerator, e.message); }
  }
  unregisterAll() { globalShortcut.unregisterAll(); this.registered = []; }
}
module.exports = GlobalShortcuts;
