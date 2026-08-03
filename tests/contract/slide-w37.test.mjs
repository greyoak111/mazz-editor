// tests/contract/slide-w37.test.mjs —— 波次三十七「mazzslide v2 画布编辑层」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('canvas.js 画布编辑层', () => {
  test('六类型渲染与命中', () => {
    const src = readSrc('renderer/modules/slide/canvas.js');
    for (const k of ['renderItem', 'renderPageCanvas', 'hitItem', 'snapItem', 'distributeItems', 'resolveItemOverlap', 'ITEM_TOOLS']) assert.ok(src.includes(`export ${k.startsWith('ITEM') ? 'const' : 'function'} ${k}`), `缺导出 ${k}`);
    for (const t of ['text', 'image', 'shape', 'table', 'ink', 'timer', 'variable']) assert.ok(src.includes(`case '${t}'`), `渲染缺类型 ${t}`);
    assert.ok(src.includes('pctToPx') && src.includes('pxToPct'), '必须百分比锚换算');
    assert.ok(src.includes("from '../mindmap/mm-shapes.js'"), 'shape 必须复用导图形状库');
  });
  test('磁吸/等距/避让 三算法', () => {
    const src = readSrc('renderer/modules/slide/canvas.js');
    assert.ok(src.includes('outW / 2') && src.includes('TH = 6'), '磁吸必须有画布中线与 6px 阈值');
    assert.ok(/export function snapItem\(slide, self, px, outW, outH\)/.test(src), 'snapItem 签名必须 (slide, self, px, outW, outH)——py 赘参已剥');
    assert.ok(src.includes('items.length < 3'), '等距必须 ≥3 闸');
    assert.ok(src.includes('for (let iter = 0; iter < 16; iter++)'), '避让必须有界迭代');
  });
});

describe('index.js 画布交互', () => {
  test('真画布与四型拖拽', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(src.includes('viewBox: `0 0 ${DESIGN.w} ${DESIGN.h}`'), '必须 1920×1080 viewBox 锚');
    assert.ok(src.includes('bindCanvasInput') && src.includes('stagePoint'), '画布输入绑定必须有');
    for (const t of ["type: 'item'", "type: 'resize'", "type: 'selrect'", "type: 'ghost'"]) assert.ok(src.includes(t), `缺拖拽型 ${t}`);
    assert.ok(src.includes('finishGhostAdd') && src.includes('startGhostAdd'), '工具加建拖框必须有');
  });
  test('军规级回归闸（W37 三枚真 bug 不得复活）', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(!/startGhostAdd\(p\);\s*return;/.test(src), '工具加建不得提前 return——pointermove/pointerup 监听必须照常注册（ghost 哑火根因）');
    assert.ok(/snapItem\(sl, it, \{ x: nx[\s\S]{0,240}\}, DESIGN\.w, DESIGN\.h\)/.test(src), 'snapItem 调用必须带 DESIGN.w/h——否则画布中线/边缘线全瞎');
    assert.ok(src.includes('it && ctl.selItem === it.id'), 'resize 必须命中已选中 Item 的右下角（旧 !it 永假死代码不得复活）');
    const cv = readSrc('renderer/modules/slide/canvas.js');
    assert.ok(/snapItem\(slide, self, px, outW, outH\)/.test(cv), '签名与调用必须同形');
  });
  test('工具条/缩放控件压画布防误触', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    const n = (src.match(/stopPropagation\(\)\); \/\/ /g) || []).length + (src.match(/e\.stopPropagation\(\)/g) || []).length;
    assert.ok(n >= 2, '工具条与缩放控件必须双双拦截 pointerdown（防误生微小对象/误起选框）');
    assert.ok(src.includes("case 'Delete'") || src.includes("e.key === 'Delete'"), 'Delete 删所选必须有');
    assert.ok(src.includes('editTextItem') && src.includes('showItemMenu'), '双击编辑与右键菜单必须有');
  });
});
