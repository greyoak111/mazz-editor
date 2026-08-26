'use strict';

// W93B application-owned acquisition coordinator.  One instance is intended
// to live under Electron's single-instance main process.  It owns Workspace
// Stores and active transports; renderers receive only projections/tokens.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contract = require('./library-resource-contract');
const { captureDomainEvent } = require('./foundation/domain-event-capture');
const LibraryAcquisitionStoreModule = require('./library-acquisition-store');
const LibraryAcquisitionStore = LibraryAcquisitionStoreModule.LibraryAcquisitionStore
  || LibraryAcquisitionStoreModule;
const LibraryHttpAcquisitionModule = require('./library-http-acquisition');
const LibraryHttpAcquisition = LibraryHttpAcquisitionModule.LibraryHttpAcquisition
  || LibraryHttpAcquisitionModule;

function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function attachCleanupError(primary, cleanup) {
  if (!primary || !cleanup) return;
  if (!primary.cleanupError) primary.cleanupError = cleanup;
  if (!Array.isArray(primary.cleanupErrors)) primary.cleanupErrors = [];
  primary.cleanupErrors.push(cleanup);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function stagingIdentity(stat) {
  return Object.freeze({
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeMs: Number(stat.birthtimeMs),
    ctimeMs: Number(stat.ctimeMs),
    mtimeMs: Number(stat.mtimeMs),
    size: Number(stat.size),
  });
}

function sameStagingOwner(identity, stat) {
  return Boolean(identity && stat
    && identity.dev === String(stat.dev)
    && identity.ino === String(stat.ino)
    && (!Number.isFinite(identity.birthtimeMs)
      || !Number.isFinite(Number(stat.birthtimeMs))
      || identity.birthtimeMs === Number(stat.birthtimeMs)));
}

function sameStableStaging(left, right) {
  return sameStagingOwner(left, right)
    && left.size === Number(right.size)
    && left.ctimeMs === Number(right.ctimeMs)
    && left.mtimeMs === Number(right.mtimeMs);
}

function promotionLeaf(title, format, contentSha256) {
  const digest = contract.normalizeSha256(contentSha256, 'promotion content sha256');
  const normalized = (typeof title === 'string' ? title : '').normalize('NFC');
  let stem = normalized
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!stem || /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/i.test(stem)) stem = 'Library resource';
  const suffix = ` (${digest}).${format}`;
  // A filename is only a display projection.  Fit it to a conservative native
  // leaf byte budget without rejecting or truncating the resource itself; the
  // full content SHA remains the Blob identity and promoter collision key.
  const characters = Array.from(stem);
  while (characters.length > 1 && Buffer.byteLength(`${characters.join('')}${suffix}`, 'utf8') > 220) characters.pop();
  return `${characters.join('')}${suffix}`;
}

function safeInternalId(value, label) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..'
    || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(value)) {
    throw codedError('LIBRARY_ACQUISITION_INVALID_ID', `${label} is not a safe acquisition identity`);
  }
  return value;
}

function toJobError(error, fallbackCode) {
  let code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_.-]*$/.test(error.code)
    ? error.code
    : fallbackCode;
  if (!/^[A-Z]/.test(code)) code = fallbackCode;
  const messages = {
    LIBRARY_ACQUISITION_ABORTED: '资源取得已中断，可由明确操作继续',
    LIBRARY_HTTP_SSRF_BLOCKED: '资源地址未通过公共网络安全检查',
    LIBRARY_HTTP_PREMATURE_EOF: '远端响应不完整，已保留可恢复进度',
    LIBRARY_HTTP_LENGTH_MISMATCH: '远端响应长度不一致，已保留可恢复进度',
    LIBRARY_HTTP_TRANSFER_MISMATCH: '暂存事实不一致，需要隔离后重新取得',
    LIBRARY_HTTP_TRANSFER_CORRUPT: '暂存记录损坏，需要隔离后重新取得',
    LIBRARY_ACQUISITION_INTEGRITY_FAILED: '资源完整性校验失败，文件已隔离',
    LIBRARY_ACQUISITION_FORMAT_MISMATCH: '资源格式校验失败，文件已隔离',
    LIBRARY_ACQUISITION_CONTAINER_UNSAFE: '资源容器未通过安全检查，文件已隔离',
    LIBRARY_ACQUISITION_PROMOTION_FAILED: '资源升格失败，可从已验证事实恢复',
  };
  return Object.freeze({
    code,
    message: messages[code] || '资源取得失败，已保留可恢复事实',
  });
}

function publicError(error, fallbackCode) {
  const receipt = toJobError(error, fallbackCode);
  // This object can cross the IPC failure boundary.  Do not attach the raw
  // system error: Node fs/network causes commonly contain absolute paths or
  // request URLs.  Durable diagnostics retain only the same stable receipt.
  return codedError(receipt.code, receipt.message);
}

async function digestFile(filePath, fsImpl = fs) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  const stream = fsImpl.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest('hex'), size };
}

async function assertTextPayload(filePath, fsImpl = fs, signal = null) {
  const stream = fsImpl.createReadStream(filePath);
  for await (const chunk of stream) {
    if (signal?.aborted) {
      stream.destroy();
      throw codedError('LIBRARY_ACQUISITION_ABORTED', 'the acquisition was interrupted');
    }
    if (chunk.includes(0)) {
      throw codedError('LIBRARY_ACQUISITION_FORMAT_MISMATCH', 'TXT payload contains binary NUL bytes');
    }
  }
}

function readExact(fsImpl, fd, length, position) {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(position) || position < 0) {
    throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive offsets are invalid');
  }
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const count = fsImpl.readSync(fd, buffer, read, length - read, position + read);
    if (!count) throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive structure ended unexpectedly');
    read += count;
  }
  return buffer;
}

function safeBigintNumber(value, label) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', `${label} cannot be represented safely`);
  }
  return Number(value);
}

function zip64Extra(extra, needs) {
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const length = extra.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + length > extra.length) {
      throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive extra field is truncated');
    }
    if (id === 0x0001) {
      const value = extra.subarray(cursor, cursor + length);
      let offset = 0;
      const take64 = label => {
        if (offset + 8 > value.length) throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', `ZIP64 ${label} is missing`);
        const result = safeBigintNumber(value.readBigUInt64LE(offset), `ZIP64 ${label}`);
        offset += 8;
        return result;
      };
      return {
        ...(needs.uncompressed ? { uncompressed: take64('uncompressed size') } : {}),
        ...(needs.compressed ? { compressed: take64('compressed size') } : {}),
        ...(needs.localOffset ? { localOffset: take64('local header offset') } : {}),
      };
    }
    cursor += length;
  }
  throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'required ZIP64 metadata is missing');
}

function inspectZipArchive(filePath, format, fsImpl = fs) {
  const stat = fsImpl.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 22) {
    throw codedError('LIBRARY_ACQUISITION_FORMAT_MISMATCH', 'resource is not a regular ZIP container');
  }
  let fd;
  try {
    fd = fsImpl.openSync(filePath, 'r');
    // EOCD comments are protocol-limited to 65,535 bytes.  This tail window is
    // a ZIP structural bound, not a limit on book size or archive entry count.
    const tailLength = Math.min(stat.size, 65_557);
    const tailPosition = stat.size - tailLength;
    const tail = readExact(fsImpl, fd, tailLength, tailPosition);
    let eocdIndex = -1;
    for (let cursor = tail.length - 22; cursor >= 0; cursor -= 1) {
      if (tail.readUInt32LE(cursor) === 0x06054b50) {
        const commentLength = tail.readUInt16LE(cursor + 20);
        if (cursor + 22 + commentLength === tail.length) {
          eocdIndex = cursor;
          break;
        }
      }
    }
    if (eocdIndex < 0) throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive end record is missing');
    const disk = tail.readUInt16LE(eocdIndex + 4);
    const centralDisk = tail.readUInt16LE(eocdIndex + 6);
    if (disk !== 0 || centralDisk !== 0) {
      throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'multi-disk archives are not safe acquisition assets');
    }
    let entryCount = tail.readUInt16LE(eocdIndex + 10);
    let centralSize = tail.readUInt32LE(eocdIndex + 12);
    let centralOffset = tail.readUInt32LE(eocdIndex + 16);
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      const absoluteEocd = tailPosition + eocdIndex;
      if (absoluteEocd < 20) throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'ZIP64 locator is missing');
      const locator = readExact(fsImpl, fd, 20, absoluteEocd - 20);
      if (locator.readUInt32LE(0) !== 0x07064b50) {
        throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'ZIP64 locator is invalid');
      }
      const zip64Offset = safeBigintNumber(locator.readBigUInt64LE(8), 'ZIP64 record offset');
      const record = readExact(fsImpl, fd, 56, zip64Offset);
      if (record.readUInt32LE(0) !== 0x06064b50 || record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0) {
        throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'ZIP64 end record is invalid');
      }
      entryCount = safeBigintNumber(record.readBigUInt64LE(32), 'ZIP64 entry count');
      centralSize = safeBigintNumber(record.readBigUInt64LE(40), 'ZIP64 central directory size');
      centralOffset = safeBigintNumber(record.readBigUInt64LE(48), 'ZIP64 central directory offset');
    }
    if (!entryCount || centralOffset + centralSize > stat.size) {
      throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive central directory is inconsistent');
    }
    let cursor = centralOffset;
    const centralEnd = centralOffset + centralSize;
    let compressedTotal = 0n;
    let uncompressedTotal = 0n;
    let hasComicImage = false;
    let epubMimeEntry = null;
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > centralEnd) throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive entry header escapes the central directory');
      const header = readExact(fsImpl, fd, 46, cursor);
      if (header.readUInt32LE(0) !== 0x02014b50) {
        throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive central entry signature is invalid');
      }
      const flags = header.readUInt16LE(8);
      const method = header.readUInt16LE(10);
      const externalAttributes = header.readUInt32LE(38);
      let compressed = header.readUInt32LE(20);
      let uncompressed = header.readUInt32LE(24);
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      let localOffset = header.readUInt32LE(42);
      const variableLength = nameLength + extraLength + commentLength;
      if (cursor + 46 + variableLength > centralEnd) {
        throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive entry metadata is truncated');
      }
      const variable = readExact(fsImpl, fd, variableLength, cursor + 46);
      const nameBytes = variable.subarray(0, nameLength);
      const extra = variable.subarray(nameLength, nameLength + extraLength);
      const needs = {
        uncompressed: uncompressed === 0xffffffff,
        compressed: compressed === 0xffffffff,
        localOffset: localOffset === 0xffffffff,
      };
      if (needs.uncompressed || needs.compressed || needs.localOffset) {
        const values = zip64Extra(extra, needs);
        if (needs.uncompressed) uncompressed = values.uncompressed;
        if (needs.compressed) compressed = values.compressed;
        if (needs.localOffset) localOffset = values.localOffset;
      }
      const name = nameBytes.toString((flags & 0x0800) ? 'utf8' : 'latin1');
      const segments = name.replace(/\\/g, '/').split('/').filter(Boolean);
      if (!name || name.includes('\0') || name.includes('\\') || /^\//.test(name)
        || /^[A-Za-z]:/.test(name) || segments.some(segment => segment === '.' || segment === '..'
          || segment.includes(':') || /[. ]$/.test(segment)
          || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment))) {
        throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive entry path is unsafe');
      }
      const unixFileType = (externalAttributes >>> 16) & 0xf000;
      if (unixFileType === 0xa000) {
        throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive symbolic-link entries are unsafe');
      }
      if ((flags & 0x0001) !== 0) {
        throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'encrypted archive entries are not accepted as readable assets');
      }
      compressedTotal += BigInt(compressed);
      uncompressedTotal += BigInt(uncompressed);
      // A ratio budget protects downstream extraction resources.  It is based
      // on expansion behaviour, never on the absolute size of the book.
      if (uncompressedTotal > (compressedTotal * 10_000n) + 1_048_576n) {
        throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive expansion ratio exceeds the safe extraction budget');
      }
      if (/\.(?:jpe?g|png|gif|webp|avif|bmp)$/i.test(name)) hasComicImage = true;
      if (name === 'mimetype') epubMimeEntry = { method, compressed, uncompressed, localOffset };
      cursor += 46 + variableLength;
    }
    if (cursor !== centralEnd) throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'archive central directory has trailing structural data');
    if (format === 'cbz' && !hasComicImage) {
      throw codedError('LIBRARY_ACQUISITION_FORMAT_MISMATCH', 'CBZ archive contains no recognized image entry');
    }
    if (format === 'epub') {
      if (!epubMimeEntry || epubMimeEntry.method !== 0 || epubMimeEntry.uncompressed !== 20) {
        throw codedError('LIBRARY_ACQUISITION_FORMAT_MISMATCH', 'EPUB mimetype entry is missing or compressed');
      }
      const local = readExact(fsImpl, fd, 30, epubMimeEntry.localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50) {
        throw codedError('LIBRARY_ACQUISITION_CONTAINER_UNSAFE', 'EPUB mimetype local header is invalid');
      }
      const dataOffset = epubMimeEntry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const mime = readExact(fsImpl, fd, 20, dataOffset).toString('ascii');
      if (mime !== 'application/epub+zip') {
        throw codedError('LIBRARY_ACQUISITION_FORMAT_MISMATCH', 'EPUB mimetype value is invalid');
      }
    }
  } finally {
    if (fd !== undefined) fsImpl.closeSync(fd);
  }
}

