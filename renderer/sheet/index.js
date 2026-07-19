// renderer/modules/sheet/index.js —— 表格模块（sheet.js）：虚拟网格 + 公式引擎 + Excel 管线
import { Workbook, Sheet, History, snapshotCells, restoreCells, remapFormula } from './model.js';
import { SheetGrid, HEADER_H, HEADER_W } from './grid.js';
import * as io from './io.js';
import { insertChart, closeChart, getChartImage } from './charts.js';
import { openPivotDialog, runPivot } from './pivot.js';
import { parseRef, numToCol, isErr } from './formula/engine.js';
import { FUNCTIONS } from './formula/functions.js';
import { contextKeys } from '../../core/contextkey-service.js';
import { menus } from '../../core/menu-service.js';
import { toast, modal } from '../../shell/shell.js';

const MODULE = 'sheet';
const FILE_MARK = 'mazz-sheet-v1';
const instances = new Map();
let current = null;

// ==================== 控制器 ====================
function createSheet(container) {
  const wb = new Workbook();
  const history = new History();

  const root = document.createElement('div');
  root.className = 'sheet-root';
  root.tabIndex = 0;
  root.innerHTML = `
    <div class="sg-fbar">
      <span class="sg-fx">fx</span>
      <input class="sg-finput" spellcheck="false" placeholder="选中单元格查看/编辑内容或公式…" />
    </div>
    <div class="sg-grid-wrap"></div>
    <div class="sg-tabs"><div class="sg-tab-list"></div><button class="sg-tab-add" title="新建工作表">＋</button></div>
    <textarea class="sg-capture" aria-hidden="true" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>`;
  container.appendChild(root);
  const capture = root.querySelector('.sg-capture');

  const ctl = {
    container, root, wb, history,
    grid: null,
    fInput: root.querySelector('.sg-finput'),
    gridWrap: root.querySelector('.sg-grid-wrap'),
    tabList: root.querySelector('.sg-tab-list'),
    get sel() { return ctl.grid?.sel; },
    get sheet() { return wb.sheet; },
    setContentCells(cells) { applyEdits(cells, '编辑'); },
    rebuildGrid,
    renderTabs,
    applyEdits(cells, label) { applyEdits(cells, label); },
    undo: () => { history.undo(); rebuildGrid(); ctl.grid.render(); renderTabs(); syncFormulaBar(); },
    redo: () => { history.redo(); rebuildGrid(); ctl.grid.render(); renderTabs(); syncFormulaBar(); },
  };

  function rebuildGrid() {
    if (ctl.grid) ctl.grid.root.remove();
    ctl.grid = new SheetGrid(ctl.gridWrap, wb, {
      onEdit: (cells) => applyEdits(cells, '编辑'),
      onSelectionChange: () => { syncFormulaBar(); syncStatus(); },
      onContextMenu: (x, y) => {
        contextKeys.set('module', MODULE);
        menus.show('sheet/cell', { x, y, preferDom: true });
      },
      remapFormula: (src, step, horizontal) => remapFormula(src, (ref) => {
        if (!ref.sheet) {
          if (horizontal) { if (!ref.absC) ref.col += step; }
          else { if (!ref.absR) ref.row += step; }
        }
        return true;
      }),
    });
    ctl.grid.root.addEventListener('mousedown', () => ctl.focusGrid());
    // 滚动时捕获框跟随单元格
    ctl.grid.scrollEl.addEventListener('scroll', () => {
      clearTimeout(ctl._capT);
      ctl._capT = setTimeout(positionCapture, 60);
    });
    positionCapture();
  }

  function applyEdits(cells, label = '编辑') {
    const sheet = wb.sheet;
    const snaps = cells.map(([r, c]) => [r, c, sheet.get(r, c) ? { v: sheet.get(r, c).v, f: sheet.get(r, c).f, s: sheet.get(r, c).s ? { ...sheet.get(r, c).s } : null } : null]);
    history.push(label, () => restoreCells(sheet, snaps), () => {
      for (const [r, c, v] of cells) sheet.setRaw(r, c, v);
    });
    for (const [r, c, v] of cells) sheet.setRaw(r, c, v);
    window.MazzHost?.notifyChange(container);
    ctl.grid.render();
    syncFormulaBar();
    syncStatus();
    positionCapture();
    ctl.focusGrid();
  }

  function syncFormulaBar() {
    const sel = ctl.grid?.sel;
    if (!sel) return;
    const cell = wb.sheet.get(sel.active.r, sel.active.c);
    ctl.fInput.value = cell ? (cell.f ?? (cell.v ?? '')) : '';
    ctl.fInput.placeholder = `${numToCol(sel.active.c)}${sel.active.r}`;
    positionCapture();
  }
  ctl.positionCapture = positionCapture;

  /** 捕获框锚定到活动单元格（IME 候选框出现在正确位置，方向键不被错位吃掉） */
  function positionCapture() {
    const sel = ctl.grid?.sel;
    if (!sel || !ctl.grid) return;
    const sl = ctl.grid.scrollEl.scrollLeft, st = ctl.grid.scrollEl.scrollTop;
    const box = ctl.grid.cellBox(sel.active.r, sel.active.c, sl, st);
    const fbarH = root.querySelector('.sg-fbar')?.offsetHeight || 0;
    capture.style.left = (46 + box.x) + 'px';
    capture.style.top = (fbarH + 26 + box.y) + 'px';
    capture.style.width = Math.max(box.w, 40) + 'px';
    capture.style.height = box.h + 'px';
  }
  function syncStatus() {
    const sel = ctl.grid?.sel;
    if (!sel) return;
    const rows = sel.r2 - sel.r1 + 1, cols = sel.c2 - sel.c1 + 1;
    let txt = `${numToCol(sel.active.c)}${sel.active.r}`;
    if (rows > 1 || cols > 1) {
      let sum = 0, n = 0;
      for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) {
        const v = wb.sheet.computed(r, c);
        if (typeof v === 'number') { sum += v; n++; }
      }
      txt = `${rows}行×${cols}列 · 求和=${Math.round(sum * 1e10) / 1e10} · 计数=${n}`;
    }
    window.MazzHost?.setStatus(container, txt);
  }

  // —— 公式栏 ——
  ctl.fInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const sel = ctl.grid.sel;
      applyEdits([[sel.active.r, sel.active.c, ctl.fInput.value]], '公式栏编辑');
      ctl.grid.root.focus();
      e.preventDefault();
    }
    if (e.key === 'Escape') { syncFormulaBar(); ctl.grid.root.focus(); }
    e.stopPropagation();
  });

  // —— 键盘 ——
  function onKeyDown(e) {
    if (ctl.grid.editing) return;
    const g = ctl.grid;
    const sel = g.sel;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); ctl.undo(); return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); ctl.redo(); return; }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      g.sel = { r1: 1, c1: 1, r2: wb.sheet.maxRow, c2: wb.sheet.maxCol, active: { r: 1, c: 1 } };
      g.render(); return;
    }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleStyle('bold'); return; }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); toggleStyle('italic'); return; }
    if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); toggleStyle('underline'); return; }
    switch (e.key) {
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
        e.preventDefault();
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        g.moveActive(d[0], d[1], e.shiftKey);
        return;
      }
      case 'Tab': e.preventDefault(); g.moveActive(0, e.shiftKey ? -1 : 1); return;
      case 'Enter': e.preventDefault(); g.moveActive(e.shiftKey ? -1 : 1, 0); return;
      case 'F2': e.preventDefault(); g.startEdit(sel.active.r, sel.active.c); return;
      case 'Delete': case 'Backspace': {
        e.preventDefault();
        const edits = [];
        for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) edits.push([r, c, null]);
        applyEdits(edits, '清除内容');
        return;
      }
      case 'Escape': closeChart(); return;
    }
    // 可打印字符不拦截：经捕获 textarea 的 input 事件进入编辑器（兼容 IME）
  }

  // —— 剪贴板（Excel 互粘） ——
  function writeClipboard(e, cut) {
    const sel = ctl.grid.sel;
    const tsv = io.selectionToTsv(wb.sheet, sel.r1, sel.c1, sel.r2, sel.c2);
    const html = io.selectionToHtmlTable(wb.sheet, sel.r1, sel.c1, sel.r2, sel.c2);
    e.clipboardData.setData('text/plain', tsv);
    e.clipboardData.setData('text/html', html);
    e.preventDefault();
    if (cut) {
      const edits = [];
      for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) edits.push([r, c, null]);
      applyEdits(edits, '剪切');
    }
  }
  function onCopy(e) { if (!ctl.grid.editing) writeClipboard(e, false); }
  function onCut(e) { if (!ctl.grid.editing) writeClipboard(e, true); }
  function onPaste(e) {
    if (ctl.grid.editing) return;
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    let rows = [];
    if (html && html.includes('<table')) rows = io.pasteHtmlToCells(html);
    else if (text) rows = io.pasteTextToCells(text);
    if (!rows.length) return;
    const sel = ctl.grid.sel;
    const edits = [];
    rows.forEach((row, i) => row.forEach((v, j) => edits.push([sel.active.r + i, sel.active.c + j, v])));
    applyEdits(edits, '粘贴');
  }

  function toggleStyle(key) {
    const sel = ctl.grid.sel;
    const cell = wb.sheet.get(sel.active.r, sel.active.c);
    const cur = cell?.s?.[key] || false;
    const edits = [];
    for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) edits.push([r, c, null]);
    const snaps = edits.map(([r, c]) => [r, c, wb.sheet.get(r, c) ? { v: wb.sheet.get(r, c).v, f: wb.sheet.get(r, c).f, s: wb.sheet.get(r, c).s ? { ...wb.sheet.get(r, c).s } : null } : null]);
    history.push('格式', () => restoreCells(wb.sheet, snaps), () => {
      for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) wb.sheet.setStyle(r, c, { [key]: !cur });
    });
    for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) wb.sheet.setStyle(r, c, { [key]: !cur });
    window.MazzHost?.notifyChange(container);
    ctl.grid.render();
  }
  ctl.toggleStyle = toggleStyle;

  // —— 工作表标签 ——
  function renderTabs() {
    ctl.tabList.innerHTML = '';
    wb.sheets.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'sg-tab' + (i === wb.active ? ' on' : '');
      el.textContent = s.name;
      el.addEventListener('click', () => { wb.active = i; rebuildGrid(); renderTabs(); syncFormulaBar(); });
      el.addEventListener('dblclick', () => {
        const name = prompt('重命名工作表：', s.name);
        if (name && wb.renameSheet(i, name)) renderTabs();
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (wb.sheets.length > 1 && confirm(`删除工作表「${s.name}」？`)) {
          wb.removeSheet(i); rebuildGrid(); renderTabs();
        }
      });
      ctl.tabList.appendChild(el);
    });
  }
  root.querySelector('.sg-tab-add').addEventListener('click', () => {
    wb.addSheet();
    rebuildGrid(); renderTabs();
    window.MazzHost?.notifyChange(container);
  });

  // 键盘/剪贴板事件挂在外层持久 root 上（网格重建不受影响）
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('copy', onCopy);
  root.addEventListener('cut', onCut);
  root.addEventListener('paste', onPaste);

  // —— 键入捕获：锚定到活动单元格的 textarea，中英/IME 输入都经它落到编辑器 ——
  capture.addEventListener('input', () => {
    if (ctl.grid?.editing) { capture.value = ''; return; }
    const text = capture.value;
    capture.value = '';
    if (!text || !ctl.grid) return;
    const sel = ctl.grid.sel;
    ctl.grid.startEdit(sel.active.r, sel.active.c, text);
  });
  capture.addEventListener('compositionend', () => {
    if (ctl.grid?.editing) return;
    const text = capture.value;
    if (!text) return;
    capture.value = '';
    const sel = ctl.grid.sel;
    ctl.grid.startEdit(sel.active.r, sel.active.c, text);
  });
  ctl.focusGrid = () => { if (!ctl.grid?.editing) capture.focus(); };

  rebuildGrid();
  renderTabs();
  return ctl;
}

