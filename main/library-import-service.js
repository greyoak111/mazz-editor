// main/library-import-service.js
//
// Library imports are coordinated in the main process because renderer-local
// queues cannot serialize two BrowserWindows.  A complete temporary file is
// published without overwrite.  The legacy renderer compatibility route keeps
// its COPYFILE_EXCL fallback; W93B's formal path route requires a hard link and
// fails closed when that atomic primitive is unavailable.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const COPYFILE_EXCL = fs.constants.COPYFILE_EXCL;
const STREAM_CHUNK_BYTES = 1024 * 1024;
const HARD_LINK_UNSUPPORTED_CODES = new Set([
  'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS',
]);

function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function attachCleanupError(primary, cleanup) {
  if (!primary || !cleanup || cleanup.code === 'ENOENT') return;
  if (!primary.cleanupError) primary.cleanupError = cleanup;
  if (!Array.isArray(primary.cleanupErrors)) primary.cleanupErrors = [];
  primary.cleanupErrors.push(cleanup);
}

function ownerKey(ownerId) {
  return String(ownerId ?? '');
}

function safeLeafName(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('\0') || raw === '.' || raw === '..') {
    throw Object.assign(new TypeError('library import requires a valid file name'), {
      code: 'LIBRARY_IMPORT_INVALID_NAME',
    });
  }
  if (path.basename(raw) !== raw || /[\\/]/.test(raw)) {
    throw Object.assign(new TypeError('library import name must not contain a path'), {
      code: 'LIBRARY_IMPORT_INVALID_NAME',
    });
  }
  return raw;
}

function safePromotionLeafName(value) {
  if (typeof value !== 'string' || !value || value !== value.normalize('NFC')
    || value === '.' || value === '..' || /[\u0000-\u001f\u007f<>:"/\\|?*]/.test(value)
    || /[. ]$/.test(value) || path.basename(value) !== value || /[\\/]/.test(value)) {
    throw codedError('LIBRARY_IMPORT_INVALID_NAME', 'library promotion requires a canonical safe leaf name');
  }
  const deviceStem = value.split('.')[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|CLOCK\$|COM[1-9]|LPT[1-9])$/.test(deviceStem)) {
    throw codedError('LIBRARY_IMPORT_INVALID_NAME', 'library promotion name must not be a reserved device name');
  }
  return value;
}

