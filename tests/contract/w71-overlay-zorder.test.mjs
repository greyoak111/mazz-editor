// W71：跨 WebContentsView 浮层的最小架构守卫
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';

const read = file => fs.readFileSync(file, 'utf8');

describe('W71 Overlay / Z-order guard', () => {
  test('首启协议与正式上下文菜单走原生子窗，不依赖 DOM z-index', () => {
    const agreement = read('renderer/lib/agreement.js');
    const menu = read('renderer/core/menu-service.js');
    const panels = read('main/panel-windows.js');
    assert.ok(agreement.indexOf("kind: 'agreement'") < agreement.indexOf("const m = modal(c.title)"), 'Electron 分支必须先于 DOM fallback');
    assert.ok(menu.includes("kind: 'ctxmenu'"), '正式上下文菜单必须走 ctxmenu PanelWindow');
    assert.ok(panels.includes('parent: parent || undefined'), 'PanelWindow 必须保持主窗 parent 关系');
  });

  test('Browser 前台信息确认不落回会被原生 Surface 遮挡的 DOM modal', () => {
    const browser = read('renderer/modules/browser/index.js');
    const marker = browser.indexOf("title: '局域网临时分享'");
    assert.ok(marker > 0);
    const block = browser.slice(marker - 260, marker + 900);
    assert.ok(block.includes("if (isElectron())") && block.includes("'dialog:confirm'"), 'Electron 分享确认必须走 OS 对话框');
    assert.ok(block.includes('else {') && block.includes("modal('局域网临时分享')"), 'DOM modal 只保留网页预览 fallback');
  });

  test('拖拽预览先 cloak WebContentsView，清理后恢复同一 Surface', () => {
    const shell = read('renderer/shell/shell.js');
    assert.ok(shell.includes('bctl._dragCloak = !!on') && shell.includes('bctl.__sync?.()'));
    assert.ok(shell.includes('dragCloak(true)') && shell.includes('dragCloak(false)'));
    assert.ok(shell.includes('pointerup') && shell.includes('armDog()'), 'pointerup 与 watchdog 必须共同兜底');
  });
});
