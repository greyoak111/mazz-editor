// main/torrent-sites.js —— W65a 四站严格适配器与礼貌访问接线
'use strict';

const {
  parseDmhyRows,
  parseMikanRows,
  parseUploadbtRows,
  parseMagnet,
  normalizeInfoHash,
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
    id: 'dmhy', name: '动漫花园 DMHY（预览）',
    homeUrl: 'https://share.dmhy.org/',
    searchUrl: (kw) => `https://share.dmhy.org/topics/list?keyword=${encodeURIComponent(kw)}`,
    detailBase: 'https://share.dmhy.org',
    parseRows: (html) => parseDmhyRows(html, { baseUrl: 'https://share.dmhy.org/' }),
  }),
  mikan: Object.freeze({
    id: 'mikan', name: '蜜柑计划 Mikan（预览）',
    homeUrl: 'https://mikanime.tv/',
    searchUrl: (kw) => `https://mikanime.tv/Home/Search?searchstr=${encodeURIComponent(kw)}`,
    detailBase: 'https://mikanime.tv',
    parseRows: (html) => parseMikanRows(html, { baseUrl: 'https://mikanime.tv/' }),
  }),
  kisssub: Object.freeze({
    id: 'kisssub', name: '爱恋动漫 KissSub（预览）',
    homeUrl: 'https://kisssub.org/',
    searchUrl: (kw) => `https://kisssub.org/search.php?keyword=${encodeURIComponent(kw)}`,
    detailBase: 'https://kisssub.org',
    visitorGateUrl: 'https://kisssub.org/addon.php?r=document/view&page=visitor-test',
    parseRows: (html) => parseUploadbtRows(html, { siteId: 'kisssub', baseUrl: 'https://kisssub.org/' }),
  }),
  comicat: Object.freeze({
    id: 'comicat', name: '漫猫动漫 ComiCat（预览）',
    homeUrl: 'https://comicat.org/',
    searchUrl: (kw) => `https://comicat.org/search.php?keyword=${encodeURIComponent(kw)}`,
    detailBase: 'https://comicat.org',
    visitorGateUrl: 'https://comicat.org/addon.php?r=document/view&page=visitor-test',
    parseRows: (html) => parseUploadbtRows(html, { siteId: 'comicat', baseUrl: 'https://comicat.org/' }),
  }),
});

function electronRequest({ url, method = 'GET', headers = {}, body = '' }) {
  const { net } = require('electron');
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method });
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

    bus.handle('sites:list', async () => Object.values(SITES).map((site) => ({ id: site.id, name: site.name })));
    bus.handle('sites:search', async ({ site, kw } = {}) => {
      const adapter = this.#site(site);
      const keyword = String(kw || '').trim();
      if (!keyword) return { rows: [], kw: keyword };
      const response = await this.#load(adapter, adapter.searchUrl(keyword), 'list');
      return { rows: adapter.parseRows(response.body), kw: keyword, sourceSite: adapter.id, cached: response.cached };
    });
    bus.handle('sites:home', async ({ site } = {}) => {
      const adapter = this.#site(site);
      const response = await this.#load(adapter, adapter.homeUrl, 'list');
      return { rows: adapter.parseRows(response.body), sourceSite: adapter.id, cached: response.cached };
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
      const response = await this.#load(adapter, target, 'detail');
      const result = parseMagnet(response.body);
      if (!result) throw Object.assign(new Error('详情页未取到 magnet（站点结构可能已变）'), { code: 'W65_MAGNET_NOT_FOUND' });
      return result;
    });
  }

  #site(siteId) {
    const site = SITES[siteId];
    if (!site) throw Object.assign(new Error(`未知站点：${siteId || ''}`), { code: 'W65_UNKNOWN_SITE' });
    return site;
  }

  async #load(site, url, kind) {
    let response = await this.transport.request(site.id, { url }, { kind });
    if (!isDeterministicVisitorGate(response.body)) return response;
    if (!site.visitorGateUrl) {
      throw Object.assign(new Error(`站点 ${site.id} 返回未知访客门`), { code: 'W65_VISITOR_GATE_UNSUPPORTED' });
    }
    await this.transport.request(site.id, {
      url: site.visitorGateUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'visitor_test=human',
    }, { kind: 'detail', cache: false, bypassCache: true });
    response = await this.transport.request(site.id, { url }, { kind, bypassCache: true });
    if (isDeterministicVisitorGate(response.body)) {
      throw Object.assign(new Error(`站点 ${site.id} 访客门未通过，自动访问已停止`), { code: 'W65_VISITOR_GATE_FAILED' });
    }
    return response;
  }
}

module.exports = TorrentSites;
module.exports.SITES = SITES;
module.exports.electronRequest = electronRequest;
