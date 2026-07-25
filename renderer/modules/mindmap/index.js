// renderer/modules/mindmap/index.js —— 思维导图 v2：多根森林 · 三布局（左右/上下/环绕）· 自由拖拽 · 节点样式与配色
import { contextKeys } from '../../core/contextkey-service.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { toast, inputModal } from '../../shell/shell.js';
import {
  createNode, createNote, createRefLine, createParentLink, findNode, findParent, removeNode, insertSibling, appendChild, moveNode,
  toOutline, layout, LEVEL_SCHEMES, levelColor, serializeDoc, parseDoc, measureNote, nodeTextLayout, wrapTextLines,
} from './model.js';
import { PRESET_TEMPLATES, listTemplates, deleteTemplate, obtainBlankTemplate } from './templates.js';

const MODULE = 'mindmap';
const instances = new Map();
let current = null;

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const SAMPLE_DOC = (() => {
  const r = createNode('中心主题', 'root');
  const a = createNode('分支一'); a.children.push(createNode('子主题'), createNode('子主题'));
  const b = createNode('分支二'); b.children.push(createNode('子主题'));
  r.children.push(a, b, createNode('分支三'));
  return { mode: 'lr', scheme: 0, roots: [r], notes: [], refLines: [], parentLinks: [], linkStyle: null };
})();

