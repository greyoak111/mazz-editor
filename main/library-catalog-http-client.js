'use strict';

const contract = require('./library-resource-contract');
const {
  normalizeResolvedAddresses,
} = require('./library-http-acquisition');

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CONDITIONAL_HEADERS = new Set(['if-none-match', 'if-modified-since']);

function codedError(code, message, details) {
  return Object.assign(new Error(message), { code }, details || {});
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function plainRecord(value, label, fields) {
  if (!isPlainRecord(value)) throw codedError('LIBRARY_CATALOG_SCHEMA_INVALID', label + ' 必须是普通对象');
  const unknown = Object.keys(value).filter(function (key) { return !fields.includes(key); });
  if (unknown.length) throw codedError('LIBRARY_CATALOG_SCHEMA_INVALID', label + ' 含未知字段');
  return value;
}

function exactString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_CATALOG_SCHEMA_INVALID', label + ' 必须是原生精确字符串');
  }
  contract.assertNoSecretString(value, label);
  return value;
}

function providerId(value) {
  const text = exactString(value, 'providerId');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw codedError('LIBRARY_CATALOG_SCHEMA_INVALID', 'providerId 非法');
  }
  return text;
}

function normalizedHeaders(input) {
  const result = {};
  if (!input || typeof input !== 'object') return result;
  for (const [name, value] of Object.entries(input)) {
    if (Array.isArray(value)) result[String(name).toLowerCase()] = value.join(', ');
    else if (value !== undefined) result[String(name).toLowerCase()] = String(value);
  }
  return result;
}

function closeResponse(response) {
  const body = response && (response.body || response.stream);
  try { if (body && typeof body.destroy === 'function' && !body.destroyed) body.destroy(); } catch {}
  try { if (response && typeof response.close === 'function') response.close(); } catch {}
}

