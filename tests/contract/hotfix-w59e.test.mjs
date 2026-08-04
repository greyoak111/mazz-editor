// tests/contract/hotfix-w59e.test.mjs —— 59e 契约（Ctrl+滚轮缩图片本体，编辑栏不缩）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('① pane-zoom 让路', () => {
  test('.ie-root 进排除键（图片编辑器滚轮自留地）', () => {
    const pz = readSrc('renderer/shell/pane-zoom.js');
    const ex = pz.split('\n').find((l) => l.includes('EXCLUDE_SEL ='));
    assert.ok(ex && ex.includes('.ie-root'), 'pane-zoom 排除键必须含 .ie-root（捕获相注册早，stage 拦不住——让路是唯一正解实锤）');
  });
});

describe('② 图片本体缩放链', () => {
  test('userZoom 倍率贯穿：初始化/重绘/限幅', () => {
    const ie = readSrc('renderer/modules/viewer/imgedit.js');
    assert.ok(ie.includes('this.userZoom = 1;'), 'userZoom 初始化必须在');
    assert.ok(ie.includes('Math.min(1, maxW / w) * (this.userZoom || 1)'), '_repaint 必须吃用户倍率（适配比×userZoom）');
    assert.ok(ie.includes('if (e.ctrlKey || e.metaKey) { this._zoomBy('), 'Ctrl/⌘ 分支必须在');
    assert.ok(ie.includes('e.stopPropagation(); // 双保险'), 'stopPropagation 双保险必须在');
    assert.ok(ie.includes('_zoomBy(f, ev) {'), '_zoomBy 必须在');
    assert.ok(ie.includes('Math.min(8, Math.max(0.1, old * f))'), '倍率限幅必须在');
  });
});

describe('③ 指针锚点+选区同步', () => {
  test('缩放前后指针下图点不跑，选区重贴', () => {
    const ie = readSrc('renderer/modules/viewer/imgedit.js');
    const zb = ie.slice(ie.indexOf('_zoomBy(f, ev) {'));
    assert.ok(zb.includes('this._toWork(ev)'), '锚点换算必须在（缩放前指针下图点）');
    assert.ok(zb.includes('this._repaint();'), '重绘必须在');
    assert.ok(zb.includes('this._cropRender({ x: this._crop.x0, y: this._crop.y0 }, { x: this._crop.x1, y: this._crop.y1 })'), '选区重贴必须双 {x,y} 形（直传 _crop=NaNpx 死信实锤）');
    assert.ok(!ie.includes('this._cropRender(this._crop,'), '全链严禁直传 _crop 当 a 参（W66 潜伏期同病绝迹）');
    assert.ok(zb.includes('this.stage.scrollLeft +=') && zb.includes('this.stage.scrollTop +='), '锚点进退滚必须在');
    assert.ok(zb.includes('this._liveScale()'), '锚点必须走折叠比现测');
  });
});
