// main/file-watcher.js —— chokidar 外部变更监听：磁盘被改 → 推送渲染进程提示重载/比对
'use strict';
const chokidar = require('chokidar');

class FileWatcher {
  constructor({ bus, windowManager }) {
    this.watcher = null;
    this.wm = windowManager;
    this.watched = new Set();

    bus.handle('fs:closeAll', async () => {
      try { this.watcher?.close(); } catch {}
      this.watcher = null;
      this.watched.clear();
      return true;
    });
    bus.handle('fs:watch', async ({ paths }) => {
      const list = Array.isArray(paths) ? paths : [paths];
      const fresh = list.filter(p => p && !this.watched.has(p));
      if (!fresh.length) return true;
      if (!this.watcher) {
        this.watcher = chokidar.watch([], {
          ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
          depth: 8,
          ignored: /(^|[/\\])\.(git|mazz[/\\]temp)|node_modules/,
        });
        this.watcher.on('all', (evt, p) => {
          // 渲染层路径统一正斜杠（与 fs:listDir / workspace:get 约定一致）
          this.wm.broadcast('file:changed', { event: evt, path: String(p).replace(/\\/g, '/'), at: Date.now() });
        });
      }
      this.watcher.add(fresh);
      fresh.forEach(p => this.watched.add(p));
      return true;
    });
    bus.handle('fs:unwatch', async ({ paths }) => {
      const list = Array.isArray(paths) ? paths : [paths];
      if (this.watcher) this.watcher.unwatch(list);
      list.forEach(p => this.watched.delete(p));
      return true;
    });
  }
  async close() { if (this.watcher) { await this.watcher.close(); this.watcher = null; } }

  /** 挂起监视（记下根目录，释放全部句柄）——删除/移动被监视的多层目录前用，Windows 上句柄会锁目录 */
  async suspend() {
    if (!this.watcher) return;
    try { await this.watcher.close(); } catch {}
    this.watcher = null;
  }

  /** 恢复监视（重建实例并把根目录加回去） */
  async resume() {
    if (this.watcher || !this.watched.size) return;
    const roots = [...this.watched];
    this.watched.clear();
    // 复用 fs:watch 通道逻辑重建
    try {
      this.watcher = chokidar.watch(roots, {
        ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        depth: 8,
        ignored: /(^|[/\\])\.(git|mazz[/\\]temp)|node_modules/,
      });
      this.watcher.on('all', (evt, p) => {
        this.wm.broadcast('file:changed', { event: evt, path: String(p).replace(/\\/g, '/'), at: Date.now() });
      });
      roots.forEach(p => this.watched.add(p));
    } catch {}
  }
}
module.exports = FileWatcher;
