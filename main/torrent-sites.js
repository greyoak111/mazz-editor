// main/torrent-sites.js —— W65a 四站严格适配器与礼貌访问接线
'use strict';

const {
  parseDmhyRows,
  parseMikanRows,
  parseUploadbtRows,
  parseUploadbtRss,
  parsePageInfo,
  parseMikanCatalog,
  parseMagnet,
  normalizeInfoHash,
  aggregateResourceRows,
} = require('./torrent-site-core');
const {
  PoliteSiteTransport,
  isDeterministicVisitorGate,
} = require('./torrent-site-network');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;

const SITES = Object.freeze({
  dmhy: Object.freeze({
    id: 'dmhy', name: '动漫花园 DMHY',
    homeUrl: 'https://share.dmhy.org/',
    mirrorBase: 'https://dmhy.anoneko.com',
    searchUrl: (kw, page = 1, base = 'https://share.dmhy.org') => `${base}/topics/list${page > 1 ? `/page/${page}` : ''}?keyword=${encodeURIComponent(kw)}`,
    detailBase: 'https://share.dmhy.org',
    parseRows: (html) => parseDmhyRows(html, { baseUrl: 'https://share.dmhy.org/' }),
  }),
  mikan: Object.freeze({
    id: 'mikan', name: '蜜柑计划 Mikan',
    homeUrl: 'https://mikanime.tv/',
    searchUrl: (kw) => `https://mikanime.tv/Home/Search?searchstr=${encodeURIComponent(kw)}`,
    catalogUrl: ({ year, season } = {}) => year && season
      ? `https://mikanime.tv/Home/BangumiCoverFlowByDayOfWeek?year=${encodeURIComponent(year)}&seasonStr=${encodeURIComponent(season)}`
      : 'https://mikanime.tv/',
    detailBase: 'https://mikanime.tv',
    parseRows: (html) => parseMikanRows(html, { baseUrl: 'https://mikanime.tv/' }),
  }),
  kisssub: Object.freeze({
    id: 'kisssub', name: '爱恋动漫 KissSub',
    homeUrl: 'https://kisssub.org/',
    rssUrl: 'https://kisssub.org/rss.xml',
    searchUrl: (kw, page = 1) => `https://kisssub.org/search.php?keyword=${encodeURIComponent(kw)}${page > 1 ? `&page=${page}` : ''}`,
    detailBase: 'https://kisssub.org',
    visitorGateUrl: 'https://kisssub.org/addon.php?r=document/view&page=visitor-test',
    parseRows: (html) => parseUploadbtRows(html, { siteId: 'kisssub', baseUrl: 'https://kisssub.org/' }),
  }),
  comicat: Object.freeze({
    id: 'comicat', name: '漫猫动漫 ComiCat',
    homeUrl: 'https://comicat.org/',
    rssUrl: 'https://comicat.org/rss.xml',
    searchUrl: (kw, page = 1) => `https://comicat.org/search.php?keyword=${encodeURIComponent(kw)}${page > 1 ? `&page=${page}` : ''}`,
    detailBase: 'https://comicat.org',
    visitorGateUrl: 'https://comicat.org/addon.php?r=document/view&page=visitor-test',
    parseRows: (html) => parseUploadbtRows(html, { siteId: 'comicat', baseUrl: 'https://comicat.org/' }),
  }),
});

