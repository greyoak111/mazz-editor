// renderer/modules/markdown/textstyle.js —— 文本样式：字体/字号/颜色/突出显示/上下标 + 块级对齐/缩进/行距/段距
// 行内样式 → HTML span 双向序列化；块级样式 → <!--block-style:{...}--> 注释行（按出现顺序成对应用）

// ==================== fontStyle mark ====================
export const fontStyleMark = {
  attrs: { family: { default: null }, size: { default: null }, color: { default: null },
    highlight: { default: null }, script: { default: null } },
  inclusive: false,
  parseDOM: [{
    tag: 'span[data-fs]',
    getAttrs: (dom) => ({
      family: dom.getAttribute('data-fs-family') || null,
      size: dom.getAttribute('data-fs-size') || null,
      color: dom.getAttribute('data-fs-color') || null,
      highlight: dom.getAttribute('data-fs-highlight') || null,
      script: dom.getAttribute('data-fs-script') || null,
    }),
  }, {
    tag: 'sup', getAttrs: () => ({ script: 'sup' }),
  }, {
    tag: 'sub', getAttrs: () => ({ script: 'sub' }),
  }],
  toDOM: (mark) => {
    const a = mark.attrs;
    if (a.script === 'sup') return ['sup', 0];
    if (a.script === 'sub') return ['sub', 0];
    const style = [];
    if (a.family) style.push(`font-family:'${a.family}'`);
    if (a.size) style.push(`font-size:${a.size}pt`);
    if (a.color) style.push(`color:${a.color}`);
    if (a.highlight) style.push(`background:${a.highlight}`);
    return ['span', {
      style: style.join(';'),
      'data-fs': '',
      ...(a.family ? { 'data-fs-family': a.family } : {}),
      ...(a.size ? { 'data-fs-size': a.size } : {}),
      ...(a.color ? { 'data-fs-color': a.color } : {}),
      ...(a.highlight ? { 'data-fs-highlight': a.highlight } : {}),
    }, 0];
  },
};

// ==================== markdown-it：<span style>/<sup>/<sub> → fs_open/fs_close ====================
const STYLE_KEYS = { 'font-family': 'family', 'font-size': 'size', 'color': 'color', 'background': 'highlight', 'background-color': 'highlight' };

function parseStyleAttr(str) {
  const attrs = {};
  for (const part of str.split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim().replace(/['"]/g, '');
    if (STYLE_KEYS[k] && v) attrs[STYLE_KEYS[k]] = v;
  }
  if (attrs.size) attrs.size = parseFloat(attrs.size) || null;
  return attrs;
}

export function fontStylePlugin(md) {
  md.inline.ruler.push('fontstyle', (state, silent) => {
    const src = state.src.slice(state.pos);
    let m = /^<span\s+style="([^"]+)"\s*>/i.exec(src);
    if (m) {
      if (!silent) {
        const token = state.push('fs_open', 'span', 1);
        token.attrs = parseStyleAttr(m[1]);
      }
      state.pos += m[0].length;
      return true;
    }
    m = /^<\/span\s*>/i.exec(src);
    if (m) {
      if (!silent) state.push('fs_close', 'span', -1);
      state.pos += m[0].length;
      return true;
    }
    m = /^<sup>/i.exec(src);
    if (m) {
      if (!silent) { const t = state.push('fs_open', 'span', 1); t.attrs = { script: 'sup' }; }
      state.pos += m[0].length;
      return true;
    }
    m = /^<\/sup>/i.exec(src);
    if (m) { if (!silent) state.push('fs_close', 'span', -1); state.pos += m[0].length; return true; }
    m = /^<sub>/i.exec(src);
    if (m) {
      if (!silent) { const t = state.push('fs_open', 'span', 1); t.attrs = { script: 'sub' }; }
      state.pos += m[0].length;
      return true;
    }
    m = /^<\/sub>/i.exec(src);
    if (m) { if (!silent) state.push('fs_close', 'span', -1); state.pos += m[0].length; return true; }
    return false;
  });
}

// tokenHandlers 规则：配置 key 自动生成 key_open/key_close handler，故 key 必须是 token 类型去后缀的基名
export const fontStyleTokens = {
  fs: { mark: 'fontStyle', getAttrs: (tok) => tok.attrs },
};