// ==================== 命令助手 ====================
function withCtl(fn) { return () => { if (current) fn(current); } }
function withSel(fn) { return withCtl(ctl => fn(ctl, ctl.grid.sel)); }

function applyStyleToSel(ctl, sel, patch) {
  const sheet = ctl.sheet;
  const snaps = snapshotCells(sheet, sel.r1, sel.c1, sel.r2, sel.c2);
  ctl.history.push('格式', () => { restoreCells(sheet, snaps); ctl.grid.render(); }, () => {
    for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) sheet.setStyle(r, c, patch);
    ctl.grid.render();
  });
  for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) sheet.setStyle(r, c, patch);
  window.MazzHost?.notifyChange(ctl.container);
  ctl.grid.render();
}

function insertStruct(ctl, kind, delta) {
  const sel = ctl.grid.sel;
  const sheet = ctl.sheet;
  const sheetIdx = ctl.wb.sheets.indexOf(sheet);
  const before = JSON.stringify(sheet.serialize());
  const op = () => {
    if (kind === 'row') delta > 0 ? sheet.insertRows(sel.r1, delta) : sheet.deleteRows(sel.r1, -delta);
    else delta > 0 ? sheet.insertCols(sel.c1, delta) : sheet.deleteCols(sel.c1, -delta);
  };
  op();
  const after = JSON.stringify(sheet.serialize());
  const restore = (json) => {
    ctl.wb.sheets[sheetIdx] = Sheet.deserialize(JSON.parse(json));
    ctl.wb.sheets[sheetIdx]._wb = ctl.wb;
    ctl.rebuildGrid();
    ctl.grid.render();
  };
  ctl.history.push('结构', () => restore(before), () => restore(after));
  ctl.grid.render();
  window.MazzHost?.notifyChange(ctl.container);
}

