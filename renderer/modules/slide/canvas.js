// renderer/modules/slide/canvas.js —— mazzslide v2 画布编辑层（W37：百分比坐标系+Item 渲染+交互平移）
// 渲染：Item（0–100 百分比）→像素（设计分辨率 1920×1080 逻辑面，缩放 cam.k 换算）
// 交互：cam 缩放平移 / 拖拽移动·resize（存百分比）/ 磁吸对齐线 / 选框多选 / 等距分布 / 自动避让
// ——导图画布交互全量平移（算法同，坐标换百分比：pxToPct/pctToPx 锚）
import { pctToPx, pxToPct, DESIGN } from './doc.js';
import { shapeEl } from '../mindmap/mm-shapes.js';

export const ITEM_TOOLS = [
  { id: 'text', name: '文本框', ico: 'T' },
  { id: 'image', name: '图片', ico: '🖼' },
  { id: 'shape', name: '形状', ico: '◇' },
  { id: 'table', name: '表格', ico: '▦' },
  { id: 'timer', name: '计时器', ico: '⏳' },
  { id: 'variable', name: '变量', ico: '🄵' },
];

/** 样式合成（Item.style → cssText） */
function styleCss(it, theme) {
  const s = it.style || {};
  const parts = [];
  if (s.size) parts.push(`font-size:${Math.max(8, Math.round(s.size * (it.height || 40) / 40))}px`);
  if (s.bold) parts.push('font-weight:700');
  if (s.italic) parts.push('font-style:italic');
  if (s.color) parts.push(`color:${s.color}`);
  if (s.bg) parts.push(`background:${s.bg}`);
  if (s.align) parts.push(`text-align:${s.align};justify-content:${s.align === 'center' ? 'center' : s.align === 'right' ? 'flex-end' : 'flex-start'}`);
  if (s.family) parts.push(`font-family:${s.family}`);
  if (s.radius) parts.push(`border-radius:${s.radius}px`);
  return parts.join(';');
}

