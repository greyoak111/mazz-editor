// tests/contract/mindmap-w35.test.mjs —— 混合画布（钉坐标/磁吸/等距/避让/图片便笺）+快捷键对调契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('快捷键对调', () => {
  test('Enter 确认 / Alt+Enter 换行', () => {
    const src = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(src.includes("e.key === 'Enter' && !e.altKey"), 'Enter 必须为确认提交');
    assert.ok(src.includes('Alt+Enter 换行'), 'Alt+Enter 必须为换行（对调不反直觉实锤）');
    assert.ok(!/Enter 换行；Ctrl\+Enter/.test(src), '旧「Enter 换行」注释与逻辑必须清');
  });
});

describe('钉坐标（脱离布局）', () => {
  test('pinned 布局跳过与角标与右键项', () => {
    const model = readSrc('renderer/modules/mindmap/model.js');
    assert.ok((model.match(/node\.pinned/g) || []).length >= 2, 'LR/TB 布局必须 pinned 跳过');
    assert.ok(model.includes('node.fx == null'), 'pinned 未初始化必须随布局值起步');
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes('mm-pin'), '图钉角标必须有');
    assert.ok(idx.includes('钉住位置（脱离布局）'), '右键钉住项必须有');
    assert.ok(idx.includes('delete n.fx'), '取消钉住必须清自由坐标回归布局流');
  });
});

describe('磁吸对齐线', () => {
  test('吸附与参考线', () => {
    const idx = readSrc('renderer/modules/mindmap/index.js');
    for (const k of ['snapNode', 'renderSnapLines', 'mm-snapline']) assert.ok(idx.includes(k), `缺 ${k}`);
    assert.ok(idx.includes('8 / ctl.cam.k'), '吸附阈值必须随缩放');
    assert.ok(idx.includes("stroke-dasharray': '4 3'"), '参考线必须虚线（excalidraw 式）');
    assert.ok(idx.includes("viewport.querySelectorAll('.mm-snapline').forEach(el => el.remove())"), '松手必须清线');
  });
});

describe('等距分布与自动避让与图片便笺', () => {
  test('等距分布', () => {
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes('distributeSel'), '等距分布必须有');
    assert.ok(idx.includes('水平等距分布') && idx.includes('垂直等距分布'), '右键双轴项必须有');
    assert.ok(idx.includes('ctl.multiSel.size < 3'), '必须≥3 才分布');
    assert.ok(idx.includes('首尾不动') || idx.includes('items[i - 1]'), '必须首尾不动中间均分');
  });
  test('自动避让', () => {
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes('resolveEntityOverlap(node)'), '节点落位必须防重合');
  });
  test('图片便笺', () => {
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes('n.image'), '便笺图片字段必须有');
    assert.ok(idx.includes("svgEl('image'"), '图片渲染必须有');
    assert.ok(idx.includes("wrap.addEventListener('paste'") && idx.includes("wrap.addEventListener('drop'"), '粘贴与拖入双入口必须有');
    const model = readSrc('renderer/modules/mindmap/model.js');
    assert.ok(model.includes('image: null'), '模型便笺必须带 image 位');
  });
});
