// W89b reader stability RED gates.
//
// This suite is intentionally not registered in tests/run.js yet.  It models
// the two resize races that used to be hidden by happy-path E2E checks:
//   1. a reflowable section above the reading point changes height;
//   2. every placeholder in the comic reel changes with viewport height.
// Product owners can run it directly while converging the implementation, then
// register it only after the Source and Packaged gates are green.
import './_setup.mjs';
import { readFileSync } from 'node:fs';
import { describe, test, assert } from '../harness.mjs';
import {
  applyComicFitVariables,
  createComicViewport,
} from '../../renderer/modules/library/comic-viewport.js';
import { createTextViewport } from '../../renderer/modules/library/text-viewport.js';
import {
  advancePhysicalPage,
  normalizeReaderMode,
  spreadOffsetForPhysicalPage,
} from '../../renderer/modules/library/reader-pagination.js';

const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const settle = async () => {
  await wait(0);
  await frame();
  await frame();
  await wait(0);
};

class ManualResizeObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    ManualResizeObserver.instances.push(this);
  }

  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }

  fire(targets = [...this.targets]) {
    const entries = targets
      .filter(target => this.targets.has(target))
      .map(target => ({ target, contentRect: target.getBoundingClientRect?.() || {} }));
    if (entries.length) this.callback(entries, this);
  }

  static fireAll(targets) {
    for (const observer of ManualResizeObserver.instances) observer.fire(targets);
  }
}

async function withManualResizeObserver(operation) {
  const previous = globalThis.ResizeObserver;
  ManualResizeObserver.instances = [];
  globalThis.ResizeObserver = ManualResizeObserver;
  try {
    return await operation();
  } finally {
    globalThis.ResizeObserver = previous;
    ManualResizeObserver.instances = [];
  }
}

