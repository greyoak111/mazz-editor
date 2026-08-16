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
  async pruneRecovered(removeTabIds, keepTabIds) {
    if (!window.mazz?.isElectron) return 0;
    return window.mazz.invoke('snapshot:pruneOwned', { removeTabIds, keepTabIds }).catch(() => 0);
  }
  start() {
    this.timer = setInterval(async () => {
      for (const tabId of this.getters.keys()) await this.writeOne(tabId);
    }, 30000);
  }
  stop() { clearInterval(this.timer); }

  /** 启动时检查崩溃残留 */
  async checkRecovery(restoreFn, { role = 'main' } = {}) {
    if (!window.mazz?.isElectron) return;
    try {
      // 分窗正常首启不得消费全局恢复材料；只有主进程确认“该 child renderer 刚崩溃并重载”才自动恢复本 owner。
      if (role === 'child') {
        const local = await window.mazz.invoke('crash:consumeRendererRecovery');
        if (local?.crashed && local.snapshots?.length) {
          await restoreFn(local.snapshots, { reason: 'renderer-crash', automatic: true });
        }
        return;
      }
      const offer = await window.mazz.invoke('crash:consumeAppRecovery');
      if (!offer?.snapshots?.length) return;
      const restoreOffered = async selected => {
        const result = await restoreFn(selected, { reason: offer.reason });
        await window.mazz.invoke('crash:finalizeAppRecovery', {
          recoveryIds: result?.recoveryIds || [],
        });
        return result;
      };
      const discardOffered = () => window.mazz.invoke('crash:finalizeAppRecovery', { discardAll: true });
      bus.emit('recovery:available', offer.snapshots, restoreOffered, discardOffered);
    } catch (e) { console.warn('[snapshot] 恢复检查失败:', e.message); }
  }
}

export const snapshots = new SnapshotService();
