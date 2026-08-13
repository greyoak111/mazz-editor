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
    if (immediate) return this.flush(id);
    this.timers.set(id, setTimeout(() => this.flush(id), this.delay));
    return Promise.resolve(null);
  }

  async flush(id) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const payload = this.pending.get(id);
    if (!payload) return null;
    this.pending.delete(id);
    return this.invoke('sync:positionPut', payload).catch(() => null);
  }

  async flushAll() {
    return Promise.all([...this.pending.keys()].map(id => this.flush(id)));
  }

  get(kind, path) {
    if (!kind || !path || typeof this.invoke !== 'function') return Promise.resolve(null);
    return this.invoke('sync:positionGet', { kind, path }).catch(() => null);
  }
}
