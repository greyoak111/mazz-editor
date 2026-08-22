// W88 Library comic spread planner: deterministic LTR/RTL pairing, cover and
// parity shifts, wide-page ownership, split crops, blanks, and navigation.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { planSpread } from '../../renderer/modules/library/spread-planner.js';

const indices = plan => plan.pages.map(item => item.index);

describe('W88 Library · spread planner basic order', () => {
  test('LTR/RTL only alter visual order; source navigation remains increasing', () => {
    const ltr = planSpread({ count: 6, index: 2, mode: 'double', direction: 'ltr' });
    const rtl = planSpread({ count: 6, index: 2, mode: 'double', direction: 'rtl' });

    assert.deepEqual(indices(ltr), [2, 3]);
    assert.deepEqual(indices(rtl), [3, 2]);
    assert.deepEqual(rtl.readingPages.map(item => item.index), [2, 3]);
    assert.equal(ltr.prevIndex, 0);
    assert.equal(ltr.nextIndex, 4);
    assert.equal(rtl.prevIndex, 0);
    assert.equal(rtl.nextIndex, 4);
  });

  test('single mode clamps index and advances one source page at a time', () => {
    const first = planSpread({ count: 3, index: -9, mode: 'single', direction: 'rtl' });
    const last = planSpread({ count: 3, index: 99, mode: 'single' });
    assert.deepEqual(first.pageIndices, [0]);
    assert.equal(first.prevIndex, null);
    assert.equal(first.nextIndex, 1);
    assert.deepEqual(last.pageIndices, [2]);
    assert.equal(last.prevIndex, 1);
    assert.equal(last.nextIndex, null);
  });

  test('empty source has explicit two-sided empty blank semantics', () => {
    const plan = planSpread({ count: 0, index: 4, mode: 'double' });
    assert.equal(plan.layout, 'empty');
    assert.equal(plan.index, null);
    assert.deepEqual(plan.pageIndices, []);
    assert.deepEqual(plan.blank, {
      left: true, right: true, any: true,
      reasons: { left: 'empty', right: 'empty' },
    });
  });
});
describe('W88 Library · cover, tail and alignment blanks', () => {
  test('cover single occupies closing edge in LTR and RTL', () => {
    const ltr = planSpread({ count: 5, index: 0, mode: 'double', direction: 'ltr', coverSingle: true });
    const rtl = planSpread({ count: 5, index: 0, mode: 'double', direction: 'rtl', coverSingle: true });
    assert.equal(ltr.slots.left.kind, 'blank');
    assert.equal(ltr.slots.left.reason, 'cover-single');
    assert.equal(ltr.slots.right.index, 0);
    assert.equal(rtl.slots.left.index, 0);
    assert.equal(rtl.slots.right.reason, 'cover-single');
    assert.equal(ltr.nextIndex, 1);
    assert.deepEqual(planSpread({ count: 5, index: 2, mode: 'double', coverSingle: true }).pageIndices, [1, 2]);
  });

  test('odd tail occupies the reading-start slot with an explicit blank', () => {
    const ltr = planSpread({ count: 5, index: 4, mode: 'double', direction: 'ltr' });
    const rtl = planSpread({ count: 5, index: 4, mode: 'double', direction: 'rtl' });
    assert.equal(ltr.slots.left.index, 4);
    assert.equal(ltr.slots.right.reason, 'unpaired-tail');
    assert.equal(rtl.slots.left.reason, 'unpaired-tail');
    assert.equal(rtl.slots.right.index, 4);
    assert.equal(ltr.nextIndex, null);
    assert.equal(ltr.prevIndex, 2);
  });

  test('offset toggles pair parity instead of mutating source indices', () => {
    const shifted = planSpread({ count: 6, index: 0, mode: 'double', offset: 1 });
    assert.equal(shifted.layout, 'singleton');
    assert.equal(shifted.blank.reasons.left, 'alignment-offset');
    assert.equal(shifted.nextIndex, 1);
    assert.deepEqual(planSpread({ count: 6, index: 2, mode: 'double', offset: 1 }).pageIndices, [1, 2]);

    const coverShiftCancelled = planSpread({
      count: 6, index: 0, mode: 'double', coverSingle: true, offset: 1,
    });
    assert.deepEqual(coverShiftCancelled.pageIndices, [0, 1]);
    assert.equal(coverShiftCancelled.blank.any, false);
  });
});

describe('W88 Library · wide page ownership', () => {
  test('Set-declared wide page owns a spread and resets pairing on both sides', () => {
    const widePages = new Set([2]);
    const before = planSpread({ count: 6, index: 1, mode: 'double', widePages });
    const wide = planSpread({ count: 6, index: 2, mode: 'double', widePages });
    const after = planSpread({ count: 6, index: 3, mode: 'double', widePages });

    assert.deepEqual(before.pageIndices, [0, 1]);
    assert.equal(wide.layout, 'wide');
    assert.deepEqual(wide.pageIndices, [2]);
    assert.equal(wide.slots.left.index, 2);
    assert.equal(wide.slots.right.index, 2);
    assert.equal(wide.blank.any, false, '跨页占满双槽，不得伪报空白页');
    assert.equal(wide.prevIndex, 0);
    assert.equal(wide.nextIndex, 3);
    assert.deepEqual(after.pageIndices, [3, 4]);
  });

  test('regular page before a wide boundary is not incorrectly paired across it', () => {
    const plan = planSpread({ count: 5, index: 0, mode: 'double', widePages: new Set([1]) });
    assert.deepEqual(plan.pageIndices, [0]);
    assert.equal(plan.blank.reasons.right, 'wide-boundary');
    assert.equal(plan.nextIndex, 1);
  });

  test('aspect resolver accepts ratio, tuple and dimensions', () => {
    const shapes = [0.7, [1800, 900], { width: 700, height: 1000 }, { aspect: 1.8 }];
    const p1 = planSpread({ count: 4, index: 1, mode: 'double', aspect: i => shapes[i] });
    const p3 = planSpread({ count: 4, index: 3, mode: 'double', aspectResolver: i => shapes[i] });
    assert.equal(p1.layout, 'wide');
    assert.equal(p3.layout, 'wide');
  });

  test('splitWide exposes two crop slots without duplicating logical navigation', () => {
    const plan = planSpread({
      count: 4, index: 1, mode: 'double', direction: 'rtl',
      widePages: new Set([1]), splitWide: true,
    });
    assert.equal(plan.layout, 'split-wide');
    assert.deepEqual(plan.pages.map(item => item.slice), ['left', 'right']);
    assert.deepEqual(plan.readingPages.map(item => item.slice), ['right', 'left']);
    assert.deepEqual(plan.pageIndices, [1]);
    assert.equal(plan.prevIndex, 0);
    assert.equal(plan.nextIndex, 2);
  });
});
