// W59f 终端栏拉伸契约：窗格级持久化、两行~60% 限位、双击复位
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('W59f 终端栏上缘拉伸', () => {
  test('grip、上下拖动与双击复位全部接线', () => {
    const src = read('renderer/modules/code/index.js');
    assert.ok(src.includes('class="code-term-grip"'), '终端上缘 grip 必须在');
    assert.ok(src.includes("addEventListener('pointerdown'"), 'grip 必须走 pointer 拖动');
    assert.ok(src.includes('startHeight + startY - ev.clientY'), '向上拖必须增高');
    assert.ok(src.includes("addEventListener('dblclick'"), '双击复位必须在');
    assert.ok(src.includes('TERMINAL_DEFAULT_HEIGHT, { persist: true }'), '双击必须恢复默认并持久化');
  });

  test('两行下限、60% 上限与窗格级设置键钉死', () => {
    const src = read('renderer/modules/code/index.js');
    assert.ok(src.includes('const TERMINAL_MIN_HEIGHT = 72'), '下限必须约两行');
    assert.ok(src.includes('const TERMINAL_MAX_RATIO = 0.6'), '上限必须为代码区 60%');
    assert.ok(src.includes("container.closest('.pane')?.dataset.paneId"), '高度归属必须取当前窗格');
    assert.ok(src.includes('code.terminalHeight.${paneId()}'), '设置键必须按窗格分仓');
    assert.ok(src.includes("invoke('settings:get'") && src.includes("invoke('settings:set'"), '重开恢复与松手落盘双线必须齐');
  });

  test('拖动同时重排 Monaco 与 xterm，关闭最后终端隐藏 grip', () => {
    const src = read('renderer/modules/code/index.js');
    assert.ok(src.includes('ctl.editor?.layout?.()'), 'Monaco 必须跟随拉伸布局');
    assert.ok(src.includes('ctl.terminal?.resize()'), 'xterm 必须跟随拉伸 fit');
    assert.ok(src.includes('if (n === 0) setTerminalOpen(false)'), '最后终端关闭必须连 grip 一起收起');
    const panes = read('renderer/shell/panes.js');
    assert.ok(panes.includes('this.el.dataset.paneId = this.id'), '窗格 DOM 必须暴露稳定 ID');
  });

  test('消费 CSS 提供可见热区和拖动禁过渡态', () => {
    const css = read('renderer/styles/base.css');
    assert.ok(css.includes('.code-term-grip'), '主界面真实加载 CSS 必须有 grip');
    assert.ok(css.includes('cursor:ns-resize'), '热区必须给上下拉伸光标');
    assert.ok(css.includes('.code-root.term-resizing .code-bottom { transition:none; }'), '拖动时高度过渡必须关闭');
  });
});
