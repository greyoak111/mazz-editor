// renderer/core/progress-relay.js —— R1：跨设备阅读/播放/编辑位置接力
// 渲染层只负责节流；持久化、路径归一与 LWW 裁决全部在 main/lansync.js。

export class ProgressRelay {
  constructor(invoke, { delay = 500 } = {}) {
    this.invoke = invoke;
    this.delay = delay;
    this.pending = new Map();
    this.timers = new Map();
  }

  _id(kind, path) { return `${kind}\u0000${path}`; }

  put(kind, path, value, { immediate = false } = {}) {
    if (!kind || !path || value == null || typeof this.invoke !== 'function') return Promise.resolve(null);
    const id = this._id(kind, path);
    this.pending.set(id, { kind, path, value });
    clearTimeout(this.timers.get(id));
    if (immediate) {
      // UI event handlers receive an explicit receipt rather than an
      // unhandled rejection. The payload is restored on failure, so the
      // strict flushAll() close gate can retry/report it later.
      return this.flush(id).then(
        result => ({ ok: true, result }),
        error => ({ ok: false, error }),
      );
    }
    this.timers.set(id, setTimeout(() => { void this.flush(id).catch(() => {}); }, this.delay));
    return Promise.resolve(null);
  }

  async flush(id) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const payload = this.pending.get(id);
    if (!payload) return null;
    this.pending.delete(id);
    try {
      const result = await this.invoke('sync:positionPut', payload);
      if (result == null || result === false || result?.ok === false) {
        throw Object.assign(new Error('阅读位置持久化未返回成功回执'), {
          code: 'PROGRESS_DURABILITY_FAILED', receipt: result,
        });
      }
      return result;
    } catch (error) {
      // A newer put supersedes this payload. Otherwise retain it so flushAll()
      // can retry and a window close cannot acknowledge a lost locator.
      if (!this.pending.has(id)) this.pending.set(id, payload);
      throw error;
    }
  }

  async flushAll() {
    return Promise.all([...this.pending.keys()].map(id => this.flush(id)));
  }

  get(kind, path) {
    if (!kind || !path || typeof this.invoke !== 'function') return Promise.resolve(null);
    return this.invoke('sync:positionGet', { kind, path }).catch(() => null);
  }
}
