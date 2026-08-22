// renderer/modules/library/comic-viewport.js
// Bounded comic reel: render a cheap page skeleton for every page, but only
// materialize the current viewport and a small neighbour window.  This keeps
// CBZ blob URLs and decoded images bounded while preserving a stable scrollbar.

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/**
 * Apply one physical comic scale to both viewport axes.
 *
 * Width-only sizing looks correct for landscape pages, but becomes a no-op for
 * portrait/tall pages once `max-height: 100%` wins the replaced-element sizing
 * algorithm.  The same normalized scale therefore caps both inline and block
 * dimensions.  Scroll mode consumes the inline cap; paged modes consume both.
 */
export function applyComicFitVariables(element, { pageWidth = .7, zoom = 100 } = {}) {
  if (!element?.style?.setProperty) return null;
  const sheet = clamp(Number(pageWidth) || .7, .2, 1);
  const zoomRatio = clamp((Number(zoom) || 100) / 100, .25, 4);
  const renderScale = clamp(sheet * zoomRatio, .2, 1);
  const values = {
    scale: renderScale,
    sheet: `${+(sheet * 100).toFixed(2)}%`,
    render: `${+(renderScale * 100).toFixed(2)}%`,
    zoom: `${+(zoomRatio * 100).toFixed(2)}%`,
  };
  element.style.setProperty('--lib-comic-sheet-width', values.sheet);
  element.style.setProperty('--lib-comic-render-width', values.render);
  element.style.setProperty('--lib-comic-render-block', values.render);
  element.style.setProperty('--lib-comic-zoom', values.zoom);
  return values;
}

export function pageWindow(center, count, before = 2, after = 3) {
  const out = new Set();
  if (!count) return out;
  const c = clamp(Number(center) || 0, 0, count - 1);
  for (let i = Math.max(0, c - before); i <= Math.min(count - 1, c + after); i++) out.add(i);
  return out;
}

/**
 * Virtualized, page-sized vertical comic reel.
 *
 * @param {object} options
 * @param {HTMLElement} options.host scrolling element
 * @param {HTMLElement} options.mount content mount
 * @param {number} options.count page count
 * @param {number} options.initialPage zero-based page
 * @param {(index:number)=>Promise<string>} options.loadPage page URL loader
 * @param {(keep:Set<number>)=>void} [options.releaseOutside] URL/cache release hook
 * @param {(index:number)=>void} [options.onPage] active-page callback
 * @param {()=>boolean} [options.isAlive] session/generation guard
 */