function createMindmap(container) {
  const root = document.createElement('div');
  root.className = 'mm-root';
  root.innerHTML = `
    <div class="mm-stylebar" style="display:none"></div>
    <div class="mm-canvas-wrap" tabindex="-1">
      <svg class="mm-svg"><defs>
        <pattern id="mmGrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--bd, #d8d6cf)" stroke-width="0.5" opacity="0.55"/>
        </pattern>
        <pattern id="mmGridBold" width="200" height="200" patternUnits="userSpaceOnUse">
          <path d="M 200 0 L 0 0 0 200" fill="none" stroke="var(--bd, #d8d6cf)" stroke-width="1" opacity="0.8"/>
        </pattern>
      </defs><g class="mm-viewport"></g></svg>
      <textarea class="mm-editor" style="display:none;resize:none" spellcheck="false" rows="3"></textarea>
      <div class="mm-hint">双击节点编辑 · 双击空白新增根节点 · Shift+双击空白新增便笺 · Tab 子节点 · Alt+Enter 同级 · Ctrl+Alt+J 连接 · Ctrl+Z 撤销 · 右键更多操作 · 滚轮缩放</div>
    </div>`;
  container.appendChild(root);

  const wrap = root.querySelector('.mm-canvas-wrap');
  const svg = root.querySelector('.mm-svg');
  const viewport = root.querySelector('.mm-viewport');
  const editor = root.querySelector('.mm-editor');
  const stylebar = root.querySelector('.mm-stylebar');

  const ctl = {
    root, container, stylebar,
    doc: null,          // {mode, scheme, roots[], notes[], refLines[], linkStyle}
    selected: null,     // 节点 id
    selectedNote: null, // 便笺 id
    selectedLine: null, // 引用线 id 或 'conn:子节点id'
    cam: { x: 30, y: 30, k: 1 },
    undoStack: [], redoStack: [],
    editing: null,      // {kind:'node'|'note', id} 或 null
    boxes: null,
    layoutInfo: null,
    linkMode: null,     // 引用线创建中：null | {from:{id,k}}
  };

  // ==================== 数据 ====================
  function snapshot() {
    ctl.undoStack.push(serializeDoc(ctl.doc));
    if (ctl.undoStack.length > 60) ctl.undoStack.shift();
    ctl.redoStack.length = 0;
  }
  function restore(json) {
    ctl.doc = parseDoc(json);
    ctl.selected = null;
    render();
  }
  function undo() {
    if (!ctl.undoStack.length) return;
    ctl.redoStack.push(serializeDoc(ctl.doc));
    restore(ctl.undoStack.pop());
    window.MazzHost?.notifyChange(container);
  }
  function redo() {
    if (!ctl.redoStack.length) return;
    ctl.undoStack.push(serializeDoc(ctl.doc));
    restore(ctl.redoStack.pop());
    window.MazzHost?.notifyChange(container);
  }
  function mutate(fn) {
    snapshot();
    const r = fn();
    render();
    window.MazzHost?.notifyChange(container);
    return r;
  }

  // ==================== 样式辅助 ====================
  ctl.template = PRESET_TEMPLATES[0];
  const tplLevel = (depth) => {
    const t = ctl.template;
    return t.levels[depth % t.levels.length];
  };
  function fillOf(node, depth, selected) {
    const base = node.color || tplLevel(depth);
    if (depth === 0) return node.color || ctl.template.rootBg || tplLevel(0);
    if (selected) return `color-mix(in srgb, ${base} 16%, white)`;
    return 'var(--card, #fff)';
  }
  function strokeOf(node, depth, selected) {
    const base = node.color || tplLevel(depth);
    return selected ? base : (depth === 0 ? 'none' : 'var(--bd, #d8d6cf)');
  }
  function applyTextStyle(textEl, node, depth) {
    const s = node.style || {};
    const base = node.color || levelColor(depth, ctl.doc.scheme);
    textEl.setAttribute('font-size', s.size || (depth === 0 ? 14 : 12.5));
    textEl.setAttribute('font-weight', (s.bold ?? (depth <= 1)) ? 700 : 400);
    textEl.setAttribute('font-style', s.italic ? 'italic' : 'normal');
    const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) textEl.setAttribute('text-decoration', deco);
    if (s.family) textEl.setAttribute('font-family', `'${s.family}',sans-serif`);
    textEl.setAttribute('fill', s.color || (depth === 0 ? '#fff' : 'var(--fg, #2c2c2a)'));
    textEl.setAttribute('text-anchor', s.align === 'left' ? 'start' : s.align === 'right' ? 'end' : 'middle');
  }

  // ==================== 渲染 ====================
  function boxPos(box) {
    // 树形布局应用手动偏移；环绕布局坐标即自由坐标
    const ox = box.node.offX || 0, oy = box.node.offY || 0;
    return { x: box.x + ox, y: box.y + oy, w: box.w, h: box.h };
  }

  function render() {
    const L = layout(ctl.doc.roots, ctl.doc.mode);
    ctl.boxes = L.boxes;
    ctl.layoutInfo = { width: L.width, height: L.height };
    // 节点重排位移时，自定义拐点跟随平移（父/子平均位移）——否则增删节点后编辑过的线
    // 视觉贴近到新位置的节点上（v33 实测诡异渲染；数据修正不记撤销，一轮到位不累积）
    if (ctl._prevBoxes) {
      const deltas = new Map();
      for (const b of L.boxes.values()) {
        const prev = ctl._prevBoxes.get(b.node.id);
        if (prev) deltas.set(b.node.id, { dx: boxPos(b).x - prev.x, dy: boxPos(b).y - prev.y });
      }
      const shift = (wps, idA, idB) => {
        if (!wps?.length) return;
        const da = deltas.get(idA) || { dx: 0, dy: 0 }, db = deltas.get(idB) || { dx: 0, dy: 0 };
        const mx = (da.dx + db.dx) / 2, my = (da.dy + db.dy) / 2;
        if (mx || my) for (const w of wps) { w.x += mx; w.y += my; }
      };
      for (const b of L.boxes.values()) {
        if (b.parentId && b.node.linkWps?.length) shift(b.node.linkWps, b.parentId, b.node.id);
      }
      for (const rl of ctl.doc.refLines || []) shift(rl.waypoints, rl.from?.id, rl.to?.id);
      for (const pl of ctl.doc.parentLinks || []) shift(pl.waypoints, pl.from?.id, pl.to?.id);
    }
    ctl._prevBoxes = new Map([...L.boxes.values()].map(b => [b.node.id, { x: boxPos(b).x, y: boxPos(b).y }]));
    viewport.innerHTML = '';
    viewport.setAttribute('transform', `translate(${ctl.cam.x},${ctl.cam.y}) scale(${ctl.cam.k})`);
    // 可开关网格坐标线（世界坐标，随平移缩放；手动定位用）
    if (ctl.doc.showGrid) {
      viewport.appendChild(svgEl('rect', {
        x: -10000, y: -10000, width: 20000, height: 20000,
        fill: 'url(#mmGrid)', class: 'mm-grid-bg', 'pointer-events': 'none',
      }));
      viewport.appendChild(svgEl('rect', {
        x: -10000, y: -10000, width: 20000, height: 20000,
        fill: 'url(#mmGridBold)', class: 'mm-grid-bg2', 'pointer-events': 'none',
      }));
    }
    // 连线（含连接线样式与注释；可选中：点选改直曲/颜色/线宽/拐点，右键选单）
    for (const b of L.boxes.values()) {
      if (!b.parentId) continue;
      const p = L.boxes.get(b.parentId);
      if (!p) continue;
      const a = boxPos(p), c = boxPos(b);
      const x1 = a.x + a.w, y1 = a.y + a.h / 2;
      const x2 = c.x, y2 = c.y + c.h / 2;
      const mx = (x1 + x2) / 2;
      const ls = ctl.doc.linkStyle || {};
      const node = b.node;
      const isSel = ctl.selectedLine === 'conn:' + node.id;
      // 线型：节点级覆盖 > 全局 linkStyle
      const mode = node.linkMode || ls.mode || 'curve';
      const straight = mode === 'straight';
      let d;
      if (straight && node.linkWps?.length) {
        d = 'M' + [[x1, y1], ...node.linkWps.map(w => [w.x, w.y]), [x2, y2]].map(q => q.join(',')).join(' L');
      } else if (straight) {
        d = connectorStraightD(a, c, b.parentId, node.id);
      } else {
        d = ctl.doc.mode === 'tb'
          ? `M${a.x + a.w / 2},${a.y + a.h} C${a.x + a.w / 2},${(a.y + a.h + c.y) / 2} ${c.x + c.w / 2},${(a.y + a.h + c.y) / 2} ${c.x + c.w / 2},${c.y}`
          : `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      }
      const connPath = svgEl('path', {
        d, fill: 'none',
        stroke: node.linkColor || ls.color || (isSel ? 'var(--acc, #4f46e5)' : (ctl.template.connColor || 'var(--bd, #d8d6cf)')),
        'stroke-width': node.linkWidth || ls.width || (isSel ? 2.6 : 1.6),
        class: 'mm-conn', 'data-id': node.id,
      });
      // 隐形加粗命中路径：1.6px 细线点不中（v33 实测），交互全挂 14px 透明描边上
      const connHit = svgEl('path', { d, fill: 'none', stroke: 'rgba(0,0,0,0)', 'stroke-width': 14, class: 'mm-conn-hit', 'data-id': node.id });
      viewport.appendChild(connHit);
      connHit.style.cursor = 'pointer';
      connPath.style.pointerEvents = 'none';
      connPath.style.cursor = 'pointer';
      connHit.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        ctl.selectedLine = 'conn:' + node.id;
        ctl.selected = null; ctl.selectedNote = null;
        // 延迟 render：给 dblclick 留「同元素连续两击」的窗口——
        // 立即 render 会销毁命中层，第二次点击落在重建的新元素上，dblclick 永不触发（双击完全没反应的总根）
        clearTimeout(ctl._connSelT);
        ctl._connSelT = setTimeout(() => render(), 260);
      });
      connHit.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        ctl.selectedLine = 'conn:' + node.id;
        ctl.selected = null; ctl.selectedNote = null;
        render();
        showLineMenu(e.clientX, e.clientY);
      });
      connHit.addEventListener('dblclick', (e) => {
        // 双击加拐点（自动切直线模式）
        e.stopPropagation();
        clearTimeout(ctl._connSelT); // 双击落定：取消延迟 render（mutate 自会触发重建）
        const rect = wrap.getBoundingClientRect();
        const wx = (e.clientX - rect.left - ctl.cam.x) / ctl.cam.k;
        const wy = (e.clientY - rect.top - ctl.cam.y) / ctl.cam.k;
        mutate(() => {
          node.linkWps = node.linkWps || [];
          node.linkWps.push({ x: wx, y: wy });
          node.linkMode = 'straight';
        });
      });
      viewport.appendChild(connPath);
      // 直线模式拐点手柄（选中时）：拖动调位 / 右键删除
      if (isSel && straight) {
        // Array.isArray 区分「用户删光了（[]，直来直去无拐点）」与「从未自定义（undefined，给默认两拐）」——
        // 此前用 length 判空，空数组被当成未自定义：明明全删掉又复位成两个默认拐点（神秘复现实锤）
        const wps = Array.isArray(node.linkWps) ? node.linkWps : (() => {
          // 未自定义：按两拐 Z 形给可拖手柄（首次拖动即固化）
          const midX = (x1 + x2) / 2;
          return [{ x: midX, y: y1 }, { x: midX, y: y2 }];
        })();
        wps.forEach((wp, i) => {
          const dot = svgEl('circle', { cx: wp.x, cy: wp.y, r: 5.5, fill: '#fff', stroke: node.linkColor || ls.color || 'var(--acc, #4f46e5)', 'stroke-width': 2, class: 'mm-wp', 'data-idx': i });
          dot.style.cursor = 'grab';
          dot.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            node.linkWps = wps.map(w => ({ ...w })); // 固化
            drag = { type: 'connwp', node, idx: i, sx: e.clientX, sy: e.clientY, ox: wp.x, oy: wp.y };
          });
          dot.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            mutate(() => { node.linkWps = wps.filter((_, j) => j !== i); });
            toast(node.linkWps.length ? '已删除拐点' : '已无拐点：直来直去一条线');
          });
          viewport.appendChild(dot);
        });
      }
      // 连接线注释（存于子节点 linkNote）
      const noteText = b.node.linkNote?.text;
      if (noteText) {
        const t = svgEl('text', {
          x: mx, y: (y1 + y2) / 2 - 4, 'text-anchor': 'middle', 'font-size': b.node.linkNote.size || 11,
          fill: b.node.linkNote.color || 'var(--fg-dim, #83817a)',
          'font-weight': b.node.linkNote.bold ? 700 : 400,
          'font-style': b.node.linkNote.italic ? 'italic' : 'normal',
        });
        t.textContent = noteText;
        viewport.appendChild(t);
      }
    }
    // 节点
    for (const b of L.boxes.values()) {
      const pos = boxPos(b);
      const node = b.node;
      const g = svgEl('g', { class: 'mm-node', 'data-id': node.id, transform: `translate(${pos.x},${pos.y})` });
      const selected = ctl.selected === node.id;
      const rect = svgEl('rect', {
        width: pos.w, height: pos.h, rx: ctl.template.radius ?? 9,
        fill: fillOf(node, b.depth, selected),
        stroke: strokeOf(node, b.depth, selected),
        'stroke-width': selected ? 2 : 1.2,
      });
      g.appendChild(rect);
      // 多行文本：与测量同一折行布局（v35 溢出根治），默认上下左右居中
      const lay = nodeTextLayout(node, b.depth);
      const lines = lay.lines;
      const lineH = lay.lineH;
      const totalH = lines.length * lineH;
      lines.forEach((ln, i) => {
        const text = svgEl('text', {
          x: pos.w / 2,
          y: pos.h / 2 - totalH / 2 + lineH * (i + 0.5) + 4,
          'text-anchor': 'middle',
        });
        applyTextStyle(text, node, b.depth);
        text.textContent = ln;
        g.appendChild(text);
      });
      // 折叠钮
      if (node.children.length) {
        const btn = svgEl('g', { class: 'mm-fold' + (node.collapsed ? ' mm-fold-on' : ''), 'data-id': node.id, transform: `translate(${pos.w + 4},${pos.h / 2 - 7})` });
        btn.appendChild(svgEl('circle', { cx: 7, cy: 7, r: 7, fill: 'var(--card,#fff)', stroke: 'var(--bd,#d8d6cf)' }));
        const t = svgEl('text', { x: 7, y: 10.5, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--fg-dim,#a3a19a)' });
        t.textContent = node.collapsed ? '+' : '−';
        btn.appendChild(t);
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          mutate(() => { node.collapsed = !node.collapsed; });
        });
        g.appendChild(btn);
      }
      if (node.collapsed && node.children.length) {
        const badge = svgEl('text', { x: pos.w + 24, y: pos.h / 2 + 4, 'font-size': 10, fill: 'var(--fg-dim,#a3a19a)' });
        badge.textContent = `(${countDesc(node)})`;
        g.appendChild(badge);
      }
      // 选中节点：右下角调尺寸手柄（完整显示内容为底线）
      if (selected) {
        const rz = svgEl('rect', { x: pos.w - 10, y: pos.h - 10, width: 10, height: 10, rx: 2, fill: 'var(--acc, #4f46e5)', class: 'mm-resize', 'data-id': node.id });
        rz.style.cursor = 'nwse-resize';
        rz.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          drag = { type: 'resize', id: node.id, sx: e.clientX, sy: e.clientY, ow: pos.w, oh: pos.h };
        });
        g.appendChild(rz);
      }
      g.addEventListener('pointerdown', (e) => onNodePointerDown(e, b));
      g.addEventListener('dblclick', (e) => { e.stopPropagation(); startEdit(b); });
      g.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        ctl.selected = node.id; ctl.selectedNote = null; ctl.selectedLine = null;
        render();
        showNodeMenu(e.clientX, e.clientY, b);
      });
      viewport.appendChild(g);
    }
    renderNotes();
    renderRefLines();
    renderParentLinks();
    renderStylebar();
  }

  // ==================== 多父级连接线（与主连接线同款样式；可选中编辑直曲/颜色/线宽/拐点/注释） ====================
  function renderParentLinks() {
    for (const pl of ctl.doc.parentLinks || []) {
      const a = entityCenter(pl.from, 'node');
      const c = entityCenter(pl.to, 'node');
      if (!a || !c) continue;
      const sel = ctl.selectedLine === pl.id;
      // 与主连接线同色同宽（模板 connColor；选中高亮）
      const color = pl.color || (sel ? 'var(--acc, #4f46e5)' : (ctl.template.connColor || 'var(--bd, #d8d6cf)'));
      const width = pl.width || (sel ? 2.2 : 1.6);
      // 与主连接线同款：右出左入贝塞尔（直线模式走拐点折线）
      const x1 = a.cx + a.w / 2, y1 = a.cy;
      const x2 = c.cx - c.w / 2, y2 = c.cy;
      let d, arrowAng;
      const endPt = { x: x2, y: y2 };
      if (pl.mode === 'straight') {
        // Array.isArray 区分「删光了（[]）」与「未自定义（undefined）」（同主连接线，防删光复位两拐）
        const wps = Array.isArray(pl.waypoints) ? pl.waypoints : defaultTwoWaypoints({ cx: x1, cy: y1, w: 0, h: 0 }, { cx: x2, cy: y2, w: 0, h: 0 });
        const pts = [[x1, y1], ...wps.map(w => [w.x, w.y]), [x2, y2]];
        d = 'M' + pts.map(q => q.join(',')).join(' L');
        const prev = pts[pts.length - 2];
        arrowAng = Math.atan2(y2 - prev[1], x2 - prev[0]);
        // 直线模式拐点手柄（选中时）
        if (sel) {
          wps.forEach((wp, i) => {
            const dot = svgEl('circle', { cx: wp.x, cy: wp.y, r: 5.5, fill: '#fff', stroke: color, 'stroke-width': 2, class: 'mm-wp', 'data-idx': i });
            dot.style.cursor = 'grab';
            dot.addEventListener('pointerdown', (e) => {
              e.stopPropagation();
              pl.waypoints = wps.map(w => ({ ...w }));
              drag = { type: 'wp', rl: pl, idx: i, sx: e.clientX, sy: e.clientY, ox: wp.x, oy: wp.y };
            });
            dot.addEventListener('contextmenu', (e) => {
              e.preventDefault(); e.stopPropagation();
              mutate(() => { pl.waypoints = wps.filter((_, j) => j !== i); });
            });
            viewport.appendChild(dot);
          });
        }
      } else {
        const mx = (x1 + x2) / 2;
        d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
        arrowAng = Math.atan2(y2 - y1, x2 - mx);
      }
      const path = svgEl('path', {
        d, fill: 'none', stroke: color, 'stroke-width': width,
        class: 'mm-refline', 'data-id': pl.id,
      });
      const plHit = svgEl('path', { d: path.getAttribute('d'), fill: 'none', stroke: 'rgba(0,0,0,0)', 'stroke-width': 14, class: 'mm-pl-hit' });
      viewport.appendChild(plHit);
      path.style.pointerEvents = 'none';
      path.style.cursor = 'pointer';
      plHit.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        ctl.selectedLine = pl.id;
        ctl.selected = null; ctl.selectedNote = null;
        render();
      });
      plHit.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        ctl.selectedLine = pl.id;
        ctl.selected = null; ctl.selectedNote = null;
        render();
        showLineMenu(e.clientX, e.clientY);
      });
      plHit.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const rect = wrap.getBoundingClientRect();
        const wx = (e.clientX - rect.left - ctl.cam.x) / ctl.cam.k;
        const wy = (e.clientY - rect.top - ctl.cam.y) / ctl.cam.k;
        mutate(() => {
          pl.waypoints = pl.waypoints || [];
          pl.waypoints.push({ x: wx, y: wy });
          pl.mode = 'straight';
        });
      });
      viewport.appendChild(path);
      // 箭头（同色）
      const ah = 8;
      viewport.appendChild(svgEl('path', {
        d: `M${endPt.x},${endPt.y} l${-ah * Math.cos(arrowAng - 0.4)},${-ah * Math.sin(arrowAng - 0.4)} l${ah * 0.6},0 l${-ah * Math.cos(arrowAng + 0.4)},${-ah * Math.sin(arrowAng + 0.4)} Z`,
        fill: color,
      }));
      // 线注释
      if (pl.note) {
        const ns = pl.noteStyle || {};
        const t = svgEl('text', {
          x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 10, 'text-anchor': 'middle',
          'font-size': ns.size || 11.5,
          'font-weight': ns.bold ? 700 : 400,
          'font-style': ns.italic ? 'italic' : 'normal',
          'text-decoration': ns.underline ? 'underline' : (ns.strike ? 'line-through' : 'none'),
          fill: ns.color || 'var(--fg, #2c2c2a)',
        });
        t.textContent = pl.note;
        viewport.appendChild(t);
      }
    }
  }

  /** 连接线直线模式路径：横平竖直且不与途经节点重合（绕障两拐）
   * 规则：从父右边出 → 中缝垂直 → 入子左边；若中缝被途经节点挡住，改从该节点上方或下方绕行 */
  function connectorStraightD(a, c, parentId, childId) {
    const M = 6; // 避让余量
    const x1 = a.x + a.w, y1 = a.y + a.h / 2;
    const x2 = c.x, y2 = c.y + c.h / 2;
    if (x2 <= x1 + 2) {
      // 子节点在父节点左侧/正下：先水平绕出再折回（退化为贝塞尔更自然）
      return `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`;
    }
    let midX = (x1 + x2) / 2;
    // 检查中缝垂直段是否与其他节点重合
    const blockers = [];
    for (const ob of ctl.boxes.values()) {
      if (ob.node.id === parentId || ob.node.id === childId) continue;
      const p = boxPos(ob);
      if (midX > p.x - M && midX < p.x + p.w + M) {
        // 垂直段是否与该节点纵向区间相交
        blockers.push(p);
      }
    }
    if (!blockers.length) {
      return `M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}`;
    }
    // 有遮挡：选择全部遮挡区间的上方或下方绕行（选更短的一侧）
    const topY = Math.min(...blockers.map(p => p.y)) - M;
    const botY = Math.max(...blockers.map(p => p.y + p.h)) + M;
    const detourY = (Math.abs(topY - y1) + Math.abs(topY - y2)) <= (Math.abs(botY - y1) + Math.abs(botY - y2)) ? topY : botY;
    return `M${x1},${y1} L${midX},${y1} L${midX},${detourY} L${midX + 24},${detourY} L${midX + 24},${y2} L${x2},${y2}`;
  }

  // ==================== 便笺 ====================
  function renderNotes() {
    for (const n of ctl.doc.notes) {
      // 便笺按内容自适应尺寸（多行也保证不溢出）
      n.w = Math.max(100, measureNote(n));
      const g = svgEl('g', { class: 'mm-note', 'data-id': n.id, transform: `translate(${n.x},${n.y})` });
      const sel = ctl.selectedNote === n.id;
      g.appendChild(svgEl('rect', {
        width: n.w, height: n.w, rx: 8,
        fill: n.color || ctl.template.noteBg || '#fde68a',
        stroke: sel ? 'var(--acc, #4f46e5)' : '#e5c04b',
        'stroke-width': sel ? 2 : 1.2,
        filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.12))',
      }));
      // 便笺多行文本：与测量同一折行（v35），上下左右居中
      const _noteLayFont = `${n.style?.bold ? 700 : 400} ${(n.style?.size) || 12}px ${n.style?.family || 'sans-serif'}`;
      const lines = wrapTextLines(n.text || '（便笺）', _noteLayFont, 300);
      const lh = ((n.style?.size) || 12) * 1.4;
      const totalH = lines.length * lh;
      lines.forEach((ln, i) => {
        const t = svgEl('text', {
          x: n.w / 2, y: n.w / 2 - totalH / 2 + lh * (i + 0.5) + 3, 'text-anchor': 'middle',
          'font-size': (n.style?.size) || 12,
          'font-weight': n.style?.bold ? 700 : 400,
          'font-style': n.style?.italic ? 'italic' : 'normal',
          fill: n.style?.color || '#5b4a1e',
        });
        t.textContent = ln;
        g.appendChild(t);
      });
      g.addEventListener('pointerdown', (e) => onNotePointerDown(e, n));
      g.addEventListener('dblclick', (e) => { e.stopPropagation(); startEditNote(n); });
      viewport.appendChild(g);
    }
  }

  // ==================== 引用线 ====================
  function entityCenter(id, kind) {
    if (kind === 'note') {
      const n = ctl.doc.notes.find(x => x.id === id);
      return n ? { cx: n.x + n.w / 2, cy: n.y + n.w / 2, w: n.w, h: n.w } : null;
    }
    const b = ctl.boxes?.get(id);
    if (!b) return null;
    const pos = boxPos(b);
    return { cx: pos.x + pos.w / 2, cy: pos.y + pos.h / 2, w: pos.w, h: pos.h };
  }

  /** 边界交点：从中心 toward 方向到实体 bbox 边缘（美观接线） */
  function edgePoint(center, toward, w, h) {
    const dx = toward.x - center.x, dy = toward.y - center.y;
    if (!dx && !dy) return { x: center.x, y: center.y };
    const tx = dx ? (w / 2) / Math.abs(dx) : Infinity;
    const ty = dy ? (h / 2) / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    return { x: center.x + dx * t, y: center.y + dy * t };
  }

  /** 直线折线路径：无拐点=直连（横平竖直或倾斜）；有拐点=按拐点折（首末接边自适应） */
  function refLinePath(rl, aInfo, cInfo) {
    const wps = rl.waypoints || [];
    if (!wps.length) {
      // 无拐点：直来直去一条直线
      const d = { x: cInfo.cx - aInfo.cx, y: cInfo.cy - aInfo.cy };
      const p1 = edgePoint({ x: aInfo.cx, y: aInfo.cy }, { x: aInfo.cx + d.x, y: aInfo.cy + d.y }, aInfo.w, aInfo.h);
      const p2 = edgePoint({ x: cInfo.cx, y: cInfo.cy }, { x: cInfo.cx - d.x, y: cInfo.cy - d.y }, cInfo.w, cInfo.h);
      return [[p1.x, p1.y], [p2.x, p2.y]];
    }
    // 首末点按邻接段方向自适应接边
    const first = wps[0], last = wps[wps.length - 1];
    const start = edgePoint({ x: aInfo.cx, y: aInfo.cy }, first, aInfo.w, aInfo.h);
    const end = edgePoint({ x: cInfo.cx, y: cInfo.cy }, last, cInfo.w, cInfo.h);
    return [[start.x, start.y], ...wps.map(p => [p.x, p.y]), [end.x, end.y]];
  }

  /** 切换直线模式时的默认两拐：直出 → 拐 → 拐直入（Z 形） */
  function defaultTwoWaypoints(aInfo, cInfo) {
    const dx = cInfo.cx - aInfo.cx;
    const dy = cInfo.cy - aInfo.cy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const mx = aInfo.cx + dx / 2;
      return [{ x: mx, y: aInfo.cy }, { x: mx, y: cInfo.cy }];
    }
    const my = aInfo.cy + dy / 2;
    return [{ x: aInfo.cx, y: my }, { x: cInfo.cx, y: my }];
  }

  /** 引用线路径点列（曲线=起/控/终，直线=起/拐点…/终的折线） */
  function refLinePoints(rl, a, c) {
    if (rl.mode === 'straight') {
      return refLinePath(rl, a, c);
    }
    return null; // 曲线走 Q
  }

  function renderRefLines() {
    for (const rl of ctl.doc.refLines) {
      const a = entityCenter(rl.from.id, rl.from.k);
      const c = entityCenter(rl.to.id, rl.to.k);
      if (!a || !c) continue;
      const sel = ctl.selectedLine === rl.id;
      const color = rl.color || (sel ? 'var(--acc, #4f46e5)' : '#94a3b8');
      const width = rl.width || (sel ? 3 : 1.8);
      const ax = a.cx, ay = a.cy, cx = c.cx, cy = c.cy;
      const mx = (ax + cx) / 2, my = (ay + cy) / 2;
      let d, arrowAng;
      if (rl.mode === 'straight') {
        const pts = refLinePath(rl, a, c);
        d = 'M' + pts.map(p => p.join(',')).join(' L');
        const prev = pts[pts.length - 2];
        arrowAng = Math.atan2(cy - prev[1], cx - prev[0]);
      } else {
        const bend = Math.max(-200, Math.min(200, rl.bend ?? 30));
        const ctrl = rl.waypoints?.length ? rl.waypoints[0] : { x: mx + bend, y: my - 30 };
        d = `M${ax},${ay} Q${ctrl.x},${ctrl.y} ${cx},${cy}`;
        arrowAng = Math.atan2(cy - ctrl.y, cx - ctrl.x);
        rl._ctrl = ctrl; // 渲染期暂存，供手柄定位
      }
      const path = svgEl('path', {
        d, fill: 'none', stroke: color, 'stroke-width': width,
        'stroke-dasharray': width > 2.5 ? 'none' : '6 4',
        class: 'mm-refline', 'data-id': rl.id,
      });
      // 隐形加粗命中路径（细线点不中的统一解法）
      const rlHit = svgEl('path', { d, fill: 'none', stroke: 'rgba(0,0,0,0)', 'stroke-width': 14, class: 'mm-refline-hit', 'data-id': rl.id });
      path.style.pointerEvents = 'none';
      rlHit.style.cursor = 'pointer';
      rlHit.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        ctl.selectedLine = rl.id;
        ctl.selected = null; ctl.selectedNote = null;
        // 局部选中态，不全量 render——render 会销毁本元素，紧随的第二击注册不到，dblclick 加拐点永远失效
        viewport.querySelectorAll('.mm-refline').forEach(pp => {
          const on = pp.dataset.id === rl.id;
          const owner = ctl.doc.refLines.find(x => x.id === pp.dataset.id);
          pp.setAttribute('stroke', owner?.color || (on ? 'var(--acc, #4f46e5)' : '#94a3b8'));
          pp.setAttribute('stroke-width', owner?.width || (on ? 3 : 1.8));
        });
      });
      rlHit.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        ctl.selectedLine = rl.id;
        ctl.selected = null; ctl.selectedNote = null;
        render();
        showLineMenu(e.clientX, e.clientY);
      });
      rlHit.addEventListener('dblclick', (e) => {
        // 双击加拐点（直线直角拐 / 曲线弯曲控制）
        e.stopPropagation();
        const rect = wrap.getBoundingClientRect();
        const wx = (e.clientX - rect.left - ctl.cam.x) / ctl.cam.k;
        const wy = (e.clientY - rect.top - ctl.cam.y) / ctl.cam.k;
        mutate(() => {
          rl.waypoints = rl.waypoints || [];
          rl.waypoints.push({ x: wx, y: wy });
        });
      });
      viewport.appendChild(rlHit);
      viewport.appendChild(path);
      // 箭头
      const ah = 8;
      viewport.appendChild(svgEl('path', {
        d: `M${cx},${cy} l${-ah * Math.cos(arrowAng - 0.4)},${-ah * Math.sin(arrowAng - 0.4)} l${ah * 0.6},0 l${-ah * Math.cos(arrowAng + 0.4)},${-ah * Math.sin(arrowAng + 0.4)} Z`,
        fill: color,
      }));
      // 拐点手柄（选中时显示；拖拽移动 / 右键删除）
      if (sel) {
        const wps = rl.mode === 'straight' ? (rl.waypoints || []) : (rl.waypoints?.length ? rl.waypoints : [rl._ctrl]);
        wps.forEach((wp, i) => {
          const dot = svgEl('circle', { cx: wp.x, cy: wp.y, r: 5.5, fill: '#fff', stroke: color, 'stroke-width': 2, class: 'mm-wp', 'data-idx': i });
          dot.style.cursor = 'grab';
          dot.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            drag = { type: 'wp', rl, idx: i, sx: e.clientX, sy: e.clientY, ox: wp.x, oy: wp.y };
          });
          dot.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            // 曲线至少保留 1 个拐点
            if (rl.mode !== 'straight' && (rl.waypoints?.length || 0) <= 1) { toast('曲线至少保留一个拐点'); return; }
            mutate(() => { rl.waypoints.splice(i, 1); });
          });
          viewport.appendChild(dot);
        });
      }
      // 线注释
      if (rl.note) {
        const ns = rl.noteStyle || {};
        const t = svgEl('text', {
          x: mx, y: my - 14, 'text-anchor': 'middle',
          'font-size': ns.size || 11.5,
          'font-weight': ns.bold ? 700 : 400,
          'font-style': ns.italic ? 'italic' : 'normal',
          'text-decoration': ns.underline ? 'underline' : (ns.strike ? 'line-through' : 'none'),
          fill: ns.color || 'var(--fg, #2c2c2a)',
          'font-family': ns.family ? `'${ns.family}',sans-serif` : '',
        });
        t.textContent = rl.note;
        viewport.appendChild(t);
      }
    }
  }

  function countDesc(node) {
    let n = 0;
    (function walk(x) { for (const c of x.children) { n++; walk(c); } })(node);
    return n;
  }

  // ==================== 编辑 ====================
  let editOpenedAt = 0;
  function startEdit(box) {
    const pos = boxPos(box);
    editOpenedAt = Date.now();
    ctl.editing = { kind: 'node', id: box.node.id };
    ctl.selected = box.node.id;
    const [sx, sy] = [pos.x * ctl.cam.k + ctl.cam.x, pos.y * ctl.cam.k + ctl.cam.y];
    editor.style.display = 'block';
    editor.style.left = sx + 'px';
    editor.style.top = sy + 'px';
    editor.style.width = Math.max(pos.w * ctl.cam.k, 90) + 'px';
    editor.style.height = Math.max(pos.h * ctl.cam.k, 40) + 'px';
    editor.value = box.node.text;
    editor.focus();
    editor.select();
  }
  function commitEdit() {
    if (!ctl.editing) return;
    const ed = ctl.editing;
    ctl.editing = null;
    editor.style.display = 'none';
    const v = editor.value.replace(/\s+$/, '');
    if (ed.kind === 'note') {
      const n = ctl.doc.notes.find(x => x.id === ed.id);
      if (n && n.text !== v) mutate(() => { n.text = v; });
      else render();
      return;
    }
    const node = findNode(ctl.doc.roots, ed.id || ed);
    if (node && node.text !== v) mutate(() => { node.text = v; });
    else render();
  }
  editor.addEventListener('blur', () => {
    // 打开后 250ms 内的幻影失焦忽略（双击时序引起）；之后点击他处 → 退出并保存
    if (Date.now() - editOpenedAt < 250) {
      requestAnimationFrame(() => { if (ctl.editing) editor.focus(); });
      return;
    }
    commitEdit();
  });
  editor.addEventListener('keydown', (e) => {
    // Enter 换行；Ctrl+Enter 退出并保存；Esc 取消
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { ctl.editing = null; editor.style.display = 'none'; }
    e.stopPropagation();
  });

  // ==================== 节点操作 ====================
  function addChildOf(id) {
    let newNode = null;
    mutate(() => { newNode = createNode(''); appendChild(ctl.doc.roots, id, newNode); });
    const box = ctl.boxes.get(newNode?.id);
    if (box) startEdit(box);
  }
  function addSiblingOf(id) {
    const parent = findParent(ctl.doc.roots, id);
    if (!parent) return addChildOf(id); // 根节点 → 向下扩展
    let newNode = null;
    mutate(() => { newNode = createNode(''); insertSibling(ctl.doc.roots, id, newNode); });
    const box = ctl.boxes.get(newNode?.id);
    if (box) startEdit(box);
  }
  function addRootAt(x, y) {
    let newNode = null;
    mutate(() => {
      newNode = createNode('');
      ctl.doc.roots.push(newNode);
      if (ctl.doc.mode === 'radial') { newNode.fx = x; newNode.fy = y; }
      else { newNode.offX = x; newNode.offY = y; }
    });
    const box = ctl.boxes.get(newNode?.id);
    if (box) startEdit(box);
  }
  function deleteNode(id) {
    const parent = findParent(ctl.doc.roots, id);
    mutate(() => removeNode(ctl.doc.roots, id));
    ctl.selected = parent?.id || null;
    render();
  }

  /** 实体防重合：把节点/便笺从其他节点与便笺中推出 */
  function resolveEntityOverlap(node) {
    const { resolveOverlap } = { resolveOverlap: null };
    // 收集全部实体（节点+便笺）
    const entities = [];
    for (const box of ctl.boxes.values()) {
      if (box.node === node) continue;
      const p = boxPos(box);
      entities.push({ x: p.x, y: p.y, w: p.w, h: p.h });
    }
    for (const n of ctl.doc.notes) entities.push({ x: n.x, y: n.y, w: n.w, h: n.w });
    const box = ctl.boxes.get(node.id);
    if (box) {
      const pos = boxPos(box);
      const e = { x: pos.x, y: pos.y, w: pos.w, h: pos.h };
      const resolved = _resolveOverlap(e, entities, 8);
      if (ctl.doc.mode === 'radial') {
        node.fx = (node.fx ?? box.x) + (resolved.x - pos.x);
        node.fy = (node.fy ?? box.y) + (resolved.y - pos.y);
      } else {
        node.offX = (node.offX || 0) + (resolved.x - pos.x);
        node.offY = (node.offY || 0) + (resolved.y - pos.y);
      }
    }
  }
  function _resolveOverlap(e, others, margin) {
    for (let iter = 0; iter < 20; iter++) {
      let moved = false;
      for (const o of others) {
        const ex = e.x + e.w / 2, ey = e.y + e.h / 2;
        const ox = o.x + o.w / 2, oy = o.y + o.h / 2;
        const dx = ex - ox, dy = ey - oy;
        const ox1 = (e.w + o.w) / 2 + margin - Math.abs(dx);
        const oy1 = (e.h + o.h) / 2 + margin - Math.abs(dy);
        if (ox1 > 0 && oy1 > 0) {
          if (ox1 < oy1) e.x += dx >= 0 ? ox1 : -ox1;
          else e.y += dy >= 0 ? oy1 : -oy1;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return e;
  }

  // ==================== 便笺操作 ====================
  function addNoteAt(x, y, text = '') {
    let note = null;
    mutate(() => {
      note = createNote(text, x - 75, y - 75);
      ctl.doc.notes.push(note);
      ctl.selectedNote = note.id;
    });
    return note;
  }
  function deleteNote(id) {
    mutate(() => {
      ctl.doc.notes = ctl.doc.notes.filter(n => n.id !== id);
      // 清理引用线
      ctl.doc.refLines = ctl.doc.refLines.filter(l => !(l.from.id === id || l.to.id === id));
    });
    ctl.selectedNote = null;
  }
  function onNotePointerDown(e, note) {
    e.stopPropagation();
    if (e.button !== 0) return;
    wrap.focus({ preventScroll: true });
    if (ctl.linkMode) return pickLinkTarget({ id: note.id, k: 'note' });
    // 只更新选中态（不全量 render，避免销毁 dblclick 目标）
    ctl.selectedNote = note.id;
    ctl.selected = null; ctl.selectedLine = null;
    viewport.querySelectorAll('.mm-note').forEach(g => {
      const r = g.querySelector('rect');
      if (r) r.setAttribute('stroke', g.dataset.id === note.id ? 'var(--acc, #4f46e5)' : '#e5c04b');
    });
    renderStylebar();
    drag = { type: 'note', id: note.id, sx: e.clientX, sy: e.clientY, ox: note.x, oy: note.y, moved: false };
  }
  function startEditNote(note) {
    editOpenedAt = Date.now();
    ctl.editing = { kind: 'note', id: note.id };
    const sx = note.x * ctl.cam.k + ctl.cam.x, sy = note.y * ctl.cam.k + ctl.cam.y;
    editor.style.display = 'block';
    editor.style.left = sx + 'px';
    editor.style.top = sy + 'px';
    editor.style.width = Math.max(note.w * ctl.cam.k, 110) + 'px';
    editor.value = note.text;
    editor.focus();
    editor.select();
  }

  // ==================== 引用线/多父级连接创建 ====================
  function startLinkMode() {
    ctl.linkMode = { type: 'ref', from: ctl.selected || ctl.selectedNote
      ? { id: ctl.selected || ctl.selectedNote, k: ctl.selected ? 'node' : 'note' } : null };
    toast(ctl.linkMode.from ? '引用线：点击目标节点或便笺' : '引用线：先点击出发节点/便笺');
  }
  function startParentLinkMode() {
    ctl.linkMode = { type: 'parent', from: ctl.selected ? { id: ctl.selected, k: 'node' } : null };
    toast(ctl.linkMode.from ? '加连接：点击入节点（可多父级）' : '加连接：先点击出节点');
  }
  function pickLinkTarget(ent) {
    if (!ctl.linkMode) return false;
    if (!ctl.linkMode.from) {
      ctl.linkMode.from = ent;
      toast(ctl.linkMode.type === 'parent' ? '加连接：再点击入节点' : '引用线：再点击到达节点/便笺');
      return true;
    }
    if (ctl.linkMode.from.id === ent.id) { toast('不能连自己'); return true; }
    const { from, type } = ctl.linkMode;
    if (type === 'parent') {
      // 便笺间/便笺-节点只能走引用线
      if (ent.k !== 'node' || from.k !== 'node') { toast('多父级连接仅限节点之间；便笺请用引用线'); ctl.linkMode = null; return true; }
      // 规则：禁止自连、禁止连到后代（防环）、禁止连到祖先（防环）、防重复；同级/同链子级/异链任意节点均可
      const isDesc = (function walk(x) { if (x.id === ent.id) return true; return x.children.some(walk); })(findNode(ctl.doc.roots, from.id) || { children: [] });
      if (isDesc) { toast('不能连接到后代节点'); ctl.linkMode = null; return true; }
      const isAnc = (function walk(x) { if (x.id === from.id) return true; return x.children.some(walk); })(findNode(ctl.doc.roots, ent.id) || { children: [] });
      if (isAnc) { toast('不能连接到祖先节点（会形成环）'); ctl.linkMode = null; return true; }
      if ((ctl.doc.parentLinks || []).some(l => l.from === from.id && l.to === ent.id)) { toast('该连接已存在'); ctl.linkMode = null; return true; }
      mutate(() => {
        ctl.doc.parentLinks = ctl.doc.parentLinks || [];
        ctl.doc.parentLinks.push(createParentLink(from.id, ent.id));
        ctl.selectedLine = ctl.doc.parentLinks[ctl.doc.parentLinks.length - 1].id;
      });
      ctl.linkMode = null;
      toast('已添加父级连接（数量不限，点线可删）');
      return true;
    }
    mutate(() => {
      ctl.doc.refLines.push(createRefLine(from.id, from.k, ent.id, ent.k));
      ctl.selectedLine = ctl.doc.refLines[ctl.doc.refLines.length - 1].id;
    });
    ctl.linkMode = null;
    toast('引用线已创建（点线可编辑颜色/粗细/注释）');
    return true;
  }

  // ==================== 连接线/引用线样式编辑 ====================
  function editLineStyle(key, value) {
    if (!ctl.selectedLine) return;
    mutate(() => {
      if (ctl.selectedLine.startsWith('conn:')) {
        const nodeId = ctl.selectedLine.slice(5);
        const n = findNode(ctl.doc.roots, nodeId);
        if (!n) return;
        if (key === 'mode') n.linkMode = value || null;          // 线型（'' = 跟随全局）
        else if (key === 'color') n.linkColor = value || null;   // 线色
        else if (key === 'width') n.linkWidth = +value || null;  // 线宽
        else { n.linkNote = { ...(n.linkNote || {}), [key]: value }; } // 注释样式
      } else {
        const rl = ctl.doc.refLines.find(l => l.id === ctl.selectedLine)
          || (ctl.doc.parentLinks || []).find(l => l.id === ctl.selectedLine);
        if (!rl) return;
        if (key === 'note') rl.note = value;
        else if (key === 'color') rl.color = value;
        else if (key === 'width') rl.width = +value || null;
        else { rl.noteStyle = { ...(rl.noteStyle || {}), [key]: value }; }
      }
    });
  }
  function deleteSelectedLine() {
    if (!ctl.selectedLine) return;
    mutate(() => {
      if (ctl.selectedLine.startsWith('conn:')) {
        // 连接线 = 树结构本身：只清自定义样式，不删结构
        const n = findNode(ctl.doc.roots, ctl.selectedLine.slice(5));
        if (n) { delete n.linkNote; delete n.linkMode; delete n.linkWps; delete n.linkColor; delete n.linkWidth; }
      } else if (ctl.selectedLine.startsWith('pl')) {
        ctl.doc.parentLinks = ctl.doc.parentLinks.filter(l => l.id !== ctl.selectedLine);
      } else {
        ctl.doc.refLines = ctl.doc.refLines.filter(l => l.id !== ctl.selectedLine);
      }
    });
    ctl.selectedLine = null;
  }

  // ==================== 右键选单（节点/空白/线三套） ====================
  function mmMenu(items, x, y) {
    document.querySelector('.mazz-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'mazz-menu';
    for (const it of items) {
      if (it === '-') {
        const sep = document.createElement('div');
        sep.className = 'mazz-menu-sep';
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'mazz-menu-item';
      row.textContent = it.label;
      row.addEventListener('click', () => { menu.remove(); it.fn?.(); });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, innerHeight - rect.height - 8) + 'px';
    setTimeout(() => {
      window.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) menu.remove(); }, { once: true });
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.remove(); }, { once: true });
    }, 0);
  }

  /** 节点右键：编辑/新建/连接/删除 */
  function showNodeMenu(x, y, box) {
    const id = box.node.id;
    mmMenu([
      { label: '编辑文字', fn: () => startEdit(box) },
      { label: '新建子节点', fn: () => addChildOf(id) },
      { label: '新建同级节点（Alt+Enter）', fn: () => addSiblingOf(id) },
      { label: '新建根节点', fn: () => { const r = wrap.getBoundingClientRect(); addRootAt((r.width / 2 - ctl.cam.x) / ctl.cam.k, (r.height / 2 - ctl.cam.y) / ctl.cam.k); } },
      '-',
      { label: '添加父级连接（多父级）', fn: () => { ctl.selected = id; startParentLinkMode(); } },
      { label: '绘制引用线', fn: () => { ctl.selected = id; startLinkMode(); } },
      '-',
      { label: '删除节点', fn: () => deleteNode(id) },
    ], x, y);
  }

  /** 空白右键：新建/视图 */
  function showBlankMenu(x, y) {
    const rect = wrap.getBoundingClientRect();
    const wx = (x - rect.left - ctl.cam.x) / ctl.cam.k;
    const wy = (y - rect.top - ctl.cam.y) / ctl.cam.k;
    mmMenu([
      { label: '新建根节点', fn: () => addRootAt(wx, wy) },
      { label: '新建便笺', fn: () => addNoteAt(wx, wy) },
      '-',
      { label: '适应视图', fn: () => fitView() },
      { label: '一键美化重排', fn: () => beautify() },
    ], x, y);
  }

  /** 线右键：直曲切换/加拐点/删除（连接线=清除自定义样式） */
  function showLineMenu(x, y) {
    const id = ctl.selectedLine;
    if (!id) return;
    const isConn = id.startsWith('conn:');
    const items = [];
    items.push({
      label: isConn ? '清除本线自定义样式' : '删除这条线',
      fn: () => deleteSelectedLine(),
    });
    if (isConn) {
      const node = findNode(ctl.doc.roots, id.slice(5));
      items.unshift({
        label: (node?.linkMode || ctl.doc.linkStyle?.mode) === 'straight' ? '切换为曲线' : '切换为直线（直角）',
        fn: () => mutate(() => {
          if (!node) return;
          node.linkMode = ((node.linkMode || ctl.doc.linkStyle?.mode) === 'straight') ? 'curve' : 'straight';
        }),
      });
    } else {
      const rl = ctl.doc.refLines.find(l => l.id === id) || (ctl.doc.parentLinks || []).find(l => l.id === id);
      if (rl) {
        items.unshift(
          {
            label: rl.mode === 'straight' ? '切换为曲线' : '切换为直线（直角）',
            fn: () => mutate(() => {
              rl.mode = rl.mode === 'straight' ? 'curve' : 'straight';
              if (rl.mode === 'straight' && !(rl.waypoints?.length)) {
                const a = entityCenter(rl.from.id, rl.from.k), c = entityCenter(rl.to.id, rl.to.k);
                rl.waypoints = defaultTwoWaypoints(a, c);
              }
            }),
          },
          {
            label: '在线中点加拐点',
            fn: () => mutate(() => {
              const a = entityCenter(rl.from.id, rl.from.k), c = entityCenter(rl.to.id, rl.to.k);
              rl.waypoints = rl.waypoints || [];
              rl.waypoints.push({ x: (a.cx + c.cx) / 2, y: (a.cy + c.cy) / 2 - 20 });
            }),
          },
        );
      }
    }
    mmMenu(items, x, y);
  }

  // ==================== 一键重排美化 ====================
  function beautify() {
    mutate(() => {
      for (const box of ctl.boxes?.values() || []) {
        delete box.node.offX; delete box.node.offY; delete box.node.fx; delete box.node.fy;
      }
      for (const n of ctl.doc.roots) { delete n.offX; delete n.offY; delete n.fx; delete n.fy; }
    });
    requestAnimationFrame(fitView);
    toast('已重排美化');
  }

  // ==================== 交互 ====================
  let drag = null; // {type:'pan'|'node', ...}
  const RADIAL = () => ctl.doc.mode === 'radial';
  function onNodePointerDown(e, box) {
    e.stopPropagation();
    if (e.button !== 0) return;
    wrap.focus({ preventScroll: true });
    if (ctl.linkMode) return pickLinkTarget({ id: box.node.id, k: 'node' });
    // 只更新选中态（不全量 render，避免销毁 dblclick 目标导致编辑打不开）
    ctl.selected = box.node.id;
    ctl.selectedNote = null; ctl.selectedLine = null;
    viewport.querySelectorAll('.mm-node').forEach(n => {
      const on = n.dataset.id === box.node.id;
      const r = n.querySelector('rect');
      if (r) {
        const depth = ctl.boxes.get(n.dataset.id)?.depth ?? 0;
        r.setAttribute('stroke', on ? (r.dataset.acc || 'var(--acc, #4f46e5)') : (depth === 0 ? 'none' : 'var(--bd, #d8d6cf)'));
        r.setAttribute('stroke-width', on ? 2 : 1.2);
      }
    });
    renderStylebar();
    drag = { type: 'node', id: box.node.id, sx: e.clientX, sy: e.clientY, moved: false, orig: { offX: box.node.offX || 0, offY: box.node.offY || 0, fx: box.node.fx, fy: box.node.fy } };
  }

  wrap.addEventListener('pointerdown', (e) => {
    if (e.target === svg || e.target === viewport) {
      wrap.focus({ preventScroll: true });
      drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...ctl.cam } };
      ctl.selected = null;
      render();
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || current !== ctl) return;
    if (drag.type === 'pan') {
      ctl.cam.x = drag.cam.x + (e.clientX - drag.sx);
      ctl.cam.y = drag.cam.y + (e.clientY - drag.sy);
      viewport.setAttribute('transform', `translate(${ctl.cam.x},${ctl.cam.y}) scale(${ctl.cam.k})`);
    } else if (drag.type === 'resize') {
      // 调尺寸：不小于内容完整显示所需（底线）
      const node = findNode(ctl.doc.roots, drag.id);
      if (node) {
        const box = ctl.boxes.get(drag.id);
        const dx = (e.clientX - drag.sx) / ctl.cam.k, dy = (e.clientY - drag.sy) / ctl.cam.k;
        node.w = Math.max(box?.w || 90, drag.ow + dx);
        node.h = Math.max(box?.h || 36, drag.oh + dy);
        renderPositionsOnly();
      }
    } else if (drag.type === 'note') {
      const dx = (e.clientX - drag.sx) / ctl.cam.k, dy = (e.clientY - drag.sy) / ctl.cam.k;
      if (Math.abs(dx) + Math.abs(dy) > 3 / ctl.cam.k) {
        drag.moved = true;
        const n = ctl.doc.notes.find(x => x.id === drag.id);
        if (n) {
          n.x = drag.ox + dx;
          n.y = drag.oy + dy;
          const g = viewport.querySelector(`.mm-note[data-id="${drag.id}"]`);
          if (g) g.setAttribute('transform', `translate(${n.x},${n.y})`);
        }
      }
    } else if (drag.type === 'wp') {
      // 拐点拖拽（曲线=调弯曲，直线=调拐点位）
      const dx = (e.clientX - drag.sx) / ctl.cam.k, dy = (e.clientY - drag.sy) / ctl.cam.k;
      const rl = drag.rl;
      if (rl.mode === 'straight') {
        rl.waypoints[drag.idx] = { x: drag.ox + dx, y: drag.oy + dy };
      } else {
        rl.waypoints = rl.waypoints?.length ? rl.waypoints : [];
        rl.waypoints[drag.idx] = { x: drag.ox + dx, y: drag.oy + dy };
        rl.bend = rl.waypoints[drag.idx].x - ((entityCenter(rl.from.id, rl.from.k)?.cx + entityCenter(rl.to.id, rl.to.k)?.cx) / 2 || 0);
      }
      // 实时重绘路径（轻量：只更新 path d 和手柄位）
      const pathEl = viewport.querySelector(`.mm-refline[data-id="${rl.id}"]`);
      if (pathEl) {
        const a = entityCenter(rl.from.id, rl.from.k), c = entityCenter(rl.to.id, rl.to.k);
        if (rl.mode === 'straight') {
          const pts = refLinePoints(rl, a, c);
          pathEl.setAttribute('d', 'M' + pts.map(p => p.join(',')).join(' L'));
        } else {
          const ctrl = rl.waypoints[drag.idx];
          pathEl.setAttribute('d', `M${a.x},${a.y} Q${ctrl.x},${ctrl.y} ${c.x},${c.y}`);
        }
      }
      const dot = viewport.querySelectorAll('.mm-wp')[drag.idx];
      if (dot) { dot.setAttribute('cx', rl.waypoints[drag.idx].x); dot.setAttribute('cy', rl.waypoints[drag.idx].y); }
    } else if (drag.type === 'connwp') {
      // 连接线拐点拖拽（直线模式）
      const dx = (e.clientX - drag.sx) / ctl.cam.k, dy = (e.clientY - drag.sy) / ctl.cam.k;
      drag.node.linkWps[drag.idx] = { x: drag.ox + dx, y: drag.oy + dy };
      render();
    } else if (drag.type === 'node') {
      const dx = (e.clientX - drag.sx) / ctl.cam.k, dy = (e.clientY - drag.sy) / ctl.cam.k;
      if (Math.abs(dx) + Math.abs(dy) > 4 / ctl.cam.k) {
        drag.moved = true;
        const node = findNode(ctl.doc.roots, drag.id);
        if (!node) return;
        // 实时预览位置
        if (RADIAL()) {
          const box = ctl.boxes.get(drag.id);
          node.fx = (drag.orig.fx ?? box.x) + dx;
          node.fy = (drag.orig.fy ?? box.y) + dy;
        } else {
          node.offX = drag.orig.offX + dx;
          node.offY = drag.orig.offY + dy;
        }
        // 吸附目标高亮（拖到别的节点上 = 改父级）
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.mm-node');
        viewport.querySelectorAll('.mm-node rect').forEach(r => r.style.strokeDasharray = '');
        if (el && el.dataset.id !== drag.id) {
          el.querySelector('rect').style.strokeDasharray = '4 3';
          drag.target = el.dataset.id;
        } else drag.target = null;
        // 轻量重渲染（拖拽中）
        renderPositionsOnly();
      }
    }
  });
  function renderPositionsOnly() {
    for (const [id, box] of ctl.boxes) {
      const g = viewport.querySelector(`.mm-node[data-id="${id}"]`);
      if (!g) continue;
      const pos = boxPos(box);
      g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    }
  }
  window.addEventListener('pointerup', (e) => {
    if (!drag || current !== ctl) return;
    if (drag.type === 'wp' || drag.type === 'resize' || drag.type === 'connwp') {
      mutate(() => {}); // 落位入栈
      drag = null;
      return;
    }
    if (drag.type === 'note') {
      // 只有真实拖动过才做避让落位（普通点击/双击不改变位置）
      if (drag.moved) {
        const n = ctl.doc.notes.find(x => x.id === drag.id);
        if (n) {
          snapshot();
          const others = [
            ...ctl.doc.notes.filter(x => x.id !== n.id).map(x => ({ x: x.x, y: x.y, w: x.w, h: x.w })),
            ...[...ctl.boxes.values()].map(b => { const p = boxPos(b); return { x: p.x, y: p.y, w: p.w, h: p.h }; }),
          ];
          const e = _resolveOverlap({ x: n.x, y: n.y, w: n.w, h: n.w }, others, 8);
          n.x = e.x; n.y = e.y;
          render();
          window.MazzHost?.notifyChange(container);
        }
      }
      drag = null;
      return;
    }
    if (drag.type === 'node' && drag.moved) {
      const node = findNode(ctl.doc.roots, drag.id);
      if (drag.target && drag.target !== drag.id && node) {
        // 拖到别的节点上 = 改父级（清除手动坐标）
        mutate(() => {
          delete node.offX; delete node.offY; delete node.fx; delete node.fy;
          moveNode(ctl.doc.roots, drag.id, drag.target);
        });
      } else {
        // 自由移动落位 + 防重合（节点/便笺互相避让）
        snapshot();
        resolveEntityOverlap(node);
        render();
        window.MazzHost?.notifyChange(container);
      }
      viewport.querySelectorAll('.mm-node rect').forEach(r => r.style.strokeDasharray = '');
    }
    drag = null;
  });
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const k2 = Math.min(Math.max(ctl.cam.k * f, 0.25), 3);
    ctl.cam.x = mx - (mx - ctl.cam.x) * (k2 / ctl.cam.k);
    ctl.cam.y = my - (my - ctl.cam.y) * (k2 / ctl.cam.k);
    ctl.cam.k = k2;
    viewport.setAttribute('transform', `translate(${ctl.cam.x},${ctl.cam.y}) scale(${ctl.cam.k})`);
  }, { passive: false });
  wrap.addEventListener('contextmenu', (e) => {
    if (e.target === svg || e.target === viewport) {
      e.preventDefault();
      showBlankMenu(e.clientX, e.clientY);
    }
  });
  wrap.addEventListener('dblclick', (e) => {
    if (e.target === svg || e.target === viewport) {
      const rect = wrap.getBoundingClientRect();
      const x = (e.clientX - rect.left - ctl.cam.x) / ctl.cam.k;
      const y = (e.clientY - rect.top - ctl.cam.y) / ctl.cam.k;
      // Shift+双击空白 → 新增便笺；普通双击 → 新增根节点
      if (e.shiftKey) addNoteAt(x, y);
      else addRootAt(x, y);
    }
  });

  // 键盘路由
  document.addEventListener('keydown', (e) => {
    if (current !== ctl || ctl.editing) return;
    const id = ctl.selected;
    // Ctrl+Z 撤销 / Ctrl+Alt+Z（或 Ctrl+Y）重做（用户要求绑定，v34）
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault(); e.stopPropagation();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ((e.altKey && e.key.toLowerCase() === 'z') || (!e.altKey && e.key.toLowerCase() === 'y'))) {
      e.preventDefault(); e.stopPropagation();
      redo();
      return;
    }
    // 组合键优先判定（Ctrl+Alt+J 加连接——原 Ctrl+Alt+L 与网易云全局键冲突，v34 换键；Alt+Enter 同级；单键 Tab 子节点殿后）
    if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'l')) {
      e.preventDefault();
      if (id) { if (!ctl.linkMode) startParentLinkMode(); pickLinkTarget({ id, k: 'node' }); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) return; // Ctrl 组合走全局键位
    if (e.key === 'Tab' && id) { e.preventDefault(); addChildOf(id); }
    else if (e.key === 'Enter' && e.altKey && id) { e.preventDefault(); addSiblingOf(id); } // Alt+Enter 新建同级（避开与编辑器换行冲突）
    else if ((e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      if (ctl.selectedLine) deleteSelectedLine();
      else if (ctl.selectedNote) deleteNote(ctl.selectedNote);
      else if (id) deleteNode(id);
    }
    else if (e.key === 'Escape') { ctl.linkMode = null; render(); }
    else if (e.key === 'F2' && id) { e.preventDefault(); const b = ctl.boxes.get(id); if (b) startEdit(b); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!ctl.boxes) return;
      e.preventDefault();
      const arr = [...ctl.boxes.values()].sort((a, b) => a.y - b.y || a.x - b.x);
      const i = arr.findIndex(b => b.node.id === id);
      const next = e.key === 'ArrowUp' ? arr[i - 1] : arr[i + 1];
      if (next) { ctl.selected = next.node.id; render(); }
      else if (i < 0 && arr.length) { ctl.selected = arr[0].node.id; render(); }
    }
  });

  // ==================== 样式条（选中节点/便笺/线时） ====================
  function renderStylebar() {
    // 便笺样式条
    if (ctl.selectedNote) {
      const n = ctl.doc.notes.find(x => x.id === ctl.selectedNote);
      if (!n) { stylebar.style.display = 'none'; return; }
      stylebar.style.display = 'flex';
      stylebar.innerHTML = `
        <span style="font-size:11.5px;color:var(--fg-dim)">便笺</span>
        <select class="mm-sb" data-n="__size" title="字号">${[11, 12, 14, 16, 20].map(v => `<option value="${v}" ${+(n.style?.size || 12) === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="mm-sb-btn ${n.style?.bold ? 'on' : ''}" data-n="bold" title="加粗"><b>B</b></button>
        <button class="mm-sb-btn ${n.style?.italic ? 'on' : ''}" data-n="italic" title="斜体"><i>I</i></button>
        <input type="color" class="mm-sb-color" data-n="__textcolor" value="${n.style?.color || '#5b4a1e'}" title="文字颜色">
        <input type="color" class="mm-sb-color" data-n="__notecolor" value="${n.color || '#fde68a'}" title="便笺底色">
        <button class="mm-sb-btn" data-n="__del" title="删除便笺">✕</button>`;
      stylebar.querySelectorAll('[data-n]').forEach(el => el.addEventListener('change', () => onNoteStyle(el.dataset.n, el.value)));
      stylebar.querySelectorAll('[data-n]').forEach(el => el.addEventListener('click', () => onNoteStyle(el.dataset.n, el.value)));
      return;
    }
    // 连接线/引用线/多父级连接线样式条
    if (ctl.selectedLine) {
      const isConn = ctl.selectedLine.startsWith('conn:');
      const isPl = ctl.selectedLine.startsWith('pl');
      const connNode = isConn ? findNode(ctl.doc.roots, ctl.selectedLine.slice(5)) : null;
      const rl = isConn ? null : (ctl.doc.refLines.find(l => l.id === ctl.selectedLine) || (ctl.doc.parentLinks || []).find(l => l.id === ctl.selectedLine));
      const curNote = isConn ? (connNode?.linkNote || {}) : { text: rl?.note || '', ...(rl?.noteStyle || {}) };
      const curMode = isConn ? (connNode?.linkMode || '') : (rl?.mode || 'curve');
      const curColor = isConn ? (connNode?.linkColor || '') : (rl?.color || '');
      const curWidth = isConn ? (connNode?.linkWidth || 0) : (rl?.width || 0);
      stylebar.style.display = 'flex';
      stylebar.innerHTML = `
        <span style="font-size:11.5px;color:var(--fg-dim)">${isConn ? '连接线' : (isPl ? '多父连接' : '引用线')}</span>
        <select class="mm-sb" data-l="__mode" title="线型">
          ${isConn ? `<option value="" ${curMode === '' ? 'selected' : ''}>跟随全局</option>` : ''}
          <option value="curve" ${curMode === 'curve' ? 'selected' : ''}>曲线</option>
          <option value="straight" ${curMode === 'straight' ? 'selected' : ''}>直线（直角）</option>
        </select>
        <input type="color" class="mm-sb-color" data-l="color" value="${curColor || '#94a3b8'}" title="线色">
        <select class="mm-sb" data-l="width" title="线宽">
          ${isConn ? `<option value="0" ${!curWidth ? 'selected' : ''}>默认</option>` : ''}
          ${[1.5, 2, 3, 4.5].map(v => `<option value="${v}" ${+curWidth === v ? 'selected' : ''}>${v}px</option>`).join('')}
        </select>
        <input class="mm-sb" data-l="note" placeholder="线注释…" value="${(curNote.text || '').replace(/"/g, '&quot;')}" style="width:130px;padding:2px 6px">
        <button class="mm-sb-btn ${curNote.bold ? 'on' : ''}" data-l="__lb" title="注释加粗"><b>B</b></button>
        <button class="mm-sb-btn ${curNote.italic ? 'on' : ''}" data-l="__li" title="注释斜体"><i>I</i></button>
        <button class="mm-sb-btn ${curNote.underline ? 'on' : ''}" data-l="__lu" title="注释下划线"><u>U</u></button>
        <button class="mm-sb-btn ${curNote.strike ? 'on' : ''}" data-l="__ls" title="注释删除线"><s>S</s></button>
        <input type="color" class="mm-sb-color" data-l="__nc" value="${curNote.color || '#2c2c2a'}" title="注释颜色">
        <select class="mm-sb" data-l="__ns" title="注释字号">${[10, 11.5, 13, 16].map(v => `<option value="${v}" ${+(curNote.size || 11.5) === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="mm-sb-btn" data-l="__del" title="${isConn ? '清除自定义样式' : '删除这条线'}">✕</button>
        <span style="font-size:11px;color:var(--fg-dim)">双击线加拐点 · 右键拐点删除</span>`;
      // 控件只绑 change（选完才应用）：click 就应用会立刻 mutate→render 重建样式条，
      // 正在下拉的 select/输入框被瞬间销毁（v33 实测闪缩/失焦根因）；按钮类只绑 click
      stylebar.querySelectorAll('[data-l]').forEach(el => {
        if (el.classList.contains('mm-sb-btn')) el.addEventListener('click', () => onLineStyle(el.dataset.l, el.value, el));
        else el.addEventListener('change', () => onLineStyle(el.dataset.l, el.value, el));
      });
      return;
    }
    const node = ctl.selected && findNode(ctl.doc.roots, ctl.selected);
    if (!node) {
      // 无线选中：显示全局操作（模板/布局/配色），模板不再非得选中节点（v33 反馈）
      stylebar.style.display = 'flex';
      stylebar.innerHTML = `
        <span style="font-size:11.5px;color:var(--fg-dim)">全局</span>
        <select class="mm-sb" data-k="__template" title="样式模板"></select>
        <select class="mm-sb" data-k="__mode" title="展开方式">
          <option value="lr" ${ctl.doc.mode === 'lr' ? 'selected' : ''}>自左向右</option>
          <option value="tb" ${ctl.doc.mode === 'tb' ? 'selected' : ''}>自上向下</option>
          <option value="radial" ${ctl.doc.mode === 'radial' ? 'selected' : ''}>全向环绕</option>
        </select>
        <select class="mm-sb" data-k="__scheme" title="各级配色方案">
          ${LEVEL_SCHEMES.map((sc, i) => `<option value="${i}" ${ctl.doc.scheme === i ? 'selected' : ''}>${sc.name}配色</option>`).join('')}
        </select>
        <button class="mm-sb-btn" data-k="__beautify" title="一键美化（清手动痕迹自动重排）">美化</button>
        <button class="mm-sb-btn ${ctl.doc.showGrid ? 'on' : ''}" data-k="__grid" title="网格坐标线（手动定位辅助）">网格</button>`;
      stylebar.querySelector('[data-k="__mode"]').addEventListener('change', (e) => mutate(() => { ctl.doc.mode = e.target.value; }));
      stylebar.querySelector('[data-k="__scheme"]').addEventListener('change', (e) => mutate(() => { ctl.doc.scheme = +e.target.value; }));
      stylebar.querySelector('[data-k="__beautify"]').addEventListener('click', () => beautify());
      stylebar.querySelector('[data-k="__grid"]').addEventListener('click', (e) => {
        mutate(() => { ctl.doc.showGrid = !ctl.doc.showGrid; });
        e.currentTarget.classList.toggle('on', !!ctl.doc.showGrid);
      });
      renderTemplateSelect();
      return;
    }
    const s = node.style || (node.style = {});
    stylebar.style.display = 'flex';
    stylebar.innerHTML = `
      <select class="mm-sb" data-k="__family" title="字体">
        <option value="">字体</option><option value="宋体" ${s.family === '宋体' ? 'selected' : ''}>宋体</option>
        <option value="黑体" ${s.family === '黑体' ? 'selected' : ''}>黑体</option>
        <option value="楷体" ${s.family === '楷体' ? 'selected' : ''}>楷体</option>
        <option value="Consolas" ${s.family === 'Consolas' ? 'selected' : ''}>Consolas</option>
      </select>
      <select class="mm-sb" data-k="__size" title="字号">
        ${[11, 12.5, 14, 16, 18, 22, 28].map(v => `<option value="${v}" ${+(s.size || 0) === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <button class="mm-sb-btn ${s.bold ? 'on' : ''}" data-k="bold" title="加粗"><b>B</b></button>
      <button class="mm-sb-btn ${s.italic ? 'on' : ''}" data-k="italic" title="斜体"><i>I</i></button>
      <button class="mm-sb-btn ${s.underline ? 'on' : ''}" data-k="underline" title="下划线"><u>U</u></button>
      <button class="mm-sb-btn ${s.strike ? 'on' : ''}" data-k="strike" title="删除线"><s>S</s></button>
      <select class="mm-sb" data-k="__align" title="对齐">
        <option value="">居中</option><option value="left" ${s.align === 'left' ? 'selected' : ''}>左</option>
        <option value="right" ${s.align === 'right' ? 'selected' : ''}>右</option>
      </select>
      <input type="color" class="mm-sb-color" data-k="__color" value="${s.color || (node.color || '#4f46e5')}" title="文字颜色">
      <input type="color" class="mm-sb-color" data-k="__nodecolor" value="${node.color || '#4f46e5'}" title="节点颜色">
      <button class="mm-sb-btn" data-k="__clearcolor" title="清除自定义颜色">✕</button>
      <select class="mm-sb" data-k="__scheme" title="各级配色方案">
        ${LEVEL_SCHEMES.map((sc, i) => `<option value="${i}" ${ctl.doc.scheme === i ? 'selected' : ''}>${sc.name}配色</option>`).join('')}
      </select>
      <select class="mm-sb" data-k="__mode" title="展开方式">
        <option value="lr" ${ctl.doc.mode === 'lr' ? 'selected' : ''}>自左向右</option>
        <option value="tb" ${ctl.doc.mode === 'tb' ? 'selected' : ''}>自上向下</option>
        <option value="radial" ${ctl.doc.mode === 'radial' ? 'selected' : ''}>全向环绕</option>
      </select>
      <span style="width:1px;height:18px;background:var(--bd,#e0ded8)"></span>
      <select class="mm-sb" data-k="__template" title="样式模板"></select>
      <button class="mm-sb-btn" data-k="__tpl-import" title="导入模板 JSON">导入</button>
      <button class="mm-sb-btn" data-k="__tpl-blank" title="生成空白模板到 mindmap-templates/">空白模板</button>
      <button class="mm-sb-btn" data-k="__tpl-del" title="删除当前自定义模板（预置不可删）">删模板</button>
      <button class="mm-sb-btn ${ctl.doc.showGrid ? 'on' : ''}" data-k="__grid" title="网格坐标线（手动定位辅助）">网格</button>`;
    stylebar.querySelectorAll('[data-k]').forEach(el => {
      if (el.classList.contains('mm-sb-btn')) el.addEventListener('click', () => onStyleChange(el.dataset.k, el.value));
      else el.addEventListener('change', () => onStyleChange(el.dataset.k, el.value));
    });
    renderTemplateSelect();
  }

  // ==================== 模板选单 ====================
  async function renderTemplateSelect() {
    const sel = stylebar.querySelector('[data-k="__template"]');
    if (!sel) return;
    const list = await listTemplates();
    sel.innerHTML =
      `<optgroup label="预置模板">${list.filter(t => t.builtin).map(t => `<option value="${t.id}" ${ctl.template.id === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</optgroup>` +
      (list.some(t => !t.builtin) ? `<optgroup label="自定义模板">${list.filter(t => !t.builtin).map(t => `<option value="${t.id}" ${ctl.template.id === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</optgroup>` : '');
    if (!sel._bound) {
      sel._bound = true;
      sel.addEventListener('change', async () => {
        const list2 = await listTemplates();
        const t = list2.find(x => x.id === sel.value);
        if (t) { ctl.template = t; render(); toast(`已切换模板：${t.name}`); }
      });
    }
  }
  function onNoteStyle(k, v) {
    const n = ctl.doc.notes.find(x => x.id === ctl.selectedNote);
    if (!n) return;
    const s = n.style || (n.style = {});
    mutate(() => {
      if (k === 'bold') s.bold = !s.bold;
      else if (k === 'italic') s.italic = !s.italic;
      else if (k === '__size') s.size = +v;
      else if (k === '__textcolor') s.color = v;
      else if (k === '__notecolor') n.color = v;
      else if (k === '__del') deleteNote(n.id);
    });
  }
  function onLineStyle(k, v, el) {
    if (k === '__del') return deleteSelectedLine();
    if (k === '__lb' || k === '__li' || k === '__lu' || k === '__ls') {
      const key = { __lb: 'bold', __li: 'italic', __lu: 'underline', __ls: 'strike' }[k];
      const cur = el.classList.contains('on');
      editLineStyle(key, !cur);
      el.classList.toggle('on', !cur);
      return;
    }
    if (k === '__mode') {
      if (ctl.selectedLine?.startsWith('conn:')) {
        editLineStyle('mode', v); // '' = 跟随全局
      } else {
        const rl = ctl.doc.refLines.find(l => l.id === ctl.selectedLine)
          || (ctl.doc.parentLinks || []).find(l => l.id === ctl.selectedLine);
        if (rl) mutate(() => {
          rl.mode = v;
          // 切直线默认两拐（直出→拐→拐直入）
          if (v === 'straight' && !(rl.waypoints?.length)) {
            const a = entityCenter(rl.from.id, rl.from.k), c = entityCenter(rl.to.id, rl.to.k);
            rl.waypoints = defaultTwoWaypoints(a, c);
          }
        });
      }
      return;
    }
    if (k === 'color') return editLineStyle('color', v);
    if (k === 'width') return editLineStyle('width', v);
    if (k === '__nc') return editLineStyle('color', v);
    if (k === '__ns') return editLineStyle('size', +v);
    editLineStyle(k, v);
  }

  function onStyleChange(k, v) {
    const node = ctl.selected && findNode(ctl.doc.roots, ctl.selected);
    if (!node) return;
    const s = node.style || (node.style = {});
    mutate(() => {
      if (k === 'bold' || k === 'italic' || k === 'underline' || k === 'strike') s[k] = !s[k];
      else if (k === '__family') s.family = v || null;
      else if (k === '__size') s.size = +v || null;
      else if (k === '__align') s.align = v || null;
      else if (k === '__color') s.color = v;
      else if (k === '__nodecolor') node.color = v;
      else if (k === '__clearcolor') { delete node.color; delete s.color; }
      else if (k === '__scheme') ctl.doc.scheme = +v;
      else if (k === '__mode') {
        ctl.doc.mode = v;
        // 切布局清手动坐标（避免错位）
        for (const box of ctl.boxes.values()) { delete box.node.offX; delete box.node.offY; delete box.node.fx; delete box.node.fy; }
      }
      else if (k === '__tpl-import') {
        (async () => {
          const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: '导图模板', extensions: ['json'] }] }).catch(() => null);
          if (!p) return;
          try {
            const text = await window.mazz.invoke('fs:readFile', { path: p });
            const { validateTemplate, tplDir } = await import('./templates.js');
            const t = validateTemplate(text, p.split(/[\\/]/).pop().replace('.json', ''));
            if (!t) throw new Error('不是合法模板（需含 levels 配色数组）');
            const dir = await tplDir();
            await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
            await window.mazz.invoke('fs:writeFile', { path: `${dir}/${t.name}.json`, content: text });
            await renderTemplateSelect();
            toast('模板已导入');
          } catch (e) { toast('导入失败：' + e.message); }
        })();
        return;
      }
      else if (k === '__tpl-blank') {
        (async () => {
          const p = await obtainBlankTemplate();
          await renderTemplateSelect();
          toast('空白模板已生成：' + p.split('/').pop());
        })();
        return;
      }
      else if (k === '__tpl-del') {
        if (ctl.template.builtin) { toast('预置模板不可删除'); return; }
        (async () => {
          await deleteTemplate(ctl.template.id);
          ctl.template = PRESET_TEMPLATES[0];
          await renderTemplateSelect();
          render();
          toast('已删除模板');
        })();
        return;
      }
      else if (k === '__grid') {
        mutate(() => { ctl.doc.showGrid = !ctl.doc.showGrid; });
        return;
      }
    });
    fitViewSoon();
  }
  let fitT = 0;
  function fitViewSoon() { clearTimeout(fitT); fitT = setTimeout(fitView, 60); }

  // ==================== 视图 ====================
  function fitView() {
    if (!ctl.layoutInfo) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const k = Math.min(w / (ctl.layoutInfo.width + 60), h / (ctl.layoutInfo.height + 60), 1.4);
    ctl.cam.k = k;
    ctl.cam.x = (w - ctl.layoutInfo.width * k) / 2;
    ctl.cam.y = (h - ctl.layoutInfo.height * k) / 2;
    viewport.setAttribute('transform', `translate(${ctl.cam.x},${ctl.cam.y}) scale(${ctl.cam.k})`);
  }

  // ==================== 导出 ====================
  async function exportPNG() {
    const L = ctl.layoutInfo;
    if (!L) return;
    const clone = svg.cloneNode(true);
    clone.querySelectorAll('.mm-grid-bg, .mm-grid-bg2').forEach(el => el.remove()); // 网格仅作绘图参考，不导出
    clone.querySelectorAll('.mm-fold, .mm-wp, .mm-conn-hit, .mm-refline-hit, .mm-sel-ring').forEach(el => el.remove()); // 交互件（折叠钮/手柄/命中层/选中环）不进导出
    clone.querySelector('.mm-viewport').setAttribute('transform', 'translate(20,20) scale(1)');
    clone.setAttribute('width', L.width + 40);
    clone.setAttribute('height', L.height + 40);
    clone.setAttribute('xmlns', NS);
    const style = document.createElementNS(NS, 'style');
    style.textContent = `text{font-family:"PingFang SC","Microsoft YaHei",sans-serif}.mm-viewport rect{stroke:#d8d6cf}`;
    clone.insertBefore(style, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = (L.width + 40) * scale;
    canvas.height = (L.height + 40) * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    if (window.mazz?.isElectron) {
      const p = await window.mazz.invoke('dialog:saveFile', { defaultPath: (ctl.title || '思维导图') + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (p) {
        await window.mazz.invoke('fs:writeFileBase64', { path: p, base64: dataUrl.split(',')[1] });
        toast('已导出 PNG');
      }
    } else {
      const a = document.createElement('a');
      a.href = dataUrl; a.download = '思维导图.png'; a.click();
    }
  }

  function exportOutline() {
    window.MazzHost?.openTab('markdown', { title: (ctl.title || '思维导图') + '.md', content: toOutline(ctl.doc.roots) });
  }

  /** 导出 SVG 矢量图 */
  async function exportSVG() {
    const L = ctl.layoutInfo;
    if (!L) return;
    const clone = svg.cloneNode(true);
    clone.querySelectorAll('.mm-grid-bg, .mm-grid-bg2').forEach(el => el.remove()); // 网格仅作绘图参考，不导出
    clone.querySelectorAll('.mm-fold, .mm-wp, .mm-conn-hit, .mm-refline-hit, .mm-sel-ring').forEach(el => el.remove()); // 交互件（折叠钮/手柄/命中层/选中环）不进导出
    clone.querySelector('.mm-viewport').setAttribute('transform', 'translate(20,20) scale(1)');
    clone.setAttribute('width', L.width + 40);
    clone.setAttribute('height', L.height + 40);
    clone.setAttribute('xmlns', NS);
    const style = document.createElementNS(NS, 'style');
    style.textContent = `text{font-family:"PingFang SC","Microsoft YaHei",sans-serif}.mm-viewport rect{stroke:#d8d6cf}`;
    clone.insertBefore(style, clone.firstChild);
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    if (window.mazz?.isElectron) {
      const p = await window.mazz.invoke('dialog:saveFile', { defaultPath: (ctl.title || '思维导图') + '.svg', filters: [{ name: 'SVG 矢量图', extensions: ['svg'] }] });
      if (p) {
        await window.mazz.invoke('fs:writeFile', { path: p, content: xml });
        toast('已导出 SVG');
      }
    } else {
      const a = document.createElement('a');
      a.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      a.download = '思维导图.svg';
      a.click();
    }
  }

  /** 导出 PDF（PNG 整页装入 → 打印通道） */
  async function exportPDF() {
    const L = ctl.layoutInfo;
    if (!L) return;
    const dataUrl = await renderToDataUrl();
    const { buildPrintDocument } = await import('../../lib/print-preview.js');
    const { PAGE_SIZES } = await import('../markdown/paginate.js');
    const landscape = L.width > L.height;
    const html = buildPrintDocument({
      title: ctl.title || '思维导图',
      setup: { size: 'A4', orientation: landscape ? 'landscape' : 'portrait', margins: { top: 10, right: 10, bottom: 10, left: 10 } },
      pagesHtml: [`<img src="${dataUrl}" style="width:100%;display:block">`],
    });
    if (window.mazz?.isElectron) {
      const target = await window.mazz.invoke('dialog:saveFile', {
        defaultPath: (ctl.title || '思维导图') + '.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      }).catch(() => null);
      if (!target) return; // 用户取消
      const p = await window.mazz.invoke('print:html', { html, setup: { size: 'A4', orientation: landscape ? 'landscape' : 'portrait' }, toPdf: true, defaultPath: target }).catch((e) => { toast('PDF 导出失败：' + e.message); return null; });
      if (p) toast(`PDF 已导出：${p.split(/[\\/]/).pop()}`);
    } else {
      const w = window.open('', '_blank');
      if (!w) return toast('弹窗被拦截');
      w.document.write(html);
      w.document.close();
      setTimeout(() => { w.focus(); w.print(); }, 400);
    }
  }

  async function renderToDataUrl() {
    const L = ctl.layoutInfo;
    const clone = svg.cloneNode(true);
    clone.querySelectorAll('.mm-grid-bg, .mm-grid-bg2').forEach(el => el.remove()); // 网格仅作绘图参考，桥接不带出
    clone.querySelectorAll('.mm-fold, .mm-wp, .mm-conn-hit, .mm-refline-hit, .mm-sel-ring').forEach(el => el.remove()); // 折叠钮/拐点手柄/隐形命中层/选中环同样只是交互件，不进导出
    clone.querySelector('.mm-viewport').setAttribute('transform', 'translate(20,20) scale(1)');
    clone.setAttribute('width', L.width + 40);
    clone.setAttribute('height', L.height + 40);
    clone.setAttribute('xmlns', NS);
    const style = document.createElementNS(NS, 'style');
    style.textContent = `text{font-family:"PingFang SC","Microsoft YaHei",sans-serif}.mm-viewport rect{stroke:#d8d6cf}`;
    clone.insertBefore(style, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = (L.width + 40) * scale;
    canvas.height = (L.height + 40) * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  ctl.undo = undo;
  ctl.redo = redo;
  ctl.render = render; // 公开重渲染（模型直改后的官方刷新口；此前只有闭包内部能用）
  ctl.fitView = fitView;
  ctl.exportPNG = exportPNG;
  ctl.exportOutline = exportOutline;
  ctl.exportSVG = exportSVG;
  ctl.exportPDF = exportPDF;
  ctl.renderToDataUrl = renderToDataUrl; // 桥接（导图→文稿/演示）取数口
  ctl.addNoteAt = addNoteAt;
  ctl.startLinkMode = startLinkMode;
  ctl.startParentLinkMode = startParentLinkMode;
  ctl.beautify = beautify;
  ctl.addChildOf = () => ctl.selected && addChildOf(ctl.selected);
  ctl.deleteSelected = () => ctl.selected && deleteNode(ctl.selected);
  ctl.addRootAt = addRootAt;
  ctl.setMode = (m) => onStyleChange('__mode', m);
  ctl.setDoc = (doc) => {
    ctl.doc = doc?.roots ? { parentLinks: [], notes: [], refLines: [], ...doc } : { mode: 'lr', scheme: 0, roots: doc?.root ? [doc.root] : [createNode('中心主题')], notes: [], refLines: [], parentLinks: [] };
    ctl.selected = ctl.doc.roots[0]?.id || null;
    render();
    requestAnimationFrame(fitView);
  };

  // 初始化
  ctl.doc = JSON.parse(JSON.stringify(SAMPLE_DOC));
  ctl.selected = ctl.doc.roots[0].id;
  render();
  requestAnimationFrame(fitView);

  return ctl;
}

export default {
  displayName: '思维导图',
  icon: '🧠',
  _forTests: { instances },

  create(container) {
    const ctl = createMindmap(container);
    instances.set(container, ctl);
    return { container };
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    window.__activeMindmapCtl = ctl;
    if (!ctl._fmtIO) { ctl._fmtIO = true; import('./formats-io.js').then(m => m.attachFormatExports(ctl)); }
    contextKeys.set('module', MODULE);
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },
  getContent(state) {
    const ctl = instances.get(state.container);
    return ctl ? serializeDoc(ctl.doc) : '';
  },
  /** 按扩展名导出：.md/.txt → Markdown 大纲；其余回落 getContent（JSON） */
  async exportAs(ext, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return null;
    if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
      return { text: toOutline(ctl.doc.roots) };
    }
    return null;
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    ctl.setDoc(parseDoc(typeof data === 'string' ? data : ''));
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    ctl?.setDoc({ mode: 'lr', scheme: 0, roots: [createNode('中心主题')] });
  },
  getCharCount(state) {
    const ctl = instances.get(state.container);
    return ctl ? serializeDoc(ctl.doc).length : 0;
  },
  getCursorPos(state) { return '导图'; },

  toolbarHTML: `
    <div class="rb-group" data-label="节点">
      <button class="rb-btn" data-command="mindmap.addChild"><i class="ico">⤵</i><span>子节点</span></button>
      <button class="rb-btn" data-command="mindmap.addRoot"><i class="ico">＋</i><span>根节点</span></button>
      <button class="rb-btn" data-command="mindmap.delete"><i class="ico">✕</i><span>删除</span></button>
    </div>
    <div class="rb-group" data-label="布局">
      <button class="rb-btn" data-command="mindmap.modeLR"><i class="ico">⇢</i><span>左右</span></button>
      <button class="rb-btn" data-command="mindmap.modeTB"><i class="ico">⇣</i><span>上下</span></button>
      <button class="rb-btn" data-command="mindmap.modeRadial"><i class="ico">◎</i><span>环绕</span></button>
    </div>
    <div class="rb-group" data-label="历史">
      <button class="rb-btn" data-command="mindmap.undo"><i class="ico">↩</i><span>撤销</span></button>
      <button class="rb-btn" data-command="mindmap.redo"><i class="ico">↪</i><span>重做</span></button>
    </div>
    <div class="rb-group" data-label="便笺/引用">
      <button class="rb-btn" data-command="mindmap.addNote"><i class="ico">${iconHtml('🗒')}</i><span>便笺</span></button>
      <button class="rb-btn" data-command="mindmap.addRefLine"><i class="ico">${iconHtml('➰')}</i><span>引用线</span></button>
      <button class="rb-btn" data-command="mindmap.addParentLink"><i class="ico">${iconHtml('⤴')}</i><span>加连接</span></button>
      <button class="rb-btn" data-command="mindmap.beautify"><i class="ico">${iconHtml('✨')}</i><span>一键美化</span></button>
    </div>
    <div class="rb-group" data-label="导出/导入">
      <button class="rb-btn" data-command="mindmap.fit"><i class="ico">${iconHtml('⛶')}</i><span>适应视图</span></button>
      <button class="rb-btn" data-command="mindmap.exportMenu"><i class="ico">⇪</i><span>导出 ▾</span></button>
      <button class="rb-btn" data-command="mindmap.importFile"><i class="ico">⇩</i><span>导入</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
  },

  contributes: {
    commands: [
      { id: 'mindmap.addChild', title: '新建子节点', group: '导图', when: "module=='mindmap'",
        run: () => current?.addChildOf() },
      { id: 'mindmap.addRoot', title: '新建根节点', group: '导图', when: "module=='mindmap'",
        run: () => {
          const c = current;
          if (!c) return;
          const wrap = c.root.querySelector('.mm-canvas-wrap');
          const rect = wrap.getBoundingClientRect();
          c.addRootAt((rect.width / 2 - c.cam.x) / c.cam.k, (rect.height / 2 - c.cam.y) / c.cam.k);
        } },
      { id: 'mindmap.delete', title: '删除节点', group: '导图', when: "module=='mindmap'",
        run: () => current?.deleteSelected() },
      { id: 'mindmap.addNote', title: '新建便笺', group: '导图', when: "module=='mindmap'",
        run: () => {
          const c = current;
          if (!c) return;
          const wrap = c.root.querySelector('.mm-canvas-wrap');
          const rect = wrap.getBoundingClientRect();
          c.addNoteAt((rect.width / 2 - c.cam.x) / c.cam.k, (rect.height / 2 - c.cam.y) / c.cam.k);
        } },
      { id: 'mindmap.addRefLine', title: '绘制引用线（先选起点）', group: '导图', when: "module=='mindmap'",
        run: () => current?.startLinkMode() },
      { id: 'mindmap.addParentLink', title: '添加父级连接（多父级）', group: '导图', when: "module=='mindmap'",
        run: () => current?.startParentLinkMode() },
      { id: 'mindmap.beautify', title: '一键重排美化', group: '导图', when: "module=='mindmap'",
        run: () => current?.beautify() },
      { id: 'mindmap.exportSVG', title: '导出 SVG 矢量图', group: '导图', when: "module=='mindmap'",
        run: () => current?.exportSVG() },
      { id: 'mindmap.exportMenu', title: '导出（PNG/SVG/PDF/OPML/FreeMind/XMind/大纲）', group: '导图', when: "module=='mindmap'",
        run: async () => {
          const ctl = window.__activeMindmapCtl;
          if (!ctl) return;
          const { showDomMenu } = await import('../../lib/dom-menu.js');
          // 命令系统不带 DOM 事件：按命令 id 找回按钮定位
          const btn = document.querySelector('[data-command="mindmap.exportMenu"]');
          const r = btn?.getBoundingClientRect() || { left: innerWidth / 2, bottom: 120 };
          showDomMenu([
            { label: '导出 PNG 图片', fn: () => ctl.exportPNG() },
            { label: '导出 SVG 矢量图', fn: () => ctl.exportSVG() },
            { label: '导出 PDF 文档', fn: () => ctl.exportPDF() },
            '-',
            { label: '导出 OPML（通用大纲交换）', fn: () => ctl.exportOpmlFile() },
            { label: '导出 FreeMind .mm（Freeplane 兼容）', fn: () => ctl.exportFreemindFile() },
            { label: '导出 XMind .xmind', fn: () => ctl.exportXmindFile() },
            '-',
            { label: '转 Markdown 大纲（桥接到文稿）', fn: () => ctl.exportOutline() },
          ], r.left, r.bottom + 4);
        } },
      { id: 'mindmap.importFile', title: '导入导图文件（OPML/FreeMind/XMind）', group: '导图', when: "module=='mindmap'",
        run: async () => {
          const p = await window.mazz.invoke('dialog:openFile', {
            filters: [{ name: '导图文件', extensions: ['opml', 'mm', 'xmind'] }],
          }).catch(() => null);
          if (!p) return;
          const { importMindmapToCtl } = await import('./formats-io.js');
          await importMindmapToCtl(p);
        } },
      { id: 'mindmap.exportPDF', title: '导出 PDF', group: '导图', when: "module=='mindmap'",
        run: () => current?.exportPDF() },
      { id: 'mindmap.modeLR', title: '布局：自左向右', group: '导图', when: "module=='mindmap'",
        run: () => current?.setMode('lr') },
      { id: 'mindmap.modeTB', title: '布局：自上向下', group: '导图', when: "module=='mindmap'",
        run: () => current?.setMode('tb') },
      { id: 'mindmap.modeRadial', title: '布局：全向环绕', group: '导图', when: "module=='mindmap'",
        run: () => current?.setMode('radial') },
      { id: 'mindmap.undo', title: '撤销', group: '导图', when: "module=='mindmap'",
        run: () => current?.undo() },
      { id: 'mindmap.redo', title: '重做', group: '导图', when: "module=='mindmap'",
        run: () => current?.redo() },
      { id: 'mindmap.fit', title: '适应视图', group: '导图', when: "module=='mindmap'",
        run: () => current?.fitView() },
      { id: 'mindmap.exportPNG', title: '导出 PNG', group: '导图', when: "module=='mindmap'",
        run: () => current?.exportPNG() },
      { id: 'mindmap.exportOutline', title: '导出为 Markdown 大纲', group: '导图', when: "module=='mindmap'",
        run: () => current?.exportOutline() },
    ],
    keybindings: [
      { command: 'mindmap.undo', key: 'ctrl+z', when: "module=='mindmap'" },
      { command: 'mindmap.redo', key: 'ctrl+y', when: "module=='mindmap'" },
    ],
    menus: {},
    bridges: [],
    aiActions: [],
  },
};
