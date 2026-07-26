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
const canBlob = () => typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
const bytesToB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};

/** 共享加工器：blob URL 登记 + 环境回退（缓存与原生两条路径同一套纪律） */
export function makeImageMaterializer() {
  const urls = new Set();
  const toUrl = (ext, bytes) => {
    if (canBlob()) {
      const u = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] || 'image/jpeg' }));
      urls.add(u);
      return u;
    }
    return `data:${MIME[ext] || 'image/jpeg'};base64,${bytesToB64(bytes)}`;
  };
  const unloadAll = () => { for (const u of urls) URL.revokeObjectURL(u); urls.clear(); };
  return { toUrl, unloadAll, liveCount: () => urls.size };
}

/** 占位符章节 → 可渲染 HTML（libimg:N 换真 URL） */
export async function materialize(rawCh, getBytes, toUrl) {
  if (!rawCh.images?.length) return rawCh.html;
  let html = rawCh.html;
  for (let i = 0; i < rawCh.images.length; i++) {
    const im = rawCh.images[i];
    if (!im) continue; // 缓存空洞（图片缺失）保留占位由上层自然隐藏
    const bytes = await getBytes(im);
    if (!bytes) continue;
    html = html.replaceAll(`src="libimg:${i}"`, `src="${toUrl(im.ext, bytes)}"`);
  }
  return html;
}

export async function parseEpub(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  // 1. container.xml → OPF 路径
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('不是合法的 epub（缺少 container.xml）');
  const containerXml = await containerFile.async('text');
  const opfPath = /full-path="([^"]+)"/.exec(containerXml)?.[1];
  if (!opfPath) throw new Error('不是合法的 epub（缺少 OPF 路径）');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  // 2. OPF：元数据 + manifest + spine
  const opfText = await zip.file(opfPath).async('text');
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
      const ncxText = await zip.file(resolvePath(opfDir, ncxItem.href)).async('text');
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
        const navText = await zip.file(resolvePath(opfDir, navItem.href)).async('text');
        const nav = new DOMParser().parseFromString(navText, 'application/xhtml+xml');
        for (const a of nav.querySelectorAll('nav a')) {
          const href = a.getAttribute('href');
          if (href && a.textContent.trim()) toc.push({ label: a.textContent.trim(), href: href.split('#')[0] });
        }
      } catch {}
    }
  }

  // 4. 章节两段式：raw（sanitize + 占位符，可入缓存）→ materialize（占位符换真 URL）
  const readZipBytes = async (zipPath) => {
    const f = zip.file(zipPath);
    return f ? f.async('uint8array') : null;
  };
  async function loadChapterRaw(item) {
    const path = resolvePath(opfDir, item.href);
    const f = zip.file(path);
    if (!f) return { id: item.id, html: '<p>（章节缺失）</p>', images: [] };
    const raw = await f.async('text');
    const doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
    const body = doc.querySelector('body') || doc.documentElement;
    // 剥除危险/无效元素
    body.querySelectorAll('script, style, link, iframe, object, embed, form, input, button, select, textarea').forEach(el => el.remove());
    // 图片改占位符（实体化延迟到渲染前——内存纪律与缓存格式的公共形态）
    const chapDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const images = [];
    for (const img of body.querySelectorAll('img, image')) {
      const src = img.getAttribute('src') || img.getAttribute('xlink:href');
      if (!src || src.startsWith('data:')) continue;
      const zipPath = resolvePath(chapDir, src);
      const ext = zipPath.split('.').pop().toLowerCase();
      if (!MIME[ext] || !zip.file(zipPath)) { img.remove(); continue; }
      img.setAttribute('src', `libimg:${images.length}`);
      img.removeAttribute('xlink:href');
      images.push({ zipPath, ext });
    }
    return { id: item.id, html: body.innerHTML, images };
  }

  const mat = makeImageMaterializer();
  const chapCache = new Map(); // 章节实体化备忘（模式切换/字号重排不再回炉，blob URL 一会话一份）
  async function loadChapter(item) {
    if (chapCache.has(item.id)) return chapCache.get(item.id);
    const rawCh = await loadChapterRaw(item);
    // materialize 的 getBytes 收的是 im 对象（非裸路径——契约实锤签名错位：裸传 readZipBytes 必然 null）
    const html = await materialize(rawCh, (im) => readZipBytes(im.zipPath), mat.toUrl);
    const out = { id: item.id, title: '', html };
    chapCache.set(item.id, out);
    return out;
  }

  // 封面（读取 bytes 也走材料化纪律）
  let cover = null;
  let coverId = '';
  for (const m of byNS(opf, 'meta')) if (m.getAttribute('name') === 'cover') coverId = m.getAttribute('content');
  const coverItem = (coverId && manifest.get(coverId)) || [...manifest.values()].find(m => m.type.startsWith('image/'));
  let coverRaw = null;
  if (coverItem) {
    coverRaw = { zipPath: resolvePath(opfDir, coverItem.href), ext: coverItem.href.split('.').pop().toLowerCase() };
    const bytes = await readZipBytes(coverRaw.zipPath);
    if (bytes) cover = mat.toUrl(coverRaw.ext, bytes);
  }

  const unloadAll = () => { mat.unloadAll(); chapCache.clear(); };
  return { title, author, cover, coverRaw, spine, toc, loadChapter, loadChapterRaw, readZipBytes, unloadAll, zip };
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
