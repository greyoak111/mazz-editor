// renderer/modules/slide/themes.js —— 主题模板包 ×5（可自制）
export const SLIDE_THEMES = [
  {
    id: 'ink', name: '墨韵',
    bg: '#0f172a', fg: '#e2e8f0', accent: '#38bdf8',
    titleColor: '#ffffff', font: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    titleSize: 34, bodySize: 18,
  },
  {
    id: 'dawn', name: '晨曦',
    bg: '#fdf6ec', fg: '#42342a', accent: '#d97706',
    titleColor: '#92400e', font: 'Georgia, "Source Han Serif SC", "Noto Serif CJK SC", serif',
    titleSize: 36, bodySize: 18,
  },
  {
    id: 'jade', name: '翡翠',
    bg: '#f0f7f2', fg: '#1c3a2c', accent: '#059669',
    titleColor: '#065f46', font: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    titleSize: 34, bodySize: 18,
  },
  {
    id: 'royal', name: '紫宸',
    bg: '#1e1b4b', fg: '#e0e7ff', accent: '#a78bfa',
    titleColor: '#f5f3ff', font: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    titleSize: 34, bodySize: 18,
  },
  {
    id: 'mono', name: '极简',
    bg: '#ffffff', fg: '#111111', accent: '#111111',
    titleColor: '#000000', font: '"Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
    titleSize: 38, bodySize: 20,
  },
];

export function themeById(id) {
  return SLIDE_THEMES.find(t => t.id === id) || SLIDE_THEMES[0];
}
