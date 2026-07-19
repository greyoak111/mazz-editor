// tests/unit/formula.test.mjs —— 公式引擎与 Excel 一致性测试
import { describe, test, assert } from '../harness.mjs';
import { parse, evaluate, E, isErr } from '../../renderer/modules/sheet/formula/engine.js';
import { FUNCTIONS, FUNCTION_COUNT } from '../../renderer/modules/sheet/formula/functions.js';

/** 迷你工作簿求值器（支持公式互相引用 + 循环检测） */
function makeCtx(cells = {}, currentSheet = 'Sheet1') {
  const visiting = new Set();
  const ctx = {
    currentSheet,
    currentRow: 1, currentCol: 1,
    sheetCount: 2,
    functions: FUNCTIONS,
    getCell(sheet, row, col) {
      const key = `${sheet}!${row},${col}`;
      let raw = cells[`${sheet}!R${row}C${col}`];
      if (typeof raw === 'string' && raw.startsWith('=')) {
        if (visiting.has(key)) return E.CYCLE;
        visiting.add(key);
        const sub = { ...ctx, currentSheet: sheet, currentRow: row, currentCol: col };
        const v = evaluate(parse(raw), sub);
        visiting.delete(key);
        return v;
      }
      return raw ?? null;
    },
    getRange(sheet, r1, r2) {
      const rows = [];
      for (let r = Math.min(r1.row, r2.row); r <= Math.max(r1.row, r2.row); r++) {
        const line = [];
        for (let c = Math.min(r1.col, r2.col); c <= Math.max(r1.col, r2.col); c++) {
          line.push(this.getCell(sheet, r, c));
        }
        rows.push(line);
      }
      return rows;
    },
  };
  return ctx;
}

function calc(f, cells) {
  try { return evaluate(parse(f), makeCtx(cells)); }
  catch (e) { return isErr(e) ? e : E.VALUE; }
}
function ok(actual, expected, msg) {
  if (isErr(actual)) throw new Error(`${msg || ''} 期望 ${expected}，实得错误 ${actual.err}`);
  if (typeof expected === 'number' && typeof actual === 'number') {
    assert.ok(Math.abs(actual - expected) < 1e-9, `期望 ${expected}，实得 ${actual}`);
  } else {
    assert.deepEqual(actual, expected, msg);
  }
}
function okErr(actual, errCode) {
  assert.ok(isErr(actual), `期望错误 ${errCode}，实得 ${JSON.stringify(actual)}`);
  assert.equal(actual.err, errCode);
}

describe('公式引擎：四则与运算优先级', () => {
  test('优先级与结合性', () => {
    ok(calc('=1+2*3'), 7);
    ok(calc('=(1+2)*3'), 9);
    ok(calc('=2^3^2'), 512);          // 右结合
    ok(calc('=-3^2'), 9);             // Excel：一元负号优先于幂
    ok(calc('=10/4'), 2.5);
    ok(calc('=10%'), 0.1);
    ok(calc('=50%+50%'), 1);
  });
  test('连接与比较', () => {
    ok(calc('="a"&"b"'), 'ab');
    ok(calc('=1&2'), '12');
    ok(calc('="总数："&SUM(1,2)'), '总数：3');
    ok(calc('=1=1'), true);
    ok(calc('="a"="A"'), true);       // 不区分大小写
    ok(calc('=2>1'), true);
    ok(calc('=1<>1'), false);
    ok(calc('="5"+3'), 8);            // 文本数字强制
    ok(calc('=TRUE+1'), 2);
  });
  test('错误值', () => {
    okErr(calc('=1/0'), '#DIV/0!');
    okErr(calc('=SQRT(-1)'), '#NUM!');
    okErr(calc('=UNKNOWNFUNC(1)'), '#NAME?');
    okErr(calc('=1+'), '#VALUE!');
  });
});

