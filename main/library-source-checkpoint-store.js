'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contract = require('./library-resource-contract');
const { LibraryAcquisitionStore } = require('./library-acquisition-store');

const CHECKPOINT_SCHEMA = 'mazz.library-source-checkpoint/v1';
const CORRUPTION_SCHEMA = 'mazz.library-source-checkpoint-corruption/v1';

function codedError(code, message, details) {
  return Object.assign(new Error(message), { code }, details || {});
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', label + ' 必须是原生精确字符串');
  }
  contract.assertNoSecretString(value, label);
  return value;
}

function opaqueId(value, label) {
  const text = exactString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', label + ' 必须是 opaque identity');
  }
  return text;
}

function iso(value, label) {
  const text = exactString(value, label);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', label + ' 必须是 ISO 时间');
  return new Date(timestamp).toISOString();
}

function canonicalJson(value) {
  return contract.stableJson(value);
}

function digest(prefix, material) {
  return prefix + '-' + crypto.createHash('sha256').update(material, 'utf8').digest('hex');
}

function queryHash(query) {
  return digest('query-sha256', exactString(query, 'query'));
}

function checkpointId(providerId, queryDigest) {
  return digest('source-checkpoint-sha256', canonicalJson({
    providerId: opaqueId(providerId, 'providerId'),
    queryHash: exactString(queryDigest, 'queryHash'),
  }));
}

function validatorHash(value) {
  if (value === undefined || value === '') return '';
  return digest('validator-sha256', exactString(value, 'validator'));
}

function normalizeRecord(input, context) {
  if (!isPlainRecord(input)) throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'checkpoint 必须是普通对象');
  const fields = [
    'schema', 'checkpointId', 'workspaceIdentity', 'providerId', 'adapterVersion',
    'policyVersion', 'queryHash', 'cursorToken', 'nextUrl', 'validatorHash',
    'observedAt', 'revision',
  ];
  const unknown = Object.keys(input).filter(key => !fields.includes(key));
  if (unknown.length) throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'checkpoint 含未知字段');
  contract.assertNoSecrets(input, 'source checkpoint');
  if (input.schema !== CHECKPOINT_SCHEMA) throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'checkpoint schema 非法');
  if (input.workspaceIdentity !== context.workspaceIdentity) {
    throw codedError('LIBRARY_SOURCE_CHECKPOINT_WORKSPACE_MISMATCH', 'checkpoint 不属于当前 Workspace');
  }
  const provider = opaqueId(input.providerId, 'providerId');
  const adapterVersion = opaqueId(input.adapterVersion, 'adapterVersion');
  const policyVersion = opaqueId(input.policyVersion, 'policyVersion');
  const queryDigest = exactString(input.queryHash, 'queryHash');
  if (!/^query-sha256-[a-f0-9]{64}$/.test(queryDigest)) {
    throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'queryHash 非法');
  }
  const expectedId = checkpointId(provider, queryDigest);
  if (input.checkpointId !== expectedId) throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'checkpointId 与来源/query 不一致');
  let cursorToken = null;
  let nextUrl = '';
  if (input.cursorToken !== null) {
    cursorToken = opaqueId(input.cursorToken, 'cursorToken');
    nextUrl = contract.assertHttpsPublicUrl(input.nextUrl, 'checkpoint.nextUrl');
  } else if (input.nextUrl !== '') {
    throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', '终点 checkpoint 不得保留 nextUrl');
  }
  const validator = input.validatorHash === '' ? '' : exactString(input.validatorHash, 'validatorHash');
  if (validator && !/^validator-sha256-[a-f0-9]{64}$/.test(validator)) {
    throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'validatorHash 非法');
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'revision 必须是正整数');
  }
  return Object.freeze({
    schema: CHECKPOINT_SCHEMA,
    checkpointId: expectedId,
    workspaceIdentity: context.workspaceIdentity,
    providerId: provider,
    adapterVersion,
    policyVersion,
    queryHash: queryDigest,
    cursorToken,
    nextUrl,
    validatorHash: validator,
    observedAt: iso(input.observedAt, 'observedAt'),
    revision: input.revision,
  });
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

