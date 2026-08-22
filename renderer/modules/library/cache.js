// renderer/modules/library/cache.js —— 书库预处理缓存（koodo cache-zip 净室复刻）：
// 一次解析后把「sanitize 后章节 + 二进制图片 + 元数据」重打包为 cache zip，
// 之后开书零解析零编码直读——大开销只疼第一次，重开即开。
import JSZip from 'jszip';
import {
  MAX_EPUB_ARCHIVE_ENTRIES,
  assertLoadedZipEntryCount,
  assertZipEntryCount,
  makeImageMaterializer,
  makeOwnedChapterLoader,
  readZipEntryBounded,
} from './epub.js';

const CACHE_V = 1; // 格式版本：结构变动即自 invalidate
const MAX_BACKGROUND_SOURCE = 32 * 1024 * 1024;
const MAX_BACKGROUND_SECTIONS = 80;
// A small compressed EPUB may expand by orders of magnitude. Keep the writer
// below a deterministic memory envelope before JSZip receives each item.
const MAX_CACHE_TEXT_ITEM_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BINARY_ITEM_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_UNCOMPRESSED_BYTES = 96 * 1024 * 1024;
// Cache archives are renderer-owned ZIPs and therefore travel through the same
// base64 IPC path as source books.  A corrupt/stale cache must not bypass the
// source archive cap and allocate an unbounded string before JSZip can reject
// an entry.  Keep a little envelope above the writer's uncompressed budget for
// ZIP metadata while remaining no larger than the supported source archive.
const MAX_CACHE_ARCHIVE_BYTES = 128 * 1024 * 1024;

function utf8ByteLength(value) {
  const text = String(value ?? '');
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
        && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (bytes > MAX_CACHE_TEXT_ITEM_BYTES) return bytes;
  }
  return bytes;
}

function createCacheBudget(limit = MAX_CACHE_UNCOMPRESSED_BYTES) {
  let used = 0;
  return {
    reserve(size, itemLimit) {
      const bytes = Number(size);
      if (!Number.isFinite(bytes) || bytes < 0 || bytes > itemLimit) return false;
      if (used + bytes > limit) return false;
      used += bytes;
      return true;
    },
    get used() { return used; },
    get limit() { return limit; },
  };
}

const normalizedWorkspace = (value) => {
  const root = String(value || '/workspace').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return root || '/workspace';
};

async function captureCacheContext({ workspace, invoke } = {}) {
  const fallback = globalThis.window?.mazz?.invoke;
  const call = typeof invoke === 'function'
    ? invoke
    : (typeof fallback === 'function' ? fallback.bind(globalThis.window.mazz) : null);
  if (!call) throw new Error('library cache requires an invoke function');
  // Capture once, before chapter/image awaits. Never ask wsPath/wsRoot again:
  // those globals may already belong to a different workspace/tab generation.
  const capturedWorkspace = workspace != null ? workspace : await call('workspace:get');
  return Object.freeze({ invoke: call, workspace: normalizedWorkspace(capturedWorkspace) });
}

const dirOf = async (context) => {
  const dir = `${context.workspace}/书库/.cache`;
  await context.invoke('fs:mkdir', { path: dir }).catch(() => {});
  return dir;
};
const zipPathOf = async (context, bookId) => `${await dirOf(context)}/${bookId}.zip`;

const b64Of = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
const bytesOf = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * 写缓存（首开后台异步）：epub 对象 + 全章 raw（占位符形态）→ cache zip
 * @param epub parseEpub 产物（带 loadChapterRaw/readZipBytes）
 * @param stat 源文件 {size, mtime}（失效校验用）
 */