describe('公式引擎：统计函数', () => {
  const grid = {
    'Sheet1!R1C1': 1, 'Sheet1!R2C1': 2, 'Sheet1!R3C1': 3, 'Sheet1!R4C1': '文本', 'Sheet1!R5C1': null,
    'Sheet1!R1C2': 10, 'Sheet1!R2C2': 20, 'Sheet1!R3C2': 30,
  };
  test('SUM/AVERAGE/COUNT/COUNTA/COUNTBLANK', () => {
    ok(calc('=SUM(A1:A3)', grid), 6);
    ok(calc('=SUM(A1:A5)', grid), 6);       // 文本/空忽略
    ok(calc('=SUM(1,2,3)'), 6);
    ok(calc('=SUM("5")'), 5);
    okErr(calc('=SUM("abc")'), '#VALUE!');
    ok(calc('=AVERAGE(1,2,3,4)'), 2.5);
    ok(calc('=COUNT(A1:A5)', grid), 3);
    ok(calc('=COUNTA(A1:A5)', grid), 4);
    ok(calc('=COUNTBLANK(A1:A5)', grid), 1);
  });
  test('MAX/MIN/MEDIAN/MODE/STDEV/VAR/LARGE/SMALL/RANK', () => {
    ok(calc('=MAX(A1:A3)', grid), 3);
    ok(calc('=MIN(A1:A3)', grid), 1);
    ok(calc('=MEDIAN(1,2,3,4)'), 2.5);
    ok(calc('=MODE(1,2,2,3)'), 2);
    ok(calc('=STDEV(2,4,4,4,5,5,7,9)'), 2.138089935299395);
    ok(calc('=STDEVP(2,4,4,4,5,5,7,9)'), 2);
    ok(calc('=VAR(2,4,4,4,5,5,7,9)'), 4.571428571428571);
    ok(calc('=VARP(2,4,4,4,5,5,7,9)'), 4);
    ok(calc('=LARGE({1,5,2,4},2)'), 4);
    ok(calc('=SMALL({1,5,2,4},2)'), 2);
    ok(calc('=RANK(3,{1,2,3,4})'), 2);
    ok(calc('=PERCENTILE({1,2,3,4},0.5)'), 2.5);
    ok(calc('=QUARTILE({1,2,3,4},2)'), 2.5);
  });
  test('SUMPRODUCT/SUMSQ/PRODUCT', () => {
    ok(calc('=SUMPRODUCT({1,2,3},{4,5,6})'), 32);
    ok(calc('=SUMSQ(3,4)'), 25);
    ok(calc('=PRODUCT(2,3,4)'), 24);
  });
  test('COUNTIF/SUMIF/COUNTIFS/SUMIFS/AVERAGEIF', () => {
    ok(calc('=COUNTIF(A1:A3,">1")', grid), 2);
    ok(calc('=COUNTIF(A1:A5,"文*")', grid), 1);
    ok(calc('=SUMIF(A1:A3,">1",B1:B3)', grid), 50);
    ok(calc('=SUMIF(A1:A3,">1")', grid), 5);
    ok(calc('=COUNTIFS(A1:A3,">0",B1:B3,">=20")', grid), 2);
    ok(calc('=SUMIFS(B1:B3,A1:A3,">0",B1:B3,">=20")', grid), 50);
    ok(calc('=AVERAGEIF(A1:A3,">1")', grid), 2.5);
    ok(calc('=MAXIFS(B1:B3,A1:A3,">1")', grid), 30);
    ok(calc('=MINIFS(B1:B3,A1:A3,">1")', grid), 20);
  });
});

