// renderer/core/activity-center.js —— R2：被动通知事件账（可回看、可跳转、重启不丢）

const MAX_ITEMS = 240;

function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

export class ActivityCenter {
  constructor({ persist, onChange, clock = () => Date.now() } = {}) {
    this.persist = persist;
    this.onChange = onChange;
    this.clock = clock;
    this.items = [];
    this.seq = 0;
    this.saveTimer = null;
  }

  hydrate(snapshot) {
    const incoming = Array.isArray(snapshot) ? snapshot : snapshot?.items;
    if (!Array.isArray(incoming)) return this.snapshot();
    const byId = new Map(this.items.map(x => [x.id, x]));
    for (const raw of incoming) {
      const item = this._clean(raw);
      if (!item) continue;
      const old = byId.get(item.id);
      if (!old || item.updatedAt > old.updatedAt) byId.set(item.id, item);
    }
    this.items = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ITEMS);
    this._changed(false);
    return this.snapshot();
  }

  _clean(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').slice(0, 160);
    const title = String(raw.title || '').trim().slice(0, 240);
    if (!id || !title) return null;
    const at = Math.floor(Number(raw.at) || this.clock());
    return {
      id,
      source: String(raw.source || 'system').slice(0, 40),
      title,
      detail: String(raw.detail || '').slice(0, 2000),
      status: ['done', 'failed', 'info'].includes(raw.status) ? raw.status : 'done',
      at,
      updatedAt: Math.floor(Number(raw.updatedAt) || at),
      read: !!raw.read,
      target: clone(raw.target),
    };
  }

  publish(payload = {}) {
    const now = this.clock();
    const id = String(payload.id || `${payload.source || 'system'}-${now}-${++this.seq}`);
    const old = this.items.find(x => x.id === id);
    const item = this._clean({ ...old, ...payload, id, at: old?.at || now, updatedAt: now, read: false });
    if (!item) return null;
    this.items = [item, ...this.items.filter(x => x.id !== id)]
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ITEMS);
    this._changed();
    return item;
  }

  get(id) { return this.items.find(x => x.id === id) || null; }
  unreadCount() { return this.items.reduce((n, x) => n + (x.read ? 0 : 1), 0); }

  markRead(id, read = true) {
    let changed = false;
    for (const item of this.items) {
      if ((id === '*' || item.id === id) && item.read !== read) { item.read = read; changed = true; }
    }
    if (changed) this._changed();
    return changed;
  }

  clearRead() {
    const before = this.items.length;
    this.items = this.items.filter(x => !x.read);
    if (this.items.length !== before) this._changed();
    return before - this.items.length;
  }

  snapshot() { return { version: 1, unread: this.unreadCount(), items: clone(this.items) || [] }; }

  _changed(save = true) {
    const snapshot = this.snapshot();
    try { this.onChange?.(snapshot); } catch {}
    if (!save || typeof this.persist !== 'function') return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { try { this.persist(this.snapshot()); } catch {} }, 120);
  }
}