function inspectMagic(filePath, format, fsImpl = fs) {
  const stat = fsImpl.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw codedError('LIBRARY_ACQUISITION_FORMAT_MISMATCH', 'staging payload is not a regular file');
  }
  let fd;
  try {
    fd = fsImpl.openSync(filePath, 'r');
    const length = Math.min(stat.size, 4096);
    const head = Buffer.alloc(length);
    if (length) fsImpl.readSync(fd, head, 0, length, 0);
    if (format === 'pdf' && (head.length < 5 || head.subarray(0, 5).toString('ascii') !== '%PDF-')) {
      throw codedError('LIBRARY_ACQUISITION_FORMAT_MISMATCH', 'PDF signature is missing');
    }
    if (format === 'txt' && head.includes(0)) {
      throw codedError('LIBRARY_ACQUISITION_FORMAT_MISMATCH', 'TXT sample contains binary NUL bytes');
    }
    if (['mobi', 'azw3'].includes(format)
      && (head.length < 68 || head.subarray(60, 68).toString('ascii') !== 'BOOKMOBI')) {
      throw codedError('LIBRARY_ACQUISITION_FORMAT_MISMATCH', 'Mobipocket signature is missing');
    }
    if (['epub', 'cbz'].includes(format)
      && (head.length < 4 || head.readUInt32LE(0) !== 0x04034b50)) {
      throw codedError('LIBRARY_ACQUISITION_FORMAT_MISMATCH', 'ZIP container signature is missing');
    }
  } finally {
    if (fd !== undefined) fsImpl.closeSync(fd);
  }
  if (['epub', 'cbz'].includes(format)) inspectZipArchive(filePath, format, fsImpl);
}

async function verifyPayload({ filePath, format, declaredChecksum = '', expectedSize = null, fsImpl = fs, signal = null }) {
  if (signal?.aborted) throw codedError('LIBRARY_ACQUISITION_ABORTED', 'the acquisition was interrupted');
  const hash = crypto.createHash('sha256');
  let size = 0;
  const readStream = fsImpl.createReadStream(filePath);
  for await (const chunk of readStream) {
    if (signal?.aborted) {
      readStream.destroy();
      throw codedError('LIBRARY_ACQUISITION_ABORTED', 'the acquisition was interrupted');
    }
    hash.update(chunk);
    size += chunk.length;
  }
  const result = { sha256: hash.digest('hex'), size };
  try {
    if (signal?.aborted) throw codedError('LIBRARY_ACQUISITION_ABORTED', 'the acquisition was interrupted');
    if (expectedSize !== null && result.size !== expectedSize) {
      throw codedError('LIBRARY_ACQUISITION_INTEGRITY_FAILED', 'resource size does not match its declared complete length');
    }
    if (declaredChecksum) {
      if (!declaredChecksum.startsWith('sha256:')) {
        throw codedError('LIBRARY_ACQUISITION_INTEGRITY_FAILED', 'the declared checksum algorithm is not verifiable in this acquisition path');
      }
      if (declaredChecksum.slice(7) !== result.sha256) {
        throw codedError('LIBRARY_ACQUISITION_INTEGRITY_FAILED', 'resource checksum does not match');
      }
    }
    inspectMagic(filePath, format, fsImpl);
    if (format === 'txt') await assertTextPayload(filePath, fsImpl, signal);
    if (signal?.aborted) throw codedError('LIBRARY_ACQUISITION_ABORTED', 'the acquisition was interrupted');
    return Object.freeze(result);
  } catch (error) {
    error.verification = Object.freeze(result);
    throw error;
  }
}

class LibraryAcquisitionService {
  constructor({
    store = null,
    storeFactory = options => new LibraryAcquisitionStore(options),
    httpAcquisition = null,
    httpFactory = null,
    torrentTransport = null,
    requester = null,
    resolver = null,
    promoter = null,
    fsImpl = fs,
    now = () => new Date(),
    randomId = () => crypto.randomUUID(),
    resourceLedger = null,
    singleInstanceOwnerCapability = null,
    onInboxReady = null,
    eventService = null,
  } = {}) {
    if (typeof storeFactory !== 'function') {
      throw codedError('LIBRARY_ACQUISITION_STORE_FACTORY_REQUIRED', 'acquisition service requires a Store factory');
    }
    this.storeFactory = storeFactory;
    this.httpFactory = httpFactory || (() => httpAcquisition || new LibraryHttpAcquisition({
      requester, resolver, fsImpl, now, randomId,
    }));
    this.promoter = promoter;
    this.torrentTransport = torrentTransport;
    this.fs = fsImpl;
    this.now = now;
    this.randomId = randomId;
    this.resourceLedger = resourceLedger;
    this.singleInstanceOwnerCapability = singleInstanceOwnerCapability;
    this.onInboxReady = typeof onInboxReady === 'function' ? onInboxReady : null;
    this.eventService = eventService;
    this.workspaces = new Map();
    this.workspacePaths = new Map();
    // A Workspace that was not current during process startup can still carry
    // active durable Jobs from the previous process. Its first main-process
    // exposure must therefore join one offline repair/recovery flight. Keep a
    // fulfilled entry as the per-process READY fact; delete only failures so
    // an explicit later access may retry instead of exposing stale state.
    this.workspaceRecovery = new Map();
    this.active = new Map();
    this.browserDownloads = new Map();
    this.browserDownloadByJob = new Map();
    this.durableCompletionReceipts = new WeakMap();
    this.accepting = true;
    if (store) this._registerStore(store);
  }

  _markDurableCompletion(error, job) {
    if (!error || (typeof error !== 'object' && typeof error !== 'function') || !job) return error;
    const receipt = Object.freeze({
      workspaceIdentity: job.workspaceIdentity,
      jobId: job.jobId,
      intentId: job.intentId,
      candidateId: job.candidateId,
      candidateFingerprint: job.candidateFingerprint,
      offerId: job.offerId,
      revision: job.revision,
      state: job.state,
      retryFrom: job.retryFrom,
      errorCode: typeof job.error?.code === 'string' ? job.error.code : '',
    });
    this.durableCompletionReceipts.set(error, receipt);
    return error;
  }

  _publicError(error, fallbackCode) {
    const sanitized = publicError(error, fallbackCode);
    const receipt = error && (typeof error === 'object' || typeof error === 'function')
      ? this.durableCompletionReceipts.get(error)
      : null;
    if (receipt) this.durableCompletionReceipts.set(sanitized, receipt);
    return sanitized;
  }

  getDurableCompletionReceipt(error) {
    if (!error || (typeof error !== 'object' && typeof error !== 'function')) return null;
    return this.durableCompletionReceipts.get(error) || null;
  }

  _event(job, outcome, action = 'transport') {
    if (!job) return { recorded: false, reason: 'NO_JOB' };
    return captureDomainEvent(this.eventService, {
      domain: 'library',
      action,
      outcome,
      actorType: 'system',
      subjectId: job.jobId,
      objectId: job.candidateId || '',
      contextId: job.workspaceIdentity || '',
      idempotencyKey: `w94e:library:${action}:${outcome}:${job.workspaceIdentity}:${job.jobId}:${job.revision}`,
    });
  }

