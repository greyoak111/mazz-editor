// renderer/core/quick-switcher.js —— W62c Quick Switcher 四路候选统一排序契约
import { fuzzyScore } from './command-palette.js';

export const QUICK_SWITCHER_KIND_LABELS = Object.freeze({
  recent: '最近',
  file: '文件',
  command: '命令',
  content: '全文',
});

const KIND_BASE = Object.freeze({ recent: 90, command: 24, file: 16, content: 8 });

function normalized(value) { return String(value || '').trim().toLocaleLowerCase(); }

function textScore(query, value, weight = 1) {
  const q = normalized(query);
  const text = normalized(value);
  if (!q || !text) return 0;
  let score = 0;
  if (text === q) score += 620;
  else if (text.startsWith(q)) score += 360;
  else if (text.split(/[\s\-_/.\\]+/).some(part => part.startsWith(q))) score += 230;
  else if (text.includes(q)) score += 150;
  const fuzzy = fuzzyScore(q, String(value || ''));
  if (fuzzy) score += Math.max(0, fuzzy.score) * 5;
  return score * weight;
}

/** 单候选评分：最近优先、标题前缀优先，正文命中行参与但不盖过同名文件。 */
export function scoreQuickCandidate(query, item) {
  const q = normalized(query);
  const kind = item?.kind || 'file';
  const recentOrder = Number.isFinite(item?.recentOrder) ? Math.max(0, item.recentOrder) : 99;
  let score = KIND_BASE[kind] || 0;
  if (kind === 'recent') score -= Math.min(70, recentOrder * 3);
  if (!q) return score;

  const titleScore = textScore(q, item?.title, kind === 'content' ? 0.45 : 1);
  const supporting = [item?.detail, item?.group, item?.id, item?.preview]
    .map(value => textScore(q, value, 0.34));
  const matched = titleScore > 0 || supporting.some(value => value > 0);
  if (!matched) return null;
  score += titleScore + supporting.reduce((sum, value) => sum + value, 0);
  if (kind === 'content' && normalized(item?.preview).includes(q)) score += 60;
  return score;
}

function identityOf(item) {
  if (item.kind === 'command') return `command:${item.id}`;
  if (item.kind === 'content') return `content:${item.path}:${item.line || 0}`;
  return `file:${normalized(item.path)}`;
}

/** 聚合、去重、稳定排序。最近文件与工作区文件同径时保留“最近”身份。 */
export function rankQuickCandidates(query, candidates, { limit = 60 } = {}) {
  const best = new Map();
  (candidates || []).forEach((item, order) => {
    if (!item || !QUICK_SWITCHER_KIND_LABELS[item.kind]) return;
    const score = scoreQuickCandidate(query, item);
    if (score == null) return;
    const ranked = { ...item, sourceLabel: QUICK_SWITCHER_KIND_LABELS[item.kind], _score: score, _order: order };
    const key = identityOf(ranked);
    const previous = best.get(key);
    if (!previous
      || (ranked.kind === 'recent' && previous.kind === 'file')
      || (previous.kind !== 'recent' && ranked._score > previous._score)) best.set(key, ranked);
  });
  return [...best.values()]
    .sort((a, b) => (b._score - a._score)
      || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
      || (a._order - b._order))
    .slice(0, Math.max(1, limit))
    .map(({ _score, _order, ...item }) => item);
}
