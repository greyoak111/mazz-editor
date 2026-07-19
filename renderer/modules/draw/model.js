// renderer/modules/draw/model.js —— 画板数据模型：文档结构 / 笔画命中检测 / 快照历史栈

let seq = 1;
const nid = (p) => p + (seq++) + '-' + Date.now().toString(36);

export function createStroke(pts, color, size) {
  return { id: nid('s'), pts, color, size };
}
export function createLayer(name) {
  return { id: nid('l'), name: name || '图层', visible: true, opacity: 1, strokes: [], images: [] };
}
export function createFrame() {
  return { id: nid('f'), layers: [createLayer('图层 1')] };
}
export function createDoc() {
  return { mark: 'mazz-draw-v1', frames: [createFrame()], current: 0 };
}

/** 点到线段最短距离 */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** 点到笔画（折线）的最短距离 */
export function distToStroke(stroke, px, py) {
  const pts = stroke.pts;
  if (!pts.length) return Infinity;
  if (pts.length === 1) return Math.hypot(px - pts[0].x, py - pts[0].y);
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (d < min) min = d;
  }
  return min;
}

/** 命中检测：返回最上层被点中的笔画（含笔宽容差），无则 null */
export function hitStroke(layer, px, py, extraTol = 4) {
  for (let i = layer.strokes.length - 1; i >= 0; i--) {
    const s = layer.strokes[i];
    const tol = (s.size || 4) / 2 + extraTol;
    if (distToStroke(s, px, py) <= tol) return s;
  }
  return null;
}

/** 跨图层命中（从上往下） */
export function hitAnyStroke(frame, px, py, extraTol = 4) {
  for (let li = frame.layers.length - 1; li >= 0; li--) {
    const layer = frame.layers[li];
    if (!layer.visible) continue;
    const s = hitStroke(layer, px, py, extraTol);
    if (s) return { stroke: s, layer };
  }
  return null;
}

/** 平移笔画 */
export function moveStroke(stroke, dx, dy) {
  for (const p of stroke.pts) { p.x += dx; p.y += dy; }
}

/** 笔画包围盒 */
export function strokeBBox(stroke) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of stroke.pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

// ==================== 快照历史栈 ====================
export class SnapshotStack {
  constructor(limit = 40) {
    this.limit = limit;
    this.undoList = [];
    this.redoList = [];
  }
  push(docJson) {
    this.undoList.push(docJson);
    if (this.undoList.length > this.limit) this.undoList.shift();
    this.redoList.length = 0;
  }
  undo(currentJson) {
    if (!this.undoList.length) return null;
    this.redoList.push(currentJson);
    return this.undoList.pop();
  }
  redo(currentJson) {
    if (!this.redoList.length) return null;
    this.undoList.push(currentJson);
    return this.redoList.pop();
  }
  clear() { this.undoList.length = 0; this.redoList.length = 0; }
}