// ==================== 模块契约 ====================
export default {
  displayName: '表格',
  icon: '📊',

  create(container) {
    const ctl = createSheet(container);
    instances.set(container, ctl);
    return { container };
  },
  activate(container, state) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    window.__activeSheetCtl = ctl; // 桥接 #1 取数
    contextKeys.set('module', MODULE);
    contextKeys.set('hasSelection', true);
    ctl.grid.render();
    ctl.focusGrid();
    ctl.positionCapture();
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },

  getContent(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return '';
    return JSON.stringify({ mark: FILE_MARK, ...ctl.wb.serialize() });
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    if (data && typeof data === 'object' && data.__xlsx) {
      toast('正在解析 xlsx…');
      import('./io.js').then(io => io.importXlsx(null, data.__xlsx)).then(wb => {
        ctl.wb = wb;
        ctl.rebuildGrid();
        ctl.renderTabs();
        toast(`已导入 ${wb.sheets.length} 个工作表`);
      }).catch(e => toast('xlsx 解析失败：' + e.message));
      return;
    }
    const text = typeof data === 'string' ? data : '';
    if (text.startsWith('{')) {
      try {
        const obj = JSON.parse(text);
        if (obj.mark === FILE_MARK) {
          ctl.wb = Workbook.deserialize(obj);
          ctl.rebuildGrid();
          ctl.renderTabs();
          return;
        }
      } catch { /* fallthrough: 按 CSV 处理 */ }
    }
    // CSV / TSV
    const rows = text.includes('\t') ? io.parseCsv(text, '\t') : io.parseCsv(text, ',');
    rows.forEach((row, i) => row.forEach((v, j) => ctl.sheet.setRaw(i + 1, j + 1, v)));
    ctl.rebuildGrid();
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    ctl.wb = new Workbook();
    ctl.rebuildGrid();
    ctl.renderTabs();
  },
  getCharCount(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return 0;
    let n = 0;
    for (const s of ctl.wb.sheets) n += s.cells.size;
    return n;
  },
  getCursorPos(state) {
    const ctl = instances.get(state.container);
    const sel = ctl?.grid?.sel;
    return sel ? `${numToCol(sel.active.c)}${sel.active.r}` : '';
  },

  toolbarHTML: `
    <div class="rb-group" data-label="字体">
      <button class="rb-btn" data-command="sheet.bold"><i class="ico">B</i><span>加粗</span></button>
      <button class="rb-btn" data-command="sheet.italic"><i class="ico" style="font-style:italic">I</i><span>斜体</span></button>
      <button class="rb-btn" data-command="sheet.underline"><i class="ico" style="text-decoration:underline">U</i><span>下划线</span></button>
    </div>
    <div class="rb-group" data-label="数字格式">
      <select class="rb-select" id="sg-fmt">
        <option value="General">常规</option><option value="0.00">数值(2位)</option>
        <option value="#,##0.00">千分位</option><option value="0%">百分比</option>
        <option value="0.00%">百分比(2位)</option><option value="&quot;¥&quot;#,##0.00">人民币</option>
        <option value="yyyy-mm-dd">日期</option><option value="yyyy-mm-dd hh:mm">日期时间</option>
      </select>
      <button class="rb-btn" data-command="sheet.alignLeft"><i class="ico">⇤</i><span>左对齐</span></button>
      <button class="rb-btn" data-command="sheet.alignCenter"><i class="ico">↔</i><span>居中</span></button>
      <button class="rb-btn" data-command="sheet.alignRight"><i class="ico">⇥</i><span>右对齐</span></button>
    </div>
    <div class="rb-group" data-label="结构">
      <button class="rb-btn" data-command="sheet.merge"><i class="ico">▣</i><span>合并</span></button>
      <button class="rb-btn" data-command="sheet.unmerge"><i class="ico">▢</i><span>拆合并</span></button>
      <button class="rb-btn" data-command="sheet.freezeAt"><i class="ico">❄</i><span>冻结至此</span></button>
      <button class="rb-btn" data-command="sheet.unfreeze"><i class="ico">☀</i><span>解冻</span></button>
    </div>
    <div class="rb-group" data-label="数据">
      <button class="rb-btn" data-command="sheet.sortAsc"><i class="ico">A↓</i><span>升序</span></button>
      <button class="rb-btn" data-command="sheet.sortDesc"><i class="ico">Z↓</i><span>降序</span></button>
      <button class="rb-btn" data-command="sheet.toggleFilter"><i class="ico">⧩</i><span>筛选</span></button>
      <button class="rb-btn" data-command="sheet.validation"><i class="ico">✓</i><span>验证</span></button>
      <button class="rb-btn" data-command="sheet.condFormat"><i class="ico">🎨</i><span>条件格式</span></button>
    </div>
    <div class="rb-group" data-label="分析">
      <button class="rb-btn" data-command="sheet.insertChart"><i class="ico">📈</i><span>图表</span></button>
      <button class="rb-btn" data-command="sheet.pivot"><i class="ico">∑</i><span>透视表</span></button>
      <button class="rb-btn" data-command="sheet.insertFunction"><i class="ico">fx</i><span>函数</span></button>
    </div>
    <div class="rb-group" data-label="文件">
      <button class="rb-btn" data-command="sheet.exportXlsx"><i class="ico">📦</i><span>导出xlsx</span></button>
      <button class="rb-btn" data-command="sheet.exportCsv"><i class="ico">📄</i><span>导出CSV</span></button>
      <button class="rb-btn" data-command="edit.undo"><i class="ico">↩</i><span>撤销</span></button>
      <button class="rb-btn" data-command="edit.redo"><i class="ico">↪</i><span>重做</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
    panel.querySelector('#sg-fmt')?.addEventListener('change', (e) => {
      window.MazzCommands.execute('sheet.setFormat', { fmt: e.target.value === '人民币' ? '"¥"#,##0.00' : e.target.value });
    });
  },

  contributes: {
    commands: [
      { id: 'sheet.undo', title: '撤销（表格）', group: '编辑', when: "module=='sheet'", run: withCtl(ctl => ctl.undo()) },
      { id: 'sheet.redo', title: '重做（表格）', group: '编辑', when: "module=='sheet'", run: withCtl(ctl => ctl.redo()) },
      { id: 'sheet.bold', title: '加粗', icon: 'B', group: '格式', when: "module=='sheet'", run: withCtl(ctl => ctl.toggleStyle('bold')) },
      { id: 'sheet.italic', title: '斜体', icon: 'I', group: '格式', when: "module=='sheet'", run: withCtl(ctl => ctl.toggleStyle('italic')) },
      { id: 'sheet.underline', title: '下划线', icon: 'U', group: '格式', when: "module=='sheet'", run: withCtl(ctl => ctl.toggleStyle('underline')) },
      { id: 'sheet.alignLeft', title: '左对齐', group: '格式', when: "module=='sheet'", run: withSel((ctl, sel) => applyStyleToSel(ctl, sel, { align: 'left' })) },
      { id: 'sheet.alignCenter', title: '居中', group: '格式', when: "module=='sheet'", run: withSel((ctl, sel) => applyStyleToSel(ctl, sel, { align: 'center' })) },
      { id: 'sheet.alignRight', title: '右对齐', group: '格式', when: "module=='sheet'", run: withSel((ctl, sel) => applyStyleToSel(ctl, sel, { align: 'right' })) },
      { id: 'sheet.setFormat', title: '设置数字格式', group: '格式', when: "module=='sheet'",
        run: (payload) => withSel((ctl, sel) => applyStyleToSel(ctl, sel, { fmt: payload?.fmt || 'General' }))() },
      { id: 'sheet.merge', title: '合并单元格', icon: '▣', group: '结构', when: "module=='sheet'",
        run: withSel((ctl, sel) => {
          if (sel.r1 === sel.r2 && sel.c1 === sel.c2) { toast('请先框选多个单元格'); return; }
          ctl.sheet.addMerge(sel.r1, sel.c1, sel.r2, sel.c2);
          ctl.grid.render();
          window.MazzHost?.notifyChange(ctl.container);
        }) },
      { id: 'sheet.unmerge', title: '取消合并', icon: '▢', group: '结构', when: "module=='sheet'",
        run: withSel((ctl, sel) => {
          ctl.sheet.removeMergesIn(sel.r1, sel.c1, sel.r2, sel.c2);
          ctl.grid.render();
        }) },
      { id: 'sheet.freezeAt', title: '冻结到当前位置', icon: '❄', group: '结构', when: "module=='sheet'",
        run: withSel((ctl, sel) => {
          ctl.sheet.freezeR = sel.active.r - 1;
          ctl.sheet.freezeC = sel.active.c - 1;
          ctl.grid.render();
          toast(`已冻结 ${ctl.sheet.freezeR} 行 ${ctl.sheet.freezeC} 列`);
        }) },
      { id: 'sheet.unfreeze', title: '取消冻结', icon: '☀', group: '结构', when: "module=='sheet'",
        run: withCtl(ctl => { ctl.sheet.freezeR = 0; ctl.sheet.freezeC = 0; ctl.grid.render(); }) },
      { id: 'sheet.sortAsc', title: '升序排序', icon: 'A↓', group: '数据', when: "module=='sheet'", run: withSel((ctl, sel) => sortSel(ctl, sel, 1)) },
      { id: 'sheet.sortDesc', title: '降序排序', icon: 'Z↓', group: '数据', when: "module=='sheet'", run: withSel((ctl, sel) => sortSel(ctl, sel, -1)) },
      { id: 'sheet.toggleFilter', title: '自动筛选', icon: '⧩', group: '数据', when: "module=='sheet'",
        run: withSel((ctl, sel) => {
          const sheet = ctl.sheet;
          if (sheet.filter) { sheet.filter = null; toast('已取消筛选'); }
          else {
            sheet.filter = { r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c2, picks: new Map() };
            openFilterPicker(ctl, sel);
          }
          ctl.grid.render();
        }) },
      { id: 'sheet.validation', title: '数据验证…', icon: '✓', group: '数据', when: "module=='sheet'", run: withSel((ctl, sel) => openValidationDialog(ctl, sel)) },
      { id: 'sheet.condFormat', title: '条件格式…', icon: '🎨', group: '数据', when: "module=='sheet'", run: withSel((ctl, sel) => openCondFormatDialog(ctl, sel)) },
      { id: 'sheet.insertChart', title: '插入图表', icon: '📈', group: '分析', when: "module=='sheet'",
        run: withSel(async (ctl, sel) => {
          await insertChart(ctl.gridWrap, ctl.sheet, sel, (r, c) => ctl.sheet.computed(r, c));
        }) },
      { id: 'sheet.pivot', title: '插入透视表', icon: '∑', group: '分析', when: "module=='sheet'",
        run: withSel(async (ctl, sel) => {
          if (sel.r2 - sel.r1 < 1) { toast('请先框选含表头的数据区'); return; }
          const config = await openPivotDialog(ctl.sheet, sel);
          const { headers, rows, title } = runPivot(ctl.sheet, sel, config);
          const ns = ctl.wb.addSheet(`透视_${ctl.sheet.name}`.slice(0, 20));
          ns.setRaw(1, 1, title);
          headers.forEach((h, j) => ns.setRaw(3, j + 1, h));
          ns.setStyle(3, 1, { bold: true });
          rows.forEach((row, i) => row.forEach((v, j) => ns.setRaw(4 + i, j + 1, v)));
          ctl.rebuildGrid();
          ctl.renderTabs();
          toast(`透视表已生成：${rows.length} 行`);
        }) },
      { id: 'sheet.insertFunction', title: '插入函数…', icon: 'fx', group: '分析', when: "module=='sheet'",
        run: withCtl((ctl) => openFunctionWizard(ctl)) },
      { id: 'sheet.insertRowAbove', title: '在上方插入行', group: '结构', when: "module=='sheet'", run: withSel((ctl, sel) => insertStruct(ctl, 'row', 1)) },
      { id: 'sheet.deleteRow', title: '删除所选行', group: '结构', when: "module=='sheet'", run: withSel((ctl, sel) => insertStruct(ctl, 'row', -(sel.r2 - sel.r1 + 1))) },
      { id: 'sheet.insertColLeft', title: '在左侧插入列', group: '结构', when: "module=='sheet'", run: withSel((ctl, sel) => insertStruct(ctl, 'col', 1)) },
      { id: 'sheet.deleteCol', title: '删除所选列', group: '结构', when: "module=='sheet'", run: withSel((ctl, sel) => insertStruct(ctl, 'col', -(sel.c2 - sel.c1 + 1))) },
      { id: 'sheet.addSheet', title: '新建工作表', group: '结构', when: "module=='sheet'",
        run: withCtl(ctl => { ctl.wb.addSheet(); ctl.rebuildGrid(); ctl.renderTabs(); }) },
      { id: 'sheet.exportCsv', title: '导出 CSV', icon: '📄', group: '文件', when: "module=='sheet'",
        run: withCtl(async (ctl) => {
          const rows = [];
          for (let r = 1; r <= ctl.sheet.maxRow; r++) {
            const line = [];
            for (let c = 1; c <= ctl.sheet.maxCol; c++) {
              const v = ctl.sheet.computed(r, c);
              line.push(v == null ? '' : v);
            }
            rows.push(line);
          }
          const csv = io.toDelimited(rows, ',');
          const p = await window.mazz.invoke('dialog:saveFile', { defaultPath: '工作表.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
          if (p) { await window.mazz.invoke('fs:writeFile', { path: p, content: csv }); toast('CSV 已导出'); }
        }) },
      { id: 'sheet.exportXlsx', title: '导出 xlsx', icon: '📦', group: '文件', when: "module=='sheet'",
        run: withCtl(async (ctl) => {
          const p = await window.mazz.invoke('dialog:saveFile', { defaultPath: '工作簿.xlsx', filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }] });
          if (!p) return;
          toast('正在编译 xlsx…');
          const chartImg = getChartImage();
          const buf = await io.exportXlsx(ctl.wb, {
            chartImages: chartImg ? [{ ...chartImg, sheet: ctl.wb.active + 1, col: 1, row: 1 }] : [],
          });
          const b64 = bufferToBase64(buf);
          await window.mazz.invoke('fs:writeFileBase64', { path: p, base64: b64 });
          toast(`xlsx 已导出：${p.split(/[\\/]/).pop()}`);
        }) },
      { id: 'sheet.copyMarkdownTable', title: '复制为 Markdown 表格', group: '分析', when: "module=='sheet'",
        run: withSel(async (ctl, sel) => {
          const lines = [];
          for (let r = sel.r1; r <= sel.r2; r++) {
            const cells = [];
            for (let c = sel.c1; c <= sel.c2; c++) {
              const v = ctl.sheet.computed(r, c);
              cells.push(v == null ? '' : String(v).replace(/\|/g, '\\|'));
            }
            lines.push('| ' + cells.join(' | ') + ' |');
            if (r === sel.r1) lines.push('|' + Array(cells.length).fill(' --- ').join('|') + '|');
          }
          await window.mazz.invoke('clipboard:write', { text: lines.join('\n') });
          toast('Markdown 表格已复制');
        }) },
      { id: 'sheet.cellFormat', title: '单元格格式…', group: '格式', when: "module=='sheet'", run: withSel((ctl, sel) => openCellFormatDialog(ctl, sel)) },
    ],
    keybindings: [
      { command: 'sheet.undo', key: 'ctrl+z', when: "module=='sheet'" },
      { command: 'sheet.redo', key: 'ctrl+y', when: "module=='sheet'" },
      { command: 'sheet.redo', key: 'ctrl+shift+z', when: "module=='sheet'" },
    ],
    menus: {
      'sheet/cell': [
        { command: 'sheet.insertRowAbove', title: '在上方插入行', group: '1_struct' },
        { command: 'sheet.deleteRow', title: '删除行', group: '1_struct' },
        { command: 'sheet.insertColLeft', title: '在左侧插入列', group: '1_struct' },
        { command: 'sheet.deleteCol', title: '删除列', group: '1_struct' },
        { command: 'sheet.merge', title: '合并单元格', group: '1_struct' },
        { command: 'sheet.cellFormat', title: '单元格格式…', group: '2_format' },
        { command: 'sheet.sortAsc', title: '升序排序', group: '3_data' },
        { command: 'sheet.sortDesc', title: '降序排序', group: '3_data' },
        { command: 'sheet.toggleFilter', title: '筛选…', group: '3_data' },
        { command: 'sheet.insertFunction', title: '插入函数…', group: '4_tool' },
        { command: 'sheet.copyMarkdownTable', title: '复制为 Markdown 表格', group: '4_tool' },
        { command: 'sheet.exportCsv', title: '导出 CSV', group: '4_tool' },
        { command: 'ai.placeholder', title: 'AI ▸（未配置）', group: '5_ai' },
      ],
    },
    bridges: [],
    aiActions: [],
  },
};

// ==================== 排序 ====================
function sortSel(ctl, sel, dir) {
  const sheet = ctl.sheet;
  const keyCol = sel.active.c;
  const rows = [];
  for (let r = sel.r1; r <= sel.r2; r++) {
    const row = [];
    for (let c = sel.c1; c <= sel.c2; c++) {
      const cell = sheet.get(r, c);
      row.push(cell ? { v: cell.v, f: cell.f, s: cell.s } : null);
    }
    rows.push({ r, key: sheet.computed(r, keyCol), row });
  }
  rows.sort((a, b) => {
    const x = a.key, y = b.key;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), 'zh-CN') * dir;
  });
  const snaps = snapshotCells(sheet, sel.r1, sel.c1, sel.r2, sel.c2);
  const apply = () => {
    rows.forEach(({ row }, i) => {
      const r = sel.r1 + i;
      row.forEach((cell, j) => {
        const c = sel.c1 + j;
        if (cell == null) sheet.setRaw(r, c, null);
        else { sheet.setRaw(r, c, cell.f || cell.v); if (cell.s) sheet.setStyle(r, c, cell.s); }
      });
    });
  };
  ctl.history.push('排序', () => { restoreCells(sheet, snaps); ctl.grid.render(); }, apply);
  apply();
  window.MazzHost?.notifyChange(ctl.container);
  ctl.grid.render();
}

// ==================== 对话框 ====================
function openCellFormatDialog(ctl, sel) {
  const m = modal('单元格格式');
  m.body.innerHTML = `
    <div class="set-row"><label>数字格式</label><select id="cf-fmt" class="rb-select">
      <option value="General">常规</option><option value="0.00">数值(2位)</option>
      <option value="#,##0.00">千分位</option><option value="0%">百分比</option>
      <option value="0.00%">百分比(2位)</option><option value='"¥"#,##0.00'>人民币</option>
      <option value="yyyy-mm-dd">日期</option><option value="yyyy-mm-dd hh:mm">日期时间</option>
    </select></div>
    <div class="set-row"><label>文字颜色</label><input type="color" id="cf-color" value="#888888"></div>
    <div class="set-row"><label>填充颜色</label><input type="color" id="cf-fill" value="#fde68a"></div>
    <div class="set-row"><label></label><button id="cf-go" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">应用</button>
    <button id="cf-clear" class="rb-btn" style="flex-direction:row">清除格式</button></div>`;
  m.body.querySelector('#cf-go').addEventListener('click', () => {
    applyStyleToSel(ctl, sel, {
      fmt: m.body.querySelector('#cf-fmt').value,
      color: m.body.querySelector('#cf-color').value,
      fill: m.body.querySelector('#cf-fill').value,
    });
    m.close();
  });
  m.body.querySelector('#cf-clear').addEventListener('click', () => {
    applyStyleToSel(ctl, sel, { fmt: 'General', color: null, fill: null, bold: null, italic: null, underline: null, align: null });
    m.close();
  });
}

function openValidationDialog(ctl, sel) {
  const m = modal('数据验证');
  m.body.innerHTML = `
    <div class="set-row"><label>类型</label><select id="vd-type" class="rb-select">
      <option value="list">下拉列表</option><option value="number">数值范围</option></select></div>
    <div class="set-row" id="vd-list-row"><label>列表值（逗号分隔）</label><input id="vd-list" class="rb-input" placeholder="苹果,香蕉,橙子"></div>
    <div class="set-row" id="vd-num-row" style="display:none"><label>最小</label><input id="vd-min" class="rb-input" type="number" style="width:70px">
    <label>最大</label><input id="vd-max" class="rb-input" type="number" style="width:70px"></div>
    <div class="set-row"><label></label><button id="vd-go" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">应用</button></div>
    <div style="color:var(--fg-dim);font-size:11.5px">列表类型在双击单元格时提供下拉选择；数值范围拒绝越界输入。</div>`;
  m.body.querySelector('#vd-type').addEventListener('change', (e) => {
    m.body.querySelector('#vd-list-row').style.display = e.target.value === 'list' ? 'flex' : 'none';
    m.body.querySelector('#vd-num-row').style.display = e.target.value === 'number' ? 'flex' : 'none';
  });
  m.body.querySelector('#vd-go').addEventListener('click', () => {
    const type = m.body.querySelector('#vd-type').value;
    const rule = type === 'list'
      ? { type: 'list', values: m.body.querySelector('#vd-list').value.split(/[,，]/).map(s => s.trim()).filter(Boolean) }
      : { type: 'number', min: +m.body.querySelector('#vd-min').value || -Infinity, max: +m.body.querySelector('#vd-max').value || Infinity };
    for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) {
      ctl.sheet.validations.set(r + ',' + c, rule);
    }
    toast('数据验证已应用');
    m.close();
  });
}

function openCondFormatDialog(ctl, sel) {
  const m = modal('条件格式');
  m.body.innerHTML = `
    <div class="set-row"><label>规则</label><select id="cf-type" class="rb-select">
      <option value="gt">大于阈值 → 绿</option><option value="lt">小于阈值 → 红</option>
      <option value="eq">等于阈值 → 黄</option><option value="colorscale">色阶（区域内按大小渐变）</option>
    </select></div>
    <div class="set-row" id="cf-th-row"><label>阈值</label><input id="cf-th" class="rb-input" type="number" value="0"></div>
    <div class="set-row"><label></label><button id="cf-go" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">应用</button></div>`;
  m.body.querySelector('#cf-type').addEventListener('change', (e) => {
    m.body.querySelector('#cf-th-row').style.display = e.target.value === 'colorscale' ? 'none' : 'flex';
  });
  m.body.querySelector('#cf-go').addEventListener('click', () => {
    const type = m.body.querySelector('#cf-type').value;
    if (type === 'colorscale') {
      let min = Infinity, max = -Infinity;
      for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) {
        const v = ctl.sheet.computed(r, c);
        if (typeof v === 'number') { min = Math.min(min, v); max = Math.max(max, v); }
      }
      ctl.sheet.condFormats.push({ r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c2, type, a: min, b: max });
    } else {
      ctl.sheet.condFormats.push({ r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c2, type, a: +m.body.querySelector('#cf-th').value });
    }
    ctl.grid.render();
    toast('条件格式已应用');
    m.close();
  });
}

