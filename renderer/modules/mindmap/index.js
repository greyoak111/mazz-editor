// renderer/modules/mindmap/index.js —— 思维导图 v2：多根森林 · 三布局（左右/上下/环绕）· 自由拖拽 · 节点样式与配色
import { contextKeys } from '../../core/contextkey-service.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { toast, inputModal } from '../../shell/shell.js';
import {
  createNode, createNote, createRefLine, createParentLink, findNode, findParent, removeNode, insertSibling, appendChild, moveNode,
  toOutline, layout, LEVEL_SCHEMES, levelColor, serializeDoc, parseDoc, measureNote, nodeTextLayout, wrapTextLines,
  wpFromPoint, wpToPoint, wpMigrate, // 拐点参数化（B2 根治）
} from './model.js';
// 模块注册骨架 + 功能 deals（kityminder 声明式同款：shapes 图形库 / swimlanes 泳道 / tplpack 模板包 / present 叙事模式）
import { mmBoot, mmTeardown, mmExec, mmModuleNames } from './mm-modules.js';
import { SHAPES, ARROW_HEADS, shapeEl, arrowHeadD, shapePad } from './mm-shapes.js';
import { renderSwimlanes, laneDragMove, laneDragEnd, laneOf } from './mm-swimlanes.js';
import { listPacks } from './mm-tplpack.js';
import { camTween, camOfFrame } from './mm-present.js'; // 演示叙事 deals 注册 + 镜头动画器（帧跳转预览消费）
import { createSlideDoc, createSlide as createV2Slide, createItem as createSlItem, addSlideToDoc, serializeDoc as serializeSlDoc } from '../slide/doc.js'; // W41 导图帧→演示本体（死转，不挂桥接引用）
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
      <button class="mm-source-hook" type="button" hidden title="回到提炼来源">
        <span class="mm-source-hook-icon">↩</span><span class="mm-source-hook-label"></span>
      </button>
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
  // 连线 canvas 层（性能碾压皇冠：虚拟化模式下连线三类全画 canvas，SVG 只管节点/手柄/选中——
  // 万级连线不吃 SVG 元素；小图（<200 节点）全走 SVG 现状零行为差）
  const linkCanvas = document.createElement('canvas');
  linkCanvas.className = 'mm-link-layer';
  linkCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';
  svg.style.position = 'relative';
  svg.style.zIndex = '1';
  wrap.insertBefore(linkCanvas, svg);
  const editor = root.querySelector('.mm-editor');
  const stylebar = root.querySelector('.mm-stylebar');
  const sourceHook = root.querySelector('.mm-source-hook');

  const ctl = {
    root, container, stylebar,
    doc: null,          // {mode, scheme, roots[], notes[], refLines[], linkStyle}
    selected: null,     // 节点 id
    selectedNote: null, // 便笺 id
    selectedLine: null, // 引用线 id 或 'conn:子节点id'
    cam: { x: 30, y: 30, k: 1 },
    toolMode: 'build', // 窗格操作模式（w34：build 新建 | pan 移动 | select 选框）
    multiSel: new Set(), // 选框模式批量选中集（节点 id）
    undoStack: [], redoStack: [],
    editing: null,      // {kind:'node'|'note', id} 或 null
    boxes: null,
    layoutInfo: null,
    linkMode: null,     // 引用线创建中：null | {from:{id,k}}
  };
  ctl.selectedNode = () => findNode(ctl.doc?.roots || [], ctl.selected); // deals 命令消费口

  function activeSourceRef() {
    return ctl.selectedNode()?.sourceRef || ctl.doc?.sourceRef || ctl.doc?.roots?.find(r => r.sourceRef)?.sourceRef || null;
  }

  async function openSourceRef() {
    const ref = activeSourceRef();
    if (!ref) return;
    const shell = window.MazzShell;
    const sourcePane = ref.tabId && shell?.paneTree?.paneOfTab?.(ref.tabId);
    const existing = sourcePane?.tabs?.get?.(ref.tabId) || (ref.tabId && shell?.tabs?.get?.(ref.tabId));
    if (existing) {
      if (sourcePane) shell.paneTree.setActive(sourcePane);
      (sourcePane?.tabs || shell.tabs).activate(ref.tabId);
    }
    else if (ref.filePath) await window.MazzCommands?.execute('file.openPath', { path: ref.filePath });
    else { toast('源文档标签已关闭，且尚未保存到磁盘'); return; }
    setTimeout(() => {
      const allTabs = shell?.paneTree?.leaves?.().flatMap(leaf => leaf.tabs.tabs) || shell?.tabs?.tabs || [];
      const tab = (ref.filePath && allTabs.find(t => t.filePath === ref.filePath)) || (ref.tabId && allTabs.find(t => t.id === ref.tabId));
      const registry = window.MazzModulesReal || window.MazzModules;
      const inst = tab && registry?.instances?.get(tab.id);
      if (inst && ref.selection) inst.def.applyProgress?.(ref.selection, inst.state);
    }, 80);
  }
  sourceHook.addEventListener('click', (event) => { event.stopPropagation(); openSourceRef(); });
  ctl.mutate = (fn) => mutate(fn); // deals 命令统一走撤销登记
  ctl.mmStatus = 'normal'; // 状态机单字段（mm-present：normal|present+rollback）
  ctl.setCam = () => { viewport.setAttribute('transform', `translate(${ctl.cam.x},${ctl.cam.y}) scale(${ctl.cam.k})`); drawLinkLayer(ctl._lastLinkStrokes || [], !!shVirtual); }; // 镜头动画统一口（canvas 层随帧）
  mmBoot(ctl); // 模块注册骨架：shapes/swimlanes/tplpack 声明式 deals 统一分派（kityminder 同款）
  ctl.mmExec = (name, ...args) => mmExec(ctl, name, ...args); // 实例命令口（E2E/deals 直调，绕过「页面裸 import 源码=新模块实例」陷阱）

  // 虚拟化共享态（render() 计算、renderNotes/renderParentLinks/renderRefLines 三个独立函数消费——
  // render() 局部变量它们够不着（ReferenceError 实锤），文件级共享是唯一活口）
  let shVirtual = false, shVr = null, shLinkStrokes = [];
  const shInView = (b) => !shVirtual || boxInView(shVr, b);
  const shInViewBranch = (br) => !shVirtual || branchInView(shVr, br);

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

  // ==================== 视口虚拟化（性能碾压：DOM 元素与总节点数解耦，万级节点硬指标） ====================
  const VIRTUAL_MIN = 200; // 节点总数阈值：以下全量渲染（小图零行为差）
  // —— canvas 连线层工具：贝塞尔采样 + path d 字符串 → 折线点列（三类连线 d 逻辑零重写，d→pts 统一） ——
  function bezSamples(p0, p1, p2, p3, n = 12) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * p3[1]]);
    }
    return out;
  }
  function quadSamples(p0, p1, p2, n = 12) {
    const out = [];
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); }
    return out;
  }
  function pathToPts(d) {
    const toks = String(d).match(/[MLCQZ]|-?\d+(?:\.\d+)?/gi) || [];
    const pts = []; let i = 0, cmd = null, cur = [0, 0];
    const num = () => parseFloat(toks[i++]);
    while (i < toks.length) {
      const tk = toks[i];
      if (/^[MLCQZ]$/i.test(tk)) { cmd = tk.toUpperCase(); i++; if (cmd === 'Z') break; continue; }
      if (cmd === 'M' || cmd === 'L') { cur = [num(), num()]; pts.push(cur); if (cmd === 'M') cmd = 'L'; }
      else if (cmd === 'C') { const p1 = [num(), num()], p2 = [num(), num()], p3 = [num(), num()]; pts.push(...bezSamples(cur, p1, p2, p3).slice(1)); cur = p3; }
      else if (cmd === 'Q') { const p1 = [num(), num()], p2 = [num(), num()]; pts.push(...quadSamples(cur, p1, p2).slice(1)); cur = p2; }
      else i++;
    }
    return pts;
  }
  // 点到折线距离（canvas 模式数学命中）
  function distToPts(x, y, pts) {
    let best = Infinity;
    for (let j = 0; j + 1 < pts.length; j++) {
      const [x1, y1] = pts[j], [x2, y2] = pts[j + 1];
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L2));
      best = Math.min(best, Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t)));
    }
    return best;
  }
  function viewRect() {
    const k = ctl.cam.k;
    const vw = (wrap.clientWidth || 800) / k, vh = (wrap.clientHeight || 600) / k;
    const vx = -ctl.cam.x / k, vy = -ctl.cam.y / k;
    return { x: vx - vw * 0.15, y: vy - vh * 0.15, w: vw * 1.3, h: vh * 1.3 }; // 世界矩形+缓冲带
  }
  const boxInView = (vr, b) => b.x + b.w >= vr.x && b.x <= vr.x + vr.w && b.y + b.h >= vr.y && b.y <= vr.y + vr.h;
  const branchInView = (vr, br) => br && boxInView(vr, br);
  function countAll(roots) { let n = 0; for (const r of (Array.isArray(roots) ? roots : [roots])) { (function w(x) { n++; for (const c of x.children) w(c); })(r); } return n; }

  function render() {
    const sourceRef = activeSourceRef();
    sourceHook.hidden = !sourceRef;
    sourceHook.querySelector('.mm-source-hook-label').textContent = sourceRef ? `来源：${sourceRef.title || '文档'}` : '';
    const L = layout(ctl.doc.roots, ctl.doc.mode);
    ctl.boxes = L.boxes;
    ctl.layoutInfo = { width: L.width, height: L.height };
    // 可见集（虚拟化；小图全量零行为差）
    const total = countAll(ctl.doc.roots);
    const virtual = total >= VIRTUAL_MIN;
    const vr = virtual ? viewRect() : null;
    const inView = (b) => !virtual || boxInView(vr, b);
    const inViewBranch = (br) => !virtual || branchInView(vr, br);
    let drawn = 0, linksDrawn = 0;
    const linkStrokes = []; // canvas 连线画列（虚拟化模式收集，render 尾统一绘制）
    shVirtual = virtual; shVr = vr; shLinkStrokes = linkStrokes; // 共享态同步（三渲染函数消费）
    // （废除 v33 平均位移平移补丁：两端位移不等时近似失真=诡异渲染概率复现真根——
    //  拐点已全面参数化 {t,k}（wpFromPoint/wpToPoint），重排后由端点实时重算，结构性不错位）
    viewport.innerHTML = '';
    viewport.setAttribute('transform', `translate(${ctl.cam.x},${ctl.cam.y}) scale(${ctl.cam.k})`);
    // 泳道背景层（节点/连线下层；deals=swimlanes）
    renderSwimlanes(svgEl, viewport, ctl);
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
      if (!inViewBranch(b.branch)) continue; // 虚拟化：整支不可见则跳（分支框判定）
      const p = L.boxes.get(b.parentId);
      if (!p) continue;
      linksDrawn++;
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
        // 懒迁移旧绝对拐点 + 参数化取屏（重排随端点实时重算——不再有位移平移补丁）
        node.linkWps = wpMigrate(node.linkWps, { cx: x1, cy: y1 }, { cx: x2, cy: y2 });
        d = 'M' + [[x1, y1], ...node.linkWps.map(w => { const q = wpToPoint({ cx: x1, cy: y1 }, { cx: x2, cy: y2 }, w); return [q.x, q.y]; }), [x2, y2]].map(q => q.join(',')).join(' L');
      } else if (straight) {
        d = connectorStraightD(a, c, b.parentId, node.id);
      } else {
        d = ctl.doc.mode === 'tb'
          ? `M${a.x + a.w / 2},${a.y + a.h} C${a.x + a.w / 2},${(a.y + a.h + c.y) / 2} ${c.x + c.w / 2},${(a.y + a.h + c.y) / 2} ${c.x + c.w / 2},${c.y}`
          : `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      }
      // canvas 模式（虚拟化）：d→pts 入 canvas 画列（选中高亮同入），SVG 不建连线但手柄照走
      if (virtual) {
        linkStrokes.push({ id: 'conn:' + node.id, pts: pathToPts(d), color: node.linkColor || ls.color || (isSel ? 'var(--acc, #4f46e5)' : (ctl.template.connColor || 'var(--bd, #d8d6cf)')), width: node.linkWidth || ls.width || (isSel ? 2.6 : 1.6), dash: false });
      } else {
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
          node.linkWps.push(wpFromPoint({ cx: x1, cy: y1 }, { cx: x2, cy: y2 }, { x: wx, y: wy })); // 参数化入库
          node.linkMode = 'straight';
        });
      });
      viewport.appendChild(connPath);
      }
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
          const qp = wpToPoint({ cx: x1, cy: y1 }, { cx: x2, cy: y2 }, wp); // 参数化取屏定位手柄
          const dot = svgEl('circle', { cx: qp.x, cy: qp.y, r: 5.5, fill: '#fff', stroke: node.linkColor || ls.color || 'var(--acc, #4f46e5)', 'stroke-width': 2, class: 'mm-wp', 'data-idx': i });
          dot.style.cursor = 'grab';
          dot.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            node.linkWps = wps.map(w => wpFromPoint({ cx: x1, cy: y1 }, { cx: x2, cy: y2 }, w)); // 固化即参数化
            drag = { type: 'connwp', node, idx: i, sx: e.clientX, sy: e.clientY, ox: qp.x, oy: qp.y };
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
      if (!inView(b)) continue; // 虚拟化：视口外节点不建 DOM
      drawn++;
      const pos = boxPos(b);
      const node = b.node;
      const g = svgEl('g', { class: 'mm-node', 'data-id': node.id, transform: `translate(${pos.x},${pos.y})` });
      const selected = ctl.selected === node.id;
      // 图形库 shape（流程图六符；rect 默认）——归属泳道时边框着泳道色（归属着色）
      const lane = laneOf(ctl.doc.swimlanes, pos.x + pos.w / 2, pos.y + pos.h / 2);
      const shapeAttrs = {
        rx: (node.shape || 'rect') === 'rect' ? (ctl.template.radius ?? 9) : undefined,
        fill: fillOf(node, b.depth, selected),
        stroke: lane ? lane.color : strokeOf(node, b.depth, selected),
        'stroke-width': lane ? 2.2 : (selected ? 2 : 1.2),
      };
      g.appendChild(shapeEl(svgEl, node.shape || 'rect', pos, shapeAttrs));
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
      // 钉坐标角标（混合画布：pinned 节点脱离布局流的标记）
      if (node.pinned) {
        const pin = svgEl('g', { class: 'mm-pin', transform: `translate(${pos.w - 14},${-6})` });
        pin.appendChild(svgEl('circle', { cx: 7, cy: 7, r: 7, fill: 'var(--acc, #4f46e5)' }));
        const pt = svgEl('text', { x: 7, y: 10, 'text-anchor': 'middle', 'font-size': 9, fill: '#fff' });
        pt.textContent = '📌';
        pin.appendChild(pt);
        g.appendChild(pin);
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
    renderMultiSel(); // 选框多选高亮（w34）
    // canvas 连线层绘制（虚拟化模式；SVG 之上交互由 SVG 节点/手柄承载，连线视觉全归 canvas）
    ctl._lastLinkStrokes = virtual ? linkStrokes : null; // 数学命中共用（canvas 模式）
    drawLinkLayer(linkStrokes, virtual);
    ctl._vstats = { total, drawn, linksDrawn, virtual, vr }; // 虚拟化统计（E2E/诊断——须在自增后赋值）
    renderStylebar();
  }

  // ==================== canvas 连线层 ====================
  function drawLinkLayer(strokes, on) {
    const cw = wrap.clientWidth || 0, ch = wrap.clientHeight || 0, dpr = window.devicePixelRatio || 1;
    if (linkCanvas.width !== cw * dpr || linkCanvas.height !== ch * dpr) { linkCanvas.width = cw * dpr; linkCanvas.height = ch * dpr; }
    let ctx;
    try { ctx = linkCanvas.getContext('2d'); } catch { return; } // jsdom 契约环境无 canvas 实现（E2E 真 Chromium 有）
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!on) return;
    const k = ctl.cam.k;
    const world = (p) => [p[0] * k + ctl.cam.x, p[1] * k + ctl.cam.y];
    const cssColor = (c) => c?.startsWith('var(') ? (getComputedStyle(root).getPropertyValue(c.match(/var\((--[a-z-]+)/)?.[1] || '--bd') || '#d8d6cf') : (c || '#d8d6cf');
    for (const s of strokes) {
      if (!s.pts?.length) continue;
      ctx.beginPath();
      const p0 = world(s.pts[0]);
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < s.pts.length; i++) { const p = world(s.pts[i]); ctx.lineTo(p[0], p[1]); }
      ctx.strokeStyle = cssColor(s.color);
      ctx.lineWidth = (s.width || 1.6) * k;
      ctx.setLineDash(s.dash ? [6 * k, 4 * k] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** canvas 模式数学命中：世界坐标点 → 最近连线（<8/k px 内） */
  function hitTestLinks(wx, wy) {
    const strokes = ctl._lastLinkStrokes || [];
    let best = null, bestD = 8 / ctl.cam.k + 4;
    for (const s of strokes) {
      const d = distToPts(wx, wy, s.pts);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
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
        const pa = { cx: x1, cy: y1 }, pc = { cx: x2, cy: y2 };
        const wps = Array.isArray(pl.waypoints) ? (pl.waypoints = wpMigrate(pl.waypoints, pa, pc)) : defaultTwoWaypoints({ cx: x1, cy: y1, w: 0, h: 0 }, { cx: x2, cy: y2, w: 0, h: 0 });
        const pts = [[x1, y1], ...wps.map(w => { const q = wpToPoint(pa, pc, w); return [q.x, q.y]; }), [x2, y2]];
        d = 'M' + pts.map(q => q.join(',')).join(' L');
        const prev = pts[pts.length - 2];
        arrowAng = Math.atan2(y2 - prev[1], x2 - prev[0]);
        // 直线模式拐点手柄（选中时）
        if (sel) {
          wps.forEach((wp, i) => {
            const qp = wpToPoint(pa, pc, wp);
            const dot = svgEl('circle', { cx: qp.x, cy: qp.y, r: 5.5, fill: '#fff', stroke: color, 'stroke-width': 2, class: 'mm-wp', 'data-idx': i });
            dot.style.cursor = 'grab';
            dot.addEventListener('pointerdown', (e) => {
              e.stopPropagation();
              pl.waypoints = wps.map(w => wpFromPoint(pa, pc, w)); // 固化即参数化
              drag = { type: 'wp', rl: pl, idx: i, sx: e.clientX, sy: e.clientY, ox: qp.x, oy: qp.y };
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
      // canvas 模式（虚拟化）：入 canvas 画列（直线拐点折线/贝塞尔统一 d→pts），SVG 不建连线
      if (shVirtual) {
        shLinkStrokes.push({ id: pl.id, pts: pathToPts(d), color, width, dash: false });
        continue;
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
          pl.waypoints.push(wpFromPoint({ cx: x1, cy: y1 }, { cx: x2, cy: y2 }, { x: wx, y: wy })); // 参数化入库
          pl.mode = 'straight';
        });
      });
      viewport.appendChild(path);
      // 箭头（多形态同色）
      const ah = 8;
      const plHeadKind = pl.arrow || ctl.doc.linkStyle?.arrow || ctl.mmOpts?.arrow || 'arrow';
      if (plHeadKind === 'circle') {
        viewport.appendChild(svgEl('circle', { cx: endPt.x, cy: endPt.y, r: 4.5, fill: '#fff', stroke: color, 'stroke-width': 2 }));
      } else if (plHeadKind !== 'none') {
        viewport.appendChild(svgEl('path', {
          d: arrowHeadD(plHeadKind, endPt.x, endPt.y, arrowAng, ah),
          fill: plHeadKind === 'open' ? 'none' : color, stroke: plHeadKind === 'open' ? color : 'none', 'stroke-width': plHeadKind === 'open' ? 1.8 : 0,
        }));
      }
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
      if (!shInView({ x: n.x, y: n.y, w: n.w, h: n.w })) continue; // 虚拟化（共享态）
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
      if (n.image) {
        // 图片便笺（混合画布：图片对象自由共存——粘贴/拖入即图，文本压底）
        g.appendChild(svgEl('image', { href: n.image, x: 6, y: 6, width: n.w - 12, height: n.w - 12, preserveAspectRatio: 'xMidYMid meet' }));
      } else {
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
      }
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
    const wps = rl.waypoints?.length ? (rl.waypoints = wpMigrate(rl.waypoints, aInfo, cInfo)) : [];
    if (!wps.length) {
      // 无拐点：直来直去一条直线
      const d = { x: cInfo.cx - aInfo.cx, y: cInfo.cy - aInfo.cy };
      const p1 = edgePoint({ x: aInfo.cx, y: aInfo.cy }, { x: aInfo.cx + d.x, y: aInfo.cy + d.y }, aInfo.w, aInfo.h);
      const p2 = edgePoint({ x: cInfo.cx, y: cInfo.cy }, { x: cInfo.cx - d.x, y: cInfo.cy - d.y }, cInfo.w, cInfo.h);
      return [[p1.x, p1.y], [p2.x, p2.y]];
    }
    // 首末点按邻接段方向自适应接边；拐点一律参数化取屏（随端点重算）
    const first = wpToPoint(aInfo, cInfo, wps[0]), last = wpToPoint(aInfo, cInfo, wps[wps.length - 1]);
    const start = edgePoint({ x: aInfo.cx, y: aInfo.cy }, first, aInfo.w, aInfo.h);
    const end = edgePoint({ x: cInfo.cx, y: cInfo.cy }, last, cInfo.w, cInfo.h);
    return [[start.x, start.y], ...wps.map(p => { const q = wpToPoint(aInfo, cInfo, p); return [q.x, q.y]; }), [end.x, end.y]];
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
      rl.waypoints = wpMigrate(rl.waypoints, a, c); // 懒迁移统一收口（曲线/直线/手柄全链同走）
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
        const ctrl = rl.waypoints?.length ? wpToPoint(a, c, rl.waypoints[0]) : { x: mx + bend, y: my - 30 }; // 参数化取屏
        d = `M${ax},${ay} Q${ctrl.x},${ctrl.y} ${cx},${cy}`;
        arrowAng = Math.atan2(cy - ctrl.y, cx - ctrl.x);
        rl._ctrl = ctrl; // 渲染期暂存，供手柄定位
      }
      // canvas 模式（虚拟化）：入 canvas 画列（虚线样式随 width 档），SVG 不建连线但手柄照走
      if (shVirtual) {
        shLinkStrokes.push({ id: rl.id, pts: pathToPts(d), color, width, dash: width <= 2.5 });
      } else {
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
          rl.waypoints.push(wpFromPoint(a, c, { x: wx, y: wy })); // 参数化入库（重排随端点重算）
        });
      });
      viewport.appendChild(rlHit);
      viewport.appendChild(path);
      // 箭头（多形态：arrow/open/diamond/circle/none——线级覆盖 > 全局 linkStyle.arrow）
      const ah = 8;
      const headKind = rl.arrow || ctl.doc.linkStyle?.arrow || ctl.mmOpts?.arrow || 'arrow';
      if (headKind === 'circle') {
        viewport.appendChild(svgEl('circle', { cx, cy, r: 4.5, fill: '#fff', stroke: color, 'stroke-width': 2 }));
      } else if (headKind !== 'none') {
        const headD = arrowHeadD(headKind, cx, cy, arrowAng, ah);
        viewport.appendChild(svgEl('path', {
          d: headD, fill: headKind === 'open' ? 'none' : color, stroke: headKind === 'open' ? color : 'none', 'stroke-width': headKind === 'open' ? 1.8 : 0,
        }));
      }
      }
      // 拐点手柄（选中时显示；拖拽移动 / 右键删除）
      if (sel) {
        const wps = rl.mode === 'straight' ? (rl.waypoints || []) : (rl.waypoints?.length ? rl.waypoints : [rl._ctrl]);
        wps.forEach((wp, i) => {
          const qp = wpToPoint(a, c, wp); // 参数化取屏定位手柄
          const dot = svgEl('circle', { cx: qp.x, cy: qp.y, r: 5.5, fill: '#fff', stroke: color, 'stroke-width': 2, class: 'mm-wp', 'data-idx': i });
          dot.style.cursor = 'grab';
          dot.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            drag = { type: 'wp', rl, idx: i, sx: e.clientX, sy: e.clientY, ox: qp.x, oy: qp.y };
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
    if (ctl.mmStatus === 'present') return; // 放映态编辑禁用
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
    // 快捷键对调（用户拍板不反直觉）：Enter=确认提交；Alt+Enter=内容换行；Ctrl+Enter 确认兼容手势；Esc 取消
    if (e.key === 'Enter' && e.altKey) {
      // Alt+Enter 换行必须手插（textarea 默认只认裸 Enter 换行，Alt+Enter 浏览器无默认插入实锤）
      e.preventDefault();
      const el = e.target;
      const s = el.selectionStart ?? el.value.length, t = el.selectionEnd ?? s;
      el.value = el.value.slice(0, s) + '\n' + el.value.slice(t);
      el.selectionStart = el.selectionEnd = s + 1;
    }
    else if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); commitEdit(); }
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
    if (ctl.mmStatus === 'present') return; // 放映态菜单禁用（状态机闸）
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
      ...SHAPES.map(s => ({
        label: `${(box.node.shape || 'rect') === s.id ? '✓ ' : ''}形状：${s.name}`,
        fn: () => mmExec(ctl, 'setNodeShape', s.id),
      })),
      '-',
      { label: `${box.node.pinned ? '✓ ' : ''}钉住位置（脱离布局）`, fn: () => mutate(() => {
        const n = box.node;
        if (n.pinned) { n.pinned = false; delete n.fx; delete n.fy; }
        else { n.pinned = true; if (n.fx == null) { const b = ctl.boxes.get(n.id); n.fx = b?.x ?? 80; n.fy = b?.y ?? 80; } }
      }) },
      '-',
      { label: '删除节点', fn: () => deleteNode(id) },
    ], x, y);
  }

  /** 空白右键：新建/视图 */
  function showBlankMenu(x, y) {
    if (ctl.mmStatus === 'present') return; // 放映态菜单禁用（状态机闸）
    const rect = wrap.getBoundingClientRect();
    const wx = (x - rect.left - ctl.cam.x) / ctl.cam.k;
    const wy = (y - rect.top - ctl.cam.y) / ctl.cam.k;
    const items = [];
    if (ctl.multiSel.size) items.push({ label: `删除所选 ${ctl.multiSel.size} 个节点`, fn: () => deleteMultiSel() }, '-'); // 选框批量删除（右键选单同款）
    if (ctl.multiSel.size >= 3) items.push(
      { label: `水平等距分布（${ctl.multiSel.size} 个）`, fn: () => distributeSel('x') },
      { label: `垂直等距分布（${ctl.multiSel.size} 个）`, fn: () => distributeSel('y') },
      '-',
    ); // 混合画布：等距分布（首尾不动中间均分）
    items.push(
      { label: '新建根节点', fn: () => addRootAt(wx, wy) },
      { label: '新建便笺', fn: () => addNoteAt(wx, wy) },
      { label: '新建泳道', fn: () => mmExec(ctl, 'addSwimlane', { x: wx - 180, y: wy - 120 }) },
      '-',
      { label: '适应视图', fn: () => fitView() },
      { label: '一键美化重排', fn: () => beautify() },
    );
    mmMenu(items, x, y);
  }

  /** 线右键：直曲切换/加拐点/删除（连接线=清除自定义样式） */
  function showLineMenu(x, y) {
    if (ctl.mmStatus === 'present') return; // 放映态菜单禁用（状态机闸）
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
              rl.waypoints.push(wpFromPoint(a, c, { x: (a.cx + c.cx) / 2, y: (a.cy + c.cy) / 2 - 20 })); // 参数化入库
            }),
          },
        );
        // 箭头形态子项（线级覆盖；isConn 树连线也吃全局 linkStyle.arrow）
        items.push('-');
        for (const ah of ARROW_HEADS) {
          items.push({
            label: `${((rl.arrow || ctl.doc.linkStyle?.arrow || 'arrow') === ah.id ? '✓ ' : '')}箭头：${ah.name}`,
            fn: () => mutate(() => { rl.arrow = ah.id === 'arrow' ? undefined : ah.id; }),
          });
        }
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
    if (ctl.mmStatus === 'present') return; // 放映态编辑禁用（状态机闸）
    if (ctl.toolMode === 'pan') { // 移动模式：节点上也平移画布（不选中不拖节点）
      ctl.selected = null; // 移动模式清选中（不产生新选中，旧选中也不留）
      drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...ctl.cam } };
      return;
    }
    if (ctl.toolMode === 'select') { // 选框模式：节点上也起选框（不拖节点）
      drag = { type: 'selrect', sel: selectRectStart(e) };
      return;
    }
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
      // canvas 模式连线数学命中（<8/k px 最近线优先于平移）
      if (ctl._lastLinkStrokes && e.button === 0) {
        const rect0 = wrap.getBoundingClientRect();
        const wx0 = (e.clientX - rect0.left - ctl.cam.x) / ctl.cam.k, wy0 = (e.clientY - rect0.top - ctl.cam.y) / ctl.cam.k;
        const hit = hitTestLinks(wx0, wy0);
        if (hit) {
          ctl.selectedLine = hit.id;
          ctl.selected = null; ctl.selectedNote = null;
          render(); // 选中高亮（canvas 重画选中色）
          renderStylebar();
          return;
        }
      }
      if (ctl.mmStatus === 'present') return; // 放映态镜头由帧驱动，禁手拖
      if (ctl.toolMode === 'select') { // 选框模式：空白起选框（不 pan）
        drag = { type: 'selrect', sel: selectRectStart(e) };
        return;
      }
      drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...ctl.cam } };
      ctl.selected = null;
      render();
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (current !== ctl) return;
    // 泳道拖拽（标题条移位/右下调尺寸；deals=swimlanes）
    if (ctl._laneDrag) { if (laneDragMove(ctl, e)) { render(); } return; }
    if (!drag) return;
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
      // 拐点拖拽（曲线=调弯曲，直线=调拐点位）——落点参数化入库（重排随端点重算）
      const dx = (e.clientX - drag.sx) / ctl.cam.k, dy = (e.clientY - drag.sy) / ctl.cam.k;
      const rl = drag.rl;
      const a = entityCenter(rl.from.id, rl.from.k), c = entityCenter(rl.to.id, rl.to.k);
      rl.waypoints = rl.waypoints?.length ? rl.waypoints : [];
      rl.waypoints[drag.idx] = wpFromPoint(a, c, { x: drag.ox + dx, y: drag.oy + dy });
      if (rl.mode !== 'straight') {
        rl.bend = wpToPoint(a, c, rl.waypoints[drag.idx]).x - ((a?.cx + c?.cx) / 2 || 0); // bend 语义保留（无 waypoints 时的默认）
      }
      // 实时重绘路径（轻量：只更新 path d 和手柄位）
      const pathEl = viewport.querySelector(`.mm-refline[data-id="${rl.id}"]`);
      if (pathEl) {
        if (rl.mode === 'straight') {
          const pts = refLinePoints(rl, a, c);
          pathEl.setAttribute('d', 'M' + pts.map(p => p.join(',')).join(' L'));
        } else {
          const ctrl = wpToPoint(a, c, rl.waypoints[drag.idx]);
          pathEl.setAttribute('d', `M${a.x},${a.y} Q${ctrl.x},${ctrl.y} ${c.x},${c.y}`);
        }
      }
      const dot = viewport.querySelectorAll('.mm-wp')[drag.idx];
      if (dot) { const q = wpToPoint(a, c, rl.waypoints[drag.idx]); dot.setAttribute('cx', q.x); dot.setAttribute('cy', q.y); }
    } else if (drag.type === 'selrect') {
      // 选框拖动：实时画虚线框（世界坐标 rect）
      drag.sel.cur = { x: (e.clientX - wrap.getBoundingClientRect().left - ctl.cam.x) / ctl.cam.k, y: (e.clientY - wrap.getBoundingClientRect().top - ctl.cam.y) / ctl.cam.k };
      const r = selectRectCalc(drag.sel);
      let box = viewport.querySelector('.mm-selrect');
      if (!box) { box = svgEl('rect', { class: 'mm-selrect', fill: 'rgba(79,70,229,.08)', stroke: 'var(--acc, #4f46e5)', 'stroke-width': 1.2, 'stroke-dasharray': '5 3' }); viewport.appendChild(box); }
      box.setAttribute('x', r.x); box.setAttribute('y', r.y);
      box.setAttribute('width', Math.max(0, r.w)); box.setAttribute('height', Math.max(0, r.h));
    } else if (drag.type === 'connwp') {
      // 连接线拐点拖拽（直线模式）——落点参数化入库
      const dx = (e.clientX - drag.sx) / ctl.cam.k, dy = (e.clientY - drag.sy) / ctl.cam.k;
      const node = drag.node;
      const pb = ctl.boxes.get(findParent(ctl.doc.roots, node.id)?.id), cb = ctl.boxes.get(node.id);
      if (pb && cb) {
        const pa = { cx: pb.x + pb.w, cy: pb.y + pb.h / 2 }, pc = { cx: cb.x, cy: cb.y + cb.h / 2 };
        node.linkWps[drag.idx] = wpFromPoint(pa, pc, { x: drag.ox + dx, y: drag.oy + dy });
      } else {
        node.linkWps[drag.idx] = { x: drag.ox + dx, y: drag.oy + dy };
      }
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
        // 磁吸对齐线（混合画布：x/y 边缘与中线吸附 8/k px，excalidraw 式虚线参考线）
        const snap = snapNode(node);
        if (snap.dx || snap.dy) {
          if (RADIAL()) { node.fx += snap.dx; node.fy += snap.dy; }
          else { node.offX += snap.dx; node.offY += snap.dy; }
        }
        renderSnapLines(snap);
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

  // ==================== 磁吸对齐线（混合画布：拖动吸附 + 虚线参考线） ====================
  /** 拖动节点对齐吸附：x/y 左中右/上中下边缘，阈值 8/k px，返回修正与参考线 */
  function snapNode(node) {
    const selfBox = (() => { const b = ctl.boxes.get(node.id); const p = boxPos(b); return { x: p.x, y: p.y, w: b.w, h: b.h }; })();
    const TH = 8 / ctl.cam.k;
    const xs = [], ys = [];
    for (const [, b] of ctl.boxes) {
      if (b.node.id === node.id) continue;
      const p = boxPos(b);
      xs.push(p.x, p.x + b.w / 2, p.x + b.w);
      ys.push(p.y, p.y + b.h / 2, p.y + b.h);
    }
    const snap1 = (val, cands) => {
      let best = null, bd = TH;
      for (const c of cands) { const d = Math.abs(val - c); if (d < bd) { bd = d; best = c; } }
      return best;
    };
    const cx = [selfBox.x, selfBox.x + selfBox.w / 2, selfBox.x + selfBox.w];
    const cy = [selfBox.y, selfBox.y + selfBox.h / 2, selfBox.y + selfBox.h];
    let dx = 0, dy = 0, lineX = null, lineY = null;
    for (let i = 0; i < 3; i++) {
      const sx = snap1(cx[i] + dx, xs);
      if (sx != null && lineX == null) { lineX = sx; dx = sx - cx[i]; }
      const sy = snap1(cy[i] + dy, ys);
      if (sy != null && lineY == null) { lineY = sy; dy = sy - cy[i]; }
    }
    return { dx, dy, lineX, lineY, box: selfBox };
  }
  /** 对齐参考线渲染（拖动中两条虚线；松手清） */
  function renderSnapLines(snap) {
    viewport.querySelectorAll('.mm-snapline').forEach(el => el.remove());
    if (!snap.lineX && !snap.lineY) return;
    if (snap.lineX != null) {
      viewport.appendChild(svgEl('line', { x1: snap.lineX, y1: snap.box.y - 4000, x2: snap.lineX, y2: snap.box.y + snap.box.h + 4000, class: 'mm-snapline', stroke: 'var(--acc, #4f46e5)', 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0.7 }));
    }
    if (snap.lineY != null) {
      viewport.appendChild(svgEl('line', { x1: snap.box.x - 4000, y1: snap.lineY, x2: snap.box.x + snap.box.w + 4000, y2: snap.lineY, class: 'mm-snapline', stroke: 'var(--acc, #4f46e5)', 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0.7 }));
    }
  }
  window.addEventListener('pointerup', (e) => {
    if (current !== ctl) return;
    if (ctl._laneDrag) { laneDragEnd(ctl); mutate(() => {}); return; } // 泳道落位入栈
    if (!drag) return;
    if (drag.type === 'pan' && ctl._vstats?.virtual) { render(); } // 虚拟化：平移结束重算可见集（transform-only 平移期保流畅）
    if (drag.type === 'selrect') { // 选框落：批量选中（相交集）+虚线框清除+多选高亮
      viewport.querySelector('.mm-selrect')?.remove();
      const n = applySelectRect(drag.sel);
      drag = null;
      render();
      if (n) toast(`已选中 ${n} 个节点（Delete 或右键删除）`);
      return;
    }
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
      viewport.querySelectorAll('.mm-snapline').forEach(el => el.remove()); // 对齐参考线松手清（混合画布）
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
    if (ctl.mmStatus === 'present') { e.preventDefault(); return; } // 放映态禁缩放
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const k2 = Math.min(Math.max(ctl.cam.k * f, 0.25), 3);
    ctl.cam.x = mx - (mx - ctl.cam.x) * (k2 / ctl.cam.k);
    ctl.cam.y = my - (my - ctl.cam.y) * (k2 / ctl.cam.k);
    ctl.cam.k = k2;
    viewport.setAttribute('transform', `translate(${ctl.cam.x},${ctl.cam.y}) scale(${ctl.cam.k})`);
    // 虚拟化重渲染防抖：缩放改可见集（transform-only 保流畅，140ms 后重算）
    clearTimeout(ctl._virtT);
    ctl._virtT = setTimeout(() => { if (ctl._vstats?.virtual) render(); }, 140);
  }, { passive: false });
  wrap.addEventListener('contextmenu', (e) => {
    if (e.target === svg || e.target === viewport) {
      e.preventDefault();
      // canvas 模式：命中连线 → 线菜单（否则空白菜单）
      if (ctl._lastLinkStrokes) {
        const rect = wrap.getBoundingClientRect();
        const wx = (e.clientX - rect.left - ctl.cam.x) / ctl.cam.k, wy = (e.clientY - rect.top - ctl.cam.y) / ctl.cam.k;
        const hit = hitTestLinks(wx, wy);
        if (hit) {
          ctl.selectedLine = hit.id;
          ctl.selected = null; ctl.selectedNote = null;
          render();
          showLineMenu(e.clientX, e.clientY);
          return;
        }
      }
      showBlankMenu(e.clientX, e.clientY);
    }
  });
  wrap.addEventListener('dblclick', (e) => {
    if (e.target === svg || e.target === viewport) {
      const rect = wrap.getBoundingClientRect();
      const x = (e.clientX - rect.left - ctl.cam.x) / ctl.cam.k;
      const y = (e.clientY - rect.top - ctl.cam.y) / ctl.cam.k;
      // canvas 模式：命中连线 → 双击加拐点（直线直角拐/曲线弯曲，按 id 前缀分派参数化入库）
      if (ctl._lastLinkStrokes && !e.shiftKey) {
        const hit = hitTestLinks(x, y);
        if (hit) {
          mutate(() => {
            if (hit.id.startsWith('conn:')) {
              const node = findNode(ctl.doc.roots, hit.id.slice(5));
              const pb = ctl.boxes.get(findParent(ctl.doc.roots, node.id)?.id), cb = ctl.boxes.get(node.id);
              if (node && pb && cb) {
                node.linkWps = node.linkWps || [];
                node.linkWps.push(wpFromPoint({ cx: pb.x + pb.w, cy: pb.y + pb.h / 2 }, { cx: cb.x, cy: cb.y + cb.h / 2 }, { x, y }));
                node.linkMode = 'straight';
              }
            } else {
              const rl = ctl.doc.refLines.find(l => l.id === hit.id) || (ctl.doc.parentLinks || []).find(l => l.id === hit.id);
              if (rl) {
                const a = entityCenter(rl.from.id ?? rl.from, rl.from.k ?? 'node'), c = entityCenter(rl.to.id ?? rl.to, rl.to.k ?? 'node');
                rl.waypoints = rl.waypoints || [];
                rl.waypoints.push(wpFromPoint(a, c, { x, y }));
                if (rl.mode !== 'curve') rl.mode = 'straight';
              }
            }
          });
          return;
        }
      }
      // Shift+双击空白 → 新增便笺；普通双击 → 新增根节点
      if (e.shiftKey) addNoteAt(x, y);
      else addRootAt(x, y);
    }
  });

  // 图片便笺入口（混合画布：粘贴/拖入图片即成图片对象）
  wrap.addEventListener('paste', (e) => {
    if (ctl.mmStatus === 'present') return;
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find(it => it.type?.startsWith('image/'));
    if (!img) return;
    e.preventDefault();
    const file = img.getAsFile();
    const fr = new FileReader();
    fr.onload = () => {
      const rect = wrap.getBoundingClientRect();
      const n = createNote('', (-ctl.cam.x / ctl.cam.k) + 80, (-ctl.cam.y / ctl.cam.k) + 80);
      n.image = fr.result; n.w = 220;
      mutate(() => { ctl.doc.notes.push(n); });
      toast('已粘贴为图片便笺');
    };
    fr.readAsDataURL(file);
  });
  wrap.addEventListener('drop', (e) => {
    if (ctl.mmStatus === 'present') return;
    const f = e.dataTransfer?.files?.[0];
    if (!f || !f.type?.startsWith('image/')) return;
    e.preventDefault();
    const fr = new FileReader();
    fr.onload = () => {
      const rect = wrap.getBoundingClientRect();
      const n = createNote('', (e.clientX - rect.left - ctl.cam.x) / ctl.cam.k, (e.clientY - rect.top - ctl.cam.y) / ctl.cam.k);
      n.image = fr.result; n.w = 220;
      mutate(() => { ctl.doc.notes.push(n); });
      toast('已拖入为图片便笺');
    };
    fr.readAsDataURL(f);
  });
  wrap.addEventListener('dragover', (e) => { if (e.dataTransfer?.files?.[0]?.type?.startsWith('image/')) e.preventDefault(); });

  // 键盘路由
  document.addEventListener('keydown', (e) => {
    if (current !== ctl || ctl.editing) return;
    // 状态机闸：present 态全部键路由走放映专属（编辑键全禁，kityminder status 自判同款）
    if (ctl.mmStatus === 'present') {
      e.preventDefault(); e.stopPropagation(); // 真实键盘事件就地消掉（编辑键全禁，载荷走 detail 专递）
      document.dispatchEvent(new CustomEvent('mm:present-key', { detail: { key: e.key } }));
      return;
    }
    // F5 启动放映（叙事模式）
    if (e.key === 'F5') { e.preventDefault(); mmExec(ctl, 'startPresent', 0); return; }
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
      if (ctl.multiSel.size) deleteMultiSel(); // 选框批量删除优先（w34）
      else if (ctl.selectedLine) deleteSelectedLine();
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
  // B12b：样式条 select 批量子窗格化——innerHTML 重写前旧代理收尸（menus 贡献/MutationObserver 不泄漏）
  const proxyStylebarSelects = () => import('../../lib/select-menu.js').then(({ selectProxy }) => {
    stylebar._selProxies = [...stylebar.querySelectorAll('select.mm-sb')].map(s => selectProxy(s, { btnClass: 'mm-sb selmenu-btn' }));
  });
  function renderStylebar() {
    if (stylebar._selProxies) { for (const p of stylebar._selProxies) p?.destroy?.(); stylebar._selProxies = null; }
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
      proxyStylebarSelects();
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
      proxyStylebarSelects();
      return;
    }
    const node = ctl.selected && findNode(ctl.doc.roots, ctl.selected);
    if (!node) {
      // 无线选中：显示全局操作（模板/布局/配色），模板不再非得选中节点（v33 反馈）
      stylebar.style.display = 'flex';
      stylebar.innerHTML = `
        <span class="mm-tools" style="display:inline-flex;gap:2px">
          <button class="mm-sb-btn ${ctl.toolMode === 'build' ? 'on' : ''}" data-t="build" title="新建模式：双击空白新增节点（现状）">${iconHtml('＋')}</button>
          <button class="mm-sb-btn ${ctl.toolMode === 'pan' ? 'on' : ''}" data-t="pan" title="移动模式：左键任意拖动=平移画布（十字箭头）">${iconHtml('✥')}</button>
          <button class="mm-sb-btn ${ctl.toolMode === 'select' ? 'on' : ''}" data-t="select" title="选框模式：左键拖框批量选中，Delete/右键删除（虚线框）">${iconHtml('⬚')}</button>
        </span>
        <button class="mm-sb-btn" data-k="__merge" title="导图间桥接：把另一张导图合并进来（自选落点，避让防冲突）">${iconHtml('⇆')} 合并</button>
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
        <button class="mm-sb-btn" data-k="__lane" title="新建泳道（标题条拖动移位，右下手柄调尺寸）">＋泳道</button>
        <button class="mm-sb-btn ${ctl.doc.showGrid ? 'on' : ''}" data-k="__grid" title="网格坐标线（手动定位辅助）">网格</button>
        <span style="width:1px;height:18px;background:var(--bd,#e0ded8)"></span>
        <select class="mm-sb" data-k="__arrow" title="箭头形态（全局）">
          ${ARROW_HEADS.map(a => `<option value="${a.id}" ${(ctl.doc.linkStyle?.arrow || 'arrow') === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}
        </select>
        <select class="mm-sb" data-k="__pack" title="模板包（mmtpl-packs/ 库）"><option value="">模板包…</option></select>
        <button class="mm-sb-btn" data-k="__pack-export" title="当前文档+样式打包为 .mmtpl 入库">打包</button>
        <span style="width:1px;height:18px;background:var(--bd,#e0ded8)"></span>
        <button class="mm-sb-btn" data-k="__frame-add" title="当前视口圈为一帧（Prezi 式叙事）">＋帧</button>
        <button class="mm-sb-btn ${ctl.mmStatus === 'present' ? 'on' : ''}" data-k="__present" title="F5 放映（→/空格 下一帧 · ← 上一帧 · Esc 退出）">▶ 放映</button>
        <span class="mm-frames" style="display:inline-flex;gap:4px;align-items:center"></span>`;
      stylebar.querySelector('[data-k="__mode"]').addEventListener('change', (e) => mutate(() => { ctl.doc.mode = e.target.value; }));
      stylebar.querySelector('[data-k="__scheme"]').addEventListener('change', (e) => mutate(() => { ctl.doc.scheme = +e.target.value; }));
      stylebar.querySelector('[data-k="__lane"]').addEventListener('click', () => mmExec(ctl, 'addSwimlane', {}));
      stylebar.querySelector('[data-k="__arrow"]').addEventListener('change', (e) => mmExec(ctl, 'setArrowHead', e.target.value));
      stylebar.querySelector('[data-k="__pack"]').addEventListener('change', (e) => { if (e.target.value) mmExec(ctl, 'importTplPack', e.target.value); e.target.value = ''; });
      stylebar.querySelector('[data-k="__pack-export"]').addEventListener('click', () => mmExec(ctl, 'exportTplPack'));
      stylebar.querySelector('[data-k="__frame-add"]').addEventListener('click', () => mmExec(ctl, 'addFrame', {}));
      stylebar.querySelector('[data-k="__present"]').addEventListener('click', () => mmExec(ctl, ctl.mmStatus === 'present' ? 'exitPresent' : 'startPresent', 0));
      stylebar.querySelectorAll('[data-t]').forEach(btn => btn.addEventListener('click', () => setToolMode(btn.dataset.t)));
      stylebar.querySelector('[data-k="__merge"]').addEventListener('click', () => mergeFromFile());
      renderPackSelect();
      renderFramesBar();
      stylebar.querySelector('[data-k="__beautify"]').addEventListener('click', () => beautify());
      stylebar.querySelector('[data-k="__grid"]').addEventListener('click', (e) => {
        mutate(() => { ctl.doc.showGrid = !ctl.doc.showGrid; });
        e.currentTarget.classList.toggle('on', !!ctl.doc.showGrid);
      });
      renderTemplateSelect();
      proxyStylebarSelects();
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
    proxyStylebarSelects();
  }

  // ==================== 导图间桥接（w34：把另一张导图合并进来，自选落点不与原有内容冲突） ====================
  /** 全树克隆：id 全量重生成（防 id 冲突），内容/样式/折叠/形状/连线参数全保 */
  function cloneTreeWithNewIds(n, idMap) {
    const c = createNode(n.text || '');
    if (n.style) c.style = JSON.parse(JSON.stringify(n.style));
    if (n.color) c.color = n.color;
    if (n.collapsed) c.collapsed = true;
    if (n.shape) c.shape = n.shape;
    if (n.linkWps) c.linkWps = JSON.parse(JSON.stringify(n.linkWps));
    if (n.linkMode) c.linkMode = n.linkMode;
    if (n.linkNote) c.linkNote = JSON.parse(JSON.stringify(n.linkNote));
    if (n.linkColor) c.linkColor = n.linkColor;
    if (n.linkWidth) c.linkWidth = n.linkWidth;
    if (n.offX != null) { c.offX = n.offX; c.offY = n.offY; }
    if (n.fx != null) { c.fx = n.fx; c.fy = n.fy; }
    if (n.minW) c.minW = n.minW; if (n.minH) c.minH = n.minH; if (n.w) c.w = n.w; if (n.h) c.h = n.h;
    idMap.set(n.id, c.id);
    c.children = (n.children || []).map(k => cloneTreeWithNewIds(k, idMap));
    return c;
  }

  /** 合并来源文档进当前：targetId 有值=挂为该节点子树（结构内不冲突），否则自动落点（现有内容右侧空白+纵向错位） */
  function mergeDocsInto(src, { targetId = null } = {}) {
    const idMap = new Map();
    const newRoots = (Array.isArray(src.roots) ? src.roots : [src.roots]).map(n => cloneTreeWithNewIds(n, idMap));
    if (targetId) {
      for (const r of newRoots) appendChild(ctl.doc.roots, targetId, r);
    } else {
      // 自动落点：现有分支框最右 +120 起排，逐根横移；纵随最高点（不与原有内容冲突实锤）
      let maxX = 40, minY = 40;
      for (const b of (ctl.boxes?.values?.() || [])) {
        const br = b.branch || b;
        maxX = Math.max(maxX, br.x + br.w);
        minY = Math.min(minY, b.y);
      }
      for (const r of newRoots) { r.offX = maxX + 120; r.offY = minY; maxX += 300; }
      ctl.doc.roots.push(...newRoots);
    }
    // 附属重映射（引用线/多父级/便笺/泳道/帧——端点 id 走 idMap，坐标错位防叠）
    const sfx = Date.now().toString(36);
    for (const rl of (src.refLines || [])) {
      if (idMap.has(rl.from?.id) && idMap.has(rl.to?.id)) {
        const nrl = JSON.parse(JSON.stringify(rl));
        nrl.id = 'rl-m' + sfx + '-' + ctl.doc.refLines.length;
        nrl.from = { id: idMap.get(rl.from.id), k: rl.from.k };
        nrl.to = { id: idMap.get(rl.to.id), k: rl.to.k };
        ctl.doc.refLines.push(nrl);
      }
    }
    for (const pl of (src.parentLinks || [])) {
      if (idMap.has(pl.from) && idMap.has(pl.to)) {
        const npl = JSON.parse(JSON.stringify(pl));
        npl.id = 'pl-m' + sfx + '-' + ctl.doc.parentLinks.length;
        npl.from = idMap.get(pl.from);
        npl.to = idMap.get(pl.to);
        ctl.doc.parentLinks.push(npl);
      }
    }
    for (const n of (src.notes || [])) {
      const nn = createNote(n.text, (n.x || 0) + 30, (n.y || 0) + 30);
      if (n.color) nn.color = n.color; if (n.style) nn.style = JSON.parse(JSON.stringify(n.style)); if (n.w) nn.w = n.w;
      ctl.doc.notes.push(nn);
    }
    for (const l of (src.swimlanes || [])) {
      const nl = JSON.parse(JSON.stringify(l));
      nl.id = l.id + '-m' + sfx; nl.x = (l.x || 0) + 20; nl.y = (l.y || 0) + 20;
      ctl.doc.swimlanes.push(nl);
    }
    for (const f of (src.frames || [])) {
      const nf = JSON.parse(JSON.stringify(f));
      nf.id = f.id + '-m' + sfx; nf.x = (f.x || 0) + 20; nf.y = (f.y || 0) + 20;
      ctl.doc.frames.push(nf);
    }
    return { roots: newRoots.length, mapped: idMap.size };
  }

  /** 桥接入口：选来源文件 → 落点两档（挂选中节点/自动避撞位） → 合并 → 适配 */
  async function mergeFromFile() {
    try {
      const ws = await window.mazz.invoke('workspace:get');
      const files = [];
      const walk = async (dir, depth) => {
        const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
        for (const e of entries) {
          if (!e.isDir && /\.mindmap$/i.test(e.name)) files.push(e.path);
          else if (e.isDir && depth > 0 && !e.name.startsWith('.')) await walk(e.path, depth - 1);
        }
      };
      await walk(ws, 1);
      const cur = ctl.filePath || ctl.tabPath || '';
      const cands = files.filter(p => p !== cur);
      if (!cands.length) { toast('工作区没有其他导图文件可合并'); return; }
      const pick = await inputModal('合并来源（输入序号）\n' + cands.map((p, i) => `${i + 1}. ${p.split('/').pop()}`).join('\n'), '1');
      if (pick == null) return;
      const src = cands[Math.max(1, Math.min(cands.length, parseInt(pick, 10) || 1)) - 1];
      // 落点：有选中节点时问挂点
      let targetId = null;
      if (ctl.selected) {
        const ans = await inputModal(`合并到选中节点「${findNode(ctl.doc.roots, ctl.selected)?.text || ctl.selected}」作为其子树？\n输入 y=挂为子树，其他=自动落点（避让不冲突）`, 'y');
        if (ans == null) return;
        if (String(ans).trim().toLowerCase() === 'y') targetId = ctl.selected;
      }
      const text = await window.mazz.invoke('fs:readFile', { path: src });
      const srcDoc = parseDoc(text);
      if (!srcDoc?.roots?.length) { toast('来源导图内容为空或解析失败'); return; }
      let r = null;
      mutate(() => { r = mergeDocsInto(srcDoc, { targetId }); });
      requestAnimationFrame(fitView);
      toast(`已合并「${src.split('/').pop()}」：${r.roots} 根 ${r.mapped} 节点${targetId ? '（挂为子树）' : '（自动避让位）'}`);
    } catch (e) { toast('合并失败：' + (e.message || e)); }
  }

  // ==================== 窗格操作模式（w34：build 新建 / pan 移动 / select 选框） ====================
  function setToolMode(m) {
    ctl.toolMode = ['build', 'pan', 'select'].includes(m) ? m : 'build';
    if (ctl.toolMode !== 'select') { ctl.multiSel.clear(); }
    render();
    renderStylebar();
    syncHint();
  }
  /** hint 随模式（现状文案/移动文案/选框文案） */
  function syncHint() {
    const h = root.querySelector('.mm-hint');
    if (!h) return;
    h.textContent = ctl.toolMode === 'pan'
      ? '移动模式：左键任意拖动=平移画布 · 点工具钮切回新建/选框'
      : ctl.toolMode === 'select'
        ? '选框模式：左键拖框批量选中 · Delete 或右键删除所选 · 点工具钮切换模式'
        : '双击节点编辑 · 双击空白新增根节点 · Shift+双击空白新增便笺 · Tab 子节点 · Alt+Enter 同级 · Ctrl+Alt+J 连接 · Ctrl+Z 撤销 · 右键更多操作 · 滚轮缩放';
  }

  /** 选框拖出：pointerdown(select 模式)→拖虚线框→松手批量选中（box 与框相交） */
  function selectRectStart(e) {
    const rect = wrap.getBoundingClientRect();
    const sx = (e.clientX - rect.left - ctl.cam.x) / ctl.cam.k, sy = (e.clientY - rect.top - ctl.cam.y) / ctl.cam.k;
    return { sx, sy, cur: { x: sx, y: sy } };
  }
  function selectRectCalc(sel) {
    const x1 = Math.min(sel.sx, sel.cur.x), y1 = Math.min(sel.sy, sel.cur.y);
    const x2 = Math.max(sel.sx, sel.cur.x), y2 = Math.max(sel.sy, sel.cur.y);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  function applySelectRect(sel) {
    const r = selectRectCalc(sel);
    const hit = new Set();
    for (const [id, b] of ctl.boxes) {
      if (b.x + b.w >= r.x && b.x <= r.x + r.w && b.y + b.h >= r.y && b.y <= r.y + r.h) hit.add(id);
    }
    ctl.multiSel = hit;
    return hit.size;
  }

  /** 等距分布（混合画布：多选≥3 按轴排序，首尾不动中间均分间距） */
  function distributeSel(axis) {
    if (ctl.multiSel.size < 3) { toast('先选框选中 3 个以上节点'); return false; }
    // 全走 boxPos（含 offX 的实位——box.x 布局层恒定（170 实锤），布局坐标算等距必错）
    const items = [...ctl.multiSel].map(id => ctl.boxes.get(id)).filter(Boolean)
      .map(b => { const p = boxPos(b); return { node: b.node, x: p.x, y: p.y, w: p.w, h: p.h }; });
    if (items.length < 3) return false;
    items.sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
    mutate(() => {
      const first = items[0], last = items[items.length - 1];
      if (axis === 'x') {
        const span = (last.x + last.w) - first.x;
        const gap = (span - items.reduce((s, b) => s + b.w, 0)) / (items.length - 1);
        let cur = first.x;
        for (let i = 1; i < items.length - 1; i++) {
          cur += items[i - 1].w + gap;
          const d = cur - items[i].x;
          items[i].node.offX = (items[i].node.offX || 0) + d;
          if (items[i].node.fx != null) items[i].node.fx += d;
          cur = items[i].x;
        }
      } else {
        const span = (last.y + last.h) - first.y;
        const gap = (span - items.reduce((s, b) => s + b.h, 0)) / (items.length - 1);
        let cur = first.y;
        for (let i = 1; i < items.length - 1; i++) {
          cur += items[i - 1].h + gap;
          const d = cur - items[i].y;
          items[i].node.offY = (items[i].node.offY || 0) + d;
          if (items[i].node.fy != null) items[i].node.fy += d;
          cur = items[i].y;
        }
      }
    });
    toast(`已${axis === 'x' ? '水平' : '垂直'}等距分布 ${items.length} 个节点`);
    return true;
  }

  /** 批量删除所选（Delete/右键选单共用；端点清理随 deleteNode 同链） */
  function deleteMultiSel() {
    if (!ctl.multiSel.size) return false;
    const n = ctl.multiSel.size;
    mutate(() => {
      for (const id of [...ctl.multiSel]) {
        removeNode(ctl.doc.roots, id);
        ctl.doc.refLines = (ctl.doc.refLines || []).filter(l => !(l.from.id === id || l.to.id === id));
        ctl.doc.parentLinks = (ctl.doc.parentLinks || []).filter(l => !(l.from === id || l.to === id));
      }
      ctl.multiSel.clear();
    });
    toast(`已删除 ${n} 个节点`);
    return true;
  }

  /** 多选渲染（选框模式：批量选中高亮描边） */
  function renderMultiSel() {
    if (ctl.toolMode !== 'select' || !ctl.multiSel.size) return;
    for (const [id, b] of ctl.boxes) {
      if (!ctl.multiSel.has(id)) continue;
      const g = viewport.querySelector(`.mm-node[data-id="${id}"]`);
      const sh = g?.querySelector('polygon,ellipse,path,rect:not(.mm-resize)');
      if (sh) { sh.setAttribute('stroke', 'var(--acc, #4f46e5)'); sh.setAttribute('stroke-width', '2.6'); }
    }
  }

  // ==================== 帧侧栏（圈帧列表：跳转/排序/删除） ====================
  function renderFramesBar() {
    const host = stylebar.querySelector('.mm-frames');
    if (!host) return;
    const fs = ctl.doc.frames || [];
    host.innerHTML = fs.map((f, i) => `
      <span class="mm-frame" data-id="${f.id}" title="${(f.title || '').replace(/"/g, '&quot;')}（点击跳转镜头；↑↓ 排序 · ✕ 删除）"
        style="display:inline-flex;gap:2px;align-items:center;border:1px solid var(--bd,#e0ded8);border-radius:6px;padding:1px 5px;font-size:11px;cursor:pointer">
        <b>${i + 1}</b>·${(f.title || '帧').slice(0, 8)}<i data-a="up" style="cursor:pointer">↑</i><i data-a="dn" style="cursor:pointer">↓</i><i data-a="del" style="cursor:pointer">✕</i>
      </span>`).join('');
    host.querySelectorAll('.mm-frame').forEach(el => {
      const id = el.dataset.id;
      el.addEventListener('click', (e) => {
        const a = e.target.dataset?.a;
        if (a === 'del') { mmExec(ctl, 'removeFrame', id); renderFramesBar(); return; }
        if (a === 'up') { mmExec(ctl, 'moveFrame', { id, dir: -1 }); renderFramesBar(); return; }
        if (a === 'dn') { mmExec(ctl, 'moveFrame', { id, dir: 1 }); renderFramesBar(); return; }
        // 跳转镜头（预览=帧适配动画）
        const f = (ctl.doc.frames || []).find(x => x.id === id);
        if (f && ctl.mmStatus !== 'present') {
          camTween(ctl, camOfFrame(ctl, f, wrap), { duration: 480 }); // 帧跳转预览（镜头动画器直引）
        }
      });
    });
  }

  // ==================== 放映覆盖层（mm:present-change 驱动） ====================
  function ensurePresentStage() {
    if (ctl._stage) return ctl._stage;
    const st = document.createElement('div');
    st.className = 'mm-present-stage';
    st.style.cssText = 'position:fixed;inset:auto 0 0 0;z-index:60;display:none;justify-content:center;pointer-events:none;padding-bottom:26px';
    st.innerHTML = `<div class="mm-present-hud" style="pointer-events:auto;display:flex;gap:14px;align-items:center;background:rgba(20,20,24,.82);color:#eee;border-radius:999px;padding:8px 18px;font-size:12.5px;backdrop-filter:blur(6px)">
      <b class="mm-pv-title"></b><span class="mm-pv-idx" style="opacity:.75"></span><span style="opacity:.55">→/空格 下一帧 · ← 上一帧 · Esc 退出</span>
      <button class="mm-pv-exit" style="background:none;border:0;color:#eee;cursor:pointer;font-size:14px" title="退出放映（Esc）">✕</button>
    </div>`;
    st.querySelector('.mm-pv-exit').addEventListener('click', () => mmExec(ctl, 'exitPresent'));
    document.body.appendChild(st);
    ctl._stage = st;
    return st;
  }
  document.addEventListener('mm:present-change', (e) => {
    if (current !== ctl) return;
    const d = e.detail || {};
    const st = ensurePresentStage();
    st.style.display = d.on ? 'flex' : 'none';
    if (d.on) {
      st.querySelector('.mm-pv-idx').textContent = `${(d.idx ?? 0) + 1} / ${d.total ?? ''}`;
      st.querySelector('.mm-pv-title').textContent = d.frame?.title || '放映中';
      // 放映态：编辑区禁用（状态机闸）；样式栏隐藏（HUD 替代）
      stylebar.style.display = 'none';
    } else {
      renderStylebar();
    }
  });

  // ==================== 模板包选单（mmtpl-packs/ 库） ====================
  async function renderPackSelect() {
    const el = stylebar.querySelector('[data-k="__pack"]');
    if (!el) return;
    const packs = await listPacks().catch(() => []);
    el.innerHTML = `<option value="">模板包…（${packs.length}）</option>` + packs.map(p => `<option value="${p.path.replace(/"/g, '&quot;')}">${p.name}</option>`).join('');
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

  /** 帧转演示（W41 本体形态：doc.frames→layouts.frames——标题 Item+帧内节点要点+note→notes；死转不挂桥接引用） */
  function framesToSlide() {
    const frames = ctl.doc.frames || [];
    if (!frames.length) { toast('还没有叙事帧——先「圈帧」（演示叙事工具）再转演示'); return; }
    const boxes = ctl.boxes || ctl.layoutInfo?.boxes;
    const doc2 = createSlideDoc((ctl.title || '思维导图') + ' 帧演示', 'night');
    const inFrame = (fr) => {
      if (!boxes) return [];
      // 帧矩形罩节点中心（树序 DFS——要点顺序即导图阅读顺序）
      const hit = new Set();
      for (const [id, b] of boxes) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        if (cx >= fr.x && cx <= fr.x + fr.w && cy >= fr.y && cy <= fr.y + fr.h) hit.add(id);
      }
      const out = [];
      const dfs = (n) => {
        if (!n) return;
        if (hit.has(n.id)) out.push((n.text || '').trim().split('\n')[0].slice(0, 40));
        for (const k of (n.children || [])) dfs(k);
      };
      for (const r of (ctl.doc.roots || [])) dfs(r);
      return out.filter(Boolean);
    };
    for (const fr of frames) {
      const bullets = inFrame(fr);
      const items = [createSlItem('text', { text: fr.title || '帧', style: { size: 40, bold: true, align: 'center' }, left: 10, top: 8, width: 80, height: 14 })];
      if (bullets.length) items.push(createSlItem('text', { left: 12, top: 28, width: 76, height: 62, list: { items: bullets.slice(0, 12).map(t => ({ text: t, icon: '•' })) }, style: { size: 22 } }));
      addSlideToDoc(doc2, createV2Slide(null, { notes: fr.note || '', items }));
    }
    window.MazzHost?.openTab('slide', { title: doc2.name + '.mazzslide', content: serializeSlDoc(doc2) });
    toast(`已转演示：${frames.length} 帧→${doc2.layouts.main.frames.length} 页（本体死转，改导图不联动）`);
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
  ctl.framesToSlide = framesToSlide; // W41 帧转演示本体
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
    // 懒加载折叠（性能碾压：大图默认折到第二层，点谁展谁；用户已动过的文档（_lazyTouched）不插手）
    const total = countAll(ctl.doc.roots);
    if (total >= 300 && !ctl.doc._lazyTouched) {
      for (const r of ctl.doc.roots) { (function w(x, d) { if (d >= 1 && x.children.length) x.collapsed = true; for (const c of x.children) w(c, d + 1); })(r, 0); } // 折到第二层（支节点折起，露出根+支）
      ctl.doc._lazyTouched = true;
      ctl._lazyApplied = total;
    }
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

/** W62d：列出所有仍在会话中的导图及其最后选中节点，供文档页跨标签嫁接。 */
export function listDistillGraftTargets() {
  const shell = window.MazzShell;
  const out = [];
  for (const [container, ctl] of instances) {
    const node = ctl.selectedNode?.();
    if (!node) continue;
    const tabId = shell?.containerTab?.get?.(container);
    const tab = tabId && (shell?.paneTree?.paneOfTab?.(tabId)?.tabs?.get?.(tabId) || shell?.tabs?.get?.(tabId));
    if (tabId) out.push({ tabId, title: tab?.title || '思维导图', nodeId: node.id, nodeText: node.text || '未命名节点' });
  }
  return out;
}

/** W62d：把经无损契约验证的森林嫁接到目标导图当前选中节点。 */
export function graftDistillRoots(tabId, roots) {
  const registry = window.MazzModulesReal || window.MazzModules;
  const inst = registry?.instances?.get(tabId);
  const ctl = inst?.name === MODULE ? inst.state : null;
  const target = ctl?.selectedNode?.();
  if (!target) throw new Error('目标导图没有已选节点');
  const forest = Array.isArray(roots) ? roots : [];
  if (!forest.length) throw new Error('没有可嫁接的节点');
  ctl.mutate(() => target.children.push(...forest));
  ctl.selected = forest[0].id;
  ctl.render();
  window.MazzHost?.notifyChange(ctl.container);
  return { targetId: target.id, appended: forest.length };
}

export default {
  displayName: '思维导图',
  icon: '🧠',
  _forTests: { instances },

  create(container) {
    const ctl = createMindmap(container);
    instances.set(container, ctl);
    // W62d 顺手归正军规：state 必须就是 ctl，跨模块嫁接才能拿到稳定实例本体。
    return ctl;
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
      { id: 'mindmap.framesToSlide', title: '帧转演示文稿（本体）', icon: '📽', group: '导图', when: "module=='mindmap'",
        run: () => current?.framesToSlide() },
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
