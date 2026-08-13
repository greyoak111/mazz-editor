// renderer/modules/factory/workshop.js —— W68b 活稿车间：消息/归档/折叠/虚拟窗口纯内核
// 该文件不碰 DOM，契约测试和 Factory Desk 共用同一套规则。

export const FACTORY_ARCHIVE_FILE = '工厂群.md';
export const FACTORY_EVENT_TYPES = Object.freeze(['body', 'skeleton', 'review', 'verdict', 'help', 'system']);
export const FACTORY_VIEW_FILTERS = Object.freeze({
  body: Object.freeze(['body']),
  workshop: FACTORY_EVENT_TYPES,
  summary: FACTORY_EVENT_TYPES,
});

const LABELS = Object.freeze({
  body: '正文', skeleton: '骨架', review: '审理', verdict: '裁决', help: '求助', system: '系统',
});
const START = '<!-- MAZZ_FACTORY_EVENT ';
const END = '<!-- /MAZZ_FACTORY_EVENT -->';

const cleanText = value => String(value ?? '').replace(/\r\n?/g, '\n');
const safeType = type => FACTORY_EVENT_TYPES.includes(type) ? type : 'system';
const safeCard = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
};
const safeMeta = event => {
  const meta = { ...event };
  delete meta.content;
  return meta;
};

export function factoryEventId(event = {}) {
  if (event.id) return String(event.id);
  const seed = [event.type, event.unitNo, event.title, event.artifactPath, event.createdAt, cleanText(event.content).slice(0, 80)].join('|');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return `fe-${(hash >>> 0).toString(36)}`;
}

export function normalizeFactoryEvent(event = {}) {
  const type = safeType(event.type);
  const unitNo = Number(event.unitNo) || 0;
  const createdAt = event.createdAt || new Date().toISOString();
  const title = String(event.title || `${LABELS[type]}${unitNo ? ` · 第 ${unitNo} 单元` : ''}`);
  const normalized = {
    id: String(event.id || ''), type, title, content: cleanText(event.content), createdAt,
    unitNo, unitName: String(event.unitName || '单元'),
    stage: String(event.stage || ''), artifactPath: String(event.artifactPath || ''),
    threadId: String(event.threadId || ''), tone: String(event.tone || ''),
    family: String(event.family || ''), refId: String(event.refId || ''), card: safeCard(event.card),
    progress: Number.isFinite(Number(event.progress)) ? Math.max(0, Math.min(100, Number(event.progress))) : null,
  };
  normalized.id = factoryEventId({ ...event, ...normalized });
  return normalized;
}

export function serializeFactoryEvent(event) {
  const row = normalizeFactoryEvent(event);
  const meta = JSON.stringify(safeMeta(row)).replace(/-->/g, '--\u003e');
  const ref = row.artifactPath ? `\n\n> 工件：${row.artifactPath}` : '';
  return `${START}${meta} -->\n## [${LABELS[row.type]}] ${row.title}\n\n${row.content}${ref}\n${END}`;
}

export function appendFactoryArchiveText(archive, events, { title = 'Mazz 工厂群' } = {}) {
  const seen = new Set(parseFactoryArchive(archive).map(event => event.id));
  const rows = (Array.isArray(events) ? events : [events]).filter(Boolean)
    .map(normalizeFactoryEvent).filter(event => !seen.has(event.id)).map(serializeFactoryEvent);
  if (!rows.length) return cleanText(archive);
  const old = cleanText(archive).trim();
  const head = old || `# ${title}\n\n> 本文件是活稿车间的可移交档案；卡片元数据位于 HTML 注释中，正文保持普通 Markdown 可读。`;
  return `${head}\n\n${rows.join('\n\n')}\n`;
}

export function parseFactoryArchive(markdown = '') {
  const text = cleanText(markdown);
  const out = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(START, cursor);
    if (start < 0) break;
    const metaEnd = text.indexOf(' -->', start + START.length);
    const end = text.indexOf(END, metaEnd + 4);
    if (metaEnd < 0 || end < 0) break;
    try {
      const meta = JSON.parse(text.slice(start + START.length, metaEnd));
      const block = text.slice(metaEnd + 4, end).replace(/^\s*##[^\n]*\n+/, '').replace(/\n+> 工件：[^\n]*\s*$/, '').trim();
      out.push(normalizeFactoryEvent({ ...meta, content: block }));
    } catch { /* 坏块跳过，后续块仍可恢复 */ }
    cursor = end + END.length;
  }
  return out;
}

export function filterFactoryEvents(events, view = 'workshop') {
  const allowed = new Set(FACTORY_VIEW_FILTERS[view] || FACTORY_VIEW_FILTERS.workshop);
  return (events || []).map(normalizeFactoryEvent).filter(event => allowed.has(event.type));
}

export function defaultFactoryCollapsed(event, events, { keepRecentUnits = 2, view = 'workshop' } = {}) {
  if (view === 'summary') return true;
  if (event.tone === 'disagreement' || event.stage === 'objection' || event.stage === 'answer') return true;
  const latest = Math.max(0, ...(events || []).map(row => Number(row.unitNo) || 0));
  return !!event.unitNo && event.unitNo <= latest - Math.max(0, keepRecentUnits);
}