function openFilterPicker(ctl, sel) {
  const sheet = ctl.sheet;
  const col = sel.active.c;
  const values = new Set();
  for (let r = sel.r1 + 1; r <= sel.r2; r++) {
    const v = sheet.computed(r, col);
    values.add(v == null ? '' : String(v));
  }
  const m = modal(`筛选：${numToCol(col)} 列`);
  const vals = [...values].sort();
  m.body.innerHTML = `
    <div style="max-height:40vh;overflow:auto;margin-bottom:10px">
      ${vals.map(v => `<label style="display:flex;gap:8px;padding:3px 0;font-size:12.5px">
        <input type="checkbox" data-v="${escapeAttr(v)}" checked> ${escapeHtml(v) || '（空）'}</label>`).join('')}
    </div>
    <button id="fp-go" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">应用筛选</button>`;
  m.body.querySelector('#fp-go').addEventListener('click', () => {
    const allowed = new Set();
    m.body.querySelectorAll('input[type=checkbox]:checked').forEach(cb => allowed.add(cb.dataset.v));
    sheet.filter.picks.set(col, allowed);
    ctl.grid.render();
    toast('筛选已应用（再次点击「筛选」可取消）');
    m.close();
  });
}

function openFunctionWizard(ctl) {
  const groups = {};
  for (const name of Object.keys(FUNCTIONS).sort()) {
    const g = /SUM|AVERAGE|COUNT|MAX|MIN|MEDIAN|MODE|STDEV|VAR|LARGE|SMALL|RANK|PERCENTILE|QUARTILE/.test(name) ? '统计'
      : /IF|AND|OR|NOT|XOR|IS|SWITCH|TRUE|FALSE|NA/.test(name) ? '逻辑'
      : /DATE|DAY|MONTH|YEAR|TIME|HOUR|MINUTE|SECOND|WEEK|EOMONTH|EDATE|DATEDIF|TODAY|NOW|WORKDAY|NETWORKDAYS|YEARFRAC|DAYS/.test(name) ? '日期'
      : /LEFT|RIGHT|MID|LEN|TRIM|UPPER|LOWER|TEXT|VALUE|FIND|SEARCH|REPLACE|SUBSTITUTE|CONCAT|REPT|CHAR|CODE|EXACT|PROPER|CLEAN|FIXED|T$/.test(name) ? '文本'
      : /VLOOKUP|HLOOKUP|INDEX|MATCH|CHOOSE|ROW|COLUMN|TRANSPOSE|SHEET/.test(name) ? '查找' : '数学';
    (groups[g] = groups[g] || []).push(name);
  }
  const m = modal('插入函数');
  m.body.innerHTML = `
    <input class="rb-input" id="fw-q" placeholder="搜索函数…" style="width:100%;margin-bottom:8px">
    <div id="fw-list" style="max-height:46vh;overflow:auto"></div>`;
  const list = m.body.querySelector('#fw-list');
  const render = (q = '') => {
    list.innerHTML = Object.entries(groups).map(([g, names]) => `
      <div style="font-weight:600;margin:8px 0 4px">${g}</div>
      ${names.filter(n => !q || n.includes(q.toUpperCase())).map(n =>
        `<button class="rb-btn" style="flex-direction:row;min-width:110px;margin:2px" data-fn="${n}">${n}</button>`).join('')}
    `).join('');
    list.querySelectorAll('[data-fn]').forEach(btn => btn.addEventListener('click', () => {
      const sel = ctl.grid.sel;
      ctl.grid.startEdit(sel.active.r, sel.active.c, '=' + btn.dataset.fn + '(');
      m.close();
    }));
  };
  m.body.querySelector('#fw-q').addEventListener('input', (e) => render(e.target.value));
  render();
}

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
