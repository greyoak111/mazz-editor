// main/ipc-bus.js —— IPC 总线：统一 {channel, payload, requestId} 信封，白名单处理器注册
'use strict';
const { ipcMain } = require('electron');

class IpcBus {
  constructor() {
    this.handlers = new Map(); // channel -> async (payload, event) => result
  }
  /** 主进程侧注册处理器（白名单唯一入口） */
  handle(channel, fn) {
    if (this.handlers.has(channel)) throw new Error(`[ipc] duplicate handler: ${channel}`);
    this.handlers.set(channel, fn);
  }
  /** 渲染进程 preload 调用入口 */
  start() {
    ipcMain.handle('mazz:invoke', async (event, envelope) => {
      const { channel, payload } = envelope || {};
      const fn = this.handlers.get(channel);
      if (!fn) return { ok: false, error: `channel not allowed: ${channel}` };
      try {
        const result = await fn(payload, event);
        return { ok: true, data: result === undefined ? null : result };
      } catch (e) {
        console.error(`[ipc] ${channel} failed:`, e);
        return { ok: false, error: e.message || String(e) };
      }
    });
  }
  /** 主进程 -> 渲染进程 广播 */
  send(win, channel, payload) {
    if (win && !win.isDestroyed()) win.webContents.send('mazz:event', { channel, payload });
  }
}
module.exports = IpcBus;
