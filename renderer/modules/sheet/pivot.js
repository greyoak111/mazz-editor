// renderer/modules/sheet/pivot.js —— 透视表基础版（行/列/值聚合；高级透视 → 桥接 Python，远期）
import { numToCol } from './formula/engine.js';
import { modal } from '../../shell/shell.js';

const AGGS = [['sum', '求和'], ['count', '计数'], ['avg', '平均'], ['max', '最大'], ['min', '最小']];

/** 打开透视配置面板；onDone(config) */
export function openPivotDialog(sheet, sel) {
  const m = modal('插入透视表');
  const cols = [];
  for (let c = sel.c1; c <= sel.c2; c++) cols.push(c);
  const colLabel = (c) => {
    const v = sheet.computed(sel.r1, c);
    return v != null ? String(v) : `列 ${numToCol(c)}`;
  };
  m.body.innerHTML = `
    <div class="set-row"><label>行字段</label><select id="pv-row" class="rb-select">
      ${cols.map(c => `<option value="${c}">${escapeHtml(colLabel(c))}</option>`).join('')}</select></div>
    <div class="set-row"><label>列字段（可选）</label><select id="pv-col" class="rb-select">
      <option value="">（无）</option>${cols.map(c => `<option value="${c}">${escapeHtml(colLabel(c))}</option>`).join('')}</select></div>
    <div class="set-row"><label>值字段</label><select id="pv-val" class="rb-select">
      ${cols.map(c => `<option value="${c}">${escapeHtml(colLabel(c))}</option>`).join('')}</select></div>
    <div class="set-row"><label>聚合方式</label><select id="pv-agg" class="rb-select">
      ${AGGS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>
    <div class="set-row"><label></label><button id="pv-go" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">生成透视表</button></div>
    <div style="color:var(--fg-dim);font-size:11.5px">数据区：R${sel.r1 + 1}:R${sel.r2}（首行作字段名）· 输出到新工作表</div>`;
  return new Promise((resolve) => {
    m.body.querySelector('#pv-go').addEventListener('click', () => {
      const config = {
        rowCol: +m.body.querySelector('#pv-row').value,
        colCol: m.body.querySelector('#pv-col').value ? +m.body.querySelector('#pv-col').value : null,
        valCol: +m.body.querySelector('#pv-val').value,
        agg: m.body.querySelector('#pv-agg').value,
      };
      m.close();
      resolve(config);
    });
  });
}

/** 执行透视：返回 {headers:[...], rows:[[...]], title} */
export function runPivot(sheet, sel, config) {
  const { rowCol, colCol, valCol, agg } = config;
  const buckets = new Map(); // rowKey -> colKey -> number[]
  const rowKeys = [];
  const colKeys = new Set();
  for (let r = sel.r1 + 1; r <= sel.r2; r++) {
    const rk = String(sheet.computed(r, rowCol) ?? '（空）');
    const ck = colCol ? String(sheet.computed(r, colCol) ?? '（空）') : '值';
    const v = sheet.computed(r, valCol);
    if (!buckets.has(rk)) { buckets.set(rk, new Map()); rowKeys.push(rk); }
    const bm = buckets.get(rk);
    if (!bm.has(ck)) bm.set(ck, []);
    if (typeof v === 'number') bm.get(ck).push(v);
    colKeys.add(ck);
  }
  const cols = [...colKeys].sort();
  const aggregate = (arr) => {
    if (!arr?.length) return agg === 'count' ? 0 : '';
    switch (agg) {
      case 'sum': return arr.reduce((p, c) => p + c, 0);
      case 'count': return arr.length;
      case 'avg': return arr.reduce((p, c) => p + c, 0) / arr.length;
      case 'max': return Math.max(...arr);
      case 'min': return Math.min(...arr);
      default: return '';
    }
  };
  const headers = ['', ...cols];
  const rows = rowKeys.sort().map(rk => {
    const bm = buckets.get(rk);
    return [rk, ...cols.map(ck => aggregate(bm.get(ck)))];
  });
  const title = `${AGGS.find(([v]) => v === agg)[1]} · 按「${String(sheet.computed(sel.r1, rowCol) ?? numToCol(rowCol))}」${colCol ? ` ×「${String(sheet.computed(sel.r1, colCol) ?? numToCol(colCol))}」` : ''}`;
  return { headers, rows, title };
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
