// tests/contract/hotfix-w46.test.mjs —— 真机三件套热修②契约（工具坞遮挡/空手起播入口/面板 chrome 同族）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('工具坞遮挡', () => {
  test('浮层遮盖根治史（W46 cloak → W49 命中测试 → W50 离屏终局）', () => {
    const src = readSrc('renderer/modules/browser/index.js');
    assert.ok(!src.includes('br-osr'), 'W52 起离屏 canvas 退役（回正原生渲染——浮层改走原生/子窗/推挤三路）');
    assert.ok(src.includes('cloakCheck'), '兜底 cloak 过渡件在岗');
    const dock = readSrc('renderer/shell/side-dock.js');
    assert.ok(dock.includes("classList.add('floating')") && dock.includes("classList.remove('floating')"), '浮窗态类必须在（cloak 判定锚）');
  });
});

describe('空手起播入口', () => {
  test('工具坞打开播放器改道 file.newViewer', () => {
    const src = readSrc('renderer/shell/side-dock.js');
    assert.ok(src.includes("cmd: 'file.newViewer'"), '工具坞必须空手起播（不再逼选本地视频——真机图实锤）');
    assert.ok(!src.includes("cmd: 'player.open'"), '旧文件对话框入口不得占工具坞位');
  });
  test('player.open 本体保留（命令面板的文件对话框路径不动）', () => {
    const src = readSrc('renderer/shell/shell.js');
    assert.ok(src.includes("R('player.open'"), 'player.open 命令本体保留（用户没让动）');
  });
});
