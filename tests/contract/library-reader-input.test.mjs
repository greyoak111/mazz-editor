import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { readFileSync } from 'node:fs';
import {
  createReaderInput, isReaderEditable, readerCommandForKey,
} from '../../renderer/modules/library/reader-input.js';

function key(target, name, init = {}) {
  const event = new window.KeyboardEvent('keydown', {
    key: name, bubbles: true, cancelable: true, ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function wheel(target, init = {}) {
  const event = new window.WheelEvent('wheel', {
    bubbles: true, cancelable: true, ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function pointer(target, type, props) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  for (const [name, value] of Object.entries(props)) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  target.dispatchEvent(event);
  return event;
}

describe('Library ReaderInputController', () => {
  test('键盘被翻译为稳定语义，左右键随阅读方向反转', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const commands = [];
    let direction = 'ltr';
    const input = createReaderInput({ host, getDirection: () => direction, onCommand: command => commands.push(command) });

    for (const name of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End', 'Escape']) {
      const event = key(host, name);
      assert.equal(event.defaultPrevented, true, `${name} 应由阅读器消费`);
    }
    key(host, ' ', { shiftKey: true });
    key(host, 'f', { ctrlKey: true });
    assert.deepEqual(commands, [
      'next', 'previous', 'next', 'previous', 'next', 'previous', 'next',
      'first', 'last', 'escape', 'previous', 'search',
    ]);

    direction = 'rtl';
    key(host, 'ArrowRight');
    key(host, 'ArrowLeft');
    assert.deepEqual(commands.slice(-2), ['previous', 'next']);
    input.dispose();
    host.remove();
  });

  test('宿主与 iframe 文档同权；表单、可编辑区和组合输入不抢键', () => {
    const host = document.createElement('div');
    const frame = document.createElement('iframe');
    const edit = document.createElement('textarea');
    const rich = document.createElement('div'); rich.setAttribute('contenteditable', 'true');
    host.append(edit, rich);
    document.body.append(host, frame);
    const commands = [];
    const input = createReaderInput({ host, frame, onCommand: command => commands.push(command) });

    key(host, 'PageDown');
    key(frame.contentDocument, 'PageDown');
    const a = key(edit, 'PageDown');
    const b = key(rich, 'ArrowRight');
    const composing = key(host, 'ArrowRight', { isComposing: true });
    assert.deepEqual(commands, ['next', 'next']);
    assert.equal(a.defaultPrevented, false);
    assert.equal(b.defaultPrevented, false);
    assert.equal(composing.defaultPrevented, false);
    assert.equal(isReaderEditable(edit), true);
    assert.equal(readerCommandForKey(a), null);
    assert.equal(input.attachedCount, 2, 'host 与 frame document 各一份监听');

    input.dispose();
    host.remove(); frame.remove();
  });

  test('书架焦点显式交接到 iframe 正文；guard 拒绝后不得从工具栏抢回', async () => {
    const host = document.createElement('div');
    const fallback = document.createElement('div');
    const toolbar = document.createElement('button');
    const frame = document.createElement('iframe');
    host.append(fallback, toolbar);
    document.body.append(host, frame);
    const input = createReaderInput({ host, frame });

    const shelfCard = document.createElement('div');
    shelfCard.tabIndex = 0;
    document.body.appendChild(shelfCard);
    shelfCard.focus();
    const focused = input.requestFocus({
      frame,
      fallback,
      guard: () => document.activeElement === shelfCard || document.activeElement === frame,
    });
    assert.equal(focused, true, '可用的同源阅读帧应同步接收焦点');
    assert.equal(document.activeElement, frame);
    assert.equal(frame.contentDocument.activeElement, frame.contentDocument.body);
    assert.equal(frame.contentDocument.hasFocus(), true);
    assert.equal(input.focusPending, false);

    toolbar.focus();
    const blocked = input.requestFocus({
      frame,
      fallback,
      guard: () => document.activeElement !== toolbar,
    });
    await Promise.resolve();
    assert.equal(blocked, false);
    assert.equal(document.activeElement, toolbar, '用户已选工具栏时不得被迟到 iframe load/retry 抢焦');
    assert.equal(input.focusPending, false);

    const lateFrame = document.createElement('iframe');
    let generationAlive = true;
    shelfCard.focus();
    const pending = input.requestFocus({
      frame: lateFrame,
      fallback,
      guard: () => generationAlive,
    });
    assert.equal(pending, false);
    assert.equal(input.focusPending, true, '未 ready 的 frame 应等待受 guard 约束的重试');
    toolbar.focus();
    generationAlive = false;
    await Promise.resolve();
    assert.equal(input.focusPending, false);
    assert.equal(document.activeElement, toolbar, '失效代际的 microtask/load 重试不得抢焦');

    input.dispose();
    shelfCard.remove(); host.remove(); frame.remove();
  });

  test('滚轮有累计阈值和方向语义，修饰键缩放不被阅读器劫持', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const commands = [];
    let direction = 'ltr';
    const input = createReaderInput({
      host, getDirection: () => direction, wheelThreshold: 24, wheelCooldownMs: 0,
      onCommand: command => commands.push(command),
    });

    const small = wheel(host, { deltaY: 11 });
    assert.equal(small.defaultPrevented, false, '阈值前必须允许自然滚动');
    const accumulated = wheel(host, { deltaY: 14 });
    assert.equal(accumulated.defaultPrevented, true);
    wheel(host, { deltaY: -30 });
    direction = 'rtl';
    wheel(host, { deltaX: -40, deltaY: 1 });
    const ctrl = wheel(host, { deltaY: -80, ctrlKey: true });
    assert.deepEqual(commands, ['next', 'previous', 'next']);
    assert.equal(ctrl.defaultPrevented, false, 'Ctrl/Meta+wheel 留给字号/图像缩放');
    input.dispose(); host.remove();
  });

  test('指针滑动映射前后页；重复 attach 不重挂，dispose 后完全静默', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const commands = [];
    let direction = 'ltr';
    const input = createReaderInput({
      host, getDirection: () => direction, swipeThreshold: 50,
      onCommand: command => commands.push(command),
    });
    input.attach(host); // no-op: 不得产生第二套监听
    pointer(host, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 160, clientY: 100, button: 0, isPrimary: true });
    const left = pointer(host, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 80, clientY: 104 });
    assert.equal(left.defaultPrevented, true);
    direction = 'rtl';
    pointer(host, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 160, clientY: 100, button: 0, isPrimary: true });
    pointer(host, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 80, clientY: 100 });
    pointer(host, 'pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 100, clientY: 150, button: 0, isPrimary: true });
    pointer(host, 'pointerup', { pointerId: 3, pointerType: 'touch', clientX: 101, clientY: 70 });
    assert.deepEqual(commands, ['next', 'previous', 'next']);
    assert.equal(input.attachedCount, 1);

    pointer(host, 'pointerdown', { pointerId: 9, pointerType: 'mouse', clientX: 160, clientY: 100, button: 0, isPrimary: true });
    const selectionDrag = pointer(host, 'pointerup', { pointerId: 9, pointerType: 'mouse', clientX: 20, clientY: 100 });
    assert.equal(selectionDrag.defaultPrevented, false, '鼠标拖选正文不得误翻页');
    assert.deepEqual(commands, ['next', 'previous', 'next']);

    input.dispose();
    key(host, 'PageDown');
    pointer(host, 'pointerdown', { pointerId: 4, clientX: 100, clientY: 100, button: 0, isPrimary: true });
    pointer(host, 'pointerup', { pointerId: 4, clientX: 0, clientY: 100 });
    assert.deepEqual(commands, ['next', 'previous', 'next']);
    assert.equal(input.attachedCount, 0);
    input.dispose(); // idempotent
    host.remove();
  });

  test('handler 明确返回 false 时保留浏览器默认行为', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const input = createReaderInput({ host, onCommand: () => false });
    const event = key(host, 'PageDown');
    assert.equal(event.defaultPrevented, false);
    input.dispose(); host.remove();
  });

  test('W88 主链将同一语义控制器接到 reader host 与每代 iframe，并保留旧滚轮', () => {
    const source = readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');
    assert.match(source, /createReaderInput\(\{[\s\S]*?host:\s*readerView,[\s\S]*?wheel:\s*false/);
    assert.match(source, /onCommand:\s*handleReaderCommand/);
    assert.match(source, /readerInput\.attachFrame\(f\)/);
    assert.match(source, /readerInput\.detachFrame\(frame\)/);
    assert.match(source, /readerInput\.requestFocus\(\{/);
    assert.match(source, /ctl\._openGen\s*!==\s*generation/);
    assert.match(source, /function\s+openBookForUser\(/);
    assert.match(source, /mayRestoreFocus[\s\S]*?shelfRenderer\.focusKey/);
    assert.match(source, /readerInput\.dispose\(\)/);
    for (const command of ['next', 'previous', 'search', 'escape', 'first', 'last']) {
      assert.ok(source.includes(`command === '${command}'`), `主链必须落实 ${command} 语义`);
    }
    assert.ok(source.includes("d.addEventListener('wheel', (e) => onReaderWheel(e, true)"), '原精细滚轮桥不能被新输入层替换');
  });
});
