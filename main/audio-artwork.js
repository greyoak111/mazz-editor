'use strict';

// Embedded audio artwork is intentionally parsed in the main process.  The
// renderer should never read an entire song merely to obtain a small cover.
// Every container, tag, image and decoded-pixel claim is bounded before its
// bytes are handed to Chromium.

const fs = require('node:fs');
const path = require('node:path');

const AUDIO_ARTWORK_LIMITS = Object.freeze({
  tagBytes: 24 * 1024 * 1024,
  containerBytes: 32 * 1024 * 1024,
  imageBytes: 8 * 1024 * 1024,
  imagePixels: 40_000_000,
  containerEntries: 4096,
  concurrentReads: 2,
  cacheEntries: 24,
  cacheBytes: 32 * 1024 * 1024,
});

const AUDIO_EXTENSIONS = new Set(['.mp3', '.aac', '.flac', '.m4a', '.mp4', '.oga', '.ogg', '.opus', '.wav']);
const ARTWORK_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const cache = new Map();
let cacheBytes = 0;
let activeArtworkReads = 0;
const artworkReadQueue = [];

function abortError() {
  const error = new Error('Audio artwork request aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function releaseArtworkPermit() {
  activeArtworkReads = Math.max(0, activeArtworkReads - 1);
  while (artworkReadQueue.length) {
    const entry = artworkReadQueue.shift();
    entry.cleanup();
    if (entry.signal?.aborted) {
      entry.reject(abortError());
      continue;
    }
    activeArtworkReads += 1;
    entry.resolve(releaseArtworkPermit);
    break;
  }
}

function acquireArtworkPermit(signal) {
  assertNotAborted(signal);
  if (activeArtworkReads < AUDIO_ARTWORK_LIMITS.concurrentReads) {
    activeArtworkReads += 1;
    return Promise.resolve(releaseArtworkPermit);
  }
  return new Promise((resolve, reject) => {
    const entry = { signal, resolve, reject, cleanup: () => {} };
    const onAbort = () => {
      const index = artworkReadQueue.indexOf(entry);
      if (index >= 0) artworkReadQueue.splice(index, 1);
      entry.cleanup();
      reject(abortError());
    };
    entry.cleanup = () => signal?.removeEventListener?.('abort', onAbort);
    signal?.addEventListener?.('abort', onAbort, { once: true });
    artworkReadQueue.push(entry);
  });
}

async function withArtworkPermit(signal, task) {
  const release = await acquireArtworkPermit(signal);
  try {
    assertNotAborted(signal);
    return await task();
  } finally {
    release();
  }
}

function syncsafe32(buffer, offset = 0) {
  if (offset < 0 || offset + 4 > buffer.length) return -1;
  const a = buffer[offset], b = buffer[offset + 1], c = buffer[offset + 2], d = buffer[offset + 3];
  if ((a | b | c | d) & 0x80) return -1;
  return (a << 21) | (b << 14) | (c << 7) | d;
}

function uint24be(buffer, offset = 0) {
  if (offset < 0 || offset + 3 > buffer.length) return -1;
  return (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
}

function deUnsynchronise(buffer) {
  if (!buffer.includes(0xff)) return buffer;
  const output = Buffer.allocUnsafe(buffer.length);
  let write = 0;
  for (let read = 0; read < buffer.length; read += 1) {
    output[write++] = buffer[read];
    if (buffer[read] === 0xff && buffer[read + 1] === 0x00) read += 1;
  }
  return output.subarray(0, write);
}

function encodedTerminator(buffer, offset, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let i = offset; i + 1 < buffer.length; i += 2) {
      if (buffer[i] === 0 && buffer[i + 1] === 0) return i + 2;
    }
    return -1;
  }
  const end = buffer.indexOf(0, offset);
  return end < 0 ? -1 : end + 1;
}

