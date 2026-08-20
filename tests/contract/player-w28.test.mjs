// tests/contract/player-w28.test.mjs —— 波次二十八「真机四瑕疵」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('真机四瑕疵修复', () => {
  test('缩略图小窗抬离进度条', () => {
    const css = readSrc('renderer/styles/base.css');
    const m = css.match(/\.mz-thumb \{[^}]*bottom: (\d+)px/);
    assert.ok(m, 'mz-thumb 定位必须在');
    assert.ok(+m[1] >= 34, `缩略图底距必须抬离进度条（实际 ${m[1]}px——22px 压条实锤）`);
  });
  test('三源列表有界滚动链', () => {
    const css = readSrc('renderer/styles/base.css');
    assert.ok(css.includes('.mz-medialib, .mz-web, .mz-downloads { flex: 1; min-height: 0; flex-direction: column; }'), '三源与下载父容器 flex 链必须有（无高度约束=溢出撑爆实锤）');
    assert.ok(css.includes('.mz-ml-list, .mz-web-rows, .mz-downloads { flex: 1; min-height: 0; }'), '列表区必须有界');
    assert.ok(css.includes('.mz-list::-webkit-scrollbar'), '播放器域滚动条样式必须有');
    const pl = readSrc('renderer/modules/viewer/player.js');
    assert.ok(pl.includes("mlEl.style.display = m === 'medialib' ? 'flex' : 'none'"), '媒体库切显必须给 flex（空串=CSS none 生效死局）');
    assert.ok(pl.includes("webEl.style.display = m === 'web' ? 'flex' : 'none'"), '网络资源切显必须给 flex');
  });
  test('播放设置全屏可达', () => {
    const sh = readSrc('renderer/shell/shell.js');
    const visual = readSrc('renderer/core/visual-composition.js');
    assert.ok(sh.includes("visualComposition.mountOverlay(mask, { kind: 'modal'"), '播放设置 modal 必须交统一 Overlay Runtime');
    assert.ok(visual.includes('const parent = document.fullscreenElement || document.body'), 'Overlay Plane 必须进入 Fullscreen top layer');
    assert.ok(visual.includes("document.addEventListener('fullscreenchange', () => this.rehomePlane())"), '进入/退出全屏都必须重挂 Overlay Plane');
  });
  test('字幕钮无字幕明白话', () => {
    const pl = readSrc('renderer/modules/viewer/player.js');
    assert.ok(pl.includes('loadAutoSubtitle(true)'), '手动点击必须带 notify');
    assert.ok(pl.includes('未探测到同名字幕'), '无字幕必须 toast 明白话（静默闷死实锤）');
    assert.ok(pl.includes('notify = false'), '自动触发不得打扰（notify 默认关）');
  });
});