class LibrarySourceCheckpointStore {
  constructor(options) {
    const input = options || {};
    if (!isPlainRecord(input)) throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'Store options 必须是普通对象');
    const unknown = Object.keys(input).filter(key => ![
      'workspacePath', 'acquisitionStore', 'fsImpl', 'now', 'randomId',
    ].includes(key));
    if (unknown.length) throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'Store options 含未知字段');
    if (input.acquisitionStore !== undefined && !(input.acquisitionStore instanceof LibraryAcquisitionStore)) {
      throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'acquisitionStore 非法');
    }
    this.owner = input.acquisitionStore || new LibraryAcquisitionStore({
      workspacePath: input.workspacePath,
      fsImpl: input.fsImpl,
      now: input.now,
      randomId: input.randomId,
      recoverOnOpen: false,
    });
    this.fs = input.fsImpl || this.owner.fs || fs;
    this.clock = typeof input.now === 'function' ? input.now : () => new Date();
    this.randomId = typeof input.randomId === 'function' ? input.randomId
      : (this.owner.randomId || (() => crypto.randomUUID()));
    this.workspacePath = this.owner.workspacePath;
    this.workspaceIdentity = this.owner.workspaceIdentity;
    this.sourcesRoot = path.join(this.owner.paths.resourcesRoot, 'sources');
    this.records = new Map();
    this.corruptions = new Map();
    this.closed = false;
    this.owner._assertPhysicalBoundary(this.owner.paths.resourcesRoot, this.sourcesRoot);
    if (!this.fs.existsSync(this.sourcesRoot)) {
      try { this.fs.mkdirSync(this.sourcesRoot, { recursive: false }); }
      catch (error) { if (error && error.code !== 'EEXIST') throw error; }
    }
    this.owner._assertPhysicalBoundary(this.owner.paths.resourcesRoot, this.sourcesRoot);
    const stat = this.fs.lstatSync(this.sourcesRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw codedError('LIBRARY_SOURCE_CHECKPOINT_UNSAFE_LAYOUT', 'sources checkpoint root 非物理目录');
    }
    this.rootIdentity = Object.freeze({
      realpath: this._realpath(this.sourcesRoot),
      dev: String(stat.dev),
      ino: String(stat.ino),
      birthtimeMs: Number.isFinite(Number(stat.birthtimeMs)) ? Number(stat.birthtimeMs) : null,
    });
    this._scan();
  }

  _now() {
    const value = this.clock();
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(timestamp)) throw codedError('LIBRARY_SOURCE_CHECKPOINT_CLOCK_INVALID', 'checkpoint clock 非法');
    return new Date(timestamp).toISOString();
  }

  _realpath(target) {
    const native = this.fs.realpathSync && this.fs.realpathSync.native;
    return path.resolve(typeof native === 'function' ? native(target) : this.fs.realpathSync(target));
  }

  _assertOpen() {
    if (this.closed) throw codedError('LIBRARY_SOURCE_CHECKPOINT_CLOSED', 'checkpoint Store 已关闭');
  }

  _assertRootStable() {
    this.owner._assertPhysicalBoundary(this.owner.paths.resourcesRoot, this.sourcesRoot);
    const stat = this.fs.lstatSync(this.sourcesRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || this._realpath(this.sourcesRoot) !== this.rootIdentity.realpath
      || String(stat.dev) !== this.rootIdentity.dev
      || String(stat.ino) !== this.rootIdentity.ino
      || (Number.isFinite(Number(stat.birthtimeMs)) ? Number(stat.birthtimeMs) : null) !== this.rootIdentity.birthtimeMs) {
      throw codedError('LIBRARY_SOURCE_CHECKPOINT_LAYOUT_CHANGED', 'sources checkpoint root 已被替换');
    }
  }

  _recordPath(id) {
    if (typeof id !== 'string' || !/^source-checkpoint-sha256-[a-f0-9]{64}$/.test(id)) {
      throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'checkpointId 非法');
    }
    return path.join(this.sourcesRoot, id + '.json');
  }

  _markCorrupt(name, error) {
    this.corruptions.set(name, Object.freeze({
      schema: CORRUPTION_SCHEMA,
      name,
      code: error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_.-]*$/.test(error.code)
        ? error.code : 'LIBRARY_SOURCE_CHECKPOINT_CORRUPT',
    }));
  }

  _scan() {
    this._assertOpen();
    this._assertRootStable();
    const next = new Map();
    const corruptions = new Map();
    const previousCorruptions = this.corruptions;
    this.corruptions = corruptions;
    for (const entry of this.fs.readdirSync(this.sourcesRoot, { withFileTypes: true })) {
      if (entry.name.endsWith('.tmp') || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -5);
      const target = path.join(this.sourcesRoot, entry.name);
      try {
        if (!entry.isFile() || entry.isSymbolicLink()) throw codedError('LIBRARY_SOURCE_CHECKPOINT_CORRUPT', 'checkpoint entry 非普通文件');
        this.owner._assertPhysicalBoundary(this.sourcesRoot, target, { mustBeRegularFile: true });
        const parsed = JSON.parse(this.fs.readFileSync(target, 'utf8'));
        const record = normalizeRecord(parsed, { workspaceIdentity: this.workspaceIdentity });
        if (record.checkpointId !== id) throw codedError('LIBRARY_SOURCE_CHECKPOINT_CORRUPT', 'checkpoint 文件名与事实不一致');
        next.set(id, record);
      } catch (error) {
        this._markCorrupt(id, error);
      }
    }
    this.records = next;
    if (!this.corruptions.size && previousCorruptions.size) previousCorruptions.clear();
    return this.list();
  }

  _assertLedgerHealthy() {
    if (this.corruptions.size) {
      throw codedError('LIBRARY_SOURCE_CHECKPOINT_REPAIR_REQUIRED', 'checkpoint 账存在损坏，必须先修复');
    }
  }

  _writeTemp(id, record) {
    this._assertRootStable();
    const temporary = path.join(this.sourcesRoot, '.' + id + '.' + String(this.randomId()) + '.tmp');
    let fd;
    let primary = null;
    try {
      fd = this.fs.openSync(temporary, 'wx', 0o600);
      this.fs.writeFileSync(fd, JSON.stringify(record, null, 2) + '\n', 'utf8');
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
          if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error && error.code)) {
            throw codedError('LIBRARY_SOURCE_CHECKPOINT_ATOMIC_UNSUPPORTED', 'checkpoint filesystem 不支持原子 create', { cause: error });
          }
          throw error;
        }
      } else {
        this.fs.renameSync(temporary, target);
      }
      this.owner._fsyncDirectory(this.sourcesRoot);
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

  save(input) {
    this._assertOpen();
    if (!isPlainRecord(input)) throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'save input 必须是普通对象');
    const unknown = Object.keys(input).filter(key => ![
      'providerId', 'adapterVersion', 'policyVersion', 'query', 'cursorToken',
      'nextUrl', 'validator', 'expectedRevision', 'observedAt',
    ].includes(key));
    if (unknown.length) throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'save input 含未知字段');
    contract.assertNoSecrets(input, 'source checkpoint save');
    const provider = opaqueId(input.providerId, 'providerId');
    const queryDigest = queryHash(input.query);
    const id = checkpointId(provider, queryDigest);
    const scope = 'library-source-checkpoint:' + id;
    return this.owner._withMutationLock(scope, () => {
      this._scan();
      this._assertLedgerHealthy();
      const current = this.records.get(id) || null;
      const expected = input.expectedRevision;
      if (current) {
        if (!Number.isSafeInteger(expected) || expected !== current.revision) {
          throw codedError('LIBRARY_SOURCE_CHECKPOINT_CONFLICT', 'checkpoint revision 冲突');
        }
      } else if (expected !== undefined && expected !== null && expected !== 0) {
        throw codedError('LIBRARY_SOURCE_CHECKPOINT_CONFLICT', 'checkpoint create revision 冲突');
      }
      const cursor = input.cursorToken === null ? null : opaqueId(input.cursorToken, 'cursorToken');
      const nextUrl = cursor === null ? '' : contract.assertHttpsPublicUrl(input.nextUrl, 'checkpoint.nextUrl');
      const record = normalizeRecord({
        schema: CHECKPOINT_SCHEMA,
        checkpointId: id,
        workspaceIdentity: this.workspaceIdentity,
        providerId: provider,
        adapterVersion: opaqueId(input.adapterVersion, 'adapterVersion'),
        policyVersion: opaqueId(input.policyVersion, 'policyVersion'),
        queryHash: queryDigest,
        cursorToken: cursor,
        nextUrl,
        validatorHash: validatorHash(input.validator),
        observedAt: input.observedAt === undefined ? this._now() : input.observedAt,
        revision: current ? current.revision + 1 : 1,
      }, { workspaceIdentity: this.workspaceIdentity });
      this._publish(id, record, !current);
      this.records.set(id, record);
      return clone(record);
    });
  }

  load(input) {
    this._assertOpen();
    if (!isPlainRecord(input)) throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'load input 必须是普通对象');
    const unknown = Object.keys(input).filter(key => !['providerId', 'adapterVersion', 'policyVersion', 'query'].includes(key));
    if (unknown.length) throw codedError('LIBRARY_SOURCE_CHECKPOINT_INVALID', 'load input 含未知字段');
    this._scan();
    this._assertLedgerHealthy();
    const provider = opaqueId(input.providerId, 'providerId');
    const id = checkpointId(provider, queryHash(input.query));
    const record = this.records.get(id) || null;
    if (!record) return Object.freeze({ status: 'missing', record: null });
    const currentAdapter = opaqueId(input.adapterVersion, 'adapterVersion');
    const currentPolicy = opaqueId(input.policyVersion, 'policyVersion');
    if (record.adapterVersion !== currentAdapter || record.policyVersion !== currentPolicy) {
      return Object.freeze({ status: 'stale', record: clone(record) });
    }
    return Object.freeze({ status: 'ready', record: clone(record) });
  }

  list() {
    return Object.freeze([...this.records.values()]
      .map(clone)
      .sort((left, right) => left.checkpointId.localeCompare(right.checkpointId, 'en')));
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
  CHECKPOINT_SCHEMA,
  CORRUPTION_SCHEMA,
  LibrarySourceCheckpointStore,
  queryHash,
  checkpointId,
  validatorHash,
  normalizeRecord,
};
