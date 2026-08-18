// main/torrent-site-core.js —— W65a 四站资源行纯适配核心（无 Electron / 网络副作用）
'use strict';

const RESOURCE_ROW_SCHEMA = 'mazz.torrent-resource-row/v0';
const RESOURCE_AGGREGATE_SCHEMA = 'mazz.torrent-resource-aggregate/v0';
const MIKAN_CATALOG_SCHEMA = 'mazz.mikan-catalog/v0';
const RESOURCE_ROW_FIELDS = Object.freeze([
  'title', 'date', 'size', 'seeders', 'leechers', 'completed',
  'magnet', 'torrentUrl', 'sourceSite', 'sourceUrl', 'subgroup',
  'resolution', 'infoHash',
]);

const HTML_ENTITIES = Object.freeze({
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
});

function decodeHtml(value) {
  return String(value || '').replace(/&(#x?[0-9a-f]+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : _;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? _;
  });
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(base, href) {
  const decoded = decodeHtml(href).trim();
  if (!decoded) return '';
  try { return new URL(decoded, base).href; } catch { return ''; }
}

function base32BtihToHex(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of String(value || '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) return '';
    bits += index.toString(2).padStart(5, '0');
  }
  if (bits.length < 160) return '';
  let hex = '';
  for (let offset = 0; offset < 160; offset += 8) {
    hex += Number.parseInt(bits.slice(offset, offset + 8), 2).toString(16).padStart(2, '0');
  }
  return hex;
}

function normalizeInfoHash(value) {
  let candidate = decodeHtml(value).trim();
  const magnetMatch = /(?:^|[?&])xt=urn:btih:([a-z0-9]{32}|[a-f0-9]{40})(?:&|$)/i.exec(candidate);
  if (magnetMatch) candidate = magnetMatch[1];
  const pathMatch = /(?:show-|episode\/|download\/[^/]+\/)([a-f0-9]{40})(?:\.|\/|$)/i.exec(candidate);
  if (pathMatch) candidate = pathMatch[1];
  if (/^[a-f0-9]{40}$/i.test(candidate)) return candidate.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(candidate)) return base32BtihToHex(candidate);
  return '';
}

function inferSubgroup(title) {
  const match = /^\s*[\[【]([^\]】]{1,80})[\]】]/.exec(String(title || ''));
  return match ? match[1].trim() : '';
}

function inferResolution(title) {
  const match = /(?:^|[^0-9])(4320p|2160p|1440p|1080[pi]?|720p|576p|480p|4k|8k)(?:[^0-9]|$)/i.exec(String(title || ''));
  return match ? match[1].toUpperCase().replace(/I$/, 'i') : '';
}

function nullableCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/[,\s]/g, '');
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

function normalizeResourceRow(input) {
  const title = stripTags(input?.title);
  const magnet = decodeHtml(input?.magnet).trim();
  const torrentUrl = decodeHtml(input?.torrentUrl).trim();
  const sourceUrl = decodeHtml(input?.sourceUrl).trim();
  const infoHash = normalizeInfoHash(input?.infoHash || magnet || torrentUrl || sourceUrl);
  return {
    title,
    date: stripTags(input?.date),
    size: stripTags(input?.size),
    seeders: nullableCount(input?.seeders),
    leechers: nullableCount(input?.leechers),
    completed: nullableCount(input?.completed),
    magnet,
    torrentUrl,
    sourceSite: String(input?.sourceSite || '').trim(),
    sourceUrl,
    subgroup: stripTags(input?.subgroup) || inferSubgroup(title),
    resolution: stripTags(input?.resolution) || inferResolution(title),
    infoHash,
  };
}

function isResourceRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== RESOURCE_ROW_FIELDS.length || keys.some((key, index) => key !== RESOURCE_ROW_FIELDS[index])) return false;
  if (!value.title || !value.sourceSite || !value.sourceUrl || !/^[a-f0-9]{40}$/.test(value.infoHash)) return false;
  return ['seeders', 'leechers', 'completed'].every((key) => value[key] === null || Number.isInteger(value[key]));
}

