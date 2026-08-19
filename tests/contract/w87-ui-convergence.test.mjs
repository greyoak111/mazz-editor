import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { SVG_ICONS } from '../../renderer/lib/svg-icons.js';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');

describe('W87 统一视觉合成协议', () => {
  test('Main / Panel / WebContentsView / DOM Overlay 全接唯一注册表', () => {
    const main = read('main/main.js');
    const windows = read('main/window-manager.js');
    const panels = read('main/panel-windows.js');
    const views = read('main/browser-views.js');
    const runtime = read('main/visual-composition.js');
    assert.ok(main.includes('new VisualCompositionRuntime') && main.includes('attachPanelWindows') && main.includes('attachBrowserViews'));
    assert.ok(windows.includes('visualComposition?.registerWindow'));
    assert.ok(panels.includes('visualComposition?.registerPanel') && panels.includes('__panelHost'));
    assert.ok(views.includes('visualComposition?.registerView') && views.includes('setHostOccluded'));
    for (const channel of ['visual:overlayBegin', 'visual:overlayUpdate', 'visual:overlayEnd', 'visual:snapshot', 'visual:focus']) {
      assert.ok(runtime.includes(`'${channel}'`) && read('preload/bridge.js').includes(`'${channel}'`), `${channel} 必须主进程注册且 preload 显式放行`);
    }
  });

  test('Browser 不再私自观察 modal，拖拽即时 cloak 与 Windows revive 补丁保留', () => {
    const browser = read('renderer/modules/browser/index.js');
    const views = read('main/browser-views.js');
    assert.ok(!browser.includes("querySelectorAll('.mazz-palette-mask, .help-mask')") && !browser.includes('ctl._cloaked'));
    assert.ok(browser.includes('ctl._dragCloak'));
    for (const marker of ['webContents.invalidate()', 'width: Math.max(1, R.width - 1)', 'height: Math.max(1, R.height - 1)', 'backgroundThrottling: false']) {
      assert.ok(views.includes(marker), `已实证 compositor workaround 不得误删：${marker}`);
    }
  });

  test('全局 Overlay Plane、焦点圈、尺寸档和 reduced-motion 均真实装载', () => {
    const index = read('renderer/index.html');
    const app = read('renderer/app.js');
    const client = read('renderer/core/visual-composition.js');
    const css = read('renderer/styles/convergence.css');
    assert.ok(index.includes('styles/convergence.css') && app.includes('visualComposition.start()'));
    for (const selector of ['.mazz-palette-mask', '.appwin-mask', '.page-preview-mask', '.sl-present']) assert.ok(client.includes(selector));
    for (const marker of ['#mazz-overlay-plane', ':focus-visible', 'data-ui-size', 'prefers-reduced-motion']) assert.ok(css.includes(marker));
  });

test('启动完成承诺与主题代际阻止迟到设置覆盖用户选择', () => {
    const app = read('renderer/app.js');
    const shell = read('renderer/shell/shell.js');
    assert.ok(app.includes('window.MazzBoot = bootPromise') && app.includes("dataset.appReady = '1'"));
    assert.ok(shell.includes('initialThemeRevision') && shell.includes('this._themeRevision === initialThemeRevision'));
  });

  test('页签隐藏前交还焦点并以 inert 隔离，表格输入代理不得 aria-hidden', () => {
    const tabs = read('renderer/shell/tabs.js');
    const sheet = read('renderer/modules/sheet/index.js');
    assert.match(tabs, /_releaseFocus\(view\)/);
    assert.match(tabs, /toggleAttribute\('inert', !active\)/);
    assert.match(tabs, /setAttribute\('aria-hidden', String\(!active\)\)/);
    assert.doesNotMatch(sheet, /sg-capture[^>]*aria-hidden/);
    assert.match(sheet, /sg-capture[^>]*aria-label="当前单元格输入"/);
  });

  test('瞬时原生菜单首帧就绪后才显现，初始假 blur 不得自闭', () => {
    const panels = read('main/panel-windows.js');
    assert.match(panels, /const transientPanel = kind === 'ctxmenu' \|\| kind === 'picklist'/);
    assert.match(panels, /show:\s*false/);
    assert.match(panels, /once\('ready-to-show'/);
    assert.match(panels, /__dismissOnBlurArmed/);
  });
});

describe('W87 全面板 UI 装载与图标门', () => {
  test('所有 PanelWindow HTML 均装载共享样式、运行时与允许 self module 的 CSP', () => {
    const panels = fs.readdirSync(path.resolve('renderer/panels')).filter(name => name.endsWith('.html')).sort();
    assert.equal(panels.length, 24);
    for (const name of panels) {
      const html = read(`renderer/panels/${name}`);
      assert.ok(html.includes('panel-runtime.js'), `${name} 未装 panel-runtime`);
      assert.ok(/script-src[^";]*'self'/.test(html), `${name} CSP 未允许同源 module`);
      if (name !== 'splitpreview.html') assert.ok(html.includes('panel-shared.css'), `${name} 未装共享 UI 层`);
    }
    const panelWindows = read('main/panel-windows.js');
    assert.ok(!panelWindows.includes("kind === 'quickopen'") && !panelWindows.includes('plugins|quickopen|recorder'), '无 HTML 的 quickopen kind 不得复活');
  });

  test('源码中的 iconHtml 字面量必须全部命中单色 SVG，不允许 emoji fallback', () => {
    const files = [];
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'dist') walk(file);
        else if (entry.name.endsWith('.js')) files.push(file);
      }
    };
    walk(path.resolve('renderer'));
    const missing = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/iconHtml\(\s*(['"])(.*?)\1\s*\)/g)) if (!SVG_ICONS[match[2]]) missing.push(`${path.relative(process.cwd(), file)}:${match[2]}`);
    }
    assert.deepEqual(missing, []);
  });

  test('QuickNote 跟随应用主题而非只看系统明暗', () => {
    const html = read('renderer/quicknote.html');
    const preload = read('preload/quicknote-preload.js');
    const main = read('main/main.js');
    assert.ok(html.includes('styles/themes.css') && html.includes('mazzNote?.onTheme'));
    assert.ok(preload.includes('onTheme(callback)') && main.includes("wm.quickNote.webContents.send('mazz:event', { channel: 'theme:changed'"));
  });
});