/** 单 Item 渲染（g 元素，百分比→像素 outW/outH） */
export function renderItem(svgEl, it, outW, outH, theme, sel) {
  const x = pctToPx(it.left, 'x', outW, outH), y = pctToPx(it.top, 'y', outW, outH);
  const w = pctToPx(it.width, 'w', outW, outH), h = pctToPx(it.height, 'h', outW, outH);
  const g = svgEl('g', { class: 'sl-item', 'data-id': it.id, transform: `translate(${x},${y})${it.rotate ? ` rotate(${it.rotate} ${w / 2} ${h / 2})` : ''}` });
  const css = styleCss(it, theme);
  const strokeAttrs = sel ? { stroke: 'var(--acc, #4f46e5)', 'stroke-width': 1.6, 'stroke-dasharray': '5 3' } : {};
  switch (it.type) {
    case 'text': {
      const box = svgEl('rect', { width: w, height: h, fill: it.style?.bg || 'transparent', rx: it.style?.radius || 0, ...strokeAttrs });
      g.appendChild(box);
      const pad = 6;
      if (it.list?.items?.length) {
        it.list.items.forEach((li, i) => {
          const t = svgEl('text', { x: pad + 10, y: pad + 18 + i * ((it.style?.size || 22) * 1.45), 'font-size': it.style?.size || 22, fill: it.style?.color || theme?.fg || '#eee', 'font-weight': it.style?.bold ? 700 : 400, 'font-style': it.style?.italic ? 'italic' : 'normal' });
          t.textContent = `${li.icon || '•'} ${li.text || ''}`;
          g.appendChild(t);
        });
      } else {
        const lines = it.lines || [{ text: '' }];
        const totalH = lines.length * ((it.style?.size || 22) * 1.35);
        lines.forEach((ln, i) => {
          const t = svgEl('text', {
            x: it.style?.align === 'center' ? w / 2 : (it.style?.align === 'right' ? w - pad : pad),
            y: h / 2 - totalH / 2 + ((it.style?.size || 22) * 1.35) * (i + 0.5) + 4,
            'text-anchor': it.style?.align === 'center' ? 'middle' : (it.style?.align === 'right' ? 'end' : 'start'),
            'font-size': it.style?.size || 22, fill: it.style?.color || theme?.fg || '#eee',
            'font-weight': it.style?.bold ? 700 : 400, 'font-style': it.style?.italic ? 'italic' : 'normal',
          });
          t.textContent = ln.text || '';
          g.appendChild(t);
        });
      }
      break;
    }
    case 'image': {
      g.appendChild(svgEl('rect', { width: w, height: h, fill: 'rgba(255,255,255,.06)', rx: 4, ...strokeAttrs }));
      if (it.src) g.appendChild(svgEl('image', { href: it.src, x: 0, y: 0, width: w, height: h, preserveAspectRatio: it.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet' }));
      else {
        const ph = svgEl('text', { x: w / 2, y: h / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, fill: 'rgba(255,255,255,.4)' });
        ph.textContent = '🖼 图片占位';
        g.appendChild(ph);
      }
      break;
    }
    case 'shape': {
      const attrs = { fill: it.style?.bg || 'rgba(79,70,229,.25)', stroke: it.style?.stroke || 'var(--acc, #4f46e5)', 'stroke-width': 1.4, ...(sel ? strokeAttrs : {}) };
      g.appendChild(shapeEl(svgEl, it.shape || 'rect', { w, h }, attrs));
      if (it.lines?.[0]?.text) {
        const t = svgEl('text', { x: w / 2, y: h / 2 + 4, 'text-anchor': 'middle', 'font-size': it.style?.size || 16, fill: it.style?.color || theme?.fg || '#eee' });
        t.textContent = it.lines[0].text;
        g.appendChild(t);
      }
      break;
    }
    case 'table': {
      const rows = it.table?.rows || [];
      const rh = rows.length ? h / rows.length : h;
      rows.forEach((r, ri) => {
        const cols = r.cells?.length || 1;
        const cw = w / cols;
        r.cells.forEach((cell, ci) => {
          g.appendChild(svgEl('rect', { x: ci * cw, y: ri * rh, width: cw, height: rh, fill: ri === 0 && it.table?.headers !== false ? 'rgba(79,70,229,.2)' : 'rgba(255,255,255,.04)', stroke: 'rgba(255,255,255,.18)', 'stroke-width': 0.6 }));
          const t = svgEl('text', { x: ci * cw + 5, y: ri * rh + rh / 2 + 4, 'font-size': 12, fill: it.style?.color || theme?.fg || '#eee' });
          t.textContent = cell.text || '';
          g.appendChild(t);
        });
      });
      if (sel) g.appendChild(svgEl('rect', { width: w, height: h, fill: 'none', ...strokeAttrs }));
      break;
    }
    case 'ink': {
      for (const st of (it.ink?.strokes || [])) {
        if (!st.points?.length) continue;
        const pts = st.points.map(p => `${pctToPx(p.x, 'x', w, h)},${pctToPx(p.y, 'y', w, h)}`).join(' ');
        g.appendChild(svgEl('polyline', { points: pts, fill: 'none', stroke: st.color || '#eee', 'stroke-width': (st.width || 2), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      }
      if (sel) g.appendChild(svgEl('rect', { width: w, height: h, fill: 'none', ...strokeAttrs }));
      break;
    }
    case 'timer': {
      g.appendChild(svgEl('rect', { width: w, height: h, fill: 'rgba(0,0,0,.35)', rx: 8, ...strokeAttrs }));
      const t = svgEl('text', { x: w / 2, y: h / 2 + 6, 'text-anchor': 'middle', 'font-size': Math.min(40, h * 0.4), 'font-weight': 700, fill: '#fff' });
      t.textContent = it.timer?.kind === 'clock' ? '00:00' : fmtCountdown(it.timer?.target || 300);
      t.classList.add('sl-timer-text');
      g.appendChild(t);
      break;
    }
    case 'variable': {
      const t = svgEl('text', { x: 4, y: h / 2 + 5, 'font-size': it.style?.size || 18, fill: it.style?.color || theme?.fg || '#eee', opacity: 0.85 });
      t.textContent = `{${it.variable?.key || 'page'}}`;
      g.appendChild(t);
      if (sel) g.appendChild(svgEl('rect', { width: w, height: h, fill: 'none', ...strokeAttrs }));
      break;
    }
  }
  return g;
}
function fmtCountdown(s) { const m = Math.floor(s / 60), sec = s % 60; return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`; }

/** 画布整页渲染（SVG 内容：背景+全 Item） */
export function renderPageCanvas(svgEl, viewport, slide, theme, { outW = DESIGN.w, outH = DESIGN.h, selId = null } = {}) {
  viewport.innerHTML = '';
  if (slide?.bg) viewport.appendChild(svgEl('rect', { x: 0, y: 0, width: outW, height: outH, fill: slide.bg }));
  for (const it of (slide?.items || [])) viewport.appendChild(renderItem(svgEl, it, outW, outH, theme, selId === it.id));
}

/** 画布内点 → Item 命中（顶向下） */
export function hitItem(slide, px, py, outW, outH) {
  const items = slide?.items || [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const x = pctToPx(it.left, 'x', outW, outH), y = pctToPx(it.top, 'y', outW, outH);
    const w = pctToPx(it.width, 'w', outW, outH), h = pctToPx(it.height, 'h', outW, outH);
    if (px >= x && px <= x + w && py >= y && py <= y + h) return it;
  }
  return null;
}

/** 磁吸对齐（导图为母本改百分比：与其他 Item 边缘/中线吸附，阈值 6px 逻辑面） */
export function snapItem(slide, self, px, outW, outH) {
  const TH = 6;
  const sx = [], sy = [];
  for (const it of (slide?.items || [])) {
    if (it.id === self.id) continue;
    const x = pctToPx(it.left, 'x', outW, outH), y = pctToPx(it.top, 'y', outW, outH);
    const w = pctToPx(it.width, 'w', outW, outH), h = pctToPx(it.height, 'h', outW, outH);
    sx.push(x, x + w / 2, x + w);
    sy.push(y, y + h / 2, y + h);
  }
  sx.push(0, outW / 2, outW); // 画布中线/边缘
  sy.push(0, outH / 2, outH);
  const candX = [px.x, px.x + px.w / 2, px.x + px.w];
  const candY = [px.y, px.y + px.h / 2, px.y + px.h];
  const snap1 = (v, arr) => { let best = null, bd = TH; for (const c of arr) { const d = Math.abs(v - c); if (d < bd) { bd = d; best = c; } } return best; };
  let dx = 0, dy = 0, lineX = null, lineY = null;
  for (let i = 0; i < 3; i++) {
    const a = snap1(candX[i] + dx, sx);
    if (a != null && lineX == null) { lineX = a; dx = a - candX[i]; }
    const b = snap1(candY[i] + dy, sy);
    if (b != null && lineY == null) { lineY = b; dy = b - candY[i]; }
  }
  return { dx, dy, lineX, lineY };
}

/** 等距分布（选集≥3，首尾不动中间均分；boxPos 同款实位（left/top 实值）） */
export function distributeItems(slide, ids, axis) {
  const items = (slide?.items || []).filter(it => ids.has(it.id));
  if (items.length < 3) return false;
  items.sort((a, b) => (axis === 'x' ? a.left - b.left : a.top - b.top));
  const first = items[0], last = items[items.length - 1];
  if (axis === 'x') {
    const span = (last.left + last.width) - first.left;
    const gap = (span - items.reduce((s, it) => s + it.width, 0)) / (items.length - 1);
    let cur = first.left;
    for (let i = 1; i < items.length - 1; i++) { cur += items[i - 1].width + gap; items[i].left = cur; cur = items[i].left; }
  } else {
    const span = (last.top + last.height) - first.top;
    const gap = (span - items.reduce((s, it) => s + it.height, 0)) / (items.length - 1);
    let cur = first.top;
    for (let i = 1; i < items.length - 1; i++) { cur += items[i - 1].height + gap; items[i].top = cur; cur = items[i].top; }
  }
  return true;
}

/** 自动避让（拖放后防重合推挤：与兄弟 Item 重叠则推出） */
export function resolveItemOverlap(slide, self) {
  const others = (slide?.items || []).filter(it => it.id !== self.id);
  for (let iter = 0; iter < 16; iter++) {
    let moved = false;
    for (const o of others) {
      const cx1 = self.left + self.width / 2, cy1 = self.top + self.height / 2;
      const cx2 = o.left + o.width / 2, cy2 = o.top + o.height / 2;
      const ox = (self.width + o.width) / 2 + 1.5 - Math.abs(cx1 - cx2);
      const oy = (self.height + o.height) / 2 + 1.5 - Math.abs(cy1 - cy2);
      if (ox > 0 && oy > 0) {
        if (ox < oy) self.left += (cx1 >= cx2 ? ox : -ox);
        else self.top += (cy1 >= cy2 ? oy : -oy);
        moved = true;
      }
    }
    if (!moved) break;
  }
  self.left = Math.max(0, Math.min(100 - self.width, self.left));
  self.top = Math.max(0, Math.min(100 - self.height, self.top));
  return self;
}
