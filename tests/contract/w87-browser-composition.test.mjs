import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');

describe('W87b Browser 复合 Surface 几何/生命周期子门（拖拽视觉连续性由 W87d）', () => {
  test('Browser View ID 必须跨 renderer 全局唯一，恢复只操作目标实例', () => {
    const browser = read('renderer/modules/browser/index.js');
    assert.match(browser, /crypto\?\.randomUUID|crypto\.randomUUID/);
    assert.match(browser, /ctl\._storeReady/);
    assert.match(browser, /async setContent\(/);
    const restore = browser.slice(browser.indexOf('async setContent('), browser.indexOf('newDocument(', browser.indexOf('async setContent(')));
    assert.match(restore, /ctl\.openTabRaw/);
    assert.doesNotMatch(restore, /window\.MazzCommands\??\.execute/);
  });

  test('主页 document.write 必须并入导航串行闸，禁止迟到覆盖真网页', () => {
    const browser = read('renderer/modules/browser/index.js');
    assert.match(browser, /await renderHome\(tab\)/);
    assert.match(browser, /async function renderHome\(tab\)/);
    const home = browser.slice(browser.indexOf('async function renderHome(tab)'), browser.indexOf('/** 加载失败页', browser.indexOf('async function renderHome(tab)')));
    assert.match(home, /return window\.mazz\.invoke\('bv:js'/);
  });

  test('只有完整 host proxy coverage ACTIVE 后才可提交分屏；布局迁移完成前不得恢复 WCV', () => {
    const shell = read('renderer/shell/shell.js');
    const views = read('main/browser-views.js');
    assert.match(shell, /browserControllers/);
    assert.match(shell, /MazzVisualComposition.*split-drag|split-drag.*MazzVisualComposition/s);
    assert.match(shell, /bv:captureVisibleHost/);
    assert.match(views, /validateHostCoverage/);
    const split = shell.slice(shell.indexOf('installSplitPreview()'), shell.indexOf('/** 外部文件拖入'));
    assert.ok(split.indexOf('await overlayHandle?.ready') < split.indexOf('dragCloak(true)'));
    assert.match(split, /proxyPhase !== 'active'\) \{ cleanup\(\); return; \}/);
    const drop = shell.slice(shell.indexOf("document.addEventListener('drop'"), shell.indexOf("document.addEventListener('dragend'"));
    assert.match(drop, /finishingDrop = true[\s\S]*clearPreview\(\)[\s\S]*this\.splitWithTab[\s\S]*requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => cleanup\(\)\)\)/);
    assert.doesNotMatch(drop, /cleanup\(\);\s*this\.splitWithTab/, '有效 drop 不得在迁移前释放遮挡');
  });

  test('分屏重组只做本地 compositor recompose，不得网络 reload', () => {
    const shell = read('renderer/shell/shell.js');
    const views = read('main/browser-views.js');
    const moved = shell.slice(shell.indexOf("bus.on('pane:tabMoved'"), shell.indexOf("bus.on('filetree:renamed'"));
    assert.doesNotMatch(moved, /reloadTab/);
    assert.match(moved, /recompose/);
    assert.match(views, /_compositionGen/);
    assert.match(views, /geometryChanged/);
    assert.match(views, /recomposeHost/);
  });

  test('普通 Panel 首帧就绪后才显示，关闭后焦点归真实宿主', () => {
    const panels = read('main/panel-windows.js');
    assert.match(panels, /show:\s*false/);
    assert.match(panels, /const host = win\.__panelHost/);
    assert.match(panels, /refreshHost/);
  });

  test('带标签交接的工作台子窗在 ACK 前不得裸显', () => {
    const main = read('main/main.js');
    const wm = read('main/window-manager.js');
    assert.match(main, /createChild\(\{\s*deferShow:/);
    assert.match(main, /if \(ok && !child\.isDestroyed\(\)\)\s*\{[\s\S]*?__showAfterHandoff/);
    assert.match(wm, /deferShow/);
    assert.match(wm, /__readyToShow[\s\S]*__handoffReady|__handoffReady[\s\S]*__readyToShow/);
  });
});
