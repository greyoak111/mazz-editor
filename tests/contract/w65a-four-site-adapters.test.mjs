import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import coreModule from '../../main/torrent-site-core.js';
import networkModule from '../../main/torrent-site-network.js';
import torrentSitesModule from '../../main/torrent-sites.js';

const {
  RESOURCE_ROW_FIELDS,
  normalizeInfoHash,
  isResourceRow,
  parseDmhyRows,
  parseMikanRows,
  parseUploadbtRows,
  aggregateResourceRows,
} = coreModule;
const { PoliteSiteTransport, isDeterministicVisitorGate, isTransientNetworkError } = networkModule;
const TorrentSites = torrentSitesModule;

const HASH_A = '5c2cf2a47fdc6c6389975d7ebdd5bd8ca0f436e2';
const HASH_B = 'bc80fd4cdfa72f3b5d664397dfa2195af3d3c6a4';
const VISITOR_GATE = `
  <form id="visitor-test-form" action="/addon.php?r=document/view&page=visitor-test">
    <input type="hidden" name="visitor_test" value="human">
  </form><script>window.captchaConfig = { success: true };</script>`;

const dmhyHtml = `<table><tbody><tr>
  <td>今天 20:03 <span style="display:none">2026/08/18 20:03</span></td>
  <td><a href="/topics/list?sort_id=2">动画</a></td>
  <td><a href="/topics/view/123456_example.html">[北宇治字幕组] 示例动画 1080p</a></td>
  <td><a href="magnet:?xt=urn:btih:${HASH_A}&amp;tr=udp%3A%2F%2Ftracker">磁力</a></td>
  <td>1.25 GB</td><td>12</td><td>3</td><td>44</td>
  <td><a href="/topics/list/user_id/7">北宇治字幕组</a></td>
</tr></tbody></table>`;

const mikanHtml = `<table><tr class="js-search-results-row">
  <td><input data-magnet="magnet:?xt=urn:btih:${HASH_A}&amp;tr=https%3A%2F%2Ftracker"></td>
  <td><a class="magnet-link-wrap" href="/Home/Episode/${HASH_A}">[北宇治字幕组] 示例动画 1080P</a></td>
  <td>1.25GB</td><td>2026/08/18 19:20</td>
  <td><a href="/Download/20260818/${HASH_A}.torrent">下载</a></td>
</tr></table>`;

function uploadbtHtml(hash = HASH_B) {
  return `<table><tr class="alt1">
    <td nowrap="nowrap">昨天 20:11</td><td><a href="sort-1-1.html">动画</a></td>
    <td><a href="show-${hash}.html" target="_blank">[ExileSub] 魔法少女奈叶 07 1080P</a></td>
    <td>812.1MB</td><td><a href="search.php?keyword=ExileSub">追放字幕组</a></td>
  </tr></table>`;
}

