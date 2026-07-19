// renderer/modules/draw/index.js —— 画板：Perfect Freehand 矢量笔 + 图层 + 参考图 + 帧/洋葱皮（动画草稿基础）
import { getStroke } from 'perfect-freehand';
import { contextKeys } from '../../core/contextkey-service.js';
import { toast, inputModal } from '../../shell/shell.js';
import { createDoc, createLayer, createFrame, createStroke, hitAnyStroke, moveStroke, SnapshotStack } from './model.js';

const MODULE = 'draw';
const instances = new Map();
let current = null;

const PALETTE = ['#1a1a1a', '#dc2626', '#ea580c', '#d97706', '#16a34a', '#0ea5e9', '#4f46e5', '#7c3aed', '#db2777', '#ffffff'];
const PF_OPTS = { thinning: 0.55, smoothing: 0.5, streamline: 0.4, easing: (t) => t, last: true };

/** freehand stroke 点列 → Path2D */
function strokePath(stroke) {
  const outline = getStroke(stroke.pts.map(p => [p.x, p.y, p.p ?? 0.5]), {
    size: stroke.size, ...PF_OPTS,
  });
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) path.lineTo(outline[i][0], outline[i][1]);
  path.closePath();
  return path;
}

function createDraw(container) {
  const root = document.createElement('div');
  root.className = 'draw-root';
  root.innerHTML = `
    <div class="draw-main">
      <div class="draw-canvas-wrap" tabindex="0">
        <canvas class="draw-canvas"></canvas>
        <div class="draw-tool-strip">
          <button data-t="pen" class="on" title="画笔（B）">✏️</button>
          <button data-t="eraser" title="橡皮：点按删除整笔（E）">🧽</button>
          <button data-t="select" title="选择/移动整笔（V）">➤</button>
          <span class="sep"></span>
          <input type="color" class="draw-color" value="#1a1a1a" title="颜色" />
          <input type="range" class="draw-size" min="1" max="40" value="6" title="粗细" />
          <span class="draw-size-v">6</span>
        </div>
        <div class="draw-palette">${PALETTE.map(c => `<i data-c="${c}" style="background:${c}" title="${c}"></i>`).join('')}</div>
      </div>
      <div class="draw-side">
        <div class="draw-sect">图层 <button data-a="add-layer" title="新建图层">＋</button></div>
        <div class="draw-layers"></div>
        <div class="draw-sect">参考图 <button data-a="add-image" title="贴入参考图">＋</button></div>
        <div class="draw-images"></div>
        <div class="draw-sect draw-ref-sect" style="display:none">分镜参考</div>
        <div class="draw-ref" style="display:none"></div>
      </div>
    </div>
    <div class="draw-frames">
      <label class="draw-onion"><input type="checkbox" class="onion-toggle" /> 洋葱皮</label>
      <div class="draw-frame-list"></div>
      <button data-a="add-frame" title="新建帧">＋帧</button>
      <button data-a="dup-frame" title="复制当前帧">⧉</button>
      <button data-a="del-frame" title="删除当前帧">✕</button>
    </div>`;
  container.appendChild(root);

  const wrap = root.querySelector('.draw-canvas-wrap');
  const canvas = root.querySelector('.draw-canvas');
  let ctx = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; } // 无 canvas 环境降级（测试/预览）
  const layersEl = root.querySelector('.draw-layers');
  const imagesEl = root.querySelector('.draw-images');
  const frameListEl = root.querySelector('.draw-frame-list');

  const ctl = {
    root, container, canvas, ctx,
    doc: createDoc(),
    tool: 'pen',
    color: '#1a1a1a',
    size: 6,
    activeLayer: 0,
    onion: false,
    drawing: null,   // {pts:[], path}
    selected: null,  // {stroke, layer}
    history: new SnapshotStack(40),
    cam: { x: 0, y: 0, k: 1 },
  };

  const frame = () => ctl.doc.frames[ctl.doc.current];
  const activeLayer = () => frame().layers[ctl.activeLayer] || frame().layers[0];

  // ==================== 渲染 ====================
  function resize() {
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function drawLayerContent(layer, alpha = 1) {
    if (!layer.visible && alpha === 1) return;
    ctx.globalAlpha = alpha * (layer.opacity ?? 1);
    for (const img of layer.images) {
      if (img._el) ctx.drawImage(img._el, img.x, img.y, img.w, img.h);
    }
    for (const s of layer.strokes) {
      ctx.fillStyle = s.color;
      if (!s._path) s._path = strokePath(s);
      ctx.fill(s._path);
    }
    ctx.globalAlpha = 1;
  }

  function redraw() {
    if (!ctx) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(ctl.cam.x, ctl.cam.y);
    ctx.scale(ctl.cam.k, ctl.cam.k);
    // 洋葱皮：前后帧灰影
    if (ctl.onion && ctl.doc.frames.length > 1) {
      const prev = ctl.doc.frames[ctl.doc.current - 1];
      const next = ctl.doc.frames[ctl.doc.current + 1];
      if (prev) { ctx.save(); ctx.globalAlpha = 0.22; for (const l of prev.layers) { l.visible && drawLayerContent(l, 1); } ctx.restore(); }
      if (next) { ctx.save(); ctx.globalAlpha = 0.22; for (const l of next.layers) { l.visible && drawLayerContent(l, 1); } ctx.restore(); }
    }
    // 当前帧
    for (const layer of frame().layers) drawLayerContent(layer);
    // 选中高亮
    if (ctl.selected?.stroke) {
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = 1.5 / ctl.cam.k;
      ctx.setLineDash([5 / ctl.cam.k, 4 / ctl.cam.k]);
      ctx.stroke(ctl.selected.stroke._path || (ctl.selected.stroke._path = strokePath(ctl.selected.stroke)));
      ctx.setLineDash([]);
    }
    // 进行中的笔画
    if (ctl.drawing) {
      ctx.fillStyle = ctl.color;
      ctx.fill(strokePath({ pts: ctl.drawing.pts, size: ctl.size }));
    }
    ctx.restore();
  }

  // ==================== 坐标 ====================
  function toWorld(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - ctl.cam.x) / ctl.cam.k,
      y: (e.clientY - rect.top - ctl.cam.y) / ctl.cam.k,
      p: e.pressure || 0.5,
    };
  }

  // ==================== 历史 ====================
  const docJson = () => JSON.stringify({ frames: ctl.doc.frames, current: ctl.doc.current });
  function snapshot() { ctl.history.push(docJson()); }
  function restore(json) {
    const obj = JSON.parse(json);
    ctl.doc.frames = obj.frames;
    ctl.doc.current = Math.min(obj.current, obj.frames.length - 1);
    // 缓存失效重算
    for (const f of ctl.doc.frames) for (const l of f.layers) for (const s of l.strokes) s._path = null;
    for (const f of ctl.doc.frames) for (const l of f.layers) for (const im of l.images) loadImageEl(im);
    ctl.selected = null;
    ctl.activeLayer = Math.min(ctl.activeLayer, frame().layers.length - 1);
    redraw(); renderLayers(); renderFrames();
    window.MazzHost?.notifyChange(container);
  }
  function undo() { const j = ctl.history.undo(docJson()); if (j) restore(j); }
  function redo() { const j = ctl.history.redo(docJson()); if (j) restore(j); }
  function changed() { window.MazzHost?.notifyChange(container); }

  // ==================== 绘画交互 ====================
  let dragImage = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    canvas.setPointerCapture?.(e.pointerId);
    const pt = toWorld(e);
    if (ctl.tool === 'pen') {
      ctl.drawing = { pts: [pt] };
      redraw();
    } else if (ctl.tool === 'eraser') {
      const hit = hitAnyStroke(frame(), pt.x, pt.y, 4 / ctl.cam.k);
      if (hit) {
        snapshot();
        const i = hit.layer.strokes.indexOf(hit.stroke);
        hit.layer.strokes.splice(i, 1);
        ctl.selected = null;
        redraw(); renderLayers(); changed();
      }
    } else if (ctl.tool === 'select') {
      // 先图片，后笔画
      const layer = activeLayer();
      const img = [...layer.images].reverse().find(im => pt.x >= im.x && pt.x <= im.x + im.w && pt.y >= im.y && pt.y <= im.y + im.h);
      if (img) { dragImage = { img, ox: pt.x - img.x, oy: pt.y - img.y }; snapshot(); return; }
      const hit = hitAnyStroke(frame(), pt.x, pt.y, 4 / ctl.cam.k);
      if (hit) {
        ctl.selected = hit;
        dragImage = { stroke: hit.stroke, ox: pt.x, oy: pt.y };
        snapshot();
      } else ctl.selected = null;
      redraw();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const pt = toWorld(e);
    if (ctl.drawing) {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events) {
        const p = toWorld(ev);
        ctl.drawing.pts.push(p);
      }
      redraw();
    } else if (dragImage?.img) {
      dragImage.img.x = pt.x - dragImage.ox;
      dragImage.img.y = pt.y - dragImage.oy;
      redraw();
    } else if (dragImage?.stroke) {
      moveStroke(dragImage.stroke, pt.x - dragImage.ox, pt.y - dragImage.oy);
      dragImage.ox = pt.x; dragImage.oy = pt.y;
      dragImage.stroke._path = null;
      redraw();
    }
  });
  canvas.addEventListener('pointerup', () => {
    if (ctl.drawing) {
      const pts = ctl.drawing.pts;
      ctl.drawing = null;
      if (pts.length >= 2) {
        snapshot();
        const stroke = createStroke(pts, ctl.color, ctl.size);
        activeLayer().strokes.push(stroke);
        redraw(); renderLayers(); changed();
      } else redraw();
    }
    if (dragImage) { dragImage = null; renderLayers(); changed(); }
  });

  // 键盘：Delete 删选中 / B E V 切工具
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && ctl.selected) {
      snapshot();
      const i = ctl.selected.layer.strokes.indexOf(ctl.selected.stroke);
      if (i >= 0) ctl.selected.layer.strokes.splice(i, 1);
      ctl.selected = null;
      redraw(); changed();
    } else if (e.key.toLowerCase() === 'b') setTool('pen');
    else if (e.key.toLowerCase() === 'e') setTool('eraser');
    else if (e.key.toLowerCase() === 'v') setTool('select');
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  });

  // 右键 9 号上下文
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const menu = document.createElement('div');
    menu.className = 'mazz-menu';
    menu.innerHTML = `
      <div class="mazz-menu-item" data-a="undo">撤销</div>
      <div class="mazz-menu-item" data-a="redo">重做</div>
      <div class="mazz-menu-sep"></div>
      <div class="mazz-menu-item" data-a="clear-layer">清空当前图层</div>
      <div class="mazz-menu-item" data-a="onion">${ctl.onion ? '✓ ' : ''}洋葱皮</div>
      <div class="mazz-menu-sep"></div>
      <div class="mazz-menu-item" data-a="export">导出 PNG</div>
      <div class="mazz-menu-item" data-a="export-seq">导出 PNG 序列（全部帧）</div>`;
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);
    const close = () => menu.remove();
    setTimeout(() => window.addEventListener('mousedown', close, { once: true }), 0);
    const acts = {
      undo, redo,
      'clear-layer': () => { snapshot(); const l = activeLayer(); l.strokes = []; l.images = []; redraw(); renderLayers(); changed(); },
      onion: () => setOnion(!ctl.onion),
      export: () => ctl.exportPNG(),
      'export-seq': () => ctl.exportSequence(),
    };
    menu.querySelectorAll('[data-a]').forEach(el => el.addEventListener('click', () => { acts[el.dataset.a]?.(); close(); }));
  });

  // ==================== 工具条 ====================
  function setTool(t) {
    ctl.tool = t;
    root.querySelectorAll('.draw-tool-strip [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    canvas.style.cursor = t === 'pen' ? 'crosshair' : (t === 'select' ? 'default' : 'cell');
  }
  root.querySelectorAll('.draw-tool-strip [data-t]').forEach(b =>
    b.addEventListener('click', () => setTool(b.dataset.t)));
  const colorEl = root.querySelector('.draw-color');
  colorEl.addEventListener('input', () => { ctl.color = colorEl.value; setTool('pen'); });
  const sizeEl = root.querySelector('.draw-size');
  sizeEl.addEventListener('input', () => {
    ctl.size = +sizeEl.value;
    root.querySelector('.draw-size-v').textContent = sizeEl.value;
  });
  root.querySelectorAll('.draw-palette i').forEach(el => el.addEventListener('click', () => {
    ctl.color = el.dataset.c;
    colorEl.value = el.dataset.c;
    setTool('pen');
  }));

  // ==================== 图层 ====================
  function renderLayers() {
    const f = frame();
    layersEl.innerHTML = f.layers.map((l, i) => `
      <div class="draw-layer${i === ctl.activeLayer ? ' on' : ''}" data-i="${i}">
        <button class="lv-vis" title="显隐">${l.visible ? '👁' : '◡'}</button>
        <span class="lv-name" title="双击重命名">${l.name}</span>
        <span class="lv-count">${l.strokes.length}</span>
        <button class="lv-del" title="删除图层">✕</button>
      </div>`).join('');
    layersEl.querySelectorAll('.draw-layer').forEach(el => {
      const i = +el.dataset.i;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.lv-del') || e.target.closest('.lv-vis')) return;
        ctl.activeLayer = i; renderLayers();
      });
      el.querySelector('.lv-vis').addEventListener('click', () => {
        snapshot(); f.layers[i].visible = !f.layers[i].visible; renderLayers(); redraw(); changed();
      });
      el.querySelector('.lv-del').addEventListener('click', () => {
        if (f.layers.length <= 1) { toast('至少保留一个图层'); return; }
        snapshot(); f.layers.splice(i, 1);
        ctl.activeLayer = Math.min(ctl.activeLayer, f.layers.length - 1);
        renderLayers(); redraw(); changed();
      });
      el.querySelector('.lv-name').addEventListener('dblclick', async () => {
        const name = await inputModal('图层名称', f.layers[i].name);
        if (name?.trim()) { snapshot(); f.layers[i].name = name.trim(); renderLayers(); changed(); }
      });
    });
    renderImages();
  }

  root.querySelector('[data-a=add-layer]').addEventListener('click', () => {
    snapshot();
    frame().layers.push(createLayer('图层 ' + (frame().layers.length + 1)));
    ctl.activeLayer = frame().layers.length - 1;
    renderLayers(); redraw(); changed();
  });

  // ==================== 参考图 ====================
  function loadImageEl(img) {
    const el = new Image();
    el.onload = () => redraw();
    el.src = img.src;
    img._el = el;
  }
  function renderImages() {
    const imgs = activeLayer().images;
    imagesEl.innerHTML = imgs.length ? imgs.map((im, i) => `
      <div class="draw-img-item" data-i="${i}"><span>🖼 图 ${i + 1}</span><button title="删除">✕</button></div>`).join('')
      : '<div class="draw-img-empty">（无）选择工具下可拖动</div>';
    imagesEl.querySelectorAll('.draw-img-item button').forEach(btn => btn.addEventListener('click', () => {
      const i = +btn.parentElement.dataset.i;
      snapshot(); activeLayer().images.splice(i, 1); renderImages(); redraw(); changed();
    }));
  }
  root.querySelector('[data-a=add-image]').addEventListener('click', async () => {
    if (!window.mazz?.isElectron) { toast('贴图需要桌面版'); return; }
    const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (!p) return;
    const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p });
    const ext = p.split('.').pop().toLowerCase().replace('jpg', 'jpeg');
    snapshot();
    const img = { src: `data:image/${ext};base64,${b64}`, x: 40, y: 40, w: 320, h: 240 };
    activeLayer().images.push(img);
    loadImageEl(img);
    renderImages(); redraw(); changed();
  });

  // ==================== 帧 ====================
  function renderFrames() {
    frameListEl.innerHTML = ctl.doc.frames.map((f, i) => `
      <button class="draw-frame${i === ctl.doc.current ? ' on' : ''}" data-i="${i}" title="第 ${i + 1} 帧">${i + 1}</button>`).join('');
    frameListEl.querySelectorAll('.draw-frame').forEach(el => el.addEventListener('click', () => {
      ctl.doc.current = +el.dataset.i;
      ctl.activeLayer = 0;
      ctl.selected = null;
      renderFrames(); renderLayers(); redraw();
    }));
  }
  function setOnion(v) {
    ctl.onion = v;
    root.querySelector('.onion-toggle').checked = v;
    redraw();
  }
  root.querySelector('.onion-toggle').addEventListener('change', (e) => setOnion(e.target.checked));
  root.querySelector('[data-a=add-frame]').addEventListener('click', () => {
    snapshot();
    ctl.doc.frames.splice(ctl.doc.current + 1, 0, createFrame());
    ctl.doc.current++;
    ctl.activeLayer = 0;
    renderFrames(); renderLayers(); redraw(); changed();
  });
  root.querySelector('[data-a=dup-frame]').addEventListener('click', () => {
    snapshot();
    const copy = JSON.parse(JSON.stringify(frame()));
    copy.id = 'f-copy-' + Date.now().toString(36);
    for (const l of copy.layers) for (const s of l.strokes) s._path = null;
    for (const l of copy.layers) for (const im of l.images) loadImageEl(im);
    ctl.doc.frames.splice(ctl.doc.current + 1, 0, copy);
    ctl.doc.current++;
    renderFrames(); renderLayers(); redraw(); changed();
  });
  root.querySelector('[data-a=del-frame]').addEventListener('click', () => {
    if (ctl.doc.frames.length <= 1) { toast('至少保留一帧'); return; }
    snapshot();
    ctl.doc.frames.splice(ctl.doc.current, 1);
    ctl.doc.current = Math.max(0, ctl.doc.current - 1);
    ctl.activeLayer = 0;
    renderFrames(); renderLayers(); redraw(); changed();
  });

  // ==================== 导出 ====================
  function renderToCanvas(f, scale = 1) {
    const w = canvas.clientWidth || 960, h = canvas.clientHeight || 540;
    const off = document.createElement('canvas');
    off.width = w * scale; off.height = h * scale;
    const c = off.getContext('2d');
    c.scale(scale, scale);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    c.translate(ctl.cam.x, ctl.cam.y);
    c.scale(ctl.cam.k, ctl.cam.k);
    for (const layer of f.layers) {
      if (!layer.visible) continue;
      c.globalAlpha = layer.opacity ?? 1;
      for (const img of layer.images) if (img._el) c.drawImage(img._el, img.x, img.y, img.w, img.h);
      for (const s of layer.strokes) {
        c.fillStyle = s.color;
        if (!s._path) s._path = strokePath(s);
        c.fill(s._path);
      }
      c.globalAlpha = 1;
    }
    return off;
  }

  ctl.frameToDataUrl = () => renderToCanvas(frame(), 2).toDataURL('image/png'); // 桥接 #5 用

  ctl.exportPNG = async () => {
    const off = renderToCanvas(frame(), 2);
    const dataUrl = off.toDataURL('image/png');
    if (window.mazz?.isElectron) {
      const p = await window.mazz.invoke('dialog:saveFile', { defaultPath: '画板.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (p) { await window.mazz.invoke('fs:writeFileBase64', { path: p, base64: dataUrl.split(',')[1] }); toast('已导出 PNG'); }
    } else {
      const a = document.createElement('a'); a.href = dataUrl; a.download = '画板.png'; a.click();
    }
  };

  ctl.exportSequence = async () => {
    if (!window.mazz?.isElectron) { toast('PNG 序列导出需要桌面版'); return; }
    const dir = await window.mazz.invoke('dialog:openFolder', {});
    if (!dir) return;
    for (let i = 0; i < ctl.doc.frames.length; i++) {
      const off = renderToCanvas(ctl.doc.frames[i], 2);
      const dataUrl = off.toDataURL('image/png');
      await window.mazz.invoke('fs:writeFileBase64', {
        path: `${dir}/frame_${String(i + 1).padStart(3, '0')}.png`,
        base64: dataUrl.split(',')[1],
      });
    }
    toast(`已导出 ${ctl.doc.frames.length} 帧 PNG 序列`);
  };

  ctl.undo = undo;
  ctl.redo = redo;
  ctl.setOnion = setOnion;
  ctl.setTool = setTool;
  ctl.clearLayer = () => { snapshot(); const l = activeLayer(); l.strokes = []; l.images = []; redraw(); renderLayers(); changed(); };

  // 序列化支持（图像元素重建）
  ctl.serialize = () => JSON.stringify({ mark: 'mazz-draw-v1', frames: ctl.doc.frames, current: ctl.doc.current });
  ctl.deserialize = (json) => {
    try {
      const obj = JSON.parse(json);
      if (!obj?.frames?.length) return false;
      ctl.doc = { mark: obj.mark || 'mazz-draw-v1', frames: obj.frames, current: Math.min(obj.current || 0, obj.frames.length - 1) };
      for (const f of ctl.doc.frames) for (const l of f.layers) {
        for (const s of l.strokes) s._path = null;
        for (const im of l.images) loadImageEl(im);
      }
      ctl.activeLayer = 0;
      ctl.selected = null;
      ctl.history.clear();
      renderLayers(); renderFrames(); resize();
      return true;
    } catch { return false; }
  };

  // 初始化
  renderLayers();
  renderFrames();
  setTool('pen');
  // 桥接 #6：文稿送来的分镜/场景参考文本
  if (window.__pendingDrawReference) {
    const ref = window.__pendingDrawReference;
    window.__pendingDrawReference = null;
    const refSect = root.querySelector('.draw-ref-sect');
    const refEl = root.querySelector('.draw-ref');
    refSect.style.display = 'flex';
    refEl.style.display = 'block';
    refEl.textContent = ref;
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(wrap);
  requestAnimationFrame(resize);

  return ctl;
}

export default {
  displayName: '画板',
  icon: '🎨',
  _forTests: { instances },

  create(container) {
    const ctl = createDraw(container);
    instances.set(container, ctl);
    return { container };
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    window.__activeDrawCtl = ctl; // 桥接 #5 取数
    contextKeys.set('module', MODULE);
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },
  getContent(state) {
    const ctl = instances.get(state.container);
    return ctl ? ctl.serialize() : '';
  },
  /** 按扩展名导出：.png → 当前帧 PNG base64；其余回落 getContent（无 canvas 环境安全回落） */
  async exportAs(ext, state) {
    const ctl = instances.get(state.container);
    if (!ctl || ext !== '.png') return null;
    try {
      return { base64: ctl.frameToDataUrl().split(',')[1] };
    } catch { return null; }
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    if (data) ctl.deserialize(typeof data === 'string' ? data : JSON.stringify(data));
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    ctl?.deserialize(JSON.stringify(createDoc()));
  },
  getCharCount(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return 0;
    return ctl.doc.frames.reduce((n, f) => n + f.layers.reduce((m, l) => m + l.strokes.length, 0), 0);
  },
  getCursorPos() { return '画板'; },

  toolbarHTML: `
    <div class="rb-group" data-label="工具">
      <button class="rb-btn" data-command="draw.pen"><i class="ico">✏️</i><span>画笔</span></button>
      <button class="rb-btn" data-command="draw.eraser"><i class="ico">🧽</i><span>橡皮</span></button>
      <button class="rb-btn" data-command="draw.select"><i class="ico">➤</i><span>选择</span></button>
    </div>
    <div class="rb-group" data-label="历史">
      <button class="rb-btn" data-command="draw.undo"><i class="ico">↩</i><span>撤销</span></button>
      <button class="rb-btn" data-command="draw.redo"><i class="ico">↪</i><span>重做</span></button>
    </div>
    <div class="rb-group" data-label="输出">
      <button class="rb-btn" data-command="draw.exportPNG"><i class="ico">🖼</i><span>导出PNG</span></button>
      <button class="rb-btn" data-command="draw.exportSeq"><i class="ico">🎞</i><span>PNG序列</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
  },

  contributes: {
    commands: [
      { id: 'draw.pen', title: '画笔', group: '画板', when: "module=='draw'", run: () => current?.setTool('pen') },
      { id: 'draw.eraser', title: '橡皮', group: '画板', when: "module=='draw'", run: () => current?.setTool('eraser') },
      { id: 'draw.select', title: '选择/移动', group: '画板', when: "module=='draw'", run: () => current?.setTool('select') },
      { id: 'draw.undo', title: '撤销', group: '画板', when: "module=='draw'", run: () => current?.undo() },
      { id: 'draw.redo', title: '重做', group: '画板', when: "module=='draw'", run: () => current?.redo() },
      { id: 'draw.exportPNG', title: '导出 PNG', group: '画板', when: "module=='draw'", run: () => current?.exportPNG() },
      { id: 'draw.exportSeq', title: '导出 PNG 序列', group: '画板', when: "module=='draw'", run: () => current?.exportSequence() },
      { id: 'draw.clearLayer', title: '清空当前图层', group: '画板', when: "module=='draw'", run: () => current?.clearLayer() },
    ],
    keybindings: [
      { command: 'draw.undo', key: 'ctrl+z', when: "module=='draw'" },
      { command: 'draw.redo', key: 'ctrl+y', when: "module=='draw'" },
    ],
    menus: {},
    bridges: [],
    aiActions: [],
  },
};
