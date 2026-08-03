// tests/contract/hotfix-w47.test.mjs —— W47 大修契约（居中/文件夹SVG/主题跟随/圆角拖拽/工具坞并行/密码捕获/F12/计时器SVG）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('播放器与图标', () => {
  test('空页提示黑画面中央（推挤补偿）', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('right:var(--mz-side-w,0px)'), '空页提示必须随侧栏收窄（黑画面中央——真机点名校正）');
    assert.ok(!src.includes("empty.style.cssText = 'position:absolute;inset:0"), 'inset:0 全台居中不得复活');
  });
  test('文件夹 emoji 消灭', () => {
    const p = readSrc('renderer/modules/viewer/player.js');
    assert.ok(p.includes("iconHtml('📂')") && !p.includes('>📁 ${'), '媒体库树必须 SVG 文件夹');
    const fav = readSrc('renderer/panels/favmgr.html');
    assert.ok(fav.includes('FOLDER_SVG') && !fav.includes('📁 '), '收藏面板必须 SVG 文件夹');
    const svg = readSrc('renderer/lib/svg-icons.js');
    assert.ok(svg.includes("'📁'") && svg.includes("'⏳'"), 'svg 库必须收 📁/⏳');
    const sl = readSrc('renderer/modules/slide/index.js');
    assert.ok(sl.includes('iconHtml(t.ico)'), '演示工具条必须走 iconHtml（计时器 SVG 实锤）');
  });
});

describe('主题跟随与窗体', () => {
  test('主题跟随主界面（非 OS 明暗）', () => {
    const pw = readSrc('main/panel-windows.js');
    assert.ok(pw.includes('static all = new Map()') && pw.includes('broadcastTheme'), '面板必须入主题广播注册表');
    const main = readSrc('main/main.js');
    assert.ok(main.includes('PanelWindows.broadcastTheme(id, vars)'), 'theme:broadcast 必须扩面板（W58c vars 快照随播）');
    for (const f of ['renderer/panels/favmgr.html', 'renderer/panels/pwmgr.html']) {
      const src = readSrc(f);
      assert.ok(src.includes('../styles/themes.css') && src.includes('dataset.theme'), `${f} 必须直链 themes.css+应用主题 id`);
      assert.ok(src.includes("type: 'themeSnapshot'") || src.includes("type:'themeSnapshot'"), `${f} 必须读主界面主题初值（W58c 快照桥：id+vars 一把抓——settings:get 老路径只有 id 没有自定义变量=透明化病根，已退役）`);
      assert.ok(src.includes("mazz.on('theme:changed'"), `${f} 必须跟广播`);
    }
  });
  test('圆角+拖拽+窗控三键（无全套标题栏）', () => {
    const pw = readSrc('main/panel-windows.js');
    assert.ok(pw.includes('transparent: true, frame: false'), '圆角唯一路径=透明窗（Win10 无原生 API）');
    for (const f of ['renderer/panels/favmgr.html', 'renderer/panels/pwmgr.html']) {
      const src = readSrc(f);
      assert.ok(src.includes('border-radius:12px'), `${f} 圆角必须有`);
      assert.ok(src.includes('-webkit-app-region:drag'), `${f} 拖拽条必须有`);
      assert.ok(src.includes('p-winbtns') && !src.includes('p-titlebar'), `${f} 窗控三键有/全套标题栏无（用户定版）`);
    }
  });
});

describe('工具坞迁移方案回滚（W49 定版）', () => {
  test('并行件全撤，内嵌坞复位', () => {
    assert.ok(!fs.existsSync(path.resolve('renderer/panels/dock.html')), 'dock.html 必须已撤（迁移方案放弃——用户定版）');
    assert.ok(!fs.existsSync(path.resolve('renderer/lib/dock-items.js')), 'dock-items.js 必须已撤');
    const pw = readSrc('main/panel-windows.js');
    assert.ok(!pw.includes('dock.html') && !pw.includes("'dock'") && !pw.includes('|dock|'), 'panel 白名单不得留老 dock 并行件（W53 dockfloat 豁免=合法新员）');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(!sh.includes('app.openDock') && !sh.includes('dockCmd'), 'shell 不得留并行命令与桥');
    assert.ok(sh.includes("{ command: 'factory.toggleDock', icon: '🧰', label: '工具坞' }"), 'ribbon 工具坞必须回内嵌坞');
    const side = readSrc('renderer/shell/side-dock.js');
    assert.ok(side.includes('const GROUPS = this._toolsGroups = [') && side.includes("cmd: 'file.newViewer'"), '内嵌坞必须 w46 原样（内联 GROUPS+空手起播入口；W53 起兼 toolsGroups 出口）');
  });
});

describe('密码捕获与 F12', () => {
  test('页面表单捕获→询问保存', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(bv.includes('did-frame-finish-load') && bv.includes('__MZPW__'), '客页表单捕获钩必须有');
    assert.ok(bv.includes('onPwCapture') && bv.includes('30000'), '去重 30s 必须有（Edge 同款克制）');
    const br = readSrc('renderer/modules/browser/index.js');
    assert.ok(br.includes("type !== 'pw-capture'") && br.includes('pw:save'), '询问保存必须有（绝不静默落库）');
    assert.ok(br.includes('pwOffered|'), '每站每人每会话只问一趟必须有');
  });
  test('devtools', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(bv.includes("bus.handle('bv:devtools'") && bv.includes("openDevTools({ mode: 'detach' })"), 'bv:devtools 开关必须有');
    const br = readSrc('preload/bridge.js');
    assert.ok(br.includes("'bv:devtools'"), '桥白名单必须有');
    const mod = readSrc('renderer/modules/browser/index.js');
    assert.ok(mod.includes('browser.devtools') && mod.includes("key: 'f12'"), '命令+F12 键位必须有');
    const m = readSrc('main/browser-views.js');
    assert.ok(m.includes("act('browser.devtools')"), '原生右键菜单项必须有');
  });
});
