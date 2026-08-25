'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const contract = require('./library-resource-contract');

const SUPPORTED_FORMATS = new Set(contract.FORMATS);
const FORBIDDEN_MAGNET_KEYS = new Set([
  'tr', 'ws', 'xs', 'as', 'kt', 'x.pe', 'so', 'xl', 'mt', 'x.mt', 'x.pn',
]);

function codedError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, options);
  return error;
}

function base32ToHex(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let accumulator = 0;
  let bits = 0;
  let hex = '';
  for (const char of value.toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw codedError('LIBRARY_TORRENT_MAGNET_INVALID', 'BTIH base32 is invalid');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      hex += ((accumulator >>> bits) & 0xff).toString(16).padStart(2, '0');
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits !== 0 || hex.length !== 40) {
    throw codedError('LIBRARY_TORRENT_MAGNET_INVALID', 'BTIH base32 must encode exactly 160 bits');
  }
  return hex;
}

function parsePublicDhtMagnet(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw codedError('LIBRARY_TORRENT_MAGNET_INVALID', 'magnet must be an exact non-empty string');
  }
  let parsed;
  try { parsed = new URL(value); } catch {
    throw codedError('LIBRARY_TORRENT_MAGNET_INVALID', 'magnet URL is invalid');
  }
  if (parsed.protocol !== 'magnet:') {
    throw codedError('LIBRARY_TORRENT_MAGNET_INVALID', 'only magnet transport is supported');
  }
  const xt = [];
  let displayName = '';
  let displayNameSeen = false;
  for (const [key, item] of parsed.searchParams) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'xt') {
      xt.push(item);
      continue;
    }
    if (normalizedKey === 'dn') {
      if (displayNameSeen) {
        throw codedError('LIBRARY_TORRENT_MAGNET_INVALID', 'magnet may contain only one display name');
      }
      displayNameSeen = true;
      displayName = item;
      continue;
    }
    if (FORBIDDEN_MAGNET_KEYS.has(normalizedKey)) {
      throw codedError(
        'LIBRARY_TORRENT_PRIVATE_COORDINATE_UNSUPPORTED',
        'tracker, webseed, source and preselection magnet parameters are not accepted',
      );
    }
    throw codedError('LIBRARY_TORRENT_MAGNET_PARAMETER_UNSUPPORTED', 'magnet contains an unsupported parameter');
  }
  if (xt.length !== 1 || !/^urn:btih:/i.test(xt[0])) {
    throw codedError('LIBRARY_TORRENT_MAGNET_INVALID', 'magnet must contain exactly one BTIH identity');
  }
  const encoded = xt[0].slice('urn:btih:'.length);
  let infoHash;
  try {
    const normalized = contract.normalizeInfoHash(encoded, 'infoHash');
    infoHash = normalized.length === 32 ? base32ToHex(normalized) : normalized.toLowerCase();
    contract.normalizeInfoHash(infoHash, 'infoHash');
  } catch {
    throw codedError('LIBRARY_TORRENT_MAGNET_INVALID', 'magnet BTIH is invalid');
  }
  return Object.freeze({
    infoHash,
    canonicalMagnet: `magnet:?xt=urn:btih:${infoHash}`,
    displayName,
  });
}

function normalizeTorrentFileCatalog(files) {
  if (!Array.isArray(files)) {
    throw codedError('LIBRARY_TORRENT_METADATA_INVALID', 'torrent metadata files must be an array');
  }
  const seen = new Set();
  const result = [];
  for (const [index, file] of files.entries()) {
    if (!file || Object.getPrototypeOf(file) !== Object.prototype) {
      throw codedError('LIBRARY_TORRENT_METADATA_INVALID', `torrent file ${index} is invalid`);
    }
    if (typeof file.path !== 'string' || !Number.isSafeInteger(file.length) || file.length < 0) {
      throw codedError('LIBRARY_TORRENT_METADATA_INVALID', `torrent file ${index} has invalid path or size`);
    }
    let normalizedPath;
    try { normalizedPath = contract.normalizeRelativePosixPath(file.path, `files[${index}].path`); }
    catch {
      throw codedError('LIBRARY_TORRENT_METADATA_INVALID', `torrent file ${index} path is unsafe`);
    }
    if (normalizedPath !== file.path) {
      throw codedError('LIBRARY_TORRENT_METADATA_INVALID', `torrent file ${index} path was not canonical`);
    }
    if (seen.has(normalizedPath)) {
      throw codedError('LIBRARY_TORRENT_METADATA_INVALID', 'torrent metadata contains duplicate file paths');
    }
    seen.add(normalizedPath);
    const extension = path.posix.extname(normalizedPath).slice(1).toLowerCase();
    if (!SUPPORTED_FORMATS.has(extension)) continue;
    result.push(Object.freeze({ path: normalizedPath, size: file.length, format: extension }));
  }
  if (!result.length) {
    throw codedError('LIBRARY_TORRENT_NO_READABLE_FILES', 'torrent has no supported readable book file');
  }
  result.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  return Object.freeze(result);
}

