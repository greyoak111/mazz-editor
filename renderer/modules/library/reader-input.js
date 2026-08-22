// Semantic input boundary for the Library reader.
//
// The reader owns commands (next, previous, search, ...), while this module
// owns the transient DOM mechanics needed to translate the same gestures from
// the host document and from a sandboxed/replaced reading iframe.  It never
// mutates reader state directly.

const EDITABLE_SELECTOR = [
  'input', 'textarea', 'select', 'option', 'button',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]', '[role="combobox"]', '[role="slider"]',
].join(',');

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function eventTarget(event) {
  const target = event?.composedPath?.()[0] || event?.target || null;
  return target?.nodeType === 3 ? target.parentElement : target;
}

/** True when a reader gesture started in a control that owns its keystrokes. */
export function isReaderEditable(target) {
  if (!target || target.nodeType !== 1) return false;
  if (target.isContentEditable) return true;
  try { return !!target.closest?.(EDITABLE_SELECTOR); } catch { return false; }
}

/** Convert a keyboard event into a direction-independent reader command. */
export function readerCommandForKey(event, direction = 'ltr') {
  if (!event || event.defaultPrevented || event.isComposing || isReaderEditable(eventTarget(event))) return null;
  const key = event.key;
  const modified = !!(event.ctrlKey || event.metaKey || event.altKey);

  if ((event.ctrlKey || event.metaKey) && !event.altKey && String(key).toLowerCase() === 'f') return 'search';
  if (modified) return null;
  if (key === 'Escape') return 'escape';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if (key === 'PageDown' || key === 'ArrowDown') return 'next';
  if (key === 'PageUp' || key === 'ArrowUp') return 'previous';
  if (key === ' ' || key === 'Spacebar') return event.shiftKey ? 'previous' : 'next';
  if (key === 'ArrowRight') return direction === 'rtl' ? 'previous' : 'next';
  if (key === 'ArrowLeft') return direction === 'rtl' ? 'next' : 'previous';
  return null;
}

function commandForWheel(event, direction) {
  const dx = finite(event?.deltaX, 0);
  const dy = finite(event?.deltaY, 0);
  if (Math.abs(dx) > Math.abs(dy)) {
    if (!dx) return null;
    const forward = direction === 'rtl' ? dx < 0 : dx > 0;
    return forward ? 'next' : 'previous';
  }
  if (!dy) return null;
  return dy > 0 ? 'next' : 'previous';
}

function commandForSwipe(start, event, direction, threshold) {
  if (!start || start.pointerId !== event.pointerId) return null;
  const dx = finite(event.clientX, start.x) - start.x;
  const dy = finite(event.clientY, start.y) - start.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return null;
  if (Math.abs(dx) >= Math.abs(dy)) {
    // A leftward finger swipe advances an LTR book and retreats an RTL book.
    const forward = direction === 'rtl' ? dx > 0 : dx < 0;
    return forward ? 'next' : 'previous';
  }
  return dy < 0 ? 'next' : 'previous';
}

export class ReaderInputController {
  constructor(options = {}) {
    this.onCommand = typeof options.onCommand === 'function' ? options.onCommand : (() => undefined);
    this.getDirection = typeof options.getDirection === 'function'
      ? options.getDirection
      : (() => options.direction === 'rtl' ? 'rtl' : 'ltr');
    this.wheel = options.wheel !== false;
    this.pointer = options.pointer !== false;
    // Text readers must not turn a page when a desktop user merely drags to
    // select a quote. Mouse swipes are opt-in; touch/pen gestures stay native.
    this.allowMouseSwipe = options.allowMouseSwipe === true;
    this.wheelThreshold = Math.max(1, finite(options.wheelThreshold, 24));
    this.wheelCooldownMs = Math.max(0, finite(options.wheelCooldownMs, 180));
    this.swipeThreshold = Math.max(8, finite(options.swipeThreshold, 56));
    this.preventDefault = options.preventDefault !== false;
    this._targets = new Set();
    this._frames = new Map();
    this._pointerStarts = new Map();
    this._wheelState = new WeakMap();
    this._focusRequest = null;
    this._focusSerial = 0;
    this._focusRaf = null;
    this._focusTimer = null;
    this._disposed = false;

    this._onKey = event => this._handleKey(event);
    this._onWheel = event => this._handleWheel(event);
    this._onPointerDown = event => this._handlePointerDown(event);
    this._onPointerUp = event => this._handlePointerUp(event);
    this._onPointerCancel = event => this._pointerStarts.delete(event.pointerId);

    if (options.host) this.attach(options.host);
    if (options.frame) this.attachFrame(options.frame);
  }

