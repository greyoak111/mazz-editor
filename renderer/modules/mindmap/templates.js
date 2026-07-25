// renderer/modules/mindmap/templates.js —— 思维导图样式模板：预置 + 工作区自定义（仿 UI 主题包思路）
// 模板 = { name, levels: [颜色...], font, radius, rootBg, connColor, noteBg }
export const PRESET_TEMPLATES = [
  {
    id: 'classic', name: '经典', builtin: true,
    levels: ['#4f46e5', '#0ea5e9', '#059669', '#d97706', '#dc2626', '#7c3aed'],
    font: null, radius: 9, rootBg: null, connColor: '#d8d6cf', noteBg: '#fde68a',
  },
  {
    id: 'minimal', name: '简约', builtin: true,
    levels: ['#1a1a1a', '#525252', '#737373', '#a3a3a3', '#d4d4d4', '#e5e5e5'],
    font: 'Georgia, serif', radius: 4, rootBg: '#1a1a1a', connColor: '#d4d4d4', noteBg: '#f5f5f5',
  },
  {
    id: 'night', name: '暗夜', builtin: true,
    levels: ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#c084fc'],
    font: null, radius: 12, rootBg: '#312e81', connColor: '#475569', noteBg: '#334155',
  },
  {
    id: 'candy', name: '糖果', builtin: true,
    levels: ['#ec4899', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6'],
    font: null, radius: 16, rootBg: null, connColor: '#f9a8d4', noteBg: '#fef3c7',
  },
];

export const TPL_DIR = '/mindmap-templates'; // 相对工作区；绝对路径用 tplDir()
export async function tplDir() {
  const { wsPath } = await import('../../lib/ws-path.js');
  return wsPath(TPL_DIR);
}

export function blankTemplate() {
  return JSON.stringify({
    _说明: [
      '思维导图样式模板：levels 为各级节点配色（循环使用），rootBg 根节点底色（留空用一级色），',
      'connColor 连接线颜色，noteBg 便笺底色，radius 节点圆角(px)，font 字体（留空默认）。',
      '保存为 .json 放进 mindmap-templates/ 即出现在模板选单里；删除文件即删除模板。',
    ],
    name: '',
    levels: ['#4f46e5', '#0ea5e9', '#059669', '#d97706', '#dc2626', '#7c3aed'],
    font: null,
    radius: 9,
    rootBg: null,
    connColor: '#d8d6cf',
    noteBg: '#fde68a',
  }, null, 2);
}

export function validateTemplate(raw, fallbackName) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || !Array.isArray(obj.levels) || !obj.levels.length) return null;
  return {
    name: (obj.name || fallbackName || '未命名模板').trim(),
    levels: obj.levels.filter(c => typeof c === 'string' && c.trim()),
    font: obj.font || null,
    radius: Math.max(0, Math.min(30, +obj.radius || 9)),
    rootBg: obj.rootBg || null,
    connColor: obj.connColor || '#d8d6cf',
    noteBg: obj.noteBg || '#fde68a',
  };
}

export async function listTemplates() {
  const customs = [];
  const entries = (await window.mazz.invoke('fs:listDir', { path: await tplDir() }).catch(() => [])) || [];
  for (const e of entries) {
    if (e.isDir || !e.name.endsWith('.json')) continue;
    try {
      const t = validateTemplate(await window.mazz.invoke('fs:readFile', { path: e.path }), e.name.replace('.json', ''));
      if (t) customs.push({ ...t, id: e.name.replace('.json', ''), builtin: false });
    } catch {}
  }
  return [...PRESET_TEMPLATES, ...customs];
}

export async function deleteTemplate(id) {
  await window.mazz.invoke('fs:delete', { path: `${await tplDir()}/${id}.json` }).catch(() => {});
}

export async function obtainBlankTemplate() {
  const dir = await tplDir();
  await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
  for (let i = 0; ; i++) {
    const name = i === 0 ? '空白模板' : `空白模板 (${i})`;
    const path = `${dir}/${name}.json`;
    const st = await window.mazz.invoke('fs:stat', { path }).catch(() => ({ exists: false }));
    if (!st.exists) {
      await window.mazz.invoke('fs:writeFile', { path, content: blankTemplate() });
      return path;
    }
  }
}
