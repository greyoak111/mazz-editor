// renderer/modules/mindmap/model.js —— 思维导图模型 v2
// 多根森林 + 三种布局：自左向右(lr) / 自上向下(tb) / 全向环绕(radial，波纹式自由扩散)
// 节点：{id, text, children, collapsed, color?, style{...}, offX?, offY?, fx?, fy?}
// offX/offY = 树形布局下的手动偏移（自由拖拽）；fx/fy = 环绕布局下的自由坐标
let seq = 1;
export function createNode(text = '', id = null) {
  return { id: id || 'n' + (seq++) + '-' + Date.now().toString(36), text, children: [], collapsed: false };
}

// ==================== 森林遍历（兼容单根/多根） ====================
const F = (r) => Array.isArray(r) ? r : [r];

export function eachNode(roots, fn, depth = 0) {
  for (const n of F(roots)) {
    fn(n, depth, null);
    (function walk(x, d) { for (const c of x.children) { fn(c, d, x); walk(c, d + 1); } })(n, depth + 1);
  }
}
export function findNode(roots, id) {
  let hit = null;
  eachNode(roots, (n) => { if (n.id === id) hit = n; });
  return hit;
}
export function findParent(roots, id) {
  let hit = null;
  eachNode(roots, (n, d, p) => { if (n.id === id) hit = p; });
  return hit;
}
export function removeNode(roots, id) {
  if (!Array.isArray(roots)) {
    // 单根兼容：root 本身不可删，只能删子孙
    if (roots.id === id) return false;
  } else {
    const i = roots.findIndex(n => n.id === id);
    if (i >= 0) { roots.splice(i, 1); return true; }
  }
  const parent = findParent(roots, id);
  if (!parent) return false;
  const j = parent.children.findIndex(c => c.id === id);
  if (j >= 0) { parent.children.splice(j, 1); return true; }
  return false;
}
export function insertSibling(roots, id, node) {
  const parent = findParent(roots, id);
  if (!parent) {
    if (!Array.isArray(roots)) return appendChild(roots, id, node); // 单根的"同级" = 加子级
    const i = roots.findIndex(n => n.id === id);
    roots.splice(i + 1, 0, node);
    return node;
  }
  const i = parent.children.findIndex(c => c.id === id);
  parent.children.splice(i + 1, 0, node);
  return node;
}
export function appendChild(roots, id, node) {
  const n = findNode(roots, id);
  if (n) n.children.push(node);
  return node;
}
/** 把 src 子树移动到 dst 子级 */
export function moveNode(roots, srcId, dstId) {
  if (srcId === dstId) return false;
  const src = findNode(roots, srcId);
  const dst = findNode(roots, dstId);
  if (!src || !dst) return false;
  // 禁止移入自己的子树
  let isDesc = false;
  (function walk(x) { if (x.id === dstId) isDesc = true; for (const c of x.children) walk(c); })(src);
  if (isDesc) return false;
  removeNode(roots, srcId);
  dst.children.push(src);
  return true;
}

// ==================== 大纲互转（兼容旧格式：# 标题作根 / 任务标记剥除） ====================
export function parseOutline(md) {
  const roots = [];
  const stack = []; // {indent, node}
  for (const raw of String(md || '').split(/\r?\n/)) {
    const h = /^#\s+(.*)$/.exec(raw.trim());
    if (h && !roots.length && !stack.length) {
      roots.push(createNode(h[1].trim(), 'root'));
      stack.push({ indent: -1, node: roots[0] });
      continue;
    }
    const m = /^(\s*)-\s+(.*)$/.exec(raw);
    if (!m) continue;
    const indent = m[1].replace(/\t/g, '  ').length / 2 | 0;
    const text = m[2].trim().replace(/^\[(?: |x|X)\]\s*/, ''); // 剥除任务列表标记
    const node = createNode(text);
    if (!stack.length) { roots.push(node); stack.push({ indent, node }); continue; }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ indent, node });
  }
  return roots.length ? roots : [createNode('中心主题', 'root')];
}
export function toOutline(roots) {
  const rs = F(roots);
  const lines = [];
  if (rs.length === 1 && rs[0].text) lines.push('# ' + rs[0].text);
  eachNode(rs, (n, d) => {
    if (rs.length === 1 && d === 0) return; // 单根的标题已用 # 表示
    lines.push('  '.repeat(rs.length === 1 ? d - 1 : d) + '- ' + (n.text || ''));
  });
  return lines.join('\n') + '\n';
}

