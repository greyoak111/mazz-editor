// tests/contract/slide-w42.test.mjs —— 波次四十二「pptx 互通」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('导出对象级（pptx2.js）', () => {
  test('Item→OOXML 映射表', () => {
    const src = readSrc('renderer/modules/slide/pptx2.js');
    assert.ok(src.includes('exportPptxV2'), 'v2 导出必须有');
    assert.ok(/SHAPE_MAP[\s\S]{0,140}roundRect[\s\S]{0,200}parallelogram[\s\S]{0,120}'can'/.test(src), '六符映射必须有（roundRect/diamond/parallelogram/can）');
    assert.ok(src.includes('slide.addText') && src.includes('slide.addImage') && src.includes('slide.addShape') && src.includes('slide.addTable'), '四类 add 必须有');
    assert.ok(src.includes("v / 100 * 10") && src.includes("v / 100 * 5.625"), '百分比必须转 inches');
    assert.ok(src.includes('inkToPng'), 'ink 必须 PNG 渲染嵌入');
    assert.ok(src.includes('fmtCountdown'), 'timer 必须静态文本降级');
  });
  test('帧属性随迁', () => {
    const src = readSrc('renderer/modules/slide/pptx2.js');
    assert.ok(src.includes('slide.hidden = true'), '禁用帧必须转隐藏页');
    assert.ok(src.includes('slide.addNotes'), '备注必须随迁');
  });
  test('reveal→Animation 后注入', () => {
    const src = readSrc('renderer/modules/slide/pptx2.js');
    assert.ok(src.includes('injectRevealAnimations'), 'reveal 注入必须有');
    assert.ok(src.includes('p:timing') && src.includes('nodeType="clickEffect"'), '单击序列 mainSeq 必须有');
    assert.ok(src.includes('p:spTgt spid=') || src.includes('spTgt spid="'), 'spid 目标锚必须有');
    assert.ok(src.includes('ids.slice(1)'), '组根占位跳过必须有（插入序回填实锤）');
    assert.ok(src.includes('!== jobs[i].rev.length) continue'), '对不上就不注（降级安全）必须有');
    assert.ok(src.includes('presetClass="entr"'), '入场动画类必须有');
  });
});

describe('导入降级与命令路由', () => {
  test('导入降级文本+图片闭环（现状维持）', () => {
    const src = readSrc('renderer/modules/slide/pptx-import.js');
    assert.ok(src.includes('pptxToOutline'), '导入入口必须在');
    assert.ok(src.includes('slideImages') && src.includes('<!--canvas:'), '图片必须经 canvas 注释随迁（v2 迁移落 image Item）');
    assert.ok(src.includes("/_rels/$1") && !src.includes("/_rels$1"), 'rels 路径必须带斜杠（W42 平反的静默死 bug 不得复活）');
    assert.ok(!src.includes('timing'), '导入不碰动画 XML（降级红线）');
  });
  test('slide.exportPptx 双路由', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(/isV2 \? await exportPptxV2/.test(src), 'v2 必须走对象级导出');
    assert.ok(src.includes('exportPptx(ctl.slides, ctl.theme)'), 'v1 老管线必须保留');
    assert.ok(src.includes('payload?.path'), 'path 测试口必须有（save 对话框不阻塞自动化）');
    assert.ok(src.includes("from './pptx2.js'"), 'pptx2 必须引入');
  });
});
