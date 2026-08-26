// W94A Workspace-bound durable store for proposals, leases, receipts and artifact descriptors.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const contract = require('./capability-execution-contract');

const SINGLE_INSTANCE_OWNER_CAPABILITIES = new WeakSet();

function createCapabilityExecutionOwnerCapability() {
  const capability = Object.freeze(Object.create(null));
  SINGLE_INSTANCE_OWNER_CAPABILITIES.add(capability);
  return capability;
}

function attachCleanupError(primary, cleanup) {
  if (!cleanup || cleanup.code === 'ENOENT') return;
  if (!primary.cleanupError) primary.cleanupError = cleanup;
  if (!Array.isArray(primary.cleanupErrors)) primary.cleanupErrors = [];
  primary.cleanupErrors.push(cleanup);
}

function clone(value) {
  return contract.clonePortable(value, 'durable capability fact');
}

function canonicalWorkspaceIdentity(workspacePath) {
  return `workspace-sha256-${contract.sha256Hex(Buffer.from(workspacePath, 'utf8'))}`;
}

function physicalRealpath(fsImpl, target) {
  const nativeRealpath = fsImpl.realpathSync?.native;
  if (typeof nativeRealpath === 'function') return path.resolve(nativeRealpath(target));
  if (typeof fsImpl.realpathSync === 'function') return path.resolve(fsImpl.realpathSync(target));
  throw contract.codedError('CAPABILITY_REALPATH_REQUIRED', 'Capability Store 需要 realpath 支持');
}