describe('公式引擎：逻辑函数', () => {
  test('IF/IFS/SWITCH/AND/OR/NOT/XOR/IFERROR/IFNA', () => {
    ok(calc('=IF(1>2,"a","b")'), 'b');
    ok(calc('=IF(TRUE,1,1/0)'), 1);          // 惰性分支
    ok(calc('=IF(FALSE,1/0,42)'), 42);
    ok(calc('=IFS(1>2,"a",2>1,"b")'), 'b');
    okErr(calc('=IFS(1>2,"a")'), '#N/A');
    ok(calc('=SWITCH(2,1,"a",2,"b","z")'), 'b');
    ok(calc('=AND(TRUE,1)'), true);
    ok(calc('=OR(FALSE,0)'), false);
    ok(calc('=NOT(FALSE)'), true);
    ok(calc('=XOR(TRUE,FALSE)'), true);
    ok(calc('=XOR(TRUE,TRUE)'), false);
    ok(calc('=IFERROR(1/0,42)'), 42);
    ok(calc('=IFERROR(7,42)'), 7);
    ok(calc('=IFNA(NA(),9)'), 9);
    ok(calc('=IFNA(7,9)'), 7);
  });
  test('IS 系列', () => {
    ok(calc('=ISNUMBER(1)'), true);
    ok(calc('=ISTEXT("a")'), true);
    ok(calc('=ISLOGICAL(TRUE)'), true);
    ok(calc('=ISBLANK(A9)', {}), true);
    ok(calc('=ISERROR(1/0)'), true);
    ok(calc('=ISERR(NA())'), false);
    ok(calc('=ISNA(NA())'), true);
    ok(calc('=ISODD(3)'), true);
    ok(calc('=ISEVEN(4)'), true);
  });
});

describe('公式引擎：文本函数', () => {
  test('截取/查找/替换', () => {
    ok(calc('=LEFT("hello",2)'), 'he');
    ok(calc('=RIGHT("hello",2)'), 'lo');
    ok(calc('=MID("hello",2,3)'), 'ell');
    ok(calc('=LEN("hello")'), 5);
    ok(calc('=FIND("l","hello")'), 3);
    okErr(calc('=FIND("z","hello")'), '#VALUE!');
    ok(calc('=SEARCH("L*","hello")'), 3);
    ok(calc('=SUBSTITUTE("a-b-c","-","+")'), 'a+b+c');
    ok(calc('=SUBSTITUTE("a-a-a","a","b",2)'), 'a-b-a');
    ok(calc('=REPLACE("abcdef",2,3,"X")'), 'aXef');
    ok(calc('=REPT("ab",3)'), 'ababab');
  });
  test('拼接/大小写/修整/转换', () => {
    ok(calc('=CONCATENATE("a","b","c")'), 'abc');
    ok(calc('=CONCAT("a",{"b","c"})'), 'abc');
    ok(calc('=TEXTJOIN(",",TRUE,"a","","b")'), 'a,b');
    ok(calc('=LOWER("ABC")'), 'abc');
    ok(calc('=UPPER("abc")'), 'ABC');
    ok(calc('=PROPER("hello world")'), 'Hello World');
    ok(calc('=TRIM("  a  b  ")'), 'a b');
    ok(calc('=EXACT("a","A")'), false);
    ok(calc('=CHAR(65)'), 'A');
    ok(calc('=CODE("A")'), 65);
    ok(calc('=T("abc")'), 'abc');
    ok(calc('=T(1)'), '');
    ok(calc('=VALUE("123")'), 123);
    ok(calc('=FIXED(1234.567,1)'), '1,234.6');
  });
  test('TEXT 格式化', () => {
    ok(calc('=TEXT(1234.567,"#,##0.00")'), '1,234.57');
    ok(calc('=TEXT(0.25,"0%")'), '25%');
    ok(calc('=TEXT(0.256,"0.0%")'), '25.6%');
    ok(calc('=TEXT(DATE(2024,1,15),"yyyy-mm-dd")'), '2024-01-15');
    ok(calc('=TEXT(1234.5,"0.00")'), '1234.50');
  });
});

