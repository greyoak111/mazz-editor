// renderer/modules/draw/stroke-render.js —— 画板与 ORA 共用的笔画渲染真源
import { getStroke } from 'perfect-freehand';
import { BRUSH_TYPES, makeTipCanvas } from './brushes.js';

/** freehand stroke 点列 → Path2D（按笔刷类型与自定义参数调整） */
export function strokePath(stroke) {
  const bt = BRUSH_TYPES[stroke.brush] || BRUSH_TYPES.pen;
  const outline = getStroke((stroke.pts || []).map(p => [p.x, p.y, p.p ?? 0.5]), {
    size: stroke.size,
    thinning: bt.thinning ?? 0.55,
    smoothing: stroke.smoothing ?? bt.smoothing ?? 0.5,
    streamline: stroke.streamline ?? bt.streamline ?? 0.4,
    easing: t => t,
    last: true,
  });
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) path.lineTo(outline[i][0], outline[i][1]);
  path.closePath();
  return path;
}

/** 印章类笔刷渲染（沿点列间隔盖章） */
export function drawStampStroke(ctx, stroke) {
  const bt = BRUSH_TYPES[stroke.brush] || {};
  const tip = stroke._tip || (stroke._tip = stroke.tipImageEl || makeTipCanvas(bt.stamp === 'air' ? 'air' : 'soft', stroke.size, stroke.color));
  const gap = Math.max(1.5, stroke.size * (bt.stamp === 'air' ? 0.35 : 0.22));
  let acc = 0;
  let prev = null;
  ctx.save();
  try {
    ctx.globalAlpha = stroke.opacity ?? bt.opacity ?? 1;
    for (const point of stroke.pts || []) {
      if (prev) {
        const distance = Math.hypot(point.x - prev.x, point.y - prev.y);
        let offset = acc;
        while (offset < distance) {
          const ratio = distance ? offset / distance : 0;
          ctx.drawImage(tip, prev.x + (point.x - prev.x) * ratio - stroke.size / 2, prev.y + (point.y - prev.y) * ratio - stroke.size / 2, stroke.size, stroke.size);
          offset += gap;
        }
        acc = offset - distance;
      }
      prev = point;
    }
  } finally { ctx.restore(); }
}

/** 统一笔画渲染入口：主画布、离屏栅格化与 ORA 不得分叉。 */
export function renderStroke(ctx, stroke) {
  if (stroke.erase) {
    if (!stroke._path) stroke._path = strokePath(stroke);
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000000';
      ctx.fill(stroke._path);
    } finally { ctx.restore(); }
    return;
  }
  if (BRUSH_TYPES[stroke.brush]?.stamp || stroke.stampMode) {
    drawStampStroke(ctx, stroke);
    return;
  }
  if (!stroke._path) stroke._path = strokePath(stroke);
  ctx.save();
  try {
    ctx.globalAlpha = stroke.opacity ?? (BRUSH_TYPES[stroke.brush]?.opacity ?? 1);
    ctx.fillStyle = stroke.color || '#000000';
    ctx.fill(stroke._path);
  } finally { ctx.restore(); }
}
