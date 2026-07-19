// renderer/modules/sheet/formula/functions.js —— 100+ 高频函数（对齐 Excel 语义）
import { E, isErr, toNumber, toText, excelCompare, matchCriteria, deref } from './engine.js';
import { dateToSerial, serialToDate, formatValue } from '../format.js';

// ==================== 取值助手 ====================
/** 拍平参数为值列表（区域展开），保持错误传播 */
function flat(args) {
  const out = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const row of a) {
        for (const v of Array.isArray(row) ? row : [row]) {
          if (isErr(v)) return { err: v };
          out.push({ v, fromRange: true });
        }
      }
    } else {
      if (isErr(a)) return { err: a };
      out.push({ v: a, fromRange: false });
    }
  }
  return { list: out };
}

/** 数值聚合（区域中文本/空忽略；标量文本转数值，失败 #VALUE!） */
function nums(args) {
  const r = flat(args);
  if (r.err) return r;
  const out = [];
  for (const { v, fromRange } of r.list) {
    if (v == null) continue;
    if (typeof v === 'number') { out.push(v); continue; }
    if (typeof v === 'boolean') { if (!fromRange) out.push(v ? 1 : 0); continue; }
    if (typeof v === 'string') {
      if (fromRange) continue; // 区域文本忽略
      const n = toNumber(v);
      if (isErr(n)) return { err: n };
      out.push(n);
    }
  }
  return { list: out };
}

/** 单参数数值 */
function num(v, def = null) {
  const n = toNumber(deref(v));
  if (isErr(n)) return def !== null ? def : { err: n };
  return { v: n };
}

/** 全部参数必须数值 */
function allNums(args) {
  return args.map(a => {
    const r = num(a);
    return r.err ? r : r.v;
  });
}

function firstErr(list) { return list.find(isErr) || null; }
function int(v) { const r = num(v); return r.err ? r : { v: Math.trunc(r.v) }; }

