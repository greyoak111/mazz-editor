// renderer/modules/notes/graph.js —— 笔记关系图谱：canvas 力导向布局（斥力 + 弹簧 + 中心引力）

export class GraphView {
  constructor(wrapEl, { onOpen } = {}) {
    this.wrap = wrapEl;
    this.canvas = wrapEl.querySelector('canvas');
    try { this.ctx = this.canvas.getContext('2d'); } catch { this.ctx = null; } // 无 canvas 环境降级：数据层照常，仅不绘制
    this.onOpen = onOpen;
    this.nodes = []; // {id, name, x, y, vx, vy, deg, daily, current}
    this.edges = []; // {s, t}（索引）
    this.cam = { x: 0, y: 0, k: 1 };
    this.hover = -1;
    this._bindEvents();
    this._resize();
    this._ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => { this._resize(); this.draw(); }) : null;
    this._ro?.observe(wrapEl);
  }

  setData(entries, currentPath) {
    const idx = new Map();
    this.nodes = entries.map((e, i) => {
      idx.set(e.path, i);
      return {
        id: e.path, name: e.name, deg: 0,
        daily: /每日笔记/.test(e.path),
        current: e.path === currentPath,
        x: Math.cos(i) * 120 + (Math.random() - 0.5) * 40,
        y: Math.sin(i) * 120 + (Math.random() - 0.5) * 40,
        vx: 0, vy: 0,
      };
    });
    const byName = new Map(entries.map((e, i) => [e.name.toLowerCase(), i]));
    this.edges = [];
    const seen = new Set();
    entries.forEach((e, i) => {
      for (const l of e.links) {
        const j = byName.get(l.toLowerCase());
        if (j === undefined || j === i) continue;
        const key = i < j ? i + '-' + j : j + '-' + i;
        if (seen.has(key)) continue;
        seen.add(key);
        this.edges.push({ s: i, t: j });
        this.nodes[i].deg++;
        this.nodes[j].deg++;
      }
    });
    this.layout(220);
    this.fitView();
    this.draw();
  }

  layout(steps) {
    const N = this.nodes;
    for (let iter = 0; iter < steps; iter++) {
      // 斥力
      for (let i = 0; i < N.length; i++) {
        for (let j = i + 1; j < N.length; j++) {
          const a = N[i], b = N[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
          const f = Math.min(900 / d2, 8);
          const ux = dx / Math.sqrt(d2), uy = dy / Math.sqrt(d2);
          a.vx += ux * f; a.vy += uy * f;
          b.vx -= ux * f; b.vy -= uy * f;
        }
      }
      // 弹簧
      for (const e of this.edges) {
        const a = N[e.s], b = N[e.t];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = (d - 90) * 0.02;
        const ux = dx / d, uy = dy / d;
        a.vx += ux * f; a.vy += uy * f;
        b.vx -= ux * f; b.vy -= uy * f;
      }
      // 中心引力 + 阻尼
      for (const n of N) {
        n.vx += -n.x * 0.008;
        n.vy += -n.y * 0.008;
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
      }
    }
  }

  fitView() {
    if (!this.nodes.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    const w = Math.max(maxX - minX, 60), h = Math.max(maxY - minY, 60);
    const cw = this.canvas.clientWidth || 600, ch = this.canvas.clientHeight || 400;
    this.cam.k = Math.min(cw / (w + 120), ch / (h + 120), 2);
    this.cam.x = (minX + maxX) / 2;
    this.cam.y = (minY + maxY) / 2;
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (!w || !h) return;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  toScreen(x, y) {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    return [ (x - this.cam.x) * this.cam.k + cw / 2, (y - this.cam.y) * this.cam.k + ch / 2 ];
  }
  toWorld(sx, sy) {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    return [ (sx - cw / 2) / this.cam.k + this.cam.x, (sy - ch / 2) / this.cam.k + this.cam.y ];
  }

  nodeRadius(n) { return (5 + Math.min(n.deg, 8) * 1.6) * (n.current ? 1.5 : 1); }

  hitNode(sx, sy) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const [x, y] = this.toScreen(this.nodes[i].x, this.nodes[i].y);
      const r = this.nodeRadius(this.nodes[i]) + 3;
      const dx = sx - x, dy = sy - y;
      if (dx * dx + dy * dy <= r * r) return i;
    }
    return -1;
  }

  _bindEvents() {
    let drag = null;
    this.canvas.addEventListener('mousedown', (e) => {
      drag = { sx: e.offsetX, sy: e.offsetY, cam: { ...this.cam }, moved: false };
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (drag) {
        const dx = e.offsetX - drag.sx, dy = e.offsetY - drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        this.cam.x = drag.cam.x - dx / this.cam.k;
        this.cam.y = drag.cam.y - dy / this.cam.k;
        this.draw();
      } else {
        const h = this.hitNode(e.offsetX, e.offsetY);
        if (h !== this.hover) { this.hover = h; this.canvas.style.cursor = h >= 0 ? 'pointer' : 'grab'; this.draw(); }
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (drag && !drag.moved) {
        const i = this.hitNode(e.offsetX ?? -1, e.offsetY ?? -1);
        // mouseup 在 window 上，offsetX/Y 相对目标元素——用 canvas 坐标重算
        const rect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        const j = this.hitNode(cx, cy);
        if (j >= 0) this.onOpen?.(this.nodes[j].id);
      }
      drag = null;
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [wx, wy] = this.toWorld(e.offsetX, e.offsetY);
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.cam.k = Math.min(Math.max(this.cam.k * f, 0.2), 5);
      // 以光标为锚缩放
      const [nx, ny] = this.toWorld(e.offsetX, e.offsetY);
      this.cam.x += wx - nx;
      this.cam.y += wy - ny;
      this.draw();
    }, { passive: false });
  }

  draw() {
    const { ctx } = this;
    if (!ctx) return;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (!cw || !ch) return;
    const cs = getComputedStyle(document.documentElement);
    const fg = cs.getPropertyValue('--fg').trim() || '#2c2c2a';
    const dim = cs.getPropertyValue('--fg-dim').trim() || '#a3a19a';
    const acc = cs.getPropertyValue('--acc').trim() || '#4f46e5';
    const bd = cs.getPropertyValue('--bd').trim() || '#e0ded8';
    ctx.clearRect(0, 0, cw, ch);
    // 边
    ctx.strokeStyle = bd;
    ctx.lineWidth = 1;
    for (const e of this.edges) {
      const [x1, y1] = this.toScreen(this.nodes[e.s].x, this.nodes[e.s].y);
      const [x2, y2] = this.toScreen(this.nodes[e.t].x, this.nodes[e.t].y);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // 节点
    this.nodes.forEach((n, i) => {
      const [x, y] = this.toScreen(n.x, n.y);
      const r = this.nodeRadius(n);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.current ? acc : (n.daily ? '#d97706' : (i === this.hover ? acc : '#8b8cf8'));
      ctx.globalAlpha = n.current || i === this.hover ? 1 : 0.75;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (n.current) { ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
      // 标签：当前/悬停/有度节点 或 足够放大时
      if (n.current || i === this.hover || n.deg > 0 || this.cam.k > 1.4) {
        ctx.font = '11px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = i === this.hover ? acc : (n.deg ? fg : dim);
        ctx.textAlign = 'center';
        ctx.fillText(n.name, x, y + r + 13);
      }
    });
  }

  destroy() { this._ro?.disconnect(); }
}
