// tests/contract/hotfix-w55.test.mjs —— W55 契约（样式统一/右键全收编/播放器改名/分屏预览罩）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('①独立子窗格与迁移前样式统一', () => {
  test('panel-shared rb 族原值', () => {
    const css = readSrc('renderer/panels/panel-shared.css');
    assert.ok(css.includes('.rb-input, .rb-select'), 'rb-input/select 族必须有');
    assert.ok(css.includes('border-radius: 6px; padding: 4px 8px; font-size: 12px;'), 'rb 原版三值必须有');
    assert.ok(css.includes('.set-row'), 'set-row 族必须有');
  });
  test('面板控件值对齐（radius 6/font 12）', () => {
    for (const f of ['settings', 'agreement', 'bookmark', 'plugins', 'recorder']) {
      const html = readSrc(`renderer/panels/${f}.html`);
      assert.ok(!/border-radius:7px; padding:[56]px 1[46]px; font-size:12.5px/.test(html), `${f} 不得残留 7px/12.5px 旧值`);
      assert.ok(html.includes('border-radius:6px'), `${f} 必须 6px 圆角`);
    }
  });
});

describe('②全软件右键收编 ctxmenu 子窗格', () => {
  test('menu-service Electron 一律子窗格（preferDom 失效）', () => {
    const ms = readSrc('renderer/core/menu-service.js');
    assert.ok(ms.includes("kind: 'ctxmenu'"), 'menu-service 必须走 ctxmenu');
    assert.ok(ms.includes('_ctxItems'), 'stash 桥必须有');
    assert.ok(!ms.includes('preferDom = false') || ms.includes('if (window.mazz?.isElectron) {'), 'Electron 必须无差别子窗格');
  });
  test('ctxmenu 面板+定位+失焦关窗+键控', () => {
    const html = readSrc('renderer/panels/ctxmenu.html');
    assert.ok(html.includes('ctxmenuQuery') && html.includes('ctxmenuPick'), '问答桥必须有');
    assert.ok(html.includes('ArrowDown') && html.includes('Enter') && html.includes('Escape'), '键控必须有');
    assert.ok(html.includes('openSub'), '子菜单展开必须有');
    const pw = readSrc('main/panel-windows.js');
    assert.ok(pw.includes("kind === 'ctxmenu'"), 'kind 认识必须有');
    assert.ok(pw.includes("win.on('blur'"), '失焦关窗必须有');
    assert.ok(pw.includes('getContentBounds'), '屏坐标换算必须有');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('ctxmenuQuery') && sh.includes('ctxmenuPick'), '主窗桥必须有');
    assert.ok(sh.includes('iconHtml'), '菜单图标 SVG 化必须有');
  });
});

describe('③播放器改名', () => {
  test('查看器→播放器', () => {
    assert.ok(readSrc('renderer/modules/viewer/index.js').includes("displayName: '播放器'"), '模块名必须改');
    assert.ok(readSrc('renderer/shell/shell.js').includes("label: '播放器'"), 'ribbon 卡必须改');
    assert.ok(readSrc('renderer/shell/shell.js').includes("title: '播放器'"), '页签名必须改');
  });
});

describe('④分屏预览跨 Surface 收敛', () => {
  test('旧 splitpreview 罩只保留资产；W87d 主线先铺代理帧再启用 DOM overlay', () => {
    const pw = readSrc('main/panel-windows.js');
    assert.ok(pw.includes("kind === 'splitpreview'"), 'kind 认识必须有（备选通道保留）');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('buildProxy') && sh.includes("invoke('bv:captureVisibleHost'"), 'WCV cloak 前必须按真实宿主建立全量可见帧代理');
    assert.ok(sh.includes('dragCloak'), '代理就绪后的拖拽命中闸必须有');
    assert.ok(sh.includes('W87d'), '当前路线修正注释必须在');
  });
});
