// main/library-import-service.js
//
// Library imports are coordinated in the main process because renderer-local
// queues cannot serialize two BrowserWindows.  A complete temporary file is
// published with an exclusive hard-link (COPYFILE_EXCL fallback), so a
// same-name concurrent import can never overwrite or observe a partial winner.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const COPYFILE_EXCL = fs.constants.COPYFILE_EXCL;

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

function collisionName(name, digest, serial = 0) {
  const extension = path.extname(name);
  const originalStem = path.basename(name, extension);
  const marker = ` (${digest.slice(0, 8)}${serial > 1 ? `-${serial}` : ''})`;
  // Leave headroom below the common 255-code-unit leaf limit.
  const stem = originalStem.slice(0, Math.max(1, 220 - extension.length - marker.length));
  return `${stem}${marker}${extension}`;
}

class LibraryImportService {
  constructor({ maxBytes = DEFAULT_MAX_BYTES, receiptId = () => crypto.randomUUID() } = {}) {
    this.maxBytes = Math.max(1, Number(maxBytes) || DEFAULT_MAX_BYTES);
    this.receiptId = receiptId;
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
