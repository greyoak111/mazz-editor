// W91: real Chromium verifies square embedded artwork, static fallback and source retirement.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w91-audio-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w91-audio-ws-'));
const externalAudio = String(process.env.MAZZ_W91_AUDIO_PATH || '').trim();
const shotPath = path.resolve(process.env.MAZZ_W91_AUDIO_SHOT
  || path.join(os.tmpdir(), 'mazz-w91-audio-artwork.png'));

function syncsafe(value) {
  return Buffer.from([
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function embeddedPngTag() {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const payload = Buffer.concat([
    Buffer.from([0]),
    Buffer.from('image/jpeg\0', 'latin1'), // deliberately false: magic bytes must win
    Buffer.from([6, 0]),
    png,
  ]);
  const frameHeader = Buffer.alloc(10);
  frameHeader.write('APIC', 0, 4, 'ascii');
  frameHeader.writeUInt32BE(payload.length, 4);
  const frame = Buffer.concat([frameHeader, payload]);
  return Buffer.concat([Buffer.from('ID3\x03\x00\x00', 'latin1'), syncsafe(frame.length), frame]);
}

function chunk(id, data) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'latin1');
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length & 1 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function wav({ artwork = false, seconds = 1 } = {}) {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * 2, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const chunks = [chunk('fmt ', fmt)];
  if (artwork) chunks.push(chunk('ID3 ', embeddedPngTag()));
  chunks.push(chunk('data', Buffer.alloc(samples * 2)));
  const body = Buffer.concat([Buffer.from('WAVE'), ...chunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

const artFixture = path.join(workspace, '01-embedded-art.wav');
const fallbackFixture = path.join(workspace, '02-no-art.wav');
fs.writeFileSync(artFixture, wav({ artwork: true }));
fs.writeFileSync(fallbackFixture, wav());
const firstPath = externalAudio && fs.existsSync(externalAudio) ? path.resolve(externalAudio) : artFixture;
const errors = [];
let app;

const activeArtwork = () => {
  const players = [...document.querySelectorAll('.mz-player')];
  const player = players.find(item => item.getBoundingClientRect().width > 0) || players.at(-1);
  const card = player?.querySelector('.mz-audio-art');
  const image = card?.querySelector('img');
  if (!card) return null;
  const cardRect = card.getBoundingClientRect();
  const imageRect = image?.getBoundingClientRect();
  const cardStyle = getComputedStyle(card);
  const imageStyle = image ? getComputedStyle(image) : null;
  const fallback = card.querySelector('.mz-audio-art-fallback');
  return {
    name: player.querySelector('.mz-name')?.textContent || '',
    src: image?.src || '',
    hasArtwork: card.classList.contains('has-artwork'),
    busy: card.getAttribute('aria-busy'),
    label: card.getAttribute('aria-label'),
    card: { width: cardRect.width, height: cardRect.height },
    image: image ? {
      width: imageRect.width,
      height: imageRect.height,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      objectFit: imageStyle.objectFit,
      opacity: imageStyle.opacity,
    } : null,
    fallbackOpacity: fallback ? getComputedStyle(fallback).opacity : null,
    animationName: cardStyle.animationName,
    transform: cardStyle.transform,
  };
};

try {
  app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  win.on('pageerror', error => errors.push(String(error?.stack || error)));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
  });
  await win.evaluate(target => window.MazzShell.openFile(target), firstPath);
  await win.waitForFunction(() => {
    const card = [...document.querySelectorAll('.mz-player')]
      .find(item => item.getBoundingClientRect().width > 0)?.querySelector('.mz-audio-art');
    const image = card?.querySelector('img');
    return card?.classList.contains('has-artwork') && image?.naturalWidth > 0 && image?.naturalHeight > 0;
  }, null, { timeout: 30000 });
  await win.waitForTimeout(250);

  const initial = await win.evaluate(activeArtwork);
  if (!initial || Math.abs(initial.card.width - initial.card.height) > 1
    || Math.abs(initial.image.width - initial.image.height) > 1
    || initial.image.objectFit !== 'cover'
    || initial.image.opacity !== '1'
    || initial.fallbackOpacity !== '0'
    || initial.animationName !== 'none') {
    throw new Error(`Square artwork contract failed: ${JSON.stringify(initial)}`);
  }
  await win.waitForTimeout(700);
  const settled = await win.evaluate(activeArtwork);
  if (settled.transform !== initial.transform) {
    throw new Error(`Artwork must not rotate: ${initial.transform} -> ${settled.transform}`);
  }

  let switched = null;
  if (firstPath === artFixture) {
    await win.waitForFunction(() => document.querySelector('.mz-side-count')?.textContent === '（2）', null, { timeout: 10000 });
    await win.locator('.mz-player [data-a=next]').click();
    await win.waitForFunction(() => {
      const player = [...document.querySelectorAll('.mz-player')].find(item => item.getBoundingClientRect().width > 0);
      const card = player?.querySelector('.mz-audio-art');
      return player?.querySelector('.mz-name')?.textContent === '02-no-art.wav'
        && !card?.classList.contains('has-artwork')
        && !card?.querySelector('img')
        && card?.getAttribute('aria-busy') === 'false'
        && getComputedStyle(card.querySelector('.mz-audio-art-fallback')).opacity === '1';
    }, null, { timeout: 10000 });
    switched = await win.evaluate(activeArtwork);
    if (!switched?.label?.includes('无内嵌封面') || switched.fallbackOpacity !== '1') {
      throw new Error(`Fallback card contract failed: ${JSON.stringify(switched)}`);
    }
  } else {
    await win.waitForFunction(() => Number((document.querySelector('.mz-side-count')?.textContent || '').replace(/\D/g, '')) >= 2, null, { timeout: 10000 });
    const oldSrc = initial.src;
    await win.locator('.mz-player [data-a=next]').click();
    await win.waitForFunction(previous => {
      const player = [...document.querySelectorAll('.mz-player')].find(item => item.getBoundingClientRect().width > 0);
      const image = player?.querySelector('.mz-audio-art.has-artwork img');
      return image?.naturalWidth > 0 && image.src !== previous && getComputedStyle(image).opacity === '1';
    }, oldSrc, { timeout: 30000 });
    switched = await win.evaluate(activeArtwork);
    if (!switched?.hasArtwork || switched.image?.opacity !== '1' || switched.fallbackOpacity !== '0') {
      throw new Error(`Switched artwork did not settle: ${JSON.stringify(switched)}`);
    }
  }

  await win.screenshot({ path: shotPath });
  const result = {
    verdict: 'PASS',
    source: firstPath === artFixture ? 'synthetic-wav-id3' : firstPath,
    initial,
    switched,
    runtimeErrors: errors,
    screenshot: shotPath,
  };
  if (errors.length) throw new Error(`Renderer errors: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  try { await app?.close(); } catch {}
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
