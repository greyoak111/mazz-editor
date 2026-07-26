// tests/contract/player-w27.test.mjs —— 波次二十七「页面同源化+HEVC平台解码」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('页面同源化（mazz-res 一源到底）', () => {
  test('app/ 与 media/ 协议分支', () => {
    const src = readSrc('main/main.js');
    assert.ok(src.includes("rel.startsWith('app/')"), 'app/ 页面分支必须有');
    assert.ok(src.includes("rel.startsWith('media/')"), 'media/ 本地媒体分支必须有');
    assert.ok(src.includes('Readable.toWeb'), '媒体必须流式（GB 级不整读）');
    assert.ok(src.includes('Content-Range') && src.includes('status: 206'), 'range 206 是 mp4 非 faststart/seek 命脉');
    assert.ok(src.includes("'Accept-Ranges': 'bytes'"), 'Accept-Ranges 头必须有');
    assert.ok(src.includes('bytes */${size}'), '416 越界应答必须有（suffix 尾段语义）');
    assert.ok(/png: 'image\/png'/.test(src) && /pdf: 'application\/pdf'/.test(src), 'mime 表必须图+pdf 通吃（漫画/PDF 同源）');
  });
  test('窗口换源与 CSP', () => {
    const wm = readSrc('main/window-manager.js');
    assert.ok(!wm.includes("loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))"), '主窗 file:// 加载必须退役');
    assert.ok(wm.includes("loadURL('mazz-res://app/index.html')"), '主窗必须 mazz-res 同源加载');
    assert.ok(wm.includes("loadURL('mazz-res://app/quicknote.html')"), 'quicknote 必须同源');
    const html = readSrc('renderer/index.html');
    for (const d of ['media-src', 'img-src', 'font-src']) {
      const m = html.match(new RegExp(d + "[^;]*"));
      assert.ok(m && m[0].includes('mazz-res:'), `${d} 必须放行 mazz-res:`);
    }
  });
  test('渲染层媒体源转换', () => {
    const vi = readSrc('renderer/modules/viewer/index.js');
    assert.ok(vi.includes("'mazz-res://media/' + encodeURIComponent"), 'viewer 媒体源必须走协议');
    assert.ok(!vi.includes("return 'file://' + path"), 'viewer file:// 媒体源必须退役');
    const pl = readSrc('renderer/modules/viewer/player.js');
    assert.ok(pl.includes("'mazz-res://tor/' + encodeURI"), 'P2P 流必须走 tor/ 代理且编码');
    assert.ok(!pl.includes("attachAuxAudio('file://"), 'aux 音轨 file:// 必须退役');
    const mg = readSrc('renderer/modules/library/manga.js');
    assert.ok(mg.includes('mazz-res://media/'), '漫画图必须走协议');
    const di = readSrc('renderer/modules/markdown/docx-io.js');
    assert.ok(di.includes("mazz-res://media/"), 'docx 导出必须双前缀兼容');
  });
});

describe('HEVC 官方组件指引（微软商店组件 CDN）', () => {
  test('codec-guide 模块与官方链接', () => {
    const g = readSrc('renderer/lib/codec-guide.js');
    assert.ok(g.includes('HEVC_LINKS'), '官方链接表必须有');
    assert.ok((g.match(/delivery\.mp\.microsoft\.com/g) || []).length >= 2, '必须双官方包链接（x64+ARM64 / x64+x86+ARM64 实测 zip 目录）');
    assert.ok(g.includes('Microsoft.HEVCVideoExtension'), '失效兜底必须给官方包名');
    assert.ok(g.includes('Add-AppxPackage') || g.includes('appxbundle'), '安装方法必须说明');
    assert.ok(g.includes('hevcGuideLines') && g.includes('renderHevcGuide'), '平台指引与渲染器必须有');
    assert.ok(/win32[\s\S]{0,400}darwin|darwin[\s\S]{0,400}win32/.test(g) || (g.includes('win32') && g.includes('darwin')), 'win/mac/linux 平台三分支必须有');
    assert.ok(g.includes('shell:openExternal'), '链接点击必须走 openExternal');
  });
  test('播放设置自检段与明白话联动', () => {
    const pl = readSrc('renderer/modules/viewer/player.js');
    assert.ok(pl.includes('ps-codec'), '播放设置必须有解码自检段');
    assert.ok(pl.includes('probeCodecs'), '自检必须 canPlayType 实测驱动');
    assert.ok(pl.includes('renderHevcGuide'), 'HEVC 缺失必须嵌指引');
    const vi = readSrc('renderer/modules/viewer/index.js');
    assert.ok(vi.includes('vf-hevc-guide'), '降级卡必须嵌指引');
    assert.ok(vi.includes('mz-stream-err-guide'), '流明白话层必须嵌指引');
    assert.ok(!vi.includes('番剧片源多为 H.264/HEVC，超出 Chromium 解码面'), 'H264 已平反——旧冤案文案必须清');
    const main = readSrc('main/main.js');
    assert.ok(main.includes("bus.handle('shell:openExternal'"), 'openExternal 通道必须在');
  });
});

describe('HEVC 平台解码（NipaPlay 硬解遗产）', () => {
  test('平台解码开关显式开', () => {
    const src = readSrc('main/main.js');
    assert.ok(src.includes('PlatformHEVCDecoderSupport'), 'HEVC 平台解码必须显式开（Win 系统组件/mac VideoToolbox）');
    assert.ok(src.includes('VaapiVideoDecoder'), 'Linux VAAPI 必须同开（有 GPU 白拿）');
  });
  test('tor/ 代理响应头加固', () => {
    const src = readSrc('main/main.js');
    const tor = src.match(/rel\.startsWith\('tor\/'\)[\s\S]{0,600}/);
    assert.ok(tor && tor[0].includes('Access-Control-Allow-Origin'), 'tor/ 响应必须补 ACAO');
    assert.ok(tor && tor[0].includes('Cross-Origin-Resource-Policy'), 'tor/ 响应必须补 CORP');
  });
});