function safeAbsolutePath(value, label) {
  if (typeof value !== 'string' || !value || !path.isAbsolute(value)
    || /^(?:\\\\[?.]\\|\\\?\?\\|\/\/[?.]\/)/.test(value)) {
    throw codedError(
      label === 'workspace' ? 'LIBRARY_IMPORT_INVALID_WORKSPACE' : 'LIBRARY_IMPORT_INVALID_SOURCE',
      `library promotion requires an absolute non-device ${label} path`,
    );
  }
  const parsed = path.parse(value);
  const tail = value.slice(parsed.root.length);
  const components = tail.split(/[\\/]+/).filter(Boolean);
  for (const component of components) {
    if (component === '.' || component === '..' || component !== component.normalize('NFC')
      || /[\u0000-\u001f\u007f<>:"|?*]/.test(component) || /[. ]$/.test(component)) {
      throw codedError(
        label === 'workspace' ? 'LIBRARY_IMPORT_INVALID_WORKSPACE' : 'LIBRARY_IMPORT_INVALID_SOURCE',
        `library promotion ${label} path contains an unsafe component`,
      );
    }
    const deviceStem = component.split('.')[0].toUpperCase();
    if (/^(CON|PRN|AUX|NUL|CLOCK\$|COM[1-9]|LPT[1-9])$/.test(deviceStem)) {
      throw codedError(
        label === 'workspace' ? 'LIBRARY_IMPORT_INVALID_WORKSPACE' : 'LIBRARY_IMPORT_INVALID_SOURCE',
        `library promotion ${label} path contains a reserved device component`,
      );
    }
  }
  return path.resolve(value);
}

function physicalRealpath(fsImpl, target) {
  if (typeof fsImpl.realpathSync?.native === 'function') return path.resolve(fsImpl.realpathSync.native(target));
  if (typeof fsImpl.realpathSync === 'function') return path.resolve(fsImpl.realpathSync(target));
  throw codedError('LIBRARY_IMPORT_REALPATH_REQUIRED', 'library promotion requires physical realpath support');
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sameIdentity(left, right) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function sameSourceSnapshot(left, right) {
  return sameIdentity(left, right)
    && Number(left.size) === Number(right.size)
    && Number(left.mtimeMs) === Number(right.mtimeMs)
    && Number(left.ctimeMs) === Number(right.ctimeMs);
}

function normalizeExpectedSourceIdentity(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object'
    || typeof value.dev !== 'string' || typeof value.ino !== 'string'
    || !Number.isFinite(Number(value.size))
    || !Number.isFinite(Number(value.ctimeMs))
    || !Number.isFinite(Number(value.mtimeMs))) {
    throw codedError('LIBRARY_IMPORT_INVALID_EXPECTATION', 'expected source identity is invalid');
  }
  return Object.freeze({
    dev: value.dev,
    ino: value.ino,
    birthtimeMs: Number(value.birthtimeMs),
    size: Number(value.size),
    ctimeMs: Number(value.ctimeMs),
    mtimeMs: Number(value.mtimeMs),
  });
}

function matchesExpectedSource(identity, stat) {
  return identity.dev === String(stat.dev)
    && identity.ino === String(stat.ino)
    && identity.size === Number(stat.size)
    && identity.ctimeMs === Number(stat.ctimeMs)
    && identity.mtimeMs === Number(stat.mtimeMs)
    && (!Number.isFinite(identity.birthtimeMs)
      || !Number.isFinite(Number(stat.birthtimeMs))
      || identity.birthtimeMs === Number(stat.birthtimeMs));
}

function assertNoLinkedComponents(fsImpl, target, errorCode, message) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  let cursor = parsed.root;
  for (const component of resolved.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const stat = fsImpl.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw codedError(errorCode, message);
  }
}

function captureDirectory(fsImpl, directory, root, errorCode = 'LIBRARY_IMPORT_UNSAFE_WORKSPACE') {
  const stat = fsImpl.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw codedError(errorCode, 'library promotion directory is linked or not a directory');
  }
  const realpath = physicalRealpath(fsImpl, directory);
  if (root && !isWithin(root, realpath)) {
    throw codedError(errorCode, 'library promotion directory escaped its physical Workspace');
  }
  return Object.freeze({ path: directory, realpath, dev: String(stat.dev), ino: String(stat.ino) });
}

function assertDirectoryStable(fsImpl, identity, root) {
  let current;
  try { current = captureDirectory(fsImpl, identity.path, root); }
  catch (error) {
    if (error?.code === 'LIBRARY_IMPORT_UNSAFE_WORKSPACE') throw error;
    throw codedError('LIBRARY_IMPORT_UNSAFE_WORKSPACE', 'library promotion directory identity is unavailable');
  }
  if (current.realpath !== identity.realpath || current.dev !== identity.dev || current.ino !== identity.ino) {
    throw codedError('LIBRARY_IMPORT_UNSAFE_WORKSPACE', 'library promotion directory identity changed');
  }
}

