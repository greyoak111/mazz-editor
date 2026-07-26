// renderer/modules/library/cache.js —— 书库预处理缓存（koodo cache-zip 净室复刻）：
// 一次解析后把「sanitize 后章节 + 二进制图片 + 元数据」重打包为 cache zip，
// 之后开书零解析零编码直读——大开销只疼第一次，重开即开。
import JSZip from 'jszip';
import { materialize, makeImageMaterializer } from './epub.js';
import { wsPath } from '../../lib/ws-path.js';

const CACHE_V = 1; // 格式版本：结构变动即自 invalidate
const dirOf = async () => {
  const dir = await wsPath('/书库/.cache');
  await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
  return dir;
};
const zipPathOf = async (bookId) => `${await dirOf()}/${bookId}.zip`;

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
export async function writeBookCache(bookId, stat, epub) {
  if (!bookId || !epub?.loadChapterRaw) return false;
  const zip = new JSZip();
  const raws = await Promise.all(epub.spine.map((item) => epub.loadChapterRaw(item)));
  for (let i = 0; i < raws.length; i++) {
    zip.file(`chapters/${i}.html`, raws[i].html);
    for (let j = 0; j < raws[i].images.length; j++) {
      const im = raws[i].images[j];
      const bytes = await epub.readZipBytes(im.zipPath);
      if (bytes) zip.file(`imgs/${i}/${j}.${im.ext}`, bytes);
    }
  }
  if (epub.coverRaw) {
    const bytes = await epub.readZipBytes(epub.coverRaw.zipPath);
    if (bytes) zip.file(`imgs/cover.${epub.coverRaw.ext}`, bytes);
  }
  zip.file('meta.json', JSON.stringify({
    v: CACHE_V, srcSize: stat?.size || 0, srcMtime: stat?.mtime || 0,
    title: epub.title, author: epub.author, toc: epub.toc,
    spine: epub.spine.map((s) => ({ id: s.id, href: s.href, type: s.type })),
    coverExt: epub.coverRaw?.ext || null,
  }));
  const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  await window.mazz.invoke('fs:writeFileBase64', { path: await zipPathOf(bookId), base64: b64Of(buf) });
  return true;
}

/**
 * 读缓存：校验通过则重建 epub 同构对象（loadChapter/loadChapterRaw/unloadAll 全接口），
 * 任何不匹配（版本/体积/mtime）返回 null 回退全量解析
 */
export async function readBookCache(bookId, stat) {
  if (!bookId || !stat) return null;
  const path = await zipPathOf(bookId);
  const st = await window.mazz.invoke('fs:stat', { path }).catch(() => null);
  if (!st?.exists) return null;
  let zip;
  try {
    const b64 = await window.mazz.invoke('fs:readFileBase64', { path });
    zip = await JSZip.loadAsync(bytesOf(b64));
  } catch { return null; }
  const metaFile = zip.file('meta.json');
  if (!metaFile) return null;
  let meta;
  try { meta = JSON.parse(await metaFile.async('text')); } catch { return null; }
  if (meta.v !== CACHE_V || meta.srcSize !== stat.size || meta.srcMtime !== stat.mtime) return null;

  const readCacheBytes = async (p) => { const f = zip.file(p); return f ? f.async('uint8array') : null; };
  const mat = makeImageMaterializer();
  const chapCache = new Map();
  const rawOf = async (i) => {
    const f = zip.file(`chapters/${i}.html`);
    if (!f) return { id: meta.spine[i].id, html: '<p>（章节缺失）</p>', images: [] };
    const html = await f.async('text');
    // 以 zip 目录扫描重建 images（下标=占位符序号，materialize 按序回替）
    const images = [];
    zip.forEach((rel) => {
      const mm = new RegExp(`^imgs/${i}/(\\d+)\\.([a-z0-9]+)$`).exec(rel);
      if (mm) images[+mm[1]] = { zipPath: rel, ext: mm[2] };
    });
    for (let j = 0; j < images.length; j++) if (!images[j]) images[j] = null; // 空洞补 null（materialize 跳过）
    return { id: meta.spine[i].id, html, images };
  };
  const loadChapter = async (item) => {
    if (chapCache.has(item.id)) return chapCache.get(item.id);
    const i = meta.spine.findIndex((s) => s.id === item.id);
    const rawCh = i >= 0 ? await rawOf(i) : { id: item.id, html: '<p>（章节缺失）</p>', images: [] };
    // rawOf 的 images 顺序即占位符顺序（imgs 数组按下标放置）
    const html = await materialize(rawCh, (im) => readCacheBytes(im.zipPath), mat.toUrl);
    const out = { id: item.id, title: '', html };
    chapCache.set(item.id, out);
    return out;
  };
  const loadChapterRaw = async (item) => {
    const i = meta.spine.findIndex((s) => s.id === item.id);
    return i >= 0 ? rawOf(i) : { id: item.id, html: '<p>（章节缺失）</p>', images: [] };
  };
  // 封面实体化
  let cover = null;
  if (meta.coverExt) {
    const bytes = await readCacheBytes(`imgs/cover.${meta.coverExt}`);
    if (bytes) cover = mat.toUrl(meta.coverExt, bytes);
  }
  return {
    title: meta.title, author: meta.author, cover,
    coverRaw: meta.coverExt ? { zipPath: `imgs/cover.${meta.coverExt}`, ext: meta.coverExt } : null,
    spine: meta.spine, toc: meta.toc,
    loadChapter, loadChapterRaw, readZipBytes: readCacheBytes,
    unloadAll: () => { mat.unloadAll(); chapCache.clear(); },
    _fromCache: true,
  };
}
