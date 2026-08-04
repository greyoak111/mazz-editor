// tests/contract/hotfix-w59c.test.mjs —— 59c 契约（编辑态滚动条复活/边缘自动滚/全局缩放裁剪不漂移）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('① 编辑态滚动条复活', () => {
  test('viewwrap 块级自然高，line-height:0 塌高绝迹', () => {
    const css = readSrc('renderer/styles/base.css');
    assert.ok(css.includes('.ie-viewwrap { position: relative; display: block; width: fit-content; margin: 0 auto; }'), 'viewwrap 必须块级自然高（塌高吃滚动条实锤根治）');
    const vw = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => l.includes('.ie-viewwrap')); // 剥注释防自咬
    assert.ok(!vw.some((l) => l.includes('line-height')), 'viewwrap 链上 line-height 必须绝迹');
    assert.ok(!vw.some((l) => l.includes('inline-block')), 'inline-block 基线塌高形态必须绝迹');
  });
});

describe('② 拖拽裁剪边缘自动滚', () => {
  test('48px 边缘侦测驱动 stage.scrollTop', () => {
    const ie = readSrc('renderer/modules/viewer/imgedit.js');
    assert.ok(ie.includes('const autoScroll = (ev) =>'), 'autoScroll 必须在');
    assert.ok(ie.includes('const dTop = ev.clientY - sr.top, dBot = sr.bottom - ev.clientY;'), '上下沿距离侦测必须在');
    assert.ok(ie.includes('if (dTop >= 0 && dTop < 48) stage.scrollTop -= Math.ceil((48 - dTop) / 4);'), '上沿加速滚必须在');
    assert.ok(ie.includes('else if (dBot >= 0 && dBot < 48) stage.scrollTop += Math.ceil((48 - dBot) / 4);'), '下沿加速滚必须在');
    assert.ok(ie.includes('if (!this._crop?.on) return; autoScroll(ev);'), 'move 链必须挂 autoScroll');
  });
});

describe('③ 全局缩放裁剪不漂移', () => {
  test('双比例分工：_liveScale 管指针换算，_localScale 管选框贴图', () => {
    const ie = readSrc('renderer/modules/viewer/imgedit.js');
    assert.ok(ie.includes('_liveScale() {'), '_liveScale 现测必须在（全局缩放漂移实锤根治）');
    assert.ok(ie.includes('getBoundingClientRect()'), '矩形现测必须在（折叠 CSS 缩放×全局缩放×DPR 全因子）');
    assert.ok(ie.includes('r.width / this.work.width'), '现测比值必须在');
    assert.ok(ie.includes('_localScale() {'), '_localScale 局部现测必须在（选框贴图专比）');
    assert.ok(ie.includes('this.view.offsetWidth'), 'offsetWidth 局部量必须在（不折全局缩放）');
    const toWork = ie.slice(ie.indexOf('_toWork(e) {'), ie.indexOf('_toWork(e) {') + 400);
    assert.ok(toWork.includes('this._liveScale()'), '指针换算必须走折叠比');
    const render = ie.slice(ie.indexOf('_cropRender(a, b) {'), ie.indexOf('_cropRender(a, b) {') + 300);
    assert.ok(render.includes('this._localScale()'), '选框贴图必须走局部比（折叠比贴图=视觉再折 zoom 脱离指针实锤）');
    assert.ok(!render.includes('this._liveScale()'), '选框贴图严禁折叠比');
  });
});
