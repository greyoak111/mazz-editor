// renderer/modules/browser/clip-runtime.js —— W62b 网页剪藏 I/O 编排
import {
  buildClipMarkdown, imageExtension, parseUrlList, runPool, safeClipName, shouldUseVision,
} from './clipper.js';
import { getProviderConfig, providerReady, visionChat } from '../factory/provider.js';

const invoke = (channel, payload) => window.mazz.invoke(channel, payload);
const reservedClipPaths = new Set();

async function uniqueMarkdownPath(dir, stem) {
  for (let n = 1; n < 10_000; n++) {
    const suffix = n === 1 ? '' : `-${n}`;
    const path = `${dir}/${stem}${suffix}.md`;
    if (reservedClipPaths.has(path)) continue;
    const stat = await invoke('fs:stat', { path }).catch(() => ({ exists: false }));
    if (!stat?.exists) { reservedClipPaths.add(path); return { path, stem: stem + suffix }; }
  }
  throw new Error('同名剪藏过多，无法分配文件名');
}

async function imagePayload(url) {
  const result = await invoke('clip:fetchImage', { url });
  if (!result?.ok || !result.base64) throw new Error(result?.error || '图片抓取失败');
  return result;
}

async function localizeImages(page, { assetDir, stem, concurrency = 2 } = {}) {
  const images = (Array.isArray(page?.images) ? page.images : []).filter(image => /^https?:/i.test(image?.src || image)).slice(0, 12);
  if (!images.length) return [];
  await invoke('fs:mkdir', { path: assetDir });
  const results = await runPool(images, async (image, index) => {
    const src = image.src || image;
    const payload = await imagePayload(src);
    const ext = payload.ext || imageExtension(payload.mime, payload.url || src);
    const filename = `${stem}-${String(index + 1).padStart(2, '0')}.${ext}`;
    const absolutePath = `${assetDir}/${filename}`;
    await invoke('fs:writeFileBase64', { path: absolutePath, base64: payload.base64 });
    return {
      alt: image.alt || `页面图片 ${index + 1}`, source: src, relativePath: `assets/${filename}`,
      // 工作区协议避免绝对盘符：LAN 同步到另一台电脑后仍按对端工作区根开图。
      markdownPath: `mazz-res://workspace/${encodeURIComponent(`网页剪藏/assets/${filename}`)}`,
    };
  }, { concurrency });
  return results.filter(result => result.ok).map(result => result.value);
}

async function maybeVisionOcr(page, { viewId } = {}) {
  if (!shouldUseVision(page)) return { text: '', used: false };
  try {
    const cfg = await getProviderConfig('vision');
    if (!providerReady(cfg)) return { text: '', used: false, reason: '未配置视觉模型' };
    let dataUrl = '';
    if (viewId) {
      const png = await invoke('bv:capture', { tabId: viewId }).catch(() => null);
      if (png) dataUrl = `data:image/png;base64,${png}`;
    }
    if (!dataUrl) {
      const first = page.images?.[0];
      if (first) {
        const payload = await imagePayload(first.src || first);
        dataUrl = `data:${payload.mime};base64,${payload.base64}`;
      }
    }
    if (!dataUrl) return { text: '', used: false, reason: '没有可识别的页面图像' };
    const text = await visionChat({
      cfg, role: 'vision', imageDataUrl: dataUrl, maxTokens: 6000,
      prompt: 'MAZZ_WEB_CLIP_OCR_V1\n请按阅读顺序精确识别这张网页截图中的正文。保留标题、段落与表格；不要解释、评价或补写，不要输出导航栏和广告。',
    });
    return { text: String(text || '').trim(), used: true };
  } catch (error) {
    return { text: '', used: false, reason: error?.message || String(error) };
  }
}

export function createClipRuntime({ ctl, toast } = {}) {
  async function savePage(page, { viewId = '', imageConcurrency = 2 } = {}) {
    if (!page?.url || (!page.text && !page.images?.length)) throw new Error('正文与页面图片均提取失败');
    const workspace = await invoke('workspace:get');
    const dir = `${workspace}/网页剪藏`;
    const assetDir = `${dir}/assets`;
    await invoke('fs:mkdir', { path: dir });
    const unique = await uniqueMarkdownPath(dir, safeClipName(page.title));
    try {
      const [assets, ocr] = await Promise.all([
        localizeImages(page, { assetDir, stem: unique.stem, concurrency: imageConcurrency }),
        maybeVisionOcr(page, { viewId }),
      ]);
      const markdown = buildClipMarkdown({ page, assets, ocrText: ocr.text });
      await invoke('fs:writeFile', { path: unique.path, content: markdown });
      return { ...unique, title: page.title || unique.stem, assets: assets.length, ocr: ocr.used, ocrReason: ocr.reason || '', markdown };
    } finally { reservedClipPaths.delete(unique.path); }
  }

  async function currentPage() {
    const tab = ctl?.activeTab?.();
    if (!tab) throw new Error('没有活动网页');
    const page = await ctl.getPageSnapshot();
    if (!page) throw new Error('页面提取失败');
    if (!page.title) page.title = tab.title || '网页剪藏';
    return { page, tab };
  }

  async function clipCurrent() {
    const { page, tab } = await currentPage();
    return savePage(page, { viewId: tab.viewId, imageConcurrency: 2 });
  }

  async function clipList(items, { source = '清单' } = {}) {
    const normalized = (items || []).map(item => typeof item === 'string' ? { url: item } : item)
      .filter(item => /^https?:/i.test(item?.url || ''));
    if (!normalized.length) throw new Error(`${source}中没有可剪藏网址`);
    const onProgress = ({ done, total, result }) => {
      invoke('panel:push', { kind: 'favmgr', payload: { type: 'clipProgress', source, done, total, ok: result.ok } }).catch(() => {});
    };
    const results = await runPool(normalized, async item => {
      const extracted = await invoke('searx:extract', { url: item.url });
      if (!extracted?.ok) throw new Error(extracted?.error || '正文提取失败');
      if (!extracted.title) extracted.title = item.name || item.title || item.url;
      return savePage(extracted, { imageConcurrency: 1 });
    }, { concurrency: 2, onProgress });
    const ok = results.filter(result => result.ok).length;
    const failed = results.length - ok;
    invoke('panel:push', { kind: 'favmgr', payload: { type: 'clipDone', source, done: results.length, total: results.length, ok, failed } }).catch(() => {});
    return { source, total: results.length, ok, failed, results };
  }

  async function clipBookmarks() {
    return clipList(ctl?.bookmarks || [], { source: '收藏' });
  }

  async function clipClipboardList() {
    const clip = await invoke('clipboard:read');
    return clipList(parseUrlList(clip?.text || ''), { source: '剪贴板清单' });
  }

  async function shareCurrent() {
    const { page } = await currentPage();
    const content = buildClipMarkdown({ page, capturedAt: new Date() });
    return invoke('sync:tempShare', { title: page.title || '网页临时分享', content, ttlMs: 10 * 60_000 });
  }

  return { savePage, currentPage, clipCurrent, clipList, clipBookmarks, clipClipboardList, shareCurrent, parseUrlList, toast };
}
