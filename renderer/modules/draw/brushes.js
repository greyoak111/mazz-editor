// renderer/modules/draw/brushes.js —— 笔刷引擎 v2：多笔型 / 参数 / 自定义笔刷 / .abr 导入
// 每种笔刷 = { id, name, type, size, opacity, smoothing, stabilize, tipImage?, custom? }
// 渲染策略：freehand 轮廓填充（pen/marker/soft/watercolor/calligraphy）或笔尖印章（stamp，.abr 导入）

export const BRUSH_TYPES = {
  pen: { name: '钢笔', thinning: 0.55, opacity: 1, smoothing: 0.5, streamline: 0.4 },
  pencil: { name: '铅笔', thinning: 0.3, opacity: 0.55, smoothing: 0.35, streamline: 0.3 },
  marker: { name: '马克笔', thinning: 0.05, opacity: 0.45, smoothing: 0.6, streamline: 0.5 },
  airbrush: { name: '喷枪', thinning: 0.0, opacity: 0.18, smoothing: 0.7, streamline: 0.65, stamp: 'air' },
  watercolor: { name: '水彩', thinning: 0.35, opacity: 0.35, smoothing: 0.75, streamline: 0.6 },
  calligraphy: { name: '书法', thinning: 0.85, opacity: 1, smoothing: 0.45, streamline: 0.35 },
  soft: { name: '柔边笔', thinning: 0.0, opacity: 0.5, smoothing: 0.8, streamline: 0.7, stamp: 'soft' },
  stamp: { name: '印章/图像笔', thinning: 0.0, opacity: 1, smoothing: 0.4, streamline: 0.4, stamp: 'image' },
};

export const DEFAULT_BRUSHES = Object.entries(BRUSH_TYPES).map(([id, t]) => ({
  id, name: t.name, type: id, size: id === 'airbrush' || id === 'soft' ? 26 : 6,
  opacity: t.opacity, smoothing: t.smoothing, streamline: t.streamline, stabilize: 0,
}));

/** 笔尖印章生成（soft/air 程序生成，image 用 .abr/自定义图） */
export function makeTipCanvas(kind, size, color) {
  const d = Math.max(8, Math.ceil(size));
  const c = document.createElement('canvas');
  c.width = c.height = d;
  const ctx = c.getContext('2d');
  const cx = d / 2;
  if (kind === 'soft' || kind === 'air') {
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    const hard = kind === 'soft' ? 0.0 : 0.15;
    g.addColorStop(0, colorWithAlpha(color, 1));
    g.addColorStop(Math.min(0.6, 0.25 + hard), colorWithAlpha(color, kind === 'soft' ? 0.6 : 0.35));
    g.addColorStop(1, colorWithAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, d, d);
  } else if (kind === 'pencil') {
    ctx.fillStyle = colorWithAlpha(color, 0.9);
    for (let i = 0; i < d * 2; i++) {
      const x = Math.random() * d, y = Math.random() * d;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}
export function colorWithAlpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#1a1a1a');
  const n = m ? parseInt(m[1], 16) : 0x1a1a1a;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ==================== .abr（Photoshop 笔刷）子集解析 ====================
/**
 * 解析 .abr v6/7/8：提取笔尖位图（16-bit gray → alpha）
 * 返回 [{name, width, height, dataUrl}]；不支持的段跳过
 */
export function parseAbr(buf) {
  const dv = new DataView(buf);
  const ver = dv.getUint16(0, false);
  if (ver < 6 || ver > 10) throw new Error('仅支持 .abr v6–v10');
  let off = 2;
  const tips = [];
  const u8 = new Uint8Array(buf);
  const str = (o, len, wide) => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(wide ? dv.getUint16(o + i * 2, false) : u8[o + i]);
    return s;
  };
  while (off + 4 <= dv.byteLength && tips.length < 64) {
    // 段：4 字节 key + 4 字节长度（大端）
    const key = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
    const len = dv.getUint32(off + 4, false);
    const body = off + 8;
    if (len <= 0 || body + len > dv.byteLength) break;
    if (key === 'patt') {
      try {
        let p = body;
        // name: pascal string (1 byte len) padded to 4
        const nl = dv.getUint8(p);
        const name = str(p + 1, nl, false) || ('tip' + tips.length);
        p += 1 + ((nl + 3) & ~3);
        // 跳到 height/width
        p += 4; // 跳过顶层长度占位（部分版本）
        const h = dv.getUint32(p, false), w = dv.getUint32(p + 4, false);
        p += 8;
        const depth = dv.getUint16(p, false); p += 2;
        p += 2; // mode
        if ((w > 0 && w <= 512 && h > 0 && h <= 512) && (depth === 8 || depth === 16)) {
          const bytes = depth === 16 ? 2 : 1;
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const cctx = c.getContext('2d');
          const img = cctx.createImageData(w, h);
          for (let i = 0; i < w * h && p + i * bytes + (bytes - 1) < body + len; i++) {
            const v = bytes === 2 ? dv.getUint16(p + i * 2, false) / 257 : u8[p + i];
            img.data[i * 4] = 30; img.data[i * 4 + 1] = 30; img.data[i * 4 + 2] = 30;
            img.data[i * 4 + 3] = 255 - v;
          }
          cctx.putImageData(img, 0, 0);
          tips.push({ name, width: w, height: h, dataUrl: c.toDataURL('image/png') });
        }
      } catch { /* 跳过坏段 */ }
    }
    off = body + len + (len % 2);
  }
  if (!tips.length) throw new Error('未解析到笔尖（该 .abr 可能是新版压缩格式）');
  return tips;
}

// ==================== 自定义笔刷存取（工作区 brushes/） ====================
export async function listCustomBrushes() {
  const { wsPath } = await import('../../lib/ws-path.js');
  const entries = (await window.mazz.invoke('fs:listDir', { path: await wsPath('/brushes') }).catch(() => [])) || [];
  const out = [];
  for (const e of entries) {
    if (e.isDir || !e.name.endsWith('.json')) continue;
    try {
      const obj = JSON.parse(await window.mazz.invoke('fs:readFile', { path: e.path }));
      if (obj?.type) out.push({ ...obj, id: 'custom:' + e.name.replace('.json', ''), custom: true });
    } catch {}
  }
  return out;
}
export async function saveCustomBrush(brush) {
  const { wsPath } = await import('../../lib/ws-path.js');
  const dir = await wsPath('/brushes');
  await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
  const name = (brush.name || '自定义笔刷').replace(/[\\/:*?"<>|]/g, '-');
  await window.mazz.invoke('fs:writeFile', {
    path: `${dir}/${name}.json`,
    content: JSON.stringify({ name: brush.name, type: brush.type, size: brush.size, opacity: brush.opacity, smoothing: brush.smoothing, streamline: brush.streamline, stabilize: brush.stabilize, tipImage: brush.tipImage || null }, null, 1),
  });
  return name;
}
