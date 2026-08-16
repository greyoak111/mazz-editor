// renderer/core/icon-registry.js —— 稳定 iconId 到主题 SVG 的单一解析入口
// 业务状态只保存 iconId；emoji 仅作为现有 SVG 库的内部符号键，不再混入标题文本。
import { iconHtml } from '../lib/svg-icons.js';

const FALLBACK_ID = 'module.unknown';
const symbols = new Map([[FALLBACK_ID, '📄']]);

export function moduleIconId(moduleId) {
  const name = String(moduleId || 'unknown').trim() || 'unknown';
  return `module.${name}`;
}

export function registerIcon(iconId, symbol) {
  const id = String(iconId || '').trim();
  if (!id) throw new Error('[icons] iconId 不能为空');
  const next = symbol || symbols.get(FALLBACK_ID);
  const previous = symbols.get(id);
  if (previous && previous !== next) throw new Error(`[icons] 重复 iconId 使用了不同图形: ${id}`);
  symbols.set(id, next);
  return id;
}

export function unregisterIcon(iconId) {
  if (iconId && iconId !== FALLBACK_ID) symbols.delete(iconId);
}

export function iconHtmlById(iconId) {
  return iconHtml(symbols.get(iconId) || symbols.get(FALLBACK_ID));
}

export function hasIconId(iconId) {
  return symbols.has(iconId);
}

export const iconRegistry = Object.freeze({
  register: registerIcon,
  unregister: unregisterIcon,
  resolve: iconHtmlById,
  has: hasIconId,
  moduleId: moduleIconId,
});
