'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const LibraryAcquisitionStore = require('./library-acquisition-store');
const contract = require('./library-resource-contract');
const source = require('./library-source-registry');

const RECORD_SCHEMA = 'mazz.library-resource-candidate-record/v1';
const CORRUPTION_SCHEMA = 'mazz.library-resource-candidate-corruption/v1';

function codedError(code, message, details) {
  return Object.assign(new Error(message), { code }, details || {});
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_RESOURCE_CATALOG_INVALID', `${label} 必须是原生精确字符串`);
  }
  contract.assertNoSecretString(value, label);
  return value;
}

function iso(value, label) {
  const text = exactString(value, label);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    throw codedError('LIBRARY_RESOURCE_CATALOG_INVALID', `${label} 必须是 ISO 时间`);
  }
  return new Date(timestamp).toISOString();
}

function recordId(candidateId, candidateFingerprint) {
  const identity = `${exactString(candidateId, 'candidateId')}:${exactString(candidateFingerprint, 'candidateFingerprint')}`;
  return `candidate-record-${crypto.createHash('sha256').update(identity).digest('hex')}`;
}

function normalizeRecord(input, { workspaceIdentity, now } = {}) {
  if (!isPlainRecord(input)) throw codedError('LIBRARY_RESOURCE_CATALOG_INVALID', 'Candidate record 必须是普通对象');
  const allowed = new Set([
    'schema', 'recordId', 'workspaceIdentity', 'candidateFingerprint', 'candidate',
    'descriptor', 'revision', 'observedAt',
  ]);
  if (Object.keys(input).some(key => !allowed.has(key))) {
    throw codedError('LIBRARY_RESOURCE_CATALOG_INVALID', 'Candidate record 含未知字段');
  }
  contract.assertNoSecrets(input, 'Candidate record');
  if (input.schema !== RECORD_SCHEMA) throw codedError('LIBRARY_RESOURCE_CATALOG_INVALID', 'Candidate record schema 非法');
  const candidate = contract.normalizeCandidate(input.candidate);
  const descriptor = source.normalizeDescriptor(input.descriptor, { now: input.observedAt || now });
  source.assertCandidateBinding(candidate, descriptor, { now: input.observedAt || now });
  const fingerprint = contract.deriveCandidateFingerprint(candidate);
  const expectedRecordId = recordId(candidate.candidateId, fingerprint);
  if (input.recordId !== expectedRecordId || input.candidateFingerprint !== fingerprint) {
    throw codedError('LIBRARY_RESOURCE_CATALOG_MISMATCH', 'Candidate record 身份或指纹不匹配');
  }
  const identity = exactString(input.workspaceIdentity, 'workspaceIdentity');
  if (workspaceIdentity && identity !== workspaceIdentity) {
    throw codedError('LIBRARY_RESOURCE_CATALOG_WORKSPACE_MISMATCH', 'Candidate record 属于另一 Workspace');
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw codedError('LIBRARY_RESOURCE_CATALOG_INVALID', 'Candidate record revision 非法');
  }
  return Object.freeze({
    schema: RECORD_SCHEMA,
    recordId: expectedRecordId,
    workspaceIdentity: identity,
    candidateFingerprint: fingerprint,
    candidate,
    descriptor,
    revision: input.revision,
    observedAt: iso(input.observedAt, 'observedAt'),
  });
}

class LibraryResourceCatalogStore {
  constructor(options = {}) {
    if (!isPlainRecord(options)) throw new TypeError('LibraryResourceCatalogStore options 必须是普通对象');
    this.fs = options.fsImpl || fs;
    this.clock = typeof options.now === 'function' ? options.now : () => new Date();
    this.randomId = typeof options.randomId === 'function'
      ? options.randomId : () => crypto.randomBytes(12).toString('hex');
    this.owner = options.acquisitionStore || new LibraryAcquisitionStore({
      workspacePath: options.workspacePath,
      recoverOnOpen: false,
      fsImpl: this.fs,
    });
    this.workspaceIdentity = this.owner.workspaceIdentity;
    this.root = path.join(this.owner.paths.resourcesRoot, 'candidates');
    this.records = new Map();
    this.corruptions = new Map();
    this.closed = false;
    this.owner._assertPhysicalBoundary(this.owner.paths.resourcesRoot, this.root);
    if (!this.fs.existsSync(this.root)) {
      this.fs.mkdirSync(this.root, { recursive: false });
      this.owner._fsyncDirectory(this.owner.paths.resourcesRoot);
    }
    this.owner._assertPhysicalBoundary(this.owner.paths.resourcesRoot, this.root);
    const stat = this.fs.lstatSync(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw codedError('LIBRARY_RESOURCE_CATALOG_UNSAFE_LAYOUT', 'Candidate catalog root 非物理目录');
    }
    this.rootIdentity = Object.freeze({
      realpath: this._realpath(this.root),
      dev: String(stat.dev),
      ino: String(stat.ino),
      birthtimeMs: Number.isFinite(Number(stat.birthtimeMs)) ? Number(stat.birthtimeMs) : null,
    });
    this._scan();
  }

