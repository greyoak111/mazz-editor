// tests/contract/slide-w39.test.mjs —— 波次三十九「mazzslide v2 放映引擎」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('放映引擎骨架', () => {
  test('状态机与幂等闸（mmStatus 同款）', () => {
    const src = readSrc('renderer/modules/slide/present2.js');
    assert.ok(src.includes("ctl.slStatus === 'present'"), 'present 态幂等闸必须有');
    assert.ok(src.includes("ctl.slStatus = 'present'") && src.includes("ctl.slStatus = 'normal'"), '状态机单字段进出必须有');
    assert.ok(src.includes('rollback'), 'rollback 纪律必须注明');
    assert.ok(src.includes('ctl._presenter'), '测试/遥控钩子必须有（W40 同口）');
  });
  test('tween 镜头动画器（camTween 同款）', () => {
    const src = readSrc('renderer/modules/slide/present2.js');
    assert.ok(src.includes('requestAnimationFrame(tick)') && src.includes('easeInOutCubic') || src.includes('Math.pow(-2 * t + 2, 3)'), 'rAF+easeInOutCubic 必须有');
    assert.ok(src.includes('cancelled'), '旧趟取消必须有');
  });
  test('四切换', () => {
    const src = readSrc('renderer/modules/slide/present2.js');
    for (const k of ["kind === 'fade'", "kind === 'slide'", "kind === 'zoom'", "kind === 'none'"]) assert.ok(src.includes(k), `缺切换 ${k}`);
    assert.ok(src.includes('translateX') && src.includes('scale(') && src.includes('opacity'), '平移/缩放/叠化必须动 transform/opacity');
  });
});

describe('reveal 引擎与帧动作', () => {
  test('逐点揭示', () => {
    const src = readSrc('renderer/modules/slide/present2.js');
    assert.ok(src.includes('it.reveal?.order'), 'reveal.order 消费必须有');
    assert.ok(src.includes('revealLeft('), '未揭计数必须有');
    assert.ok(/revealLeft\(sl\) > 0[\s\S]{0,420}return;/.test(src), '先揭后翻闸必须有');
    assert.ok(src.includes("opacity .15s ease"), '揭示 150ms 显现过渡必须有');
    assert.ok(src.includes('this.revealN = 0'), '换帧揭示归零必须有');
  });
  test('帧动作三件', () => {
    const src = readSrc('renderer/modules/slide/present2.js');
    assert.ok(src.includes('fr.nextAfter > 0') && src.includes('setTimeout(() => this.step(1)'), 'nextAfter 到时推进必须有');
    assert.ok(src.includes('fr.actions?.clearMedia'), 'clearMedia 必须有');
    assert.ok(src.includes('fr.actions?.stopTimer'), 'stopTimer 必须有');
    assert.ok(src.includes('sl-timer-text'), '计时器走字必须有');
    assert.ok(src.includes('禁用帧跳过') || src.includes('frames[j].disabled'), '禁用帧跳过必须有');
  });
});

describe('演讲者视图与编辑器集成', () => {
  test('演讲者视图四件', () => {
    const src = readSrc('renderer/modules/slide/present2.js');
    assert.ok(src.includes('sl-pv2-next'), '下一帧预览必须有');
    assert.ok(src.includes('sl-pv-notes-body'), '备注必须有');
    assert.ok(src.includes('sl-pv2-reveal'), '揭示进度必须有');
    assert.ok(src.includes('sl-clock'), '计时必须有');
  });
  test('命令路由与编辑器 reveal UI', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(/slide\.present[\s\S]{0,500}Presenter2/.test(src), 'slide.present 必须路由 v2 引擎');
    assert.ok(/slide\.presentPv[\s\S]{0,600}presenterView: true[\s\S]{0,200}Presenter2|slide\.presentPv[\s\S]{0,600}Presenter2/.test(src), 'slide.presentPv 必须路由 v2 演讲者视图');
    assert.ok(src.includes('没有可放映的帧'), '全禁用/空编排必须明白话拦截');
    assert.ok(src.includes('加入揭示序列') && src.includes('移出揭示序列'), '编辑器 reveal 右键必须有');
    assert.ok(src.includes("mode: 'click', order: mx + 1"), '揭示入列必须 max+1');
    assert.ok(src.includes('揭示#'), '样式栏揭示标必须有');
  });
  test('v1 路径不退化', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(src.includes("from './present.js'"), 'v1 Presenter 必须保留（v1 大纲档老路）');
    const p1 = readSrc('renderer/modules/slide/present.js');
    assert.ok(p1.includes('class Presenter'), 'v1 Presenter 源码必须在');
  });
});
