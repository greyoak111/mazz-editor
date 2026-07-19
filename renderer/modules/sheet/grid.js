// renderer/modules/sheet/grid.js —— 虚拟滚动网格：10 万行流畅、冻结四分屏、合并、选区、填充柄
import { numToCol } from './formula/engine.js';
import { formatValue } from './format.js';

export const DEFAULT_COL_W = 90;
export const DEFAULT_ROW_H = 24;
export const HEADER_W = 46;
export const HEADER_H = 26;

export class SheetGrid {
  constructor(container, workbook, hooks = {}) {
    this.wb = workbook;
    this.hooks = hooks; // {onEdit(cells), onSelectionChange(sel), onContextMenu(x,y)}
    this.sel = { r1: 1, c1: 1, r2: 1, c2: 1, active: { r: 1, c: 1 } };
    this.editing = null;
    this.buildDom(container);
    this.bindScroll();
    this.bindMouse();
    this.render();
  }

  get sheet() { return this.wb.sheet; }

  // ==================== DOM ====================
  buildDom(container) {
    this.root = document.createElement('div');
    this.root.className = 'sg-root';
    this.root.innerHTML = `
      <div class="sg-corner"></div>
      <div class="sg-colhead"><div class="sg-colhead-inner"></div></div>
      <div class="sg-rowhead"><div class="sg-rowhead-inner"></div></div>
      <div class="sg-scroll"><div class="sg-space"></div></div>
      <div class="sg-fzrow"><div class="sg-fzrow-inner"></div></div>
      <div class="sg-fzcol"><div class="sg-fzcol-inner"></div></div>
      <div class="sg-fzcorner"></div>
      <div class="sg-sel"></div>
      <div class="sg-active"></div>
      <div class="sg-fillhandle" title="拖动填充"></div>`;
    container.appendChild(this.root);
    this.scrollEl = this.root.querySelector('.sg-scroll');
    this.spaceEl = this.root.querySelector('.sg-space');
    this.colHeadInner = this.root.querySelector('.sg-colhead-inner');
    this.rowHeadInner = this.root.querySelector('.sg-rowhead-inner');
    this.fzRowInner = this.root.querySelector('.sg-fzrow-inner');
    this.fzColInner = this.root.querySelector('.sg-fzcol-inner');
    this.fzCorner = this.root.querySelector('.sg-fzcorner');
    this.selEl = this.root.querySelector('.sg-sel');
    this.activeEl = this.root.querySelector('.sg-active');
    this.fillEl = this.root.querySelector('.sg-fillhandle');
  }

  // ==================== 尺寸计算 ====================
  colX(c) { let x = 0; for (let i = 1; i < c; i++) x += this.sheet.colW.get(i) || DEFAULT_COL_W; return x; }
  colW(c) { return this.sheet.colW.get(c) || DEFAULT_COL_W; }
  rowY(r) { let y = 0; for (let i = 1; i < r; i++) y += this.sheet.rowVisible(i) ? (this.sheet.rowH.get(i) || DEFAULT_ROW_H) : 0; return y; }
  rowH(r) { return this.sheet.rowVisible(r) ? (this.sheet.rowH.get(r) || DEFAULT_ROW_H) : 0; }
  totalW() { return this.colX(this.sheet.maxCol + 2); }
  totalH() { return this.rowY(this.sheet.maxRow + 2); }
  fzRowH() { let h = 0; for (let r = 1; r <= this.sheet.freezeR; r++) h += this.rowH(r); return h; }
  fzColW() { let w = 0; for (let c = 1; c <= this.sheet.freezeC; c++) w += this.colW(c); return w; }

  colAt(x) { let acc = 0, c = 1; while (c <= this.sheet.maxCol + 1) { const w = this.colW(c); if (x < acc + w) return c; acc += w; c++; } return c; }
  rowAt(y) { let acc = 0, r = 1; while (r <= this.sheet.maxRow + 1) { const h = this.rowH(r); if (y < acc + h) return r; acc += h; r++; } return r; }

  // ==================== 渲染 ====================
  render() {
    const sheet = this.sheet;
    const sl = this.scrollEl.scrollLeft, st = this.scrollEl.scrollTop;
    const vw = this.scrollEl.clientWidth, vh = this.scrollEl.clientHeight;

    this.spaceEl.style.width = this.totalW() + 'px';
    this.spaceEl.style.height = this.totalH() + 'px';

    const c1 = this.colAt(sl), c2 = this.colAt(sl + vw) + 1;
    const r1 = this.rowAt(st), r2 = this.rowAt(st + vh) + 1;

    this.renderBody(r1, r2, c1, c2, sl, st);
    this.renderColHead(c1, c2, sl);
    this.renderRowHead(r1, r2, st);
    this.renderFrozen(sl, st, c1, c2, r1, r2);
    this.renderSelection(sl, st);
    this.positionChrome();
  }

