// renderer/modules/library/comic-viewport.js
// Bounded comic reel: render a cheap page skeleton for every page, but only
// materialize the current viewport and a small neighbour window.  This keeps
// CBZ blob URLs and decoded images bounded while preserving a stable scrollbar.

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

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
  const setViewportHeight = () => {
    if (!alive()) return;
    const h = Math.max(320, Math.round(host.clientHeight || mount.clientHeight || 720));
    rail.style.setProperty('--lib-reader-vh', `${h}px`);
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
    if (!alive() || frame || programmaticEpoch) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const next = closestPage();
      if (next === active) return;
      active = next;
      onPage(active);
      converge(active);
    });
  };
  host.addEventListener('scroll', onScroll, { passive: true });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(setViewportHeight) : null;
  ro?.observe(host);
  setViewportHeight();
  converge(active);
  requestAnimationFrame(() => slots[active]?.scrollIntoView?.({ block: 'start' }));

  return {
    get activePage() { return active; },
    get residentCount() { return resident.size; },
    async goTo(index, { smooth = false } = {}) {
      if (!alive() || !total) return;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      const target = clamp(index, 0, total - 1);
      const token = ++programmaticEpoch;
      active = target;
      await converge(target);
      if (!alive() || programmaticEpoch !== token) return;
      slots[target]?.scrollIntoView?.({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
      active = target;
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
      if (frame) cancelAnimationFrame(frame);
      host.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      for (const i of [...resident.keys()]) unloadNode(i);
      releaseOutside(new Set());
      rail.remove();
      mount.classList.remove('lib-page--virtual');
    },
  };
}
