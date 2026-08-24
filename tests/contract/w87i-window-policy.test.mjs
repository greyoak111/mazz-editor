// W87i —— caption geometry, PanelWindow resize ownership and Construct frame contract.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { systemIntegratedUiUsesDarkColors, trayAssetName } = require('../../main/system-ui-theme.js');

const read = file => fs.readFileSync(path.resolve(file), 'utf8');
const titlebar = read('renderer/shell/titlebar.js');
const base = read('renderer/styles/base.css');
const convergence = read('renderer/styles/convergence.css');
const windowManager = read('main/window-manager.js');
const mainProcess = read('main/main.js');
const tray = read('main/tray-service.js');
const preload = read('preload/bridge.js');
const panels = read('main/panel-windows.js');
const panelRuntime = read('renderer/panels/panel-runtime.js');
const panelCss = read('renderer/panels/panel-shared.css');
const themes = read('renderer/styles/themes.css');
const themeStore = read('renderer/lib/theme-store.js');
const shell = read('renderer/shell/shell.js');
const ribbon = read('renderer/shell/ribbon.js');

describe('W87i Window and Panel policy', () => {
  test('Windows caption controls use dedicated optical SVGs and fixed hit boxes', () => {
    assert.doesNotMatch(titlebar, /import \{ iconHtml \}/, 'caption controls must not use the generic 24px semantic icon map');
    assert.match(titlebar, /class="tb-caption-icon" viewBox="0 0 12 12"/);
    assert.match(titlebar, /captionIcon\('min'\)[\s\S]*captionIcon\('max'\)[\s\S]*captionIcon\('close'\)/);
    assert.match(titlebar, /restore:\s*'<path/);
    assert.doesNotMatch(titlebar, /data-act="(?:min|max|close)"[^>]*>\s*[^<$\s]/, 'caption must never regress to font glyphs');
    assert.match(base, /\.titlebar \.tb-btn \{[^}]*width:\s*46px;[^}]*height:\s*36px[^}]*flex:\s*0 0 46px/s);
    assert.match(base, /\.tb-caption-icon \{[^}]*width:\s*12px;[^}]*height:\s*12px/);
    assert.match(convergence, /\.titlebar \.tb-caption-icon \{ stroke-width:\s*1; \}/,
      '后载通用 button svg 规则不得加粗 Windows caption 光学图元');
    assert.match(base, /\.titlebar \.tb-btn:hover \{[^}]*color-mix/);
    assert.match(base, /\.titlebar \.tb-btn:active \{[^}]*color-mix/);
    assert.match(base, /\.titlebar \.tb-btn\.close:hover \{[^}]*#e81123[^}]*#fff/);
    assert.match(base, /\.titlebar \.tb-btn\.close:active \{[^}]*#b50d1b[^}]*#fff/);
  });

  test('main/child remove native overlay so the dedicated SVG caption is never double-painted', () => {
    assert.equal((windowManager.match(/titleBarOverlay:\s*false/g) || []).length, 2,
      'main and child BrowserWindow must both disable native titleBarOverlay');
    assert.doesNotMatch(windowManager, /symbolColor|titleBarOverlay:\s*process\.platform/);
    assert.equal((windowManager.match(/titleBarStyle:\s*process\.platform === 'darwin' \? 'hiddenInset' : 'hidden'/g) || []).length, 2);
  });

  test('caption follows CSS surface contrast and maximize/restore state without raw symbols', () => {
    assert.match(convergence, /\[data-theme="paper"\] \.titlebar, \[data-theme="sand"\] \.titlebar \{ --tb-caption-fg:\s*#1f2937; \}/);
    for (const theme of ['ink', 'indigo', 'moss', 'genshin']) {
      assert.match(convergence, new RegExp(`\\[data-theme="${theme}"\\] \\.titlebar`), `${theme} caption contrast token missing`);
    }
    assert.match(convergence, /\[data-theme="construct"\] \.titlebar, \[data-theme="custom"\] \.titlebar,[\s\S]*\[data-theme-structure="hard-edge"\] \.titlebar \{ --tb-caption-fg:\s*var\(--bg\); \}/);
    assert.doesNotMatch(convergence, /\[data-theme\^="pack:"\][^}]*--tb-caption-fg:\s*#fff/,
      'light theme packs must inherit their own foreground instead of being forced white');
    assert.match(convergence, /\.titlebar \.tb-btn \{ color:\s*var\(--tb-caption-fg\) !important; \}/);
    assert.match(titlebar, /dataset\.windowState = maximized \? 'maximized' : 'normal'/);
    assert.match(titlebar, /captionIcon\(maximized \? 'restore' : 'max'\)/);
    assert.match(titlebar, /window\.mazz\?\.on\?\.\('window:maximize-state', syncMaximized\)/);
    assert.match(windowManager, /win\.on\('maximize', emitMaximizeState\)[\s\S]*win\.on\('unmaximize', emitMaximizeState\)[\s\S]*win\.on\('restore', emitMaximizeState\)/);
    assert.ok(preload.includes("'window:maximize-state'"), 'maximize state event must cross the preload allowlist');
  });

  test('caption maximize button changes to restore and external state changes cannot revert incorrectly', async () => {
    const originalMazz = window.mazz;
    const listeners = new Map();
    const invocations = [];
    window.mazz = {
      platform: 'win32',
      invoke: async channel => {
        invocations.push(channel);
        if (channel === 'window:isMaximized') return false;
        if (channel === 'window:toggleMaximize') return true;
        return true;
      },
      on: (channel, callback) => {
        listeners.set(channel, callback);
        return () => listeners.delete(channel);
      },
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    const { createTitlebar } = await import('../../renderer/shell/titlebar.js');
    const api = createTitlebar(root);
    try {
      await Promise.resolve();
      const max = root.querySelector('[data-act=max]');
      assert.equal(max.dataset.windowState, 'normal');
      assert.equal(max.getAttribute('aria-label'), '最大化');
      assert.match(max.innerHTML, /<rect/);

      max.click();
      await Promise.resolve();
      assert.equal(max.dataset.windowState, 'maximized');
      assert.equal(max.getAttribute('aria-label'), '还原');
      assert.match(max.innerHTML, /M3\.5 4\.5h6v6/);
      assert.ok(invocations.includes('window:toggleMaximize'));

      listeners.get('window:maximize-state')?.({ maximized: false });
      assert.equal(max.dataset.windowState, 'normal');
      assert.equal(max.getAttribute('aria-label'), '最大化');
      assert.match(max.innerHTML, /<rect/);
    } finally {
      api.destroy();
      assert.equal(listeners.has('window:maximize-state'), false, 'destroy must unregister maximize listener');
      document.body.classList.remove('platform-other');
      root.remove();
      window.mazz = originalMazz;
    }
  });

  test('system-integrated theme selects visible tray asset and refresh listener is reusable', () => {
    const forcedAppOpposite = { shouldUseDarkColorsForSystemIntegratedUI: true, shouldUseDarkColors: false };
    assert.equal(systemIntegratedUiUsesDarkColors(forcedAppOpposite, 'win32'), true,
      'Windows integrated UI must win over the app/native themeSource');
    assert.equal(trayAssetName(forcedAppOpposite, 'win32'), 'tray-light.png', 'dark taskbar needs white tray glyph');
    assert.equal(trayAssetName({ shouldUseDarkColorsForSystemIntegratedUI: false, shouldUseDarkColors: true }, 'win32'), 'tray-dark.png',
      'light taskbar needs dark tray glyph');
    assert.equal(trayAssetName({ shouldUseDarkColors: false }, 'win32'), 'tray-light.png',
      'missing integrated signal must fail closed to white on Windows');
    assert.match(tray, /trayAssetName\(nativeTheme, process\.platform\)/);
    assert.match(tray, /nativeTheme\.on\('updated', this\.onNativeThemeUpdated\)/);
    assert.match(tray, /nativeTheme\.removeListener\('updated', this\.onNativeThemeUpdated\)/);
    assert.match(tray, /themeListenerAttached = false[\s\S]*if \(!this\.themeListenerAttached\)[\s\S]*this\.themeListenerAttached = true/);
    assert.match(mainProcess, /app\.on\('will-quit',[\s\S]*?tray\.destroy\(\)/,
      'tray may release only inside the post-renderer durable will-quit gate');
    assert.doesNotMatch(mainProcess, /app\.on\('before-quit', \(\) => tray\.destroy\(\)\)/,
      'a vetoed dirty close must not strand the live app without its tray');
  });

  test('fixed utilities cannot be stretched while workbench panels retain resize ownership', () => {
    for (const kind of ['palette', 'shortcuts', 'agreement', 'bookmark', 'newfile', 'picklist', 'ctxmenu']) {
      assert.match(panels, new RegExp(`${kind}: 'fixed'`), `${kind} must be fixed`);
    }
    for (const kind of ['help', 'settings', 'dockfloat', 'factorycfg', 'archive', 'fpreview', 'fedit']) {
      assert.match(panels, new RegExp(`${kind}: 'workbench'`), `${kind} must remain resizable`);
    }
    assert.match(panels, /resizable:\s*resizablePanel[\s\S]*maximizable:\s*resizablePanel[\s\S]*thickFrame:\s*resizablePanel/);
    assert.match(panels, /maxWidth:\s*resizablePanel \? undefined : panelWidth/);
    assert.match(panels, /resize=\$\{resizeMode\}/, 'native policy must be exposed to panel runtime');
    assert.match(panelRuntime, /dataset\.panelResize = panelResize/);
    assert.match(panelCss, /data-panel-resize="fixed"\] #p-max \{ display:\s*none/);
  });

  test('Construct and custom Construct packs project square native panel geometry', () => {
    assert.match(themes, /--panel-corner-radius:\s*12px/);
    assert.match(themes, /\[data-theme="construct"\][\s\S]*--panel-corner-radius:\s*0px/);
    assert.match(themes, /\[data-theme="custom"\]\s*\{[\s\S]*--panel-corner-radius:\s*0px/);
    assert.match(panelCss, /border-radius:\s*var\(--panel-corner-radius, 12px\) !important/);
    assert.doesNotMatch(themeStore, /selectorText !== src/, 'pack structure cloning must include the root geometry rule');
    assert.match(shell, /'panel-corner-radius', 'panel-window-shadow'/, 'native panel theme snapshot must carry structural tokens');
  });

  test('Help and Agreement are neutral peer text routes', () => {
    assert.match(ribbon, /agree\.className = 'ribbon-tab';[\s\S]*agree\.textContent = '协议'/);
    assert.match(ribbon, /help\.className = 'ribbon-tab';[\s\S]*help\.textContent = '帮助'/);
    assert.doesNotMatch(ribbon, /ribbon-help-btn|help\.innerHTML/);
    assert.doesNotMatch(base, /\.ribbon-help-btn/);
    assert.doesNotMatch(themes, /\.ribbon-help-btn/);
  });

  test('async theme restoration is last-intent-wins across every await boundary', () => {
    const segment = shell.slice(shell.indexOf('setTheme(id)'), shell.indexOf('/** 全部主题'));
    assert.match(segment, /const revision = \+\+this\._themeRevision/);
    assert.ok((segment.match(/if \(revision !== this\._themeRevision\) return;/g) || []).length >= 4,
      'pack import/list and custom import/restore must all reject stale completion');
  });
});
