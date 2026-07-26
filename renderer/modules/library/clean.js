// renderer/modules/library/clean.js —— 净化规则（koodo textRules 净室复刻）：
// 替换/删除 × 字面/正则 × 全书/本书——网文广告与站点水印的清洗层。
// 应用面：DOM 文本节点级（规则永远进不了标签与属性，正则误伤 HTML 结构的根本不存在）。
import { zhConvert } from './zh-convert.js';

const RULES_KEY = 'library.cleanrules';

export async function getAllRules() {
  return (await window.mazz.invoke('settings:get', { key: RULES_KEY }).catch(() => [])) || [];
}
export async function saveAllRules(rules) {
  await window.mazz.invoke('settings:set', { key: RULES_KEY, value: rules }).catch(() => {});
}
/** 当前书生效的规则（全书 + 本书） */
export function rulesForBook(all, bookId) {
  return (all || []).filter(r => r && r.pattern && (r.scope === 'all' || (r.scope === 'book' && r.bookId === bookId)));
}

/** 文本节点级加工（净化 + 简繁共用同一个 DOM 走查，一次遍历两条链） */
export function processHtmlText(html, { rules = [], zhMode = '' } = {}) {
  if (!rules.length && !zhMode) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  // 预编译规则（坏正则不炸整链：标记无效并跳过）
  const compiled = rules.map(r => {
    try {
      return { ...r, re: r.match === 'regex' ? new RegExp(r.pattern, 'g') : null };
    } catch { return { ...r, invalid: true }; }
  }).filter(r => !r.invalid);
  const applyOne = (t) => {
    for (const r of compiled) {
      const rep = r.type === 'delete' ? '' : (r.replacement ?? '');
      t = r.match === 'regex' ? t.replace(r.re, rep) : t.split(r.pattern).join(rep);
    }
    if (zhMode) t = zhConvert(t, zhMode);
    return t;
  };
  const walker = doc.createTreeWalker(doc.body.firstChild, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const t = applyOne(n.textContent);
    if (t !== n.textContent) n.textContent = t;
  }
  return doc.body.innerHTML;
}
