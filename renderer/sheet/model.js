// renderer/modules/sheet/model.js —— 工作簿数据模型：单元格/公式重算/合并/冻结/筛选/验证/条件格式/撤销栈
import { parse, evaluate, E, isErr, numToCol } from './formula/engine.js';
import { FUNCTIONS } from './formula/functions.js';

export const MAX_ROWS = 100000;
export const MAX_COLS = 200;

export class Sheet {
  constructor(name) {
    this.name = name;
    this.cells = new Map();      // "r,c" -> {v: raw, f: formula|null, s: styleObj|null}
    this.merges = [];            // [{r1,c1,r2,c2}]
    this.colW = new Map();
    this.rowH = new Map();
    this.freezeR = 0;
    this.freezeC = 0;
    this.filter = null;          // {r1,c1,r2,c2, picks: Map<col, Set<allowedText>>}
    this.validations = new Map();// "r,c" -> {type:'list',values:[]}|{type:'number',min,max}|{type:'textlen',max}
    this.condFormats = [];       // [{r1,c1,r2,c2,type:'colorscale'|'databar'|'gt'|'lt'|'eq', a, b}]
    this._computed = new Map();  // "r,c" -> {epoch, value}
    this._epoch = 0;
    this.maxRow = 50;
    this.maxCol = 15;
  }

  key(r, c) { return r + ',' + c; }
  get(r, c) { return this.cells.get(this.key(r, c)) || null; }

  setRaw(r, c, raw, stylePatch) {
    if (r < 1 || c < 1 || r > MAX_ROWS || c > MAX_COLS) return;
    const k = this.key(r, c);
    let cell = this.cells.get(k);
    const isFormula = typeof raw === 'string' && raw.startsWith('=');
    if (raw == null || raw === '') {
      if (cell) { cell.v = null; cell.f = null; }
    } else {
      if (!cell) { cell = { v: null, f: null, s: null }; this.cells.set(k, cell); }
      if (isFormula) { cell.f = raw; cell.v = null; }
      else { cell.f = null; cell.v = this._coerce(raw); }
    }
    if (stylePatch && cell) cell.s = { ...(cell.s || {}), ...stylePatch };
    if (cell && cell.v == null && !cell.f && !cell.s) this.cells.delete(k);
    this.maxRow = Math.max(this.maxRow, r);
    this.maxCol = Math.max(this.maxCol, c);
    this._epoch++;
  }

