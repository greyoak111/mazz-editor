// renderer/modules/library/epub.js —— EPUB 解析器：zip → container → OPF → spine/目录 → 章节 HTML（资源 dataURL 化）
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

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

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

  // 4. 章节 HTML：sanitize + 图片 dataURL 化
  const loadAsset = async (href) => {
    const f = zip.file(href);
    if (!f) return null;
    const ext = href.split('.').pop().toLowerCase();
    if (!MIME[ext]) return null;
    const b64 = await f.async('base64');
    return `data:${MIME[ext]};base64,${b64}`;
  };

  async function loadChapter(item) {
    const path = resolvePath(opfDir, item.href);
    const f = zip.file(path);
    if (!f) return { id: item.id, title: '', html: '<p>（章节缺失）</p>' };
    const raw = await f.async('text');
    const doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
    const body = doc.querySelector('body') || doc.documentElement;
    // 剥除危险/无效元素
    body.querySelectorAll('script, style, link, iframe, object, embed, form, input, button, select, textarea').forEach(el => el.remove());
    // 图片资源重写
    const chapDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    for (const img of body.querySelectorAll('img, image')) {
      const src = img.getAttribute('src') || img.getAttribute('xlink:href');
      if (!src || src.startsWith('data:')) continue;
      const dataUrl = await loadAsset(resolvePath(chapDir, src));
      if (dataUrl) {
        img.setAttribute('src', dataUrl);
        img.removeAttribute('xlink:href');
      } else img.remove();
    }
    return { id: item.id, title: '', html: body.innerHTML };
  }

  // 封面
  let cover = null;
  let coverId = '';
  for (const m of byNS(opf, 'meta')) if (m.getAttribute('name') === 'cover') coverId = m.getAttribute('content');
  const coverItem = (coverId && manifest.get(coverId)) || [...manifest.values()].find(m => m.type.startsWith('image/'));
  if (coverItem) cover = await loadAsset(resolvePath(opfDir, coverItem.href));

  return { title, author, cover, spine, toc, loadChapter, zip };
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
