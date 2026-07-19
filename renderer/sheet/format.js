// renderer/modules/sheet/format.js —— 数字格式（单元格显示与 TEXT() 函数共用）
// 支持子集：General / 0 / 0.00 / #,##0(.00) / 0% / 0.00% / 货币 / 常用日期格式
// Excel 序列日：1900 系统（含 Lotus 1900 闰年 bug 兼容）

export const EPOCH = Date.UTC(1899, 11, 31); // 1899-12-31

export function dateToSerial(d) {
  let serial = (d.getTime() - EPOCH) / 86400000;
  if (serial >= 60) serial += 1; // 1900-02-29 幻影日（Excel 兼容）
  return serial;
}
export function serialToDate(serial) {
  let s = serial;
  if (s >= 60) s -= 1;
  return new Date(EPOCH + s * 86400000);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 千分位 + 定点小数 */
function fixedWithGroup(num, decimals, group) {
  const neg = num < 0;
  const abs = Math.abs(num);
  let s = abs.toFixed(decimals);
  if (group) {
    const [i, f] = s.split('.');
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
  }
  return (neg ? '-' : '') + s;
}

const DATE_TOKENS = /(yyyy|yy|mmmm|mmm|mm|m|dd|d|hh|h|ss|s|AM\/PM|aaaa)/g;

function formatDate(serial, fmt) {
  const d = serialToDate(serial);
  const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
  const h = d.getUTCHours(), mi = d.getUTCMinutes(), se = d.getUTCSeconds();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const mon3 = months.map(m => m.slice(0, 3));
  return fmt.replace(DATE_TOKENS, (tok) => {
    switch (tok) {
      case 'yyyy': return String(y);
      case 'yy': return pad(y % 100);
      case 'mmmm': return months[mo - 1];
      case 'mmm': return mon3[mo - 1];
      case 'mm': return pad(mo);
      case 'm': return String(mo);
      case 'dd': return pad(da);
      case 'd': return String(da);
      case 'hh': return pad(h);
      case 'h': return String(h);
      case 'ss': return pad(se);
      case 's': return String(se);
      case 'AM/PM': return h < 12 ? 'AM' : 'PM';
      default: return tok;
    }
  });
}

/** 主入口：formatValue(value, fmt)
 * value: number | string | boolean | Date-as-serial
 * fmt: Excel 格式码子集；空/General 走默认
 */
export function formatValue(value, fmt) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object' && value.err) return value.err;
  if (typeof value === 'string') return value;
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) return '#NUM!';

  if (!fmt || fmt === 'General') {
    // Excel 风格：最多 11 位有效数字，去尾零
    if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
    let s = value.toPrecision(11).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    if (/e/i.test(s)) s = value.toExponential(5).replace(/(\.\d*?)0+e/, '$1e').replace(/\.e/, 'e');
    return s;
  }
  const f = fmt.trim();

  // 日期格式（含 y/d 字母且无数字占位符冲突的简单判定）
  if (/[ymd]/.test(f) && !/^0[.,]/.test(f) && !f.includes('%')) return formatDate(value, f);

  // 百分比
  if (f.endsWith('%')) {
    const decimals = (f.split('.')[1] || '').replace('%', '').length;
    return fixedWithGroup(value * 100, decimals, false) + '%';
  }
  // 货币/自定义前缀后缀（如 "¥"#,##0.00 或 $#,##0）
  const m = f.match(/^("?)([^#0.,]*)\1?(#,##0|0)?(\.\d+)?(.*)$/);
  if (m) {
    const [, , prefix = '', intPart = '0', decPart = '', suffix = ''] = m;
    const decimals = decPart ? decPart.length - 1 : 0;
    const group = (intPart || '').includes(',');
    return prefix + fixedWithGroup(value, decimals, group) + suffix;
  }
  return String(value);
}

/** 解析显示格式分类（对齐用）：number/date/text */
export function formatKind(fmt) {
  if (!fmt || fmt === 'General') return 'auto';
  if (/[ymd]/.test(fmt) && !fmt.includes('%')) return 'date';
  return 'number';
}