describe('W65a 四站严格离线适配器', () => {
  test('统一资源行固定为 13 字段，DMHY 当前表格可直接取得 magnet 与三项活跃度', () => {
    assert.equal(RESOURCE_ROW_FIELDS.length, 13);
    const rows = parseDmhyRows(dmhyHtml);
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]), RESOURCE_ROW_FIELDS);
    assert.equal(isResourceRow(rows[0]), true);
    assert.equal(rows[0].infoHash, HASH_A);
    assert.deepEqual([rows[0].seeders, rows[0].leechers, rows[0].completed], [12, 3, 44]);
    assert.equal(rows[0].resolution, '1080P');
    assert.equal(rows[0].subgroup, '北宇治字幕组');
  });

  test('Mikan 搜索行保留详情、torrent、magnet，并收敛到同一 infoHash', () => {
    const [row] = parseMikanRows(mikanHtml);
    assert.equal(isResourceRow(row), true);
    assert.equal(row.infoHash, HASH_A);
    assert.match(row.torrentUrl, new RegExp(`${HASH_A}\\.torrent$`));
    assert.match(row.sourceUrl, new RegExp(`/Home/Episode/${HASH_A}$`));
  });

  test('KissSub 与 ComiCat 从 show-<hash> 列表行取得 hash，不假造同名合并', () => {
    const kiss = parseUploadbtRows(uploadbtHtml(), { siteId: 'kisssub', baseUrl: 'https://kisssub.org/' });
    const comicat = parseUploadbtRows(uploadbtHtml(HASH_A), { siteId: 'comicat', baseUrl: 'https://comicat.org/' });
    assert.equal(kiss[0].infoHash, HASH_B);
    assert.equal(kiss[0].magnet, `magnet:?xt=urn:btih:${HASH_B}`);
    assert.equal(comicat[0].sourceSite, 'comicat');
    const groups = aggregateResourceRows([
      parseDmhyRows(dmhyHtml)[0], parseMikanRows(mikanHtml)[0], kiss[0], comicat[0],
    ]);
    assert.equal(groups.length, 2, '只按 infoHash 合并；标题相近不是合并依据');
    const shared = groups.find((group) => group.infoHash === HASH_A);
    assert.deepEqual(shared.sources.map((source) => source.sourceSite), ['comicat', 'dmhy', 'mikan']);
  });

  test('BTIH 的 32 位 base32 与 40 位 hex 均归一为 40 位小写 hex', () => {
    assert.equal(normalizeInfoHash(`magnet:?xt=urn:btih:${HASH_A.toUpperCase()}`), HASH_A);
    assert.equal(normalizeInfoHash('magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), '0000000000000000000000000000000000000000');
  });
});

describe('W65a 礼貌网络纪律', () => {
  test('单站请求串行、起点间隔不低于 2 秒，列表缓存命中不再访问', async () => {
    let clock = 10_000;
    const starts = [];
    const transport = new PoliteSiteTransport({
      now: () => clock,
      wait: async (ms) => { clock += ms; },
      request: async ({ url }) => { starts.push({ url, at: clock }); return { statusCode: 200, url, body: `<p>${url}</p>` }; },
    });
    const first = await transport.request('dmhy', { url: 'https://share.dmhy.org/a' });
    const cached = await transport.request('dmhy', { url: 'https://share.dmhy.org/a' });
    const second = await transport.request('dmhy', { url: 'https://share.dmhy.org/b' });
    assert.equal(first.cached, false);
    assert.equal(cached.cached, true);
    assert.equal(starts.length, 2);
    assert.ok(starts[1].at - starts[0].at >= 2_000);
    assert.equal(second.cached, false);
  });

  test('429/5xx 只按 2s→8s→20s 有界退避，成功后停止重试', async () => {
    let clock = 0;
    const waits = [];
    let calls = 0;
    const transport = new PoliteSiteTransport({
      now: () => clock,
      wait: async (ms) => { waits.push(ms); clock += ms; },
      request: async ({ url }) => ({ statusCode: ++calls < 3 ? 503 : 200, url, body: 'ok' }),
    });
    const response = await transport.request('mikan', { url: 'https://mikanime.tv/transient' });
    assert.equal(response.statusCode, 200);
    assert.equal(calls, 3);
    assert.ok(waits.includes(2_000) && waits.includes(8_000));
    assert.ok(!waits.includes(20_000), '第三次已成功，不应继续退避');
  });

  test('真实断连错误进入同一有限退避，结构错误不自动重试', async () => {
    assert.equal(isTransientNetworkError(Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })), true);
    let calls = 0;
    let clock = 0;
    const transport = new PoliteSiteTransport({
      minIntervalMs: 0, retryDelaysMs: [2, 8], now: () => clock,
      wait: async (ms) => { clock += ms; },
      request: async ({ url }) => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        return { statusCode: 200, url, body: 'ok' };
      },
    });
    assert.equal((await transport.request('dmhy', { url: 'https://share.dmhy.org/reset' })).statusCode, 200);
    assert.equal(calls, 2);

    const structural = new PoliteSiteTransport({
      minIntervalMs: 0, request: async () => { throw Object.assign(new Error('parser failed'), { code: 'W65_STRUCTURE_CHANGED' }); },
    });
    await assert.rejects(() => structural.request('mikan', { url: 'https://mikanime.tv/bad' }), /parser failed/);
  });

  test('交互验证码立即熔断且后续零请求；固定 visitor gate 不冒充验证码', async () => {
    let calls = 0;
    const transport = new PoliteSiteTransport({
      minIntervalMs: 0,
      request: async ({ url }) => { calls += 1; return { statusCode: 200, url, body: '<div class="g-recaptcha"></div>' }; },
    });
    await assert.rejects(() => transport.request('dmhy', { url: 'https://share.dmhy.org/' }), (error) => error.code === 'W65_CHALLENGE_REQUIRED');
    await assert.rejects(() => transport.request('dmhy', { url: 'https://share.dmhy.org/again' }), (error) => error.code === 'W65_CHALLENGE_REQUIRED');
    assert.equal(calls, 1);
    assert.equal(isDeterministicVisitorGate(VISITOR_GATE), true);
  });
});

