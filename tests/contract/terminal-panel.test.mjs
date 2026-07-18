// tests/contract/terminal-panel.test.mjs —— 终端面板：最后一个终端关闭时面板正确收敛
import { register } from 'node:module';
register('../css-hooks.mjs', import.meta.url); // .css import → 空文本（esbuild text loader 的测试替身）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

window.mazz = { invoke: async () => ({}), on: () => {} };

const { TerminalPanel } = await import('../../renderer/modules/code/terminal-view.js');

/** 手工塞入假终端（绕过 xterm/主进程，仅测面板状态机） */
function fakeTerm(panel, id, title) {
  const wrap = document.createElement('div');
  wrap.className = 'term-view';
  wrap.dataset.termId = id;
  panel.bodyEl.appendChild(wrap);
  panel.terms.set(id, { id, title, xterm: { dispose() {}, write() {}, clear() {}, hasSelection: () => false }, fitAddon: { fit() {} } });
  panel.activeId = id;
  panel.renderTabs();
}

describe('终端面板：关闭收敛', () => {
  test('叉掉最后一个终端：activeId 清空、标签栏清空、onCountChange(0) 触发', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let lastCount = -1;
    const panel = new TerminalPanel(container, { onCountChange: (n) => { lastCount = n; } });
    fakeTerm(panel, 'term-1', 'powershell.exe');
    fakeTerm(panel, 'term-2', 'powershell.exe');
    assert.equal(panel.count(), 2);
    // 关掉一个：还剩一个，activeId 切换
    panel.kill('term-1');
    assert.equal(panel.count(), 1);
    assert.equal(panel.activeId, 'term-2');
    assert.equal(lastCount, 1);
    assert.equal(panel.tabsEl.querySelectorAll('.term-tab').length, 1, '标签栏应剩一个');
    // 叉掉最后一个：全空
    panel.kill('term-2');
    assert.equal(panel.count(), 0);
    assert.equal(panel.activeId, null, 'activeId 应清空');
    assert.equal(lastCount, 0, 'onCountChange 应以 0 回调（宿主据此收起面板）');
    assert.equal(panel.tabsEl.querySelectorAll('.term-tab').length, 0, '死标签应清掉');
    assert.ok(!panel.bodyEl.querySelector('[data-term-id]'), '视图应清空');
    container.remove();
  });

  test('kill 不存在的 id 不抛错、不触发回调', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let calls = 0;
    const panel = new TerminalPanel(container, { onCountChange: () => { calls++; } });
    panel.kill('term-404');
    assert.equal(calls, 0);
    container.remove();
  });
});