export async function writeBookCache(bookId, stat, epub, {
  isAlive = () => true,
  workspace,
  invoke,
} = {}) {
  if (!bookId || !epub?.loadChapterRaw) return false;
  const context = await captureCacheContext({ workspace, invoke });
  // 旧实现 Promise.all 全章 + JSZip 全量驻留；大书会与阅读首屏争内存。
  // 流式 cache writer 落地前，大书明确跳过后台二次打包，阅读主链优先。
  if ((stat?.size || 0) > MAX_BACKGROUND_SOURCE || epub.spine.length > MAX_BACKGROUND_SECTIONS) return false;
  const zip = new JSZip();
  const budget = createCacheBudget();
  for (let i = 0; i < epub.spine.length; i++) {
    if (!isAlive()) return false;
    const raw = await epub.loadChapterRaw(epub.spine[i], { maxBytes: MAX_CACHE_TEXT_ITEM_BYTES });
    if (!isAlive()) return false;
    const chapterHtml = String(raw?.html ?? '');
    if (!budget.reserve(utf8ByteLength(chapterHtml), MAX_CACHE_TEXT_ITEM_BYTES)) return false;
    zip.file(`chapters/${i}.html`, chapterHtml);
    for (let j = 0; j < (raw?.images?.length || 0); j++) {
      if (!isAlive()) return false;
      const im = raw.images[j];
      if (!im?.zipPath) continue;
      const bytes = await epub.readZipBytes(im.zipPath, { maxBytes: MAX_CACHE_BINARY_ITEM_BYTES });
      if (bytes) {
        if (!budget.reserve(bytes.byteLength ?? bytes.length, MAX_CACHE_BINARY_ITEM_BYTES)) return false;
        zip.file(`imgs/${i}/${j}.${im.ext}`, bytes);
      }
    }
  }
  if (epub.coverRaw) {
    const bytes = await epub.readZipBytes(epub.coverRaw.zipPath, { maxBytes: MAX_CACHE_BINARY_ITEM_BYTES });
    if (bytes) {
      if (!budget.reserve(bytes.byteLength ?? bytes.length, MAX_CACHE_BINARY_ITEM_BYTES)) return false;
      zip.file(`imgs/cover.${epub.coverRaw.ext}`, bytes);
    }
  }
  const metaJson = JSON.stringify({
    v: CACHE_V, srcSize: stat?.size || 0, srcMtime: stat?.mtime || 0,
    title: epub.title, author: epub.author, toc: epub.toc,
    spine: epub.spine.map((s) => ({ id: s.id, href: s.href, type: s.type })),
    coverExt: epub.coverRaw?.ext || null,
  });
  if (!budget.reserve(utf8ByteLength(metaJson), MAX_CACHE_TEXT_ITEM_BYTES)) return false;
  zip.file('meta.json', metaJson);
  if (!isAlive()) return false;
  const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  if (!isAlive()) return false;
  await context.invoke('fs:writeFileBase64', { path: await zipPathOf(context, bookId), base64: b64Of(buf) });
  return true;
}

/**
 * 读缓存：校验通过则重建 epub 同构对象（loadChapter/loadChapterRaw/unloadAll 全接口），
 * 任何不匹配（版本/体积/mtime）返回 null 回退全量解析
 */
