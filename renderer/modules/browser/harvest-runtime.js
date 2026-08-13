// W62f：AI 对话整理 I/O 编排——采集、工作区导出、文风素材、无损提炼回喂。
import { buildHarvestMarkdown, harvestScript, normalizeHarvestMessages, safeHarvestName } from './harvester.js';
import { saveStyleText } from '../factory/style-studio.js';

const invoke = (channel, payload) => window.mazz.invoke(channel, payload);
const reservedPaths = new Set();

async function uniqueMarkdownPath(dir, stem) {
  for (let n = 1; n < 10_000; n++) {
    const suffix = n === 1 ? '' : `-${n}`;
    const path = `${dir}/${stem}${suffix}.md`;
    if (reservedPaths.has(path)) continue;
    const stat = await invoke('fs:stat', { path }).catch(() => ({ exists: false }));
    if (!stat?.exists) { reservedPaths.add(path); return { path, stem: stem + suffix }; }
  }
  throw new Error('同名对话过多，无法分配文件名');
}

function normalizedPayload(payload = {}) {
  const meta = {
    adapterId: String(payload.meta?.adapterId || ''),
    site: String(payload.meta?.site || '通用网页对话'),
    title: String(payload.meta?.title || ''),
    topic: safeHarvestName(payload.meta?.topic || payload.meta?.title || '未命名对话'),
    url: String(payload.meta?.url || ''),
    capturedAt: String(payload.meta?.capturedAt || new Date().toISOString()),
    scrollPasses: Math.max(0, Number(payload.meta?.scrollPasses) || 0),
  };
  if (!/^https?:\/\//i.test(meta.url)) throw new Error('对话来源网址无效');
  const messages = normalizeHarvestMessages(payload.messages).slice(0, 1000);
  if (!messages.length) throw new Error('请至少选择一条消息');
  const totalChars = messages.reduce((sum, row) => sum + row.text.length, 0);
  if (totalChars > 500_000) throw new Error('一次最多处理 50 万字，请缩小选择范围');
  return { meta, messages };
}

export function createHarvestRuntime({ ctl } = {}) {
  async function collectCurrent() {
    const tab = ctl?.activeTab?.();
    if (!tab?.viewId || !/^https?:/i.test(tab.url || '')) throw new Error('请先打开一个 AI 对话网页');
    const result = await invoke('bv:js', { tabId: tab.viewId, code: harvestScript(tab.url) });
    if (!result || result.__err) throw new Error(result?.__err || '页面采集脚本没有返回结果');
    const messages = normalizeHarvestMessages(result.messages);
    if (!messages.length) throw new Error('没有识别到对话消息；可滚动页面后重试');
    return {
      meta: {
        adapterId: result.adapterId || 'generic',
        site: result.site || '通用网页对话',
        title: result.title || tab.title || 'AI 对话',
        topic: result.topic || result.title || tab.title || 'AI 对话',
        url: result.url || tab.url,
        capturedAt: result.capturedAt || new Date().toISOString(),
        scrollPasses: Number(result.scrollPasses) || 0,
        selector: result.selector || '',
      },
      messages,
    };
  }

  async function exportSelection(payload) {
    const { meta, messages } = normalizedPayload(payload);
    const markdown = buildHarvestMarkdown(meta, messages);
    const workspace = await invoke('workspace:get');
    const dir = `${workspace}/AI对话归档`;
    await invoke('fs:mkdir', { path: dir });
    const stamp = new Date(meta.capturedAt).toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    const stem = safeHarvestName(`AI对话-${meta.site}-${meta.topic}-${stamp}`);
    const unique = await uniqueMarkdownPath(dir, stem);
    try {
      await invoke('fs:writeFile', { path: unique.path, content: markdown });
      return { ...unique, markdown, meta, messages };
    } finally { reservedPaths.delete(unique.path); }
  }

  async function feedStyle(payload) {
    const { meta, messages } = normalizedPayload(payload);
    const answers = messages.filter(row => row.role === 'assistant');
    const source = answers.length ? answers : messages;
    const text = source.map(row => row.text).join('\n\n---\n\n');
    const entry = await saveStyleText({
      label: `${meta.site} · ${meta.topic}`,
      text,
      note: `来自 AI 对话整理，共 ${source.length} 条${answers.length ? ' AI 回复' : '消息'}`,
      sourceUrl: meta.url,
    });
    return { entry, count: source.length };
  }

  async function distillSelection(payload) {
    const saved = await exportSelection(payload);
    await invoke('panel:close', { kind: 'harvest' }).catch(() => {});
    window.MazzHost?.openTab('markdown', { title: saved.path.split('/').pop(), filePath: saved.path, content: saved.markdown });
    await new Promise(resolve => setTimeout(resolve, 0));
    await window.MazzCommands?.execute('markdown.distillDocumentToMindmap');
    return saved;
  }

  return { collectCurrent, exportSelection, feedStyle, distillSelection, normalizedPayload };
}