function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10 || buffer.length > AUDIO_ARTWORK_LIMITS.imageBytes) return null;
  let mime = null;
  let width = 0;
  let height = 0;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    mime = 'image/jpeg';
    let cursor = 2;
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (cursor + 8 < buffer.length) {
      while (cursor < buffer.length && buffer[cursor] !== 0xff) cursor += 1;
      while (cursor < buffer.length && buffer[cursor] === 0xff) cursor += 1;
      if (cursor >= buffer.length) break;
      const marker = buffer[cursor++];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (cursor + 2 > buffer.length) break;
      const segmentBytes = buffer.readUInt16BE(cursor);
      if (segmentBytes < 2 || cursor + segmentBytes > buffer.length) break;
      if (sof.has(marker) && segmentBytes >= 7) {
        height = buffer.readUInt16BE(cursor + 3);
        width = buffer.readUInt16BE(cursor + 5);
        break;
      }
      cursor += segmentBytes;
    }
  } else if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buffer.length >= 24) {
    mime = 'image/png';
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  } else if ((buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') && buffer.length >= 10) {
    mime = 'image/gif';
    width = buffer.readUInt16LE(6);
    height = buffer.readUInt16LE(8);
  } else if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' && buffer.length >= 30) {
    mime = 'image/webp';
    const kind = buffer.subarray(12, 16).toString('ascii');
    if (kind === 'VP8X') {
      width = 1 + buffer.readUIntLE(24, 3);
      height = 1 + buffer.readUIntLE(27, 3);
    } else if (kind === 'VP8 ' && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      width = buffer.readUInt16LE(26) & 0x3fff;
      height = buffer.readUInt16LE(28) & 0x3fff;
    } else if (kind === 'VP8L' && buffer[20] === 0x2f) {
      width = 1 + buffer[21] + ((buffer[22] & 0x3f) << 8);
      height = 1 + ((buffer[22] & 0xc0) >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10);
    }
  }

  if (!mime || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return null;
  if (width * height > AUDIO_ARTWORK_LIMITS.imagePixels) return null;
  return { mime, width, height, bytes: buffer };
}

function pictureBlock(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) return null;
  let cursor = 0;
  const pictureType = buffer.readUInt32BE(cursor); cursor += 4;
  const mimeBytes = buffer.readUInt32BE(cursor); cursor += 4;
  if (mimeBytes > 256 || cursor + mimeBytes + 4 > buffer.length) return null;
  cursor += mimeBytes;
  const descriptionBytes = buffer.readUInt32BE(cursor); cursor += 4;
  if (descriptionBytes > 1024 * 1024 || cursor + descriptionBytes + 20 > buffer.length) return null;
  cursor += descriptionBytes;
  cursor += 16; // width, height, depth, indexed colours (actual image remains authoritative)
  const imageBytes = buffer.readUInt32BE(cursor); cursor += 4;
  if (imageBytes < 1 || imageBytes > AUDIO_ARTWORK_LIMITS.imageBytes || cursor + imageBytes > buffer.length) return null;
  const image = sniffImage(buffer.subarray(cursor, cursor + imageBytes));
  return image ? { ...image, pictureType } : null;
}

function apicFrame(payload, version) {
  if (!Buffer.isBuffer(payload) || payload.length < 8) return null;
  const encoding = payload[0];
  let cursor = 1;
  if (version === 2) {
    if (cursor + 4 > payload.length) return null;
    cursor += 3; // three-byte image format (actual bytes remain authoritative)
  } else {
    const mimeEnd = payload.indexOf(0, cursor);
    if (mimeEnd < 0 || mimeEnd - cursor > 256) return null;
    cursor = mimeEnd + 1;
  }
  if (cursor >= payload.length) return null;
  const pictureType = payload[cursor++];
  const imageOffset = encodedTerminator(payload, cursor, encoding);
  if (imageOffset < 0 || imageOffset >= payload.length) return null;
  const image = sniffImage(payload.subarray(imageOffset));
  return image ? { ...image, pictureType } : null;
}

