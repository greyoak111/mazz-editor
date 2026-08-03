// tests/contract/slide-w36.test.mjs —— 波次三十六「mazzslide v2 文档模型骨架」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('v2 文档模型', () => {
  test('工厂与物料×编排分离', () => {
    const src = readSrc('renderer/modules/slide/doc.js');
    for (const k of ['createSlideDoc', 'createSlide', 'createItem', 'createFrame', 'addSlideToDoc', 'serializeDoc', 'parseDoc']) assert.ok(src.includes(k), `缺 ${k}`);
    assert.ok(src.includes('slides: {}') && src.includes("layouts: { main"), '物料 slides 与编排 layouts 必须分离（FreeShow 同款骨架）');
    assert.ok(src.includes('frames: []'), '编排必须有 frames 序列');
    assert.ok(src.includes('nextAfter') && src.includes('transition'), '帧必须有切换与到时（W39 消费）');
  });
  test('百分比对象模型与桥接预留', () => {
    const src = readSrc('renderer/modules/slide/doc.js');
    assert.ok(src.includes('DESIGN = { w: 1920, h: 1080 }'), '设计分辨率锚必须有');
    assert.ok(src.includes('pctToPx') && src.includes('pxToPct'), '百分比换算必须有');
    assert.ok(src.includes('left: props.left ??') && src.includes('width: props.width ??'), 'Item 必须百分比坐标（分辨率无关）');
    assert.ok(src.includes('source: null'), 'Item.source 桥接字段必须预留（后续统一推进——用户拍板维持现状）');
    for (const t of ['text', 'image', 'shape', 'table', 'ink', 'timer', 'variable']) assert.ok(src.includes(`'${t}'`), `缺类型 ${t}`);
  });
});

describe('v1 lazy 迁移', () => {
  test('migrateFromOutline', () => {
    const src = readSrc('renderer/modules/slide/doc.js');
    assert.ok(src.includes('migrateFromOutline'), 'v1 迁移必须有');
    assert.ok(src.includes('parseOutline(outlineText)'), '迁移必须走 v1 解析器');
    assert.ok(src.includes("size: 44") || src.includes('size: 44'), '标题 Item 必须还原');
    assert.ok(src.includes("icon: b.style === 'heading' ? '§' : '•'"), '小节标题与要点必须分级');
    assert.ok(src.includes('p.notes'), '备注必须随迁');
  });
});

describe('index.js v2 骨架', () => {
  test('v2 模式进出与保存', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(src.includes('enterV2') && src.includes('exitV2'), 'v2 模式进出必须有');
    assert.ok(/setContent[\s\S]{0,900}parseDoc\(text\)/.test(src), 'setContent 必须统一 parseDoc 入口（v1 大纲全迁 v2 实锤）');
    assert.ok(src.includes('serializeDoc(ctl.doc2)'), 'v2 模式必须存 v2 文档');
    assert.ok(src.includes('createSlideDoc'), 'newDocument 必须 v2 起手式');
    assert.ok(!/createSlide\(container\).{0,200}createSlide\(null/.test(src.replace(/createV2Slide/g, 'CV2')), '工厂命名不得冲突（createV2Slide 别名实锤）');
  });
  test('页侧栏', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(src.includes('renderPageList'), '页侧栏必须有');
    assert.ok(src.includes('slideTitleOf'), '页标题谱必须有');
    assert.ok(src.includes('dragstart') && src.includes("'drop'"), '拖拽排序必须有');
    assert.ok(src.includes('data-a="del"'), '删除页必须有');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(css.includes('.sl-v2-page') && css.includes('overflow-y: auto'), '页侧栏样式与滚动必须有');
  });
});