// ==================== 函数表 ====================
export const FUNCTIONS = {

  // —— 数学 ——
  ABS: (a) => { const r = num(a[0]); return r.err || Math.abs(r.v); },
  SIGN: (a) => { const r = num(a[0]); return r.err || Math.sign(r.v); },
  INT: (a) => { const r = num(a[0]); return r.err || Math.floor(r.v); },
  TRUNC: (a) => { const r = num(a[0]); if (r.err) return r.err; const d = a[1] !== undefined ? (num(a[1]).v ?? 0) : 0; const m = Math.pow(10, d); return Math.trunc(r.v * m) / m; },
  ROUND: (a) => { const [x, d] = allNums(a); if (isErr(x)) return x; if (isErr(d)) return d; const m = Math.pow(10, d); return Math.round((x * m) + (x < 0 ? -1e-10 : 1e-10)) / m; },
  ROUNDUP: (a) => { const [x, d] = allNums(a); if (isErr(x)) return x; const m = Math.pow(10, d); return (x < 0 ? -1 : 1) * Math.ceil(Math.abs(x * m)) / m; },
  ROUNDDOWN: (a) => { const [x, d] = allNums(a); if (isErr(x)) return x; const m = Math.pow(10, d); return (x < 0 ? -1 : 1) * Math.floor(Math.abs(x * m)) / m; },
  CEILING: (a) => { const [x, s] = allNums(a); if (isErr(x)) return x; if (isErr(s)) return s; if (s === 0) return 0; return Math.ceil(x / Math.abs(s)) * Math.abs(s); },
  FLOOR: (a) => { const [x, s] = allNums(a); if (isErr(x)) return x; if (isErr(s)) return s; if (s === 0) return 0; return Math.floor(x / Math.abs(s)) * Math.abs(s); },
  MROUND: (a) => { const [x, m] = allNums(a); if (isErr(x)) return x; if (m === 0) return 0; return Math.round(x / m) * m; },
  EVEN: (a) => { const r = num(a[0]); return r.err || (r.v < 0 ? -1 : 1) * Math.ceil(Math.abs(r.v) / 2) * 2; },
  ODD: (a) => { const r = num(a[0]); if (r.err) return r.err; const c = Math.ceil(Math.abs(r.v)); return (r.v < 0 ? -1 : 1) * (c % 2 === 0 ? c + 1 : c); },
  SQRT: (a) => { const r = num(a[0]); if (r.err) return r.err; return r.v < 0 ? E.NUM : Math.sqrt(r.v); },
  POWER: (a) => { const [x, y] = allNums(a); if (isErr(x)) return x; const v = Math.pow(x, y); return Number.isFinite(v) ? v : E.NUM; },
  EXP: (a) => { const r = num(a[0]); return r.err || Math.exp(r.v); },
  LN: (a) => { const r = num(a[0]); if (r.err) return r.err; return r.v <= 0 ? E.NUM : Math.log(r.v); },
  LOG: (a) => { const r = num(a[0]); if (r.err) return r.err; const base = a[1] !== undefined ? num(a[1]).v : 10; if (r.v <= 0 || base <= 0 || base === 1) return E.NUM; return Math.log(r.v) / Math.log(base); },
  LOG10: (a) => { const r = num(a[0]); if (r.err) return r.err; return r.v <= 0 ? E.NUM : Math.log10(r.v); },
  PI: () => Math.PI,
  RAND: () => Math.random(),
  RANDBETWEEN: (a) => { const [lo, hi] = allNums(a); if (isErr(lo)) return lo; return Math.floor(Math.random() * (hi - lo + 1)) + lo; },
  MOD: (a) => { const [x, y] = allNums(a); if (isErr(x)) return x; if (y === 0) return E.DIV0; return x - y * Math.floor(x / y); },
  GCD: (a) => { const ns = nums(a); if (ns.err) return ns.err; const g = (x, y) => y === 0 ? x : g(y, x % y); return ns.list.reduce((p, c) => g(p, Math.trunc(c)), 0); },
  LCM: (a) => { const ns = nums(a); if (ns.err) return ns.err; const g = (x, y) => y === 0 ? x : g(y, x % y); return ns.list.reduce((p, c) => Math.abs(p * Math.trunc(c)) / g(p, Math.trunc(c)) || 0, 1); },
  FACT: (a) => { const r = int(a[0]); if (r.err) return r.err; if (r.v < 0) return E.NUM; let f = 1; for (let i = 2; i <= r.v; i++) f *= i; return f; },
  COMBIN: (a) => { const [n, k] = allNums(a); if (isErr(n)) return n; if (k < 0 || n < 0 || k > n) return E.NUM; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); },
  DEGREES: (a) => { const r = num(a[0]); return r.err || r.v * 180 / Math.PI; },
  RADIANS: (a) => { const r = num(a[0]); return r.err || r.v * Math.PI / 180; },
  SIN: (a) => { const r = num(a[0]); return r.err || Math.sin(r.v); },
  COS: (a) => { const r = num(a[0]); return r.err || Math.cos(r.v); },
  TAN: (a) => { const r = num(a[0]); return r.err || Math.tan(r.v); },
  ASIN: (a) => { const r = num(a[0]); if (r.err) return r.err; return Math.abs(r.v) > 1 ? E.NUM : Math.asin(r.v); },
  ACOS: (a) => { const r = num(a[0]); if (r.err) return r.err; return Math.abs(r.v) > 1 ? E.NUM : Math.acos(r.v); },
  ATAN: (a) => { const r = num(a[0]); return r.err || Math.atan(r.v); },
  ATAN2: (a) => { const [x, y] = allNums(a); if (isErr(x)) return x; return Math.atan2(y, x); },
  SINH: (a) => { const r = num(a[0]); return r.err || Math.sinh(r.v); },
  COSH: (a) => { const r = num(a[0]); return r.err || Math.cosh(r.v); },
  TANH: (a) => { const r = num(a[0]); return r.err || Math.tanh(r.v); },
  SUMSQ: (a) => { const ns = nums(a); return ns.err || ns.list.reduce((p, c) => p + c * c, 0); },
  SERIESSUM: (a) => { const [x, n, m] = allNums(a); if (isErr(x)) return x; const coeffs = Array.isArray(a[3]) ? a[3].flat() : [a[3]]; return coeffs.reduce((p, c, i) => p + (toNumber(c) || 0) * Math.pow(x, n + i * m), 0); },

  // —— 统计 ——
  SUM: (a) => { const ns = nums(a); return ns.err || ns.list.reduce((p, c) => p + c, 0); },
  PRODUCT: (a) => { const ns = nums(a); return ns.err || ns.list.reduce((p, c) => p * c, 1); },
  AVERAGE: (a) => { const ns = nums(a); return ns.err || (ns.list.length ? ns.list.reduce((p, c) => p + c, 0) / ns.list.length : E.DIV0); },
  AVERAGEA: (a) => { const r = flat(a); if (r.err) return r.err; const vs = r.list.map(x => typeof x.v === 'number' ? x.v : typeof x.v === 'boolean' ? (x.v ? 1 : 0) : 0); return vs.length ? vs.reduce((p, c) => p + c, 0) / vs.length : E.DIV0; },
  COUNT: (a) => { const ns = nums(a); return ns.err || ns.list.length; },
  COUNTA: (a) => { const r = flat(a); return r.err || r.list.filter(x => x.v != null).length; },
  COUNTBLANK: (a) => { const r = flat(a); return r.err || r.list.filter(x => x.v == null || x.v === '').length; },
  MAX: (a) => { const ns = nums(a); return ns.err || (ns.list.length ? Math.max(...ns.list) : 0); },
  MIN: (a) => { const ns = nums(a); return ns.err || (ns.list.length ? Math.min(...ns.list) : 0); },
  MEDIAN: (a) => { const ns = nums(a); if (ns.err) return ns.err; if (!ns.list.length) return E.DIV0; const s = [...ns.list].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
  MODE: (a) => { const ns = nums(a); if (ns.err) return ns.err; const freq = new Map(); let best = null, bestN = 0; for (const v of ns.list) { const n = (freq.get(v) || 0) + 1; freq.set(v, n); if (n > bestN) { bestN = n; best = v; } } return bestN > 1 ? best : E.NA; },
  STDEV: (a) => { const ns = nums(a); if (ns.err) return ns.err; if (ns.list.length < 2) return E.DIV0; const m = ns.list.reduce((p, c) => p + c, 0) / ns.list.length; return Math.sqrt(ns.list.reduce((p, c) => p + (c - m) ** 2, 0) / (ns.list.length - 1)); },
  STDEVP: (a) => { const ns = nums(a); if (ns.err) return ns.err; if (!ns.list.length) return E.DIV0; const m = ns.list.reduce((p, c) => p + c, 0) / ns.list.length; return Math.sqrt(ns.list.reduce((p, c) => p + (c - m) ** 2, 0) / ns.list.length); },
  VAR: (a) => { const ns = nums(a); if (ns.err) return ns.err; if (ns.list.length < 2) return E.DIV0; const m = ns.list.reduce((p, c) => p + c, 0) / ns.list.length; return ns.list.reduce((p, c) => p + (c - m) ** 2, 0) / (ns.list.length - 1); },
  VARP: (a) => { const ns = nums(a); if (ns.err) return ns.err; if (!ns.list.length) return E.DIV0; const m = ns.list.reduce((p, c) => p + c, 0) / ns.list.length; return ns.list.reduce((p, c) => p + (c - m) ** 2, 0) / ns.list.length; },
  LARGE: (a) => { const ns = nums([a[0]]); if (ns.err) return ns.err; const k = num(a[1]).v; const s = [...ns.list].sort((x, y) => y - x); return k >= 1 && k <= s.length ? s[k - 1] : E.NUM; },
  SMALL: (a) => { const ns = nums([a[0]]); if (ns.err) return ns.err; const k = num(a[1]).v; const s = [...ns.list].sort((x, y) => x - y); return k >= 1 && k <= s.length ? s[k - 1] : E.NUM; },
  RANK: (a) => { const x = num(a[0]); if (x.err) return x.err; const ns = nums([a[1]]); if (ns.err) return ns.err; if (!ns.list.includes(x.v)) return E.NA; const desc = a[2] === undefined || toNumber(a[2]) === 0; const s = [...ns.list].sort((p, q) => desc ? q - p : p - q); return s.indexOf(x.v) + 1; },
  PERCENTILE: (a) => { const ns = nums([a[0]]); if (ns.err) return ns.err; const k = num(a[1]).v; if (k < 0 || k > 1 || !ns.list.length) return E.NUM; const s = [...ns.list].sort((x, y) => x - y); const idx = k * (s.length - 1); const lo = Math.floor(idx), hi = Math.ceil(idx); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo); },
  QUARTILE: (a) => { const q = num(a[1]).v; if (q < 0 || q > 4) return E.NUM; return FUNCTIONS.PERCENTILE([a[0], q / 4]); },
  SUMPRODUCT: (a) => {
    const arrays = a.map(x => Array.isArray(x) ? x.flat() : [x]);
    const len = arrays[0].length;
    if (arrays.some(r => r.length !== len)) return E.VALUE;
    let sum = 0;
    for (let i = 0; i < len; i++) {
      let prod = 1;
      for (const arr of arrays) {
        const v = arr[i];
        if (isErr(v)) return v;
        prod *= typeof v === 'number' ? v : 0;
      }
      sum += prod;
    }
    return sum;
  },
  COUNTIF: (a) => { const r = flat([a[0]]); if (r.err) return r.err; return r.list.filter(x => matchCriteria(x.v, deref(a[1]))).length; },
  SUMIF: (a) => {
    const crit = flat([a[0]]); if (crit.err) return crit.err;
    const sums = a[2] !== undefined ? flat([a[2]]) : crit;
    if (sums.err) return sums.err;
    const c = deref(a[1]);
    let sum = 0;
    for (let i = 0; i < crit.list.length; i++) {
      if (matchCriteria(crit.list[i].v, c)) {
        const v = sums.list[i]?.v;
        if (typeof v === 'number') sum += v;
      }
    }
    return sum;
  },
  COUNTIFS: (a) => {
    let count = 0;
    const pairs = [];
    for (let i = 0; i < a.length; i += 2) pairs.push([a[i], deref(a[i + 1])]);
    const r0 = flat([pairs[0][0]]);
    if (r0.err) return r0.err;
    outer: for (let i = 0; i < r0.list.length; i++) {
      for (const [range, crit] of pairs) {
        const r = flat([range]);
        if (r.err) return r.err;
        if (!matchCriteria(r.list[i]?.v, crit)) continue outer;
      }
      count++;
    }
    return count;
  },
  SUMIFS: (a) => {
    const sumR = flat([a[0]]); if (sumR.err) return sumR.err;
    const pairs = [];
    for (let i = 1; i < a.length; i += 2) pairs.push([a[i], deref(a[i + 1])]);
    let sum = 0;
    outer: for (let i = 0; i < sumR.list.length; i++) {
      for (const [range, crit] of pairs) {
        const r = flat([range]);
        if (r.err) return r.err;
        if (!matchCriteria(r.list[i]?.v, crit)) continue outer;
      }
      if (typeof sumR.list[i]?.v === 'number') sum += sumR.list[i].v;
    }
    return sum;
  },
  AVERAGEIF: (a) => { const r = FUNCTIONS.SUMIF(a); if (isErr(r)) return r; const n = FUNCTIONS.COUNTIF(a); return n ? r / n : E.DIV0; },
  AVERAGEIFS: (a) => { const r = FUNCTIONS.SUMIFS(a); if (isErr(r)) return r; const n = FUNCTIONS.COUNTIFS(a.slice(1)); return n ? r / n : E.DIV0; },
  MAXIFS: (a) => { return ifsAgg(a, Math.max); },
  MINIFS: (a) => { return ifsAgg(a, Math.min); },
  FREQUENCY: () => E.NA, // 数组公式，封远期

  // —— 逻辑 ——
  IF: (raw, ctx, evalNode) => {
    const cond = evalNode(raw[0], ctx);
    if (isErr(cond)) return cond;
    if (deref(cond)) return raw[1] ? evalNode(raw[1], ctx) : true;
    return raw[2] !== undefined ? evalNode(raw[2], ctx) : false;
  },
  IFS: (raw, ctx, evalNode) => {
    for (let i = 0; i < raw.length; i += 2) {
      const cond = evalNode(raw[i], ctx);
      if (isErr(cond)) return cond;
      if (deref(cond)) return evalNode(raw[i + 1], ctx);
    }
    return E.NA;
  },
  SWITCH: (raw, ctx, evalNode) => {
    const target = evalNode(raw[0], ctx);
    if (isErr(target)) return target;
    for (let i = 1; i < raw.length - 1; i += 2) {
      const v = evalNode(raw[i], ctx);
      if (isErr(v)) return v;
      if (excelCompare(deref(v), deref(target)) === 0) return evalNode(raw[i + 1], ctx);
    }
    return raw.length % 2 === 0 ? evalNode(raw[raw.length - 1], ctx) : E.NA;
  },
  AND: (a) => { const r = flat(a); if (r.err) return r.err; const vs = r.list.map(x => x.v).filter(v => v != null && typeof v !== 'string'); return vs.length ? vs.every(v => !!v) : E.VALUE; },
  OR: (a) => { const r = flat(a); if (r.err) return r.err; const vs = r.list.map(x => x.v).filter(v => v != null && typeof v !== 'string'); return vs.length ? vs.some(v => !!v) : E.VALUE; },
  NOT: (a) => { const v = deref(a[0]); return !v; },
  XOR: (a) => { const r = flat(a); if (r.err) return r.err; return r.list.filter(x => !!x.v).length % 2 === 1; },
  TRUE: () => true,
  FALSE: () => false,
  IFERROR: (raw, ctx, evalNode) => {
    const v = evalNode(raw[0], ctx);
    if (isErr(v) || (Array.isArray(v) && isErr(v[0]?.[0] ?? v[0]))) return evalNode(raw[1], ctx);
    return v;
  },
  IFNA: (raw, ctx, evalNode) => {
    const v = evalNode(raw[0], ctx);
    const d = deref(v);
    return isErr(d) && d.err === '#N/A' ? evalNode(raw[1], ctx) : v;
  },
  // —— IS 系列为惰性：错误值必须作为参数值传入而非直接传播 ——
  ISBLANK: (raw, ctx, evalNode) => deref(evalNode(raw[0], ctx)) == null,
  ISNUMBER: (raw, ctx, evalNode) => typeof deref(evalNode(raw[0], ctx)) === 'number',
  ISTEXT: (raw, ctx, evalNode) => typeof deref(evalNode(raw[0], ctx)) === 'string',
  ISLOGICAL: (raw, ctx, evalNode) => typeof deref(evalNode(raw[0], ctx)) === 'boolean',
  ISERROR: (raw, ctx, evalNode) => isErr(deref(evalNode(raw[0], ctx))),
  ISERR: (raw, ctx, evalNode) => { const v = deref(evalNode(raw[0], ctx)); return isErr(v) && v.err !== '#N/A'; },
  ISNA: (raw, ctx, evalNode) => { const v = deref(evalNode(raw[0], ctx)); return isErr(v) && v.err === '#N/A'; },
  ISODD: (raw, ctx, evalNode) => { const v = deref(evalNode(raw[0], ctx)); return typeof v === 'number' && Math.abs(Math.trunc(v)) % 2 === 1; },
  ISEVEN: (raw, ctx, evalNode) => { const v = deref(evalNode(raw[0], ctx)); return typeof v === 'number' && Math.trunc(v) % 2 === 0; },
  ISFORMULA: (raw, ctx) => !!ctx.currentIsFormula,
  NA: () => E.NA,

  // —— 文本 ——
  CONCATENATE: (a) => a.map(x => toText(deref(x))).join(''),
  CONCAT: (a) => { const r = flat(a); return r.err || r.list.map(x => toText(x.v)).join(''); },
  TEXTJOIN: (a) => {
    const delim = toText(deref(a[0]));
    const ignoreEmpty = !!deref(a[1]);
    const r = flat(a.slice(2));
    if (r.err) return r.err;
    return r.list.map(x => toText(x.v)).filter(t => !ignoreEmpty || t !== '').join(delim);
  },
  LEFT: (a) => { const t = toText(deref(a[0])); const n = a[1] !== undefined ? num(a[1]).v : 1; return t.slice(0, n); },
  RIGHT: (a) => { const t = toText(deref(a[0])); const n = a[1] !== undefined ? num(a[1]).v : 1; return n >= t.length ? t : t.slice(t.length - n); },
  MID: (a) => { const t = toText(deref(a[0])); const [s, n] = allNums(a.slice(1)); if (isErr(s)) return s; return t.slice(Math.max(0, s - 1), Math.max(0, s - 1) + n); },
  LEN: (a) => toText(deref(a[0])).length,
  LOWER: (a) => toText(deref(a[0])).toLowerCase(),
  UPPER: (a) => toText(deref(a[0])).toUpperCase(),
  PROPER: (a) => toText(deref(a[0])).replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
  TRIM: (a) => toText(deref(a[0])).trim().replace(/ +/g, ' '),
  CLEAN: (a) => toText(deref(a[0])).replace(/[\x00-\x1f]/g, ''),
  SUBSTITUTE: (a) => {
    const t = toText(deref(a[0])), from = toText(deref(a[1])), to = toText(deref(a[2]));
    if (from === '') return t;
    if (a[3] !== undefined) {
      const nth = num(a[3]).v;
      let count = 0;
      return t.split(from).reduce((acc, part, i, arr) => {
        if (i === arr.length - 1) return acc + part;
        count++;
        return acc + part + (count === nth ? to : from);
      }, '');
    }
    return t.split(from).join(to);
  },
  REPLACE: (a) => {
    const t = toText(deref(a[0]));
    const [s, n] = allNums(a.slice(1, 3));
    if (isErr(s)) return s;
    const to = toText(deref(a[3]));
    return t.slice(0, s - 1) + to + t.slice(s - 1 + n);
  },
  TEXT: (a) => formatValue(deref(a[0]), toText(deref(a[1]))),
  VALUE: (a) => { const r = toNumber(toText(deref(a[0]))); return isErr(r) ? E.VALUE : r; },
  NUMBERVALUE: (a) => FUNCTIONS.VALUE(a),
  FIXED: (a) => { const [x, d] = allNums(a); if (isErr(x)) return x; const noComma = !!deref(a[2]); const dd = d === undefined ? 2 : d; const s = Math.abs(x).toFixed(dd); const [i, f] = s.split('.'); const g = noComma ? i : i.replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (x < 0 ? '-' : '') + g + (dd > 0 ? '.' + f : ''); },
  FIND: (a) => {
    const needle = toText(deref(a[0])), hay = toText(deref(a[1]));
    const start = a[2] !== undefined ? num(a[2]).v : 1;
    const idx = hay.indexOf(needle, start - 1);
    return idx < 0 ? E.VALUE : idx + 1;
  },
  SEARCH: (a) => {
    const needle = toText(deref(a[0])), hay = toText(deref(a[1]));
    const start = a[2] !== undefined ? num(a[2]).v : 1;
    const re = new RegExp(needle.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'), 'i');
    const m = re.exec(hay.slice(start - 1));
    return m ? m.index + start : E.VALUE;
  },
  EXACT: (a) => toText(deref(a[0])) === toText(deref(a[1])),
  REPT: (a) => { const t = toText(deref(a[0])); const n = num(a[1]).v; return n > 0 ? t.repeat(Math.min(n, 32767)) : ''; },
  CHAR: (a) => { const r = num(a[0]); return r.err || String.fromCharCode(Math.trunc(r.v)); },
  CODE: (a) => { const t = toText(deref(a[0])); return t ? t.charCodeAt(0) : E.VALUE; },
  T: (a) => { const v = deref(a[0]); return typeof v === 'string' ? v : ''; },

  // —— 日期时间 ——
  DATE: (a) => {
    const [y, m, d] = allNums(a);
    if (isErr(y)) return y;
    const yy = y < 1900 ? y + 1900 : y;
    return dateToSerial(new Date(Date.UTC(yy, m - 1, d)));
  },
  DATEVALUE: (a) => {
    const s = toText(deref(a[0]));
    const d = new Date(s.replace(/\./g, '-'));
    return isNaN(d) ? E.VALUE : Math.floor(dateToSerial(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))));
  },
  YEAR: (a) => { const r = num(a[0]); return r.err || serialToDate(r.v).getUTCFullYear(); },
  MONTH: (a) => { const r = num(a[0]); return r.err || serialToDate(r.v).getUTCMonth() + 1; },
  DAY: (a) => { const r = num(a[0]); return r.err || serialToDate(r.v).getUTCDate(); },
  TODAY: () => { const n = new Date(); return Math.floor(dateToSerial(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())))); },
  NOW: () => dateToSerial(new Date()),
  HOUR: (a) => { const r = num(a[0]); return r.err || serialToDate(r.v).getUTCHours(); },
  MINUTE: (a) => { const r = num(a[0]); return r.err || serialToDate(r.v).getUTCMinutes(); },
  SECOND: (a) => { const r = num(a[0]); return r.err || serialToDate(r.v).getUTCSeconds(); },
  TIME: (a) => { const [h, m, s] = allNums(a); if (isErr(h)) return h; return ((h * 3600 + m * 60 + s) / 86400) % 1; },
  TIMEVALUE: (a) => {
    const s = toText(deref(a[0]));
    const m = /(\d+):(\d+)(?::(\d+))?/.exec(s);
    if (!m) return E.VALUE;
    return ((+m[1] * 3600) + (+m[2] * 60) + (+(m[3] || 0))) / 86400;
  },
  DAYS: (a) => { const [e, s] = allNums(a); if (isErr(e)) return e; return Math.floor(e) - Math.floor(s); },
  DATEDIF: (a) => {
    const [s, e] = allNums(a);
    if (isErr(s)) return s;
    if (e < s) return E.NUM;
    const unit = toText(deref(a[2])).toUpperCase();
    const d1 = serialToDate(s), d2 = serialToDate(e);
    const yd = d2.getUTCFullYear() - d1.getUTCFullYear();
    const md = yd * 12 + (d2.getUTCMonth() - d1.getUTCMonth());
    const dayBefore = d2.getUTCDate() < d1.getUTCDate();
    switch (unit) {
      case 'Y': return Math.floor((md - (dayBefore ? 1 : 0)) / 12);
      case 'M': return md;
      case 'D': return Math.floor(e) - Math.floor(s);
      case 'MD': { let dd = d2.getUTCDate() - d1.getUTCDate(); if (dd < 0) { const pm = new Date(Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth(), 0)); dd += pm.getUTCDate(); } return dd; }
      case 'YM': return ((md - (dayBefore ? 1 : 0)) % 12 + 12) % 12;
      case 'YD': {
        const anniv = new Date(Date.UTC(d2.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate()));
        if (anniv > d2) anniv.setUTCFullYear(d2.getUTCFullYear() - 1);
        return Math.round((d2 - anniv) / 86400000);
      }
      default: return E.NUM;
    }
  },
  DAYS360: (a) => {
    const [s, e] = allNums(a);
    if (isErr(s)) return s;
    const d1 = serialToDate(s), d2 = serialToDate(e);
    return (d2.getUTCFullYear() - d1.getUTCFullYear()) * 360 + (d2.getUTCMonth() - d1.getUTCMonth()) * 30 + Math.min(d2.getUTCDate(), 30) - Math.min(d1.getUTCDate(), 30);
  },
  EDATE: (a) => {
    const [s, m] = allNums(a);
    if (isErr(s)) return s;
    const d = serialToDate(s);
    const day = d.getUTCDate();
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return dateToSerial(target);
  },
  EOMONTH: (a) => {
    const [s, m] = allNums(a);
    if (isErr(s)) return s;
    const d = serialToDate(s);
    return dateToSerial(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m + 1, 0)));
  },
  WEEKDAY: (a) => {
    const r = num(a[0]);
    if (r.err) return r.err;
    const type = a[1] !== undefined ? num(a[1]).v : 1;
    const dow = serialToDate(r.v).getUTCDay(); // 0=Sun
    if (type === 2) return dow === 0 ? 7 : dow;
    if (type === 3) return (dow + 6) % 7;
    return dow + 1;
  },
  WEEKNUM: (a) => {
    const r = num(a[0]);
    if (r.err) return r.err;
    const d = serialToDate(r.v);
    const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.floor(((d - start) / 86400000 + start.getUTCDay()) / 7) + 1;
  },
  WORKDAY: (a) => {
    const r = num(a[0]);
    if (r.err) return r.err;
    let n = num(a[1]).v;
    let d = Math.floor(r.v);
    const step = n >= 0 ? 1 : -1;
    while (n !== 0) {
      d += step;
      const dow = serialToDate(d).getUTCDay();
      if (dow !== 0 && dow !== 6) n -= step;
    }
    return d;
  },
  NETWORKDAYS: (a) => {
    const [s, e] = allNums(a);
    if (isErr(s)) return s;
    let count = 0;
    for (let d = Math.floor(s); d <= Math.floor(e); d++) {
      const dow = serialToDate(d).getUTCDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    return count;
  },
  YEARFRAC: (a) => { const [s, e] = allNums(a); if (isErr(s)) return s; return (e - s) / 360; },

  // —— 查找引用 ——
  VLOOKUP: (a) => {
    const key = deref(a[0]);
    const table = a[1];
    if (!Array.isArray(table)) return E.VALUE;
    const colIdx = num(a[2]).v;
    const approx = a[3] === undefined ? true : !!deref(a[3]);
    const rows = table.length;
    const cols = Array.isArray(table[0]) ? table[0].length : 1;
    if (colIdx < 1 || colIdx > cols) return E.REF;
    if (approx) {
      let best = null;
      for (let r = 0; r < rows; r++) {
        const v = table[r][0];
        if (isErr(v)) continue;
        if (excelCompare(v, key) <= 0) best = r;
        else break;
      }
      if (best == null) return E.NA;
      return table[best][colIdx - 1] ?? E.NA;
    }
    for (let r = 0; r < rows; r++) {
      const v = table[r][0];
      if (typeof v === 'string' && typeof key === 'string' && /[*?]/.test(key)) {
        if (matchCriteria(v, key)) return table[r][colIdx - 1] ?? E.NA;
      } else if (excelCompare(v, key) === 0) return table[r][colIdx - 1] ?? E.NA;
    }
    return E.NA;
  },
  HLOOKUP: (a) => {
    const key = deref(a[0]);
    const table = a[1];
    if (!Array.isArray(table)) return E.VALUE;
    const rowIdx = num(a[2]).v;
    const approx = a[3] === undefined ? true : !!deref(a[3]);
    const cols = Array.isArray(table[0]) ? table[0].length : 1;
    if (rowIdx < 1 || rowIdx > table.length) return E.REF;
    const first = [];
    for (let c = 0; c < cols; c++) first.push(table[0][c]);
    if (approx) {
      let best = null;
      for (let c = 0; c < cols; c++) {
        const v = first[c];
        if (isErr(v)) continue;
        if (excelCompare(v, key) <= 0) best = c;
        else break;
      }
      if (best == null) return E.NA;
      return table[rowIdx - 1][best] ?? E.NA;
    }
    for (let c = 0; c < cols; c++) {
      if (excelCompare(first[c], key) === 0) return table[rowIdx - 1][c] ?? E.NA;
    }
    return E.NA;
  },
  INDEX: (a) => {
    const arr = a[0];
    if (!Array.isArray(arr)) return deref(arr);
    const r = num(a[1]).v;
    const c = a[2] !== undefined ? num(a[2]).v : 1;
    if (r === 0 && c === 0) return arr;
    const row = arr[r - 1];
    if (!row) return E.REF;
    return row[c - 1] ?? E.REF;
  },
  MATCH: (a) => {
    const key = deref(a[0]);
    const arr = Array.isArray(a[1]) ? a[1].flat() : [a[1]];
    const type = a[2] !== undefined ? num(a[2]).v : 1;
    if (type === 0) {
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (typeof v === 'string' && typeof key === 'string' && /[*?]/.test(key)) {
          if (matchCriteria(v, key)) return i + 1;
        } else if (excelCompare(v, key) === 0) return i + 1;
      }
      return E.NA;
    }
    if (type === 1) {
      let best = E.NA;
      for (let i = 0; i < arr.length; i++) {
        if (excelCompare(arr[i], key) <= 0) best = i + 1;
        else break;
      }
      return best;
    }
    // -1
    let best = E.NA;
    for (let i = 0; i < arr.length; i++) {
      if (excelCompare(arr[i], key) >= 0) best = i + 1;
      else break;
    }
    return best;
  },
  CHOOSE: (raw, ctx, evalNode) => {
    const idx = evalNode(raw[0], ctx);
    const i = num(idx);
    if (i.err) return i.err;
    if (i.v < 1 || i.v >= raw.length) return E.VALUE;
    return evalNode(raw[Math.trunc(i.v)], ctx);
  },
  ROW: (raw, ctx) => raw[0]?.type === 'ref' ? raw[0].row : ctx.currentRow,
  COLUMN: (raw, ctx) => raw[0]?.type === 'ref' ? raw[0].col : ctx.currentCol,
  ROWS: (a) => Array.isArray(a[0]) ? a[0].length : 1,
  COLUMNS: (a) => Array.isArray(a[0]) && Array.isArray(a[0][0]) ? a[0][0].length : 1,
  TRANSPOSE: (a) => {
    const arr = a[0];
    if (!Array.isArray(arr)) return arr;
    return arr[0].map((_, c) => arr.map(row => row[c]));
  },
  SHEET: (a, ctx) => ctx.currentSheetIndex ?? 1,
  SHEETS: (a, ctx) => ctx.sheetCount ?? 1,
};

function ifsAgg(a, fn) {
  const targetR = a[0];
  const target = Array.isArray(targetR) ? targetR.flat() : [targetR];
  const pairs = [];
  for (let i = 1; i < a.length; i += 2) {
    const r = Array.isArray(a[i]) ? a[i].flat() : [a[i]];
    pairs.push([r, deref(a[i + 1])]);
  }
  const vals = [];
  outer: for (let i = 0; i < target.length; i++) {
    for (const [range, crit] of pairs) {
      if (!matchCriteria(range[i], crit)) continue outer;
    }
    if (typeof target[i] === 'number') vals.push(target[i]);
  }
  return vals.length ? fn(...vals) : 0;
}

export const FUNCTION_COUNT = Object.keys(FUNCTIONS).length;