export async function readBookCache(bookId, stat, { workspace, invoke } = {}) {
  if (!bookId || !stat) return null;
  const context = await captureCacheContext({ workspace, invoke });
  const path = await zipPathOf(context, bookId);
  const st = await context.invoke('fs:stat', { path }).catch(() => null);
  if (!st?.exists) return null;
  const archiveBytes = Number(st.size);
  if (Number.isFinite(archiveBytes) && archiveBytes > MAX_CACHE_ARCHIVE_BYTES) return null;
  let zip;
  try {
    const b64 = await context.invoke('fs:readFileBase64', {
      path,
      maxBytes: MAX_CACHE_ARCHIVE_BYTES,
    });
    const bytes = bytesOf(b64);
    assertZipEntryCount(bytes, {
      maxEntries: MAX_EPUB_ARCHIVE_ENTRIES,
      label: 'Library cache',
    });
    zip = await JSZip.loadAsync(bytes);
    assertLoadedZipEntryCount(zip, {
      maxEntries: MAX_EPUB_ARCHIVE_ENTRIES,
      label: 'Library cache',
    });
  } catch { return null; }
  const metaFile = zip.file('meta.json');
  if (!metaFile) return null;
  let meta;
  try {
    meta = JSON.parse(await readZipEntryBounded(metaFile, 'text', {
      maxBytes: MAX_CACHE_TEXT_ITEM_BYTES, label: 'Library cache metadata',
    }));
  } catch { return null; }
  if (meta.v !== CACHE_V || meta.srcSize !== stat.size || meta.srcMtime !== stat.mtime) return null;

  const readCacheBytes = async (p, { maxBytes = MAX_CACHE_BINARY_ITEM_BYTES } = {}) => {
    const f = zip.file(p);
    return readZipEntryBounded(f, 'uint8array', { maxBytes, label: `Library cache resource ${p}` });
  };
  const mat = makeImageMaterializer();
  const rawOf = async (i, { maxBytes = MAX_CACHE_TEXT_ITEM_BYTES } = {}) => {
    const f = zip.file(`chapters/${i}.html`);
    if (!f) return { id: meta.spine[i].id, html: '<p>（章节缺失）</p>', images: [] };
    const html = await readZipEntryBounded(f, 'text', {
      maxBytes, label: `Library cache chapter ${i}`,
    });
    // 以 zip 目录扫描重建 images（下标=占位符序号，materialize 按序回替）
    const images = [];
    zip.forEach((rel) => {
      const mm = new RegExp(`^imgs/${i}/(\\d+)\\.([a-z0-9]+)$`).exec(rel);
      if (mm) images[+mm[1]] = { zipPath: rel, ext: mm[2] };
    });
    for (let j = 0; j < images.length; j++) if (!images[j]) images[j] = null; // 空洞补 null（materialize 跳过）
    return { id: meta.spine[i].id, html, images };
  };
  const loadChapterRaw = async (item, options) => {
    const i = meta.spine.findIndex((s) => s.id === item.id);
    return i >= 0 ? rawOf(i, options) : { id: item.id, html: '<p>（章节缺失）</p>', images: [] };
  };
  const chapters = makeOwnedChapterLoader({
    loadRaw: loadChapterRaw,
    // rawOf 的 images 顺序即占位符顺序（imgs 数组按下标放置）
    getBytes: (im) => readCacheBytes(im.zipPath),
    materializer: mat,
  });
  // 封面实体化
  let cover = null;
  if (meta.coverExt) {
    const bytes = await readCacheBytes(`imgs/cover.${meta.coverExt}`);
    if (bytes) cover = mat.toUrl(meta.coverExt, bytes, '__cover__');
  }
  return {
    title: meta.title, author: meta.author, cover,
    coverRaw: meta.coverExt ? { zipPath: `imgs/cover.${meta.coverExt}`, ext: meta.coverExt } : null,
    spine: meta.spine, toc: meta.toc,
    loadChapter: chapters.loadChapter, loadChapterRaw, readZipBytes: readCacheBytes,
    unloadOutside: chapters.unloadOutside,
    releaseOwner: chapters.releaseOwner,
    unloadAll: chapters.unloadAll,
    loadedCount: chapters.loadedCount,
    pendingCount: chapters.pendingCount,
    liveImageCount: chapters.liveImageCount,
    _fromCache: true,
  };
}

export const _forTests = {
  MAX_BACKGROUND_SOURCE,
  MAX_BACKGROUND_SECTIONS,
  MAX_CACHE_TEXT_ITEM_BYTES,
  MAX_CACHE_BINARY_ITEM_BYTES,
  MAX_CACHE_UNCOMPRESSED_BYTES,
  MAX_CACHE_ARCHIVE_BYTES,
  utf8ByteLength,
  createCacheBudget,
};