  cellBox(r, c, sl, st) {
    const m = this.sheet.mergeAt(r, c);
    if (m) {
      const x = this.colX(m.c1) - sl, y = this.rowY(m.r1) - st;
      let w = 0, h = 0;
      for (let cc = m.c1; cc <= m.c2; cc++) w += this.colW(cc);
      for (let rr = m.r1; rr <= m.r2; rr++) h += this.rowH(rr);
      return { x, y, w, h, covered: !(r === m.r1 && c === m.c1) };
    }
    return { x: this.colX(c) - sl, y: this.rowY(r) - st, w: this.colW(c), h: this.rowH(r), covered: false };
  }

  makeCell(r, c, sl, st, layer) {
    const box = this.cellBox(r, c, sl, st);
    if (box.covered) return null;
    const cell = this.sheet.get(r, c);
    const el = document.createElement('div');
    el.className = 'sg-cell';
    el.dataset.r = r; el.dataset.c = c;
    el.style.cssText = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
    const v = this.sheet.computed(r, c);
    const s = cell?.s || {};
    if (v != null) {
      const txt = formatValue(v, s.fmt);
      el.textContent = txt;
      if (typeof v === 'number' || (s.fmt && s.fmt !== 'General')) el.classList.add('num');
    }
    if (cell?.f) el.classList.add('has-formula');
    if (s.bold) el.style.fontWeight = '600';
    if (s.italic) el.style.fontStyle = 'italic';
    if (s.underline) el.style.textDecoration = 'underline';
    if (s.color) el.style.color = s.color;
    if (s.fill) el.style.background = s.fill;
    if (s.align) el.style.textAlign = s.align;
    if (s.font) el.style.fontFamily = `'${s.font}', sans-serif`;
    if (s.size) el.style.fontSize = s.size + 'pt';
    if (s.valign) {
      el.style.display = 'flex';
      el.style.flexDirection = 'column';
      el.style.justifyContent = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[s.valign] || 'flex-start';
    }
    if (s.border && s.border !== 'none') {
      const bw = s.border === 'medium' ? '2px' : '1px';
      el.style.outline = `${bw} solid ${s.borderColor || 'var(--fg-dim)'}`;
      el.style.outlineOffset = `-${bw === '2px' ? 1 : 0}px`;
    }
    // 条件格式
    const cfBg = this.evalCondFormats(r, c, v);
    if (cfBg) el.style.background = cfBg;
    layer.appendChild(el);
    return el;
  }

  evalCondFormats(r, c, v) {
    if (typeof v !== 'number') return null;
    for (const cf of this.sheet.condFormats) {
      if (r < cf.r1 || r > cf.r2 || c < cf.c1 || c > cf.c2) continue;
      if (cf.type === 'gt' && v > cf.a) return 'rgba(74,222,128,.35)';
      if (cf.type === 'lt' && v < cf.a) return 'rgba(248,113,113,.35)';
      if (cf.type === 'eq' && v === cf.a) return 'rgba(251,191,36,.4)';
      if (cf.type === 'colorscale') {
        const t = (v - cf.a) / ((cf.b - cf.a) || 1);
        return `color-mix(in srgb, var(--accent) ${Math.round(Math.max(0, Math.min(1, t)) * 45)}%, transparent)`;
      }
    }
    return null;
  }

  renderBody(r1, r2, c1, c2, sl, st) {
    const layer = this.spaceEl;
    layer.querySelectorAll('.sg-cell').forEach(e => e.remove());
    const frag = document.createDocumentFragment();
    for (let r = Math.max(1, r1 - 1); r <= r2 + 1; r++) {
      if (!this.sheet.rowVisible(r)) continue;
      for (let c = Math.max(1, c1 - 1); c <= c2 + 1; c++) {
        this.makeCell(r, c, sl, st, frag);
      }
    }
    layer.appendChild(frag);
  }

