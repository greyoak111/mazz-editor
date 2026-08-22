// W88 Library shelf model: pure normalization/search/filter/sort/group/window.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  ShelfViewModel,
  computeVirtualWindow,
  createShelfViewModel,
  dedupeShelfRecords,
  groupShelfItems,
  matchesShelfQuery,
  normalizeShelfRecord,
  projectShelfProgress,
  shelfFacets,
  shelfIdentity,
  tokenizeShelfQuery,
} from '../../renderer/modules/library/shelf-model.js';

const books = () => ([
  {
    id: 'a', title: 'Book 10 魔法少女', author: 'Zebra', category: '技术',
    format: 'EPUB', path: 'D:\\Books\\A.epub', addedAt: 1, lastOpenedAt: 5,
    favorite: true, customPluginField: { edition: 2 },
  },
  {
    id: 'b', title: 'Book 2', author: 'Alpha', category: '技术',
    format: 'pdf', path: 'D:/Books/B.pdf', addedAt: 3, lastOpenedAt: 10,
    missing: true,
  },
  {
    id: 'c', title: '漫画合集', author: 'Beta', category: '漫画',
    format: 'cbz', path: 'D:/Books/C.cbz', addedAt: 2, lastOpenedAt: 7,
    starred: true,
  },
]);

const progress = {
  a: { ratio: 0.2, updatedAt: 4 },
  b: { pct: 0.8, updatedAt: 9 },
  c: { completed: true, updatedAt: 6 },
};

describe('W88 Library · shelf record normalization and identity', () => {
  test('保留未知字段、不修改输入，并规范化旧字段/格式/缺失状态', () => {
    const source = {
      name: '  Legacy\u0000 Book  ', creator: '  李四  ', path: 'D:/Shelf/legacy.MOBI',
      category: '', pinned: true, exists: false, extensionField: { source: 'plugin' },
    };
    const before = source.path;
    const normalized = normalizeShelfRecord(source);

    assert.equal(normalized.title, 'Legacy Book');
    assert.equal(normalized.author, '李四');
    assert.equal(normalized.category, '未分类');
    assert.equal(normalized.format, 'mobi');
    assert.equal(normalized.favorite, true);
    assert.equal(normalized.missing, true);
    assert.deepEqual(normalized.extensionField, { source: 'plugin' });
    assert.equal(source.path, before, '不得回写输入记录');
    assert.ok(normalized.id.startsWith('legacy-'));
    assert.equal(normalizeShelfRecord(source).id, normalized.id, '无 id 老记录必须得到稳定 id');
  });

  test('阻断原型污染键，内容指纹优先于路径/id 生成身份', () => {
    const source = { id: 'x', title: 'X', path: 'D:/X.epub', sourceHash: ' ABCDEF ', cover: 'javascript:alert(1)' };
    Object.defineProperty(source, '__proto__', { enumerable: true, value: { polluted: true } });
    const normalized = normalizeShelfRecord(source);
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized, '__proto__'), false);
    assert.equal(normalized.sourceHash, 'abcdef');
    assert.equal(normalized.cover, '', '不安全/远程封面不得进入渲染投影');
    assert.equal(shelfIdentity(normalized), 'content:abcdef');
    assert.equal(normalizeShelfRecord({ cover: 'mazz-res://media/D%3A/c.webp' }).cover, 'mazz-res://media/D%3A/c.webp');
  });

  test('按 sourceHash、本地路径/来源路径和 id 稳定去重，保留第一条', () => {
    const result = dedupeShelfRecords([
      { id: 'one', title: '第一版', path: 'D:\\Books\\A.epub', sourceHash: 'HASH-A', keep: 1 },
      { id: 'hash-copy', title: '指纹重复', path: 'E:/Copy.epub', sourceHash: 'hash-a' },
      { id: 'two', title: '路径原件', path: 'file:///D:/Books/B.epub' },
      { id: 'path-copy', title: '来源路径重复', sourcePath: 'd:\\books\\b.epub' },
      { id: 'three', title: '仅 id' },
      { id: 'three', title: 'id 重复' },
    ]);
    assert.deepEqual(result.map(book => book.title), ['第一版', '路径原件', '仅 id']);
    assert.equal(result[0].keep, 1);
  });
});

