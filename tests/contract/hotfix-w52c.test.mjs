// tests/contract/hotfix-w52c.test.mjs —— W52③ 浮层遣散契约（toast挪位/ribbon原生/薄子窗/全应用子窗）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('toast 挪位与 ribbon 原生菜单', () => {
  test('toast 不盖视图区', () => {
    const css = readSrc('renderer/styles/base.css');
    assert.ok(/\.mazz-toast \{[\s\S]{0,120}left: 12px/.test(css), 'toast 必须挪左侧（永不盖视图区）');
    assert.ok(!/\.mazz-toast \{[\s\S]{0,120}left: 50%/.test(css), '居中旧位不得复活');
  });
  test('ribbon 更多切 ctxmenu 子窗格（W56 B13：回老样式血统，载体不回 DOM）', () => {
    const rb = readSrc('renderer/shell/ribbon.js');
    assert.ok(rb.includes("kind: 'ctxmenu'"), 'showMore 必须走 ctxmenu 子窗格');
    assert.ok(!/invoke\('menu:context'/.test(rb), 'menu:context 原生 OS 菜单必须退出 ribbon（仅留浏览器视图内右键 W34 路）');
    assert.ok(rb.includes('menus._ctxItems'), 'ctxmenu stash 桥必须有');
  });
});

describe('薄子窗（palette/shortcuts）', () => {
  test('面板位与数据桥', () => {
    const pw = readSrc('main/panel-windows.js');
    assert.ok(pw.includes('palette') && pw.includes('shortcuts'), '面板种类必须加薄子窗两位');
    assert.ok(pw.includes("bus.handle('panel:push'"), 'panel:push 回答信道必须有');
    const br = readSrc('preload/bridge.js');
    assert.ok(br.includes("'panel:push'"), '桥白名单必须有（双向）');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('paletteQuery') && sh.includes('shortcutQuery') && sh.includes('paletteRun'), '三问必须有');
    assert.ok(sh.includes('fuzzyScore') && sh.includes('displayKey'), '检索与键位渲染必须复用核心件');
    assert.ok(sh.includes("panel:open', { kind: 'palette' }") && sh.includes("panel:open', { kind: 'shortcuts' }"), '两命令必须改道薄子窗');
  });
  test('薄窗页面三铁律', () => {
    for (const f of ['renderer/panels/palette.html', 'renderer/panels/shortcuts.html']) {
      const src = readSrc(f);
      assert.ok(src.includes('../styles/themes.css') && src.includes('dataset.theme'), `${f} 主题跟随必须有`);
      assert.ok(src.includes('p-drag') && src.includes('p-winbtns'), `${f} 拖拽+窗控必须有`);
      assert.ok(src.includes('mazz-scroll'), `${f} 滚动条族必须有（军规④）`);
    }
  });
});

describe('全应用子窗（设置/帮助/协议）', () => {
  test('handoff openModal 支路（W53 已退役：七面板全走 panel-windows 全原生子窗格）', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(!sh.includes('snapshot?.openModal'), 'openModal 支路必须退役（panel-windows 时代）');
    assert.ok(!sh.includes('openChildModal'), 'openChildModal 助手必须退役（panel-windows 时代）');
    assert.ok(sh.includes("kind: 'settings'"), '设置必须走 panel:open 子窗格');
    const help = readSrc('renderer/help/index.js');
    assert.ok(help.includes("kind: 'help'"), '帮助必须走 panel:open 子窗格');
    const rb = readSrc('renderer/shell/ribbon.js');
    assert.ok(rb.includes("kind: 'agreement'"), '协议必须走 panel:open 子窗格');
  });
});