// ==================== 布局 ====================
const NODE_W = 150, NODE_H = 36;
const MAX_TEXT_W = 300; // 文本区最大宽度（超出自动折行，不再溢出）

// —— 真实文本测量（canvas measureText；无 DOM 环境回退估算：CJK 1em 其余 0.55em）——
let _mctx = null;
export function textWidth(str, font) {
  const s = String(str);
  if (typeof document !== 'undefined') {
    if (_mctx === null) {
      // jsdom 等环境 getContext 返回 null：回退估算
      try { _mctx = document.createElement('canvas').getContext('2d') || false; } catch { _mctx = false; }
    }
    if (_mctx) {
      _mctx.font = font;
      return _mctx.measureText(s).width;
    }
  }
  const em = parseFloat(font) || 12;
  let w = 0;
  for (const ch of s) w += /[\u1100-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? em : em * 0.55;
  return w;
}

/** 按宽度折行（统一测量/渲染共用：中文按字符断、英文优先按词断） */
export function wrapTextLines(text, font, maxW) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    if (!raw) { out.push(''); continue; }
    let line = '', w = 0;
    for (const ch of raw) {
      const cw = textWidth(ch, font);
      if (w + cw > maxW && line) {
        // 英文尝试回溯到最近空格断词
        if (!/[\u1100-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) {
          const sp = line.lastIndexOf(' ');
          if (sp > 0 && line.length - sp < 14) {
            out.push(line.slice(0, sp));
            line = line.slice(sp + 1) + ch;
            w = textWidth(line, font);
            continue;
          }
        }
        out.push(line);
        line = ch;
        w = cw;
      } else { line += ch; w += cw; }
    }
    out.push(line);
  }
  return out;
}

/** 节点文本布局：折行后各行与总尺寸（渲染与 measureNode 共用，保证不溢出） */
export function nodeTextLayout(node, depth) {
  const fontSize = node.style?.size ? +node.style.size : (depth === 0 ? 14 : 12.5);
  const bold = node.style?.bold ? 700 : 400;
  const family = node.style?.family || 'sans-serif';
  const font = `${bold} ${fontSize}px ${family}`;
  const lines = wrapTextLines(node.text || '（空）', font, MAX_TEXT_W);
  const maxLineW = Math.max(1, ...lines.map(l => textWidth(l, font)));
  const lineH = fontSize * 1.35;
  return { lines, fontSize, lineH, textW: maxLineW, textH: lines.length * lineH };
}

function measureNode(node, depth) {
  // 按内容自适应：真实测量 + 自动折行（完整显示为底线；v35 修复溢出）
  const lay = nodeTextLayout(node, depth);
  const needW = lay.textW + 34;
  const needH = lay.textH + 18;
  const w = Math.max(node.minW || 90, Math.min(MAX_TEXT_W + 34, needW), node.w || 0);
  const h = Math.max(node.minH || (depth === 0 ? NODE_H + 6 : NODE_H), needH, node.h || 0);
  return { w, h };
}

/** 便笺按内容自适应尺寸（真实测量 + 折行，完整显示为底线） */
export function measureNote(note) {
  const fontSize = note.style?.size ? +note.style.size : 12;
  const bold = note.style?.bold ? 700 : 400;
  const font = `${bold} ${fontSize}px ${note.style?.family || 'sans-serif'}`;
  const lines = wrapTextLines(note.text || '', font, MAX_TEXT_W);
  const maxLineW = Math.max(1, ...lines.map(l => textWidth(l, font)));
  const side = Math.max(100, maxLineW + 28, lines.length * fontSize * 1.45 + 24, note.minW || 0);
  return Math.min(MAX_TEXT_W + 34, side);
}

