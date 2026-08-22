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
    maxGlobalConcurrency = 2,
    maxCacheEntries = 1000,
  } = {}) {
    if (typeof request !== 'function') throw new TypeError('PoliteSiteTransport requires request');
    this.requestImpl = request;
    this.now = now;
    this.wait = wait;
    this.minIntervalMs = minIntervalMs;
    this.listTtlMs = listTtlMs;
    this.detailTtlMs = detailTtlMs;
    this.retryDelaysMs = [...retryDelaysMs];
    this.maxGlobalConcurrency = Math.max(1, Number(maxGlobalConcurrency) || 2);
    this.maxCacheEntries = Math.max(16, Number(maxCacheEntries) || 1000);
    this.cache = new Map();
    this.siteQueues = new Map();
    this.lastStartedAt = new Map();
    this.blockedSites = new Map();
    this.health = new Map();
    this.siteGenerations = new Map();
    this.activeGlobal = 0;
    this.globalWaiters = [];
  }

  clearSite(siteId) {
    this.siteGenerations.set(siteId, this.siteGeneration(siteId) + 1);
    this.blockedSites.delete(siteId);
    // A reset clears state, not the politeness clock.  Keeping the last start
    // prevents a manual reset from bypassing the per-site request interval.
    for (const key of this.cache.keys()) if (key.startsWith(`${siteId}\0`)) this.cache.delete(key);
    this.health.set(siteId, this.#emptyHealth(siteId));
  }

  siteGeneration(siteId) {
    return this.siteGenerations.get(siteId) || 0;
  }

  snapshot(siteId) {
    if (siteId) return { ...(this.health.get(siteId) || this.#emptyHealth(siteId)) };
    return [...this.health.values()].map((entry) => ({ ...entry })).sort((left, right) => left.siteId.localeCompare(right.siteId));
  }

  async request(siteId, request, { kind = 'list', cache = true, bypassCache = false, staleIfError = true } = {}) {
    if (!siteId) throw new TypeError('siteId required');
    // Capture at invocation time, before this request can wait in the site
    // queue.  clearSite() advances the generation so every older queued or
    // in-flight request becomes read-only: it may finish for its caller, but
    // it cannot resurrect reset health, cache, or challenge state.
    const generation = this.siteGeneration(siteId);
    const blocked = this.blockedSites.get(siteId);
    if (blocked) throw new SiteRequestError('W65_CHALLENGE_REQUIRED', `站点 ${siteId} 需要人工验证，自动访问已停止`, blocked);
    const spec = typeof request === 'string' ? { url: request, method: 'GET' } : { method: 'GET', ...request };
    const cacheKey = `${siteId}\0${spec.method}\0${spec.url}\0${spec.body || ''}`;
    // Keep the requested expired entry until this attempt settles: it is the
    // only eligible stale-if-error fallback. Other expired entries can be
    // reclaimed immediately.
    for (const [key, entry] of this.cache) {
      if (key !== cacheKey && entry.expiresAt <= this.now()) this.cache.delete(key);
    }
    const cached = this.cache.get(cacheKey);
    if (cache && !bypassCache && cached && cached.expiresAt > this.now()) {
      this.#record(siteId, { status: 'healthy', sourceMode: 'cache', lastSuccessAt: new Date(this.now()).toISOString(), lastError: '' }, generation);
      return { ...cached.response, cached: true, stale: false };
    }

    const previous = this.siteQueues.get(siteId) || Promise.resolve();
    const task = previous.then(() => this.#perform(siteId, spec, generation), () => this.#perform(siteId, spec, generation));
    const queued = task.then(
      () => { if (this.siteQueues.get(siteId) === queued) this.siteQueues.delete(siteId); },
      () => { if (this.siteQueues.get(siteId) === queued) this.siteQueues.delete(siteId); },
    );
    this.siteQueues.set(siteId, queued);
    let response;
    try {
      response = await task;
    } catch (error) {
      if (this.#isCurrent(siteId, generation) && cache && staleIfError && cached?.response && error?.transient) {
        this.#record(siteId, { status: 'degraded', sourceMode: 'stale-cache', lastError: error.message || String(error) }, generation);
        return { ...cached.response, cached: true, stale: true };
      }
      throw error;
    }
    if (this.#isCurrent(siteId, generation) && cache && !isDeterministicVisitorGate(response.body)) {
      const ttl = kind === 'detail' ? this.detailTtlMs : this.listTtlMs;
      this.cache.set(cacheKey, { expiresAt: this.now() + ttl, response });
      while (this.cache.size > this.maxCacheEntries) this.cache.delete(this.cache.keys().next().value);
    }
    return response;
  }

  async #perform(siteId, spec, generation) {
    let lastError;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
      const elapsed = this.now() - (this.lastStartedAt.get(siteId) ?? -Infinity);
      if (elapsed < this.minIntervalMs) await this.wait(this.minIntervalMs - elapsed);
      this.lastStartedAt.set(siteId, this.now());
      this.#record(siteId, { lastAttemptAt: new Date(this.now()).toISOString() }, generation);
      try {
        const response = await this.#withGlobalSlot(() => this.requestImpl({ ...spec, siteId, attempt }));
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
          if (this.#isCurrent(siteId, generation)) this.blockedSites.set(siteId, evidence);
          this.#record(siteId, { status: 'challenge', sourceMode: 'blocked', lastFailureAt: evidence.detectedAt, lastError: '需要人工验证', consecutiveFailures: (this.health.get(siteId)?.consecutiveFailures || 0) + 1 }, generation);
          throw new SiteRequestError('W65_CHALLENGE_REQUIRED', `站点 ${siteId} 出现交互式验证，自动访问已停止`, evidence);
        }
        this.#record(siteId, { status: 'healthy', sourceMode: 'network', lastSuccessAt: new Date(this.now()).toISOString(), lastError: '', consecutiveFailures: 0 }, generation);
        return normalized;
      } catch (error) {
        const normalizedError = isTransientNetworkError(error)
          ? new SiteRequestError('W65_TRANSIENT', error.message || '网络暂时不可用', { siteId, attempt, causeCode: error.code || '' })
          : error;
        lastError = normalizedError;
        if (normalizedError?.code !== 'W65_CHALLENGE_REQUIRED') {
          this.#record(siteId, {
            status: normalizedError?.transient ? 'degraded' : 'failed',
            sourceMode: 'network',
            lastFailureAt: new Date(this.now()).toISOString(),
            lastError: normalizedError?.message || String(normalizedError),
            consecutiveFailures: (this.health.get(siteId)?.consecutiveFailures || 0) + 1,
          }, generation);
        }
        if (normalizedError?.code === 'W65_CHALLENGE_REQUIRED' || !normalizedError?.transient || attempt >= this.retryDelaysMs.length) throw normalizedError;
        await this.wait(this.retryDelaysMs[attempt]);
      }
    }
    throw lastError;
  }

  #emptyHealth(siteId) {
    return { siteId, status: 'unknown', sourceMode: 'none', lastAttemptAt: '', lastSuccessAt: '', lastFailureAt: '', consecutiveFailures: 0, lastError: '' };
  }

  #isCurrent(siteId, generation) {
    return this.siteGeneration(siteId) === generation;
  }

  #record(siteId, patch, generation = this.siteGeneration(siteId)) {
    if (!this.#isCurrent(siteId, generation)) return false;
    this.health.set(siteId, { ...(this.health.get(siteId) || this.#emptyHealth(siteId)), ...patch, siteId });
    return true;
  }

  async #withGlobalSlot(fn) {
    if (this.activeGlobal >= this.maxGlobalConcurrency) {
      await new Promise((resolve) => this.globalWaiters.push(resolve));
    }
    this.activeGlobal += 1;
    try { return await fn(); }
    finally {
      this.activeGlobal -= 1;
      this.globalWaiters.shift()?.();
    }
  }
}

module.exports = { SiteRequestError, PoliteSiteTransport, isDeterministicVisitorGate, hasInteractiveChallenge, isTransientNetworkError };
