// renderer/modules/markdown/inputrules.js —— 输入规则：# 标题 / > 引用 / - 列表 / ``` 代码块 / --- 分割线 / 智能标点
// 含「中文友好」增强：# 后直接跟汉字也转标题；全角标记（＊＊／～～／｀）与半角等价
import {
  inputRules, wrappingInputRule, textblockTypeInputRule, smartQuotes, emDash, ellipsis, InputRule,
} from 'prosemirror-inputrules';
import { findWrapping } from 'prosemirror-transform';

/** 分割线：--- 回车处替换为 horizontal_rule */
function hrRule(nodeType) {
  return new InputRule(/^(?:---|___|\*\*\*)$/, (state, match, start, end) => {
    const tr = state.tr.delete(start, end);
    tr.insert(start, nodeType.create());
    tr.insert(start + 1, state.schema.nodes.paragraph.create());
    return tr;
  });
}

/** 代码块：```lang 进入代码块 */
function codeBlockRule(nodeType) {
  return textblockTypeInputRule(/^```([a-zA-Z0-9+#-]*)?$/, nodeType, (match) => ({ params: match[1] || '' }));
}

/** 中文友好：# 后直接跟 CJK 字符也转标题（CommonMark 需空格；飞书/语雀式体验） */
function cjkHeadingRule(nodeType) {
  return new InputRule(/^(#{1,6})([一-鿿])$/, (state, match, start, end) => {
    const level = match[1].length;
    const tr = state.tr.delete(start, end); // 删除 #（输入规则会吞掉触发字符，需补回）
    tr.insertText(match[2], start);          // 补回被吞的汉字
    tr.setBlockType(start, start, nodeType, { level });
    return tr;
  });
}

/** 中文友好：> 后直接跟 CJK 字符也转引用 */
function cjkBlockquoteRule(nodeType) {
  return new InputRule(/^>([一-鿿])$/, (state, match, start, end) => {
    const tr = state.tr.delete(start, end); // 删除 >（触发字符需补回）
    tr.insertText(match[1], start);
    const $start = tr.doc.resolve(start);
    const range = $start.blockRange();
    if (!range) return null;
    const wrapping = findWrapping(range, nodeType);
    if (!wrapping) return null;
    tr.wrap(range, wrapping);
    return tr;
  });
}

/** 全角行内标记：＊＊粗＊＊ ／ ～～删～～ ／ ｀码｀（IME 用户常态） */
function fullwidthMarkRule(regexp, markType) {
  return new InputRule(regexp, (state, match, start, end) => {
    const inner = match[1];
    if (!inner) return null;
    const tr = state.tr.insertText(inner, start, end);
    tr.addMark(start, start + inner.length, markType.create());
    tr.removeStoredMark(markType);
    return tr;
  });
}

export function buildMarkRules(schema) {
  return [
    fullwidthMarkRule(/＊＊([^＊*]+)＊＊$/, schema.marks.strong),
    fullwidthMarkRule(/(?<![＊*])＊([^＊*\n]+)＊$/, schema.marks.em),
    fullwidthMarkRule(/｀([^｀`]+)｀$/, schema.marks.code),
    fullwidthMarkRule(/～～([^～~]+)～～$/, schema.marks.strike),
  ];
}

export function buildInputRules(schema) {
  const rules = [...smartQuotes, ellipsis, emDash];
  if (schema.nodes.blockquote) {
    rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote));
    rules.push(cjkBlockquoteRule(schema.nodes.blockquote));
  }
  if (schema.nodes.heading) {
    rules.push(textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, m => ({ level: m[1].length })));
    rules.push(cjkHeadingRule(schema.nodes.heading));
  }
  if (schema.nodes.code_block) rules.push(codeBlockRule(schema.nodes.code_block));
  if (schema.nodes.horizontal_rule) rules.push(hrRule(schema.nodes.horizontal_rule));
  if (schema.nodes.bullet_list) rules.push(wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list));
  if (schema.nodes.ordered_list) {
    rules.push(wrappingInputRule(/^(\d+)[.)]\s$/, schema.nodes.ordered_list,
      m => ({ order: +m[1] }), (match, node) => node.childCount + node.attrs.order === +match[1] + 1));
  }
  return inputRules({ rules });
}
