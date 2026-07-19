// tests/contract/mindmap-draw.test.mjs —— 第四阶段波次2：思维导图模型/布局/大纲互转 + 画板模型/命中/历史栈
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const mm = await import('../../renderer/modules/mindmap/model.js');
const dm = await import('../../renderer/modules/draw/model.js');

describe('思维导图：树操作', () => {
  function sampleTree() {
    const r = mm.createNode('根', 'root');
    const a = mm.createNode('A', 'a');
    const b = mm.createNode('B', 'b');
    a.children.push(mm.createNode('A1', 'a1'));
    r.children.push(a, b);
    return r;
  }

  test('查找/追加/插入/删除', () => {
    const r = sampleTree();
    assert.equal(mm.findNode(r, 'a1').text, 'A1');
    assert.equal(mm.findParent(r, 'a1').id, 'a');
    const n = mm.createNode('A2', 'a2');
    mm.appendChild(r, 'a', n);
    assert.equal(mm.findNode(r, 'a').children.length, 2);
    const s = mm.createNode('B2', 'b2');
    mm.insertSibling(r, 'b', s);
    assert.equal(r.children[2].id, 'b2');
    assert.ok(mm.removeNode(r, 'a1'));
    assert.equal(mm.findNode(r, 'a1'), null);
    assert.ok(!mm.removeNode(r, 'root'), '根不可删');
  });

  test('moveNode 重排 + 防环', () => {
    const r = sampleTree();
    assert.ok(mm.moveNode(r, 'b', 'a'), 'B 移到 A 下');
    assert.equal(mm.findNode(r, 'a').children[1].id, 'b');
    assert.equal(r.children.length, 1);
    assert.ok(!mm.moveNode(r, 'a', 'b'), 'A 不能移到自己的子树（防环）');
    assert.ok(!mm.moveNode(r, 'root', 'b'), '根不可移动');
  });

  test('大纲互转：parseOutline / toOutline 往返', () => {
    const md = '# 项目计划\n\n- 前端\n  - 页面\n  - 组件\n- 后端\n  - API\n';
    const tree = mm.parseOutline(md);
    assert.equal(tree.text, '项目计划');
    assert.equal(tree.children.length, 2);
    assert.equal(tree.children[0].text, '前端');
    assert.equal(tree.children[0].children[1].text, '组件');
    const out = mm.toOutline(tree);
    assert.ok(out.includes('# 项目计划'));
    assert.ok(out.includes('- 前端'));
    assert.ok(out.includes('  - 页面'));
    // 往返一致
    const tree2 = mm.parseOutline(out);
    assert.equal(tree2.children[0].children[0].text, '页面');
  });

  test('任务列表标记被剥除', () => {
    const tree = mm.parseOutline('# T\n\n- [ ] 待办\n- [x] 完成\n');
    assert.equal(tree.children[0].text, '待办');
    assert.equal(tree.children[1].text, '完成');
  });

  test('水平树布局：父节点垂直居中于子树', () => {
    const r = sampleTree();
    const { boxes, width, height } = mm.layout(r);
    assert.ok(width > 0 && height > 0);
    const root = boxes.get('root');
    const a = boxes.get('a');
    const b = boxes.get('b');
    assert.ok(a.x > root.x && b.x > root.x, '子节点在父节点右侧');
    const a1 = boxes.get('a1');
    assert.equal(a.y, a1.y, '单子的父节点与子同高（居中）');
    // 折叠后子树不占位
    mm.findNode(r, 'a').collapsed = true;
    const L2 = mm.layout(r);
    assert.ok(!L2.boxes.has('a1'), '折叠的子孙不参与布局');
  });
});

describe('画板：数据模型与命中检测', () => {
  test('distToSegment / distToStroke', () => {
    assert.equal(dm.distToSegment(0, 5, 0, 0, 10, 0), 5);
    assert.equal(dm.distToSegment(-5, 0, 0, 0, 10, 0), 5);
    const s = dm.createStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }], '#000', 4);
    assert.equal(dm.distToStroke(s, 50, 3), 3);
  });

  test('hitStroke 取最上层 + 笔宽容差', () => {
    const layer = dm.createLayer('L');
    const s1 = dm.createStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }], '#000', 4);
    const s2 = dm.createStroke([{ x: 0, y: 6 }, { x: 100, y: 6 }], '#f00', 4);
    layer.strokes.push(s1, s2);
    assert.equal(dm.hitStroke(layer, 50, 4)?.id, s2.id, '后画的（上层）先命中');
    assert.equal(dm.hitStroke(layer, 50, 30), null, '远处不命中');
    assert.equal(dm.hitStroke(layer, 50, 10, 20)?.id, s2.id, '大容差兜底');
  });

  test('hitAnyStroke 跳过隐藏图层', () => {
    const f = dm.createFrame();
    const s = dm.createStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }], '#000', 4);
    f.layers[0].strokes.push(s);
    assert.ok(dm.hitAnyStroke(f, 25, 2));
    f.layers[0].visible = false;
    assert.equal(dm.hitAnyStroke(f, 25, 2), null);
  });

  test('moveStroke 平移', () => {
    const s = dm.createStroke([{ x: 1, y: 2 }, { x: 3, y: 4 }], '#000', 2);
    dm.moveStroke(s, 10, 20);
    assert.deepEqual(s.pts[0], { x: 11, y: 22 });
  });

  test('SnapshotStack 撤销/重做语义', () => {
    const st = new dm.SnapshotStack(3);
    st.push('v1'); st.push('v2');
    assert.equal(st.undo('v3'), 'v2');
    assert.equal(st.redoList.length, 1);
    assert.equal(st.undo('v2'), 'v1');
    assert.equal(st.undo('v1'), null, '空栈返回 null');
    assert.equal(st.redo('v1'), 'v2');
    st.push('vx');
    assert.equal(st.redoList.length, 0, '新操作清空重做栈');
    // 容量上限
    const st2 = new dm.SnapshotStack(2);
    st2.push('a'); st2.push('b'); st2.push('c');
    assert.equal(st2.undoList.length, 2);
    assert.equal(st2.undo('z'), 'c');
  });
});
