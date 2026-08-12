// tests/contract/hotfix-w58c.test.mjs —— W58c 契约（分屏刷新/播放器栏宽/自定义主题子窗/B12b 收编/B13b 窄列）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('① 分屏后自动刷新（视图穿帮根治）', () => {
  test('移签跨窗格广播+浏览器自动重同步重载', () => {
    const pz = readSrc('renderer/shell/panes.js');
    assert.ok(pz.includes("bus.emit('pane:tabMoved'"), 'moveTabToPane 必须广播 pane:tabMoved（唯一闸）');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes("bus.on('pane:tabMoved'"), 'shell 必须订阅');
    assert.ok(sh.includes('ctl?.__sync?.()'), '布局落稳重同步必须有');
    assert.ok(sh.includes('ctl.reloadTab?.(t)'), '浏览器自动刷新必须有（用户定版药方）');
    assert.ok(sh.includes('!ctl?._cloaked && !ctl?._dragCloak'), '斗篷闸防护必须有');
    const br = readSrc('renderer/modules/browser/index.js');
    assert.ok(br.includes('W58c 根治：create 必须返回 ctl 本体'), '浏览器 create 返 ctl 根治钉必须在（code W58 同族病）');
    assert.ok(!br.includes('return { container };'), '浏览器畸形态 { container } 返回必须绝迹');
  });
});

describe('② 播放器底部栏最低宽度（窗口态）', () => {
  test('z-index 压侧栏+min-width 全组件自然宽', () => {
    const css = readSrc('renderer/styles/base.css');
    assert.ok(/\.mz-controls \{[^}]*z-index: 9/.test(css), 'controls z-index 必须压过 .mz-side(8)');
    assert.ok(/\.mz-bar \{[^}]*min-width: max-content/.test(css), 'bar min-width=max-content 必须有');
  });
});

describe('③ 自定义主题子窗透明化根治', () => {
  test('快照件+延后广播+vars 全链', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('_themeVarsSnapshot()'), '快照件必须有');
    assert.ok(sh.includes('_broadcastThemeNow()'), '延后广播件必须有');
    assert.ok(!/setTheme\(id\) \{\s*\/\/[^\n]*\n\s*if \(contextKeys[^)]*\) \{\s*window\.mazz\?\.invoke\('theme:broadcast'/.test(sh.toString()), 'setTheme 开口就播的旧序必须绝迹');
    assert.ok(sh.includes("pl.type === 'themeSnapshot'"), '面板初始化快照桥必须有');
    const mj = readSrc('main/main.js');
    assert.ok(mj.includes("bus.handle('theme:broadcast', async ({ id, vars })"), '主进程 vars 透传必须有');
    const pw = readSrc('main/panel-windows.js');
    assert.ok(pw.includes('static broadcastTheme(id, vars)'), '面板广播 vars 必须有');
    assert.ok(pw.includes('payload.kind = kind'), '发件 kind 标注必须有（17 面板免手带）');
  });
  test('17 面板全收编（无漏网）', () => {
    const files = fs.readdirSync(path.resolve('renderer/panels')).filter(f => f.endsWith('.html'));
    assert.ok(files.length >= 17, '面板数底线');
    for (const f of files) {
      const s = readSrc('renderer/panels/' + f);
      assert.ok(s.includes("type: 'themeSnapshot'") || s.includes("type:'themeSnapshot'"), f + ' 必须走快照桥');
      assert.ok(!s.includes("settings:get', { key: 'theme' }") && !s.includes("settings:get',{key:'theme'}"), f + ' 老 settings:get theme 必须绝迹');
    }
  });
});

describe('④ B12b select 普查收编', () => {
  test('公共件三件套：代理/动态保鲜/收尸', () => {
    const sm = readSrc('renderer/lib/select-menu.js');
    assert.ok(sm.includes('export function selectProxy'), 'selectProxy 必须导出');
    assert.ok(sm.includes('new MutationObserver'), '选项重建自动保鲜必须有');
    assert.ok(sm.includes("sel._selProxy = api"), '手动同步口必须有');
    assert.ok(sm.includes('mo.disconnect()'), '收尸断观察必须有');
  });
  test('十一簇全收编', () => {
    const pins = [
      ['renderer/shell/sidebar-panels.js', 'selectProxy(this.wsSel'],
      ['renderer/modules/draw/index.js', "selectProxy(root.querySelector('.draw-guides')"],
      ['renderer/modules/sheet/index.js', "'#sg-border', '#sg-border-width', '#sg-fmt'"],
      ['renderer/modules/sheet/charts.js', "selectProxy(chartEl.querySelector('select')"],
      ['renderer/modules/viewer/player.js', "selectProxy(root.querySelector('.mz-speed')"],
      ['renderer/modules/markdown/index.js', /selectProxy\(sel\);\r?\n\s*if \(lh\) selectProxy\(lh\)/],
      ['renderer/modules/library/index.js', "'.lib-cat-filter', '.lib-mode', '.lib-read-theme', '.lib-pagew', '.lib-zh'"],
      ['renderer/modules/math/index.js', 'selectProxy(backendSel)'],
      ['renderer/modules/search/index.js', 'selectProxy(typeEl); selectProxy(scopeEl)'],
      ['renderer/modules/factory/index.js', 'selectProxy(this.genreSel'],
      ['renderer/modules/mindmap/index.js', 'proxyStylebarSelects'],
    ];
    for (const [f, pin] of pins) {
      const src = readSrc(f);
      assert.ok(pin instanceof RegExp ? pin.test(src) : src.includes(pin), f + ' 收编钉必须在');
    }
    const mm = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(mm.includes('stylebar._selProxies'), '导图重写前收尸必须有');
  });
});

describe('⑤ B13b 窄列后缀隐藏', () => {
  test('ResizeObserver 阈值挂类+CSS 整族隐藏', () => {
    const ft = readSrc('renderer/shell/file-tree.js');
    assert.ok(ft.includes('new ResizeObserver'), '窄列观察必须有');
    assert.ok(ft.includes("ft-narrow"), 'ft-narrow 类必须有');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(css.includes('.ft-narrow .ft-dir { display: none; }'), 'CSS 隐藏规则必须有');
  });
});
