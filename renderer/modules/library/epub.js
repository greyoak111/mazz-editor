// renderer/modules/library/epub.js —— EPUB 解析器：zip → container → OPF → spine/目录 → 章节 HTML
// 两段式：loadChapterRaw（sanitize + 图片占位符 libimg:N，产物可入缓存 zip）
//        materialize（占位符 → blob URL（内存纪律）/dataURL（无 createObjectURL 环境回退））
import JSZip from 'jszip';

const byNS = (doc, name) => doc.getElementsByTagNameNS('*', name);

/** 解析相对路径为 zip 内绝对路径（dir 为目录语义，不带文件名） */
function resolvePath(dir, href) {
  const parts = (dir ? dir.split('/') : []).concat(href.split('/'));
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return decodeURIComponent(out.join('/'));
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' };
const BLOCKED_CHAPTER_ELEMENTS = new Set([
  'script', 'style', 'link', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'option', 'textarea', 'meta', 'base',
  'audio', 'video', 'source', 'track', 'foreignobject', 'use', 'template', 'portal',
  'fencedframe', 'webview', 'browserplugin', 'param',
]);
const REQUEST_ATTRIBUTES = new Set([
  'src', 'srcset', 'imagesrcset', 'dynsrc', 'lowsrc', 'href', 'xlink:href', 'data', 'poster', 'action', 'formaction',
  'background', 'cite', 'longdesc', 'usemap', 'ping', 'manifest', 'profile', 'codebase',
  'archive', 'srcdoc',
]);
const REMOTE_OR_ACTIVE_VALUE = /(?:\b(?:https?|file|ftp|javascript|vbscript|data|blob)\s*:|(?:^|["'\s(])\/\/|url\s*\(|@import\b)/i;
export const EPUB_ENTRY_LIMITS = Object.freeze({
  container: 1024 * 1024,
  package: 4 * 1024 * 1024,
  navigation: 8 * 1024 * 1024,
  chapter: 16 * 1024 * 1024,
  image: 64 * 1024 * 1024,
  cover: 24 * 1024 * 1024,
});
export const EPUB_CHAPTER_IMAGE_LIMITS = Object.freeze({
  count: 64,
  totalBytes: 96 * 1024 * 1024,
});
export const MAX_EPUB_ARCHIVE_ENTRIES = 10_000;

/**
 * Read the classic ZIP end-of-central-directory record before JSZip builds an
 * object for every entry.  The archive source is already bounded, but a tiny
 * ZIP can still declare tens of thousands of empty entries and amplify heap
 * usage in metadata alone.  ZIP64's 0xffff sentinel necessarily exceeds the
 * supported Library envelope and is rejected here; a future random-access ZIP
 * adapter may lift this without weakening the renderer limit.
 */
export function assertZipEntryCount(source, {
  maxEntries = MAX_EPUB_ARCHIVE_ENTRIES,
  label = 'ZIP archive',
} = {}) {
  const bytes = source instanceof Uint8Array
    ? source
    : ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : null;
  if (!bytes || bytes.byteLength < 22) {
    throw Object.assign(new Error(`${label} 缺少 ZIP 中央目录`), { code: 'LIBRARY_ZIP_EOCD_MISSING' });
  }
  const limit = Math.max(1, Math.trunc(Number(maxEntries) || 0));
  const min = Math.max(0, bytes.byteLength - 22 - 0xffff);
  let offset = -1;
  for (let i = bytes.byteLength - 22; i >= min; i--) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x05 || bytes[i + 3] !== 0x06) continue;
    const candidate = new DataView(bytes.buffer, bytes.byteOffset + i, bytes.byteLength - i);
    const commentBytes = candidate.getUint16(20, true);
    const diskNo = candidate.getUint16(4, true);
    const centralDisk = candidate.getUint16(6, true);
    const entriesOnDisk = candidate.getUint16(8, true);
    const entriesTotal = candidate.getUint16(10, true);
    const centralBytes = candidate.getUint32(12, true);
    const centralOffset = candidate.getUint32(16, true);
    // A PK0506 byte sequence inside the archive comment is not an EOCD.  The
    // record must terminate the archive, describe one disk, and point to a
    // central directory ending exactly where this record begins.  This also
    // prevents a forged low-count EOCD in a malicious comment from bypassing
    // the pre-JSZip amplification gate.
    if (i + 22 + commentBytes !== bytes.byteLength) continue;
    if (diskNo !== 0 || centralDisk !== 0 || entriesOnDisk !== entriesTotal) continue;
    if (centralOffset + centralBytes !== i) continue;
    if (entriesTotal !== 0xffff && entriesTotal <= limit) {
      let cursor = centralOffset;
      let valid = true;
      for (let entryIndex = 0; entryIndex < entriesTotal; entryIndex++) {
        if (cursor + 46 > i
          || bytes[cursor] !== 0x50 || bytes[cursor + 1] !== 0x4b
          || bytes[cursor + 2] !== 0x01 || bytes[cursor + 3] !== 0x02) {
          valid = false;
          break;
        }
        const central = new DataView(bytes.buffer, bytes.byteOffset + cursor, i - cursor);
        const nameBytes = central.getUint16(28, true);
        const extraBytes = central.getUint16(30, true);
        const entryCommentBytes = central.getUint16(32, true);
        cursor += 46 + nameBytes + extraBytes + entryCommentBytes;
        if (cursor > i) { valid = false; break; }
      }
      if (!valid || cursor !== i) continue;
    }
    offset = i;
    break;
  }
  if (offset < 0) {
    throw Object.assign(new Error(`${label} 缺少 ZIP 中央目录`), { code: 'LIBRARY_ZIP_EOCD_MISSING' });
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
  const entries = view.getUint16(10, true);
  if (entries === 0xffff || entries > limit) {
    throw Object.assign(new Error(`${label} 文件项过多（${entries === 0xffff ? 'ZIP64/≥65535' : entries} > ${limit}）`), {
      code: 'LIBRARY_ZIP_TOO_MANY_ENTRIES', entries, maxEntries: limit,
    });
  }
  return entries;
}

export function assertLoadedZipEntryCount(zip, {
  maxEntries = MAX_EPUB_ARCHIVE_ENTRIES,
  label = 'ZIP archive',
} = {}) {
  const entries = Object.keys(zip?.files || {}).length;
  const limit = Math.max(1, Math.trunc(Number(maxEntries) || 0));
  if (entries > limit) {
    throw Object.assign(new Error(`${label} 实际文件项过多（${entries} > ${limit}）`), {
      code: 'LIBRARY_ZIP_TOO_MANY_ENTRIES', entries, maxEntries: limit,
    });
  }
  return entries;
}

/**
 * JSZip exposes the central-directory uncompressed size on loaded entries.
 * Checking it before `.async()` is the only way to reject a highly compressed
 * expansion bomb before its full payload is allocated.  The post-read check
 * below remains mandatory for synthetic entries and corrupt size metadata.
 */
export function zipEntryDeclaredSize(entry) {
  const raw = entry?._data?.uncompressedSize;
  const size = typeof raw === 'bigint' ? Number(raw) : Number(raw);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

const valueByteLength = value => {
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
  const size = Number(value?.byteLength ?? value?.length);
  return Number.isFinite(size) && size >= 0 ? size : 0;
};

export async function readZipEntryBounded(entry, type, {
  maxBytes = Infinity,
  label = entry?.name || 'ZIP entry',
} = {}) {
  if (!entry) return null;
  const limit = Number(maxBytes);
  const bounded = Number.isFinite(limit) && limit >= 0;
  const declaredBytes = zipEntryDeclaredSize(entry);
  if (bounded && declaredBytes != null && declaredBytes > limit) {
    throw Object.assign(new Error(`${label} 解压后体积超过限制（${declaredBytes} > ${limit}）`), {
      code: 'LIBRARY_ZIP_ENTRY_TOO_LARGE', declaredBytes, maxBytes: limit,
    });
  }
  // The central-directory size is useful for an early rejection, but it is
  // attacker-controlled metadata.  JSZip's `.async()` accumulates the entire
  // inflated payload before returning, so a forged small declared size could
  // bypass the check above and exhaust the renderer before the post-check.
  // Consume JSZip's 16 KiB output stream instead and abort the worker as soon
  // as the real byte budget is crossed.
  if (typeof entry.internalStream === 'function') {
    const chunks = [];
    let actualBytes = 0;
    const bytes = await new Promise((resolve, reject) => {
      const helper = entry.internalStream('uint8array');
      let settled = false;
      const finishReject = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      helper.on('data', chunk => {
        if (settled) return;
        const part = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        actualBytes += part.byteLength;
        if (bounded && actualBytes > limit) {
          const error = Object.assign(new Error(`${label} 实际体积超过限制（${actualBytes} > ${limit}）`), {
            code: 'LIBRARY_ZIP_ENTRY_TOO_LARGE', actualBytes, maxBytes: limit,
          });
          // StreamHelper has no public abort. Pause propagates synchronously to
          // every upstream worker, so no further inflater tick is scheduled.
          // Do not call the private `.error()` while JSZip is emitting `data`:
          // it clears the listener array mid-iteration and can itself throw.
          try { helper.pause?.(); } catch {}
          finishReject(error);
          return;
        }
        chunks.push(part);
      });
      helper.on('error', finishReject);
      helper.on('end', () => {
        if (settled) return;
        settled = true;
        const out = new Uint8Array(actualBytes);
        let offset = 0;
        for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
        resolve(out);
      });
      helper.resume();
    });
    if (type === 'text' || type === 'string') return new TextDecoder('utf-8').decode(bytes);
    if (type === 'arraybuffer') return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return bytes;
  }

  // Synthetic adapters may not expose JSZip's stream API. They retain the
  // post-read guard, while every production JSZip entry takes the bounded
  // streaming branch above.
  const value = await entry.async(type);
  const actualBytes = valueByteLength(value);
  if (bounded && actualBytes > limit) {
    throw Object.assign(new Error(`${label} 实际体积超过限制（${actualBytes} > ${limit}）`), {
      code: 'LIBRARY_ZIP_ENTRY_TOO_LARGE', actualBytes, maxBytes: limit,
    });
  }
  return value;
}

const canBlob = () => typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
const bytesToB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};

/** 共享加工器：blob URL 登记 + 环境回退（缓存与原生两条路径同一套纪律） */
export function makeImageMaterializer() {
  const urls = new Set();
  const byOwner = new Map();
  const toUrl = (ext, bytes, owner = '') => {
    if (canBlob()) {
      const u = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] || 'image/jpeg' }));
      urls.add(u);
      if (owner) {
        if (!byOwner.has(owner)) byOwner.set(owner, new Set());
        byOwner.get(owner).add(u);
      }
      return u;
    }
    return `data:${MIME[ext] || 'image/jpeg'};base64,${bytesToB64(bytes)}`;
  };
  const releaseOwner = (owner) => {
    const owned = byOwner.get(owner);
    if (!owned) return;
    for (const u of owned) {
      if (u.startsWith('blob:')) URL.revokeObjectURL(u);
      urls.delete(u);
    }
    byOwner.delete(owner);
  };
  const unloadAll = () => {
    for (const u of urls) if (u.startsWith('blob:')) URL.revokeObjectURL(u);
    urls.clear();
    byOwner.clear();
  };
  return { toUrl, releaseOwner, unloadAll, liveCount: () => urls.size };
}

