// renderer/theme-custom.js —— 图片取色自定义主题：像素提取 → 构成主义角色分配 → 达标校验 → 注入应用
import { toast } from './shell/shell.js';

// ==================== 颜色工具 ====================
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.min(Math.max(s, 0), 1); l = Math.min(Math.max(l, 0), 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}
const hueDist = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/** 实色状态底必须自带可验证前景；在深/浅基准中选 WCAG 对比更高者。 */
function pairedForeground(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(String(hex || ''))) return '#ffffff';
  const luminance = (value) => {
    const channels = value.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  return ratio(hex, '#111827') >= ratio(hex, '#ffffff') ? '#111827' : '#ffffff';
}

// ==================== 提取（量化分桶：色相 12 桶 × 明度 3 层） ====================
/** pixels: RGBA Uint8ClampedArray。返回 {palette:[{h,s,l,count}], stats} */
export function extractPalette(pixels, { maxColors = 6 } = {}) {
  const buckets = new Map(); // key -> {count, h, s, l}
  let total = 0, vividTotal = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 128) continue;
    total++;
    const { h, s, l } = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    const vivid = s > 0.12 && l > 0.08 && l < 0.95;
    if (vivid) vividTotal++;
    const key = Math.round(h / 30) * 30 + '-' + Math.round(l * 2);
    const b = buckets.get(key) || { count: 0, h: 0, s: 0, l: 0 };
    b.count++;
    b.h += h; b.s += s; b.l += l;
    buckets.set(key, b);
  }
  const palette = [...buckets.values()]
    .map(b => ({ h: b.h / b.count, s: b.s / b.count, l: b.l / b.count, count: b.count }))
    .sort((x, y) => y.count - x.count)
    .slice(0, maxColors * 2)
    .filter(c => c.s > 0.1)
    .slice(0, maxColors);
  return {
    palette,
    stats: {
      total,
      vividRatio: total ? vividTotal / total : 0,
      vividCount: palette.length,
      avgSat: palette.length ? palette.reduce((n, c) => n + c.s, 0) / palette.length : 0,
    },
  };
}

/** 达标评估：有效色占比、颜色数、平均饱和度 */
export function assessColors(stats) {
  const fails = [];
  if (stats.vividRatio < 0.18) fails.push('彩色像素太少（画面偏灰/黑白）');
  if (stats.vividCount < 3) fails.push('可分辨的颜色不足 3 种');
  if (stats.avgSat < 0.2) fails.push('颜色饱和度整体偏低');
  return { ok: fails.length === 0, fails };
}

// ==================== 构成主义角色分配 ====================
/** 主色=最醒目暖色（红橙优先）· 深=正文/描边 · 浅=纸底 · 点缀=对比色 */
export function assignRoles(palette) {
  const warm = palette.filter(c => c.h <= 70 || c.h >= 330);
  const accent = (warm.length ? warm : palette).reduce((a, b) => (a.s * a.count > b.s * b.count ? a : b));
  const rest = palette.filter(c => c !== accent);
  const accent2 = rest.length
    ? rest.reduce((a, b) => (hueDist(a.h, accent.h) > hueDist(b.h, accent.h) ? a : b))
    : { h: (accent.h + 150) % 360, s: 0.5, l: 0.5 };
  const darkest = palette.reduce((a, b) => (a.l < b.l ? a : b));
  const lightest = palette.reduce((a, b) => (a.l > b.l ? a : b));

  const accHex = hslToHex(accent.h, Math.min(accent.s * 1.1, 1), Math.min(Math.max(accent.l, 0.32), 0.46));
  const acc2Hex = hslToHex(accent2.h, Math.min(accent2.s, 0.85), Math.min(Math.max(accent2.l, 0.36), 0.55));
  const fgHex = hslToHex(darkest.h, Math.min(darkest.s, 0.5), 0.13);
  const bgHex = hslToHex(lightest.h, Math.min(lightest.s * 0.32, 0.4), 0.9);
  const cardHex = hslToHex(lightest.h, Math.min(lightest.s * 0.28, 0.36), 0.935);
  const hoverHex = hslToHex(lightest.h, Math.min(lightest.s * 0.35, 0.42), 0.855);
  const activeHex = hslToHex(lightest.h, Math.min(lightest.s * 0.38, 0.45), 0.8);
  const softHex = hslToHex(accent.h, Math.min(accent.s * 0.45, 0.5), 0.85);
  const okHex = hslToHex(115, 0.45, 0.32);

  return {
    bg: bgHex, bgElev: cardHex, bgHover: hoverHex, bgActive: activeHex, bgSoft: hoverHex,
    fg: fgHex, fgDim: hslToHex(darkest.h, Math.min(darkest.s, 0.3), 0.38), border: fgHex,
    accent: accHex, accentSoft: softHex, accentFg: cardHex,
    danger: accHex, dangerFg: pairedForeground(accHex),
    warn: acc2Hex, warnFg: pairedForeground(acc2Hex),
    ok: okHex, okFg: pairedForeground(okHex),
    docBg: cardHex,
    acc: accHex, bd: fgHex, bd2: activeHex, card: cardHex,
    mut: hslToHex(darkest.h, Math.min(darkest.s, 0.3), 0.38),
    faint: hslToHex(darkest.h, Math.min(darkest.s, 0.25), 0.55),
    sh: 'rgba(0,0,0,.18)',
  };
}

