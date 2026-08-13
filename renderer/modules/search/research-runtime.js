// renderer/modules/search/research-runtime.js —— W62 桌面运行时：模型路由、IPC 与工作区落盘
import { chat } from '../factory/provider.js';
import { finishResearch, prepareResearch } from './research-pipeline.js';

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

export async function prepareWebResearch(topic, { onStage, invoke = defaultInvoke, chatFn = chat } = {}) {
  return prepareResearch({
    topic, onStage,
    expand: async subject => chatFn({
      role: 'search', temperature: 0.1, maxTokens: 500,
      system: '你是检索式扩写器。只返回 JSON 字符串数组，最多 4 条；覆盖原题、事实数据、研究报告与反方/限制，不作答。',
      user: subject,
    }),
    search: async query => {
      const out = await invoke('searx:search', { query, categories: 'general', language: 'auto' });
      if (!out?.ok) throw new Error(out?.error || 'SearXNG 检索失败');
      return out.results || [];
    },
    extract: async source => {
      const out = await invoke('searx:extract', { url: source.url });
      return out?.ok ? out : { title: source.title, text: '' };
    },
  });
}

export async function finishWebResearch(prepared, { selectedIds, onStage, invoke = defaultInvoke, chatFn = chat, now = () => new Date() } = {}) {
  const savedAtRaw = now();
  const savedAt = savedAtRaw instanceof Date ? savedAtRaw : new Date(savedAtRaw);
  const done = await finishResearch(prepared, {
    selectedIds, onStage, now: () => savedAt,
    synthesize: prompt => chatFn({
      role: 'research', temperature: 0.15, maxTokens: 5000,
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
