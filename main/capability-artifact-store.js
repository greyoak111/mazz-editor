// W94B Workspace-bound streaming content-addressed Artifact store.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const contract = require('./capability-execution-contract');

const STORAGE_REF = /^capability-blob:([0-9a-f]{64})$/;

function codedError(code, message, details = {}) {
  return contract.codedError(code, message, details);
}

function attachCleanupError(primary, cleanup) {
  if (!primary || !cleanup) return;
  if (!Array.isArray(primary.cleanupErrors)) primary.cleanupErrors = [];
  primary.cleanupErrors.push({ code: cleanup.code || 'CLEANUP_FAILED', message: cleanup.message || String(cleanup) });
}

function physicalIdentity(stat) {
  return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.mode}`;
}

class CapabilityArtifactStore {
  constructor({ workspacePath, fsApi = fs, randomId = () => crypto.randomUUID() } = {}) {
    this.fs = fsApi;
    this.randomId = randomId;
    if (typeof workspacePath !== 'string' || !workspacePath || workspacePath !== workspacePath.trim()) {
      throw codedError('CAPABILITY_ARTIFACT_WORKSPACE_INVALID', 'Artifact Store 需要精确 Workspace path');
    }
    const requested = path.resolve(workspacePath);
    if (!this.fs.existsSync(requested)) throw codedError('CAPABILITY_ARTIFACT_WORKSPACE_MISSING', 'Artifact Workspace 不存在');
    this._assertNoLinkedComponents(requested);
    this.workspacePath = this._realpath(requested);
    this.workspaceIdentity = `workspace-sha256-${contract.sha256Hex(Buffer.from(this.workspacePath, 'utf8'))}`;
    this.paths = Object.freeze({
      root: path.join(this.workspacePath, '.mazz', 'capability-artifacts'),
      blobs: path.join(this.workspacePath, '.mazz', 'capability-artifacts', 'blobs'),
      staging: path.join(this.workspacePath, '.mazz', 'capability-artifacts', 'staging'),
      locks: path.join(this.workspacePath, '.mazz', 'capability-artifacts', 'locks'),
      quarantine: path.join(this.workspacePath, '.mazz', 'capability-artifacts', 'quarantine'),
    });
    this._ensureLayout();
    this._layout = new Map(Object.values(this.paths).map(directory => [directory, this._directoryFingerprint(directory)]));
  }

  _identityPath(value) {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
  }

  _realpath(value) {
    const native = this.fs.realpathSync?.native;
    return path.resolve(typeof native === 'function' ? native(value) : this.fs.realpathSync(value));
  }

  _insideWorkspace(value) {
    const root = this._identityPath(this.workspacePath);
    const candidate = this._identityPath(value);
    return candidate === root || candidate.startsWith(root + path.sep);
  }

  _assertNoLinkedComponents(value) {
    const absolute = path.resolve(value);
    let cursor = absolute;
    const chain = [];
    while (!this.fs.existsSync(cursor)) {
      chain.push(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) throw codedError('CAPABILITY_ARTIFACT_LAYOUT_UNSAFE', 'Artifact path 无现存祖先');
      cursor = parent;
    }
    const root = path.parse(cursor).root;
    const components = [];
    let walk = cursor;
    while (true) {
      components.push(walk);
      if (walk === root) break;
      walk = path.dirname(walk);
    }
    for (const component of components.reverse()) {
      const stat = this.fs.lstatSync(component);
      if (stat.isSymbolicLink()) throw codedError('CAPABILITY_ARTIFACT_LAYOUT_UNSAFE', 'Artifact path 含 link/reparse component');
    }
    return chain;
  }

  _ensureDirectory(directory) {
    if (!this._insideWorkspace(directory)) throw codedError('CAPABILITY_ARTIFACT_LAYOUT_UNSAFE', 'Artifact layout 越出 Workspace');
    this._assertNoLinkedComponents(directory);
    if (!this.fs.existsSync(directory)) this.fs.mkdirSync(directory, { recursive: false });
    const stat = this.fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw codedError('CAPABILITY_ARTIFACT_LAYOUT_UNSAFE', 'Artifact layout 必须是物理目录');
    const physical = this._realpath(directory);
    if (!this._insideWorkspace(physical)) throw codedError('CAPABILITY_ARTIFACT_LAYOUT_UNSAFE', 'Artifact layout 物理越界');
  }

  _ensureLayout() {
    const mazzRoot = path.join(this.workspacePath, '.mazz');
    for (const directory of [mazzRoot, this.paths.root, this.paths.blobs, this.paths.staging, this.paths.locks, this.paths.quarantine]) {
      this._ensureDirectory(directory);
    }
  }

  _directoryFingerprint(directory) {
    const stat = this.fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw codedError('CAPABILITY_ARTIFACT_LAYOUT_UNSAFE', 'Artifact layout 已被替换');
    return `${this._identityPath(this._realpath(directory))}:${physicalIdentity(stat)}`;
  }

  _assertLayout() {
    for (const [directory, fingerprint] of this._layout) {
      if (this._directoryFingerprint(directory) !== fingerprint) {
        throw codedError('CAPABILITY_ARTIFACT_LAYOUT_CHANGED', 'Artifact layout physical identity 已改变');
      }
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
        try { this.fs.closeSync(fd); } catch (cleanup) {
          if (primary) attachCleanupError(primary, cleanup); else primary = cleanup;
        }
      }
    }
    if (primary) throw primary;
  }

  _blobPath(hex) {
    if (!/^[0-9a-f]{64}$/.test(hex)) throw codedError('CAPABILITY_ARTIFACT_REF_INVALID', 'Artifact blob hash 非法');
    return path.join(this.paths.blobs, hex);
  }

  _validateBlobPath(blobPath, expectedHex = '') {
    this._assertLayout();
    const resolved = path.resolve(blobPath);
    if (path.dirname(resolved) !== this.paths.blobs) throw codedError('CAPABILITY_ARTIFACT_LAYOUT_UNSAFE', 'Artifact blob 越界');
    if (expectedHex && path.basename(resolved) !== expectedHex) throw codedError('CAPABILITY_ARTIFACT_REF_INVALID', 'Artifact blob identity 不匹配');
    const stat = this.fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink < 1) {
      throw codedError('CAPABILITY_ARTIFACT_BLOB_UNSAFE', 'Artifact blob 必须是物理 regular file');
    }
    if (this._realpath(resolved) !== resolved) throw codedError('CAPABILITY_ARTIFACT_BLOB_UNSAFE', 'Artifact blob physical path 不一致');
    return stat;
  }

  async _hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    let size = 0;
    for await (const chunk of this.fs.createReadStream(filePath)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      size += buffer.length;
    }
    return { hex: hash.digest('hex'), size };
  }

  async _verifyExisting(blobPath, expectedHex, expectedSize) {
    const before = this._validateBlobPath(blobPath, expectedHex);
    const digest = await this._hashFile(blobPath);
    const after = this._validateBlobPath(blobPath, expectedHex);
    if (physicalIdentity(before) !== physicalIdentity(after) || digest.hex !== expectedHex || digest.size !== expectedSize) {
      throw codedError('CAPABILITY_ARTIFACT_BLOB_CORRUPT', '既有 Artifact blob 完整性不一致');
    }
    return after;
  }

  _safeUnlink(filePath) {
    if (!this.fs.existsSync(filePath)) return;
    this.fs.unlinkSync(filePath);
  }

  async publishReadable({ readable, signal = null, beforeCommit = null } = {}) {
    if (!readable || typeof readable[Symbol.asyncIterator] !== 'function') {
      throw codedError('CAPABILITY_ARTIFACT_STREAM_INVALID', 'Artifact publisher 需要 Readable stream');
    }
    this._assertLayout();
    const stagingPath = path.join(this.paths.staging, `artifact-${this.randomId()}.part`);
    if (path.dirname(stagingPath) !== this.paths.staging) throw codedError('CAPABILITY_ARTIFACT_LAYOUT_UNSAFE', 'Artifact staging 越界');
    let fd;
    let primary = null;
    const hash = crypto.createHash('sha256');
    let size = 0;
    try {
      fd = this.fs.openSync(stagingPath, 'wx');
      for await (const chunk of readable) {
        if (signal?.aborted) throw codedError('CAPABILITY_CANCELLED', 'Artifact publication cancelled');
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        let offset = 0;
        while (offset < buffer.length) offset += this.fs.writeSync(fd, buffer, offset, buffer.length - offset);
        hash.update(buffer);
        size += buffer.length;
      }
      this.fs.fsyncSync(fd);
    } catch (error) {
      primary = error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch (cleanup) {
          if (primary) attachCleanupError(primary, cleanup); else primary = cleanup;
        }
      }
    }
    if (primary) {
      try { this._safeUnlink(stagingPath); } catch (cleanup) { attachCleanupError(primary, cleanup); }
      throw primary;
    }
    try {
      if (beforeCommit) await beforeCommit;
      if (signal?.aborted) throw codedError('CAPABILITY_CANCELLED', 'Artifact publication cancelled');
      this._assertLayout();
      const hex = hash.digest('hex');
      const blobPath = this._blobPath(hex);
      let reused = false;
      try {
        this.fs.linkSync(stagingPath, blobPath);
        this._fsyncDirectory(this.paths.blobs);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          await this._verifyExisting(blobPath, hex, size);
          reused = true;
        } else if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error?.code)) {
          throw codedError('CAPABILITY_ARTIFACT_ATOMIC_PUBLISH_UNSUPPORTED', 'Workspace filesystem 不支持 Artifact 原子排他发布', { cause: error });
        } else throw error;
      }
      const finalStat = this._validateBlobPath(blobPath, hex);
      if (finalStat.size !== size) throw codedError('CAPABILITY_ARTIFACT_BLOB_CORRUPT', 'Artifact publish size 不一致');
      this._safeUnlink(stagingPath);
      this._fsyncDirectory(this.paths.staging);
      return Object.freeze({
        contentHash: `sha256-${hex}`,
        storageRef: `capability-blob:${hex}`,
        size,
        created: !reused,
        reused,
      });
    } catch (error) {
      try { this._safeUnlink(stagingPath); } catch (cleanup) { attachCleanupError(error, cleanup); }
      throw error;
    }
  }

  publishBytes(bytes, options = {}) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return this.publishReadable({ ...options, readable: Readable.from([buffer]) });
  }

  async open(storageRef, { expectedHash = '' } = {}) {
    const ref = contract.opaqueRef(storageRef, 'storageRef');
    const match = STORAGE_REF.exec(ref);
    if (!match) throw codedError('CAPABILITY_ARTIFACT_REF_INVALID', 'Artifact storageRef 非法');
    const hex = match[1];
    if (expectedHash && contract.normalizeHash(expectedHash, 'expectedHash') !== `sha256-${hex}`) {
      throw codedError('CAPABILITY_ARTIFACT_REF_MISMATCH', 'Artifact storageRef/contentHash 不一致');
    }
    const blobPath = this._blobPath(hex);
    const before = this._validateBlobPath(blobPath, hex);
    let fd;
    let primary = null;
    try {
      fd = this.fs.openSync(blobPath, 'r');
      const opened = this.fs.fstatSync(fd);
      const current = this._validateBlobPath(blobPath, hex);
      if (!opened.isFile() || physicalIdentity(opened) !== physicalIdentity(before)
          || physicalIdentity(current) !== physicalIdentity(before) || opened.size !== before.size) {
        throw codedError('CAPABILITY_ARTIFACT_BLOB_CHANGED', 'Artifact blob 在打开时被替换');
      }
      const stream = this.fs.createReadStream(blobPath, { fd, autoClose: true });
      fd = undefined;
      return Object.freeze({
        stream,
        size: opened.size,
        contentHash: `sha256-${hex}`,
        storageRef: ref,
      });
    } catch (error) {
      primary = error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch (cleanup) {
          if (primary) attachCleanupError(primary, cleanup); else primary = cleanup;
        }
      }
    }
    throw primary;
  }

  snapshot() {
    this._assertLayout();
    const blobs = this.fs.readdirSync(this.paths.blobs, { withFileTypes: true });
    const staging = this.fs.readdirSync(this.paths.staging, { withFileTypes: true });
    return Object.freeze({
      schema: 'mazz.capability-artifact-store-snapshot/v1',
      workspaceIdentity: this.workspaceIdentity,
      blobCount: blobs.filter(entry => entry.isFile() && /^[0-9a-f]{64}$/.test(entry.name)).length,
      stagingCount: staging.length,
    });
  }
}

module.exports = { CapabilityArtifactStore, STORAGE_REF };
