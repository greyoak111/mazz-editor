// tests/contract/hotfix-w50.test.mjs —— W52① 地基回正契约（离屏弯路清算+反节流+主题底色）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('离屏弯路清算（W52 地基回正）', () => {
  test('三重税全退', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(!bv.includes('offscreen: true'), 'offscreen 必须退（GPU→CPU 回读税不交）');
    assert.ok(!bv.includes("wc.on('paint'") && !bv.includes('onPaint'), '帧管线必须退（IPC 序列化税不交）');
    assert.ok(!bv.includes('setFrameRate('), 'setFrameRate 闸一个不留（=显示器 v-sync 自适应——用户定版）');
    const br = readSrc('renderer/modules/browser/index.js');
    assert.ok(!br.includes('br-osr') && !br.includes('bindOsrCanvas') && !br.includes("mazz.on('bv:frame'"), 'canvas 帧管线与输入绑定必须退（CPU 光栅税不交）');
    assert.ok(!br.includes('imeMirror') && !br.includes('br-ime-mirror'), 'IME 镜像必须退役（原生输入天然支持中文）');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(!css.includes('.br-osr') && !css.includes('.br-ime-mirror'), '离屏与镜像样式必须清');
  });
});

describe('地基三钉', () => {
  test('永久反节流', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(bv.includes('backgroundThrottling: false'), 'WebContents 永久反节流必须有（遮挡误杀连根拔——deepseek 实锤方一永开化）');
  });
  test('主题底色跟随', () => {
    const wm = readSrc('main/window-manager.js');
    assert.ok(wm.includes('THEME_BG') && wm.includes('themeBg'), '主题底色映射必须有');
    assert.ok(wm.includes("paper: '#f7f6f3'") && wm.includes("ink: '#16181d'"), 'paper/ink 色值必须与 themes.css 同值（风格一致化铁律）');
    const main = readSrc('main/main.js');
    assert.ok(main.includes('setBackgroundColor(wm.themeBg()'), 'theme:broadcast 必须实时换底色（主题跟随铁律）');
  });
  test('W87 统一遮挡调度取代局部 cloak', () => {
    const br = readSrc('renderer/modules/browser/index.js');
    assert.ok(!br.includes('cloakCheck') && !br.includes('ctl._cloaked'), 'Browser 私有弹层观察器与状态机必须退役');
    const rendererVisual = readSrc('renderer/core/visual-composition.js');
    const mainVisual = readSrc('main/visual-composition.js');
    assert.ok(rendererVisual.includes("selector: '.mazz-palette-mask'") && rendererVisual.includes('registerOverlay'), 'DOM Overlay 必须登记唯一 Plane');
    assert.ok(mainVisual.includes('setHostOccluded') && mainVisual.includes('beginOverlay'), '主进程必须按 host 引用计数遮挡原生 Surface');
  });
});