function parseRetryAfter(value, nowMs) {
  if (value === undefined || value === '') return '';
  const text = String(value).trim();
  if (/^(?:0|[1-9][0-9]*)$/.test(text)) {
    const seconds = Number(text);
    if (Number.isSafeInteger(seconds)) return new Date(nowMs + seconds * 1000).toISOString();
  }
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function validateContact(value) {
  const text = exactString(value, 'contact');
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return text;
  try { return contract.assertHttpsPublicUrl(text, 'contact'); }
  catch { throw codedError('LIBRARY_CATALOG_CONTACT_REQUIRED', 'catalog contact 必须是 email 或公共 HTTPS URL'); }
}

async function bodyBytes(response, signal) {
  if (signal && signal.aborted) {
    closeResponse(response);
    throw codedError('LIBRARY_SOURCE_ABORTED', 'catalog request 已取消');
  }
  const body = response && (response.body || response.stream);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') {
    throw codedError('LIBRARY_CATALOG_RESPONSE_INVALID', 'catalog requester 必须返回可读取 body');
  }
  const chunks = [];
  try {
    for await (const chunk of body) {
      if (signal && signal.aborted) {
        closeResponse(response);
        throw codedError('LIBRARY_SOURCE_ABORTED', 'catalog request 已取消');
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    closeResponse(response);
    if (signal && signal.aborted) throw codedError('LIBRARY_SOURCE_ABORTED', 'catalog request 已取消');
    throw error;
  }
}

class LibraryCatalogHttpClient {
  constructor(options) {
    const input = options || {};
    plainRecord(input, 'LibraryCatalogHttpClient options', [
      'resolver', 'requester', 'productToken', 'contact', 'now', 'redirectHopBudget',
    ]);
    if (typeof input.resolver !== 'function' || typeof input.requester !== 'function') {
      throw codedError('LIBRARY_CATALOG_TRANSPORT_REQUIRED', 'catalog client 必须显式注入 resolver/requester');
    }
    const product = exactString(input.productToken, 'productToken');
    if (!/^[A-Za-z][A-Za-z0-9._/-]*$/.test(product)) {
      throw codedError('LIBRARY_CATALOG_SCHEMA_INVALID', 'productToken 非法');
    }
    this.resolver = input.resolver;
    this.requester = input.requester;
    this.contact = validateContact(input.contact);
    this.userAgent = product + ' (+' + this.contact + ')';
    this.clock = typeof input.now === 'function' ? input.now : function () { return Date.now(); };
    this.redirectHopBudget = input.redirectHopBudget === undefined ? 10 : input.redirectHopBudget;
    if (!Number.isSafeInteger(this.redirectHopBudget) || this.redirectHopBudget < 1) {
      throw codedError('LIBRARY_CATALOG_SCHEMA_INVALID', 'redirectHopBudget 必须是正整数协议安全界');
    }
    this.closed = false;
    this.activeRequests = 0;
    this.queues = new Map();
    this.lastStartedAt = new Map();
  }

  _nowMs() {
    const value = Number(this.clock());
    if (!Number.isFinite(value)) throw codedError('LIBRARY_CATALOG_CLOCK_INVALID', 'catalog clock 非法');
    return value;
  }

  _safeUrl(value, label) {
    try { return contract.assertHttpsPublicUrl(value, label); }
    catch { throw codedError('LIBRARY_CATALOG_URL_REJECTED', label + ' 未通过公共 HTTPS/secret 边界'); }
  }

  async _resolve(urlObject) {
    try {
      const result = await this.resolver(urlObject.hostname, { all: true, verbatim: true });
      return normalizeResolvedAddresses(result);
    } catch (error) {
      if (error && typeof error.code === 'string' && error.code.startsWith('LIBRARY_HTTP_')) throw error;
      throw codedError('LIBRARY_CATALOG_DNS_FAILED', 'catalog hostname 无法安全解析', { cause: error });
    }
  }

  async _requestOne(urlObject, headers, signal) {
    const addresses = await this._resolve(urlObject);
    if (signal && signal.aborted) throw codedError('LIBRARY_SOURCE_ABORTED', 'catalog request 已取消');
    const pinned = addresses[0];
    try {
      return await this.requester({
        url: urlObject.toString(),
        hostname: urlObject.hostname,
        servername: urlObject.hostname,
        address: pinned.address,
        family: pinned.family,
        addresses: addresses,
        headers: Object.freeze(Object.assign({}, headers)),
        signal: signal,
      });
    } catch (error) {
      if ((signal && signal.aborted) || (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR'))) {
        throw codedError('LIBRARY_SOURCE_ABORTED', 'catalog request 已取消', { cause: error });
      }
      throw codedError('LIBRARY_CATALOG_REQUEST_FAILED', 'catalog HTTPS 请求失败', { cause: error });
    }
  }

  async _open(initialUrl, headers, signal) {
    let current = new URL(this._safeUrl(initialUrl, 'catalog URL'));
    let hopHeaders = Object.assign({}, headers);
    const seen = new Set();
    for (let redirects = 0; ; redirects += 1) {
      const normalized = this._safeUrl(current.toString(), 'catalog redirect URL');
      current = new URL(normalized);
      if (seen.has(current.href)) throw codedError('LIBRARY_CATALOG_REDIRECT_LOOP', 'catalog redirect 循环');
      seen.add(current.href);
      const response = await this._requestOne(current, hopHeaders, signal);
      const statusCode = Number(response && (response.statusCode === undefined ? response.status : response.statusCode));
      const responseHeaders = normalizedHeaders(response && response.headers);
      if (!REDIRECT_STATUSES.has(statusCode)) {
        return { response: response, statusCode: statusCode, headers: responseHeaders, url: current.href };
      }
      closeResponse(response);
      if (redirects + 1 > this.redirectHopBudget) {
        throw codedError('LIBRARY_CATALOG_REDIRECT_BUDGET_EXCEEDED', 'catalog redirect 超过协议安全界');
      }
      if (!responseHeaders.location) throw codedError('LIBRARY_CATALOG_REDIRECT_INVALID', 'catalog redirect 缺少 Location');
      let next;
      try { next = new URL(responseHeaders.location, current); }
      catch { throw codedError('LIBRARY_CATALOG_REDIRECT_INVALID', 'catalog redirect Location 非法'); }
      next = new URL(this._safeUrl(next.toString(), 'catalog redirect URL'));
      hopHeaders = Object.fromEntries(Object.entries(hopHeaders).filter(function (entry) {
        return !CONDITIONAL_HEADERS.has(entry[0].toLowerCase());
      }));
      current = next;
    }
  }

  _enqueue(id, action) {
    const previous = this.queues.get(id) || Promise.resolve();
    const task = previous.catch(function () {}).then(action);
    const settled = task.then(
      () => { if (this.queues.get(id) === settled) this.queues.delete(id); },
      () => { if (this.queues.get(id) === settled) this.queues.delete(id); },
    );
    this.queues.set(id, settled);
    return task;
  }

  async get(options) {
    const input = options || {};
    plainRecord(input, 'catalog GET', [
      'providerId', 'url', 'accept', 'etag', 'lastModified', 'minIntervalMs', 'signal',
    ]);
    if (this.closed) throw codedError('LIBRARY_CATALOG_CLIENT_CLOSED', 'catalog client 已关闭');
    const id = providerId(input.providerId);
    const url = this._safeUrl(input.url, 'catalog URL');
    const accept = exactString(input.accept, 'Accept');
    const etag = input.etag === undefined || input.etag === '' ? '' : exactString(input.etag, 'ETag');
    const lastModified = input.lastModified === undefined || input.lastModified === ''
      ? '' : exactString(input.lastModified, 'Last-Modified');
    const interval = input.minIntervalMs === undefined ? 0 : input.minIntervalMs;
    if (!Number.isSafeInteger(interval) || interval < 0) {
      throw codedError('LIBRARY_CATALOG_SCHEMA_INVALID', 'minIntervalMs 必须是非负协议间隔');
    }
    return this._enqueue(id, async () => {
      if (this.closed) throw codedError('LIBRARY_CATALOG_CLIENT_CLOSED', 'catalog client 已关闭');
      if (input.signal && input.signal.aborted) throw codedError('LIBRARY_SOURCE_ABORTED', 'catalog request 已取消');
      const now = this._nowMs();
      const previous = this.lastStartedAt.get(id);
      if (previous !== undefined && now - previous < interval) {
        throw codedError('LIBRARY_CATALOG_RATE_LIMITED', 'catalog 来源尚未到下一次礼貌访问时间', {
          availableAt: new Date(previous + interval).toISOString(),
        });
      }
      this.lastStartedAt.set(id, now);
      this.activeRequests += 1;
      try {
        const headers = {
          'User-Agent': this.userAgent,
          Accept: accept,
          'Accept-Encoding': 'identity',
        };
        if (etag) headers['If-None-Match'] = etag;
        else if (lastModified) headers['If-Modified-Since'] = lastModified;
        const opened = await this._open(url, headers, input.signal);
        if (opened.statusCode === 304) {
          closeResponse(opened.response);
          return Object.freeze({
            statusCode: 304, url: opened.url, headers: opened.headers,
            body: Buffer.alloc(0), notModified: true,
          });
        }
        if (opened.statusCode === 429 || opened.statusCode === 503) {
          const availableAt = parseRetryAfter(opened.headers['retry-after'], this._nowMs());
          closeResponse(opened.response);
          throw codedError('LIBRARY_CATALOG_RETRY_LATER', 'catalog 来源要求稍后重试', {
            statusCode: opened.statusCode,
            availableAt: availableAt,
          });
        }
        if (opened.statusCode < 200 || opened.statusCode >= 300) {
          closeResponse(opened.response);
          throw codedError('LIBRARY_CATALOG_HTTP_ERROR', 'catalog 来源返回非成功状态', {
            statusCode: opened.statusCode,
          });
        }
        const bytes = await bodyBytes(opened.response, input.signal);
        return Object.freeze({
          statusCode: opened.statusCode,
          url: opened.url,
          headers: opened.headers,
          body: bytes,
          notModified: false,
        });
      } finally {
        this.activeRequests -= 1;
      }
    });
  }

  snapshot() {
    return Object.freeze({
      closed: this.closed,
      activeRequests: this.activeRequests,
      queuedProviders: this.queues.size,
      timerCount: 0,
      listenerCount: 0,
    });
  }

  close() {
    if (this.activeRequests !== 0 || this.queues.size !== 0) {
      throw codedError('LIBRARY_CATALOG_BUSY', 'catalog client 仍有活动请求');
    }
    this.closed = true;
    this.lastStartedAt.clear();
    return this.snapshot();
  }
}

module.exports = {
  LibraryCatalogHttpClient,
  parseRetryAfter,
  _forTests: { bodyBytes, normalizedHeaders, validateContact },
};
