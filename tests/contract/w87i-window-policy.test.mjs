// W87i —— caption geometry, PanelWindow resize ownership and Construct frame contract.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');
const titlebar = read('renderer/shell/titlebar.js');
const base = read('renderer/styles/base.css');
const convergence = read('renderer/styles/convergence.css');
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
    assert.match(base, /\.titlebar \.tb-btn \{[^}]*width:\s*46px;[^}]*height:\s*100%[^}]*flex:\s*0 0 46px/s);
    assert.match(base, /\.tb-caption-icon \{[^}]*width:\s*12px;[^}]*height:\s*12px/);
    assert.match(convergence, /\.titlebar \.tb-caption-icon \{ stroke-width:\s*1\.15; \}/,
      '后载通用 button svg 规则不得加粗 Windows caption 光学图元');
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
