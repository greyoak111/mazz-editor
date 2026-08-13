// renderer/modules/browser/clipper.js —— W62b 网页剪藏纯内核
// 站点差异、批量并发、命名与 Markdown 组装集中在这里；运行时 I/O 留给 clip-runtime。

export const CLIP_ADAPTERS = Object.freeze([
  Object.freeze({
    id: 'wechat', hosts: ['mp.weixin.qq.com'],
    content: ['#js_content', '.rich_media_content', 'article'],
    remove: ['script', 'style', 'noscript', '.qr_code_pc', '.rich_media_tool'],
  }),
  Object.freeze({
    id: 'zhihu', hosts: ['zhihu.com'],
    content: ['.Post-RichTextContainer', '.RichContent-inner', 'article', 'main'],
    remove: ['script', 'style', 'noscript', '.ContentItem-actions', '.Recommendations-Main'],
  }),
  Object.freeze({
    id: 'juejin', hosts: ['juejin.cn'],
    content: ['article', '.article-content', '.markdown-body', 'main'],
    remove: ['script', 'style', 'noscript', '.article-suspended-panel', '.sidebar'],
  }),
  Object.freeze({
    id: 'generic', hosts: [],
    content: ['article', '[role="main"]', 'main', '.post-content', '.article-content', '.entry-content', 'body'],
    remove: ['script', 'style', 'noscript', 'template', 'nav', 'footer', 'aside', 'form'],
  }),
]);

export function resolveClipAdapter(rawUrl = '') {
  let host = '';
  try { host = new URL(rawUrl).hostname.toLowerCase(); } catch {}
  return CLIP_ADAPTERS.find(adapter => adapter.hosts.some(domain => host === domain || host.endsWith('.' + domain)))
    || CLIP_ADAPTERS.at(-1);
}

/** 在 BrowserView 客页执行。只回传文本与公开图片 URL，不把不受信 HTML 带回应用。 */
export function snapshotScript(rawUrl = '') {
  const adapter = resolveClipAdapter(rawUrl);
  return `(() => {
    const cfg = ${JSON.stringify(adapter)};
    const source = cfg.content.map(s => document.querySelector(s)).find(Boolean) || document.body;
    const clone = source.cloneNode(true);
    for (const sel of cfg.remove) clone.querySelectorAll(sel).forEach(el => el.remove());
    const text = String(clone.innerText || clone.textContent || '').replace(/[\\t ]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 60000);
    const images = [...source.querySelectorAll('img')].map((img) => {
      const raw = img.currentSrc || img.getAttribute('data-original') || img.getAttribute('data-src') || img.src || '';
      let src = '';
      try { src = new URL(raw, location.href).toString(); } catch {}
      return { src, alt: (img.alt || '').trim().slice(0, 160), width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0 };
    }).filter(x => /^https?:/i.test(x.src));
    const unique = [...new Map(images.map(x => [x.src, x])).values()].slice(0, 24);
    return { title: (document.title || '').trim().slice(0, 400), url: location.href, text, images: unique, adapter: cfg.id };
  })()`;
}

export function shouldUseVision(page) {
  const textLength = String(page?.text || '').replace(/\s/g, '').length;
  const images = Array.isArray(page?.images) ? page.images : [];
  const large = images.some(image => Number(image.width) >= 640 && Number(image.height) >= 360);
  return textLength < 280 && (large || images.length >= 1);
}

export function safeClipName(value = '', fallback = '剪藏') {
  const clean = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
  return (clean || fallback).slice(0, 72);
}

export function imageExtension(mime = '', url = '') {
  const table = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico',
  };
  if (table[String(mime).toLowerCase()]) return table[String(mime).toLowerCase()];
  try {
    const ext = new URL(url).pathname.split('.').pop().toLowerCase();
    if (/^(?:png|jpe?g|webp|gif|avif|bmp|ico)$/.test(ext)) return ext === 'jpeg' ? 'jpg' : ext;
  } catch {}
  return 'png';
}

export function parseUrlList(text = '') {
  const found = String(text).match(/https?:\/\/[^\s<>'"\]\[()，。；、]+/gi) || [];
  return [...new Set(found.map(url => url.replace(/[),.;!?]+$/g, '')))];
}

/** 保序并发池。批量网页抓取与单页图片本地化共同复用，默认严格最多 2 件。 */
export async function runPool(items, worker, { concurrency = 2, onProgress } = {}) {
  const list = Array.from(items || []);
  const results = new Array(list.length);
  const limit = Math.max(1, Math.min(8, Math.floor(Number(concurrency) || 2)));
  let cursor = 0, done = 0;
  async function lane() {
    while (cursor < list.length) {
      const index = cursor++;
      try { results[index] = { ok: true, value: await worker(list[index], index) }; }
      catch (error) { results[index] = { ok: false, error: error?.message || String(error) }; }
      done++;
      onProgress?.({ done, total: list.length, index, result: results[index] });
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => lane()));
  return results;
}

export function buildClipMarkdown({ page, assets = [], capturedAt = new Date(), ocrText = '' } = {}) {
  const title = String(page?.title || '').replace(/\s+/g, ' ').trim() || '网页剪藏';
  const source = String(page?.url || '').trim();
  const adapter = String(page?.adapter || 'generic');
  const body = String(page?.text || '').trim();
  const stamp = capturedAt instanceof Date ? capturedAt.toLocaleString('zh-CN') : String(capturedAt);
  const lines = [
    `# ${title}`,
    '',
    `> 来源：${source}`,
    `> 剪藏时间：${stamp}`,
    `> 提取适配器：${adapter}`,
    '',
  ];
  if (body) lines.push(body, '');
  if (ocrText) lines.push('## 图片页 OCR', '', String(ocrText).trim(), '');
  if (assets.length) {
    lines.push('## 页面图片（已本地化）', '');
    for (const asset of assets) {
      const target = asset.markdownPath || asset.relativePath;
      lines.push(`![${String(asset.alt || '页面图片').replace(/[\[\]\r\n]/g, '')}](${target})`);
      if (asset.markdownPath && asset.relativePath) lines.push(`<!-- 本地资源：${asset.relativePath} -->`);
    }
    lines.push('');
  }
  if (!body && !ocrText) lines.push('> 未能提取正文；已保留来源与本地化图片。', '');
  return lines.join('\n');
}