// ==================== 注入与恢复 ====================
export function injectCustomTheme(vars) {
  let el = document.getElementById('custom-image-theme');
  if (!el) {
    el = document.createElement('style');
    el.id = 'custom-image-theme';
    document.head.appendChild(el);
  }
  el.textContent = `[data-theme="custom"] {\n` +
    Object.entries({
      bg: vars.bg, 'bg-elev': vars.bgElev, 'bg-hover': vars.bgHover, 'bg-active': vars.bgActive,
      'bg-soft': vars.bgSoft || vars.bgHover,
      fg: vars.fg, 'fg-dim': vars.fgDim, border: vars.border,
      accent: vars.accent, 'accent-soft': vars.accentSoft, 'accent-fg': vars.accentFg,
      danger: vars.danger, 'danger-fg': vars.dangerFg || pairedForeground(vars.danger),
      warn: vars.warn, 'warn-fg': vars.warnFg || pairedForeground(vars.warn),
      ok: vars.ok, 'ok-fg': vars.okFg || pairedForeground(vars.ok),
      shadow: `5px 5px 0 ${vars.border}`, 'doc-bg': vars.docBg,
      acc: vars.acc, bd: vars.bd, bd2: vars.bd2, card: vars.card,
      mut: vars.mut, faint: vars.faint, sh: vars.sh,
    }).map(([k, v]) => `  --${k}: ${v};`).join('\n') + '\n}';
}

export async function applyImageTheme() {
  if (!window.mazz?.isElectron) { toast('图片取色需要桌面版'); return false; }
  const p = await window.mazz.invoke('dialog:openFile', {
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
  });
  if (!p) return false;
  const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p });
  const ext = p.split('.').pop().toLowerCase().replace('jpg', 'jpeg');
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `data:image/${ext};base64,${b64}`; });
  const SIZE = 96;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = Math.max(1, Math.round(img.height / img.width * SIZE));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { palette, stats } = extractPalette(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  const assess = assessColors(stats);
  if (!assess.ok) {
    toast('这张图片无法配色：' + assess.fails.join('、') + '——请换一张色彩更鲜明的图片', [], 5000);
    return false;
  }
  const vars = assignRoles(palette);
  injectCustomTheme(vars);
  document.documentElement.dataset.theme = 'custom';
  await window.mazz.invoke('settings:set', { key: 'theme', value: 'custom' }).catch(() => {});
  await window.mazz.invoke('settings:set', { key: 'ui.customThemeVars', value: vars }).catch(() => {});
  // 广播外部窗格跟随。这里只发 id 会让已打开的 PanelWindow 先切到 custom
  // 结构、却继续沿用上一主题的颜色变量；统一复用 Shell 的 computed snapshot，
  // 连同 panel corner/shadow 等结构令牌一次送达。
  if (window.MazzShell?._broadcastThemeNow) window.MazzShell._broadcastThemeNow();
  else window.mazz?.invoke('theme:broadcast', { id: 'custom' }).catch(() => {});
  // 落盘到工作区 themes/（用户可命名，此后出现在主题包列表里）——v42 需求
  try {
    const { inputModal } = await import('./shell/shell.js');
    const name = await inputModal('主题命名（存到 themes/ 文件夹，可在主题列表复用）', p.split(/[\\/]/).pop().replace(/\.\w+$/, '') + '主题');
    if (name?.trim()) {
      const { savePack } = await import('./lib/theme-store.js');
      const { wsPath } = await import('./lib/ws-path.js');
      const dir = await wsPath('/themes');
      await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
      const safe = name.trim().replace(/[\\/:*?"<>|]/g, '-');
      // 键名对齐主题包规范（VAR_KEYS 全量 26 键 kebab-case；图片主题为浅色基底）
      // 主套 19 键 + 模块第二套（acc/bd/bd2/card/mut/faint/sh）+ structure 结构镜像——缺一样，重载后构成主义就缺腿
      const packVars = {
        bg: vars.bg, 'bg-elev': vars.bgElev, 'bg-hover': vars.bgHover, 'bg-active': vars.bgActive, 'bg-soft': vars.bgSoft,
        fg: vars.fg, 'fg-dim': vars.fgDim, border: vars.border,
        accent: vars.accent, 'accent-soft': vars.accentSoft, 'accent-fg': vars.accentFg,
        danger: vars.danger, 'danger-fg': vars.dangerFg,
        warn: vars.warn, 'warn-fg': vars.warnFg,
        ok: vars.ok, 'ok-fg': vars.okFg,
        shadow: `5px 5px 0 ${vars.border}`, 'doc-bg': vars.docBg,
        acc: vars.acc, bd: vars.bd, bd2: vars.bd2, card: vars.card,
        mut: vars.mut, faint: vars.faint, sh: vars.sh,
      };
      const pack = {
        name: name.trim(),
        base: 'paper',
        structure: 'custom', // 结构镜像：重载时把构成主义骨架（硬边/斜切/投影）一并套上
        vars: packVars,
      };
      await window.mazz.invoke('fs:writeFile', { path: `${dir}/${safe}.json`, content: JSON.stringify(pack, null, 2) });
      toast(`主题已生成并存储到 themes/${safe}.json`);
      return true;
    }
  } catch {}
  toast('已生成自定义主题（构成主义配色）');
  return true;
}

/** 启动时恢复上次的图片自定义主题 */
export async function restoreImageTheme() {
  const theme = await window.mazz?.invoke('settings:get', { key: 'theme' }).catch(() => null);
  if (theme !== 'custom') return false;
  const vars = await window.mazz.invoke('settings:get', { key: 'ui.customThemeVars' }).catch(() => null);
  if (!vars) return false;
  injectCustomTheme(vars);
  return true;
}