export function createComicViewport({
  host,
  mount,
  count,
  initialPage = 0,
  loadPage,
  releaseOutside = () => {},
  onPage = () => {},
  isAlive = () => true,
}) {
  if (!host || !mount || typeof loadPage !== 'function') throw new Error('comic viewport requires host/mount/loadPage');
  const total = Math.max(0, Number(count) || 0);
  let active = clamp(Number(initialPage) || 0, 0, Math.max(0, total - 1));
  let destroyed = false;
  let frame = 0;
  let loadEpoch = 0;
  let programmaticEpoch = 0;
  let resizeEpoch = 0;
  let resizeReleaseFrame = 0;
  let viewportSlotHeight = 0;
  let viewportInlineSize = 0;
  let stablePageLocator = { page: active, ratio: 0 };
  const resident = new Map();

  mount.replaceChildren();
  mount.classList.add('lib-page--virtual');
  const rail = document.createElement('div');
  rail.className = 'lib-comic-reel';
  rail.setAttribute('role', 'list');
  rail.setAttribute('aria-label', '漫画连续阅读');
  const slots = [];
  for (let i = 0; i < total; i++) {
    const slot = document.createElement('section');
    slot.className = 'lib-comic-slot';
    slot.dataset.i = String(i);
    slot.setAttribute('role', 'listitem');
    slot.setAttribute('aria-label', `第 ${i + 1} 页`);
    const placeholder = document.createElement('span');
    placeholder.className = 'lib-comic-placeholder';
    placeholder.textContent = `${i + 1}`;
    slot.appendChild(placeholder);
    rail.appendChild(slot);
    slots.push(slot);
  }
  mount.appendChild(rail);

  const alive = () => !destroyed && isAlive();
  const slotGeometry = index => {
    const slot = slots[index];
    if (!slot) return null;
    const hostRect = host.getBoundingClientRect?.() || { top: 0 };
    const slotRect = slot.getBoundingClientRect?.() || {};
    const top = Number(slotRect.top) - (Number(hostRect.top) || 0) + (Number(host.scrollTop) || 0);
    const height = Math.max(1, Number(slotRect.height) || viewportSlotHeight || 1);
    return { top: Number.isFinite(top) ? top : 0, height };
  };
  const capturePageLocator = (page = active) => {
    const index = clamp(Number(page) || 0, 0, Math.max(0, total - 1));
    const geometry = slotGeometry(index);
    if (!geometry) return { page: index, ratio: 0 };
    // Ratio is intentionally signed. The active page is selected around the
    // reading line and may begin slightly below the viewport top; retaining a
    // negative ratio preserves that exact visual placement after resize.
    const ratio = clamp(((Number(host.scrollTop) || 0) - geometry.top) / geometry.height, -1, 1);
    return { page: index, ratio };
  };
  const rememberPageLocator = locator => {
    if (!locator || !total) return;
    stablePageLocator = {
      page: clamp(Number(locator.page) || 0, 0, total - 1),
      ratio: clamp(Number(locator.ratio) || 0, -1, 1),
    };
  };
  const restorePageLocator = locator => {
    if (!locator || !total) return;
    const page = clamp(Number(locator.page) || 0, 0, total - 1);
    const geometry = slotGeometry(page);
    if (!geometry) return;
    const ratio = clamp(Number(locator.ratio) || 0, -1, 1);
    host.scrollTop = Math.max(0, geometry.top + ratio * geometry.height);
    active = page;
    rememberPageLocator({ page, ratio });
  };
  const holdPageLocator = locator => {
    if (!locator || !alive() || !total) return false;
    // Geometry-affecting CSS (page width, zoom or viewport height) is committed
    // synchronously before this read. Keep scroll events muted until the
    // locator has been replayed and Chromium has painted two stable frames.
    void rail.offsetHeight;
    const token = ++resizeEpoch;
    restorePageLocator(locator);
    if (resizeReleaseFrame) cancelAnimationFrame(resizeReleaseFrame);
    resizeReleaseFrame = requestAnimationFrame(() => {
      if (!alive()) { resizeReleaseFrame = 0; return; }
      resizeReleaseFrame = requestAnimationFrame(() => {
        if (resizeEpoch === token) resizeEpoch = 0;
        resizeReleaseFrame = 0;
      });
    });
    return true;
  };
  const setViewportGeometry = () => {
    if (!alive()) return;
    const h = Math.max(320, Math.round(host.clientHeight || mount.clientHeight || 720));
    const hostRect = host.getBoundingClientRect?.() || {};
    const w = Math.max(1, Math.round(host.clientWidth || mount.clientWidth || hostRect.width || 1));
    if (h === viewportSlotHeight && w === viewportInlineSize) return;
    const locator = viewportSlotHeight > 0 && viewportInlineSize > 0
      ? { ...stablePageLocator }
      : null;
    rail.style.setProperty('--lib-reader-vh', `${h}px`);
    viewportSlotHeight = h;
    viewportInlineSize = w;
    if (!locator) return;
    // Both axes can reflow portrait pages. Restore from the pre-resize page
    // locator before a width-only or height resize scroll event can reinterpret
    // the old scrollTop against the new placeholder grid.
    holdPageLocator(locator);
  };

  const unloadNode = (index) => {
    const img = resident.get(index);
    if (!img) return;
    resident.delete(index);
    img.removeAttribute('src');
    img.remove();
    slots[index]?.classList.remove('is-loaded');
  };

  const loadNode = async (index, epoch) => {
    if (!alive() || index < 0 || index >= total || resident.has(index)) return;
    const slot = slots[index];
    if (!slot) return;
    slot.classList.add('is-loading');
    try {
      const url = await loadPage(index);
      if (!alive() || epoch !== loadEpoch || !url) return;
      const img = document.createElement('img');
      img.className = 'lib-manga-page';
      img.alt = `第 ${index + 1} 页`;
      img.decoding = 'async';
      img.loading = 'eager';
      img.src = url;
      resident.set(index, img);
      slot.appendChild(img);
      slot.classList.add('is-loaded');
      // decode is advisory: a corrupt page keeps the slot/error affordance alive.
      img.decode?.().catch(() => { slot.classList.add('is-error'); });
    } catch {
      if (alive() && epoch === loadEpoch) slot.classList.add('is-error');
    } finally {
      slot.classList.remove('is-loading');
    }
  };

  const converge = async (next = active) => {
    if (!alive() || !total) return;
    active = clamp(next, 0, total - 1);
    const keep = pageWindow(active, total);
    const epoch = ++loadEpoch;
    for (const i of [...resident.keys()]) if (!keep.has(i)) unloadNode(i);
    // Current page first; neighbours fill in parallel after the visible surface.
    await loadNode(active, epoch);
    if (!alive() || epoch !== loadEpoch) return;
    const neighbours = [...keep].filter(i => i !== active);
    Promise.allSettled(neighbours.map(i => loadNode(i, epoch))).then(() => {
      if (!alive() || epoch !== loadEpoch) return;
      releaseOutside(new Set(resident.keys()));
    });
    releaseOutside(new Set([...resident.keys(), ...keep]));
  };

  const closestPage = () => {
    const hr = host.getBoundingClientRect();
    const y = hr.top + hr.height * .46;
    const x = hr.left + hr.width * .5;
    const hit = document.elementsFromPoint?.(x, y)?.find(el => el.classList?.contains('lib-comic-slot'));
    if (hit) return Number(hit.dataset.i) || 0;
    let best = active, dist = Infinity;
    // Only inspect a bounded neighbourhood during ordinary wheel scrolling.
    const from = Math.max(0, active - 5), to = Math.min(total - 1, active + 5);
    for (let i = from; i <= to; i++) {
      const r = slots[i].getBoundingClientRect();
      const d = Math.abs((r.top + r.bottom) / 2 - y);
      if (d < dist) { dist = d; best = i; }
    }
    return best;
  };

  const onScroll = () => {
    if (!alive() || frame || programmaticEpoch || resizeEpoch) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const next = closestPage();
      rememberPageLocator(capturePageLocator(next));
      if (next === active) return;
      active = next;
      onPage(active);
      converge(active);
    });
  };
  host.addEventListener('scroll', onScroll, { passive: true });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(setViewportGeometry) : null;
  ro?.observe(host);
  setViewportGeometry();
  converge(active);
  requestAnimationFrame(() => slots[active]?.scrollIntoView?.({ block: 'start' }));

  return {
    get activePage() { return active; },
    get residentCount() { return resident.size; },
    captureLocator() {
      if (!alive() || !total) return null;
      const locator = capturePageLocator(active);
      rememberPageLocator(locator);
      return { ...stablePageLocator };
    },
    restoreLocator(locator) {
      return holdPageLocator(locator);
    },
    async goTo(index, { smooth = false } = {}) {
      if (!alive() || !total) return;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      const target = clamp(index, 0, total - 1);
      const token = ++programmaticEpoch;
      active = target;
      rememberPageLocator({ page: target, ratio: 0 });
      await converge(target);
      if (!alive() || programmaticEpoch !== token) return;
      slots[target]?.scrollIntoView?.({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
      active = target;
      rememberPageLocator({ page: target, ratio: 0 });
      onPage(target);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (programmaticEpoch === token) programmaticEpoch = 0;
      }));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loadEpoch++;
      programmaticEpoch++;
      resizeEpoch++;
      if (frame) cancelAnimationFrame(frame);
      if (resizeReleaseFrame) cancelAnimationFrame(resizeReleaseFrame);
      host.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      for (const i of [...resident.keys()]) unloadNode(i);
      releaseOutside(new Set());
      rail.remove();
      mount.classList.remove('lib-page--virtual');
    },
  };
}