// ==================== fontStyle 序列化 ====================
export const fontStyleSerializer = {
  fontStyle: {
    open(state, mark) {
      const a = mark.attrs;
      if (a.script === 'sup') return '<sup>';
      if (a.script === 'sub') return '<sub>';
      const style = [];
      if (a.family) style.push(`font-family:${a.family}`);
      if (a.size) style.push(`font-size:${a.size}pt`);
      if (a.color) style.push(`color:${a.color}`);
      if (a.highlight) style.push(`background:${a.highlight}`);
      return `<span style="${style.join(';')}">`;
    },
    close(state, mark) {
      const a = mark.attrs;
      return a.script ? `</${a.script}>` : '</span>';
    },
    mixable: false,
  },
};

// ==================== 块级样式（对齐/缩进/行距/段距） ====================
export const BLOCK_ATTRS = Object.fromEntries(
  ['align', 'indent', 'lineHeight', 'spacingBefore', 'spacingAfter'].map(k => [k, { default: null }]));

export function blockNodeSpec(baseSpec, tagFn) {
  const resolveTag = (node) => typeof tagFn === 'function' ? tagFn(node) : tagFn;
  return {
    ...baseSpec,
    attrs: { ...(baseSpec.attrs || {}), ...BLOCK_ATTRS },
    toDOM: (node) => {
      const a = node.attrs || {};
      const style = [];
      if (a.align) style.push(`text-align:${a.align}`);
      if (a.indent) style.push(`text-indent:${a.indent}em`);
      if (a.lineHeight) style.push(`line-height:${a.lineHeight}`);
      if (a.spacingBefore) style.push(`margin-top:${a.spacingBefore}em`);
      if (a.spacingAfter) style.push(`margin-bottom:${a.spacingAfter}em`);
      return [resolveTag(node), style.length ? { style: style.join(';') } : {}, 0];
    },
    parseDOM: (baseSpec.parseDOM || []).map(rule => ({
      ...rule,
      getAttrs: (dom) => {
        const baseAttrs = rule.getAttrs ? rule.getAttrs(dom) : {};
        if (baseAttrs === false) return false;
        // h1~h6 标签级别（基础规则未必带 getAttrs）
        const hm = /^h([1-6])$/i.exec(rule.tag || '');
        if (hm && baseAttrs.level == null) baseAttrs.level = +hm[1];
        const s = dom.style || {};
        return {
          ...baseAttrs,
          align: s.textAlign || null,
          indent: parseFloat(s.textIndent) || null,
          lineHeight: parseFloat(s.lineHeight) || null,
          spacingBefore: parseFloat(s.marginTop) || null,
          spacingAfter: parseFloat(s.marginBottom) || null,
        };
      },
    })),
  };
}

// —— 序列化前置/后置处理 ——
const BLOCK_HINT = /^<!--block-style:(\{.*?\})-->\s*$/;

/** 解析时：按出现顺序收集 hints（doc 顶层块按顺序应用） */
export function extractBlockHints(text) {
  const hints = [];
  const body = [];
  for (const line of String(text).split('\n')) {
    const m = BLOCK_HINT.exec(line);
    if (m) {
      try { hints.push(JSON.parse(m[1])); } catch {}
      continue;
    }
    body.push(line);
  }
  return { body: body.join('\n'), hints };
}

/** 解析后：把 hints 按顺序应用到顶层块 */
export function applyBlockHintsToDoc(schema, doc, hints) {
  if (!hints?.length) return doc;
  const blocks = [];
  doc.forEach(n => blocks.push(n));
  let hi = 0;
  const next = blocks.map((node, i) => {
    if (hi < hints.length && hints[hi]) {
      const merged = { ...node.attrs, ...hints[hi] };
      hi++;
      return node.type.create(merged, node.content, node.marks);
    }
    return node;
  });
  return schema.nodes.doc.create(null, next);
}

/** 序列化时：有样式的块前插入注释行 */
export function injectBlockHintsToMd(doc, mdText) {
  const blocks = [];
  doc.forEach(n => blocks.push(n));
  const hintLines = [];
  const hasStyled = blocks.some(n => {
    const a = n.attrs || {};
    return a.align || a.indent || a.lineHeight || a.spacingBefore || a.spacingAfter;
  });
  if (!hasStyled) return mdText;
  for (const n of blocks) {
    const a = n.attrs || {};
    if (a.align || a.indent || a.lineHeight || a.spacingBefore || a.spacingAfter) {
      const attrs = {};
      if (a.align) attrs.align = a.align;
      if (a.indent) attrs.indent = a.indent;
      if (a.lineHeight) attrs.lineHeight = a.lineHeight;
      if (a.spacingBefore) attrs.spacingBefore = a.spacingBefore;
      if (a.spacingAfter) attrs.spacingAfter = a.spacingAfter;
      hintLines.push(`<!--block-style:${JSON.stringify(attrs)}-->`);
    }
  }
  return hintLines.join('\n') + '\n' + mdText;
}
