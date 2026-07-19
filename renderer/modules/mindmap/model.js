// renderer/modules/mindmap/model.js —— 思维导图数据模型：树操作 + Markdown 大纲互转 + 水平树布局

let seq = 1;
export function createNode(text = '', id = null) {
  return { id: id || 'n' + (seq++) + '-' + Date.now().toString(36), text, children: [], collapsed: false };
}

export function findNode(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

export function findParent(root, id, parent = null) {
  if (!root) return null;
  if (root.id === id) return parent;
  for (const c of root.children) {
    const hit = findParent(c, id, root);
    if (hit !== null) return hit;
  }
  return null;
}

/** 删除节点（含子树）；根节点不可删 */
export function removeNode(root, id) {
  if (root.id === id) return false;
  const parent = findParent(root, id);
  if (!parent) return false;
  const i = parent.children.findIndex(c => c.id === id);
  if (i >= 0) { parent.children.splice(i, 1); return true; }
  return false;
}

/** 新建同级（在 id 之后插入）；返回新节点 */
export function insertSibling(root, id, node) {
  const parent = findParent(root, id);
  if (!parent) return null;
  const i = parent.children.findIndex(c => c.id === id);
  parent.children.splice(i + 1, 0, node);
  return node;
}

/** 追加子节点；自动展开 */
export function appendChild(root, id, node) {
  const target = findNode(root, id);
  if (!target) return null;
  target.collapsed = false;
  target.children.push(node);
  return node;
}

/** 拖拽重排：把 srcId 移到 dstId 的子节点末尾；防环（不能移到自己的子树里） */
export function moveNode(root, srcId, dstId) {
  if (srcId === dstId || root.id === srcId) return false;
  // 防环：dst 在 src 子树内则拒绝
  if (findNode(findNode(root, srcId), dstId)) return false;
  const src = findNode(root, srcId);
  const dst = findNode(root, dstId);
  if (!src || !dst) return false;
  if (!removeNode(root, srcId)) return false;
  dst.collapsed = false;
  dst.children.push(src);
  return true;
}

// ==================== Markdown 大纲互转 ====================
/** 解析 Markdown 为树：首个 # 标题作根（无标题用首行或「导图」），- 与 * 无序列表按缩进分层 */
export function parseOutline(md) {
  const lines = String(md || '').split('\n');
  let root = null;
  const stack = []; // {node, indent}
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h && !root) { root = createNode(h[2].trim() || '导图'); stack.length = 0; stack.push({ node: root, indent: -1 }); continue; }
    const m = /^(\s*)[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (!m) continue;
    const indent = m[1].length;
    const node = createNode(m[2].trim());
    if (!root) { root = createNode('导图'); stack.push({ node: root, indent: -1 }); }
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ node, indent });
  }
  return root || createNode('导图');
}

/** 导出为 Markdown 大纲：# 根 + 缩进无序列表 */
export function toOutline(root) {
  const out = ['# ' + (root.text || '导图'), ''];
  (function walk(node, depth) {
    for (const c of node.children) {
      out.push('  '.repeat(depth) + '- ' + c.text);
      walk(c, depth + 1);
    }
  })(root, 0);
  return out.join('\n') + '\n';
}

// ==================== 水平树布局 ====================
/**
 * 经典右侧展开水平树：根在最左，子树向右。
 * 返回 { boxes: Map<id, {node, x, y, w, h, depth, parentId}>, width, height }
 */
export function layout(root, { nodeW = 150, nodeH = 34, gapX = 56, gapY = 12, measure } = {}) {
  const boxes = new Map();
  const textW = (t, depth) => {
    if (measure) return measure(t, depth);
    // 粗算：CJK 13px，ASCII 7px，加 padding
    let w = 0;
    for (const ch of String(t || '')) w += ch.charCodeAt(0) > 255 ? 13 : 7.5;
    return Math.min(Math.max(w + 22, 56), 260);
  };
  let cursor = 0; // 下一个可用 y 槽位
  (function place(node, depth) {
    const w = textW(node.text, depth);
    if (!node.children.length || node.collapsed) {
      const y = cursor;
      cursor += nodeH + gapY;
      boxes.set(node.id, { node, x: depth * (nodeW + gapX), y, w, h: nodeH, depth, parentId: null });
      return;
    }
    // 先摆子树，再取子节点垂直区间中点
    for (const c of node.children) place(c, depth + 1);
    const first = boxes.get(node.children[0].id);
    const last = boxes.get(node.children[node.children.length - 1].id);
    const y = (first.y + last.y) / 2;
    boxes.set(node.id, { node, x: depth * (nodeW + gapX), y, w, h: nodeH, depth, parentId: null });
  })(root, 0);
  // 回填 parentId + 计算画布尺寸
  let width = 0, height = 0;
  (function fill(node) {
    for (const c of node.children) {
      const b = boxes.get(c.id);
      if (b) b.parentId = node.id;
      fill(c);
    }
  })(root);
  for (const b of boxes.values()) {
    width = Math.max(width, b.x + b.w);
    height = Math.max(height, b.y + b.h);
  }
  return { boxes, width: width + 40, height: height + 30 };
}