describe('公式引擎：日期时间函数', () => {
  test('DATE/分量/溢出', () => {
    ok(calc('=YEAR(DATE(2024,1,15))'), 2024);
    ok(calc('=MONTH(DATE(2024,1,15))'), 1);
    ok(calc('=DAY(DATE(2024,1,15))'), 15);
    ok(calc('=YEAR(DATE(2024,13,1))'), 2025); // 月份溢出
    ok(calc('=MONTH(DATE(2024,13,1))'), 1);
    ok(calc('=DAY(DATE(2024,2,31))'), 2);      // 2024-03-02
  });
  test('DATEDIF/DAYS/DAYS360/NETWORKDAYS/WORKDAY', () => {
    ok(calc('=DATEDIF(DATE(2024,1,1),DATE(2025,3,5),"Y")'), 1);
    ok(calc('=DATEDIF(DATE(2024,1,1),DATE(2025,3,5),"M")'), 14);
    ok(calc('=DATEDIF(DATE(2024,1,1),DATE(2025,3,5),"D")'), 429);
    ok(calc('=DATEDIF(DATE(2024,1,15),DATE(2024,3,5),"MD")'), 19);
    ok(calc('=DAYS(DATE(2024,3,1),DATE(2024,1,1))'), 60);
    ok(calc('=DAYS360(DATE(2024,1,1),DATE(2024,3,1))'), 60);
    ok(calc('=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7))'), 5);
    ok(calc('=DAY(WORKDAY(DATE(2024,1,5),1))'), 8);
  });
  test('EDATE/EOMONTH/WEEKDAY/WEEKNUM/TIME', () => {
    ok(calc('=DAY(EDATE(DATE(2024,1,31),1))'), 29);
    ok(calc('=DAY(EOMONTH(DATE(2024,2,5),0))'), 29);
    ok(calc('=MONTH(EOMONTH(DATE(2024,1,15),1))'), 2);
    ok(calc('=WEEKDAY(DATE(2024,1,7))'), 1);
    ok(calc('=WEEKDAY(DATE(2024,1,7),2)'), 7);
    ok(calc('=WEEKNUM(DATE(2024,1,1))'), 1);
    ok(calc('=TIME(12,30,0)'), 0.5208333333333334);
    ok(calc('=HOUR(TIME(14,30,0))'), 14);
    ok(calc('=MINUTE(TIME(14,30,0))'), 30);
    ok(calc('=TIMEVALUE("12:00:00")'), 0.5);
    ok(calc('=YEAR(DATEVALUE("2024-01-15"))'), 2024);
  });
});

describe('公式引擎：查找引用', () => {
  const grid = {
    'Sheet1!R1C1': 'apple', 'Sheet1!R2C1': 'banana', 'Sheet1!R3C1': 'cherry',
    'Sheet1!R1C2': 10, 'Sheet1!R2C2': 20, 'Sheet1!R3C2': 30,
    'Sheet1!R1C4': 1, 'Sheet1!R2C4': 2, 'Sheet1!R3C4': 3, 'Sheet1!R4C4': 4,
  };
  test('VLOOKUP 精确/近似/未命中', () => {
    ok(calc('=VLOOKUP("banana",A1:B3,2,FALSE)', grid), 20);
    ok(calc('=VLOOKUP("ban*",A1:B3,2,FALSE)', grid), 20);
    okErr(calc('=VLOOKUP("mango",A1:B3,2,FALSE)', grid), '#N/A');
    ok(calc('=VLOOKUP(2.5,D1:D4,1,TRUE)', grid), 2);
    okErr(calc('=VLOOKUP(0.5,D1:D4,1,TRUE)', grid), '#N/A');
  });
  test('HLOOKUP/INDEX/MATCH/CHOOSE/TRANSPOSE', () => {
    ok(calc('=HLOOKUP("b",{"a","b","c";1,2,3},2,FALSE)'), 2);
    ok(calc('=INDEX({1,2;3,4},2,2)'), 4);
    ok(calc('=MATCH(3,{1,2,3,4},0)'), 3);
    ok(calc('=MATCH("b*",{"apple","banana"},0)'), 2);
    okErr(calc('=MATCH(9,{1,2,3},0)'), '#N/A');
    ok(calc('=CHOOSE(2,"a","b","c")'), 'b');
    assert.deepEqual(calc('=TRANSPOSE({1,2;3,4})'), [[1, 3], [2, 4]]);
  });
  test('ROW/COLUMN/ROWS/COLUMNS/SHEETS', () => {
    ok(calc('=ROW()'), 1);
    ok(calc('=ROWS(A1:C3)', grid), 3);
    ok(calc('=COLUMNS(A1:C3)', grid), 3);
    ok(calc('=SHEETS()'), 2);
  });
});

