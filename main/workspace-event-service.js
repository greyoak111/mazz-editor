'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const events = require('./foundation/workspace-events');

function slash(value) { return String(value || '').replace(/\\/g, '/'); }
function workspaceId(root) { return `workspace:${crypto.createHash('sha256').update(path.resolve(root).toLocaleLowerCase('en-US')).digest('hex')}`; }

class WorkspaceEventService {
  constructor({ rootProvider, store, fsImpl = fs } = {}) {
    if (typeof rootProvider !== 'function' || !store) throw new Error('WorkspaceEventService 依赖 rootProvider/store');
    this.rootProvider = rootProvider; this.store = store; this.fs = fsImpl; this.cache = null;
  }
  root() { return path.resolve(this.rootProvider()); }
  folder() { return path.join(this.root(), '.mazz', 'events'); }
  file() { return path.join(this.folder(), 'ledger.ndjson'); }
  enabledKey() { return `w81.enabled.${workspaceId(this.root())}`; }
  enabled() { return this.store.get(this.enabledKey(), true) !== false; }
  setEnabled(value) { this.store.set(this.enabledKey(), value === true); return { enabled: this.enabled() }; }
  readRecords() {
    if (this.cache) return this.cache;
    const file = this.file();
    if (!this.fs.existsSync(file)) return (this.cache = []);
    const lines = String(this.fs.readFileSync(file, 'utf8')).split(/\r?\n/).filter(Boolean);
    const parsed = [], invalid = [];
    for (let i = 0; i < lines.length; i++) {
      try { parsed.push(JSON.parse(lines[i])); } catch (error) { invalid.push({ line: i + 1, reason: error.message, digest: crypto.createHash('sha256').update(lines[i]).digest('hex') }); }
    }
    if (invalid.length) {
      this.fs.mkdirSync(this.folder(), { recursive: true });
      const report = path.join(this.folder(), `recovery-${Date.now()}.json`);
      this.fs.writeFileSync(report, JSON.stringify({ source: slash(file), invalid, rawLedgerRetained: true }, null, 2));
      throw new Error(`事件账有 ${invalid.length} 行损坏；原账保留，恢复报告 ${slash(report)}`);
    }
    try { this.cache = events.verifyEventRecords(parsed); }
    catch (error) {
      this.fs.mkdirSync(this.folder(), { recursive: true });
      const report = path.join(this.folder(), `recovery-${Date.now()}.json`);
      this.fs.writeFileSync(report, JSON.stringify({ source: slash(file), invalid: [{ line: 0, reason: error.message, digest: crypto.createHash('sha256').update(lines.join('\n')).digest('hex') }], rawLedgerRetained: true }, null, 2));
      throw new Error(`事件账校验失败；原账保留，恢复报告 ${slash(report)}`);
    }
    return this.cache;
  }
  list({ limit = 500 } = {}) {
    const records = this.readRecords();
    return records.slice(-Math.max(1, Math.min(Number(limit) || 500, 5000))).map(record => record.event);
  }
  capture(input = {}) {
    if (!this.enabled()) return { recorded: false, reason: 'DISABLED' };
    const root = this.root();
    const event = events.normalizeWorkspaceEvent({ ...input, workspaceId: workspaceId(root), recordedAt: new Date().toISOString() });
    const records = this.readRecords();
    if (records.some(record => record.event.eventId === event.eventId)) return { recorded: false, duplicate: true, eventId: event.eventId };
    const record = events.createEventRecord(event, { sequence: records.length + 1, previousHash: records.at(-1)?.recordHash || '' });
    this.fs.mkdirSync(this.folder(), { recursive: true });
    this.fs.appendFileSync(this.file(), JSON.stringify(record) + '\n', 'utf8');
    this.cache = [...records, record];
    return { recorded: true, eventId: event.eventId, sequence: record.sequence };
  }
  snapshot() {
    const rows = this.list({ limit: 5000 });
    const stat = this.fs.existsSync(this.file()) ? this.fs.statSync(this.file()) : { size: 0 };
    return { enabled: this.enabled(), workspaceId: workspaceId(this.root()), events: rows, episodes: events.buildEpisodes(rows), count: rows.length, bytes: stat.size, localOnly: true, capturesKeystrokes: false, capturesSecrets: false, capturesClipboardBody: false };
  }
  search(query) { return events.searchOperationalHistory(this.list({ limit: 5000 }), query); }
  lifecycle(ref) { return events.aggregateConceptLifecycle(this.list({ limit: 5000 }), ref); }
  export() { return { schema: 'mazz.workspace-event-export/v0', exportedAt: new Date().toISOString(), ...this.snapshot() }; }
  applyRetention({ now = new Date().toISOString(), authorityRef, reason } = {}) {
    if (!String(authorityRef || '').startsWith('human:')) throw new Error('执行保留策略需要 human:* Authority');
    if (!String(reason || '').trim()) throw new Error('执行保留策略需要理由');
    const records = this.readRecords();
    const partition = events.partitionByRetention(records.map(record => record.event), { now });
    if (!partition.expire.length) return { applied: false, expired: 0, kept: partition.keep.length, archivedPath: '' };
    this.fs.mkdirSync(this.folder(), { recursive: true });
    const file = this.file();
    const archive = path.join(this.folder(), `ledger-retention-${Date.now()}.ndjson`);
    this.fs.renameSync(file, archive);
    const next = []; let previousHash = '';
    for (const event of partition.keep) {
      const record = events.createEventRecord(event, { sequence: next.length + 1, previousHash });
      next.push(record); previousHash = record.recordHash;
    }
    if (next.length) this.fs.writeFileSync(file, next.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    this.cache = next;
    return { applied: true, expired: partition.expire.length, kept: partition.keep.length, archivedPath: slash(archive), recoverable: true };
  }
  clear({ authorityRef, reason } = {}) {
    if (!String(authorityRef || '').startsWith('human:')) throw new Error('清空事件账需要 human:* Authority');
    if (!String(reason || '').trim()) throw new Error('清空事件账需要理由');
    const file = this.file();
    if (!this.fs.existsSync(file)) return { cleared: false, archivedPath: '' };
    const archive = path.join(this.folder(), `ledger-cleared-${Date.now()}.ndjson`);
    this.fs.renameSync(file, archive);
    this.cache = [];
    return { cleared: true, archivedPath: slash(archive), recoverable: true };
  }
}

module.exports = { WorkspaceEventService, workspaceId };
