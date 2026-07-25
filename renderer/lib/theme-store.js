// renderer/lib/theme-store.js —— 自定义主题包：空白模板 / 导入 / 持久化 / 增删 / 应用
// 存储：工作区 themes/ 目录（普通文件夹——随局域网同步、可在文件树/资源管理器里改名）
// 主题包 = 基底主题 + 变量覆盖：只覆盖填了的变量，空白包等价于纸白基底
const VAR_KEYS = [
  'bg', 'bg-elev', 'bg-hover', 'bg-active',
  'fg', 'fg-dim', 'border',
  'accent', 'accent-soft', 'accent-fg',
  'danger', 'warn', 'ok', 'shadow', 'doc-bg',
  // 模块自定义变量双套（构成主题同款第二套，缺了只剩主套=风格缺腿）
  'acc', 'bd', 'bd2', 'card', 'mut', 'faint', 'sh',
];

import { wsPath } from './ws-path.js';

export const THEMES_DIR = '/themes'; // 相对工作区；绝对路径用 themesDir()
/** 主题目录绝对路径（工作区 themes/） */
export async function themesDir() { return wsPath(THEMES_DIR); }

/** 空白主题包模板（设置页「获取空白主题包」写入的内容） */
export function blankTemplate() {
  const vars = {};
  for (const k of VAR_KEYS) vars[k] = '';
  return JSON.stringify({
    _说明: [
      'Mazz 自定义主题包：在 vars 里填入颜色值（如 #1a1a1a）即生效，留空的变量沿用基底主题。',
      'name 为主题显示名（不填则用文件名）。base 为基底主题（paper 纸白 / ink 墨黑），只影响留空变量。',
      '可用变量：' + VAR_KEYS.join(' / '),
      '改完保存后，在 设置 → UI 主题 里选择它；删除文件即删除主题。',
    ],
    name: '',
    base: 'paper',
    vars,
  }, null, 2);
}

/** 校验并规整主题包（非法 → 返回 null） */
export function validatePack(raw, fallbackName) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || !obj.vars || typeof obj.vars !== 'object') return null;
  const vars = {};
  for (const k of VAR_KEYS) {
    const v = obj.vars[k];
    if (typeof v === 'string' && v.trim()) vars[k] = v.trim();
  }
  return {
    name: (typeof obj.name === 'string' && obj.name.trim()) || fallbackName || '未命名主题',
    base: obj.base === 'ink' ? 'ink' : 'paper',
    structure: typeof obj.structure === 'string' ? obj.structure : undefined, // 结构镜像（custom=构成主义骨架）
    vars,
  };
}

async function ensureDir() {
  await window.mazz.invoke('fs:mkdir', { path: await themesDir() }).catch(() => {});
}

/** 列出全部自定义主题包 [{id, name, base, vars, path}]（id = 文件名去后缀） */
export async function listPacks() {
  const entries = await window.mazz.invoke('fs:listDir', { path: await themesDir() }).catch(() => []);
  const out = [];
  for (const e of entries) {
    if (e.isDir || !e.name.toLowerCase().endsWith('.json')) continue;
    const text = await window.mazz.invoke('fs:readFile', { path: e.path }).catch(() => null);
    const pack = text && validatePack(text, e.name.replace(/\.json$/i, ''));
    if (pack) out.push({ id: e.name.replace(/\.json$/i, ''), path: e.path, ...pack });
  }
  return out;
}

