// Workspace-bound durable facts for library acquisition jobs and Inbox receipts.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const contract = require('./library-resource-contract');

const JOB_KIND = 'job';
const INBOX_KIND = 'inbox';
const CORRUPTION_SCHEMA = 'mazz.library-acquisition-corruption/v1';
const SINGLE_INSTANCE_OWNER_CAPABILITIES = new WeakSet();

function createSingleInstanceOwnerCapability() {
  const capability = Object.freeze(Object.create(null));
  SINGLE_INSTANCE_OWNER_CAPABILITIES.add(capability);
  return capability;
}

function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw codedError('LIBRARY_ACQUISITION_INVALID_TIME', 'acquisition store clock returned an invalid time');
  }
  return date.toISOString();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function attachCleanupError(primary, cleanup) {
  if (!cleanup || cleanup.code === 'ENOENT') return;
  if (!primary.cleanupError) primary.cleanupError = cleanup;
  if (!Array.isArray(primary.cleanupErrors)) primary.cleanupErrors = [];
  primary.cleanupErrors.push(cleanup);
}

function safeRecordId(value, label) {
  if (typeof value !== 'string') {
    throw codedError('LIBRARY_ACQUISITION_INVALID_RECORD_ID', `${label} must be a system-generated safe id`);
  }
  const id = value;
  if (!id || id === '.' || id === '..' || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(id)) {
    throw codedError('LIBRARY_ACQUISITION_INVALID_RECORD_ID', `${label} must be a system-generated safe id`);
  }
  const stem = id.split('.')[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) {
    throw codedError('LIBRARY_ACQUISITION_INVALID_RECORD_ID', `${label} must not use a reserved device name`);
  }
  return id;
}

function normalizeWorkspaceOptions(input) {
  const options = typeof input === 'string' ? { workspacePath: input } : { ...(input || {}) };
  const supplied = options.workspacePath ?? options.workspace;
  if (!supplied || typeof supplied !== 'string') {
    throw codedError('LIBRARY_ACQUISITION_INVALID_WORKSPACE', 'acquisition store requires a workspace path');
  }
  return { options, requestedWorkspacePath: path.resolve(supplied) };
}

function physicalRealpath(fsImpl, target) {
  const nativeRealpath = fsImpl.realpathSync?.native;
  if (typeof nativeRealpath === 'function') return path.resolve(nativeRealpath(target));
  if (typeof fsImpl.realpathSync === 'function') return path.resolve(fsImpl.realpathSync(target));
  throw codedError('LIBRARY_ACQUISITION_REALPATH_REQUIRED', 'acquisition store requires realpath support');
}

function assertNoLinkedPathComponents(fsImpl, target) {
  const parsed = path.parse(target);
  let cursor = parsed.root;
  for (const segment of target.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (fsImpl.lstatSync(cursor).isSymbolicLink()) {
      throw codedError(
        'LIBRARY_ACQUISITION_UNSAFE_WORKSPACE_ALIAS',
        'acquisition Workspace cannot traverse a linked path component',
      );
    }
  }
}

function ensurePhysicalDirectoryPath(fsImpl, target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  let cursor = parsed.root;
  const verify = directory => {
    const stat = fsImpl.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw codedError(
        'LIBRARY_ACQUISITION_UNSAFE_WORKSPACE_ALIAS',
        'acquisition Workspace cannot traverse a linked or non-directory path component',
      );
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
    try {
      fsImpl.mkdirSync(cursor, { recursive: false });
    } catch (error) {
      // Another owner may have created the component after our ENOENT. Its
      // type is verified below before any deeper path is created.
      if (error?.code !== 'EEXIST') throw error;
    }
    verify(cursor);
  }
  return resolved;
}

function receiptImmutableView(receipt) {
  const value = clone(receipt);
  delete value.state;
  delete value.revision;
  delete value.acknowledgedAt;
  return value;
}

class LibraryAcquisitionStore {
  constructor(input = {}) {
    const { options, requestedWorkspacePath } = normalizeWorkspaceOptions(input);
    this.fs = options.fsImpl || fs;
    this.randomId = options.randomId || (() => crypto.randomUUID());
    this.clock = typeof options.now === 'function' ? options.now : (() => new Date());
    ensurePhysicalDirectoryPath(this.fs, requestedWorkspacePath);
    assertNoLinkedPathComponents(this.fs, requestedWorkspacePath);
    const workspacePath = physicalRealpath(this.fs, requestedWorkspacePath);
    const workspaceIdentity = contract.deriveWorkspaceIdentity(workspacePath);
    if (options.workspaceIdentity !== undefined
      && (typeof options.workspaceIdentity !== 'string'
        || options.workspaceIdentity !== workspaceIdentity)) {
      throw codedError(
        'LIBRARY_ACQUISITION_INVALID_WORKSPACE',
        'acquisition workspace identity must be the canonical derived string',
      );
    }

    Object.defineProperties(this, {
      workspacePath: { value: workspacePath, enumerable: true, writable: false, configurable: false },
      workspaceIdentity: { value: workspaceIdentity, enumerable: true, writable: false, configurable: false },
    });

    const libraryRoot = path.join(workspacePath, '书库');
    const resourcesRoot = path.join(libraryRoot, '.resources');
    this.paths = Object.freeze({
      workspaceRoot: workspacePath,
      libraryRoot,
      resourcesRoot,
      jobsRoot: path.join(resourcesRoot, 'jobs'),
      inboxRoot: path.join(resourcesRoot, 'inbox'),
      stagingRoot: path.join(resourcesRoot, 'staging'),
      quarantineRoot: path.join(resourcesRoot, 'quarantine'),
      locksRoot: path.join(resourcesRoot, 'locks'),
    });
    this.context = Object.freeze({
      workspacePath,
      workspaceIdentity,
      resourcesRoot,
      stagingRoot: this.paths.stagingRoot,
      libraryRoot,
    });
    this.corruptions = new Map();
    this.jobs = new Map();
    this.inbox = new Map();
    this.jobByIdempotencyKey = new Map();

    this._ensureLayout();
    Object.defineProperty(this, 'layoutIdentity', {
      value: this._captureLayoutIdentity(), enumerable: false, writable: false, configurable: false,
    });
    this._scan(JOB_KIND);
    this._scan(INBOX_KIND);
    // Opening a second view over the same Workspace is not proof that the
    // application restarted.  Recovery is an explicit coordinator action;
    // otherwise a reader could pause work still owned by another process.
    if (options.recoverOnOpen === true) this.recoverAfterRestart();
  }

