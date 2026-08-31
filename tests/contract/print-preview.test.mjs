// tests/contract/print-preview.test.mjs —— 打印预览契约（纸张/四边距/表格分页/演示分页/打印文档）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const { PAGE_SIZES, normalizeMargins } = await import('../../renderer/modules/markdown/paginate.js');
const { buildPrintDocument } = await import('../../renderer/lib/print-preview.js');
const { buildSheetPages, usedRange } = await import('../../renderer/modules/sheet/print.js');
const { buildSlidePages, buildSlidePagesForController } = await import('../../renderer/modules/slide/print.js');
const { createSlideDoc, createSlide, createItem, addSlideToDoc } = await import('../../renderer/modules/slide/doc.js');

describe('纸张与页边距', () => {
  test('纸张谱系完整（A3/A4/A5/A6/B4/B5/Letter/Legal/Executive/16K）', () => {
    for (const s of ['A3', 'A4', 'A5', 'A6', 'B4', 'B5', 'Letter', 'Legal', 'Executive', '16K']) {
      assert.ok(PAGE_SIZES[s], '缺纸张: ' + s);
    }
    assert.deepEqual(PAGE_SIZES.A4, { w: 210, h: 297 });
  });
  test('normalizeMargins：旧单值 → 四边；对象部分补齐；越界夹紧', () => {
    assert.deepEqual(normalizeMargins({ margin: 25 }), { top: 25, right: 25, bottom: 25, left: 25 });
    assert.deepEqual(normalizeMargins({ margins: { top: 10, left: 99 } }), { top: 10, right: 25, bottom: 25, left: 80 });
    assert.deepEqual(normalizeMargins({}), { top: 25, right: 25, bottom: 25, left: 25 });
  });
});

describe('打印文档', () => {
  test('@page 含精确纸张与四边距', () => {
    const html = buildPrintDocument({
      title: 't', setup: { size: 'A4', orientation: 'portrait', margins: { top: 10, right: 20, bottom: 30, left: 40 } },
      pagesHtml: '<div class="sheet">x</div>',
    });
    assert.ok(html.includes('size: 210mm 297mm'));
    assert.ok(html.includes('margin: 10mm 20mm 30mm 40mm'));
    assert.ok(html.includes('<div class="sheet">x</div>'));
    // 横向应交换宽高
    const h2 = buildPrintDocument({ title: 't', setup: { size: 'A4', orientation: 'landscape', margins: {} }, pagesHtml: '' });
    assert.ok(h2.includes('size: 297mm 210mm'));
  });
});

describe('表格分页', () => {
  function fakeSheet(rows) {
    return {
      maxRow: rows.length, maxCol: rows[0]?.length || 0,
      computed: (r, c) => rows[r - 1]?.[c - 1] ?? '',
    };
  }
  test('usedRange 裁剪末尾空行空列', () => {
    const s = fakeSheet([['a', '', ''], ['', '', '']]);
    s.maxCol = 5;
    const { maxR, maxC } = usedRange(s);
    assert.equal(maxR, 1);
    assert.equal(maxC, 1);
  });
  test('按页高分页 + 表头重复 + 内容正确', () => {
    const rows = [];
    for (let i = 1; i <= 100; i++) rows.push(['R' + i, i * 2]);
    const pages = buildSheetPages(fakeSheet(rows), { size: 'A5', orientation: 'portrait', margins: { top: 10, right: 10, bottom: 10, left: 10 } });
    assert.ok(pages.length > 1, 'A5 小纸应分多页');
    assert.ok(pages.every(p => p.includes('<th>A</th>')), '每页应重复列表头');
    assert.ok(pages[0].includes('R1'));
    assert.ok(pages[pages.length - 1].includes('R100'));
  });
});

describe('演示分页', () => {
  test('每页一张幻灯片，标题/要点/页码齐全', () => {
    const slides = [
      { title: '封面', sections: [{ heading: '', bullets: [{ text: '要点甲', lvl: 0 }] }] },
      { title: '第二页', sections: [{ heading: '细节', bullets: [{ text: '点一', lvl: 0 }] }] },
    ];
    const theme = { bg: '#000', fg: '#fff', accent: '#f00', titleColor: '#fff', font: 'sans', titleSize: 30, bodySize: 16 };
    const pages = buildSlidePages(slides, theme);
    assert.equal(pages.length, 2);
    assert.ok(pages[0].includes('封面'));
    assert.ok(pages[0].includes('要点甲'));
    assert.ok(pages[1].includes('2 / 2'));
    assert.ok(pages[1].includes('细节'));
  });
  test('V2 打印直接消费 doc2 Item，不读旧 slides', () => {
    const theme = { bg: '#000', fg: '#fff', accent: '#f00', titleColor: '#fff', font: 'sans', titleSize: 30, bodySize: 16 };
    const doc = createSlideDoc('V2 打印', 'night');
    addSlideToDoc(doc, createSlide(null, { items: [
      createItem('text', { text: 'V2 唯一文本', left: 10, top: 20, width: 80, height: 20 }),
      createItem('shape', { shape: 'ellipse', left: 30, top: 50, width: 40, height: 25 }),
    ] }));
    const pages = buildSlidePagesForController({ isV2: true, doc2: doc, theme, slides: [{ title: 'V1 脏数据', sections: [] }] });
    assert.equal(pages.length, 1);
    assert.ok(pages[0].includes('V2 唯一文本'));
    assert.ok(pages[0].includes('<ellipse'), 'V2 shape Item 必须进打印 SVG');
    assert.ok(!pages[0].includes('V1 脏数据'), '不得读旧 slides 镜像');
  });
  test('V2 打印不允许文档背景值逃出 style 属性', () => {
    const theme = { bg: '#000', fg: '#fff', font: 'sans-serif' };
    const doc = createSlideDoc('恶意背景', 'night');
    addSlideToDoc(doc, createSlide(null, {
      bg: 'red" onpointerenter="window.__slidePrintPwned=1',
      items: [createItem('text', { text: '安全页' })],
    }));
    const [html] = buildSlidePagesForController({ isV2: true, doc2: doc, theme, slides: [] });
    const host = document.createElement('div');
    host.innerHTML = html;
    assert.equal(host.firstElementChild.hasAttribute('onpointerenter'), false);
    assert.ok(!html.includes('window.__slidePrintPwned'));
  });
});
