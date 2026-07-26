// main/torrent-sites.js —— 种子站适配器（动漫花园系：搜索行(日期/类型/标题/大小/上传者) + 详情页 magnet）
// 结构已破（resource-row 五列规整 + detail 页 btih 直出），懒加载：先出行，点播放再取详情
'use strict';
const { net } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const SITES = {
  dmhy: {
    id: 'dmhy', name: '动漫花园',
    homeUrl: 'https://dongmanhuayuan.com/',
    searchUrl: (kw) => `https://dongmanhuayuan.com/search/${encodeURIComponent(kw)}/`,
    detailBase: 'https://dongmanhuayuan.com',
  },
  'dmhy-sync': {
    id: 'dmhy-sync', name: '动漫花园（同步站）',
    homeUrl: 'https://dongmanhuayuan.myheartsite.com/',
    searchUrl: (kw) => `https://dongmanhuayuan.myheartsite.com/search/${encodeURIComponent(kw)}/`,
    detailBase: 'https://dongmanhuayuan.myheartsite.com',
  },
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url });
    req.setHeader('User-Agent', UA);
    req.setHeader('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8');
    let body = '';
    req.on('response', (res) => {
      if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.on('data', (c) => { body += c.toString('utf8'); });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });
}

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** resource-row 五行解析（日期/类型/标题+详情链/大小/上传者） */
function parseDmhyRows(html) {
  const rows = [];
  const parts = String(html).split(/<tr class="resource-row[^"]*"/).slice(1);
  for (const part of parts) {
    const row = part.slice(0, part.indexOf('</tr>') > -1 ? part.indexOf('</tr>') : part.length);
    const m = /whitespace-nowrap">([^<]{4,20})<\/td>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?whitespace-nowrap">([^<]{2,20})<\/td>[\s\S]*?text-gray-600">([\s\S]*?)<\/td>/.exec(row);
    if (!m) continue;
    const [, date, type, href, title, size, uploader] = m;
    rows.push({
      date: stripTags(date), type: stripTags(type), href,
      title: stripTags(title), size: stripTags(size), uploader: stripTags(uploader),
    });
  }
  return rows;
}

function parseMagnet(html) {
  const m = /magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^"'<]*/.exec(String(html));
  if (!m) return null;
  const t = /<h1[^>]*class="[^"]*seo-h1[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(String(html));
  return { magnet: m[0], title: t ? stripTags(t[1]) : '' };
}

class TorrentSites {
  constructor({ bus }) {
    this.bus = bus;
    bus.handle('sites:list', async () => Object.values(SITES).map(s => ({ id: s.id, name: s.name })));
    bus.handle('sites:search', async ({ site, kw }) => {
      const s = SITES[site];
      if (!s) throw new Error('未知站点：' + site);
      if (!kw || !String(kw).trim()) return { rows: [], kw };
      const html = await fetchText(s.searchUrl(String(kw).trim()));
      return { rows: parseDmhyRows(html), kw };
    });
    // 首页即当日上传列表——与搜索页同构（resource-row 五列规整），解析器直接复用
    bus.handle('sites:home', async ({ site }) => {
      const s = SITES[site];
      if (!s) throw new Error('未知站点：' + site);
      const html = await fetchText(s.homeUrl);
      return { rows: parseDmhyRows(html) };
    });
    bus.handle('sites:magnet', async ({ site, href }) => {
      const s = SITES[site];
      if (!s) throw new Error('未知站点：' + site);
      const url = href.startsWith('http') ? href : s.detailBase + href;
      const html = await fetchText(url);
      const r = parseMagnet(html);
      if (!r) throw new Error('详情页未取到 magnet（站点结构可能已变）');
      return r;
    });
  }
}

module.exports = TorrentSites;