  get disposed() { return this._disposed; }
  get attachedCount() { return this._targets.size; }
  get focusPending() { return !!this._focusRequest; }

  _direction() {
    try { return this.getDirection() === 'rtl' ? 'rtl' : 'ltr'; } catch { return 'ltr'; }
  }

  _emit(command, event, source, extra = {}) {
    if (!command || this._disposed) return false;
    let result;
    try {
      result = this.onCommand(command, {
        command, event, source, direction: this._direction(), ...extra,
      });
    } catch {
      return false;
    }
    // Returning false is the explicit "not handled" contract. Undefined is a
    // successful fire-and-forget handler and therefore still consumes input.
    const handled = result !== false;
    if (handled && this.preventDefault && event?.cancelable) event.preventDefault();
    return handled;
  }

  _handleKey(event) {
    const command = readerCommandForKey(event, this._direction());
    return this._emit(command, event, 'keyboard');
  }

  _handleWheel(event) {
    if (!this.wheel || event.defaultPrevented || event.ctrlKey || event.metaKey || isReaderEditable(eventTarget(event))) return false;
    const target = event.currentTarget || event.target;
    const now = Date.now();
    const state = this._wheelState.get(target) || { x: 0, y: 0, lastAt: -Infinity };
    state.x += finite(event.deltaX, 0);
    state.y += finite(event.deltaY, 0);
    if (Math.max(Math.abs(state.x), Math.abs(state.y)) < this.wheelThreshold) {
      this._wheelState.set(target, state);
      return false;
    }
    if (now - state.lastAt < this.wheelCooldownMs) {
      state.x = 0; state.y = 0;
      this._wheelState.set(target, state);
      return false;
    }
    const command = commandForWheel({ deltaX: state.x, deltaY: state.y }, this._direction());
    state.x = 0; state.y = 0; state.lastAt = now;
    this._wheelState.set(target, state);
    return this._emit(command, event, 'wheel');
  }

  _handlePointerDown(event) {
    if (!this.pointer || event.defaultPrevented || event.button > 0 || event.isPrimary === false
      || (!this.allowMouseSwipe && event.pointerType === 'mouse')
      || isReaderEditable(eventTarget(event))) return;
    this._pointerStarts.set(event.pointerId, {
      pointerId: event.pointerId,
      x: finite(event.clientX, 0), y: finite(event.clientY, 0),
      target: event.currentTarget,
    });
  }

  _handlePointerUp(event) {
    if (!this.pointer) return false;
    const start = this._pointerStarts.get(event.pointerId);
    this._pointerStarts.delete(event.pointerId);
    if (!start || start.target !== event.currentTarget) return false;
    const command = commandForSwipe(start, event, this._direction(), this.swipeThreshold);
    return this._emit(command, event, 'swipe', {
      deltaX: finite(event.clientX, start.x) - start.x,
      deltaY: finite(event.clientY, start.y) - start.y,
    });
  }

  /** Attach one EventTarget exactly once; returns an idempotent detach closure. */
  attach(target) {
    if (this._disposed || !target?.addEventListener || this._targets.has(target)) return () => false;
    target.addEventListener('keydown', this._onKey, false);
    target.addEventListener('wheel', this._onWheel, { passive: false });
    target.addEventListener('pointerdown', this._onPointerDown, false);
    target.addEventListener('pointerup', this._onPointerUp, false);
    target.addEventListener('pointercancel', this._onPointerCancel, false);
    this._targets.add(target);
    return () => this.detach(target);
  }

  detach(target) {
    if (!target || !this._targets.delete(target)) return false;
    target.removeEventListener('keydown', this._onKey, false);
    target.removeEventListener('wheel', this._onWheel, false);
    target.removeEventListener('pointerdown', this._onPointerDown, false);
    target.removeEventListener('pointerup', this._onPointerUp, false);
    target.removeEventListener('pointercancel', this._onPointerCancel, false);
    this._pointerStarts.clear();
    return true;
  }

