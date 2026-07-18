// main/translate.js —— 翻译服务（主进程代理：渲染进程与网页均不接触翻译通道细节）
// 引擎：MyMemory（免 key 默认）/ LibreTranslate（自部署实例，可填 key）
'use strict';
const https = require('https');
const http = require('http');

const TR_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** 通用请求（支持 GET/POST，自签容错，超时重试） */
function request(url, { method = 'GET', headers = {}, body = null, timeout = 15000, retries = 1 } = {}) {
  const attempt = () => new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: { 'User-Agent': TR_UA, 'Accept-Encoding': 'identity', ...headers },
      rejectUnauthorized: false,
      timeout,
      agent: false,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { data += d; if (data.length > 2e6) req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
  return attempt().catch((e) => {
    if (retries > 0) return request(url, { method, headers, body, timeout, retries: retries - 1 });
    throw e;
  });
}

/** 粗略判定文本是否以中文为主（用于 auto 方向推断） */
function looksChinese(text) {
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  return cjk / Math.max(text.length, 1) > 0.15;
}

/** 文本切块（MyMemory 免费层单次 ≤500 字符） */
function chunkText(text, max = 450) {
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = Math.max(rest.lastIndexOf('。', max), rest.lastIndexOf('. ', max), rest.lastIndexOf('\n', max));
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) parts.push(rest);
  return parts;
}

class TranslateService {
  constructor({ bus, store }) {
    this.store = store;
    bus.handle('tr:translate', async (p) => this.translate(p));
    bus.handle('tr:getConfig', async () => {
      const cfg = this.store.get('translate', {});
      // 脱敏：key 只回长度
      return { engine: cfg.engine || 'mymemory', ltUrl: cfg.ltUrl || '', ltKeySet: !!(cfg.ltKey || '').length };
    });
    bus.handle('tr:setConfig', async ({ engine, ltUrl, ltKey }) => {
      const prev = this.store.get('translate', {});
      this.store.set('translate', {
        engine: engine || 'mymemory',
        ltUrl: ltUrl ?? prev.ltUrl ?? '',
        ltKey: ltKey ?? prev.ltKey ?? '',
      });
      return true;
    });
  }

  async translate({ text, from = 'auto', to = '' }) {
    if (!text || !String(text).trim()) return { text: '' };
    const cfg = this.store.get('translate', {});
    const source = from === 'auto' ? (looksChinese(text) ? 'zh-CN' : 'en') : from;
    const target = to || (source.startsWith('zh') ? 'en' : 'zh-CN');
    if (cfg.engine === 'libretranslate' && cfg.ltUrl) {
      return this.libreTranslate(String(text), source, target, cfg);
    }
    return this.myMemory(String(text), source, target);
  }

  /** MyMemory（免 key；日限额内可用，长文自动切块） */
  async myMemory(text, source, target) {
    const lang = `${source}|${target}`;
    const parts = chunkText(text);
    const out = [];
    for (const part of parts) {
      const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(part) + '&langpair=' + encodeURIComponent(lang);
      const r = await request(url);
      if (!r.ok) throw new Error('翻译服务响应异常（HTTP ' + r.status + '）');
      const data = JSON.parse(r.body);
      const translated = data?.responseData?.translatedText;
      if (!translated) throw new Error(data?.responseDetails || '翻译失败');
      out.push(translated);
    }
    return { text: out.join(''), engine: 'mymemory', from: source, to: target };
  }

  /** LibreTranslate 自部署实例 */
  async libreTranslate(text, source, target, cfg) {
    const url = cfg.ltUrl.replace(/\/+$/, '') + '/translate';
    const payload = JSON.stringify({ q: text, source, target, format: 'text', api_key: cfg.ltKey || undefined });
    const r = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
    if (!r.ok) throw new Error('LibreTranslate 响应异常（HTTP ' + r.status + '）');
    const data = JSON.parse(r.body);
    if (!data?.translatedText) throw new Error(data?.error || '翻译失败');
    return { text: data.translatedText, engine: 'libretranslate', from: source, to: target };
  }
}

module.exports = TranslateService;
module.exports.looksChinese = looksChinese;
module.exports.chunkText = chunkText;
