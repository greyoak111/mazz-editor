// renderer/modules/draw/ora.js —— OpenRaster (.ora) 导出：画板 → 工程文件（Krita/CSP/PS 可读）
import JSZip from 'jszip';
import { getStroke } from 'perfect-freehand';

/** 把单帧按图层导出为 ORA 包（异步返回 ArrayBuffer） */
export async function exportOra(frame, { width = 1600, height = 900 } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'image/openraster');
  const layerEntries = [];
  const merged = document.createElement('canvas');
  merged.width = width; merged.height = height;
  const mctx = merged.getContext('2d');
  mctx.fillStyle = '#ffffff';
  mctx.fillRect(0, 0, width, height);

  for (let i = frame.layers.length - 1; i >= 0; i--) {
    const layer = frame.layers[i];
    if (!layer.visible) continue;
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    ctx.globalAlpha = layer.opacity ?? 1;
    for (const img of layer.images) if (img._el) ctx.drawImage(img._el, img.x, img.y, img.w, img.h);
    for (const s of layer.strokes) {
      const outline = getStroke(s.pts.map(p => [p.x, p.y, p.p ?? 0.5]), { size: s.size, thinning: 0.55, smoothing: 0.5, streamline: 0.4, last: true });
      if (outline.length) {
        const path = new Path2D();
        path.moveTo(outline[0][0], outline[0][1]);
        for (let k = 1; k < outline.length; k++) path.lineTo(outline[k][0], outline[k][1]);
        path.closePath();
        ctx.globalAlpha = (s.opacity ?? 1) * (layer.opacity ?? 1);
        ctx.fillStyle = s.color;
        ctx.fill(path);
      }
    }
    const name = `layer${i}.png`;
    zip.file('data/' + name, c.toDataURL('image/png').split(',')[1], { base64: true });
    mctx.drawImage(c, 0, 0);
    layerEntries.push({ name: 'data/' + name, title: layer.name || `图层 ${i + 1}`, x: 0, y: 0, opacity: layer.opacity ?? 1, visible: true });
  }

  zip.file('mergedimage.png', merged.toDataURL('image/png').split(',')[1], { base64: true });
  zip.file('Thumbnails/thumbnail.png', merged.toDataURL('image/png').split(',')[1], { base64: true });
  zip.file('stack.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<image w="${width}" h="${height}">\n  <stack>\n` +
    layerEntries.map(l => `    <layer name="${escapeXml(l.title)}" src="${l.name}" x="${l.x}" y="${l.y}" opacity="${l.opacity}" visibility="visible" composite-op="svg:src-over"/>`).join('\n') +
    '\n  </stack>\n</image>');
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

function escapeXml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
