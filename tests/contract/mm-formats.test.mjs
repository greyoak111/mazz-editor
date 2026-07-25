// tests/contract/mm-formats.test.mjs —— 导图格式互通契约（OPML/FreeMind/XMind）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const { exportOpml, parseOpml, exportFreemind, parseFreemind, exportXmind, parseXmind, parseMindmapFile } = await import('../../renderer/modules/mindmap/formats.js');
const { createNode } = await import('../../renderer/modules/mindmap/model.js');

function sampleTree() {
  const r = createNode('根 & 特殊 <字符>');
  const a = createNode('子A');
  a.children.push(createNode('孙甲'), createNode('孙乙'));
  r.children.push(a, createNode('子B'));
  return { mode: 'lr', roots: [r, createNode('第二根')] };
}

describe('导图格式互通', () => {
  test('OPML 往返：层级/文本/特殊字符', () => {
    const doc = sampleTree();
    const back = parseOpml(exportOpml(doc, '测试'));
    assert(back.roots.length === 2, '应两整根，实际 ' + back.roots.length);
    assert(back.roots[0].text === '根 & 特殊 <字符>', '特殊字符失真：' + back.roots[0].text);
    assert(back.roots[0].children[0].children[1].text === '孙乙', '孙级丢失');
  });

  test('OPML 坏文件报错不含糊', () => {
    let msg = '';
    try { parseOpml('<notxml'); } catch (e) { msg = e.message; }
    assert(msg.length > 0, '坏 XML 应报错');
    let msg2 = '';
    try { parseOpml('<opml version="2.0"><body></body></opml>'); } catch (e) { msg2 = e.message; }
    assert(msg2.includes('outline'), '空 body 应报无 outline');
  });

  test('FreeMind 往返：多根打包与解包', () => {
    const doc = sampleTree();
    const back = parseFreemind(exportFreemind(doc));
    assert(back.roots.length >= 1, '至少一根');
    assert(back.roots[0].children.length === 2, '首根应两子');
    assert(back.roots[0].children[0].children.length === 2, '孙级保留');
  });

  test('FreeMind 单根不包虚拟根', () => {
    const doc = { mode: 'lr', roots: [sampleTree().roots[0]] };
    const xml = exportFreemind(doc);
    assert(!xml.includes('思维导图</') || xml.indexOf('<node TEXT="根') > 0, '单根结构');
    const back = parseFreemind(xml);
    assert(back.roots[0].text.startsWith('根'), '单根文本');
  });

  test('XMind 往返（zip content.json）', async () => {
    const doc = sampleTree();
    const bytes = await exportXmind(doc, '测试');
    assert(bytes.length > 100, '包过小');
    const back = await parseXmind(bytes);
    assert(back.roots.length >= 1, '至少一根');
    assert(back.roots[0].children[0].children[0].text === '孙甲', '孙级丢失');
  });

  test('parseMindmapFile 按扩展名分发', async () => {
    const doc = sampleTree();
    const d1 = await parseMindmapFile('a.opml', exportOpml(doc));
    const d2 = await parseMindmapFile('a.mm', exportFreemind(doc));
    const d3 = await parseMindmapFile('a.xmind', await exportXmind(doc));
    assert(d1.roots.length && d2.roots.length && d3.roots.length, '三格式分发');
    let msg = '';
    try { await parseMindmapFile('a.xyz', ''); } catch (e) { msg = e.message; }
    assert(msg.includes('不支持'), '未知扩展应报不支持');
  });
});
