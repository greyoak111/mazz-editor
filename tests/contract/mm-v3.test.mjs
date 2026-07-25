// tests/contract/mm-v3.test.mjs —— 导图 v3（便笺/引用线/序列化）+ 画板工具箱契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const mm = await import('../../renderer/modules/mindmap/model.js');
const drawModule = (await import('../../renderer/modules/draw/index.js')).default;

describe('导图 v3 模型', () => {
  test('便笺与引用线创建', () => {
    const n = mm.createNote('备忘', 100, 200);
    assert.equal(n.text, '备忘');
    assert.ok(n.w > 0);
    const rl = mm.createRefLine('a', 'node', 'b', 'note');
    assert.equal(rl.from.k, 'node');
    assert.equal(rl.to.k, 'note');
  });

  test('v3 序列化往返保留便笺/引用线/连接线样式', () => {
    const doc = {
      mode: 'radial', scheme: 1,
      roots: [mm.createNode('根', 'root')],
      notes: [mm.createNote('便笺甲', 50, 60)],
      refLines: [mm.createRefLine('root', 'node', 'note1', 'note')],
      linkStyle: { color: '#ff0000', width: 3 },
    };
    doc.refLines[0].note = '关联说明';
    doc.refLines[0].noteStyle = { bold: true, color: '#123456' };
    const back = mm.parseDoc(mm.serializeDoc(doc));
    assert.equal(back.mode, 'radial');
    assert.equal(back.notes.length, 1);
    assert.equal(back.notes[0].text, '便笺甲');
    assert.equal(back.refLines.length, 1);
    assert.equal(back.refLines[0].note, '关联说明');
    assert.equal(back.refLines[0].noteStyle.bold, true);
    assert.equal(back.linkStyle.color, '#ff0000');
  });

  test('旧版 JSON 与大纲兼容', () => {
    const old = mm.parseDoc(JSON.stringify({ root: { id: 'r', text: '旧根', children: [] } }));
    assert.equal(old.roots[0].text, '旧根');
    assert.deepEqual(old.notes, []);
    const md = mm.parseDoc('# 标题\n\n- 分支\n');
    assert.equal(md.roots[0].text, '标题');
  });
});

describe('画板工具箱', () => {
  test('对称镜像点列（水平/垂直/径向/曼陀罗）', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = drawModule.create(container);
    const ctl = drawModule._forTests?.instances?.get(container) || [...drawModule._forTests.instances.values()][0];
    const pts = [{ x: 100, y: 100, p: 0.5 }];
    ctl.symmetry = 'h';
    const mh = ctl._test.mirrorPts(pts);
    assert.equal(mh.length, 1);
    assert.notEqual(mh[0][0].x, 100);
    ctl.symmetry = 'mandala';
    const mm5 = ctl._test.mirrorPts(pts);
    assert.equal(mm5.length, 5, '曼陀罗应生成 5 个镜像（共 6 段）');
    container.remove();
  });

  test('画布翻转变换笔画坐标', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = drawModule.create(container);
    const ctl = [...drawModule._forTests.instances.values()].pop();
    const layer = ctl.doc.frames[0].layers[0];
    layer.strokes.push({ pts: [{ x: 10, y: 20, p: 0.5 }], color: '#000', size: 5 });
    // jsdom 无布局宽高度 → 默认 800x600
    ctl._test.flipCanvas(true);
    assert.notEqual(layer.strokes[0].pts[0].x, 10);
    container.remove();
  });
});
