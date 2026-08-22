// main/crash-recovery.js —— 崩溃恢复守护：快照落盘 + 事务日志 + 异常退出标记
'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

class CrashRecovery {
  constructor({ app, bus }) {
    this.dir = path.join(app.getPath('userData'), 'snapshots');
    this.runId = randomUUID();
    this.flagFile = path.join(this.dir, 'RUNNING.flag');
    this.pendingRecoveryFile = path.join(this.dir, 'RECOVERY_PENDING.flag');
    fs.mkdirSync(this.dir, { recursive: true });

    // 上次若残留 RUNNING.flag 即非正常退出；新格式同时留下 runId，恢复时只取真正事故批次。
    this.lastExitUnclean = fs.existsSync(this.flagFile);
    this.previousRunId = null;
    if (this.lastExitUnclean) {
      try { this.previousRunId = JSON.parse(fs.readFileSync(this.flagFile, 'utf8'))?.runId || null; } catch {}
    }
    this.pendingRecoveryIds = new Set();
    this.sealedSnapshots = new Set();
    try {
      const pending = JSON.parse(fs.readFileSync(this.pendingRecoveryFile, 'utf8'));
      for (const id of pending?.recoveryIds || []) this.pendingRecoveryIds.add(String(id));
    } catch {}
    fs.writeFileSync(this.flagFile, JSON.stringify({ schemaVersion: 1, runId: this.runId, startedAt: Date.now() }));
    app.on('will-quit', () => { try { fs.unlinkSync(this.flagFile); } catch {} });

    // BrowserWindow 本体未死、只有 child renderer 崩溃时，RUNNING.flag 不能表达这次局部事故。
    // 这里只记录完整工作台分窗；Panel / WebContentsView 仍由各自 owner 的生命周期负责。
    this.crashedChildRenderers = new Set();
    app.on('render-process-gone', (_event, webContents, details = {}) => {
      const reason = details.reason || '';
      const isChildShell = (() => {
        try { return new URL(webContents?.getURL?.() || '').searchParams.get('role') === 'child'; }
        catch { return false; }
      })();
      if (!isChildShell || reason === 'clean-exit' || reason === 'killed') return;
      const id = webContents?.id;
      if (!id) return;
      this.crashedChildRenderers.add(id);
      try { webContents.once('destroyed', () => this.crashedChildRenderers.delete(id)); } catch {}
    });

    // 渲染进程每 30s（及内容变更防抖后）推送快照，主进程原子落盘
    const ownerId = event => `${this.runId}:${String(event?.sender?.id || 'legacy')}`;
    const snapshotFile = (tabId, event) => path.join(this.dir, encodeURIComponent(`${ownerId(event)}:${tabId}`) + '.json');
    this.snapshotFileForOwner = (tabId, senderId) => path.join(
      this.dir,
      encodeURIComponent(`${this.runId}:${String(senderId || 'legacy')}:${tabId}`) + '.json',
    );
    const entries = () => fs.readdirSync(this.dir).filter(f => f.endsWith('.json')).map(file => {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8'));
        const senderId = String(record?.ownerId || '').split(':').at(-1);
        if (this.sealedSnapshots.has(`${senderId}:${record?.tabId}`)) return null;
        return { file: path.join(this.dir, file), record };
      }
      catch { return null; }
    }).filter(Boolean);
    // 冻结进程启动前已经存在的恢复材料；本轮新写快照绝不能混进上次事故的候选集。
    this.startupRecoveryEntries = entries();
    this.appRecoveryOffer = null;
    this.appRecoveryDone = false;
    const startupById = new Map(this.startupRecoveryEntries.map(entry => [path.basename(entry.file), entry]));
    this.pendingRecoveryIds = new Set([...this.pendingRecoveryIds].filter(id => startupById.has(id)));
    if (this.lastExitUnclean && this.startupRecoveryEntries.length) {
      let incident = this.previousRunId
        ? this.startupRecoveryEntries.filter(entry => String(entry.record?.ownerId || '').startsWith(`${this.previousRunId}:`))
        : [];
      // 兼容旧版只有时间戳的 RUNNING.flag：退化为 savedAt 最新的同 run owner 组，不吞全部历史。
      if (!incident.length && !this.previousRunId) {
        const groups = new Map();
        for (const entry of this.startupRecoveryEntries) {
          const owner = String(entry.record?.ownerId || 'legacy');
          const split = owner.lastIndexOf(':');
          const run = split > 0 ? owner.slice(0, split) : owner;
          const group = groups.get(run) || { savedAt: 0, entries: [] };
          group.savedAt = Math.max(group.savedAt, Number(entry.record?.savedAt || 0));
          group.entries.push(entry);
          groups.set(run, group);
        }
        incident = [...groups.values()].sort((a, b) => b.savedAt - a.savedAt)[0]?.entries || [];
      }
      for (const entry of incident) this.pendingRecoveryIds.add(path.basename(entry.file));
    }
    if (this.pendingRecoveryIds.size) {
      fs.writeFileSync(this.pendingRecoveryFile, JSON.stringify({
        schemaVersion: 1, recoveryIds: [...this.pendingRecoveryIds], updatedAt: Date.now(),
      }));
    } else {
      try { fs.unlinkSync(this.pendingRecoveryFile); } catch {}
    }
    bus.handle('snapshot:write', async ({ tabId, title, filePath, moduleId, content, dirty, pinned, progress } = {}, event) => {
      if (!tabId) return false;
      if (this.sealedSnapshots.has(`${String(event?.sender?.id || 'legacy')}:${tabId}`)) return false;
      const file = snapshotFile(tabId, event);
      const rec = {
        tabId, ownerId: ownerId(event), title: title || null, filePath, moduleId, content,
        dirty: dirty !== false, pinned: !!pinned, progress: progress ?? null, savedAt: Date.now(),
      };
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(rec));
      fs.renameSync(tmp, file);
      return true;
    });
    bus.handle('snapshot:list', async () => {
      return entries().map(x => x.record).sort((a, b) => b.savedAt - a.savedAt);
    });
    bus.handle('snapshot:clear', async ({ tabId }, event) => {
      try { fs.unlinkSync(snapshotFile(tabId, event)); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      // 兼容清理旧版未分 owner 的快照；不会碰其他 renderer 的同名 tab。
      try { fs.unlinkSync(path.join(this.dir, encodeURIComponent(tabId) + '.json')); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      return true;
    });
    // child reload 后只交付该 WebContents 在本次 app run 内的快照；一次消费，禁止其他窗口冒领。
    bus.handle('crash:consumeRendererRecovery', async (payload, event) => {
      const senderId = event?.sender?.id;
      if (!senderId || !this.crashedChildRenderers.delete(senderId)) return { crashed: false, snapshots: [] };
      const owner = ownerId(event);
      const snapshots = entries().map(x => x.record)
        .filter(record => record.ownerId === owner)
        .sort((a, b) => String(a.tabId).localeCompare(String(b.tabId), undefined, { numeric: true }));
      return { crashed: true, snapshots };
    });
    // 整应用异常退出后的恢复材料只交付主工作台。调用可在 main renderer 自身重载后重入，
    // 但在显式完成/忽略前始终指向同一批启动前文件，不会夹入本轮新快照。
    bus.handle('crash:consumeAppRecovery', async (payload, event) => {
      const isMainShell = (() => {
        try {
          const url = new URL(event?.sender?.getURL?.() || '');
          return url.protocol === 'mazz-res:' && url.hostname === 'app'
            && url.pathname.endsWith('/index.html') && url.searchParams.get('role') !== 'child';
        } catch { return false; }
      })();
      if (!isMainShell || this.appRecoveryDone) return { reason: null, snapshots: [] };
      if (!this.appRecoveryOffer) {
        const reason = this.lastExitUnclean || this.pendingRecoveryIds.size ? 'app-unclean' : 'unsaved';
        const selected = reason === 'app-unclean'
          ? this.startupRecoveryEntries.filter(entry => this.pendingRecoveryIds.has(path.basename(entry.file)))
          : this.startupRecoveryEntries.filter(entry => !entry.record?.filePath);
        if (!selected.length) {
          this.appRecoveryDone = true;
          try { fs.unlinkSync(this.pendingRecoveryFile); } catch {}
        }
        this.appRecoveryOffer = {
          reason: selected.length ? reason : null,
          entries: new Map(selected.map(entry => [path.basename(entry.file), entry])),
        };
      }
      return {
        reason: this.appRecoveryOffer.reason,
        snapshots: [...this.appRecoveryOffer.entries].map(([recoveryId, entry]) => ({
          ...entry.record, recoveryId,
        })),
      };
    });
    bus.handle('crash:finalizeAppRecovery', async ({ recoveryIds = [], discardAll = false } = {}, event) => {
      if (!this.appRecoveryOffer) return { removed: 0, remaining: 0 };
      const isMainShell = (() => {
        try {
          const url = new URL(event?.sender?.getURL?.() || '');
          return url.protocol === 'mazz-res:' && url.hostname === 'app'
            && url.pathname.endsWith('/index.html') && url.searchParams.get('role') !== 'child';
        } catch { return false; }
      })();
      if (!isMainShell) return { removed: 0, remaining: this.appRecoveryOffer.entries.size };
      const ids = discardAll ? new Set(this.appRecoveryOffer.entries.keys()) : new Set(recoveryIds.map(String));
      let removed = 0;
      for (const id of ids) {
        const entry = this.appRecoveryOffer.entries.get(id);
        if (!entry) continue;
        let deleted = false;
        try { fs.unlinkSync(entry.file); deleted = true; } catch { deleted = !fs.existsSync(entry.file); }
        if (!deleted) continue;
        removed++;
        this.appRecoveryOffer.entries.delete(id);
      }
      const remaining = this.appRecoveryOffer.entries.size;
      this.appRecoveryDone = remaining === 0;
      if (this.appRecoveryDone) {
        try { fs.unlinkSync(this.pendingRecoveryFile); } catch {}
      } else {
        fs.writeFileSync(this.pendingRecoveryFile, JSON.stringify({
          schemaVersion: 1, recoveryIds: [...this.appRecoveryOffer.entries.keys()], updatedAt: Date.now(),
        }));
      }
      return { removed, remaining };
    });
    // 恢复后清理由旧 tabId 遗留、且没有被新标签继续占用的当前 owner 快照。
    bus.handle('snapshot:pruneOwned', async ({ removeTabIds = [], keepTabIds = [] } = {}, event) => {
      const owner = ownerId(event);
      const remove = new Set(removeTabIds.map(String));
      const keep = new Set(keepTabIds.map(String));
      let removed = 0;
      for (const entry of entries()) {
        const tabId = String(entry.record?.tabId || '');
        if (entry.record?.ownerId !== owner || !remove.has(tabId) || keep.has(tabId)) continue;
        try { fs.unlinkSync(entry.file); removed++; } catch {}
      }
      return removed;
    });
    bus.handle('snapshot:clearAll', async () => {
      for (const f of fs.readdirSync(this.dir)) {
        if (f.endsWith('.json')) { try { fs.unlinkSync(path.join(this.dir, f)); } catch {} }
      }
      try { fs.unlinkSync(this.pendingRecoveryFile); } catch {}
      return true;
    });
    bus.handle('crash:lastExitUnclean', async () => this.lastExitUnclean);
  }

  /** Main-process handoff settlement: once the target recovery snapshot is
   * durable, retire the exact source owner before target publication. */
  clearOwnedSnapshot(tabId, senderId) {
    if (!tabId || !senderId) return false;
    this.sealedSnapshots.add(`${String(senderId)}:${tabId}`);
    const file = this.snapshotFileForOwner(tabId, senderId);
    try { fs.unlinkSync(file); }
    catch (error) {
      if (error?.code !== 'ENOENT') {
        try { fs.renameSync(file, `${file}.superseded`); }
        catch { throw error; }
      }
    }
    return true;
  }
}
module.exports = CrashRecovery;
