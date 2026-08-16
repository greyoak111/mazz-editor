// main/file-watcher.js —— chokidar 外部变更监听：磁盘被改 → 推送渲染进程提示重载/比对
'use strict';
const chokidar = require('chokidar');

class FileWatcher {
  constructor({ bus, windowManager, resourceLedger = null }) {
    this.watcher = null;
    this.wm = windowManager;
    this.watched = new Set();
    this.resourceLedger = resourceLedger;
    this.resourceKey = null;
    this.readyPromise = null;
    this._finishReady = null;
    this._readyTimer = null;

    bus.handle('fs:closeAll', async () => {
      await this.close({ clearRoots: true, reason: 'fs-close-all' });
      return true;
    });
    bus.handle('fs:watch', async ({ paths }) => {
      const list = Array.isArray(paths) ? paths : [paths];
      const fresh = list.filter(p => p && !this.watched.has(p));
      if (!fresh.length) {
        if (this.readyPromise) await this.readyPromise;
        return true;
      }
      fresh.forEach(p => this.watched.add(p));
      if (!this.watcher) {
        this._createWatcher(fresh);
        await this.readyPromise;
      } else {
        this.watcher.add(fresh);
        if (this.readyPromise) await this.readyPromise;
      }
      this._updateLedger('watch');
      return true;
    });
    bus.handle('fs:unwatch', async ({ paths }) => {
      const list = Array.isArray(paths) ? paths : [paths];
      if (this.watcher) await Promise.resolve(this.watcher.unwatch(list));
      list.forEach(p => this.watched.delete(p));
      if (!this.watched.size) await this.close({ clearRoots: false, reason: 'no-roots' });
      else this._updateLedger('unwatch');
      return true;
    });
  }

  _createWatcher(roots) {
    this.watcher = chokidar.watch(roots, {
      ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      depth: 8,
      ignored: /(^|[/\\])\.(git|mazz[/\\]temp)|node_modules/,
    });
    const watcher = this.watcher;
    this.readyPromise = new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this._readyTimer) clearTimeout(this._readyTimer);
        if (this._finishReady === finish) this._finishReady = null;
        this._readyTimer = null;
        resolve(true);
      };
      this._finishReady = finish;
      this._readyTimer = setTimeout(finish, 10000);
      this._readyTimer.unref?.();
      watcher.once('ready', finish);
    });
    watcher.on('all', (evt, p) => {
      // 渲染层路径统一正斜杠（与 fs:listDir / workspace:get 约定一致）
      this.wm.broadcast('file:changed', { event: evt, path: String(p).replace(/\\/g, '/'), at: Date.now() });
    });
    if (this.resourceLedger && !this.resourceKey) {
      this.resourceKey = this.resourceLedger.register({
        type: 'file-watcher', id: 'workspace', owner: 'file-watcher',
        meta: { roots: this.watched.size, reason: 'create' },
      });
    }
    this._updateLedger('create');
  }

  _updateLedger(reason) {
    if (!this.resourceLedger || !this.resourceKey) return;
    this.resourceLedger.update(this.resourceKey, {
      state: this.watcher ? 'watching' : 'closed',
      meta: { roots: this.watched.size, reason },
    });
  }

  _releaseLedger(reason) {
    if (!this.resourceLedger || !this.resourceKey) return;
    this.resourceLedger.release(this.resourceKey, { reason });
    this.resourceKey = null;
  }

  async close({ clearRoots = true, reason = 'close' } = {}) {
    const current = this.watcher;
    this.watcher = null;
    this._finishReady?.();
    if (current) {
      try { await current.close(); } catch {}
    }
    if (clearRoots) this.watched.clear();
    this.readyPromise = null;
    this._releaseLedger(reason);
  }

  /** 挂起监视（记下根目录，释放全部句柄）——删除/移动被监视的多层目录前用，Windows 上句柄会锁目录 */
  async suspend() {
    if (!this.watcher) return;
    await this.close({ clearRoots: false, reason: 'suspend' });
  }

  /** 恢复监视（重建实例并把根目录加回去） */
  async resume() {
    if (this.watcher || !this.watched.size) return;
    const roots = [...this.watched];
    this.watched.clear();
    // 复用 fs:watch 通道逻辑重建
    try {
      roots.forEach(p => this.watched.add(p));
      this._createWatcher(roots);
    } catch {}
  }
}
module.exports = FileWatcher;
