// W90 —— Player source ownership and Mikan catalog presentation behavior.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import coreModule from '../../main/torrent-site-core.js';
import imagePolicy from '../../main/catalog-image-policy.js';
import TorrentSites from '../../main/torrent-sites.js';
import networkModule from '../../main/torrent-site-network.js';

const { PoliteSiteTransport } = networkModule;

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const readSrc = file => fs.readFileSync(path.resolve(file), 'utf8');

function installMediaStubs() {
  const mediaProto = window.HTMLMediaElement.prototype;
  const canvasProto = window.HTMLCanvasElement.prototype;
  const originals = {
    play: mediaProto.play,
    pause: mediaProto.pause,
    load: mediaProto.load,
    requestPictureInPicture: mediaProto.requestPictureInPicture,
    getContext: canvasProto.getContext,
    pipDescriptor: Object.getOwnPropertyDescriptor(document, 'pictureInPictureElement'),
    exitPictureInPicture: document.exitPictureInPicture,
  };
  let pipElement = null;
  mediaProto.play = () => Promise.resolve();
  mediaProto.pause = () => {};
  mediaProto.load = () => {};
  mediaProto.requestPictureInPicture = async function () { pipElement = this; return { width: 320, height: 180 }; };
  canvasProto.getContext = () => null;
  Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => pipElement });
  document.exitPictureInPicture = async () => { pipElement = null; };
  return {
    restore() {
      mediaProto.play = originals.play;
      mediaProto.pause = originals.pause;
      mediaProto.load = originals.load;
      if (originals.requestPictureInPicture === undefined) delete mediaProto.requestPictureInPicture;
      else mediaProto.requestPictureInPicture = originals.requestPictureInPicture;
      canvasProto.getContext = originals.getContext;
      if (originals.pipDescriptor) Object.defineProperty(document, 'pictureInPictureElement', originals.pipDescriptor);
      else delete document.pictureInPictureElement;
      if (originals.exitPictureInPicture === undefined) delete document.exitPictureInPicture;
      else document.exitPictureInPicture = originals.exitPictureInPicture;
    },
  };
}

function installBridge(catalog = null) {
  window.mazz = {
    isElectron: true,
    on: () => () => {},
    invoke(channel) {
      if (channel === 'settings:get') return Promise.resolve(null);
      if (channel === 'fs:listDir') return Promise.resolve([]);
      if (channel === 'sites:list') return Promise.resolve([{ id: 'mikan', name: '蜜柑计划 Mikan' }]);
      if (channel === 'sites:health') return Promise.resolve([]);
      if (channel === 'sites:catalog') return Promise.resolve(catalog || { seasons: [], items: [] });
      return Promise.resolve(true);
    },
  };
}

class HealthBus {
  constructor() { this.handlers = new Map(); }
  handle(channel, handler) { this.handlers.set(channel, handler); }
  invoke(channel, payload = {}) { return this.handlers.get(channel)(payload); }
}

