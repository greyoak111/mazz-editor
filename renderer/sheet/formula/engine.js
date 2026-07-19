// renderer/modules/sheet/formula/engine.js —— 公式引擎：分词 → 解析(Pratt) → 求值
// 支持：A1/$A$1/Sheet!A1 引用、区域 A1:B10、运算符、括号、数组常量、函数调用、错误值
// 求值语义对齐 Excel：类型强制、错误传播、空值规则、文本比较不区分大小写

// ==================== 单元格引用工具 ====================
export function colToNum(col) {
  let n = 0;
  for (const c of col.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}
export function numToCol(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}
export function parseRef(str) {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(str);
  if (!m) return null;
  return { absC: !!m[1], col: colToNum(m[2]), absR: !!m[3], row: +m[4] };
}
export function formatRef(col, row, absC = false, absR = false) {
  return (absC ? '$' : '') + numToCol(col) + (absR ? '$' : '') + row;
}

// ==================== 错误值 ====================
export const E = {
  DIV0: { err: '#DIV/0!' }, VALUE: { err: '#VALUE!' }, NAME: { err: '#NAME?' },
  REF: { err: '#REF!' }, NA: { err: '#N/A' }, NUM: { err: '#NUM!' },
  CYCLE: { err: '#CYCLE!' }, NULL: { err: '#NULL!' },
};
export const isErr = (v) => v != null && typeof v === 'object' && 'err' in v;

// ==================== 分词 ====================
const TOK = {
  NUM: 'NUM', STR: 'STR', BOOL: 'BOOL', ERR: 'ERR', REF: 'REF', RANGE: 'RANGE',
  FUNC: 'FUNC', OP: 'OP', LPAREN: '(', RPAREN: ')', COMMA: ',', SEMI: ';',
  LBRACE: '{', RBRACE: '}', WS: 'WS',
};

export function tokenize(src) {
  const out = [];
  let i = 0;
  const s = src.startsWith('=') ? src.slice(1) : src;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    // 字符串 "..."
    if (c === '"') {
      let j = i + 1, str = '';
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') { str += '"'; j += 2; continue; }
          break;
        }
        str += s[j++];
      }
      if (j >= s.length) throw E.VALUE;
      out.push({ t: TOK.STR, v: str }); i = j + 1; continue;
    }
    // 错误值字面量
    const errM = /^(#DIV\/0!|#VALUE!|#REF!|#NAME\?|#N\/A|#NUM!|#NULL!)/i.exec(s.slice(i));
    if (errM) { out.push({ t: TOK.ERR, v: { err: errM[1].toUpperCase() } }); i += errM[1].length; continue; }
    // 数字（含小数/科学计数）
    const numM = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(s.slice(i));
    if (numM) { out.push({ t: TOK.NUM, v: parseFloat(numM[0]) }); i += numM[0].length; continue; }
    // Sheet 引用前缀：'My Sheet'! 或 Sheet1!
    const sheetM = /^('([^']|'')+'|[A-Za-z_一-鿿][\w一-鿿.]*)!/.exec(s.slice(i));
    let sheet = null;
    if (sheetM) {
      sheet = sheetM[1].startsWith("'")
        ? sheetM[1].slice(1, -1).replace(/''/g, "'")
        : sheetM[1];
      i += sheetM[0].length;
    }
    // 单元格引用 / 区域（注意：LOG10( 这类函数名末尾带数字，后跟 ( 时按函数处理）
    const refM = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)/.exec(s.slice(i));
    if (refM && s[i + refM[0].length] !== '(') {
      const mk = (m) => ({ absC: !!m[1], col: colToNum(m[2]), absR: !!m[3], row: +m[4] });
      const r1 = mk(refM);
      i += refM[0].length;
      // 区域 A1[:[$]B2]
      if (s[i] === ':') {
        const refM2 = /^:(\$?)([A-Za-z]{1,3})(\$?)(\d+)/.exec(s.slice(i));
        if (refM2) {
          i += refM2[0].length;
          out.push({ t: TOK.RANGE, v: { r1, r2: mk({ 1: refM2[1], 2: refM2[2], 3: refM2[3], 4: refM2[4] }), sheet } });
          continue;
        }
      }
      out.push({ t: TOK.REF, v: { ...r1, sheet } });
      continue;
    }
    if (sheet) throw E.REF; // Sheet! 后必须跟引用
    // 整列/整行区域 A:A / 1:1
    const colRangeM = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})/.exec(s.slice(i));
    if (colRangeM) {
      out.push({ t: TOK.RANGE, v: { r1: { col: colToNum(colRangeM[1]), row: 1 }, r2: { col: colToNum(colRangeM[2]), row: 1048576 } } });
      i += colRangeM[0].length; continue;
    }
    // 布尔/函数/名称
    const idM = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(s.slice(i));
    if (idM) {
      const name = idM[0].toUpperCase();
      i += idM[0].length;
      if (s[i] === '(') { out.push({ t: TOK.FUNC, v: name }); continue; }
      if (name === 'TRUE') { out.push({ t: TOK.BOOL, v: true }); continue; }
      if (name === 'FALSE') { out.push({ t: TOK.BOOL, v: false }); continue; }
      throw E.NAME;
    }
    // 运算符
    const opM = /^(<>|<=|>=|[-+*/^&=<>%])/.exec(s.slice(i));
    if (opM) { out.push({ t: TOK.OP, v: opM[1] }); i += opM[1].length; continue; }
    if (c === '(') { out.push({ t: TOK.LPAREN }); i++; continue; }
    if (c === ')') { out.push({ t: TOK.RPAREN }); i++; continue; }
    if (c === ',') { out.push({ t: TOK.COMMA }); i++; continue; }
    if (c === ';') { out.push({ t: TOK.SEMI }); i++; continue; }
    if (c === '{') { out.push({ t: TOK.LBRACE }); i++; continue; }
    if (c === '}') { out.push({ t: TOK.RBRACE }); i++; continue; }
    if (c === ':') { i++; continue; } // 兜底（区间已由引用处理）
    throw E.VALUE;
  }
  return out;
}

