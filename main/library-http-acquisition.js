'use strict';

// W93B HTTP byte transport.  The transport is inert until download() is
// explicitly called and both a resolver and requester have been injected.
// Response bodies are consumed as streams; no whole-response Buffer or IPC
// payload is produced.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const https = require('node:https');
const dns = require('node:dns');
const contract = require('./library-resource-contract');

const TRANSFER_SCHEMA = 'mazz.library-http-transfer/v1';
const TRANSFER_FIELDS = Object.freeze([
  'schema', 'jobId', 'offerId', 'candidateFingerprint', 'urlHash', 'bytes',
  'total', 'validator', 'sha256', 'updatedAt',
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function safeInteger(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw codedError('LIBRARY_HTTP_TRANSFER_CORRUPT', `${label} is not a safe non-negative integer`);
  }
  return value;
}

function payloadIdentity(stat) {
  return Object.freeze({
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeMs: Number(stat.birthtimeMs),
    ctimeMs: Number(stat.ctimeMs),
    mtimeMs: Number(stat.mtimeMs),
    size: Number(stat.size),
  });
}

function samePayloadOwner(identity, stat) {
  return Boolean(identity && stat
    && identity.dev === String(stat.dev)
    && identity.ino === String(stat.ino)
    && (!Number.isFinite(identity.birthtimeMs)
      || !Number.isFinite(Number(stat.birthtimeMs))
      || identity.birthtimeMs === Number(stat.birthtimeMs)));
}

function sameStablePayload(left, right) {
  return samePayloadOwner(left, right)
    && left.size === Number(right.size)
    && left.ctimeMs === Number(right.ctimeMs)
    && left.mtimeMs === Number(right.mtimeMs);
}

function normalizedHeaders(input) {
  const output = Object.create(null);
  if (!input || typeof input !== 'object') return output;
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = String(rawName).toLowerCase();
    if (rawValue === undefined) continue;
    if (Array.isArray(rawValue)) output[name] = rawValue.map(String).join(', ');
    else output[name] = String(rawValue);
  }
  return output;
}

