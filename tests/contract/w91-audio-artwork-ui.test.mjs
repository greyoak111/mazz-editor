// W91 — renderer-owned square audio artwork: safe local URL policy, decoded
// image gate, stale-owner retirement and motion contract.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { audioArtworkUrl, mountAudioArtwork } from '../../renderer/modules/viewer/audio-artwork.js';

const readSrc = file => fs.readFileSync(path.resolve(file), 'utf8');

function decoded(image, width = 640, height = 640) {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height });
  image.dispatchEvent(new window.Event('load'));
}

describe('W91 square audio artwork', () => {
  test('only local absolute and UNC paths enter the custom protocol', () => {
    assert.equal(audioArtworkUrl('C:\\Music\\cover song.mp3'), 'mazz-res://audio-artwork/C%3A%2FMusic%2Fcover%20song.mp3');
    assert.equal(audioArtworkUrl('\\\\server\\share\\song.flac'), 'mazz-res://audio-artwork/%2F%2Fserver%2Fshare%2Fsong.flac');
    assert.equal(audioArtworkUrl('/home/me/song.ogg'), 'mazz-res://audio-artwork/%2Fhome%2Fme%2Fsong.ogg');
    for (const value of ['track.mp3', 'http://host/track.mp3', 'https://host/track.mp3', 'blob:https://host/id', 'mazz-res://media/x', 'data:audio/mp3;base64,AA==']) {
      assert.equal(audioArtworkUrl(value), null, `${value} must stay on the fallback card`);
    }
  });

  test('a cover is revealed only after load and positive decoded dimensions', () => {
    const host = document.createElement('div');
    const artwork = mountAudioArtwork(host, { path: 'C:/Music/first.mp3', name: 'first.mp3' });
    try {
      const image = host.querySelector('img');
      assert.ok(image, 'a local source creates one image owner');
      assert.equal(host.classList.contains('has-artwork'), false);
      image.dispatchEvent(new window.Event('load'));
      assert.equal(host.querySelector('img'), null, 'a zero-size load retires the invalid image');
      assert.equal(host.classList.contains('has-artwork'), false);

      artwork.setSource('C:/Music/valid.mp3', 'valid.mp3');
      const valid = host.querySelector('img');
      decoded(valid);
      assert.equal(host.classList.contains('has-artwork'), true);
      assert.equal(host.getAttribute('aria-busy'), 'false');
    } finally {
      artwork.destroy();
      host.remove();
    }
  });

  test('source changes install a fresh owner and stale events cannot restore old art', () => {
    const host = document.createElement('div');
    const artwork = mountAudioArtwork(host, { path: 'C:/Music/old.mp3', name: 'old.mp3' });
    const oldImage = host.querySelector('img');
    decoded(oldImage);
    assert.equal(host.classList.contains('has-artwork'), true);

    artwork.setSource('C:/Music/new.mp3', 'new.mp3');
    const newImage = host.querySelector('img');
    assert.notEqual(newImage, oldImage, 'each source must own a new image element');
    assert.equal(oldImage.isConnected, false, 'old owner must leave the DOM synchronously');
    assert.equal(oldImage.hasAttribute('src'), false, 'old request must be actively retired');
    assert.equal(host.classList.contains('has-artwork'), false, 'fallback remains until the new image is decoded');

    decoded(oldImage, 900, 900);
    assert.equal(host.classList.contains('has-artwork'), false, 'late old load cannot mark the new source ready');
    decoded(newImage, 720, 720);
    assert.equal(host.classList.contains('has-artwork'), true);

    artwork.destroy();
    assert.equal(newImage.isConnected, false);
    assert.equal(newImage.hasAttribute('src'), false);
    assert.equal(host.querySelector('img'), null);
    decoded(newImage, 1024, 1024);
    assert.equal(host.classList.contains('has-artwork'), false, 'late load after destroy stays inert');
    host.remove();
  });

  test('player and CSS keep one square card, cover crop and fade-only reduced-motion contract', () => {
    const player = readSrc('renderer/modules/viewer/player.js');
    const css = readSrc('renderer/styles/base.css');
    assert.match(player, /class="mz-audio-art"/);
    assert.match(player, /audioArtwork\?\.setSource\(curPath, curName\)/);
    assert.match(player, /audioArtwork\?\.destroy\(\)/);
    assert.doesNotMatch(player, /mz-audio-disc|classList\.(?:add|remove)\('spin'\)/);
    assert.match(css, /\.mz-audio-art \{[^}]*aspect-ratio:\s*1\s*\/\s*1/);
    assert.match(css, /\.mz-audio-art > img \{[^}]*object-fit:\s*cover[^}]*transition:\s*opacity 200ms ease/);
    assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.mz-audio-art > img,[^}]*transition:\s*none/);
    assert.doesNotMatch(css, /\.mz-audio-disc|@keyframes\s+mzspin/);
  });
});