// ==================== 解析（Pratt） ====================
const BIN_PREC = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

export function parse(src) {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const take = () => toks[pos++];

  function parseExpr(minPrec) {
    let left = parseUnary();
    while (true) {
      const t = peek();
      if (!t || t.t !== TOK.OP || !(t.v in BIN_PREC)) break;
      const prec = BIN_PREC[t.v];
      if (prec < minPrec) break;
      take();
      // ^ 右结合
      const right = parseExpr(t.v === '^' ? prec : prec + 1);
      left = { type: 'binop', op: t.v, left, right };
    }
    return left;
  }

  function parseUnary() {
    const t = peek();
    if (t?.t === TOK.OP && (t.v === '-' || t.v === '+')) {
      take();
      const operand = parseUnary();
      return t.v === '-' ? { type: 'neg', operand } : operand;
    }
    return parsePostfix();
  }

  function parsePostfix() {
    const node = parsePrimary();
    if (peek()?.t === TOK.OP && peek().v === '%') {
      take();
      return { type: 'pct', operand: node };
    }
    return node;
  }

  function parsePrimary() {
    const t = take();
    if (!t) throw E.VALUE;
    switch (t.t) {
      case TOK.NUM: return { type: 'num', value: t.v };
      case TOK.STR: return { type: 'str', value: t.v };
      case TOK.BOOL: return { type: 'bool', value: t.v };
      case TOK.ERR: return { type: 'err', value: t.v };
      case TOK.REF: return { type: 'ref', ...t.v };
      case TOK.RANGE: return { type: 'range', r1: t.v.r1, r2: t.v.r2, sheet: t.v.sheet };
      case TOK.LPAREN: {
        const e = parseExpr(0);
        if (take()?.t !== TOK.RPAREN) throw E.VALUE;
        return e;
      }
      case TOK.LBRACE: return parseArray();
      case TOK.FUNC: {
        if (take()?.t !== TOK.LPAREN) throw E.VALUE;
        const args = [];
        if (peek()?.t !== TOK.RPAREN) {
          args.push(parseExpr(0));
          while (peek()?.t === TOK.COMMA) { take(); args.push(parseExpr(0)); }
        }
        if (take()?.t !== TOK.RPAREN) throw E.VALUE;
        return { type: 'func', name: t.v, args };
      }
      default: throw E.VALUE;
    }
  }

  function parseArray() {
    const rows = [];
    let row = [];
    while (true) {
      const t = peek();
      if (t?.t === TOK.RBRACE) { take(); row.length && rows.push(row); break; }
      if (t?.t === TOK.COMMA) { take(); row.push(parseExpr(0)); continue; }
      if (t?.t === TOK.SEMI) { take(); rows.push(row); row = []; continue; }
      row.push(parseExpr(0));
    }
    return { type: 'array', rows };
  }

  const ast = parseExpr(0);
  if (pos < toks.length) throw E.VALUE;
  return ast;
}

// ==================== 求值 ====================
// ctx: { getCell(sheet, row, col) -> raw, getRange(sheet, r1, r2) -> [[raw]], currentSheet, functions }
// raw: number | string | boolean | null | {err}

export function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isErr(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return 0;
    const n = Number(t.replace(/,/g, '').replace(/%$/, ''));
    if (isNaN(n)) return E.VALUE;
    return t.endsWith('%') ? n / 100 : n;
  }
  return E.VALUE;
}

export function toText(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (isErr(v)) return v.err;
  return String(v);
}

