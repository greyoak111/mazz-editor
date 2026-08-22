// W88 Library shelf projection.
//
// This module deliberately has no DOM, storage or Electron dependencies.  It
// turns legacy/new shelf records into deterministic view items which can be
// consumed by a grid, list, command palette or tests without mutating the
// persisted records.

const DEFAULT_CATEGORY = '未分类';
const DEFAULT_TITLE = '未命名书籍';
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cleanString(value, limit = 512) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, limit);
}

function plainRecord(record) {
  const output = {};
  if (!record || typeof record !== 'object' || Array.isArray(record)) return output;
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    try { output[key] = record[key]; } catch { /* an accessor must not break a shelf */ }
  }
  return output;
}

function stableHash(value) {
  const text = String(value ?? '');
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a ^= code;
    a = Math.imul(a, 0x01000193) >>> 0;
    b ^= code + ((index + 1) * 131);
    b = Math.imul(b, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function normalizePath(value) {
  let raw = cleanString(value, 4096).replace(/^file:\/{2,3}/i, '/').replace(/\\/g, '/');
  if (!raw) return '';
  if (/^\/[a-z]:\//i.test(raw)) raw = raw.slice(1);
  const absolute = raw.startsWith('/');
  const parts = [];
  for (const segment of raw.replace(/\/{2,}/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length && parts.at(-1) !== '..') parts.pop();
      else if (!absolute) parts.push(segment);
      continue;
    }
    parts.push(segment);
  }
  raw = (absolute ? '/' : '') + parts.join('/');
  if (/^[a-z]:\//i.test(raw) || /^\/[^/]+\/[^/]+/.test(raw)) raw = raw.toLocaleLowerCase('en-US');
  return raw.replace(/\/$/, '');
}

function hashOf(record) {
  return cleanString(
    record?.contentFingerprint ?? record?.sourceHash ?? record?.contentHash ?? record?.hash,
    512,
  ).toLocaleLowerCase('en-US');
}

function formatFrom(record) {
  let format = cleanString(record?.format ?? record?.type, 48).replace(/^\./, '').toLocaleLowerCase('en-US');
  if (!format) {
    const path = cleanString(record?.path || record?.sourcePath, 4096).replace(/[?#].*$/, '');
    const match = path.match(/\.([a-z\d]{1,12})$/i);
    format = match?.[1]?.toLocaleLowerCase('en-US') || '';
  }
  if (['manga', 'folder', 'manga_folder', 'comic-folder'].includes(format)) return 'manga-folder';
  return format || 'unknown';
}

function timeValue(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function filenameTitle(path) {
  const name = cleanString(path, 4096).replace(/\\/g, '/').split('/').at(-1) || '';
  return cleanString(name.replace(/\.[^.]+$/, ''), 512);
}

function normalizeCover(value) {
  // SVG/remote/javascript covers stay out of the view model.  The Library's
  // persisted-cover pipeline emits mazz-res://media URLs; legacy raster data
  // and session blob URLs remain readable during migration.
  const cover = cleanString(value, 8 * 1024 * 1024);
  return /^(?:data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,|blob:|mazz-res:\/\/media\/)/i.test(cover)
    ? cover
    : '';
}

/**
 * Return a plain, safe, legacy-compatible record.
 *
 * Unknown own enumerable fields are retained.  Known display/index fields are
 * normalized, while no input object or nested unknown value is mutated.
 */
export function normalizeShelfRecord(record, { index = 0 } = {}) {
  const source = plainRecord(record);
  const path = cleanString(source.path, 4096);
  const sourcePath = cleanString(source.sourcePath, 4096);
  const title = cleanString(source.title ?? source.name, 512)
    || filenameTitle(path || sourcePath)
    || DEFAULT_TITLE;
  const author = cleanString(source.author ?? source.creator, 512);
  const category = cleanString(source.category, 256) || DEFAULT_CATEGORY;
  const contentHash = hashOf(source);
  const identitySeed = contentHash
    || normalizePath(path || sourcePath)
    || [title, author, formatFrom(source), timeValue(source.addedAt), cleanString(source.cover, 2048), number(index)].join('\u0000');
  const id = cleanString(source.id, 512) || `legacy-${stableHash(identitySeed)}`;

  return {
    ...source,
    id,
    title,
    author,
    category,
    format: formatFrom(source),
    path,
    sourcePath,
    sourceHash: contentHash || cleanString(source.sourceHash, 512),
    cover: normalizeCover(source.cover),
    addedAt: timeValue(source.addedAt ?? source.importedAt ?? source.createdAt),
    lastOpenedAt: timeValue(source.lastOpenedAt ?? source.lastReadAt ?? source.openedAt),
    favorite: source.favorite === true || source.favourite === true || source.starred === true || source.pinned === true,
    missing: source.missing === true || source.unavailable === true || source.exists === false || source.status === 'missing',
  };
}

/** Stable key for view reconciliation. Content hash is stronger than path/id. */
export function shelfIdentity(record) {
  const normalized = normalizeShelfRecord(record);
  const content = hashOf(normalized);
  if (content) return `content:${content}`;
  const path = normalizePath(normalized.path || normalized.sourcePath);
  if (path) return `path:${stableHash(path)}`;
  return `id:${stableHash(normalized.id)}`;
}

function dedupeSignals(record) {
  const normalized = normalizeShelfRecord(record);
  return {
    content: hashOf(normalized),
    paths: [...new Set([
      normalizePath(normalized.path),
      normalizePath(normalized.sourcePath),
    ].filter(Boolean))],
    id: cleanString(normalized.id, 512),
  };
}

/** Keep the first stable occurrence and never mutate input records. */
export function dedupeShelfRecords(records) {
  const output = [];
  const contents = new Set();
  const paths = new Set();
  const ids = new Set();
  for (const [index, candidate] of (Array.isArray(records) ? records : []).entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const normalized = normalizeShelfRecord(candidate, { index });
    const signal = dedupeSignals(normalized);
    if ((signal.content && contents.has(signal.content))
      || signal.paths.some(path => paths.has(path))
      || (signal.id && ids.has(signal.id))) continue;
    if (signal.content) contents.add(signal.content);
    for (const path of signal.paths) paths.add(path);
    if (signal.id) ids.add(signal.id);
    output.push(normalized);
  }
  return output;
}

function searchForm(value) {
  return cleanString(value, 32768)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .normalize('NFD')
    .replace(/\p{Mark}+/gu, '');
}

/** CJK runs remain substring tokens; Latin/number runs are case folded. */
export function tokenizeShelfQuery(query) {
  const text = searchForm(query);
  const matches = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{Letter}\p{Number}]+/gu) || [];
  return [...new Set(matches.filter(Boolean))];
}

function recordSearchText(record) {
  const tags = Array.isArray(record.tags) ? record.tags.join(' ') : record.tags;
  return searchForm([
    record.title, record.author, record.category, record.format,
    record.series, record.publisher, record.description, tags,
    record.path, record.sourcePath,
  ].filter(value => value != null).join('\n'));
}

export function matchesShelfQuery(record, queryOrTokens) {
  const tokens = Array.isArray(queryOrTokens) ? queryOrTokens.map(searchForm).filter(Boolean) : tokenizeShelfQuery(queryOrTokens);
  if (!tokens.length) return true;
  const haystack = recordSearchText(normalizeShelfRecord(record));
  return tokens.every(token => haystack.includes(token));
}

function readProgressSource(source, keys) {
  if (typeof source === 'function') {
    for (const key of keys) {
      const value = source(key);
      if (value != null) return value;
    }
    return null;
  }
  if (source instanceof Map) {
    for (const key of keys) if (source.has(key)) return source.get(key);
    return null;
  }
  if (source && typeof source === 'object') {
    for (const key of keys) if (key && Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  return null;
}

function ratioFromProgress(progress) {
  if (!progress || typeof progress !== 'object') return 0;
  if (progress.completed === true || progress.finished === true || progress.status === 'finished') return 1;

  for (const key of ['ratio', 'pct', 'percentage', 'percent']) {
    if (!Number.isFinite(Number(progress[key]))) continue;
    const raw = Number(progress[key]);
    return clamp(raw > 1 ? raw / 100 : raw, 0, 1);
  }

  const pairs = [
    ['current', 'total', false],
    ['position', 'length', false],
    ['page', 'totalPages', true],
    ['chapter', 'totalChapters', true],
  ];
  for (const [currentKey, totalKey, zeroBased] of pairs) {
    const current = Number(progress[currentKey]);
    const total = Number(progress[totalKey]);
    if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
      return clamp((current + (zeroBased ? 1 : 0)) / total, 0, 1);
    }
  }
  return 0;
}

/** Project one persisted locator into shelf-safe progress metadata. */
export function projectShelfProgress(record, progressSource = {}) {
  const book = normalizeShelfRecord(record);
  const identity = shelfIdentity(book);
  const path = normalizePath(book.path || book.sourcePath);
  const keys = [book.id, identity, path, hashOf(book)].filter(Boolean);
  const external = readProgressSource(progressSource, keys);
  const raw = external && typeof external === 'object'
    ? external
    : (book.progress && typeof book.progress === 'object' ? book.progress : {});
  const ratio = ratioFromProgress(raw);
  const updatedAt = timeValue(raw.updatedAt ?? raw.savedAt ?? raw.lastReadAt ?? raw.timestamp ?? book.lastOpenedAt);
  const status = ratio >= 0.999999
    ? 'finished'
    : (ratio > 0 || raw.page != null || raw.chapter != null || updatedAt > 0 ? 'reading' : 'unread');
  return {
    ratio,
    percent: Math.round(ratio * 1000) / 10,
    status,
    completed: status === 'finished',
    updatedAt,
    locator: plainRecord(raw),
  };
}

function listFilter(value) {
  if (value == null || value === '' || value === 'all') return null;
  const input = value instanceof Set ? [...value] : (Array.isArray(value) ? value : [value]);
  const output = new Set(input.map(item => cleanString(item, 256).toLocaleLowerCase('en-US')).filter(Boolean));
  return output.size ? output : null;
}

function normalizeFilters(filters = {}) {
  const missingInput = filters.missing;
  const missing = missingInput === true || missingInput === 'only' || missingInput === 'missing'
    ? 'only'
    : (missingInput === false || missingInput === 'available' ? 'available' : 'all');
  const favoritesInput = filters.favorites ?? filters.favorite;
  const favorites = favoritesInput === true || favoritesInput === 'only' ? 'only' : 'all';
  return {
    category: listFilter(filters.category),
    format: listFilter(filters.format),
    favorites,
    missing,
  };
}

function itemPasses(item, filters) {
  const book = item.book;
  if (filters.category && !filters.category.has(book.category.toLocaleLowerCase('en-US'))) return false;
  if (filters.format && !filters.format.has(book.format.toLocaleLowerCase('en-US'))) return false;
  if (filters.favorites === 'only' && !book.favorite) return false;
  if (filters.missing === 'only' && !book.missing) return false;
  if (filters.missing === 'available' && book.missing) return false;
  return true;
}

function collator(locale) {
  try { return new Intl.Collator(locale || 'zh-CN', { numeric: true, sensitivity: 'base' }); }
  catch { return new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }); }
}

function recentOf(item) {
  return Math.max(item.book.lastOpenedAt, item.progress.updatedAt, timeValue(item.book.updatedAt), item.book.addedAt);
}

function comparator(sort, language) {
  const compare = collator(language).compare;
  const mode = cleanString(sort || 'recent', 64).toLocaleLowerCase('en-US');
  const direction = mode.endsWith('-desc') ? -1 : 1;
  const name = mode.replace(/-(asc|desc)$/, '');
  return (left, right) => {
    let result = 0;
    if (name === 'title') result = compare(left.book.title, right.book.title);
    else if (name === 'author') result = compare(left.book.author || '\uffff', right.book.author || '\uffff');
    else if (name === 'progress') result = right.progress.ratio - left.progress.ratio;
    else if (name === 'imported' || name === 'added') result = right.book.addedAt - left.book.addedAt;
    else result = recentOf(right) - recentOf(left); // recent defaults newest first

    // Explicit desc reverses alphabetical order. Time/progress modes already
    // default to newest/highest first, so explicit "-asc" reverses them.
    if (name === 'title' || name === 'author') result *= direction;
    else if (mode.endsWith('-asc')) result *= -1;
    if (!result) result = compare(left.book.title, right.book.title);
    if (!result) result = left.sourceIndex - right.sourceIndex;
    if (!result) result = compare(left.key, right.key);
    return result;
  };
}

function groupDescriptor(item, by) {
  const book = item.book;
  switch (by) {
    case 'category': return [book.category || DEFAULT_CATEGORY, book.category || DEFAULT_CATEGORY];
    case 'author': return [book.author || '@unknown', book.author || '未知作者'];
    case 'format': return [book.format, book.format.toLocaleUpperCase('en-US')];
    case 'progress': {
      if (item.progress.status === 'finished') return ['finished', '已读完'];
      if (item.progress.status === 'reading') return ['reading', '在读'];
      return ['unread', '未读'];
    }
    case 'favorite': return book.favorite ? ['favorite', '收藏'] : ['other', '其他'];
    default: return ['all', '全部'];
  }
}

/** Group already-filtered view items, retaining deterministic item order. */
export function groupShelfItems(items, { by = 'none' } = {}) {
  const source = Array.isArray(items) ? items : [];
  if (!by || by === 'none') return [{ key: 'all', label: '全部', count: source.length, start: 0, end: source.length, items: [...source] }];
  const buckets = new Map();
  for (const item of source) {
    const [key, label] = groupDescriptor(item, by);
    if (!buckets.has(key)) buckets.set(key, { key, label, items: [] });
    buckets.get(key).items.push(item);
  }
  const groups = [...buckets.values()];
  if (by === 'progress') {
    const rank = new Map([['reading', 0], ['unread', 1], ['finished', 2]]);
    groups.sort((a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99));
  } else if (by === 'favorite') {
    groups.sort((a, b) => (a.key === 'favorite' ? -1 : 1) - (b.key === 'favorite' ? -1 : 1));
  } else {
    const compare = collator('zh-CN').compare;
    groups.sort((a, b) => compare(a.label, b.label));
  }
  let offset = 0;
  return groups.map(group => {
    const start = offset;
    offset += group.items.length;
    return { ...group, count: group.items.length, start, end: offset };
  });
}

/** Return facet counts from view items without applying any filters. */
export function shelfFacets(items) {
  const category = new Map();
  const format = new Map();
  let favorites = 0;
  let missing = 0;
  for (const item of Array.isArray(items) ? items : []) {
    category.set(item.book.category, (category.get(item.book.category) || 0) + 1);
    format.set(item.book.format, (format.get(item.book.format) || 0) + 1);
    if (item.book.favorite) favorites++;
    if (item.book.missing) missing++;
  }
  const asList = map => [...map.entries()].map(([key, count]) => ({ key, count }));
  return { category: asList(category), format: asList(format), favorites, missing };
}

/**
 * Fixed-row grid virtualization math for large shelves.
 * `endIndex` is exclusive and padding values exclude the row gap at the edge.
 */
export function computeVirtualWindow({
  count = 0,
  scrollTop = 0,
  viewportHeight = 0,
  itemHeight = 1,
  rowGap = 0,
  columns = 1,
  overscanRows = 2,
} = {}) {
  const total = Math.max(0, Math.trunc(number(count)));
  const cols = Math.max(1, Math.trunc(number(columns, 1)));
  const height = Math.max(1, number(itemHeight, 1));
  const gap = Math.max(0, number(rowGap));
  const stride = height + gap;
  const rows = Math.ceil(total / cols);
  const totalHeight = rows ? (rows * height) + ((rows - 1) * gap) : 0;
  if (!total || viewportHeight <= 0) {
    return {
      startIndex: 0, endIndex: 0, startRow: 0, endRow: 0,
      visibleStartRow: 0, visibleEndRow: 0, rows, columns: cols,
      paddingTop: 0, paddingBottom: totalHeight, totalHeight,
    };
  }

  const top = clamp(number(scrollTop), 0, Math.max(0, totalHeight));
  const viewport = Math.max(0, number(viewportHeight));
  const overscan = Math.max(0, Math.trunc(number(overscanRows, 2)));
  const visibleStartRow = clamp(Math.floor(top / stride), 0, rows);
  const visibleEndRow = clamp(Math.ceil((top + viewport) / stride), visibleStartRow, rows);
  const startRow = Math.max(0, visibleStartRow - overscan);
  const endRow = Math.min(rows, visibleEndRow + overscan);
  const startIndex = Math.min(total, startRow * cols);
  const endIndex = Math.min(total, endRow * cols);
  const paddingTop = startRow * stride;
  const paddingBottom = Math.max(0, totalHeight - (endRow ? (endRow * height) + ((endRow - 1) * gap) : 0));
  return {
    startIndex, endIndex, startRow, endRow,
    visibleStartRow, visibleEndRow, rows, columns: cols,
    paddingTop, paddingBottom, totalHeight,
  };
}

function createViewItems(records, progress) {
  return records.map((book, sourceIndex) => ({
    key: shelfIdentity(book),
    sourceIndex,
    book,
    progress: projectShelfProgress(book, progress),
    searchText: recordSearchText(book),
  }));
}

/** Immutable shelf query model. Use with(patch) to create the next state. */
export class ShelfViewModel {
  constructor({
    records = [], progress = {}, query = '', filters = {}, sort = 'recent',
    group = 'none', locale = 'zh-CN', now = Date.now(), _prepared = null,
  } = {}) {
    const input = Array.isArray(records) ? records : [];
    const reusable = _prepared?.input === input && _prepared?.progressSource === progress;
    this._inputRecords = reusable ? input : [...input];
    this.records = reusable ? _prepared.records : dedupeShelfRecords(this._inputRecords);
    this.progressSource = progress;
    this.query = cleanString(query, 4096);
    this.filters = normalizeFilters(filters);
    this.sort = cleanString(sort || 'recent', 64) || 'recent';
    this.group = cleanString(group || 'none', 64) || 'none';
    this.locale = cleanString(locale || 'zh-CN', 64) || 'zh-CN';
    this.now = timeValue(now);
    this.rawCount = this._inputRecords.length;
    this._prepared = reusable
      ? _prepared
      : {
          input: this._inputRecords,
          progressSource: progress,
          records: this.records,
          allItems: createViewItems(this.records, progress),
        };
    if (!this._prepared.facets) this._prepared.facets = shelfFacets(this._prepared.allItems);
  }

  with(patch = {}) {
    const has = key => Object.prototype.hasOwnProperty.call(patch, key);
    return new ShelfViewModel({
      records: has('records') ? patch.records : this._inputRecords,
      progress: has('progress') ? patch.progress : this.progressSource,
      query: has('query') ? patch.query : this.query,
      filters: has('filters') ? patch.filters : this.filters,
      sort: has('sort') ? patch.sort : this.sort,
      group: has('group') ? patch.group : this.group,
      locale: has('locale') ? patch.locale : this.locale,
      now: has('now') ? patch.now : this.now,
      _prepared: this._prepared,
    });
  }

  snapshot() {
    const allItems = this._prepared.allItems;
    const tokens = tokenizeShelfQuery(this.query);
    const filtered = allItems
      .filter(item => (!tokens.length || tokens.every(token => item.searchText.includes(token))))
      .filter(item => itemPasses(item, this.filters))
      .sort(comparator(this.sort, this.locale));
    const groups = groupShelfItems(filtered, { by: this.group });
    const items = groups.flatMap(group => group.items);
    return {
      items,
      groups,
      facets: this._prepared.facets,
      total: allItems.length,
      filteredTotal: items.length,
      duplicateCount: Math.max(0, this.rawCount - this.records.length),
      query: this.query,
      tokens,
      filters: this.filters,
      sort: this.sort,
      group: this.group,
    };
  }

  virtualize(layout = {}) {
    const snapshot = this.snapshot();
    const window = computeVirtualWindow({ ...layout, count: snapshot.items.length });
    return { ...window, items: snapshot.items.slice(window.startIndex, window.endIndex), snapshot };
  }
}

export function createShelfViewModel(options) {
  return new ShelfViewModel(options);
}

export const _forTests = {
  cleanString,
  normalizePath,
  hashOf,
  ratioFromProgress,
  normalizeFilters,
  normalizeCover,
  recordSearchText,
  stableHash,
};
