// tests/contract/mindmap-w31.test.mjs —— 波次三十一「图形库扩容+模板包+模块骨架」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('模块注册骨架（kityminder 声明式 deals）', () => {
  test('骨架三件套与命令纪律', () => {
    const src = readSrc('renderer/modules/mindmap/mm-modules.js');
    for (const k of ['mmRegister', 'mmBoot', 'mmExec']) assert.ok(src.includes(k), `缺 ${k}`);
    for (const f of ['defaultOptions', 'init', 'commands', 'events', 'renderers', 'shortcuts']) assert.ok(src.includes(f), `deals 契约缺 ${f}`);
    assert.ok(src.includes('queryState(ctl) === -1'), 'exec 前必须三态检查（禁用不执行，kityminder 同款纪律）');
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes('mmBoot(ctl)'), '实例必须统一分派');
    assert.ok(idx.includes("from './mm-shapes.js'") && idx.includes("from './mm-swimlanes.js'") && idx.includes("from './mm-tplpack.js'"), '三 deals 必须注册入列');
  });
});

describe('图形库（流程图六符+箭头多形态）', () => {
  test('shape 体系与渲染', () => {
    const src = readSrc('renderer/modules/mindmap/mm-shapes.js');
    for (const s of ['rect', 'round', 'diamond', 'ellipse', 'para', 'cylinder']) assert.ok(src.includes(`'${s}'`) || src.includes(`"${s}"`), `缺形状 ${s}`);
    assert.ok(src.includes('shapeEl'), '统一形状入口必须有');
    assert.ok(src.includes('shapePad'), '形状内边距必须有（菱形椭圆文字防贴边）');
    const model = readSrc('renderer/modules/mindmap/model.js');
    assert.ok(model.includes('diamond: 1.45'), 'measureNode 必须吃 shapePad');
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes('shapeEl(svgEl, node.shape'), '节点渲染必须走形状');
    assert.ok(idx.includes('SHAPES.map'), '节点菜单必须有形状子项');
  });
  test('箭头多形态', () => {
    const src = readSrc('renderer/modules/mindmap/mm-shapes.js');
    for (const a of ['arrow', 'open', 'diamond', 'circle', 'none']) assert.ok(src.includes(`'${a}'`), `缺箭头 ${a}`);
    assert.ok(src.includes('arrowHeadD'), '箭头统一产出必须有');
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes('ARROW_HEADS.map'), '线菜单必须有箭夫子项');
    assert.ok(idx.includes("rl.arrow || ctl.doc.linkStyle?.arrow"), '线级覆盖 > 全局必须有');
  });
});

describe('泳道与模板包', () => {
  test('泳道 deals 与归属着色', () => {
    const src = readSrc('renderer/modules/mindmap/mm-swimlanes.js');
    for (const k of ['laneOf', 'renderSwimlanes', 'laneDragMove', 'laneDragEnd']) assert.ok(src.includes(k), `缺 ${k}`);
    assert.ok(src.includes('doc.swimlanes'), '文档泳道字段必须有');
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes('renderSwimlanes(svgEl, viewport, ctl)'), '泳道背景层必须入渲染');
    assert.ok(idx.includes('laneOf(ctl.doc.swimlanes'), '节点归属着色必须有');
    assert.ok(idx.includes('laneDragMove(ctl, e)') && idx.includes('laneDragEnd(ctl)'), '泳道拖拽必须接主循环');
    const model = readSrc('renderer/modules/mindmap/model.js');
    assert.ok(model.includes('swimlanes: doc.swimlanes || []') && model.includes('swimlanes: obj.swimlanes || []'), '序列化往返必须有泳道');
  });
  test('模板包 .mmtpl 结构', () => {
    const src = readSrc('renderer/modules/mindmap/mm-tplpack.js');
    assert.ok(src.includes("zip.file('meta.json'") && src.includes("zip.file('doc.json'"), '包必须 meta+doc 双件');
    assert.ok(src.includes('serializeDoc') && src.includes('parseDoc'), '文档必须走 v4 序列化');
    assert.ok(src.includes('preview.png'), '预览图必须有');
    assert.ok(src.includes('mmtpl-packs'), '库目录必须有');
    assert.ok(src.includes('applyPack'), '应用包必须有');
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes('renderPackSelect') && idx.includes('__pack-export'), 'stylebar 模板包区必须有');
  });
});
