// tests/contract/player-w25.test.mjs —— 波次二十五「DMHY首页/全编码音轨/种子内字幕」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('W65 站点首页资源行', () => {
  test('sites:home 通道委托当前站点严格解析器', () => {
    const src = readSrc('main/torrent-sites.js');
    assert.ok(src.includes('homeUrl'), '站点表必须有 homeUrl');
    assert.ok(src.includes("bus.handle('sites:home'"), 'sites:home 通道必须有');
    assert.ok(/sites:home[\s\S]{0,500}adapter\.parseRows/.test(src), '首页必须委托所选站点的严格解析器');
    assert.ok(!src.includes('dongmanhuayuan.com'), '旧 DMHY clone 端点不得回魂');
    assert.ok(readSrc('preload/bridge.js').includes("'sites:home'"), '桥白名单必须登记 sites:home');
  });
  test('首开即载与切站即载接线', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('loadHome'), 'loadHome 必须有');
    assert.ok(src.includes("invoke('sites:home'"), 'loadHome 必须走 sites:home');
    assert.ok(src.includes("addEventListener('change', loadHome)"), '切站必须即载首页（选中即展示）');
    assert.ok(src.includes('renderRows'), '行渲染必须与搜索共用 renderRows');
    assert.ok(/renderWatching\(\);\s*\n\s*loadHome\(\)/.test(src), '首开必须即载首页');
  });
});

describe('全编码音轨封装', () => {
  test('extractTrack 与三大封装器结构', () => {
    const src = readSrc('main/mkv-demux.js');
    for (const k of ['extractTrack', 'extractFrames', 'muxVorbis', 'muxAac', 'muxOpus', 'oggPage', 'oggCrc', 'TRACK_MUXERS']) {
      assert.ok(src.includes(k), `缺 ${k}`);
    }
    for (const c of ['A_FLAC', 'A_VORBIS', 'A_AAC', 'A_OPUS']) {
      assert.ok(src.includes(c), `封装分派表缺 ${c}`);
    }
    assert.ok(src.includes('clusterTc'), '帧时间码必须含 Cluster 绝对值（granule 要用）');
    assert.ok(src.includes('0x04c11db7'), 'Ogg CRC 多项式必须对');
    const main = readSrc('main/main.js');
    assert.ok(main.includes("bus.handle('mkv:extractTrack'"), 'mkv:extractTrack 通道必须有');
    assert.ok(main.includes('.audcache'), '抽轨必须有输出缓存');
    assert.ok(/mkv:extractTrack[\s\S]{0,500}existsSync/.test(main), '必须有后缀探测缓存（同轨落过盘即直用）');
    assert.ok(readSrc('preload/bridge.js').includes("'mkv:extractTrack'"), '桥白名单必须登记 mkv:extractTrack');
  });
  test('播放器全编码切换', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('SUPPORTED_TRACK_CODECS'), '全编码判定必须有');
    assert.ok(src.includes('FLAC|VORBIS|AAC|OPUS'), '支持表必须四编码齐');
    assert.ok(src.includes("invoke('mkv:extractTrack'"), '切轨必须走 mkv:extractTrack');
    assert.ok(!src.includes('Vorbis/AAC 下波支持'), '旧「下波支持」话术必须清');
  });
});

describe('种子内字幕', () => {
  test('tor:fileBytes 通道与播放即挂', () => {
    const d = readSrc('main/torrent-daemon.js');
    assert.ok(d.includes("bus.handle('tor:fileBytes'"), 'tor:fileBytes 通道必须有');
    assert.ok(d.includes('for await'), '必须 asyncIterator 按需取块（小块下完即收）');
    assert.ok(readSrc('preload/bridge.js').includes("'tor:fileBytes'"), '桥白名单必须登记 tor:fileBytes');
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes("invoke('tor:fileBytes'"), '播放器必须调 tor:fileBytes');
    assert.ok(/\.(ass\|srt\|ssa)/.test(src) || src.includes('ass|srt|ssa'), '必须探种子内 .ass/.srt/.ssa');
    assert.ok(src.includes('attachSubtitle(media, { subContent'), '必须内容直挂（播放即挂）');
    assert.ok(src.includes('已挂载种子内字幕'), '挂载成功必须有明白话');
  });
});
