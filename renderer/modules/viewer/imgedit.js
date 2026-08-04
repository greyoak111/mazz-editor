// renderer/modules/viewer/imgedit.js —— W59 查看器图片编辑模式（浏览/编辑双态）
// 参考移植：Pegasus（MIT, Pascal Institute）features/layer_history.js 快照栈模式 + image_mode.js 模式机；
// 全程 Canvas 2D（不引 Sharp——同源 mazz-res 画布零污染，像素操作全可行）
import { iconHtml } from '../../lib/svg-icons.js';
import { toast, inputModal } from '../../shell/shell.js';

// ==================== LayerHistory 移植（快照栈：FIFO 上限 + 分支截断 + 原图可回） ====================
class LayerHistory {
  constructor(maxSize = 15) { this.snaps = []; this.metas = []; this.index = -1; this.maxSize = maxSize; }
  /** 入栈（undo 中再改=截掉 redo 未来——Pegasus 同款分支截断） */
  add(snap, meta) {
    this.index++;
    if (this.snaps[this.index]) { this.snaps = this.snaps.slice(0, this.index); this.metas = this.metas.slice(0, this.index); }
    if (this.index >= this.maxSize) { this.snaps.shift(); this.metas.shift(); this.index = this.maxSize - 1; }
    this.snaps.push(snap); this.metas.push(meta);
  }
  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.snaps.length - 1; }
  undo() { if (!this.canUndo()) return null; this.index--; return this.current(); }
  redo() { if (!this.canRedo()) return null; this.index++; return this.current(); }
  current() { return this.index >= 0 && this.index < this.snaps.length ? { snap: this.snaps[this.index], meta: this.metas[this.index] } : null; }
  clear() { this.snaps = []; this.metas = []; this.index = -1; }
  getSize() { return this.snaps.length; }
  getStats() { return { size: this.getSize(), index: this.index, canUndo: this.canUndo(), canRedo: this.canRedo(), maxSize: this.maxSize }; }
}

// ==================== 模式机（Pegasus ImageMode 移植：normal/crop/draw/colorpick） ====================
const ImageMode = { NORMAL: 'normal', CROPPING: 'cropping', DRAWING: 'drawing', COLORPICKER: 'colorpicker' };

const FILTERS = [
  ['grayscale(1)', '灰度'], ['invert(1)', '反色'], ['sepia(1)', '复古'],
  ['saturate(0.4)', '低饱和'], ['brightness(1.15)', '提亮'], ['contrast(1.25)', '高对比'], ['blur(2px)', '柔焦'], ['sharpen', '锐化'],
];

