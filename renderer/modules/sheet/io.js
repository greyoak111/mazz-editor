// renderer/modules/sheet/io.js —— CSV/TSV/HTML 表格互粘 + xlsx 进出（SheetJS 导入 / ExcelJS 导出）
import { numToCol } from './formula/engine.js';
import { formatValue } from './format.js';

// ==================== CSV / TSV ====================
export function parseCsv(text, delim = ',') {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      rows.push(row); row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export function toDelimited(rows, delim = ',') {
  return rows.map(row => row.map(v => {
    const s = v == null ? '' : String(v);
    return /["\n\r,]/.test(s) || (delim === '\t' && /\t/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(delim)).join('\r\n');
}

// ==================== Excel 互粘（TSV + HTML table） ====================
export function selectionToTsv(sheet, r1, c1, r2, c2) {
  const rows = [];
  for (let r = r1; r <= r2; r++) {
    const line = [];
    for (let c = c1; c <= c2; c++) {
      const cell = sheet.get(r, c);
      const v = sheet.computed(r, c);
      line.push(v == null ? '' : formatValue(v, cell?.s?.fmt));
    }
    rows.push(line);
  }
  return toDelimited(rows, '\t');
}

export function selectionToHtmlTable(sheet, r1, c1, r2, c2) {
  let html = '<table>';
  for (let r = r1; r <= r2; r++) {
    html += '<tr>';
    for (let c = c1; c <= c2; c++) {
      const cell = sheet.get(r, c);
      const v = sheet.computed(r, c);
      const txt = v == null ? '' : formatValue(v, cell?.s?.fmt);
      const style = [];
      if (cell?.s?.bold) style.push('font-weight:bold');
      if (cell?.s?.italic) style.push('font-style:italic');
      if (cell?.s?.color) style.push(`color:${cell.s.color}`);
      if (cell?.s?.fill) style.push(`background:${cell.s.fill}`);
      html += `<td${style.length ? ` style="${style.join(';')}"` : ''}>${escapeHtml(txt)}</td>`;
    }
    html += '</tr>';
  }
  return html + '</table>';
}

export function pasteTextToCells(text) {
  // TSV（Excel/WPS 复制的纯文本形态）
  return parseCsv(text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), '\t');
}

export function pasteHtmlToCells(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = [];
  const table = doc.querySelector('table');
  if (!table) return rows;
  for (const tr of table.querySelectorAll('tr')) {
    const line = [];
    for (const td of tr.querySelectorAll('td,th')) {
      line.push(td.textContent);
    }
    rows.push(line);
  }
  return rows;
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ==================== xlsx 导入（SheetJS，动态加载） ====================
export async function importXlsx(workbook, data) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(data, { type: 'array', cellFormula: true, cellDates: false, raw: true });
  const { Workbook, Sheet } = await import('./model.js');
  const out = new Workbook();
  out.sheets = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const sheet = new Sheet(name);
    const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
    if (range) {
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (!cell) continue;
          const rr = r + 1, cc = c + 1;
          if (cell.f) sheet.setRaw(rr, cc, '=' + cell.f);
          else if (cell.v != null) {
            if (cell.t === 'd' && cell.v instanceof Date) {
              sheet.setRaw(rr, cc, Math.round((cell.v.getTime() / 86400000) + 25569 + (cell.v.getTimezoneOffset() / 1440) * -1));
            } else sheet.setRaw(rr, cc, cell.v);
          }
        }
      }
      sheet.maxRow = Math.max(sheet.maxRow, range.e.r + 1);
      sheet.maxCol = Math.max(sheet.maxCol, range.e.c + 1);
    }
    if (ws['!merges']) {
      for (const m of ws['!merges']) {
        sheet.merges.push({ r1: m.s.r + 1, c1: m.s.c + 1, r2: m.e.r + 1, c2: m.e.c + 1 });
      }
    }
    if (ws['!cols']) {
      ws['!cols'].forEach((col, i) => { if (col?.wpx) sheet.colW.set(i + 1, col.wpx); });
    }
    sheet._wb = out;
    out.sheets.push(sheet);
  }
  if (!out.sheets.length) out.sheets = [new Sheet('Sheet1')];
  for (const s of out.sheets) s._wb = out;
  out.active = 0;
  return out;
}

// ==================== xlsx 导出（ExcelJS，动态加载；写样式） ====================
export async function exportXlsx(workbook, { chartImages = [] } = {}) {
  const mod = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  for (const sheet of workbook.sheets) {
    const ws = wb.addWorksheet(sheet.name);
    for (const [k, cell] of sheet.cells) {
      const [r, c] = k.split(',').map(Number);
      const ec = ws.getCell(r, c);
      const v = sheet.computed(r, c);
      if (cell.f) {
        ec.value = { formula: cell.f.slice(1), result: (v != null && typeof v !== 'object') ? v : undefined };
      } else if (v != null && typeof v !== 'object') {
        ec.value = v;
      }
      const s = cell.s || {};
      if (s.bold || s.italic || s.underline || s.color || s.font || s.size) {
        ec.font = {
          bold: !!s.bold, italic: !!s.italic, underline: !!s.underline,
          color: s.color ? { argb: 'FF' + s.color.replace('#', '') } : undefined,
          name: s.font || undefined,
          size: s.size || undefined,
        };
      }
      if (s.fill) ec.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + s.fill.replace('#', '') } };
      if (s.align || s.valign) ec.alignment = { horizontal: s.align || undefined, vertical: s.valign === 'middle' ? 'middle' : s.valign === 'bottom' ? 'bottom' : 'top' };
      if (s.fmt && s.fmt !== 'General') ec.numFmt = s.fmt;
      if (s.border && s.border !== 'none') {
        const st = s.border === 'medium' ? 'medium' : 'thin';
        ec.border = {
          top: { style: st }, left: { style: st },
          bottom: { style: st }, right: { style: st },
        };
      }
    }
    for (const m of sheet.merges) ws.mergeCells(m.r1, m.c1, m.r2, m.c2);
    for (const [c, w] of sheet.colW) ws.getColumn(c).width = w / 7.2;
    if (sheet.freezeR || sheet.freezeC) {
      ws.views = [{ state: 'frozen', xSplit: sheet.freezeC, ySplit: sheet.freezeR }];
    }
  }
  // 图表导出为静态图（ECharts getDataURL 传入）
  for (const img of chartImages) {
    const ws = wb.getWorksheet(img.sheet || 1) || wb.worksheets[0];
    if (!ws) continue;
    const imageId = wb.addImage({ base64: img.dataUrl.split(',')[1], extension: 'png' });
    ws.addImage(imageId, { tl: { col: img.col || 1, row: img.row || 1 }, ext: { width: img.width || 480, height: img.height || 300 } });
  }
  return wb.xlsx.writeBuffer();
}