function callDestroy(target, options) {
  if (!target || typeof target.destroy !== 'function' || target.destroyed) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = error => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve();
    };
    try {
      const result = options === undefined
        ? target.destroy(done)
        : target.destroy(options, done);
      if (result?.then) result.then(() => done(), done);
    } catch (error) { done(error); }
  });
}

function waitForTorrentReady(torrent, signal) {
  if (torrent?.ready) return Promise.resolve(torrent);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      torrent?.removeListener?.('ready', onReady);
      torrent?.removeListener?.('error', onError);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const onReady = () => { cleanup(); resolve(torrent); };
    const onError = error => { cleanup(); reject(error); };
    const onAbort = () => {
      cleanup();
      reject(codedError('LIBRARY_TORRENT_ABORTED', 'torrent operation was interrupted', { name: 'AbortError' }));
    };
    torrent?.once?.('ready', onReady);
    torrent?.once?.('error', onError);
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function createFlatFileStore(fsImpl, filePath) {
  return class FlatFileChunkStore {
    constructor(chunkLength, options = {}) {
      this.chunkLength = Number(chunkLength);
      this.length = Number(options.length);
      if (!Number.isSafeInteger(this.chunkLength) || this.chunkLength <= 0
        || !Number.isSafeInteger(this.length) || this.length < 0) {
        throw codedError('LIBRARY_TORRENT_STORE_INVALID', 'torrent piece store dimensions are invalid');
      }
      this.fd = fsImpl.openSync(filePath, 'wx+');
      this.closed = false;
    }

    put(index, buffer, callback = () => {}) {
      if (this.closed) return queueMicrotask(() => callback(codedError('LIBRARY_TORRENT_STORE_CLOSED', 'piece store is closed')));
      const position = index * this.chunkLength;
      const source = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      let offset = 0;
      const writeNext = () => {
        fsImpl.write(this.fd, source, offset, source.length - offset, position + offset, (error, written) => {
          if (error) return callback(error);
          if (!written) return callback(codedError('LIBRARY_TORRENT_STORE_WRITE_FAILED', 'piece store write made no progress'));
          offset += written;
          if (offset < source.length) return writeNext();
          callback(null);
        });
      };
      writeNext();
    }

    get(index, options, callback) {
      if (typeof options === 'function') { callback = options; options = {}; }
      callback ||= () => {};
      if (this.closed) return queueMicrotask(() => callback(codedError('LIBRARY_TORRENT_STORE_CLOSED', 'piece store is closed')));
      const pieceStart = index * this.chunkLength;
      const pieceLength = Math.min(this.chunkLength, this.length - pieceStart);
      const offset = options?.offset || 0;
      const length = options?.length || (pieceLength - offset);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0
        || offset + length > pieceLength) {
        return queueMicrotask(() => callback(codedError('LIBRARY_TORRENT_STORE_READ_FAILED', 'piece read range is invalid')));
      }
      const output = Buffer.alloc(length);
      let received = 0;
      const readNext = () => {
        fsImpl.read(this.fd, output, received, length - received, pieceStart + offset + received, (error, bytesRead) => {
          if (error) return callback(error);
          if (!bytesRead && received < length) {
            const missing = codedError('LIBRARY_TORRENT_PIECE_MISSING', 'torrent piece is not present');
            missing.notFound = true;
            return callback(missing);
          }
          received += bytesRead;
          if (received < length) return readNext();
          callback(null, output);
        });
      };
      if (length === 0) return queueMicrotask(() => callback(null, output));
      readNext();
    }

    close(callback = () => {}) {
      if (this.closed) return queueMicrotask(() => callback(null));
      this.closed = true;
      fsImpl.close(this.fd, callback);
    }

    destroy(callback = () => {}) {
      const remove = closeError => {
        fsImpl.unlink(filePath, unlinkError => {
          if (unlinkError?.code === 'ENOENT') unlinkError = null;
          callback(closeError || unlinkError || null);
        });
      };
      if (this.closed) return remove(null);
      this.close(remove);
    }
  };
}

class LibraryTorrentBookTransport {
  constructor({
    loadWebTorrent = () => import('webtorrent'),
    fsImpl = fs,
    resourceLedger = null,
  } = {}) {
    if (typeof loadWebTorrent !== 'function') {
      throw codedError('LIBRARY_TORRENT_RUNTIME_REQUIRED', 'torrent transport requires a WebTorrent loader');
    }
    this.loadWebTorrent = loadWebTorrent;
    this.fs = fsImpl;
    this.resourceLedger = resourceLedger;
    this.operations = new Set();
    this.accepting = true;
  }