/** 防重合：把实体从其他实体 bbox 中推出（节点/便笺统一避让，含余量） */
export function resolveOverlap(entity, others, { margin = 8 } = {}) {
  const e = entity;
  for (let iter = 0; iter < 20; iter++) {
    let moved = false;
    for (const o of others) {
      if (o === e) continue;
      const ex = e.x + e.w / 2, ey = e.y + e.h / 2;
      const ox = o.x + o.w / 2, oy = o.y + o.h / 2;
      const dx = ex - ox, dy = ey - oy;
      const overlapX = (e.w + o.w) / 2 + margin - Math.abs(dx);
      const overlapY = (e.h + o.h) / 2 + margin - Math.abs(dy);
      if (overlapX > 0 && overlapY > 0) {
        // 沿较短穿透轴推出
        if (overlapX < overlapY) {
          e.x += (dx >= 0 ? overlapX : -overlapX);
        } else {
          e.y += (dy >= 0 ? overlapY : -overlapY);
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return e;
}

/** 自左向右（水平树） */
export function layoutLR(roots, { startX = 24, startY = 24 } = {}) {
  const boxes = new Map();
  let cursorY = startY;
  const place = (node, depth, x) => {
    if (node.collapsed) node._kidsVisible = false;
    const size = measureNode(node, depth);
    const kids = node.collapsed ? [] : node.children;
    const childBoxes = [];
    for (const k of kids) { k._parent = node.id; childBoxes.push(place(k, depth + 1, x + size.w + 56)); }
    let y;
    if (!childBoxes.length) y = cursorY, cursorY += size.h + 14;
    else y = (childBoxes[0].y + childBoxes[childBoxes.length - 1].y) / 2;
    const box = { node, depth, x, y, w: size.w, h: size.h, parentId: node._parent || null };
    node._parent = null;
    boxes.set(node.id, box);
    return box;
  };
  for (const r of roots) { r._parent = null; place(r, 0, startX); cursorY += 18; }
  return boundsOf(boxes);
}

/** 自上向下（垂直树） */
export function layoutTB(roots, { startX = 24, startY = 24 } = {}) {
  const boxes = new Map();
  let cursorX = startX;
  const place = (node, depth, y) => {
    const size = measureNode(node, depth);
    const kids = node.collapsed ? [] : node.children;
    const childBoxes = [];
    for (const k of kids) { k._parent = node.id; childBoxes.push(place(k, depth + 1, y + size.h + 44)); }
    let x;
    if (!childBoxes.length) x = cursorX, cursorX += size.w + 20;
    else x = (childBoxes[0].x + childBoxes[childBoxes.length - 1].x) / 2;
    const box = { node, depth, x, y, w: size.w, h: size.h, parentId: node._parent || null };
    node._parent = null;
    boxes.set(node.id, box);
    return box;
  };
  for (const r of roots) { r._parent = null; place(r, 0, startY); cursorX += 26; }
  return boundsOf(boxes);
}

/** 全向环绕（波纹式：子节点绕父节点圆环展开，逐级外扩；自由坐标可拖拽） */
export function layoutRadial(roots, { cx = 420, cy = 340 } = {}) {
  const boxes = new Map();
  const RING = 150; // 每级半径增量
  const placeRing = (node, depth, x, y, a0, a1) => {
    const size = measureNode(node, depth);
    // 自由坐标优先（拖拽过）
    const bx = node.fx != null ? node.fx : x;
    const by = node.fy != null ? node.fy : y;
    boxes.set(node.id, { node, depth, x: bx, y: by, w: size.w, h: size.h, parentId: node._parent || null });
    node._parent = null;
    const kids = node.collapsed ? [] : node.children;
    if (!kids.length) return;
    const step = (a1 - a0) / kids.length;
    kids.forEach((k, i) => {
      const ang = a0 + step * (i + 0.5);
      const r = RING * (depth + 1);
      k._parent = node.id;
      placeRing(k, depth + 1, bx + Math.cos(ang) * r, by + Math.sin(ang) * r, a0 + step * i, a0 + step * (i + 1));
    });
  };
  // 多根：等角散布在中心圆上
  roots.forEach((r, i) => {
    const ang = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, roots.length);
    r._parent = null;
    const x = roots.length === 1 ? cx : cx + Math.cos(ang) * RING * 0.8;
    const y = roots.length === 1 ? cy : cy + Math.sin(ang) * RING * 0.8;
    placeRing(r, 0, x, y, ang - Math.PI / 2, ang + Math.PI / 2);
  });
  return boundsOf(boxes);
}

function boundsOf(boxes) {
  let maxX = 0, maxY = 0;
  for (const b of boxes.values()) {
    maxX = Math.max(maxX, b.x + b.w + 40);
    maxY = Math.max(maxY, b.y + b.h + 40);
  }
  return { boxes, width: Math.max(maxX, 600), height: Math.max(maxY, 400) };
}

export function layout(roots, mode = 'lr', opts = {}) {
  const rs = Array.isArray(roots) ? roots : [roots];
  if (mode === 'tb') return layoutTB(rs, opts);
  if (mode === 'radial') return layoutRadial(rs, opts);
  return layoutLR(rs, opts);
}

// ==================== 颜色预设 ====================
export const LEVEL_SCHEMES = [
  { name: '默认', colors: ['#4f46e5', '#0ea5e9', '#059669', '#d97706', '#dc2626', '#7c3aed'] },
  { name: '暖阳', colors: ['#d97706', '#ea580c', '#dc2626', '#db2777', '#a21caf', '#7c3aed'] },
  { name: '森海', colors: ['#0f766e', '#059669', '#65a30d', '#ca8a04', '#0369a1', '#4338ca'] },
];
export function levelColor(depth, schemeIdx = 0) {
  const s = LEVEL_SCHEMES[schemeIdx] || LEVEL_SCHEMES[0];
  return s.colors[depth % s.colors.length];
}

// ==================== 便笺与引用线 ====================
export function createParentLink(fromId, toId) {
  return { id: 'pl' + (seq++) + '-' + Date.now().toString(36), from: fromId, to: toId };
}

export function createNote(text = '', x = 0, y = 0) {
  return { id: 'note' + (seq++) + '-' + Date.now().toString(36), text, x, y, w: 150, color: null, style: null };
}
export function createRefLine(fromId, fromKind, toId, toKind) {
  return {
    id: 'rl' + (seq++) + '-' + Date.now().toString(36),
    from: { id: fromId, k: fromKind }, to: { id: toId, k: toKind },
    color: null, width: null, note: '', noteStyle: null,
    mode: 'curve',          // curve 曲线（默认≥1拐点）| straight 直线（横平竖直）
    bend: 30,               // 曲线弯曲量（可拖拽调节）
    waypoints: [],          // 拐点 [{x,y}]：曲线=弯曲控制点（≥1）；直线=直角拐点（可增删）
  };
}

// ==================== 序列化 ====================
export function serializeDoc(doc) {
  return JSON.stringify({
    v: 3, mode: doc.mode || 'lr', scheme: doc.scheme ?? 0,
    roots: doc.roots,
    notes: doc.notes || [],
    refLines: doc.refLines || [],
    parentLinks: doc.parentLinks || [],
    linkStyle: doc.linkStyle || null,
    showGrid: !!doc.showGrid,
  });
}
export function parseDoc(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && (obj.v === 3 || obj.v === 2) && Array.isArray(obj.roots)) {
      return {
        mode: obj.mode || 'lr', scheme: obj.scheme ?? 0,
        roots: obj.roots,
        notes: obj.notes || [],
        refLines: obj.refLines || [],
        parentLinks: obj.parentLinks || [],
        linkStyle: obj.linkStyle || null,
        showGrid: !!obj.showGrid,
      };
    }
    if (obj && obj.root) return { mode: 'lr', scheme: 0, roots: [obj.root], notes: [], refLines: [], parentLinks: [], linkStyle: null }; // 旧单根 JSON
  } catch {}
  // 更旧的 Markdown 大纲
  return { mode: 'lr', scheme: 0, roots: parseOutline(text), notes: [], refLines: [], parentLinks: [], linkStyle: null };
}