  renderColHead(c1, c2, sl) {
    this.colHeadInner.innerHTML = '';
    this.colHeadInner.style.transform = `translateX(${-sl}px)`;
    const frag = document.createDocumentFragment();
    for (let c = Math.max(1, c1 - 1); c <= c2 + 1; c++) {
      const el = document.createElement('div');
      el.className = 'sg-hcell' + (this.sel.c1 <= c && c <= this.sel.c2 ? ' sel' : '');
      el.textContent = numToCol(c);
      el.style.cssText = `left:${this.colX(c)}px;width:${this.colW(c)}px`;
      el.dataset.c = c;
      frag.appendChild(el);
    }
    this.colHeadInner.appendChild(frag);
  }

  renderRowHead(r1, r2, st) {
    this.rowHeadInner.innerHTML = '';
    this.rowHeadInner.style.transform = `translateY(${-st}px)`;
    const frag = document.createDocumentFragment();
    for (let r = Math.max(1, r1 - 1); r <= r2 + 1; r++) {
      if (!this.sheet.rowVisible(r)) continue;
      const el = document.createElement('div');
      el.className = 'sg-hcell' + (this.sel.r1 <= r && r <= this.sel.r2 ? ' sel' : '');
      el.textContent = r;
      el.style.cssText = `top:${this.rowY(r)}px;height:${this.rowH(r)}px`;
      el.dataset.r = r;
      frag.appendChild(el);
    }
    this.rowHeadInner.appendChild(frag);
  }

  renderFrozen(sl, st, c1, c2, r1, r2) {
    const s = this.sheet;
    const frH = this.fzRowH(), frW = this.fzColW();
    const fzRow = this.root.querySelector('.sg-fzrow');
    const fzCol = this.root.querySelector('.sg-fzcol');
    fzRow.style.display = s.freezeR ? 'block' : 'none';
    fzCol.style.display = s.freezeC ? 'block' : 'none';
    this.fzCorner.style.display = (s.freezeR && s.freezeC) ? 'block' : 'none';
    fzRow.style.height = frH + 'px';
    fzCol.style.width = frW + 'px';
    this.fzCorner.style.width = frW + 'px';
    this.fzCorner.style.height = frH + 'px';

    if (s.freezeR) {
      this.fzRowInner.innerHTML = '';
      this.fzRowInner.style.transform = `translateX(${-sl}px)`;
      const frag = document.createDocumentFragment();
      for (let r = 1; r <= s.freezeR; r++) {
        for (let c = Math.max(1, c1 - 1); c <= c2 + 1; c++) this.makeCell(r, c, sl, 0, frag);
      }
      this.fzRowInner.appendChild(frag);
    }
    if (s.freezeC) {
      this.fzColInner.innerHTML = '';
      this.fzColInner.style.transform = `translateY(${-st}px)`;
      const frag = document.createDocumentFragment();
      for (let r = Math.max(1, r1 - 1); r <= r2 + 1; r++) {
        if (!s.rowVisible(r)) continue;
        for (let c = 1; c <= s.freezeC; c++) this.makeCell(r, c, 0, st, frag);
      }
      this.fzColInner.appendChild(frag);
    }
    if (s.freezeR && s.freezeC) {
      this.fzCorner.innerHTML = '';
      for (let r = 1; r <= s.freezeR; r++) {
        for (let c = 1; c <= s.freezeC; c++) {
          const cell = this.sheet.get(r, c);
          if (!cell) continue;
          const el = document.createElement('div');
          el.className = 'sg-cell';
          el.style.cssText = `left:${this.colX(c)}px;top:${this.rowY(r)}px;width:${this.colW(c)}px;height:${this.rowH(r)}px`;
          const v = this.sheet.computed(r, c);
          if (v != null) el.textContent = formatValue(v, cell.s?.fmt);
          this.fzCorner.appendChild(el);
        }
      }
    }
  }

  positionChrome() {
    const frH = this.fzRowH();
    this.root.querySelector('.sg-fzrow').style.left = HEADER_W + 'px';
    this.root.querySelector('.sg-fzrow').style.top = HEADER_H + 'px';
    this.root.querySelector('.sg-fzcol').style.top = (HEADER_H + frH) + 'px';
    this.fzCorner.style.left = HEADER_W + 'px';
    this.fzCorner.style.top = HEADER_H + 'px';
  }