describe('W90 Player source owners', () => {
  test('setSource retires the old seek preview owner and the next hover binds curUrl', async () => {
    const mediaHarness = installMediaStubs();
    installBridge();
    const originalCreateElement = document.createElement.bind(document);
    const previewVideos = [];
    document.createElement = function (tagName, options) {
      const element = originalCreateElement(tagName, options);
      if (String(tagName).toLowerCase() === 'video') previewVideos.push(element);
      return element;
    };
    const root = originalCreateElement('div');
    document.body.appendChild(root);
    const oldUrl = 'mazz-res://media/C%3A%2Fold.mp4';
    const newUrl = 'mazz-res://media/C%3A%2Fnext.mp4';
    let player;
    try {
      const { createPlayer } = await import('../../renderer/modules/viewer/player.js');
      player = createPlayer(root, { url: oldUrl, name: 'old.mp4', ext: 'mp4', path: 'C:/old.mp4', kind: 'video' });
      const media = root.querySelector('.mz-media');
      const track = root.querySelector('.mz-seek-track');
      const thumbCanvas = root.querySelector('.mz-thumb canvas');
      let staleDraws = 0;
      thumbCanvas.getContext = () => ({ drawImage: () => { staleDraws += 1; } });
      Object.defineProperty(media, 'duration', { configurable: true, value: 120 });
      Object.defineProperty(media, 'currentSrc', { configurable: true, get: () => media.getAttribute('src') || '' });
      track.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 8, width: 100, height: 8, x: 0, y: 0 });

      track.parentElement.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 50 }));
      await tick(135);
      assert.equal(previewVideos.length, 1);
      assert.equal(previewVideos[0]._src, oldUrl, 'first preview must own the initial source');

      root.querySelector('[data-a=pip]').click();
      await tick();
      assert.equal(document.pictureInPictureElement, media, 'precondition: system PiP is active on the media element');

      player.setSource(newUrl, 'next.mp4', 'C:/next.mp4', 200);
      assert.equal(media.currentSrc, newUrl, 'setSource must synchronously replace currentSrc');
      assert.equal(document.pictureInPictureElement, media, 'native PiP keeps the same media element during an ordinary source swap');
      assert.equal(previewVideos[0].hasAttribute('src'), false, 'old preview decoder must be retired immediately');
      previewVideos[0].dispatchEvent(new window.Event('seeked'));
      assert.equal(staleDraws, 0, 'a queued seeked event from the retired owner must not repaint the old frame');

      track.parentElement.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 25 }));
      await tick(135);
      assert.equal(previewVideos.length, 2);
      assert.equal(previewVideos[1]._src, newUrl, 'next hover preview must be decoded from curUrl, never the constructor URL');
    } finally {
      player?.destroy();
      root.remove();
      document.createElement = originalCreateElement;
      mediaHarness.restore();
      await tick();
    }
  });
});

