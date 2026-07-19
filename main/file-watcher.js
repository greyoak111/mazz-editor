// main/file-watcher.js —— chokidar 外部变更监听：磁盘被改 → 推送渲染进程提示重载/比对
'use strict';
const chokidar = require('chokidar');

class FileWatcher {
  constructor({ bus, windowManager }) {
    this.watcher = null;
    this.wm = windowManager;
    this.watched = new Set();

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
          this.wm.broadcast('file:changed', { event: evt, path: p, at: Date.now() });
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
}
module.exports = FileWatcher;
