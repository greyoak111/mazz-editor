import './_setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { commands } from '../../renderer/core/command-registry.js';
import { MATURITY, PRODUCT_CAPABILITIES, visibleHelpSections } from '../../renderer/core/product-maturity.js';
import { HELP_SECTIONS } from '../../renderer/help/content.js';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');

describe('W71 产品入口成熟度单源', () => {
  test('历史 PARTIAL 与低水位候选全部得到唯一三态', () => {
    const expected = {
      mobile: MATURITY.HIDDEN,
      updater: MATURITY.HIDDEN,
      feed: MATURITY.FORMAL,
      agent: MATURITY.HIDDEN,
      dmhy: MATURITY.FORMAL,
      recorder: MATURITY.PREVIEW,
      plugins: MATURITY.PREVIEW,
      ocr: MATURITY.PREVIEW,
      archive: MATURITY.PREVIEW,
      ffmpegRuntime: MATURITY.HIDDEN,
    };
    assert.deepEqual(Object.fromEntries(Object.entries(PRODUCT_CAPABILITIES).map(([id, item]) => [id, item.maturity])), expected);
  });

  test('Hidden 命令不注册，Preview 命令自动显式标识并进入工具卡', () => {
    let hiddenRan = false;
    const hidden = commands.register('update.check', { title: '检查更新', source: 'w71-maturity-test', run: () => { hiddenRan = true; } });
    assert.equal(hidden, false);
    assert.equal(commands.has('update.check'), false);
    assert.equal(hiddenRan, false);

    commands.register('ocr.image', { title: '图片文字识别（OCR）', source: 'w71-maturity-test', run: () => {} });
    const preview = commands.get('ocr.image');
    assert.equal(preview.maturity, MATURITY.PREVIEW);
    assert.match(preview.title, /（预览）$/);
    assert.equal(commands.toolCards().find(card => card.id === 'ocr.image')?.maturity, MATURITY.PREVIEW);
    commands.unregisterBySource('w71-maturity-test');
  });

  test('工具坞消费命令可见性，Updater 面板入口与移动帮助不再暴露', () => {
    const dock = read('renderer/shell/side-dock.js');
    const sync = read('renderer/panels/sync.html');
    const help = read('renderer/help/content.js');
    const shell = read('renderer/shell/shell.js');
    assert.ok(dock.includes('items.filter(item => commands.has(item.cmd))'));
    assert.ok(!sync.includes('data-t="update"'));
    assert.ok(sync.includes("if (t === 'update') t = 'host'"));
    assert.equal(visibleHelpSections(HELP_SECTIONS).some(section => section.id === 'mobile'), false);
    assert.ok(shell.includes("const src = visibleHelpSections(ver === 'senior' ? SENIOR_SECTIONS : HELP_SECTIONS)"),
      'Electron 原生帮助窗必须与网页帮助共用同一可见性规则');
    assert.ok(!help.includes('## 检查更新'));
  });

  test('保留 Preview 的工具继续明示；已过门禁的四站数据源转为 Formal', () => {
    for (const file of ['renderer/panels/archive.html', 'renderer/panels/plugins.html', 'renderer/panels/recorder.html']) {
      assert.match(read(file), /预览/);
    }
    assert.match(read('renderer/help/content.js'), /插件系统（预览/);
    assert.doesNotMatch(read('main/torrent-sites.js'), /（预览）/);
    assert.doesNotMatch(read('renderer/modules/viewer/player.js'), /DMHY（预览）/);
    assert.match(read('renderer/modules/viewer/player.js'), /sites:searchMany/);
  });

  test('FFmpeg core 未闭环时转码子能力 Hidden 且发行物双重排除', () => {
    const pkg = JSON.parse(read('package.json'));
    const viewer = read('renderer/modules/viewer/index.js');
    const player = read('renderer/modules/viewer/player.js');
    const recorder = read('renderer/panels/recorder.html');
    const help = read('renderer/help/content.js');
    assert.equal(PRODUCT_CAPABILITIES.ffmpegRuntime.maturity, MATURITY.HIDDEN);
    assert.ok(viewer.includes('PRODUCT_CAPABILITIES.ffmpegRuntime.maturity !== MATURITY.HIDDEN'));
    assert.ok(player.includes('PRODUCT_CAPABILITIES.ffmpegRuntime.maturity !== MATURITY.HIDDEN'));
    assert.equal(recorder.includes('<option value="mp4">'), false);
    assert.match(recorder, /源码分发闭环后重新启用/);
    assert.match(help, /不进入发行包或正式入口/);
    assert.ok(pkg.build.files.includes('!renderer/vendor/ffmpeg/ffmpeg-core.js'));
    assert.ok(pkg.build.files.includes('!renderer/vendor/ffmpeg/ffmpeg-core.wasm'));
  });
});
