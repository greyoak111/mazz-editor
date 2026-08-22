import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="s"></div></body>', { url: 'https://mazz.local/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  requestAnimationFrame: callback => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: clearTimeout,
  ResizeObserver: class {
    constructor(callback) { this.callback = callback; this.target = null; }
    observe(target) { this.target = target; target.__shelfResizeObserver = this; }
    disconnect() { if (this.target?.__shelfResizeObserver === this) delete this.target.__shelfResizeObserver; this.target = null; }
    trigger() { this.callback?.([{ target: this.target }], this); }
  },
});

const { createLibraryShelfView } = await import('../../renderer/modules/library/shelf-view.js');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function item(index, patch = {}) {
  const id = `book-${index}`;
  return {
    key: `id:${id}`,
    book: {
      id,
      title: `书籍 ${index}`,
      author: `作者 ${index}`,
      category: '未分类',
      format: 'epub',
      cover: '',
      ...patch,
    },
    progress: { status: index ? 'reading' : 'unread', ratio: index / 100 },
  };
}

function sizedHost(width = 720, height = 500) {
  const host = document.createElement('div');
  Object.defineProperties(host, {
    clientWidth: { configurable: true, writable: true, value: width },
    clientHeight: { configurable: true, value: height },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });
  document.body.replaceChildren(host);
  return host;
}

await test('metadata uses text nodes and cannot inject executable markup', () => {
  const host = sizedHost();
  const view = createLibraryShelfView({ host });
  view.update({ items: [item(1, { title: '<img src=x onerror="globalThis.pwned=1">', author: '<svg onload=alert(1)>' })] });
  assert.equal(host.querySelectorAll('.lib-card-title img,.lib-card-author svg').length, 0);
  assert.match(host.querySelector('.lib-card-title').textContent, /<img/);
  assert.equal(globalThis.pwned, undefined);
  view.destroy();
});

await test('large shelves retain a bounded card DOM window', () => {
  const host = sizedHost(720, 500);
  const view = createLibraryShelfView({ host, virtualThreshold: 160 });
  view.update({ items: Array.from({ length: 1000 }, (_, index) => item(index)) });
  const first = view.metrics;
  const overlap = new Map([...host.querySelectorAll('.lib-card')].map(card => [card.dataset.id, card]));
  assert.equal(first.total, 1000);
  assert.ok(first.rendered > 0 && first.rendered < 80, JSON.stringify(first));
  host.scrollTop = 800;
  view.paint(false);
  const moved = view.metrics;
  assert.ok(moved.startIndex > 0, JSON.stringify(moved));
  assert.ok(moved.rendered < 80, JSON.stringify(moved));
  const reused = [...host.querySelectorAll('.lib-card')].some(card => overlap.get(card.dataset.id) === card);
  assert.ok(reused, 'overlapping virtual rows should retain their card nodes');
  view.destroy();
});

await test('deep resize preserves the first visible key, viewport offset and focused card', async () => {
  const host = sizedHost(1200, 500); // 8 columns with the production geometry
  const view = createLibraryShelfView({ host, virtualThreshold: 160 });
  const items = Array.from({ length: 1000 }, (_, index) => item(index));
  view.update({ items });

  const stride = 226 + 16;
  const originalCardTop = 18 + (80 * stride); // row 80 * 8 columns = item 640
  host.scrollTop = originalCardTop + 37;
  view.paint(false);
  const focused = host.querySelector('.lib-card[data-id="book-640"]');
  assert.ok(focused, 'deep anchor card must be resident before resize');
  focused.focus();
  assert.equal(document.activeElement, focused);

  host.clientWidth = 600; // 4 columns
  host.__shelfResizeObserver.trigger();
  await new Promise(resolve => setTimeout(resolve, 10));

  const resizedCardTop = 18 + (160 * stride); // item 640 / 4 columns
  const expectedScrollTop = resizedCardTop + 37;
  assert.equal(view.metrics.columns, 4);
  assert.ok(Math.abs(host.scrollTop - expectedScrollTop) < 1,
    `semantic anchor offset drifted: ${host.scrollTop} vs ${expectedScrollTop}`);
  const visibleRow = Math.floor((host.scrollTop - 18) / stride);
  assert.equal(items[visibleRow * view.metrics.columns].book.id, 'book-640',
    'resize must retain the first visible key rather than the old row index');
  assert.equal(document.activeElement?.dataset?.id, 'book-640',
    'resize reconciliation must restore the focused key');

  host.clientWidth = 1200; // 8 columns again
  host.__shelfResizeObserver.trigger();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(view.metrics.columns, 8);
  assert.ok(Math.abs(host.scrollTop - (originalCardTop + 37)) < 1,
    `reverse resize must restore the same semantic offset: ${host.scrollTop}`);
  const restoredRow = Math.floor((host.scrollTop - 18) / stride);
  assert.equal(items[restoredRow * view.metrics.columns].book.id, 'book-640',
    '8→4→8 must keep the same first visible book key');
  assert.equal(document.activeElement?.dataset?.id, 'book-640',
    'reverse resize must preserve the focused key');

  assert.equal(await view.focusKey('book-10'), true,
    'focusKey must materialize a stable key outside the current virtual window');
  assert.equal(document.activeElement?.dataset?.id, 'book-10');
  assert.ok(host.querySelector('.lib-card[data-id="book-10"]'),
    'focusKey target must be resident after virtual scroll correction');
  view.destroy();
});

await test('delegated open, keyboard, context and batch actions execute once', () => {
  const host = sizedHost();
  const calls = { open: 0, batch: 0, context: 0 };
  const view = createLibraryShelfView({
    host,
    onOpen: () => { calls.open += 1; },
    onToggleBatch: () => { calls.batch += 1; },
    onContext: () => { calls.context += 1; },
  });
  view.update({ items: [item(1)] });
  const card = host.querySelector('.lib-card');
  card.click();
  card.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  card.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.deepEqual(calls, { open: 2, batch: 0, context: 1 });
  view.update({ items: [item(1)], batchMode: true });
  host.querySelector('.lib-card').click();
  assert.deepEqual(calls, { open: 2, batch: 1, context: 1 });
  view.destroy();
});

await test('progress, favorite, missing state and invalid covers are explicit', () => {
  const host = sizedHost();
  const view = createLibraryShelfView({ host });
  const value = item(50, { favorite: true, missing: true, cover: 'javascript:alert(1)' });
  value.progress = { status: 'reading', ratio: 0.5 };
  view.update({ items: [value] });
  assert.equal(host.querySelector('.lib-cover img'), null);
  assert.ok(host.querySelector('.lib-card-favorite svg'));
  assert.equal(host.querySelector('.lib-card-missing').textContent, '源文件缺失');
  assert.equal(host.querySelector('[role=progressbar]').getAttribute('aria-valuenow'), '50');
  view.destroy();
});

await test('destroy detaches the stable owner and clears resident cards', () => {
  const host = sizedHost();
  let opened = 0;
  const view = createLibraryShelfView({ host, onOpen: () => { opened += 1; } });
  view.update({ items: [item(1)] });
  const oldCard = host.querySelector('.lib-card');
  view.destroy();
  oldCard.click();
  assert.equal(opened, 0);
  assert.equal(view.metrics.rendered, 0);
});

console.log(`[library-shelf-view] ${passed}/6 passed`);
