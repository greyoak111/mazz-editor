// renderer/modules/library/cover-cache.js
// Session blob URLs are never valid shelf records.  Covers are normalized to a
// small persistent workspace thumbnail and the shelf stores only its stable URL.

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
};

export const COVER_LIMITS = Object.freeze({
  inputBytes: 24 * 1024 * 1024,
  persistedBytes: 2 * 1024 * 1024,
  dataUrlBytes: 256 * 1024,
});

const emptyCover = reason => ({ cover: '', coverPath: '', ...(reason ? { skipped: reason } : {}) });
const base64DecodedBytes = value => Math.floor(String(value || '').length * 3 / 4);

const bytesToBase64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
};

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error || new Error('cover encode failed'));
  reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
  reader.readAsDataURL(blob);
});

async function thumbnail(bytes, mime, maxEdge = 384) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { base64: bytesToBase64(bytes), ext: mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png', mime };
  }
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width || 1, bitmap.height || 1));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('cover canvas unavailable');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .84));
    if (!blob) throw new Error('cover thumbnail encode failed');
    return { base64: await blobToBase64(blob), ext: 'webp', mime: 'image/webp' };
  } finally {
    bitmap.close?.();
  }
}

export const stableMediaUrl = (path) => `mazz-res://media/${encodeURIComponent(String(path || '').replace(/\\/g, '/'))}`;

/** Persist image bytes as a bounded shelf thumbnail. Falls back to a stable data URL. */
export async function persistCover({ invoke, workspace, bookId, bytes, mime, ext }) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) return { cover: '', coverPath: '' };
  if (bytes.byteLength > COVER_LIMITS.inputBytes) return emptyCover('input-too-large');
  const type = mime || MIME_BY_EXT[String(ext || '').toLowerCase()] || 'image/jpeg';
  let out;
  try { out = await thumbnail(bytes, type); }
  catch {
    if (bytes.byteLength > COVER_LIMITS.persistedBytes) return emptyCover('thumbnail-failed');
    out = { base64: bytesToBase64(bytes), ext: String(ext || 'jpg').replace('jpeg', 'jpg'), mime: type };
  }
  const outputBytes = base64DecodedBytes(out?.base64);
  if (!out?.base64 || outputBytes > COVER_LIMITS.persistedBytes) return emptyCover('thumbnail-too-large');

  const safeId = String(bookId || 'cover').replace(/[^a-z0-9_-]/gi, '_');
  const root = String(workspace || '').replace(/[\\/]+$/, '');
  if (root && typeof invoke === 'function') {
    const dir = `${root}/书库/.covers`;
    const path = `${dir}/${safeId}.${out.ext || 'webp'}`;
    try {
      await invoke('fs:mkdir', { path: dir });
      await invoke('fs:writeFileBase64', { path, base64: out.base64 });
      return { cover: stableMediaUrl(path), coverPath: path };
    } catch {}
  }
  if (outputBytes <= COVER_LIMITS.dataUrlBytes) {
    return { cover: `data:${out.mime};base64,${out.base64}`, coverPath: '' };
  }
  return emptyCover('data-url-too-large');
}

export const _forTests = { MIME_BY_EXT, bytesToBase64, base64DecodedBytes };
