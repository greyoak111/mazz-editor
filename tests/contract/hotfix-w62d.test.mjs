import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  captureDistillBlocks, validateDistillPlan, distillWithRetry,
  planToPreview, previewToPlan, planToRoots,
} from '../../renderer/modules/mindmap/distill.js';
import { serializeDoc, parseDoc } from '../../renderer/modules/mindmap/model.js';

const blocks = captureDistillBlocks('# 总论\n- 证据甲\n  - 证据乙\n> 结论');
assert.deepEqual(blocks.map(b => b.text), ['总论', '证据甲', '证据乙', '结论'], '仅剥结构标记，不改正文');

const manyLines = Array.from({ length: 300 }, (_, index) => `块${index + 1}`).join('\n');
const manyBlocks = captureDistillBlocks(manyLines);
assert.equal(manyBlocks.length, 300, '提炼不得因旧 240 块门限拒绝或截断输入');
assert.equal(manyBlocks.at(-1)?.text, '块300', '输入尾部块必须完整保留');

assert.throws(
  () => validateDistillPlan([{ id: 'B001', depth: 1 }, { id: 'B001', depth: 2 }, { id: 'B003', depth: 2 }, { id: 'B004', depth: 1 }], blocks),
  /重复使用/,
  '重复块必须被契约拒绝',
);
assert.throws(
  () => validateDistillPlan([{ id: 'B001', depth: 1 }, { id: 'B002', depth: 3 }, { id: 'B003', depth: 2 }, { id: 'B004', depth: 1 }], blocks),
  /跳级/,
  '层级跳跃必须被契约拒绝',
);

let calls = 0;
const distilled = await distillWithRetry('甲\n乙\n丙', async () => {
  calls++;
  return calls === 1
    ? '[{"id":"B001","depth":1}]'
    : '[{"id":"B001","depth":1},{"id":"B003","depth":2},{"id":"B002","depth":2}]';
});
assert.equal(calls, 2, '解析失败后只自动重试一次');
assert.equal(distilled.attempts, 2);

const preview = planToPreview(distilled.plan, distilled.blocks);
assert.deepEqual(previewToPlan(preview, distilled.blocks), distilled.plan, '预览层级可无损回读');
assert.throws(() => previewToPlan(preview.replace('乙', '新增'), distilled.blocks), /增加、删除或改写/, '预览不允许改写正文');

const sourceRef = { filePath: 'D:/docs/source.md', title: 'source.md', selection: { from: 2, to: 9 } };
const roots = planToRoots(distilled.plan, distilled.blocks, sourceRef, 'test');
assert.equal(roots.length, 1);
assert.deepEqual(roots[0].children.map(n => n.text), ['丙', '乙']);
assert.equal(roots[0].sourceRef.filePath, sourceRef.filePath, '提炼根保留回跳钩');

const encoded = serializeDoc({ mode: 'lr', scheme: 0, roots, sourceRef });
assert.deepEqual(parseDoc(encoded).sourceRef, sourceRef, '源文档回跳信息必须跨保存/重开');

const markdownSource = fs.readFileSync(new URL('../../renderer/modules/markdown/index.js', import.meta.url), 'utf8');
const mindmapSource = fs.readFileSync(new URL('../../renderer/modules/mindmap/index.js', import.meta.url), 'utf8');
const providerSource = fs.readFileSync(new URL('../../renderer/modules/factory/provider.js', import.meta.url), 'utf8');
assert.match(markdownSource, /markdown\.distillSelectionToMindmap/);
assert.match(markdownSource, /markdown\.distillDocumentToMindmap/);
assert.match(markdownSource, /previewToPlan\(area\.value, blocks\)/, '创建前必须复验预览');
assert.match(mindmapSource, /return ctl;\s*\n\s*},\s*\n\s*activate\(/, 'mindmap create 必须返回 ctl 本体');
assert.match(mindmapSource, /graftDistillRoots/);
assert.match(mindmapSource, /mm-source-hook/);
assert.doesNotMatch(mindmapSource, /bullets\.slice\(0,\s*12\)|split\('\\n'\)\[0\]\.slice\(0,\s*40\)/,
  '帧转演示不得按节点条数或节点字符数裁掉导图内容');
assert.match(providerSource, /mindmap_distill/);
const distillSource = fs.readFileSync(new URL('../../renderer/modules/mindmap/distill.js', import.meta.url), 'utf8');
assert.doesNotMatch(distillSource, /MAX_BLOCKS|一次最多提炼|blocks\.length\s*>/,
  '实现不得保留业务块数门限');

console.log('✓ W62d 无损提炼契约 / 一次重试 / 预览复验 / 新建嫁接 / 回跳钩');