describe('W88 Library · multilingual search and progress projection', () => {
  test('CJK 连续串按子串命中，Latin 折叠大小写/重音并执行 AND 查询', () => {
    assert.deepEqual(
      tokenizeShelfQuery('魔法 少女  ÉCOLE-2024'),
      ['魔法', '少女', 'ecole', '2024'],
    );
    const record = {
      title: '魔法少女 Madoka', author: '新房昭之', category: '动画',
      tags: ['治愈', 'Ecole'], path: 'D:/Anime/Madoka.epub',
    };
    assert.equal(matchesShelfQuery(record, '魔法 少女 madoka'), true);
    assert.equal(matchesShelfQuery(record, '魔法 科幻'), false);
    assert.equal(matchesShelfQuery(record, ['ECOLE', '动画']), true);
  });

  test('进度可从 object/Map/内嵌旧记录投影，并一律夹紧到 0..1', () => {
    const mapped = projectShelfProgress({ id: 'a', title: 'A' }, new Map([
      ['a', { ratio: 0.424, updatedAt: 9, anchor: { p: '/2' } }],
    ]));
    assert.equal(mapped.ratio, 0.424);
    assert.equal(mapped.percent, 42.4);
    assert.equal(mapped.status, 'reading');
    assert.deepEqual(mapped.locator.anchor, { p: '/2' });

    const legacy = projectShelfProgress({ id: 'b', progress: { page: 4, totalPages: 10 } });
    assert.equal(legacy.ratio, 0.5, '页码 locator 是零起点');
    assert.equal(projectShelfProgress({ id: 'c' }, { c: { percent: 173 } }).ratio, 1);
    assert.equal(projectShelfProgress({ id: 'd' }, { d: { finished: true } }).status, 'finished');
    assert.equal(projectShelfProgress({ id: 'e' }).status, 'unread');
  });
});

describe('W88 Library · query, sort, filter, grouping and facets', () => {
  test('五类排序稳定：recent/title/author/progress/imported', () => {
    const options = { records: books(), progress };
    const ids = sort => createShelfViewModel({ ...options, sort }).snapshot().items.map(item => item.book.id);
    assert.deepEqual(ids('recent'), ['b', 'c', 'a']);
    assert.deepEqual(ids('title'), ['c', 'b', 'a']);
    assert.ok(ids('title').indexOf('b') < ids('title').indexOf('a'), 'Intl numeric 排序应使 Book 2 在 Book 10 前');
    assert.deepEqual(ids('title-desc'), ['a', 'b', 'c']);
    assert.deepEqual(ids('author'), ['b', 'c', 'a']);
    assert.deepEqual(ids('progress'), ['c', 'b', 'a']);
    assert.deepEqual(ids('imported'), ['b', 'c', 'a']);
    assert.deepEqual(ids('imported-asc'), ['a', 'c', 'b']);
  });

  test('查询与类别/收藏/格式/缺失四种筛选可组合', () => {
    const model = new ShelfViewModel({
      records: books(), progress, query: 'book',
      filters: { category: ['技术'], favorites: true, format: new Set(['epub']), missing: 'available' },
      sort: 'title',
    });
    assert.deepEqual(model.snapshot().items.map(item => item.book.id), ['a']);
    assert.deepEqual(model.with({ query: '', filters: { missing: 'only' } }).snapshot().items.map(item => item.book.id), ['b']);
    assert.deepEqual(model.with({ query: '', filters: { category: '漫画', format: 'cbz' } }).snapshot().items.map(item => item.book.id), ['c']);
  });

  test('分组返回连续 start/end，进度组顺序固定为在读/未读/已读完', () => {
    const base = createShelfViewModel({ records: books(), progress, sort: 'title' }).snapshot().items;
    const groups = groupShelfItems(base, { by: 'progress' });
    assert.deepEqual(groups.map(group => group.key), ['reading', 'finished']);
    assert.deepEqual(groups.map(group => [group.start, group.end, group.count]), [[0, 2, 2], [2, 3, 1]]);

    const snapshot = createShelfViewModel({ records: books(), progress, group: 'category' }).snapshot();
    assert.equal(snapshot.items.length, 3);
    assert.equal(snapshot.groups.reduce((sum, group) => sum + group.count, 0), 3);
    assert.equal(snapshot.groups.every(group => group.end - group.start === group.count), true);
  });

  test('分面统计使用去重后全量数据，不被当前查询篡改', () => {
    const model = createShelfViewModel({ records: books(), progress, query: '不存在' });
    const snapshot = model.snapshot();
    assert.equal(snapshot.filteredTotal, 0);
    assert.deepEqual(snapshot.facets.category, [
      { key: '技术', count: 2 },
      { key: '漫画', count: 1 },
    ]);
    assert.equal(snapshot.facets.favorites, 2);
    assert.equal(snapshot.facets.missing, 1);
    assert.deepEqual(shelfFacets([]), { category: [], format: [], favorites: 0, missing: 0 });
  });

  test('with() 产生新模型且保留原始去重诊断', () => {
    const records = [...books(), { ...books()[0], id: 'duplicate', sourceHash: 'same' }, { ...books()[0], id: 'duplicate-2', sourceHash: 'same' }];
    const original = createShelfViewModel({ records, query: '' });
    const next = original.with({ query: '漫画' });
    assert.notEqual(next, original);
    assert.equal(original.query, '');
    assert.equal(next.query, '漫画');
    assert.equal(next.snapshot().duplicateCount, original.snapshot().duplicateCount);
    assert.equal(
      next.with({ query: '' }).snapshot().items.find(item => item.book.id === 'a'),
      original.snapshot().items.find(item => item.book.id === 'a'),
      '仅改查询/筛选时应复用已规范化的投影项，避免千册书架重做全量索引',
    );
  });
});

