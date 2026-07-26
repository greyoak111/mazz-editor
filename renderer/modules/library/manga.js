// renderer/modules/library/manga.js —— 文件夹漫画：一个文件夹 = 一本书；子文件夹 = 一话
// 借鉴 NanaView：图片序列串成长条，一话=一个图片文件夹
const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']);

/** 自然排序（数字按数值比较：p1 < p2 < p10） */
export function naturalSort(a, b) {
  const ax = a.match(/\d+|\D+/g) || [a], bx = b.match(/\d+|\D+/g) || [b];
  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    if (ax[i] === undefined) return -1;
    if (bx[i] === undefined) return 1;
    const an = /^\d+$/.test(ax[i]) ? +ax[i] : NaN, bn = /^\d+$/.test(bx[i]) ? +bx[i] : NaN;
    if (!isNaN(an) && !isNaN(bn)) { if (an !== bn) return an - bn; continue; }
    const c = String(ax[i]).localeCompare(String(bx[i]), 'zh-CN');
    if (c) return c;
  }
  return 0;
}

async function listImages(dir) {
  const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
  return entries.filter(e => !e.isDir && IMG_EXTS.has(e.name.split('.').pop().toLowerCase()))
    .map(e => e.path).sort(naturalSort);
}

/**
 * 解析漫画文件夹 → { title, chapters: [{name, pages: [path...]}] }
 * 结构：文件夹下全是图片 = 一话；含图片子文件夹 = 每个子文件夹一话；两者都有时根目录图片作「正篇」在前
 */
export async function buildMangaBook(dir) {
  const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
  if (!entries.length) throw new Error('文件夹为空或不可读');
  const title = dir.replace(/\\/g, '/').split('/').pop();
  const chapters = [];
  const rootPages = await listImages(dir);
  if (rootPages.length) chapters.push({ name: '正篇', pages: rootPages });
  const subDirs = entries.filter(e => e.isDir).map(e => e.path).sort(naturalSort);
  for (const sub of subDirs) {
    const pages = await listImages(sub);
    if (pages.length) chapters.push({ name: sub.replace(/\\/g, '/').split('/').pop(), pages });
  }
  if (!chapters.length) throw new Error('文件夹（含子文件夹）里没有图片');
  return { title, chapters };
}

/** 图片路径 → 可渲染 URL（Electron 走 file://；网页/移动端读 base64 建 Blob） */
export async function imageUrl(p) {
  if (window.mazz?.isElectron) return 'mazz-res://media/' + encodeURIComponent(p.replace(/\\/g, '/')); // 页面同源化：file:// 图片在非 file 页被拦
  const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p });
  const ext = p.split('.').pop().toLowerCase().replace('jpg', 'jpeg');
  return 'data:image/' + ext + ';base64,' + b64;
}
