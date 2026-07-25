// renderer/modules/sheet/print.js —— 表格打印预览：用区提取 + 行分页 + 表头重复 + 超宽缩放
import { PAGE_SIZES, normalizeMargins } from '../markdown/paginate.js';
import { openPrintPreview } from '../../lib/print-preview.js';

const ROW_MM = 7;      // 行高估值
const COL_MM = 24;     // 列宽估值

/** 计算有效用区（去掉末尾空行空列） */
export function usedRange(sheet) {
  let maxR = 0, maxC = 0;
  for (let r = 1; r <= sheet.maxRow; r++) {
    for (let c = 1; c <= sheet.maxCol; c++) {
      const v = sheet.computed(r, c);
      if (v !== null && v !== undefined && v !== '') { maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); }
    }
  }
  return { maxR, maxC };
}

function colName(c) { let s = ''; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

/** 分页：返回每页 innerHTML */
export function buildSheetPages(sheet, setup) {
  const { maxR, maxC } = usedRange(sheet);
  if (!maxR) return [];
  const size = PAGE_SIZES[setup.size] || PAGE_SIZES.A4;
  const [pw, ph] = setup.orientation === 'portrait' ? [size.w, size.h] : [size.h, size.w];
  const mg = normalizeMargins(setup);
  const contentW = pw - mg.left - mg.right;
  const contentH = ph - mg.top - mg.bottom;
  const rowsPerPage = Math.max(1, Math.floor((contentH - ROW_MM * 2) / ROW_MM));
  const scale = Math.min(1, contentW / (maxC * COL_MM + 10));

  const header = `<tr><th style="min-width:8mm"></th>${Array.from({ length: maxC }, (_, i) => `<th>${colName(i + 1)}</th>`).join('')}</tr>`;
  const pages = [];
  for (let r1 = 1; r1 <= maxR; r1 += rowsPerPage) {
    const r2 = Math.min(maxR, r1 + rowsPerPage - 1);
    const rows = [];
    for (let r = r1; r <= r2; r++) {
      rows.push(`<tr><th>${r}</th>${Array.from({ length: maxC }, (_, i) => {
        const v = sheet.computed(r, i + 1);
        return `<td>${v == null ? '' : esc(String(v))}</td>`;
      }).join('')}</tr>`);
    }
    pages.push(`<div style="transform:scale(${scale});transform-origin:top left${scale < 1 ? `;width:${100 / scale}%` : ''}">
      <table>${header}${rows.join('')}</table></div>`);
  }
  return pages;
}

/** 入口：表格打印预览 */
export function openSheetPrintPreview(ctl, title) {
  const setup = ctl.printSetup || (ctl.printSetup = { size: 'A4', orientation: 'landscape', margins: { top: 15, right: 15, bottom: 15, left: 15 }, pageno: true });
  openPrintPreview({
    title: title || '工作表',
    setup,
    buildPages: (s) => { Object.assign(setup, s); return buildSheetPages(ctl.sheet, s); },
  });
}

function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
