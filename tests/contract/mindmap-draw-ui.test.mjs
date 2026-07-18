// tests/contract/mindmap-draw-ui.test.mjs —— 思维导图/画板 UI 实例化：渲染、交互、序列化
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

window.mazz = { invoke: async () => null };
window.MazzCommands = { execute: () => {} };
window.MazzHost = { notifyChange: () => {}, setTabTitle: () => {}, openTab: () => {}, toast: () => {} };

const { default: mindmapModule } = await import('../../renderer/modules/mindmap/index.js');
const { default: drawModule } = await import('../../renderer/modules/draw/index.js');
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));

const mouse = (type, x, y, extra = {}) => {
  const ev = new window.MouseEvent(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { clientX: x, clientY: y, offsetX: x, offsetY: y, pointerId: 1, button: 0, pressure: 0.5, ...extra });
  return ev;
};

describe('思维导图 UI', () => {
  test('create 渲染 SVG 节点与连线', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mindmapModule.create(container);
    await tick();
    const nodes = container.querySelectorAll('.mm-node');
    assert.ok(nodes.length >= 4, '默认示例应渲染多个节点');
    assert.ok(container.querySelectorAll('path').length >= 3, '应有连线');
    assert.ok(container.querySelector('.mm-hint'), '应有操作提示');
    container.remove();
  });

  test('setContent：JSON 文档与 Markdown 大纲双通道', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = mindmapModule.create(container);
    const ctl = mindmapModule._forTests.instances.get(container);
    // JSON
    mindmapModule.setContent(JSON.stringify({ mark: 'mazz-mindmap-v1', root: { id: 'r', text: '测试根', children: [{ id: 'c1', text: '子1', children: [], collapsed: false }], collapsed: false } }), state);
    assert.equal(ctl.doc.root.text, '测试根');
    assert.equal(ctl.doc.root.children.length, 1);
    // Markdown 大纲
    mindmapModule.setContent('# 大纲根\n\n- 分支A\n  - 叶A\n- 分支B\n', state);
    assert.equal(ctl.doc.root.text, '大纲根');
    assert.equal(ctl.doc.root.children[0].children[0].text, '叶A');
    // getContent 往返
    const back = JSON.parse(mindmapModule.getContent(state));
    assert.equal(back.root.text, '大纲根');
    container.remove();
  });

  test('节点选中 + 子节点/删除命令', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mindmapModule.create(container);
    await tick();
    const ctl = mindmapModule._forTests.instances.get(container);
    ctl.selected = ctl.doc.root.id;
    const before = ctl.doc.root.children.length;
    ctl.addChildOf();
    assert.equal(ctl.doc.root.children.length, before + 1, '应新增子节点');
    assert.ok(ctl.editing, '新节点应进入编辑态');
    // 提交编辑
    const editor = container.querySelector('.mm-editor');
    editor.value = '新分支';
    editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(ctl.doc.root.children[before].text, '新分支');
    // 删除
    ctl.selected = ctl.doc.root.children[before].id;
    ctl.deleteSelected();
    assert.equal(ctl.doc.root.children.length, before, '应删除');
    container.remove();
  });
});

describe('画板 UI', () => {
  test('create 布局 + 工具切换 + 图层管理', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    drawModule.create(container);
    await tick();
    const ctl = drawModule._forTests.instances.get(container);
    assert.ok(container.querySelector('.draw-canvas'), '画布应挂载');
    assert.ok(container.querySelector('.draw-tool-strip'), '工具条应存在');
    assert.equal(container.querySelectorAll('.draw-layer').length, 1, '默认一个图层');
    // 切工具
    container.querySelector('[data-t=eraser]').click();
    assert.equal(ctl.tool, 'eraser');
    // 新建图层
    container.querySelector('[data-a=add-layer]').click();
    assert.equal(ctl.doc.frames[0].layers.length, 2);
    assert.equal(container.querySelectorAll('.draw-layer').length, 2);
    assert.equal(ctl.activeLayer, 1, '新图层激活');
    // 删除图层
    container.querySelectorAll('.draw-layer .lv-del')[1].click();
    assert.equal(ctl.doc.frames[0].layers.length, 1);
    container.remove();
  });

  test('帧管理：新建/复制/删除', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    drawModule.create(container);
    await tick();
    const ctl = drawModule._forTests.instances.get(container);
    container.querySelector('[data-a=add-frame]').click();
    assert.equal(ctl.doc.frames.length, 2);
    assert.equal(ctl.doc.current, 1);
    container.querySelector('[data-a=dup-frame]').click();
    assert.equal(ctl.doc.frames.length, 3);
    container.querySelector('[data-a=del-frame]').click();
    assert.equal(ctl.doc.frames.length, 2);
    assert.equal(container.querySelectorAll('.draw-frame').length, 2, '帧按钮数量同步');
    container.remove();
  });

  test('序列化往返：笔画与图层结构守恒', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    drawModule.create(container);
    await tick();
    const ctl = drawModule._forTests.instances.get(container);
    // 手工注入笔画（绕过 pointer 事件）
    const { createStroke } = await import('../../renderer/modules/draw/model.js');
    ctl.doc.frames[0].layers[0].strokes.push(
      createStroke([{ x: 10, y: 10, p: 0.5 }, { x: 50, y: 50, p: 0.5 }, { x: 90, y: 10, p: 0.5 }], '#dc2626', 8));
    const json = ctl.serialize();
    // 新实例恢复
    const container2 = document.createElement('div');
    document.body.appendChild(container2);
    drawModule.create(container2);
    const ctl2 = drawModule._forTests.instances.get(container2);
    assert.ok(ctl2.deserialize(json), '恢复应成功');
    const strokes = ctl2.doc.frames[0].layers[0].strokes;
    assert.equal(strokes.length, 1);
    assert.equal(strokes[0].color, '#dc2626');
    assert.equal(strokes[0].size, 8);
    assert.equal(strokes[0].pts.length, 3);
    container.remove();
    container2.remove();
  });

  test('撤销/重做：注入笔画后可回退', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    drawModule.create(container);
    await tick();
    const ctl = drawModule._forTests.instances.get(container);
    // 经快照路径模拟一次"画完"：snapshot + push stroke
    const { createStroke } = await import('../../renderer/modules/draw/model.js');
    ctl.history.push(JSON.stringify({ frames: ctl.doc.frames, current: 0 }));
    ctl.doc.frames[0].layers[0].strokes.push(createStroke([{ x: 1, y: 1 }, { x: 5, y: 5 }], '#000', 4));
    assert.equal(ctl.doc.frames[0].layers[0].strokes.length, 1);
    ctl.undo();
    assert.equal(ctl.doc.frames[0].layers[0].strokes.length, 0, '撤销后笔画消失');
    ctl.redo();
    assert.equal(ctl.doc.frames[0].layers[0].strokes.length, 1, '重做后恢复');
    container.remove();
  });
});
