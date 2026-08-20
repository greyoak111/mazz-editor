// renderer/lib/annotate.js —— 全局批注层（外套）：全窗悬浮手写，与任何窗格内容完全隔离
// 圈画在顶层画布上，不写入任何文档；撤销上一笔 / 清屏 / 退出即还
import { getStroke } from 'perfect-freehand';
import { iconHtml } from './svg-icons.js';

const COLORS = ['#dc2626', '#d97706', '#2563eb', '#16a34a', '#1a1a1a'];
const PF_OPTS = { thinning: 0.55, smoothing: 0.5, streamline: 0.42, easing: (t) => t, last: true };

export class AnnotateLayer {
  constructor() {
    this.active = false;
    this.strokes = [];   // {pts, color, size}
    this.drawing = null;
    this.color = COLORS[0];
    this.size = 5;
    this.el = null;
  }

  toggle() { this.active ? this.exit() : this.enter(); }

  enter() {
    if (this.active) return;
    this.active = true;
    this.el = document.createElement('div');
    this.el.className = 'annotate-layer';
    this.el.innerHTML = `
      <canvas class="annotate-canvas"></canvas>
      <div class="annotate-bar">
        <button class="an-fold" data-a="fold" aria-expanded="true" title="折叠/展开颜色条">${iconHtml('▾')}</button>
        <span class="an-body">
          ${COLORS.map(c => `<i class="an-c${c === this.color ? ' on' : ''}" data-c="${c}" style="background:${c}"></i>`).join('')}
          <span class="an-sep"></span>
          <input class="an-size" type="range" min="2" max="16" value="${this.size}" title="粗细">
        <button class="an-btn" data-a="undo" title="撤销上一笔（Ctrl+Z）">${iconHtml('↩')} 撤销</button>
        <button class="an-btn" data-a="clear" title="清空全部批注">${iconHtml('✕')} 清屏</button>
          <button class="an-btn an-exit" data-a="exit" title="退出批注（Esc）">退出批注</button>
        </span>
      </div>`;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('.annotate-canvas');
    this.ctx = this.canvas.getContext('2d');
    // 颜色条自动停靠 Ribbon 下沿（拉开美观距离；窗口尺寸变化跟随）
    this._placeBar = () => {
      const rb = document.querySelector('.ribbon');
      const bar = this.el.querySelector('.annotate-bar');
      if (!rb || !bar) return;
      const r = rb.getBoundingClientRect();
      bar.style.top = Math.round(r.bottom + 12) + 'px';
    };
    this._placeBar();
    window.addEventListener('resize', this._placeBar);
    // 一键折叠/展开颜色条
    const foldBtn = this.el.querySelector('[data-a=fold]');
    foldBtn.addEventListener('click', () => {
      const bar = this.el.querySelector('.annotate-bar');
      const collapsed = bar.classList.toggle('collapsed');
      foldBtn.innerHTML = iconHtml(collapsed ? '▸' : '▾');
      foldBtn.setAttribute('aria-expanded', String(!collapsed));
    });
    this.resize();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(document.body);
    this.redraw();

    this.el.querySelectorAll('.an-c').forEach(el => el.addEventListener('click', () => {
      this.color = el.dataset.c;
      this.el.querySelectorAll('.an-c').forEach(x => x.classList.toggle('on', x === el));
    }));
    this.el.querySelector('.an-size').addEventListener('input', (e) => { this.size = +e.target.value; });
    this.el.querySelector('[data-a=undo]').addEventListener('click', () => this.undo());
    this.el.querySelector('[data-a=clear]').addEventListener('click', () => this.clear());
    this.el.querySelector('[data-a=exit]').addEventListener('click', () => this.exit());

    this._pd = (e) => this.pointerDown(e);
    this._pm = (e) => this.pointerMove(e);
    this._pu = () => this.pointerUp();
    this.canvas.addEventListener('pointerdown', this._pd);
    window.addEventListener('pointermove', this._pm);
    window.addEventListener('pointerup', this._pu);
    // 滚轮穿透：批注外套不拦截滚动（合成 wheel 事件不受信、不会触发原生滚动，直接驱动滚动条）
    this.canvas.addEventListener('wheel', (e) => {
      this.canvas.style.pointerEvents = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      this.canvas.style.pointerEvents = '';
      if (!under || under === this.canvas) return;
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+滚轮走窗格缩放（pane-zoom 是 JS 监听，不受信也能触发）
        under.dispatchEvent(new WheelEvent('wheel', {
          deltaY: e.deltaY, clientX: e.clientX, clientY: e.clientY,
          bubbles: true, cancelable: true, ctrlKey: true, metaKey: e.metaKey,
        }));
        return;
      }
      // 找最近的滚容器直接滚
      const unit = e.deltaMode === 1 ? 33 : 1;
      let el = under;
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight + 4) {
          const oy = getComputedStyle(el).overflowY;
          if (/(auto|scroll|overlay)/.test(oy)) {
            el.scrollTop += e.deltaY * unit;
            el.scrollLeft += e.deltaX * unit;
            return;
          }
        }
        el = el.parentElement;
      }
    }, { passive: true });
    this._kd = (e) => {
      if (e.key === 'Escape') this.exit();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); }
    };
    document.addEventListener('keydown', this._kd, true);
  }

  exit() {
    if (!this.active) return;
    this.strokes = []; // 退出自动清屏（外套即穿即脱，不留痕）
    this.active = false;
    this._ro?.disconnect();
    window.removeEventListener('resize', this._placeBar);
    document.removeEventListener('keydown', this._kd, true);
    window.removeEventListener('pointermove', this._pm);
    window.removeEventListener('pointerup', this._pu);
    this.el?.remove();
    this.el = null;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.canvas.style.width = innerWidth + 'px';
    this.canvas.style.height = innerHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  pointerDown(e) {
    if (e.button !== 0) return;
    this.drawing = { pts: [{ x: e.clientX, y: e.clientY, p: e.pressure || 0.5 }], color: this.color, size: this.size };
    this.canvas.setPointerCapture?.(e.pointerId);
    this.redraw();
  }
  pointerMove(e) {
    if (!this.drawing) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) this.drawing.pts.push({ x: ev.clientX, y: ev.clientY, p: ev.pressure || 0.5 });
    this.redraw();
  }
  pointerUp() {
    if (!this.drawing) return;
    if (this.drawing.pts.length >= 2) this.strokes.push(this.drawing);
    this.drawing = null;
    this.redraw();
  }

  undo() {
    this.strokes.pop();
    this.redraw();
  }
  clear() {
    this.strokes = [];
    this.redraw();
  }

  drawStroke(stroke) {
    const outline = getStroke(stroke.pts.map(p => [p.x, p.y, p.p ?? 0.5]), { size: stroke.size, ...PF_OPTS });
    if (!outline.length) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
    ctx.closePath();
    ctx.fillStyle = stroke.color;
    ctx.fill();
  }

  redraw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.strokes) this.drawStroke(s);
    if (this.drawing) this.drawStroke(this.drawing);
  }
}

let instance = null;
export function toggleAnnotate() {
  instance = instance || new AnnotateLayer();
  instance.toggle();
  return instance.active;
}
export function clearAnnotate() {
  instance?.clear();
}