export function resolveFactoryCollapsed(event, events, memory = {}, opts = {}) {
  if (opts.view === 'summary') return true;
  if (Object.prototype.hasOwnProperty.call(memory, event.id)) return !!memory[event.id];
  return defaultFactoryCollapsed(event, events, opts);
}

function chunkText(text, maxChars) {
  const source = cleanText(text);
  if (source.length <= maxChars) return [source];
  const chunks = [];
  let rest = source;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n\n', maxChars);
    if (cut < maxChars * 0.55) cut = rest.lastIndexOf('\n', maxChars);
    if (cut < maxChars * 0.55) cut = maxChars;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function buildFactoryVirtualItems(events, memory = {}, { view = 'workshop', chunkChars = 12000, keepRecentUnits = 2 } = {}) {
  const filtered = filterFactoryEvents(events, view);
  const items = [];
  for (const event of filtered) {
    const collapsed = resolveFactoryCollapsed(event, filtered, memory, { view, keepRecentUnits });
    const chunks = collapsed ? [''] : chunkText(event.content, Math.max(1000, chunkChars));
    chunks.forEach((content, chunkIndex) => {
      const lines = content ? content.split('\n').length : 0;
      const height = collapsed ? 52 : 92 + lines * 22 + Math.ceil(content.length / 78) * 18;
      items.push({
        id: `${event.id}:${chunkIndex}`, eventId: event.id, event,
        content, collapsed, chunkIndex, chunkCount: chunks.length, estimatedHeight: height,
      });
    });
  }
  return items;
}

export function computeFactoryVirtualWindow(items, scrollTop = 0, viewportHeight = 800, heightCache = {}, overscanScreens = 2) {
  const heights = (items || []).map(item => Math.max(24, Number(heightCache[item.id]) || item.estimatedHeight || 100));
  const starts = [];
  let totalHeight = 0;
  for (const height of heights) { starts.push(totalHeight); totalHeight += height; }
  const pad = Math.max(0, viewportHeight) * Math.max(0, overscanScreens);
  const fromY = Math.max(0, scrollTop - pad);
  const toY = scrollTop + viewportHeight + pad;
  let start = 0;
  while (start < items.length && starts[start] + heights[start] < fromY) start++;
  let end = start;
  while (end < items.length && starts[end] < toY) end++;
  return {
    start, end, totalHeight,
    top: starts[start] || 0,
    bottom: Math.max(0, totalHeight - (starts[end] || totalHeight)),
    items: (items || []).slice(start, end),
  };
}

export function findFactoryMatches(events, query) {
  const q = String(query || '').trim().toLocaleLowerCase();
  if (!q) return [];
  return (events || []).map(normalizeFactoryEvent).flatMap(event => {
    const hay = `${event.title}\n${event.content}`.toLocaleLowerCase();
    const at = hay.indexOf(q);
    return at < 0 ? [] : [{ eventId: event.id, at, excerpt: `${event.title}\n${event.content}`.slice(Math.max(0, at - 36), at + q.length + 72) }];
  });
}

export function buildFactoryDebateThreads(events) {
  const threads = new Map();
  for (const event of (events || []).map(normalizeFactoryEvent)) {
    if (!event.threadId && !['objection', 'answer', 'hearing'].includes(event.stage)) continue;
    const id = event.threadId || `unit-${event.unitNo || 0}`;
    if (!threads.has(id)) threads.set(id, { id, objection: [], answer: [], verdict: [] });
    const thread = threads.get(id);
    if (event.stage === 'objection' || event.tone === 'disagreement') thread.objection.push(event);
    else if (event.stage === 'answer' || event.tone === 'evidence') thread.answer.push(event);
    else thread.verdict.push(event);
  }
  return [...threads.values()];
}

export function factoryArtifactEvent(key, content, { unitNo = 0, unitName = '单元', artifactPath = '' } = {}) {
  const map = {
    skeleton: ['skeleton', '骨架与验收点', 'skeleton', ''],
    draft: ['body', '扩写稿', 'draft', ''],
    polish: ['review', '润色记录', 'polish', ''], machine: ['review', '机检报告', 'machine', ''],
    point: ['review', '对点报告', 'point', 'evidence'], repair: ['review', '修订单', 'repair', ''],
    consultation: ['help', '请示单', 'consultation', ''], review: ['review', '审理表', 'review', ''],
    objection: ['review', '质询单', 'objection', 'disagreement'], answer: ['review', '答辩书', 'answer', 'evidence'],
    verdict: ['verdict', '裁决书', 'verdict', 'verdict'],
  };
  const [type, title, stage, tone] = map[key] || ['system', key, key, ''];
  return normalizeFactoryEvent({
    type, title: `${title} · 第 ${String(unitNo).padStart(3, '0')}${unitName}`, content,
    unitNo, unitName, stage, tone, artifactPath,
    threadId: ['objection', 'answer', 'verdict'].includes(key) ? `unit-${unitNo}` : '',
  });
}
