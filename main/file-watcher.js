// main/file-watcher.js —— chokidar 外部变更监听：磁盘被改 → 推送渲染进程提示重载/比对
'use strict';
const chokidar = require('chokidar');
const path = require('path');

// Internal durability ledgers are not user-authored documents. Broadcasting
// every atomic job/inbox write would repeatedly rebuild the file tree while a
// Library acquisition is progressing. Keep the ignore predicate narrow:
// actual books below `书库/` must continue to produce external-change events.
function shouldIgnoreWatchPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (/(^|\/)\.git(?:\/|$)/i.test(normalized)) return true;
  if (/(^|\/)node_modules(?:\/|$)/i.test(normalized)) return true;
  if (/(^|\/)\.mazz\/temp(?:\/|$)/i.test(normalized)) return true;
  if (/(^|\/)\.mazz\/capability-runtime(?:\/|$)/i.test(normalized)) return true;
  if (/(^|\/)\.mazz\/capability-artifacts(?:\/|$)/i.test(normalized)) return true;
  return /(^|\/)书库\/\.resources(?:\/|$)/i.test(normalized);
}

class FileWatcher {
  constructor({
    bus,
    windowManager,
    resourceLedger = null,
    watchFactory = (roots, options) => chokidar.watch(roots, options),
    readyTimeoutMs = 10000,
  }) {
    this.watcher = null;
    this.wm = windowManager;
    this.watched = new Set();
    this.resourceLedger = resourceLedger;
    this.resourceKey = null;
    this.watchState = 'closed';
    this.readyOutcome = 'closed';
    this.lastWatchErrorCode = '';
    this.readyPromise = null;
    this._finishReady = null;
    this._readyTimer = null;
    this.restartPromise = null;
    this.watchFactory = watchFactory;
    this.readyTimeoutMs = Math.max(1, Number(readyTimeoutMs) || 10000);

    bus.handle('fs:closeAll', async () => {
      await this._waitForRestart();
      await this.close({ clearRoots: true, reason: 'fs-close-all' });
      return true;
    });
    bus.handle('fs:watch', async ({ paths }) => {
      await this._waitForRestart();
      const list = Array.isArray(paths) ? paths : [paths];
      const fresh = list.filter(p => p && !this.watched.has(p));
      fresh.forEach(p => this.watched.add(p));
      try {
        if (!this.watcher) {
          if (!this.watched.size) return true;
          // A failed restart deliberately retains every root.  Rebuild from the
          // complete preserved set, never just the newly requested subset.
          this._createWatcher([...this.watched]);
        } else if (fresh.length) {
          this.watcher.add(fresh);
        }
        const expected = this.watcher;
        if (this.readyPromise) await this.readyPromise;
        this._assertHealthy(expected);
        this._updateLedger('watch', 'watching');
        return true;
      } catch (error) {
        throw await this._degradeFailedStart(error, {
          releaseReason: 'watch-start-failed',
          ledgerReason: 'watch-start-failed',
          logLabel: 'start failed',
        });
      }
    });
    bus.handle('fs:unwatch', async ({ paths }) => {
      await this._waitForRestart();
      const list = Array.isArray(paths) ? paths : [paths];
      if (this.watcher) await Promise.resolve(this.watcher.unwatch(list));
      list.forEach(p => this.watched.delete(p));
      if (!this.watched.size) await this.close({ clearRoots: false, reason: 'no-roots' });
      else this._updateLedger('unwatch');
      return true;
    });
    bus.handle('fs:restartWatch', async () => {
      if (this.restartPromise) return this.restartPromise;
      const operation = this._restartWatch();
      this.restartPromise = operation;
      try {
        return await operation;
      } finally {
        if (this.restartPromise === operation) this.restartPromise = null;
      }
    });
  }

  async _waitForRestart() {
    if (!this.restartPromise) return;
    try { await this.restartPromise; } catch {}
  }

