// W91 audio artwork: bounded embedded-cover parsing and fail-closed protocol.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  AUDIO_ARTWORK_LIMITS,
  audioArtworkPathFromResourceUrl,
  parseId3Artwork,
  readAudioArtwork,
  readMp4Artwork,
  readWavArtwork,
  serveAudioArtwork,
  sniffImage,
  withArtworkPermit,
} = require('../../main/audio-artwork.js');

function syncsafe(value) {
  return Buffer.from([
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function png(width, height) {
  const value = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(value);
  value.writeUInt32BE(13, 8);
  value.write('IHDR', 12, 'ascii');
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}

function jpeg(width, height) {
  const value = Buffer.alloc(24);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]).copy(value);
  value.writeUInt16BE(height, 7);
  value.writeUInt16BE(width, 9);
  value[value.length - 2] = 0xff;
  value[value.length - 1] = 0xd9;
  return value;
}

function frame(id, payload) {
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function apic(pictureType, image, declaredMime = 'image/jpeg') {
  return frame('APIC', Buffer.concat([
    Buffer.from([0]),
    Buffer.from(`${declaredMime}\0`, 'latin1'),
    Buffer.from([pictureType, 0]),
    image,
  ]));
}

function id3(...frames) {
  const body = Buffer.concat(frames);
  return Buffer.concat([Buffer.from('ID3\x03\x00\x00', 'latin1'), syncsafe(body.length), body]);
}

function memoryHandle(bytes) {
  let reads = 0;
  return {
    get reads() { return reads; },
    async read(target, offset, length, position) {
      reads += 1;
      const available = Math.max(0, Math.min(length, bytes.length - position));
      if (available) bytes.copy(target, offset, position, position + available);
      return { bytesRead: available };
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe('W91 · ID3 embedded artwork parser', () => {
  test('type 6 remains a valid fallback and declared MIME is corrected by image magic', () => {
    const cover = parseId3Artwork(id3(apic(6, png(800, 800), 'image/jpeg')));
    assert.ok(cover);
    assert.equal(cover.pictureType, 6);
    assert.equal(cover.mime, 'image/png');
    assert.equal(cover.width, 800);
    assert.equal(cover.height, 800);
  });

  test('front cover type 3 wins over an earlier valid fallback', () => {
    const cover = parseId3Artwork(id3(
      apic(6, png(320, 320)),
      apic(3, jpeg(500, 500)),
    ));
    assert.ok(cover);
    assert.equal(cover.pictureType, 3);
    assert.equal(cover.mime, 'image/jpeg');
    assert.equal(cover.width, 500);
  });

  test('no picture, corrupt declarations and bounded-size violations fail closed', () => {
    assert.equal(parseId3Artwork(id3(frame('TIT2', Buffer.from([0, 65])))), null);

    const truncated = Buffer.concat([
      Buffer.from('ID3\x03\x00\x00', 'latin1'),
      syncsafe(1000),
      Buffer.alloc(12),
    ]);
    assert.equal(parseId3Artwork(truncated), null);

    const overTag = Buffer.concat([
      Buffer.from('ID3\x03\x00\x00', 'latin1'),
      syncsafe(AUDIO_ARTWORK_LIMITS.tagBytes + 1),
    ]);
    assert.equal(parseId3Artwork(overTag), null);

    const overImage = Buffer.alloc(AUDIO_ARTWORK_LIMITS.imageBytes + 1);
    png(10, 10).copy(overImage);
    assert.equal(sniffImage(overImage), null);
    assert.equal(sniffImage(png(10_000, 5_000)), null);
  });
});

describe('W91 · mazz-res audio-artwork protocol contract', () => {
  test('MP4 atoms and WAV chunks have a hard I/O entry budget', async () => {
    const entries = AUDIO_ARTWORK_LIMITS.containerEntries + 1;
    const mp4 = Buffer.alloc(entries * 8);
    for (let index = 0; index < entries; index += 1) {
      mp4.writeUInt32BE(8, index * 8);
      mp4.write('free', index * 8 + 4, 4, 'ascii');
    }
    const mp4Handle = memoryHandle(mp4);
    assert.equal(await readMp4Artwork(mp4Handle, mp4.length), null);
    assert.ok(mp4Handle.reads <= AUDIO_ARTWORK_LIMITS.containerEntries,
      `MP4 probe exceeded the ${AUDIO_ARTWORK_LIMITS.containerEntries}-read budget`);

    const wav = Buffer.alloc(12 + entries * 8);
    wav.write('RIFF', 0, 4, 'ascii');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVE', 8, 4, 'ascii');
    for (let index = 0; index < entries; index += 1) wav.write('JUNK', 12 + index * 8, 4, 'ascii');
    const wavHandle = memoryHandle(wav);
    assert.equal(await readWavArtwork(wavHandle, wav.length), null);
    assert.ok(wavHandle.reads <= AUDIO_ARTWORK_LIMITS.containerEntries + 1,
      `WAV probe exceeded the header + ${AUDIO_ARTWORK_LIMITS.containerEntries}-read budget`);
  });

  test('retired reads abort at the next boundary and the global gate caps concurrency', async () => {
    const bytes = Buffer.alloc(24);
    bytes.writeUInt32BE(8, 0);
    bytes.write('free', 4, 4, 'ascii');
    bytes.writeUInt32BE(8, 8);
    bytes.write('free', 12, 4, 'ascii');
    bytes.writeUInt32BE(8, 16);
    bytes.write('free', 20, 4, 'ascii');
    const controller = new AbortController();
    const handle = memoryHandle(bytes);
    const originalRead = handle.read.bind(handle);
    handle.read = async (...args) => {
      const result = await originalRead(...args);
      controller.abort();
      return result;
    };
    await assert.rejects(
      () => readMp4Artwork(handle, bytes.length, { signal: controller.signal }),
      (error) => error?.name === 'AbortError',
    );
    assert.equal(handle.reads, 1, 'an aborted owner must not continue probing atoms');

    const blockers = [deferred(), deferred(), deferred()];
    let active = 0;
    let peak = 0;
    const started = [];
    const tasks = blockers.map((blocker, index) => withArtworkPermit(null, async () => {
      started.push(index);
      active += 1;
      peak = Math.max(peak, active);
      await blocker.promise;
      active -= 1;
    }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, [0, 1]);
    assert.equal(peak, AUDIO_ARTWORK_LIMITS.concurrentReads);
    blockers[0].resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 2]);
    blockers[1].resolve();
    blockers[2].resolve();
    await Promise.all(tasks);
  });

  test('encoded absolute path resolves exactly once; relative and malformed paths are rejected', () => {
    const absolute = path.resolve('C:/W91 percent% cover.mp3');
    const url = `mazz-res://audio-artwork/${encodeURIComponent(absolute.replace(/\\/g, '/'))}`;
    assert.equal(audioArtworkPathFromResourceUrl(url), absolute);
    assert.equal(audioArtworkPathFromResourceUrl('mazz-res://audio-artwork/relative.mp3'), null);
    assert.equal(audioArtworkPathFromResourceUrl('mazz-res://audio-artwork/%E0%A4%A'), null);
    assert.equal(audioArtworkPathFromResourceUrl('mazz-res://media/C%3A%2Fx.mp3'), null);
  });

  test('real bounded file read serves magic-derived MIME and hardened headers', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w91-art-'));
    const target = path.join(directory, 'type6-mislabeled.mp3');
    try {
      fs.writeFileSync(target, id3(apic(6, png(800, 800), 'image/jpeg')));
      const parsed = await readAudioArtwork(target);
      assert.equal(parsed?.mime, 'image/png');
      const response = await serveAudioArtwork(target);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(response.headers.get('content-length'), String(parsed.bytes.length));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), parsed.bytes);

      const head = await serveAudioArtwork(target, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      assert.equal(head.headers.get('content-length'), String(parsed.bytes.length));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('missing/unsupported artwork and invalid methods never leak a body or path', async () => {
    const missing = await serveAudioArtwork('relative.mp3');
    assert.equal(missing.status, 404);
    assert.equal((await missing.text()), '');

    const rejected = await serveAudioArtwork('C:/bad.mp3', {
      reader: async () => ({ mime: 'text/html', width: 1, height: 1, bytes: Buffer.from('<script>x</script>') }),
    });
    assert.equal(rejected.status, 404);
    assert.equal(rejected.headers.get('x-content-type-options'), 'nosniff');

    let called = false;
    const method = await serveAudioArtwork('C:/bad.mp3', {
      method: 'POST',
      reader: async () => { called = true; return null; },
    });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get('allow'), 'GET, HEAD');
    assert.equal(called, false);
  });

  test('main protocol routes artwork before generic media streaming', () => {
    const source = fs.readFileSync(path.resolve('main/main.js'), 'utf8');
    const artwork = source.indexOf("u.host === 'audio-artwork'");
    const media = source.indexOf("rel.startsWith('media/')");
    assert.ok(artwork > 0, 'audio artwork route must be registered');
    assert.ok(media > artwork, 'artwork route must precede generic media streaming');
    assert.ok(source.includes('serveAudioArtwork(artworkPath, { method: req.method, signal: req.signal })'));
  });
});