function ensurePhysicalDirectory(fsImpl, directory, workspacePath, workspaceRealpath) {
  const resolved = path.resolve(directory);
  const parsed = path.parse(resolved);
  let cursor = parsed.root;
  for (const component of resolved.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      const existing = fsImpl.lstatSync(cursor);
      if (!existing.isDirectory() || existing.isSymbolicLink()) {
        throw codedError('LIBRARY_IMPORT_UNSAFE_WORKSPACE', 'library promotion layout contains a linked or non-directory component');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try { fsImpl.mkdirSync(cursor, { recursive: false }); }
      catch (mkdirError) { if (mkdirError?.code !== 'EEXIST') throw mkdirError; }
      const created = fsImpl.lstatSync(cursor);
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw codedError('LIBRARY_IMPORT_UNSAFE_WORKSPACE', 'library promotion layout creation was redirected');
      }
    }
    const physical = physicalRealpath(fsImpl, cursor);
    // Ancestors are traversed only to create one component at a time.  Once
    // the lexical Workspace is reached, every physical component must remain
    // beneath its captured realpath; an unrelated/ancestor redirect is unsafe.
    const atOrBelowWorkspace = isWithin(workspacePath, cursor);
    const safePhysical = atOrBelowWorkspace
      ? isWithin(workspaceRealpath, physical)
      : isWithin(physical, workspaceRealpath);
    if (!safePhysical) {
      throw codedError('LIBRARY_IMPORT_UNSAFE_WORKSPACE', 'library promotion layout escaped its physical Workspace');
    }
  }
  return resolved;
}

function fullDigestCollisionName(name, digest) {
  const extension = path.extname(name);
  const stem = path.basename(name, extension);
  return `${stem} (${digest})${extension}`;
}

function decodeBase64(value, maxBytes) {
  const raw = String(value || '').replace(/\s+/g, '');
  // Reject obviously oversized payloads before allocating the decoded Buffer.
  if (raw.length > Math.ceil(maxBytes / 3) * 4 + 8) {
    throw Object.assign(new RangeError(`library import exceeds ${maxBytes} bytes`), {
      code: 'LIBRARY_IMPORT_TOO_LARGE', limit: maxBytes,
    });
  }
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.byteLength > maxBytes) {
    throw Object.assign(new RangeError(`library import exceeds ${maxBytes} bytes`), {
      code: 'LIBRARY_IMPORT_TOO_LARGE', size: bytes.byteLength, limit: maxBytes,
    });
  }
  return bytes;
}

function digestBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function digestFile(filePath, expectedSize) {
  let stat;
  try { stat = fs.statSync(filePath); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.size !== expectedSize) return null;
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, expectedSize)));
  try {
    let offset = 0;
    while (offset < expectedSize) {
      const read = fs.readSync(fd, chunk, 0, Math.min(chunk.length, expectedSize - offset), offset);
      if (!read) return null;
      hash.update(chunk.subarray(0, read));
      offset += read;
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function digestOpenedRegularFile(fsImpl, filePath, expectedSize, chunkBytes) {
  let pathStat;
  try { pathStat = fsImpl.lstatSync(filePath); }
  catch (error) {
    if (error?.code === 'ENOENT') return { exists: false };
    throw error;
  }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw codedError('LIBRARY_IMPORT_UNSAFE_DESTINATION', 'library promotion target is linked or not a regular file');
  }
  if (Number(pathStat.size) !== expectedSize) return { exists: true, matches: false };

  let fd;
  let primaryError = null;
  try {
    const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
    fd = fsImpl.openSync(filePath, Number(fs.constants.O_RDONLY) | noFollow);
    const before = fsImpl.fstatSync(fd);
    if (!before.isFile() || !sameIdentity(pathStat, before) || Number(before.size) !== expectedSize) {
      throw codedError('LIBRARY_IMPORT_UNSAFE_DESTINATION', 'library promotion target identity changed before verification');
    }
    const hash = crypto.createHash('sha256');
    const chunk = Buffer.allocUnsafe(Math.max(1, chunkBytes));
    let offset = 0;
    while (offset < expectedSize) {
      const read = fsImpl.readSync(fd, chunk, 0, Math.min(chunk.length, expectedSize - offset), offset);
      if (!read) {
        throw codedError('LIBRARY_IMPORT_UNSAFE_DESTINATION', 'library promotion target changed during verification');
      }
      hash.update(chunk.subarray(0, read));
      offset += read;
    }
    const extra = fsImpl.readSync(fd, chunk, 0, 1, offset);
    const after = fsImpl.fstatSync(fd);
    const finalPathStat = fsImpl.lstatSync(filePath);
    if (extra !== 0 || !finalPathStat.isFile() || finalPathStat.isSymbolicLink()
      || !sameSourceSnapshot(before, after) || !sameSourceSnapshot(after, finalPathStat)) {
      throw codedError('LIBRARY_IMPORT_UNSAFE_DESTINATION', 'library promotion target changed during verification');
    }
    return { exists: true, matches: true, digest: hash.digest('hex') };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); }
      catch (cleanupError) {
        if (primaryError) attachCleanupError(primaryError, cleanupError);
        else throw cleanupError;
      }
    }
  }
}