const rect = ({ top = 0, left = 0, width = 800, height = 600 } = {}) => ({
  x: left,
  y: top,
  top,
  left,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe('W89b Library reader · resize/locator stability', () => {
  test('continuous text preserves sectionId and in-section ratio when measured heights above it reflow', async () => {
    await withManualResizeObserver(async () => {
      const host = document.createElement('div');
      const mount = document.createElement('main');
      host.appendChild(mount);
      document.body.appendChild(host);
      const layoutHeights = Array(10).fill(600);
      Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => 600 });
      host.getBoundingClientRect = () => rect({ height: 600 });

      const viewport = createTextViewport({
        host,
        mount,
        count: layoutHeights.length,
        initialLocator: { section: 5, sectionId: 'chapter-06', ratio: 0.4 },
        estimateHeight: 600,
        getSectionId: index => `chapter-${String(index + 1).padStart(2, '0')}`,
        loadSection: async index => {
          const article = document.createElement('article');
          article.textContent = `chapter ${index}`;
          return article;
        },
      });
      const slots = [...mount.querySelectorAll('.lib-text-slot')];
      const topOf = index => layoutHeights.slice(0, index).reduce((sum, height) => sum + height, 0);
      for (const slot of slots) {
        slot.getBoundingClientRect = () => {
          const index = Number(slot.dataset.i);
          return rect({ top: topOf(index) - host.scrollTop, height: layoutHeights[index] });
        };
      }

      assert.equal(await viewport.ready, true);
      const before = viewport.captureLocator();
      assert.equal(before.sectionId, 'chapter-06');
      assert.ok(Math.abs(before.ratio - 0.4) <= 0.001, JSON.stringify(before));

      // Responsive typography made the resident predecessor 300 px taller and
      // the active section 120 px taller.  The content changes before RO runs,
      // exactly as it does in Chromium.
      layoutHeights[4] = 900;
      layoutHeights[5] = 720;
      const cachedBeforeObserver = viewport.captureStableLocator();
      assert.equal(cachedBeforeObserver.sectionId, before.sectionId);
      assert.ok(Math.abs(cachedBeforeObserver.ratio - before.ratio) <= 0.001,
        'post-layout callers must retrieve the pre-change stable locator');
      ManualResizeObserver.fireAll([slots[4], slots[5]]);
      await settle();

      const after = viewport.captureLocator();
      assert.equal(after.sectionId, before.sectionId,
        `predecessor reflow changed the logical section: ${JSON.stringify({ before, after })}`);
      assert.ok(Math.abs(after.ratio - before.ratio) <= 0.01,
        `reflow changed the in-section locator: ${JSON.stringify({ before, after })}`);
      const expectedTop = layoutHeights.slice(0, 5).reduce((sum, height) => sum + height, 0)
        + layoutHeights[5] * before.ratio;
      assert.ok(Math.abs(host.scrollTop - expectedTop) <= 2,
        `scrollTop was not compensated from the canonical locator: ${host.scrollTop} != ${expectedTop}`);

      viewport.destroy();
      host.remove();
    });
  });

  test('continuous refresh mutes stale scroll interpretation and replays its supplied locator', async () => {
    await withManualResizeObserver(async () => {
      const host = document.createElement('div');
      const mount = document.createElement('main');
      host.appendChild(mount);
      document.body.appendChild(host);
      const layoutHeights = Array(8).fill(600);
      Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => 600 });
      host.getBoundingClientRect = () => rect({ height: 600 });
      const viewport = createTextViewport({
        host, mount, count: 8,
        initialLocator: { section: 4, sectionId: 's4', ratio: .35 },
        estimateHeight: 600,
        getSectionId: index => `s${index}`,
        loadSection: async index => ({ html: `<p>section ${index}</p>` }),
      });
      const slots = [...mount.querySelectorAll('.lib-text-slot')];
      const topOf = index => layoutHeights.slice(0, index).reduce((sum, height) => sum + height, 0);
      for (const slot of slots) {
        slot.getBoundingClientRect = () => {
          const index = Number(slot.dataset.i);
          return rect({ top: topOf(index) - host.scrollTop, height: layoutHeights[index] });
        };
      }
      assert.equal(await viewport.ready, true);
      const locator = viewport.captureStableLocator();
      layoutHeights[3] = 840;
      layoutHeights[4] = 780;
      viewport.refresh({ locator });
      await settle();
      const after = viewport.captureLocator();
      assert.equal(after.sectionId, locator.sectionId);
      assert.ok(Math.abs(after.ratio - locator.ratio) <= .01, JSON.stringify({ locator, after }));
      assert.ok(Math.abs(host.scrollTop - (topOf(4) + 780 * .35)) <= 2);
      viewport.destroy();
      host.remove();
    });
  });

  test('loaded text slots remeasure natural height and shrink on narrow to wide reflow', async () => {
    await withManualResizeObserver(async () => {
      const host = document.createElement('div');
      const mount = document.createElement('main');
      host.appendChild(mount);
      document.body.appendChild(host);
      const naturalHeights = [600, 600, 960, 600, 600];
      Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => 600 });
      host.getBoundingClientRect = () => rect({ height: 600 });

      const viewport = createTextViewport({
        host, mount, count: naturalHeights.length,
        initialLocator: { section: 2, sectionId: 's2', ratio: .4 },
        estimateHeight: 600,
        getSectionId: index => `s${index}`,
        loadSection: async index => ({ html: `<p>section ${index}</p>` }),
      });
      const slots = [...mount.querySelectorAll('.lib-text-slot')];
      const cssPixels = value => Math.max(0, Number.parseFloat(value) || 0);
      const effectiveHeight = index => Math.max(
        naturalHeights[index],
        cssPixels(slots[index].style.height),
        cssPixels(slots[index].style.minHeight),
      );
      const topOf = index => slots.slice(0, index).reduce((sum, _, slotIndex) => sum + effectiveHeight(slotIndex), 0);
      for (const slot of slots) {
        const index = Number(slot.dataset.i);
        slot.getBoundingClientRect = () => rect({
          top: topOf(index) - host.scrollTop,
          height: effectiveHeight(index),
        });
        Object.defineProperty(slot, 'scrollHeight', { configurable: true, get: () => effectiveHeight(index) });
        Object.defineProperty(slot, 'offsetHeight', { configurable: true, get: () => effectiveHeight(index) });
      }

      assert.equal(await viewport.ready, true);
      await settle();
      const slot = slots[2];
      const content = slot.querySelector('.lib-text-section-content');
      Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => naturalHeights[2] });
      content.getBoundingClientRect = () => rect({ height: naturalHeights[2] });
      const narrow = {
        slot: slot.getBoundingClientRect().height,
        content: content.getBoundingClientRect().height,
        locator: viewport.captureStableLocator(),
      };
      assert.ok(Math.abs(narrow.slot - narrow.content) <= 1, JSON.stringify(narrow));

      naturalHeights[2] = 480;
      const wideLocator = viewport.captureStableLocator();
      viewport.refresh({ locator: wideLocator });
      await settle();
      const wide = {
        slot: slot.getBoundingClientRect().height,
        content: content.getBoundingClientRect().height,
        locator: viewport.captureLocator(),
      };
      assert.ok(wide.slot < narrow.slot - 300,
        `old minHeight prevented shrink: ${JSON.stringify({ narrow, wide })}`);
      assert.ok(Math.abs(wide.slot - wide.content) <= 1,
        `slot must converge to natural content height: ${JSON.stringify(wide)}`);
      assert.equal(wide.locator.sectionId, narrow.locator.sectionId);
      assert.ok(Math.abs(wide.locator.ratio - narrow.locator.ratio) <= .01,
        JSON.stringify({ narrow, wide }));

      naturalHeights[2] = 840;
      const narrowAgainLocator = viewport.captureStableLocator();
      viewport.refresh({ locator: narrowAgainLocator });
      await settle();
      const narrowAgain = {
        slot: slot.getBoundingClientRect().height,
        content: content.getBoundingClientRect().height,
        locator: viewport.captureLocator(),
      };
      assert.ok(narrowAgain.slot > wide.slot + 300,
        `narrow reflow did not grow again: ${JSON.stringify({ wide, narrowAgain })}`);
      assert.ok(Math.abs(narrowAgain.slot - narrowAgain.content) <= 1,
        `remeasured slot diverged from content: ${JSON.stringify(narrowAgain)}`);
      assert.equal(narrowAgain.locator.sectionId, narrow.locator.sectionId);
      assert.ok(Math.abs(narrowAgain.locator.ratio - narrow.locator.ratio) <= .01,
        JSON.stringify({ narrow, narrowAgain }));

      viewport.destroy();
      host.remove();
    });
  });

  test('comic viewport keeps the active page pinned when viewport-height placeholders resize', async () => {
    await withManualResizeObserver(async () => {
      const host = document.createElement('div');
      const mount = document.createElement('main');
      host.appendChild(mount);
      document.body.appendChild(host);
      let viewportHeight = 600;
      const gap = 18;
      Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => viewportHeight });
      host.getBoundingClientRect = () => rect({ height: viewportHeight });
      const pageEvents = [];

      const viewport = createComicViewport({
        host,
        mount,
        count: 20,
        initialPage: 0,
        loadPage: async index => `data:image/png;base64,page-${index}`,
        onPage: index => pageEvents.push(index),
      });
      const slots = [...mount.querySelectorAll('.lib-comic-slot')];
      const stride = () => viewportHeight + gap;
      for (const slot of slots) {
        const index = Number(slot.dataset.i);
        slot.getBoundingClientRect = () => rect({
          top: index * stride() - host.scrollTop,
          height: viewportHeight,
        });
        slot.scrollIntoView = () => { host.scrollTop = index * stride(); };
      }
      await settle();
      await viewport.goTo(7);
      await settle();
      assert.equal(viewport.activePage, 7);
      // Preserve a real in-page reading point, not only a page-aligned top.
      host.scrollTop = 7 * stride() + viewportHeight * 0.4;
      host.dispatchEvent(new window.Event('scroll'));
      await settle();
      assert.equal(viewport.activePage, 7);
      pageEvents.length = 0;

      viewportHeight = 420;
      ManualResizeObserver.fireAll([host]);
      await settle();
      host.dispatchEvent(new window.Event('scroll'));
      await settle();

      assert.equal(viewport.activePage, 7,
        `viewport resize silently selected another page (scrollTop=${host.scrollTop})`);
      const expected = 7 * stride() + viewportHeight * 0.4;
      assert.ok(Math.abs(host.scrollTop - expected) <= 2,
        `active page ratio was not pinned after placeholder resize: ${host.scrollTop} != ${expected}`);
      assert.deepEqual(pageEvents, [], 'a pure resize must not emit a user page change');

      viewport.destroy();
      host.remove();
    });
  });

  test('comic page-width reflow replays the pre-change active page and in-page ratio', async () => {
    await withManualResizeObserver(async () => {
      const host = document.createElement('div');
      const mount = document.createElement('main');
      host.appendChild(mount);
      document.body.appendChild(host);
      const gap = 18;
      let pageHeight = 600;
      Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => 600 });
      host.getBoundingClientRect = () => rect({ height: 600 });
      const pageEvents = [];
      const viewport = createComicViewport({
        host,
        mount,
        count: 20,
        initialPage: 0,
        loadPage: async index => `data:image/png;base64,page-${index}`,
        onPage: index => pageEvents.push(index),
      });
      const slots = [...mount.querySelectorAll('.lib-comic-slot')];
      const stride = () => pageHeight + gap;
      for (const slot of slots) {
        const index = Number(slot.dataset.i);
        slot.getBoundingClientRect = () => rect({
          top: index * stride() - host.scrollTop,
          height: pageHeight,
        });
        slot.scrollIntoView = () => { host.scrollTop = index * stride(); };
      }

      await settle();
      await viewport.goTo(7);
      await settle();
      host.scrollTop = 7 * stride() + pageHeight * 0.4;
      host.dispatchEvent(new window.Event('scroll'));
      await settle();
      const preChange = viewport.captureLocator();
      assert.equal(preChange.page, 7);
      assert.ok(Math.abs(preChange.ratio - 0.4) <= 0.001, JSON.stringify(preChange));
      pageEvents.length = 0;

      // A width change makes a portrait page taller before product replays the
      // captured locator. The old scrollTop now points at page 4 without this
      // explicit transaction.
      pageHeight = 900;
      assert.equal(viewport.restoreLocator(preChange), true);
      await settle();
      assert.equal(viewport.activePage, 7);
      assert.ok(Math.abs(host.scrollTop - (7 * stride() + pageHeight * 0.4)) <= 2,
        `page-width reflow lost page/ratio: ${JSON.stringify({ preChange, scrollTop: host.scrollTop })}`);
      assert.deepEqual(pageEvents, [], 'geometry replay must not emit a user page change');

      viewport.destroy();
      host.remove();
    });
  });

  test('comic host width-only ResizeObserver keeps the active page pinned', async () => {
    await withManualResizeObserver(async () => {
      const host = document.createElement('div');
      const mount = document.createElement('main');
      host.appendChild(mount);
      document.body.appendChild(host);
      let viewportWidth = 1_268;
      const viewportHeight = 612;
      const gap = 18;
      const pageHeight = () => viewportWidth > 1_000 ? 900 : 640;
      Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => viewportHeight });
      Object.defineProperty(host, 'clientWidth', { configurable: true, get: () => viewportWidth });
      host.getBoundingClientRect = () => rect({ width: viewportWidth, height: viewportHeight });
      const viewport = createComicViewport({
        host, mount, count: 20, initialPage: 0,
        loadPage: async index => `data:image/png;base64,page-${index}`,
      });
      const slots = [...mount.querySelectorAll('.lib-comic-slot')];
      const stride = () => pageHeight() + gap;
      for (const slot of slots) {
        const index = Number(slot.dataset.i);
        slot.getBoundingClientRect = () => rect({
          top: index * stride() - host.scrollTop,
          height: pageHeight(), width: viewportWidth,
        });
        slot.scrollIntoView = () => { host.scrollTop = index * stride(); };
      }
      await settle();
      await viewport.goTo(7);
      await settle();
      host.scrollTop = 7 * stride() + pageHeight() * .3;
      host.dispatchEvent(new window.Event('scroll'));
      await settle();
      const locator = viewport.captureLocator();
      assert.equal(locator.page, 7);
      assert.ok(Math.abs(locator.ratio - .3) <= .001, JSON.stringify(locator));

      viewportWidth = 900;
      ManualResizeObserver.fireAll([host]);
      await settle();
      assert.equal(viewport.activePage, 7);
      assert.ok(Math.abs(host.scrollTop - (7 * stride() + pageHeight() * .3)) <= 2,
        `width-only shrink drifted the active page: ${host.scrollTop}`);

      viewportWidth = 1_268;
      ManualResizeObserver.fireAll([host]);
      await settle();
      assert.equal(viewport.activePage, 7);
      assert.ok(Math.abs(host.scrollTop - (7 * stride() + pageHeight() * .3)) <= 2,
        `width-only restore drifted the active page: ${host.scrollTop}`);
      viewport.destroy();
      host.remove();
    });
  });
});

