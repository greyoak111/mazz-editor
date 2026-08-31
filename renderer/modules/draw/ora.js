// renderer/modules/draw/ora.js —— OpenRaster (.ora) 导出：画板 → 工程文件（Krita/CSP/PS 可读）
import JSZip from 'jszip';
import { renderStroke } from './stroke-render.js';

function drawWithState(ctx, opacity, run) {
  ctx.save();
  try {
    ctx.globalAlpha = opacity;
    run();
  } finally { ctx.restore(); }
}

/** ORA 与画板共用的数据语义：填充补丁 → 图片 → 形状 → 笔画。 */
export function paintOraLayer(ctx, layer, { fillElement = layer?._fillEl || null } = {}) {
  if (!layer) return;
  if (fillElement) drawWithState(ctx, 1, () => ctx.drawImage(fillElement, 0, 0));
  for (const img of layer.images || []) {
    if (img._el) drawWithState(ctx, img.opacity ?? 1, () => ctx.drawImage(img._el, img.x, img.y, img.w, img.h));
  }
  for (const sh of layer.shapes || []) {
    drawWithState(ctx, sh.opacity ?? 1, () => {
      ctx.strokeStyle = sh.color;
      ctx.fillStyle = sh.color;
      ctx.lineWidth = sh.lineWidth || 2;
      const [x1, y1, x2, y2] = [Math.min(sh.x1, sh.x2), Math.min(sh.y1, sh.y2), Math.max(sh.x1, sh.x2), Math.max(sh.y1, sh.y2)];
      if (sh.kind === 'rect') {
        sh.fill ? ctx.fillRect(x1, y1, x2 - x1, y2 - y1) : ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      } else if (sh.kind === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2, 0, 0, Math.PI * 2);
        sh.fill ? ctx.fill() : ctx.stroke();
      } else if (sh.kind === 'line') {
        ctx.beginPath(); ctx.moveTo(sh.x1, sh.y1); ctx.lineTo(sh.x2, sh.y2); ctx.stroke();
      } else if (sh.kind === 'text') {
        ctx.font = `${sh.bold ? '700' : '400'} ${sh.size || 18}px ${sh.family || 'sans-serif'}`;
        ctx.textBaseline = 'top';
        String(sh.text || '').split('\n').forEach((text, index) => ctx.fillText(text, sh.x1, sh.y1 + index * (sh.size || 18) * 1.3));
      }
    });
  }
  for (const stroke of layer.strokes || []) {
    // 与主画布同一渲染口：笔型参数、印章/喷枪、透明度和擦除全部保真。
    renderStroke(ctx, stroke);
  }
}

async function resolveFillElement(layer) {
  if (layer?._fillEl) return layer._fillEl;
  if (!layer?.fillPatch) return null;
  if (typeof Image !== 'function') throw new Error('ORA 导出无法加载图层填充补丁');
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('ORA 导出无法加载图层填充补丁'));
    image.src = layer.fillPatch;
  });
}

/** 把单帧按图层导出为 ORA 包（异步返回 ArrayBuffer） */
export async function exportOra(frame, { width = 1600, height = 900 } = {}) {
  const zip = new JSZip();
  // OpenRaster 要求 mimetype 为 ZIP 首项且 STORE（不压缩）。
  zip.file('mimetype', 'image/openraster', { compression: 'STORE' });
  const layerEntries = [];
  const merged = document.createElement('canvas');
  merged.width = width; merged.height = height;
  const mctx = merged.getContext('2d');
  mctx.fillStyle = '#ffffff';
  mctx.fillRect(0, 0, width, height);

  // 画板 layers 按底→顶存储：merged 必须同序合成；stack.xml 则按顶→底声明。
  for (let i = 0; i < frame.layers.length; i++) {
    const layer = frame.layers[i];
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    paintOraLayer(ctx, layer, { fillElement: await resolveFillElement(layer) });
    const name = `layer${i}.png`;
    zip.file('data/' + name, c.toDataURL('image/png').split(',')[1], { base64: true });
    if (layer.visible !== false) drawWithState(mctx, layer.opacity ?? 1, () => mctx.drawImage(c, 0, 0));
    layerEntries.push({ name: 'data/' + name, title: layer.name || `图层 ${i + 1}`, x: 0, y: 0, opacity: layer.opacity ?? 1, visible: layer.visible !== false });
  }

  zip.file('mergedimage.png', merged.toDataURL('image/png').split(',')[1], { base64: true });
  zip.file('Thumbnails/thumbnail.png', merged.toDataURL('image/png').split(',')[1], { base64: true });
  zip.file('stack.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<image w="${width}" h="${height}">\n  <stack>\n` +
    [...layerEntries].reverse().map(l => `    <layer name="${escapeXml(l.title)}" src="${l.name}" x="${l.x}" y="${l.y}" opacity="${l.opacity}" visibility="${l.visible ? 'visible' : 'hidden'}" composite-op="svg:src-over"/>`).join('\n') +
    '\n  </stack>\n</image>');
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

function escapeXml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