function parseIpv4(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(part => (/^(?:0|[1-9][0-9]{0,2})$/.test(part) ? Number(part) : NaN));
  if (octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return octets;
}

function isUnsafeIpv4(address) {
  const value = parseIpv4(address);
  if (!value) return true;
  const [a, b, c] = value;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function expandIpv6(address) {
  let text = String(address).toLowerCase();
  const zoneIndex = text.indexOf('%');
  if (zoneIndex >= 0) text = text.slice(0, zoneIndex);
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    const ipv4 = parseIpv4(text.slice(lastColon + 1));
    if (!ipv4) return null;
    text = `${text.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[a-f0-9]{1,4}$/.test(group))) return null;
  return groups.map(group => Number.parseInt(group, 16));
}

function isUnsafeIpv6(address) {
  const groups = expandIpv6(address);
  if (!groups) return true;
  const [a, b, c, d] = groups;
  const allZero = groups.every(value => value === 0);
  const loopback = groups.slice(0, 7).every(value => value === 0) && groups[7] === 1;
  const mapped = groups.slice(0, 5).every(value => value === 0) && groups[5] === 0xffff;
  const globalUnicast = (a & 0xe000) === 0x2000;
  const documentation = a === 0x2001 && b === 0x0db8;
  const uniqueLocal = (a & 0xfe00) === 0xfc00;
  const linkLocal = (a & 0xffc0) === 0xfe80;
  const multicast = (a & 0xff00) === 0xff00;
  // IANA IPv6 Special-Purpose Address Space entries whose Globally
  // Reachable value is false/N/A.  Keep narrowly-scoped globally reachable
  // neighbours such as 2001:1::/32 and 2001:3::/32 admissible.
  const benchmarking = a === 0x2001 && b === 0x0002 && c === 0x0000; // 2001:2::/48
  const teredo = a === 0x2001 && b === 0; // 2001::/32
  const orchid = a === 0x2001 && (b & 0xfff0) === 0x0010; // 2001:10::/28
  const orchidV2 = a === 0x2001 && (b & 0xfff0) === 0x0020; // 2001:20::/28
  const documentationV2 = a === 0x3fff && (b & 0xf000) === 0; // 3fff::/20
  const segmentRoutingSids = a === 0x5f00; // 5f00::/16
  const sixToFour = a === 0x2002; // 2002::/16
  const dummy = a === 0x0100 && b === 0 && c === 0 && d === 1; // 100:0:0:1::/64
  return allZero || loopback || mapped || !globalUnicast || documentation
    || uniqueLocal || linkLocal || multicast || benchmarking || teredo || orchid
    || orchidV2 || documentationV2 || segmentRoutingSids || sixToFour || dummy;
}

function isUnsafeAddress(address) {
  const family = net.isIP(String(address));
  if (family === 4) return isUnsafeIpv4(address);
  if (family === 6) return isUnsafeIpv6(address);
  return true;
}

function normalizeResolvedAddresses(result) {
  const values = Array.isArray(result) ? result : [result];
  if (!values.length) {
    throw codedError('LIBRARY_HTTP_DNS_EMPTY', 'the resource hostname resolved to no addresses');
  }
  const normalized = values.map(value => {
    const address = typeof value === 'string' ? value : value?.address;
    const family = Number(typeof value === 'object' ? value?.family : net.isIP(address));
    if (typeof address !== 'string' || !net.isIP(address) || ![4, 6].includes(family)) {
      throw codedError('LIBRARY_HTTP_DNS_INVALID', 'the resolver returned an invalid address');
    }
    return Object.freeze({ address, family });
  });
  if (normalized.some(item => isUnsafeAddress(item.address))) {
    throw codedError('LIBRARY_HTTP_SSRF_BLOCKED', 'the resource hostname resolved to a non-public address');
  }
  return normalized;
}

function parseContentLength(value) {
  if (value === undefined || value === '') return null;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw codedError('LIBRARY_HTTP_LENGTH_INVALID', 'the response Content-Length is invalid');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw codedError('LIBRARY_HTTP_LENGTH_UNREPRESENTABLE', 'the response length cannot be represented safely');
  }
  return number;
}

function parseContentRange(value) {
  const match = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+|\*)$/.exec(value || '');
  if (!match) throw codedError('LIBRARY_HTTP_RANGE_INVALID', 'the response Content-Range is invalid');
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (![start, end, ...(total === null ? [] : [total])].every(Number.isSafeInteger)
    || start > end || (total !== null && end >= total)) {
    throw codedError('LIBRARY_HTTP_RANGE_INVALID', 'the response Content-Range is inconsistent');
  }
  return { start, end, total };
}

function parseUnsatisfiedRange(value) {
  const match = /^bytes \*\/([0-9]+)$/.exec(value || '');
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) ? total : null;
}

function validatorFromHeaders(headers) {
  const etag = headers.etag;
  if (etag && !/^W\//i.test(etag)) {
    if (/^[\x20-\x7e]+$/.test(etag)) return Object.freeze({ kind: 'etag', value: etag });
    throw codedError('LIBRARY_HTTP_VALIDATOR_INVALID', 'the response ETag is invalid');
  }
  const modified = headers['last-modified'];
  if (modified) {
    if (!/^[\x20-\x7e]+$/.test(modified) || !Number.isFinite(Date.parse(modified))) {
      throw codedError('LIBRARY_HTTP_VALIDATOR_INVALID', 'the response Last-Modified value is invalid');
    }
    return Object.freeze({ kind: 'last-modified', value: modified });
  }
  return null;
}

function sameValidator(left, right) {
  return Boolean(left && right && left.kind === right.kind && left.value === right.value);
}

function validateTransferRecord(input) {
  if (!isPlainRecord(input) || Object.keys(input).some(key => !TRANSFER_FIELDS.includes(key))
    || TRANSFER_FIELDS.some(key => !Object.prototype.hasOwnProperty.call(input, key))) {
    throw codedError('LIBRARY_HTTP_TRANSFER_CORRUPT', 'the durable transfer record shape is invalid');
  }
  if (input.schema !== TRANSFER_SCHEMA
    || typeof input.jobId !== 'string' || !input.jobId
    || typeof input.offerId !== 'string' || !input.offerId
    || !/^candidate-sha256-[a-f0-9]{64}$/.test(input.candidateFingerprint)
    || !/^[a-f0-9]{64}$/.test(input.urlHash)
    || !/^[a-f0-9]{64}$/.test(input.sha256)
    || typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt))) {
    throw codedError('LIBRARY_HTTP_TRANSFER_CORRUPT', 'the durable transfer record values are invalid');
  }
  safeInteger(input.bytes, 'transfer.bytes');
  safeInteger(input.total, 'transfer.total', { nullable: true });
  if (input.total !== null && input.bytes > input.total) {
    throw codedError('LIBRARY_HTTP_TRANSFER_CORRUPT', 'the durable transfer length is inconsistent');
  }
  if (input.validator !== null) {
    if (!isPlainRecord(input.validator)
      || !['etag', 'last-modified'].includes(input.validator.kind)
      || typeof input.validator.value !== 'string'
      || !input.validator.value
      || !/^[\x20-\x7e]+$/.test(input.validator.value)) {
      throw codedError('LIBRARY_HTTP_TRANSFER_CORRUPT', 'the durable transfer validator is invalid');
    }
  }
  contract.assertNoSecrets(input, 'HTTP transfer record');
  return Object.freeze({
    ...input,
    validator: input.validator ? Object.freeze({ ...input.validator }) : null,
  });
}

async function hashFile(filePath, fsImpl = fs) {
  const hash = crypto.createHash('sha256');
  const stream = fsImpl.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function seedFileHash(filePath, hash, fsImpl = fs) {
  const stream = fsImpl.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
}

function closeResponse(response) {
  try { response?.body?.destroy?.(); } catch {}
  try { response?.destroy?.(); } catch {}
}

function waitForWritableClose(stream) {
  if (stream.closed) return Promise.resolve();
  return new Promise(resolve => stream.once('close', resolve));
}

function waitForWritableFinishOrClose(stream, signal = null) {
  if (stream.writableFinished) return Promise.resolve();
  const closedBeforeFinish = () => codedError(
    signal?.aborted ? 'LIBRARY_ACQUISITION_ABORTED' : 'ERR_STREAM_PREMATURE_CLOSE',
    signal?.aborted
      ? 'the acquisition was interrupted'
      : 'the staging writer closed before its durable finish boundary',
  );
  if (stream.closed || stream.destroyed) return Promise.reject(closedBeforeFinish());
  return new Promise((resolveFinish, rejectFinish) => {
    let settled = false;
    const cleanup = () => {
      stream.removeListener('finish', onFinish);
      stream.removeListener('error', onError);
      stream.removeListener('close', onClose);
    };
    const settle = (error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) rejectFinish(error);
      else resolveFinish();
    };
    const onFinish = () => settle();
    const onError = error => settle(error);
    const onClose = () => settle(stream.writableFinished ? null : closedBeforeFinish());
    stream.once('finish', onFinish);
    stream.once('error', onError);
    stream.once('close', onClose);
    // Cover a close/finish that occurred immediately before listener setup.
    if (stream.writableFinished) onFinish();
    else if (stream.closed || stream.destroyed) onClose();
  });
}

function isAbortLike(error, signal = null) {
  return error?.code === 'LIBRARY_ACQUISITION_ABORTED'
    || error?.name === 'AbortError'
    || error?.code === 'ABORT_ERR'
    || (signal?.aborted && new Set([
      'ERR_STREAM_PREMATURE_CLOSE',
      'ERR_STREAM_DESTROYED',
      'ERR_OPERATION_ABORTED',
      'ECANCELED',
      'LIBRARY_HTTP_PREMATURE_EOF',
    ]).has(error?.code));
}

function ensureBody(response) {
  const body = response?.body;
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') {
    closeResponse(response);
    throw codedError('LIBRARY_HTTP_RESPONSE_STREAM_REQUIRED', 'the HTTP requester must return a response stream');
  }
  return body;
}

function createNodeResolver() {
  return (hostname, options = {}) => dns.promises.lookup(hostname, { all: true, verbatim: true, ...options });
}

function createNodeHttpsRequester() {
  return ({ url, hostname, address, family, headers, signal }) => new Promise((resolve, reject) => {
    let settled = false;
    const request = https.request(url, {
      method: 'GET',
      headers,
      signal,
      servername: hostname,
      // Do not reuse a pooled socket that predates this hop's DNS review.
      agent: false,
      lookup(_host, lookupOptions, callback) {
        if (lookupOptions?.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    }, response => {
      settled = true;
      resolve({ statusCode: response.statusCode, headers: response.headers, body: response });
    });
    request.once('error', error => {
      if (!settled) reject(error);
    });
    request.end();
  });
}

class LibraryHttpAcquisition {
  constructor({
    requester = null,
    resolver = null,
    fsImpl = fs,
    now = () => new Date(),
    randomId = () => crypto.randomUUID(),
    redirectHopBudget = 10,
  } = {}) {
    this.requester = requester;
    this.resolver = resolver;
    this.fs = fsImpl;
    this.now = now;
    this.randomId = randomId;
    if (!Number.isSafeInteger(redirectHopBudget) || redirectHopBudget < 1) {
      throw codedError('LIBRARY_HTTP_INVALID_REDIRECT_BUDGET', 'redirect hop budget must be a positive protocol safety bound');
    }
    this.redirectHopBudget = redirectHopBudget;
  }

  _now() {
    const value = this.now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw codedError('LIBRARY_HTTP_INVALID_TIME', 'the transport clock is invalid');
    return date.toISOString();
  }

  _assertInjected() {
    if (typeof this.resolver !== 'function') {
      throw codedError('LIBRARY_HTTP_RESOLVER_REQUIRED', 'HTTP acquisition requires an explicitly injected resolver');
    }
    if (typeof this.requester !== 'function') {
      throw codedError('LIBRARY_HTTP_REQUESTER_REQUIRED', 'HTTP acquisition requires an explicitly injected requester');
    }
  }

  _assertPath(filePath, stagingRoot, { regularIfExists = false } = {}) {
    const root = path.resolve(stagingRoot);
    const target = path.resolve(filePath);
    if (!contract.isPathInside(root, target)) {
      throw codedError('LIBRARY_HTTP_PATH_ESCAPE', 'HTTP acquisition staging path escapes its Workspace');
    }
    let cursor = target;
    while (!this.fs.existsSync(cursor)) {
      const parent = path.dirname(cursor);
      if (parent === cursor) throw codedError('LIBRARY_HTTP_PATH_ESCAPE', 'staging path has no contained ancestor');
      cursor = parent;
    }
    if (cursor !== root && !contract.isPathInside(root, cursor)) {
      throw codedError('LIBRARY_HTTP_PATH_ESCAPE', 'staging path escapes its lexical root');
    }
    let component = root;
    const relative = path.relative(root, cursor);
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      component = path.join(component, segment);
      const stat = this.fs.lstatSync(component);
      if (stat.isSymbolicLink()) throw codedError('LIBRARY_HTTP_PATH_ESCAPE', 'staging path traverses a linked component');
    }
    if (regularIfExists && this.fs.existsSync(target)) {
      const stat = this.fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()
        || (typeof stat.nlink === 'number' && stat.nlink !== 1)) {
        throw codedError('LIBRARY_HTTP_UNSAFE_STAGING', 'staging payload must be a regular physical file');
      }
    }
  }

  _payloadIdentityError(message = 'the active staging payload identity changed') {
    return codedError('LIBRARY_HTTP_PAYLOAD_IDENTITY_CHANGED', message, { quarantine: true });
  }

  _assertPayloadOwner(payloadPath, stagingRoot, expectedIdentity) {
    try {
      this._assertPath(payloadPath, stagingRoot, { regularIfExists: true });
    } catch (error) {
      error.quarantine = true;
      throw error;
    }
    if (!this.fs.existsSync(payloadPath)) throw this._payloadIdentityError('the active staging payload disappeared');
    const stat = this.fs.lstatSync(payloadPath);
    if (!stat.isFile() || stat.isSymbolicLink()
      || (typeof stat.nlink === 'number' && stat.nlink !== 1)
      || (expectedIdentity && !samePayloadOwner(expectedIdentity, stat))) {
      throw this._payloadIdentityError();
    }
    return payloadIdentity(stat);
  }

  _openPayloadWriter(payloadPath, stagingRoot, start, expectedIdentity) {
    let fd;
    let primary = null;
    try {
      fd = this.fs.openSync(payloadPath, expectedIdentity ? 'r+' : 'wx', 0o600);
      const stat = this.fs.fstatSync(fd);
      if (!stat.isFile() || (typeof stat.nlink === 'number' && stat.nlink !== 1)
        || (expectedIdentity && !samePayloadOwner(expectedIdentity, stat))) {
        throw this._payloadIdentityError('the payload path no longer names the active write owner');
      }
      const identity = payloadIdentity(stat);
      this._assertPayloadOwner(payloadPath, stagingRoot, identity);
      const writeStream = this.fs.createWriteStream(payloadPath, {
        fd,
        autoClose: true,
        start,
        mode: 0o600,
      });
      fd = undefined;
      return { writeStream, identity };
    } catch (error) {
      primary = error;
      throw error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); }
        catch (cleanupError) {
          if (primary) attachCleanupError(primary, cleanupError);
          else throw cleanupError;
        }
      }
    }
  }

  _truncatePayload(payloadPath, stagingRoot, expectedIdentity, length = 0) {
    let fd;
    let primary = null;
    let identity;
    try {
      fd = this.fs.openSync(payloadPath, 'r+');
      const before = this.fs.fstatSync(fd);
      if (!before.isFile() || (typeof before.nlink === 'number' && before.nlink !== 1)
        || (expectedIdentity && !samePayloadOwner(expectedIdentity, before))) {
        throw this._payloadIdentityError('the payload changed before a durable restart');
      }
      this.fs.ftruncateSync(fd, length);
      this.fs.fsyncSync(fd);
      const after = this.fs.fstatSync(fd);
      if (!samePayloadOwner(before && payloadIdentity(before), after) || Number(after.size) !== length) {
        throw this._payloadIdentityError('the payload changed during a durable restart');
      }
      identity = payloadIdentity(after);
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
    this._fsyncDirectory(path.dirname(payloadPath));
    return this._assertPayloadOwner(payloadPath, stagingRoot, identity);
  }

  _readMetadata(metadataPath, stagingRoot) {
    this._assertPath(metadataPath, stagingRoot, { regularIfExists: true });
    if (!this.fs.existsSync(metadataPath)) return null;
    let parsed;
    try { parsed = JSON.parse(this.fs.readFileSync(metadataPath, 'utf8')); }
    catch (error) {
      throw codedError('LIBRARY_HTTP_TRANSFER_CORRUPT', 'the durable transfer record cannot be parsed', { cause: error, quarantine: true });
    }
    try { return validateTransferRecord(parsed); }
    catch (error) {
      error.quarantine = true;
      throw error;
    }
  }

  _writeMetadata(metadataPath, stagingRoot, record) {
    this._assertPath(metadataPath, stagingRoot, { regularIfExists: true });
    const normalized = validateTransferRecord(record);
    const directory = path.dirname(metadataPath);
    const temporary = path.join(directory, `.${path.basename(metadataPath)}.${this.randomId()}.tmp`);
    let fd;
    let primary = null;
    try {
      fd = this.fs.openSync(temporary, 'wx', 0o600);
      this.fs.writeFileSync(fd, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      this.fs.fsyncSync(fd);
      this.fs.closeSync(fd);
      fd = undefined;
      this.fs.renameSync(temporary, metadataPath);
      this._fsyncDirectory(directory);
    } catch (error) {
      primary = error;
      throw error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch (cleanupError) { if (primary) primary.cleanupError = cleanupError; }
      }
      try { this.fs.unlinkSync(temporary); } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT' && primary) primary.cleanupError = cleanupError;
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
        try { this.fs.closeSync(fd); }
        catch (cleanupError) {
          if (primary) attachCleanupError(primary, cleanupError);
          else primary = cleanupError;
        }
      }
    }
    if (primary) throw primary;
  }

  _fsyncPayload(payloadPath, expectedIdentity = null) {
    let fd;
    let primary = null;
    let identity = expectedIdentity;
    try {
      // Windows requires a writable handle for FlushFileBuffers/fsync.
      fd = this.fs.openSync(payloadPath, 'r+');
      const before = this.fs.fstatSync(fd);
      if (!before.isFile() || (typeof before.nlink === 'number' && before.nlink !== 1)
        || (expectedIdentity && !samePayloadOwner(expectedIdentity, before))) {
        throw this._payloadIdentityError('the payload changed before its durable checkpoint');
      }
      this.fs.fsyncSync(fd);
      const after = this.fs.fstatSync(fd);
      if (!samePayloadOwner(payloadIdentity(before), after)) {
        throw this._payloadIdentityError('the payload changed during its durable checkpoint');
      }
      identity = payloadIdentity(after);
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
    this._fsyncDirectory(path.dirname(payloadPath));
    return identity;
  }

  _fsyncOpenPayload(writeStream) {
    const fd = writeStream?.fd;
    if (!Number.isInteger(fd) || fd < 0) {
      const error = codedError('LIBRARY_HTTP_PAYLOAD_FD_UNAVAILABLE', 'the active payload descriptor is unavailable for a durable checkpoint');
      error.durabilityFailure = true;
      throw error;
    }
    try {
      this.fs.fsyncSync(fd);
    } catch (error) {
      error.durabilityFailure = true;
      throw error;
    }
  }

  _sealPartial({ job, offer, stagingRoot, payloadPath, metadataPath } = {}, primary, expectedIdentity = null) {
    if (!primary || typeof primary !== 'object') return;
    primary.partialDurable = false;
    try {
      if (primary.quarantine === true) return;
      if (!job || !offer || typeof stagingRoot !== 'string'
        || typeof payloadPath !== 'string' || typeof metadataPath !== 'string') return;
      this._assertPath(payloadPath, stagingRoot, { regularIfExists: true });
      this._assertPath(metadataPath, stagingRoot, { regularIfExists: true });
      let durableBytes = 0;
      if (this.fs.existsSync(metadataPath)) {
        const record = this._readMetadata(metadataPath, stagingRoot);
        const urlHash = sha256Text(this._safeUrl(offer.sourceUrl, 'offer.sourceUrl'));
        if (record.jobId !== job.jobId || record.offerId !== job.offerId
          || record.candidateFingerprint !== job.candidateFingerprint
          || record.urlHash !== urlHash) {
          throw codedError('LIBRARY_HTTP_TRANSFER_MISMATCH', 'partial transfer identity changed before durability sealing');
        }
        durableBytes = record.bytes;
      }
      if (this.fs.existsSync(payloadPath)) {
        const stat = this.fs.lstatSync(payloadPath);
        if (!stat.isFile() || stat.isSymbolicLink()
          || (typeof stat.nlink === 'number' && stat.nlink !== 1)
          || (expectedIdentity && !samePayloadOwner(expectedIdentity, stat))
          || stat.size < durableBytes) {
          if (expectedIdentity && !samePayloadOwner(expectedIdentity, stat)) primary.quarantine = true;
          throw codedError('LIBRARY_HTTP_TRANSFER_MISMATCH', 'partial payload cannot match its durable transfer checkpoint');
        }
        // A write can reach the filesystem just before its callback reports an
        // abort/error.  Bytes without a payload-fsync + metadata checkpoint are
        // deliberately discarded so restart never joins an unknown suffix.
        if (stat.size !== durableBytes) {
          expectedIdentity = this._truncatePayload(payloadPath, stagingRoot, expectedIdentity, durableBytes);
        }
        this._fsyncPayload(payloadPath, expectedIdentity);
      } else if (durableBytes !== 0) {
        if (expectedIdentity) primary.quarantine = true;
        throw codedError('LIBRARY_HTTP_TRANSFER_MISMATCH', 'durable partial metadata has no payload');
      }
      if (primary.durabilityFailure === true) return;
      primary.partialDurable = true;
    } catch (cleanupError) {
      primary.durabilityError = cleanupError;
      attachCleanupError(primary, cleanupError);
      for (const nested of cleanupError?.cleanupErrors || []) attachCleanupError(primary, nested);
    }
  }

  _assertDiskCapacity(stagingRoot, remainingBytes) {
    if (!Number.isSafeInteger(remainingBytes) || remainingBytes < 1
      || typeof this.fs.statfsSync !== 'function') return;
    let stat;
    try { stat = this.fs.statfsSync(stagingRoot, { bigint: true }); }
    catch (error) {
      if (['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error?.code)) return;
      throw error;
    }
    const blocks = stat.bavail ?? stat.bfree;
    const blockSize = stat.bsize ?? stat.frsize;
    if (blocks === undefined || blockSize === undefined) return;
    const available = BigInt(blocks) * BigInt(blockSize);
    if (available < BigInt(remainingBytes)) {
      throw codedError('LIBRARY_ACQUISITION_DISK_SPACE', 'the bound Workspace has insufficient current free space for the declared remaining bytes');
    }
  }

  async _resolve(urlObject) {
    try {
      const result = await this.resolver(urlObject.hostname, { all: true, verbatim: true });
      return normalizeResolvedAddresses(result);
    } catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('LIBRARY_HTTP_')) throw error;
      throw codedError('LIBRARY_HTTP_DNS_FAILED', 'the resource hostname could not be resolved safely');
    }
  }

  _safeUrl(value, label) {
    try { return contract.assertHttpsPublicUrl(value, label); }
    catch {
      throw codedError('LIBRARY_HTTP_URL_REJECTED', 'the resource URL failed the HTTPS, secret, or public-host boundary');
    }
  }

  async _requestOne(urlObject, headers, signal) {
    const addresses = await this._resolve(urlObject);
    if (signal?.aborted) throw codedError('LIBRARY_ACQUISITION_ABORTED', 'the acquisition was interrupted');
    // The requester receives a reviewed address and must connect to exactly it;
    // createNodeHttpsRequester implements this with a pinned lookup callback.
    const pinned = addresses[0];
    try {
      return await this.requester({
        url: urlObject.toString(),
        hostname: urlObject.hostname,
        servername: urlObject.hostname,
        address: pinned.address,
        family: pinned.family,
        addresses,
        headers: Object.freeze({ ...headers }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
        throw codedError('LIBRARY_ACQUISITION_ABORTED', 'the acquisition was interrupted', { cause: error });
      }
      throw codedError('LIBRARY_HTTP_REQUEST_FAILED', 'the HTTPS request failed', { cause: error });
    }
  }

  async _openResponse(initialUrl, headers, signal) {
    let current = new URL(this._safeUrl(initialUrl, 'offer.sourceUrl'));
    let hopHeaders = { ...headers };
    let crossedOrigin = false;
    let redirected = false;
    const seen = new Set();
    let redirects = 0;
    for (;;) {
      const normalized = this._safeUrl(current.toString(), 'redirect URL');
      current = new URL(normalized);
      const identity = current.toString();
      if (seen.has(identity)) throw codedError('LIBRARY_HTTP_REDIRECT_LOOP', 'the HTTPS redirect chain contains a loop');
      seen.add(identity);
      const response = await this._requestOne(current, hopHeaders, signal);
      const statusCode = Number(response?.statusCode ?? response?.status);
      const responseHeaders = normalizedHeaders(response?.headers);
      if (!REDIRECT_STATUSES.has(statusCode)) {
        return { response, statusCode, headers: responseHeaders, crossedOrigin, redirected };
      }
      closeResponse(response);
      redirects += 1;
      if (redirects > this.redirectHopBudget) {
        throw codedError('LIBRARY_HTTP_REDIRECT_BUDGET_EXCEEDED', 'the HTTPS redirect chain exceeded its protocol safety budget');
      }
      const location = responseHeaders.location;
      if (!location) throw codedError('LIBRARY_HTTP_REDIRECT_INVALID', 'the HTTPS redirect response omitted Location');
      let next;
      try { next = new URL(location, current); }
      catch (error) { throw codedError('LIBRARY_HTTP_REDIRECT_INVALID', 'the HTTPS redirect Location is invalid', { cause: error }); }
      // Every hop crosses the full secret/protocol/literal-host boundary before
      // DNS is consulted for that hop. A validator identifies the concrete URL
      // representation that produced it, not an arbitrary redirect alias. Never
      // carry Range/If-Range onto any next hop, even when the origin is unchanged.
      next = new URL(this._safeUrl(next.toString(), 'redirect URL'));
      redirected = true;
      if (next.origin !== current.origin) crossedOrigin = true;
      hopHeaders = Object.fromEntries(Object.entries(hopHeaders).filter(([name]) => {
        const normalizedName = name.toLowerCase();
        return normalizedName !== 'range' && normalizedName !== 'if-range';
      }));
      current = next;
    }
  }

  async download(options = {}) {
    const execution = { payloadIdentity: null };
    try {
      return await this._download(options, execution);
    } catch (error) {
      let primary = error;
      if (isAbortLike(primary, options?.signal)
        && primary?.code !== 'LIBRARY_ACQUISITION_ABORTED') {
        primary = codedError('LIBRARY_ACQUISITION_ABORTED', 'the acquisition was interrupted', { cause: error });
        for (const cleanupError of error?.cleanupErrors || []) attachCleanupError(primary, cleanupError);
      }
      this._sealPartial(options, primary, execution.payloadIdentity);
      throw primary;
    }
  }

  async _download({
    job,
    offer,
    stagingRoot,
    payloadPath,
    metadataPath,
    signal,
    onProgress = null,
    boundaryCheck = null,
  } = {}, execution = { payloadIdentity: null }) {
    this._assertInjected();
    if (!job || !offer || offer.transport !== 'https' || !offer.sourceUrl) {
      throw codedError('LIBRARY_HTTP_INVALID_INTENT', 'HTTP acquisition requires a bound HTTPS offer');
    }
    if (typeof stagingRoot !== 'string' || typeof payloadPath !== 'string' || typeof metadataPath !== 'string') {
      throw codedError('LIBRARY_HTTP_INVALID_STAGING', 'HTTP acquisition requires explicit Workspace staging paths');
    }
    const checkBoundary = () => {
      this._assertPath(payloadPath, stagingRoot, { regularIfExists: true });
      this._assertPath(metadataPath, stagingRoot, { regularIfExists: true });
      if (execution.payloadIdentity) {
        this._assertPayloadOwner(payloadPath, stagingRoot, execution.payloadIdentity);
      }
      if (typeof boundaryCheck === 'function') boundaryCheck();
    };
    checkBoundary();
    const urlHash = sha256Text(this._safeUrl(offer.sourceUrl, 'offer.sourceUrl'));
    let metadata = this._readMetadata(metadataPath, stagingRoot);
    let offset = 0;
    let total = null;
    let validator = null;
    let hasher = crypto.createHash('sha256');
    const payloadExists = this.fs.existsSync(payloadPath);
    if (metadata) {
      const identityMatches = metadata.jobId === job.jobId
        && metadata.offerId === job.offerId
        && metadata.candidateFingerprint === job.candidateFingerprint
        && metadata.urlHash === urlHash;
      if (!identityMatches || !payloadExists) {
        throw codedError('LIBRARY_HTTP_TRANSFER_MISMATCH', 'staging transfer identity does not match the durable Job', { quarantine: true });
      }
      const stat = this.fs.lstatSync(payloadPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== metadata.bytes
        || job.bytes.received !== metadata.bytes || job.bytes.total !== metadata.total) {
        throw codedError('LIBRARY_HTTP_TRANSFER_MISMATCH', 'staging bytes do not match the durable transfer record', { quarantine: true });
      }
      execution.payloadIdentity = payloadIdentity(stat);
      const digest = await hashFile(payloadPath, this.fs);
      if (digest !== metadata.sha256) {
        throw codedError('LIBRARY_HTTP_TRANSFER_MISMATCH', 'staging digest does not match the durable transfer record', { quarantine: true });
      }
      offset = metadata.bytes;
      total = metadata.total;
      validator = metadata.validator;
      if (offset > 0 && validator) await seedFileHash(payloadPath, hasher, this.fs);
      if (offset > 0 && !validator) {
        execution.payloadIdentity = this._truncatePayload(
          payloadPath, stagingRoot, execution.payloadIdentity, 0,
        );
        offset = 0;
        total = null;
        hasher = crypto.createHash('sha256');
        metadata = {
          schema: TRANSFER_SCHEMA,
          jobId: job.jobId,
          offerId: job.offerId,
          candidateFingerprint: job.candidateFingerprint,
          urlHash,
          bytes: 0,
          total: null,
          validator: null,
          sha256: hasher.copy().digest('hex'),
          updatedAt: this._now(),
        };
        this._writeMetadata(metadataPath, stagingRoot, metadata);
        if (typeof onProgress === 'function') await onProgress({ received: 0, total: null });
      }
    } else {
      if (payloadExists) {
        const stat = this.fs.lstatSync(payloadPath);
        execution.payloadIdentity = payloadIdentity(stat);
        if (stat.size !== 0) {
          throw codedError('LIBRARY_HTTP_TRANSFER_MISMATCH', 'unowned staging bytes require quarantine', { quarantine: true });
        }
      }
      if (job.bytes.received !== 0) {
        throw codedError('LIBRARY_HTTP_TRANSFER_MISMATCH', 'durable Job progress has no matching transfer record', { quarantine: true });
      }
    }

    let restartedFresh = false;
    for (;;) {
      if (signal?.aborted) throw codedError('LIBRARY_ACQUISITION_ABORTED', 'the acquisition was interrupted');
      const requestHeaders = Object.create(null);
      requestHeaders['Accept-Encoding'] = 'identity';
      if (offset > 0 && validator) {
        requestHeaders.Range = `bytes=${offset}-`;
        requestHeaders['If-Range'] = validator.value;
      }
      const opened = await this._openResponse(offer.sourceUrl, requestHeaders, signal);
      const { response, statusCode, headers } = opened;
      if (opened.redirected && offset > 0) {
        checkBoundary();
        execution.payloadIdentity = this._truncatePayload(
          payloadPath, stagingRoot, execution.payloadIdentity, 0,
        );
        offset = 0;
        total = null;
        validator = null;
        hasher = crypto.createHash('sha256');
        metadata = {
          schema: TRANSFER_SCHEMA,
          jobId: job.jobId,
          offerId: job.offerId,
          candidateFingerprint: job.candidateFingerprint,
          urlHash,
          bytes: 0,
          total: null,
          validator: null,
          sha256: hasher.copy().digest('hex'),
          updatedAt: this._now(),
        };
        this._writeMetadata(metadataPath, stagingRoot, metadata);
        if (typeof onProgress === 'function') await onProgress({ received: 0, total: null });
      }
      let responseStart = 0;
      let responseLength;
      let responseTotal = null;
      let responseValidator;
      let mustRestart = false;
      try {
        responseLength = parseContentLength(headers['content-length']);
        if (headers['content-encoding'] && headers['content-encoding'].toLowerCase() !== 'identity') {
          closeResponse(response);
          throw codedError('LIBRARY_HTTP_CONTENT_ENCODING_REJECTED', 'the HTTPS response did not honor identity content encoding');
        }
        // A redirect alias can change its final target while preserving an
        // opaque validator string. Never persist a validator learned through
        // any redirect chain; an interrupted redirected transfer starts fresh.
        responseValidator = opened.redirected ? null : validatorFromHeaders(headers);
        if (statusCode === 416) {
          const unsatisfiedTotal = parseUnsatisfiedRange(headers['content-range']);
          closeResponse(response);
          if (offset > 0 && unsatisfiedTotal !== null && offset === unsatisfiedTotal
            && (total === null || total === unsatisfiedTotal)) {
            total = unsatisfiedTotal;
            break;
          }
          mustRestart = true;
        } else if (statusCode === 206) {
          const range = parseContentRange(headers['content-range']);
          if (offset === 0 || range.start !== offset || range.total === null
            || (total !== null && total !== range.total)
            || !sameValidator(validator, responseValidator)) {
            closeResponse(response);
            mustRestart = true;
          } else {
            responseStart = range.start;
            responseTotal = range.total;
            if (responseLength !== null && responseLength !== (range.end - range.start + 1)) {
              closeResponse(response);
              throw codedError('LIBRARY_HTTP_LENGTH_MISMATCH', 'the ranged response length is inconsistent');
            }
          }
        } else if (statusCode === 200) {
          if (offset > 0) {
            execution.payloadIdentity = this._truncatePayload(
              payloadPath, stagingRoot, execution.payloadIdentity, 0,
            );
            offset = 0;
            total = null;
            validator = null;
            hasher = crypto.createHash('sha256');
            metadata = {
              schema: TRANSFER_SCHEMA,
              jobId: job.jobId,
              offerId: job.offerId,
              candidateFingerprint: job.candidateFingerprint,
              urlHash,
              bytes: 0,
              total: null,
              validator: null,
              sha256: hasher.copy().digest('hex'),
              updatedAt: this._now(),
            };
            this._writeMetadata(metadataPath, stagingRoot, metadata);
            if (typeof onProgress === 'function') await onProgress({ received: 0, total: null });
          }
          responseStart = 0;
          responseTotal = responseLength;
        } else {
          closeResponse(response);
          throw codedError('LIBRARY_HTTP_STATUS_REJECTED', 'the HTTPS server returned a non-success status');
        }

        if (mustRestart) {
          if (restartedFresh) {
            throw codedError('LIBRARY_HTTP_RANGE_RESTART_FAILED', 'the HTTPS server could not provide a coherent fresh response');
          }
          restartedFresh = true;
          checkBoundary();
          if (this.fs.existsSync(payloadPath)) {
            execution.payloadIdentity = this._truncatePayload(
              payloadPath, stagingRoot, execution.payloadIdentity, 0,
            );
          }
          offset = 0;
          total = null;
          validator = null;
          hasher = crypto.createHash('sha256');
          metadata = {
            schema: TRANSFER_SCHEMA,
            jobId: job.jobId,
            offerId: job.offerId,
            candidateFingerprint: job.candidateFingerprint,
            urlHash,
            bytes: 0,
            total: null,
            validator: null,
            sha256: hasher.copy().digest('hex'),
            updatedAt: this._now(),
          };
          this._writeMetadata(metadataPath, stagingRoot, metadata);
          if (typeof onProgress === 'function') await onProgress({ received: 0, total: null });
          continue;
        }

        if (responseTotal !== null) this._assertDiskCapacity(stagingRoot, responseTotal - responseStart);

        const body = ensureBody(response);
        checkBoundary();
        const openedWriter = this._openPayloadWriter(
          payloadPath, stagingRoot, responseStart, execution.payloadIdentity,
        );
        const { writeStream } = openedWriter;
        execution.payloadIdentity = openedWriter.identity;
        // Keep an error listener installed until the descriptor closes.  Chunk
        // callbacks and the surrounding try/catch still carry the primary
        // error; this listener prevents a second unhandled EventEmitter error.
        let emittedWriteError = null;
        const captureWriteError = error => { emittedWriteError = emittedWriteError || error; };
        writeStream.on('error', captureWriteError);
        // Aborting the response is what wakes a pending async-iterator read.
        // Destroy the writer without injecting a second error event; the
        // durable abort reason is handled by the coordinator exactly once.
        const abortWriter = () => {
          writeStream.destroy();
          closeResponse(response);
        };
        signal?.addEventListener?.('abort', abortWriter, { once: true });
        let responseBytes = 0;
        let primary = null;
        try {
          for await (const rawChunk of body) {
            if (signal?.aborted) throw codedError('LIBRARY_ACQUISITION_ABORTED', 'the acquisition was interrupted');
            const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
            await new Promise((resolveWrite, rejectWrite) => {
              writeStream.write(chunk, error => (error ? rejectWrite(error) : resolveWrite()));
            });
            hasher.update(chunk);
            responseBytes += chunk.length;
            offset += chunk.length;
            total = responseTotal;
            validator = responseValidator;
            // A progress/metadata checkpoint is truthful only after these
            // exact payload bytes have reached stable storage.
            this._fsyncOpenPayload(writeStream);
            checkBoundary();
            metadata = {
              schema: TRANSFER_SCHEMA,
              jobId: job.jobId,
              offerId: job.offerId,
              candidateFingerprint: job.candidateFingerprint,
              urlHash,
              bytes: offset,
              total,
              validator,
              sha256: hasher.copy().digest('hex'),
              updatedAt: this._now(),
            };
            this._writeMetadata(metadataPath, stagingRoot, metadata);
            checkBoundary();
            if (typeof onProgress === 'function') await onProgress({ received: offset, total });
          }
          this._fsyncOpenPayload(writeStream);
          checkBoundary();
          writeStream.end();
          await waitForWritableFinishOrClose(writeStream, signal);
          await waitForWritableClose(writeStream);
          if (emittedWriteError) throw emittedWriteError;
          checkBoundary();
        } catch (error) {
          primary = error;
          try { writeStream.destroy(); }
          catch (cleanupError) { attachCleanupError(primary, cleanupError); }
          closeResponse(response);
          try { await waitForWritableClose(writeStream); }
          catch (cleanupError) { attachCleanupError(primary, cleanupError); }
          if (emittedWriteError && emittedWriteError !== primary) {
            if (primary?.code === 'LIBRARY_ACQUISITION_ABORTED'
              && !isAbortLike(emittedWriteError, signal)) {
              attachCleanupError(emittedWriteError, primary);
              if (primary.durabilityFailure === true) emittedWriteError.durabilityFailure = true;
              primary = emittedWriteError;
            } else {
              attachCleanupError(primary, emittedWriteError);
            }
          }
          throw primary;
        } finally {
          signal?.removeEventListener?.('abort', abortWriter);
          writeStream.removeListener('error', captureWriteError);
          if (primary) closeResponse(response);
        }
        if (responseLength !== null && responseBytes !== responseLength) {
          throw codedError('LIBRARY_HTTP_PREMATURE_EOF', 'the HTTPS response ended before its declared length');
        }
        if (responseTotal !== null && offset !== responseTotal) {
          throw codedError('LIBRARY_HTTP_PREMATURE_EOF', 'the HTTPS response did not produce the declared complete resource');
        }
        checkBoundary();
        execution.payloadIdentity = this._fsyncPayload(payloadPath, execution.payloadIdentity);
        checkBoundary();
        metadata = {
          schema: TRANSFER_SCHEMA,
          jobId: job.jobId,
          offerId: job.offerId,
          candidateFingerprint: job.candidateFingerprint,
          urlHash,
          bytes: offset,
          total: responseTotal,
          validator: responseValidator,
          sha256: hasher.copy().digest('hex'),
          updatedAt: this._now(),
        };
        this._writeMetadata(metadataPath, stagingRoot, metadata);
        if (typeof onProgress === 'function') await onProgress({ received: offset, total: responseTotal });
        total = responseTotal;
        validator = responseValidator;
        break;
      } catch (error) {
        closeResponse(response);
        throw error;
      } finally {
        // Successful streams close themselves; redirect/error responses are
        // explicitly destroyed above.  A fixture may expose a close method on
        // the envelope rather than the body.
        if (signal?.aborted) closeResponse(response);
      }
    }
    const beforeHash = this._assertPayloadOwner(payloadPath, stagingRoot, execution.payloadIdentity);
    const sha256 = await hashFile(payloadPath, this.fs);
    const afterHash = this._assertPayloadOwner(payloadPath, stagingRoot, execution.payloadIdentity);
    const streamedSha256 = hasher.copy().digest('hex');
    if (!sameStablePayload(beforeHash, afterHash)
      || sha256 !== streamedSha256
      || metadata?.sha256 !== streamedSha256) {
      throw this._payloadIdentityError('the completed payload changed during final verification');
    }
    execution.payloadIdentity = afterHash;
    return Object.freeze({
      path: payloadPath,
      bytes: offset,
      total,
      validator,
      sha256,
      identity: afterHash,
    });
  }
}

module.exports = LibraryHttpAcquisition;
module.exports.LibraryHttpAcquisition = LibraryHttpAcquisition;
module.exports.TRANSFER_SCHEMA = TRANSFER_SCHEMA;
module.exports.createNodeResolver = createNodeResolver;
module.exports.createNodeHttpsRequester = createNodeHttpsRequester;
module.exports.isUnsafeAddress = isUnsafeAddress;
module.exports.normalizeResolvedAddresses = normalizeResolvedAddresses;
module.exports.validateTransferRecord = validateTransferRecord;
module.exports._forTests = {
  parseContentLength,
  parseContentRange,
  parseUnsatisfiedRange,
  validatorFromHeaders,
  hashFile,
};
