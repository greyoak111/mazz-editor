// W73h Factory Production Run owner registry：同一 Run 同时只允许一个 renderer 执行。
'use strict';

const clean = (value, max = 320) => String(value ?? '').trim().slice(0, max);

class FactoryRunOwnerRegistry {
  constructor({ resourceLedger = null, idFactory = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` } = {}) {
    this.resourceLedger = resourceLedger;
    this.idFactory = idFactory;
    this.active = new Map();
  }

  acquire({ runId, taskId, ownerId } = {}) {
    const run = clean(runId, 240);
    const task = clean(taskId, 240);
    const owner = clean(ownerId, 120);
    if (!run || !task || !owner) throw new Error('[factory-run-owner] runId/taskId/ownerId 必填');
    const existing = this.active.get(run);
    if (existing) {
      if (existing.ownerId === owner && existing.taskId === task) {
        return Object.freeze({ ok: true, code: 'IDEMPOTENT', runId: run, taskId: task, leaseId: existing.leaseId });
      }
      return Object.freeze({ ok: false, code: 'RUN_OWNER_ACTIVE', runId: run, taskId: task, message: 'BLOCKED: RUN_OWNER_ACTIVE' });
    }
    const leaseId = `run-owner:${run}:${clean(this.idFactory(), 160)}`;
    let resourceKey = null;
    if (this.resourceLedger) {
      resourceKey = this.resourceLedger.register({
        type: 'factory-run-owner', id: leaseId, owner: `renderer:${owner}`,
        meta: { runId: run, taskId: task },
      });
    }
    this.active.set(run, { runId: run, taskId: task, ownerId: owner, leaseId, resourceKey });
    return Object.freeze({ ok: true, code: 'ACQUIRED', runId: run, taskId: task, leaseId });
  }

  release({ runId, leaseId, ownerId, reason = 'released' } = {}) {
    const run = clean(runId, 240);
    const existing = this.active.get(run);
    if (!existing) return Object.freeze({ ok: true, code: 'ALREADY_RELEASED', runId: run });
    if (clean(ownerId, 120) !== existing.ownerId || clean(leaseId, 500) !== existing.leaseId) {
      return Object.freeze({ ok: false, code: 'RUN_OWNER_MISMATCH', runId: run, message: 'BLOCKED: RUN_OWNER_MISMATCH' });
    }
    this._release(existing, reason);
    return Object.freeze({ ok: true, code: 'RELEASED', runId: run, leaseId: existing.leaseId });
  }

  releaseOwner(ownerId, reason = 'renderer-destroyed') {
    const owner = clean(ownerId, 120);
    const records = [...this.active.values()].filter(record => record.ownerId === owner);
    for (const record of records) this._release(record, reason);
    return records.length;
  }

  _release(record, reason) {
    if (this.active.get(record.runId) !== record) return false;
    this.active.delete(record.runId);
    if (record.resourceKey) this.resourceLedger?.release(record.resourceKey, { reason: clean(reason, 160) || 'released' });
    return true;
  }

  destroy(reason = 'app-quit') {
    const records = [...this.active.values()];
    for (const record of records) this._release(record, reason);
    return records.length;
  }

  snapshot() {
    return [...this.active.values()].map(record => ({
      runId: record.runId, taskId: record.taskId, ownerId: record.ownerId, leaseId: record.leaseId,
    }));
  }

  healthSnapshot() {
    return Object.freeze({ activeOwners: this.active.size });
  }
}

module.exports = { FactoryRunOwnerRegistry };
