// Bounded, cancel-aware operations which inspect an EPUB without joining the
// reader's materialized chapter residency.  Search and export must never fill
// the live reader cache merely because they walk the whole spine.

import { htmlToMarkdown } from './epub.js';

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
};

const bytesToBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
};

const textOf = (html) => {
  const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
  return String(doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
};

/**
 * Scan raw chapters only.  `loadChapterRaw()` performs no Blob materialization
 * and therefore cannot evict or inflate the reader's bounded chapter window.
 */
export async function searchEpubRaw(epub, query, {
  isAlive = () => true,
  limit = 30,
  maxSectionBytes = 8 * 1024 * 1024,
} = {}) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle || !epub?.loadChapterRaw || !Array.isArray(epub.spine)) {
    return { ok: false, cancelled: false, hits: [], scanned: 0 };
  }
  const hits = [];
  let scanned = 0;
  for (let i = 0; i < epub.spine.length; i++) {
    if (!isAlive()) return { ok: false, cancelled: true, hits, scanned };
    const raw = await epub.loadChapterRaw(epub.spine[i], { maxBytes: maxSectionBytes });
    if (!isAlive()) return { ok: false, cancelled: true, hits, scanned };
    scanned++;
    if (textOf(raw?.html).toLocaleLowerCase().includes(needle) && hits.length < limit) {
      hits.push({
        idx: i,
        label: String(epub.toc?.[i]?.label || `第 ${i + 1} 节`),
        spineItemId: String(epub.spine[i]?.id || ''),
      });
    }
  }
  return { ok: true, cancelled: false, hits, scanned };
}

async function portableChapterMarkdown(epub, raw, {
  isAlive,
  imageBudget,
  maxImageBytes,
}) {
  const doc = new DOMParser().parseFromString(`<div>${String(raw?.html || '')}</div>`, 'text/html');
  const root = doc.body?.firstElementChild || doc.body;
  const images = Array.isArray(raw?.images) ? raw.images : [];
  let embeddedBytes = 0;
  let omittedImages = 0;

  for (let i = 0; i < images.length; i++) {
    if (!isAlive()) return { cancelled: true, markdown: '', embeddedBytes, omittedImages };
    const descriptor = images[i];
    const node = root?.querySelector?.(`img[src="libimg:${i}"],image[src="libimg:${i}"]`);
    if (!node || !descriptor) continue;
    let bytes = null;
    try { bytes = await epub.readZipBytes?.(descriptor.zipPath, { maxBytes: maxImageBytes }); } catch {}
    if (!isAlive()) return { cancelled: true, markdown: '', embeddedBytes, omittedImages };
    const size = Number(bytes?.byteLength || bytes?.length || 0);
    if (bytes instanceof Uint8Array && size > 0 && size <= maxImageBytes && imageBudget.used + size <= imageBudget.max) {
      const ext = String(descriptor.ext || '').toLowerCase();
      node.setAttribute('src', `data:${MIME_BY_EXT[ext] || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`);
      imageBudget.used += size;
      embeddedBytes += size;
    } else {
      node.replaceWith(doc.createTextNode(`〔图像未内嵌：${String(descriptor.zipPath || `image-${i + 1}`)}〕`));
      omittedImages++;
    }
  }

  return {
    cancelled: false,
    markdown: htmlToMarkdown(root?.innerHTML || ''),
    embeddedBytes,
    omittedImages,
  };
}

/**
 * Export from raw chapters, embedding only a bounded amount of portable data.
 * No session `blob:` URL can escape into the resulting Markdown document.
 */
export async function exportEpubMarkdownRaw(epub, {
  title = epub?.title || '未命名书籍',
  author = epub?.author || '',
  isAlive = () => true,
  maxImageBytes = 2 * 1024 * 1024,
  maxTotalImageBytes = 24 * 1024 * 1024,
  maxSectionBytes = 8 * 1024 * 1024,
} = {}) {
  if (!epub?.loadChapterRaw || !Array.isArray(epub.spine)) {
    throw new Error('EPUB 不支持原始章节导出');
  }
  const parts = [`# ${String(title || '未命名书籍')}\n`];
  if (author) parts.push(`> 作者：${String(author)}\n`);
  const imageBudget = { used: 0, max: Math.max(0, Number(maxTotalImageBytes) || 0) };
  let omittedImages = 0;
  let exportedSections = 0;

  for (const item of epub.spine) {
    if (!isAlive()) return { ok: false, cancelled: true, content: '', exportedSections, omittedImages };
    const raw = await epub.loadChapterRaw(item, { maxBytes: maxSectionBytes });
    if (!isAlive()) return { ok: false, cancelled: true, content: '', exportedSections, omittedImages };
    const section = await portableChapterMarkdown(epub, raw, {
      isAlive,
      imageBudget,
      maxImageBytes: Math.max(0, Number(maxImageBytes) || 0),
    });
    if (section.cancelled) return { ok: false, cancelled: true, content: '', exportedSections, omittedImages };
    if (section.markdown.trim()) parts.push(section.markdown);
    omittedImages += section.omittedImages;
    exportedSections++;
  }

  return {
    ok: true,
    cancelled: false,
    content: parts.join('\n\n'),
    exportedSections,
    embeddedImageBytes: imageBudget.used,
    omittedImages,
  };
}

export const _forTests = { bytesToBase64, textOf };