// Excel 比较排序：数字 < 文本(不区分大小写) < 布尔
function cmpOrder(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return 1;
  if (typeof v === 'string') return 2;
  if (typeof v === 'boolean') return 3;
  return 4;
}
export function excelCompare(a, b) {
  const oa = cmpOrder(a), ob = cmpOrder(b);
  if (oa !== ob) return oa - ob;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') {
    const la = a.toLowerCase(), lb = b.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return 0;
}

export function evaluate(node, ctx) {
  try { return evalNode(node, ctx); }
  catch (e) { return isErr(e) ? e : E.VALUE; }
}

function evalNode(node, ctx) {
  switch (node.type) {
    case 'num': return node.value;
    case 'str': return node.value;
    case 'bool': return node.value;
    case 'err': return node.value;
    case 'pct': {
      const v = evalNode(node.operand, ctx);
      if (isErr(v)) return v;
      const n = toNumber(v);
      return isErr(n) ? n : n / 100;
    }
    case 'neg': {
      const v = evalNode(node.operand, ctx);
      if (isErr(v)) return v;
      const n = toNumber(v);
      return isErr(n) ? n : -n;
    }
    case 'ref': {
      const sheet = node.sheet || ctx.currentSheet;
      const v = ctx.getCell(sheet, node.row, node.col);
      return v === undefined ? null : v;
    }
    case 'range': {
      const sheet = node.sheet || ctx.currentSheet;
      return ctx.getRange(sheet, node.r1, node.r2);
    }
    case 'array':
      return node.rows.map(row => row.map(cell => {
        const v = evalNode(cell, ctx);
        return v;
      }));
    case 'binop': return evalBinop(node, ctx);
    case 'func': return evalFunc(node, ctx);
    default: return E.VALUE;
  }
}

function evalBinop(node, ctx) {
  const l = evalNode(node.left, ctx);
  if (isErr(l)) return l;
  const r = evalNode(node.right, ctx);
  if (isErr(r)) return r;
  const { op } = node;

  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
    const c = excelCompare(deref(l), deref(r));
    switch (op) {
      case '=': return c === 0;
      case '<>': return c !== 0;
      case '<': return c < 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '>=': return c >= 0;
    }
  }
  if (op === '&') return toText(deref(l)) + toText(deref(r));

  const ln = toNumber(deref(l));
  if (isErr(ln)) return ln;
  const rn = toNumber(deref(r));
  if (isErr(rn)) return rn;
  switch (op) {
    case '+': return ln + rn;
    case '-': return ln - rn;
    case '*': return ln * rn;
    case '/': return rn === 0 ? E.DIV0 : ln / rn;
    case '^': {
      if (ln === 0 && rn < 0) return E.DIV0;
      const v = Math.pow(ln, rn);
      return Number.isFinite(v) ? v : E.NUM;
    }
  }
  return E.VALUE;
}

// 区域/数组参与标量运算时取首元素（Excel 隐式交集的简化）
export function deref(v) {
  if (Array.isArray(v)) {
    const row = v[0];
    return Array.isArray(row) ? row[0] : row;
  }
  return v;
}

const LAZY_FUNCS = new Set([
  'IF', 'IFS', 'IFERROR', 'IFNA', 'CHOOSE', 'SWITCH', 'ROW', 'COLUMN',
  'ISBLANK', 'ISNUMBER', 'ISTEXT', 'ISLOGICAL', 'ISERROR', 'ISERR', 'ISNA', 'ISODD', 'ISEVEN', 'ISFORMULA',
]);

function evalFunc(node, ctx) {
  const fn = ctx.functions[node.name];
  if (!fn) return E.NAME;
  if (LAZY_FUNCS.has(node.name)) {
    return fn(node.args, ctx, evalNode);
  }
  const args = node.args.map(a => evalNode(a, ctx));
  for (const a of args) if (isErr(a)) return a;
  return fn(args, ctx);
}

// ==================== 条件匹配（COUNTIF/SUMIF 等） ====================
export function matchCriteria(value, criteria) {
  if (isErr(value)) return false;
  if (typeof criteria === 'string') {
    const m = /^(<=|>=|<>|=|<|>)(.*)$/.exec(criteria);
    if (m) {
      const target = coerceCriteria(m[2]);
      const c = excelCompare(value, target);
      switch (m[1]) {
        case '=': return c === 0;
        case '<>': return c !== 0;
        case '<': return c < 0;
        case '>': return c > 0;
        case '<=': return c <= 0;
        case '>=': return c >= 0;
      }
    }
    // 通配符 * ?
    const re = new RegExp('^' + criteria.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    return re.test(String(value));
  }
  return excelCompare(value, criteria) === 0;
}
function coerceCriteria(s) {
  const n = Number(s);
  if (!isNaN(n) && s.trim() !== '') return n;
  if (s.toUpperCase() === 'TRUE') return true;
  if (s.toUpperCase() === 'FALSE') return false;
  return s;
}