function ensurePhysicalDirectoryPath(fsImpl, target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  let cursor = parsed.root;
  const verify = directory => {
    const stat = fsImpl.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw contract.codedError('CAPABILITY_UNSAFE_WORKSPACE', 'Capability Workspace 路径含链接或非目录组件');
    }
  };
  verify(cursor);
  for (const segment of resolved.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      verify(cursor);
      continue;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try { fsImpl.mkdirSync(cursor, { recursive: false }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
    verify(cursor);
  }
  return resolved;
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right;
}

class CapabilityExecutionStore {
  constructor(input = {}) {
    const options = typeof input === 'string' ? { workspacePath: input } : input;
    if (!contract.isPlainRecord(options)) throw contract.codedError('CAPABILITY_STORE_INVALID', 'Capability Store options 必须是普通对象');
    const supplied = options.workspacePath ?? options.workspace;
    if (typeof supplied !== 'string' || !supplied || supplied !== supplied.trim()) {
      throw contract.codedError('CAPABILITY_STORE_INVALID', 'Capability Store 需要精确 Workspace 路径');
    }
    this.fs = options.fsImpl || fs;
    this.clock = typeof options.now === 'function' ? options.now : (() => new Date());
    this.randomId = typeof options.randomId === 'function' ? options.randomId : (() => crypto.randomUUID());
    ensurePhysicalDirectoryPath(this.fs, path.resolve(supplied));
    const workspacePath = physicalRealpath(this.fs, path.resolve(supplied));
    const workspaceIdentity = canonicalWorkspaceIdentity(workspacePath);
    if (options.workspaceIdentity !== undefined && options.workspaceIdentity !== workspaceIdentity) {
      throw contract.codedError('CAPABILITY_STORE_WORKSPACE_MISMATCH', '显式 Workspace identity 与物理路径不一致');
    }
    Object.defineProperties(this, {
      workspacePath: { value: workspacePath, enumerable: true },
      workspaceIdentity: { value: workspaceIdentity, enumerable: true },
    });
    this.paths = Object.freeze({
      workspaceRoot: workspacePath,
      mazzRoot: path.join(workspacePath, '.mazz'),
      runtimeRoot: path.join(workspacePath, '.mazz', 'capability-runtime'),
      locksRoot: path.join(workspacePath, '.mazz', 'capability-runtime', 'locks'),
      quarantineRoot: path.join(workspacePath, '.mazz', 'capability-runtime', 'quarantine'),
      statePath: path.join(workspacePath, '.mazz', 'capability-runtime', 'state.json'),
      mutationLock: path.join(workspacePath, '.mazz', 'capability-runtime', 'locks', 'mutation.lock'),
    });
    this._ensureLayout();
    this.layoutIdentity = this._captureLayoutIdentity();
    this.corruption = null;
    this._openOrCreate();
  }

  _now() {
    const value = this.clock();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw contract.codedError('CAPABILITY_STORE_CLOCK_INVALID', 'Capability Store clock 非法');
    return date.toISOString();
  }

  _layoutDirectories() {
    return [this.paths.workspaceRoot, this.paths.mazzRoot, this.paths.runtimeRoot, this.paths.locksRoot, this.paths.quarantineRoot];
  }

  _ensureLayout() {
    for (const directory of this._layoutDirectories()) {
      ensurePhysicalDirectoryPath(this.fs, directory);
      const real = physicalRealpath(this.fs, directory);
      if (!samePath(real, path.resolve(directory))) {
        // Windows short/long aliases are normalized because workspaceRoot is
        // already canonical. A different physical target is never accepted.
        const parent = directory === this.paths.workspaceRoot ? real : path.resolve(directory);
        if (!samePath(real, parent)) throw contract.codedError('CAPABILITY_UNSAFE_LAYOUT', 'Capability Store layout 指向外部路径');
      }
    }
  }

  _captureLayoutIdentity() {
    const entries = {};
    for (const directory of this._layoutDirectories()) {
      const stat = this.fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw contract.codedError('CAPABILITY_UNSAFE_LAYOUT', 'Capability Store layout 非物理目录');
      entries[directory] = Object.freeze({
        realpath: physicalRealpath(this.fs, directory),
        dev: String(stat.dev),
        ino: String(stat.ino),
        birthtimeMs: Number.isFinite(Number(stat.birthtimeMs)) ? Number(stat.birthtimeMs) : null,
      });
    }
    return Object.freeze(entries);
  }

  _assertLayoutStable() {
    for (const [directory, expected] of Object.entries(this.layoutIdentity || {})) {
      const stat = this.fs.lstatSync(directory);
      const current = {
        realpath: physicalRealpath(this.fs, directory), dev: String(stat.dev), ino: String(stat.ino),
        birthtimeMs: Number.isFinite(Number(stat.birthtimeMs)) ? Number(stat.birthtimeMs) : null,
      };
      if (!stat.isDirectory() || stat.isSymbolicLink() || current.realpath !== expected.realpath
          || current.dev !== expected.dev || current.ino !== expected.ino
          || current.birthtimeMs !== expected.birthtimeMs) {
        throw contract.codedError('CAPABILITY_LAYOUT_CHANGED', 'Capability Store layout 在运行期间被替换');
      }
    }
  }

  _assertStateLeaf() {
    let stat;
    try { stat = this.fs.lstatSync(this.paths.statePath); }
    catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw contract.codedError('CAPABILITY_STORE_CORRUPT', 'Capability state 不是普通文件');
    const real = physicalRealpath(this.fs, this.paths.statePath);
    const relative = path.relative(this.paths.runtimeRoot, real);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw contract.codedError('CAPABILITY_STORE_CORRUPT', 'Capability state 越出 runtime root');
    return true;
  }

  _initialState() {
    const now = this._now();
    return contract.normalizeStoreState({
      schema: contract.CAPABILITY_STORE_SCHEMA,
      workspaceIdentity: this.workspaceIdentity,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      proposals: [], leases: [], receipts: [], artifacts: [],
    }, { workspaceIdentity: this.workspaceIdentity, durable: true });
  }

  _openOrCreate() {
    this._assertLayoutStable();
    if (!this._assertStateLeaf()) {
      try { this._publishCreate(this._initialState()); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
    }
    this._readState();
  }

  _readState({ tolerateCorruption = false } = {}) {
    this._assertLayoutStable();
    try {
      if (!this._assertStateLeaf()) throw contract.codedError('CAPABILITY_STORE_CORRUPT', 'Capability state 缺失');
      const bytes = this.fs.readFileSync(this.paths.statePath);
      const parsed = JSON.parse(bytes.toString('utf8'));
      const state = contract.normalizeStoreState(parsed, { workspaceIdentity: this.workspaceIdentity, durable: true });
      this.corruption = null;
      return state;
    } catch (error) {
      this.corruption = Object.freeze({
        schema: 'mazz.capability-store-corruption/v1',
        workspaceIdentity: this.workspaceIdentity,
        code: String(error?.code || 'CAPABILITY_STORE_CORRUPT'),
        message: String(error?.message || error),
        observedAt: this._now(),
      });
      if (tolerateCorruption) return null;
      throw contract.codedError('CAPABILITY_STORE_CORRUPT', 'Capability Store 损坏，原件已保留并阻断写入', { cause: error, corruption: this.corruption });
    }
  }

  _fsyncDirectory(directory) {
    let fd;
    let primary = null;
    try {
      fd = this.fs.openSync(directory, 'r');
      this.fs.fsyncSync(fd);
    } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)
          && !(process.platform === 'win32' && error?.code === 'EPERM')) primary = error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); }
        catch (cleanup) { if (primary) attachCleanupError(primary, cleanup); else primary = cleanup; }
      }
    }
    if (primary) throw primary;
  }

  _writeTemp(leaf, value) {
    this._assertLayoutStable();
    const temporary = path.join(this.paths.runtimeRoot, `.${leaf}.${this.randomId()}.tmp`);
    let fd;
    let primary = null;
    try {
      fd = this.fs.openSync(temporary, 'wx', 0o600);
      this.fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      this.fs.fsyncSync(fd);
      this.fs.closeSync(fd);
      fd = undefined;
      return temporary;
    } catch (error) {
      primary = error;
      throw error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch (cleanup) { if (primary) attachCleanupError(primary, cleanup); else throw cleanup; }
      }
      if (primary) {
        try { this.fs.unlinkSync(temporary); } catch (cleanup) { attachCleanupError(primary, cleanup); }
      }
    }
  }

  _publishCreate(value) {
    const temporary = this._writeTemp('state.json', value);
    let primary = null;
    try {
      try { this.fs.linkSync(temporary, this.paths.statePath); }
      catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error?.code)) {
          throw contract.codedError('CAPABILITY_ATOMIC_CREATE_UNSUPPORTED', 'Workspace 文件系统不支持原子 capability state 创建', { cause: error });
        }
        throw error;
      }
      this._fsyncDirectory(this.paths.runtimeRoot);
    } catch (error) { primary = error; throw error; }
    finally {
      try { this.fs.unlinkSync(temporary); }
      catch (cleanup) {
        if (cleanup?.code !== 'ENOENT') { if (primary) attachCleanupError(primary, cleanup); else throw cleanup; }
      }
    }
  }

  _publishReplace(value) {
    const temporary = this._writeTemp('state.json', value);
    try {
      this.fs.renameSync(temporary, this.paths.statePath);
      this._fsyncDirectory(this.paths.runtimeRoot);
    } catch (error) {
      try { this.fs.unlinkSync(temporary); } catch (cleanup) { attachCleanupError(error, cleanup); }
      throw error;
    }
  }

  _pidAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { return error?.code !== 'ESRCH'; }
  }

  _withMutationLock(action) {
    this._assertLayoutStable();
    const token = String(this.randomId());
    const owner = { pid: process.pid, token, acquiredAt: this._now() };
    const temporary = path.join(this.paths.locksRoot, `.mutation.lock.${token}.tmp`);
    let fd;
    try {
      fd = this.fs.openSync(temporary, 'wx', 0o600);
      this.fs.writeFileSync(fd, `${JSON.stringify(owner)}\n`, 'utf8');
      this.fs.fsyncSync(fd);
      this.fs.closeSync(fd);
      fd = undefined;
      this.fs.linkSync(temporary, this.paths.mutationLock);
      this._fsyncDirectory(this.paths.locksRoot);
    } catch (error) {
      if (fd !== undefined) { try { this.fs.closeSync(fd); } catch (cleanup) { attachCleanupError(error, cleanup); } }
      try { this.fs.unlinkSync(temporary); } catch (cleanup) { if (cleanup?.code !== 'ENOENT') attachCleanupError(error, cleanup); }
      if (error?.code === 'EEXIST') {
        let current = null;
        try { current = JSON.parse(this.fs.readFileSync(this.paths.mutationLock, 'utf8')); } catch {}
        if (current && typeof current.token === 'string' && current.token && this._pidAlive(Number(current.pid))) {
          throw contract.codedError('CAPABILITY_STORE_BUSY', '另一个 capability coordinator 正在提交事实');
        }
        throw contract.codedError('CAPABILITY_LOCK_REPAIR_REQUIRED', 'Capability orphan lock 需要单实例 owner 显式修复');
      }
      if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error?.code)) {
        throw contract.codedError('CAPABILITY_ATOMIC_LOCK_UNSUPPORTED', 'Workspace 文件系统不支持原子 capability lock', { cause: error });
      }
      throw error;
    } finally {
      try { this.fs.unlinkSync(temporary); }
      catch (cleanup) {
        if (cleanup?.code !== 'ENOENT') {
          // The lock has already been published, so a failed temporary-file
          // cleanup must not be hidden or leave a live lock behind. Release
          // only the exact token we just acquired, then surface the cleanup
          // failure (with any release failure attached).
          try {
            const current = JSON.parse(this.fs.readFileSync(this.paths.mutationLock, 'utf8'));
            if (current.token !== token || Number(current.pid) !== process.pid) {
              throw contract.codedError('CAPABILITY_LOCK_OWNERSHIP_LOST', 'Capability lock owner 在清理期间改变');
            }
            this.fs.unlinkSync(this.paths.mutationLock);
            this._fsyncDirectory(this.paths.locksRoot);
          } catch (releaseError) {
            attachCleanupError(cleanup, releaseError);
          }
          throw cleanup;
        }
      }
    }

    let result;
    let primary = null;
    try { result = action(); }
    catch (error) { primary = error; }
    finally {
      try {
        this._assertLayoutStable();
        const current = JSON.parse(this.fs.readFileSync(this.paths.mutationLock, 'utf8'));
        if (current.token !== token || Number(current.pid) !== process.pid) {
          throw contract.codedError('CAPABILITY_LOCK_OWNERSHIP_LOST', 'Capability lock owner 在提交期间改变');
        }
        this.fs.unlinkSync(this.paths.mutationLock);
        this._fsyncDirectory(this.paths.locksRoot);
      } catch (cleanup) {
        if (cleanup?.code !== 'ENOENT') { if (primary) attachCleanupError(primary, cleanup); else primary = cleanup; }
      }
    }
    if (primary) throw primary;
    return result;
  }

  repairOrphanLock(ownerCapability) {
    if (!ownerCapability || !SINGLE_INSTANCE_OWNER_CAPABILITIES.has(ownerCapability)) {
      throw contract.codedError('CAPABILITY_SINGLE_INSTANCE_OWNER_REQUIRED', 'Capability lock 修复需要 Electron 单实例权限');
    }
    this._assertLayoutStable();
    let before;
    let bytes;
    let owner = null;
    try {
      before = this.fs.lstatSync(this.paths.mutationLock);
      if (!before.isFile() || before.isSymbolicLink()) throw contract.codedError('CAPABILITY_LOCK_REPAIR_BLOCKED', 'Capability lock 不是安全普通文件');
      bytes = this.fs.readFileSync(this.paths.mutationLock);
      try { owner = JSON.parse(bytes.toString('utf8')); } catch {}
    } catch (error) {
      if (error?.code === 'ENOENT') return Object.freeze({ removed: false, reason: 'NO_LOCK' });
      throw error;
    }
    if (owner && typeof owner.token === 'string' && owner.token && this._pidAlive(Number(owner.pid))) {
      return Object.freeze({ removed: false, reason: 'LIVE_OWNER' });
    }
    const after = this.fs.lstatSync(this.paths.mutationLock);
    const currentBytes = this.fs.readFileSync(this.paths.mutationLock);
    if (String(before.dev) !== String(after.dev) || String(before.ino) !== String(after.ino) || !bytes.equals(currentBytes)) {
      throw contract.codedError('CAPABILITY_LOCK_OWNERSHIP_LOST', 'Capability orphan lock 在修复期间被替换');
    }
    this.fs.unlinkSync(this.paths.mutationLock);
    this._fsyncDirectory(this.paths.locksRoot);
    return Object.freeze({ removed: true, reason: 'ORPHAN_REMOVED' });
  }

  snapshot() {
    return clone(this._readState());
  }

  inspect() {
    const state = this._readState({ tolerateCorruption: true });
    return Object.freeze({
      workspacePath: this.workspacePath,
      workspaceIdentity: this.workspaceIdentity,
      ok: !!state,
      revision: state?.revision || null,
      corruption: this.corruption ? clone(this.corruption) : null,
    });
  }

  mutate({ expectedRevision = null, apply } = {}) {
    return this.transact({ expectedRevision, apply }).state;
  }

  transact({ expectedRevision = null, apply } = {}) {
    if (typeof apply !== 'function') throw contract.codedError('CAPABILITY_STORE_INVALID', 'Capability mutation 缺 apply');
    return this._withMutationLock(() => {
      const current = this._readState();
      if (expectedRevision !== null && expectedRevision !== current.revision) {
        throw contract.codedError('CAPABILITY_STORE_CONFLICT', `Capability Store revision 冲突: ${expectedRevision} != ${current.revision}`);
      }
      const draft = clone(current);
      const returned = apply(draft, clone(current));
      const envelope = contract.isPlainRecord(returned) && Object.prototype.hasOwnProperty.call(returned, 'state')
        ? returned
        : { state: returned === undefined ? draft : returned, result: null, changed: true };
      if (envelope.changed === false) {
        return Object.freeze({ state: clone(current), result: clone(envelope.result), changed: false });
      }
      const candidate = envelope.state;
      const next = contract.normalizeStoreState({
        ...candidate,
        schema: contract.CAPABILITY_STORE_SCHEMA,
        workspaceIdentity: this.workspaceIdentity,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        updatedAt: this._now(),
      }, { workspaceIdentity: this.workspaceIdentity, durable: true });
      this._publishReplace(next);
      return Object.freeze({ state: clone(next), result: clone(envelope.result), changed: true });
    });
  }
}

module.exports = {
  CapabilityExecutionStore,
  createCapabilityExecutionOwnerCapability,
  canonicalWorkspaceIdentity,
};
