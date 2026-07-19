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
    bg: bgHex, bgElev: cardHex, bgHover: hoverHex, bgActive: activeHex,
    fg: fgHex, fgDim: hslToHex(darkest.h, Math.min(darkest.s, 0.3), 0.38), border: fgHex,
    accent: accHex, accentSoft: softHex, accentFg: cardHex,
    danger: accHex, warn: acc2Hex, ok: okHex,
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
      fg: vars.fg, 'fg-dim': vars.fgDim, border: vars.border,
      accent: vars.accent, 'accent-soft': vars.accentSoft, 'accent-fg': vars.accentFg,
      danger: vars.danger, warn: vars.warn, ok: vars.ok,
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
