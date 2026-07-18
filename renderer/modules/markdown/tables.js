// renderer/modules/markdown/tables.js —— 文档内表格：prosemirror-tables + 管道表双向序列化
import { tableNodes, tableEditing, columnResizing } from 'prosemirror-tables';
import {
  addRowBefore, addRowAfter, addColumnBefore, addColumnAfter,
  deleteRow, deleteColumn, deleteTable, toggleHeaderRow, toggleHeaderColumn,
} from 'prosemirror-tables';

// ==================== schema 扩展 ====================
export function tableSchemaNodes() {
  return tableNodes({
    tableGroup: 'block',
    cellContent: 'block+',
    cellAttributes: {},
  });
}

// ==================== 插件 ====================
export function tablePlugins() {
  return [
    tableEditing(),
    columnResizing({ cellMinWidth: 40 }),
  ];
}

// ==================== 管道表 → PM Doc 段（前处理拼接） ====================
const PIPE_ROW = /^\s*\|(.+)\|\s*$/;
const PIPE_DELIM = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

/** 把 markdown 文本拆成 [文本段, 表格段, 文本段, …] */
export function splitPipeTables(text) {
  const lines = String(text).split('\n');
  const parts = [];
  let buf = [];
  let i = 0;
  const flushText = () => { if (buf.length) { parts.push({ type: 'text', text: buf.join('\n') }); buf = []; } };
  while (i < lines.length) {
    const line = lines[i];
    if (PIPE_ROW.test(line) && i + 1 < lines.length && PIPE_DELIM.test(lines[i + 1])) {
      // 表格起点（表头行 + 分隔行）
      flushText();
      const rows = [line];
      i += 2; // 跳过分隔行
      while (i < lines.length && PIPE_ROW.test(lines[i])) { rows.push(lines[i]); i++; }
      parts.push({ type: 'table', rows });
      continue;
    }
    buf.push(line);
    i++;
  }
  flushText();
  return parts;
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim().replace(/\\\|/g, '|'));
}

/** 表格段 → table 节点 */
export function tableNodeFromRows(schema, rows) {
  const T = schema.nodes;
  const trs = rows.map((rowLine, ri) => {
    const cells = splitRow(rowLine).map(text => {
      const type = ri === 0 ? T.table_header : T.table_cell;
      return type.create(null, text ? T.paragraph.create(null, schema.text(text)) : T.paragraph.create());
    });
    return T.table_row.create(null, cells);
  });
  return T.table.create(null, trs);
}

// ==================== table 节点 → 管道表（序列化覆写） ====================
export const tableSerializers = {
  table(state, node) {
    state.wrapBlock('\n', null, node, () => {
      node.forEach((row, _o, ri) => {
        const cells = [];
        row.forEach(cell => {
          const text = cell.textContent.replace(/\|/g, '\\|').replace(/\n/g, ' ');
          cells.push(' ' + text + ' ');
        });
        state.write('|' + cells.join('|') + '|\n');
        if (ri === 0) {
          state.write('|' + cells.map(() => ' --- ').join('|') + '|\n');
        }
      });
    });
    state.closeBlock(node);
  },
  table_row() {},
  table_cell() {},
  table_header() {},
};

// ==================== 命令 ====================
export const tableCommands = {
  insertTable: (rows = 2, cols = 3) => (state, dispatch) => {
    const T = state.schema.nodes;
    const trs = [];
    for (let r = 0; r < rows + 1; r++) { // +1 表头
      const cells = [];
      for (let c = 0; c < cols; c++) {
        const type = r === 0 ? T.table_header : T.table_cell;
        cells.push(type.create(null, T.paragraph.create()));
      }
      trs.push(T.table_row.create(null, cells));
    }
    const table = T.table.create(null, trs);
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(table).scrollIntoView());
    }
    return true;
  },
  addRowBefore, addRowAfter, addColumnBefore, addColumnAfter,
  deleteRow, deleteColumn, deleteTable, toggleHeaderRow, toggleHeaderColumn,
};
