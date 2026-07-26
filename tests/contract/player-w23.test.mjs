// tests/contract/player-w23.test.mjs —— 波次二十三「P2P 边下边播」架构契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('P2P 守护与通道', () => {
  test('torrent-daemon 六通道与依赖打桩', () => {
    const src = readSrc('main/torrent-daemon.js');
    for (const ch of ["'tor:add'", "'tor:stats'", "'tor:list'", "'tor:streamUrl'", "'tor:filePath'", "'tor:remove'"]) {
      assert.ok(src.includes(ch), `缺通道 ${ch}`);
    }
    assert.ok(src.includes('node-datachannel'), 'node-datachannel 打桩必须有（cmake 原生绕不过）');
    assert.ok(src.includes('uploadLimit'), '上行限流必须有（做种本性说清）');
    assert.ok(src.includes("import('webtorrent')"), '必须 lazy import webtorrent');
    assert.ok(src.includes('createServer'), '必须有 range 流端点');
    // 防回归：client.get() 预查会拿空壳（files:0 实锤）——不得再现
    assert.ok(!src.includes('client.get(magnet)'), '不得用 client.get() 预查空壳');
  });
  test('守护装配与桥白名单', () => {
    const main = readSrc('main/main.js');
    assert.ok(main.includes("require('./torrent-daemon')") && main.includes("require('./torrent-sites')"), '主进程必须装配守护与适配器');
    const bridge = readSrc('preload/bridge.js');
    for (const ch of ["'tor:add'", "'tor:stats'", "'tor:list'", "'tor:streamUrl'", "'tor:filePath'", "'tor:remove'", "'sites:list'", "'sites:search'", "'sites:magnet'"]) {
      assert.ok(bridge.includes(ch), `桥白名单缺 ${ch}`);
    }
    assert.ok(main.includes("rel.startsWith('tor/')"), 'mazz-res 必须有 tor 流代理');
  });
});

describe('动漫花园适配器', () => {
  test('搜索/详情两级懒取结构', () => {
    const src = readSrc('main/torrent-sites.js');
    assert.ok(src.includes('dongmanhuayuan.com/search/'), '搜索路径必须破译');
    assert.ok(src.includes('resource-row'), 'resource-row 行结构必须破译');
    assert.ok(src.includes('urn:btih:'), '详情页 magnet 必须破译');
    assert.ok(src.includes('dmhy-sync'), '同步站必须在册');
  });
});

describe('三源面板', () => {
  test('页签/媒体库/网络资源接线', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    for (const k of ['mz-src-tab', 'data-src="playlist"', 'data-src="medialib"', 'data-src="web"']) {
      assert.ok(src.includes(k), `缺 ${k}`);
    }
    assert.ok(src.includes("window.mazz?.on?.('workspace:changed'"), '工作区切换必须重扫媒体库');
    assert.ok(src.includes('sites:search') && src.includes('sites:magnet') && src.includes('tor:add'), '网络资源搜索/懒取/添加必须接线');
    assert.ok(src.includes('mz-wr-title'), '行完整标题名称一栏必须有');
    assert.ok(src.includes('torrentKeepMode'), '播完存/不存模式必须有');
    assert.ok(src.includes('watchPollT'), '下载状态轮询必须有且必须可清');
  });
});

describe('依赖卫生', () => {
  test('patch-package 与钉版', () => {
    assert.ok(fs.existsSync(path.resolve('patches/webtorrent+2.8.5.patch')), 'webtorrent 源码补丁必须入册');
    const patch = readSrc('patches/webtorrent+2.8.5.patch');
    assert.ok(patch.includes('arr2hex') && patch.includes("typeof parsedTorrent.infoHash === 'string'"), '补丁必须修 infoHash 双形态');
    const pkg = JSON.parse(readSrc('package.json'));
    assert.equal(pkg.dependencies?.webtorrent, '2.8.5', 'webtorrent 必须精确钉版');
    assert.equal(pkg.scripts?.postinstall, 'patch-package', 'postinstall 必须挂 patch-package');
    assert.ok(pkg.devDependencies?.['patch-package'], 'patch-package 必须入 devDeps');
  });
});
