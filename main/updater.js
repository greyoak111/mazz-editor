// main/updater.js —— 自动更新入口（接口层）：manifest 拉取 + 版本比较；下载/安装留待发布渠道定稿
'use strict';
const https = require('https');
const http = require('http');

const UA = 'MazzEditor-Updater/0.1';

function normalizeUpdateUrl(value, { allowEmpty = true } = {}) {
  const text = String(value || '').trim();
  if (!text && allowEmpty) return '';
  if (text.length > 2048) throw new Error('更新源地址过长');
  const url = new URL(text);
  if (url.protocol !== 'https:') throw new Error('更新源必须使用 HTTPS');
  if (url.username || url.password) throw new Error('更新源地址不得包含凭据');
  if (url.hash) throw new Error('更新源地址不得包含片段');
  return url.toString();
}

function getJson(url, { timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(normalizeUpdateUrl(url, { allowEmpty: false }));
    const lib = https;
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Encoding': 'identity' },
      rejectUnauthorized: true, timeout, agent: false,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { data += d; if (data.length > 1e6) req.destroy(); });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch (e) { reject(new Error('更新源返回的不是合法 JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** 语义化版本比较：a>b 返回 1，a<b 返回 -1，相等 0（只比数字段） */
function semverCompare(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

class Updater {
  constructor({ bus, store, version }) {
    this.store = store;
    this.version = version || '0.1.0';
    bus.handle('update:check', async () => this.check());
    bus.handle('update:getConfig', async () => ({
      url: this.store.get('update', {}).url || '',
      maturity: 'hidden', gate: 'CONDITIONAL_RELEASE_INFRASTRUCTURE',
      supportsAutomaticInstall: false,
    }));
    bus.handle('update:setConfig', async ({ url }) => {
      this.store.set('update', { url: normalizeUpdateUrl(url) });
      return true;
    });
  }

  async check() {
    const { url } = this.store.get('update', {});
    if (!url) {
      return { ok: false, current: this.version, message: '未配置更新源（设置 → 更新 → 更新源地址）' };
    }
    try {
      const { status, json } = await getJson(url);
      if (status !== 200) throw new Error('更新源响应 HTTP ' + status);
      const latest = json.version || json.tag_name || '';
      if (!latest) throw new Error('更新源清单缺少 version 字段');
      const hasUpdate = semverCompare(latest, this.version) > 0;
      return {
        ok: true,
        current: this.version,
        latest,
        hasUpdate,
        notes: String(json.notes || json.body || '').slice(0, 50_000),
        files: (Array.isArray(json.files) ? json.files : Array.isArray(json.assets) ? json.assets : []).slice(0, 20),
        message: hasUpdate ? `发现新版本 ${latest}` : `已是最新（${this.version}）`,
      };
    } catch (e) {
      return { ok: false, current: this.version, message: '检查更新失败：' + (e.message || e) };
    }
  }
}

module.exports = Updater;
module.exports.semverCompare = semverCompare;
module.exports.getJson = getJson;
module.exports.normalizeUpdateUrl = normalizeUpdateUrl;