describe('公式引擎：数学函数', () => {
  test('舍入/取整', () => {
    ok(calc('=ROUND(2.5,0)'), 3);
    ok(calc('=ROUND(-2.5,0)'), -3);
    ok(calc('=ROUND(3.14159,2)'), 3.14);
    ok(calc('=ROUNDUP(3.141,2)'), 3.15);
    ok(calc('=ROUNDDOWN(3.149,2)'), 3.14);
    ok(calc('=INT(-1.5)'), -2);
    ok(calc('=TRUNC(-1.5)'), -1);
    ok(calc('=CEILING(4.3,1)'), 5);
    ok(calc('=FLOOR(4.7,1)'), 4);
    ok(calc('=MROUND(10,3)'), 9);
    ok(calc('=EVEN(3)'), 4);
    ok(calc('=ODD(4)'), 5);
  });
  test('算术/数论', () => {
    ok(calc('=ABS(-5)'), 5);
    ok(calc('=SIGN(-5)'), -1);
    ok(calc('=SQRT(16)'), 4);
    ok(calc('=POWER(2,10)'), 1024);
    ok(calc('=MOD(7,3)'), 1);
    ok(calc('=MOD(-7,3)'), 2);
    ok(calc('=MOD(7,-3)'), -2);
    ok(calc('=GCD(12,18)'), 6);
    ok(calc('=LCM(4,6)'), 12);
    ok(calc('=FACT(5)'), 120);
    ok(calc('=COMBIN(5,2)'), 10);
  });
  test('三角/对数', () => {
    ok(calc('=PI()'), Math.PI);
    ok(calc('=EXP(1)'), Math.E);
    ok(calc('=LN(EXP(1))'), 1);
    ok(calc('=LOG(100)'), 2);
    ok(calc('=LOG10(1000)'), 3);
    ok(calc('=SIN(PI()/2)'), 1);
    ok(calc('=COS(0)'), 1);
    ok(calc('=DEGREES(PI())'), 180);
    ok(calc('=RADIANS(180)'), Math.PI);
    ok(calc('=ATAN2(1,1)'), Math.PI / 4);
    ok(calc('=SINH(0)'), 0);
    ok(calc('=TANH(0)'), 0);
  });
  test('随机（范围校验）', () => {
    const v = calc('=RANDBETWEEN(1,10)');
    assert.ok(v >= 1 && v <= 10 && Number.isInteger(v));
    const r = calc('=RAND()');
    assert.ok(r >= 0 && r < 1);
  });
});

describe('公式引擎：引用与跨表/循环', () => {
  test('公式互相引用', () => {
    const grid = {
      'Sheet1!R1C1': 5,
      'Sheet1!R2C1': '=A1*2',   // A2 = 10
      'Sheet1!R3C1': '=A2+1',   // A3 = 11
    };
    ok(calc('=A3', grid), 11);
  });
  test('循环引用检测', () => {
    const grid = {
      'Sheet1!R1C1': '=B1+1',
      'Sheet1!R1C2': '=A1+1',
    };
    okErr(calc('=A1', grid), '#CYCLE!');
  });
  test('跨表引用', () => {
    const grid = { 'Sheet2!R1C1': 99 };
    ok(calc('=Sheet2!A1', grid), 99);
    ok(calc('=SUM(Sheet2!A1:A1)', grid), 99);
  });
  test('函数数量 ≥ 100', () => {
    assert.ok(FUNCTION_COUNT >= 100, `当前 ${FUNCTION_COUNT} 个`);
  });
});
