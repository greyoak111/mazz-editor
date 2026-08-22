// renderer/modules/library/cbz.js —— CBZ 漫画解析：zip 图片包 → 排序页面（blob URL + 翻页 revoke 内存纪律）
import JSZip from 'jszip';
import { imageBytesToDataUrl } from './mobi.js';
import { assertLoadedZipEntryCount, assertZipEntryCount, readZipEntryBounded } from './epub.js';

const IMG_RE = /\.(jpe?g|png|webp|gif)$/i;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
export const MAX_CBZ_PAGE_BYTES = 64 * 1024 * 1024;
export const MAX_CBZ_ARCHIVE_ENTRIES = 20_000;

/** 自然排序（page2 < page10） */
function naturalSort(a, b) {
  return a.replace(/(\d+)/g, m => m.padStart(8, '0')).localeCompare(b.replace(/(\d+)/g, m => m.padStart(8, '0')));
}

/** blob URL 可用性（jsdom 契约环境无 createObjectURL → 回退 dataURL，契约断言 data: 前缀实锤） */
const canBlob = () => typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

/**
 * 通用图片页加载器：blob URL 优先 + 缓存 + unloadOutside 翻页释放（koodo 内存纪律——
 * 旧实现全图 dataURL 字符串驻留 DOM，几百 MB 的大漫画必胀爆；翻走的页立即 revoke，
 * 只留当前屏与前后邻页，DOM 里永不超个位数）
 */
export function makeBytesPager(list, getBlob) {
  const cache = new Map(); // idx → { url, ownerKey }
  const pending = new Map(); // idx → { promise, ownerKey }
  const ownerEpoch = new Map();
  let generation = 0;
  let requestSerial = 0;
  let disposed = false;

  const epochOf = i => ownerEpoch.get(i) || 0;
  const revoke = (entry) => {
    const url = entry?.url;
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  };
  const invalidate = (i) => {
    ownerEpoch.set(i, epochOf(i) + 1);
    revoke(cache.get(i));
    cache.delete(i);
    pending.delete(i);
  };

  const loadPage = (i) => {
    if (disposed || !Number.isInteger(i) || i < 0 || i >= list.length) return Promise.resolve(null);
    const cached = cache.get(i);
    if (cached) return Promise.resolve(cached.url);
    const inflight = pending.get(i);
    if (inflight) return inflight.promise;

    const requestGeneration = generation;
    const requestEpoch = epochOf(i);
    const ownerKey = `page:${requestGeneration}:${++requestSerial}:${i}`;
    const isCurrent = () => (
      !disposed
      && generation === requestGeneration
      && epochOf(i) === requestEpoch
      && pending.get(i)?.ownerKey === ownerKey
    );
    const promise = (async () => {
      const payload = await getBlob(i);
      if (!isCurrent() || !payload?.bytes) return null;
      const { mime, bytes } = payload;
      const url = canBlob()
        ? URL.createObjectURL(new Blob([bytes], { type: mime }))
        : imageBytesToDataUrl(mime, bytes);
      if (!isCurrent()) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        return null;
      }
      cache.set(i, { url, ownerKey });
      return url;
    })().catch((error) => {
      if (!isCurrent()) return null;
      throw error;
    }).finally(() => {
      if (pending.get(i)?.ownerKey === ownerKey) pending.delete(i);
    });
    pending.set(i, { promise, ownerKey });
    return promise;
  };
  const release = (i) => {
    invalidate(i);
  };
  const unloadOutside = (keep) => {
    const indices = keep instanceof Set ? keep : new Set(keep || []);
    const owned = new Set([...cache.keys(), ...pending.keys()]);
    for (const i of owned) if (!indices.has(i)) release(i);
  };
  const unloadAll = () => {
    if (disposed) return;
    disposed = true;
    generation++;
    const owned = new Set([...cache.keys(), ...pending.keys()]);
    for (const i of owned) release(i);
    cache.clear();
    pending.clear();
  };
  return {
    count: list.length,
    loadPage,
    readPage: (i, options) => getBlob(i, options),
    unloadOutside,
    unloadAll,
    cachedCount: () => cache.size,
    pendingCount: () => pending.size,
    liveCount: () => cache.size,
  };
}

export async function parseCbz(buffer) {
  assertZipEntryCount(buffer, { maxEntries: MAX_CBZ_ARCHIVE_ENTRIES, label: 'CBZ' });
  const zip = await JSZip.loadAsync(buffer);
  assertLoadedZipEntryCount(zip, { maxEntries: MAX_CBZ_ARCHIVE_ENTRIES, label: 'CBZ' });
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && IMG_RE.test(n)).sort(naturalSort);
  if (!names.length) throw new Error('cbz 中没有图片');
  const pager = makeBytesPager(names, async (i, { maxBytes = MAX_CBZ_PAGE_BYTES } = {}) => {
    const name = names[i];
    const ext = name.split('.').pop().toLowerCase();
    const bytes = await readZipEntryBounded(zip.file(name), 'uint8array', {
      maxBytes, label: `CBZ page ${name}`,
    });
    return { mime: MIME[ext] || 'image/jpeg', bytes };
  });
  return { ...pager, names, title: '漫画' };
}