function collisionName(name, digest, serial = 0) {
  const extension = path.extname(name);
  const originalStem = path.basename(name, extension);
  const marker = ` (${digest.slice(0, 8)}${serial > 1 ? `-${serial}` : ''})`;
  // Leave headroom below the common 255-code-unit leaf limit.
  const stem = originalStem.slice(0, Math.max(1, 220 - extension.length - marker.length));
  return `${stem}${marker}${extension}`;
}

class LibraryImportService {
  constructor({
    maxBytes = DEFAULT_MAX_BYTES,
    receiptId = () => crypto.randomUUID(),
    fsImpl = fs,
    chunkBytes = STREAM_CHUNK_BYTES,
  } = {}) {
    this.maxBytes = Math.max(1, Number(maxBytes) || DEFAULT_MAX_BYTES);
    this.receiptId = receiptId;
    this.fs = fsImpl;
    this.chunkBytes = Number.isSafeInteger(chunkBytes) && chunkBytes > 0
      ? Math.min(STREAM_CHUNK_BYTES, chunkBytes)
      : STREAM_CHUNK_BYTES;
    this.tails = new Map();
    this.receipts = new Map();
  }

  _withDestinationLock(key, work) {
    const previous = this.tails.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(work);
    this.tails.set(key, task);
    return task.finally(() => {
      if (this.tails.get(key) === task) this.tails.delete(key);
    });
  }

