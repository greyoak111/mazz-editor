// Factory 批量与持续投喂数量合同：合法数据不因本地固定计数被拒绝或裁剪。
import './_setup.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';
import { factoryBatchGate, parseCsvTasks } from '../../renderer/modules/factory/engine.js';

const require = createRequire(import.meta.url);
const { ContinuousFeedService, localItems, parseSyndication } = require('../../main/continuous-feed-service.js');
const { FEED_SCAN_REQUEST_SCHEMA, FEED_W65_REQUEST_SCHEMA, normalizeFeedScanRequest, normalizeW65FeedRequest } = require('../../main/feed-pipeline.js');
const TorrentSites = require('../../main/torrent-sites.js');

const read = relative => fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

function feedItem(sourceId, index) {
  return {
    itemId: `${sourceId}:${index}`,
    title: `条目 ${index}`,
    url: `https://example.test/${encodeURIComponent(sourceId)}/${index}`,
    publishedAt: '2026-08-23T00:00:00.000Z',
    summary: `材料 ${index}`,
    canonicalKey: `${sourceId}:${index}`,
  };
}

function feedRequest(sourceBatches) {
  return {
    schema: FEED_SCAN_REQUEST_SCHEMA,
    projectId: 'project:unbounded-feed-contract',
    projectPath: path.join(os.tmpdir(), 'mazz-unbounded-feed-contract'),
    query: '数量合同',
    dimension: '外部动态',
    mode: 'approval',
    windowHours: 24,
    observedAt: '2026-08-23T00:00:00.000Z',
    sourceBatches,
  };
}

class FakeBus {
  constructor() { this.handlers = new Map(); }
  handle(name, handler) { this.handlers.set(name, handler); }
  invoke(name, payload) { return this.handlers.get(name)(payload); }
}

function uploadRow(page, hasMore) {
  const hash = page.toString(16).padStart(40, '0');
  const pager = hasMore ? `<a href="?keyword=x&amp;page=${page + 1}">${page + 1}</a>` : '';
  return `<table><tr><td>2026/08/23</td><td>动画</td><td><a href="show-${hash}.html">第 ${page} 页资源</a></td><td>1GB</td><td><a>组</a></td></tr></table>${pager}`;
}

describe('Factory 批量名单与 CSV 无固定数量闸', () => {
  test('1000+ 条合法名单不警告、不确认、不拒绝', () => {
    const gate = factoryBatchGate(1001);
    assert.equal(gate.allowed, true);
    assert.equal(gate.warning, false);
    assert.equal(gate.message, '');
    const csv = ['书名', ...Array.from({ length: 1001 }, (_, index) => `作品${index + 1}`)].join('\n');
    assert.equal(parseCsvTasks(csv, { input_fields: [{ id: '书名', label: '书名' }] }).length, 1001);

    const factory = read('renderer/modules/factory/index.js');
    const panel = read('renderer/panels/factorycfg.html');
    assert(!factory.includes('confirmBatchImport') && !factory.includes('factoryBatchGate('), 'Factory 仍按批量数量弹确认或拒绝');
    assert(!/超过\s*100|31～100|30\s*条/.test(panel), '立项 UI 仍宣称固定批量门');
  });
});

