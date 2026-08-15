// main/searx.js —— SearXNG 搜索服务（主进程专属）
// 隐私红线：Basic Auth 凭据只存在于主进程，渲染进程/网页永远拿不到
// TLS 默认严格验证；自签实例必须显式配置 SHA-256 证书指纹
'use strict';
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const { URL } = require('url');

// 归一化 UA（反指纹：所有搜索流量同一副面孔，不携带任何客户端特征）
const SEARCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const DEFAULT_INSTANCE = {
  url: '',
  user: '',
  pass: '',
  tlsPin: '',
};

// 旧版本曾把共享实例三元组写进源码；只保留不可逆指纹用于迁移时清除旧配置。
const LEAKED_DEFAULT_FINGERPRINT = '0cfef0ca7ea502d4a962522bc920a7597dd964a55fe86784f49ce5974b4be753';

function normalizeTlsPin(value) {
  const pin = String(value || '').replace(/[^a-f0-9]/gi, '').toUpperCase();
  if (pin && pin.length !== 64) throw new Error('TLS 指纹必须是 64 位 SHA-256 十六进制');
  return pin;
}

function authHeaders(config) {
  if (!config.user && !config.pass) return {};
  return { Authorization: 'Basic ' + Buffer.from(`${config.user}:${config.pass}`).toString('base64') };
}

function assertSecureEndpoint(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '::1' || /^127\./.test(host);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('搜索实例必须使用 HTTPS（仅本机 loopback 可使用 HTTP）');
  }
  return parsed;
}

/** 主进程 Node https 请求：默认系统 CA；自签证书只按用户显式 SHA-256 指纹放行。 */
function nodeFetch(url, { headers = {}, timeout = 12000, retries = 1, tlsPin = '' } = {}) {
  const attempt = () => new Promise((resolve, reject) => {
    const u = assertSecureEndpoint(url);
    const transport = u.protocol === 'http:' ? http : https;
    const pin = u.protocol === 'https:' ? normalizeTlsPin(tlsPin) : '';
    const req = transport.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': SEARCH_UA, 'Accept-Encoding': 'identity', ...headers },
      rejectUnauthorized: !pin,
      timeout,
      agent: false,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (pin) {
      req.on('socket', socket => socket.once('secureConnect', () => {
        const actual = normalizeTlsPin(socket.getPeerCertificate()?.fingerprint256 || '');
        if (!actual || actual !== pin) req.destroy(new Error('TLS 证书指纹不匹配'));
      }));
    }
    req.end();
  });
  return attempt().catch((e) => {
    if (retries > 0) return nodeFetch(url, { headers, timeout, retries: retries - 1, tlsPin });
    throw e;
  });
}

const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./, /^(?:22[4-9]|23\d|24\d|25[0-5])\./,
];

function isPrivateAddress(address) {
  const ip = String(address || '').toLowerCase();
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return PRIVATE_V4.some(rule => rule.test(ip))
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 192 && (b === 0 || b === 2))
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0);
  }
  if (!net.isIPv6(ip)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]);
  return ip === '::' || ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')
    || ip.startsWith('::ffff:127.') || ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:169.254.')
    || /^::ffff:172\.(?:1[6-9]|2\d|3[01])\./.test(ip) || ip.startsWith('::ffff:192.168.');
}

function e2eOriginAllowed(url) {
  if (!process.env.MAZZ_E2E_RESEARCH_ORIGIN) return false;
  try { return new URL(url).origin === new URL(process.env.MAZZ_E2E_RESEARCH_ORIGIN).origin; }
  catch { return false; }
}

async function assertPublicUrl(raw) {
  const url = new URL(String(raw || ''));
  if (!/^https?:$/.test(url.protocol)) throw new Error('只允许抓取 HTTP/HTTPS 网页');
  if (e2eOriginAllowed(url)) return { url, address: null };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || isPrivateAddress(host)) throw new Error('拒绝抓取本机或内网地址');
  const rows = await dns.lookup(host, { all: true, verbatim: true });
  if (!rows.length || rows.some(row => isPrivateAddress(row.address))) throw new Error('拒绝抓取解析到内网的地址');
  return { url, address: rows[0] };
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
  return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (all, key) => {
    if (key[0] === '#') {
      const hex = key[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : all; } catch { return all; }
    }
    return Object.prototype.hasOwnProperty.call(named, key.toLowerCase()) ? named[key.toLowerCase()] : all;
  });
}

