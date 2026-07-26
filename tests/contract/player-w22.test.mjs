// tests/contract/player-w22.test.mjs —— 波次二十二「播放器字幕/连播/设置」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const { parseEpisode, nextEpisodePath } = await import('../../renderer/lib/episode-detect.js');

describe('播放器字幕·架构接线', () => {
  test('octopus 资产与渲染通道', () => {
    const main = readSrc('main/main.js');
    assert.ok(main.includes("bus.handle('player:subAssets'"), '主进程必须有字幕资产通道');
    assert.ok(main.includes('fallbackFont'), '必须有 CJK 回退字体探测');
    assert.ok(main.includes("protocol.handle('mazz-res'"), '必须有 mazz-res 资产协议（wasm worker 唯一活路）');
    assert.ok(main.includes('Cross-Origin-Opener-Policy') || main.includes('wasm-unsafe-eval'), '协议响应必须带隔离/CSP 头');
    assert.ok(readSrc('preload/bridge.js').includes("player:subAssets"), '桥白名单必须登记');
    assert.ok(readSrc('scripts/build.js').includes('subtitles-octopus-worker.wasm'), '构建必须落 octopus worker/wasm');
    const sub = readSrc('renderer/modules/viewer/subtitles.js');
    assert.ok(sub.includes("from 'libass-wasm'"), '必须引 subtitles-octopus（libass-wasm）');
    assert.ok(sub.includes('mazz-res://app/dist/lib/octopus/'), 'worker 必须走 mazz-res 协议且与页面同 host（w27 同源化：mazz-res://lib 与 mazz-res://app 不同 origin=跨源 worker 被拦实锤；blob/file 源全被掐实锤）');
    assert.ok(sub.includes('mz-sub-host'), '画布必须 DOM 收养（octopus canvasParent 会被 dispose 摘除实锤）');
    assert.ok(sub.includes('probeSubtitles'), '同名探测必须有');
    const csp = readSrc('renderer/index.html');
    assert.ok(csp.includes("'wasm-unsafe-eval'"), 'CSP 必须放行 wasm 编译');
  });
  test('播放器接线（CC钮/外挂/销毁）', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('data-a=sub') && src.includes('data-a=pset'), 'CC 与设置钮必须存在');
    assert.ok(src.includes('loadAutoSubtitle') && src.includes('attachSubtitle'), '自动挂载必须接线');
    assert.ok(src.includes('detachSubtitle()'), '换片/销毁必须卸字幕');
    assert.ok(src.includes('subtitleEnabled') || src.includes('SUB_SW'), '字幕开关必须入 settings');
  });
});

describe('番剧识别公共 util', () => {
  test('parseEpisode 全形态', () => {
    assert.equal(parseEpisode('[CASO&SumiSora][Puella_Magi_Madoka_Magica][BDRIP][01][1920x1080][x264_FLACx2][2582CC95].mkv')?.episode, 1, 'fansub [01] 即第一集（1920x1080 分辨率不得误抓）');
    assert.equal(parseEpisode('[CASO&SumiSora][Puella_Magi_Madoka_Magica][BDRIP][2582CC95].mkv'), null, 'CRC 哈希段不得当集数');
    assert.equal(parseEpisode('潮骚 S01E03.mkv')?.episode, 3, 'S01E03');
    assert.equal(parseEpisode('潮骚 第4集.mkv')?.episode, 4, '第4集');
    assert.equal(parseEpisode('潮骚 EP05.mkv')?.episode, 5, 'EP05');
    assert.equal(parseEpisode('[Group] 潮骚 [06] [1080p].mkv')?.episode, 6, '[06]+压制标');
    assert.equal(parseEpisode('潮骚.1x07.mkv')?.episode, 7, '1x07');
    assert.equal(parseEpisode('潮骚 S02E01.mkv')?.season, 2, '季号识别');
    assert.equal(parseEpisode('说明文档.mkv'), null, '非剧集应 null');
  });
  test('nextEpisodePath 同番续集与串番防御', () => {
    const entries = [
      { name: '潮骚 S01E01.mkv', path: '/v/潮骚 S01E01.mkv', isDir: false },
      { name: '潮骚 S01E02.mkv', path: '/v/潮骚 S01E02.mkv', isDir: false },
      { name: '潮骚 S02E01.mkv', path: '/v/潮骚 S02E01.mkv', isDir: false },
      { name: '别的番 S01E02.mkv', path: '/v/别的番 S01E02.mkv', isDir: false },
      { name: '潮骚 S01E02.ass', path: '/v/潮骚 S01E02.ass', isDir: false },
    ];
    const exts = new Set(['mkv', 'mp4']);
    assert.equal(nextEpisodePath('/v/潮骚 S01E01.mkv', entries, exts), '/v/潮骚 S01E02.mkv', '同季续集（不得串到别的番同集）');
    assert.equal(nextEpisodePath('/v/潮骚 S01E02.mkv', entries, exts), '/v/潮骚 S02E01.mkv', '跨季接下一季首集');
    assert.equal(nextEpisodePath('/v/孤独番 S01E01.mkv', entries, exts), null, '无同番续集时不得串番接别家');
    assert.equal(nextEpisodePath('/v/潮骚 S02E01.mkv', entries, exts), null, '无下集应 null');
  });
});

describe('自动连播与设置面板', () => {
  test('连播开关/倒计时/嗅探接线', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('autoNextEnabled') || src.includes('AUTO_NEXT_SW'), '连播开关必须入 settings');
    assert.ok(src.includes('nextEpisodePath'), '必须走公共 util 嗅探');
    assert.ok(src.includes('3s 后自动连播') && src.includes('取消连播'), '倒计时可取消必须有');
    assert.ok(src.includes("ctl.loop !== 'single' && ctl.loop !== 'off'"), 'single/off 必须尊重显式选择');
  });
  test('设置面板与片源', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    for (const k of ['ps-sub-sw', 'ps-next-sw', 'ps-sub-load', 'ps-site', 'nyaa.si', 'dmhy.org']) {
      assert.ok(src.includes(k), `设置面板缺 ${k}`);
    }
    assert.ok(src.includes('persist:mazz-author'), '片源必须走投稿会话');
    assert.ok(src.includes('JASSUB（libass wasm）'), '渲染归属说明必须有（LGPL 合规标注）');
  });
});
