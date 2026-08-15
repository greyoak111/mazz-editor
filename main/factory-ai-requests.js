// main/factory-ai-requests.js —— Factory AI 请求的主进程生命周期 owner
'use strict';

class FactoryAiRequestRegistry {
  constructor({ resourceLedger = null, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.resourceLedger = resourceLedger;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.active = new Map();
  }

  begin(requestId, { kind = 'chat', timeoutMs = 180000, model = '', ownerId = '' } = {}) {
    const id = String(requestId || '').trim();
    if (!id) throw new Error('[factory-ai] requestId 必填');
    if (this.active.has(id)) throw new Error(`[factory-ai] duplicate requestId: ${id}`);

    const controller = new AbortController();
    const record = {
      id,
      kind: String(kind || 'chat'),
      ownerId: String(ownerId || ''),
      controller,
      reader: null,
      timer: null,
      cancelled: false,
      cancelReason: '',
      closed: false,
      resourceKey: null,
    };
    if (this.resourceLedger) {
      record.resourceKey = this.resourceLedger.register({
        type: 'factory-ai-request', id, owner: 'factory-ai',
        meta: { kind: record.kind, model: String(model || '').slice(0, 120), ownerId: record.ownerId },
      });
    }
    this.active.set(id, record);
    const timeout = Math.max(0, Number(timeoutMs) || 0);
    if (timeout) record.timer = this.setTimer(() => { this.cancel(id, 'timeout').catch(() => {}); }, timeout);

    return {
      id,
      signal: controller.signal,
      get cancelled() { return record.cancelled; },
      get cancelReason() { return record.cancelReason; },
      attachReader: reader => { if (!record.closed) record.reader = reader || null; },
      close: options => this._close(record, options),
    };
  }

  async cancel(requestId, reason = 'renderer-cancel', { ownerId = '' } = {}) {
    const record = this.active.get(String(requestId || ''));
    if (!record || record.closed) return false;
    if (ownerId && record.ownerId && String(ownerId) !== record.ownerId) return false;
    if (!record.cancelled) {
      record.cancelled = true;
      record.cancelReason = String(reason || 'cancelled');
      try { record.controller.abort(new Error(record.cancelReason)); } catch { record.controller.abort(); }
      if (record.resourceKey) this.resourceLedger?.update(record.resourceKey, { state: 'cancelling', meta: { reason: record.cancelReason } });
    }
    try { await record.reader?.cancel?.(record.cancelReason); } catch {}
    return true;
  }

  async _close(record, { reason = '' } = {}) {
    if (!record || record.closed) return false;
    record.closed = true;
    if (record.timer) this.clearTimer(record.timer);
    record.timer = null;
    try { record.reader?.releaseLock?.(); } catch {}
    if (this.active.get(record.id) === record) this.active.delete(record.id);
    if (record.resourceKey) {
      this.resourceLedger?.release(record.resourceKey, {
        reason: reason || record.cancelReason || 'completed',
        state: record.cancelled ? 'cancelled' : 'released',
      });
    }
    return true;
  }

  async destroy(reason = 'app-quit') {
    const records = [...this.active.values()];
    await Promise.all(records.map(record => this.cancel(record.id, reason)));
    await Promise.all(records.map(record => this._close(record, { reason })));
  }

  async cancelOwner(ownerId, reason = 'renderer-destroyed') {
    const id = String(ownerId || '');
    const records = [...this.active.values()].filter(record => record.ownerId === id);
    await Promise.all(records.map(record => this.cancel(record.id, reason, { ownerId: id })));
    return records.length;
  }

  snapshot() {
    return [...this.active.values()].map(record => ({
      id: record.id, kind: record.kind, ownerId: record.ownerId, cancelled: record.cancelled, cancelReason: record.cancelReason,
    }));
  }
}

module.exports = { FactoryAiRequestRegistry };
