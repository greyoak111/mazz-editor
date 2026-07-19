// renderer/modules/markdown/index.js —— 文档编辑内核（ProseMirror 自建 · WYSIWYG Markdown）
// 契约 v1 + contributes：输入规则 / 全快捷键 / 工具栏 / Markdown 双向序列化 / 链接气泡 / 查找替换
import { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap as pmKeymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import {
  toggleMark, setBlockType, wrapIn, chainCommands, deleteSelection,
  joinBackward, joinForward, selectNodeBackward, selectNodeForward,
  newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock, exitCode,
  baseKeymap,
} from 'prosemirror-commands';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { inputRules, InputRule } from 'prosemirror-inputrules';
import { Slice } from 'prosemirror-model';
import { schema, parseMarkdown, serializeMarkdown } from './schema.js';
import { buildInputRules, buildMarkRules } from './inputrules.js';
import { findPlugin, FindReplaceBar } from './find-replace.js';
import { linkBubblePlugin } from './link-bubble.js';
import { tablePlugins, tableCommands } from './tables.js';
import { openPagePreview, openPageSetupDialog, extractPageSetup, serializePageSetup, extractHeadings, DEFAULT_SETUP, TocPanel } from './paginate.js';
import { exportDocx } from './docx-io.js';
import { CommentsPanel } from './comments.js';
import { inputModal, modal, toast as shellToast } from '../../shell/shell.js';
import { calcBlockPlugin } from './calc-block.js';
import { FontFamilyPicker, FontSizePicker, ColorPicker } from '../../shell/pickers.js';
import { contextKeys } from '../../core/contextkey-service.js';
import { menus } from '../../core/menu-service.js';

// —— 行内标记输入规则（**粗** *斜* `码` ~~删~~）——
function markInputRule(regexp, markType) {
  return new InputRule(regexp, (state, match, start, end) => {
    const inner = match[1];
    if (!inner) return null;
    const tr = state.tr.insertText(inner, start, end);
    tr.addMark(start, start + inner.length, markType.create());
    tr.removeStoredMark(markType);
    return tr;
  });
}

const MODULE = 'markdown';
const instances = new Map(); // container -> ctl
let current = null;          // 当前激活的编辑器控制器

function createEditor(container, initialText) {
  const host = document.createElement('div');
  host.className = 'pm-host';
  const page = document.createElement('div');
  page.className = 'pm-page';
  host.appendChild(page);
  container.appendChild(host);
  container.style.position = 'relative';

  const doc = parseMarkdown(initialText || '');
  const state = EditorState.create({
    doc,
    plugins: [
      buildInputRules(schema),
      inputRules({ rules: [
        markInputRule(/\*\*([^*]+)\*\*$/, schema.marks.strong),
        markInputRule(/(?<!\*)\*([^*\n]+)\*$/, schema.marks.em),
        markInputRule(/`([^`]+)`$/, schema.marks.code),
        markInputRule(/~~([^~]+)~~$/, schema.marks.strike),
        ...buildMarkRules(schema), // 全角标记（IME 用户）：＊＊／～～／｀
        // [[双链]] 即时转换：[[笔记]] 或 [[笔记|别名]] → wikilink 原子节点
        new InputRule(/\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]$/,
          (state, match, start, end) => state.tr.replaceWith(start, end,
            schema.nodes.wikilink.create({ target: match[1].trim(), alias: (match[2] || '').trim() }))),
      ] }),
      pmKeymap({
        'Enter': chainCommands(splitListItem(schema.nodes.list_item), newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock),
        'Tab': (s, d) => sinkListItem(schema.nodes.list_item)(s, d) || false,
        'Shift-Tab': (s, d) => liftListItem(schema.nodes.list_item)(s, d) || false,
        'Backspace': chainCommands(deleteSelection, joinBackward, selectNodeBackward),
        'Delete': chainCommands(deleteSelection, joinForward, selectNodeForward),
        'Shift-Enter': chainCommands(exitCode, (s, d) => {
          d && d(s.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
          return true;
        }),
      }),
      pmKeymap(baseKeymap),
      history(),
      ...tablePlugins(),
      calcBlockPlugin(),
      findPlugin(),
      linkBubblePlugin({
        onOpenExternal: (href) => {
          if (window.mazz?.isElectron) window.mazz.invoke('shell:openExternal', { url: href });
          else window.open(href, '_blank', 'noopener');
        },
      }),
      new Plugin({
        key: new PluginKey('mazz-md-hooks'),
        view() {
          return {
            update(view) {
              const { empty } = view.state.selection;
              if (current?.view === view) contextKeys.set('hasSelection', !empty);
              if (view.hasFocus?.() !== false && current?.view === view) scheduleModelPush();
            },
          };
        },
      }),
    ],
  });

  const view = new EditorView(page, {
    state,
    dispatchTransaction(tr) {
      const newState = view.state.apply(tr);
      view.updateState(newState);
      if (tr.docChanged) window.MazzHost?.notifyChange(container);
    },
    // 粘贴 Markdown 纯文本时按 Markdown 解析（Typora 式体验；HTML 粘贴走默认路径）
    handlePaste(view, event, slice) {
      const cd = event.clipboardData;
      if (!cd) return false;
      if (cd.getData('text/html')) return false; // 富文本粘贴走 PM 默认 HTML 解析
      const text = cd.getData('text/plain');
      if (!text) return false;
      const looksLikeMarkdown = /(^#{1,6}\s)|(^#{1,6}[一-鿿])|(^\s*[-*+]\s)|(^\s*>\s?)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~?[^~\n]+~~?)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\n]+\))|(^\s*\d+[.)]\s)/m.test(text);
      if (!looksLikeMarkdown) return false;
      const doc = parseMarkdown(text);
      if (!doc || doc.childCount === 0) return false;
      view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView());
      return true;
    },
    handleDOMEvents: {
      contextmenu(view, event) {
        if (window.mazz?.isElectron) return false; // 主进程原生菜单（拼写建议 + 注册表模型）
        event.preventDefault();
        menus.show('editor/context', { x: event.clientX, y: event.clientY, preferDom: true });
        return true;
      },
      click(view, event) {
        const el = event.target.closest?.('.wikilink');
        if (el) {
          window.MazzNotes?.openWikiLink?.(el.dataset.target);
          return true;
        }
        return false;
      },
      focus() { if (current !== ctl) { current = ctl; contextKeys.set('module', MODULE); } },
    },
  });

  const ctl = {
    view, host, page, container,
    findBar: new FindReplaceBar(view, container),
    tocPanel: null,
    pageSetup: { ...DEFAULT_SETUP },
    getMarkdown: () => serializePageSetup(ctl.pageSetup) + serializeMarkdown(view.state.doc),
    setMarkdown(text) {
      const { setup, body } = extractPageSetup(text || '');
      ctl.pageSetup = setup;
      const newDoc = parseMarkdown(body);
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content);
      tr.setMeta('addToHistory', false);
      view.dispatch(tr);
      ctl.tocPanel?.update();
    },
  };
  // 脚注双击编辑
  view.dom.addEventListener('dblclick', (e) => {
    const sup = e.target.closest('sup.pm-footnote');
    if (!sup) return;
    const pos = view.posAtDOM(sup);
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== 'footnote') return;
    inputModal('脚注内容', node.attrs.note).then(note => {
      if (note == null) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, { note }));
    });
  });
  return ctl;
}

let pushTimer = null;
function scheduleModelPush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => menus.pushModel('editor/context'), 180);
}

// —— 命令操作助手（作用于当前激活编辑器）——
function withView(fn) { return () => { if (current?.view) { fn(current.view); current.view.focus(); } }; }
function toggle(markName) {
  return withView(view => { toggleMark(view.state.schema.marks[markName])(view.state, view.dispatch); });
}

/** 行内样式应用：选区合并 fontStyle attrs（无选区时作用于后续输入） */
function applyFontStyle(patch) {
  if (!current?.view) return;
  const view = current.view;
  const mark = view.state.schema.marks.fontStyle;
  const { from, to, empty } = view.state.selection;
  if (empty) {
    // 无选区：存为 storedMarks
    const cur = view.state.storedMarks?.find(m => m.type === mark);
    const attrs = { ...(cur?.attrs || {}), ...patch };
    view.dispatch(view.state.tr.addStoredMark(mark.create(attrs)));
    view.focus();
    return;
  }
  // 合并范围内已有样式
  let merged = {};
  view.state.doc.nodesBetween(from, to, (node) => {
    node.marks?.forEach(m => { if (m.type === mark) merged = { ...merged, ...m.attrs }; });
  });
  const attrs = { ...merged, ...patch };
  view.dispatch(view.state.tr.addMark(from, to, mark.create(attrs)));
  view.focus();
}

function toggleScript(script) {
  if (!current?.view) return;
  const view = current.view;
  const mark = view.state.schema.marks.fontStyle;
  const { from, to, empty } = view.state.selection;
  let current_script = null;
  view.state.doc.nodesBetween(from, to, (node) => {
    node.marks?.forEach(m => { if (m.type === mark && m.attrs.script) current_script = m.attrs.script; });
  });
  const next = current_script === script ? null : script;
  if (empty) {
    const cur = view.state.storedMarks?.find(m => m.type === mark);
    const attrs = { ...(cur?.attrs || {}), script: next };
    view.dispatch(view.state.tr.addStoredMark(next ? mark.create(attrs) : null));
  } else {
    let merged = {};
    view.state.doc.nodesBetween(from, to, (node) => {
      node.marks?.forEach(m => { if (m.type === mark) merged = { ...merged, ...m.attrs }; });
    });
    const attrs = { ...merged, script: next };
    if (next) view.dispatch(view.state.tr.addMark(from, to, mark.create(attrs)));
    else view.dispatch(view.state.tr.removeMark(from, to, mark));
  }
  view.focus();
}

/** 块级属性应用：作用于选区覆盖的所有文本块 */
function applyBlockAttrs(patch) {
  if (!current?.view) return;
  const view = current.view;
  const { from, to } = view.state.selection;
  const tr = view.state.tr;
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      tr.setNodeMarkup(pos, null, { ...node.attrs, ...patch });
    }
  });
  if (tr.docChanged) view.dispatch(tr);
  view.focus();
}
function selectionSliceMarkdown(view) {
  const { from, to } = view.state.selection;
  const slice = view.state.doc.slice(from, to);
  const doc = schema.nodes.doc.create(null, slice.content);
  return serializeMarkdown(doc);
}
function selectionHTML(view) {
  const { from, to } = view.state.selection;
  const slice = view.state.doc.slice(from, to);
  const { DOMSerializer } = view.state.schema.cached || {};
  return null; // 简化：HTML 由纯文本兜底
}

// ==================== 模块契约 ====================
// —— Word 管线 v1 扩展命令（页面设置/目录/分页/脚注/docx/表格）——
/** Word 样式映射表管理（存 settings word.styleMap，docx 导出时应用；字号单位=磅） */
async function openStyleMapDialog() {
  const { DEFAULT_STYLE_MAP } = await import('./docx-io.js');
  const saved = (await window.mazz.invoke('settings:get', { key: 'word.styleMap' }).catch(() => null)) || {};
  const sm = Object.fromEntries(Object.entries(DEFAULT_STYLE_MAP).map(([k, v]) => [k, { ...v, ...(saved[k] || {}) }]));
  const ROWS = [
    ['h1', '标题 1'], ['h2', '标题 2'], ['h3', '标题 3'], ['h4', '标题 4'],
    ['h5', '标题 5'], ['h6', '标题 6'], ['body', '正文'], ['code', '代码'], ['quote', '引用'],
  ];
  const m = modal('Word 样式映射表');
  m.body.innerHTML = `
    <div style="font-size:12px;color:#83817a;margin-bottom:10px">控制导出 docx 时的默认样式（字号单位：磅；颜色为十六进制，留空继承 Word 默认）</div>
    <table class="sm-table" style="width:100%;border-collapse:collapse;font-size:12.5px">
      <tr style="text-align:left;color:#83817a"><th style="padding:4px">元素</th><th>字号</th><th>加粗</th><th>斜体</th><th>颜色</th><th>字体</th></tr>
      ${ROWS.map(([k, name]) => `
        <tr data-k="${k}">
          <td style="padding:4px">${name}</td>
          <td><input class="rb-input sm-size" type="number" min="6" max="72" value="${(sm[k].size || 21) / 2}" style="width:56px"></td>
          <td style="text-align:center"><input type="checkbox" class="sm-bold" ${sm[k].bold ? 'checked' : ''}></td>
          <td style="text-align:center"><input type="checkbox" class="sm-ital" ${sm[k].italics ? 'checked' : ''}></td>
          <td><input class="rb-input sm-color" value="${sm[k].color || ''}" placeholder="2E74B5" style="width:76px"></td>
          <td><input class="rb-input sm-font" value="${sm[k].font || ''}" placeholder="默认" style="width:110px"></td>
        </tr>`).join('')}
    </table>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button id="sm-reset" class="rb-btn" style="flex-direction:row">恢复默认</button>
      <button id="sm-save" class="rb-btn" style="flex-direction:row">保存</button>
    </div>`;
  const collect = () => {
    const out = {};
    m.body.querySelectorAll('tr[data-k]').forEach(tr => {
      const k = tr.dataset.k;
      out[k] = {
        size: Math.round(parseFloat(tr.querySelector('.sm-size').value || '10.5') * 2),
        bold: tr.querySelector('.sm-bold').checked || undefined,
        italics: tr.querySelector('.sm-ital').checked || undefined,
        color: tr.querySelector('.sm-color').value.trim().replace('#', '') || '',
        font: tr.querySelector('.sm-font').value.trim(),
      };
    });
    return out;
  };
  m.body.querySelector('#sm-save').addEventListener('click', async () => {
    await window.mazz.invoke('settings:set', { key: 'word.styleMap', value: collect() });
    shellToast('样式映射已保存（下次导出 docx 生效）');
    m.close();
  });
  m.body.querySelector('#sm-reset').addEventListener('click', async () => {
    await window.mazz.invoke('settings:set', { key: 'word.styleMap', value: {} });
    shellToast('已恢复默认样式映射');
    m.close();
  });
}

const wordCommands = [
      { id: 'markdown.insertTable', title: '插入表格', icon: '▦', group: '插入',
        when: "module=='markdown'",
        run: withView(view => { tableCommands.insertTable(2, 3)(view.state, view.dispatch); }) },
      { id: 'markdown.tableAddRowBelow', title: '表格：下方插入行', group: '表格',
        when: "module=='markdown'", run: withView(view => tableCommands.addRowAfter(view.state, view.dispatch)) },
      { id: 'markdown.tableAddColRight', title: '表格：右侧插入列', group: '表格',
        when: "module=='markdown'", run: withView(view => tableCommands.addColumnAfter(view.state, view.dispatch)) },
      { id: 'markdown.tableDeleteRow', title: '表格：删除行', group: '表格',
        when: "module=='markdown'", run: withView(view => tableCommands.deleteRow(view.state, view.dispatch)) },
      { id: 'markdown.tableDeleteCol', title: '表格：删除列', group: '表格',
        when: "module=='markdown'", run: withView(view => tableCommands.deleteColumn(view.state, view.dispatch)) },
      { id: 'markdown.tableDelete', title: '表格：删除表格', group: '表格',
        when: "module=='markdown'", run: withView(view => tableCommands.deleteTable(view.state, view.dispatch)) },
      { id: 'markdown.insertFootnote', title: '插入脚注', icon: '†', group: '插入',
        when: "module=='markdown'",
        run: withView(async view => {
          const note = await inputModal('脚注内容');
          if (note == null) return;
          const fn = view.state.schema.nodes.footnote.create({ note });
          view.dispatch(view.state.tr.replaceSelectionWith(fn).scrollIntoView());
        }) },
      { id: 'markdown.toggleToc', title: '目录面板', icon: '≡', group: '视图',
        when: "module=='markdown'",
        run: () => {
          if (!current) return;
          if (current.tocPanel) { current.tocPanel.destroy(); current.tocPanel = null; }
          else {
            const host = current.container;
            host.style.display = 'flex';
            current.host.style.flex = '1';
            current.tocPanel = new TocPanel(current.view, host);
          }
        } },
      // —— Word v2：批注 ——
      { id: 'word.addComment', title: '添加批注', icon: '💬', group: '批注',
        when: "module=='markdown'",
        run: async () => {
          if (!current) return;
          const { state } = current.view;
          const { from, to, empty } = state.selection;
          if (empty) { window.MazzHost?.toast('先选中要批注的文字'); return; }
          const text = await inputModal('添加批注');
          if (!text?.trim()) return;
          const mark = state.schema.marks.comment.create({ text: text.trim() });
          current.view.dispatch(state.tr.addMark(from, to, mark).scrollIntoView());
          current.commentsPanel?.update();
          window.MazzHost?.notifyChange(current.container);
        } },
      { id: 'word.removeComment', title: '删除选区批注', icon: '🗑', group: '批注',
        when: "module=='markdown'",
        run: () => {
          if (!current) return;
          const { state } = current.view;
          const { from, to } = state.selection;
          current.view.dispatch(state.tr.removeMark(from, to, state.schema.marks.comment));
          current.commentsPanel?.update();
          window.MazzHost?.notifyChange(current.container);
        } },
      { id: 'word.toggleComments', title: '批注面板', icon: '💬', group: '视图',
        when: "module=='markdown'",
        run: () => {
          if (!current) return;
          if (current.commentsPanel) { current.commentsPanel.destroy(); current.commentsPanel = null; }
          else {
            const host = current.container;
            host.style.display = 'flex';
            current.host.style.flex = '1';
            current.commentsPanel = new CommentsPanel(current.view, host, {
              onChange: () => window.MazzHost?.notifyChange(current.container),
            });
          }
        } },
      { id: 'word.styleMap', title: 'Word 样式映射…', icon: '🎨', group: '页面',
        when: "module=='markdown'",
        run: () => openStyleMapDialog() },
      { id: 'markdown.pageSetup', title: '页面设置…', icon: '⚙', group: '页面',
        when: "module=='markdown'",
        run: () => {
          if (!current) return;
          openPageSetupDialog(current.pageSetup, (setup) => {
            current.pageSetup = setup;
            window.MazzHost?.notifyChange(current.container);
            window.MazzHost?.toast('页面设置已保存（随文档存储）');
          });
        } },
      { id: 'markdown.pagePreview', title: '分页预览', icon: '📄', group: '页面',
        when: "module=='markdown'",
        run: () => { if (current) openPagePreview(current.view, current.pageSetup); } },
      // —— 字体样式（本机字体库/字号/颜色/突出显示/上下标）——
      { id: 'markdown.setFontFamily', title: '设置字体', group: '格式',
        when: "module=='markdown'", run: (p) => applyFontStyle({ family: p?.family }) },
      { id: 'markdown.setFontSize', title: '设置字号', group: '格式',
        when: "module=='markdown'", run: (p) => applyFontStyle({ size: p?.size }) },
      { id: 'markdown.setFontColor', title: '文字颜色', group: '格式',
        when: "module=='markdown'", run: (p) => applyFontStyle({ color: p?.color }) },
      { id: 'markdown.setHighlight', title: '突出显示', group: '格式',
        when: "module=='markdown'", run: (p) => applyFontStyle({ highlight: p?.color }) },
      { id: 'markdown.setScript', title: '上标/下标', group: '格式',
        when: "module=='markdown'", run: (p) => toggleScript(p?.script) },
      { id: 'markdown.clearTextStyle', title: '清除文本样式', group: '格式',
        when: "module=='markdown'", run: withView(view => {
          const { from, to } = view.state.selection;
          view.dispatch(view.state.tr.removeMark(from, to, view.state.schema.marks.fontStyle));
        }) },
      // —— 块级对齐/缩进/行距/段距 ——
      { id: 'markdown.setAlign', title: '段落对齐', group: '格式',
        when: "module=='markdown'", run: (p) => applyBlockAttrs({ align: p?.align === 'left' ? null : p?.align }) },
      { id: 'markdown.setIndent', title: '首行缩进', group: '格式',
        when: "module=='markdown'", run: (p) => applyBlockAttrs({ indent: p?.indent ? +p.indent : null }) },
      { id: 'markdown.setLineHeight', title: '行距', group: '格式',
        when: "module=='markdown'", run: (p) => applyBlockAttrs({ lineHeight: p?.lineHeight || null }) },
      { id: 'markdown.setSpacingBefore', title: '段前距', group: '格式',
        when: "module=='markdown'", run: (p) => applyBlockAttrs({ spacingBefore: p?.em ?? null }) },
      { id: 'markdown.setSpacingAfter', title: '段后距', group: '格式',
        when: "module=='markdown'", run: (p) => applyBlockAttrs({ spacingAfter: p?.em ?? null }) },

      { id: 'markdown.exportDocx', title: '导出为 Word (docx)', icon: '📦', group: '文件',
        when: "module=='markdown'",
        run: async () => {
          if (!current) return;
          const p = await window.mazz.invoke('dialog:saveFile', {
            defaultPath: '文档.docx',
            filters: [{ name: 'Word 文档', extensions: ['docx'] }],
          });
          if (!p) return;
          window.MazzHost?.toast('正在编译 docx…');
          try {
            const styleMap = await window.mazz.invoke('settings:get', { key: 'word.styleMap' }).catch(() => null) || {};
            const buf = await exportDocx(current.view.state.doc, { setup: current.pageSetup, styleMap });
            const bytes = new Uint8Array(buf);
            let s = '';
            for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
            await window.mazz.invoke('fs:writeFileBase64', { path: p, base64: btoa(s) });
            window.MazzHost?.toast(`docx 已导出：${p.split(/[\\/]/).pop()}`);
          } catch (e) {
            window.MazzHost?.toast('docx 导出失败：' + e.message);
          }
        } },
    ];

export default {
  displayName: 'Markdown 文档',
  icon: 'Ⓜ',

  // —— 生命周期 ——
  create(container) {
    const ctl = createEditor(container, '');
    instances.set(container, ctl);
    return { container };
  },
  activate(container, state) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    contextKeys.set('module', MODULE);
    contextKeys.set('hasSelection', !ctl.view.state.selection.empty);
    scheduleModelPush();
    if (!ctl.view.hasFocus()) ctl.view.focus();
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },

  // —— 内容 ——
  getContent(state) {
    const ctl = instances.get(state.container);
    return ctl ? ctl.getMarkdown() : '';
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    if (data && typeof data === 'object' && data.__docx) {
      window.MazzHost?.toast('正在解析 docx…');
      import('./docx-io.js').then(({ importDocx }) => importDocx(schema, data.__docx)).then(({ doc, warnings }) => {
        const tr = ctl.view.state.tr.replaceWith(0, ctl.view.state.doc.content.size, doc.content);
        tr.setMeta('addToHistory', false);
        ctl.view.dispatch(tr);
        ctl.tocPanel?.update();
        window.MazzHost?.toast(warnings.length ? `docx 已导入（${warnings.length} 条降级提示）` : 'docx 已导入');
      }).catch(e => window.MazzHost?.toast('docx 解析失败：' + e.message));
      return;
    }
    ctl.setMarkdown(typeof data === 'string' ? data : '');
  },
  newDocument(state) { this.setContent('', state); },

  getCharCount(state) {
    const ctl = instances.get(state.container);
    return ctl ? ctl.view.state.doc.textContent.length : 0;
  },
  getCursorPos(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return '';
    const { from } = ctl.view.state.selection;
    const before = ctl.view.state.doc.textBetween(0, from, '\n', '\n');
    const line = before.split('\n').length;
    const col = from - before.lastIndexOf('\n');
    return `行 ${line}，列 ${col}`;
  },

  // —— 工具栏（Ribbon「开始」页由外壳调度）——
  toolbarHTML: `
    <div class="rb-group" data-label="剪贴板">
      <button class="rb-btn" data-command="edit.paste"><i class="ico">📋</i><span>粘贴</span></button>
    </div>
    <div class="rb-group" data-label="字体">
      <div id="md-font-picker"></div>
      <div id="md-size-picker"></div>
      <button class="rb-btn" data-command="markdown.toggleBold"><i class="ico">B</i><span>加粗</span></button>
      <button class="rb-btn" data-command="markdown.toggleItalic"><i class="ico" style="font-style:italic">I</i><span>斜体</span></button>
      <button class="rb-btn" data-command="markdown.toggleStrike"><i class="ico" style="text-decoration:line-through">S</i><span>删除线</span></button>
      <button class="rb-btn" data-command="markdown.toggleInlineCode"><i class="ico">&lt;/&gt;</i><span>行内码</span></button>
      <button class="rb-btn" data-command="markdown.setScript" data-script="sup"><i class="ico">x²</i><span>上标</span></button>
      <button class="rb-btn" data-command="markdown.setScript" data-script="sub"><i class="ico">x₂</i><span>下标</span></button>
    </div>
    <div class="rb-group" data-label="颜色">
      <div id="md-color-picker"></div>
      <div id="md-highlight-picker"></div>
      <button class="rb-btn" data-command="markdown.clearTextStyle"><i class="ico">⌫</i><span>清样式</span></button>
    </div>
    <div class="rb-group" data-label="对齐/行距">
      <button class="rb-btn" data-command="markdown.setAlign" data-align="left"><i class="ico">⇤</i><span>左对齐</span></button>
      <button class="rb-btn" data-command="markdown.setAlign" data-align="center"><i class="ico">↔</i><span>居中</span></button>
      <button class="rb-btn" data-command="markdown.setAlign" data-align="right"><i class="ico">⇥</i><span>右对齐</span></button>
      <button class="rb-btn" data-command="markdown.setAlign" data-align="justify"><i class="ico">☰</i><span>两端</span></button>
      <button class="rb-btn" data-command="markdown.setAlign" data-align="distributed"><i class="ico">⇹</i><span>分散</span></button>
      <select class="rb-select" id="md-lineheight" title="行距">
        <option value="">行距</option><option value="1">1.0</option><option value="1.15">1.15</option>
        <option value="1.5">1.5</option><option value="2">2.0</option><option value="2.5">2.5</option><option value="3">3.0</option>
      </select>
      <button class="rb-btn" data-command="markdown.setIndent" data-indent="2"><i class="ico">⇨</i><span>首行缩进</span></button>
      <button class="rb-btn" data-command="markdown.setIndent" data-indent=""><i class="ico">⇦</i><span>去缩进</span></button>
    </div>
    <div class="rb-group" data-label="段落">
      <select class="rb-select" id="md-blocktype">
        <option value="0">正文</option><option value="1">标题 1</option><option value="2">标题 2</option>
        <option value="3">标题 3</option><option value="4">标题 4</option><option value="5">标题 5</option>
        <option value="6">标题 6</option>
      </select>
      <button class="rb-btn" data-command="markdown.toggleBulletList"><i class="ico">•≡</i><span>无序列表</span></button>
      <button class="rb-btn" data-command="markdown.toggleOrderedList"><i class="ico">1≡</i><span>有序列表</span></button>
      <button class="rb-btn" data-command="markdown.toggleBlockquote"><i class="ico">❝</i><span>引用</span></button>
      <button class="rb-btn" data-command="markdown.setCodeBlock"><i class="ico">{ }</i><span>代码块</span></button>
    </div>
    <div class="rb-group" data-label="插入">
      <button class="rb-btn" data-command="markdown.insertLink"><i class="ico">🔗</i><span>链接</span></button>
      <button class="rb-btn" data-command="markdown.insertImage"><i class="ico">🖼</i><span>图片</span></button>
      <button class="rb-btn" data-command="markdown.insertHr"><i class="ico">―</i><span>分割线</span></button>
      <button class="rb-btn" data-command="markdown.insertTable"><i class="ico">▦</i><span>表格</span></button>
      <button class="rb-btn" data-command="markdown.insertFootnote"><i class="ico">†</i><span>脚注</span></button>
    </div>
    <div class="rb-group" data-label="页面">
      <button class="rb-btn" data-command="markdown.toggleToc"><i class="ico">≡</i><span>目录</span></button>
      <button class="rb-btn" data-command="markdown.pageSetup"><i class="ico">⚙</i><span>页面设置</span></button>
      <button class="rb-btn" data-command="markdown.pagePreview"><i class="ico">📄</i><span>分页预览</span></button>
      <button class="rb-btn" data-command="markdown.exportDocx"><i class="ico">📦</i><span>导出docx</span></button>
    </div>
    <div class="rb-group" data-label="编辑">
      <button class="rb-btn" data-command="edit.find"><i class="ico">🔍</i><span>查找</span></button>
      <button class="rb-btn" data-command="edit.replace"><i class="ico">⇄</i><span>替换</span></button>
      <button class="rb-btn" data-command="edit.undo"><i class="ico">↩</i><span>撤销</span></button>
      <button class="rb-btn" data-command="edit.redo"><i class="ico">↪</i><span>重做</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command, {
        align: btn.dataset.align,
        script: btn.dataset.script,
        indent: btn.dataset.indent,
      }));
    });
    const sel = panel.querySelector('#md-blocktype');
    sel?.addEventListener('change', () => {
      const level = +sel.value;
      window.MazzCommands.execute(level ? 'markdown.setHeading' : 'markdown.setParagraph', { level });
    });
    // 挂载字体/字号/颜色选择器（本机字体库 + 预设 + 自由调节）
    const fp = new FontFamilyPicker(panel.querySelector('#md-font-picker'), {
      onChange: (family) => family && window.MazzCommands.execute('markdown.setFontFamily', { family }),
    });
    const sp = new FontSizePicker(panel.querySelector('#md-size-picker'), {
      onChange: (size) => size && window.MazzCommands.execute('markdown.setFontSize', { size }),
    });
    sp.input.placeholder = '字号';
    sp.input.style.width = '52px';
    const cp = new ColorPicker(panel.querySelector('#md-color-picker'), {
      label: '文字色',
      onChange: (color) => window.MazzCommands.execute('markdown.setFontColor', { color }),
    });
    const hp = new ColorPicker(panel.querySelector('#md-highlight-picker'), {
      label: '突出显示',
      onChange: (color) => window.MazzCommands.execute('markdown.setHighlight', { color }),
    });
    const lh = panel.querySelector('#md-lineheight');
    lh?.addEventListener('change', () => {
      window.MazzCommands.execute('markdown.setLineHeight', { lineHeight: lh.value ? parseFloat(lh.value) : null });
    });
    // 当前选区样式回显（简化：记录到面板引用）
    panel._pickers = { fp, sp, cp, hp };
  },

  // —— 声明式贡献 ——
  contributes: {
    commands: [
      ...wordCommands,
      { id: 'markdown.toggleBold', title: '加粗', icon: 'B', group: '格式',
        when: "module=='markdown'", run: toggle('strong') },
      { id: 'markdown.toggleItalic', title: '斜体', icon: 'I', group: '格式',
        when: "module=='markdown'", run: toggle('em') },
      { id: 'markdown.toggleInlineCode', title: '行内代码', icon: '</>', group: '格式',
        when: "module=='markdown'", run: toggle('code') },
      { id: 'markdown.toggleStrike', title: '删除线', icon: 'S', group: '格式',
        when: "module=='markdown'", run: toggle('strike') },
      { id: 'markdown.clearFormatting', title: '清除格式', group: '格式',
        when: "module=='markdown'", run: withView(view => {
          const { from, to } = view.state.selection;
          const tr = view.state.tr;
          Object.values(view.state.schema.marks).forEach(m => tr.removeMark(from, to, m));
          view.dispatch(tr);
        }) },
      { id: 'markdown.insertLink', title: '插入/编辑链接', icon: '🔗', group: '插入',
        when: "module=='markdown'", run: withView(async view => {
          const url = await inputModal('链接地址', 'https://');
          if (!url) return;
          const mark = view.state.schema.marks.link.create({ href: url });
          const { from, to, empty } = view.state.selection;
          const tr = view.state.tr;
          if (empty) tr.insertText(url, from).addMark(from, from + url.length, mark);
          else tr.addMark(from, to, mark);
          view.dispatch(tr.scrollIntoView());
        }) },
      { id: 'markdown.setParagraph', title: '正文', group: '格式',
        when: "module=='markdown'", run: withView(view => setBlockType(view.state.schema.nodes.paragraph)(view.state, view.dispatch)) },
      ...[1, 2, 3, 4, 5, 6].map(level => ({
        id: `markdown.setHeading${level}`, title: `标题 ${level}`, group: '格式',
        when: "module=='markdown'",
        run: withView(view => setBlockType(view.state.schema.nodes.heading, { level })(view.state, view.dispatch)),
      })),
      { id: 'markdown.setHeading', title: '设置标题级别', when: "module=='markdown'",
        run: (payload) => withView(view => setBlockType(view.state.schema.nodes.heading, { level: payload?.level || 1 })(view.state, view.dispatch))() },
      { id: 'markdown.toggleBulletList', title: '无序列表', icon: '•≡', group: '格式',
        when: "module=='markdown'", run: withView(view => wrapInList(view.state.schema.nodes.bullet_list)(view.state, view.dispatch)) },
      { id: 'markdown.toggleOrderedList', title: '有序列表', icon: '1≡', group: '格式',
        when: "module=='markdown'", run: withView(view => wrapInList(view.state.schema.nodes.ordered_list)(view.state, view.dispatch)) },
      { id: 'markdown.toggleBlockquote', title: '引用', icon: '❝', group: '格式',
        when: "module=='markdown'", run: withView(view => wrapIn(view.state.schema.nodes.blockquote)(view.state, view.dispatch)) },
      { id: 'markdown.setCodeBlock', title: '代码块', icon: '{ }', group: '格式',
        when: "module=='markdown'", run: withView(view => setBlockType(view.state.schema.nodes.code_block)(view.state, view.dispatch)) },
      { id: 'markdown.sinkListItem', title: '列表缩进', group: '格式',
        when: "module=='markdown'", run: withView(view => sinkListItem(view.state.schema.nodes.list_item)(view.state, view.dispatch)) },
      { id: 'markdown.liftListItem', title: '列表提升', group: '格式',
        when: "module=='markdown'", run: withView(view => liftListItem(view.state.schema.nodes.list_item)(view.state, view.dispatch)) },
      { id: 'markdown.insertImage', title: '插入图片', icon: '🖼', group: '插入',
        when: "module=='markdown'", run: async () => {
          if (!current?.view) return;
          const p = await window.mazz?.invoke('dialog:openFile', {
            filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
          }).catch(() => null);
          if (!p) return;
          const src = window.mazz?.isElectron ? `file://${p}` : p;
          const { state } = current.view;
          current.view.dispatch(state.tr.replaceSelectionWith(schema.nodes.image.create({ src, alt: p.split(/[\\/]/).pop() })).scrollIntoView());
          current.view.focus();
        } },
      { id: 'markdown.insertHr', title: '插入分割线', icon: '―', group: '插入',
        when: "module=='markdown'", run: withView(view => {
          const tr = view.state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create());
          view.dispatch(tr.scrollIntoView());
        }) },
      { id: 'markdown.selectNextOccurrence', title: '选中下一个相同词', group: '编辑',
        when: "module=='markdown'", run: withView(view => {
          const { state } = view;
          const { from, to, empty } = state.selection;
          let text, searchFrom;
          if (empty) {
            // 选中当前单词
            const $from = state.doc.resolve(from);
            const start = $from.start();
            const blockText = $from.parent.textBetween(0, $from.parent.content.size, undefined, '\ufffc');
            const off = from - start;
            const re = /[\w\u4e00-\u9fa5]+/g;
            let m;
            while ((m = re.exec(blockText))) {
              if (off >= m.index && off <= m.index + m[0].length) {
                const sel = TextSelection.create(state.doc, start + m.index, start + m.index + m[0].length);
                view.dispatch(state.tr.setSelection(sel));
                return;
              }
            }
            return;
          }
          text = state.doc.textBetween(from, to);
          searchFrom = to;
          const full = state.doc.textBetween(0, state.doc.content.size, '\n', '\n');
          const rel = state.doc.textBetween(0, searchFrom, '\n', '\n').length;
          let idx = full.indexOf(text, rel);
          if (idx < 0) idx = full.indexOf(text); // 回绕
          if (idx >= 0) {
            const sel = TextSelection.create(state.doc, idx, idx + text.length);
            view.dispatch(state.tr.setSelection(sel).scrollIntoView());
          }
        }) },
      { id: 'markdown.copyAsMarkdown', title: '复制为 Markdown 源码', group: '编辑',
        when: "module=='markdown' && hasSelection", run: async () => {
          if (!current?.view) return;
          const md = selectionSliceMarkdown(current.view);
          await window.mazz?.invoke('clipboard:write', { text: md }).catch(() => navigator.clipboard?.writeText(md));
          window.MazzHost?.toast('已复制为 Markdown 源码');
        } },
      { id: 'markdown.copyPlainText', title: '复制为纯文本', group: '编辑',
        when: "module=='markdown' && hasSelection", run: async () => {
          if (!current?.view) return;
          const { from, to } = current.view.state.selection;
          const t = current.view.state.doc.textBetween(from, to, '\n', '\n');
          await window.mazz?.invoke('clipboard:write', { text: t }).catch(() => navigator.clipboard?.writeText(t));
        } },
      { id: 'markdown.pastePlainText', title: '粘贴为纯文本', group: '编辑',
        when: "module=='markdown'", run: async () => {
          if (!current?.view) return;
          let text = '';
          if (window.mazz?.isElectron) text = (await window.mazz.invoke('clipboard:read')).text || '';
          else text = await navigator.clipboard.readText().catch(() => '');
          if (text) current.view.pasteText(text);
          current.view.focus();
        } },
    ],

    keybindings: [
      { command: 'markdown.toggleBold', key: 'ctrl+b', when: "module=='markdown'" },
      { command: 'markdown.toggleItalic', key: 'ctrl+i', when: "module=='markdown'" },
      { command: 'markdown.toggleInlineCode', key: 'ctrl+e', when: "module=='markdown'" },
      { command: 'markdown.toggleStrike', key: 'ctrl+shift+x', when: "module=='markdown'" },
      { command: 'markdown.insertLink', key: 'ctrl+k', when: "module=='markdown'" },
      { command: 'markdown.setParagraph', key: 'ctrl+alt+0', when: "module=='markdown'" },
      { command: 'markdown.setHeading1', key: 'ctrl+alt+1', when: "module=='markdown'" },
      { command: 'markdown.setHeading2', key: 'ctrl+alt+2', when: "module=='markdown'" },
      { command: 'markdown.setHeading3', key: 'ctrl+alt+3', when: "module=='markdown'" },
      { command: 'markdown.setHeading4', key: 'ctrl+alt+4', when: "module=='markdown'" },
      { command: 'markdown.setHeading5', key: 'ctrl+alt+5', when: "module=='markdown'" },
      { command: 'markdown.setHeading6', key: 'ctrl+alt+6', when: "module=='markdown'" },
      { command: 'markdown.toggleBulletList', key: 'ctrl+shift+8', when: "module=='markdown'" },
      { command: 'markdown.toggleOrderedList', key: 'ctrl+shift+9', when: "module=='markdown'" },
      { command: 'markdown.toggleBlockquote', key: 'ctrl+alt+q', when: "module=='markdown'" },
      { command: 'markdown.setCodeBlock', key: 'ctrl+alt+c', when: "module=='markdown'" },
      { command: 'markdown.sinkListItem', key: 'ctrl+]', when: "module=='markdown'" },
      { command: 'markdown.liftListItem', key: 'ctrl+[', when: "module=='markdown'" },
      { command: 'markdown.clearFormatting', key: 'ctrl+shift+l', when: "module=='markdown'" },
      { command: 'markdown.selectNextOccurrence', key: 'ctrl+d', when: "module=='markdown'" },
      { command: 'markdown.copyAsMarkdown', key: 'ctrl+shift+c', when: "module=='markdown'" },
      { command: 'markdown.pastePlainText', key: 'ctrl+shift+v', when: "module=='markdown'" },
      { command: 'edit.undo', key: 'ctrl+z', when: "module=='markdown'" },
      { command: 'edit.redo', key: 'ctrl+y', when: "module=='markdown'" },
      { command: 'edit.redo', key: 'ctrl+shift+z', when: "module=='markdown'" },
      { command: 'edit.find', key: 'ctrl+f', when: "module=='markdown'" },
      { command: 'edit.replace', key: 'ctrl+h', when: "module=='markdown'" },
      { command: 'edit.findNext', key: 'f3', when: "module=='markdown'" },
      { command: 'edit.findPrev', key: 'shift+f3', when: "module=='markdown'" },
    ],

    menus: {
      // 1/2 号上下文：文档（有/无选区由 when 分流）
      'editor/context': [
        { command: 'edit.cut', title: '剪切', when: 'hasSelection', group: '1_clip' },
        { command: 'edit.copy', title: '复制', when: 'hasSelection', group: '1_clip' },
        { command: 'edit.paste', title: '粘贴', group: '1_clip' },
        { command: 'markdown.copyAsMarkdown', title: '复制为 Markdown', when: 'hasSelection', group: '1_clip' },
        { command: 'markdown.copyPlainText', title: '复制纯文本', when: 'hasSelection', group: '1_clip' },
        { command: 'markdown.pastePlainText', title: '粘贴为纯文本', when: '!hasSelection', group: '1_clip' },
        { command: 'edit.selectAll', title: '全选', when: '!hasSelection', group: '1_clip' },
        { command: 'markdown.toggleBold', title: '加粗', when: 'hasSelection', group: '2_format' },
        { command: 'markdown.toggleItalic', title: '斜体', when: 'hasSelection', group: '2_format' },
        { command: 'markdown.toggleStrike', title: '删除线', when: 'hasSelection', group: '2_format' },
        { command: 'markdown.toggleInlineCode', title: '行内代码', when: 'hasSelection', group: '2_format' },
        { command: 'markdown.insertLink', title: '插入链接', when: 'hasSelection', group: '3_insert' },
        { command: 'markdown.insertImage', title: '插入图片', when: '!hasSelection', group: '3_insert' },
        { command: 'markdown.setCodeBlock', title: '插入代码块', when: '!hasSelection', group: '3_insert' },
        { command: 'markdown.insertHr', title: '插入分割线', when: '!hasSelection', group: '3_insert' },
        { command: 'markdown.insertTable', title: '插入表格', when: '!hasSelection', group: '3_insert' },
        { command: 'markdown.insertFootnote', title: '插入脚注', when: '!hasSelection', group: '3_insert' },
        { command: 'markdown.tableAddRowBelow', title: '表格：下方插入行', when: 'hasSelection', group: '4_table' },
        { command: 'markdown.tableAddColRight', title: '表格：右侧插入列', when: 'hasSelection', group: '4_table' },
        { command: 'markdown.tableDeleteRow', title: '表格：删除行', when: 'hasSelection', group: '4_table' },
        { command: 'markdown.tableDelete', title: '表格：删除表格', when: 'hasSelection', group: '4_table' },
        { command: 'edit.find', title: '查找…', group: '5_tool' },
        { command: 'file.print', title: '打印…', when: '!hasSelection', group: '5_tool' },
        { command: 'markdown.exportDocx', title: '导出为 Word (docx)', group: '5_tool' },
        { command: 'ai.placeholder', title: 'AI ▸（未配置）', group: '6_ai' },
      ],
    },

    bridges: [],
    aiActions: [],
  },
};