  _realpath(target) {
    const native = this.fs.realpathSync?.native;
    return path.resolve(typeof native === 'function' ? native(target) : this.fs.realpathSync(target));
  }

  _now() {
    const value = this.clock();
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(timestamp)) throw codedError('LIBRARY_RESOURCE_CATALOG_CLOCK_INVALID', 'Candidate catalog clock 非法');
    return new Date(timestamp).toISOString();
  }

  _assertOpen() {
    if (this.closed) throw codedError('LIBRARY_RESOURCE_CATALOG_CLOSED', 'Candidate catalog 已关闭');
  }

  _assertRootStable() {
    this.owner._assertPhysicalBoundary(this.owner.paths.resourcesRoot, this.root);
    const stat = this.fs.lstatSync(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()
        || this._realpath(this.root) !== this.rootIdentity.realpath
        || String(stat.dev) !== this.rootIdentity.dev
        || String(stat.ino) !== this.rootIdentity.ino
        || (Number.isFinite(Number(stat.birthtimeMs)) ? Number(stat.birthtimeMs) : null) !== this.rootIdentity.birthtimeMs) {
      throw codedError('LIBRARY_RESOURCE_CATALOG_LAYOUT_CHANGED', 'Candidate catalog root 已被替换');
    }
  }

  _recordPath(id) {
    if (typeof id !== 'string' || !/^candidate-record-[a-f0-9]{64}$/.test(id)) {
      throw codedError('LIBRARY_RESOURCE_CATALOG_INVALID', 'Candidate recordId 非法');
    }
    return path.join(this.root, `${id}.json`);
  }

  _markCorruption(name, error) {
    this.corruptions.set(name, Object.freeze({
      schema: CORRUPTION_SCHEMA,
      name,
      code: typeof error?.code === 'string' && /^[A-Z][A-Z0-9_.-]*$/.test(error.code)
        ? error.code : 'LIBRARY_RESOURCE_CATALOG_CORRUPT',
    }));
  }

  _scan() {
    this._assertOpen();
    this._assertRootStable();
    const records = new Map();
    this.corruptions = new Map();
    for (const entry of this.fs.readdirSync(this.root, { withFileTypes: true })) {
      if (entry.name.endsWith('.tmp') || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -5);
      const target = path.join(this.root, entry.name);
      try {
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw codedError('LIBRARY_RESOURCE_CATALOG_CORRUPT', 'Candidate record 非普通文件');
        }
        this.owner._assertPhysicalBoundary(this.root, target, { mustBeRegularFile: true });
        const parsed = JSON.parse(this.fs.readFileSync(target, 'utf8'));
        const normalized = normalizeRecord(parsed, { workspaceIdentity: this.workspaceIdentity });
        if (normalized.recordId !== id) throw codedError('LIBRARY_RESOURCE_CATALOG_CORRUPT', '文件名与 Candidate record 不一致');
        records.set(normalized.recordId, normalized);
      } catch (error) {
        this._markCorruption(id, error);
      }
    }
    this.records = records;
    return this.list();
  }

  _assertHealthy() {
    if (this.corruptions.size) {
      throw codedError('LIBRARY_RESOURCE_CATALOG_REPAIR_REQUIRED', 'Candidate catalog 存在损坏，必须先修复');
    }
  }

  _writeTemp(id, record) {
    this._assertRootStable();
    const temporary = path.join(this.root, `.${id}.${this.randomId()}.tmp`);
    let fd;
    let primary = null;
    try {
      fd = this.fs.openSync(temporary, 'wx', 0o600);
      this.fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      this.fs.fsyncSync(fd);
      this.fs.closeSync(fd);
      fd = undefined;
      return temporary;
    } catch (error) {
      primary = error;
      throw error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch (cleanup) { if (primary) primary.cleanupError = cleanup; else throw cleanup; }
      }
      if (primary) {
        try { this.fs.unlinkSync(temporary); } catch (cleanup) { if (cleanup.code !== 'ENOENT') primary.cleanupError = cleanup; }
      }
    }
  }

  _publish(id, record, create) {
    const target = this._recordPath(id);
    const temporary = this._writeTemp(id, record);
    let primary = null;
    try {
      if (create) {
        try { this.fs.linkSync(temporary, target); }
        catch (error) {
          if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error?.code)) {
            throw codedError('LIBRARY_RESOURCE_CATALOG_ATOMIC_UNSUPPORTED', 'Candidate catalog filesystem 不支持原子 create', { cause: error });
          }
          throw error;
        }
      } else {
        this.fs.renameSync(temporary, target);
      }
      this.owner._fsyncDirectory(this.root);
    } catch (error) {
      primary = error;
      throw error;
    } finally {
      try { this.fs.unlinkSync(temporary); } catch (cleanup) {
        if (cleanup.code !== 'ENOENT') {
          if (primary) primary.cleanupError = cleanup;
          else throw cleanup;
        }
      }
    }
  }

  put(candidateInput, descriptorInput, { expectedRevision } = {}) {
    this._assertOpen();
    const observedAt = this._now();
    const candidate = contract.normalizeCandidate(candidateInput);
    const descriptor = source.normalizeDescriptor(descriptorInput, { now: observedAt });
    source.assertCandidateBinding(candidate, descriptor, { now: observedAt });
    const fingerprint = contract.deriveCandidateFingerprint(candidate);
    const id = recordId(candidate.candidateId, fingerprint);
    return this.owner._withMutationLock(`library-resource-candidate:${id}`, () => {
      this._scan();
      this._assertHealthy();
      const current = this.records.get(id) || null;
      if (current && current.candidateFingerprint === fingerprint
          && contract.stableJson(current.descriptor) === contract.stableJson(descriptor)) {
        return Object.freeze({ created: false, idempotent: true, record: clone(current) });
      }
      if (current) {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
          throw codedError('LIBRARY_RESOURCE_CATALOG_CONFLICT', 'Candidate catalog revision 冲突');
        }
      } else if (expectedRevision !== undefined && expectedRevision !== null && expectedRevision !== 0) {
        throw codedError('LIBRARY_RESOURCE_CATALOG_CONFLICT', 'Candidate catalog create revision 冲突');
      }
      const record = normalizeRecord({
        schema: RECORD_SCHEMA,
        recordId: id,
        workspaceIdentity: this.workspaceIdentity,
        candidateFingerprint: fingerprint,
        candidate,
        descriptor,
        revision: current ? current.revision + 1 : 1,
        observedAt,
      }, { workspaceIdentity: this.workspaceIdentity, now: observedAt });
      this._publish(id, record, !current);
      this.records.set(id, record);
      return Object.freeze({ created: !current, idempotent: false, record: clone(record) });
    });
  }

  get(candidateId, candidateFingerprint = '') {
    this._assertOpen();
    this._scan();
    this._assertHealthy();
    const id = exactString(candidateId, 'candidateId');
    const matches = [...this.records.values()].filter(item => item.candidate.candidateId === id);
    const record = candidateFingerprint
      ? matches.find(item => item.candidateFingerprint === exactString(candidateFingerprint, 'candidateFingerprint')) || null
      : matches.sort((left, right) => right.observedAt.localeCompare(left.observedAt, 'en'))[0] || null;
    if (!record) return null;
    if (candidateFingerprint && record.candidateFingerprint !== exactString(candidateFingerprint, 'candidateFingerprint')) {
      throw codedError('LIBRARY_RESOURCE_CATALOG_MISMATCH', 'Candidate fingerprint 已变化');
    }
    return clone(record);
  }

  list() {
    const latest = new Map();
    for (const record of this.records.values()) {
      const current = latest.get(record.candidate.candidateId);
      if (!current || record.observedAt > current.observedAt) latest.set(record.candidate.candidateId, record);
    }
    return Object.freeze([...latest.values()].map(clone)
      .sort((left, right) => left.candidate.candidateId.localeCompare(right.candidate.candidateId, 'en')));
  }

  listCorruptions() {
    return Object.freeze([...this.corruptions.values()].map(clone));
  }

  snapshot() {
    return Object.freeze({
      closed: this.closed,
      workspaceIdentity: this.workspaceIdentity,
      recordCount: this.records.size,
      corruptionCount: this.corruptions.size,
      timerCount: 0,
      listenerCount: 0,
      networkOwnerCount: 0,
    });
  }

  close() {
    this._assertOpen();
    this.closed = true;
    this.records.clear();
    this.corruptions.clear();
    return this.snapshot();
  }
}

module.exports = {
  RECORD_SCHEMA,
  CORRUPTION_SCHEMA,
  LibraryResourceCatalogStore,
  normalizeRecord,
  recordId,
};
