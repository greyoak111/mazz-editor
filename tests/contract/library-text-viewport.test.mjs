import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { createTextViewport, sectionWindow } from '../../renderer/modules/library/text-viewport.js';

const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const settle = async () => {
  await wait(0);
  await new Promise(resolve => requestAnimationFrame(resolve));
  await wait(0);
};

function fixture({ count = 100, initialSection = 0, initialLocator = null, loadSection, releaseOutside, onSection } = {}) {
  const host = document.createElement('div');
  const mount = document.createElement('main');
  host.appendChild(mount);
  document.body.appendChild(host);
  Object.defineProperty(host, 'clientHeight', { value: 600, configurable: true });
  host.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 });
  const loads = [];
  const releases = [];
  const active = [];
  const viewport = createTextViewport({
    host,
    mount,
    count,
    initialSection,
    initialLocator,
    estimateHeight: 600,
    loadSection: loadSection || (async index => {
      loads.push(index);
      const article = document.createElement('article');
      article.dataset.loaded = String(index);
      article.textContent = `section ${index}`;
      return article;
    }),
    getSectionId: index => `spine-${index}`,
    releaseOutside: (ids, indices) => {
      releases.push({ ids: [...ids], indices: [...indices] });
      releaseOutside?.(ids, indices);
    },
    onSection: index => { active.push(index); onSection?.(index); },
  });
  const slots = [...mount.querySelectorAll('.lib-text-slot')];
  const applyGeometry = () => {
    for (const slot of slots) {
      slot.getBoundingClientRect = () => {
        const index = Number(slot.dataset.i);
        const top = index * 600 - host.scrollTop;
        return { top, bottom: top + 600, left: 0, right: 800, width: 800, height: 600 };
      };
    }
  };
  applyGeometry();
  return { host, mount, viewport, slots, loads, releases, active, dispose: () => { viewport.destroy(); host.remove(); } };
}

