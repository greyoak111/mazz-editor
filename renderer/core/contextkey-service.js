// renderer/core/contextkey-service.js —— 上下文键服务：hasSelection / module==xxx 等实时求值
// when 表达式语法：标识符、'字符串'、数字、==、!=、&&、||、!、()；裸标识符取真值
class ContextKeyService {
  constructor() {
    this.keys = new Map();
    this.listeners = new Set();
  }
  set(key, value) {
    if (this.keys.get(key) === value) return;
    this.keys.set(key, value);
    for (const cb of [...this.listeners]) { try { cb(key, value); } catch {} }
  }
  get(key) { return this.keys.get(key); }
  onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  /** 求值 when 表达式；空表达式恒真 */
  evaluate(expr) {
    if (!expr || !String(expr).trim()) return true;
    try {
      const tokens = tokenize(String(expr));
      const pos = { i: 0 };
      const val = parseOr(tokens, pos, this.keys);
      return !!val;
    } catch (e) {
      console.warn('[contextkey] 表达式解析失败:', expr, e.message);
      return false;
    }
  }

  /** 解析校验（插件/配置准入用；非法表达式抛错） */
  validate(expr) {
    if (!expr || !String(expr).trim()) return;
    const tokens = tokenize(String(expr));
    const pos = { i: 0 };
    parseOr(tokens, pos, this.keys);
    if (pos.i < tokens.length) throw new Error('when 表达式有多余内容: ' + expr);
  }
}

function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (s.startsWith('==', i) || s.startsWith('!=', i) || s.startsWith('&&', i) || s.startsWith('||', i)) {
      out.push({ t: 'op', v: s.slice(i, i + 2) }); i += 2; continue;
    }
    if (c === '(' || c === ')' || c === '!') { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) throw new Error('字符串未闭合');
      out.push({ t: 'str', v: s.slice(i + 1, j) }); i = j + 1; continue;
    }
    const m = /^[a-zA-Z_][\w.\-]*/.exec(s.slice(i));
    if (m) { out.push({ t: 'ident', v: m[0] }); i += m[0].length; continue; }
    const n = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (n) { out.push({ t: 'num', v: parseFloat(n[0]) }); i += n[0].length; continue; }
    throw new Error(`无法识别的字符: ${c}`);
  }
  return out;
}

function peek(ts, p) { return ts[p.i]; }
function take(ts, p) { return ts[p.i++]; }

function parseOr(ts, p, keys) {
  let v = parseAnd(ts, p, keys);
  while (peek(ts, p)?.v === '||') { take(ts, p); v = !!v || !!parseAnd(ts, p, keys); }
  return v;
}
function parseAnd(ts, p, keys) {
  let v = parseUnary(ts, p, keys);
  while (peek(ts, p)?.v === '&&') { take(ts, p); v = !!v && !!parseUnary(ts, p, keys); }
  return v;
}
function parseUnary(ts, p, keys) {
  if (peek(ts, p)?.v === '!') { take(ts, p); return !parseUnary(ts, p, keys); }
  return parseEq(ts, p, keys);
}
function parseEq(ts, p, keys) {
  const left = parseAtom(ts, p, keys);
  const t = peek(ts, p);
  if (t?.v === '==' || t?.v === '!=') {
    take(ts, p);
    const right = parseAtom(ts, p, keys);
    return t.v === '==' ? left === right : left !== right;
  }
  return left;
}
function parseAtom(ts, p, keys) {
  const t = take(ts, p);
  if (!t) throw new Error('表达式意外结束');
  if (t.v === '(') {
    const v = parseOr(ts, p, keys);
    if (take(ts, p)?.v !== ')') throw new Error('缺少 )');
    return v;
  }
  if (t.t === 'str') return t.v;
  if (t.t === 'num') return t.v;
  if (t.t === 'ident') {
    if (t.v === 'true') return true;
    if (t.v === 'false') return false;
    return keys.get(t.v);
  }
  throw new Error(`意外的符号: ${t.v}`);
}

export const contextKeys = new ContextKeyService();