export class ImageEditor {
  /**
   * @param {HTMLDivElement} host 工作区容器（viewer body）
   * @param {{path:string, imgSrc:string, natW:number, natH:number, ext:string}} opts
   */
  constructor(host, { path, imgSrc, natW, natH, ext }) {
    this.host = host;
    this.path = path;
    this.ext = (ext || 'png').toLowerCase();
    this.name = (path.split(/[\\/]/).pop() || 'image').replace(/\.[^.]+$/, '');
    this.dir = path.replace(/[\\/][^\\/]+$/, '');
    this.mode = ImageMode.NORMAL;
    this.history = new LayerHistory();
    this.color = '#e81123';
    this.brushSize = 6;
    this.dirtySinceSave = false;

    // —— 工作画布（原分辨率）+展示画布（CSS 缩放）——
    this.work = document.createElement('canvas');
    this.work.width = natW; this.work.height = natH;
    this.wctx = this.work.getContext('2d', { willReadFrequently: true });
    this.el = document.createElement('div');
    this.el.className = 'ie-root';
    this.el.innerHTML = `
      <div class="ie-bar">
        <button class="rb-btn" data-t="crop" title="裁剪选框（拖拽框选，Enter/双击应用）">${iconHtml('⬚')}<span>裁剪</span></button>
        <button class="rb-btn" data-t="grid" title="网格分割导出（R×C 切块 zip 打包）">${iconHtml('▦')}<span>网格</span></button>
        <span class="ie-sep"></span>
        <button class="rb-btn" data-t="rotl" title="逆时针 90°">${iconHtml('↩')}<span>左转</span></button>
        <button class="rb-btn" data-t="rotr" title="顺时针 90°">${iconHtml('↪')}<span>右转</span></button>
        <button class="rb-btn" data-t="fliph" title="水平镜像">${iconHtml('↔')}<span>左右</span></button>
        <button class="rb-btn" data-t="flipv" title="垂直镜像">${iconHtml('↕')}<span>上下</span></button>
        <span class="ie-sep"></span>
        <span class="ie-grp" title="滤镜">${FILTERS.map(([f, n], i) => `<button class="rb-btn ie-flt" data-f="${f}" title="滤镜：${n}">${n}</button>`).join('')}</span>
        <span class="ie-sep"></span>
        <button class="rb-btn" data-t="draw" title="绘画（复用 draw 笔画手感：圆头折线）">${iconHtml('✏')}<span>绘画</span></button>
        <input class="ie-size" type="range" min="2" max="40" value="6" title="笔刷粗细" />
        <button class="rb-btn ie-swatch" data-t="pick" title="取色（点击画面取色，写剪贴板）"><span class="ie-chip"></span><span>取色</span></button>
        <span class="ie-sep"></span>
        <button class="rb-btn" data-t="undo" title="撤销（Ctrl+Z）">${iconHtml('↩')}<span>撤销</span></button>
        <button class="rb-btn" data-t="redo" title="重做（Ctrl+Y）">${iconHtml('↪')}<span>重做</span></button>
        <span class="ie-hist"></span>
        <span style="flex:1"></span>
        <select class="ie-fmt rb-select" title="另存格式"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select>
        <button class="rb-btn" data-t="save" title="另存副本（默认不覆盖原图——同源目录自动名）">${iconHtml('💾')}<span>另存副本</span></button>
        <button class="rb-btn" data-t="exit" title="退出编辑">${iconHtml('✕')}<span>退出</span></button>
      </div>
      <div class="ie-stage"><div class="ie-viewwrap"><canvas class="ie-view"></canvas><div class="ie-crop" style="display:none"><i class="ie-ch tl"></i><i class="ie-ch tr"></i><i class="ie-ch bl"></i><i class="ie-ch br"></i></div></div></div>`;
    host.appendChild(this.el);
    this.view = this.el.querySelector('.ie-view');
    this.viewwrap = this.el.querySelector('.ie-viewwrap');
    // 59d：滚轮只走纵向——横向滚轮/触控板横滑一律压死（左右滚动拖条专用，编辑查看同规）；
    // 手动 scrollTop 取代原生：Chromium 纵向滚不动时会暗渡横向（不绑滚轮实锤平反）
    // 59e：Ctrl/⌘+滚轮=图片本体缩放（编辑栏不缩——pane-zoom 排除键已让路，此 handler 即唯一东家）
    this.userZoom = 1;
    this.stage = this.el.querySelector('.ie-stage');
    this.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation(); // 双保险：pane-zoom 让路后，任何后来者捕获相也不许抢
      if (e.ctrlKey || e.metaKey) { this._zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e); return; }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      this.stage.scrollTop += e.deltaY;
    }, { passive: false });
    // W66 裁剪自适应根治：宿主尺寸变动即重绘+选区按工作坐标重贴（漂移/不随缩放实锤）
    this._ro = new ResizeObserver(() => { this._repaint(); this._crop && this._cropRender({ x: this._crop.x0, y: this._crop.y0 }, { x: this._crop.x1, y: this._crop.y1 }); }); // 59e：a 也要 {x,y} 形——直传 _crop 是 NaNpx 死信（W66 潜伏期实锤）
    this._ro.observe(this.host);
    this.vctx = this.view.getContext('2d');
    this.cropEl = this.el.querySelector('.ie-crop');
    this.bar = this.el.querySelector('.ie-bar');
    this._loadSrc(imgSrc, natW, natH).then(() => { this._pushHist('原图'); this._repaint(); });
    this._bind();
  }

  async _loadSrc(src, w, h) {
    const img = new Image();
    img.src = src;
    await img.decode().catch(() => {});
    this.wctx.drawImage(img, 0, 0, w, h);
  }

  // ==================== 历史 ====================
  _pushHist(label) {
    this.history.add(this.work.toDataURL('image/png'), { w: this.work.width, h: this.work.height, label });
    this.dirtySinceSave = true;
    this._syncHist();
  }
  _syncHist() {
    const s = this.history.getStats();
    const el = this.el.querySelector('.ie-hist');
    if (el) el.textContent = `${s.index + 1}/${s.size}`;
    const u = this.bar.querySelector('[data-t=undo]'), r = this.bar.querySelector('[data-t=redo]');
    if (u) u.disabled = !s.canUndo;
    if (r) r.disabled = !s.canRedo;
  }
  async _restore(state) {
    if (!state) return;
    const img = new Image();
    img.src = state.snap;
    await img.decode().catch(() => {});
    this.work.width = state.meta.w; this.work.height = state.meta.h;
    this.wctx.drawImage(img, 0, 0);
    this._repaint();
    this._syncHist();
  }
  undo() { this._restore(this.history.undo()); }
  redo() { this._restore(this.history.redo()); }

  // ==================== 展示 ====================
  _repaint() {
    const w = this.work.width, h = this.work.height;
    const maxW = Math.max(320, this.host.clientWidth - 40);
    const scale = Math.min(1, maxW / w) * (this.userZoom || 1); // 59e：适配比×用户倍率（Ctrl+滚轮缩图片本体）
    this.view.width = w; this.view.height = h;
    this.view.style.width = Math.round(w * scale) + 'px';
    this.view.style.height = Math.round(h * scale) + 'px';
    this.vctx.drawImage(this.work, 0, 0);
    this._scale = scale;
  }
  /** 活比例现测（59c：记账 _scale 只服务展示——坐标/选区一律现测，全局缩放/画布缩放/任何缩放全含）
   *  r.width ÷ work.width = 最终显示比（getBoundingClientRect 把一切缩放机制都折进去了，记账必漂实锤） */
  _liveScale() {
    const r = this.view.getBoundingClientRect();
    return r.width > 0 ? r.width / this.work.width : (this._scale || 1);
  }
  /** 局部比例现测（59c 补钉：选框 style 定位走局部 CSS 像素——offsetWidth 不折全局缩放；
   *  若误用 _liveScale 折叠比，全局缩放下选框视觉再折一次 zoom 脱离指针实锤） */
  _localScale() {
    const w = this.view.offsetWidth;
    return w > 0 ? w / this.work.width : (this._scale || 1);
  }

  /** 图片本体缩放（59e：Ctrl+滚轮作用图片不作用编辑栏——指针锚点不跑，选区同步重贴） */
  _zoomBy(f, ev) {
    const old = this.userZoom || 1;
    const next = Math.min(8, Math.max(0.1, old * f));
    if (next === old) return;
    const anchor = ev ? this._toWork(ev) : null; // 缩放前指针下的图点（工作坐标）
    this.userZoom = next;
    this._repaint();
    if (this._crop) this._cropRender({ x: this._crop.x0, y: this._crop.y0 }, { x: this._crop.x1, y: this._crop.y1 });
    if (anchor) {
      const rAfter = this.view.getBoundingClientRect();
      const live = this._liveScale();
      // 图点新屏幕位与指针的差量吃进退滚，指针下图点原地不动
      this.stage.scrollLeft += (rAfter.left + anchor.x * live) - ev.clientX;
      this.stage.scrollTop += (rAfter.top + anchor.y * live) - ev.clientY;
    }
  }

  /** 展示坐标 → 工作坐标（活比例现测——全局缩放 50% 也不许漂） */
  _toWork(e) {
    const r = this.view.getBoundingClientRect();
    const live = this._liveScale();
    const x = (e.clientX - r.left) / live, y = (e.clientY - r.top) / live;
    return { x: Math.max(0, Math.min(this.work.width, x)), y: Math.max(0, Math.min(this.work.height, y)) };
  }

  // ==================== 工具 ====================
  _op(mutate, label) { mutate(); this._pushHist(label); this._repaint(); }
  _swap(fn) { // 尺寸变化类操作（旋转/裁剪）：新画布重画后接管
    const c = document.createElement('canvas');
    const { w, h } = fn(c);
    const x = c.getContext('2d');
    x.drawImage(this.work, 0, 0);
    this.work.width = w; this.work.height = h;
    this.wctx.drawImage(c, 0, 0);
  }
  rotate(dir) { this._op(() => this._swap(c => { c.width = this.work.height; c.height = this.work.width; const x = c.getContext('2d'); x.translate(dir > 0 ? c.width : 0, dir > 0 ? 0 : c.height); x.rotate(dir * Math.PI / 2); return { w: c.width, h: c.height }; }), dir > 0 ? '右转90°' : '左转90°'); }
  flip(h) { this._op(() => { const x = this.wctx; x.save(); x.scale(h ? -1 : 1, h ? 1 : -1); x.drawImage(this.work, h ? -this.work.width : 0, h ? 0 : -this.work.height); x.restore(); }, h ? '水平镜像' : '垂直镜像'); }
  filter(f) {
    this._op(() => {
      if (f === 'sharpen') {
        const d = this.wctx.getImageData(0, 0, this.work.width, this.work.height);
        const K = [0, -1, 0, -1, 5, -1, 0, -1, 0], w = this.work.width, h = this.work.height, src = d.data, out = new Uint8ClampedArray(src);
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          for (let c = 0; c < 3; c++) {
            let s = 0;
            for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) s += src[((y + ky) * w + (x + kx)) * 4 + c] * K[(ky + 1) * 3 + kx + 1];
            out[(y * w + x) * 4 + c] = s;
          }
        }
        d.data.set(out); this.wctx.putImageData(d, 0, 0);
      } else {
        const t = document.createElement('canvas');
        t.width = this.work.width; t.height = this.work.height;
        const x = t.getContext('2d');
        x.filter = f; x.drawImage(this.work, 0, 0);
        this.wctx.drawImage(t, 0, 0);
      }
    }, '滤镜:' + (FILTERS.find(x => x[0] === f)?.[1] || f));
  }

  // —— 裁剪选框 ——
  _startCrop() {
    this.mode = ImageMode.CROPPING;
    this.view.style.cursor = 'crosshair';
  }
  _cropDown(e) {
    const a = this._toWork(e);
    this._crop = { x0: a.x, y0: a.y, x1: a.x, y1: a.y, on: true };
    this._cropRender(a, a);
    const stage = this.el.querySelector('.ie-stage');
    // 59c 边缘自滚：指针逼近上下边 48px 内按近边距离变速自滚（拖拽不跟随自动上下实锤平反）
    const autoScroll = (ev) => {
      const sr = stage.getBoundingClientRect();
      const dTop = ev.clientY - sr.top, dBot = sr.bottom - ev.clientY;
      if (dTop >= 0 && dTop < 48) stage.scrollTop -= Math.ceil((48 - dTop) / 4);
      else if (dBot >= 0 && dBot < 48) stage.scrollTop += Math.ceil((48 - dBot) / 4);
    };
    const move = (ev) => { if (!this._crop?.on) return; autoScroll(ev); const b = this._toWork(ev); this._crop.x1 = b.x; this._crop.y1 = b.y; this._cropRender({ x: this._crop.x0, y: this._crop.y0 }, b); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
  /** 选区贴图（W66 结构根治：viewwrap 局部坐标；59c 局部比例现测——style 定位绝不许用折叠比，全局缩放贴手） */
  _cropRender(a, b) {
    const live = this._localScale();
    const x = Math.min(a.x, b.x) * live, y = Math.min(a.y, b.y) * live;
    const w = Math.abs(a.x - b.x) * live, h = Math.abs(a.y - b.y) * live;
    Object.assign(this.cropEl.style, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  }
  applyCrop() {
    const c = this._crop;
    this.cropEl.style.display = 'none';
    if (!c || Math.abs(c.x1 - c.x0) < 4 || Math.abs(c.y1 - c.y0) < 4) { this._crop = null; return; }
    const x = Math.round(Math.min(c.x0, c.x1)), y = Math.round(Math.min(c.y0, c.y1));
    const w = Math.round(Math.abs(c.x1 - c.x0)), h = Math.round(Math.abs(c.y1 - c.y0));
    this._op(() => this._swap(cv => { cv.width = w; cv.height = h; cv.getContext('2d').drawImage(this.work, x, y, w, h, 0, 0, w, h); return { w, h }; }), '裁剪');
    this._crop = null;
  }

  // —— 网格分割导出 ——
  async gridExport(rows, cols) {
    if (!rows || !cols) return toast('网格：行/列数无效');
    const tw = Math.floor(this.work.width / cols), th = Math.floor(this.work.height / rows);
    if (tw < 2 || th < 2) return toast('网格：图太小分不了这么多块');
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const blobToU8 = async (b) => new Uint8Array(await b.arrayBuffer());
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const t = document.createElement('canvas');
      t.width = tw; t.height = th;
      t.getContext('2d').drawImage(this.work, c * tw, r * th, tw, th, 0, 0, tw, th);
      const b = await new Promise(res => t.toBlob(res, 'image/png'));
      zip.file(`${this.name}-r${r + 1}c${c + 1}.png`, await blobToU8(b));
    }
    const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    let b64 = '';
    for (let i = 0; i < buf.length; i += 8192) b64 += String.fromCharCode(...buf.subarray(i, i + 8192));
    const out = `${this.dir}/${this.name}-网格${rows}x${cols}.zip`;
    await window.mazz.invoke('fs:writeFileBase64', { path: out, base64: btoa(b64) });
    toast(`网格分割已导出：${rows}×${cols}=${rows * cols} 块 → ${out.split(/[\\/]/).pop()}`);
  }

  // —— 绘画 ——
  _drawDown(e) {
    const a = this._toWork(e);
    const x = this.wctx;
    x.save(); x.strokeStyle = this.color; x.lineWidth = this.brushSize;
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(a.x, a.y);
    const move = (ev) => { const b = this._toWork(ev); x.lineTo(b.x, b.y); x.stroke(); this._repaint(); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); x.restore(); this._pushHist('绘画'); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // —— 取色 ——
  _pickDown(e) {
    const a = this._toWork(e);
    const d = this.wctx.getImageData(Math.round(a.x), Math.round(a.y), 1, 1).data;
    const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    this.color = hex;
    const chip = this.el.querySelector('.ie-chip');
    if (chip) chip.style.background = hex;
    window.mazz?.invoke('clipboard:write', { text: hex }).catch(() => {});
    toast(`已取色 ${hex}（已复制）`);
    this._setMode(ImageMode.NORMAL);
  }

  _setMode(m) {
    this.mode = m;
    this.view.style.cursor = m === ImageMode.CROPPING ? 'crosshair' : m === ImageMode.DRAWING ? 'crosshair' : m === ImageMode.COLORPICKER ? 'crosshair' : 'default';
    for (const [t, mm] of [['crop', ImageMode.CROPPING], ['draw', ImageMode.DRAWING], ['pick', ImageMode.COLORPICKER]]) {
      const b = this.bar.querySelector(`[data-t=${t}]`);
      if (b) b.classList.toggle('on', this.mode === mm);
    }
  }

  // ==================== 另存副本（默认不覆盖原图） ====================
  async saveCopy() {
    const fmt = this.el.querySelector('.ie-fmt').value || 'png';
    const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[fmt];
    const ext2 = { png: 'png', jpeg: 'jpg', webp: 'webp' }[fmt];
    const blob = await new Promise(res => this.work.toBlob(res, mime, 0.92));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let b64 = '';
    for (let i = 0; i < buf.length; i += 8192) b64 += String.fromCharCode(...buf.subarray(i, i + 8192));
    // 自动名：name-edit.ext / name-edit-N.ext（永不覆盖）
    let out = `${this.dir}/${this.name}-edit.${ext2}`;
    for (let i = 1; ; i++) {
      const ex = await window.mazz.invoke('fs:stat', { path: out }).catch(() => null);
      if (!ex || ex.exists === false) break; // fs:stat 缺档回 {exists:false}（真值对象——只判 !ex=死循环挂死实锤）
      out = `${this.dir}/${this.name}-edit-${i}.${ext2}`;
    }
    await window.mazz.invoke('fs:writeFileBase64', { path: out, base64: btoa(b64) });
    this.dirtySinceSave = false;
    toast(`已另存副本：${out.split(/[\\/]/).pop()}（原图未动）`);
    window.MazzShell?.fileTree?.refresh?.();
  }

  // ==================== 事件 ====================
  _bind() {
    this.bar.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      const t = b.dataset.t;
      if (t === 'crop') { this.mode === ImageMode.CROPPING ? this.applyCrop() : this._setMode(ImageMode.CROPPING); }
      else if (t === 'grid') {
        const rows = parseInt(await inputModal('网格分割：行数', '3') || '', 10);
        if (!rows || rows < 1) return;
        const cols = parseInt(await inputModal('网格分割：列数', '3') || '', 10);
        if (!cols || cols < 1) return;
        await this.gridExport(rows, cols);
      }
      else if (t === 'rotl') this.rotate(-1);
      else if (t === 'rotr') this.rotate(1);
      else if (t === 'fliph') this.flip(true);
      else if (t === 'flipv') this.flip(false);
      else if (t === 'draw') this._setMode(this.mode === ImageMode.DRAWING ? ImageMode.NORMAL : ImageMode.DRAWING);
      else if (t === 'pick') this._setMode(ImageMode.COLORPICKER);
      else if (t === 'undo') this.undo();
      else if (t === 'redo') this.redo();
      else if (t === 'save') await this.saveCopy();
      else if (t === 'exit') this.requestExit();
    });
    this.bar.querySelectorAll('.ie-flt').forEach(b => b.addEventListener('click', () => this.filter(b.dataset.f)));
    this.bar.querySelector('.ie-size').addEventListener('input', (e) => { this.brushSize = +e.target.value; });
    this.view.addEventListener('mousedown', (e) => {
      if (this.mode === ImageMode.CROPPING) this._cropDown(e);
      else if (this.mode === ImageMode.DRAWING) this._drawDown(e);
      else if (this.mode === ImageMode.COLORPICKER) this._pickDown(e);
    });
    this.view.addEventListener('dblclick', () => { if (this.mode === ImageMode.CROPPING) this.applyCrop(); });
    this._keyH = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); this.redo(); }
      if (e.key === 'Enter' && this.mode === ImageMode.CROPPING) { e.preventDefault(); this.applyCrop(); }
    };
    document.addEventListener('keydown', this._keyH);
  }

  requestExit() {
    if (this.dirtySinceSave && this.history.getSize() > 1) {
      toast('有未保存的编辑', [
        { label: '保存副本并退出', fn: async () => { await this.saveCopy(); this.destroy(); } },
        { label: '放弃退出', fn: () => this.destroy() },
      ], 8000);
      return;
    }
    this.destroy();
  }

  destroy() {
    this._ro?.disconnect();
    document.removeEventListener('keydown', this._keyH);
    this.el.remove();
    this.onDestroy?.();
  }
}
