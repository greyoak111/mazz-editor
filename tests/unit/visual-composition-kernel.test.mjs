import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { VisualCompositionKernel, normalizeBounds } = require('../../main/visual-composition-kernel.js');

describe('W87 VisualCompositionKernel', () => {
  test('Surface 注册、几何归一与生命周期为单一真源', () => {
    let now = 100;
    const kernel = new VisualCompositionKernel({ now: () => ++now });
    const surface = kernel.registerSurface({
      id: 'view:tab-1', kind: 'web-contents-view', layer: 'native-content', owner: 'browser-tab:tab-1',
      hostWindowId: 7, bounds: { x: 1.4, y: 2.6, width: 320.2, height: 180.7 },
    });
    assert.deepEqual(surface.bounds, { x: 1, y: 3, width: 320, height: 181 });
    assert.equal(kernel.snapshot().surfaceCount, 1);
    kernel.updateSurface('view:tab-1', { desiredVisible: false, visible: false });
    assert.equal(kernel.snapshot().surfaces[0].desiredVisible, false);
    assert.equal(kernel.unregisterSurface('view:tab-1'), true);
    assert.equal(kernel.snapshot().surfaceCount, 0);
    assert.equal(normalizeBounds({ x: NaN, y: 0, width: 1, height: 1 }), null);
  });

  test('多 Overlay 令牌按宿主引用计数，来源退出必收尸', () => {
    const kernel = new VisualCompositionKernel();
    kernel.beginOverlay({ token: 'a', kind: 'modal', hostWindowId: 7, sourceWebContentsId: 70 });
    kernel.beginOverlay({ token: 'b', kind: 'palette', hostWindowId: 7, sourceWebContentsId: 70 });
    kernel.beginOverlay({ token: 'c', kind: 'modal', hostWindowId: 8, sourceWebContentsId: 80 });
    assert.deepEqual(kernel.occlusionState(7), { hostWindowId: 7, occluded: true, tokens: ['a', 'b'] });
    assert.equal(kernel.endOverlay('a').occluded, true, '同宿主仍有第二个弹层时不得抢先恢复 Surface');
    assert.equal(kernel.endOverlay('b').occluded, false);
    assert.equal(kernel.snapshot().occludedHostCount, 1);
    const cleaned = kernel.endOverlaysBySource(80);
    assert.equal(cleaned[0].occluded, false);
    assert.equal(kernel.snapshot().surfaceCount, 0);
  });

  test('非法 kind、空 token 与无宿主 Overlay fail closed', () => {
    const kernel = new VisualCompositionKernel();
    assert.throws(() => kernel.registerSurface({ id: 'bad', kind: 'universal-god-surface' }), /unsupported/);
    assert.throws(() => kernel.beginOverlay({ token: '', hostWindowId: 1 }), /required/);
    assert.throws(() => kernel.beginOverlay({ token: 'x', hostWindowId: 0 }), /required/);
  });
});