  async _restartWatch() {
    // 进入第一个 await 前一次性捕获全部根；其他 watcher IPC 会等待
    // restartPromise，故工作区目录与独立文件根不会在重建窗口内丢失。
    const roots = [...this.watched];
    if (!roots.length) return { ok: false, reason: 'no-watch-roots', roots: 0 };
    await this.close({ clearRoots: false, reason: 'watch-restart' });
    this.watched.clear();
    roots.forEach(root => this.watched.add(root));
    try {
      const created = this._createWatcher(roots);
      await this.readyPromise;
      this._assertHealthy(created);
      this._updateLedger('restart-ready', 'watching');
      return { ok: true, reason: 'restarted', roots: roots.length };
    } catch (error) {
      throw await this._degradeFailedStart(error, {
        releaseReason: 'watch-restart-failed',
        ledgerReason: 'restart-failed',
        logLabel: 'restart failed',
      });
    }
  }

  async _degradeFailedStart(error, { releaseReason, ledgerReason, logLabel }) {
    const code = this._safeErrorCode(error?.code, 'WATCH_START_FAILED');
    await this.close({ clearRoots: false, reason: releaseReason });
    this.watchState = 'degraded';
    this.readyOutcome = 'failed';
    this.lastWatchErrorCode = code;
    if (this.resourceLedger && !this.resourceKey) {
      this.resourceKey = this.resourceLedger.register({
        type: 'file-watcher', id: 'workspace', owner: 'file-watcher', state: 'degraded',
        meta: { roots: this.watched.size, reason: ledgerReason, code },
      });
    }
    this._updateLedger(ledgerReason, 'degraded');
    console.error(`[file-watcher] ${logLabel}: ${code}`);
    this.wm.broadcastShells?.('file:watch-error', { code, state: 'degraded', at: Date.now() });
    const failure = new Error(`文件监视启动失败（${code}）`);
    failure.code = code;
    return failure;
  }

  _createWatcher(roots) {
    const watcher = this.watchFactory(roots, {
      ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignored: shouldIgnoreWatchPath,
    });
    this.watcher = watcher;
    // 创建成功仍只是 starting；只有真实 ready 且无 fatal 才能转为 watching。
    this.watchState = 'starting';
    this.readyOutcome = 'pending';
    this.lastWatchErrorCode = '';
    this.readyPromise = new Promise(resolve => {
      let settled = false;
      const finish = (outcome = 'ready') => {
        if (settled) return;
        settled = true;
        this.readyOutcome = outcome;
        if (this._readyTimer) clearTimeout(this._readyTimer);
        if (this._finishReady === finish) this._finishReady = null;
        this._readyTimer = null;
        resolve(true);
      };
      this._finishReady = finish;
      this._readyTimer = setTimeout(() => finish('timeout'), this.readyTimeoutMs);
      this._readyTimer.unref?.();
      watcher.once('ready', () => finish('ready'));
    });
    watcher.on('all', (evt, p) => {
      // 渲染层路径统一正斜杠（与 fs:listDir / workspace:get 约定一致）
      this.wm.broadcastShells('file:changed', { event: evt, path: String(p).replace(/\\/g, '/'), at: Date.now() });
    });
    watcher.on('error', error => {
      // EventEmitter 会把无人处理的 `error` 升级为 uncaughtException。先接住
      // 所有 watcher 错误，再只对白名单内的 Windows 原子替换竞态保持健康。
      const code = this._safeErrorCode(error?.code);
      if (this.watcher !== watcher) {
        console.warn(`[file-watcher] closed watcher event: ${code}`);
        return;
      }
      if (this._isTransientChildError(error)) {
        // 不输出 error.message：其中通常包含用户工作区绝对路径。
        console.warn(`[file-watcher] transient child event: ${code}`);
        this._updateLedger(`watch-transient:${code}`, 'watching');
        return;
      }
      console.error(`[file-watcher] degraded: ${code}`);
      this.lastWatchErrorCode = code;
      this._updateLedger(`watch-error:${code}`, 'degraded');
      this.wm.broadcastShells?.('file:watch-error', {
        code,
        state: 'degraded',
        at: Date.now(),
      });
    });
    if (this.resourceLedger && !this.resourceKey) {
      this.resourceKey = this.resourceLedger.register({
        type: 'file-watcher', id: 'workspace', owner: 'file-watcher',
        meta: { roots: this.watched.size, reason: 'create' },
      });
    }
    this._updateLedger('create');
    return watcher;
  }

