// renderer/modules/library/text-viewport.js
// Bounded text-section virtualization for long, reflowable books.
//
// Every section keeps a cheap, height-preserving slot in the scroll rail while
// only the active section and its nearest neighbours own live DOM/resources.
// The implementation deliberately knows nothing about EPUB: callers provide
// section content and a release hook, keeping parsing and viewport lifecycles
// independently testable.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function sectionWindow(center, count, before = 1, after = 1) {
  const keep = new Set();
  const total = Math.max(0, Number(count) || 0);
  if (!total) return keep;
  const current = clamp(Number(center) || 0, 0, total - 1);
  const lead = Math.max(0, Number(before) || 0);
  const trail = Math.max(0, Number(after) || 0);
  for (let index = Math.max(0, current - lead); index <= Math.min(total - 1, current + trail); index++) {
    keep.add(index);
  }
  return keep;
}

const finiteHeight = (value, fallback) => {
  const height = Number(value);
  return Number.isFinite(height) && height > 0 ? Math.round(height) : fallback;
};

/**
 * Create a stable vertical viewport for a section-based text book.
 *
 * `loadSection()` may resolve to a Node, DocumentFragment, sanitized HTML
 * string, or `{ node | element | html, height? }`. HTML is assumed to have
 * already passed the book parser's sanitizer.
 *
 * @param {object} options
 * @param {HTMLElement} options.host scrolling element (including iframe body)
 * @param {HTMLElement} options.mount rail mount (may equal host)
 * @param {number} options.count number of sections
 * @param {number} [options.initialSection]
 * @param {{section?:number,sectionId?:string,spineItemId?:string,ratio?:number}} [options.initialLocator]
 * @param {number} [options.before=1] resident sections before active
 * @param {number} [options.after=1] resident sections after active
 * @param {number|((index:number)=>number)} [options.estimateHeight]
 * @param {(index:number)=>Promise<Node|string|object>} options.loadSection
 * @param {(index:number)=>string|number} [options.getSectionId]
 * @param {(keepIds:Set, keepIndices:Set)=>void} [options.releaseOutside]
 * @param {(index:number)=>void} [options.onSection]
 * @param {()=>boolean} [options.isAlive]
 */