describe('W89b Library reader · product decisions', () => {
  test('double spread cursor advances exactly one physical page and alternates parity', () => {
    assert.equal(advancePhysicalPage(6, 1, 20), 7);
    assert.equal(advancePhysicalPage(7, -1, 20), 6);
    assert.equal(advancePhysicalPage(19, 1, 20), 19, 'last page must clamp');
    assert.equal(advancePhysicalPage(0, -1, 20), 0, 'first page must clamp');
    assert.notEqual(
      spreadOffsetForPhysicalPage(6, { coverSingle: true }),
      spreadOffsetForPhysicalPage(7, { coverSingle: true }),
      'N/N+1 → N+1/N+2 requires alternating spread parity',
    );
  });

  test('unfinished vertical prototype is migrated to supported single mode', () => {
    assert.equal(normalizeReaderMode('vertical'), 'single');
    assert.equal(normalizeReaderMode('VERTICAL'), 'single');
    assert.equal(normalizeReaderMode('double'), 'double');
  });

  test('collapsed progress remains an in-flow compact seek surface', () => {
    const css = readFileSync(new URL('../../renderer/styles/base.css', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');
    const base = css.match(/\.lib-progress\s*\{([^}]+)\}/)?.[1] || '';
    const rule = css.match(/\.lib-progress\.collapsed\s*\{([^}]+)\}/)?.[1] || '';
    assert.ok(rule, 'missing collapsed progress rule');
    assert.match(base, /flex\s*:\s*0 0 43px/);
    assert.match(base, /height\s*:\s*43px/);
    assert.match(base, /min-height\s*:\s*43px/);
    assert.match(base, /max-height\s*:\s*43px/);
    assert.ok(!/display\s*:\s*none/i.test(rule), 'collapsed progress must retain its flex slot');
    assert.doesNotMatch(rule, /visibility\s*:\s*hidden|opacity\s*:\s*0|translateY|pointer-events\s*:\s*none/);
    assert.match(css, /\.lib-progress\.collapsed \.lib-progress-nav\s*\{\s*display:\s*none/);
    assert.match(css, /\.lib-progress\.collapsed \.lib-progress-toggle[^}]*min-width:\s*68px/);
    assert.match(css, /\.lib-prog-track[^}]*min-width:\s*48px/);
    assert.ok(source.includes('role="slider" tabindex="0"'));
    assert.ok(source.includes('lib-pos-location') && source.includes('lib-pos-percent'));
    assert.ok(source.includes("aria-expanded', String(!collapsed)"));
    assert.ok(!source.includes('lib-progress-peek'));
  });

  test('paged seek maps whole-book percentage to a stable section locator', () => {
    const source = readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');
    assert.ok(source.includes("ctl._pendingAnchor = { kind: 'dom-text', m: section, r: within }"));
    assert.ok(source.includes('const scaled = targetRatio * total'));
    assert.ok(source.includes('const anchor = ctl._captureStableAnchor?.() || captureAnchor()'));
    assert.ok(source.includes('commitProgress(Math.round((section + within) / total * 100)'));
    assert.ok(!source.includes('Math.round(targetRatio * (screens - 1)) * step'),
      'temporary chapter rail screen count must never masquerade as whole-book seek');
  });

  test('tall comic fit changes both DOM axis caps between 50% and 100%', () => {
    const page = document.createElement('div');
    const narrow = applyComicFitVariables(page, { pageWidth: .5, zoom: 100 });
    assert.equal(narrow.scale, .5);
    assert.equal(page.style.getPropertyValue('--lib-comic-render-width'), '50%');
    assert.equal(page.style.getPropertyValue('--lib-comic-render-block'), '50%');

    const wide = applyComicFitVariables(page, { pageWidth: 1, zoom: 100 });
    assert.equal(wide.scale, 1);
    assert.equal(page.style.getPropertyValue('--lib-comic-render-width'), '100%');
    assert.equal(page.style.getPropertyValue('--lib-comic-render-block'), '100%');

    // CSS `contain` sizing for a 2:3 portrait page in a 1000x700 viewport:
    // both axes are bounded by the same product scale, so height cannot remain
    // pinned at 700 px when the user selects 50%.
    const fittedHeight = scale => 1_500 * Math.min((1_000 * scale) / 1_000, (700 * scale) / 1_500);
    assert.equal(fittedHeight(narrow.scale), 350);
    assert.equal(fittedHeight(wide.scale), 700);
  });
});
