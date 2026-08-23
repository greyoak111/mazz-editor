'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeWorkflowPackage, stableStringify } = require('./foundation/organizational-kernel');

const LIBRARY_RECORD_SCHEMA = 'mazz.workflow-library-record/v0';
const WORKFLOW_EXPORT_SCHEMA = 'mazz.workflow-export/v0';
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;

const digest = value => crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
const safeId = value => crypto.createHash('sha256').update(String(value)).digest('hex');

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temp, file);
}

function readJson(file, limit = MAX_PACKAGE_BYTES) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > limit) throw new Error(`Workflow 文件无效或超过 ${limit} bytes`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function semverParts(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) throw new Error(`Workflow version 必须是 semver: ${version}`);
  return match.slice(1).map(Number);
}

function nextForkVersion(version) {
  const [major, minor, patch] = semverParts(version);
  return `${major}.${minor}.${patch + 1}`;
}

function diffValues(before, after, trail = '') {
  if (stableStringify(before) === stableStringify(after)) return [];
  if (Array.isArray(before) || Array.isArray(after) || before == null || after == null || typeof before !== 'object' || typeof after !== 'object') {
    return [{ path: trail || '$', before, after }];
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.flatMap(key => diffValues(before[key], after[key], trail ? `${trail}.${key}` : key));
}

class WorkflowLibrary {
  constructor({ rootProvider, now = () => new Date().toISOString() }) {
    this.rootProvider = rootProvider;
    this.now = now;
    this.migrations = new Map();
  }

  root() {
    const workspace = path.resolve(String(this.rootProvider?.() || ''));
    if (!workspace) throw new Error('Workflow Library 缺少 workspace');
    return path.join(workspace, '.mazz', 'workflows');
  }

  recordPath(workflowId, version) {
    return path.join(this.root(), safeId(workflowId), `${safeId(version)}.json`);
  }

  indexPath() { return path.join(this.root(), 'index.json'); }

  loadIndex() {
    try {
      const value = readJson(this.indexPath());
      return value?.schema === 'mazz.workflow-library-index/v0' && Array.isArray(value.records) ? value : { schema: 'mazz.workflow-library-index/v0', records: [] };
    } catch { return { schema: 'mazz.workflow-library-index/v0', records: [] }; }
  }

  writeIndex(index) { atomicWrite(this.indexPath(), `${JSON.stringify(index, null, 2)}\n`); }

  save(input, { source = 'create', authorityRef = 'human:workflow-owner', derivedFrom = null, migration = null } = {}) {
    if (!String(authorityRef).startsWith('human:')) throw new Error('Workflow Library 写入必须由 human Authority 发起');
    const packageValue = normalizeWorkflowPackage(input);
    const packageDigest = digest(packageValue);
    const file = this.recordPath(packageValue.workflowId, packageValue.version);
    const record = {
      schema: LIBRARY_RECORD_SCHEMA, workflowId: packageValue.workflowId, version: packageValue.version,
      packageDigest, status: 'ACTIVE', source, authorityRef, derivedFrom,
      migration, createdAt: this.now(), deprecatedAt: '', deprecationReason: '',
      runtimeIncluded: false, publicationGranted: false, package: packageValue,
    };
    if (fs.existsSync(file)) {
      const existing = readJson(file);
      if (existing.packageDigest !== packageDigest) throw new Error('同 workflowId/version 内容漂移，拒绝覆盖');
      return existing;
    }
    atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`);
    const index = this.loadIndex();
    index.records.push({ workflowId: record.workflowId, version: record.version, packageDigest, status: record.status, path: path.relative(this.root(), file).replace(/\\/g, '/'), createdAt: record.createdAt });
    index.records.sort((a, b) => `${a.workflowId}@${a.version}`.localeCompare(`${b.workflowId}@${b.version}`));
    this.writeIndex(index);
    return record;
  }

  create(input, options) { return this.save(input, { ...options, source: 'create' }); }

  list({ includeDeprecated = true } = {}) {
    const rows = this.loadIndex().records;
    return rows.filter(row => includeDeprecated || row.status !== 'DEPRECATED');
  }

  get(workflowId, version) { return readJson(this.recordPath(workflowId, version)); }

  importFile(file, options = {}) {
    const value = readJson(path.resolve(file));
    const packageValue = value.schema === WORKFLOW_EXPORT_SCHEMA ? value.package : value.package || value;
    return this.save(packageValue, { ...options, source: 'import', derivedFrom: value.derivedFrom || null });
  }

  exportFile(workflowId, version, destination) {
    const record = this.get(workflowId, version);
    const envelope = {
      schema: WORKFLOW_EXPORT_SCHEMA, workflowId, version,
      packageDigest: record.packageDigest, exportedAt: this.now(),
      derivedFrom: record.derivedFrom, runtimeIncluded: false, publicationGranted: false,
      package: record.package,
    };
    const text = `${JSON.stringify(envelope, null, 2)}\n`;
    if (Buffer.byteLength(text) > MAX_PACKAGE_BYTES) throw new Error('Workflow export 超过上限');
    atomicWrite(path.resolve(destination), text);
    return { path: path.resolve(destination), bytes: Buffer.byteLength(text), digest: digest(envelope), packageDigest: record.packageDigest };
  }

  fork(workflowId, version, { workflowId: nextId, version: nextVersion = '', name = '', authorityRef = 'human:workflow-owner' } = {}) {
    const record = this.get(workflowId, version);
    const forked = {
      ...record.package,
      workflowId: String(nextId || `${workflowId}:fork:${Date.now().toString(36)}`),
      version: nextVersion || nextForkVersion(version),
      name: name || `${record.package.name} (Fork)`,
      provenance: { ...record.package.provenance, derivedFrom: `${workflowId}@${version}`, forkedBy: authorityRef },
    };
    return this.save(forked, { source: 'fork', authorityRef, derivedFrom: { workflowId, version, packageDigest: record.packageDigest } });
  }

  diff(left, right) {
    const a = this.get(left.workflowId, left.version);
    const b = this.get(right.workflowId, right.version);
    const changes = diffValues(a.package, b.package);
    return { schema: 'mazz.workflow-diff/v0', left: { ...left, digest: a.packageDigest }, right: { ...right, digest: b.packageDigest }, changed: changes.length > 0, changes, runtimeCompared: false };
  }

  registerMigration({ migrationId, fromVersion, toVersion, apply }) {
    if (!migrationId || typeof apply !== 'function') throw new Error('Migration 必须有 id/apply');
    this.migrations.set(String(migrationId), { migrationId: String(migrationId), fromVersion: String(fromVersion), toVersion: String(toVersion), apply });
  }

  migrate(workflowId, version, migrationId, { authorityRef = 'human:workflow-owner' } = {}) {
    const migration = this.migrations.get(String(migrationId));
    if (!migration) throw new Error(`未知 Workflow migration: ${migrationId}`);
    if (version !== migration.fromVersion) throw new Error('Migration 起始版本不匹配');
    const record = this.get(workflowId, version);
    const migrated = migration.apply(JSON.parse(JSON.stringify(record.package)));
    migrated.workflowId = workflowId;
    migrated.version = migration.toVersion;
    return this.save(migrated, { source: 'migrate', authorityRef, derivedFrom: { workflowId, version, packageDigest: record.packageDigest }, migration: { migrationId, fromVersion: version, toVersion: migration.toVersion, previewDiff: diffValues(record.package, migrated) } });
  }

  deprecate(workflowId, version, { authorityRef = 'human:workflow-owner', reason }) {
    if (!String(authorityRef).startsWith('human:') || !String(reason || '').trim()) throw new Error('Deprecate 需要 human Authority 和理由');
    const file = this.recordPath(workflowId, version);
    const record = readJson(file);
    const updated = { ...record, status: 'DEPRECATED', deprecatedAt: this.now(), deprecationReason: String(reason) };
    atomicWrite(file, `${JSON.stringify(updated, null, 2)}\n`);
    const index = this.loadIndex();
    const row = index.records.find(item => item.workflowId === workflowId && item.version === version);
    if (row) row.status = 'DEPRECATED';
    this.writeIndex(index);
    return updated;
  }

  compatibility(workflowId, version, { capabilityIds = [], authorityRefs = [] } = {}) {
    const { package: packageValue } = this.get(workflowId, version);
    const requiredCapabilities = [...new Set(packageValue.seats.flatMap(seat => seat.requiredCapabilityIds))].sort();
    const requiredAuthorities = [...new Set(packageValue.gates.map(gate => gate.authorityRef))].sort();
    const missingCapabilities = requiredCapabilities.filter(id => !capabilityIds.includes(id));
    const missingAuthorities = requiredAuthorities.filter(id => !authorityRefs.includes(id));
    return { compatible: !missingCapabilities.length && !missingAuthorities.length, requiredCapabilities, requiredAuthorities, missingCapabilities, missingAuthorities, executionAuthorized: false };
  }
}

module.exports = { WorkflowLibrary, LIBRARY_RECORD_SCHEMA, WORKFLOW_EXPORT_SCHEMA, MAX_PACKAGE_BYTES, diffValues, digest };
