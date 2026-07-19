// tests/contract/_setup.mjs —— jsdom 环境（契约行为测试：无头浏览器环境真实实例化）
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html data-theme="paper"><body></body></html>', {
  url: 'https://localhost/',
  pretendToBeVisual: true,
});

// 补齐 jsdom 缺失的 API（ProseMirror 视图挂载需要）
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
if (!dom.window.Range.prototype.getClientRects) {
  dom.window.Range.prototype.getClientRects = function () { return []; };
}
dom.window.Range.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
};
if (!dom.window.navigator.clipboard) {
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    value: { writeText: async () => {}, readText: async () => '' },
  });
}

globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node 21+ 的 navigator 是只读 getter，直接赋值会抛 TypeError，必须用 defineProperty 覆盖（勿删，Node 24 下测试会全崩）
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame?.bind(dom.window) || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame?.bind(dom.window) || clearTimeout;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.XMLSerializer = dom.window.XMLSerializer;

export { dom };