function rowBlocks(html) {
  return [...String(html || '').matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
}

function cellsOf(row) {
  return [...String(row || '').matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
}

function anchorsOf(fragment) {
  return [...String(fragment || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => {
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(match[1])?.[1] || '';
    return { href: decodeHtml(href), text: stripTags(match[2]), attrs: match[1] };
  });
}

function firstAttribute(fragment, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(String(fragment || ''));
  return decodeHtml(match?.[1] || '');
}

function parseDmhyRows(html, { baseUrl = 'https://share.dmhy.org/' } = {}) {
  const rows = [];
  for (const block of rowBlocks(html)) {
    const anchors = anchorsOf(block);
    const topic = anchors.find((anchor) => /\/topics\/view\//i.test(anchor.href));
    const magnet = /magnet:\?xt=urn:btih:[a-z0-9]{32,40}[^"'<\s]*/i.exec(decodeHtml(block))?.[0] || '';
    if (!topic || !magnet) continue;
    const cells = cellsOf(block);
    const sizeIndex = cells.findIndex((cell) => /\b\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB)\b/i.test(stripTags(cell)));
    const dateCell = cells[0] || '';
    const exactDate = /20\d{2}[/-]\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}:\d{2})?/.exec(stripTags(dateCell))?.[0];
    const countCells = sizeIndex >= 0 ? cells.slice(sizeIndex + 1).map(stripTags).filter((v) => /^\d[\d,]*$/.test(v)) : [];
    const uploader = cells.length ? anchorsOf(cells[cells.length - 1]).at(-1)?.text || stripTags(cells[cells.length - 1]) : '';
    const sourceUrl = absoluteUrl(baseUrl, topic.href);
    const row = normalizeResourceRow({
      title: topic.text,
      date: exactDate || stripTags(dateCell),
      size: sizeIndex >= 0 ? stripTags(cells[sizeIndex]) : '',
      seeders: countCells[0], leechers: countCells[1], completed: countCells[2],
      magnet, torrentUrl: anchors.find((anchor) => /\.torrent(?:\?|$)/i.test(anchor.href))?.href || '',
      sourceSite: 'dmhy', sourceUrl, subgroup: uploader,
    });
    if (isResourceRow(row)) rows.push(row);
  }
  return rows;
}

function parseMikanRows(html, { baseUrl = 'https://mikanime.tv/' } = {}) {
  const rows = [];
  for (const block of rowBlocks(html)) {
    const anchors = anchorsOf(block);
    const episode = anchors.find((anchor) => /\/Home\/Episode\/[a-f0-9]{40}/i.test(anchor.href));
    const torrent = anchors.find((anchor) => /\/Download\/[^/]+\/[a-f0-9]{40}\.torrent/i.test(anchor.href));
    const magnet = firstAttribute(block, 'data-magnet') || /magnet:\?xt=urn:btih:[a-z0-9]{32,40}[^"'<\s]*/i.exec(decodeHtml(block))?.[0] || '';
    if (!episode || (!magnet && !torrent)) continue;
    const cells = cellsOf(block).map(stripTags);
    const size = cells.find((value) => /\b\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB)\b/i.test(value)) || '';
    const date = cells.find((value) => /20\d{2}[/-]\d{1,2}[/-]\d{1,2}/.test(value)) || '';
    const sourceUrl = absoluteUrl(baseUrl, episode.href);
    const row = normalizeResourceRow({
      title: episode.text, date, size, magnet,
      torrentUrl: absoluteUrl(baseUrl, torrent?.href),
      sourceSite: 'mikan', sourceUrl,
    });
    if (isResourceRow(row)) rows.push(row);
  }
  return rows;
}

function parseUploadbtRows(html, { siteId, baseUrl }) {
  if (!siteId || !baseUrl) throw new TypeError('parseUploadbtRows requires siteId and baseUrl');
  const rows = [];
  for (const block of rowBlocks(html)) {
    const cells = cellsOf(block);
    const anchors = anchorsOf(block);
    const detail = anchors.find((anchor) => /(?:^|\/)show-([a-f0-9]{40})\.html(?:$|[?#])/i.test(anchor.href));
    if (!detail) continue;
    const infoHash = /show-([a-f0-9]{40})\.html/i.exec(detail.href)?.[1]?.toLowerCase() || '';
    const sourceUrl = absoluteUrl(baseUrl, detail.href);
    const row = normalizeResourceRow({
      title: detail.text,
      date: stripTags(cells[0]),
      size: stripTags(cells[3]),
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
      torrentUrl: '', sourceSite: siteId, sourceUrl,
      subgroup: anchorsOf(cells[4] || '').at(-1)?.text || stripTags(cells[4]),
      infoHash,
    });
    if (isResourceRow(row)) rows.push(row);
  }
  return rows;
}

function tagValue(fragment, tagName) {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(String(fragment || ''));
  return stripTags(String(match?.[1] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1'));
}

function parseUploadbtRss(xml, { siteId, baseUrl }) {
  if (!siteId || !baseUrl) throw new TypeError('parseUploadbtRss requires siteId and baseUrl');
  const rows = [];
  for (const match of String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const sourceHref = tagValue(item, 'link') || tagValue(item, 'guid');
    const enclosure = /<enclosure\b[^>]*\burl\s*=\s*["']([^"']+)["']/i.exec(item)?.[1] || '';
    const infoHash = normalizeInfoHash(sourceHref || enclosure);
    if (!infoHash) continue;
    const sourceUrl = absoluteUrl(baseUrl, sourceHref || `show-${infoHash}.html`);
    const row = normalizeResourceRow({
      title: tagValue(item, 'title'),
      date: tagValue(item, 'pubDate'),
      size: '',
      seeders: null,
      leechers: null,
      completed: null,
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
      torrentUrl: absoluteUrl(baseUrl, enclosure),
      sourceSite: siteId,
      sourceUrl,
      subgroup: tagValue(item, 'author'),
      infoHash,
    });
    if (isResourceRow(row)) rows.push(row);
  }
  return rows;
}

function parsePageInfo(html, currentPage = 1) {
  const current = Math.max(1, Number.parseInt(currentPage, 10) || 1);
  const pages = new Set([current]);
  const decoded = decodeHtml(html);
  for (const match of decoded.matchAll(/(?:[?&]page=|\/page\/)(\d{1,6})(?:\D|$)/gi)) {
    const page = Number(match[1]);
    if (Number.isSafeInteger(page) && page > 0) pages.add(page);
  }
  const totalPages = Math.max(...pages);
  return {
    page: current,
    totalPages,
    hasMore: totalPages > current,
    nextPage: totalPages > current ? current + 1 : null,
  };
}

function parseMikanCatalog(html, { baseUrl = 'https://mikanime.tv/', year = '', season = '' } = {}) {
  const source = String(html || '');
  const seasons = [];
  const seasonKeys = new Set();
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    if (!/\bonclick\s*=\s*["'][^"']*Update(?:Mobile)?BangumiCoverFlow/i.test(attrs)) continue;
    const itemYear = firstAttribute(attrs, 'data-year');
    const itemSeason = firstAttribute(attrs, 'data-season');
    if (!itemYear || !itemSeason) continue;
    const key = `${itemYear}\0${itemSeason}`;
    if (seasonKeys.has(key)) continue;
    seasonKeys.add(key);
    seasons.push({ year: itemYear, season: itemSeason, label: stripTags(match[2]) || `${itemYear} ${itemSeason}季番组` });
  }

  const starts = [...source.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*\bsk-bangumi\b[^"']*["'][^>]*>/gi)];
  const items = [];
  const itemKeys = new Set();
  const dayLabels = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '剧场版'];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const block = source.slice(start.index, starts[index + 1]?.index ?? source.length);
    const dayOfWeek = Math.max(0, Number.parseInt(firstAttribute(start[0], 'data-dayofweek'), 10) || 0);
    for (const link of block.matchAll(/<a\b([^>]*)\bhref\s*=\s*["']([^"']*\/Home\/Bangumi\/(\d+)[^"']*)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const bangumiId = link[3];
      if (itemKeys.has(bangumiId)) continue;
      itemKeys.add(bangumiId);
      const before = block.slice(Math.max(0, link.index - 700), link.index);
      const imageMatches = [...before.matchAll(/\bdata-src\s*=\s*["']([^"']+)["']/gi)];
      const dateMatches = [...before.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*\bdate-text\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
      items.push({
        bangumiId,
        title: stripTags(link[5]) || stripTags(firstAttribute(`${link[1]} ${link[4]}`, 'title')),
        url: absoluteUrl(baseUrl, link[2]),
        imageUrl: absoluteUrl(baseUrl, imageMatches.at(-1)?.[1] || ''),
        updatedAt: stripTags(dateMatches.at(-1)?.[1] || ''),
        dayOfWeek,
        dayLabel: dayLabels[dayOfWeek] || `周历 ${dayOfWeek}`,
      });
    }
  }
  return {
    schema: MIKAN_CATALOG_SCHEMA,
    year: String(year || seasons[0]?.year || ''),
    season: String(season || seasons[0]?.season || ''),
    seasons,
    items,
  };
}

function parseMagnet(html) {
  const decoded = decodeHtml(html);
  const match = /magnet:\?xt=urn:btih:[a-z0-9]{32,40}[^"'<\s]*/i.exec(decoded);
  if (!match) return null;
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(String(html || ''));
  return { magnet: match[0], title: heading ? stripTags(heading[1]) : '', infoHash: normalizeInfoHash(match[0]) };
}

function aggregateResourceRows(rows) {
  const groups = new Map();
  for (const candidate of rows || []) {
    const row = normalizeResourceRow(candidate);
    if (!isResourceRow(row)) continue;
    let group = groups.get(row.infoHash);
    if (!group) {
      group = { schema: RESOURCE_AGGREGATE_SCHEMA, infoHash: row.infoHash, primary: row, sources: [] };
      groups.set(row.infoHash, group);
    }
    const sourceKey = `${row.sourceSite}\0${row.sourceUrl}`;
    if (!group.sources.some((source) => `${source.sourceSite}\0${source.sourceUrl}` === sourceKey)) {
      group.sources.push({
        sourceSite: row.sourceSite, sourceUrl: row.sourceUrl,
        magnet: row.magnet, torrentUrl: row.torrentUrl,
      });
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    sources: group.sources.sort((left, right) => left.sourceSite.localeCompare(right.sourceSite) || left.sourceUrl.localeCompare(right.sourceUrl)),
  }));
}

module.exports = {
  RESOURCE_ROW_SCHEMA,
  RESOURCE_AGGREGATE_SCHEMA,
  MIKAN_CATALOG_SCHEMA,
  RESOURCE_ROW_FIELDS,
  decodeHtml,
  stripTags,
  absoluteUrl,
  normalizeInfoHash,
  normalizeResourceRow,
  isResourceRow,
  parseDmhyRows,
  parseMikanRows,
  parseUploadbtRows,
  parseUploadbtRss,
  parsePageInfo,
  parseMikanCatalog,
  parseMagnet,
  aggregateResourceRows,
};
