// renderer/modules/draw/index.js —— 画板：多笔刷引擎 + 图层 + 参考图 + 帧/洋葱皮 + 过程内录
import { getStroke } from 'perfect-freehand';
import { iconHtml } from '../../lib/svg-icons.js';
import { contextKeys } from '../../core/contextkey-service.js';
import { toast, inputModal } from '../../shell/shell.js';
import { createDoc, createLayer, createFrame, createStroke, hitAnyStroke, moveStroke, SnapshotStack, legacyFrameToCanvasDocument } from './model.js';
import { createCanvasAgentClient } from '../../lib/canvas-agent.js';
import { BRUSH_TYPES, DEFAULT_BRUSHES, makeTipCanvas, colorWithAlpha, parseAbr, listCustomBrushes, saveCustomBrush } from './brushes.js';

const MODULE = 'draw';
const instances = new Map();
let current = null;

const PALETTE = ['#1a1a1a', '#dc2626', '#ea580c', '#d97706', '#16a34a', '#0ea5e9', '#4f46e5', '#7c3aed', '#db2777', '#ffffff'];
const PF_OPTS = { thinning: 0.55, smoothing: 0.5, streamline: 0.4, easing: (t) => t, last: true };

/** freehand stroke 点列 → Path2D（按笔刷类型调参） */
function strokePath(stroke) {
  const bt = BRUSH_TYPES[stroke.brush] || BRUSH_TYPES.pen;
  const outline = getStroke(stroke.pts.map(p => [p.x, p.y, p.p ?? 0.5]), {
    size: stroke.size,
    thinning: bt.thinning ?? 0.55,
    smoothing: stroke.smoothing ?? bt.smoothing ?? 0.5,
    streamline: stroke.streamline ?? bt.streamline ?? 0.4,
    easing: (t) => t,
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
function drawStampStroke(ctx, stroke, tipCache) {
  const bt = BRUSH_TYPES[stroke.brush] || {};
  const tip = stroke._tip || (stroke._tip = stroke.tipImageEl || makeTipCanvas(bt.stamp === 'air' ? 'air' : 'soft', stroke.size, stroke.color));
  const gap = Math.max(1.5, stroke.size * (bt.stamp === 'air' ? 0.35 : 0.22));
  let acc = 0, prev = null;
  ctx.globalAlpha = stroke.opacity ?? bt.opacity ?? 1;
  for (const p of stroke.pts) {
    if (prev) {
      const d = Math.hypot(p.x - prev.x, p.y - prev.y);
      let t = acc;
      while (t < d) {
        const k = t / d;
        ctx.drawImage(tip, prev.x + (p.x - prev.x) * k - stroke.size / 2, prev.y + (p.y - prev.y) * k - stroke.size / 2, stroke.size, stroke.size);
        t += gap;
      }
      acc = t - d;
    }
    prev = p;
  }
  ctx.globalAlpha = 1;
}

/** 统一笔画渲染入口 */
function renderStroke(ctx, s) {
  // 擦除笔画：destination-out 把划过区域擦透明（橡皮 v34）
  if (s.erase) {
    if (!s._path) s._path = strokePath(s);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fill(s._path);
    ctx.restore();
    return;
  }
  const isStamp = (BRUSH_TYPES[s.brush]?.stamp);
  if (isStamp || s.stampMode) { drawStampStroke(ctx, s); return; }
  if (!s._path) s._path = strokePath(s);
  ctx.globalAlpha = s.opacity ?? (BRUSH_TYPES[s.brush]?.opacity ?? 1);
  ctx.fillStyle = s.color;
  ctx.fill(s._path);
  ctx.globalAlpha = 1;
}

function createDraw(container) {
  const root = document.createElement('div');
  root.className = 'draw-root';
  root.innerHTML = `
    <div class="draw-main">
      <div class="draw-canvas-wrap" tabindex="0">
        <canvas class="draw-canvas"></canvas>
        <button class="draw-collapse-ts" aria-expanded="true" title="收起/展开工具菜单">${iconHtml('‹')}</button>
        <div class="draw-tool-strip">
          <div class="draw-ts-grip" title="拖动移动工具条">${iconHtml('⠿')}</div>
          <div class="draw-palette">${PALETTE.map(c => `<i data-c="${c}" style="background:${c}" title="${c}"></i>`).join('')}</div>
          <div class="draw-tool-row1"></div>
          <div class="draw-tool-row2">
            <input type="color" class="draw-color" value="#1a1a1a" title="颜色" />
            <label title="粗细">⌀<input type="range" class="draw-size" min="1" max="80" value="6" /><span class="draw-size-v">6</span></label>
            <label title="不透明度">◐<input type="range" class="draw-opacity" min="10" max="100" value="100" /><span class="draw-opacity-v">100%</span></label>
            <label title="平滑">〜<input type="range" class="draw-smooth" min="0" max="90" value="50" /></label>
            <button data-a="save-brush" title="把当前参数保存为自定义笔刷">存笔刷</button>
            <button data-a="import-abr" title="导入 Photoshop 笔刷（.abr）">ABR</button>
            <button data-a="more" title="更多（滤镜/翻转/信息）"><span>更多</span>${iconHtml('▾')}</button>
            <select class="draw-guides" title="辅助线">
              <option value="">辅助线</option><option value="center">中线</option><option value="thirds">三分网格</option>
              <option value="p1">一点透视</option><option value="p2">二点透视</option><option value="p3">三点透视</option>
            </select>
            <label title="抖动修正（越高越稳）">稳<input type="range" class="draw-stab" min="0" max="90" value="0" /></label>
            <button data-a="record" class="draw-rec" title="录制绘制过程（mp4 存工作区）">${iconHtml('●')}<span>内录</span></button>
          </div>
        </div>
      </div>
      <div class="draw-side">
        <div class="draw-sect">图层 <button data-a="add-layer" title="新建图层">${iconHtml('＋')}</button><button class="draw-collapse-side" aria-expanded="true" title="收起/展开图层面板">${iconHtml('‹')}</button></div>
        <div class="draw-layers"></div>
        <div class="draw-sect">参考图 <button data-a="add-image" title="贴入参考图">${iconHtml('＋')}</button></div>
        <div class="draw-images"></div>
        <div class="draw-sect draw-ref-sect" style="display:none">分镜参考</div>
        <div class="draw-ref" style="display:none"></div>
      </div>
    </div>
    <div class="draw-frames">
      <label class="draw-onion"><input type="checkbox" class="onion-toggle" /> 洋葱皮</label>
      <div class="draw-frame-list"></div>
      <button data-a="add-frame" title="新建帧">${iconHtml('＋')}<span>帧</span></button>
      <button data-a="dup-frame" title="复制当前帧">${iconHtml('⧉')}</button>
      <button data-a="del-frame" title="删除当前帧" aria-label="删除当前帧">${iconHtml('✕')}</button>
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
    symmetry: 'off', // off | h | v | radial | mandala
    lasso: null,     // {pts, hits, mode}
    bornAt: Date.now(),
  };

  // 终极兜底：任何非法态（空帧/空层/越界）下 frame/activeLayer 都不许返回 undefined——
  // 否则笔迹静默落空（撤销后全工具画不出的最后一道保险）
  const frame = () => {
    if (!ctl.doc.frames?.length) ctl.doc.frames = [createFrame()];
    if (ctl.doc.current < 0 || ctl.doc.current >= ctl.doc.frames.length) ctl.doc.current = 0;
    return ctl.doc.frames[ctl.doc.current];
  };
  const activeLayer = () => {
    const f = frame();
    if (!Array.isArray(f.layers) || !f.layers.length) f.layers = [createLayer()];
    if (ctl.activeLayer < 0 || ctl.activeLayer >= f.layers.length) ctl.activeLayer = 0;
    return f.layers[ctl.activeLayer];
  };

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
    // 含擦除笔画的层：先离屏渲染本层再合成——destination-out 才不会擦穿下面图层
    if (layer.strokes.some(s => s.erase)) {
      const off = document.createElement('canvas');
      off.width = canvas.clientWidth || 800;
      off.height = canvas.clientHeight || 600;
      const octx = off.getContext('2d');
      if (layer._fillEl) octx.drawImage(layer._fillEl, 0, 0);
      for (const img of layer.images) if (img._el) octx.drawImage(img._el, img.x, img.y, img.w, img.h);
      for (const sh of layer.shapes || []) { octx.save(); paintShape(octx, sh); octx.restore(); }
      for (const s of layer.strokes) renderStroke(octx, s);
      ctx.globalAlpha = alpha * (layer.opacity ?? 1);
      ctx.drawImage(off, 0, 0);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.globalAlpha = alpha * (layer.opacity ?? 1);
    // 栅格补丁（油漆桶/液化/滤镜产物）垫底，矢量笔画/形状/图片在上
    if (layer._fillEl) ctx.drawImage(layer._fillEl, 0, 0);
    for (const img of layer.images) {
      if (img._el) ctx.drawImage(img._el, img.x, img.y, img.w, img.h);
    }
    for (const sh of layer.shapes || []) drawShape(sh);
    for (const s of layer.strokes) renderStroke(ctx, s);
    ctx.globalAlpha = 1;
  }

  /** drawShape 的目标上下文版（离屏用；与 drawShape 逻辑一致） */
  function paintShape(c, sh) {
    c.globalAlpha = sh.opacity ?? 1;
    c.strokeStyle = sh.color;
    c.fillStyle = sh.color;
    c.lineWidth = sh.lineWidth || 2;
    const [x1, y1, x2, y2] = [Math.min(sh.x1, sh.x2), Math.min(sh.y1, sh.y2), Math.max(sh.x1, sh.x2), Math.max(sh.y1, sh.y2)];
    if (sh.kind === 'rect') {
      sh.fill ? c.fillRect(x1, y1, x2 - x1, y2 - y1) : c.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (sh.kind === 'ellipse') {
      c.beginPath();
      c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2, 0, 0, Math.PI * 2);
      sh.fill ? c.fill() : c.stroke();
    } else if (sh.kind === 'line') {
      c.beginPath();
      c.moveTo(sh.x1, sh.y1);
      c.lineTo(sh.x2, sh.y2);
      c.stroke();
    } else if (sh.kind === 'text') {
      c.font = `${sh.bold ? '700' : '400'} ${sh.size || 18}px ${sh.family || 'sans-serif'}`;
      c.textBaseline = 'top';
      String(sh.text || '').split('\n').forEach((l, i) => c.fillText(l, sh.x1, sh.y1 + i * (sh.size || 18) * 1.3));
    }
    c.globalAlpha = 1;
  }

  /** 形状渲染：矩形/椭圆/直线/文字 */
  function drawShape(sh) {
    ctx.save();
    ctx.globalAlpha = sh.opacity ?? 1;
    ctx.strokeStyle = sh.color;
    ctx.fillStyle = sh.color;
    ctx.lineWidth = sh.lineWidth || 2;
    const [x1, y1, x2, y2] = [Math.min(sh.x1, sh.x2), Math.min(sh.y1, sh.y2), Math.max(sh.x1, sh.x2), Math.max(sh.y1, sh.y2)];
    if (sh.kind === 'rect') {
      sh.fill ? ctx.fillRect(x1, y1, x2 - x1, y2 - y1) : ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (sh.kind === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2, 0, 0, Math.PI * 2);
      sh.fill ? ctx.fill() : ctx.stroke();
    } else if (sh.kind === 'line') {
      ctx.beginPath();
      ctx.moveTo(sh.x1, sh.y1);
      ctx.lineTo(sh.x2, sh.y2);
      ctx.stroke();
    } else if (sh.kind === 'text') {
      ctx.font = `${sh.bold ? '700' : '400'} ${sh.size || 18}px ${sh.family || 'sans-serif'}`;
      ctx.textBaseline = 'top';
      const lines = String(sh.text || '').split('\n');
      lines.forEach((l, i) => ctx.fillText(l, sh.x1, sh.y1 + i * (sh.size || 18) * 1.3));
    }
    ctx.restore();
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
    // 辅助线（中线/三分/透视，不参与内容）
    if (ctl.guides?.size) renderGuides();

    // 进行中的笔画
    if (ctl.drawing) {
      if (ctl.drawing.erasing) {
        // 擦除轨迹预览：半透明白边圈（真擦效果提交后呈现）
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = Math.max(2, ctl.size * 0.5);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        ctl.drawing.pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.stroke();
        ctx.restore();
      } else {
        renderStroke(ctx, { pts: ctl.drawing.pts, size: ctl.size, color: ctl.color, brush: ctl.brush?.type || 'pen', opacity: ctl.brush?.opacity });
      }
    }
    // 形状预览
    if (ctl.shapeDrag) {
      drawShape({ ...ctl.shapeDrag, color: ctl.color, fill: false, lineWidth: 2, opacity: 0.7 });
    }
    // 套索路径预览
    if (ctl.lasso) {
      ctx.save();
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctl.lasso.pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      if (ctl.lasso.hits) ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // ==================== 油漆桶 / 吸管 / 套索 / 滤镜 ====================
  /** 栅格化当前图层 */
  function rasterizeLayer(layer) {
    const c = document.createElement('canvas');
    c.width = canvas.clientWidth || 800;
    c.height = canvas.clientHeight || 600;
    const cctx = c.getContext('2d');
    // 透明底（白底会把下层整个盖住）+ 先画上次补丁（否则上次液化/填充成果丢失）
    const old = ctx;
    // 临时借位：用独立上下文重画该层
    ctx = cctx;
    ctx.save();
    if (layer._fillEl) ctx.drawImage(layer._fillEl, 0, 0);
    for (const img of layer.images) if (img._el) ctx.drawImage(img._el, img.x, img.y, img.w, img.h);
    for (const sh of layer.shapes || []) drawShape(sh);
    for (const s of layer.strokes) renderStroke(ctx, s);
    ctx.restore();
    ctx = old;
    return c;
  }

  /** 油漆桶：扫描线洪水填充（容差 32） */
  function floodFill(layer, pt, color) {
    const raster = rasterizeLayer(layer);
    const cctx = raster.getContext('2d');
    const W = raster.width, H = raster.height;
    const img = cctx.getImageData(0, 0, W, H);
    const px = Math.floor(pt.x), py = Math.floor(pt.y);
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    const i0 = (py * W + px) * 4;
    const target = [img.data[i0], img.data[i0 + 1], img.data[i0 + 2]];
    const rgb = /^#?([0-9a-f]{6})$/i.exec(color);
    if (!rgb) return;
    const fill = [parseInt(rgb[1].slice(0, 2), 16), parseInt(rgb[1].slice(2, 4), 16), parseInt(rgb[1].slice(4, 6), 16)];
    if (target.join() === fill.join()) return;
    const match = (i) => Math.abs(img.data[i] - target[0]) <= 32 && Math.abs(img.data[i + 1] - target[1]) <= 32 && Math.abs(img.data[i + 2] - target[2]) <= 32;
    const stack = [[px, py]];
    const seen = new Uint8Array(W * H);
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= W || y < 0 || y >= H || seen[y * W + x]) continue;
      const i = (y * W + x) * 4;
      if (!match(i)) continue;
      seen[y * W + x] = 1;
      img.data[i] = fill[0]; img.data[i + 1] = fill[1]; img.data[i + 2] = fill[2]; img.data[i + 3] = 255;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    cctx.putImageData(img, 0, 0);
    // 填充结果作为该层的栅格补丁（叠加在矢量层下方）
    snapshot();
    layer.fillPatch = raster.toDataURL('image/png');
    const el = new Image();
    el.onload = () => { layer._fillEl = el; redraw(); };
    el.src = layer.fillPatch;
    redraw(); changed();
    toast('已填充');
  }

  /** 液化（推抹像素）：拖拽把图像向拖动方向推移 */
  function startLiquify(layer, pt) {
    const raster = rasterizeLayer(layer);
    const session = { raster, last: pt, r: Math.max(10, ctl.size * 2.2) };
    ctl.liquify = session;
    const onMove = (e) => {
      if (!ctl.liquify) return;
      const p = toWorld(e);
      smudge(session, session.last, p);
      session.last = p;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!ctl.liquify) return;
      // 提交为图层栅格补丁（定版：液化是破坏性操作，矢量对象全部并入补丁，
      // 否则推移后的像素与原矢量笔画双重显示——v33 实测「效果与原状并存」根因）
      snapshot();
      layer.fillPatch = session.raster.toDataURL('image/png');
      layer.strokes = [];
      layer.images = [];
      layer.shapes = [];
      const el = new Image();
      el.onload = () => { layer._fillEl = el; redraw(); renderLayers(); };
      el.src = layer.fillPatch;
      ctl.liquify = null;
      redraw(); changed();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /** 单步推抹：把 last 处的圆形区域沿到 p 的方向位移 */
  function smudge(session, last, p) {
    const c = session.raster.getContext('2d');
    const r = session.r;
    const dx = p.x - last.x, dy = p.y - last.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    const steps = Math.min(40, Math.ceil(dist / (r / 2)) || 1);
    const d = r * 2;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = last.x - r + dx * (t - 1 / steps * 0.5);
      const sy = last.y - r + dy * (t - 1 / steps * 0.5);
      const tx = sx + dx / steps * 0.5;
      const ty = sy + dy / steps * 0.5;
      // 圆形蒙版内位移
      c.save();
      c.beginPath();
      c.arc(tx + r, ty + r, r, 0, Math.PI * 2);
      c.clip();
      c.drawImage(session.raster, Math.round(sx - tx), Math.round(sy - ty));
      c.restore();
    }
    // 实时预览（跟随视图平移/缩放）
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr * ctl.cam.k, 0, 0, dpr * ctl.cam.k, dpr * ctl.cam.x, dpr * ctl.cam.y);
    ctx.drawImage(session.raster, 0, 0);
    ctx.restore();
  }

  /** 辅助线渲染：水平/垂直中线、三分网格、一/二/三点透视 */
  function renderGuides() {
    const g = ctl.guides;
    const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
    ctx.save();
    ctx.lineWidth = 0.7;
    ctx.setLineDash([5, 4]);
    const line = (x1, y1, x2, y2, color) => {
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    const GREEN = 'rgba(34,197,94,.55)', BLUE = 'rgba(59,130,246,.65)', PURPLE = 'rgba(168,85,247,.6)';
    if (g.has('center')) {
      line(w / 2, 0, w / 2, h, BLUE);
      line(0, h / 2, w, h / 2, BLUE);
    }
    if (g.has('thirds')) {
      for (let i = 1; i < 3; i++) {
        line(w * i / 3, 0, w * i / 3, h, GREEN);
        line(0, h * i / 3, w, h * i / 3, GREEN);
      }
    }
    const ray = (vx, vy, color) => {
      // 灭点射线（向画布四边发散）
      const targets = [[0, 0], [w, 0], [0, h], [w, h], [w / 2, 0], [w / 2, h], [0, h / 2], [w, h / 2]];
      for (const [tx, ty] of targets) line(vx, vy, tx, ty, color);
    };
    if (g.has('p1')) ray(w / 2, h / 2, 'rgba(244,63,94,.5)');
    if (g.has('p2')) { ray(w * 0.15, h / 2, 'rgba(244,63,94,.45)'); ray(w * 0.85, h / 2, 'rgba(59,130,246,.45)'); }
    if (g.has('p3')) { ray(w / 2, -h * 0.2, PURPLE); ray(w * 0.1, h * 0.7, 'rgba(244,63,94,.4)'); ray(w * 0.9, h * 0.7, 'rgba(59,130,246,.4)'); }
    ctx.restore();
  }

  /** 吸管：取画布合成像素颜色 */
  function pickColor(pt) {
    const x = Math.floor(pt.x * (window.devicePixelRatio || 1));
    const y = Math.floor(pt.y * (window.devicePixelRatio || 1));
    try {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }

  /** 套索：多边形内命中笔画 */
  function finishLasso() {
    const pts = ctl.lasso.pts;
    if (pts.length < 3) { ctl.lasso = null; redraw(); return; }
    const inPoly = (x, y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if ((pts[i].y > y) !== (pts[j].y > y) && x < (pts[j].x - pts[i].x) * (y - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
      }
      return inside;
    };
    const hits = [];
    for (const layer of frame().layers) {
      for (const s of layer.strokes) {
        const cx = s.pts.reduce((a, p) => a + p.x, 0) / s.pts.length;
        const cy = s.pts.reduce((a, p) => a + p.y, 0) / s.pts.length;
        if (inPoly(cx, cy)) hits.push({ kind: 'stroke', layer, stroke: s });
      }
      for (const sh of layer.shapes || []) {
        const b = shapeBBox(sh);
        if (inPoly(b.x + b.w / 2, b.y + b.h / 2)) hits.push({ kind: 'shape', layer, shape: sh });
      }
      for (const im of layer.images) {
        if (inPoly(im.x + im.w / 2, im.y + im.h / 2)) hits.push({ kind: 'image', layer, image: im });
      }
    }
    ctl.lasso.hits = hits;
    toast(`套住 ${hits.length} 项——底部选择：复制 / 剪切 / 反选 / 取消`);
    redraw();
    renderLassoBar();
  }

  function renderLassoBar() {
    root.querySelector('.lasso-bar')?.remove();
    if (!ctl.lasso?.hits) return;
    const bar = document.createElement('div');
    bar.className = 'lasso-bar';
    bar.style.cssText = 'position:absolute;bottom:56px;left:50%;transform:translateX(-50%);display:flex;gap:8px;background:var(--bg-elev,#fff);border:1px solid var(--bd,#e0ded8);border-radius:9px;padding:6px 12px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:20;font-size:12.5px';
    bar.innerHTML = `
      <button data-l="copy">复制 ${ctl.lasso.hits.length} 项</button>
      <button data-l="cut">剪切</button>
      <button data-l="invert">反选</button>
      <button data-l="cancel">取消</button>`;
    bar.querySelectorAll('button').forEach(b => {
      b.style.cssText = 'border:1px solid var(--bd,#e0ded8);background:none;border-radius:6px;padding:4px 10px;cursor:pointer;color:inherit';
      b.addEventListener('click', () => lassoAction(b.dataset.l));
    });
    wrap.appendChild(bar);
  }

  function lassoAction(act) {
    const hits = ctl.lasso?.hits;
    if (!hits) return;
    if (act === 'copy') {
      snapshot();
      for (const h of hits) {
        if (h.kind === 'shape') {
          const copy = JSON.parse(JSON.stringify(h.shape));
          copy.x1 += 16; copy.x2 += 16; copy.y1 += 16; copy.y2 += 16;
          (h.layer.shapes = h.layer.shapes || []).push(copy);
        } else if (h.kind === 'image') {
          const copy = { ...h.image, x: h.image.x + 16, y: h.image.y + 16, _el: h.image._el };
          h.layer.images.push(copy);
        } else {
          const copy = JSON.parse(JSON.stringify(h.stroke));
          copy.pts = copy.pts.map(p => ({ ...p, x: p.x + 16, y: p.y + 16 }));
          copy._path = null;
          h.layer.strokes.push(copy);
        }
      }
      toast('已复制');
    } else if (act === 'cut') {
      snapshot();
      for (const h of hits) {
        if (h.kind === 'shape') { const i = h.layer.shapes.indexOf(h.shape); if (i >= 0) h.layer.shapes.splice(i, 1); }
        else if (h.kind === 'image') { const i = h.layer.images.indexOf(h.image); if (i >= 0) h.layer.images.splice(i, 1); }
        else { const i = h.layer.strokes.indexOf(h.stroke); if (i >= 0) h.layer.strokes.splice(i, 1); }
      }
      toast('已剪切');
    } else if (act === 'invert') {
      const all = [];
      for (const layer of frame().layers) {
        for (const s of layer.strokes) all.push({ kind: 'stroke', layer, stroke: s });
        for (const sh of layer.shapes || []) all.push({ kind: 'shape', layer, shape: sh });
        for (const im of layer.images) all.push({ kind: 'image', layer, image: im });
      }
      const key = (h) => h.stroke || h.shape || h.image;
      ctl.lasso.hits = all.filter(h => !hits.some(x => key(x) === key(h)));
      renderLassoBar();
      redraw();
      return;
    }
    ctl.lasso = null;
    root.querySelector('.lasso-bar')?.remove();
    redraw(); changed();
  }

  /** 滤镜：黑白 / 反相 / 模糊（作用于当前图层栅格补丁） */
  function applyFilter(kind) {
    const layer = activeLayer();
    const raster = layer.fillPatch ? null : rasterizeLayer(layer);
    const src = raster || (() => { const c = document.createElement('canvas'); c.width = canvas.clientWidth || 800; c.height = canvas.clientHeight || 600; const x = c.getContext('2d'); if (layer._fillEl) x.drawImage(layer._fillEl, 0, 0); else { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); } return c; })();
    const cctx = src.getContext('2d');
    const img = cctx.getImageData(0, 0, src.width, src.height);
    const d = img.data;
    if (kind === 'gray') {
      for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = g; }
    } else if (kind === 'invert') {
      for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
    } else if (kind === 'blur') {
      const c2 = document.createElement('canvas');
      c2.width = src.width; c2.height = src.height;
      const x2 = c2.getContext('2d');
      x2.filter = 'blur(3px)';
      x2.drawImage(src, 0, 0);
      snapshot();
      layer.fillPatch = c2.toDataURL('image/png');
      const el = new Image();
      el.onload = () => { layer._fillEl = el; redraw(); };
      el.src = layer.fillPatch;
      redraw(); changed();
      toast('已模糊');
      return;
    }
    cctx.putImageData(img, 0, 0);
    snapshot();
    layer.fillPatch = src.toDataURL('image/png');
    const el = new Image();
    el.onload = () => { layer._fillEl = el; redraw(); };
    el.src = layer.fillPatch;
    redraw(); changed();
    toast(kind === 'gray' ? '已转黑白' : '已反相');
  }

  /** 画布翻转（水平/垂直镜像全部内容） */
  function flipCanvas(horizontal) {
    snapshot();
    const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
    for (const layer of frame().layers) {
      for (const s of layer.strokes) {
        s.pts = s.pts.map(p => horizontal ? { ...p, x: w - p.x } : { ...p, y: h - p.y });
        s._path = null;
      }
      for (const img of layer.images) {
        if (horizontal) img.x = w - img.x - img.w;
        else img.y = h - img.y - img.h;
        img._flipH = horizontal ? !img._flipH : img._flipH;
        img._flipV = horizontal ? img._flipV : !img._flipV;
      }
      for (const sh of layer.shapes || []) {
        if (horizontal) { const t = sh.x1; sh.x1 = w - sh.x2; sh.x2 = w - t; }
        else { const t = sh.y1; sh.y1 = h - sh.y2; sh.y2 = h - t; }
      }
      if (layer._fillEl) { layer._fillEl = null; layer.fillPatch = null; }
    }
    redraw(); changed();
    toast(horizontal ? '已水平翻转' : '已垂直翻转');
  }

  /** 画布信息（尺寸/笔画/耗时） */
  function canvasInfo() {
    let strokes = 0;
    for (const f of ctl.doc.frames) for (const l of f.layers) strokes += l.strokes.length;
    const mins = Math.max(1, Math.round((Date.now() - ctl.bornAt) / 60000));
    const w = canvas.clientWidth || 0, h = canvas.clientHeight || 0;
    toast(`画布 ${w}×${h}px · 共 ${ctl.doc.frames.length} 帧 ${strokes} 笔 · 作画约 ${mins} 分钟`, [], 5000);
  }

  // ==================== 形状/图片命中（橡皮/选择/套索与笔画同权） ====================
  function shapeBBox(sh) {
    if (sh.kind === 'text') {
      const lines = String(sh.text || '').split('\n');
      const w = Math.max(30, ...lines.map(l => l.length)) * (sh.size || 18) * 0.62;
      const h = lines.length * (sh.size || 18) * 1.35;
      return { x: sh.x1, y: sh.y1, w, h };
    }
    return {
      x: Math.min(sh.x1, sh.x2), y: Math.min(sh.y1, sh.y2),
      w: Math.abs(sh.x2 - sh.x1), h: Math.abs(sh.y2 - sh.y1),
    };
  }
  function hitShape(layer, x, y, tol = 5) {
    const shapes = layer.shapes || [];
    for (let i = shapes.length - 1; i >= 0; i--) {
      const b = shapeBBox(shapes[i]);
      if (x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol) return shapes[i];
    }
    return null;
  }
  function hitImage(layer, x, y) {
    return [...layer.images].reverse().find(im => x >= im.x && x <= im.x + im.w && y >= im.y && y <= im.y + im.h) || null;
  }
  function moveShape(sh, dx, dy) { sh.x1 += dx; sh.x2 += dx; sh.y1 += dy; sh.y2 += dy; }
  /** 当前活动层最上层内容（图片 > 形状 > 笔画） */
  function hitAnything(x, y) {
    const layer = activeLayer();
    const im = hitImage(layer, x, y);
    if (im) return { kind: 'image', image: im, layer };
    const sh = hitShape(layer, x, y);
    if (sh) return { kind: 'shape', shape: sh, layer };
    const hit = hitAnyStroke(frame(), x, y, 4 / ctl.cam.k);
    if (hit) return { kind: 'stroke', stroke: hit.stroke, layer: hit.layer };
    return null;
  }

  // ==================== 坐标 ====================
  function toWorld(e) {
    const rect = canvas.getBoundingClientRect();
    // pane-zoom/CSS zoom 下 rect 是缩放后视觉尺寸，canvas 是未缩放布局尺寸——先除回缩放比，否则笔迹比例漂移
    const dpr = window.devicePixelRatio || 1;
    const sx = rect.width ? (canvas.width / dpr) / rect.width : 1;
    const sy = rect.height ? (canvas.height / dpr) / rect.height : 1;
    const lx = (e.clientX - rect.left) * sx;
    const ly = (e.clientY - rect.top) * sy;
    const raw = {
      x: (lx - ctl.cam.x) / ctl.cam.k,
      y: (ly - ctl.cam.y) / ctl.cam.k,
      p: e.pressure || 0.5,
    };
    // 抖动修正：与上一点做指数平滑
    const stab = ctl.stabilize || 0;
    if (stab > 0 && ctl._lastPt && ctl.drawing) {
      return {
        x: ctl._lastPt.x + (raw.x - ctl._lastPt.x) * (1 - stab),
        y: ctl._lastPt.y + (raw.y - ctl._lastPt.y) * (1 - stab),
        p: raw.p,
      };
    }
    return raw;
  }

  // ==================== 对称镜像 ====================
  /** 按对称模式生成镜像点列（h 水平 / v 垂直 / radial 径向两段 / mandala 曼陀罗六段） */
  function mirrorPts(pts) {
    if (ctl.symmetry === 'off' || !ctl.symmetry) return [];
    const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
    const cx = w / 2, cy = h / 2;
    const out = [];
    const flipX = (p) => ({ x: w - p.x, y: p.y, p: p.p });
    const flipY = (p) => ({ x: p.x, y: h - p.y, p: p.p });
    const rot = (p, n, total) => {
      const ang = (Math.PI * 2 * n) / total;
      const dx = p.x - cx, dy = p.y - cy;
      const c = Math.cos(ang), s = Math.sin(ang);
      return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c, p: p.p };
    };
    if (ctl.symmetry === 'h') out.push(pts.map(flipX));
    else if (ctl.symmetry === 'v') out.push(pts.map(flipY));
    else if (ctl.symmetry === 'radial') {
      out.push(pts.map(flipX), pts.map(flipY), pts.map(p => flipY(flipX(p))));
    } else if (ctl.symmetry === 'mandala') {
      for (let i = 1; i < 6; i++) out.push(pts.map(p => rot(p, i, 6)));
    }
    return out;
  }

  // ==================== 面板折叠 ====================
  const tsBtn = root.querySelector('.draw-collapse-ts');
  const strip = root.querySelector('.draw-tool-strip');
  tsBtn.addEventListener('click', () => {
    const collapsed = strip.classList.toggle('collapsed');
    tsBtn.innerHTML = iconHtml(collapsed ? '›' : '‹');
    tsBtn.setAttribute('aria-expanded', String(!collapsed));
  });
  // 工具条拖拽移动（握住 ⠿ 手柄拖到任意位置，位置随会话保留）
  const grip = root.querySelector('.draw-ts-grip');
  if (ctl.tsPos) Object.assign(strip.style, { left: ctl.tsPos.x + 'px', top: ctl.tsPos.y + 'px', bottom: 'auto', transform: 'none' });
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const wrapR = root.querySelector('.draw-canvas-wrap').getBoundingClientRect();
    const stripR = strip.getBoundingClientRect();
    const ox = e.clientX - stripR.left, oy = e.clientY - stripR.top;
    const move = (ev) => {
      const x = Math.max(0, Math.min(ev.clientX - wrapR.left - ox, wrapR.width - stripR.width));
      const y = Math.max(0, Math.min(ev.clientY - wrapR.top - oy, wrapR.height - 30));
      Object.assign(strip.style, { left: x + 'px', top: y + 'px', bottom: 'auto', transform: 'none' });
      ctl.tsPos = { x, y };
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  const sideBtn = root.querySelector('.draw-collapse-side');
  const side = root.querySelector('.draw-side');
  sideBtn.addEventListener('click', () => {
    const collapsed = side.classList.toggle('collapsed');
    sideBtn.innerHTML = iconHtml(collapsed ? '›' : '‹');
    sideBtn.setAttribute('aria-expanded', String(!collapsed));
    resize();
  });

  // ==================== 历史 ====================
  const docJson = () => JSON.stringify({ frames: ctl.doc.frames, current: ctl.doc.current });
  function snapshot() { ctl.history.push(docJson()); }
  function restore(json) {
    const obj = JSON.parse(json);
    ctl.doc.frames = Array.isArray(obj.frames) ? obj.frames : [];
    // 非法态自愈①：快照 frames 为空（异常快照/老版本快照）——重建默认帧，否则 frame()=undefined 全工具画不出
    if (!ctl.doc.frames.length) ctl.doc.frames = [createFrame()];
    ctl.doc.current = Math.max(0, Math.min(obj.current || 0, ctl.doc.frames.length - 1));
    // 非法态自愈②：当前帧 layers 为空——重建默认层，否则 activeLayer()=undefined 笔迹无处落
    for (const f of ctl.doc.frames) { if (!Array.isArray(f.layers) || !f.layers.length) f.layers = [createLayer()]; }
    // 缓存失效重算（全字段防御：老快照 strokes/images/shapes 可能缺字段，裸遍历 TypeError 中断恢复=doc 半恢复画不出）
    for (const f of ctl.doc.frames) for (const l of f.layers) for (const s of (l.strokes || [])) s._path = null;
    for (const f of ctl.doc.frames) for (const l of f.layers) for (const im of (l.images || [])) loadImageEl(im);
    // 栅格补丁重建（撤销/重做跨快照后 _fillEl 不重建，液化/填充成果会像丢了一样——v33「变纸色」根因）
    for (const f of ctl.doc.frames) for (const l of f.layers) {
      if (l.fillPatch) {
        const el = new Image();
        el.onload = () => { l._fillEl = el; redraw(); };
        el.src = l.fillPatch;
      } else l._fillEl = null;
    }
    ctl.selected = null;
    ctl.activeLayer = Math.max(0, Math.min(ctl.activeLayer, frame().layers.length - 1));
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
    try { canvas.setPointerCapture?.(e.pointerId); } catch {} // 某些环境指针已失效，不影响绘制
    const pt = toWorld(e);
    if (ctl.tool === 'pen') {
      ctl.drawing = { pts: [pt] };
      redraw();
    } else if (ctl.tool === 'shape-rect' || ctl.tool === 'shape-ellipse' || ctl.tool === 'shape-line') {
      ctl.shapeDrag = { kind: ctl.tool.slice(6), x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      redraw();
    } else if (ctl.tool === 'shape-text') {
      inputModal('文字内容', '').then(v => {
        if (v != null && v !== '') {
          snapshot();
          activeLayer().shapes = activeLayer().shapes || [];
          activeLayer().shapes.push({ kind: 'text', x1: pt.x, y1: pt.y, text: v, color: ctl.color, size: 18 });
          redraw(); changed();
        }
        setTool('pen');
      });
    } else if (ctl.tool === 'liquify') {
      startLiquify(activeLayer(), pt);
    } else if (ctl.tool === 'bucket') {
      floodFill(activeLayer(), pt, ctl.color);
    } else if (ctl.tool === 'picker') {
      const c = pickColor(pt);
      if (c) {
        ctl.color = c;
        root.querySelector('.draw-color').value = c;
        toast('已取色 ' + c);
      }
      setTool('pen');
    } else if (ctl.tool === 'lasso') {
      ctl.lasso = { pts: [pt], hits: null, mode: null };
      redraw();
    } else if (ctl.tool === 'eraser') {
      // 擦除笔：拖过才擦（destination-out 笔画），粗细随画笔设置；点按删除整笔的逻辑移到「选择+Delete」
      snapshot(); // 整段擦除只记一次撤销
      ctl.drawing = { pts: [pt], erasing: true };
      redraw();
    } else if (ctl.tool === 'select') {
      // 图片 > 形状 > 笔画，命中即选中可拖动
      const hit = hitAnything(pt.x, pt.y);
      if (hit) {
        ctl.selected = hit;
        if (hit.kind === 'image') dragImage = { img: hit.image, ox: pt.x - hit.image.x, oy: pt.y - hit.image.y };
        else if (hit.kind === 'shape') dragImage = { shape: hit.shape, ox: pt.x, oy: pt.y };
        else dragImage = { stroke: hit.stroke, ox: pt.x, oy: pt.y };
        snapshot();
      } else ctl.selected = null;
      redraw();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const pt = toWorld(e);
    ctl._lastPt = pt;
    if (ctl.shapeDrag) {
      ctl.shapeDrag.x2 = pt.x;
      ctl.shapeDrag.y2 = pt.y;
      redraw();
    } else if (ctl.lasso && !ctl.lasso.hits) {
      ctl.lasso.pts.push(pt);
      redraw();
    } else if (ctl.drawing) {
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
    } else if (dragImage?.shape) {
      moveShape(dragImage.shape, pt.x - dragImage.ox, pt.y - dragImage.oy);
      dragImage.ox = pt.x; dragImage.oy = pt.y;
      redraw();
    } else if (dragImage?.stroke) {
      moveStroke(dragImage.stroke, pt.x - dragImage.ox, pt.y - dragImage.oy);
      dragImage.ox = pt.x; dragImage.oy = pt.y;
      dragImage.stroke._path = null;
      redraw();
    }
  });
  canvas.addEventListener('pointerup', () => {
    if (ctl.shapeDrag) {
      const d = ctl.shapeDrag;
      ctl.shapeDrag = null;
      if (Math.abs(d.x2 - d.x1) + Math.abs(d.y2 - d.y1) > 4 || d.kind === 'line') {
        snapshot();
        activeLayer().shapes = activeLayer().shapes || [];
        activeLayer().shapes.push({ ...d, color: ctl.color, fill: false, lineWidth: ctl.size > 2 ? ctl.size / 2 : 2 });
        redraw(); changed();
      } else redraw();
      return;
    }
    if (ctl.lasso && !ctl.lasso.hits) {
      // 套索闭合 → 命中检测
      finishLasso();
      return;
    }
    if (ctl.drawing) {
      const pts = ctl.drawing.pts;
      const wasErasing = ctl.drawing.erasing;
      ctl.drawing = null;
      if (wasErasing) {
        if (pts.length >= 2) {
          const stroke = createStroke(pts, '#000', ctl.size);
          stroke.erase = true;
          activeLayer().strokes.push(stroke);
          redraw(); renderLayers(); changed();
        } else redraw();
        return;
      }
      if (pts.length >= 2) {
        snapshot();
        const stroke = createStroke(pts, ctl.color, ctl.size);
        // 记录笔刷指纹（类型/参数），保证后续渲染一致
        if (ctl.brush) {
          stroke.brush = ctl.brush.type;
          stroke.opacity = ctl.brush.opacity;
          stroke.smoothing = ctl.brush.smoothing;
          stroke.streamline = ctl.brush.streamline;
          if (ctl.brush.tipImageEl) stroke.tipImageEl = ctl.brush.tipImageEl;
        }
        activeLayer().strokes.push(stroke);
        // 对称模式：生成镜像副本
        for (const mirror of mirrorPts(pts)) {
          const ms = createStroke(mirror, ctl.color, ctl.size);
          Object.assign(ms, { brush: stroke.brush, opacity: stroke.opacity, smoothing: stroke.smoothing, streamline: stroke.streamline });
          activeLayer().strokes.push(ms);
        }
        redraw(); renderLayers(); changed();
      } else redraw();
    }
    if (dragImage) { dragImage = null; renderLayers(); changed(); }
  });

  // 键盘：Delete 删选中 / B E V 切工具
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && ctl.selected) {
      snapshot();
      const sel = ctl.selected;
      if (sel.kind === 'image') sel.layer.images.splice(sel.layer.images.indexOf(sel.image), 1);
      else if (sel.kind === 'shape') sel.layer.shapes.splice(sel.layer.shapes.indexOf(sel.shape), 1);
      else { const i = sel.layer.strokes.indexOf(sel.stroke); if (i >= 0) sel.layer.strokes.splice(i, 1); }
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
      <div class="mazz-menu-item" data-a="onion">${ctl.onion ? iconHtml('✓') : ''}<span>洋葱皮</span></div>
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
  function refreshToolStates() {
    // 笔刷按钮：仅当前笔刷且当前为画笔工具时亮；工具按钮：按 data-t 精确亮
    root.querySelectorAll('.draw-tool-row1 [data-t]').forEach(b => {
      const isBrushBtn = !!b.dataset.id;
      b.classList.toggle('on', isBrushBtn
        ? (ctl.tool === 'pen' && b.dataset.id === ctl.brush?.id)
        : b.dataset.t === ctl.tool);
    });
  }
  function setTool(t) {
    ctl.tool = t;
    refreshToolStates();
    canvas.style.cursor = t === 'pen' ? 'crosshair' : (t === 'select' ? 'default' : 'cell');
  }
  function setBrush(b) {
    ctl.brush = b;
    ctl.size = b.size || 6;
    root.querySelector('.draw-size').value = ctl.size;
    root.querySelector('.draw-size-v').textContent = ctl.size;
    setTool('pen');
  }

  // —— 一级：笔刷类目 + 工具 ——
  const row1 = root.querySelector('.draw-tool-row1');
  function renderRow1() {
    const cats = [...ctl.brushes.filter(b => !b.custom), ...ctl.brushes.filter(b => b.custom)];
    row1.innerHTML = cats.map(b =>
      `<button data-t="${b.type}" data-id="${b.id}" title="${b.name}（${b.type}）">${iconHtml(({ pen: '✒', pencil: '✏', marker: '🖍', airbrush: '💨', watercolor: '💧', calligraphy: '🖌', soft: '☁', stamp: '🌸' })[b.type] || '🖊')}</button>`
    ).join('') + `
      <span class="sep"></span>
      <button data-t="liquify" title="液化（推抹像素）">${iconHtml('🌀')}</button>
      <button data-t="shape-rect" title="矩形">${iconHtml('▭')}</button>
      <button data-t="shape-ellipse" title="椭圆">${iconHtml('◯')}</button>
      <button data-t="shape-line" title="直线">${iconHtml('╱')}</button>
      <button data-t="shape-text" title="文字">${iconHtml('T')}</button>
      <button data-t="bucket" title="油漆桶">${iconHtml('🪣')}</button>
      <button data-t="picker" title="吸管取色">${iconHtml('💉')}</button>
      <button data-t="lasso" title="套索选择">${iconHtml('◌')}</button>
      <span class="sep"></span>
      <button data-t="eraser" title="橡皮：拖过擦除（粗细随画笔；选区删除用选择工具+Delete）（E）">${iconHtml('🧽')}</button>
      <button data-t="select" title="选择/移动整笔（V）">${iconHtml('➤')}</button>
      <span class="sep"></span>
      <select class="draw-sym" title="对称模式">
        <option value="off">对称关</option><option value="h">水平</option><option value="v">垂直</option>
        <option value="radial">径向</option><option value="mandala">曼陀罗</option>
      </select>`;
    row1.querySelectorAll('[data-t]').forEach(btn => btn.addEventListener('click', () => {
      const t = btn.dataset.t;
      if (t === 'eraser' || t === 'select') return setTool(t);
      if (t.startsWith('shape-') || t === 'bucket' || t === 'picker' || t === 'lasso' || t === 'liquify') return setTool(t);
      const b = ctl.brushes.find(x => x.id === btn.dataset.id);
      if (b) setBrush(b);
    }));
    const symSel = row1.querySelector('.draw-sym');
    if (symSel) symSel.addEventListener('change', () => {
      ctl.symmetry = symSel.value;
      toast(symSel.value === 'off' ? '对称已关' : `对称：${symSel.selectedOptions[0].text}`);
    });
  }
  ctl.brushes = [...DEFAULT_BRUSHES];
  ctl.brush = ctl.brushes[0];
  renderRow1();
  // 自定义笔刷（工作区 brushes/）
  listCustomBrushes().then(cs => { if (cs.length) { ctl.brushes.push(...cs); renderRow1(); } }).catch(() => {});

  const colorEl = root.querySelector('.draw-color');
  colorEl.addEventListener('input', () => { ctl.color = colorEl.value; setTool('pen'); });
  const sizeEl = root.querySelector('.draw-size');
  sizeEl.addEventListener('input', () => {
    ctl.size = +sizeEl.value;
    ctl.brush.size = ctl.size;
    root.querySelector('.draw-size-v').textContent = sizeEl.value;
  });
  const opEl = root.querySelector('.draw-opacity');
  opEl.addEventListener('input', () => {
    ctl.brush.opacity = +opEl.value / 100;
    root.querySelector('.draw-opacity-v').textContent = opEl.value + '%';
  });
  root.querySelector('.draw-smooth').addEventListener('input', (e) => {
    ctl.brush.smoothing = +e.target.value / 100;
    ctl.brush.streamline = +e.target.value / 100;
  });
  root.querySelector('.draw-stab').addEventListener('input', (e) => {
    ctl.stabilize = +e.target.value / 100;
  });
  // B12b 收编：辅助线选择子窗格化（select 隐藏保留作状态单源，change 联动照旧）
  import('../../lib/select-menu.js').then(({ selectProxy }) => selectProxy(root.querySelector('.draw-guides')));
  root.querySelector('.draw-guides').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) { ctl.guides = null; redraw(); return; }
    ctl.guides = ctl.guides || new Set();
    ctl.guides.has(v) ? ctl.guides.delete(v) : ctl.guides.add(v);
    e.target.value = '';
    redraw();
    toast('辅助线：' + ['center', 'thirds', 'p1', 'p2', 'p3'].filter(k => ctl.guides.has(k)).map(k => ({ center: '中线', thirds: '三分', p1: '一点', p2: '二点', p3: '三点' })[k]).join('+') || '已清空');
  });
  root.querySelector('[data-a=save-brush]').addEventListener('click', async () => {
    const name = await inputModal('自定义笔刷名', ctl.brush.name + '·改');
    if (!name?.trim()) return;
    const b = { ...ctl.brush, name: name.trim(), custom: true };
    await saveCustomBrush(b);
    b.id = 'custom:' + b.name;
    ctl.brushes.push(b);
    renderRow1();
    toast('自定义笔刷已保存到工作区 brushes/');
  });
  root.querySelector('[data-a=import-abr]').addEventListener('click', async () => {
    const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: 'Photoshop 笔刷', extensions: ['abr'] }] }).catch(() => null);
    if (!p) return;
    try {
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p });
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const tips = parseAbr(u8.buffer);
      for (const tip of tips) {
        const img = new Image();
        img.src = tip.dataUrl;
        await img.decode().catch(() => {});
        ctl.brushes.push({ id: 'abr:' + tip.name, name: tip.name + '（ABR）', type: 'stamp', size: Math.min(tip.width, 64), opacity: 1, smoothing: 0.4, streamline: 0.4, stabilize: 0, custom: true, tipImageEl: img });
      }
      renderRow1();
      toast(`已导入 ${tips.length} 个笔尖`);
    } catch (e) { toast('ABR 解析失败：' + e.message); }
  });
  // 「更多」二级菜单：滤镜 / 翻转 / 信息
  root.querySelector('[data-a=more]').addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelector('.draw-more-pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'draw-more-pop';
    pop.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-elev,#fff);border:1px solid var(--bd,#e0ded8);border-radius:9px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.14);display:flex;flex-direction:column;gap:3px;min-width:130px';
    pop.innerHTML = `
      <button data-m="gray">滤镜：黑白</button>
      <button data-m="invert">滤镜：反相</button>
      <button data-m="blur">滤镜：模糊</button>
      <button data-m="fliph">水平翻转画布</button>
      <button data-m="flipv">垂直翻转画布</button>
      <button data-m="info">画布信息</button>`;
    pop.querySelectorAll('button').forEach(b => {
      b.style.cssText = 'border:0;background:none;text-align:left;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12.5px;color:inherit';
      b.addEventListener('click', () => {
        const a = b.dataset.m;
        pop.remove();
        if (a === 'gray') applyFilter('gray');
        else if (a === 'invert') applyFilter('invert');
        else if (a === 'blur') applyFilter('blur');
        else if (a === 'fliph') flipCanvas(true);
        else if (a === 'flipv') flipCanvas(false);
        else if (a === 'info') canvasInfo();
      });
    });
    document.body.appendChild(pop);
    const r = e.target.getBoundingClientRect();
    // 下方空间不足 → 向上弹；水平/垂直都钳在窗口内（v33 溢出窗格根因）
    const ph = pop.offsetHeight || 190, pw = pop.offsetWidth || 150;
    const left = Math.max(4, Math.min(r.left, innerWidth - pw - 8));
    const top = (r.bottom + 4 + ph > innerHeight) ? Math.max(4, r.top - ph - 4) : (r.bottom + 4);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    setTimeout(() => document.addEventListener('mousedown', function close(ev) {
      if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', close); }
    }), 0);
  });

  // 过程内录（mp4 → 工作区 录制/）
  const recBtn = root.querySelector('[data-a=record]');
  recBtn.addEventListener('click', async () => {
    if (ctl.recorder) { ctl.recorder.stop(); return; }
    const { startCanvasRecorder } = await import('../../lib/recorder.js');
    const r = await startCanvasRecorder(canvas, { name: (ctl.title || '画板过程') });
    if (!r) { toast('当前环境不支持内录'); return; }
    ctl.recorder = r;
    recBtn.innerHTML = `${iconHtml('■')}<span>停止</span>`;
    recBtn.setAttribute('aria-label', '停止录制绘制过程');
    recBtn.classList.add('on');
    r.onstop = () => {
      ctl.recorder = null;
      recBtn.innerHTML = `${iconHtml('●')}<span>内录</span>`;
      recBtn.setAttribute('aria-label', '录制绘制过程');
      recBtn.classList.remove('on');
    };
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
        <button class="lv-vis" title="显隐">${iconHtml(l.visible ? '👁' : '◡')}</button>
        <span class="lv-name" title="双击重命名">${l.name}</span>
        <span class="lv-count">${l.strokes.length}</span>
        <button class="lv-del" title="删除图层" aria-label="删除图层">${iconHtml('✕')}</button>
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
      <div class="draw-img-item" data-i="${i}"><span>${iconHtml('🖼')} 图 ${i + 1}</span><button title="删除" aria-label="删除参考图">${iconHtml('✕')}</button></div>`).join('')
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
      if (layer._fillEl) c.drawImage(layer._fillEl, 0, 0);
      for (const img of layer.images) if (img._el) c.drawImage(img._el, img.x, img.y, img.w, img.h);
      for (const sh of layer.shapes || []) {
        c.save();
        c.strokeStyle = sh.color; c.fillStyle = sh.color; c.lineWidth = sh.lineWidth || 2;
        const [x1, y1, x2, y2] = [Math.min(sh.x1, sh.x2), Math.min(sh.y1, sh.y2), Math.max(sh.x1, sh.x2), Math.max(sh.y1, sh.y2)];
        if (sh.kind === 'rect') { sh.fill ? c.fillRect(x1, y1, x2 - x1, y2 - y1) : c.strokeRect(x1, y1, x2 - x1, y2 - y1); }
        else if (sh.kind === 'ellipse') { c.beginPath(); c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2, 0, 0, Math.PI * 2); sh.fill ? c.fill() : c.stroke(); }
        else if (sh.kind === 'line') { c.beginPath(); c.moveTo(sh.x1, sh.y1); c.lineTo(sh.x2, sh.y2); c.stroke(); }
        else if (sh.kind === 'text') { c.font = `${sh.bold ? '700' : '400'} ${sh.size || 18}px ${sh.family || 'sans-serif'}`; c.textBaseline = 'top'; String(sh.text || '').split('\n').forEach((l, i) => c.fillText(l, sh.x1, sh.y1 + i * (sh.size || 18) * 1.3)); }
        c.restore();
      }
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
    // 格式选单：PNG / JPG / PDF（对齐画世界导出谱系）
    const { modal: openModal } = await import('../../shell/shell.js');
    const m = openModal('导出画板');
    m.body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;min-width:240px">
        <button class="rb-btn" data-f="png" style="flex-direction:row">PNG（无损）</button>
        <button class="rb-btn" data-f="jpg" style="flex-direction:row">JPG（92% 质量，白底）</button>
        <button class="rb-btn" data-f="pdf" style="flex-direction:row">PDF（A4 整页）</button>
      </div>`;
    m.body.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', async () => {
      const fmt = b.dataset.f;
      m.close();
      await exportAs(fmt);
    }));
  };

  async function exportAs(fmt) {
    const off = renderToCanvas(frame(), 2);
    const name = ctl.title?.replace(/\.[^.]*$/, '') || '画板';
    if (fmt === 'pdf') {
      const { buildPrintDocument } = await import('../../lib/print-preview.js');
      const html = buildPrintDocument({
        title: name,
        setup: { size: 'A4', orientation: 'portrait', margins: { top: 10, right: 10, bottom: 10, left: 10 } },
        pagesHtml: [`<img src="${off.toDataURL('image/png')}" style="width:100%;display:block">`],
      });
      if (window.mazz?.isElectron) {
        const target = await window.mazz.invoke('dialog:saveFile', {
          defaultPath: name + '.pdf',
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        }).catch(() => null);
        if (!target) return;
        const p = await window.mazz.invoke('print:html', { html, setup: { size: 'A4', orientation: 'portrait' }, toPdf: true, defaultPath: target }).catch((e) => { toast('PDF 导出失败：' + e.message); return null; });
        if (p) toast(`PDF 已导出：${p.split(/[\\/]/).pop()}`);
      } else {
        const w = window.open('', '_blank');
        if (!w) return toast('弹窗被拦截');
        w.document.write(html);
        w.document.close();
        setTimeout(() => { w.focus(); w.print(); }, 400);
      }
      return;
    }
    const dataUrl = fmt === 'jpg' ? off.toDataURL('image/jpeg', 0.92) : off.toDataURL('image/png');
    const ext = fmt === 'jpg' ? 'jpg' : 'png';
    if (window.mazz?.isElectron) {
      const p = await window.mazz.invoke('dialog:saveFile', { defaultPath: name + '.' + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      if (p) { await window.mazz.invoke('fs:writeFileBase64', { path: p, base64: dataUrl.split(',')[1] }); toast(`已导出 ${ext.toUpperCase()}`); }
    } else {
      const a = document.createElement('a'); a.href = dataUrl; a.download = name + '.' + ext; a.click();
    }
  }

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

  // W94C：旧画板只在显式调用时写入结构化 Canvas Document；绘制本身不触发隐式网络/文件写入。
  ctl.canvasBinding = null;
  ctl.toCanvasDocument = ({ documentId, workspaceIdentity, title = '' } = {}) => legacyFrameToCanvasDocument(frame(), { documentId, workspaceIdentity, title });
  ctl.connectCanvasAgent = ({ workspacePath, documentId, workspaceIdentity, title = '', actor = { kind: 'human', ref: 'human:draw' } } = {}) => {
    const client = createCanvasAgentClient({ bridge: window.mazz, workspacePath });
    ctl.canvasBinding = { client, workspacePath, documentId, workspaceIdentity, title, actor, revision: 0 };
    return Object.freeze({ documentId, workspacePath });
  };
  ctl.persistCanvasDocument = async () => {
    const binding = ctl.canvasBinding;
    if (!binding) throw new Error('Canvas agent 尚未连接');
    if (!binding.revision) {
      const created = await binding.client.create({ documentId: binding.documentId, title: binding.title });
      binding.documentId = created.document.documentId;
      binding.workspaceIdentity = created.document.workspaceIdentity;
      binding.revision = created.document.revision;
    }
    const document = ctl.toCanvasDocument({ documentId: binding.documentId, workspaceIdentity: binding.workspaceIdentity, title: binding.title });
    document.revision = binding.revision;
    const operation = { schema: 'mazz.canvas-operation/v1', operationId: `canvas-op-${crypto.randomUUID()}`, documentId: binding.documentId, expectedRevision: binding.revision, actor: binding.actor, kind: 'replace-document', affectedIds: [], precondition: {}, payload: { document } };
    const result = await binding.client.apply(operation);
    binding.revision = result.document.revision;
    return result;
  };
  ctl.canvasUndo = async () => {
    const binding = ctl.canvasBinding;
    if (!binding) throw new Error('Canvas agent 尚未连接');
    const result = await binding.client.undo({ documentId: binding.documentId, expectedRevision: binding.revision, actor: binding.actor });
    binding.revision = result.document.revision;
    return result;
  };
  ctl.canvasRedo = async () => {
    const binding = ctl.canvasBinding;
    if (!binding) throw new Error('Canvas agent 尚未连接');
    const result = await binding.client.redo({ documentId: binding.documentId, expectedRevision: binding.revision, actor: binding.actor });
    binding.revision = result.document.revision;
    return result;
  };

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

  ctl._test = { mirrorPts, drawShape, flipCanvas, applyFilter };

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
      <button class="rb-btn" data-command="draw.pen"><i class="ico">${iconHtml('✏')}</i><span>画笔</span></button>
      <button class="rb-btn" data-command="draw.eraser"><i class="ico">${iconHtml('🧽')}</i><span>橡皮</span></button>
      <button class="rb-btn" data-command="draw.select"><i class="ico">${iconHtml('➤')}</i><span>选择</span></button>
    </div>
    <div class="rb-group" data-label="历史">
      <button class="rb-btn" data-command="draw.undo"><i class="ico">${iconHtml('↩')}</i><span>撤销</span></button>
      <button class="rb-btn" data-command="draw.redo"><i class="ico">${iconHtml('↪')}</i><span>重做</span></button>
    </div>
    <div class="rb-group" data-label="输出">
      <button class="rb-btn" data-command="draw.exportPNG"><i class="ico">${iconHtml('🖼')}</i><span>导出PNG</span></button>
      <button class="rb-btn" data-command="draw.exportSeq"><i class="ico">${iconHtml('🎞')}</i><span>PNG序列</span></button>
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