  _now() {
    return iso(this.clock());
  }

  _rootFor(kind) {
    return kind === JOB_KIND ? this.paths.jobsRoot : this.paths.inboxRoot;
  }

  _layoutDirectories() {
    return [
      this.paths.workspaceRoot,
      this.paths.libraryRoot,
      this.paths.resourcesRoot,
      this.paths.jobsRoot,
      this.paths.inboxRoot,
      this.paths.stagingRoot,
      this.paths.quarantineRoot,
      this.paths.locksRoot,
    ];
  }

  _captureLayoutIdentity() {
    const entries = {};
    for (const directory of this._layoutDirectories()) {
      const stat = this.fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw codedError('LIBRARY_ACQUISITION_UNSAFE_LAYOUT', 'acquisition layout identity is unsafe');
      }
      entries[directory] = Object.freeze({
        realpath: this._realpath(directory),
        dev: String(stat.dev),
        ino: String(stat.ino),
        birthtimeMs: Number.isFinite(Number(stat.birthtimeMs)) ? Number(stat.birthtimeMs) : null,
      });
    }
    return Object.freeze(entries);
  }

  _assertLayoutStable() {
    if (!this.layoutIdentity) return true;
    for (const [directory, expected] of Object.entries(this.layoutIdentity)) {
      let stat;
      let actual;
      try {
        stat = this.fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('linked or non-directory layout root');
        actual = this._realpath(directory);
      } catch (error) {
        throw codedError(
          'LIBRARY_ACQUISITION_LAYOUT_CHANGED',
          'acquisition layout changed after the Workspace was bound',
          { cause: error },
        );
      }
      if (actual !== expected.realpath
        || String(stat.dev) !== expected.dev
        || String(stat.ino) !== expected.ino
        || (Number.isFinite(Number(stat.birthtimeMs)) ? Number(stat.birthtimeMs) : null) !== expected.birthtimeMs) {
        throw codedError(
          'LIBRARY_ACQUISITION_LAYOUT_CHANGED',
          'acquisition layout identity changed after the Workspace was bound',
        );
      }
    }
    return true;
  }

  _mapFor(kind) {
    return kind === JOB_KIND ? this.jobs : this.inbox;
  }

  _ensureLayout() {
    this.fs.mkdirSync(this.workspacePath, { recursive: true });
    const workspaceStat = this.fs.lstatSync(this.workspacePath);
    if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
      throw codedError(
        'LIBRARY_ACQUISITION_UNSAFE_WORKSPACE_ALIAS',
        'acquisition Workspace must be a physical directory, not a link',
      );
    }
    assertNoLinkedPathComponents(this.fs, this.workspacePath);
    const workspaceReal = this._realpath(this.workspacePath);
    for (const directory of [
      this.paths.libraryRoot,
      this.paths.resourcesRoot,
      this.paths.jobsRoot,
      this.paths.inboxRoot,
      this.paths.stagingRoot,
      this.paths.quarantineRoot,
      this.paths.locksRoot,
    ]) {
      // Validate the closest existing ancestor before creating the next
      // directory. A pre-existing Library junction must be rejected before
      // mkdir can create `.resources` outside the bound Workspace.
      this._assertPhysicalBoundary(this.workspacePath, directory);
      if (!this.fs.existsSync(directory)) this.fs.mkdirSync(directory, { recursive: false });
      const stat = this.fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw codedError('LIBRARY_ACQUISITION_UNSAFE_LAYOUT', 'acquisition layout cannot use a link or non-directory');
      }
      const actual = this._realpath(directory);
      if (!contract.isPathInside(workspaceReal, actual)) {
        throw codedError('LIBRARY_ACQUISITION_UNSAFE_LAYOUT', 'acquisition layout escapes the bound Workspace');
      }
    }
  }

  _realpath(target) {
    return physicalRealpath(this.fs, target);
  }

  _assertPhysicalBoundary(root, target, { mustBeRegularFile = false } = {}) {
    this._assertLayoutStable();
    const rootPath = path.resolve(root);
    const rootReal = this._realpath(rootPath);
    let cursor = path.resolve(target);
    while (!this.fs.existsSync(cursor)) {
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw codedError('LIBRARY_ACQUISITION_PATH_ESCAPE', 'acquisition path has no contained existing ancestor');
      }
      cursor = parent;
    }
    if (cursor !== rootPath && !contract.isPathInside(rootPath, cursor)) {
      throw codedError('LIBRARY_ACQUISITION_PATH_ESCAPE', 'acquisition path escapes its lexical root');
    }
    let component = rootPath;
    const relative = path.relative(rootPath, cursor);
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      component = path.join(component, segment);
      if (this.fs.lstatSync(component).isSymbolicLink()) {
        throw codedError('LIBRARY_ACQUISITION_PATH_ESCAPE', 'acquisition path cannot traverse a link');
      }
    }
    const stat = this.fs.lstatSync(cursor);
    const actual = this._realpath(cursor);
    if (actual !== rootReal && !contract.isPathInside(rootReal, actual)) {
      throw codedError('LIBRARY_ACQUISITION_PATH_ESCAPE', 'acquisition path escapes its physical root');
    }
    if (mustBeRegularFile) {
      if (cursor !== path.resolve(target) || !stat.isFile()) {
        throw codedError('LIBRARY_ACQUISITION_ARTIFACT_MISSING', 'Inbox artifact must be an existing regular file');
      }
    }
    return true;
  }

  _recordPath(kind, id) {
    const label = kind === JOB_KIND ? 'jobId' : 'receiptId';
    return path.join(this._rootFor(kind), `${safeRecordId(id, label)}.json`);
  }

  _normalize(kind, value, now = this._now(), extraContext = {}) {
    const context = { ...this.context, ...extraContext, now };
    const normalized = kind === JOB_KIND
      ? contract.normalizeJob(value, context)
      : contract.normalizeInboxReceipt(value, context);
    if (kind === JOB_KIND) {
      if (normalized.stagingPath) this._assertPhysicalBoundary(this.paths.stagingRoot, normalized.stagingPath);
      if (normalized.finalPath) this._assertPhysicalBoundary(this.paths.libraryRoot, normalized.finalPath);
    } else {
      this._assertPhysicalBoundary(this.paths.libraryRoot, normalized.artifact.path);
    }
    return normalized;
  }

  _corruptionKey(kind, id) {
    return `${kind}:${id}`;
  }

  _markCorruption(kind, id, error, bytes) {
    const key = this._corruptionKey(kind, id);
    const reason = error instanceof SyntaxError ? 'INVALID_JSON' : 'INVALID_RECORD';
    const digest = crypto.createHash('sha256').update(bytes || '').digest('hex');
    const record = Object.freeze({
      schema: CORRUPTION_SCHEMA,
      recordType: kind,
      recordId: id,
      code: reason,
      digest,
      retained: true,
      blocked: true,
      observedAt: this._now(),
    });
    this.corruptions.set(key, record);
    this._mapFor(kind).delete(id);
    return record;
  }

  _blocked(kind, id) {
    return this.corruptions.get(this._corruptionKey(kind, id)) || null;
  }

  _readOne(kind, id) {
    this._assertLayoutStable();
    const safeId = safeRecordId(id, kind === JOB_KIND ? 'jobId' : 'receiptId');
    const blocked = this._blocked(kind, safeId);
    if (blocked) return { ok: false, corruption: clone(blocked) };
    const file = this._recordPath(kind, safeId);
    let bytes;
    try {
      const stat = this.fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return { ok: false, corruption: clone(this._markCorruption(kind, safeId, new Error('not a regular file'), '')) };
      }
      bytes = this.fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: true, record: null };
      throw error;
    }
    try {
      const record = this._normalize(kind, JSON.parse(bytes), this._now(), { durableRecord: true });
      const actualId = kind === JOB_KIND ? record.jobId : record.receiptId;
      if (actualId !== safeId) throw new Error('record id does not match file name');
      this._mapFor(kind).set(safeId, record);
      return { ok: true, record: clone(record) };
    } catch (error) {
      return { ok: false, corruption: clone(this._markCorruption(kind, safeId, error, bytes)) };
    }
  }

  _scan(kind) {
    this._assertLayoutStable();
    const root = this._rootFor(kind);
    const records = new Map();
    for (const entry of this.fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -5);
      try {
        safeRecordId(id, kind === JOB_KIND ? 'jobId' : 'receiptId');
      } catch (error) {
        const opaqueId = `invalid-${crypto.createHash('sha256').update(entry.name).digest('hex')}`;
        const bytes = entry.isFile() && !entry.isSymbolicLink()
          ? this.fs.readFileSync(path.join(root, entry.name))
          : '';
        this._markCorruption(kind, opaqueId, error, bytes);
        continue;
      }
      if (!entry.isFile() || entry.isSymbolicLink()) {
        this._markCorruption(kind, id, new Error('not a regular file'), '');
        continue;
      }
      const result = this._readOne(kind, id);
      if (result.ok && result.record) records.set(id, result.record);
    }
    const target = this._mapFor(kind);
    target.clear();
    for (const [id, record] of records) target.set(id, record);
    if (kind === JOB_KIND) this._rebuildIdempotencyProjection();
    return [...records.values()].map(clone);
  }

  _rebuildIdempotencyProjection() {
    this.jobByIdempotencyKey.clear();
    for (const job of this.jobs.values()) {
      for (const key of [job.idempotencyKey, ...(job.idempotencyAliases || [])]) {
        const prior = this.jobByIdempotencyKey.get(key);
        if (prior && prior !== job.jobId) {
          throw codedError(
            'LIBRARY_ACQUISITION_DUPLICATE_IDEMPOTENCY_KEY',
            'durable jobs contain a duplicate acquisition idempotency key or alias',
          );
        }
        this.jobByIdempotencyKey.set(key, job.jobId);
      }
    }
  }

  _fsyncDirectory(directory) {
    let fd;
    let primaryError = null;
    try {
      fd = this.fs.openSync(directory, 'r');
      this.fs.fsyncSync(fd);
    } catch (error) {
      // Windows does not expose directory handles usable by fsync.  Ignore
      // only that platform limitation; permission and media errors propagate.
      if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)
        && !(process.platform === 'win32' && error?.code === 'EPERM')) primaryError = error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch (cleanupError) {
          if (primaryError) attachCleanupError(primaryError, cleanupError);
          else primaryError = cleanupError;
        }
      }
    }
    if (primaryError) throw primaryError;
  }

  _lockPath(scope) {
    const digest = crypto.createHash('sha256').update(String(scope), 'utf8').digest('hex');
    return path.join(this.paths.locksRoot, `${digest}.lock`);
  }

  _pidIsAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code !== 'ESRCH';
    }
  }

  _withMutationLock(scope, action) {
    this._assertLayoutStable();
    const lockPath = this._lockPath(scope);
    const publishOwner = () => {
      const token = String(this.randomId());
      const temporary = this._writeTemp(this.paths.locksRoot, path.basename(lockPath), {
        pid: process.pid,
        token,
        acquiredAt: this._now(),
      });
      let primaryError = null;
      try {
        try {
          this.fs.linkSync(temporary, lockPath);
        } catch (error) {
          if (error?.code === 'EEXIST') throw error;
          if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error?.code)) {
            throw codedError(
              'LIBRARY_ACQUISITION_ATOMIC_LOCK_UNSUPPORTED',
              'the Workspace filesystem cannot atomically publish acquisition locks',
              { cause: error },
            );
          }
          throw error;
        }
        this._fsyncDirectory(this.paths.locksRoot);
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        try { this.fs.unlinkSync(temporary); } catch (cleanupError) {
          if (!primaryError && cleanupError?.code !== 'ENOENT') throw cleanupError;
          if (primaryError) attachCleanupError(primaryError, cleanupError);
        }
      }
      return token;
    };
    let ownerToken;
    try {
      ownerToken = publishOwner();
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let owner = null;
      try { owner = JSON.parse(this.fs.readFileSync(lockPath, 'utf8')); } catch {}
      if (owner && typeof owner.token === 'string' && owner.token && this._pidIsAlive(Number(owner.pid))) {
        throw codedError(
          'LIBRARY_ACQUISITION_BUSY',
          'another acquisition coordinator is committing the same durable fact',
        );
      }
      // A Store instance cannot prove global process quiescence, so it must
      // never unlink an orphan automatically.  App-start repair can do that
      // later under the Electron single-instance owner.
      throw codedError(
        'LIBRARY_ACQUISITION_LOCK_REPAIR_REQUIRED',
        'an orphaned acquisition lock requires explicit single-owner repair',
      );
    }
    let result;
    let primaryError = null;
    try {
      result = action();
    } catch (error) {
      primaryError = error;
    } finally {
      try {
        this._assertLayoutStable();
        let currentOwner = null;
        try { currentOwner = JSON.parse(this.fs.readFileSync(lockPath, 'utf8')); } catch {}
        if (!currentOwner || currentOwner.token !== ownerToken) {
          throw codedError(
            'LIBRARY_ACQUISITION_LOCK_OWNERSHIP_LOST',
            'acquisition lock ownership changed before release',
          );
        }
        this.fs.unlinkSync(lockPath);
        this._fsyncDirectory(this.paths.locksRoot);
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') {
          if (primaryError) primaryError.cleanupError = cleanupError;
          else primaryError = cleanupError;
        }
      }
    }
    if (primaryError) throw primaryError;
    return result;
  }

  _withMutationLocks(scopes, action) {
    const ordered = [...new Set(scopes.map(scope => String(scope)))].sort((left, right) => left.localeCompare(right, 'en'));
    const enter = index => (index >= ordered.length
      ? action()
      : this._withMutationLock(ordered[index], () => enter(index + 1)));
    return enter(0);
  }

  /**
   * Remove only demonstrably orphaned mutation locks after the Electron app
   * has acquired its single-instance authority.  Normal Store construction
   * and normal mutations deliberately never call this method.
   *
   * The opaque capability is main-process-only and must not cross IPC.  Each
   * lock is re-read and re-statted immediately before unlink so a concurrently
   * replaced owner is retained rather than guessed away.
   */
  repairOrphanLocks(ownerCapability) {
    if (!ownerCapability || !SINGLE_INSTANCE_OWNER_CAPABILITIES.has(ownerCapability)) {
      throw codedError(
        'LIBRARY_ACQUISITION_SINGLE_INSTANCE_OWNER_REQUIRED',
        'orphan lock repair requires explicit single-instance application authority',
      );
    }
    this._assertLayoutStable();
    const removed = [];
    const retained = [];
    const entries = this.fs.readdirSync(this.paths.locksRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.endsWith('.lock')) continue;
      const lockPath = path.join(this.paths.locksRoot, entry.name);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        retained.push(Object.freeze({ name: entry.name, reason: 'UNSAFE_LOCK_ENTRY' }));
        continue;
      }
      let before;
      let bytes;
      let owner = null;
      try {
        before = this.fs.lstatSync(lockPath);
        if (!before.isFile() || before.isSymbolicLink()) {
          retained.push(Object.freeze({ name: entry.name, reason: 'UNSAFE_LOCK_ENTRY' }));
          continue;
        }
        bytes = this.fs.readFileSync(lockPath);
        try { owner = JSON.parse(bytes.toString('utf8')); } catch {}
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      if (owner && typeof owner.token === 'string' && owner.token
        && this._pidIsAlive(Number(owner.pid))) {
        retained.push(Object.freeze({ name: entry.name, reason: 'LIVE_OWNER' }));
        continue;
      }

      // Revalidate both physical identity and exact content before removal.
      // This closes the lstat/read/unlink replacement race without following
      // links or relying on a stale directory enumeration.
      let after;
      let currentBytes;
      try {
        after = this.fs.lstatSync(lockPath);
        currentBytes = this.fs.readFileSync(lockPath);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const sameIdentity = String(before.dev) === String(after.dev)
        && String(before.ino) === String(after.ino)
        && before.size === after.size
        && before.mtimeMs === after.mtimeMs;
      const sameContent = bytes.length === currentBytes.length
        && crypto.timingSafeEqual(bytes, currentBytes);
      if (!after.isFile() || after.isSymbolicLink() || !sameIdentity || !sameContent) {
        retained.push(Object.freeze({ name: entry.name, reason: 'LOCK_CHANGED' }));
        continue;
      }
      this.fs.unlinkSync(lockPath);
      removed.push(entry.name);
    }
    if (removed.length) this._fsyncDirectory(this.paths.locksRoot);
    return Object.freeze({
      removed: Object.freeze(removed.sort((left, right) => left.localeCompare(right, 'en'))),
      retained: Object.freeze(retained.sort((left, right) => left.name.localeCompare(right.name, 'en'))),
    });
  }

  _writeTemp(directory, leaf, value) {
    this._assertLayoutStable();
    const temporary = path.join(directory, `.${leaf}.${this.randomId()}.tmp`);
    const content = `${JSON.stringify(value, null, 2)}\n`;
    let fd;
    try {
      fd = this.fs.openSync(temporary, 'wx', 0o600);
      this.fs.writeFileSync(fd, content, 'utf8');
      this.fs.fsyncSync(fd);
      this.fs.closeSync(fd);
      fd = undefined;
      return temporary;
    } catch (error) {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch (cleanupError) { attachCleanupError(error, cleanupError); }
      }
      try { this.fs.unlinkSync(temporary); } catch (cleanupError) { attachCleanupError(error, cleanupError); }
      throw error;
    }
  }

  _publishCreate(kind, id, value) {
    this._assertLayoutStable();
    const target = this._recordPath(kind, id);
    const directory = path.dirname(target);
    const temporary = this._writeTemp(directory, `${id}.json`, value);
    let primaryError = null;
    try {
      try {
        this.fs.linkSync(temporary, target);
      } catch (error) {
        if (error?.code === 'EEXIST') throw error;
        if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error?.code)) {
          throw codedError(
            'LIBRARY_ACQUISITION_ATOMIC_CREATE_UNSUPPORTED',
            'the Workspace filesystem cannot atomically publish acquisition records',
            { cause: error },
          );
        }
        throw error;
      }
      this._fsyncDirectory(directory);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try { this.fs.unlinkSync(temporary); } catch (cleanupError) {
        if (!primaryError && cleanupError?.code !== 'ENOENT') throw cleanupError;
        if (primaryError) attachCleanupError(primaryError, cleanupError);
      }
    }
  }

  _publishReplace(kind, id, value) {
    this._assertLayoutStable();
    const target = this._recordPath(kind, id);
    const directory = path.dirname(target);
    const temporary = this._writeTemp(directory, `${id}.json`, value);
    try {
      this.fs.renameSync(temporary, target);
      this._fsyncDirectory(directory);
    } catch (error) {
      try { this.fs.unlinkSync(temporary); } catch (cleanupError) { attachCleanupError(error, cleanupError); }
      throw error;
    }
  }

  _throwIfCorrupt(kind, id) {
    const corruption = this._blocked(kind, id);
    if (corruption) {
      throw codedError(
        'LIBRARY_ACQUISITION_RECORD_CORRUPT',
        'durable acquisition record is corrupt and must be repaired outside the store',
        { corruption: clone(corruption) },
      );
    }
  }

  readJob(jobId) {
    return this._readOne(JOB_KIND, jobId);
  }

  getJob(jobId) {
    const result = this.readJob(jobId);
    if (!result.ok) this._throwIfCorrupt(JOB_KIND, safeRecordId(jobId, 'jobId'));
    return result.record;
  }

  listJobs() {
    return this._scan(JOB_KIND).sort((left, right) => left.jobId.localeCompare(right.jobId));
  }

  putJob(input, options = {}) {
    if (!isPlainRecord(input)) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_JOB', 'acquisition job input must be a plain object');
    }
    safeRecordId(input.jobId, 'jobId');
    safeRecordId(input.intentId, 'intentId');
    if (!options.candidate) {
      throw codedError(
        'LIBRARY_ACQUISITION_CANDIDATE_REQUIRED',
        'creating an acquisition job requires its validated Resource Candidate',
      );
    }
    const now = this._now();
    let job = this._normalize(
      JOB_KIND,
      { ...input, revision: input?.revision ?? 1 },
      now,
      { candidate: options.candidate },
    );
    if (contract.PASSING_RIGHTS_STATUSES.includes(job.rightsStatus) && !job.rightsReceipt) {
      throw codedError(
        'LIBRARY_ACQUISITION_RIGHTS_RECEIPT_REQUIRED',
        'a passing Candidate must establish its Rights Receipt when the durable job is created',
      );
    }
    if (job.idempotencyAliases.length) {
      throw codedError(
        'LIBRARY_ACQUISITION_ALIAS_FORBIDDEN_ON_CREATE',
        'idempotency aliases can only be established by the Store selection transaction',
      );
    }
    const preSelectionKey = job.selectedFiles.length
      ? contract.deriveAcquisitionIdempotencyKey({
        workspaceIdentity: job.workspaceIdentity,
        intentId: job.intentId,
        offerId: job.offerId,
        transportIdentity: job.transportIdentity,
        selectedFiles: [],
      })
      : '';
    if (preSelectionKey) {
      job = this._normalize(JOB_KIND, {
        ...job,
        idempotencyAliases: [preSelectionKey],
      }, now, { candidate: options.candidate, durableRecord: true });
    }
    const identityScopes = [job.idempotencyKey, preSelectionKey]
      .filter(Boolean)
      .map(key => `job-idempotency:${key}`);
    return this._withMutationLocks(
      identityScopes,
      () => this._putJobNormalized(job, { preSelectionKey }),
    );
  }

  _putJobNormalized(job, { preSelectionKey = '' } = {}) {
    safeRecordId(job.jobId, 'jobId');
    if (job.revision !== 1) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_REVISION', 'a new acquisition job must start at revision 1');
    }
    this._scan(JOB_KIND);
    if ([...this.corruptions.values()].some(item => item.recordType === JOB_KIND)) {
      throw codedError(
        'LIBRARY_ACQUISITION_LEDGER_REPAIR_REQUIRED',
        'a corrupt acquisition Job makes idempotency ownership unknowable; repair is required before creating work',
      );
    }
    this._throwIfCorrupt(JOB_KIND, job.jobId);

    const exactKeyId = this.jobByIdempotencyKey.get(job.idempotencyKey);
    if (exactKeyId) {
      const existing = this.getJob(exactKeyId);
      return { created: false, idempotent: true, job: existing };
    }
    if (preSelectionKey) {
      const preSelectionOwner = this.jobByIdempotencyKey.get(preSelectionKey);
      if (preSelectionOwner) {
        const existing = this.getJob(preSelectionOwner);
        if (existing.selectedFiles.length) {
          throw codedError(
            'LIBRARY_ACQUISITION_SELECTION_CONFLICT',
            'this acquisition intent already finalized a different file selection',
          );
        }
        throw codedError(
          'LIBRARY_ACQUISITION_SELECTION_TRANSACTION_REQUIRED',
          'this acquisition intent is awaiting selection and must be finalized with its revisioned transition',
        );
      }
    }
    const existing = this.getJob(job.jobId);
    if (existing) {
      if (existing.idempotencyKey === job.idempotencyKey) {
        return { created: false, idempotent: true, job: existing };
      }
      throw codedError('LIBRARY_ACQUISITION_JOB_ID_CONFLICT', 'jobId already belongs to another acquisition');
    }

    try {
      this._publishCreate(JOB_KIND, job.jobId, job);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const winner = this.getJob(job.jobId);
      if (!winner || winner.idempotencyKey !== job.idempotencyKey) {
        throw codedError('LIBRARY_ACQUISITION_JOB_ID_CONFLICT', 'jobId was concurrently claimed by another acquisition');
      }
      return { created: false, idempotent: true, job: winner };
    }
    this.jobs.set(job.jobId, job);
    this._rebuildIdempotencyProjection();
    return { created: true, idempotent: false, job: clone(job) };
  }

  createJob(input, options = {}) {
    return this.putJob(input, options).job;
  }

  _parseUpdate(expectedOrOptions, maybeChange) {
    if (typeof expectedOrOptions === 'number') {
      return {
        expectedRevision: expectedOrOptions,
        ...(typeof maybeChange === 'function' ? { mutate: maybeChange } : { patch: maybeChange }),
      };
    }
    const value = expectedOrOptions || {};
    if (Object.prototype.hasOwnProperty.call(value, 'expectedRevision')
      || Object.prototype.hasOwnProperty.call(value, 'patch')
      || Object.prototype.hasOwnProperty.call(value, 'next')
      || Object.prototype.hasOwnProperty.call(value, 'mutate')) return value;
    return { expectedRevision: value.revision, next: value };
  }

  updateJob(jobId, expectedOrOptions, maybeChange) {
    const id = safeRecordId(jobId, 'jobId');
    return this._withMutationLock(
      `job-record:${id}`,
      () => this._updateJobUnlocked(id, expectedOrOptions, maybeChange),
    );
  }

  _updateJobUnlocked(id, expectedOrOptions, maybeChange) {
    this._scan(JOB_KIND);
    this._throwIfCorrupt(JOB_KIND, id);
    const current = this.getJob(id);
    if (!current) throw codedError('LIBRARY_ACQUISITION_JOB_NOT_FOUND', 'acquisition job does not exist');
    const options = this._parseUpdate(expectedOrOptions, maybeChange);
    if (!Number.isInteger(options.expectedRevision)) {
      throw codedError('LIBRARY_ACQUISITION_EXPECTED_REVISION_REQUIRED', 'job update requires expectedRevision');
    }
    if (options.expectedRevision !== current.revision) {
      throw codedError('LIBRARY_ACQUISITION_REVISION_CONFLICT', 'acquisition job revision changed', {
        expectedRevision: options.expectedRevision,
        actualRevision: current.revision,
      });
    }

    let proposed;
    if (typeof options.mutate === 'function') proposed = options.mutate(clone(current));
    else if (options.next !== undefined) proposed = options.next;
    else proposed = { ...current, ...(options.patch === undefined ? {} : options.patch) };
    if (!isPlainRecord(proposed)
      || (options.patch !== undefined && !isPlainRecord(options.patch))) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_UPDATE', 'job update must produce an object');
    }

    if (contract.isTerminalJobState(current.state)) {
      if (canonicalJson(proposed) !== canonicalJson(current)) {
        throw codedError(
          'LIBRARY_ACQUISITION_TERMINAL_IMMUTABLE',
          'terminal acquisition receipts are immutable',
        );
      }
      return clone(current);
    }
    if (current.state === 'failed' && proposed.state === 'failed') {
      if (canonicalJson(proposed) !== canonicalJson(current)) {
        throw codedError(
          'LIBRARY_ACQUISITION_FAILED_IMMUTABLE',
          'a failed acquisition receipt can only retry or cancel, not be rewritten in place',
        );
      }
      return clone(current);
    }

    const immutable = [
      'schema', 'jobId', 'intentId', 'workspaceIdentity', 'workspacePath',
      'candidateId', 'candidateFingerprint', 'offerId', 'providerId', 'transport', 'transportIdentity', 'rightsStatus', 'createdAt',
    ];
    for (const key of immutable) {
      if (canonicalJson(proposed[key]) !== canonicalJson(current[key])) {
        throw codedError('LIBRARY_ACQUISITION_IMMUTABLE_FIELD', `acquisition job field ${key} is immutable`);
      }
    }
    const rightsChanged = canonicalJson(proposed.rightsReceipt) !== canonicalJson(current.rightsReceipt);
    if (current.rightsReceipt && rightsChanged) {
      throw codedError('LIBRARY_ACQUISITION_IMMUTABLE_FIELD', 'an established Rights Receipt is immutable');
    }
    if (!current.rightsReceipt && proposed.rightsReceipt) {
      const userResolution = current.state === 'awaiting-rights'
        && current.rightsStatus === 'unknown'
        && proposed.state === 'inspecting'
        && proposed.rightsReceipt.decision === 'user-owned'
        && proposed.rightsReceipt.authority === 'user';
      if (!userResolution) {
        throw codedError(
          'LIBRARY_ACQUISITION_RIGHTS_ESCALATION_FORBIDDEN',
          'an unverified job can only advance through an explicit user-owned Rights decision',
        );
      }
    }
    if (proposed.state === current.state && proposed.retryFrom !== current.retryFrom) {
      throw codedError(
        'LIBRARY_ACQUISITION_RETRY_TARGET_IMMUTABLE',
        'a durable retry target cannot be rewritten in place',
      );
    }
    const selectionChanged = canonicalJson(proposed.selectedFiles) !== canonicalJson(current.selectedFiles);
    if (current.state === 'awaiting-selection' && proposed.state === 'queued'
      && (!selectionChanged || !Array.isArray(proposed.selectedFiles) || proposed.selectedFiles.length === 0)) {
      throw codedError(
        'LIBRARY_ACQUISITION_SELECTION_REQUIRED',
        'awaiting-selection can enter queued only with an explicit non-empty file selection',
      );
    }
    if (selectionChanged && !(current.state === 'awaiting-selection' && proposed.state === 'queued')) {
      throw codedError(
        'LIBRARY_ACQUISITION_SELECTION_IMMUTABLE',
        'selectedFiles can only be finalized when awaiting-selection enters queued',
      );
    }
    if (selectionChanged) {
      if (!options.candidate) {
        throw codedError(
          'LIBRARY_ACQUISITION_CANDIDATE_REQUIRED',
          'finalizing a file selection requires the validated Resource Candidate',
        );
      }
      proposed.idempotencyAliases = [...new Set([
        ...(current.idempotencyAliases || []),
        current.idempotencyKey,
      ])].sort((left, right) => left.localeCompare(right, 'en'));
      proposed.idempotencyKey = contract.deriveAcquisitionIdempotencyKey({
        workspaceIdentity: current.workspaceIdentity,
        intentId: current.intentId,
        offerId: current.offerId,
        transportIdentity: current.transportIdentity,
        selectedFiles: proposed.selectedFiles,
      });
    } else if (proposed.idempotencyKey !== current.idempotencyKey
      || canonicalJson(proposed.idempotencyAliases || []) !== canonicalJson(current.idempotencyAliases || [])) {
      throw codedError('LIBRARY_ACQUISITION_IMMUTABLE_FIELD', 'idempotency identity and aliases are derived and immutable');
    }
    if (proposed.state !== current.state) {
      if (options.restartRecovery === true) {
        const validRecovery = contract.RESTART_PAUSE_STATES.includes(current.state)
          && proposed.state === 'paused'
          && proposed.retryFrom === current.state
          && proposed.error?.code === 'APP_RESTART_RECOVERY';
        if (!validRecovery) {
          throw codedError('LIBRARY_ACQUISITION_INVALID_RECOVERY', 'restart recovery transition is malformed');
        }
      }
      const transitionRetryFrom = current.state === 'failed'
        ? current.retryFrom
        : (current.state === 'paused' && proposed.state !== 'failed'
          ? current.retryFrom
          : proposed.retryFrom);
      contract.assertJobTransition(current.state, proposed.state, {
        retryFrom: transitionRetryFrom,
        restartRecovery: options.restartRecovery === true,
      });
    }
    const now = this._now();
    const next = this._normalize(JOB_KIND, {
      ...proposed,
      revision: current.revision + 1,
      updatedAt: now,
    }, now, {
      durableRecord: true,
      ...(selectionChanged ? { candidate: options.candidate } : {}),
    });
    const commit = () => {
      if (selectionChanged) {
        this._scan(JOB_KIND);
        if ([...this.corruptions.values()].some(item => item.recordType === JOB_KIND)) {
          throw codedError(
            'LIBRARY_ACQUISITION_LEDGER_REPAIR_REQUIRED',
            'a corrupt acquisition Job makes selection idempotency ownership unknowable',
          );
        }
        const owner = this.jobByIdempotencyKey.get(next.idempotencyKey);
        if (owner && owner !== id) {
          throw codedError(
            'LIBRARY_ACQUISITION_DUPLICATE_IDEMPOTENCY_KEY',
            'another durable job already owns the finalized acquisition selection',
          );
        }
      }
      this._publishReplace(JOB_KIND, id, next);
      this.jobs.set(id, next);
      this._rebuildIdempotencyProjection();
      return clone(next);
    };
    return selectionChanged
      ? this._withMutationLocks([
        `job-idempotency:${current.idempotencyKey}`,
        `job-idempotency:${next.idempotencyKey}`,
      ], commit)
      : commit();
  }

  transitionJob(jobId, state, options = {}) {
    const { expectedRevision, patch = {}, retryFrom, candidate } = options;
    const clearRetryFrom = state !== 'failed';
    return this.updateJob(jobId, {
      expectedRevision,
      patch: {
        ...patch,
        state,
        ...(retryFrom === undefined
          ? (clearRetryFrom ? { retryFrom: null } : {})
          : { retryFrom }),
      },
      ...(candidate ? { candidate } : {}),
    });
  }

  recoverAfterRestart() {
    // The explicit app-start owner may have opened before another process or
    // renderer published its last durable state. Recovery is defined over
    // disk truth, never this instance's stale in-memory projection.
    this._scan(JOB_KIND);
    const recovered = [];
    for (const jobId of [...this.jobs.keys()]) {
      const current = this.getJob(jobId);
      if (!current) continue;
      const now = this._now();
      const projected = contract.recoverJobAfterRestart(clone(current), { now });
      if (canonicalJson(projected) === canonicalJson(current)) continue;
      const next = this.updateJob(current.jobId, {
        expectedRevision: current.revision,
        restartRecovery: true,
        patch: {
          state: projected.state,
          retryFrom: projected.retryFrom,
          error: projected.error,
        },
      });
      recovered.push(clone(next));
    }
    return recovered;
  }

  readInboxReceipt(receiptId) {
    return this._readOne(INBOX_KIND, receiptId);
  }

  getInboxReceipt(receiptId) {
    const result = this.readInboxReceipt(receiptId);
    if (!result.ok) this._throwIfCorrupt(INBOX_KIND, safeRecordId(receiptId, 'receiptId'));
    return result.record;
  }

  listInboxReceipts({ state } = {}) {
    return this._scan(INBOX_KIND)
      .filter(receipt => !state || receipt.state === state)
      .sort((left, right) => left.receiptId.localeCompare(right.receiptId));
  }

  putInboxReceipt(input) {
    if (!isPlainRecord(input)) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_INBOX', 'Inbox receipt input must be a plain object');
    }
    safeRecordId(input.receiptId, 'receiptId');
    safeRecordId(input.jobId, 'jobId');
    const now = this._now();
    const receipt = this._normalize(INBOX_KIND, {
      ...input,
      state: input?.state ?? 'pending',
      revision: input?.revision ?? 1,
      createdAt: input?.createdAt ?? now,
    }, now);
    safeRecordId(receipt.receiptId, 'receiptId');
    this._assertPhysicalBoundary(this.paths.libraryRoot, receipt.artifact.path, { mustBeRegularFile: true });
    return this._withMutationLock(
      `inbox-record:${receipt.receiptId}`,
      () => this._putInboxReceiptNormalized(receipt, input),
    );
  }

  _putInboxReceiptNormalized(receipt, input) {
    this._scan(INBOX_KIND);
    this._throwIfCorrupt(INBOX_KIND, receipt.receiptId);
    const existing = this.getInboxReceipt(receipt.receiptId);
    if (existing) {
      const incoming = { ...receipt, createdAt: input?.createdAt ?? existing.createdAt };
      if (canonicalJson(receiptImmutableView(incoming)) !== canonicalJson(receiptImmutableView(existing))) {
        throw codedError('LIBRARY_ACQUISITION_INBOX_CONFLICT', 'receiptId already refers to different content');
      }
      return { created: false, idempotent: true, receipt: existing };
    }
    if (receipt.state !== 'pending' || receipt.revision !== 1) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_INBOX_CREATE', 'a new Inbox receipt must start pending at revision 1');
    }

    try {
      this._publishCreate(INBOX_KIND, receipt.receiptId, receipt);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const winner = this.getInboxReceipt(receipt.receiptId);
      if (!winner || canonicalJson(receiptImmutableView(receipt)) !== canonicalJson(receiptImmutableView(winner))) {
        throw codedError('LIBRARY_ACQUISITION_INBOX_CONFLICT', 'receiptId was concurrently claimed by different content');
      }
      return { created: false, idempotent: true, receipt: winner };
    }
    this.inbox.set(receipt.receiptId, receipt);
    return { created: true, idempotent: false, receipt: clone(receipt) };
  }

  createInboxReceipt(input) {
    return this.putInboxReceipt(input).receipt;
  }

  acknowledgeInboxReceipt(receiptId, options = {}) {
    const id = safeRecordId(receiptId, 'receiptId');
    return this._withMutationLock(
      `inbox-record:${id}`,
      () => this._acknowledgeInboxReceiptUnlocked(id, options),
    );
  }

  _acknowledgeInboxReceiptUnlocked(id, options = {}) {
    this._throwIfCorrupt(INBOX_KIND, id);
    const current = this.getInboxReceipt(id);
    if (!current) throw codedError('LIBRARY_ACQUISITION_INBOX_NOT_FOUND', 'Inbox receipt does not exist');
    if (current.state === 'acknowledged') return current;
    if (current.state !== 'pending') {
      throw codedError('LIBRARY_ACQUISITION_INVALID_INBOX_STATE', 'Inbox receipt is not pending');
    }
    if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
      throw codedError('LIBRARY_ACQUISITION_REVISION_CONFLICT', 'Inbox receipt revision changed', {
        expectedRevision: options.expectedRevision,
        actualRevision: current.revision,
      });
    }
    const acknowledgedAt = iso(options.acknowledgedAt ?? this.clock());
    const next = this._normalize(INBOX_KIND, {
      ...current,
      state: 'acknowledged',
      revision: current.revision + 1,
      acknowledgedAt,
    }, acknowledgedAt);
    this._publishReplace(INBOX_KIND, id, next);
    this.inbox.set(id, next);
    return clone(next);
  }

  listCorruptions() {
    return [...this.corruptions.values()]
      .map(clone)
      .sort((left, right) => `${left.recordType}:${left.recordId}`.localeCompare(`${right.recordType}:${right.recordId}`));
  }

  snapshot() {
    return {
      workspacePath: this.workspacePath,
      workspaceIdentity: this.workspaceIdentity,
      jobs: this.listJobs(),
      inbox: this.listInboxReceipts(),
      corruptions: this.listCorruptions(),
    };
  }
}

module.exports = LibraryAcquisitionStore;
module.exports.LibraryAcquisitionStore = LibraryAcquisitionStore;
module.exports.CORRUPTION_SCHEMA = CORRUPTION_SCHEMA;
module.exports.createSingleInstanceOwnerCapability = createSingleInstanceOwnerCapability;
module.exports._forTests = { canonicalJson, receiptImmutableView, safeRecordId };