export function createTextViewport({
  host,
  mount,
  count,
  initialSection = 0,
  initialLocator = null,
  before = 1,
  after = 1,
  estimateHeight,
  loadSection,
  getSectionId = index => index,
  releaseOutside = () => {},
  onSection = () => {},
  isAlive = () => true,
}) {
  if (!host || !mount || typeof loadSection !== 'function') {
    throw new Error('text viewport requires host/mount/loadSection');
  }

  const doc = mount.ownerDocument || document;
  const view = doc.defaultView || null;
  const rootHost = host === doc.body || host === doc.documentElement || host === doc.scrollingElement;
  // Standards-mode iframes scroll `document.scrollingElement` (normally
  // <html>) even when overflow is declared on <body>. Keep the mount and the
  // scroll owner separate: the body owns the virtual rail, while this resolved
  // element owns position, viewport metrics and scroll events.
  const scrollElement = rootHost ? (doc.scrollingElement || host) : host;
  const readScrollTop = () => Math.max(0, Number(scrollElement?.scrollTop) || 0);
  const writeScrollTop = (top, smooth = false) => {
    const target = Math.max(0, Number(top) || 0);
    if (smooth && typeof scrollElement?.scrollTo === 'function') {
      try {
        scrollElement.scrollTo({ top: target, behavior: 'smooth' });
        return;
      } catch { /* fall through to the deterministic assignment */ }
    }
    scrollElement.scrollTop = target;
  };
  const viewportHeight = () => {
    if (rootHost) {
      return Number(doc.documentElement?.clientHeight)
        || Number(view?.innerHeight)
        || Number(scrollElement?.clientHeight)
        || Number(host.clientHeight)
        || Number(mount.clientHeight)
        || 720;
    }
    return Number(scrollElement?.clientHeight) || Number(mount.clientHeight) || 720;
  };
  const scrollTargets = [...new Set(
    rootHost ? [doc, view, scrollElement].filter(Boolean) : [scrollElement],
  )];
  const total = Math.max(0, Number(count) || 0);
  const defaultHeight = Math.max(320, Math.round(viewportHeight()));
  const estimateFor = index => finiteHeight(
    typeof estimateHeight === 'function' ? estimateHeight(index) : estimateHeight,
    defaultHeight,
  );

  let active = clamp(Number(initialSection) || 0, 0, Math.max(0, total - 1));
  let destroyed = false;
  let frame = 0;
  let convergence = 0;
  let resizeObserver = null;
  const resident = new Map();
  const pending = new Map();
  const loadTokens = new Map();
  const heights = Array.from({ length: total }, (_, index) => estimateFor(index));

  mount.replaceChildren();
  mount.classList.add('lib-page--text-virtual');
  const rail = doc.createElement('div');
  rail.className = 'lib-text-reel';
  rail.setAttribute('role', 'document');
  rail.setAttribute('aria-label', '电子书连续阅读');
  const slots = [];

  for (let index = 0; index < total; index++) {
    const slot = doc.createElement('section');
    slot.className = 'lib-text-slot';
    slot.dataset.i = String(index);
    slot.dataset.sectionId = String(getSectionId(index));
    slot.setAttribute('role', 'region');
    slot.setAttribute('aria-label', `第 ${index + 1} 节`);
    slot.style.minHeight = `${heights[index]}px`;
    slot.style.height = `${heights[index]}px`;

    const placeholder = doc.createElement('span');
    placeholder.className = 'lib-text-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    slot.appendChild(placeholder);
    rail.appendChild(slot);
    slots.push(slot);
  }
  mount.appendChild(rail);

  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const ratioOf = value => clamp(Number.isFinite(Number(value)) ? Number(value) : 0, 0, 1);
  const idAt = index => String(getSectionId(index));
  const resolveSection = (locator, fallback = active) => {
    const source = locator && typeof locator === 'object' ? locator : {};
    const requestedId = source.sectionId ?? source.spineItemId;
    if (requestedId != null) {
      const match = slots.findIndex((_, index) => idAt(index) === String(requestedId));
      if (match >= 0) return match;
    }
    const numeric = Number(source.section);
    return clamp(Number.isFinite(numeric) ? Math.trunc(numeric) : fallback, 0, Math.max(0, total - 1));
  };
  let restoringLocator = initialLocator && typeof initialLocator === 'object'
    ? { ...initialLocator, section: resolveSection(initialLocator), ratio: ratioOf(initialLocator.ratio) }
    : { section: active, sectionId: total ? idAt(active) : '', ratio: 0 };

  const alive = () => !destroyed && isAlive();
  const currentKeep = () => sectionWindow(active, total, before, after);
  const idsFor = indices => new Set([...indices].map(index => getSectionId(index)));
  const release = indices => {
    try { releaseOutside(idsFor(indices), new Set(indices)); } catch { /* release is best-effort */ }
  };

  const measure = index => {
    const slot = slots[index];
    if (!slot) return heights[index] || defaultHeight;
    const rectHeight = slot.getBoundingClientRect?.().height;
    const measured = finiteHeight(
      Math.max(Number(rectHeight) || 0, Number(slot.scrollHeight) || 0, Number(slot.offsetHeight) || 0),
      heights[index] || defaultHeight,
    );
    heights[index] = measured;
    slot.style.minHeight = `${measured}px`;
    return measured;
  };

  const unload = index => {
    const entry = resident.get(index);
    if (!entry) return;
    const slot = slots[index];
    const height = measure(index);
    resizeObserver?.unobserve?.(slot);
    resident.delete(index);
    slot.replaceChildren();
    slot.classList.remove('is-loaded', 'is-loading', 'is-error');
    slot.style.minHeight = `${height}px`;
    slot.style.height = `${height}px`;
    const placeholder = doc.createElement('span');
    placeholder.className = 'lib-text-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    slot.appendChild(placeholder);
  };

  const asNode = result => {
    const value = result && typeof result === 'object'
      ? (result.node || result.element || (result.html != null ? result.html : result))
      : result;
    if (typeof value === 'string') {
      const wrapper = doc.createElement('div');
      wrapper.className = 'lib-text-section-content';
      wrapper.innerHTML = value;
      return wrapper;
    }
    if (value?.nodeType) return value;
    return null;
  };

  const load = async (index, epoch) => {
    if (!alive() || index < 0 || index >= total || resident.has(index)) return false;

    const token = (loadTokens.get(index) || 0) + 1;
    loadTokens.set(index, token);
    const slot = slots[index];
    slot.classList.remove('is-error');
    slot.classList.add('is-loading');

    const request = Promise.resolve().then(() => loadSection(index));
    pending.set(index, { token, request });
    try {
      const result = await request;
      const keep = currentKeep();
      const requestAlive = alive();
      if (!requestAlive || epoch !== convergence || loadTokens.get(index) !== token || !keep.has(index)) {
        // destroy() already released this viewport's complete ownership set.
        // A request that settles after destroy/isAlive invalidation must not
        // replay its obsolete keep-set into a shared EPUB loader: a replacement
        // viewport may already own newer chapters on that same loader.
        if (requestAlive) release(keep);
        return false;
      }

      const node = asNode(result);
      if (!node) throw new Error('section loader returned no content');
      const hintedHeight = result && typeof result === 'object' ? result.height : 0;
      if (hintedHeight) heights[index] = finiteHeight(hintedHeight, heights[index]);

      slot.replaceChildren(node);
      slot.style.height = '';
      slot.style.minHeight = `${heights[index]}px`;
      slot.classList.remove('is-loading');
      slot.classList.add('is-loaded');
      resident.set(index, { node, token });
      resizeObserver?.observe?.(slot);

      // Let layout settle before capturing the height used by a future
      // placeholder. This callback is generation guarded as well.
      requestAnimationFrame(() => {
        if (alive() && convergence === epoch && resident.get(index)?.token === token) measure(index);
      });
      return true;
    } catch {
      if (alive() && convergence === epoch && loadTokens.get(index) === token) {
        slot.classList.remove('is-loading');
        slot.classList.add('is-error');
      }
      return false;
    } finally {
      if (pending.get(index)?.token === token) pending.delete(index);
    }
  };

  const converge = async (next = active) => {
    if (!alive() || !total) return;
    active = clamp(Number(next) || 0, 0, total - 1);
    const epoch = ++convergence;
    const keep = currentKeep();

    for (const index of [...resident.keys()]) if (!keep.has(index)) unload(index);
    for (const [index] of pending) {
      if (!keep.has(index)) loadTokens.set(index, (loadTokens.get(index) || 0) + 1);
    }
    release(keep);

    // The active section is the visual gate. Neighbours are speculative and
    // never delay goTo or input response.
    await load(active, epoch);
    if (!alive() || epoch !== convergence) return;
    const neighbours = [...keep].filter(index => index !== active);
    Promise.allSettled(neighbours.map(index => load(index, epoch))).then(() => {
      if (!alive() || epoch !== convergence) return;
      release(currentKeep());
    });
  };

  const viewportMetrics = () => {
    const rect = scrollElement?.getBoundingClientRect?.() || { top: 0, height: 0 };
    const height = viewportHeight() || Number(rect.height) || defaultHeight;
    return { top: rootHost ? 0 : (Number(rect.top) || 0), height };
  };

  const geometricSection = () => {
    if (!total) return 0;
    const viewport = viewportMetrics();
    const targetY = viewport.top + viewport.height * 0.38;
    let best = active;
    let distance = Infinity;
    let hasGeometry = false;

    for (let index = 0; index < total; index++) {
      const rect = slots[index].getBoundingClientRect?.();
      if (!rect || !(Number(rect.height) > 0)) continue;
      hasGeometry = true;
      if (targetY >= rect.top && targetY <= rect.bottom) return index;
      const delta = Math.abs((rect.top + rect.bottom) / 2 - targetY);
      if (delta < distance) { distance = delta; best = index; }
    }
    if (hasGeometry) return best;

    // jsdom and some not-yet-laid-out iframe bodies report zero rectangles.
    // Falling back to the height ledger keeps navigation deterministic.
    let remaining = readScrollTop() + viewportMetrics().height * 0.38;
    for (let index = 0; index < total; index++) {
      if (remaining < heights[index]) return index;
      remaining -= heights[index];
    }
    return total - 1;
  };

  const slotHeight = index => {
    const slot = slots[index];
    const rectHeight = Number(slot?.getBoundingClientRect?.().height) || 0;
    return finiteHeight(
      Math.max(rectHeight, Number(slot?.scrollHeight) || 0, Number(slot?.offsetHeight) || 0),
      heights[index] || defaultHeight,
    );
  };

  const ledgerTop = index => heights.slice(0, Math.max(0, index)).reduce((sum, height) => sum + height, 0);
  const slotTop = index => {
    const offset = Number(slots[index]?.offsetTop);
    return Number.isFinite(offset) && (index === 0 || offset > 0) ? offset : ledgerTop(index);
  };

  /**
   * Capture the viewport-top reading point, not merely the active chapter.
   * The section key + section-relative ratio survives reflow and resize; the
   * raw scrollTop is evidence/debug fallback only and is never canonical.
   */
  const captureLocator = () => {
    if (!total) return null;
    if (restoringLocator) return { ...restoringLocator };

    const viewportTop = viewportMetrics().top;
    let section = -1;
    let ratio = 0;
    let hasGeometry = false;
    for (let index = 0; index < total; index++) {
      const rect = slots[index]?.getBoundingClientRect?.();
      if (!rect || !(Number(rect.height) > 0)) continue;
      hasGeometry = true;
      if (viewportTop >= rect.top && viewportTop < rect.bottom) {
        section = index;
        ratio = ratioOf((viewportTop - rect.top) / rect.height);
        break;
      }
    }

    const scrollTop = readScrollTop();
    if (section < 0) {
      let remaining = scrollTop;
      section = total - 1;
      for (let index = 0; index < total; index++) {
        const height = heights[index] || defaultHeight;
        if (remaining < height || index === total - 1) {
          section = index;
          ratio = ratioOf(remaining / Math.max(1, height));
          break;
        }
        remaining -= height;
      }
    } else if (!hasGeometry) {
      ratio = 0;
    }

    const height = slotHeight(section);
    const totalHeight = Math.max(1, heights.reduce((sum, item) => sum + item, 0));
    const progression = clamp((ledgerTop(section) + ratio * height) / totalHeight, 0, 1);
    return {
      section,
      sectionId: idAt(section),
      ratio: +ratio.toFixed(5),
      progression: +progression.toFixed(5),
      scrollTop: +scrollTop.toFixed(2),
    };
  };

  const restoreLocator = async (locator, { smooth = false, notify = false } = {}) => {
    if (!alive() || !total) return false;
    const source = locator && typeof locator === 'object' ? locator : {};
    const next = resolveSection(source, active);
    const ratio = ratioOf(source.ratio);
    const changed = next !== active;
    active = next;
    restoringLocator = { ...source, section: active, sectionId: idAt(active), ratio };
    await converge(active);
    if (!alive()) return false;
    await nextFrame();
    if (!alive()) return false;
    measure(active);
    const target = Math.max(0, slotTop(active) + ratio * slotHeight(active));
    writeScrollTop(target, smooth);
    await nextFrame();
    if (!alive()) return false;
    restoringLocator = null;
    if (notify && (changed || ratio > 0)) onSection(active);
    return true;
  };

  const onScroll = () => {
    if (!alive() || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const next = geometricSection();
      if (next === active) return;
      active = next;
      onSection(active);
      converge(active);
    });
  };
  for (const target of scrollTargets) target.addEventListener('scroll', onScroll, { passive: true });

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(entries => {
      if (!alive()) return;
      for (const entry of entries) {
        const index = Number(entry.target?.dataset?.i);
        if (Number.isInteger(index) && resident.has(index)) measure(index);
      }
    });
  }

  const ready = restoreLocator(restoringLocator, { notify: false }).catch(() => false);

  return {
    get activeSection() { return active; },
    get residentCount() { return resident.size; },
    get pendingCount() { return pending.size; },
    get residentIndices() { return [...resident.keys()].sort((a, b) => a - b); },
    get estimatedTotalHeight() { return heights.reduce((sum, height) => sum + height, 0); },
    get destroyed() { return destroyed; },
    ready,
    captureLocator,
    async restoreLocator(locator, options = {}) {
      return restoreLocator(locator, { ...options, notify: options.notify !== false });
    },
    async goTo(index, { smooth = false, ratio = 0 } = {}) {
      return restoreLocator({ section: index, ratio }, { smooth, notify: true });
    },
    refresh() {
      if (!alive()) return;
      for (const index of resident.keys()) measure(index);
      onScroll();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      convergence++;
      if (frame) cancelAnimationFrame(frame);
      for (const target of scrollTargets) target.removeEventListener('scroll', onScroll);
      resizeObserver?.disconnect?.();
      for (const index of loadTokens.keys()) loadTokens.set(index, (loadTokens.get(index) || 0) + 1);
      pending.clear();
      for (const index of [...resident.keys()]) unload(index);
      release(new Set());
      resident.clear();
      rail.remove();
      mount.classList.remove('lib-page--text-virtual');
    },
  };
}
