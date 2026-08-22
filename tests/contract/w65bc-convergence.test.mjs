import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import coreModule from '../../main/torrent-site-core.js';
import networkModule from '../../main/torrent-site-network.js';
import TorrentSites from '../../main/torrent-sites.js';
import TorrentDaemon from '../../main/torrent-daemon.js';

const { parseUploadbtRss, parsePageInfo, parseMikanCatalog, isResourceRow } = coreModule;
const { PoliteSiteTransport } = networkModule;
const HASH_A = '5c2cf2a47fdc6c6389975d7ebdd5bd8ca0f436e2';
const HASH_B = 'bc80fd4cdfa72f3b5d664397dfa2195af3d3c6a4';

class FakeBus {
  constructor() { this.handlers = new Map(); }
  handle(name, fn) { this.handlers.set(name, fn); }
  invoke(name, payload = {}) { return this.handlers.get(name)(payload); }
}

const uploadRow = (hash, title = '示例动画 1080P', pages = '') => `<table><tr>
  <td>2026/08/18 20:11</td><td>动画</td><td><a href="show-${hash}.html">${title}</a></td><td>812MB</td><td><a>字幕组</a></td>
</tr></table>${pages}`;

describe('W65b 页面增量、RSS 与 Mikan 目录纯契约', () => {
  test('UploadBT RSS 仍收敛为严格 13 字段资源行', () => {
    const xml = `<rss><channel><item><title><![CDATA[[组] 番组 1080P]]></title>
      <link>https://kisssub.org/show-${HASH_A}.html</link><author><![CDATA[字幕组]]></author>
      <enclosure url="https://v2.uploadbt.com/?r=down&amp;hash=${HASH_A}" type="application/x-bittorrent" />
      <pubDate>Tue, 18 Aug 2026 20:25:10 +0800</pubDate></item></channel></rss>`;
    const [row] = parseUploadbtRss(xml, { siteId: 'kisssub', baseUrl: 'https://kisssub.org/' });
    assert.equal(isResourceRow(row), true);
    assert.equal(row.infoHash, HASH_A);
    assert.equal(row.subgroup, '字幕组');
    assert.match(row.torrentUrl, new RegExp(HASH_A));
  });

  test('分页只读取真实 page 证据，Mikan 目录保留周历与季度选择', () => {
    assert.deepEqual(parsePageInfo('<a href="?keyword=x&amp;page=2">2</a><a href="/page/14">14</a>', 1), {
      page: 1, totalPages: 14, hasMore: true, nextPage: 2,
    });
    const html = `<a onclick="UpdateBangumiCoverFlow(this, true)" data-year="2026" data-season="夏">夏季番组</a>
      <div class="sk-bangumi" data-dayofweek="2"><li><span data-src="/cover.webp"></span>
      <div class="date-text">2026/08/18 更新</div><a href="/Home/Bangumi/3979" title="番组">番组</a></li></div>`;
    const catalog = parseMikanCatalog(html);
    assert.equal(catalog.items.length, 1);
    assert.deepEqual(catalog.items[0], {
      bangumiId: '3979', title: '番组', url: 'https://mikanime.tv/Home/Bangumi/3979',
      imageUrl: 'https://mikanime.tv/cover.webp', updatedAt: '2026/08/18 更新', dayOfWeek: 2, dayLabel: '星期二',
    });
    assert.deepEqual(catalog.seasons[0], { year: '2026', season: '夏', label: '2026 · 夏季番组' });
  });
});