function parseId3Artwork(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10 || buffer.subarray(0, 3).toString('ascii') !== 'ID3') return null;
  const version = buffer[3];
  if (![2, 3, 4].includes(version)) return null;
  const declaredBytes = syncsafe32(buffer, 6);
  if (declaredBytes < 0 || declaredBytes > AUDIO_ARTWORK_LIMITS.tagBytes || 10 + declaredBytes > buffer.length) return null;
  let tag = buffer.subarray(10, 10 + declaredBytes);
  if (buffer[5] & 0x80) tag = deUnsynchronise(tag);
  let cursor = 0;
  if (buffer[5] & 0x40) {
    if (version === 3 && tag.length >= 4) {
      const extBytes = tag.readUInt32BE(0);
      cursor = 4 + extBytes;
    } else if (version === 4 && tag.length >= 4) {
      cursor = syncsafe32(tag, 0);
    }
    if (cursor < 0 || cursor > tag.length) return null;
  }

  let fallback = null;
  while (cursor + (version === 2 ? 6 : 10) <= tag.length) {
    const idBytes = version === 2 ? 3 : 4;
    const id = tag.subarray(cursor, cursor + idBytes).toString('ascii');
    if (/^\x00+$/.test(id)) break;
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const frameBytes = version === 2
      ? uint24be(tag, cursor + 3)
      : version === 4 ? syncsafe32(tag, cursor + 4) : tag.readUInt32BE(cursor + 4);
    const headerBytes = version === 2 ? 6 : 10;
    if (frameBytes < 0 || frameBytes > AUDIO_ARTWORK_LIMITS.tagBytes || cursor + headerBytes + frameBytes > tag.length) break;
    let payload = tag.subarray(cursor + headerBytes, cursor + headerBytes + frameBytes);
    if (version === 4 && (tag[cursor + 9] & 0x02)) payload = deUnsynchronise(payload);
    if (id === 'APIC' || id === 'PIC') {
      const candidate = apicFrame(payload, version);
      if (candidate?.pictureType === 3) return candidate;
      if (candidate && !fallback) fallback = candidate;
    }
    cursor += headerBytes + frameBytes;
  }
  return fallback;
}

function parseFlacArtwork(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.subarray(0, 4).toString('ascii') !== 'fLaC') return null;
  let cursor = 4;
  let fallback = null;
  while (cursor + 4 <= buffer.length) {
    const typeByte = buffer[cursor];
    const last = !!(typeByte & 0x80);
    const type = typeByte & 0x7f;
    const blockBytes = uint24be(buffer, cursor + 1);
    cursor += 4;
    if (blockBytes < 0 || cursor + blockBytes > buffer.length) return fallback;
    if (type === 6) {
      const candidate = pictureBlock(buffer.subarray(cursor, cursor + blockBytes));
      if (candidate?.pictureType === 3) return candidate;
      if (candidate && !fallback) fallback = candidate;
    }
    cursor += blockBytes;
    if (last) break;
  }
  return fallback;
}

function parseOggArtwork(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.subarray(0, 4).toString('ascii') !== 'OggS') return null;
  for (const key of ['METADATA_BLOCK_PICTURE=', 'COVERART=']) {
    let offset = 0;
    while ((offset = buffer.indexOf(key, offset, 'ascii')) >= 0) {
      const start = offset + key.length;
      let end = start;
      while (end < buffer.length && /[A-Za-z0-9+/=]/.test(String.fromCharCode(buffer[end]))) end += 1;
      if (end > start && end - start <= Math.ceil(AUDIO_ARTWORK_LIMITS.imageBytes * 4 / 3) + 16) {
        try {
          const decoded = Buffer.from(buffer.subarray(start, end).toString('ascii'), 'base64');
          const candidate = key[0] === 'M' ? pictureBlock(decoded) : sniffImage(decoded);
          if (candidate) return candidate;
        } catch {}
      }
      offset = end + 1;
    }
  }
  return null;
}

function parseMp4Artwork(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  let cursor = 0;
  while ((cursor = buffer.indexOf('covr', cursor, 'ascii')) >= 0) {
    const coverStart = cursor - 4;
    if (coverStart >= 0) {
      const coverBytes = buffer.readUInt32BE(coverStart);
      const coverEnd = coverStart + coverBytes;
      if (coverBytes >= 24 && coverEnd <= buffer.length) {
        let child = coverStart + 8;
        while (child + 16 <= coverEnd) {
          const childBytes = buffer.readUInt32BE(child);
          const childType = buffer.subarray(child + 4, child + 8).toString('ascii');
          if (childBytes < 16 || child + childBytes > coverEnd) break;
          if (childType === 'data') {
            const candidate = sniffImage(buffer.subarray(child + 16, child + childBytes));
            if (candidate) return candidate;
          }
          child += childBytes;
        }
      }
    }
    cursor += 4;
  }
  return null;
}

