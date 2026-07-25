// tests/contract/format-v2.test.mjs —— 下划线/首字下沉/表格尺寸/演示旋转契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const { parseMarkdown, serializeMarkdown } = await import('../../renderer/modules/markdown/schema.js');
const { blockNodeSpec, BLOCK_ATTRS } = await import('../../renderer/modules/markdown/textstyle.js');
const { renderSlideHTML } = await import('../../renderer/modules/slide/render.js');

describe('下划线（Markdown 双向）', () => {
  test('<u> 解析为 underline 标记，往返序列化保留', () => {
    const doc = parseMarkdown('这是 <u>重点内容</u> 文字\n');
    let found = false;
    doc.descendants((node) => {
      node.marks?.forEach((m) => { if (m.type.name === 'underline') found = true; });
    });
    assert.ok(found, '应解析出 underline mark');
    const md = serializeMarkdown(doc);
    assert.ok(md.includes('<u>重点内容</u>'), '序列化应还原 <u> 标签: ' + md);
  });

  test('schema 注册 underline mark', () => {
    const doc = parseMarkdown('x');
    assert.ok(doc.type.schema.marks.underline, 'schema 应有 underline');
  });
});

describe('首字下沉（块属性）', () => {
  test('dropCap 在 BLOCK_ATTRS 且 toDOM 输出 pm-dropcap class', () => {
    assert.ok('dropCap' in BLOCK_ATTRS);
    const spec = blockNodeSpec({ attrs: {}, toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] }, 'p');
    const dom = spec.toDOM({ attrs: { dropCap: true } });
    assert.equal(dom[1].class, 'pm-dropcap');
  });

  test('块样式序列化带 dropCap（往返保留）', () => {
    const doc = parseMarkdown('# 标题\n\n首字下沉段落正文。\n');
    const first = [];
    doc.forEach(n => first.push(n));
    const para = first[first.length - 1];
    const patched = doc.type.schema.nodes.doc.create(null, first.map(n =>
      n === para ? n.type.create({ ...n.attrs, dropCap: true }, n.content, n.marks) : n));
    const md = serializeMarkdown(patched);
    assert.ok(md.includes('"dropCap":true'), 'block-style 注释应含 dropCap: ' + md);
  });
});

describe('表格行列尺寸', () => {
  test('模型 colW/rowH 持久化在 serialize/deserialize', async () => {
    const { Sheet } = await import('../../renderer/modules/sheet/model.js');
    const s = new Sheet('S1');
    s.colW.set(2, 160);
    s.rowH.set(3, 48);
    const json = s.serialize();
    assert.ok((json.colW || []).some(([k, v]) => k === 2 && v === 160), 'colW 应序列化');
    assert.ok((json.rowH || []).some(([k, v]) => k === 3 && v === 48), 'rowH 应序列化');
    const s2 = Sheet.deserialize(json);
    assert.equal(s2.colW.get(2), 160);
    assert.equal(s2.rowH.get(3), 48);
  });
});

describe('演示旋转', () => {
  test('render 输出 rotate 变换；未旋转不输出', () => {
    const theme = { bg: '#000', fg: '#fff', accent: '#f00', titleColor: '#fff', font: 'sans', titleSize: 30, bodySize: 16 };
    const slide = { title: 't', sections: [], elements: [
      { type: 'rect', x: 10, y: 10, w: 20, h: 20, fill: '#123', rotate: 45 },
      { type: 'text', x: 50, y: 10, w: 20, h: 10, text: 'hi' },
    ] };
    const html = renderSlideHTML(slide, theme);
    assert.ok(html.includes('rotate(45deg)'), '应输出旋转变换');
    assert.equal((html.match(/rotate\(/g) || []).length, 1, '未旋转元素不应输出 rotate');
  });
});
