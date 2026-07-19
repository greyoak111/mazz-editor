// renderer/modules/markdown/footnotes.js —— 脚注：[^1] 行内注记节点 + 文末定义
// markdown 语法：正文 [^1]，文末 [^1]: 注释文本

// ==================== schema ====================
export const footnoteNode = {
  footnote: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { note: { default: '' } },
    draggable: false,
    parseDOM: [{
      tag: 'sup[data-note]',
      getAttrs: (dom) => ({ note: dom.getAttribute('data-note') || '' }),
    }],
    toDOM: (node) => ['sup', {
      class: 'pm-footnote',
      'data-note': node.attrs.note,
      title: node.attrs.note,
    }, '[†]'],
  },
};

// ==================== markdown-it 行内规则（[^id]） ====================
export function footnoteRefPlugin(md) {
  md.inline.ruler.push('footnote_ref_mazz', (state, silent) => {
    const m = /^\[\^([^\]\n]+)\]/.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) {
      const token = state.push('footnote_ref', 'sup', 0);
      token.meta = { id: m[1] };
    }
    state.pos += m[0].length;
    return true;
  });
}

// ==================== 定义行提取（[^id]: 文本） ====================
let _defs = new Map();
const DEF_LINE = /^\[\^([^\]]+)\]:\s*(.*)$/;

export function extractFootnoteDefs(text) {
  const defs = new Map();
  const body = [];
  for (const line of String(text).split('\n')) {
    const m = DEF_LINE.exec(line);
    if (m) defs.set(m[1], m[2].trim());
    else body.push(line);
  }
  return { body: body.join('\n'), defs };
}
export function setParseDefs(defs) { _defs = defs; }
export function getDef(id) { return _defs.get(id); }

export const footnoteTokenHandler = {
  footnote_ref: {
    node: 'footnote',
    getAttrs: (tok) => ({ note: getDef(tok.meta.id) || tok.meta.id }),
  },
};

// ==================== 序列化 ====================
// 策略：先给全文脚注按出现顺序编号，正文写 [^n]，文末补定义
export const footnoteSerializer = {
  footnote(state, node) {
    const id = state.nextFootnoteId = (state.nextFootnoteId || 0) + 1;
    state.footnoteDefs = state.footnoteDefs || [];
    state.footnoteDefs.push({ id, note: node.attrs.note });
    state.write(`[^${id}]`);
  },
};

export function appendFootnoteDefs(md, state) {
  if (!state.footnoteDefs?.length) return md;
  const lines = state.footnoteDefs.map(d => `[^${d.id}]: ${d.note}`);
  return md.replace(/\s*$/, '') + '\n\n' + lines.join('\n') + '\n';
}
