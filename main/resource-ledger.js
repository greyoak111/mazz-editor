// main/resource-ledger.js —— W71 资源账本：只记录生命周期事实，不持有资源本体
'use strict';

const SECRET_KEY = /(?:password|passwd|secret|token|api[-_]?key|authorization|cookie)/i;

function safeValue(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 500);
  if (depth >= 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 30).map(v => safeValue(v, depth + 1));
  if (typeof value !== 'object') return String(value).slice(0, 200);
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : safeValue(item, depth + 1);
  }
  return out;
}

class ResourceLedger {
  constructor({ now = () => Date.now(), historyLimit = 200 } = {}) {
    this.now = now;
    this.historyLimit = Math.max(0, Number(historyLimit) || 0);
    this.active = new Map();
    this.history = [];
  }

  register({ type, id, owner = 'app', state = 'active', meta = {} }) {
    const resourceType = String(type || '').trim();
    const resourceId = String(id || '').trim();
    if (!resourceType || !resourceId) throw new Error('[resources] type 与 id 必填');
    const key = `${resourceType}:${resourceId}`;
    if (this.active.has(key)) throw new Error(`[resources] 重复登记: ${key}`);
    const at = this.now();
    const entry = {
      key, type: resourceType, id: resourceId, owner: String(owner || 'app'),
      state: String(state || 'active'), createdAt: at, updatedAt: at,
      meta: safeValue(meta),
    };
    this.active.set(key, entry);
    return key;
  }

  update(key, { state, meta } = {}) {
    const entry = this.active.get(String(key || ''));
    if (!entry) return false;
    if (state) entry.state = String(state);
    if (meta && typeof meta === 'object') entry.meta = { ...entry.meta, ...safeValue(meta) };
    entry.updatedAt = this.now();
    return true;
  }

  release(key, { reason = 'released', state = 'released', meta } = {}) {
    const resourceKey = String(key || '');
    const entry = this.active.get(resourceKey);
    if (!entry) return false;
    this.active.delete(resourceKey);
    const released = {
      ...entry,
      state: String(state || 'released'),
      updatedAt: this.now(),
      releasedAt: this.now(),
      releaseReason: String(reason || 'released'),
      meta: meta && typeof meta === 'object' ? { ...entry.meta, ...safeValue(meta) } : entry.meta,
    };
    if (this.historyLimit > 0) {
      this.history.push(released);
      if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    }
    return true;
  }

  snapshot({ includeReleased = false } = {}) {
    const active = [...this.active.values()].map(entry => ({ ...entry, meta: safeValue(entry.meta) }));
    const byType = {};
    for (const entry of active) byType[entry.type] = (byType[entry.type] || 0) + 1;
    return {
      version: 1,
      capturedAt: this.now(),
      activeCount: active.length,
      byType,
      active,
      ...(includeReleased ? { released: this.history.map(entry => ({ ...entry, meta: safeValue(entry.meta) })) } : {}),
    };
  }

  clearHistory() { this.history = []; }
}

module.exports = { ResourceLedger, safeValue };