  _coerce(raw) {
    if (typeof raw !== 'string') return raw;
    const t = raw.trim();
    if (t === '') return raw;
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n) && Math.abs(n) < 1e15) return n;
    }
    if (t.toUpperCase() === 'TRUE') return true;
    if (t.toUpperCase() === 'FALSE') return false;
    return raw;
  }

  setStyle(r, c, patch) {
    const k = this.key(r, c);
    let cell = this.cells.get(k);
    if (!cell) { cell = { v: null, f: null, s: null }; this.cells.set(k, cell); }
    cell.s = { ...(cell.s || {}), ...patch };
    this._epoch++;
  }

  /** 惰性求值（含循环引用检测） */
  computed(r, c, visiting = new Set()) {
    const cell = this.get(r, c);
    if (!cell) return null;
    if (!cell.f) return cell.v;
    const k = this.key(r, c);
    const cached = this._computed.get(k);
    if (cached && cached.epoch === this._epoch) return cached.value;
    if (visiting.has(k)) return E.CYCLE;
    visiting.add(k);
    const value = evaluate(parse(cell.f), this._ctx(r, c, visiting));
    visiting.delete(k);
    this._computed.set(k, { epoch: this._epoch, value });
    return value;
  }

  _ctx(r, c, visiting) {
    const self = this;
    const wb = this._wb;
    return {
      currentSheet: self.name,
      currentRow: r, currentCol: c,
      currentIsFormula: true,
      sheetCount: wb ? wb.sheets.length : 1,
      currentSheetIndex: wb ? wb.sheets.indexOf(self) + 1 : 1,
      functions: FUNCTIONS,
      getCell(sheetName, row, col) {
        const s = wb ? wb.sheetByName(sheetName) : self;
        if (!s) return E.REF;
        return s.computed(row, col, visiting);
      },
      getRange(sheetName, r1, r2) {
        const s = wb ? wb.sheetByName(sheetName) : self;
        if (!s) return [[E.REF]];
        const out = [];
        for (let rr = Math.min(r1.row, r2.row); rr <= Math.max(r1.row, r2.row); rr++) {
          const line = [];
          for (let cc = Math.min(r1.col, r2.col); cc <= Math.max(r1.col, r2.col); cc++) {
            line.push(s.computed(rr, cc, visiting));
          }
          out.push(line);
        }
        return out;
      },
    };
  }

  // —— 合并 ——
  mergeAt(r, c) {
    for (const m of this.merges) {
      if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return m;
    }
    return null;
  }
  addMerge(r1, c1, r2, c2) {
    this.removeMergesIn(r1, c1, r2, c2);
    this.merges.push({ r1, c1, r2, c2 });
    this._epoch++;
  }
  removeMergesIn(r1, c1, r2, c2) {
    this.merges = this.merges.filter(m => !(m.r1 <= r2 && m.r2 >= r1 && m.c1 <= c2 && m.c2 >= c1));
    this._epoch++;
  }

  // —— 筛选：行是否可见 ——
  rowVisible(r) {
    if (!this.filter) return true;
    const { r1, r2, picks } = this.filter;
    if (r <= r1 || r > r2) return true; // 表头行与区域外不受影响
    for (const [col, allowed] of picks) {
      if (!allowed) continue;
      const v = this.computed(r, col);
      const t = v == null ? '' : String(v);
      if (!allowed.has(t)) return false;
    }
    return true;
  }

  // —— 行/列结构操作（公式引用随动） ——
  insertRows(at, count) { this._shiftRows(at, count); }
  deleteRows(at, count) { this._shiftRows(at, -count); }
  _shiftRows(at, delta) {
    const next = new Map();
    for (const [k, cell] of this.cells) {
      const [r, c] = k.split(',').map(Number);
      if (r >= at) {
        if (delta < 0 && r < at - delta) continue; // 删除区
        next.set(this.key(r + delta, c), cell);
      } else next.set(k, cell);
    }
    this.cells = next;
    // 公式引用平移
    if (delta !== 0) this._remapRefs((ref) => {
      if (ref.row >= at) ref.row += delta;
      return ref.row >= 1;
    });
    this.maxRow = Math.max(1, this.maxRow + delta);
    this._epoch++;
  }
  insertCols(at, count) { this._shiftCols(at, count); }
  deleteCols(at, count) { this._shiftCols(at, -count); }
  _shiftCols(at, delta) {
    const next = new Map();
    for (const [k, cell] of this.cells) {
      const [r, c] = k.split(',').map(Number);
      if (c >= at) {
        if (delta < 0 && c < at - delta) continue;
        next.set(this.key(r, c + delta), cell);
      } else next.set(k, cell);
    }
    this.cells = next;
    if (delta !== 0) this._remapRefs((ref) => {
      if (ref.col >= at) ref.col += delta;
      return ref.col >= 1;
    });
    this.maxCol = Math.max(1, this.maxCol + delta);
    this._epoch++;
  }

  /** 遍历所有公式并重写引用（结构平移/填充共用） */
  _remapRefs(mapper) {
    for (const cell of this.cells.values()) {
      if (cell.f) cell.f = remapFormula(cell.f, mapper);
    }
  }

  serialize() {
    const cells = {};
    for (const [k, cell] of this.cells) {
      cells[k] = { v: cell.v, f: cell.f, s: cell.s };
    }
    return {
      name: this.name, cells,
      merges: this.merges, freezeR: this.freezeR, freezeC: this.freezeC,
      colW: [...this.colW], rowH: [...this.rowH],
      filter: this.filter ? { ...this.filter, picks: [...this.filter.picks].map(([c, s]) => [c, [...s]]) } : null,
      validations: [...this.validations], condFormats: this.condFormats,
    };
  }
  static deserialize(data) {
    const s = new Sheet(data.name);
    for (const [k, cell] of Object.entries(data.cells || {})) {
      s.cells.set(k, { v: cell.v, f: cell.f, s: cell.s });
      const [r, c] = k.split(',').map(Number);
      s.maxRow = Math.max(s.maxRow, r);
      s.maxCol = Math.max(s.maxCol, c);
    }
    s.merges = data.merges || [];
    s.freezeR = data.freezeR || 0;
    s.freezeC = data.freezeC || 0;
    s.colW = new Map(data.colW || []);
    s.rowH = new Map(data.rowH || []);
    if (data.filter) s.filter = { ...data.filter, picks: new Map((data.filter.picks || []).map(([c, arr]) => [c, new Set(arr)])) };
    s.validations = new Map(data.validations || []);
    s.condFormats = data.condFormats || [];
    s._epoch++;
    return s;
  }
}

