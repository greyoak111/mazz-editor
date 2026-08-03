// tests/contract/hotfix-w57.test.mjs —— W57 契约（分屏 DOM 回归+拖拽 cloak/factorycfg 收编/toast 防压）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('分屏 DOM 回归+拖拽 cloak', () => {
  test('老 DOM overlay 转正+拖起隐落下恢复', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('dragCloak'), 'dragCloak 必须有');
    assert.ok(sh.includes('bctl._dragCloak = !!on'), '拖拽独立闸必须有（observer 不覆盖）');
    assert.ok(sh.includes('dragCloak(true)') && sh.includes('dragCloak(false)'), '拖起隐/落下恢复必须挂');
    assert.ok(!sh.includes("kind: 'splitpreview'") || sh.includes('非 Electron'), '罩页调用必须退出分屏主线');
    assert.ok(sh.includes('W57 分屏路线修正'), '路线修正注释必须在');
    assert.ok(sh.includes('overlay.style.background = zoneGradient'), '老 DOM overlay 样式必须保留');
  });
});

describe('factorycfg 收编（创作模板/AI 服务）', () => {
  test('kind 注册+双页签+桥+两入口收编', () => {
    assert.ok(readSrc('main/panel-windows.js').includes('factorycfg'), 'kind 注册必须有');
    const html = readSrc('renderer/panels/factorycfg.html');
    assert.ok(html.includes('factoryPresetsQuery') && html.includes('secret:get') && html.includes('secret:set'), 'PRESETS 桥+密钥直读写必须有');
    assert.ok(html.includes('factory:aiModels') && html.includes('factory:aiChat'), '拉取/测试白名单直调必须有');
    assert.ok(html.includes('genreSave'), '模板保存桥必须有');
    const fi = readSrc('renderer/modules/factory/index.js');
    assert.ok(fi.includes("kind: 'factorycfg'"), '两入口必须收编');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('factoryPresetsQuery') && sh.includes('genreSave') && sh.includes('factoryProviderSaved'), '桥应答必须有');
    assert.ok(sh.includes("import('../modules/factory/engine.js')"), 'saveCustomGenre 必须走 engine.js 单源');
  });
});

describe('图标补丁两件（dockfloat 0×0/快速跳转裸 emoji）', () => {
  test('S() 内联 em 尺寸+快速跳转 iconHtml 化', () => {
    const si = readSrc('renderer/lib/svg-icons.js');
    assert.ok(si.includes('width="1em" height="1em"'), 'S() 必须内联 em 尺寸（0×0 缺失平反）');
    const sd = readSrc('renderer/shell/side-dock.js');
    assert.ok(sd.includes("iconHtml('⚡')"), '快速跳转必须 iconHtml 化');
    assert.ok(!sd.includes('>⚡ 快速跳转<'), '快速跳转裸 emoji 必须绝迹');
    const rb = readSrc('renderer/shell/ribbon.js');
    assert.ok(rb.includes('icon: b.icon'), 'B13 stash 必须带 icon（二级菜单无 SVG 样式平反）');
  });
});

describe('toast 防压', () => {
  test('视图覆盖左下挪顶', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('mazz-toast-top'), '挪顶类判定必须有');
    assert.ok(sh.includes('vr.bottom > window.innerHeight - 120'), '覆盖判定必须有');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(css.includes('.mazz-toast-top'), '挪顶样式必须有');
    assert.ok(css.includes('top: 46px; left: 50%'), '顶部居中必须有');
  });
});