  async materialize({ workspace, name, base64, fingerprint = '' } = {}, ownerId = '') {
    const root = path.resolve(String(workspace || ''));
    if (!workspace || root === path.parse(root).root) {
      throw Object.assign(new TypeError('library import requires a non-root workspace'), {
        code: 'LIBRARY_IMPORT_INVALID_WORKSPACE',
      });
    }
    const leaf = safeLeafName(name);
    const bytes = decodeBase64(base64, this.maxBytes);
    const digest = digestBuffer(bytes);
    const claimed = String(fingerprint || '').trim().toLowerCase();
    if (claimed && !/^[0-9a-f]{8,64}$/.test(claimed)) {
      throw Object.assign(new TypeError('library import fingerprint is invalid'), {
        code: 'LIBRARY_IMPORT_INVALID_FINGERPRINT',
      });
    }
    // Renderer fallback fingerprints are only eight hex digits.  Modern
    // SHA-256 claims (the normal Electron path) are verified at the boundary.
    if (claimed.length >= 16 && !digest.startsWith(claimed)) {
      throw Object.assign(new Error('library import bytes changed after fingerprinting'), {
        code: 'LIBRARY_IMPORT_FINGERPRINT_MISMATCH',
      });
    }

    const directory = path.join(root, '书库');
    const lockKey = `${process.platform === 'win32' ? directory.toLowerCase() : directory}\0${process.platform === 'win32' ? leaf.toLowerCase() : leaf}`;
    return this._withDestinationLock(lockKey, () => {
      fs.mkdirSync(directory, { recursive: true });
      const tempPath = path.join(directory, `.mazz-import-${this.receiptId()}.tmp`);
      let tempExists = false;
      try {
        const fd = fs.openSync(tempPath, 'wx', 0o600);
        tempExists = true;
        try {
          let offset = 0;
          while (offset < bytes.byteLength) offset += fs.writeSync(fd, bytes, offset, bytes.byteLength - offset);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }

        let serial = 0;
        while (serial < 10000) {
          const candidateLeaf = serial === 0 ? leaf : collisionName(leaf, digest, serial);
          const candidate = path.join(directory, candidateLeaf);
          try {
            // linkSync publishes the already-fsynced bytes in one exclusive
            // namespace operation.  COPYFILE_EXCL retains no-overwrite
            // semantics on filesystems without hard-link support.
            try { fs.linkSync(tempPath, candidate); }
            catch (error) {
              if (error?.code === 'EEXIST') throw error;
              if (!['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error?.code)) throw error;
              fs.copyFileSync(tempPath, candidate, COPYFILE_EXCL);
            }
            // Publication already succeeded; failure to remove the staging
            // hard-link must not turn the complete candidate into an orphan.
            try { fs.unlinkSync(tempPath); tempExists = false; } catch {}
            const receiptId = this.receiptId();
            this.receipts.set(receiptId, {
              ownerId: ownerKey(ownerId), path: candidate, digest, size: bytes.byteLength,
            });
            return {
              path: candidate, created: true, receiptId,
              sourceHash: digest.slice(0, 20), size: bytes.byteLength,
            };
          } catch (error) {
            if (error?.code !== 'EEXIST') throw error;
            if (digestFile(candidate, bytes.byteLength) === digest) {
              fs.unlinkSync(tempPath);
              tempExists = false;
              return {
                path: candidate, created: false, receiptId: null, reused: true,
                sourceHash: digest.slice(0, 20), size: bytes.byteLength,
              };
            }
            serial++;
          }
        }
        throw Object.assign(new Error('library import collision space exhausted'), {
          code: 'LIBRARY_IMPORT_COLLISION_EXHAUSTED',
        });
      } finally {
        if (tempExists) { try { fs.unlinkSync(tempPath); } catch {} }
      }
    });
  }

  _fsyncDirectory(directory) {
    let fd;
    let primaryError = null;
    try {
      fd = this.fs.openSync(directory, 'r');
      this.fs.fsyncSync(fd);
    } catch (error) {
      // Node on Windows cannot flush directory handles.  The call is still
      // attempted; ignore only the OS capability error, never media/I/O errors.
      if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)
        && !(process.platform === 'win32' && error?.code === 'EPERM')) primaryError = error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); }
        catch (cleanupError) {
          if (primaryError) attachCleanupError(primaryError, cleanupError);
          else primaryError = cleanupError;
        }
      }
    }
    if (primaryError) throw primaryError;
  }

  _preparePromotionLayout(workspace) {
    const requestedRoot = safeAbsolutePath(workspace, 'workspace');
    assertNoLinkedComponents(
      this.fs,
      requestedRoot,
      'LIBRARY_IMPORT_UNSAFE_WORKSPACE',
      'library promotion Workspace cannot traverse a linked or reparse component',
    );
    const rootStat = this.fs.lstatSync(requestedRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw codedError('LIBRARY_IMPORT_INVALID_WORKSPACE', 'library promotion Workspace is not a physical directory');
    }
    const workspaceRealpath = physicalRealpath(this.fs, requestedRoot);
    if (workspaceRealpath === path.parse(workspaceRealpath).root) {
      throw codedError('LIBRARY_IMPORT_INVALID_WORKSPACE', 'library promotion refuses a filesystem root Workspace');
    }

    const libraryRoot = ensurePhysicalDirectory(
      this.fs, path.join(requestedRoot, '书库'), requestedRoot, workspaceRealpath,
    );
    const resourcesRoot = ensurePhysicalDirectory(
      this.fs, path.join(libraryRoot, '.resources'), requestedRoot, workspaceRealpath,
    );
    const stagingRoot = ensurePhysicalDirectory(
      this.fs, path.join(resourcesRoot, 'staging'), requestedRoot, workspaceRealpath,
    );
    const identities = Object.freeze([
      captureDirectory(this.fs, requestedRoot, workspaceRealpath),
      captureDirectory(this.fs, libraryRoot, workspaceRealpath),
      captureDirectory(this.fs, resourcesRoot, workspaceRealpath),
      captureDirectory(this.fs, stagingRoot, workspaceRealpath),
    ]);
    return Object.freeze({
      workspaceRealpath, libraryRoot, resourcesRoot, stagingRoot, identities,
    });
  }

  _assertPromotionLayout(layout) {
    for (const identity of layout.identities) {
      assertDirectoryStable(this.fs, identity, layout.workspaceRealpath);
    }
  }

  _stageSourcePath(sourcePath, layout, expectedIdentity = null) {
    const source = safeAbsolutePath(sourcePath, 'source');
    assertNoLinkedComponents(
      this.fs,
      source,
      'LIBRARY_IMPORT_UNSAFE_SOURCE',
      'library promotion source cannot traverse a linked or reparse component',
    );
    const sourcePathStat = this.fs.lstatSync(source);
    if (!sourcePathStat.isFile() || sourcePathStat.isSymbolicLink()) {
      throw codedError('LIBRARY_IMPORT_UNSAFE_SOURCE', 'library promotion source is not a physical regular file');
    }
    if (expectedIdentity && !matchesExpectedSource(expectedIdentity, sourcePathStat)) {
      throw codedError('LIBRARY_IMPORT_SOURCE_CHANGED', 'library promotion source differs from the verified source identity');
    }

    this._assertPromotionLayout(layout);
    const temporary = path.join(layout.stagingRoot, `.mazz-promote-${crypto.randomUUID()}.tmp`);
    let sourceFd;
    let stagingFd;
    let stagingExists = false;
    let primaryError = null;
    let result;
    try {
      const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
      sourceFd = this.fs.openSync(source, Number(fs.constants.O_RDONLY) | noFollow);
      const sourceBefore = this.fs.fstatSync(sourceFd);
      if (!sourceBefore.isFile() || !sameIdentity(sourcePathStat, sourceBefore)
        || (expectedIdentity && !matchesExpectedSource(expectedIdentity, sourceBefore))) {
        throw codedError('LIBRARY_IMPORT_SOURCE_CHANGED', 'library promotion source identity changed before copying');
      }

      stagingFd = this.fs.openSync(temporary, 'wx', 0o600);
      stagingExists = true;
      const stagingStat = this.fs.fstatSync(stagingFd);
      if (!stagingStat.isFile()) {
        throw codedError('LIBRARY_IMPORT_UNSAFE_STAGING', 'library promotion staging target is not a regular file');
      }

      const expectedSize = Number(sourceBefore.size);
      const hash = crypto.createHash('sha256');
      const chunk = Buffer.allocUnsafe(this.chunkBytes);
      let offset = 0;
      while (offset < expectedSize) {
        const read = this.fs.readSync(
          sourceFd,
          chunk,
          0,
          Math.min(chunk.length, expectedSize - offset),
          offset,
        );
        if (!read) {
          throw codedError('LIBRARY_IMPORT_SOURCE_CHANGED', 'library promotion source became shorter while copying');
        }
        hash.update(chunk.subarray(0, read));
        let written = 0;
        while (written < read) {
          const count = this.fs.writeSync(stagingFd, chunk, written, read - written, offset + written);
          if (!count) throw codedError('LIBRARY_IMPORT_WRITE_STALLED', 'library promotion staging write made no progress');
          written += count;
        }
        offset += read;
      }
      const extra = this.fs.readSync(sourceFd, chunk, 0, 1, offset);
      const sourceAfter = this.fs.fstatSync(sourceFd);
      const sourcePathAfter = this.fs.lstatSync(source);
      if (extra !== 0 || !sourcePathAfter.isFile() || sourcePathAfter.isSymbolicLink()
        || !sameSourceSnapshot(sourceBefore, sourceAfter)
        || !sameSourceSnapshot(sourceAfter, sourcePathAfter)) {
        throw codedError('LIBRARY_IMPORT_SOURCE_CHANGED', 'library promotion source changed while copying');
      }
      this.fs.fsyncSync(stagingFd);
      result = {
        temporary,
        digest: hash.digest('hex'),
        size: expectedSize,
        source,
      };
    } catch (error) {
      primaryError = error;
    } finally {
      if (stagingFd !== undefined) {
        try { this.fs.closeSync(stagingFd); }
        catch (cleanupError) {
          if (primaryError) attachCleanupError(primaryError, cleanupError);
          else primaryError = cleanupError;
        }
      }
      if (sourceFd !== undefined) {
        try { this.fs.closeSync(sourceFd); }
        catch (cleanupError) {
          if (primaryError) attachCleanupError(primaryError, cleanupError);
          else primaryError = cleanupError;
        }
      }
    }
    if (primaryError) {
      if (stagingExists) {
        try { this.fs.unlinkSync(temporary); stagingExists = false; }
        catch (cleanupError) { attachCleanupError(primaryError, cleanupError); }
      }
      throw primaryError;
    }
    try {
      this._fsyncDirectory(layout.stagingRoot);
    } catch (error) {
      if (stagingExists) {
        try { this.fs.unlinkSync(temporary); stagingExists = false; }
        catch (cleanupError) { attachCleanupError(error, cleanupError); }
      }
      throw error;
    }
    return { ...result, stagingExists };
  }

  _verifyExistingPromotion(candidate, layout, digest, size) {
    this._assertPromotionLayout(layout);
    const physicalParent = physicalRealpath(this.fs, path.dirname(candidate));
    if (physicalParent !== layout.identities[1].realpath) {
      throw codedError('LIBRARY_IMPORT_UNSAFE_DESTINATION', 'library promotion target parent escaped its physical directory');
    }
    const result = digestOpenedRegularFile(this.fs, candidate, size, this.chunkBytes);
    return result.exists && result.matches && result.digest === digest;
  }

  _publishPathStage(stage, layout, requestedLeaf) {
    const publish = candidate => {
      this._assertPromotionLayout(layout);
      try { this.fs.linkSync(stage.temporary, candidate); }
      catch (error) {
        if (error?.code === 'EEXIST') return { exists: true };
        if (HARD_LINK_UNSUPPORTED_CODES.has(error?.code)) {
          throw codedError(
            'LIBRARY_IMPORT_ATOMIC_PUBLICATION_UNSUPPORTED',
            'library promotion requires exclusive hard-link publication on this Workspace filesystem',
            { systemCode: error.code, cause: error },
          );
        }
        throw error;
      }
      const staged = this.fs.lstatSync(stage.temporary);
      const published = this.fs.lstatSync(candidate);
      this._assertPromotionLayout(layout);
      if (!published.isFile() || published.isSymbolicLink() || !sameIdentity(staged, published)) {
        throw codedError('LIBRARY_IMPORT_UNSAFE_DESTINATION', 'library promotion publication identity is unsafe');
      }
      this._fsyncDirectory(layout.libraryRoot);
      return { exists: false, created: true };
    };

    const requestedPath = path.join(layout.libraryRoot, requestedLeaf);
    let selectedPath = requestedPath;
    let outcome = publish(requestedPath);
    if (outcome.exists) {
      if (this._verifyExistingPromotion(requestedPath, layout, stage.digest, stage.size)) {
        return { path: requestedPath, created: false, reused: true };
      }
      const collisionLeaf = safePromotionLeafName(fullDigestCollisionName(requestedLeaf, stage.digest));
      selectedPath = path.join(layout.libraryRoot, collisionLeaf);
      outcome = publish(selectedPath);
      if (outcome.exists) {
        if (this._verifyExistingPromotion(selectedPath, layout, stage.digest, stage.size)) {
          return { path: selectedPath, created: false, reused: true };
        }
        throw codedError(
          'LIBRARY_IMPORT_HASH_PATH_CONFLICT',
          'library promotion deterministic content path is occupied by different bytes',
        );
      }
    }
    return { path: selectedPath, created: true, reused: false };
  }

  /**
   * Formal main-process path promotion.  Unlike the legacy renderer Base64
   * compatibility API above, this path never consults maxBytes: one opened
   * source descriptor is copied in bounded chunks and verified before an
   * exclusive hard-link makes the complete file visible.
   */
  async materializePath({
    workspace,
    name,
    sourcePath,
    expectedSha256 = '',
    expectedSize = null,
    expectedIdentity = null,
  } = {}) {
    const leaf = safePromotionLeafName(name);
    const expectedDigest = expectedSha256 === ''
      ? ''
      : (typeof expectedSha256 === 'string' ? expectedSha256.toLowerCase() : null);
    if (expectedDigest === null || (expectedDigest && !/^[a-f0-9]{64}$/.test(expectedDigest))) {
      throw codedError('LIBRARY_IMPORT_INVALID_EXPECTATION', 'expected source SHA-256 is invalid');
    }
    if (expectedSize !== null && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
      throw codedError('LIBRARY_IMPORT_INVALID_EXPECTATION', 'expected source size is invalid');
    }
    const expectedSourceIdentity = normalizeExpectedSourceIdentity(expectedIdentity);
    const layout = this._preparePromotionLayout(workspace);
    const lockKey = `${process.platform === 'win32' ? layout.libraryRoot.toLowerCase() : layout.libraryRoot}\0${process.platform === 'win32' ? leaf.toLowerCase() : leaf}`;
    return this._withDestinationLock(lockKey, () => {
      const stage = this._stageSourcePath(sourcePath, layout, expectedSourceIdentity);
      let primaryError = null;
      let result;
      try {
        if ((expectedDigest && stage.digest !== expectedDigest)
          || (expectedSize !== null && stage.size !== expectedSize)) {
          throw codedError(
            'LIBRARY_IMPORT_SOURCE_CHANGED',
            'library promotion source no longer matches its verified hash and size',
          );
        }
        result = this._publishPathStage(stage, layout, leaf);
      } catch (error) {
        primaryError = error;
      }

      try {
        this.fs.unlinkSync(stage.temporary);
        stage.stagingExists = false;
        this._fsyncDirectory(layout.stagingRoot);
      } catch (cleanupError) {
        if (primaryError) attachCleanupError(primaryError, cleanupError);
        else primaryError = cleanupError;
      }
      if (primaryError) throw primaryError;

      return {
        path: result.path,
        finalPath: result.path,
        created: result.created,
        reused: result.reused,
        sourceHash: stage.digest,
        sha256: stage.digest,
        size: stage.size,
      };
    });
  }

  async finalize({ receiptId, keep = false } = {}, ownerId = '') {
    const id = String(receiptId || '');
    if (!id) return { ok: true, owned: false, kept: keep === true };
    const receipt = this.receipts.get(id);
    if (!receipt) return { ok: false, reason: 'unknown-receipt' };
    if (receipt.ownerId !== ownerKey(ownerId)) return { ok: false, reason: 'owner-mismatch' };
    if (keep === true) {
      this.receipts.delete(id);
      return { ok: true, owned: true, kept: true, path: receipt.path };
    }

    // A receipt owns exactly the bytes it published.  If another actor has
    // replaced/modified the path, fail closed instead of deleting their file.
    const currentDigest = digestFile(receipt.path, receipt.size);
    if (currentDigest !== receipt.digest) {
      this.receipts.delete(id);
      return { ok: false, owned: true, deleted: false, reason: currentDigest ? 'content-changed' : 'missing' };
    }
    fs.unlinkSync(receipt.path);
    this.receipts.delete(id);
    return { ok: true, owned: true, deleted: true, path: receipt.path };
  }
}

module.exports = LibraryImportService;
module.exports.DEFAULT_MAX_BYTES = DEFAULT_MAX_BYTES;
module.exports._forTests = { collisionName, digestFile, safeLeafName };
