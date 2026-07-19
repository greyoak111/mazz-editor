// tests/roundtrip/docx.test.mjs —— docx round-trip 测试集（20 份）：关键元素保留率 ≥95%
import '../contract/_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell } from 'docx';
import { importDocx } from '../../renderer/modules/markdown/docx-io.js';
import { schema } from '../../renderer/modules/markdown/schema.js';

/** 生成一份含关键元素的 docx（按序号变化内容） */
async function makeDocx(i) {
  const doc = new Document({
    creator: 'mazz-test',
    sections: [{
      children: [
        new Paragraph({ text: `标题${i}`, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: `二级标题${i}`, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({
          children: [
            new TextRun({ text: '普通' }),
            new TextRun({ text: '加粗', bold: true }),
            new TextRun({ text: '斜体', italics: true }),
            new TextRun({ text: '删除线', strike: true }),
          ],
        }),
        new Paragraph({ children: [new TextRun({ text: 'const x = 1;', font: 'Consolas' })] }),
        new Paragraph({ text: '列表项甲', bullet: { level: 0 } }),
        new Paragraph({ text: '列表项乙', bullet: { level: 0 } }),
        new Table({
          rows: [
            new TableRow({ children: [new TableCell({ children: [new Paragraph('表头A')] }), new TableCell({ children: [new Paragraph('表头B')] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph('甲')] }), new TableCell({ children: [new Paragraph('5')] })] }),
          ],
        }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

function analyze(doc) {
  const found = { heading1: 0, heading2: 0, bold: 0, italic: 0, strike: 0, table: 0, list: 0 };
  doc.descendants((node) => {
    if (node.type.name === 'heading') {
      if (node.attrs.level === 1) found.heading1++;
      if (node.attrs.level === 2) found.heading2++;
    }
    if (node.type.name === 'table') found.table++;
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') found.list++;
    node.marks?.forEach(m => {
      if (m.type.name === 'strong') found.bold++;
      if (m.type.name === 'em') found.italic++;
      if (m.type.name === 'strike') found.strike++;
    });
    return true;
  });
  return found;
}

describe('docx round-trip：20 份测试集', () => {
  test('关键元素保留率 ≥95%', async () => {
    const EXPECT = ['heading1', 'heading2', 'bold', 'italic', 'table', 'list'];
    let totalScore = 0;
    for (let i = 1; i <= 20; i++) {
      const buf = await makeDocx(i);
      const { doc } = await importDocx(schema, buf);
      const f = analyze(doc);
      let hit = 0;
      if (f.heading1 >= 1) hit++;
      if (f.heading2 >= 1) hit++;
      if (f.bold >= 1) hit++;
      if (f.italic >= 1) hit++;
      if (f.table >= 1) hit++;
      if (f.list >= 1) hit++;
      totalScore += hit / EXPECT.length;
      assert.ok(f.heading1 >= 1, `第 ${i} 份：一级标题丢失`);
      assert.ok(f.bold >= 1, `第 ${i} 份：加粗丢失`);
    }
    const rate = totalScore / 20;
    console.log(`    保留率：${(rate * 100).toFixed(1)}%（20 份）`);
    assert.ok(rate >= 0.95, `保留率不足：${(rate * 100).toFixed(1)}%`);
  });
});