describe('W65b 礼貌并发、健康与陈旧缓存恢复', () => {
  test('四站并行时全局最多两个请求，单站健康可观测并可显式复位', async () => {
    let active = 0; let maximum = 0;
    const transport = new PoliteSiteTransport({
      minIntervalMs: 0, maxGlobalConcurrency: 2,
      request: async ({ url }) => {
        active += 1; maximum = Math.max(maximum, active);
        await new Promise(resolve => setImmediate(resolve));
        active -= 1;
        return { statusCode: 200, url, body: 'ok' };
      },
    });
    await Promise.all(['dmhy', 'mikan', 'kisssub', 'comicat'].map(site => transport.request(site, { url: `https://${site}.invalid/` })));
    assert.equal(maximum, 2);
    assert.ok(transport.snapshot().every(item => item.status === 'healthy'));
    transport.clearSite('dmhy');
    assert.equal(transport.snapshot('dmhy').status, 'unknown');
  });

  test('过期缓存只在瞬态失败时降级为 stale-cache，不把结构错误伪装成功', async () => {
    let clock = 1_000; let fail = false;
    const transport = new PoliteSiteTransport({
      now: () => clock, minIntervalMs: 0, listTtlMs: 10, retryDelaysMs: [],
      request: async ({ url }) => {
        if (fail) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        return { statusCode: 200, url, body: 'fresh' };
      },
    });
    await transport.request('dmhy', { url: 'https://share.dmhy.org/a' });
    clock += 20; fail = true;
    const stale = await transport.request('dmhy', { url: 'https://share.dmhy.org/a' });
    assert.equal(stale.stale, true);
    assert.equal(transport.snapshot('dmhy').sourceMode, 'stale-cache');
  });
});

describe('W65b 四站会话聚合与降级路线', () => {
  test('多站检索有界自动翻页，并严格按 infoHash 聚合来源', async () => {
    const bus = new FakeBus();
    const transport = new PoliteSiteTransport({
      minIntervalMs: 0,
      request: async ({ url }) => {
        if (url.includes('kisssub.org')) return { statusCode: 200, url, body: uploadRow(HASH_A, '共同资源', '<a href="?page=2">2</a>') };
        if (url.includes('comicat.org')) return { statusCode: 200, url, body: uploadRow(HASH_A, '共同资源') };
        return { statusCode: 200, url, body: '' };
      },
    });
    new TorrentSites({ bus, transport });
    const result = await bus.invoke('sites:searchMany', { sites: ['kisssub', 'comicat'], kw: '共同', maxPages: 2 });
    assert.equal(result.aggregates.length, 1);
    assert.deepEqual(result.aggregates[0].sources.map(item => item.sourceSite), ['comicat', 'kisssub']);
    assert.equal(result.perSite.kisssub.rows.length, 2, 'KissSub 应按真实 page=2 有界增量加载');
    assert.equal(result.perSite.comicat.rows.length, 1);
    const continued = await bus.invoke('sites:searchMany', { sites: ['kisssub', 'comicat'], kw: '共同', pageMap: { kisssub: 2 }, maxPages: 1 });
    assert.deepEqual(Object.keys(continued.perSite), ['kisssub'], '继续加载只请求仍有游标的站点，不得重抓已结束站点');
  });

  test('DMHY 搜索后端故障切同构镜像；UploadBT 首页空结构切 RSS', async () => {
    const bus = new FakeBus();
    const rss = `<rss><channel><item><title>RSS 资源</title><link>https://kisssub.org/show-${HASH_B}.html</link><author>组</author><pubDate>now</pubDate></item></channel></rss>`;
    const transport = new PoliteSiteTransport({
      minIntervalMs: 0,
      request: async ({ url }) => {
        if (url.startsWith('https://share.dmhy.org/topics')) return { statusCode: 200, url, body: 'SQLSTATE searchd Connection refused' };
        if (url.startsWith('https://dmhy.anoneko.com/topics')) {
          return { statusCode: 200, url, body: `<table><tr><td>2026/08/18</td><td>动画</td><td><a href="/topics/view/1.html">镜像资源 1080P</a></td><td><a href="magnet:?xt=urn:btih:${HASH_A}">磁力</a></td><td>1GB</td><td>1</td><td>2</td><td>3</td><td><a>组</a></td></tr></table>` };
        }
        if (url === 'https://kisssub.org/') return { statusCode: 200, url, body: '<html>empty</html>' };
        if (url.endsWith('/rss.xml')) return { statusCode: 200, url, body: rss };
        return { statusCode: 200, url, body: '' };
      },
    });
    new TorrentSites({ bus, transport });
    const dmhy = await bus.invoke('sites:searchPage', { site: 'dmhy', kw: '镜像', page: 1 });
    assert.equal(dmhy.sourceMode, 'mirror');
    assert.equal(dmhy.rows[0].infoHash, HASH_A);
    const home = await bus.invoke('sites:home', { site: 'kisssub' });
    assert.equal(home.sourceMode, 'rss');
    assert.equal(home.rows[0].infoHash, HASH_B);
  });
});