function stripTags(html) {
  return decodeEntities(String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript|template|iframe|canvas|form|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|main|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractImageSources(html, baseUrl = '') {
  const source = String(html || '').slice(0, 2_000_000);
  const out = [];
  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const attr = (name) => {
      const found = new RegExp(`\\b${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, 'i').exec(tag);
      return decodeEntities(found?.[1] || found?.[2] || '').trim();
    };
    let raw = attr('data-original') || attr('data-src') || attr('data-lazy-src') || attr('src');
    if (!raw) raw = (attr('srcset').split(',')[0] || '').trim().split(/\s+/)[0] || '';
    if (!raw || /^(?:data|blob):/i.test(raw)) continue;
    try {
      const url = new URL(raw, baseUrl || undefined);
      if (!/^https?:$/.test(url.protocol)) continue;
      const normalized = url.toString();
      if (!out.includes(normalized)) out.push(normalized);
    } catch {}
    if (out.length >= 24) break;
  }
  return out;
}

function extractArticleText(html, baseUrl = '') {
  const source = String(html || '').slice(0, 2_000_000);
  const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const articleMatch = source.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i);
  const mainMatch = source.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i);
  const bodyMatch = source.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  return {
    title: stripTags(titleMatch?.[1] || '').slice(0, 400),
    text: stripTags(articleMatch?.[1] || mainMatch?.[1] || bodyMatch?.[1] || source).slice(0, 60_000),
    images: extractImageSources(source, baseUrl),
  };
}

function decodePage(bytes, contentType = '') {
  const probe = bytes.subarray(0, 4096).toString('latin1');
  let charset = (/charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1]
    || /<meta\b[^>]*charset\s*=\s*["']?([^\s"'/>]+)/i.exec(probe)?.[1]
    || 'utf-8').toLowerCase();
  if (charset === 'gbk' || charset === 'gb2312') charset = 'gb18030';
  try { return new TextDecoder(charset, { fatal: false }).decode(bytes); }
  catch { return bytes.toString('utf8'); }
}

async function fetchArticle(raw, redirects = 0) {
  if (redirects > 4) throw new Error('网页重定向过多');
  const checked = await assertPublicUrl(raw);
  const { url, address } = checked;
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'http:' ? http : https;
    const req = transport.request({
      protocol: url.protocol, hostname: url.hostname, port: url.port || undefined,
      path: url.pathname + url.search, method: 'GET',
      headers: { 'User-Agent': SEARCH_UA, Accept: 'text/html,text/plain;q=0.9', 'Accept-Encoding': 'identity' },
      rejectUnauthorized: true, timeout: 15_000, agent: false,
      lookup: address ? (_hostname, _options, callback) => callback(null, address.address, address.family) : undefined,
    }, res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        fetchArticle(next, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) { res.resume(); reject(new Error(`HTTP ${status}`)); return; }
      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (type && !/(?:text\/(?:html|plain)|application\/xhtml\+xml)/.test(type)) {
        res.resume(); reject(new Error('目标不是可提取的网页正文')); return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 2_000_000) req.destroy(new Error('网页正文超过 2MB 上限'));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        const html = decodePage(Buffer.concat(chunks), type);
        resolve({ ...extractArticleText(html, url.toString()), url: url.toString(), adapter: 'server-generic' });
      });
    });
    req.on('timeout', () => req.destroy(new Error('网页抓取超时')));
    req.on('error', reject);
    req.end();
  });
}

const IMAGE_MIME_EXT = Object.freeze({
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico',
});

async function fetchImage(raw, redirects = 0) {
  if (redirects > 4) throw new Error('图片重定向过多');
  const checked = await assertPublicUrl(raw);
  const { url, address } = checked;
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'http:' ? http : https;
    const req = transport.request({
      protocol: url.protocol, hostname: url.hostname, port: url.port || undefined,
      path: url.pathname + url.search, method: 'GET',
      headers: { 'User-Agent': SEARCH_UA, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp;q=0.8', 'Accept-Encoding': 'identity' },
      rejectUnauthorized: true, timeout: 15_000, agent: false,
      lookup: address ? (_hostname, _options, callback) => callback(null, address.address, address.family) : undefined,
    }, res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        fetchImage(new URL(res.headers.location, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) { res.resume(); reject(new Error(`图片 HTTP ${status}`)); return; }
      const mime = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!IMAGE_MIME_EXT[mime]) { res.resume(); reject(new Error('目标不是受支持的安全图片格式')); return; }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) req.destroy(new Error('图片超过 8MB 上限'));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({ url: url.toString(), mime, ext: IMAGE_MIME_EXT[mime], size: bytes.length, base64: bytes.toString('base64') });
      });
    });
    req.on('timeout', () => req.destroy(new Error('图片抓取超时')));
    req.on('error', reject);
    req.end();
  });
}

class SearxService {
  constructor({ bus, store, session, encryptSecret = null, decryptSecret = null }) {
    this.store = store;
    this.session = session;
    this.encryptSecret = encryptSecret || (value => ({ enc: false, data: Buffer.from(String(value || '')).toString('base64') }));
    this.decryptSecret = decryptSecret || (payload => Buffer.from(payload?.data || '', 'base64').toString('utf8'));
    this.migrateLegacyConfig();

    bus.handle('searx:search', async (payload) => this.search(payload));
    bus.handle('searx:extract', async (payload) => this.extract(payload));
    bus.handle('clip:fetchImage', async (payload) => this.fetchImage(payload));
    bus.handle('searx:selfcheck', async () => this.selfcheck());
    bus.handle('searx:getMaskedConfig', async () => this.maskedConfig());
    bus.handle('searx:setConfig', async ({ url, user, pass, tlsPin, clearPass = false }) => {
      const previous = this.store.get('searx', {}) || {};
      const next = {
        url: String(url || previous.url || '').trim().replace(/\/+$/, ''),
        user: user === undefined ? String(previous.user || '') : String(user || '').trim(),
        tlsPin: normalizeTlsPin(tlsPin === undefined ? previous.tlsPin || '' : tlsPin),
      };
      if (!clearPass && pass) next.passEnc = this.encryptSecret(String(pass));
      else if (!clearPass && previous.passEnc) next.passEnc = previous.passEnc;
      this.store.set('searx', next);
      return this.selfcheck();
    });
  }

  migrateLegacyConfig() {
    const previous = this.store.get('searx', null);
    if (!previous || typeof previous !== 'object') return;
    const plain = typeof previous.pass === 'string' ? previous.pass : '';
    const fingerprint = crypto.createHash('sha256')
      .update(`${previous.url || ''}\n${previous.user || ''}\n${plain}`)
      .digest('hex');
    if (fingerprint === LEAKED_DEFAULT_FINGERPRINT) {
      this.store.set('searx', { url: '', user: '', tlsPin: '', legacyCredentialsRemovedAt: Date.now() });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(previous, 'pass')) {
      const next = { ...previous };
      delete next.pass;
      if (plain) next.passEnc = this.encryptSecret(plain);
      this.store.set('searx', next);
    }
  }

  async extract({ url } = {}) {
    try {
      const page = await fetchArticle(url);
      return { ok: true, ...page };
    } catch (error) {
      return { ok: false, url: String(url || ''), title: '', text: '', error: error.message || String(error) };
    }
  }

  async fetchImage({ url } = {}) {
    try { return { ok: true, ...(await fetchImage(url)) }; }
    catch (error) { return { ok: false, url: String(url || ''), error: error.message || String(error) }; }
  }

  config() {
    const stored = this.store.get('searx', {}) || {};
    let pass = '';
    try { if (stored.passEnc) pass = this.decryptSecret(stored.passEnc); } catch {}
    let tlsPin = '';
    try { tlsPin = normalizeTlsPin(stored.tlsPin || ''); } catch {}
    return {
      ...DEFAULT_INSTANCE,
      url: String(stored.url || ''),
      user: String(stored.user || ''),
      tlsPin,
      pass,
    };
  }

  maskedConfig() {
    const c = this.config();
    let masked = c.url;
    try {
      const u = new URL(c.url);
      masked = u.protocol + '//' + u.host.replace(/^(\d{1,3})\.(\d{1,3})\..*$/, '$1.$2.***.***');
    } catch {}
    return { masked, user: c.user, hasPass: !!c.pass, tlsPin: c.tlsPin };
  }

  /** 搜索：返回结构化结果（不含任何实例信息） */
  async search({ query, categories = 'general', language = 'auto', pageno = 1, time_range = '' }) {
    const c = this.config();
    if (!c.url) return { ok: false, error: '未配置搜索实例', results: [] };
    const params = new URLSearchParams({
      q: query, format: 'json', categories: categories, pageno: String(pageno),
    });
    if (language && language !== 'auto') params.set('language', language);
    if (time_range) params.set('time_range', time_range);
    const url = `${c.url}/search?${params}`;
    let lastErr = null;
    try {
      const res = await nodeFetch(url, {
        headers: {
          ...authHeaders(c),
          'Accept': 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        tlsPin: c.tlsPin,
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, results: [], selfcheck: await this.selfcheck() };
      let data;
      try { data = JSON.parse(res.body); }
      catch { return { ok: false, error: 'JSON 解析失败（实例可能未开 json 格式）', results: [], selfcheck: await this.selfcheck() }; }
      return {
        ok: true,
        query,
        results: (data.results || []).map(r => ({
          title: r.title || '',
          url: r.url || '',
          content: r.content || '',
          engine: r.engine || '',
          score: r.score || 0,
        })),
        suggestions: data.suggestions || [],
        infoboxes: (data.infoboxes || []).map(b => ({ infobox: b.infobox, content: b.content, urls: (b.urls || []).map(u => ({ title: u.title, url: u.url })) })),
        answers: data.answers || [],
      };
    } catch (e) {
      lastErr = e.message;
    }
    // 保险③：JSON 失败给实例自检指引，绝不静默失败
    return { ok: false, error: lastErr || '网络错误', results: [], selfcheck: await this.selfcheck() };
  }

  /** 实例自检（凭据连通性 + JSON 可用性） */
  async selfcheck() {
    const c = this.config();
    const out = { instance: 'configured', checks: [] };
    if (!c.url) return { ...out, ok: false, instance: 'missing', checks: [{ name: '实例配置', pass: false, detail: '未配置搜索实例' }] };
    try {
      const r1 = await nodeFetch(`${c.url}/search?q=test&format=json`, {
        headers: { ...authHeaders(c), 'Accept': 'application/json' }, tlsPin: c.tlsPin,
      });
      out.checks.push({ name: 'Basic Auth + JSON', pass: r1.ok, detail: `HTTP ${r1.status}` });
    } catch (e) {
      out.checks.push({ name: 'Basic Auth + JSON', pass: false, detail: e.message });
    }
    try {
      const r2 = await nodeFetch(`${c.url}/`, {
        headers: authHeaders(c), tlsPin: c.tlsPin,
      });
      out.checks.push({ name: '实例可达性', pass: r2.ok, detail: `HTTP ${r2.status}` });
    } catch (e) {
      out.checks.push({ name: '实例可达性', pass: false, detail: e.message });
    }
    out.ok = out.checks.every(c => c.pass);
    return out;
  }
}
SearxService.extractArticleText = extractArticleText;
SearxService.extractImageSources = extractImageSources;
SearxService.isPrivateAddress = isPrivateAddress;
SearxService.normalizeTlsPin = normalizeTlsPin;
SearxService.nodeFetch = nodeFetch;
SearxService.assertSecureEndpoint = assertSecureEndpoint;
module.exports = SearxService;