/** 公式引用重写：mapper(ref 对象 {col,row,absC,absR,sheet}) -> 返回 false 表示该引用失效(#REF!) */
export function remapFormula(src, mapper) {
  return src.replace(/('([^']|'')+'|[A-Za-z_一-鿿][\w一-鿿.]*)?!?(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g,
    (whole, sheetPart, _q, absC, colS, absR, rowS) => {
      // 只处理单元格形态（含可选 Sheet! 前缀）
      const isRefLike = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.test(whole.slice(sheetPart ? sheetPart.length + 1 : 0).replace(/^!/, '') || whole);
      if (!isRefLike) return whole;
      const sheet = sheetPart ? sheetPart.replace(/^'|'$/g, '').replace(/''/g, "'") : null;
      const ref = { col: colToNumLocal(colS), row: +rowS, absC: !!absC, absR: !!absR, sheet };
      const out = mapper(ref);
      if (out === false) return '#REF!';
      const prefix = ref.sheet ? `${ref.sheet}!` : '';
      return prefix + (ref.absC ? '$' : '') + numToCol(ref.col) + (ref.absR ? '$' : '') + ref.row;
    });
}
function colToNumLocal(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export class Workbook {
  constructor() {
    this.sheets = [new Sheet('Sheet1')];
    for (const s of this.sheets) s._wb = this;
    this.active = 0;
  }
  get sheet() { return this.sheets[this.active]; }
  sheetByName(name) {
    return this.sheets.find(s => s.name.toLowerCase() === String(name).toLowerCase()) || null;
  }
  addSheet(name) {
    let n = name || `Sheet${this.sheets.length + 1}`;
    let i = 1;
    while (this.sheetByName(n)) n = `${name || 'Sheet'}${this.sheets.length + 1 + i++}`;
    const s = new Sheet(n);
    s._wb = this;
    this.sheets.push(s);
    this.active = this.sheets.length - 1;
    return s;
  }
  removeSheet(idx) {
    if (this.sheets.length <= 1) return false;
    this.sheets.splice(idx, 1);
    this.active = Math.min(this.active, this.sheets.length - 1);
    return true;
  }
  renameSheet(idx, name) {
    if (!name || this.sheetByName(name)) return false;
    this.sheets[idx].name = name;
    return true;
  }

  serialize() { return { active: this.active, sheets: this.sheets.map(s => s.serialize()) }; }
  static deserialize(data) {
    const wb = new Workbook();
    wb.sheets = (data.sheets || []).map(d => Sheet.deserialize(d));
    if (!wb.sheets.length) wb.sheets = [new Sheet('Sheet1')];
    for (const s of wb.sheets) s._wb = wb;
    wb.active = Math.min(data.active || 0, wb.sheets.length - 1);
    return wb;
  }
}

// ==================== 撤销/重做（命令栈） ====================
export class History {
  constructor(limit = 100) { this.undoStack = []; this.redoStack = []; this.limit = limit; }
  push(label, undo, redo) {
    this.undoStack.push({ label, undo, redo });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undo() { const op = this.undoStack.pop(); if (op) { op.undo(); this.redoStack.push(op); } }
  redo() { const op = this.redoStack.pop(); if (op) { op.redo(); this.undoStack.push(op); } }
}

/** 快照一批单元格（用于撤销） */
export function snapshotCells(sheet, r1, c1, r2, c2) {
  const snap = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = sheet.get(r, c);
      snap.push([r, c, cell ? { v: cell.v, f: cell.f, s: cell.s ? { ...cell.s } : null } : null]);
    }
  }
  return snap;
}
export function restoreCells(sheet, snap) {
  for (const [r, c, cell] of snap) {
    if (cell == null) sheet.setRaw(r, c, null);
    else {
      sheet.setRaw(r, c, cell.f || cell.v);
      if (cell.s) sheet.setStyle(r, c, cell.s);
    }
  }
}
