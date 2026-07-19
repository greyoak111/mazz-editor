// renderer/modules/mindmap/index.js —— 思维导图：SVG 水平树 + 节点编辑/拖拽重排/撤销重做 + PNG/大纲导出
import { contextKeys } from '../../core/contextkey-service.js';
import { toast } from '../../shell/shell.js';
import { createNode, findNode, findParent, removeNode, insertSibling, appendChild, moveNode, parseOutline, toOutline, layout } from './model.js';

const MODULE = 'mindmap';
const instances = new Map();
let current = null;

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const SAMPLE = {
  root: (() => {
    const r = createNode('中心主题', 'root');
    const a = createNode('分支一'); a.children.push(createNode('子主题'), createNode('子主题'));
    const b = createNode('分支二'); b.children.push(createNode('子主题'));
    r.children.push(a, b, createNode('分支三'));
    return r;
  })(),
};

function createMindmap(container) {
  const root = document.createElement('div');
  root.className = 'mm-root';
  root.innerHTML = `
    <div class="mm-canvas-wrap" tabindex="-1">
      <svg class="mm-svg"><g class="mm-viewport"></g></svg>
      <input class="mm-editor" style="display:none" spellcheck="false" />
      <div class="mm-hint">双击节点编辑 · Tab 子节点 · Enter 同级 · Del 删除 · 拖拽重排 · 滚轮缩放</div>
    </div>`;
  container.appendChild(root);

  const wrap = root.querySelector('.mm-canvas-wrap');
  const svg = root.querySelector('.mm-svg');
  const viewport = root.querySelector('.mm-viewport');
  const editor = root.querySelector('.mm-editor');

  const ctl = {
    root, container,
    doc: null,          // { root }
    selected: null,     // 节点 id
    cam: { x: 30, y: 30, k: 1 },
    undoStack: [],
    redoStack: [],
    editing: null,      // 正在编辑的节点 id
    boxes: null,
  };

  // ==================== 数据 ====================
  function snapshot() {
    ctl.undoStack.push(JSON.stringify(ctl.doc.root));
    if (ctl.undoStack.length > 60) ctl.undoStack.shift();
    ctl.redoStack.length = 0;
  }
  function restore(json) {
    ctl.doc.root = JSON.parse(json);
    ctl.selected = null;
    render();
  }
  function undo() {
    if (!ctl.undoStack.length) return;
    ctl.redoStack.push(JSON.stringify(ctl.doc.root));
    restore(ctl.undoStack.pop());
    window.MazzHost?.notifyChange(container);
  }
  function redo() {
    if (!ctl.redoStack.length) return;
    ctl.undoStack.push(JSON.stringify(ctl.doc.root));
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

  // ==================== 渲染 ====================
  function nodeFill(depth) {
    return ['#4f46e5', '#0ea5e9', '#059669', '#d97706', '#dc2626', '#7c3aed'][depth % 6];
  }

  function render() {
    const L = layout(ctl.doc.root);
    ctl.boxes = L.boxes; // Map<id, box>
    ctl.layoutInfo = { width: L.width, height: L.height };
    viewport.innerHTML = '';
    viewport.setAttribute('transform', `translate(${ctl.cam.x},${ctl.cam.y}) scale(${ctl.cam.k})`);
    // 连线
    for (const b of L.boxes.values()) {
      if (!b.parentId) continue;
      const p = L.boxes.get(b.parentId);
      const x1 = p.x + p.w, y1 = p.y + p.h / 2;
      const x2 = b.x, y2 = b.y + b.h / 2;
      const mx = (x1 + x2) / 2;
      viewport.appendChild(svgEl('path', {
        d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`,
        fill: 'none', stroke: 'var(--bd, #d8d6cf)', 'stroke-width': 1.6,
      }));
    }
    // 节点
    for (const b of L.boxes.values()) {
      const g = svgEl('g', { class: 'mm-node', 'data-id': b.node.id, transform: `translate(${b.x},${b.y})` });
      const selected = ctl.selected === b.node.id;
      const rect = svgEl('rect', {
        width: b.w, height: b.h, rx: 9,
        fill: b.depth === 0 ? nodeFill(0) : (selected ? 'color-mix(in srgb, ' + nodeFill(b.depth) + ' 16%, white)' : 'var(--card, #fff)'),
        stroke: selected ? nodeFill(b.depth) : (b.depth === 0 ? 'none' : 'var(--bd, #d8d6cf)'),
        'stroke-width': selected ? 2 : 1.2,
      });
      g.appendChild(rect);
      const text = svgEl('text', {
        x: b.w / 2, y: b.h / 2 + 4.5, 'text-anchor': 'middle',
        'font-size': b.depth === 0 ? 14 : 12.5,
        'font-weight': b.depth <= 1 ? 700 : 400,
        fill: b.depth === 0 ? '#fff' : 'var(--fg, #2c2c2a)',
      });
      text.textContent = b.node.text || '（空）';
      g.appendChild(text);
      // 折叠钮
      if (b.node.children.length) {
        const btn = svgEl('g', { class: 'mm-fold', 'data-id': b.node.id, transform: `translate(${b.w + 4},${b.h / 2 - 7})` });
        btn.appendChild(svgEl('circle', { cx: 7, cy: 7, r: 7, fill: 'var(--card,#fff)', stroke: 'var(--bd,#d8d6cf)' }));
        const t = svgEl('text', { x: 7, y: 10.5, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--fg-dim,#a3a19a)' });
        t.textContent = b.node.collapsed ? '+' : '−';
        btn.appendChild(t);
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          mutate(() => { b.node.collapsed = !b.node.collapsed; });
        });
        g.appendChild(btn);
      }
      // 折叠时显示子节点数
      if (b.node.collapsed && b.node.children.length) {
        const badge = svgEl('text', { x: b.w + 24, y: b.h / 2 + 4, 'font-size': 10, fill: 'var(--fg-dim,#a3a19a)' });
        badge.textContent = `(${countDesc(b.node)})`;
        g.appendChild(badge);
      }
      g.addEventListener('mousedown', (e) => onNodeMouseDown(e, b));
      g.addEventListener('dblclick', (e) => { e.stopPropagation(); startEdit(b); });
      viewport.appendChild(g);
    }
  }

  function countDesc(node) {
    let n = 0;
    (function walk(x) { for (const c of x.children) { n++; walk(c); } })(node);
    return n;
  }

  // ==================== 编辑 ====================
  function startEdit(box) {
    ctl.editing = box.node.id;
    ctl.selected = box.node.id;
    const [sx, sy] = [box.x * ctl.cam.k + ctl.cam.x, box.y * ctl.cam.k + ctl.cam.y];
    editor.style.display = 'block';
    editor.style.left = sx + 'px';
    editor.style.top = sy + 'px';
    editor.style.width = Math.max(box.w * ctl.cam.k, 90) + 'px';
    editor.style.height = Math.max(box.h * ctl.cam.k, 26) + 'px';
    editor.value = box.node.text;
    editor.focus();
    editor.select();
  }
  function commitEdit() {
    if (!ctl.editing) return;
    const id = ctl.editing;
    ctl.editing = null;
    editor.style.display = 'none';
    const node = findNode(ctl.doc.root, id);
    const v = editor.value.trim();
    if (node && node.text !== v) mutate(() => { node.text = v; });
    else render();
  }
  editor.addEventListener('blur', commitEdit);
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { ctl.editing = null; editor.style.display = 'none'; }
    e.stopPropagation();
  });

  // ==================== 节点操作 ====================
  function addChildOf(id) {
    let newNode = null;
    mutate(() => { newNode = createNode(''); appendChild(ctl.doc.root, id, newNode); });
    const box = ctl.boxes.get(newNode?.id);
    if (box) startEdit(box);
  }
  function addSiblingOf(id) {
    if (id === ctl.doc.root.id) return addChildOf(id);
    let newNode = null;
    mutate(() => { newNode = createNode(''); insertSibling(ctl.doc.root, id, newNode); });
    const box = ctl.boxes.get(newNode?.id);
    if (box) startEdit(box);
  }
  function deleteNode(id) {
    if (id === ctl.doc.root.id) { toast('根节点不能删除'); return; }
    const parent = findParent(ctl.doc.root, id);
    mutate(() => removeNode(ctl.doc.root, id));
    ctl.selected = parent?.id || null;
    render();
  }

  // ==================== 交互 ====================
  let drag = null; // {type:'pan'|'node', ...}
  function onNodeMouseDown(e, box) {
    e.stopPropagation();
    if (e.button !== 0) return;
    wrap.focus({ preventScroll: true }); // 画布拿焦点（否则快捷键收不到）
    ctl.selected = box.node.id;
    render();
    drag = { type: 'node', id: box.node.id, sx: e.clientX, sy: e.clientY, moved: false };
  }

  wrap.addEventListener('mousedown', (e) => {
    if (e.target === svg || e.target === viewport) {
      wrap.focus({ preventScroll: true });
      drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...ctl.cam } };
      ctl.selected = null;
      render();
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag || current !== ctl) return; // 只响应本实例发起的拖拽（分屏/多标签隔离）
    if (drag.type === 'pan') {
      ctl.cam.x = drag.cam.x + (e.clientX - drag.sx);
      ctl.cam.y = drag.cam.y + (e.clientY - drag.sy);
      viewport.setAttribute('transform', `translate(${ctl.cam.x},${ctl.cam.y}) scale(${ctl.cam.k})`);
    } else if (drag.type === 'node') {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 5) {
        drag.moved = true;
        // 悬停高亮目标
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.mm-node');
        viewport.querySelectorAll('.mm-node rect').forEach(r => r.style.strokeDasharray = '');
        if (el && el.dataset.id !== drag.id) {
          el.querySelector('rect').style.strokeDasharray = '4 3';
          drag.target = el.dataset.id;
        } else drag.target = null;
      }
    }
  });
  window.addEventListener('mouseup', () => {
    if (!drag || current !== ctl) return;
    if (drag.type === 'node' && drag.moved && drag.target) {
      mutate(() => moveNode(ctl.doc.root, drag.id, drag.target));
    }
    drag = null;
  });
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const k2 = Math.min(Math.max(ctl.cam.k * f, 0.25), 3);
    // 以光标为锚
    ctl.cam.x = mx - (mx - ctl.cam.x) * (k2 / ctl.cam.k);
    ctl.cam.y = my - (my - ctl.cam.y) * (k2 / ctl.cam.k);
    ctl.cam.k = k2;
    viewport.setAttribute('transform', `translate(${ctl.cam.x},${ctl.cam.y}) scale(${ctl.cam.k})`);
  }, { passive: false });
  wrap.addEventListener('dblclick', (e) => {
    if (e.target === svg || e.target === viewport) fitView();
  });

  // 键盘路由挂 document（画布无需焦点亦可响应），按当前实例隔离——分屏/多标签互不打架
  document.addEventListener('keydown', (e) => {
    if (current !== ctl || ctl.editing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // 组合键交给全局 keymap/命令表
    const id = ctl.selected;
    if (e.key === 'Tab' && id) { e.preventDefault(); addChildOf(id); }
    else if (e.key === 'Enter' && id) { e.preventDefault(); addSiblingOf(id); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && id) { e.preventDefault(); deleteNode(id); }
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
    clone.querySelector('.mm-viewport').setAttribute('transform', 'translate(20,20) scale(1)');
    clone.setAttribute('width', L.width + 40);
    clone.setAttribute('height', L.height + 40);
    clone.setAttribute('xmlns', NS);
    // 内联基础样式（SVG 离开文档后 CSS 变量失效）
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
    window.MazzHost?.openTab('markdown', { title: (ctl.title || '思维导图') + '.md', content: toOutline(ctl.doc.root) });
  }

  ctl.undo = undo;
  ctl.redo = redo;
  ctl.fitView = fitView;
  ctl.exportPNG = exportPNG;
  ctl.exportOutline = exportOutline;
  ctl.addChildOf = () => ctl.selected && addChildOf(ctl.selected);
  ctl.deleteSelected = () => ctl.selected && deleteNode(ctl.selected);
  ctl.setDoc = (doc) => { ctl.doc = doc; ctl.selected = doc.root.id; render(); requestAnimationFrame(fitView); };

  // 初始化
  ctl.doc = { root: JSON.parse(JSON.stringify(SAMPLE.root)) };
  ctl.selected = ctl.doc.root.id;
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
    contextKeys.set('module', MODULE);
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },
  getContent(state) {
    const ctl = instances.get(state.container);
    return ctl ? JSON.stringify({ mark: 'mazz-mindmap-v1', root: ctl.doc.root }) : '';
  },
  /** 按扩展名导出：.md/.txt → Markdown 大纲；其余回落 getContent（JSON） */
  async exportAs(ext, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return null;
    if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
      return { text: toOutline(ctl.doc.root) };
    }
    return null;
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      if (obj?.root) { ctl.setDoc({ root: obj.root }); return; }
    } catch {}
    // 非 JSON：按 Markdown 大纲解析
    ctl.setDoc({ root: parseOutline(typeof data === 'string' ? data : '') });
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    ctl?.setDoc({ root: createNode('中心主题') });
  },
  getCharCount(state) {
    const ctl = instances.get(state.container);
    return ctl ? JSON.stringify(ctl.doc.root).length : 0;
  },
  getCursorPos(state) { return '导图'; },

  toolbarHTML: `
    <div class="rb-group" data-label="节点">
      <button class="rb-btn" data-command="mindmap.addChild"><i class="ico">⤵</i><span>子节点</span></button>
      <button class="rb-btn" data-command="mindmap.delete"><i class="ico">✕</i><span>删除</span></button>
    </div>
    <div class="rb-group" data-label="历史">
      <button class="rb-btn" data-command="mindmap.undo"><i class="ico">↩</i><span>撤销</span></button>
      <button class="rb-btn" data-command="mindmap.redo"><i class="ico">↪</i><span>重做</span></button>
    </div>
    <div class="rb-group" data-label="导出">
      <button class="rb-btn" data-command="mindmap.fit"><i class="ico">⛶</i><span>适应视图</span></button>
      <button class="rb-btn" data-command="mindmap.exportPNG"><i class="ico">🖼</i><span>导出PNG</span></button>
      <button class="rb-btn" data-command="mindmap.exportOutline"><i class="ico">≣</i><span>转大纲</span></button>
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
      { id: 'mindmap.delete', title: '删除节点', group: '导图', when: "module=='mindmap'",
        run: () => current?.deleteSelected() },
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
