// tests/contract/mindmap-w30.test.mjs —— 波次三十「导图渲染病根治」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('拐点参数化模型', () => {
  test('参数化三件套与语义', () => {
    const src = readSrc('renderer/modules/mindmap/model.js');
    for (const k of ['wpFromPoint', 'wpToPoint', 'wpMigrate']) assert.ok(src.includes(k), `缺 ${k}`);
    assert.ok(src.includes('(pt.x - a.cx) * dx + (pt.y - a.cy) * dy'), 't 必须为连线投影系数');
    assert.ok(src.includes('-dy / L, ny = dx / L'), '必须法向量偏移（k 相对 |ac| 比例——kityminder 顶点向量同款）');
    assert.ok(src.includes('if (wp.t == null) return { x: wp.x, y: wp.y }'), '旧绝对格式必须直通兼容');
    assert.ok(src.includes('v: 4'), '序列化必须 v4');
    assert.ok(src.includes('obj.v === 4 || obj.v === 3 || obj.v === 2'), 'v2/v3/v4 必须兼容');
  });
  test('旧平均位移平移补丁已废', () => {
    const src = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(!src.includes('_prevBoxes'), '旧 shift 补丁必须整段废除（近似失真=概率复现真根）');
    assert.ok(!src.includes("shift(b.node.linkWps"), 'linkWps 平移调用必须清');
    assert.ok(!src.includes("shift(rl.waypoints"), 'refLines 平移调用必须清');
  });
});

describe('渲染与编辑全链参数化', () => {
  test('渲染取屏', () => {
    const src = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(src.includes('wpMigrate(node.linkWps'), '父子连线渲染必须懒迁移');
    assert.ok(src.includes('wpMigrate(rl.waypoints, aInfo, cInfo)'), '引用线路径必须懒迁移');
    assert.ok((src.match(/wpToPoint\(/g) || []).length >= 6, '手柄/路径/曲线控制点取屏必须全走 wpToPoint');
  });
  test('编辑入库', () => {
    const src = readSrc('renderer/modules/mindmap/index.js');
    assert.ok((src.match(/wpFromPoint\(/g) || []).length >= 6, '双击加拐/拖拽落点/默认固化必须全走 wpFromPoint 参数化入库');
    assert.ok(!src.includes("linkWps.push({ x: wx, y: wy })"), '父子线双击不得再存绝对坐标');
    assert.ok(!src.includes("waypoints.push({ x: wx, y: wy })"), '引用线双击不得再存绝对坐标');
  });
});

describe('演示 S2 修复挂接', () => {
  test('外部 PPT 二次打开步骤化诊断', () => {
    const src = readSrc('renderer/lib/extern-convert.js');
    assert.ok(src.includes('S2 修复'), 'S2 标记必须在');
    assert.ok(src.includes('大纲解析失败') && src.includes('pptx 导出失败'), '解析/导出必须分段抱因（不再一句格式转换失败闷死）');
    assert.ok(src.includes('大纲内容为空'), '空内容必须明白话');
    assert.ok(src.includes('临时文件写入失败'), '写盘锁定必须明白话带因');
    assert.ok(src.includes("typeof content !== 'string'"), '内容源非字符串必须兜底');
  });
});
