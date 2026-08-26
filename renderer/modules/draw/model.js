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

/** 将旧画板帧转换为 W94C 结构化 Canvas Document；不携带 data URL/运行时元素。 */
export function legacyFrameToCanvasDocument(frame, { documentId, workspaceIdentity, title = '' } = {}) {
  const safeToken = value => String(value ?? '').replace(/[^A-Za-z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '') || '0';
  const unique = (base, used) => { let id = base; let index = 2; while (used.has(id)) id = `${base}-${index++}`; used.add(id); return id; };
  const layerRows = [];
  const nodes = {};
  const usedLayers = new Set();
  const usedNodes = new Set();
  for (const [layerIndex, layer] of (frame?.layers || []).entries()) {
    const layerId = unique(`layer-legacy-${safeToken(layer.id || layerIndex)}`, usedLayers);
    const nodeIds = [];
    for (const stroke of layer.strokes || []) {
      const nodeId = unique(`stroke-${safeToken(stroke.id || `${layerIndex}-${nodeIds.length}`)}`, usedNodes);
      nodes[nodeId] = { nodeId, kind: 'path', x: 0, y: 0, width: 0, height: 0, rotation: 0, opacity: stroke.opacity ?? 1, visible: true, fill: stroke.color || '#000000', stroke: stroke.color || '#000000', strokeWidth: stroke.size || 1, text: '', points: (stroke.pts || []).map(point => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })), assetRef: null, children: [] };
      nodeIds.push(nodeId);
    }
    for (const shape of layer.shapes || []) {
      const nodeId = unique(`shape-${safeToken(shape.id || `${layerIndex}-${nodeIds.length}`)}`, usedNodes);
      const kind = shape.kind === 'ellipse' ? 'ellipse' : (shape.kind === 'text' ? 'text' : 'rect');
      nodes[nodeId] = { nodeId, kind, x: Number(shape.x1) || 0, y: Number(shape.y1) || 0, width: Math.abs((Number(shape.x2) || Number(shape.x1) || 0) - (Number(shape.x1) || 0)), height: Math.abs((Number(shape.y2) || Number(shape.y1) || 0) - (Number(shape.y1) || 0)), rotation: 0, opacity: shape.opacity ?? 1, visible: true, fill: shape.color || '#ffffff', stroke: shape.color || '#000000', strokeWidth: shape.lineWidth || 1, text: String(shape.text || ''), points: [], assetRef: null, children: [] };
      nodeIds.push(nodeId);
    }
    layerRows.push({ layerId, name: String(layer.name || `图层 ${layerIndex + 1}`), visible: layer.visible !== false, opacity: layer.opacity ?? 1, nodeIds });
  }
  return { schema: 'mazz.canvas-document/v1', documentId, workspaceIdentity, revision: 1, title, width: 960, height: 540, background: '#ffffff', layers: layerRows.length ? layerRows : [{ layerId: 'layer-legacy-0', name: 'Layer 1', visible: true, opacity: 1, nodeIds: [] }], nodes, selection: [], headOperationId: null };
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