  async _client() {
    const loaded = await this.loadWebTorrent();
    const WebTorrent = loaded?.default || loaded;
    if (typeof WebTorrent !== 'function') {
      throw codedError('LIBRARY_TORRENT_RUNTIME_REQUIRED', 'WebTorrent runtime is unavailable');
    }
    return new WebTorrent({
      tracker: false,
      lsd: false,
      webSeeds: false,
      natUpnp: false,
      natPmp: false,
      seedOutgoingConnections: false,
    });
  }

  _begin(kind, infoHash, parentSignal) {
    if (!this.accepting) throw codedError('LIBRARY_TORRENT_SHUTTING_DOWN', 'torrent transport is stopping');
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    parentSignal?.addEventListener?.('abort', forwardAbort, { once: true });
    if (parentSignal?.aborted) controller.abort();
    const operation = {
      kind, infoHash, controller, parentSignal, forwardAbort,
      client: null, torrent: null, iterator: null, resourceKey: null, promise: null,
    };
    operation.resourceKey = this.resourceLedger?.register?.({
      type: 'library-torrent',
      id: `${kind}:${crypto.createHash('sha256').update(infoHash, 'ascii').digest('hex')}`,
      owner: 'library-torrent-book-transport',
      state: kind,
      meta: { transport: 'magnet' },
    }) || null;
    this.operations.add(operation);
    return operation;
  }

  async _settle(operation, reason) {
    operation.parentSignal?.removeEventListener?.('abort', operation.forwardAbort);
    let primary = null;
    try { await operation.iterator?.return?.(); } catch (error) { primary = error; }
    try { await callDestroy(operation.torrent, { destroyStore: true }); } catch (error) { primary ||= error; }
    try { await callDestroy(operation.client); } catch (error) { primary ||= error; }
    this.operations.delete(operation);
    if (operation.resourceKey) {
      this.resourceLedger?.release?.(operation.resourceKey, { reason, state: 'released' });
      operation.resourceKey = null;
    }
    if (primary) {
      throw codedError('LIBRARY_TORRENT_CLEANUP_FAILED', 'torrent owner cleanup did not settle');
    }
  }

  async inspect({ magnet, p2pConsent, signal } = {}) {
    if (p2pConsent !== true) {
      throw codedError('LIBRARY_TORRENT_P2P_CONSENT_REQUIRED', 'metadata inspection requires explicit P2P consent');
    }
    const parsed = parsePublicDhtMagnet(magnet);
    const operation = this._begin('inspecting', parsed.infoHash, signal);
    operation.promise = (async () => {
      let outcome = 'failed';
      try {
        operation.client = await this._client();
        operation.torrent = operation.client.add(parsed.canonicalMagnet, {
          deselect: true,
          store: require('memory-chunk-store'),
          uploads: 0,
        });
        const torrent = await waitForTorrentReady(operation.torrent, operation.controller.signal);
        if (torrent.private === true || torrent.announce?.length || torrent.urlList?.length) {
          throw codedError(
            'LIBRARY_TORRENT_PRIVATE_COORDINATE_UNSUPPORTED',
            'private, tracker-bound and webseed torrents are not accepted in W93F',
          );
        }
        const files = normalizeTorrentFileCatalog(torrent.files.map(file => ({
          path: file.path,
          length: file.length,
        })));
        outcome = 'inspected';
        return Object.freeze({
          infoHash: parsed.infoHash,
          // `dn` is an untrusted transport hint and never becomes durable
          // metadata. Only metadata's own title may describe the Candidate.
          title: typeof torrent.name === 'string' && torrent.name ? torrent.name : 'Torrent book',
          files,
        });
      } catch (error) {
        if (operation.controller.signal.aborted && error?.code !== 'LIBRARY_TORRENT_ABORTED') {
          throw codedError('LIBRARY_TORRENT_ABORTED', 'torrent inspection was interrupted', { name: 'AbortError' });
        }
        if (typeof error?.code === 'string' && error.code.startsWith('LIBRARY_TORRENT_')) throw error;
        throw codedError('LIBRARY_TORRENT_RUNTIME_FAILED', 'torrent metadata inspection failed');
      } finally {
        await this._settle(operation, outcome);
      }
    })();
    return operation.promise;
  }