describe('W90 station health ownership', () => {
  test('main checks four stations with fresh-result and in-flight coalescing, while unified reset clears all', async () => {
    const bus = new HealthBus();
    let clock = 1_800_000_000_000;
    const requests = [];
    const transport = new PoliteSiteTransport({
      minIntervalMs: 0,
      retryDelaysMs: [],
      now: () => clock,
      request: async ({ siteId, url }) => {
        requests.push({ siteId, url });
        await tick();
        return { statusCode: 200, url, body: '<html>available</html>' };
      },
    });
    new TorrentSites({ bus, transport });

    const initial = await bus.invoke('sites:check', { maxAgeMs: 3_600_000 });
    assert.equal(initial.length, 4);
    assert.equal(initial.every(row => row.status === 'healthy'), true);
    assert.equal(requests.length, 4, 'automatic check must observe each station once');
    await bus.invoke('sites:check', { maxAgeMs: 3_600_000 });
    assert.equal(requests.length, 4, 'another Player inside the freshness window must reuse the snapshots');

    clock += 3_600_001;
    const first = bus.invoke('sites:check', { site: 'mikan', force: true });
    const joined = bus.invoke('sites:check', { site: 'mikan', force: true });
    assert.deepEqual(await first, await joined);
    assert.equal(requests.filter(row => row.siteId === 'mikan').length, 2, 'concurrent manual checks must join one station owner');
    assert.equal(requests.filter(row => row.siteId !== 'mikan').length, 3, 'manual check must not touch other stations');

    const reset = await bus.invoke('sites:reset', {});
    assert.equal(reset.length, 4);
    assert.equal(reset.every(row => row.status === 'unknown' && row.sourceMode === 'none'), true);
  });

  test('a fresh-looking intermediate snapshot joins the live probe instead of settling as untested', async () => {
    const bus = new HealthBus();
    let releaseRequest;
    let startedResolve;
    const started = new Promise(resolve => { startedResolve = resolve; });
    const transport = new PoliteSiteTransport({
      minIntervalMs: 0,
      retryDelaysMs: [],
      request: ({ url }) => new Promise(resolve => {
        releaseRequest = () => resolve({ statusCode: 200, url, body: '<html>available</html>' });
        startedResolve();
      }),
    });
    new TorrentSites({ bus, transport });

    const first = bus.invoke('sites:check', { site: 'mikan', maxAgeMs: 3_600_000 });
    await started;
    let secondSettled = false;
    const second = bus.invoke('sites:check', { site: 'mikan', maxAgeMs: 3_600_000 }).then(value => {
      secondSettled = true;
      return value;
    });
    await tick();
    assert.equal(secondSettled, false, 'lastAttemptAt is not a terminal result while its probe owner is live');
    releaseRequest();
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.status, 'healthy');
    assert.equal(right.status, 'healthy');
  });

  test('reset generations prevent ordinary catalog/home traffic from resurrecting health or cache', async () => {
    const bus = new HealthBus();
    let releaseRequest;
    let startedResolve;
    const started = new Promise(resolve => { startedResolve = resolve; });
    const transport = new PoliteSiteTransport({
      minIntervalMs: 0,
      retryDelaysMs: [],
      request: ({ url }) => new Promise(resolve => {
        releaseRequest = () => resolve({ statusCode: 200, url, body: '<html>late old response</html>' });
        startedResolve();
      }),
    });
    new TorrentSites({ bus, transport });

    const home = bus.invoke('sites:home', { site: 'dmhy' });
    await started;
    const politenessClock = transport.lastStartedAt.get('dmhy');
    const reset = await bus.invoke('sites:reset', { site: 'dmhy' });
    assert.equal(reset.status, 'unknown');
    assert.equal(transport.lastStartedAt.get('dmhy'), politenessClock, 'reset must not bypass the per-site request interval');
    releaseRequest();
    await assert.rejects(home, error => error?.code === 'W65_RESET_STALE');
    assert.equal(transport.snapshot('dmhy').status, 'unknown', 'a pre-reset request cannot revive health');
    assert.equal([...transport.cache.keys()].some(key => key.startsWith('dmhy\0')), false, 'a pre-reset request cannot refill cache');
  });

  test('reset invalidates the whole visitor-gate operation before it can continue through gate or RSS fallbacks', async () => {
    const bus = new HealthBus();
    const requests = [];
    let releaseRequest;
    let startedResolve;
    const started = new Promise(resolve => { startedResolve = resolve; });
    const visitorGate = `<form id="visitor-test-form"><input name="visitor_test" value="human"></form><script>window.captchaConfig={success:true}</script>`;
    const transport = new PoliteSiteTransport({
      minIntervalMs: 0,
      retryDelaysMs: [],
      request: spec => {
        requests.push(spec);
        if (requests.length === 1) {
          startedResolve();
          return new Promise(resolve => {
            releaseRequest = () => resolve({ statusCode: 200, url: spec.url, body: visitorGate });
          });
        }
        return Promise.resolve({ statusCode: 200, url: spec.url, body: '<rss></rss>' });
      },
    });
    const service = new TorrentSites({ bus, transport });

    const home = bus.invoke('sites:home', { site: 'kisssub' });
    await started;
    await bus.invoke('sites:reset', { site: 'kisssub' });
    releaseRequest();
    await assert.rejects(home, error => error?.code === 'W65_RESET_STALE');
    assert.equal(requests.length, 1, 'a reset-stale home operation must not start its visitor POST or RSS fallback');
    assert.equal(service.visitorCookies.has('kisssub'), false, 'the stale visitor operation cannot recreate its cookie');
    assert.equal(transport.snapshot('kisssub').status, 'unknown');
    assert.equal([...transport.cache.keys()].some(key => key.startsWith('kisssub\0')), false);
  });

  test('Player checks on open, polls hourly, gives each station a manual check, and owns one reset button', async () => {
    const mediaHarness = installMediaStubs();
    const calls = [];
    const health = new Map();
    let manualCheckGate = null;
    let healthReadGate = null;
    const sites = [
      { id: 'dmhy', name: '动漫花园 DMHY' },
      { id: 'mikan', name: '蜜柑计划 Mikan' },
    ];
    window.mazz = {
      isElectron: true,
      on: () => () => {},
      async invoke(channel, payload = {}) {
        calls.push({ channel, payload });
        if (channel === 'settings:get') return null;
        if (channel === 'fs:listDir') return [];
        if (channel === 'sites:list') return sites;
        if (channel === 'sites:catalog') return { seasons: [], items: [] };
        if (channel === 'sites:health') {
          if (healthReadGate) await healthReadGate;
          return [...health.values()];
        }
        if (channel === 'sites:check') {
          if (payload.site && manualCheckGate) await manualCheckGate;
          const targets = payload.site ? sites.filter(row => row.id === payload.site) : sites;
          for (const target of targets) health.set(target.id, {
            siteId: target.id, status: 'healthy', sourceMode: 'network',
            lastAttemptAt: '2026-08-22T00:00:00.000Z', lastError: '',
          });
          return payload.site ? health.get(payload.site) : [...health.values()];
        }
        if (channel === 'sites:reset') {
          for (const target of sites) health.set(target.id, { siteId: target.id, status: 'unknown', sourceMode: 'none' });
          return [...health.values()];
        }
        return true;
      },
    };
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervals = [];
    globalThis.setInterval = (fn, ms) => {
      const owner = { fn, ms, cleared: false };
      intervals.push(owner);
      return owner;
    };
    globalThis.clearInterval = (owner) => { if (owner) owner.cleared = true; };
    const root = document.createElement('div');
    document.body.appendChild(root);
    let player;
    try {
      const { createPlayer, SITE_HEALTH_POLL_MS } = await import('../../renderer/modules/viewer/player.js');
      player = createPlayer(root, { url: null, name: 'health', ext: '', path: null, kind: 'video' });
      for (let i = 0; i < 12 && !calls.some(row => row.channel === 'sites:check'); i += 1) await tick();
      const checks = () => calls.filter(row => row.channel === 'sites:check');
      assert.equal(checks().length, 1, 'opening Player itself must start one automatic station check');
      assert.equal(Object.hasOwn(checks()[0].payload, 'site'), false);
      const hourly = intervals.find(owner => owner.ms === SITE_HEALTH_POLL_MS);
      assert.ok(hourly, 'Player must own an exact one-hour station timer');

      root.querySelector('[data-src=web]').click();
      for (let i = 0; i < 20 && root.querySelectorAll('.mz-site-check').length !== 2; i += 1) await tick();
      assert.equal(root.querySelectorAll('.mz-site-check').length, 2);
      assert.equal(root.querySelectorAll('.mz-site-health-reset').length, 1, 'there must be one unified reset action');
      assert.equal([...root.querySelectorAll('.mz-site-check small')].every(node => node.textContent === '正常'), true);

      let releaseManualCheck;
      let releaseHealthRead;
      manualCheckGate = new Promise(resolve => { releaseManualCheck = resolve; });
      healthReadGate = new Promise(resolve => { releaseHealthRead = resolve; });
      const liveOwner = root.querySelector('.mz-site-health-live');
      const mikanCheck = root.querySelector('.mz-site-check[data-site=mikan]');
      mikanCheck.focus();
      mikanCheck.click();
      for (let i = 0; i < 12 && checks().length < 2; i += 1) await tick();
      assert.deepEqual(checks()[1].payload, { site: 'mikan', force: true });
      assert.equal(calls.some(row => row.channel === 'sites:reset'), false, 'manual station check must never reset its session');
      for (let i = 0; i < 12 && root.querySelector('.mz-site-check[data-site=mikan]')?.getAttribute('aria-busy') !== 'true'; i += 1) await tick();
      assert.equal(document.activeElement?.dataset?.site, 'mikan', 'the checking state must preserve keyboard focus');
      assert.equal(root.querySelector('.mz-site-health-live'), liveOwner, 'the aria-live owner must remain stable across status updates');
      root.querySelector('.mz-site-check[data-site=dmhy]').focus();
      releaseHealthRead();
      healthReadGate = null;
      for (let i = 0; i < 12 && document.activeElement?.dataset?.site !== 'dmhy'; i += 1) await tick();
      assert.equal(document.activeElement?.dataset?.site, 'dmhy', 'an async refresh must follow a newer keyboard focus instead of stealing it back');
      assert.match(liveOwner.textContent, /蜜柑计划 Mikan/);
      releaseManualCheck();
      manualCheckGate = null;
      for (let i = 0; i < 12 && root.querySelector('.mz-site-check[data-site=mikan]')?.getAttribute('aria-busy') !== 'false'; i += 1) await tick();
      assert.equal(document.activeElement?.dataset?.site, 'dmhy', 'the terminal state must preserve the user’s latest station focus');
      assert.equal(root.querySelector('.mz-site-health-live'), liveOwner, 'terminal announcements update the existing live node');

      for (let i = 0; i < 12 && root.querySelector('.mz-site-health-reset')?.getAttribute('aria-disabled') === 'true'; i += 1) await tick();
      root.querySelector('.mz-site-health-reset').click();
      for (let i = 0; i < 12 && !calls.some(row => row.channel === 'sites:reset'); i += 1) await tick();
      const resets = calls.filter(row => row.channel === 'sites:reset');
      assert.equal(resets.length, 1);
      assert.deepEqual(resets[0].payload, {}, 'one reset action clears all stations in one IPC transaction');
      for (let i = 0; i < 12 && ![...root.querySelectorAll('.mz-site-check small')].every(node => node.textContent === '未检测'); i += 1) await tick();
      assert.equal([...root.querySelectorAll('.mz-site-check small')].every(node => node.textContent === '未检测'), true, 'reset returns every station to an explicit untested state');

      await hourly.fn();
      assert.equal(checks().length, 3, 'the one-hour owner must repeat the automatic all-station check once');
      player.destroy();
      player = null;
      assert.equal(hourly.cleared, true, 'destroy must retire the one-hour network owner');
      await hourly.fn();
      assert.equal(checks().length, 3, 'a retired timer callback cannot resurrect station traffic');
    } finally {
      player?.destroy();
      root.remove();
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
      mediaHarness.restore();
      await tick();
    }
  });
});

