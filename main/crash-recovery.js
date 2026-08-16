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

    // 渲染进程每 30s（及内容变更防抖后）推送快照，主进程原子落盘
    const ownerId = event => `${this.runId}:${String(event?.sender?.id || 'legacy')}`;
    const snapshotFile = (tabId, event) => path.join(this.dir, encodeURIComponent(`${ownerId(event)}:${tabId}`) + '.json');
    bus.handle('snapshot:write', async ({ tabId, filePath, moduleId, content }, event) => {
      if (!tabId) return false;
      const file = snapshotFile(tabId, event);
      const rec = { tabId, ownerId: ownerId(event), filePath, moduleId, content, savedAt: Date.now() };
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(rec));
      fs.renameSync(tmp, file);
      return true;
    });
    bus.handle('snapshot:list', async () => {
      return fs.readdirSync(this.dir).filter(f => f.endsWith('.json')).map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')); }
        catch { return null; }
      }).filter(Boolean).sort((a, b) => b.savedAt - a.savedAt);
    });
    bus.handle('snapshot:clear', async ({ tabId }, event) => {
      try { fs.unlinkSync(snapshotFile(tabId, event)); } catch {}
      // 兼容清理旧版未分 owner 的快照；不会碰其他 renderer 的同名 tab。
      try { fs.unlinkSync(path.join(this.dir, encodeURIComponent(tabId) + '.json')); } catch {}
      return true;
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
