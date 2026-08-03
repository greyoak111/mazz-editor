// tests/contract/slide-w41.test.mjs —— 波次四十一「一键成页本体+导图帧放映本体」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('markdown→页本体（死转现状）', () => {
  test('结构化直转 v2 本体', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(/compileFromMarkdown[\s\S]{0,900}migrateFromOutline\(markdownToOutline\(md\)\)/.test(src), '有结构必须 outline→migrate→v2 本体直落（不经大纲中间态）');
    assert.ok(src.includes('serializeDoc(doc)'), '开档必须 v2 序列化');
    assert.ok(src.includes('本体死转，改文稿不联动'), '必须明白话声明死转');
    assert.ok(!/content: outline,/.test(src), '不得再开大纲中间态（本体实锤）');
  });
  test('AI 拆段', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(src.includes('aiSplitMarkdownToSlides'), 'AI 拆段必须有');
    assert.ok(src.includes("import('../factory/provider.js')") && src.includes('providerReady(cfg)'), '必须走 provider 且未配置明白话拦截');
    assert.ok(src.includes('只回 JSON 数组'), '拆段提示词必须锁 JSON');
    assert.ok(src.includes('match(/\\[[\\s\\S]*\\]/)'), '必须宽容解析（剥围栏抓数组）');
    assert.ok(src.includes('skipConfirm'), 'autoConfirm 测试口必须有（原生确认框不阻塞自动化）');
    assert.ok(src.includes('AI 拆段完成'), '完工必须明白话报数');
  });
});

describe('导图帧放映本体（不带 BridgeRef）', () => {
  test('framesToSlide 转换', () => {
    const src = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(src.includes('framesToSlide'), '帧转演示必须有');
    assert.ok(src.includes("from '../slide/doc.js'"), '必须引 slide 文档模型');
    assert.ok(src.includes('ctl.doc.frames'), '必须吃 doc.frames');
    assert.ok(/createSlideDoc\([\s\S]{0,60}帧演示/.test(src), '必须建 v2 演示文档');
    assert.ok(src.includes('fr.note'), '帧 note 必须转演讲者备注');
  });
  test('帧内节点→要点（树序 DFS）', () => {
    const src = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(src.includes('inFrame'), '帧罩节点判定必须有');
    assert.ok(/b\.x \+ b\.w \/ 2[\s\S]{0,120}b\.y \+ b\.h \/ 2/.test(src), '必须节点中心命中');
    assert.ok(src.includes('const dfs = (n) =>'), '必须树序 DFS（要点即阅读顺序）');
    assert.ok(!src.includes('BridgeRef'), '不得带 BridgeRef（后续统一推进——用户拍板）');
  });
  test('命令面', () => {
    const src = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(src.includes("mindmap.framesToSlide"), '命令必须注册');
    assert.ok(src.includes('ctl.framesToSlide = framesToSlide'), 'ctl 方法必须暴露');
    assert.ok(src.includes('先「圈帧」'), '空帧必须明白话指路');
  });
});
