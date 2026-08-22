// renderer/core/snapshot-service.js —— 自动保存 + 快照：每 30s + 变更防抖；崩溃恢复提示条
import { bus } from './events.js';

export class SnapshotService {
  constructor() {
    this.getters = new Map(); // tabId -> () => {filePath, moduleId, content}
    this.timer = null;
    this.dirty = new Set();
    this.dirtyRevision = new Map();
  }
  track(tabId, getter) { this.getters.set(tabId, getter); }
  replaceTracking(tabId, getter, { dirty = false } = {}) {
    this.getters.set(tabId, getter);
    if (!dirty) {
      this.dirty.delete(tabId);
      this.dirtyRevision.delete(tabId);
    }
  }
  untrack(tabId) {
    this.getters.delete(tabId);
    this.dirty.delete(tabId);
    this.dirtyRevision.delete(tabId);
    window.mazz?.invoke('snapshot:clear', { tabId }).catch(() => {});
  }
  async untrackStrict(tabId) {
    if (window.mazz?.isElectron) {
      const result = await window.mazz.invoke('snapshot:clear', { tabId });
      if (result !== true && result?.ok !== true) throw new Error(`snapshot:clear rejected for ${tabId}`);
    }
    // A rejected clear leaves the live getter/dirty marker intact so the
    // owner can retry; never acknowledge an untrack that only happened in RAM.
    this.getters.delete(tabId);
    this.dirty.delete(tabId);
    this.dirtyRevision.delete(tabId);
    if (!window.mazz?.isElectron) return { ok: true, skipped: true };
    return { ok: true };
  }
  markDirty(tabId) {
    this.dirty.add(tabId);
    this.dirtyRevision.set(tabId, (this.dirtyRevision.get(tabId) || 0) + 1);
    clearTimeout(this._deb);
    this._deb = setTimeout(() => this.flush(), 2000);
  }
  async flush({ strict = false } = {}) {
    if (!window.mazz?.isElectron) return [];
    const receipts = [];
    for (const tabId of [...this.dirty]) {
      const revision = this.dirtyRevision.get(tabId) || 0;
      try {
        const receipt = await this.writeOneStrict(tabId);
        receipts.push(receipt);
        if (receipt?.skipped) {
          if (strict) throw Object.assign(new Error(`snapshot getter missing for ${tabId}`), {
            code: 'SNAPSHOT_DURABILITY_SKIPPED', tabId,
          });
          continue;
        }
        // An edit may have marked the same tab dirty while IPC was in flight.
        // Clear only the exact revision that reached disk.
        if ((this.dirtyRevision.get(tabId) || 0) === revision) {
          this.dirty.delete(tabId);
          this.dirtyRevision.delete(tabId);
        }
      } catch (error) {
        console.error('[snapshot] 写快照失败:', error);
        if (strict) throw error;
      }
    }
    return receipts;
  }
  flushStrict() { return this.flush({ strict: true }); }
  async writeOne(tabId) {
    try {
      return await this.writeOneStrict(tabId);
    } catch (e) {
      console.error('[snapshot] 写快照失败:', e);
      return false;
    }
  }
  async writeOneStrict(tabId) {
    const g = this.getters.get(tabId);
    if (!g || !window.mazz?.isElectron) return { ok: true, skipped: true };
    const snap = g();
    return this.writePayloadStrict(tabId, snap);
  }
  async writePayloadStrict(tabId, snap) {
    if (!window.mazz?.isElectron || snap?.content == null) return { ok: true, skipped: true };
    const result = await window.mazz.invoke('snapshot:write', { tabId, ...snap });
    if (result !== true && result?.ok !== true) throw new Error(`snapshot:write rejected for ${tabId}`);
    return { ok: true };
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
