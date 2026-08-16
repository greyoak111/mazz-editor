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
    fs.mkdirSync(this.dir, { recursive: true });

    // 上次若残留 RUNNING.flag 即非正常退出
    this.lastExitUnclean = fs.existsSync(this.flagFile);
    fs.writeFileSync(this.flagFile, String(Date.now()));
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
    const entries = () => fs.readdirSync(this.dir).filter(f => f.endsWith('.json')).map(file => {
      try { return { file: path.join(this.dir, file), record: JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8')) }; }
      catch { return null; }
    }).filter(Boolean);
    bus.handle('snapshot:write', async ({ tabId, title, filePath, moduleId, content, dirty, pinned, progress } = {}, event) => {
      if (!tabId) return false;
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
      try { fs.unlinkSync(snapshotFile(tabId, event)); } catch {}
      // 兼容清理旧版未分 owner 的快照；不会碰其他 renderer 的同名 tab。
      try { fs.unlinkSync(path.join(this.dir, encodeURIComponent(tabId) + '.json')); } catch {}
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
      return true;
    });
    bus.handle('crash:lastExitUnclean', async () => this.lastExitUnclean);
  }
}
module.exports = CrashRecovery;
