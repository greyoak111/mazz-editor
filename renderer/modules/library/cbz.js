// renderer/modules/library/cbz.js —— CBZ 漫画解析：zip 图片包 → 排序页面（blob URL + 翻页 revoke 内存纪律）
import JSZip from 'jszip';
import { imageBytesToDataUrl } from './mobi.js';

const IMG_RE = /\.(jpe?g|png|webp|gif)$/i;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

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
  const cache = new Map(); // idx → url（blob 或 dataURL）
  const loadPage = async (i) => {
    if (cache.has(i)) return cache.get(i);
    const { mime, bytes } = await getBlob(i);
    const url = canBlob() ? URL.createObjectURL(new Blob([bytes], { type: mime })) : imageBytesToDataUrl(mime, bytes);
    cache.set(i, url);
    return url;
  };
  const release = (i) => {
    const u = cache.get(i);
    if (u && u.startsWith('blob:')) URL.revokeObjectURL(u);
    cache.delete(i);
  };
  const unloadOutside = (keep) => { for (const i of [...cache.keys()]) if (!keep.has(i)) release(i); };
  const unloadAll = () => unloadOutside(new Set());
  return { count: list.length, loadPage, unloadOutside, unloadAll, cachedCount: () => cache.size };
}

export async function parseCbz(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && IMG_RE.test(n)).sort(naturalSort);
  if (!names.length) throw new Error('cbz 中没有图片');
  const pager = makeBytesPager(names, async (i) => {
    const name = names[i];
    const ext = name.split('.').pop().toLowerCase();
    const bytes = await zip.file(name).async('uint8array');
    return { mime: MIME[ext] || 'image/jpeg', bytes };
  });
  return { ...pager, names, title: '漫画' };
}