async function readRange(handle, position, length, signal) {
  assertNotAborted(signal);
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    assertNotAborted(signal);
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    assertNotAborted(signal);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

async function readMp4Artwork(handle, size, { signal } = {}) {
  let cursor = 0;
  for (let atoms = 0; atoms < AUDIO_ARTWORK_LIMITS.containerEntries && cursor + 8 <= size; atoms += 1) {
    assertNotAborted(signal);
    const header = await readRange(handle, cursor, 16, signal);
    if (header.length < 8) return null;
    let atomBytes = header.readUInt32BE(0);
    const type = header.subarray(4, 8).toString('ascii');
    let headerBytes = 8;
    if (atomBytes === 1) {
      if (header.length < 16) return null;
      const wide = header.readBigUInt64BE(8);
      if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      atomBytes = Number(wide);
      headerBytes = 16;
    } else if (atomBytes === 0) atomBytes = size - cursor;
    if (atomBytes < headerBytes || cursor + atomBytes > size) return null;
    if (type === 'moov') {
      if (atomBytes > AUDIO_ARTWORK_LIMITS.containerBytes) return null;
      return parseMp4Artwork(await readRange(handle, cursor, atomBytes, signal));
    }
    cursor += atomBytes;
  }
  return null;
}

async function readWavArtwork(handle, size, { signal } = {}) {
  const head = await readRange(handle, 0, 12, signal);
  if (head.length < 12 || head.subarray(0, 4).toString('ascii') !== 'RIFF' || head.subarray(8, 12).toString('ascii') !== 'WAVE') return null;
  let cursor = 12;
  for (let chunks = 0; chunks < AUDIO_ARTWORK_LIMITS.containerEntries && cursor + 8 <= size; chunks += 1) {
    assertNotAborted(signal);
    const header = await readRange(handle, cursor, 8, signal);
    if (header.length < 8) return null;
    const type = header.subarray(0, 4).toString('ascii').toLowerCase();
    const chunkBytes = header.readUInt32LE(4);
    if (chunkBytes > size - cursor - 8) return null;
    if (type === 'id3 ' || type === 'id3\x00') {
      if (chunkBytes > AUDIO_ARTWORK_LIMITS.tagBytes) return null;
      return parseId3Artwork(await readRange(handle, cursor + 8, chunkBytes, signal));
    }
    cursor += 8 + chunkBytes + (chunkBytes & 1);
  }
  return null;
}

function cacheGet(key) {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cachePut(key, value) {
  if (cache.has(key)) {
    cacheBytes -= cache.get(key)?.bytes?.length || 0;
    cache.delete(key);
  }
  const bytes = value?.bytes?.length || 0;
  cache.set(key, value);
  cacheBytes += bytes;
  while (cache.size > AUDIO_ARTWORK_LIMITS.cacheEntries || cacheBytes > AUDIO_ARTWORK_LIMITS.cacheBytes) {
    const oldest = cache.keys().next().value;
    const retired = cache.get(oldest);
    cacheBytes -= retired?.bytes?.length || 0;
    cache.delete(oldest);
  }
}

async function readAudioArtworkUnlocked(filePath, signal) {
  assertNotAborted(signal);
  const source = String(filePath || '');
  // The artwork route is intentionally an absolute-local-file capability,
  // matching media playback.  Never let a malformed/relative request fall
  // through to the main process working directory.
  if (!source || source.includes('\0') || source.length > 32_768 || !path.isAbsolute(source)) return null;
  const resolved = path.resolve(source);
  if (!AUDIO_EXTENSIONS.has(path.extname(resolved).toLowerCase())) return null;
  let handle;
  try {
    handle = await fs.promises.open(resolved, 'r');
    assertNotAborted(signal);
    const stat = await handle.stat();
    assertNotAborted(signal);
    if (!stat.isFile() || stat.size < 10) return null;
    const key = `${resolved}\0${stat.size}\0${stat.mtimeMs}`;
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;

    const extension = path.extname(resolved).toLowerCase();
    let artwork = null;
    if (extension === '.m4a' || extension === '.mp4') {
      artwork = await readMp4Artwork(handle, stat.size, { signal });
    } else if (extension === '.wav') {
      artwork = await readWavArtwork(handle, stat.size, { signal });
    } else {
      const scanLimit = extension === '.flac' ? AUDIO_ARTWORK_LIMITS.containerBytes
        : (extension === '.oga' || extension === '.ogg' || extension === '.opus') ? AUDIO_ARTWORK_LIMITS.imageBytes * 2
          : AUDIO_ARTWORK_LIMITS.tagBytes + 10;
      const prefix = await readRange(handle, 0, Math.min(stat.size, scanLimit), signal);
      assertNotAborted(signal);
      artwork = extension === '.flac' ? parseFlacArtwork(prefix)
        : (extension === '.oga' || extension === '.ogg' || extension === '.opus') ? parseOggArtwork(prefix)
          : parseId3Artwork(prefix);
    }
    const result = artwork ? Object.freeze({
      mime: artwork.mime,
      width: artwork.width,
      height: artwork.height,
      bytes: Buffer.from(artwork.bytes),
    }) : null;
    assertNotAborted(signal);
    cachePut(key, result);
    return result;
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readAudioArtwork(filePath, { signal } = {}) {
  return withArtworkPermit(signal, () => readAudioArtworkUnlocked(filePath, signal));
}

function audioArtworkPathFromResourceUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(String(value || ''));
    if (url.protocol !== 'mazz-res:' || url.host !== 'audio-artwork') return null;
    // URL.pathname always contributes the routing slash.  Decode exactly
    // once so literal percent signs in a legitimate filename stay literal.
    const source = decodeURIComponent(url.pathname.slice(1));
    if (!source || source.includes('\0') || source.length > 32_768 || !path.isAbsolute(source)) return null;
    return path.resolve(source);
  } catch {
    return null;
  }
}

const artworkResponseHeaders = (mime = '') => ({
  ...(mime ? { 'Content-Type': mime } : {}),
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
});

async function serveAudioArtwork(filePath, { method = 'GET', reader = readAudioArtwork, signal } = {}) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb !== 'GET' && verb !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...artworkResponseHeaders(), Allow: 'GET, HEAD' } });
  }
  try {
    assertNotAborted(signal);
    const artwork = await reader(filePath, { signal });
    assertNotAborted(signal);
    const bytes = artwork?.bytes;
    const mime = String(artwork?.mime || '').toLowerCase();
    if (!Buffer.isBuffer(bytes)
      || bytes.length < 10
      || bytes.length > AUDIO_ARTWORK_LIMITS.imageBytes
      || !ARTWORK_MIME_TYPES.has(mime)
      || !Number.isSafeInteger(artwork.width)
      || !Number.isSafeInteger(artwork.height)
      || artwork.width < 1
      || artwork.height < 1
      || artwork.width * artwork.height > AUDIO_ARTWORK_LIMITS.imagePixels) {
      return new Response(null, { status: 404, headers: artworkResponseHeaders() });
    }
    const headers = {
      ...artworkResponseHeaders(mime),
      'Content-Length': String(bytes.length),
    };
    return new Response(verb === 'HEAD' ? null : bytes, { status: 200, headers });
  } catch {
    // A bad tag, disappearing file or parser failure is an ordinary
    // no-artwork result.  Do not leak the local path or parser internals.
    return new Response(null, { status: 404, headers: artworkResponseHeaders() });
  }
}

module.exports = {
  AUDIO_ARTWORK_LIMITS,
  ARTWORK_MIME_TYPES,
  audioArtworkPathFromResourceUrl,
  parseId3Artwork,
  parseFlacArtwork,
  parseOggArtwork,
  parseMp4Artwork,
  readAudioArtwork,
  readMp4Artwork,
  readWavArtwork,
  serveAudioArtwork,
  sniffImage,
  withArtworkPermit,
};