describe('W65a 主进程四站注册与访客门接线', () => {
  test('只登记四个主站并保持 Preview；KissSub 固定门通过后回到原搜索 URL', async () => {
    const handlers = new Map();
    const bus = { handle: (channel, handler) => handlers.set(channel, handler) };
    let clock = 0;
    const requests = [];
    let searchVisits = 0;
    const transport = new PoliteSiteTransport({
      minIntervalMs: 0,
      now: () => clock,
      wait: async (ms) => { clock += ms; },
      request: async (spec) => {
        requests.push(spec);
        if (spec.method === 'POST') return { statusCode: 200, url: spec.url, body: '<html>gate accepted</html>' };
        if (spec.url.includes('search.php')) {
          searchVisits += 1;
          return { statusCode: 200, url: spec.url, body: searchVisits === 1 ? VISITOR_GATE : uploadbtHtml() };
        }
        return { statusCode: 200, url: spec.url, body: '' };
      },
    });
    new TorrentSites({ bus, transport });
    const sites = await handlers.get('sites:list')();
    assert.deepEqual(sites.map((site) => site.id), ['dmhy', 'mikan', 'kisssub', 'comicat']);
    assert.ok(sites.every((site) => site.name.includes('（预览）')));
    const result = await handlers.get('sites:search')({ site: 'kisssub', kw: '奈叶' });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].infoHash, HASH_B);
    assert.deepEqual(requests.map((request) => request.method), ['GET', 'POST', 'GET']);
    assert.equal(requests[1].body, 'visitor_test=human');
  });

  test('Electron transport 必须同时限制响应体与请求时长', () => {
    const source = fs.readFileSync(new URL('../../main/torrent-sites.js', import.meta.url), 'utf8');
    assert.match(source, /MAX_RESPONSE_BYTES\s*=\s*12\s*\*\s*1024\s*\*\s*1024/);
    assert.match(source, /REQUEST_TIMEOUT_MS\s*=\s*25_000/);
    assert.match(source, /code:\s*'ETIMEDOUT'/);
  });

  test('统一行已带 magnet/infoHash 时点播不再访问详情页', async () => {
    const handlers = new Map();
    const bus = { handle: (channel, handler) => handlers.set(channel, handler) };
    new TorrentSites({ bus, request: async () => { throw new Error('不应发起网络请求'); } });
    const result = await handlers.get('sites:magnet')({ site: 'comicat', infoHash: HASH_A });
    assert.equal(result.magnet, `magnet:?xt=urn:btih:${HASH_A}`);
  });

  test('播放器对站点标题做 HTML 转义且只消费统一字段', () => {
    const source = fs.readFileSync(new URL('../../renderer/modules/viewer/player.js', import.meta.url), 'utf8');
    assert.match(source, /escapeSiteText/);
    assert.doesNotMatch(source, /\$\{x\.(?:type|uploader)\s*\|\|/);
    assert.doesNotMatch(source, /href:\s*row\.href/);
  });
});