// —— 通用编辑命令（撤销/重做/剪贴板/查找），markdown 与 text 模块共用 ——
export function registerSharedEditCommands(MazzCommands) {
  MazzCommands.register('edit.undo', { title: '撤销', group: '编辑', when: "module=='markdown'", run: withView(view => undo(view.state, view.dispatch)) });
  MazzCommands.register('edit.redo', { title: '重做', group: '编辑', when: "module=='markdown'", run: withView(view => redo(view.state, view.dispatch)) });
  MazzCommands.register('edit.find', { title: '查找', icon: '🔍', group: '编辑', when: "module=='markdown'", run: () => current?.findBar.open(false) });
  MazzCommands.register('edit.replace', { title: '替换', icon: '⇄', group: '编辑', when: "module=='markdown'", run: () => current?.findBar.open(true) });
  MazzCommands.register('edit.findNext', { title: '查找下一个', group: '编辑', when: "module=='markdown'", run: () => current?.findBar.next() });
  MazzCommands.register('edit.findPrev', { title: '查找上一个', group: '编辑', when: "module=='markdown'", run: () => current?.findBar.prev() });
  MazzCommands.register('edit.cut', { title: '剪切', group: '编辑', when: "module=='markdown' && hasSelection", run: async () => {
    if (!current?.view) return;
    const view = current.view;
    const { from, to } = view.state.selection;
    const t = view.state.doc.textBetween(from, to, '\n', '\n');
    await window.mazz?.invoke('clipboard:write', { text: t }).catch(() => navigator.clipboard?.writeText(t));
    view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
    view.focus();
  } });
  MazzCommands.register('edit.copy', { title: '复制', group: '编辑', when: "module=='markdown' && hasSelection", run: async () => {
    if (!current?.view) return;
    const { from, to } = current.view.state.selection;
    const t = current.view.state.doc.textBetween(from, to, '\n', '\n');
    await window.mazz?.invoke('clipboard:write', { text: t }).catch(() => navigator.clipboard?.writeText(t));
  } });
  MazzCommands.register('edit.paste', { title: '粘贴', icon: '📋', group: '编辑', when: "module=='markdown'", run: async () => {
    if (!current?.view) return;
    const clip = window.mazz?.isElectron
      ? await window.mazz.invoke('clipboard:read')
      : { text: await navigator.clipboard.readText().catch(() => '') };
    if (clip.html) current.view.pasteHTML(clip.html);
    else if (clip.text) current.view.pasteText(clip.text);
    current.view.focus();
  } });
  MazzCommands.register('edit.selectAll', { title: '全选', group: '编辑', when: "module=='markdown'", run: withView(view => {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 0, view.state.doc.content.size)));
  }) });
}
