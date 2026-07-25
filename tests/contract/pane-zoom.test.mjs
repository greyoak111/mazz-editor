// tests/contract/pane-zoom.test.mjs —— Ctrl+滚轮 / 双指捏合缩放契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const { installPaneZoom, paneZoomOf, setPaneZoomListener, resetAllPaneZooms } = await import('../../renderer/shell/pane-zoom.js');

function mkPane() {
  const pane = document.createElement('div');
  pane.className = 'pane';
  pane.innerHTML = '<div class="tabbar"></div><div class="editor-area"></div>';
  document.body.appendChild(pane);
  return pane;
}
function wheel(target, { ctrl = true, deltaY = -100 } = {}) {
  const ev = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: ctrl, deltaY });
  target.dispatchEvent(ev);
  return ev;
}
function ptr(type, target, { id, x, y }) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  ev.pointerId = id; ev.pointerType = 'touch'; ev.clientX = x; ev.clientY = y;
  (target || document.body).dispatchEvent(ev);
}

installPaneZoom();

describe('Ctrl+滚轮缩放', () => {
  test('模块窗格内：上滚放大/下滚缩小；不带 Ctrl 不缩放', () => {
    const pane = mkPane();
    const area = pane.querySelector('.editor-area');
    wheel(area, { deltaY: -100 });
    assert.equal(paneZoomOf(area), 1.1);
    wheel(area, { deltaY: -100 });
    assert.equal(paneZoomOf(area), 1.2);
    wheel(area, { deltaY: 100 });
    assert.equal(paneZoomOf(area), 1.1);
    wheel(area, { ctrl: false, deltaY: -100 });
    assert.equal(paneZoomOf(area), 1.1); // 无 Ctrl 不变
  });

  test('上下限夹紧（0.5–2）', () => {
    const pane = mkPane();
    const area = pane.querySelector('.editor-area');
    for (let i = 0; i < 30; i++) wheel(area, { deltaY: -100 });
    assert.equal(paneZoomOf(area), 2);
    for (let i = 0; i < 30; i++) wheel(area, { deltaY: 100 });
    assert.equal(paneZoomOf(area), 0.5);
  });

  test('固定 UI 排除：面板/侧栏/标签栏上不缩放', () => {
    const pane = mkPane();
    const area = pane.querySelector('.editor-area');
    // 命令面板遮罩
    const mask = document.createElement('div');
    mask.className = 'mazz-palette-mask';
    pane.querySelector('.editor-area').appendChild(mask);
    wheel(mask, { deltaY: -100 });
    assert.equal(paneZoomOf(area), 1);
    // 标签栏
    wheel(pane.querySelector('.tabbar'), { deltaY: -100 });
    assert.equal(paneZoomOf(area), 1);
    // 右键菜单
    const menu = document.createElement('div');
    menu.className = 'mazz-menu';
    area.appendChild(menu);
    wheel(menu, { deltaY: -100 });
    assert.equal(paneZoomOf(area), 1);
  });

  test('缩放监听器触发（状态栏联动）+ 一键重置', () => {
    const pane = mkPane();
    const area = pane.querySelector('.editor-area');
    let got = null;
    setPaneZoomListener((a, z) => { got = { a, z }; });
    wheel(area, { deltaY: -100 });
    assert.equal(got.a, area);
    assert.equal(got.z, 1.1);
    resetAllPaneZooms();
    assert.equal(paneZoomOf(area), 1);
    assert.equal(area.style.zoom, '');
    setPaneZoomListener(null);
  });

  test('阻止默认（防浏览器整页缩放）', () => {
    const pane = mkPane();
    const area = pane.querySelector('.editor-area');
    const ev = wheel(area, { deltaY: -100 });
    assert.equal(ev.defaultPrevented, true);
  });
});

describe('双指捏合缩放', () => {
  test('捏大放大、捏小缩小；抬起一指即停', () => {
    const pane = mkPane();
    const area = pane.querySelector('.editor-area');
    const content = document.createElement('div');
    area.appendChild(content);
    // 双指落下：间距 100
    ptr('pointerdown', content, { id: 1, x: 100, y: 100 });
    ptr('pointerdown', content, { id: 2, x: 200, y: 100 });
    // 撑开到 200
    ptr('pointermove', content, { id: 2, x: 300, y: 100 });
    assert.equal(paneZoomOf(area), 2);
    // 抬一指后再动不影响
    ptr('pointerup', content, { id: 2, x: 300, y: 100 });
    ptr('pointermove', content, { id: 1, x: 50, y: 100 });
    assert.equal(paneZoomOf(area), 2);
  });

  test('固定 UI 上起手势不生效', () => {
    const pane = mkPane();
    const area = pane.querySelector('.editor-area');
    const mask = document.createElement('div');
    mask.className = 'mazz-palette-mask';
    area.appendChild(mask);
    ptr('pointerdown', mask, { id: 1, x: 100, y: 100 });
    ptr('pointerdown', mask, { id: 2, x: 200, y: 100 });
    ptr('pointermove', mask, { id: 2, x: 300, y: 100 });
    assert.equal(paneZoomOf(area), 1);
  });
});