const replaceImagePlaceholder = (html, index, url = '') => {
  const matcher = new RegExp(`\\b(src|href)\\s*=\\s*(["'])libimg:${index}\\2`, 'gi');
  return html.replace(matcher, (_all, attribute, quote) => url
    ? `${attribute}=${quote}${url}${quote}`
    : `data-libimg-missing=${quote}${index}${quote}`);
};

const retireUnresolvedImagePlaceholders = html => html.replace(
  /\b(?:src|href)\s*=\s*(?:(["'])libimg:(\d+)[^"']*\1|libimg:(\d+)[^\s>]*)/gi,
  (_all, quote, quotedIndex, bareIndex) => `data-libimg-missing=${quote || '"'}${quotedIndex ?? bareIndex}${quote || '"'}`,
);

/**
 * 占位符章节 → 可渲染 HTML（libimg:N 换真 URL）。
 *
 * 单个 ZIP entry 的上限不足以阻止一章通过许多“小于上限”的图片聚合
 * 占满内存，因此计数与累计解压字节在所有 owner（原生/缓存）进入
 * materializer 前统一执行。预算耗尽后绝不再读取后续 entry。
 */
export async function materialize(rawCh, getBytes, toUrl, {
  isAlive = () => true,
  limits = EPUB_CHAPTER_IMAGE_LIMITS,
} = {}) {
  if (!isAlive()) return null;
  let html = String(rawCh?.html || '');
  const images = Array.isArray(rawCh?.images) ? rawCh.images : [];
  const normalizeLimit = (value, fallback) => {
    const n = Number(value ?? fallback);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  const maxCount = normalizeLimit(limits?.count, EPUB_CHAPTER_IMAGE_LIMITS.count);
  const maxTotalBytes = normalizeLimit(limits?.totalBytes, EPUB_CHAPTER_IMAGE_LIMITS.totalBytes);
  let readCount = 0;
  let totalBytes = 0;
  let exhausted = maxCount === 0 || maxTotalBytes === 0;
  for (let i = 0; i < images.length; i++) {
    if (!isAlive()) return null;
    const im = images[i];
    if (!im || exhausted || readCount >= maxCount) {
      exhausted ||= readCount >= maxCount;
      html = replaceImagePlaceholder(html, i);
      continue;
    }
    readCount++;
    const bytes = await getBytes(im);
    if (!isAlive()) return null;
    if (!bytes) {
      html = replaceImagePlaceholder(html, i);
      continue;
    }
    const byteLength = valueByteLength(bytes);
    if (byteLength > maxTotalBytes - totalBytes) {
      exhausted = true;
      html = replaceImagePlaceholder(html, i);
      continue;
    }
    totalBytes += byteLength;
    html = replaceImagePlaceholder(html, i, toUrl(im.ext, bytes));
    if (totalBytes >= maxTotalBytes) exhausted = true;
  }
  // Corrupt/legacy cache metadata may contain a placeholder without a matching
  // image descriptor. Never hand the iframe an active custom-scheme URL.
  return retireUnresolvedImagePlaceholders(html);
}

function chapterElementName(element) {
  return String(element?.localName || element?.tagName || '').toLowerCase();
}

function localChapterResource(value) {
  const raw = String(value || '').trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  const compact = raw.replace(/[\s\u00a0]+/g, '');
  if (!compact || compact.startsWith('/') || compact.startsWith('\\') || compact.startsWith('#')
      || /^[a-z][a-z0-9+.-]*:/i.test(compact)) return null;
  return raw.split(/[?#]/, 1)[0] || null;
}

/**
 * Turn one parsed chapter body into inert, local-only markup.
 *
 * The result intentionally contains no stylesheet or automatic network
 * request carrier. ZIP-local raster/SVG image files are represented only by
 * `libimg:N` placeholders and are materialized later into renderer-owned
 * blob/data URLs. Links retain fragment navigation only.
 */
export function sanitizeEpubChapterBody(body, { chapterPath = '', hasEntry = () => false } = {}) {
  const chapterDir = chapterPath.includes('/') ? chapterPath.slice(0, chapterPath.lastIndexOf('/')) : '';
  const images = [];

  for (const element of [...body.querySelectorAll('*')]) {
    if (BLOCKED_CHAPTER_ELEMENTS.has(chapterElementName(element))) element.remove();
  }

  // XML parsers preserve namespace prefixes in qualified tag names. Filtering
  // by localName keeps `<svg:image>` on the exact same local-materialization
  // path as ordinary HTML `<img>` instead of silently dropping the former.
  const localImages = [...body.querySelectorAll('*')]
    .filter(element => ['img', 'image'].includes(chapterElementName(element)));
  for (const image of localImages) {
    const source = image.getAttribute('src') || image.getAttribute('href') || image.getAttribute('xlink:href');
    image.removeAttribute('src');
    image.removeAttribute('srcset');
    image.removeAttribute('href');
    image.removeAttribute('xlink:href');
    const local = localChapterResource(source);
    if (!local) { image.remove(); continue; }
    let zipPath = '';
    try { zipPath = resolvePath(chapterDir, local); } catch { zipPath = ''; }
    const ext = zipPath.split('.').pop()?.toLowerCase() || '';
    if (!MIME[ext] || !hasEntry(zipPath)) { image.remove(); continue; }
    const attribute = chapterElementName(image) === 'image' ? 'href' : 'src';
    image.setAttribute(attribute, `libimg:${images.length}`);
    images.push({ zipPath, ext, attribute });
  }

  for (const element of [...body.querySelectorAll('*')]) {
    const tag = chapterElementName(element);
    for (const attribute of [...element.attributes]) {
      const name = String(attribute.name || '').toLowerCase();
      const value = String(attribute.value || '');
      if (name.startsWith('on') || name === 'style' || name === 'srcset'
          || name === 'xmlns' || name.startsWith('xmlns:')) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (REQUEST_ATTRIBUTES.has(name)) {
        const isMaterializedImage = (tag === 'img' && name === 'src' || tag === 'image' && name === 'href')
          && /^libimg:\d+$/.test(value);
        const isLocalFragment = tag === 'a' && name === 'href' && /^#[^\s]*$/.test(value);
        if (!isMaterializedImage && !isLocalFragment) element.removeAttribute(attribute.name);
        continue;
      }
      if (REMOTE_OR_ACTIVE_VALUE.test(value)) element.removeAttribute(attribute.name);
    }
  }

  return { html: body.innerHTML, images };
}

/**
 * Chapter residency controller shared by native EPUB and the cache adapter.
 *
 * A chapter id is a logical slot; `ownerKey` identifies one concrete async
 * materialization attempt.  Keeping those identities separate is essential:
 * an invalidated request may settle after a replacement request has started,
 * and must only revoke its own URLs.
 */
export function makeOwnedChapterLoader({
  loadRaw,
  getBytes,
  materializer = makeImageMaterializer(),
  imageLimits = EPUB_CHAPTER_IMAGE_LIMITS,
}) {
  if (typeof loadRaw !== 'function' || typeof getBytes !== 'function') {
    throw new Error('chapter loader requires loadRaw/getBytes');
  }

  const defaultLeaseOwner = Symbol('library-chapter-default-owner');
  const chapCache = new Map(); // chapter id -> { value, ownerKey, owners }
  const pending = new Map(); // chapter id -> { promise, ownerKey, owners }
  const ownerEpoch = new Map();
  let generation = 0;
  let requestSerial = 0;
  let disposed = false;

  const epochOf = id => ownerEpoch.get(id) || 0;
  const invalidate = (id) => {
    ownerEpoch.set(id, epochOf(id) + 1);
    const cached = chapCache.get(id);
    if (cached) materializer.releaseOwner(cached.ownerKey);
    chapCache.delete(id);
    const inflight = pending.get(id);
    if (inflight) materializer.releaseOwner(inflight.ownerKey);
    pending.delete(id);
  };

  const leaseOf = owner => owner == null ? defaultLeaseOwner : owner;

  const loadChapter = (item, owner = null) => {
    const id = item?.id;
    if (disposed || id == null) return Promise.resolve(null);
    const leaseOwner = leaseOf(owner);
    const cached = chapCache.get(id);
    if (cached) {
      cached.owners.add(leaseOwner);
      return Promise.resolve(cached.value);
    }
    const inflight = pending.get(id);
    if (inflight) {
      inflight.owners.add(leaseOwner);
      return inflight.promise;
    }

    const requestGeneration = generation;
    const requestEpoch = epochOf(id);
    const ownerKey = `chapter:${requestGeneration}:${++requestSerial}:${String(id)}`;
    const leaseOwners = new Set([leaseOwner]);
    const isCurrent = () => (
      !disposed
      && generation === requestGeneration
      && epochOf(id) === requestEpoch
      && pending.get(id)?.ownerKey === ownerKey
    );

    const promise = (async () => {
      const rawCh = await loadRaw(item);
      if (!isCurrent()) return null;
      const html = await materialize(
        rawCh,
        getBytes,
        (ext, bytes) => materializer.toUrl(ext, bytes, ownerKey),
        { isAlive: isCurrent, limits: imageLimits },
      );
      if (!isCurrent() || html == null) return null;
      const value = { id, title: '', html };
      chapCache.set(id, { value, ownerKey, owners: new Set(leaseOwners) });
      return value;
    })().catch((error) => {
      if (!isCurrent()) return null;
      throw error;
    }).finally(() => {
      if (pending.get(id)?.ownerKey === ownerKey) pending.delete(id);
      if (chapCache.get(id)?.ownerKey !== ownerKey) materializer.releaseOwner(ownerKey);
    });

    pending.set(id, { promise, ownerKey, owners: leaseOwners });
    return promise;
  };

  const unloadOutside = (keep, owner) => {
    const ids = keep instanceof Set ? keep : new Set(keep || []);
    const owned = new Set([...chapCache.keys(), ...pending.keys()]);
    // Legacy callers omit owner and intentionally retain the original global
    // convergence semantics. Virtual viewports pass a concrete token: their
    // retirement may release only their own lease and can never revoke a
    // replacement viewport's cached HTML/blob owner.
    if (owner == null) {
      for (const id of owned) if (!ids.has(id)) invalidate(id);
      return;
    }
    const leaseOwner = leaseOf(owner);
    for (const id of owned) {
      if (ids.has(id)) continue;
      const cached = chapCache.get(id);
      const inflight = pending.get(id);
      cached?.owners?.delete(leaseOwner);
      inflight?.owners?.delete(leaseOwner);
      if (!(cached?.owners?.size || inflight?.owners?.size)) invalidate(id);
    }
  };

  const releaseOwner = owner => {
    if (owner != null) unloadOutside(new Set(), owner);
  };

  const unloadAll = () => {
    if (disposed) return;
    disposed = true;
    generation++;
    const owned = new Set([...chapCache.keys(), ...pending.keys()]);
    for (const id of owned) invalidate(id);
    chapCache.clear();
    pending.clear();
    materializer.unloadAll();
  };

  return {
    loadChapter,
    unloadOutside,
    releaseOwner,
    unloadAll,
    loadedCount: () => chapCache.size,
    pendingCount: () => pending.size,
    liveImageCount: () => materializer.liveCount(),
  };
}

export async function parseEpub(buffer) {
  assertZipEntryCount(buffer, { maxEntries: MAX_EPUB_ARCHIVE_ENTRIES, label: 'EPUB' });
  const zip = await JSZip.loadAsync(buffer);
  assertLoadedZipEntryCount(zip, { maxEntries: MAX_EPUB_ARCHIVE_ENTRIES, label: 'EPUB' });
  // 1. container.xml → OPF 路径
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('不是合法的 epub（缺少 container.xml）');
  const containerXml = await readZipEntryBounded(containerFile, 'text', {
    maxBytes: EPUB_ENTRY_LIMITS.container, label: 'EPUB container.xml',
  });
  const opfPath = /full-path="([^"]+)"/.exec(containerXml)?.[1];
  if (!opfPath) throw new Error('不是合法的 epub（缺少 OPF 路径）');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  // 2. OPF：元数据 + manifest + spine
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error('不是合法的 epub（缺少 OPF 文件）');
  const opfText = await readZipEntryBounded(opfFile, 'text', {
    maxBytes: EPUB_ENTRY_LIMITS.package, label: 'EPUB OPF',
  });
  const opf = new DOMParser().parseFromString(opfText, 'application/xml');
  const pick = (name) => byNS(opf, name)[0]?.textContent?.trim() || '';
  const title = pick('title') || '未命名书籍';
  const author = pick('creator') || '';

  const manifest = new Map(); // id -> {href, type}
  for (const item of byNS(opf, 'item')) {
    manifest.set(item.getAttribute('id'), {
      href: item.getAttribute('href'),
      type: item.getAttribute('media-type') || '',
    });
  }
  const spine = [];
  for (const ref of byNS(opf, 'itemref')) {
    const id = ref.getAttribute('idref');
    if (manifest.has(id)) spine.push({ id, ...manifest.get(id) });
  }

  // 3. 目录（优先 NCX，其次 NAV）
  let toc = [];
  const ncxItem = [...manifest.values()].find(m => m.type.includes('dtbncx') || /\.ncx$/i.test(m.href));
  if (ncxItem) {
    try {
      const ncxText = await readZipEntryBounded(zip.file(resolvePath(opfDir, ncxItem.href)), 'text', {
        maxBytes: EPUB_ENTRY_LIMITS.navigation, label: 'EPUB NCX',
      });
      const ncx = new DOMParser().parseFromString(ncxText, 'application/xml');
      for (const np of byNS(ncx, 'navPoint')) {
        const label = byNS(np, 'text')[0]?.textContent?.trim();
        const src = byNS(np, 'content')[0]?.getAttribute('src');
        if (label && src) toc.push({ label, href: src.split('#')[0] });
      }
    } catch {}
  }
  if (!toc.length) {
    const navItem = [...manifest.values()].find(m => /nav\.x?html?$/i.test(m.href));
    if (navItem) {
      try {
        const navText = await readZipEntryBounded(zip.file(resolvePath(opfDir, navItem.href)), 'text', {
          maxBytes: EPUB_ENTRY_LIMITS.navigation, label: 'EPUB NAV',
        });
        const nav = new DOMParser().parseFromString(navText, 'application/xhtml+xml');
        for (const a of nav.querySelectorAll('nav a')) {
          const href = a.getAttribute('href');
          if (href && a.textContent.trim()) toc.push({ label: a.textContent.trim(), href: href.split('#')[0] });
        }
      } catch {}
    }
  }

  // 4. 章节两段式：raw（sanitize + 占位符，可入缓存）→ materialize（占位符换真 URL）
  const readZipBytes = async (zipPath, { maxBytes = EPUB_ENTRY_LIMITS.image } = {}) => {
    const f = zip.file(zipPath);
    return readZipEntryBounded(f, 'uint8array', { maxBytes, label: `EPUB resource ${zipPath}` });
  };
  async function loadChapterRaw(item, { maxBytes = EPUB_ENTRY_LIMITS.chapter } = {}) {
    const path = resolvePath(opfDir, item.href);
    const f = zip.file(path);
    if (!f) return { id: item.id, html: '<p>（章节缺失）</p>', images: [] };
    const raw = await readZipEntryBounded(f, 'text', { maxBytes, label: `EPUB chapter ${path}` });
    const doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
    const body = doc.querySelector('body') || doc.documentElement;
    const sanitized = sanitizeEpubChapterBody(body, {
      chapterPath: path,
      hasEntry: zipPath => !!zip.file(zipPath),
    });
    return { id: item.id, ...sanitized };
  }

  const mat = makeImageMaterializer();
  const chapters = makeOwnedChapterLoader({
    loadRaw: loadChapterRaw,
    // materialize 的 getBytes 收的是 im 对象（非裸路径——契约实锤签名错位：裸传 readZipBytes 必然 null）
    getBytes: (im) => readZipBytes(im.zipPath),
    materializer: mat,
  });

  // 封面（读取 bytes 也走材料化纪律）
  let cover = null;
  let coverId = '';
  for (const m of byNS(opf, 'meta')) if (m.getAttribute('name') === 'cover') coverId = m.getAttribute('content');
  const coverItem = (coverId && manifest.get(coverId)) || [...manifest.values()].find(m => m.type.startsWith('image/'));
  let coverRaw = null;
  if (coverItem) {
    coverRaw = { zipPath: resolvePath(opfDir, coverItem.href), ext: coverItem.href.split('.').pop().toLowerCase() };
    try {
      const bytes = await readZipBytes(coverRaw.zipPath, { maxBytes: EPUB_ENTRY_LIMITS.cover });
      if (bytes) cover = mat.toUrl(coverRaw.ext, bytes, '__cover__');
    } catch (error) {
      if (error?.code !== 'LIBRARY_ZIP_ENTRY_TOO_LARGE') throw error;
      coverRaw = null;
    }
  }

  return {
    title, author, cover, coverRaw, spine, toc, loadChapter: chapters.loadChapter, loadChapterRaw, readZipBytes,
    unloadOutside: chapters.unloadOutside, unloadAll: chapters.unloadAll,
    loadedCount: chapters.loadedCount,
    pendingCount: chapters.pendingCount,
    liveImageCount: chapters.liveImageCount,
    zip,
  };
}

/** 章节 HTML → 粗 Markdown（导出笔记用） */
export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const out = [];
  const walk = (el, depth = 0) => {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) { // TEXT_NODE
        const t = node.textContent.replace(/\s+/g, ' ');
        if (t.trim()) out.push({ depth, text: t, type: 'text' });
        continue;
      }
      if (node.nodeType !== 1) continue; // ELEMENT_NODE
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) out.push({ depth: 0, text: '#'.repeat(+tag[1]) + ' ' + node.textContent.trim(), type: 'raw' });
      else if (tag === 'li') out.push({ depth, text: '- ' + node.textContent.trim().replace(/\s+/g, ' '), type: 'raw' });
      else if (tag === 'img') out.push({ depth, text: `![图](${node.getAttribute('src') || ''})`, type: 'raw' });
      else if (tag === 'blockquote') { const before = out.length; walk(node, depth); for (let i = before; i < out.length; i++) out[i].text = '> ' + out[i].text; }
      else walk(node, depth);
    }
  };
  walk(doc.body.firstChild);
  // 合并：raw 独占行；text 按段落连写
  const lines = [];
  let para = '';
  for (const item of out) {
    if (item.type === 'raw') {
      if (para.trim()) { lines.push(para.trim()); para = ''; }
      lines.push(item.text);
    } else {
      para += item.text;
    }
  }
  if (para.trim()) lines.push(para.trim());
  return lines.filter(l => l.trim()).join('\n\n');
}