function electronRequest({ url, method = 'GET', headers = {}, body = '' }) {
  const { net, session } = require('electron');
  return new Promise((resolve, reject) => {
    const persistentSession = session.fromPartition('persist:mazz-torrent-sites');
    const req = net.request({ url, method, session: persistentSession });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      finish(reject, Object.assign(new Error(`站点请求超过 ${REQUEST_TIMEOUT_MS / 1000} 秒`), { code: 'ETIMEDOUT' }));
      req.abort();
    }, REQUEST_TIMEOUT_MS);
    req.setHeader('User-Agent', UA);
    req.setHeader('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8');
    for (const [name, value] of Object.entries(headers)) req.setHeader(name, value);
    req.on('response', (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          req.abort();
          finish(reject, Object.assign(new Error('站点响应超过 12 MiB 安全上限'), { code: 'W65_RESPONSE_TOO_LARGE' }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(resolve, {
        statusCode: res.statusCode,
        url: res.headers.location || url,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      res.on('error', (error) => finish(reject, error));
    });
    req.on('error', (error) => finish(reject, error));
    if (body) req.write(body);
    req.end();
  });
}

class TorrentSites {
  constructor({ bus, request = electronRequest, transport } = {}) {
    if (!bus?.handle) throw new TypeError('TorrentSites requires IPC bus');
    this.bus = bus;
    this.transport = transport || new PoliteSiteTransport({ request });
    this.visitorCookies = new Map();
    this.probeInFlight = new Map();

    bus.handle('sites:list', async () => Object.values(SITES).map((site) => ({ id: site.id, name: site.name })));
    bus.handle('sites:search', async ({ site, kw } = {}) => {
      const keyword = String(kw || '').trim();
      if (!keyword) return { rows: [], kw: keyword };
      const adapter = this.#site(site);
      return this.#searchPage(adapter, keyword, 1, this.#captureGeneration(adapter.id));
    });
    bus.handle('sites:searchPage', async ({ site, kw, page = 1 } = {}) => {
      const keyword = String(kw || '').trim();
      if (!keyword) return { rows: [], kw: keyword, page: 1, totalPages: 1, hasMore: false, nextPage: null };
      const adapter = this.#site(site);
      return this.#searchPage(adapter, keyword, page, this.#captureGeneration(adapter.id));
    });
    bus.handle('sites:searchMany', async payload => this.searchMany(payload));
    bus.handle('sites:home', async ({ site } = {}) => {
      const adapter = this.#site(site);
      const generation = this.#captureGeneration(adapter.id);
      try {
        const response = await this.#load(adapter, adapter.homeUrl, 'list', {}, generation);
        const rows = adapter.parseRows(response.body);
        if (rows.length || !adapter.rssUrl) return { rows, sourceSite: adapter.id, cached: response.cached, sourceMode: this.#sourceMode(response) };
      } catch (error) {
        if (error?.code === 'W65_RESET_STALE') throw error;
        if (!adapter.rssUrl) throw error;
      }
      this.#assertGeneration(adapter.id, generation);
      const fallback = await this.#rss(adapter, generation);
      return { rows: fallback.rows, sourceSite: adapter.id, cached: fallback.cached, sourceMode: 'rss' };
    });
    bus.handle('sites:catalog', async ({ site = 'mikan', year = '', season = '' } = {}) => {
      const adapter = this.#site(site);
      if (!adapter.catalogUrl) throw Object.assign(new Error(`站点 ${site} 没有季度目录`), { code: 'W65_CATALOG_UNSUPPORTED' });
      const generation = this.#captureGeneration(adapter.id);
      const response = await this.#load(adapter, adapter.catalogUrl({ year, season }), 'list', {}, generation);
      return { ...parseMikanCatalog(response.body, { year, season }), cached: response.cached, sourceMode: this.#sourceMode(response) };
    });
    bus.handle('sites:health', async ({ site } = {}) => {
      if (site) this.#site(site);
      return this.transport.snapshot?.(site) || (site ? { siteId: site, status: 'unknown' } : []);
    });
    bus.handle('sites:check', async ({ site, force = false, maxAgeMs = 0 } = {}) => {
      const adapters = site ? [this.#site(site)] : Object.values(SITES);
      const snapshots = await Promise.all(adapters.map((adapter) => this.#checkSite(adapter, { force, maxAgeMs })));
      return site ? snapshots[0] : snapshots;
    });
    bus.handle('sites:reset', async ({ site } = {}) => {
      const adapters = site ? [this.#site(site)] : Object.values(SITES);
      const snapshots = adapters.map((adapter) => {
        // clearSite advances the station generation immediately.  Older
        // probes/searches may finish their socket work, but every subsequent
        // step and all durable health/cache writes are now stale owners.
        this.probeInFlight.delete(adapter.id);
        this.visitorCookies.delete(adapter.id);
        this.transport.clearSite?.(adapter.id);
        return this.transport.snapshot?.(adapter.id) || { siteId: adapter.id, status: 'unknown' };
      });
      return site ? snapshots[0] : snapshots;
    });
    bus.handle('sites:magnet', async ({ site, href, magnet, infoHash, sourceUrl, torrentUrl } = {}) => {
      const adapter = this.#site(site);
      if (String(magnet || href || '').startsWith('magnet:')) {
        const direct = String(magnet || href);
        return { magnet: direct, title: '', infoHash: normalizeInfoHash(direct) };
      }
      const knownHash = normalizeInfoHash(infoHash || href || torrentUrl || sourceUrl);
      if (knownHash) return { magnet: `magnet:?xt=urn:btih:${knownHash}`, title: '', infoHash: knownHash };
      const target = new URL(String(sourceUrl || href || ''), adapter.detailBase).href;
      const generation = this.#captureGeneration(adapter.id);
      const response = await this.#load(adapter, target, 'detail', {}, generation);
      const result = parseMagnet(response.body);
      if (!result) throw Object.assign(new Error('详情页未取到 magnet（站点结构可能已变）'), { code: 'W65_MAGNET_NOT_FOUND' });
      return result;
    });
  }

  async searchMany({ sites, kw, pageMap = {}, maxPages = null } = {}) {
    const keyword = String(kw || '').trim();
    const cursorMode = pageMap && Object.keys(pageMap).length > 0;
    const selected = [...new Set((Array.isArray(sites) ? sites : []).filter((id) => SITES[id] && (!cursorMode || Object.hasOwn(pageMap, id))))];
    const pageLimit = maxPages == null || maxPages === '' ? null : Number(maxPages);
    if (pageLimit != null && (!Number.isInteger(pageLimit) || pageLimit < 1)) throw new Error('maxPages 如提供，必须是正整数');
    if (!keyword || !selected.length) return { rows: [], aggregates: [], perSite: {}, nextPages: {}, kw: keyword };
    const entries = await Promise.all(selected.map(async (siteId) => {
      const adapter = this.#site(siteId);
      const generation = this.#captureGeneration(adapter.id);
      const startPage = Math.max(1, Number.parseInt(pageMap?.[siteId], 10) || 1);
      const rows = [];
      let current = null;
      try {
        for (let offset = 0; pageLimit == null || offset < pageLimit; offset += 1) {
          current = await this.#searchPage(adapter, keyword, startPage + offset, generation);
          rows.push(...current.rows);
          if (!current.hasMore) break;
        }
        return [siteId, { ...current, rows, error: '' }];
      } catch (error) {
        const survivingRows = error?.code === 'W65_RESET_STALE' ? [] : rows;
        return [siteId, { rows: survivingRows, page: startPage, totalPages: startPage, hasMore: false, nextPage: null, sourceSite: siteId, sourceMode: 'failed', error: error.message || String(error) }];
      }
    }));
    const perSite = Object.fromEntries(entries);
    const rows = entries.flatMap(([, result]) => result.rows || []);
    const nextPages = Object.fromEntries(entries.filter(([, result]) => result.nextPage).map(([siteId, result]) => [siteId, result.nextPage]));
    return { rows, aggregates: aggregateResourceRows(rows), perSite, nextPages, kw: keyword };
  }

  #site(siteId) {
    const site = SITES[siteId];
    if (!site) throw Object.assign(new Error(`未知站点：${siteId || ''}`), { code: 'W65_UNKNOWN_SITE' });
    return site;
  }

  #captureGeneration(siteId) {
    return typeof this.transport.siteGeneration === 'function'
      ? this.transport.siteGeneration(siteId)
      : null;
  }

  #assertGeneration(siteId, generation) {
    if (generation === null || generation === undefined || typeof this.transport.siteGeneration !== 'function') return;
    if (this.transport.siteGeneration(siteId) !== generation) {
      throw Object.assign(new Error(`站点 ${siteId} 会话已重置，旧请求已作废`), { code: 'W65_RESET_STALE' });
    }
  }

  #checkSite(adapter, { force = false, maxAgeMs = 0 } = {}) {
    // An in-flight probe has already stamped lastAttemptAt but has not yet
    // produced terminal health.  Join that owner before consulting freshness
    // so a second Player cannot settle early with an intermediate snapshot.
    const pending = this.probeInFlight.get(adapter.id);
    if (pending) return pending;
    const current = this.transport.snapshot?.(adapter.id)
      || { siteId: adapter.id, status: 'unknown', sourceMode: 'none' };
    const checkedAt = Date.parse(current.lastAttemptAt || '');
    const observedNow = Number(this.transport.now?.());
    const now = Number.isFinite(observedNow) ? observedNow : Date.now();
    const freshFor = Math.max(0, Number(maxAgeMs) || 0);
    if (!force && freshFor > 0 && Number.isFinite(checkedAt) && now - checkedAt < freshFor) {
      return Promise.resolve(current);
    }
    const task = (async () => {
      try {
        // A health check is an actual bounded network observation, not a
        // cache hit masquerading as availability.  It deliberately avoids
        // populating the search cache and never falls back to stale data.
        await this.#load(adapter, adapter.homeUrl, 'list', {
          cache: false,
          bypassCache: true,
          staleIfError: false,
        });
      } catch {}
      return this.transport.snapshot?.(adapter.id)
        || { siteId: adapter.id, status: 'unknown', sourceMode: 'none' };
    })().finally(() => {
      if (this.probeInFlight.get(adapter.id) === task) this.probeInFlight.delete(adapter.id);
    });
    this.probeInFlight.set(adapter.id, task);
    return task;
  }

  async #load(site, url, kind, requestPolicy = {}, operationGeneration = this.#captureGeneration(site.id)) {
    const ownerGeneration = operationGeneration;
    this.#assertGeneration(site.id, ownerGeneration);
    const cookie = this.visitorCookies.get(site.id) || '';
    const policy = { kind, staleIfError: true, ...requestPolicy };
    let response = await this.transport.request(site.id, { url, headers: cookie ? { Cookie: cookie } : {} }, policy);
    this.#assertGeneration(site.id, ownerGeneration);
    if (!isDeterministicVisitorGate(response.body)) return response;
    if (!site.visitorGateUrl) {
      throw Object.assign(new Error(`站点 ${site.id} 返回未知访客门`), { code: 'W65_VISITOR_GATE_UNSUPPORTED' });
    }
    this.#assertGeneration(site.id, ownerGeneration);
    const gateResponse = await this.transport.request(site.id, {
      url: site.visitorGateUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'visitor_test=human',
    }, { kind: 'detail', cache: false, bypassCache: true });
    this.#assertGeneration(site.id, ownerGeneration);
    const setCookie = Object.entries(gateResponse.headers || {}).find(([name]) => name.toLowerCase() === 'set-cookie')?.[1];
    const cookieMatch = /visitor_test=([^;,\s]+)/i.exec(Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie || ''));
    const visitorCookie = `visitor_test=${cookieMatch?.[1] || 'human'}`;
    this.visitorCookies.set(site.id, visitorCookie);
    this.#assertGeneration(site.id, ownerGeneration);
    response = await this.transport.request(site.id, { url, headers: { Cookie: visitorCookie } }, {
      ...policy,
      cache: false,
      bypassCache: true,
      staleIfError: false,
    });
    this.#assertGeneration(site.id, ownerGeneration);
    if (isDeterministicVisitorGate(response.body)) {
      throw Object.assign(new Error(`站点 ${site.id} 访客门未通过，自动访问已停止`), { code: 'W65_VISITOR_GATE_FAILED' });
    }
    return response;
  }

  #sourceMode(response) {
    return response?.stale ? 'stale-cache' : response?.cached ? 'cache' : 'network';
  }

  async #rss(site, operationGeneration = this.#captureGeneration(site.id)) {
    this.#assertGeneration(site.id, operationGeneration);
    const response = await this.#load(site, site.rssUrl, 'list', {}, operationGeneration);
    return {
      rows: parseUploadbtRss(response.body, { siteId: site.id, baseUrl: site.detailBase }),
      cached: response.cached,
      sourceMode: this.#sourceMode(response),
    };
  }

  async #searchPage(site, keyword, page, operationGeneration = this.#captureGeneration(site.id)) {
    this.#assertGeneration(site.id, operationGeneration);
    const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const urls = site.id === 'dmhy'
      ? [site.searchUrl(keyword, currentPage), site.searchUrl(keyword, currentPage, site.mirrorBase)]
      : [site.searchUrl(keyword, currentPage)];
    let lastError = null;
    for (const url of urls) {
      try {
        const response = await this.#load(site, url, 'list', {}, operationGeneration);
        const rows = site.parseRows(response.body);
        const backendFailed = site.id === 'dmhy' && /(?:searchd|SQLSTATE|Connection refused)/i.test(response.body);
        if (backendFailed) throw Object.assign(new Error('DMHY 搜索服务暂不可用'), { code: 'W65_DMHy_SEARCH_UNAVAILABLE' });
        const paging = site.id === 'mikan' ? { page: 1, totalPages: 1, hasMore: false, nextPage: null } : parsePageInfo(response.body, currentPage);
        return { rows, kw: keyword, sourceSite: site.id, cached: response.cached, sourceMode: url.startsWith(site.mirrorBase || '\0') ? 'mirror' : this.#sourceMode(response), ...paging };
      } catch (error) {
        if (error?.code === 'W65_RESET_STALE') throw error;
        lastError = error;
      }
    }
    if (site.rssUrl && currentPage === 1) {
      try {
        const fallback = await this.#rss(site, operationGeneration);
        const folded = keyword.toLocaleLowerCase('zh-CN');
        const rows = fallback.rows.filter((row) => row.title.toLocaleLowerCase('zh-CN').includes(folded));
        return { rows, kw: keyword, sourceSite: site.id, cached: fallback.cached, sourceMode: 'rss', page: 1, totalPages: 1, hasMore: false, nextPage: null };
      } catch (error) {
        if (error?.code === 'W65_RESET_STALE') throw error;
        lastError = error;
      }
    }
    throw lastError || Object.assign(new Error(`站点 ${site.id} 搜索失败`), { code: 'W65_SEARCH_FAILED' });
  }
}

module.exports = TorrentSites;
module.exports.SITES = SITES;
module.exports.electronRequest = electronRequest;
