// tests/roundtrip/xlsx.test.mjs —— 10 份真实 xlsx 进出数值零丢失
import { describe, test, assert } from '../harness.mjs';
import ExcelJS from 'exceljs';
import { importXlsx, exportXlsx } from '../../renderer/modules/sheet/io.js';

/** 生成一份 xlsx（数值/文本/公式/多表） */
async function makeXlsx(seed) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('数据');
  ws.getCell('A1').value = '名称';
  ws.getCell('B1').value = '数值';
  for (let r = 2; r <= 10; r++) {
    ws.getCell(`A${r}`).value = `项目${seed}-${r}`;
    ws.getCell(`B${r}`).value = seed * 100 + r + (r % 3 ? 0.5 : 0);
  }
  ws.getCell('B11').value = { formula: 'SUM(B2:B10)', result: 9 * (seed * 100) + 54 + 4 };
  const ws2 = wb.addWorksheet('第二表');
  ws2.getCell('A1').value = seed * 7 + 0.25;
  ws2.getCell('A2').value = '文本' + seed;
  return wb.xlsx.writeBuffer();
}

/** 读回数值（经 SheetJS） */
async function readValues(buf) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const out = [];
  const ws = wb.Sheets['数据'];
  for (let r = 2; r <= 10; r++) {
    const a = ws[`A${r}`], b = ws[`B${r}`];
    out.push([a?.v, b?.v]);
  }
  return out;
}

describe('xlsx 进出：10 份数值零丢失', () => {
  test('导入 → 模型 → 导出 → 重读，数值/文本完全一致', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const src = await makeXlsx(seed);
      const wb = await importXlsx(null, src);
      // 模型内校验
      const s1 = wb.sheetByName('数据');
      assert.ok(s1, `第 ${seed} 份：缺少「数据」表`);
      for (let r = 2; r <= 10; r++) {
        const expect = seed * 100 + r + (r % 3 ? 0.5 : 0);
        const got = s1.computed(r, 2);
        assert.equal(got, expect, `第 ${seed} 份 B${r} 数值偏差`);
      }
      // 公式求值
      const sum = s1.computed(11, 2);
      const expectSum = Array.from({ length: 9 }, (_, i) => seed * 100 + (i + 2) + ((i + 2) % 3 ? 0.5 : 0)).reduce((p, c) => p + c, 0);
      assert.ok(Math.abs(sum - expectSum) < 1e-9, `第 ${seed} 份 SUM 公式偏差: ${sum} vs ${expectSum}`);
      // 导出再读回
      const out = await exportXlsx(wb);
      const back = await readValues(out);
      for (let i = 0; i < 9; i++) {
        const r = i + 2;
        assert.equal(back[i][0], `项目${seed}-${r}`, `第 ${seed} 份导出 A${r} 文本偏差`);
        assert.equal(back[i][1], seed * 100 + r + (r % 3 ? 0.5 : 0), `第 ${seed} 份导出 B${r} 数值偏差`);
      }
    }
  });
});
