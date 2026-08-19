// tests/contract/hotfix-w56.test.mjs —— W56 契约（B7 替换插入桥/B11 实况帧/B4/B6 验收钉点）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('B7 翻译替换/插入跨窗桥', () => {
  test('面板钮启用+桥+主窗执行', () => {
    const html = readSrc('renderer/panels/translate.html');
    assert.ok(html.includes('id="replace"') && html.includes('id="insert"'), '两钮必须在');
    assert.ok(html.includes("type: 'translateAction'"), '桥调用必须有');
    assert.ok(!html.includes('请在主窗使用'), '禁用妥协文案必须退役');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes("pl.type === 'translateAction'"), '主窗桥必须有');
    assert.ok(sh.includes("insertText") && sh.includes('当前编辑器无选区'), '选区执行+无选区提示必须有');
  });
});

describe('B11 内录录制中实况流', () => {
  test('合成画布帧钩+面板实况图', () => {
    const rec = readSrc('renderer/lib/recorder.js');
    assert.ok(rec.includes('frameTick') && rec.includes("type: 'recFrame'"), '帧钩必须有');
    assert.ok(rec.includes("toDataURL('image/jpeg', 0.5)"), 'jpeg 节流必须有');
    const html = readSrc('renderer/panels/recorder.html');
    assert.ok(html.includes('id="live"') && html.includes('recFrame'), '实况 img 必须有');
    assert.ok(html.includes("img.style.display = 'none'"), '停止收图必须有');
  });
});

describe('B4/B6 新形态验收钉点', () => {
  test('B4 遮挡场景由 W87 统一视觉合成接管', () => {
    const bi = readSrc('renderer/modules/browser/index.js');
    assert.ok(!bi.includes('.mazz-palette-mask, .help-mask') && !bi.includes('ctl._cloaked'), 'Browser 私有 cloak 选择器与状态机必须绝迹');
    const visual = readSrc('renderer/core/visual-composition.js');
    assert.ok(visual.includes("selector: '.mazz-palette-mask'") && visual.includes('releaseOverlay'), '统一 Plane 必须覆盖登记与释放');
  });
  test('B6 全屏处理链在场', () => {
    const bi = readSrc('renderer/modules/browser/index.js');
    assert.ok(bi.includes("case 'enter-html-full-screen'") && bi.includes('ctl._htmlFs'), '全屏状态机必须在');
    const bv = readSrc('main/browser-views.js');
    assert.ok(bv.includes("enter-html-full-screen"), '主进程转发必须在');
  });
});
