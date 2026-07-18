// renderer/modules/markdown/schema.js —— ProseMirror 自建内核：schema + Markdown 双向序列化
// 基准：prosemirror-markdown 1.13.x（tokens 基准名注册 em/s/strong）
// 扩展：删除线 / 文档内表格（管道表）/ 脚注（[^1]）
import { Schema } from 'prosemirror-model';
import {
  schema as baseSchema,
  defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer, MarkdownSerializerState,
} from 'prosemirror-markdown';
import { tableSchemaNodes, splitPipeTables, tableNodeFromRows, tableSerializers } from './tables.js';
import { footnoteNode, footnoteRefPlugin, footnoteTokenHandler, footnoteSerializer, extractFootnoteDefs, setParseDefs, appendFootnoteDefs } from './footnotes.js';
import { fontStyleMark, fontStylePlugin, fontStyleTokens, fontStyleSerializer, blockNodeSpec, extractBlockHints, applyBlockHintsToDoc, injectBlockHintsToMd } from './textstyle.js';

// —— schema：基础 + 删除线 mark + 脚注 inline node + 双链 inline node + 表格节点 ——
const strikeMark = {
  parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' },
    { style: 'text-decoration', getAttrs: v => v.includes('line-through') && null }],
  toDOM: () => ['s', 0],
};

// 批注 mark（CriticMarkup 风格 {==正文==}{>>批注<<} 内联自足）
export const commentMark = {
  attrs: { id: { default: '' }, text: { default: '' } },
  inclusive: false,
  parseDOM: [{
    tag: 'span.pm-comment',
    getAttrs: dom => ({ id: dom.dataset.id || '', text: dom.dataset.text || '' }),
  }],
  toDOM: m => ['span', {
    class: 'pm-comment', 'data-id': m.attrs.id, 'data-text': m.attrs.text,
    title: '批注：' + m.attrs.text,
  }, 0],
};

// {==正文==}{>>批注<<} 行内规则
export function commentPlugin(md) {
  md.inline.ruler.push('comment', (state, silent) => {
    const src = state.src.slice(state.pos);
    const m = /^\{==([^=\n]+)==\}\{>>([^\n]+?)<<\}/.exec(src);
    if (!m) return false;
    if (!silent) {
      const open = state.push('comment_open', 'span', 1);
      open.attrs = { id: '', text: m[2] };
      const t = state.push('text', '', 0);
      t.content = m[1];
      state.push('comment_close', 'span', -1);
    }
    state.pos += m[0].length;
    return true;
  });
}
export const commentTokens = {
  comment: { mark: 'comment', getAttrs: (tok) => tok.attrs },
};
export const commentSerializer = {
  open: '{==',
  close: (state, mark) => `==}{>>${mark.attrs.text}<<}`,
};

// [[双链]] inline 原子节点：整体选中/删除，点击经全局 MazzNotes 钩子打开
export const wikilinkNode = {
  attrs: { target: { default: '' }, alias: { default: '' } },
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  parseDOM: [{
    tag: 'span.wikilink',
    getAttrs: dom => ({ target: dom.dataset.target || '', alias: dom.dataset.alias || '' }),
  }],
  toDOM: node => ['span', {
    class: 'wikilink', 'data-target': node.attrs.target, 'data-alias': node.attrs.alias,
    title: '打开笔记：' + node.attrs.target,
  }, node.attrs.alias || node.attrs.target],
};

export const schema = new Schema({
  nodes: baseSchema.spec.nodes
    .update('paragraph', blockNodeSpec(baseSchema.spec.nodes.get('paragraph'), 'p'))
    .update('heading', blockNodeSpec(baseSchema.spec.nodes.get('heading'), (node) => 'h' + node.attrs.level))
    .append(footnoteNode)
    .append({ wikilink: wikilinkNode })
    .append(tableSchemaNodes()),
  marks: baseSchema.spec.marks
    .addToEnd('strike', strikeMark)
    .addToEnd('comment', commentMark)
    .addToEnd('fontStyle', fontStyleMark),
});

// —— 解析：markdown-it（strikethrough + 脚注行内规则 + span/sup/sub 样式 + [[双链]]）→ PM Doc ——
const tokenizer = defaultMarkdownParser.tokenizer;
tokenizer.enable('strikethrough');
tokenizer.use(footnoteRefPlugin);
tokenizer.use(fontStylePlugin);
tokenizer.use(wikilinkPlugin);
tokenizer.use(commentPlugin);

export const mdParser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  s: { mark: 'strike' },
  ...footnoteTokenHandler,
  ...fontStyleTokens,
  ...commentTokens,
  wikilink: { node: 'wikilink', getAttrs: (tok) => tok.attrs },
});

// [[target]] / [[target|alias]] 行内规则
function wikilinkPlugin(md) {
  md.inline.ruler.push('wikilink', (state, silent) => {
    const src = state.src.slice(state.pos);
    const m = /^\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/.exec(src);
    if (!m) return false;
    if (!silent) {
      const token = state.push('wikilink', 'span', 0);
      token.attrs = { target: m[1].trim(), alias: (m[2] || '').trim() };
    }
    state.pos += m[0].length;
    return true;
  });
}

// —— 序列化：PM Doc → Markdown ——
export const mdSerializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, ...tableSerializers },
  {
    ...defaultMarkdownSerializer.marks,
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    comment: { open: commentSerializer.open, close: commentSerializer.close, mixable: false },
    fontStyle: fontStyleSerializer.fontStyle,
  },
);
// 脚注序列化挂到节点表
mdSerializer.nodes.footnote = footnoteSerializer.footnote;
// 双链序列化：[[target]] 或 [[target|alias]]
mdSerializer.nodes.wikilink = (state, node) => {
  const { target, alias } = node.attrs;
  state.write(alias && alias !== target ? `[[${target}|${alias}]]` : `[[${target}]]`);
};

export function parseMarkdown(text) {
  const { body: hinted, hints } = extractBlockHints(text || '');
  const { body, defs } = extractFootnoteDefs(hinted);
  setParseDefs(defs);
  const parts = splitPipeTables(body);
  let doc;
  if (parts.length === 1 && parts[0].type === 'text') {
    doc = mdParser.parse(body);
  } else {
    const children = [];
    for (const part of parts) {
      if (part.type === 'table') {
        children.push(tableNodeFromRows(schema, part.rows));
      } else if (part.text.trim()) {
        const d = mdParser.parse(part.text);
        if (d) d.forEach(n => children.push(n));
      }
    }
    doc = schema.nodes.doc.create(null, children.length ? children : [schema.nodes.paragraph.create()]);
  }
  return applyBlockHintsToDoc(schema, doc, hints);
}

export function serializeMarkdown(doc) {
  const state = new MarkdownSerializerState(mdSerializer.nodes, mdSerializer.marks, {});
  state.renderContent(doc);
  return injectBlockHintsToMd(doc, appendFootnoteDefs(state.out, state));
}
