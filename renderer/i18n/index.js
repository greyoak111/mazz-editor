// renderer/i18n/index.js —— 多语言框架：「原文即 key」字典映射 + 语言切换 + RTL 支持
// 设计：源码保持中文，t(中文) 在非中文环境查映射表，查不到回落中文原文
import { LANGS, DICTS } from './langs.js';

export const LANGUAGES = LANGS; // [{id, name, dir}]

let current = 'zh-CN';
const listeners = new Set();

export function getLanguage() { return current; }
export function isRTL() { return (LANGUAGES.find(l => l.id === current)?.dir) === 'rtl'; }

/** 翻译：非中文环境查「中文原文 → 目标语」映射 */
export function t(text) {
  if (current === 'zh-CN' || text == null) return text;
  const d = DICTS[current];
  if (!d) return text;
  const hit = d[text];
  return hit !== undefined ? hit : text;
}

/** 变量插值：t('共 {n} 个文件', {n: 5}) */
export function tv(text, vars = {}) {
  let s = t(text);
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll('{' + k + '}', String(v));
  return s;
}

export function onLanguageChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function applyDir() {
  document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
  document.documentElement.lang = current;
}

export async function initI18n() {
  const saved = await window.mazz?.invoke('settings:get', { key: 'ui.language' }).catch(() => null);
  if (saved && DICTS[saved]) current = saved;
  applyDir();
  return current;
}

export async function setLanguage(id) {
  if (id !== 'zh-CN' && !DICTS[id]) return; // zh-CN 为源语言，无字典亦合法
  current = id;
  applyDir();
  await window.mazz?.invoke('settings:set', { key: 'ui.language', value: id }).catch(() => {});
  for (const cb of listeners) { try { cb(current); } catch {} }
}
