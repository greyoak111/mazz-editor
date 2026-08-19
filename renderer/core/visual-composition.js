import { installControlIconRuntime } from '../lib/control-icons.js';

export const OVERLAY_RULES = Object.freeze([
  { selector: '.mazz-palette-mask', kind: 'modal', moveToPlane: true },
  { selector: '.appwin-mask', kind: 'app-window', moveToPlane: true },
  { selector: '.page-preview-mask', kind: 'page-preview', moveToPlane: true },
  { selector: '.sl-present', kind: 'presentation', moveToPlane: false },
]);

function finiteBounds(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) };
}

function isElement(value) { return value?.nodeType === 1 && typeof value.getBoundingClientRect === 'function'; }

function focusable(root) {
  return [...root.querySelectorAll('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')]
    .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
}

class VisualCompositionClient {
  constructor() {
    this.records = new Map();
    this.elements = new WeakMap();
    this.stack = [];
    this.sequence = 0;
    this.started = false;
    this.plane = null;
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.ensurePlane();
    installControlIconRuntime(document);
    this.scan(document);
    this.observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) this.scan(node);
        for (const node of record.removedNodes) if (node.nodeType === Node.ELEMENT_NODE) this.releaseDisconnected(node);
      }
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('fullscreenchange', () => this.rehomePlane());
    document.addEventListener('keydown', event => this.arbitrateKey(event), true);
    window.addEventListener('resize', () => this.updateViewportClass(), { passive: true });
    window.addEventListener('pagehide', () => this.releaseAll('pagehide'));
    this.updateViewportClass();
    document.documentElement.dataset.visualComposition = 'v1';
    window.MazzVisualComposition = this;
    return this;
  }

  ensurePlane() {
    if (this.plane?.isConnected) return this.plane;
    this.plane = document.getElementById('mazz-overlay-plane') || document.createElement('div');
    this.plane.id = 'mazz-overlay-plane';
    this.plane.setAttribute('aria-live', 'polite');
    (document.body || document.documentElement).appendChild(this.plane);
    return this.plane;
  }

  rehomePlane() {
    const parent = document.fullscreenElement || document.body;
    if (parent && this.plane.parentElement !== parent && !this.plane.contains(parent)) parent.appendChild(this.plane);
  }

  ruleFor(element) { return OVERLAY_RULES.find(rule => element.matches?.(rule.selector)); }

  scan(root) {
    const candidates = [];
    if (isElement(root) && this.ruleFor(root)) candidates.push(root);
    for (const rule of OVERLAY_RULES) candidates.push(...(root.querySelectorAll?.(rule.selector) || []));
    for (const element of new Set(candidates)) this.registerOverlay(element);
  }

  mountOverlay(element, options = {}) {
    this.ensurePlane().appendChild(element);
    return this.registerOverlay(element, { ...options, moveToPlane: options.moveToPlane !== false });
  }

  registerOverlay(element, options = {}) {
    const existingToken = this.elements.get(element);
    if (existingToken) return this.handleFor(existingToken);
    const rule = this.ruleFor(element) || { kind: options.kind || 'overlay', moveToPlane: options.moveToPlane !== false };
    const token = `renderer-${Date.now().toString(36)}-${++this.sequence}`;
    const record = {
      token, element, kind: options.kind || rule.kind,
      onDismiss: options.onDismiss || null,
      focusPolicy: options.focusPolicy === 'none' ? 'none' : 'auto',
      previousFocus: isElement(document.activeElement) ? document.activeElement : null,
      resizeObserver: null, released: false,
    };
    this.records.set(token, record);
    this.elements.set(element, token);
    this.stack.push(token);
    element.dataset.visualToken = token;
    element.dataset.visualState = 'pending';
    if ((options.moveToPlane ?? rule.moveToPlane) && element.parentElement !== this.ensurePlane()) this.plane.appendChild(element);
    const activate = async () => {
      try {
        if (window.mazz?.isElectron) {
          await window.mazz.invoke('visual:overlayBegin', {
            token, kind: record.kind, bounds: finiteBounds(element), dismissible: !!record.onDismiss,
          });
        }
        if (!record.released && element.isConnected) {
          element.dataset.visualReady = '1';
          element.dataset.visualState = 'active';
          if (record.focusPolicy !== 'none') queueMicrotask(() => {
            if (!element.contains(document.activeElement)) focusable(element)[0]?.focus?.({ preventScroll: true });
          });
        }
      } catch (error) {
        element.dataset.visualReady = 'degraded';
        element.dataset.visualState = 'degraded';
        console.error('[visual-composition] overlay registration failed:', error);
      }
    };
    activate();
    if (typeof ResizeObserver === 'function') {
      record.resizeObserver = new ResizeObserver(() => {
        if (!record.released && window.mazz?.isElectron) window.mazz.invoke('visual:overlayUpdate', { token, bounds: finiteBounds(element) }).catch(error => console.error('[visual-composition] geometry update failed:', error));
      });
      record.resizeObserver.observe(element);
    }
    return this.handleFor(token);
  }

  handleFor(token) {
    return { token, release: reason => this.releaseOverlay(token, reason), update: () => this.updateOverlay(token) };
  }

  updateOverlay(token) {
    const record = this.records.get(token);
    if (!record || record.released) return false;
    if (window.mazz?.isElectron) window.mazz.invoke('visual:overlayUpdate', { token, bounds: finiteBounds(record.element) }).catch(error => console.error('[visual-composition] geometry update failed:', error));
    return true;
  }

  releaseDisconnected(root) {
    for (const [token, record] of [...this.records]) {
      if ((record.element === root || root.contains?.(record.element)) && !record.element.isConnected) this.releaseOverlay(token, 'dom-removed');
    }
  }

  releaseOverlay(token, reason = 'closed') {
    const record = this.records.get(token);
    if (!record || record.released) return false;
    record.released = true;
    record.resizeObserver?.disconnect?.();
    this.records.delete(token);
    this.elements.delete(record.element);
    this.stack = this.stack.filter(value => value !== token);
    delete record.element.dataset.visualReady;
    record.element.dataset.visualState = 'released';
    if (window.mazz?.isElectron) window.mazz.invoke('visual:overlayEnd', { token, reason }).catch(error => console.error('[visual-composition] overlay release failed:', error));
    const top = this.topRecord();
    if (top) focusable(top.element)[0]?.focus?.({ preventScroll: true });
    else if (record.previousFocus?.isConnected) record.previousFocus.focus?.({ preventScroll: true });
    return true;
  }

  releaseAll(reason) { for (const token of [...this.stack].reverse()) this.releaseOverlay(token, reason); }
  topRecord() { return this.records.get(this.stack.at(-1)) || null; }

  arbitrateKey(event) {
    const top = this.topRecord();
    if (!top || !top.element.isConnected) return;
    if (top.focusPolicy === 'none') return;
    if (event.key === 'Escape' && top.onDismiss) {
      event.preventDefault(); event.stopImmediatePropagation(); top.onDismiss(); return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable(top.element);
    if (!items.length) { event.preventDefault(); top.element.tabIndex = -1; top.element.focus(); return; }
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  updateViewportClass() {
    const width = Math.round(document.documentElement.clientWidth || innerWidth || 0);
    document.documentElement.dataset.uiSize = width < 720 ? 'xs' : width < 960 ? 'sm' : width < 1280 ? 'md' : 'lg';
  }

  snapshot() {
    return {
      protocol: 'mazz.visual-composition/renderer-v1',
      overlayCount: this.records.size,
      stack: this.stack.map(token => {
        const record = this.records.get(token);
        return { token, kind: record?.kind, state: record?.element.dataset.visualState, focusPolicy: record?.focusPolicy, bounds: finiteBounds(record?.element) };
      }),
      uiSize: document.documentElement.dataset.uiSize,
      planeConnected: !!this.plane?.isConnected,
    };
  }
}

export const visualComposition = new VisualCompositionClient();
export { finiteBounds };
