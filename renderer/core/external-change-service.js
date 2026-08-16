// renderer/core/external-change-service.js —— 外部文件变化的单一决策协议

export function normalizeChangePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function fileSignature(stat) {
  if (!stat?.exists) return null;
  const mtime = Number(stat.mtime ?? stat.mtimeMs);
  const size = Number(stat.size);
  if (!Number.isFinite(mtime) || !Number.isFinite(size)) return null;
  return `${size}:${mtime}`;
}

export function externalChangeDecision({ event, dirty = false, selfWrite = false } = {}) {
  if (event === 'unlink' || event === 'unlinkDir') return 'delete';
  if (event !== 'change' && event !== 'add') return 'ignore';
  if (selfWrite) return 'self-write';
  return dirty ? 'conflict' : 'reload';
}

export class ExternalChangeService {
  constructor({
    delay = 400,
    ownWriteTtl = 5000,
    now = () => Date.now(),
    setTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimer = timer => globalThis.clearTimeout(timer),
  } = {}) {
    this.delay = delay;
    this.ownWriteTtl = ownWriteTtl;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.pending = new Map();
    this.ownWrites = new Map();
  }

  markOwnWrite(path, stat) {
    const key = normalizeChangePath(path);
    const signature = fileSignature(stat);
    if (!key || !signature) return false;
    const previous = this.ownWrites.get(key);
    if (previous?.timer) this.clearTimer(previous.timer);
    const token = Symbol(key);
    const entry = { signature, expiresAt: this.now() + this.ownWriteTtl, token, timer: null };
    entry.timer = this.setTimer(() => {
      if (this.ownWrites.get(key)?.token === token) this.ownWrites.delete(key);
    }, this.ownWriteTtl);
    entry.timer?.unref?.();
    this.ownWrites.set(key, entry);
    return true;
  }

  isOwnWrite(path, stat) {
    const key = normalizeChangePath(path);
    const entry = this.ownWrites.get(key);
    if (!entry) return false;
    if (entry.expiresAt < this.now()) {
      if (entry.timer) this.clearTimer(entry.timer);
      this.ownWrites.delete(key);
      return false;
    }
    return entry.signature === fileSignature(stat);
  }

  schedule(tabId, callback) {
    if (!tabId || typeof callback !== 'function') return;
    const previous = this.pending.get(tabId);
    if (previous) this.clearTimer(previous);
    const timer = this.setTimer(async () => {
      if (this.pending.get(tabId) === timer) this.pending.delete(tabId);
      await callback();
    }, this.delay);
    timer?.unref?.();
    this.pending.set(tabId, timer);
  }

  cancel(tabId) {
    const timer = this.pending.get(tabId);
    if (timer) this.clearTimer(timer);
    this.pending.delete(tabId);
  }

  dispose() {
    for (const timer of this.pending.values()) this.clearTimer(timer);
    for (const entry of this.ownWrites.values()) if (entry.timer) this.clearTimer(entry.timer);
    this.pending.clear();
    this.ownWrites.clear();
  }
}