describe('Continuous Feed 不裁 RSS、目录或搜索结果', () => {
  test('第 201 项之后仍完整保留', async () => {
    const count = 205;
    const xml = `<rss><channel>${Array.from({ length: count }, (_, index) => `<item><guid>g${index}</guid><title>订阅${index}</title></item>`).join('')}</channel></rss>`;
    assert.equal(parseSyndication(xml, 'https://example.test/feed.xml', '2026-08-23T00:00:00.000Z').length, count);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-feed-unbounded-'));
    const dir = path.join(root, 'items');
    fs.mkdirSync(dir);
    try {
      for (let index = 0; index < count; index += 1) fs.writeFileSync(path.join(dir, `item-${String(index).padStart(3, '0')}.txt`), '');
      assert.equal(localItems({ location: dir, projectPath: root }, '2026-08-23T00:00:00.000Z').length, count);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }

    const service = new ContinuousFeedService({
      feedPipeline: { scan: async () => ({ code: 'NO_CHANGES' }) },
      searxService: { search: async () => ({ ok: true, results: Array.from({ length: count }, (_, index) => ({ title: `搜索${index}`, url: `https://example.test/s/${index}`, content: `摘要${index}` })) }) },
    });
    const searchItems = await service._items({ kind: 'search', query: '主题' }, '2026-08-23T00:00:00.000Z');
    assert.equal(searchItems.length, count);
  });

  test('搜索短页继续翻页，仅空页或规范 URL 无新增时自然结束', async () => {
    const pages = [];
    const service = new ContinuousFeedService({
      feedPipeline: { scan: async () => ({ code: 'NO_CHANGES' }) },
      searxService: {
        search: async ({ pageno }) => {
          pages.push(pageno);
          if (pageno === 1) return { ok: true, results: [{ title: '甲', url: 'https://example.test/a?utm_source=feed', content: '' }] };
          if (pageno === 2) return { ok: true, results: [{ title: '乙', url: 'https://example.test/b', content: '' }] };
          if (pageno === 3) return { ok: true, results: [{ title: '乙重复', url: 'https://example.test/b?utm_campaign=repeat', content: '' }] };
          throw new Error('规范 URL 无新增后不应继续请求');
        },
      },
    });
    const items = await service._items({ kind: 'search', query: '主题' }, '2026-08-23T00:00:00.000Z');
    assert.deepEqual(pages, [1, 2, 3]);
    assert.deepEqual(items.map(item => item.url), ['https://example.test/a', 'https://example.test/b']);

    const emptyPages = [];
    const emptyEndService = new ContinuousFeedService({
      feedPipeline: { scan: async () => ({ code: 'NO_CHANGES' }) },
      searxService: {
        search: async ({ pageno }) => {
          emptyPages.push(pageno);
          return pageno === 1
            ? { ok: true, results: [{ title: '唯一结果', url: 'https://example.test/only', content: '' }] }
            : { ok: true, results: [] };
        },
      },
    });
    assert.equal((await emptyEndService._items({ kind: 'search', query: '主题' }, '2026-08-23T00:00:00.000Z')).length, 1);
    assert.deepEqual(emptyPages, [1, 2]);

    const noUrlPages = [];
    const noUrlService = new ContinuousFeedService({
      feedPipeline: { scan: async () => ({ code: 'NO_CHANGES' }) },
      searxService: {
        search: async ({ pageno }) => {
          noUrlPages.push(pageno);
          if (pageno === 1) return { ok: true, results: [{ title: '无链接甲', content: '材料甲' }] };
          if (pageno === 2) return { ok: true, results: [{ title: '无链接乙', content: '材料乙' }] };
          return { ok: true, results: [] };
        },
      },
    });
    const noUrlItems = await noUrlService._items({ kind: 'search', query: '主题' }, '2026-08-23T00:00:00.000Z');
    assert.deepEqual(noUrlPages, [1, 2, 3]);
    assert.deepEqual(noUrlItems.map(item => item.title), ['无链接甲', '无链接乙']);
  });

  test('搜索后续页网络失败仍向上抛出，不伪装为自然结束', async () => {
    const pages = [];
    const service = new ContinuousFeedService({
      feedPipeline: { scan: async () => ({ code: 'NO_CHANGES' }) },
      searxService: {
        search: async ({ pageno }) => {
          pages.push(pageno);
          if (pageno === 1) return { ok: true, results: [{ title: '第一页', url: 'https://example.test/first', content: '' }] };
          return { ok: false, error: 'endpoint unavailable', results: [] };
        },
      },
    });
    await assert.rejects(
      () => service._items({ kind: 'search', query: '主题' }, '2026-08-23T00:00:00.000Z'),
      /endpoint unavailable/,
    );
    assert.deepEqual(pages, [1, 2]);
  });
});

describe('Feed pipeline 与 W65 翻页无固定数量上限', () => {
  test('17 个来源与单来源 201 项均可归一', () => {
    const manySources = Array.from({ length: 17 }, (_, index) => ({
      sourceId: `source:${index}`, sourceType: 'search', items: [feedItem(`source:${index}`, 0)],
    }));
    assert.equal(normalizeFeedScanRequest(feedRequest(manySources)).sourceBatches.length, 17);
    const manyItems = Array.from({ length: 201 }, (_, index) => feedItem('source:many', index));
    assert.equal(normalizeFeedScanRequest(feedRequest([{ sourceId: 'source:many', sourceType: 'search', items: manyItems }])).sourceBatches[0].items.length, 201);
  });

  test('maxPages 缺省为自然结束，显式正整数不钳到 3', async () => {
    const base = {
      schema: FEED_W65_REQUEST_SCHEMA,
      projectId: 'project:w65-unbounded',
      projectPath: path.join(os.tmpdir(), 'mazz-w65-unbounded'),
      query: '主题', dimension: '动态', observedAt: '2026-08-23T00:00:00.000Z', sites: ['kisssub'],
    };
    assert.equal(normalizeW65FeedRequest(base).maxPages, null);
    assert.equal(normalizeW65FeedRequest({ ...base, maxPages: 8 }).maxPages, 8);

    const bus = new FakeBus();
    const pages = [];
    const transport = {
      request: async (_siteId, { url }) => {
        const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] || 1);
        pages.push(page);
        return { statusCode: 200, url, body: uploadRow(page, page < 5) };
      },
    };
    new TorrentSites({ bus, transport });
    const result = await bus.invoke('sites:searchMany', { sites: ['kisssub'], kw: '主题' });
    assert.deepEqual(pages, [1, 2, 3, 4, 5]);
    assert.equal(result.perSite.kisssub.rows.length, 5);

    const factory = read('renderer/modules/factory/index.js');
    const pipeline = read('main/feed-pipeline.js');
    const torrentSites = read('main/torrent-sites.js');
    assert(!/maxPages\s*:\s*1/.test(factory), 'Factory W65 仍固定只取一页');
    assert(!/clusters\.slice\(0,\s*6\)/.test(factory), 'Feed→Factory 仍只传前六个簇');
    assert(!/sites\.length\s*>\s*4/.test(pipeline), 'W65 请求仍限制最多四个站点');
    assert(!/selected[\s\S]{0,200}\.slice\(0,\s*4\)/.test(torrentSites), '站点搜索仍静默裁到前四个');
  });
});