  // ==================== 选区渲染 ====================
  renderSelection(sl, st) {
    const { r1, r2, c1, c2, active } = this.sel;
    const a = active;
    const box = this.cellBox(a.r, a.c, sl, st);
    this.activeEl.style.cssText = `display:block;left:${HEADER_W + box.x}px;top:${HEADER_H + box.y}px;width:${box.w}px;height:${box.h}px`;

    const x1 = this.colX(c1) - sl, y1 = this.rowY(r1) - st;
    let w = 0, h = 0;
    for (let c = c1; c <= c2; c++) w += this.colW(c);
    for (let r = r1; r <= r2; r++) h += this.rowH(r);
    this.selEl.style.cssText = `display:block;left:${HEADER_W + x1}px;top:${HEADER_H + y1}px;width:${w}px;height:${h}px`;
    this.fillEl.style.cssText = `display:${this.editing ? 'none' : 'block'};left:${HEADER_W + x1 + w - 4}px;top:${HEADER_H + y1 + h - 4}px`;
  }

  // ==================== 滚动 ====================
  bindScroll() {
    let raf = 0;
    this.scrollEl.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; this.render(); });
    });
  }

  // ==================== 鼠标 ====================
  bindMouse() {
    let dragging = false, filling = false;
    const cellFromEvent = (e) => {
      const t = e.target.closest('.sg-cell');
      if (!t) return null;
      return { r: +t.dataset.r, c: +t.dataset.c };
    };

    this.root.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target === this.fillEl) { filling = true; e.preventDefault(); return; }
      const hit = cellFromEvent(e);
      if (!hit) return;
      if (this.editing) this.commitEdit();
      if (e.shiftKey) {
        this.sel.r2 = hit.r; this.sel.c2 = hit.c;
      } else {
        this.sel = { r1: hit.r, c1: hit.c, r2: hit.r, c2: hit.c, active: hit };
        dragging = true;
      }
      this.normalizeSel();
      this.emitSel();
      this.render();
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging && !filling) return;
      const rect = this.scrollEl.getBoundingClientRect();
      const x = e.clientX - rect.left + this.scrollEl.scrollLeft;
      const y = e.clientY - rect.top + this.scrollEl.scrollTop;
      const r = this.rowAt(y), c = this.colAt(x);
      if (r < 1 || c < 1) return;
      this.sel.r2 = r; this.sel.c2 = c;
      this.normalizeSel();
      this.render();
    });
    window.addEventListener('mouseup', () => {
      if (filling) { this.applyFill(); }
      dragging = false; filling = false;
    });

    this.root.addEventListener('dblclick', (e) => {
      const hit = cellFromEvent(e);
      if (hit) this.startEdit(hit.r, hit.c);
    });

    this.root.addEventListener('contextmenu', (e) => {
      const hit = cellFromEvent(e);
      if (hit && !(hit.r >= this.sel.r1 && hit.r <= this.sel.r2 && hit.c >= this.sel.c1 && hit.c <= this.sel.c2)) {
        this.sel = { r1: hit.r, c1: hit.c, r2: hit.r, c2: hit.c, active: hit };
        this.normalizeSel();
        this.emitSel();
        this.render();
      }
      e.preventDefault();
      this.hooks.onContextMenu?.(e.clientX, e.clientY);
    });

    // 列头/行头选择
    this.root.querySelector('.sg-colhead').addEventListener('mousedown', (e) => {
      const t = e.target.closest('.sg-hcell');
      if (!t) return;
      const c = +t.dataset.c;
      this.sel = { r1: 1, c1: c, r2: this.sheet.maxRow, c2: c, active: { r: 1, c } };
      this.emitSel(); this.render();
      e.preventDefault();
    });
    this.root.querySelector('.sg-rowhead').addEventListener('mousedown', (e) => {
      const t = e.target.closest('.sg-hcell');
      if (!t) return;
      const r = +t.dataset.r;
      this.sel = { r1: r, c1: 1, r2: r, c2: this.sheet.maxCol, active: { r, c: 1 } };
      this.emitSel(); this.render();
      e.preventDefault();
    });
  }

  normalizeSel() {
    const s = this.sel;
    if (s.r1 > s.r2) [s.r1, s.r2] = [s.r2, s.r1];
    if (s.c1 > s.c2) [s.c1, s.c2] = [s.c2, s.c1];
  }
  emitSel() { this.hooks.onSelectionChange?.(this.sel); }

  // ==================== 编辑 ====================
  startEdit(r, c, initial = null) {
    if (this.editing) this.commitEdit();
    const cell = this.sheet.get(r, c);
    const raw = initial !== null ? initial : (cell?.f ?? cell?.v ?? '');
    const sl = this.scrollEl.scrollLeft, st = this.scrollEl.scrollTop;
    const box = this.cellBox(r, c, sl, st);
    const input = document.createElement('input');
    input.className = 'sg-editor';
    input.value = raw === null ? '' : String(raw);
    input.style.cssText = `left:${HEADER_W + box.x}px;top:${HEADER_H + box.y}px;width:${Math.max(box.w, 60)}px;height:${box.h}px`;
    this.root.appendChild(input);
    this.editing = { input, r, c };
    input.focus();
    // 光标一律置于末尾（初始字符不被后续键入替换）
    input.setSelectionRange(input.value.length, input.value.length);
    let composing = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('keydown', (e) => {
      if (composing || e.isComposing) { e.stopPropagation(); return; }
      if (e.key === 'Enter') { e.preventDefault(); this.commitEdit(); this.moveActive(1, 0, e.shiftKey); }
      else if (e.key === 'Tab') { e.preventDefault(); this.commitEdit(); this.moveActive(0, e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { this.cancelEdit(); }
      else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        // Excel 行为：方向键提交并移动（非输入法组合态时）
        e.preventDefault();
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        this.commitEdit();
        this.moveActive(d[0], d[1]);
      }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => this.commitEdit());
    this.render();
  }

  commitEdit() {
    if (!this.editing) return;
    const { input, r, c } = this.editing;
    const val = input.value;
    input.remove();
    this.editing = null;
    this.hooks.onEdit?.([[r, c, val]]);
    this.render();
  }
  cancelEdit() {
    if (!this.editing) return;
    this.editing.input.remove();
    this.editing = null;
    this.render();
  }

  moveActive(dr, dc, shift = false) {
    const a = this.sel.active;
    let nr = Math.max(1, Math.min(100000, a.r + dr));
    let nc = Math.max(1, Math.min(200, a.c + dc));
    if (shift) {
      this.sel.r2 = nr; this.sel.c2 = nc;
    } else {
      this.sel = { r1: nr, c1: nc, r2: nr, c2: nc, active: { r: nr, c: nc } };
    }
    this.normalizeSel();
    this.scrollCellIntoView(nr, nc);
    this.emitSel();
    this.render();
  }

  scrollCellIntoView(r, c) {
    const x = this.colX(c), y = this.rowY(r);
    const w = this.colW(c), h = this.rowH(r);
    const sl = this.scrollEl.scrollLeft, st = this.scrollEl.scrollTop;
    const vw = this.scrollEl.clientWidth, vh = this.scrollEl.clientHeight;
    if (x < sl) this.scrollEl.scrollLeft = x;
    else if (x + w > sl + vw) this.scrollEl.scrollLeft = x + w - vw;
    if (y < st) this.scrollEl.scrollTop = y;
    else if (y + h > st + vh) this.scrollEl.scrollTop = y + h - vh;
  }

  // ==================== 填充柄 ====================
  applyFill() {
    const { r1, r2, c1, c2, active } = this.sel;
    const a = active;
    // 源区 = 初始选区（active 锚定），目标 = 拖动后的扩区
    const edits = [];
    const srcR1 = Math.min(r1, a.r), srcR2 = Math.max(r2, a.r);
    const srcC1 = Math.min(c1, a.c), srcC2 = Math.max(c2, a.c);
    const srcH = srcR2 - srcR1 + 1, srcW = srcC2 - srcC1 + 1;
    // 纵向填充
    if (r2 > srcR2) {
      for (let r = srcR2 + 1; r <= r2; r++) {
        for (let c = srcC1; c <= srcC2; c++) {
          edits.push([r, c, this.fillValue(srcR1 + (r - srcR1) % srcH, c, Math.floor((r - srcR1) / srcH))]);
        }
      }
    }
    // 横向填充
    if (c2 > srcC2) {
      for (let c = srcC2 + 1; c <= c2; c++) {
        for (let r = srcR1; r <= srcR2; r++) {
          edits.push([r, c, this.fillValue(r, srcC1 + (c - srcC1) % srcW, Math.floor((c - srcC1) / srcW), true)]);
        }
      }
    }
    if (edits.length) this.hooks.onEdit?.(edits);
    this.render();
  }

  fillValue(sr, sc, step, horizontal = false) {
    const cell = this.sheet.get(sr, sc);
    if (!cell) return null;
    if (cell.f) {
      const { remapFormula } = this.hooks;
      return remapFormula ? remapFormula(cell.f, step, horizontal) : cell.f;
    }
    return cell.v;
  }
}
