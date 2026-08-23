// renderer/modules/search/research-runtime.js —— W62 桌面运行时：模型路由、IPC 与工作区落盘
import { chat } from '../factory/provider.js';
import { canonicalUrl, finishResearch, prepareResearch } from './research-pipeline.js';

const defaultInvoke = (channel, payload) => window.mazz.invoke(channel, payload);

function cleanFilePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 72) || '未命名研究';
}

function timestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error(String(signal.reason || '检索已取消'));
  error.name = 'AbortError';
  throw error;
}

/**
 * Fetch one query page-by-page until SearXNG itself reaches a natural end.
 * There is deliberately no local page ceiling: the provider owns result volume.
 */
export async function searchAllSearxPages(query, { invoke = defaultInvoke, signal } = {}) {
  const results = [];
  const seenUrls = new Set();
  let page = 1;

  for (;;) {
    throwIfAborted(signal);
    const out = await invoke('searx:search', {
      query, categories: 'general', language: 'auto', pageno: page,
    });
    throwIfAborted(signal);
    if (!out?.ok) throw new Error(out?.error || 'SearXNG 检索失败');

    const rows = Array.isArray(out.results) ? out.results : [];
    if (!rows.length) break;
    results.push(...rows);

    let added = 0;
    for (const row of rows) {
      const url = canonicalUrl(row?.url);
      if (url && !seenUrls.has(url)) { seenUrls.add(url); added++; }
    }
    if (!added) break;
    page++;
  }
  return results;
}

export async function prepareWebResearch(topic, { onStage, invoke = defaultInvoke, chatFn = chat, signal } = {}) {
  throwIfAborted(signal);
  const prepared = await prepareResearch({
    topic, onStage,
    expand: async subject => chatFn({
      role: 'search', temperature: 0.1,
      system: '你是检索式扩写器。只返回 JSON 字符串数组；覆盖原题、事实数据、研究报告与反方/限制，不作答。按主题实际需要给出检索式，不设本地产出的数量门限。',
      user: subject, signal,
    }),
    search: query => searchAllSearxPages(query, { invoke, signal }),
    extract: async source => {
      const out = await invoke('searx:extract', { url: source.url });
      return out?.ok ? out : { title: source.title, text: '' };
    },
  });
  throwIfAborted(signal);
  return prepared;
}

export async function finishWebResearch(prepared, { selectedIds, onStage, invoke = defaultInvoke, chatFn = chat, now = () => new Date() } = {}) {
  const savedAtRaw = now();
  const savedAt = savedAtRaw instanceof Date ? savedAtRaw : new Date(savedAtRaw);
  const done = await finishResearch(prepared, {
    selectedIds, onStage, now: () => savedAt,
    synthesize: prompt => chatFn({
      role: 'research', temperature: 0.15,
      system: prompt.system, user: prompt.user,
    }),
  });
  const ws = String(await invoke('workspace:get') || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!ws) throw new Error('尚未设置工作区，无法保存检索报告');
  const dir = `${ws}/检索`;
  const path = `${ws}/检索/${cleanFilePart(prepared.topic)}-${timestamp(savedAt)}.md`;
  await invoke('fs:mkdir', { path: dir });
  await invoke('fs:writeFile', { path, content: done.report });
  try {
    window.dispatchEvent(new CustomEvent('mazz:research-saved', { detail: { path, topic: prepared.topic } }));
  } catch {}
  return { ...done, path };
}
