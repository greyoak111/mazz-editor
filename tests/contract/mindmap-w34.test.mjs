// tests/contract/mindmap-w34.test.mjs —— 波次三十四「窗格三模式+批量选删+导图桥接」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('窗格操作三模式', () => {
  test('模式机与风格一致化图标', () => {
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes("toolMode: 'build'"), '模式机必须有（build 默认=现状）');
    assert.ok(idx.includes('setToolMode') && idx.includes('syncHint'), '切换与 hint 随模式必须有');
    assert.ok(idx.includes("data-t=\"pan\""), '移动模式钮必须有');
    assert.ok(idx.includes("data-t=\"select\""), '选框模式钮必须有');
    const icons = readSrc('renderer/lib/svg-icons.js');
    assert.ok(icons.includes("'✥'"), '十字箭头必须入 SVG 库（风格一致化 stroke 族）');
    assert.ok(icons.includes("'⬚'"), '虚线选框必须入 SVG 库');
    assert.ok(icons.includes("'⇆'"), '桥接图标必须入 SVG 库');
  });
  test('移动模式行为', () => {
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes("ctl.toolMode === 'pan'"), '移动模式节点上也平移必须有');
  });
});

describe('选框模式与批量删除', () => {
  test('拖框/多选/删除链', () => {
    const idx = readSrc('renderer/modules/mindmap/index.js');
    for (const k of ['selectRectStart', 'selectRectCalc', 'applySelectRect', 'deleteMultiSel', 'renderMultiSel']) assert.ok(idx.includes(k), `缺 ${k}`);
    assert.ok(idx.includes("drag.type = 'selrect'") || idx.includes("'selrect'"), '选框拖拽必须有');
    assert.ok(idx.includes('mm-selrect'), '虚线选框元素必须有');
    assert.ok(idx.includes('ctl.multiSel.size) deleteMultiSel()'), 'Delete 快捷键批量删除必须有');
    assert.ok(idx.includes('删除所选'), '右键选单批量删除必须有');
    assert.ok(idx.includes('已选中 ${n} 个节点'), '选中计数明白话必须有');
  });
});

describe('导图间桥接', () => {
  test('合并链与防冲突', () => {
    const idx = readSrc('renderer/modules/mindmap/index.js');
    for (const k of ['cloneTreeWithNewIds', 'mergeDocsInto', 'mergeFromFile']) assert.ok(idx.includes(k), `缺 ${k}`);
    assert.ok(idx.includes('idMap.set(n.id, c.id)'), 'id 全树重生成必须有（防 id 冲突）');
    assert.ok(idx.includes('maxX + 120'), '自动落点必须右侧避让（不与原有内容冲突）');
    assert.ok(idx.includes("targetId") && idx.includes('appendChild(ctl.doc.roots, targetId, r)'), '挂选中节点档必须有');
    assert.ok(idx.includes('nrl.from = { id: idMap.get'), '引用线端点必须重映射');
    assert.ok(idx.includes("npl.from = idMap.get(pl.from)"), '多父级端点必须重映射');
    assert.ok(idx.includes('inputModal'), '来源选择交互必须有');
    assert.ok(!idx.includes('复制节点') && !idx.includes('粘贴节点') && !idx.includes('剪切节点'), '节点级复制粘贴剪切不做（内容牵扯不清——用户拍板；clipboardData 是图片便笺入口不误伤）');
  });
});