  async download({ infoHash, selectedFile, pieceStorePath, p2pConsent, signal, onChunk } = {}) {
    if (p2pConsent !== true) {
      throw codedError('LIBRARY_TORRENT_P2P_CONSENT_REQUIRED', 'torrent download requires explicit P2P consent');
    }
    const canonicalInfoHash = contract.normalizeInfoHash(infoHash, 'infoHash');
    if (!/^[a-f0-9]{40}$/.test(canonicalInfoHash)) {
      throw codedError('LIBRARY_TORRENT_INFOHASH_INVALID', 'torrent download requires canonical hex BTIH');
    }
    const canonicalFile = contract.normalizeRelativePosixPath(selectedFile, 'selectedFile');
    if (canonicalFile !== selectedFile || typeof onChunk !== 'function') {
      throw codedError('LIBRARY_TORRENT_SELECTION_INVALID', 'torrent download selection is invalid');
    }
    if (typeof pieceStorePath !== 'string' || !path.isAbsolute(pieceStorePath)) {
      throw codedError('LIBRARY_TORRENT_STORE_INVALID', 'torrent piece store path must be main-owned');
    }
    const operation = this._begin('downloading', canonicalInfoHash, signal);
    operation.promise = (async () => {
      let outcome = 'failed';
      try {
        operation.client = await this._client();
        operation.torrent = operation.client.add(`magnet:?xt=urn:btih:${canonicalInfoHash}`, {
          deselect: true,
          store: createFlatFileStore(this.fs, pieceStorePath),
          destroyStoreOnDestroy: true,
          uploads: 0,
        });
        const torrent = await waitForTorrentReady(operation.torrent, operation.controller.signal);
        if (torrent.private === true || torrent.announce?.length || torrent.urlList?.length) {
          throw codedError('LIBRARY_TORRENT_PRIVATE_COORDINATE_UNSUPPORTED', 'torrent transport coordinates changed');
        }
        const catalog = normalizeTorrentFileCatalog(torrent.files.map(file => ({ path: file.path, length: file.length })));
        const selected = catalog.find(file => file.path === canonicalFile);
        const file = torrent.files.find(item => item.path === canonicalFile);
        if (!selected || !file || file.length !== selected.size) {
          throw codedError('LIBRARY_TORRENT_SELECTION_CHANGED', 'selected torrent file is absent from current metadata');
        }
        file.select(1);
        operation.iterator = file[Symbol.asyncIterator]();
        let received = 0;
        for (;;) {
          if (operation.controller.signal.aborted) {
            throw codedError('LIBRARY_TORRENT_ABORTED', 'torrent download was interrupted', { name: 'AbortError' });
          }
          const next = await operation.iterator.next();
          if (next.done) break;
          const chunk = Buffer.from(next.value);
          received += chunk.length;
          if (received > selected.size) {
            throw codedError('LIBRARY_TORRENT_LENGTH_MISMATCH', 'torrent file exceeded declared metadata size');
          }
          await onChunk(chunk, Object.freeze({ received, total: selected.size }));
        }
        if (received !== selected.size) {
          throw codedError('LIBRARY_TORRENT_LENGTH_MISMATCH', 'torrent file ended before declared metadata size');
        }
        outcome = 'completed';
        return Object.freeze({ bytes: received, total: selected.size, pieceVerified: true });
      } catch (error) {
        if (operation.controller.signal.aborted && error?.code !== 'LIBRARY_TORRENT_ABORTED') {
          throw codedError('LIBRARY_TORRENT_ABORTED', 'torrent download was interrupted', { name: 'AbortError' });
        }
        if (typeof error?.code === 'string' && error.code.startsWith('LIBRARY_TORRENT_')) throw error;
        throw codedError('LIBRARY_TORRENT_RUNTIME_FAILED', 'torrent book transfer failed');
      } finally {
        await this._settle(operation, outcome);
      }
    })();
    return operation.promise;
  }

  async shutdown() {
    this.accepting = false;
    for (const operation of this.operations) operation.controller.abort();
    const settled = await Promise.allSettled([...this.operations].map(operation => operation.promise).filter(Boolean));
    const failures = settled.filter(item => item.status === 'rejected').map(item => item.reason);
    if (this.operations.size || failures.some(error => error?.code !== 'LIBRARY_TORRENT_ABORTED')) {
      const error = new AggregateError(failures, 'torrent transport did not settle cleanly');
      error.code = 'LIBRARY_TORRENT_SHUTDOWN_FAILED';
      throw error;
    }
    return settled;
  }

  snapshot() {
    const operations = [...this.operations];
    return Object.freeze({
      accepting: this.accepting,
      activeCount: operations.length,
      inspectCount: operations.filter(item => item.kind === 'inspecting').length,
      downloadCount: operations.filter(item => item.kind === 'downloading').length,
    });
  }
}

module.exports = LibraryTorrentBookTransport;
module.exports.LibraryTorrentBookTransport = LibraryTorrentBookTransport;
module.exports.parsePublicDhtMagnet = parsePublicDhtMagnet;
module.exports.normalizeTorrentFileCatalog = normalizeTorrentFileCatalog;
module.exports._forTests = { base32ToHex, createFlatFileStore, waitForTorrentReady };
