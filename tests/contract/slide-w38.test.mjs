// tests/contract/slide-w38.test.mjs —— 波次三十八「mazzslide v2 编排层」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('编排层数据模型', () => {
  test('帧字段齐备（transition/nextAfter/actions/disabled）', () => {
    const src = readSrc('renderer/modules/slide/doc.js');
    assert.ok(src.includes("transition: props.transition || 'fade'"), '帧必须有 transition 默认 fade');
    assert.ok(src.includes('nextAfter: props.nextAfter || 0'), '帧必须有 nextAfter');
    assert.ok(src.includes('actions: props.actions || null'), '帧必须有 actions');
    assert.ok(src.includes('disabled: !!props.disabled'), '帧必须有 disabled');
    assert.ok(src.includes('export function cloneSlide'), '物料克隆必须有（页库复制）');
    assert.ok(/cloneSlide[\s\S]{0,220}JSON\.parse\(JSON\.stringify/.test(src), '克隆必须深拷贝');
    assert.ok(/cloneSlide[\s\S]{0,400}cp\.id = nid\('s'\)[\s\S]{0,200}it\.id = nid\('it'\)/.test(src), '克隆必须页与 Item 全换新 id');
  });
});

describe('物料×编排双视图', () => {
  test('双视图切换与页库', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(src.includes('sideView'), '双视图态必须有');
    assert.ok(src.includes("data-v=\"library\"") && src.includes("data-v=\"sequence\""), '物料/放映序切换钮必须有');
    assert.ok(src.includes('renderLibList') && src.includes('renderSeqList'), '双视图渲染必须分家');
    assert.ok(src.includes('未入编排'), '页库必须标孤立物料');
    assert.ok(/findIndex\(f => f\.slideId === sl\.id\)[\s\S]{0,120}if \(fi < 0\) \{ frames\.push/.test(src), '点物料无帧必须建帧入编排');
  });
  test('帧删物料零引用才清', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(src.includes('frames.some(f => f.slideId === fr.slideId)'), '删帧必须查物料零引用（页库视图可见）');
    assert.ok(src.includes('frames.filter(f => f.slideId !== sl.id)'), '删物料必须连引用帧一并清');
  });
});

describe('帧属性面板与帧动作', () => {
  test('四切换+到时+禁用+双动作', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(src.includes('renderFrameProps'), '帧属性面板必须有');
    for (const t of ["'fade'", "'slide'", "'zoom'", "'none'"]) assert.ok(src.includes(`id: ${t}`), `缺切换 ${t}`);
    assert.ok(src.includes('fr.nextAfter = Math.max(0'), '到时翻页必须可编辑');
    assert.ok(src.includes('fr.disabled = !!'), '禁用开关必须有');
    assert.ok(src.includes('clearMedia: true') && src.includes('stopTimer: true'), '帧动作清媒体/停计时必须有');
    assert.ok(src.includes('fr.actions = (cm || st)'), '动作空必须归 null（不占档）');
  });
  test('帧行标记', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(src.includes('⏱${fr.nextAfter}'), '到时必须有 ⏱ 标');
    assert.ok(src.includes('mk ac'), '有动作必须有 ⚡ 标');
    assert.ok(src.includes('mk tr'), '切换必须有图标标');
  });
});

describe('演讲者备注', () => {
  test('备注编辑区', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(src.includes('renderNotesBox'), '备注区必须有');
    assert.ok(src.includes('sl.notes = ta.value'), '备注必须写物料层');
    assert.ok(src.includes("addEventListener('input', () => { if (sl) { sl.notes = ta.value; markDirty(); } })"), '备注 input 只存档不重渲（打字不丢焦实锤）');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(css.includes('.sl-v2-notes textarea'), '备注区样式必须有');
  });
});