class FakeServer {
  listen(_port, _host, callback) { callback(); }
  address() { return { port: 45171 }; }
  close(callback) { callback?.(); }
}

class FakeTorrent extends EventEmitter {
  constructor(infoHash) {
    super(); this.infoHash = infoHash; this.name = '队列样本'; this.ready = true; this.info = true;
    this.progress = 0.25; this.downloaded = 25; this.length = 100; this.downloadSpeed = 2048; this.uploadSpeed = 0; this.numPeers = 2; this.done = false;
    this.files = [{ path: '队列样本/video.mp4', name: 'video.mp4', length: 100, streamURL: '/0/video.mp4' }];
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  destroy(_options, callback) { if (typeof _options === 'function') _options(); else callback?.(); }
}

class FakeWebTorrent {
  constructor() { this.server = new FakeServer(); this.last = null; }
  createServer() { return this.server; }
  add(magnet) { this.last = new FakeTorrent(coreModule.normalizeInfoHash(magnet)); return this.last; }
  destroy(callback) { callback?.(); }
}

describe('W65c 主进程五态下载队列', () => {
  test('排队→下载→暂停→继续→完成→移除闭环，状态不归 renderer 标签所有', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w65c-'));
    const bus = new FakeBus();
    const daemon = new TorrentDaemon({ bus, workspace: () => dir, session: null, loadWebTorrent: async () => ({ default: FakeWebTorrent }) });
    try {
      const magnet = `magnet:?xt=urn:btih:${HASH_A}`;
      const queued = await bus.invoke('tor:addBuffer', { magnet, name: '队列样本' });
      assert.equal(queued.state, 'queued');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal((await bus.invoke('tor:queue'))[0].state, 'downloading');
      assert.equal((await bus.invoke('tor:pause', { infoHash: HASH_A })).state, 'paused');
      assert.equal((await bus.invoke('tor:resume', { infoHash: HASH_A })).state, 'downloading');
      daemon.torrents.get(HASH_A).t.done = true;
      daemon.torrents.get(HASH_A).t.emit('done');
      assert.equal((await bus.invoke('tor:queue'))[0].state, 'completed');
      await bus.invoke('tor:remove', { infoHash: HASH_A, deleteFiles: false });
      assert.deepEqual(await bus.invoke('tor:queue'), []);
    } finally {
      await daemon.destroy('test');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('桥与播放器暴露多站、健康、季度目录和五态干预，不再用 renderer watching Map', () => {
    const bridge = fs.readFileSync(path.resolve('preload/bridge.js'), 'utf8');
    const player = fs.readFileSync(path.resolve('renderer/modules/viewer/player.js'), 'utf8');
    for (const channel of ['sites:searchMany', 'sites:catalog', 'sites:health', 'sites:check', 'sites:reset', 'tor:addBuffer', 'tor:queue', 'tor:pause', 'tor:resume', 'tor:retry']) {
      assert.ok(bridge.includes(`'${channel}'`), `preload 缺 ${channel}`);
      assert.ok((player + fs.readFileSync(path.resolve('main/torrent-daemon.js'), 'utf8') + fs.readFileSync(path.resolve('main/torrent-sites.js'), 'utf8')).includes(`'${channel}'`), `运行链缺 ${channel}`);
    }
    assert.ok(player.includes('data-src="downloads"'));
    assert.ok(player.includes('DOWNLOAD_STATE_LABELS'));
    assert.ok(player.includes('mz-web-sites'));
    assert.equal(player.includes('const watching = new Map()'), false);
  });
});
