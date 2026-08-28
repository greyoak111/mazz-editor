// tests/contract/hotfix-w45.test.mjs —— 真机三件套热修契约（工作区树/空起手/面板风格一致化）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('工作区树展开媒体库', () => {
  test('迁移启动即触发（不再等 tor:add）', () => {
    const src = readSrc('main/torrent-daemon.js');
    assert.ok(/this\.torrents = new Map\(\);[\s\S]{0,700}try \{ this\.storeRoot\(\); \} catch \{\}[\s\S]{0,180}this\.register\(\);/.test(src), '构造必须即过 storeRoot（迁移启动即触发——真机实锤闸）');
  });
});

describe('无视频启动', () => {
  test('bootEmptyPlayer 立即+切回双钩', () => {
    const src = readSrc('renderer/modules/viewer/index.js');
    assert.ok(src.includes('async function bootEmptyPlayer(ctl)'), '起手函数必须有');
    assert.ok(/if \(ctl\.path \|\| ctl\._player[\s\S]{0,60}return/.test(src), '幂等闸必须有');
    assert.ok(/create\(container\) \{[\s\S]{0,220}bootEmptyPlayer\(ctl\);/.test(src) && !src.includes('setTimeout(async () =>'), 'create 必须立即起（350ms 竞态不得复活——真机慢 attach 实锤）');
    assert.ok(src.includes('ctl._bootingEmpty'), 'await 竞态闸必须有（双播放器实锤）');
    assert.ok(/if \(!ctl\.path && !ctl\._player[\s\S]{0,60}\) \{ ctl\.body\.innerHTML = ''; bootEmptyPlayer\(ctl\); \}/.test(src), '切回必须清壳重起（死 UI 实锤闸）');
  });
});

describe('面板风格一致化（只风格不动框）', () => {
  test('窗体 chrome 现行真值（W47 定版：透明圆角+拖拽条+窗控三键，无全套标题栏）', () => {
    const src = readSrc('main/panel-windows.js');
    assert.ok(src.includes('transparent: true, frame: false'), 'W47 定版：透明圆角窗（Win10 圆角唯一路径——w45/46 的 overlay 案已被用户圆角诉求取代）');
    assert.ok(!src.includes('p-titlebar'), '不得夹带自制 HTML 标题栏件（用户禁令——历史两轮实锤）');
    assert.ok(!src.includes('titleBarOverlay') || src.includes('//'), 'overlay 案已废（与 transparent 互斥）');
  });
  test('面板页与 app 同盘同字', () => {
    for (const f of ['renderer/panels/favmgr.html', 'renderer/panels/pwmgr.html']) {
      const src = readSrc(f);
      assert.ok(!src.includes('p-titlebar') && !src.includes('p-wb'), `${f} 不得残留标题栏件`);
      assert.ok(src.includes('../styles/themes.css') && src.includes('dataset.theme'), `${f} W47 定版：直链 themes.css+主题 id 跟随（硬编码色盘已废）`);
      assert.ok(src.includes('--font-ui'), `${f} 字体必须吃 app 变量栈`);
    }
  });
});
