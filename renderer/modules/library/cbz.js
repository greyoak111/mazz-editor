// renderer/modules/library/cbz.js —— CBZ 漫画解析：zip 图片包 → 排序页面
import JSZip from 'jszip';

const IMG_RE = /\.(jpe?g|png|webp|gif)$/i;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/** 自然排序（page2 < page10） */
function naturalSort(a, b) {
  return a.replace(/(\d+)/g, m => m.padStart(8, '0')).localeCompare(b.replace(/(\d+)/g, m => m.padStart(8, '0')));
}

export async function parseCbz(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && IMG_RE.test(n)).sort(naturalSort);
  if (!names.length) throw new Error('cbz 中没有图片');
  const loadPage = async (i) => {
    const name = names[i];
    const ext = name.split('.').pop().toLowerCase();
    const b64 = await zip.file(name).async('base64');
    return `data:${MIME[ext]};base64,${b64}`;
  };
  return { count: names.length, names, loadPage, title: '漫画' };
}
