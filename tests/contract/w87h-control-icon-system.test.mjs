// W87h —— 全页面 Control Icon：未知图标 fail-closed、嵌套控件递归 SVG 化。
import { dom } from './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.HTMLElement = dom.window.HTMLElement;

const { iconHtml, normalizeIconToken, SVG_ICONS } = await import('../../renderer/lib/svg-icons.js');
const { normalizeControlIcons, installControlIconRuntime, findRawControlIcons } = await import('../../renderer/lib/control-icons.js');
const { showDomMenu } = await import('../../renderer/lib/dom-menu.js');
const { menus } = await import('../../renderer/core/menu-service.js');

const RAW_ICON = /[\p{Extended_Pictographic}\u2190-\u21FF\u2300-\u23FF\u2500-\u25FF\u2600-\u27BF\u2B00-\u2BFF]/u;

describe('W87h Control Icon System', () => {
  test('未知 emoji / variation selector fail-closed 为 currentColor SVG，不回落系统字形', () => {
    const unknown = iconHtml('🍅️');
    assert.match(unknown, /^<svg\b/);
    assert.match(unknown, /stroke="currentColor"/);
    assert.doesNotMatch(unknown, RAW_ICON);
    assert.equal(normalizeIconToken('⚙️'), '⚙');
  });

  test('按钮嵌套 span 与连续符号递归替换，文字标签保持不变', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <button id="factory"><span class="icon">🏭</span><span>智能创作台</span></button>
      <button id="run"><span>▶▶</span> 全部启动</button>
      <button id="plugin"><span>🍅</span> 专注计时</button>`;
    document.body.append(host);
    assert.equal(normalizeControlIcons(host), 3);
    assert.equal(host.querySelectorAll('svg.mz-ico').length, 3);
    assert.equal(findRawControlIcons(host).length, 0);
    assert.match(host.textContent, /智能创作台/);
    assert.match(host.textContent, /全部启动/);
    assert.match(host.textContent, /专注计时/);
    host.remove();
  });

  test('MutationObserver 兜底覆盖动态加入的嵌套控件', async () => {
    const stop = installControlIconRuntime(document);
    const button = document.createElement('button');
    button.innerHTML = '<span>🖥</span> 发送桌面快捷方式';
    document.body.append(button);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(button.querySelectorAll('svg.mz-ico').length, 1);
    assert.equal(findRawControlIcons(document).length, 0);
    stop();
    button.remove();
  });

  test('自绘菜单、data action 与 ARIA tab 也属于控件，不允许伪按钮漏回系统字形', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="mazz-menu-item">✓ 已选</div>
      <i data-a="close">✕</i>
      <div role="tab">▶ 工序</div>`;
    document.body.append(host);
    assert.equal(normalizeControlIcons(host), 3);
    assert.equal(host.querySelectorAll('svg.mz-ico').length, 3);
    assert.equal(findRawControlIcons(host).length, 0);
    assert.match(host.textContent, /已选/);
    assert.match(host.textContent, /工序/);
    host.remove();
  });

  test('两套 DOM 菜单 Escape 后归还焦点并拆除外点监听，不把键盘用户关进已删除节点', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = '触发菜单';
    document.body.append(trigger);
    trigger.focus();

    const localMenu = showDomMenu([{ label: '打开', fn() {} }], 0, 0);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.activeElement?.getAttribute('role'), 'menuitem');
    localMenu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(localMenu.isConnected, false);
    assert.equal(document.activeElement, trigger);

    menus.showDom([{ id: 'missing.test-command', label: '测试', enabled: true }], { x: 0, y: 0 });
    await new Promise(resolve => setTimeout(resolve, 0));
    const serviceMenu = document.querySelector('.mazz-menu');
    assert.equal(document.activeElement?.getAttribute('role'), 'menuitem');
    serviceMenu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(serviceMenu.isConnected, false);
    assert.equal(document.activeElement, trigger);

    const outsideMenu = showDomMenu([
      { label: '不可用', disabled: true },
      { label: '可用', fn() {} },
    ], 0, 0);
    await new Promise(resolve => setTimeout(resolve, 0));
    outsideMenu.querySelector('.disabled').dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    assert.equal(outsideMenu.isConnected, true, '菜单内按下不可用项不得消耗外点关闭监听');
    document.body.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    assert.equal(outsideMenu.isConnected, false, '后续真正外点仍必须关闭菜单');

    const menuServiceSource = fs.readFileSync(path.resolve('renderer/core/menu-service.js'), 'utf8');
    const domMenuSource = fs.readFileSync(path.resolve('renderer/lib/dom-menu.js'), 'utf8');
    assert.match(menuServiceSource, /removeEventListener\('mousedown', this\._domOutsideHandler\)/);
    assert.match(domMenuSource, /removeEventListener\('mousedown', outsideHandler\)/);
    assert.doesNotMatch(menuServiceSource, /addEventListener\('mousedown',[^;]+once/);
    assert.doesNotMatch(domMenuSource, /addEventListener\('mousedown',[^;]+once/);
    trigger.remove();
  });

  test('本波高风险字符全部具有专用 SVG，不依赖中性 fallback', () => {
    for (const token of ['🏭', '▶▶', '🖥', '⚙', '✎', '▣', '≡', '◫', '◈', '¶', '·', '↥', '⇥', '∑', '⊞', '⏎', '▗', '➕', '⧩', '🔄', '🕘', '🗜', '🪟']) {
      assert.ok(SVG_ICONS[token], `${token} 必须有专用 currentColor SVG`);
      assert.match(SVG_ICONS[token], /^<svg\b/);
    }
  });

  test('逐页 E2E 是正式脚本，并同时门禁 Paper/Ink、裸控件字形与 currentColor SVG', () => {
    const sweep = fs.readFileSync(path.resolve('tests/e2e/ui-page-sweep.mjs'), 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    assert.equal(pkg.scripts['test:w87:ui-sweep'], 'node tests/e2e/ui-page-sweep.mjs');
    assert.equal(pkg.scripts['test:w87:theme-legibility'], 'node tests/e2e/w87g-theme-legibility.mjs');
    assert.match(sweep, /'paper,ink'/);
    assert.match(sweep, /RAW_CONTROL_GLYPH/);
    assert.match(sweep, /CONTROL_SVG_NOT_CURRENTCOLOR/);
    assert.match(sweep, /CONTROL_ICON_SVG_MISSING/);
    assert.match(sweep, /CONTROL_ACCESSIBLE_NAME_MISSING/);
    assert.match(sweep, /NESTED_INTERACTIVE_CONTROL/);
    assert.match(sweep, /MODULES\.length \+ SIDEBAR_TABS\.length \+ RIBBON_PAGES\.length/);
    assert.match(sweep, /bv:captureVisibleHost/);
    assert.match(sweep, /NATIVE_SURFACE_CAPTURE_EMPTY[\s\S]*scene\.status = 'FAIL'/, 'Browser 原生帧缺失必须让逐页门 RED，不能降为 warning');
    assert.match(sweep, /NATIVE_HOME_PLACEHOLDER_CONTRAST/, 'Browser 自有主页必须经 bv:js 审计 placeholder 对比度，不能只看主壳 DOM');
  });

  test('源码中的直接 iconHtml 字面量全部登记，不允许悄悄落中性占位', () => {
    const root = path.resolve('renderer');
    const files = [];
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'dist') walk(full); }
        else if (/\.(?:js|html)$/.test(entry.name)) files.push(full);
      }
    };
    walk(root);
    const missing = [];
    const literal = /iconHtml\(\s*(['"])(.*?)\1\s*\)/g;
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(literal)) {
        const token = normalizeIconToken(match[2]);
        if (token && !SVG_ICONS[token]) missing.push(`${path.relative(root, file)}:${token}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  test('高频模块的动态控件不再用字体字形，伪按钮具备键盘契约', () => {
    const read = rel => fs.readFileSync(path.resolve(rel), 'utf8');
    const files = [
      'renderer/lib/annotate.js',
      'renderer/modules/draw/index.js',
      'renderer/modules/notes/index.js',
      'renderer/modules/viewer/player.js',
      'renderer/modules/markdown/calc-block.js',
      'renderer/modules/factory/desk.js',
    ];
    const rawDynamicSetter = /(?:textContent|innerText)\s*=\s*(['"`])[^'"`]*(?:«|»|▾|▸|▶|■|●|←|✓|○)[^'"`]*\1/;
    for (const file of files) assert.doesNotMatch(read(file), rawDynamicSetter, `${file} 不得恢复动态裸字形`);

    const notes = read('renderer/modules/notes/index.js');
    assert.match(notes, /class="notes-item[^\n]+role="button" tabindex="0"/);
    assert.match(notes, /event\.key !== 'Enter' && event\.key !== ' '/);

    const player = read('renderer/modules/viewer/player.js');
    assert.match(player, /class="mz-ml-dir" role="button" tabindex="0" aria-expanded=/);
    assert.match(player, /class="mz-li mz-ml-item" role="button" tabindex="0"/);
    assert.match(player, /mz-ml-caret'\)\.innerHTML = iconHtml/);

    const desk = read('renderer/modules/factory/desk.js');
    assert.match(desk, /role="tab" aria-selected="false" tabindex="-1"/);
    assert.match(desk, /btn\.setAttribute\('aria-selected', String\(selected\)\)/);
    assert.match(desk, /event\.key === 'ArrowRight'/);
  });
});