describe('W90 Mikan catalog identity and covers', () => {
  test('season labels are year-qualified and unique even when source labels repeat', () => {
    const html = `<a onclick="UpdateBangumiCoverFlow(this, true)" data-year="2026" data-season="夏">夏季番组</a>
      <a onclick="UpdateBangumiCoverFlow(this, true)" data-year="2025" data-season="夏">2025 夏季番组</a>`;
    const catalog = coreModule.parseMikanCatalog(html);
    assert.deepEqual(catalog.seasons.map(item => item.label), ['2026 · 夏季番组', '2025 · 夏季番组']);
    assert.equal(new Set(catalog.seasons.map(item => item.label)).size, catalog.seasons.length);
  });

  test('live Mikan card shape keeps its cover and repairs the legacy-host casing redirect', () => {
    const html = `<div class="sk-bangumi" data-dayofweek="6"><div class="an-box"><ul><li>
      <span data-src="/images/Bangumi/202604/edeef072.jpg?width=400&amp;height=400&amp;format=webp" class="b-lazy"></span>
      <div class="date-text">2026/08/20 更新</div>
      <a href="/Home/Bangumi/3920" class="an-text" title="摩绪">摩绪</a>
    </li></ul></div></div>`;
    const catalog = coreModule.parseMikanCatalog(html, { baseUrl: 'https://mikanime.tv/' });
    assert.equal(catalog.items.length, 1);
    assert.equal(catalog.items[0].imageUrl, 'https://mikanime.tv/images/Bangumi/202604/edeef072.jpg?width=400&height=400&format=webp');
    assert.equal(
      imagePolicy.canonicalCatalogImageUrl(catalog.items[0].imageUrl)?.href,
      'https://mikanani.me/images/Bangumi/202604/edeef072.jpg?width=400&height=400&format=webp',
      'legacy Mikan cover hosts must be canonicalized before Electron net.fetch sees the broken redirect',
    );

    const repaired = imagePolicy.resolvedCatalogImageRedirect(
      catalog.items[0].imageUrl,
      'https://mikanani.me/images/bangumi/202604/edeef072.jpg?width=400&height=400&format=webp',
    );
    assert.equal(repaired?.href, 'https://mikanani.me/images/Bangumi/202604/edeef072.jpg?width=400&height=400&format=webp');
    assert.equal(imagePolicy.resolvedCatalogImageRedirect(catalog.items[0].imageUrl, 'https://evil.invalid/cover.webp'), null);
  });

  test('catalog uses portrait lazy thumbnails, sanitizes URLs, and exposes a stable failure fallback', async () => {
    const catalog = {
      seasons: [
        { year: '2026', season: '夏', label: '2026 · 夏季番组' },
        { year: '2025', season: '夏', label: '2025 · 夏季番组' },
      ],
      items: [
        // Official Mikan fixture verified as a 1200×1697 portrait source; the
        // UI intentionally downsamples it into a compact 34×46 owner box.
        { title: '允许封面', imageUrl: 'https://mikanani.me/images/Bangumi/202604/25dac229.jpg', dayLabel: '星期一', updatedAt: '2026/08/22 更新' },
        { title: '零尺寸封面', imageUrl: 'https://mikanani.me/images/Bangumi/202604/edeef072.jpg', dayLabel: '星期一', updatedAt: '2026/08/22 更新' },
        { title: '拒绝封面', imageUrl: 'https://evil.invalid/track.png', dayLabel: '星期二', updatedAt: '2026/08/21 更新' },
      ],
    };
    const mediaHarness = installMediaStubs();
    installBridge(catalog);
    const root = document.createElement('div');
    document.body.appendChild(root);
    let player;
    try {
      const { createPlayer } = await import('../../renderer/modules/viewer/player.js');
      player = createPlayer(root, { url: null, name: 'catalog', ext: '', path: null, kind: 'video' });
      root.querySelector('[data-src=web]').click();
      for (let i = 0; i < 12 && !root.querySelector('.mz-catalog-item'); i += 1) await tick();

      const labels = [...root.querySelectorAll('.mz-mikan-season option')].map(option => option.textContent);
      assert.deepEqual(labels, ['2026 · 夏季番组', '2025 · 夏季番组']);
      const items = root.querySelectorAll('.mz-catalog-item');
      assert.equal(items.length, 3);
      const images = root.querySelectorAll('.mz-catalog-cover img');
      assert.equal(images.length, 2, 'non-official hosts must remain on the local fallback and never create a request owner');
      const image = images[0];
      assert.match(image.getAttribute('src'), /^mazz-res:\/\/catalog\/https%3A%2F%2Fmikanani\.me%2F/i);
      assert.equal(image.getAttribute('loading'), 'lazy');
      assert.equal(image.getAttribute('decoding'), 'async');
      assert.equal(image.getAttribute('width'), '34');
      assert.equal(image.getAttribute('height'), '46');
      assert.ok(+image.getAttribute('height') > +image.getAttribute('width'), 'cover box must preserve the portrait poster treatment');
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1200 });
      Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1697 });
      image.dispatchEvent(new window.Event('load'));
      assert.equal(items[0].querySelector('.mz-catalog-cover').classList.contains('has-image'), true, 'fallback hides only after decoded pixels have a real natural size');
      image.dispatchEvent(new window.Event('error'));
      assert.equal(image.hasAttribute('src'), false, 'failed image owner must be released rather than retried forever');
      assert.equal(items[0].querySelector('.mz-catalog-fallback').textContent, '允');
      assert.equal(items[0].querySelector('.mz-catalog-cover').classList.contains('has-image'), false);
      images[1].dispatchEvent(new window.Event('load'));
      assert.equal(items[1].querySelector('.mz-catalog-cover').classList.contains('has-image'), false, 'a synthetic load without decoded pixels must not create a false success state');
      assert.equal(images[1].hasAttribute('src'), false, 'zero-sized load owners are retired like ordinary image failures');
    } finally {
      player?.destroy();
      root.remove();
      mediaHarness.restore();
      await tick();
    }
  });

  test('catalog proxy allow-list rejects schemes, credentials, and unrelated hosts', () => {
    assert.equal(imagePolicy.allowedCatalogImageUrl('http://mikanani.me/a.jpg'), null);
    assert.equal(imagePolicy.allowedCatalogImageUrl('https://evil.invalid/a.jpg'), null);
    assert.equal(imagePolicy.allowedCatalogImageUrl('javascript:alert(1)'), null);
    assert.equal(imagePolicy.allowedCatalogImageUrl('https://mikanani.me.evil.invalid/a.jpg'), null);
    assert.equal(imagePolicy.allowedCatalogImageUrl('https://user:secret@mikanani.me/a.jpg'), null);
    assert.equal(imagePolicy.allowedCatalogImageUrl('https://mikanani.me:444/a.jpg'), null);
    assert.equal(imagePolicy.allowedCatalogImageUrl('https://mikanani.me/a.webp').hostname, 'mikanani.me');
    const main = readSrc('main/main.js');
    const css = readSrc('renderer/styles/base.css');
    assert.match(main, /signal:\s*req\.signal/, 'native image owner cancellation must propagate to net.fetch');
    assert.match(main, /CATALOG_IMAGE_MAX_BYTES/, 'cover proxy must enforce a hard byte bound');
    assert.match(css, /\.mz-catalog-item\s*\{[^}]*min-height:\s*52px/s, 'poster rows stay in the compact 52px tier');
    assert.match(css, /\.mz-catalog-cover\s*\{[^}]*width:\s*34px;\s*height:\s*46px/s, 'Mikan covers keep a portrait box rather than regressing to square glyphs');
    assert.match(css, /\.mz-catalog-cover img\s*\{[^}]*object-fit:\s*contain/s, 'source poster proportions must not be stretched');
  });
});
