// renderer/core/snapshot-service.js —— 自动保存 + 快照：每 30s + 变更防抖；崩溃恢复提示条
import { bus } from './events.js';

class SnapshotService {
  constructor() {
    this.getters = new Map(); // tabId -> () => {filePath, moduleId, content}
    this.timer = null;
    this.dirty = new Set();
  }
  track(tabId, getter) { this.getters.set(tabId, getter); }
  untrack(tabId) {
    this.getters.delete(tabId);
    this.dirty.delete(tabId);
    window.mazz?.invoke('snapshot:clear', { tabId }).catch(() => {});
  }
  markDirty(tabId) {
    this.dirty.add(tabId);
    clearTimeout(this._deb);
    this._deb = setTimeout(() => this.flush(), 2000);
  }
  async flush() {
    if (!window.mazz?.isElectron) return;
    for (const tabId of [...this.dirty]) await this.writeOne(tabId);
    this.dirty.clear();
  }
  async writeOne(tabId) {
    const g = this.getters.get(tabId);
    if (!g || !window.mazz?.isElectron) return;
    try {
      const snap = g();
      if (snap?.content != null) await window.mazz.invoke('snapshot:write', { tabId, ...snap });
    } catch (e) { console.error('[snapshot] 写快照失败:', e); }
  }
  start() {
    this.timer = setInterval(async () => {
      for (const tabId of this.getters.keys()) await this.writeOne(tabId);
    }, 30000);
  }
  stop() { clearInterval(this.timer); }

  /** 启动时检查崩溃残留 */
  async checkRecovery(restoreFn) {
    if (!window.mazz?.isElectron) return;
    try {
      const unclean = await window.mazz.invoke('crash:lastExitUnclean');
      const snaps = await window.mazz.invoke('snapshot:list');
      if (!snaps?.length) return;
      if (unclean) {
        bus.emit('recovery:available', snaps, restoreFn);
      } else {
        const unsaved = snaps.filter(s => !s.filePath);
        if (unsaved.length) bus.emit('recovery:available', unsaved, restoreFn);
      }
    } catch (e) { console.warn('[snapshot] 恢复检查失败:', e.message); }
  }
}

export const snapshots = new SnapshotService();
