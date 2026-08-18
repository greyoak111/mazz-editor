// main/torrent-site-network.js —— W65a 可注入、可测试的礼貌访问纪律
'use strict';

class SiteRequestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SiteRequestError';
    this.code = code;
    this.details = details;
    this.transient = code === 'W65_TRANSIENT';
  }
}

function isDeterministicVisitorGate(body) {
  const text = String(body || '');
  return /name=["']visitor_test["'][^>]*value=["']human["']/i.test(text)
    && /success\s*:\s*true/i.test(text)
    && /visitor-test-form/i.test(text);
}

function hasInteractiveChallenge(body) {
  const text = String(body || '');
  if (isDeterministicVisitorGate(text)) return false;
  return /(?:g-recaptcha|h-captcha|hcaptcha|cf-turnstile|turnstile\.render|行为验证|滑动验证|人机验证)/i.test(text);
}

function isTransientNetworkError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  return /(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ERR_CONNECTION_(?:RESET|REFUSED|TIMED_OUT)|ERR_NETWORK_CHANGED)/i.test(`${code} ${message}`);
}

class PoliteSiteTransport {
  constructor({
    request,
    now = () => Date.now(),
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    minIntervalMs = 2_000,
    listTtlMs = 5 * 60_000,
    detailTtlMs = 30 * 60_000,
    retryDelaysMs = [2_000, 8_000, 20_000],
  } = {}) {
    if (typeof request !== 'function') throw new TypeError('PoliteSiteTransport requires request');
    this.requestImpl = request;
    this.now = now;
    this.wait = wait;
    this.minIntervalMs = minIntervalMs;
    this.listTtlMs = listTtlMs;
    this.detailTtlMs = detailTtlMs;
    this.retryDelaysMs = [...retryDelaysMs];
    this.cache = new Map();
    this.siteQueues = new Map();
    this.lastStartedAt = new Map();
    this.blockedSites = new Map();
  }

  clearSite(siteId) {
    this.blockedSites.delete(siteId);
    for (const key of this.cache.keys()) if (key.startsWith(`${siteId}\0`)) this.cache.delete(key);
  }

  async request(siteId, request, { kind = 'list', cache = true, bypassCache = false } = {}) {
    if (!siteId) throw new TypeError('siteId required');
    const blocked = this.blockedSites.get(siteId);
    if (blocked) throw new SiteRequestError('W65_CHALLENGE_REQUIRED', `站点 ${siteId} 需要人工验证，自动访问已停止`, blocked);
    const spec = typeof request === 'string' ? { url: request, method: 'GET' } : { method: 'GET', ...request };
    const cacheKey = `${siteId}\0${spec.method}\0${spec.url}\0${spec.body || ''}`;
    const cached = this.cache.get(cacheKey);
    if (cache && !bypassCache && cached && cached.expiresAt > this.now()) return { ...cached.response, cached: true };

    const previous = this.siteQueues.get(siteId) || Promise.resolve();
    const task = previous.then(() => this.#perform(siteId, spec), () => this.#perform(siteId, spec));
    const queued = task.then(
      () => { if (this.siteQueues.get(siteId) === queued) this.siteQueues.delete(siteId); },
      () => { if (this.siteQueues.get(siteId) === queued) this.siteQueues.delete(siteId); },
    );
    this.siteQueues.set(siteId, queued);
    const response = await task;
    if (cache && !isDeterministicVisitorGate(response.body)) {
      const ttl = kind === 'detail' ? this.detailTtlMs : this.listTtlMs;
      this.cache.set(cacheKey, { expiresAt: this.now() + ttl, response });
    }
    return response;
  }

  async #perform(siteId, spec) {
    let lastError;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
      const elapsed = this.now() - (this.lastStartedAt.get(siteId) ?? -Infinity);
      if (elapsed < this.minIntervalMs) await this.wait(this.minIntervalMs - elapsed);
      this.lastStartedAt.set(siteId, this.now());
      try {
        const response = await this.requestImpl({ ...spec, siteId, attempt });
        const statusCode = Number(response?.statusCode || 0);
        if (statusCode === 429 || statusCode >= 500) {
          throw new SiteRequestError('W65_TRANSIENT', `HTTP ${statusCode}`, { siteId, statusCode, attempt });
        }
        if (statusCode >= 400 || statusCode < 200) {
          throw new SiteRequestError('W65_HTTP_ERROR', `HTTP ${statusCode || 'UNKNOWN'}`, { siteId, statusCode, attempt });
        }
        const normalized = { statusCode, url: response.url || spec.url, headers: response.headers || {}, body: String(response.body || ''), cached: false };
        if (hasInteractiveChallenge(normalized.body)) {
          const evidence = { siteId, url: normalized.url, detectedAt: new Date(this.now()).toISOString() };
          this.blockedSites.set(siteId, evidence);
          throw new SiteRequestError('W65_CHALLENGE_REQUIRED', `站点 ${siteId} 出现交互式验证，自动访问已停止`, evidence);
        }
        return normalized;
      } catch (error) {
        const normalizedError = isTransientNetworkError(error)
          ? new SiteRequestError('W65_TRANSIENT', error.message || '网络暂时不可用', { siteId, attempt, causeCode: error.code || '' })
          : error;
        lastError = normalizedError;
        if (normalizedError?.code === 'W65_CHALLENGE_REQUIRED' || !normalizedError?.transient || attempt >= this.retryDelaysMs.length) throw normalizedError;
        await this.wait(this.retryDelaysMs[attempt]);
      }
    }
    throw lastError;
  }
}

module.exports = { SiteRequestError, PoliteSiteTransport, isDeterministicVisitorGate, hasInteractiveChallenge, isTransientNetworkError };
