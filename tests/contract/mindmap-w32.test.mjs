// tests/contract/mindmap-w32.test.mjs —— 波次三十二「性能碾压」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('布局分支框', () => {
  test('branchOf 与三布局挂载', () => {
    const src = readSrc('renderer/modules/mindmap/model.js');
    assert.ok(src.includes('branchOf(box, childBoxes)'), '分支框合并函数必须有（kityminder getBranchBox 同款）');
    assert.ok((src.match(/box\.branch = branchOf/g) || []).length >= 3, 'LR/TB/Radial 三布局必须全挂分支框');
  });
});

describe('视口虚拟化', () => {
  test('可见集与统计', () => {
    const src = readSrc('renderer/modules/mindmap/index.js');
    for (const k of ['viewRect', 'boxInView', 'branchInView', 'VIRTUAL_MIN', '_vstats']) assert.ok(src.includes(k), `缺 ${k}`);
    assert.ok(src.includes('if (!inView(b)) continue'), '视口外节点必须跳过 DOM');
    assert.ok(src.includes('if (!inViewBranch(b.branch)) continue'), '整支不可见连线必须跳（分支框判定）');
    assert.ok(src.includes('total >= VIRTUAL_MIN'), '小图必须全量零行为差');
    assert.ok(src.includes('_virtT'), '缩放必须防抖重渲染');
    assert.ok(src.includes("drag.type === 'pan' && ctl._vstats?.virtual"), '平移结束必须重算可见集');
  });
  test('懒加载折叠', () => {
    const src = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(src.includes('_lazyTouched'), '懒加载标记必须有');
    assert.ok(src.includes('_lazyApplied'), '懒加载应用统计必须有');
    assert.ok(src.includes('total >= 300'), '大图阈值必须有');
    assert.ok(src.includes('x.collapsed = true'), '默认折叠必须落');
  });
});

describe('连线 canvas 层', () => {
  test('d→pts 与绘制', () => {
    const src = readSrc('renderer/modules/mindmap/index.js');
    for (const k of ['mm-link-layer', 'pathToPts', 'bezSamples', 'distToPts', 'drawLinkLayer', 'linkStrokes']) assert.ok(src.includes(k), `缺 ${k}`);
    assert.ok((src.match(/linkStrokes\.push\(\{ id: 'conn:'/g) || []).length >= 1, '树连接线必须入 canvas 列');
    assert.ok((src.match(/shLinkStrokes\.push\(\{ id: rl\.id/g) || []).length >= 1, '引用线必须入 canvas 列（共享态）');
    assert.ok((src.match(/shLinkStrokes\.push\(\{ id: pl\.id/g) || []).length >= 1, 'parentLink 必须入 canvas 列（共享态）');
    assert.ok(src.includes('devicePixelRatio'), 'canvas 必须吃 dpr（高清屏不糊）');
  });
  test('数学命中接线', () => {
    const src = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(src.includes('hitTestLinks'), '命中函数必须有');
    assert.ok(src.includes('_lastLinkStrokes'), '命中画列缓存必须有');
    assert.ok((src.match(/hitTestLinks\(/g) || []).length >= 3, 'pointerdown/dblclick/contextmenu 三处命中必须有');
    assert.ok(!/if \(virtual\) \{\s*linkStrokes\.push\(\{ id: rl\.id[\s\S]{0,80}continue;/.test(src), '选中手柄不得被 continue 跳过（条件包裹实锤）');
  });
});
