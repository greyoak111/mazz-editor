// main/searx.js —— SearXNG 搜索服务（主进程专属）
// 隐私红线：实例地址与 Basic Auth 凭据只存在于主进程，渲染进程/网页永远拿不到
// TLS 走 Node https（实例自签证书直连，不受 Chromium 证书栈影响）
'use strict';
const { app } = require('electron');
const https = require('https');
const { URL } = require('url');

// 归一化 UA（反指纹：所有搜索流量同一副面孔，不携带任何客户端特征）
const SEARCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const DEFAULT_INSTANCE = {
  url: 'https://107.174.37.27',
  user: 'mazz',
  pass: '737037sxf',
};

/** 主进程 Node https 请求（实例自签证书走 rejectUnauthorized=false；超时+单次重试） */
function nodeFetch(url, { headers = {}, timeout = 12000, retries = 1 } = {}) {
  const attempt = () => new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': SEARCH_UA, 'Accept-Encoding': 'identity', ...headers },
      rejectUnauthorized: false, // 实例为自签证书（Basic Auth 已做访问控制）
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
    req.end();
  });
  return attempt().catch((e) => {
    if (retries > 0) return nodeFetch(url, { headers, timeout, retries: retries - 1 });
    throw e;
  });
}

class SearxService {
  constructor({ bus, store, session }) {
    this.store = store;
    this.session = session;

    // 自签证书放行：仅对配置的实例主机生效（plan 4.3.6 既定方案）
    this.applyCertWhitelist();

    bus.handle('searx:search', async (payload) => this.search(payload));
    bus.handle('searx:selfcheck', async () => this.selfcheck());
    bus.handle('searx:getMaskedConfig', async () => this.maskedConfig());
    bus.handle('searx:setConfig', async ({ url, user, pass }) => {
      this.store.set('searx', {
        url: String(url || '').trim().replace(/\/+$/, ''),
        user: String(user || '').trim(),
        pass: String(pass || ''),
      });
      this.applyCertWhitelist();
      return this.selfcheck();
    });
  }

  config() {
    const c = this.store.get('searx', DEFAULT_INSTANCE);
    return { ...DEFAULT_INSTANCE, ...c };
  }

  /** 实例主机证书白名单：app 级 certificate-error 事件，仅放行该主机，其余站点完全走默认验证 */
  applyCertWhitelist() {
    if (this._hooked) return;
    this._hooked = true;
    app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
      let host = '';
      try { host = new URL(this.config().url).host; } catch {}
      try {
        if (host && new URL(url).host === host) {
          event.preventDefault();
          callback(true); // 仅实例主机放行自签证书
          return;
        }
      } catch {}
      callback(false); // 其余站点：默认验证（不受任何影响）
    });
  }

  maskedConfig() {
    const c = this.config();
    let masked = c.url;
    try {
      const u = new URL(c.url);
      masked = u.protocol + '//' + u.host.replace(/^(\d{1,3})\.(\d{1,3})\..*$/, '$1.$2.***.***');
    } catch {}
    return { masked, user: c.user, hasPass: !!c.pass };
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
    const auth = 'Basic ' + Buffer.from(`${c.user}:${c.pass}`).toString('base64');

    let lastErr = null;
    try {
      const res = await nodeFetch(url, {
        headers: {
          'Authorization': auth,
          'Accept': 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
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
    const auth = 'Basic ' + Buffer.from(`${c.user}:${c.pass}`).toString('base64');
    const out = { instance: 'configured', checks: [] };
    try {
      const r1 = await nodeFetch(`${c.url}/search?q=test&format=json`, {
        headers: { 'Authorization': auth, 'Accept': 'application/json' },
      });
      out.checks.push({ name: 'Basic Auth + JSON', pass: r1.ok, detail: `HTTP ${r1.status}` });
    } catch (e) {
      out.checks.push({ name: 'Basic Auth + JSON', pass: false, detail: e.message });
    }
    try {
      const r2 = await nodeFetch(`${c.url}/`, {
        headers: { 'Authorization': auth },
      });
      out.checks.push({ name: '实例可达性', pass: r2.ok, detail: `HTTP ${r2.status}` });
    } catch (e) {
      out.checks.push({ name: '实例可达性', pass: false, detail: e.message });
    }
    out.ok = out.checks.every(c => c.pass);
    return out;
  }
}
module.exports = SearxService;
