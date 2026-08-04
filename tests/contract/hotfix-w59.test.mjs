// tests/contract/hotfix-w59.test.mjs —— W59 契约（查看器图片编辑模式）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('W59 查看器图片编辑模式', () => {
  test('LayerHistory 移植（快照栈全件）', () => {
    const ie = readSrc('renderer/modules/viewer/imgedit.js');
    assert.ok(ie.includes('class LayerHistory'), 'LayerHistory 必须在（Pegasus MIT 移植）');
    assert.ok(ie.includes('slice(0, this.index)'), '分支截断必须有');
    assert.ok(ie.includes('shift()'), 'FIFO 上限必须有');
    assert.ok(ie.includes('canUndo()') && ie.includes('canRedo()') && ie.includes('clear()') && ie.includes('getStats()'), '全件方法必须齐');
    assert.ok(!ie.includes("require(\"sharp\")") && !ie.includes("from 'sharp'"), '不得引 Sharp');
  });
  test('模式机+八件工具齐', () => {
    const ie = readSrc('renderer/modules/viewer/imgedit.js');
    assert.ok(ie.includes("CROPPING: 'cropping'") && ie.includes("DRAWING: 'drawing'") && ie.includes("COLORPICKER: 'colorpicker'"), 'ImageMode 模式机必须在');
    for (const pin of ['applyCrop', 'gridExport', 'rotate(', 'flip(', 'filter(', '_drawDown', '_pickDown', 'saveCopy']) {
      assert.ok(ie.includes(pin), pin + ' 必须在');
    }
    assert.ok(ie.includes('this.name}-edit') || ie.includes('-edit.'), '另存副本自动名必须在（默认不覆盖原图）');
    assert.ok(ie.includes("import('jszip')"), '网格分割 zip 打包必须有');
  });
  test('查看器集成（双态+收尸+按类显隐）', () => {
    const vw = readSrc('renderer/modules/viewer/index.js');
    assert.ok(vw.includes("data-a='imgedit'") || vw.includes('data-a = "imgedit"') || vw.includes("'imgedit'"), '编辑入口钮必须在');
    assert.ok(vw.includes('enterImageEdit'), '双态切换件必须在');
    assert.ok(vw.includes('ctl._imgEditor.destroy()') || vw.includes('ctl._imgEditor.destroy?.()') || vw.includes('ctl._imgEditor.destroy'), '换片收编辑器必须在');
    assert.ok(vw.includes('[data-a=imgedit]'), '按类显隐必须在');
  });
  test('ie 族样式+滚动条族在位', () => {
    const css = readSrc('renderer/styles/base.css');
    for (const pin of ['.ie-root', '.ie-bar', '.ie-stage', '.ie-crop', '.ie-view']) assert.ok(css.includes(pin), pin + ' 必须在');
  });
});