/** 保存主题包（新增或覆盖） */
export async function savePack(id, pack) {
  await ensureDir();
  const safe = String(id).replace(/[\\/:*?"<>|]/g, '-');
  const data = JSON.stringify({ name: pack.name, base: pack.base, ...(pack.structure ? { structure: pack.structure } : {}), vars: pack.vars }, null, 2);
  const path = `${await themesDir()}/${safe}.json`;
  await window.mazz.invoke('fs:writeFile', { path, content: data });
  return path;
}

export async function deletePack(id) {
  await window.mazz.invoke('fs:delete', { path: `${await themesDir()}/${id}.json` }).catch(() => {});
}

/** 把主题包变量注入为 [data-theme="pack:<id>"] 样式（基底变量兜底在 themes.css 的 paper/ink） */
export function injectPack(id, pack) {
  const sel = `pack:${id}`;
  let el = document.getElementById('mazz-pack-theme');
  if (!el) {
    el = document.createElement('style');
    el.id = 'mazz-pack-theme';
    document.head.appendChild(el);
  }
  const lines = Object.entries(pack.vars).map(([k, v]) => `  --${k}: ${v};`).join('\n');
  el.textContent = `[data-theme="${sel}"] {\n${lines || '  /* 空包：全量沿用基底 */'}\n}`;
  return sel;
}

/** 应用主题包：注入 + 切换 data-theme + 基底 class 兜底 */
export function applyPack(id, pack) {
  const sel = injectPack(id, pack);
  document.documentElement.dataset.theme = sel;
  // 空变量的部分回退到基底主题变量：临时并列基底选择器再被覆盖式注入
  let base = document.getElementById('mazz-pack-base');
  if (!base) {
    base = document.createElement('style');
    base.id = 'mazz-pack-base';
    document.head.appendChild(base);
  }
  // 复用 themes.css 的基底定义：把基底选择器改写成当前选择器，优先级低于注入（注入在后）
  const baseRules = [...document.styleSheets].flatMap(ss => {
    try { return [...ss.cssRules]; } catch { return []; }
  }).filter(r => r.selectorText === `[data-theme="${pack.base}"]`);
  base.textContent = baseRules.map(r => r.cssText.replace(`[data-theme="${pack.base}"]`, `[data-theme="${sel}"]`)).join('\n');
  // 结构镜像（图片主题等声明了 structure 的包）：把目标结构主题的全部选择器改写到本包——
  // 否则重载后的包只有颜色没有构成主义骨架（硬边/斜切/投影全丢）
  if (pack.structure) {
    const src = `[data-theme="${pack.structure}"]`;
    const structRules = [...document.styleSheets].flatMap(ss => {
      try { return [...ss.cssRules]; } catch { return []; }
    }).filter(r => r.selectorText && r.selectorText.includes(src) && r.selectorText !== src);
    base.textContent += '\n' + structRules.map(r => r.cssText.split(src).join(`[data-theme="${sel}"]`)).join('\n');
  }
  // 注入放最后保证覆盖
  document.head.appendChild(document.getElementById('mazz-pack-theme'));
}

/** 导入：从文件内容注册为工作区主题包（自动命名避让） */
export async function importPack(text, fileName = '导入主题') {
  const pack = validatePack(text, fileName.replace(/\.json$/i, ''));
  if (!pack) throw new Error('不是合法的主题包（需要含 vars 的 JSON）');
  await ensureDir();
  let id = pack.name || fileName.replace(/\.json$/i, '');
  id = id.replace(/[\\/:*?"<>|]/g, '-');
  for (let i = 0; ; i++) {
    const cand = i === 0 ? id : `${id} (${i})`;
    const st = await window.mazz.invoke('fs:stat', { path: `${await themesDir()}/${cand}.json` }).catch(() => ({ exists: false }));
    if (!st.exists) {
      await savePack(cand, pack);
      return cand;
    }
  }
}

/** 获取空白主题包 → 写入 themes/ 并返回路径（不存在同名则避让） */
export async function obtainBlankPack() {
  await ensureDir();
  for (let i = 0; ; i++) {
    const name = i === 0 ? '空白主题包' : `空白主题包 (${i})`;
    const path = `${await themesDir()}/${name}.json`;
    const st = await window.mazz.invoke('fs:stat', { path }).catch(() => ({ exists: false }));
    if (!st.exists) {
      await window.mazz.invoke('fs:writeFile', { path, content: blankTemplate() });
      return path;
    }
  }
}
