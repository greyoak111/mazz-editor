// tests/contract/hotfix-w51.test.mjs —— W51 体验根治契约（IME 镜像输入+动态帧率）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('IME 镜像输入（中文输入根治）', () => {
  test('焦点追踪钩与镜像件', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(!bv.includes('__MZIME__') && !bv.includes('onImeFocus'), 'W52 起 IME 镜像/焦点钩退役在案（原生输入天然支持——弯路清算）');
    const br = readSrc('renderer/modules/browser/index.js');
    assert.ok(!br.includes('imeMirror') && !br.includes('br-ime-mirror'), '镜像件退役在案');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(!css.includes('.br-ime-mirror'), '镜像样式退役在案');
  });
});

describe('动态帧率（看视频不卡）', () => {
  test('播放侦测与 60/30 切换', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(!bv.includes('__MZVID__') && !bv.includes('setFrameRate('), 'W52 起动态帧率/一切帧率闸退役（显示器 v-sync 自适应——用户定版）');
  });
});
