// tests/contract/player-w24.test.mjs —— 波次二十四「播放器本地收尾」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('MKV 自解复用', () => {
  test('EBML-lite 结构与通道', () => {
    const src = readSrc('main/mkv-demux.js');
    for (const k of ['listTracks', 'extractFlacTrack', 'Tracks', 'Cluster', 'SimpleBlock', 'CodecPrivate']) {
      assert.ok(src.includes(k), `缺 ${k}`);
    }
    assert.ok(src.includes('Cursor'), '必须有分片游标（GB 级不整读）');
    assert.ok(src.includes("track & ((1 << (7 * tLen)) - 1)"), 'vint 轨号必须剥标记位（0x82=轨2）');
    const main = readSrc('main/main.js');
    assert.ok(main.includes("bus.handle('mkv:tracks'") && main.includes("bus.handle('mkv:extractFlac'"), 'mkv 双通道必须有');
    assert.ok(main.includes('.audcache'), '抽轨必须有输出缓存');
    assert.ok(readSrc('preload/bridge.js').includes("'mkv:tracks'") && readSrc('preload/bridge.js').includes("'mkv:extractFlac'"), '桥白名单必须登记');
  });
});

describe('多音轨双元素同步', () => {
  test('轨菜单/aux 同步/静音语义', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('probeAudioTracks') && src.includes('renderTrackMenu'), '轨探测与菜单必须有');
    assert.ok(src.includes('attachAuxAudio') && src.includes('detachAuxAudio'), 'aux 挂卸必须有');
    assert.ok(src.includes('media.muted = true'), '切 aux 必须整轨静音（Chromium 无法单独禁容器内轨）');
    assert.ok(src.includes('timeupdate') && src.includes('0.35'), '必须有漂移矫正');
    assert.ok(src.includes('ratechange') && src.includes('volumechange'), '速率与音量必须镜像');
    assert.ok(src.includes('A_FLAC'), 'FLAC 直通判定必须有');
    assert.ok(src.includes("pathChanged) { detachSubtitle(); subFor = null; detachAuxAudio()"), '换片必须卸 aux');
  });
});

describe('PiP/增益/记忆/降级明白话', () => {
  test('画中画与共享增益链', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('data-a=pip') && src.includes('requestPictureInPicture'), 'PiP 必须有');
    assert.ok(src.includes('mediaChain') && src.includes('createGain'), '共享增益链必须有');
    assert.ok(!/createMediaElementSource\(media\)[\s\S]{0,80}createMediaElementSource\(media\)/.test(src), '不得重复 createMediaElementSource（InvalidStateError）');
    assert.ok(src.includes('player.audioGain'), '增益必须入 settings');
  });
  test('倍速亮度记忆与 HEVC 明白话与图标', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('player.lastSpeed') && src.includes('player.lastBrightness'), '倍速亮度记忆必须有');
    const vi = readSrc('renderer/modules/viewer/index.js');
    assert.ok(vi.includes('HEVC(x265)/AV1') || vi.includes('HEVC'), 'HEVC/AV1 猜测明白话必须有');
    assert.ok(readSrc('renderer/lib/svg-icons.js').includes("'🗔'"), 'PiP 图标必须入库（SVG 一致化）');
  });
});