  _clearFocusRequest(request = null) {
    if (request && this._focusRequest?.id !== request.id) return false;
    this._focusRequest = null;
    if (this._focusRaf != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._focusRaf);
    }
    this._focusRaf = null;
    clearTimeout(this._focusTimer);
    this._focusTimer = null;
    return true;
  }

  cancelFocusRequest() {
    this._focusSerial += 1;
    return this._clearFocusRequest();
  }

  _focusAllowed(request) {
    if (this._disposed || this._focusRequest?.id !== request?.id) return false;
    try { return request.guard?.() !== false; } catch { return false; }
  }

  _attemptFocus(request, { allowFallback = !request?.frame } = {}) {
    if (!this._focusAllowed(request)) {
      if (this._focusRequest?.id === request?.id) this._clearFocusRequest(request);
      return false;
    }

    const frame = request.frame;
    if (frame?.isConnected) {
      try {
        const doc = frame.contentDocument || frame.contentWindow?.document || null;
        const body = doc?.body || null;
        if (body) {
          if (!frame.hasAttribute?.('tabindex')) frame.setAttribute?.('tabindex', '-1');
          frame.focus?.({ preventScroll: true });
          if (!body.hasAttribute?.('tabindex')) body.setAttribute?.('tabindex', '-1');
          body.focus?.({ preventScroll: true });
          if (frame.ownerDocument?.activeElement === frame && doc.activeElement === body) {
            this._clearFocusRequest(request);
            return true;
          }
        }
      } catch {
        // A non-readable or not-yet-loaded document may become available on
        // the frame's next load event. The guarded retry below owns that race.
      }
    }

    const fallback = request.fallback;
    if (allowFallback && fallback?.isConnected) {
      try {
        if (!fallback.hasAttribute?.('tabindex')) fallback.setAttribute?.('tabindex', '-1');
        fallback.focus?.({ preventScroll: true });
        if (fallback.ownerDocument?.activeElement === fallback) {
          this._clearFocusRequest(request);
          return true;
        }
      } catch {}
    }
    return false;
  }

  /**
   * Transfer keyboard ownership from the shelf into the reading surface.
   * The caller-supplied guard is rechecked for every delayed attempt so an
   * iframe load cannot steal focus after the user moved to reader controls or
   * after the owning book/generation retired.
   */
  requestFocus({ frame = null, fallback = null, guard = () => true } = {}) {
    this.cancelFocusRequest();
    if (this._disposed) return false;
    const request = { id: ++this._focusSerial, frame, fallback, guard };
    this._focusRequest = request;
    if (this._attemptFocus(request)) return true;

    queueMicrotask(() => this._attemptFocus(request));
    if (typeof requestAnimationFrame === 'function') {
      this._focusRaf = requestAnimationFrame(() => {
        this._focusRaf = null;
        this._attemptFocus(request);
      });
    }
    this._focusTimer = setTimeout(() => {
      this._focusTimer = null;
      this._attemptFocus(request, { allowFallback: true });
      if (this._focusRequest?.id === request.id) this._clearFocusRequest(request);
    }, 120);
    return false;
  }

  /**
   * Attach a live Document or an iframe element. Replaced iframe documents are
   * re-bound on load without retaining the previous document.
   */
  attachFrame(frame) {
    if (this._disposed || !frame) return () => this.detachFrame(frame);
    if (frame.nodeType === 9) {
      this.attach(frame);
      return () => this.detach(frame);
    }
    if (!frame.addEventListener || this._frames.has(frame)) return () => false;
    const binding = { document: null, onLoad: null };
    const bindDocument = () => {
      let doc = null;
      try { doc = frame.contentDocument || frame.contentWindow?.document || null; } catch { doc = null; }
      if (binding.document === doc) return;
      if (binding.document) this.detach(binding.document);
      binding.document = doc;
      if (doc) this.attach(doc);
      if (this._focusRequest?.frame === frame) this._attemptFocus(this._focusRequest);
    };
    binding.onLoad = bindDocument;
    this._frames.set(frame, binding);
    frame.addEventListener('load', bindDocument, false);
    bindDocument();
    return () => this.detachFrame(frame);
  }

  detachFrame(frame) {
    const binding = this._frames.get(frame);
    if (!binding) return false;
    this._frames.delete(frame);
    frame.removeEventListener('load', binding.onLoad, false);
    if (binding.document) this.detach(binding.document);
    if (this._focusRequest?.frame === frame) this.cancelFocusRequest();
    return true;
  }

  dispose() {
    if (this._disposed) return;
    this.cancelFocusRequest();
    for (const frame of [...this._frames.keys()]) this.detachFrame(frame);
    for (const target of [...this._targets]) this.detach(target);
    this._pointerStarts.clear();
    this._disposed = true;
  }
}

export function createReaderInput(options) {
  return new ReaderInputController(options);
}

export const _forTests = Object.freeze({ commandForWheel, commandForSwipe, eventTarget });