describe('LibraryTextViewport', () => {
  test('窗口函数边界稳定，默认最多只保留 current ± 1', () => {
    assert.deepEqual([...sectionWindow(0, 100)], [0, 1]);
    assert.deepEqual([...sectionWindow(50, 100)], [49, 50, 51]);
    assert.deepEqual([...sectionWindow(99, 100)], [98, 99]);
    assert.deepEqual([...sectionWindow(3, 0)], []);
  });

  test('100 章首屏与滚过 20 章后常驻内容始终不超过 3', async () => {
    const fx = fixture();
    await settle();
    assert.ok(fx.viewport.residentCount <= 3, `首屏常驻 ${fx.viewport.residentCount}，不得超过 3`);
    assert.deepEqual(fx.viewport.residentIndices, [0, 1]);

    fx.host.scrollTop = 20 * 600;
    fx.host.dispatchEvent(new window.Event('scroll'));
    await settle();
    await settle();
    assert.equal(fx.viewport.activeSection, 20);
    assert.ok(fx.viewport.residentCount <= 3, `第 20 章常驻 ${fx.viewport.residentCount}，不得超过 3`);
    assert.deepEqual(fx.viewport.residentIndices, [19, 20, 21]);
    assert.deepEqual(fx.releases.at(-1).ids, ['spine-19', 'spine-20', 'spine-21']);
    fx.dispose();
  });

  test('旧章节迟到完成也不能写入新的视口代次', async () => {
    let resolveOld;
    const old = new Promise(resolve => { resolveOld = resolve; });
    const fx = fixture({
      count: 20,
      loadSection: async index => {
        if (index === 0) return old;
        const node = document.createElement('article');
        node.dataset.loaded = String(index);
        return node;
      },
    });

    const moved = fx.viewport.goTo(10);
    await settle();
    await moved;
    const stale = document.createElement('article');
    stale.id = 'late-section-zero';
    resolveOld(stale);
    await settle();

    assert.equal(fx.mount.querySelector('#late-section-zero'), null, '迟到的第 0 章不得进入 DOM');
    assert.ok(!fx.viewport.residentIndices.includes(0), '迟到章节不得成为 resident');
    assert.deepEqual(fx.viewport.residentIndices, [9, 10, 11]);
    fx.dispose();
  });

  test('旧视口 destroy 后迟到任务不得用旧 keep 集释放替代视口资源', async () => {
    let resolveRetired;
    const retiredLoad = new Promise(resolve => { resolveRetired = resolve; });
    let sharedResident = new Set();
    const convergeShared = ids => { sharedResident = new Set(ids); };
    const retired = fixture({
      count: 20,
      loadSection: index => index === 0 ? retiredLoad : Promise.resolve(document.createElement('article')),
      releaseOutside: ids => convergeShared(ids),
    });
    await wait(0);
    retired.viewport.destroy();

    const replacement = fixture({
      count: 20,
      initialSection: 10,
      releaseOutside: ids => convergeShared(ids),
    });
    await replacement.viewport.ready;
    await settle();
    assert.deepEqual([...sharedResident], ['spine-9', 'spine-10', 'spine-11']);

    resolveRetired(document.createElement('article'));
    await settle();
    assert.deepEqual([...sharedResident], ['spine-9', 'spine-10', 'spine-11'],
      '退役任务落定不得把 shared EPUB 收敛回旧视口 0/1');
    assert.deepEqual(replacement.viewport.residentIndices, [9, 10, 11]);
    retired.host.remove();
    replacement.dispose();
  });

  test('卸载使用实测高度回填占位，长章节离场后总高度不坍塌', async () => {
    const fx = fixture({ count: 8 });
    fx.slots[0].getBoundingClientRect = () => ({ top: 0, bottom: 960, left: 0, right: 800, width: 800, height: 960 });
    await fx.viewport.ready;
    const before = fx.viewport.estimatedTotalHeight;
    await fx.viewport.goTo(4);
    await settle();

    assert.equal(fx.slots[0].style.height, '960px', '已卸载长章节必须保留实测块高');
    assert.ok(fx.viewport.estimatedTotalHeight >= before, '卸载不得让高度账本倒退');
    assert.ok(fx.viewport.estimatedTotalHeight >= 8 * 600 + 360, '长章节额外高度必须进入稳定账本');
    fx.dispose();
  });

  test('连续阅读定位器保存章节内比例，重建后恢复同一视口顶点', async () => {
    const first = fixture({ count: 8 });
    await first.viewport.ready;
    first.host.scrollTop = 2 * 600 + 270;
    first.host.dispatchEvent(new window.Event('scroll'));
    await settle();

    const locator = first.viewport.captureLocator();
    assert.equal(locator.section, 2);
    assert.equal(locator.sectionId, 'spine-2');
    assert.ok(Math.abs(locator.ratio - 0.45) <= 0.001, `章内比例应为 0.45，实际 ${locator.ratio}`);
    assert.ok(Math.abs(locator.progression - 0.30625) <= 0.001,
      `全书滚动比例应保留章内位置，实际 ${locator.progression}`);
    first.dispose();

    const restored = fixture({ count: 8, initialSection: 0, initialLocator: locator });
    assert.equal(await restored.viewport.ready, true);
    assert.equal(restored.host.scrollTop, 2 * 600 + 270);
    const roundTrip = restored.viewport.captureLocator();
    assert.equal(roundTrip.sectionId, 'spine-2');
    assert.ok(Math.abs(roundTrip.ratio - locator.ratio) <= 0.001);
    restored.dispose();
  });

  test('稳定 sectionId 优先于旧数字下标，目录改序后仍恢复同一章节', async () => {
    const host = document.createElement('div');
    const mount = document.createElement('main');
    host.appendChild(mount);
    document.body.appendChild(host);
    Object.defineProperty(host, 'clientHeight', { value: 600, configurable: true });
    const ids = ['new-preface', 'chapter-a', 'chapter-b'];
    const viewport = createTextViewport({
      host, mount, count: ids.length, initialSection: 1,
      initialLocator: { section: 1, sectionId: 'chapter-b', ratio: 0.25 },
      estimateHeight: 600,
      getSectionId: index => ids[index],
      loadSection: async index => {
        const node = document.createElement('article');
        node.textContent = ids[index];
        return node;
      },
    });
    for (const slot of mount.querySelectorAll('.lib-text-slot')) {
      slot.getBoundingClientRect = () => {
        const index = Number(slot.dataset.i);
        const top = index * 600 - host.scrollTop;
        return { top, bottom: top + 600, left: 0, right: 800, width: 800, height: 600 };
      };
    }
    assert.equal(await viewport.ready, true);
    assert.equal(host.scrollTop, 2 * 600 + 150, 'sectionId 应把旧下标 1 重映射到新下标 2');
    assert.equal(viewport.captureLocator().sectionId, 'chapter-b');
    viewport.destroy();
    host.remove();
  });

  test('iframe body 作为根滚动宿主时使用视口坐标，不会粘死第一章', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const frameDocument = frame.contentDocument;
    const host = frameDocument.body;
    Object.defineProperty(host, 'clientHeight', { value: 600, configurable: true });
    host.getBoundingClientRect = () => ({
      top: -host.scrollTop, bottom: 2400 - host.scrollTop,
      left: 0, right: 800, width: 800, height: 2400,
    });
    const viewport = createTextViewport({
      host, mount: host, count: 4,
      initialLocator: { section: 2, sectionId: 'root-2', ratio: 0.4 },
      estimateHeight: 600,
      getSectionId: index => `root-${index}`,
      loadSection: async index => {
        const node = frameDocument.createElement('article');
        node.textContent = `root section ${index}`;
        return node;
      },
    });
    for (const slot of host.querySelectorAll('.lib-text-slot')) {
      slot.getBoundingClientRect = () => {
        const index = Number(slot.dataset.i);
        const top = index * 600 - host.scrollTop;
        return { top, bottom: top + 600, left: 0, right: 800, width: 800, height: 600 };
      };
    }
    assert.equal(await viewport.ready, true);
    const locator = viewport.captureLocator();
    assert.equal(locator.sectionId, 'root-2');
    assert.ok(Math.abs(locator.ratio - 0.4) <= 0.001,
      `根滚动宿主不应把移动的 body rect 当视口顶端：${JSON.stringify(locator)}`);
    viewport.destroy();
    frame.remove();
  });

  test('standards iframe 把 body 内容挂到 document.scrollingElement，并从真实根恢复定位', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const frameDocument = frame.contentDocument;
    const mount = frameDocument.body;
    const root = frameDocument.documentElement;
    Object.defineProperty(frameDocument, 'scrollingElement', { value: root, configurable: true });
    Object.defineProperty(root, 'clientHeight', { value: 600, configurable: true });
    root.scrollTop = 0;

    const viewport = createTextViewport({
      // Exercise the compatibility path too: callers that still pass body
      // must be redirected to the document's authoritative root scroller.
      host: mount,
      mount,
      count: 4,
      initialLocator: { section: 2, sectionId: 'chapter-03', ratio: 0.45 },
      estimateHeight: 600,
      getSectionId: index => `chapter-0${index + 1}`,
      loadSection: async index => {
        const node = frameDocument.createElement('article');
        node.textContent = `root chapter ${index}`;
        return node;
      },
    });
    for (const slot of mount.querySelectorAll('.lib-text-slot')) {
      slot.getBoundingClientRect = () => {
        const index = Number(slot.dataset.i);
        const top = index * 600 - root.scrollTop;
        return { top, bottom: top + 600, left: 0, right: 800, width: 800, height: 600 };
      };
    }

    assert.equal(await viewport.ready, true);
    assert.equal(root.scrollTop, 2 * 600 + 270, '定位必须写入 document.scrollingElement');
    assert.equal(mount.scrollTop, 0, 'body 不是 standards-mode 的位置账本');
    const locator = viewport.captureLocator();
    assert.equal(locator.sectionId, 'chapter-03');
    assert.ok(Math.abs(locator.ratio - 0.45) <= 0.001, JSON.stringify(locator));

    root.scrollTop = 600;
    frameDocument.dispatchEvent(new frame.contentWindow.Event('scroll'));
    await settle();
    assert.equal(viewport.activeSection, 1, 'document scroll 事件必须驱动虚拟视口收敛');
    viewport.destroy();
    frame.remove();
  });

  test('destroy 幂等：监听、迟到请求、DOM 与资源常驻全部收敛为零', async () => {
    let resolvePending;
    const pending = new Promise(resolve => { resolvePending = resolve; });
    const emptyReleases = [];
    const fx = fixture({
      count: 3,
      loadSection: index => index === 0 ? pending : Promise.resolve(document.createElement('article')),
      releaseOutside: (ids, indices) => { if (!ids.size && !indices.size) emptyReleases.push(true); },
    });
    assert.equal(fx.viewport.pendingCount, 1);
    fx.viewport.destroy();
    fx.viewport.destroy();
    resolvePending(document.createElement('article'));
    await settle();

    assert.equal(fx.viewport.destroyed, true);
    assert.equal(fx.viewport.residentCount, 0);
    assert.equal(fx.viewport.pendingCount, 0);
    assert.equal(fx.mount.querySelector('.lib-text-reel'), null);
    assert.equal(emptyReleases.length, 1, '资源清零回调只应执行一次');
    fx.host.remove();
  });
});