  _registerStore(store) {
    if (!store || typeof store.listJobs !== 'function' || typeof store.listInboxReceipts !== 'function'
      || typeof store.workspaceIdentity !== 'string' || typeof store.workspacePath !== 'string') {
      throw codedError('LIBRARY_ACQUISITION_INVALID_STORE', 'acquisition service requires a W93A Workspace Store');
    }
    const expectedIdentity = contract.deriveWorkspaceIdentity(store.workspacePath);
    if (store.workspaceIdentity !== expectedIdentity) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_STORE', 'Store Workspace identity is not canonical');
    }
    const existing = this.workspaces.get(store.workspaceIdentity);
    if (existing && existing.store !== store) return existing;
    const context = Object.freeze({
      store,
      http: this.httpFactory({ store }),
      workspaceIdentity: store.workspaceIdentity,
      workspacePath: store.workspacePath,
      workspaceToken: `workspace-token-${this.randomId()}`,
    });
    if (!context.http || typeof context.http.download !== 'function') {
      throw codedError('LIBRARY_ACQUISITION_HTTP_REQUIRED', 'acquisition service requires an HTTP transport implementation');
    }
    this.workspaces.set(context.workspaceIdentity, context);
    this.workspacePaths.set(path.resolve(context.workspacePath), context.workspaceIdentity);
    return context;
  }

  openWorkspace(workspacePath) {
    if (typeof workspacePath !== 'string' || !workspacePath) {
      throw codedError('LIBRARY_ACQUISITION_WORKSPACE_REQUIRED', 'opening acquisition state requires a Workspace path');
    }
    const requested = path.resolve(workspacePath);
    const knownIdentity = this.workspacePaths.get(requested);
    const context = knownIdentity ? this.workspaces.get(knownIdentity) : this._registerStore(this.storeFactory({ workspacePath: requested }));
    return Object.freeze({
      workspaceIdentity: context.workspaceIdentity,
      workspaceToken: context.workspaceToken,
    });
  }

  ensureWorkspaceRecovery(selector, {
    repairOrphanLocks = true,
    recoverAfterRestart = true,
  } = {}) {
    if (!this.accepting) {
      return Promise.reject(codedError(
        'LIBRARY_ACQUISITION_SHUTTING_DOWN',
        'acquisition coordinator is stopping',
      ));
    }
    let opened = selector;
    if (typeof selector === 'string' && !this.workspaces.has(selector)) {
      opened = this.openWorkspace(selector);
    } else if (isPlainRecord(selector) && typeof selector.workspacePath === 'string'
      && typeof selector.workspaceIdentity !== 'string') {
      opened = this.openWorkspace(selector.workspacePath);
    }
    const context = this._workspace(opened);
    const existing = this.workspaceRecovery.get(context.workspaceIdentity);
    if (existing) return existing.promise;

    const entry = { promise: null, settled: false };
    entry.promise = Promise.resolve().then(async () => {
      const actions = [];
      if (repairOrphanLocks) {
        actions.push(Object.freeze({
          action: 'LOCK_REPAIR',
          result: await this.repairOrphanLocks(context.workspaceIdentity),
        }));
      }
      if (recoverAfterRestart) {
        actions.push(...await this.recoverAfterRestart(context.workspaceIdentity));
      } else {
        actions.push(...await this.reconcileWorkspace(context.workspaceIdentity));
      }
      entry.settled = true;
      return Object.freeze({
        workspaceIdentity: context.workspaceIdentity,
        workspaceToken: context.workspaceToken,
        actions: Object.freeze(actions),
      });
    }).catch(error => {
      if (this.workspaceRecovery.get(context.workspaceIdentity) === entry) {
        this.workspaceRecovery.delete(context.workspaceIdentity);
      }
      throw error;
    });
    this.workspaceRecovery.set(context.workspaceIdentity, entry);
    return entry.promise;
  }

  _workspace(selector, { tokenRequired = false } = {}) {
    const workspaceIdentity = typeof selector === 'string' ? selector : selector?.workspaceIdentity;
    if (typeof workspaceIdentity !== 'string' || !workspaceIdentity) {
      throw codedError('LIBRARY_ACQUISITION_WORKSPACE_REQUIRED', 'a canonical Workspace identity is required');
    }
    const context = this.workspaces.get(workspaceIdentity);
    if (!context) throw codedError('LIBRARY_ACQUISITION_WORKSPACE_NOT_OPEN', 'the acquisition Workspace is not open');
    if (tokenRequired && selector?.workspaceToken !== context.workspaceToken) {
      throw codedError('LIBRARY_ACQUISITION_WORKSPACE_TOKEN_INVALID', 'the Inbox capability does not belong to this Workspace');
    }
    return context;
  }

  listJobs(selector) {
    return this._workspace(selector).store.listJobs();
  }

  listInbox(selector = {}, options = {}) {
    if (isPlainRecord(selector) && typeof selector.workspacePath === 'string') {
      const opened = this.openWorkspace(selector.workspacePath);
      const context = this._workspace(opened);
      const state = selector.state ?? options.state ?? 'pending';
      return Object.freeze({
        ...opened,
        receipts: Object.freeze(context.store.listInboxReceipts({ state })),
      });
    }
    const context = this._workspace(selector, {
      tokenRequired: isPlainRecord(selector) && Object.prototype.hasOwnProperty.call(selector, 'workspaceToken'),
    });
    const state = (isPlainRecord(selector) ? selector.state : undefined) ?? options.state ?? 'pending';
    return Object.freeze({
      workspaceIdentity: context.workspaceIdentity,
      workspaceToken: context.workspaceToken,
      receipts: Object.freeze(context.store.listInboxReceipts({ state })),
    });
  }

  createJob(selector, input, { candidate } = {}) {
    const context = this._workspace(selector, { tokenRequired: isPlainRecord(selector) && 'workspaceToken' in selector });
    return context.store.createJob(input, { candidate });
  }

  repairOrphanLocks(selector) {
    if (!this.singleInstanceOwnerCapability) {
      throw codedError('LIBRARY_ACQUISITION_SINGLE_INSTANCE_OWNER_REQUIRED', 'service has no single-instance repair authority');
    }
    return this._workspace(selector).store.repairOrphanLocks(this.singleInstanceOwnerCapability);
  }

  _parseStartArgs(selector, jobId, options) {
    if (options === undefined && isPlainRecord(jobId)) {
      options = jobId;
      jobId = selector;
      if (this.workspaces.size !== 1) {
        throw codedError('LIBRARY_ACQUISITION_WORKSPACE_REQUIRED', 'Job start requires an explicit Workspace identity');
      }
      selector = this.workspaces.keys().next().value;
    }
    return { context: this._workspace(selector), jobId: safeInternalId(jobId, 'jobId'), options: options || {} };
  }

  _assertStart(context, jobId, options, requiredTransport = 'https') {
    if (!this.accepting) throw codedError('LIBRARY_ACQUISITION_SHUTTING_DOWN', 'acquisition coordinator is stopping');
    if (!Number.isSafeInteger(options.expectedRevision)) {
      throw codedError('LIBRARY_ACQUISITION_EXPECTED_REVISION_REQUIRED', 'starting a Job requires its expected revision');
    }
    const job = context.store.getJob(jobId);
    if (!job) throw codedError('LIBRARY_ACQUISITION_JOB_NOT_FOUND', 'acquisition Job does not exist');
    if (job.revision !== options.expectedRevision) {
      throw codedError('LIBRARY_ACQUISITION_REVISION_CONFLICT', 'acquisition Job revision changed');
    }
    if (job.workspaceIdentity !== context.workspaceIdentity || path.resolve(job.workspacePath) !== path.resolve(context.workspacePath)) {
      throw codedError('LIBRARY_ACQUISITION_WORKSPACE_MISMATCH', 'acquisition Job belongs to another Workspace');
    }
    let candidate;
    let fingerprint;
    try {
      candidate = contract.normalizeCandidate(options.candidate);
      fingerprint = contract.deriveCandidateFingerprint(candidate);
    } catch (error) {
      throw codedError(
        'LIBRARY_ACQUISITION_CANDIDATE_INVALID',
        'Candidate did not pass the frozen resource contract',
      );
    }
    if (candidate.candidateId !== job.candidateId || fingerprint !== job.candidateFingerprint) {
      throw codedError('LIBRARY_ACQUISITION_CANDIDATE_MISMATCH', 'Candidate snapshot does not match the durable Job');
    }
    const offer = candidate.offers.find(item => item.offerId === job.offerId);
    if (!offer || offer.providerId !== job.providerId || offer.transport !== job.transport
      || contract.deriveTransportIdentity(offer) !== job.transportIdentity) {
      throw codedError('LIBRARY_ACQUISITION_OFFER_MISMATCH', 'Candidate Offer does not match the durable Job');
    }
    if (offer.transport !== requiredTransport
      || (requiredTransport === 'https' && !offer.sourceUrl)
      || (requiredTransport === 'magnet' && !offer.infoHash)) {
      throw codedError(
        'LIBRARY_ACQUISITION_TRANSPORT_OFFER_REQUIRED',
        `acquisition Job requires an explicit ${requiredTransport} Offer`,
      );
    }
    if (!job.rightsReceipt || !contract.PASSING_RIGHTS_STATUSES.includes(job.rightsReceipt.decision)
      || job.rightsStatus === 'restricted') {
      throw codedError('LIBRARY_ACQUISITION_RIGHTS_REQUIRED', 'Job has no passing immutable Rights Receipt');
    }
    const allowed = job.state === 'queued'
      || (job.state === 'paused' && job.retryFrom === 'downloading')
      || (job.state === 'failed' && job.retryFrom === 'downloading');
    if (!allowed) {
      if (contract.isTerminalJobState(job.state)) return { job, candidate, offer, terminal: true };
      throw codedError('LIBRARY_ACQUISITION_INVALID_STATE', 'Job is not ready for HTTP transport');
    }
    if (!this.promoter || !(typeof this.promoter === 'function'
      || typeof this.promoter.promote === 'function'
      || typeof this.promoter.promotePath === 'function'
      || typeof this.promoter.materializePath === 'function')) {
      throw codedError('LIBRARY_ACQUISITION_PROMOTER_REQUIRED', 'HTTP acquisition requires an injected atomic promoter');
    }
    return { job, candidate, offer, terminal: false };
  }

  startHttp(selector, jobId, options) {
    const parsed = this._parseStartArgs(selector, jobId, options);
    const { context } = parsed;
    const intent = this._assertStart(context, parsed.jobId, parsed.options);
    if (intent.terminal) return Promise.resolve(intent.job);
    const activeKey = `${context.workspaceIdentity}:${parsed.jobId}`;
    if (this.active.has(activeKey) || this.browserDownloadByJob.has(activeKey)) {
      throw codedError('LIBRARY_ACQUISITION_BUSY', 'this acquisition Job already has an active owner');
    }
    const controller = new AbortController();
    const record = {
      key: activeKey,
      context,
      jobId: parsed.jobId,
      candidate: intent.candidate,
      offer: intent.offer,
      controller,
      requested: null,
      transport: 'https',
      phase: 'starting',
      resourceKey: null,
      promise: null,
    };
    record.resourceKey = this.resourceLedger?.register?.({
      type: 'library-acquisition',
      id: parsed.jobId,
      owner: `library-acquisition:${context.workspaceIdentity}`,
      state: 'starting',
      meta: { transport: 'https' },
    }) || null;
    this.active.set(activeKey, record);
    record.promise = this._executeHttp(record, intent.job)
      .finally(() => {
        this.active.delete(activeKey);
        if (record.resourceKey) {
          this.resourceLedger?.release?.(record.resourceKey, {
            reason: record.requested || 'settled',
            state: 'released',
          });
          record.resourceKey = null;
        }
      });
    return record.promise;
  }

  resumeHttp(selector, jobId, options) {
    return this.startHttp(selector, jobId, options);
  }

  finalizeSelection(selector, jobId, { expectedRevision, candidate, selectedFiles } = {}) {
    const context = this._workspace(selector);
    const id = safeInternalId(jobId, 'jobId');
    if (!Number.isSafeInteger(expectedRevision)) {
      throw codedError('LIBRARY_ACQUISITION_EXPECTED_REVISION_REQUIRED', 'selection requires its expected revision');
    }
    let normalizedCandidate;
    try { normalizedCandidate = contract.normalizeCandidate(candidate); }
    catch { throw codedError('LIBRARY_ACQUISITION_CANDIDATE_INVALID', 'selection Candidate is invalid'); }
    let normalizedFiles;
    try { normalizedFiles = contract.normalizeSelectedFiles(selectedFiles); }
    catch { throw codedError('LIBRARY_ACQUISITION_SELECTION_INVALID', 'selection contains an unsafe file path'); }
    if (normalizedFiles.length !== 1) {
      throw codedError('LIBRARY_ACQUISITION_SELECTION_INVALID', 'book acquisition requires exactly one selected file');
    }
    return context.store.transitionJob(id, 'queued', {
      expectedRevision,
      candidate: normalizedCandidate,
      patch: { selectedFiles: normalizedFiles, error: null },
    });
  }

  startTorrent(selector, jobId, options) {
    const parsed = this._parseStartArgs(selector, jobId, options);
    const { context } = parsed;
    const intent = this._assertStart(context, parsed.jobId, parsed.options, 'magnet');
    if (intent.terminal) return Promise.resolve(intent.job);
    if (!this.torrentTransport || typeof this.torrentTransport.download !== 'function') {
      throw codedError('LIBRARY_ACQUISITION_TORRENT_REQUIRED', 'torrent acquisition requires its isolated transport');
    }
    if (parsed.options.p2pConsent !== true) {
      throw codedError('LIBRARY_TORRENT_P2P_CONSENT_REQUIRED', 'torrent acquisition requires explicit P2P consent');
    }
    if (intent.job.selectedFiles.length !== 1
      || !intent.offer.selectableFiles.includes(intent.job.selectedFiles[0])) {
      throw codedError('LIBRARY_ACQUISITION_SELECTION_INVALID', 'torrent Job has no exact frozen book selection');
    }
    const activeKey = `${context.workspaceIdentity}:${parsed.jobId}`;
    if (this.active.has(activeKey) || this.browserDownloadByJob.has(activeKey)) {
      throw codedError('LIBRARY_ACQUISITION_BUSY', 'this acquisition Job already has an active owner');
    }
    const controller = new AbortController();
    const record = {
      key: activeKey,
      context,
      jobId: parsed.jobId,
      candidate: intent.candidate,
      offer: intent.offer,
      controller,
      requested: null,
      transport: 'magnet',
      p2pConsent: true,
      phase: 'starting',
      resourceKey: null,
      promise: null,
    };
    record.resourceKey = this.resourceLedger?.register?.({
      type: 'library-acquisition',
      id: parsed.jobId,
      owner: `library-acquisition:${context.workspaceIdentity}`,
      state: 'starting',
      meta: { transport: 'magnet' },
    }) || null;
    this.active.set(activeKey, record);
    record.promise = this._executeTorrent(record, intent.job)
      .finally(() => {
        this.active.delete(activeKey);
        if (record.resourceKey) {
          this.resourceLedger?.release?.(record.resourceKey, {
            reason: record.requested || 'settled',
            state: 'released',
          });
          record.resourceKey = null;
        }
      });
    return record.promise;
  }

  resumeTorrent(selector, jobId, options) {
    return this.startTorrent(selector, jobId, options);
  }

  _stagingPaths(context, job, offer) {
    const jobRoot = path.join(context.store.paths.stagingRoot, safeInternalId(job.jobId, 'jobId'));
    context.store._assertPhysicalBoundary(context.store.paths.stagingRoot, jobRoot);
    const payloadPath = path.join(jobRoot, `payload.${offer.format}.part`);
    const metadataPath = path.join(jobRoot, 'transfer.json');
    const pieceStorePath = path.join(jobRoot, 'torrent-pieces.bin');
    if (job.stagingPath && path.resolve(job.stagingPath) !== path.resolve(payloadPath)) {
      throw codedError('LIBRARY_ACQUISITION_STAGING_MISMATCH', 'durable staging path differs from the Job-owned path');
    }
    return { jobRoot, payloadPath, metadataPath, pieceStorePath };
  }

  _captureStagingPayload(context, payloadPath, expectedIdentity = null) {
    try {
      context.store._assertPhysicalBoundary(
        context.store.paths.stagingRoot,
        payloadPath,
        { mustBeRegularFile: true },
      );
    } catch (error) {
      error.quarantine = true;
      throw error;
    }
    if (!this.fs.existsSync(payloadPath)) {
      throw codedError(
        'LIBRARY_ACQUISITION_STAGING_IDENTITY_CHANGED',
        'the active staging payload disappeared',
        { quarantine: true },
      );
    }
    const stat = this.fs.lstatSync(payloadPath);
    if (!stat.isFile() || stat.isSymbolicLink()
      || (typeof stat.nlink === 'number' && stat.nlink !== 1)
      || (expectedIdentity && !sameStagingOwner(expectedIdentity, stat))) {
      throw codedError(
        'LIBRARY_ACQUISITION_STAGING_IDENTITY_CHANGED',
        'the active staging path no longer names its captured file identity',
        { quarantine: true },
      );
    }
    return stagingIdentity(stat);
  }

  _prepareStaging(context, staging) {
    context.store._assertPhysicalBoundary(context.store.paths.stagingRoot, staging.jobRoot);
    let created = false;
    if (!this.fs.existsSync(staging.jobRoot)) {
      this.fs.mkdirSync(staging.jobRoot, { recursive: false });
      created = true;
    }
    const stat = this.fs.lstatSync(staging.jobRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw codedError('LIBRARY_ACQUISITION_UNSAFE_STAGING', 'Job staging root must be a physical directory');
    }
    context.store._assertPhysicalBoundary(context.store.paths.stagingRoot, staging.jobRoot);
    if (created) this._fsyncDirectory(context.store.paths.stagingRoot);
  }

  _transitionToDownloading(context, job, payloadPath, { restartFresh = false } = {}) {
    return context.store.transitionJob(job.jobId, 'downloading', {
      expectedRevision: job.revision,
      patch: {
        stagingPath: payloadPath,
        error: null,
        // A quarantined transport has no resumable staging ownership.  Its
        // failed receipt retains the old exact byte count; the explicit retry
        // begins a new transfer fact at zero without deleting quarantine.
        ...(restartFresh || !job.stagingPath ? { bytes: { received: 0, total: null } } : {}),
      },
    });
  }

  _updateProgress(context, jobId, progress) {
    const current = context.store.getJob(jobId);
    if (!current || current.state !== 'downloading') {
      throw codedError('LIBRARY_ACQUISITION_OWNER_LOST', 'durable Job owner changed during transport');
    }
    if (current.bytes.received === progress.received && current.bytes.total === progress.total) return current;
    return context.store.updateJob(jobId, {
      expectedRevision: current.revision,
      patch: { bytes: { received: progress.received, total: progress.total } },
    });
  }

  async _finishStaged(record, job, staging, transfer) {
    const { context, candidate, offer, controller } = record;
    if (controller.signal.aborted) {
      const aborted = codedError('LIBRARY_ACQUISITION_ABORTED', 'the acquisition was interrupted');
      const requestedPause = record.requested === 'pause' || record.requested === 'shutdown';
      if (requestedPause) {
        const durable = context.store.getJob(job.jobId);
        if (durable?.state === 'downloading'
          && durable.bytes.received === transfer.bytes
          && durable.bytes.total === transfer.total) {
          // The transport has already fsynced the complete payload and its
          // transfer record, and onProgress has committed the same exact byte
          // fact to the Job.  A pause that arrives during the transport's
          // final hash is therefore a durable downloading boundary, not a
          // verification failure.
          aborted.partialDurable = true;
        } else {
          aborted.durabilityError = codedError(
            'LIBRARY_ACQUISITION_DURABILITY_MISMATCH',
            'the completed transport did not match the durable Job progress',
          );
        }
      }
      throw aborted;
    }
    job = context.store.getJob(job.jobId);
    job = context.store.transitionJob(job.jobId, 'verifying', {
      expectedRevision: job.revision,
      patch: { bytes: { received: transfer.bytes, total: transfer.total ?? transfer.bytes }, error: null },
    });
    record.phase = 'verifying';
    this.resourceLedger?.update?.(record.resourceKey, { state: 'verifying' });
    let verified;
    try {
      const beforeVerification = this._captureStagingPayload(
        context, staging.payloadPath, record.stagingIdentity,
      );
      verified = await verifyPayload({
        filePath: staging.payloadPath,
        format: offer.format,
        declaredChecksum: offer.checksum,
        expectedSize: offer.size ?? transfer.total,
        fsImpl: this.fs,
        signal: controller.signal,
      });
      const afterVerification = this._captureStagingPayload(
        context, staging.payloadPath, beforeVerification,
      );
      if (!sameStableStaging(beforeVerification, afterVerification)
        || verified.size !== afterVerification.size) {
        throw codedError(
          'LIBRARY_ACQUISITION_STAGING_IDENTITY_CHANGED',
          'the staging payload changed while it was being verified',
          { quarantine: true },
        );
      }
      record.stagingIdentity = afterVerification;
    } catch (error) {
      if (record.requested === 'cancel' && error?.code === 'LIBRARY_ACQUISITION_ABORTED') throw error;
      let quarantined = false;
      try {
        await this._quarantine(context, job, staging, error.verification?.sha256 || '');
        quarantined = true;
      } catch (quarantineError) {
        error.quarantineError = quarantineError;
      }
      const current = context.store.getJob(job.jobId);
      const failed = context.store.transitionJob(job.jobId, 'failed', {
        expectedRevision: current.revision,
        retryFrom: 'verifying',
        patch: {
          error: toJobError(
            quarantined ? error : error.quarantineError,
            quarantined ? 'LIBRARY_ACQUISITION_INTEGRITY_FAILED' : 'LIBRARY_ACQUISITION_QUARANTINE_FAILED',
          ),
          ...(quarantined ? { stagingPath: '' } : {}),
        },
      });
      this._event(failed, 'failed');
      this._markDurableCompletion(error, failed);
      throw error;
    }
    job = context.store.getJob(job.jobId);
    job = context.store.transitionJob(job.jobId, 'materializing', {
      expectedRevision: job.revision,
      patch: {
        integrity: {
          sha256: verified.sha256,
          declaredChecksum: offer.checksum,
          pieceVerified: transfer.pieceVerified === true,
        },
        bytes: { received: verified.size, total: verified.size },
      },
    });
    record.phase = 'materializing';
    this.resourceLedger?.update?.(record.resourceKey, { state: 'materializing' });
    let promotion;
    try {
      promotion = await this._promote(context, {
        job, candidate, offer, sourcePath: staging.payloadPath,
        sha256: verified.sha256, size: verified.size, format: offer.format,
        sourceIdentity: record.stagingIdentity,
      });
    } catch (error) {
      const current = context.store.getJob(job.jobId);
      const failed = context.store.transitionJob(job.jobId, 'failed', {
        expectedRevision: current.revision,
        retryFrom: 'materializing',
        patch: { error: toJobError(error, 'LIBRARY_ACQUISITION_PROMOTION_FAILED') },
      });
      this._event(failed, 'failed');
      this._markDurableCompletion(error, failed);
      throw error;
    }
    job = context.store.getJob(job.jobId);
    job = context.store.transitionJob(job.jobId, 'awaiting-import', {
      expectedRevision: job.revision,
      patch: { finalPath: promotion.path },
    });
    record.phase = 'awaiting-import';
    this.resourceLedger?.update?.(record.resourceKey, { state: 'awaiting-import' });
    try {
      this._ensureInbox(context, job, offer.format);
    } catch (error) {
      this._markDurableCompletion(error, job);
      throw error;
    }
    const settled = context.store.getJob(job.jobId);
    this._event(settled, 'success');
    return settled;
  }

  async _executeHttp(record, initialJob) {
    const { context, candidate, offer, controller } = record;
    const staging = this._stagingPaths(context, initialJob, offer);
    let job = this._transitionToDownloading(context, initialJob, staging.payloadPath);
    record.phase = 'downloading';
    this.resourceLedger?.update?.(record.resourceKey, { state: 'downloading' });
    try {
      // Persist the owning state and exact target before the first directory or
      // payload side effect is created.
      this._prepareStaging(context, staging);
      const transfer = await context.http.download({
        job,
        offer,
        stagingRoot: context.store.paths.stagingRoot,
        payloadPath: staging.payloadPath,
        metadataPath: staging.metadataPath,
        signal: controller.signal,
        boundaryCheck: () => context.store._assertPhysicalBoundary(
          context.store.paths.stagingRoot,
          staging.payloadPath,
          { mustBeRegularFile: this.fs.existsSync(staging.payloadPath) },
        ),
        onProgress: progress => { job = this._updateProgress(context, job.jobId, progress); },
      });
      record.stagingIdentity = transfer.identity;
      return await this._finishStaged(record, job, staging, transfer);
    } catch (error) {
      const current = context.store.getJob(initialJob.jobId);
      if (record.requested === 'cancel') {
        this._cleanupStaging(context, initialJob.jobId);
        if (current && !contract.isTerminalJobState(current.state) && current.state !== 'awaiting-import') {
          const cancelled = context.store.transitionJob(current.jobId, 'cancelled', { expectedRevision: current.revision });
          this._event(cancelled, 'cancelled', 'cancel');
          return cancelled;
        }
      }
      const requestedPause = record.requested === 'pause' || record.requested === 'shutdown';
      if (requestedPause && error?.code === 'LIBRARY_ACQUISITION_ABORTED'
        && error?.partialDurable === true) {
        if (current?.state === 'downloading') {
          const paused = context.store.transitionJob(current.jobId, 'paused', {
            expectedRevision: current.revision,
            retryFrom: 'downloading',
            patch: { error: null },
          });
          this._event(paused, 'partial', 'pause');
          return paused;
        }
      }
      // Verification and materialization failures are persisted at their
      // exact stage above.  Awaiting-import failures deliberately retain that
      // state so startup reconciliation can recreate a missing Inbox.
      if (current?.state === 'downloading') {
        let transportError = requestedPause && error?.partialDurable !== true && error?.durabilityError
          ? error.durabilityError
          : error;
        let quarantined = false;
        if (error?.quarantine === true) {
          try {
            quarantined = Boolean(await this._quarantine(context, current, staging));
          } catch (quarantineError) {
            transportError = quarantineError;
          }
        }
        const failed = context.store.transitionJob(current.jobId, 'failed', {
          expectedRevision: current.revision,
          retryFrom: 'downloading',
          patch: {
            error: toJobError(transportError, 'LIBRARY_ACQUISITION_DOWNLOAD_FAILED'),
            ...(quarantined ? { stagingPath: '' } : {}),
          },
        });
        this._event(failed, 'failed');
        const failure = this._publicError(transportError, 'LIBRARY_ACQUISITION_DOWNLOAD_FAILED');
        this._markDurableCompletion(failure, failed);
        throw failure;
      }
      throw this._publicError(error, 'LIBRARY_ACQUISITION_FAILED');
    }
  }

  async _executeTorrent(record, initialJob) {
    const { context, candidate, offer, controller } = record;
    const staging = this._stagingPaths(context, initialJob, offer);
    const restarting = initialJob.state === 'paused' || initialJob.state === 'failed';
    let job = this._transitionToDownloading(context, initialJob, staging.payloadPath, { restartFresh: true });
    record.phase = 'downloading';
    this.resourceLedger?.update?.(record.resourceKey, { state: 'downloading' });
    let payloadFd = null;
    let received = 0;
    let payloadDurable = false;
    try {
      // Publish the fresh zero-byte downloading intent before retiring stale
      // staging. A crash at either side therefore reopens to a truthful
      // downloading→paused fact instead of a paused receipt naming deleted
      // resumable bytes.
      if (restarting) this._cleanupStaging(context, initialJob.jobId);
      this._prepareStaging(context, staging);
      context.store._assertPhysicalBoundary(context.store.paths.stagingRoot, staging.payloadPath);
      payloadFd = this.fs.openSync(staging.payloadPath, 'wx');
      record.stagingIdentity = this._captureStagingPayload(context, staging.payloadPath);
      const writeChunk = async (chunk, progress) => {
        if (controller.signal.aborted) {
          throw codedError('LIBRARY_TORRENT_ABORTED', 'torrent download was interrupted');
        }
        const before = this._captureStagingPayload(
          context, staging.payloadPath, record.stagingIdentity,
        );
        let offset = 0;
        while (offset < chunk.length) {
          const written = this.fs.writeSync(payloadFd, chunk, offset, chunk.length - offset, received + offset);
          if (!written) throw codedError('LIBRARY_TORRENT_WRITE_FAILED', 'torrent staging write made no progress');
          offset += written;
        }
        this.fs.fsyncSync(payloadFd);
        received += chunk.length;
        const after = this._captureStagingPayload(context, staging.payloadPath, before);
        if (!sameStagingOwner(before, after) || after.size !== received) {
          throw codedError(
            'LIBRARY_ACQUISITION_STAGING_IDENTITY_CHANGED',
            'torrent staging payload changed during its durable checkpoint',
            { quarantine: true },
          );
        }
        record.stagingIdentity = after;
        payloadDurable = true;
        job = this._updateProgress(context, job.jobId, {
          received: progress.received,
          total: progress.total,
        });
      };
      const transfer = await this.torrentTransport.download({
        infoHash: offer.infoHash,
        selectedFile: job.selectedFiles[0],
        pieceStorePath: staging.pieceStorePath,
        p2pConsent: record.p2pConsent,
        signal: controller.signal,
        onChunk: writeChunk,
      });
      this.fs.fsyncSync(payloadFd);
      payloadDurable = true;
      this.fs.closeSync(payloadFd);
      payloadFd = null;
      const closedIdentity = this._captureStagingPayload(
        context, staging.payloadPath, record.stagingIdentity,
      );
      if (!sameStableStaging(record.stagingIdentity, closedIdentity)
        || closedIdentity.size !== transfer.bytes) {
        throw codedError(
          'LIBRARY_ACQUISITION_STAGING_IDENTITY_CHANGED',
          'torrent staging payload changed at writer close',
          { quarantine: true },
        );
      }
      record.stagingIdentity = closedIdentity;
      return await this._finishStaged(record, job, staging, transfer);
    } catch (error) {
      let settlementError = error;
      if (payloadFd !== null) {
        try {
          this.fs.fsyncSync(payloadFd);
          payloadDurable = true;
        } catch (fsyncError) {
          settlementError = fsyncError;
        }
        try { this.fs.closeSync(payloadFd); }
        catch (closeError) {
          attachCleanupError(settlementError, closeError);
          if (settlementError === error && error?.code === 'LIBRARY_TORRENT_ABORTED') {
            settlementError = closeError;
          }
        }
        payloadFd = null;
      }
      const current = context.store.getJob(initialJob.jobId);
      if (record.requested === 'cancel') {
        this._cleanupStaging(context, initialJob.jobId);
        if (current && !contract.isTerminalJobState(current.state) && current.state !== 'awaiting-import') {
          const cancelled = context.store.transitionJob(current.jobId, 'cancelled', { expectedRevision: current.revision });
          this._event(cancelled, 'cancelled', 'cancel');
          return cancelled;
        }
      }
      const requestedPause = record.requested === 'pause' || record.requested === 'shutdown';
      if (requestedPause && settlementError === error
        && error?.code === 'LIBRARY_TORRENT_ABORTED' && payloadDurable && !error.cleanupError) {
        if (current?.state === 'downloading') {
          const paused = context.store.transitionJob(current.jobId, 'paused', {
            expectedRevision: current.revision,
            retryFrom: 'downloading',
            patch: { error: null },
          });
          this._event(paused, 'partial', 'pause');
          return paused;
        }
      }
      if (current?.state === 'downloading') {
        let quarantined = false;
        if (error?.quarantine === true) {
          try { quarantined = Boolean(await this._quarantine(context, current, staging)); }
          catch (quarantineError) { settlementError = quarantineError; }
        }
        const failed = context.store.transitionJob(current.jobId, 'failed', {
          expectedRevision: current.revision,
          retryFrom: 'downloading',
          patch: {
            error: toJobError(settlementError, 'LIBRARY_TORRENT_DOWNLOAD_FAILED'),
            ...(quarantined ? { stagingPath: '' } : {}),
          },
        });
        this._event(failed, 'failed');
        const failure = this._publicError(settlementError, 'LIBRARY_TORRENT_DOWNLOAD_FAILED');
        this._markDurableCompletion(failure, failed);
        throw failure;
      }
      throw this._publicError(settlementError, 'LIBRARY_TORRENT_ACQUISITION_FAILED');
    }
  }

  async _promote(context, request) {
    let result;
    if (typeof this.promoter === 'function') result = await this.promoter({ ...request, store: context.store });
    else if (typeof this.promoter.promote === 'function') result = await this.promoter.promote({ ...request, store: context.store });
    else if (typeof this.promoter.promotePath === 'function') {
      result = await this.promoter.promotePath({ ...request, store: context.store });
    } else {
      // LibraryImportService's W93B path API.  It derives the hash itself and
      // performs exclusive same-filesystem publication; this coordinator
      // independently re-verifies its returned receipt below.
      result = await this.promoter.materializePath({
        workspace: context.workspacePath,
        sourcePath: request.sourcePath,
        name: promotionLeaf(request.candidate.work.title, request.format, request.sha256),
        expectedSha256: request.sha256,
        expectedSize: request.size,
        expectedIdentity: request.sourceIdentity,
      });
    }
    const finalPath = result?.path || result?.finalPath;
    if (typeof finalPath !== 'string' || !finalPath) {
      throw codedError('LIBRARY_ACQUISITION_PROMOTION_FAILED', 'atomic promoter returned no final artifact path');
    }
    const resolved = path.resolve(finalPath);
    if (!contract.isPathInside(context.store.paths.libraryRoot, resolved)
      || resolved === context.store.paths.resourcesRoot
      || contract.isPathInside(context.store.paths.resourcesRoot, resolved)) {
      throw codedError('LIBRARY_ACQUISITION_PROMOTION_FAILED', 'atomic promoter returned an unsafe artifact path');
    }
    if (path.extname(resolved).toLowerCase() !== `.${request.format}`) {
      throw codedError('LIBRARY_ACQUISITION_PROMOTION_FAILED', 'promoted artifact extension differs from the verified Offer format');
    }
    context.store._assertPhysicalBoundary(context.store.paths.libraryRoot, resolved, { mustBeRegularFile: true });
    const actual = await digestFile(resolved, this.fs);
    if (actual.sha256 !== request.sha256 || actual.size !== request.size) {
      throw codedError('LIBRARY_ACQUISITION_PROMOTION_FAILED', 'promoted artifact differs from the verified payload');
    }
    return Object.freeze({ path: resolved, reused: result?.reused === true });
  }

  _browserHandle(handleId) {
    const id = safeInternalId(handleId, 'browserDownloadHandle');
    const record = this.browserDownloads.get(id);
    if (!record) throw codedError('LIBRARY_ACQUISITION_BROWSER_HANDLE_NOT_FOUND', 'Browser download handle is no longer active');
    return record;
  }

  prepareBrowserDownload(selector, jobId, options = {}) {
    const context = this._workspace(selector);
    const id = safeInternalId(jobId, 'jobId');
    const intent = this._assertStart(context, id, options);
    if (intent.terminal) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_STATE', 'terminal Job cannot become a Browser download');
    }
    const jobKey = `${context.workspaceIdentity}:${id}`;
    if (this.active.has(jobKey) || this.browserDownloadByJob.has(jobKey)) {
      throw codedError('LIBRARY_ACQUISITION_BUSY', 'this acquisition Job already has an active owner');
    }
    const staging = this._stagingPaths(context, intent.job, intent.offer);
    let job = this._transitionToDownloading(context, intent.job, staging.payloadPath, { restartFresh: true });
    let capturedStagingIdentity;
    try {
      // A user re-initiation of a short-lived Browser handle is an explicit
      // full restart.  Remove only this Job's previously validated staging
      // leaves after the fresh durable state is established.
      this._cleanupStaging(context, id);
      this._prepareStaging(context, staging);
      this._createBrowserPayload(staging.payloadPath);
      capturedStagingIdentity = this._captureStagingPayload(context, staging.payloadPath);
    } catch (error) {
      job = context.store.getJob(id);
      const failed = context.store.transitionJob(id, 'failed', {
        expectedRevision: job.revision,
        retryFrom: 'downloading',
        patch: { error: toJobError(error, 'LIBRARY_ACQUISITION_BROWSER_PREPARE_FAILED') },
      });
      this._event(failed, 'failed');
      const failure = this._publicError(error, 'LIBRARY_ACQUISITION_BROWSER_PREPARE_FAILED');
      this._markDurableCompletion(failure, failed);
      throw failure;
    }
    const handleId = `browser-download-${sha256Text(this.randomId())}`;
    const record = {
      handleId,
      jobKey,
      jobId: id,
      context,
      candidate: intent.candidate,
      offer: intent.offer,
      staging,
      controller: new AbortController(),
      requested: null,
      phase: 'downloading',
      stagingIdentity: capturedStagingIdentity,
      expectedRevision: job.revision,
      promise: null,
      resourceKey: this.resourceLedger?.register?.({
        type: 'library-browser-download',
        id,
        owner: `library-acquisition:${context.workspaceIdentity}`,
        state: 'downloading',
        meta: { transport: 'browser-download' },
      }) || null,
    };
    this.browserDownloads.set(handleId, record);
    this.browserDownloadByJob.set(jobKey, handleId);
    return Object.freeze({
      handleId,
      jobId: id,
      workspaceIdentity: context.workspaceIdentity,
      savePath: staging.payloadPath,
      revision: context.store.getJob(id).revision,
    });
  }

  getBrowserDownload(handleId) {
    const record = this._browserHandle(handleId);
    const job = record.context.store.getJob(record.jobId);
    return Object.freeze({
      handleId: record.handleId,
      jobId: record.jobId,
      workspaceIdentity: record.context.workspaceIdentity,
      savePath: record.staging.payloadPath,
      revision: job.revision,
      state: job.state,
      bytes: job.bytes,
      settling: Boolean(record.promise),
    });
  }

  updateBrowserDownload(handleId, { expectedRevision, total } = {}) {
    const record = this._browserHandle(handleId);
    if (record.promise) throw codedError('LIBRARY_ACQUISITION_BUSY', 'Browser download completion is already settling');
    const current = record.context.store.getJob(record.jobId);
    if (current.state !== 'downloading') {
      throw codedError('LIBRARY_ACQUISITION_INVALID_STATE', 'Browser download Job is not downloading');
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
      throw codedError('LIBRARY_ACQUISITION_REVISION_CONFLICT', 'Browser download Job revision changed');
    }
    if (!(total === undefined || total === null || (Number.isSafeInteger(total) && total >= 0))) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_PROGRESS', 'Browser download total is invalid');
    }
    const beforeCheckpoint = this._captureStagingPayload(
      record.context, record.staging.payloadPath, record.stagingIdentity,
    );
    this._fsyncPayload(record.staging.payloadPath);
    const afterCheckpoint = this._captureStagingPayload(
      record.context, record.staging.payloadPath, beforeCheckpoint,
    );
    if (!sameStableStaging(beforeCheckpoint, afterCheckpoint)) {
      throw codedError(
        'LIBRARY_ACQUISITION_STAGING_IDENTITY_CHANGED',
        'the Browser staging payload changed during its durable progress checkpoint',
        { quarantine: true },
      );
    }
    record.stagingIdentity = afterCheckpoint;
    const received = afterCheckpoint.size;
    if (total !== undefined && total !== null && received > total) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_PROGRESS', 'Browser download bytes exceed the declared total');
    }
    const durableTotal = total === undefined
      ? (current.bytes.total === null || current.bytes.total >= received ? current.bytes.total : null)
      : total;
    const job = this._updateProgress(record.context, record.jobId, { received, total: durableTotal });
    record.expectedRevision = job.revision;
    return Object.freeze({
      handleId: record.handleId,
      jobId: record.jobId,
      workspaceIdentity: record.context.workspaceIdentity,
      revision: job.revision,
      bytes: job.bytes,
    });
  }

  _releaseBrowserRecord(record, reason) {
    this.browserDownloads.delete(record.handleId);
    this.browserDownloadByJob.delete(record.jobKey);
    if (record.resourceKey) {
      this.resourceLedger?.release?.(record.resourceKey, { reason, state: 'released' });
      record.resourceKey = null;
    }
  }

  completeBrowserDownload(handleId, options = {}) {
    const record = this._browserHandle(handleId);
    if (record.promise) throw codedError('LIBRARY_ACQUISITION_BUSY', 'Browser download completion is already settling');
    // Capability and CAS failures do not consume the short-lived handle.  The
    // bridge may re-read and retry with the current revision; only a validated
    // terminal DownloadItem observation transfers ownership to settling.
    const validated = this._validateBrowserCompletion(record, options);
    record.promise = this._completeBrowserDownload(record, validated)
      .finally(() => this._releaseBrowserRecord(record, options.state || 'settled'));
    return record.promise;
  }

  _validateBrowserCompletion(record, options) {
    const allowed = new Set(['state', 'candidate', 'expectedRevision']);
    if (!isPlainRecord(options) || Object.keys(options).some(key => !allowed.has(key))) {
      throw codedError('LIBRARY_ACQUISITION_BROWSER_RESULT_INVALID', 'Browser download completion shape is invalid');
    }
    if (!['completed', 'interrupted', 'failed', 'cancelled'].includes(options.state)) {
      throw codedError('LIBRARY_ACQUISITION_BROWSER_RESULT_INVALID', 'Browser download completion state is invalid');
    }
    let candidate = record.candidate;
    if (options.candidate !== undefined) {
      try { candidate = contract.normalizeCandidate(options.candidate); }
      catch { throw codedError('LIBRARY_ACQUISITION_CANDIDATE_INVALID', 'Candidate did not pass the frozen resource contract'); }
    }
    const candidateFingerprint = contract.deriveCandidateFingerprint(candidate);
    if (candidateFingerprint !== contract.deriveCandidateFingerprint(record.candidate)) {
      throw codedError('LIBRARY_ACQUISITION_CANDIDATE_MISMATCH', 'Browser download Candidate differs from its registered intent');
    }
    let job = record.context.store.getJob(record.jobId);
    const expectedRevision = options.expectedRevision === undefined
      ? record.expectedRevision
      : options.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== job.revision) {
      throw codedError('LIBRARY_ACQUISITION_REVISION_CONFLICT', 'Browser download Job revision changed');
    }
    if (job.state !== 'downloading') {
      throw codedError('LIBRARY_ACQUISITION_INVALID_STATE', 'Browser download Job is not downloading');
    }
    if (job.workspaceIdentity !== record.context.workspaceIdentity
      || job.candidateFingerprint !== candidateFingerprint
      || job.offerId !== record.offer.offerId
      || path.resolve(job.stagingPath) !== path.resolve(record.staging.payloadPath)) {
      throw codedError('LIBRARY_ACQUISITION_BROWSER_OWNER_MISMATCH', 'Browser download no longer owns the registered Job staging fact');
    }
    // Chromium may write through a temporary download leaf and atomically
    // replace the coordinator-created empty savePath when DownloadItem emits
    // `done`.  That replacement is the trusted writer hand-off boundary: take
    // the closed regular file as the new owner exactly here, then require this
    // identity to remain stable through fsync, verification and publication.
    const writerClosedIdentity = options.state === 'cancelled'
      ? record.stagingIdentity
      : this._captureStagingPayload(record.context, record.staging.payloadPath);
    return Object.freeze({
      state: options.state,
      candidate,
      job,
      writerClosedIdentity,
    });
  }

  async _completeBrowserDownload(record, validated) {
    let job = validated.job;
    try {
      const beforeSettlement = this._captureStagingPayload(
        record.context, record.staging.payloadPath, validated.writerClosedIdentity,
      );
      const received = beforeSettlement.size;
      const observedTotal = validated.state === 'completed'
        ? received
        : (job.bytes.total === null || job.bytes.total >= received ? job.bytes.total : null);
      if (validated.state !== 'cancelled' && this.fs.existsSync(record.staging.payloadPath)) {
        // Interrupted/failed bytes are recovery facts too.  Flush the closed
        // DownloadItem target before the durable paused/failed transition.
        this._fsyncPayload(record.staging.payloadPath);
      }

      if (validated.state !== 'cancelled') {
        const afterSettlement = this._captureStagingPayload(
          record.context, record.staging.payloadPath, beforeSettlement,
        );
        if (!sameStableStaging(beforeSettlement, afterSettlement)) {
          throw codedError(
            'LIBRARY_ACQUISITION_STAGING_IDENTITY_CHANGED',
            'the Browser staging payload changed during durable settlement',
            { quarantine: true },
          );
        }
        record.stagingIdentity = afterSettlement;
      }

      // Only expose Browser progress after the closed DownloadItem payload has
      // been fsynced and proven stable under the originally captured owner.
      job = this._updateProgress(record.context, record.jobId, { received, total: observedTotal });

      if (validated.state === 'cancelled') {
        this._cleanupStaging(record.context, record.jobId);
        const cancelled = record.context.store.transitionJob(job.jobId, 'cancelled', { expectedRevision: job.revision });
        this._event(cancelled, 'cancelled', 'cancel');
        return cancelled;
      }
      if (validated.state === 'interrupted') {
        const paused = record.context.store.transitionJob(job.jobId, 'paused', {
          expectedRevision: job.revision,
          retryFrom: 'downloading',
          patch: {
            error: {
              code: 'BROWSER_DOWNLOAD_INTERRUPTED',
              message: '浏览器下载已安全暂停，可由用户重新发起',
            },
          },
        });
        this._event(paused, 'partial', 'pause');
        return paused;
      }
      if (validated.state === 'failed') {
        const failed = record.context.store.transitionJob(job.jobId, 'failed', {
          expectedRevision: job.revision,
          retryFrom: 'downloading',
          patch: {
            error: {
              code: 'BROWSER_DOWNLOAD_FAILED',
              message: '浏览器下载失败，已保留可恢复事实',
            },
          },
        });
        this._event(failed, 'failed');
        return failed;
      }
      if (!this.fs.existsSync(record.staging.payloadPath)) {
        throw codedError('LIBRARY_ACQUISITION_BROWSER_PAYLOAD_MISSING', 'completed Browser download has no staging payload');
      }
      return await this._finishStaged(record, job, record.staging, { bytes: received, total: received });
    } catch (error) {
      const current = record.context.store.getJob(job.jobId);
      if (current?.state === 'downloading') {
        const failed = record.context.store.transitionJob(job.jobId, 'failed', {
          expectedRevision: current.revision,
          retryFrom: 'downloading',
          patch: { error: toJobError(error, 'LIBRARY_ACQUISITION_BROWSER_COMPLETE_FAILED') },
        });
        this._event(failed, 'failed');
        this._markDurableCompletion(error, failed);
      }
      throw this._publicError(error, 'LIBRARY_ACQUISITION_BROWSER_COMPLETE_FAILED');
    }
  }

  _ensureInbox(context, job, format) {
    if (job.state !== 'awaiting-import' || !job.finalPath || !job.integrity.sha256) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_STATE', 'Inbox can be created only from a verified promoted Job');
    }
    const receiptId = `receipt-${sha256Text(`${job.jobId}:${job.integrity.sha256}`)}`;
    const outcome = context.store.putInboxReceipt({
      schema: contract.INBOX_SCHEMA,
      revision: 1,
      receiptId,
      jobId: job.jobId,
      workspaceIdentity: context.workspaceIdentity,
      kind: 'library-asset-ready',
      state: 'pending',
      artifact: {
        path: job.finalPath,
        sha256: job.integrity.sha256,
        size: job.bytes.received,
        format,
      },
      createdAt: job.updatedAt,
      acknowledgedAt: null,
    });
    if (outcome.created && this.onInboxReady) {
      try {
        const wakeup = this.onInboxReady(Object.freeze({
          workspaceIdentity: context.workspaceIdentity,
          receiptId: outcome.receipt.receiptId,
        }));
        if (wakeup && typeof wakeup.then === 'function') {
          Promise.resolve(wakeup).catch(() => {});
        }
      } catch {
        // Wakeups are hints only.  A durable pending Inbox is already the
        // truth and must never be rolled back by a window/event failure.
      }
    }
    return outcome.receipt;
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
        catch (cleanupError) {
          if (primary) attachCleanupError(primary, cleanupError);
          else primary = cleanupError;
        }
      }
    }
    if (primary) throw primary;
  }

  _fsyncPayload(filePath) {
    let fd;
    let primary = null;
    try {
      // Windows requires a writable handle for FlushFileBuffers/fsync.
      fd = this.fs.openSync(filePath, 'r+');
      this.fs.fsyncSync(fd);
    } catch (error) {
      primary = error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); }
        catch (cleanupError) {
          if (primary) attachCleanupError(primary, cleanupError);
          else primary = cleanupError;
        }
      }
    }
    if (primary) throw primary;
    this._fsyncDirectory(path.dirname(filePath));
  }

  _createBrowserPayload(filePath) {
    let fd;
    let primary = null;
    try {
      // The Browser bridge must hand DownloadItem a path whose physical file
      // identity has already been established inside the Job-owned staging
      // directory.  Exclusive creation prevents a linked leaf from winning.
      fd = this.fs.openSync(filePath, 'wx');
      this.fs.fsyncSync(fd);
    } catch (error) {
      primary = error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); }
        catch (cleanupError) {
          if (primary) attachCleanupError(primary, cleanupError);
          else primary = cleanupError;
        }
      }
    }
    if (primary) throw primary;
    const stat = this.fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || (typeof stat.nlink === 'number' && stat.nlink !== 1)) {
      throw codedError('LIBRARY_ACQUISITION_UNSAFE_STAGING', 'Browser staging payload is not an exclusively owned regular file');
    }
    this._fsyncDirectory(path.dirname(filePath));
  }

  async _quarantine(context, job, staging, digest = '') {
    const sources = [];
    if (this.fs.existsSync(staging.payloadPath)) {
      context.store._assertPhysicalBoundary(context.store.paths.stagingRoot, staging.payloadPath, { mustBeRegularFile: true });
      const stat = this.fs.lstatSync(staging.payloadPath);
      if (typeof stat.nlink === 'number' && stat.nlink !== 1) {
        throw codedError('LIBRARY_ACQUISITION_QUARANTINE_FAILED', 'staging payload has unsafe hard-link ownership');
      }
      sources.push({ kind: 'payload', path: staging.payloadPath });
    }
    if (this.fs.existsSync(staging.metadataPath)) {
      context.store._assertPhysicalBoundary(context.store.paths.stagingRoot, staging.metadataPath, { mustBeRegularFile: true });
      const stat = this.fs.lstatSync(staging.metadataPath);
      if (typeof stat.nlink === 'number' && stat.nlink !== 1) {
        throw codedError('LIBRARY_ACQUISITION_QUARANTINE_FAILED', 'transfer metadata has unsafe hard-link ownership');
      }
      sources.push({ kind: 'transfer', path: staging.metadataPath });
    }
    if (!sources.length) return null;
    const quarantineJobRoot = path.join(context.store.paths.quarantineRoot, safeInternalId(job.jobId, 'jobId'));
    context.store._assertPhysicalBoundary(context.store.paths.quarantineRoot, quarantineJobRoot);
    if (!this.fs.existsSync(quarantineJobRoot)) this.fs.mkdirSync(quarantineJobRoot, { recursive: false });
    const stat = this.fs.lstatSync(quarantineJobRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw codedError('LIBRARY_ACQUISITION_QUARANTINE_FAILED', 'quarantine root is unsafe');
    }
    const identity = /^[a-f0-9]{64}$/.test(digest) ? digest : 'unverified';
    const nonce = sha256Text(this.randomId());
    const linked = [];
    for (const source of sources) {
      const suffix = source.kind === 'payload'
        ? (path.extname(source.path).replace(/^\./, '') || 'bin')
        : 'json';
      const target = path.join(quarantineJobRoot, `${source.kind}-${identity}-${nonce}.${suffix}`);
      context.store._assertPhysicalBoundary(context.store.paths.quarantineRoot, target);
      try {
        this.fs.linkSync(source.path, target);
      } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error?.code)) {
          throw codedError('LIBRARY_ACQUISITION_QUARANTINE_ATOMIC_UNSUPPORTED', 'Workspace cannot atomically quarantine the failed payload', { cause: error });
        }
        throw error;
      }
      linked.push({ ...source, target });
    }
    this._fsyncDirectory(quarantineJobRoot);
    for (const item of linked) this.fs.unlinkSync(item.path);
    this._fsyncDirectory(path.dirname(staging.payloadPath));
    return Object.freeze(Object.fromEntries(linked.map(item => [`${item.kind}Path`, item.target])));
  }

  _cleanupStaging(context, jobId) {
    const jobRoot = path.join(context.store.paths.stagingRoot, safeInternalId(jobId, 'jobId'));
    context.store._assertPhysicalBoundary(context.store.paths.stagingRoot, jobRoot);
    if (!this.fs.existsSync(jobRoot)) return;
    const stat = this.fs.lstatSync(jobRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw codedError('LIBRARY_ACQUISITION_UNSAFE_STAGING', 'Job staging cleanup target is unsafe');
    }
    for (const name of this.fs.readdirSync(jobRoot)) {
      if (!/^payload\.(?:epub|cbz|txt|mobi|azw3|pdf)\.part$/.test(name)
        && name !== 'transfer.json' && name !== 'torrent-pieces.bin') continue;
      const target = path.join(jobRoot, name);
      context.store._assertPhysicalBoundary(context.store.paths.stagingRoot, target);
      const child = this.fs.lstatSync(target);
      if (!child.isFile() || child.isSymbolicLink()) {
        throw codedError('LIBRARY_ACQUISITION_UNSAFE_STAGING', 'Job-owned staging leaf is unsafe');
      }
      this.fs.unlinkSync(target);
    }
    this._fsyncDirectory(jobRoot);
    if (this.fs.readdirSync(jobRoot).length === 0) {
      this.fs.rmdirSync(jobRoot);
      this._fsyncDirectory(context.store.paths.stagingRoot);
    }
  }

  async pause(selector, jobId) {
    const context = this._workspace(selector);
    const id = safeInternalId(jobId, 'jobId');
    const jobKey = `${context.workspaceIdentity}:${id}`;
    if (this.browserDownloadByJob.has(jobKey)) {
      throw codedError('LIBRARY_ACQUISITION_BROWSER_HANDLE_REQUIRED', 'settle the registered Browser download handle to pause this Job');
    }
    const active = this.active.get(jobKey);
    if (active) {
      const current = context.store.getJob(id);
      if (current?.state !== 'downloading') {
        throw codedError('LIBRARY_ACQUISITION_PHASE_NOT_PAUSABLE', 'only an active transfer can be paused');
      }
      active.requested = 'pause';
      this.resourceLedger?.update?.(active.resourceKey, { state: 'pausing' });
      active.controller.abort();
      return active.promise;
    }
    const job = context.store.getJob(id);
    if (!job) throw codedError('LIBRARY_ACQUISITION_JOB_NOT_FOUND', 'acquisition Job does not exist');
    if (job.state === 'paused' || contract.isTerminalJobState(job.state)) return job;
    if (!['queued', 'downloading'].includes(job.state)) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_STATE', 'Job cannot be paused from its current state');
    }
    const paused = context.store.transitionJob(id, 'paused', {
      expectedRevision: job.revision,
      retryFrom: job.state,
      patch: { error: null },
    });
    this._event(paused, 'partial', 'pause');
    return paused;
  }

  async cancel(selector, jobId) {
    const context = this._workspace(selector);
    const id = safeInternalId(jobId, 'jobId');
    const jobKey = `${context.workspaceIdentity}:${id}`;
    if (this.browserDownloadByJob.has(jobKey)) {
      throw codedError('LIBRARY_ACQUISITION_BROWSER_HANDLE_REQUIRED', 'settle the registered Browser download handle to cancel this Job');
    }
    const active = this.active.get(jobKey);
    if (active) {
      const current = context.store.getJob(id);
      if (current?.state === 'materializing' || current?.state === 'awaiting-import' || current?.finalPath) {
        throw codedError('LIBRARY_ACQUISITION_IMPORT_PENDING', 'publication has begun and requires an explicit discard transaction');
      }
      active.requested = 'cancel';
      this.resourceLedger?.update?.(active.resourceKey, { state: 'cancelling' });
      active.controller.abort();
      return active.promise;
    }
    const job = context.store.getJob(id);
    if (!job) throw codedError('LIBRARY_ACQUISITION_JOB_NOT_FOUND', 'acquisition Job does not exist');
    if (job.state === 'cancelled') return job;
    if (job.state === 'imported' || job.state === 'awaiting-import' || job.finalPath) {
      throw codedError('LIBRARY_ACQUISITION_IMPORT_PENDING', 'published Library assets require an explicit discard transaction');
    }
    this._cleanupStaging(context, id);
    const cancelled = context.store.transitionJob(id, 'cancelled', { expectedRevision: job.revision });
    this._event(cancelled, 'cancelled', 'cancel');
    return cancelled;
  }

  _validateShelfCommit(context, receipt, commit) {
    if (!isPlainRecord(commit)) throw codedError('LIBRARY_ACQUISITION_INVALID_COMMIT', 'shelf commit must be an object');
    const allowed = new Set(['receiptId', 'bookId', 'workspaceIdentity', 'contentHash', 'path', 'expectedJobRevision']);
    if (Object.keys(commit).some(key => !allowed.has(key))) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_COMMIT', 'shelf commit contains an unsupported capability field');
    }
    const bookId = safeInternalId(commit.bookId, 'bookId');
    if (commit.receiptId !== undefined && commit.receiptId !== receipt.receiptId) {
      throw codedError('LIBRARY_ACQUISITION_COMMIT_MISMATCH', 'shelf commit names another Inbox receipt');
    }
    if (typeof commit.path !== 'string' || typeof commit.contentHash !== 'string'
      || commit.workspaceIdentity !== context.workspaceIdentity
      || commit.contentHash !== receipt.artifact.sha256
      || commit.path !== receipt.artifact.path) {
      throw codedError('LIBRARY_ACQUISITION_COMMIT_MISMATCH', 'shelf commit does not match the immutable Inbox artifact');
    }
    return bookId;
  }

  async completeInbox(selector, receiptIdOrCommit, maybeCommit) {
    const context = this._workspace(selector, { tokenRequired: true });
    const receiptId = typeof receiptIdOrCommit === 'string' ? receiptIdOrCommit : receiptIdOrCommit?.receiptId;
    const commit = typeof receiptIdOrCommit === 'string' ? maybeCommit : receiptIdOrCommit;
    const receipt = context.store.getInboxReceipt(safeInternalId(receiptId, 'receiptId'));
    if (!receipt) throw codedError('LIBRARY_ACQUISITION_INBOX_NOT_FOUND', 'Inbox receipt does not exist');
    const bookId = this._validateShelfCommit(context, receipt, commit);
    let before;
    let artifact;
    let after;
    try {
      context.store._assertPhysicalBoundary(
        context.store.paths.libraryRoot,
        receipt.artifact.path,
        { mustBeRegularFile: true },
      );
      before = this.fs.lstatSync(receipt.artifact.path);
      artifact = await digestFile(receipt.artifact.path, this.fs);
      after = this.fs.lstatSync(receipt.artifact.path);
    } catch {
      throw codedError('LIBRARY_ACQUISITION_ARTIFACT_UNAVAILABLE', 'Inbox artifact could not be safely revalidated');
    }
    const stableArtifact = before.isFile() && !before.isSymbolicLink()
      && after.isFile() && !after.isSymbolicLink()
      && String(before.dev) === String(after.dev)
      && String(before.ino) === String(after.ino)
      && before.size === after.size
      && before.mtimeMs === after.mtimeMs
      && before.ctimeMs === after.ctimeMs;
    if (!stableArtifact || artifact.sha256 !== receipt.artifact.sha256
      || artifact.size !== receipt.artifact.size) {
      throw codedError('LIBRARY_ACQUISITION_ARTIFACT_CHANGED', 'Inbox artifact no longer matches its verified immutable receipt');
    }
    // The digest above is an await boundary: another exact consumer may have
    // committed the same pending snapshot while this call was hashing.  From
    // here on, always act on freshly re-read durable facts.  Revision conflicts
    // are retried only by re-reading; a genuinely different book/receipt still
    // fails closed.
    let mutated = false;
    for (;;) {
      const currentReceipt = context.store.getInboxReceipt(receipt.receiptId);
      if (!currentReceipt) throw codedError('LIBRARY_ACQUISITION_INBOX_NOT_FOUND', 'Inbox receipt no longer exists');
      this._validateShelfCommit(context, currentReceipt, commit);
      let job = context.store.getJob(currentReceipt.jobId);
      if (!job) throw codedError('LIBRARY_ACQUISITION_JOB_NOT_FOUND', 'Inbox Job does not exist');
      if (job.bookId && job.bookId !== bookId) {
        throw codedError('LIBRARY_ACQUISITION_COMMIT_CONFLICT', 'Inbox Job already belongs to another shelf identity');
      }
      if (job.state === 'imported') {
        if (job.bookId !== bookId || currentReceipt.state !== 'acknowledged') {
          throw codedError('LIBRARY_ACQUISITION_COMMIT_CONFLICT', 'terminal Inbox fact differs from this shelf commit');
        }
        return Object.freeze({ receipt: currentReceipt, job, idempotent: !mutated });
      }
      if (job.state === 'paused' && job.retryFrom === 'awaiting-import') {
        try {
          context.store.transitionJob(job.jobId, 'awaiting-import', {
            expectedRevision: job.revision,
            patch: { error: null },
          });
          mutated = true;
        } catch (error) {
          if (error?.code !== 'LIBRARY_ACQUISITION_REVISION_CONFLICT') throw error;
        }
        continue;
      }
      if (job.state !== 'awaiting-import') {
        throw codedError('LIBRARY_ACQUISITION_INVALID_STATE', 'Inbox Job is not awaiting shelf import');
      }
      if (commit.expectedJobRevision !== undefined && commit.expectedJobRevision !== job.revision
        && !job.bookId) {
        throw codedError('LIBRARY_ACQUISITION_REVISION_CONFLICT', 'Inbox Job revision changed');
      }
      if (!job.bookId) {
        try {
          context.store.updateJob(job.jobId, {
            expectedRevision: job.revision,
            patch: { bookId },
          });
          mutated = true;
        } catch (error) {
          if (error?.code !== 'LIBRARY_ACQUISITION_REVISION_CONFLICT') throw error;
        }
        continue;
      }
      if (currentReceipt.state === 'pending') {
        try {
          context.store.acknowledgeInboxReceipt(currentReceipt.receiptId, {
            expectedRevision: currentReceipt.revision,
          });
          mutated = true;
        } catch (error) {
          if (error?.code !== 'LIBRARY_ACQUISITION_REVISION_CONFLICT') throw error;
        }
        continue;
      }
      if (currentReceipt.state !== 'acknowledged') {
        throw codedError('LIBRARY_ACQUISITION_COMMIT_CONFLICT', 'Inbox receipt has a conflicting terminal state');
      }
      try {
        context.store.transitionJob(job.jobId, 'imported', { expectedRevision: job.revision });
        mutated = true;
      } catch (error) {
        if (error?.code !== 'LIBRARY_ACQUISITION_REVISION_CONFLICT') throw error;
      }
    }
  }

  // Compatibility spelling for the main-process IPC bridge.
  commitShelfReceipt(selector, receiptIdOrCommit, maybeCommit) {
    // Renderer-facing adapter shape:
    //   commitShelfReceipt(receiptId, commit, { workspaceToken })
    // The Workspace identity remains part of the immutable commit while the
    // session token is carried separately and is never persisted.
    if (typeof selector === 'string' && isPlainRecord(receiptIdOrCommit)
      && isPlainRecord(maybeCommit) && typeof receiptIdOrCommit.workspaceIdentity === 'string') {
      return this.completeInbox({
        workspaceIdentity: receiptIdOrCommit.workspaceIdentity,
        workspaceToken: maybeCommit.workspaceToken,
      }, selector, receiptIdOrCommit);
    }
    return this.completeInbox(selector, receiptIdOrCommit, maybeCommit);
  }

  _jobFormat(job) {
    const match = /^payload\.(epub|cbz|txt|mobi|azw3|pdf)\.part$/.exec(path.basename(job.stagingPath || ''));
    return match?.[1] || '';
  }

  async _findPublishedArtifact(context, job) {
    const digest = job.integrity?.sha256;
    const format = this._jobFormat(job);
    if (!/^[a-f0-9]{64}$/.test(digest || '') || !format) return null;
    const marker = `(${digest})`;
    const candidates = [];
    for (const entry of this.fs.readdirSync(context.store.paths.libraryRoot, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()
        || path.extname(entry.name).toLowerCase() !== `.${format}`
        || !entry.name.includes(marker)) continue;
      const artifactPath = path.join(context.store.paths.libraryRoot, entry.name);
      try {
        context.store._assertPhysicalBoundary(context.store.paths.libraryRoot, artifactPath, { mustBeRegularFile: true });
        const before = this.fs.lstatSync(artifactPath);
        const actual = await digestFile(artifactPath, this.fs);
        const after = this.fs.lstatSync(artifactPath);
        const stable = before.isFile() && !before.isSymbolicLink()
          && after.isFile() && !after.isSymbolicLink()
          && String(before.dev) === String(after.dev)
          && String(before.ino) === String(after.ino)
          && before.size === after.size
          && before.mtimeMs === after.mtimeMs
          && before.ctimeMs === after.ctimeMs;
        if (stable && actual.sha256 === digest && actual.size === job.bytes.received) candidates.push(artifactPath);
      } catch {
        // A changed/unreadable candidate is not proof of publication.  Keep
        // the Job paused and require explicit repair rather than guessing.
      }
    }
    return candidates.sort((left, right) => left.localeCompare(right, 'en'))[0] || null;
  }

  async reconcileWorkspace(selector) {
    const context = this._workspace(selector);
    const actions = [];
    for (const job of context.store.listJobs()) {
      let current = context.store.getJob(job.jobId);
      if (current.state === 'materializing'
        || (current.state === 'paused' && current.retryFrom === 'materializing')
        || (current.state === 'failed' && current.retryFrom === 'materializing')) {
        const published = await this._findPublishedArtifact(context, current);
        if (published) {
          if (current.state !== 'materializing') {
            current = context.store.transitionJob(current.jobId, 'materializing', {
              expectedRevision: current.revision,
              patch: { error: null },
            });
          }
          current = context.store.transitionJob(current.jobId, 'awaiting-import', {
            expectedRevision: current.revision,
            patch: { finalPath: published },
          });
          this._ensureInbox(context, current, this._jobFormat(current));
          actions.push(Object.freeze({ jobId: current.jobId, action: 'PUBLICATION_RECONCILED' }));
        }
      }
      if (current.state === 'paused' && current.retryFrom === 'awaiting-import' && current.bookId) {
        const receipts = context.store.listInboxReceipts().filter(item => item.jobId === current.jobId);
        if (receipts.some(item => item.state === 'acknowledged')) {
          current = context.store.transitionJob(current.jobId, 'awaiting-import', {
            expectedRevision: current.revision,
            patch: { error: null },
          });
        }
      }
      if (current.state !== 'awaiting-import') continue;
      let receipts = context.store.listInboxReceipts().filter(item => item.jobId === current.jobId);
      if (!receipts.length) {
        const format = path.extname(current.finalPath).slice(1).toLowerCase();
        this._ensureInbox(context, current, format);
        receipts = context.store.listInboxReceipts().filter(item => item.jobId === current.jobId);
        actions.push(Object.freeze({ jobId: current.jobId, action: 'INBOX_RECREATED' }));
      }
      const acknowledged = receipts.find(item => item.state === 'acknowledged');
      if (acknowledged && current.bookId) {
        current = context.store.transitionJob(current.jobId, 'imported', { expectedRevision: current.revision });
        actions.push(Object.freeze({ jobId: current.jobId, action: 'IMPORTED_RECONCILED' }));
      }
    }
    return Object.freeze(actions);
  }

  async recoverAfterRestart(selector = null) {
    const contexts = selector ? [this._workspace(selector)] : [...this.workspaces.values()];
    const result = [];
    for (const context of contexts) {
      const recovered = context.store.recoverAfterRestart();
      result.push(...recovered.map(job => Object.freeze({ jobId: job.jobId, action: 'PAUSED_AFTER_RESTART' })));
      // Reconciliation uses only durable filesystem facts.  It never resolves
      // a hostname or resumes transport.
      result.push(...await this.reconcileWorkspace(context.workspaceIdentity));
    }
    return Object.freeze(result);
  }

  async shutdown() {
    this.accepting = false;
    const promises = [...this.workspaceRecovery.values()
      .filter(entry => !entry.settled)
      .map(entry => entry.promise)];
    for (const active of this.active.values()) {
      const current = active.context.store.getJob(active.jobId);
      let shutdownRequested = false;
      if (active.phase === 'starting' || current?.state === 'queued' || current?.state === 'downloading') {
        active.requested = 'shutdown';
        shutdownRequested = true;
        this.resourceLedger?.update?.(active.resourceKey, { state: 'stopping' });
        active.controller.abort();
      }
      promises.push(active.promise.catch(error => {
        // Verification/materialization may report a normal acquisition
        // failure after persisting an exact failed/awaiting-import fact.  Once
        // its owner has released, that is a product outcome for the Library to
        // show and retry, not a quit-durability failure.  A transfer that this
        // shutdown actively aborted must still prove its pause boundary and
        // therefore never uses this classification.
        if (!shutdownRequested) {
          const receipt = this.getDurableCompletionReceipt(error);
          if (receipt
            && receipt.workspaceIdentity === active.context.workspaceIdentity
            && receipt.jobId === active.jobId) return receipt;
        }
        throw error;
      }));
    }
    for (const record of [...this.browserDownloads.values()]) {
      record.controller.abort();
      if (record.promise) {
        promises.push(record.promise);
        continue;
      }
      // The service does not own Electron's DownloadItem and therefore cannot
      // prove that its writer has stopped.  Only the bridge's explicit
      // completed/interrupted settlement may fsync, identity-check and release
      // this owner.  Retain it and fail shutdown closed instead of inventing a
      // durable paused receipt from a path that may still be changing.
      record.requested = 'shutdown';
      this.resourceLedger?.update?.(record.resourceKey, { state: 'stopping' });
      promises.push(Promise.reject(codedError(
        'LIBRARY_ACQUISITION_BROWSER_SHUTDOWN_UNSETTLED',
        'an active Browser download has not supplied a durable terminal observation',
      )));
    }
    const settled = await Promise.allSettled(promises);
    const failures = settled
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);
    if (failures.length) {
      const error = new AggregateError(
        failures,
        'one or more acquisition owners could not be settled durably during shutdown',
      );
      error.code = 'LIBRARY_ACQUISITION_SHUTDOWN_DURABILITY_FAILED';
      error.failureCount = failures.length;
      const primaryCode = failures.find(failure => (
        typeof failure?.code === 'string' && /^[A-Z][A-Z0-9_.-]*$/.test(failure.code)
      ))?.code;
      if (primaryCode) error.primaryCode = primaryCode;
      throw error;
    }
    return settled;
  }

  snapshot() {
    const activeRecords = [...this.active.values()];
    return Object.freeze({
      accepting: this.accepting,
      activeCount: this.active.size + this.browserDownloads.size,
      httpActiveCount: activeRecords.filter(record => record.transport === 'https').length,
      torrentActiveCount: activeRecords.filter(record => record.transport === 'magnet').length,
      browserActiveCount: this.browserDownloads.size,
      workspaces: Object.freeze([...this.workspaces.values()].map(context => Object.freeze({
        workspaceIdentity: context.workspaceIdentity,
        jobs: context.store.listJobs(),
        inbox: context.store.listInboxReceipts(),
      }))),
    });
  }
}

module.exports = LibraryAcquisitionService;
module.exports.LibraryAcquisitionService = LibraryAcquisitionService;
module.exports.verifyPayload = verifyPayload;
module.exports.inspectMagic = inspectMagic;
module.exports.inspectZipArchive = inspectZipArchive;
module.exports._forTests = { digestFile, toJobError, promotionLeaf };