  _assertHealthy(expectedWatcher) {
    if (!expectedWatcher || this.watcher !== expectedWatcher) {
      const failure = new Error('文件监视实例已关闭');
      failure.code = 'WATCH_CLOSED';
      throw failure;
    }
    if (this.readyOutcome !== 'ready') {
      const code = this.readyOutcome === 'timeout' ? 'WATCH_READY_TIMEOUT' : (this.lastWatchErrorCode || 'WATCH_NOT_READY');
      if (this.watchState !== 'degraded') {
        this.lastWatchErrorCode = code;
        this._updateLedger(`watch-error:${code}`, 'degraded');
        this.wm.broadcastShells?.('file:watch-error', { code, state: 'degraded', at: Date.now() });
      }
      const failure = new Error(`文件监视未就绪（${code}）`);
      failure.code = code;
      throw failure;
    }
    if (this.watchState === 'degraded') {
      const code = this.lastWatchErrorCode || 'WATCH_DEGRADED';
      const failure = new Error(`文件监视已降级（${code}）`);
      failure.code = code;
      throw failure;
    }
    if (this.watchState !== 'starting' && this.watchState !== 'watching') {
      const failure = new Error('文件监视状态无效');
      failure.code = 'WATCH_INVALID_STATE';
      throw failure;
    }
  }

  _isTransientChildError(error) {
    const code = String(error?.code || '').toUpperCase();
    if (code !== 'EPERM' && code !== 'ENOENT') return false;
    const errorPath = typeof error?.path === 'string' ? error.path.trim() : '';
    if (!errorPath) return false;
    const canonical = value => {
      const resolved = path.resolve(String(value));
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const target = canonical(errorPath);
    return [...this.watched].some(root => {
      if (typeof root !== 'string' || !root.trim()) return false;
      const relative = path.relative(canonical(root), target);
      // 空串是根本身；绝对路径或 .. 前缀均在根之外。
      return Boolean(relative)
        && !path.isAbsolute(relative)
        && relative !== '..'
        && !relative.startsWith(`..${path.sep}`);
    });
  }

  _safeErrorCode(value, fallback = 'WATCH_ERROR') {
    const code = String(value || '').toUpperCase();
    return /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? code : fallback;
  }

  _updateLedger(reason, requestedState = null) {
    if (requestedState === 'degraded') this.watchState = 'degraded';
    else if (requestedState === 'watching' && this.watchState !== 'degraded') this.watchState = 'watching';
    else if (!this.watcher && this.watchState !== 'degraded') this.watchState = 'closed';
    if (!this.resourceLedger || !this.resourceKey) return;
    this.resourceLedger.update(this.resourceKey, {
      state: this.watchState,
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
    this.watchState = 'closed';
    this.readyOutcome = 'closed';
    this.lastWatchErrorCode = '';
    this._finishReady?.('closed');
    if (current) {
      try { await current.close(); } catch {}
    }
    if (clearRoots) this.watched.clear();
    this.readyPromise = null;
    this._releaseLedger(reason);
  }

  /** 挂起监视（记下根目录，释放全部句柄）——删除/移动被监视的多层目录前用，Windows 上句柄会锁目录 */
  async suspend() {
    await this._waitForRestart();
    if (!this.watcher) return;
    await this.close({ clearRoots: false, reason: 'suspend' });
  }

  /** 恢复监视（重建实例并把根目录加回去） */
  async resume() {
    await this._waitForRestart();
    if (this.watcher || !this.watched.size) return false;
    const roots = [...this.watched];
    try {
      const created = this._createWatcher(roots);
      await this.readyPromise;
      this._assertHealthy(created);
      this._updateLedger('resume-ready', 'watching');
      return true;
    } catch (error) {
      throw await this._degradeFailedStart(error, {
        releaseReason: 'watch-resume-failed',
        ledgerReason: 'resume-failed',
        logLabel: 'resume failed',
      });
    }
  }
}
module.exports = FileWatcher;
module.exports.shouldIgnoreWatchPath = shouldIgnoreWatchPath;
