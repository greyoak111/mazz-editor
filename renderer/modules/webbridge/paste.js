// renderer/modules/webbridge/paste.js —— 粘贴注入（paste-html）：markdown→HTML + 本地图片 → File
// 核心：伪造一场"用户粘贴"——DataTransfer(text/html + files)，编辑器自己的 paste 管线接管
import { renderHelpMd } from '../../help/index.js';

/** markdown → HTML（帮助中心 mini 渲染器兜底：h1→h2 偏移、无链接，仅供非编辑器场景） */
export function mdToHtml(text) {
  return renderHelpMd(String(text || ''));
}

/** 首选：直接提取编辑器渲染好的 DOM（最标准 HTML——h1/strong/a/img 全规范，零新依赖） */
export function docToHtml(ctl) {
  const dom = ctl?.view?.dom;
  if (!dom) return '';
  const pm = dom.classList.contains('ProseMirror') ? dom : dom.querySelector('.ProseMirror');
  return (pm || dom).innerHTML;
}

/** 收集 HTML 中的本地图片（file:// 或工作区相对路径）→ [{placeholder, name, file}] */
export async function collectImages(html, { workspace } = {}) {
  const out = [];
  const re = /<img[^>]+src="([^"]+)"[^>]*>/g;
  let m, i = 0;
  const seen = new Map();
  for (const match of html.matchAll(re)) {
    const src = match[1];
    let path = null;
    if (src.startsWith('file://')) path = decodeURIComponent(src.slice(7));
    else if (src.startsWith('mazz-res://media/')) path = decodeURIComponent(src.slice('mazz-res://media/'.length)); // 页面同源化双前缀兼容
    else if (!/^https?:|^data:|^blob:/.test(src) && workspace) path = workspace + '/' + src.replace(/^\.\//, '');
    if (!path || seen.has(path)) continue;
    try {
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path });
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
      const name = path.split(/[\\/]/).pop();
      const ext = (name.split('.').pop() || 'png').toLowerCase().replace('jpg', 'jpeg');
      const file = new File([bytes], name, { type: `image/${ext}` });
      seen.set(path, { placeholder: `__WB_IMG_${i}__`, name, file, index: i });
      out.push(seen.get(path));
      i++;
    } catch { /* 读不到的图跳过（保留原 src） */ }
  }
  return out;
}

/** 用占位符替换 HTML 中的本地图片 src（编辑器 paste 时会把 files 上传并占位关联） */
export function placeholderize(html, images) {
  let out = html;
  const re = /<img[^>]+src="([^"]+)"[^>]*>/g;
  for (const img of images) {
    // 按序替换本地 src 为占位符（paste-files 模式下编辑器会按顺序匹配上传）
    out = out.replace(/(<img[^>]+src=")(file:\/\/[^"]+|[^"h][^"]*)(\")/, `$1${img.placeholder}$3`);
  }
  return out;
}

/** 生成粘贴注入脚本（在投稿页内执行）：DataTransfer + ClipboardEvent('paste') */
export function buildPasteScript({ title, html, images, adapter }) {
  const payload = JSON.stringify({ title, html, imageCount: images.length });
  const filesB64 = images.map(img => img.fileB64 || '');
  return `(async () => {
    const p = ${payload};
    const fileB64 = ${JSON.stringify(filesB64)};
    const titleSel = ${JSON.stringify(adapter.title || '')};
    if (titleSel) {
      const t = document.querySelector(titleSel);
      if (t) {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc?.set) desc.set.call(t, p.title); else t.value = p.title;
        t.dispatchEvent(new Event('input', { bubbles: true }));
        t.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const editorSel = ${JSON.stringify((adapter.editors || []).join(', '))};
    const el = document.querySelector(editorSel) || document.querySelector('[contenteditable="true"]');
    if (!el) return { ok: false, reason: 'editor-not-found' };
    el.focus();
    // 构造 DataTransfer：text/html + files（编辑器 paste 管线接管上传）
    const dt = new DataTransfer();
    dt.setData('text/html', p.html);
    dt.setData('text/plain', p.html.replace(/<[^>]+>/g, ''));
    for (const b64 of fileB64) {
      if (!b64) continue;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
      const name = ${JSON.stringify(images.map(i => i.name))}[fileB64.indexOf(b64)] || 'image.png';
      const ext = (name.split('.').pop() || 'png').toLowerCase().replace('jpg', 'jpeg');
      dt.items.add(new File([bytes], name, { type: 'image/' + ext }));
    }
    const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(evt);
    return { ok: true, via: 'paste', images: fileB64.filter(Boolean).length };
  })()`;
}
