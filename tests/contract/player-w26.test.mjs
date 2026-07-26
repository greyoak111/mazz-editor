// tests/contract/player-w26.test.mjs —— 波次二十六「播放器列表栏工作区栏同款」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('列表栏推挤布局（展开压缩/收起铺满）', () => {
  test('CSS 变量宽与 side-open 推挤族', () => {
    const css = readSrc('renderer/styles/base.css');
    assert.ok(css.includes('--mz-side-w'), '舞台必须有 --mz-side-w 变量');
    assert.ok(css.includes('width: var(--mz-side-w)'), '侧栏宽必须走变量（自由拉伸基础）');
    assert.ok(css.includes('.mz-stage.side-open .mz-side'), '展开态必须 class 驱动（非内联显隐）');
    assert.ok(/side-open \.mz-media, \.mz-stage\.side-open \.mz-audio-wrap|side-open \.mz-media/.test(css), '展开必须压缩视频区');
    assert.ok(css.includes('side-open .mz-topbar') && css.includes('side-open .mz-controls'), '顶条/控制条必须同步收窄（关闭/全屏钮防盖）');
    assert.ok(css.includes('side-open .mz-sub-host'), '字幕画布必须同步收窄');
    assert.ok(css.includes('.mz-side-grip'), 'grip 拖拽手柄样式必须有');
  });
  test('JS 开合统一入口与状态记忆', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('setSideOpen'), 'setSideOpen 统一入口必须有');
    assert.ok(src.includes("classList.toggle('side-open'"), '开合必须 class 驱动');
    assert.ok(src.includes('player.listSide'), '宽度与开合必须持久化 settings');
    assert.ok(!src.includes("side.style.display === 'none' ? 'flex'"), '旧内联显隐切换必须清');
    assert.ok(/SIDE_MIN\s*=\s*\d+/.test(src) && /SIDE_MAX\s*=\s*\d+/.test(src), '拖拽必须钳制最小/最大宽');
  });
});

describe('P2P 流解码失败不毁播放器', () => {
  test('流感知错误路径与内嵌明白话层', () => {
    const vi = readSrc('renderer/modules/viewer/index.js');
    assert.ok(vi.includes('mz-stream-err'), '流错误必须有内嵌明白话层');
    assert.ok(/currentSrc \|\| mediaEl\.src/.test(vi) || vi.includes('currentSrc'), '必须按真实源判定流');
    assert.ok(/\^https\?\:/.test(vi.replace(/\\/g, '')), '必须识别 http(s) 流');
    const errBlock = vi.match(/addEventListener\('error'[\s\S]{0,1400}/);
    assert.ok(errBlock && errBlock[0].indexOf('mz-stream-err') < errBlock[0].indexOf('destroy()'), '流分支必须先于 destroy 返回（不毁播放器）');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(css.includes('.mz-stream-err'), '明白话层样式必须入库');
  });
});

describe('daemon 健壮（截图攻坚实锤双修）', () => {
  test('裸 magnet 公共 tracker 注入', () => {
    const d = readSrc('main/torrent-daemon.js');
    assert.ok(d.includes('PUBLIC_TRACKERS') && d.includes('enrichMagnet'), '裸 magnet 必须注入公共 tracker（dmhy 全系裸 btih 实锤）');
    assert.ok(d.includes('[?&]tr='), '自带 tr 的 magnet 不得重复注入');
    assert.ok(d.includes('enrichMagnet(magnet)'), 'tor:add 必须走注入');
  });
  test('同 infoHash 重复添加幂等秒回', () => {
    const d = readSrc('main/torrent-daemon.js');
    assert.ok(d.includes('t.ready || t.info'), "元数据已在手必须先查即态（'metadata' 不重发=挂 60s 实锤）");
    assert.ok(d.includes("t.once('ready', done)"), 'ready 事件必须双挂耳兜底');
  });
});

describe('自由拉伸与折叠符号', () => {
  test('grip 拖拽与方向', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes("querySelector('.mz-side-grip')"), 'grip 必须挂事件');
    assert.ok(src.includes('startW + (startX - ev.clientX)'), '右侧栏往左拖必须变宽（方向不得反）');
    assert.ok(src.includes('col-resize') || readSrc('renderer/styles/base.css').includes('col-resize'), '必须有 col-resize 光标');
  });
  test('叉号退役·展开折叠符号风格一致化', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    const m = src.match(/mz-side-x[\s\S]{0,160}/);
    assert.ok(m, '侧栏折叠钮必须在');
    assert.ok(m[0].includes("iconHtml('›')"), '折叠钮必须用 ›（右侧栏收起方向符，工作区栏 «/» 同款语义）');
    assert.ok(!m[0].includes("iconHtml('✕')"), '侧栏叉号必须退役');
    const icons = readSrc('renderer/lib/svg-icons.js');
    assert.ok(icons.includes("'›'"), '› 必须在 SVG 图标库（风格一致化）');
  });
});