describe('W88 Library · 1k+ fixed-grid virtualization', () => {
  test('万本书仅返回可见行+预读行，窗口、填充与总高度数学闭合', () => {
    const window = computeVirtualWindow({
      count: 10_000, columns: 5, itemHeight: 200, rowGap: 16,
      scrollTop: 2_160, viewportHeight: 432, overscanRows: 2,
    });
    assert.equal(window.rows, 2_000);
    assert.equal(window.visibleStartRow, 10);
    assert.equal(window.visibleEndRow, 12);
    assert.equal(window.startRow, 8);
    assert.equal(window.endRow, 14);
    assert.equal(window.startIndex, 40);
    assert.equal(window.endIndex, 70);
    assert.equal(window.endIndex - window.startIndex, 30, '不得随总书数增长 DOM 居民');
    assert.equal(window.totalHeight, 431_984);
    const renderedHeight = ((window.endRow - window.startRow) * 200) + ((window.endRow - window.startRow - 1) * 16);
    assert.equal(window.paddingTop + renderedHeight + window.paddingBottom, window.totalHeight);
  });

  test('超界滚动被夹紧，空集合/零视口有明确结果', () => {
    const end = computeVirtualWindow({ count: 11, columns: 3, itemHeight: 100, scrollTop: 99_999, viewportHeight: 100 });
    assert.equal(end.endIndex, 11);
    assert.ok(end.startIndex >= 0);
    assert.equal(computeVirtualWindow({ count: 0, itemHeight: 100, viewportHeight: 500 }).totalHeight, 0);
    const hidden = computeVirtualWindow({ count: 10, itemHeight: 100, viewportHeight: 0 });
    assert.equal(hidden.endIndex, 0);
    assert.equal(hidden.paddingBottom, 1000);
  });

  test('ShelfViewModel.virtualize() 切片与窗口索引严格对齐', () => {
    const records = Array.from({ length: 1_005 }, (_, index) => ({
      id: `book-${index}`, title: `Book ${index}`, path: `D:/Shelf/${index}.epub`, addedAt: index,
    }));
    const result = createShelfViewModel({ records, sort: 'imported' }).virtualize({
      columns: 5, itemHeight: 180, rowGap: 12, viewportHeight: 384, scrollTop: 3_840, overscanRows: 1,
    });
    assert.equal(result.items.length, result.endIndex - result.startIndex);
    assert.equal(result.items[0], result.snapshot.items[result.startIndex]);
    assert.equal(result.items.at(-1), result.snapshot.items[result.endIndex - 1]);
    assert.ok(result.items.length < 50);
  });
});
