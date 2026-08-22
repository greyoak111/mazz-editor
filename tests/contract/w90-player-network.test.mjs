// W90 —— Player source ownership and Mikan catalog presentation behavior.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import coreModule from '../../main/torrent-site-core.js';
import imagePolicy from '../../main/catalog-image-policy.js';

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
