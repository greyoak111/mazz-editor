// W89b Reader layout: semantic pagination, stable chrome and real paper width.
import './_setup.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';
import {
  advancePhysicalPage,
  chapterBridgeLocator,
  chapterBridgeOffset,
  normalizeReaderMode,
  normalizeReaderTurnEffect,
  pagedSectionWindow,
  physicalPageOffset,
  spreadOffsetForPhysicalPage,
} from '../../renderer/modules/library/reader-pagination.js';
import { planSpread } from '../../renderer/modules/library/spread-planner.js';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');

describe('W89b Reader · one physical page cursor', () => {
  test('spread display can overlap while each command advances exactly one page', () => {
    assert.equal(advancePhysicalPage(8, 1, 30), 9);
    assert.equal(advancePhysicalPage(8, -1, 30), 7);
    assert.equal(advancePhysicalPage(29, 1, 30), 29);
    const at1 = planSpread({
      count: 8, index: 1, mode: 'double', coverSingle: true,
      offset: spreadOffsetForPhysicalPage(1, { coverSingle: true }),
    });
    const at2 = planSpread({
      count: 8, index: 2, mode: 'double', coverSingle: true,
      offset: spreadOffsetForPhysicalPage(2, { coverSingle: true }),
    });
    assert.deepEqual(at1.pageIndices, [1, 2]);
    assert.deepEqual(at2.pageIndices, [2, 3]);
  });

  test('resolved semantic content is snapped onto the new page pitch', () => {
    assert.equal(physicalPageOffset({
      contentOffset: 1_987, pagePaddingInline: 64, pagePitch: 640, maxOffset: 5_120,
    }), 1_920);
    assert.equal(physicalPageOffset({
      contentOffset: 99_999, pagePaddingInline: 64, pagePitch: 640, maxOffset: 4_230,
    }), 3_840, 'last offset must remain an exact reachable physical-page pitch');
  });

  test('bounded paged rail includes adjacent chapters for a one-page boundary overlap', () => {
    const forward = chapterBridgeLocator(2, 3, 5);
    const backward = chapterBridgeLocator(3, 2, 5);
    assert.deepEqual(pagedSectionWindow(2, 5), [2]);
    assert.deepEqual(pagedSectionWindow(3, 5, forward), [2, 3]);
    assert.deepEqual(pagedSectionWindow(2, 5, backward), [2, 3]);
    assert.equal(forward.direction, 1);
    assert.equal(backward.direction, -1);
    assert.equal(chapterBridgeOffset({ highOffset: 4_800, pagePitch: 600, maxOffset: 9_000 }), 4_200);
    assert.equal(chapterBridgeOffset({ highOffset: 4_800, pagePitch: 600, maxOffset: 9_000 }), 4_200,
      'forward and backward land on the same [low:last, high:first] bridge spread');
    const source = read('renderer/modules/library/index.js');
    assert.ok(source.includes('const sectionIndices = pagedSectionWindow(only, total, ctl._pendingAnchor)'));
    assert.ok(source.includes('for (const i of sectionIndices)'));
    assert.ok(!source.includes('for (const i of [only])'), 'single-chapter rail forces an atomic chapter jump');
    assert.ok(source.includes('chapterBridgeLocator(currentPos(), next, total)'));
    assert.ok(source.includes("locator.kind === 'chapter-bridge'"));
    assert.ok(source.includes("ctl._pageGeometry?.effectiveMode === 'double'"),
      'single mode must cross chapters directly instead of repeating the low chapter tail');
    assert.ok(source.includes("bridge || { kind: 'chapter-edge'"),
      'single boundary must restore the target chapter edge in one command');
  });
});

describe('W89b Reader · retired half-finished preferences', () => {
  test('legacy motion and vertical values canonicalize deterministically', () => {
    assert.equal(normalizeReaderTurnEffect('slide'), 'fade');
    assert.equal(normalizeReaderTurnEffect('none'), 'fade');
    assert.equal(normalizeReaderTurnEffect('fade'), 'fade');
    assert.equal(normalizeReaderMode('vertical'), 'single');
  });

  test('toolbar exposes neither a fake choice nor an unreliable vertical mode', () => {
    const source = read('renderer/modules/library/index.js');
    assert.ok(!source.includes('class="lib-turn'));
    assert.ok(!source.includes('<option value="vertical">'));
    assert.ok(source.includes('restoreSemanticLocator') && source.includes('resolveNodePath'));
    assert.ok(source.includes('const stepOf = () => pitchOf() || 1'));
  });

  test('paged resize restores the cached pre-change semantic locator', () => {
    const source = read('renderer/modules/library/index.js');
    assert.ok(source.includes('let stableSemanticLocator'));
    assert.ok(source.includes('const captured = semanticLocator || captureAnchor()'));
    assert.ok(source.includes('rectIntersects(caretRect(doc, point.node, point.offset), rect)'),
      'transformed multicol caret results must be visible before becoming canonical');
    const pagedResize = source.slice(source.indexOf('// 窗格拖动/窗口缩放实时跟随'));
    const resizeBody = pagedResize.match(/ctl\._flowRO\s*=\s*new ResizeObserver\(\(\)\s*=>\s*\{([\s\S]*?)\}\);\s*ctl\._flowRO\.observe\(pageEl\)/)?.[1] || '';
    assert.ok(resizeBody.includes('stableSemanticLocator'), 'resize must replay the last pre-change locator');
    assert.ok(!resizeBody.includes('captureAnchor()'), 'post-layout ResizeObserver geometry is too late to capture the old anchor');
    assert.ok(resizeBody.includes('resizeSemanticLocator ||= stableSemanticLocator'));
    assert.ok(resizeBody.includes('token !== resizeSemanticEpoch'));
  });

  test('every paged font-size entry captures before mutating frame styles', () => {
    const source = read('renderer/modules/library/index.js');
    const minus = source.match(/\[data-a=font-minus\][\s\S]*?addEventListener\('click',[\s\S]*?\n  \}\);/)?.[0] || '';
    const plus = source.match(/\[data-a=font-plus\][\s\S]*?addEventListener\('click',[\s\S]*?\n  \}\);/)?.[0] || '';
    for (const [name, body] of [['minus', minus], ['plus', plus]]) {
      assert.ok(body.includes('captureReaderReflowLocator()'), `${name} is missing a pre-change locator`);
      assert.ok(body.indexOf('captureReaderReflowLocator()') < body.indexOf('applyTextStyle()'),
        `${name} captures after the font reflow`);
      assert.ok(body.includes('reflowReaderGeometry(locator)'));
    }
    const wheel = source.slice(source.indexOf('function onReaderWheel'), source.indexOf('// 阅读页右键'));
    assert.ok(wheel.indexOf('captureReaderReflowLocator()') < wheel.indexOf('applyTextStyle()'));
    const context = source.slice(source.indexOf('// 阅读页右键'), source.indexOf('pageEl.addEventListener'));
    assert.ok((context.match(/const locator = captureReaderReflowLocator\(\)/g) || []).length >= 2,
      'both context-menu font actions need a pre-change locator');
    assert.ok((context.match(/reflowReaderGeometry\(locator\)/g) || []).length >= 2);
  });
});

describe('W89b Reader · stable chrome and paper surfaces', () => {
  test('collapsed progress retains its flex slot and cannot resize the iframe', () => {
    const css = read('renderer/styles/base.css');
    const rule = css.match(/\.lib-progress\.collapsed\s*\{([^}]*)\}/)?.[1] || '';
    assert.ok(rule.includes('visibility: hidden'));
    assert.ok(rule.includes('opacity: 0'));
    assert.ok(rule.includes('transform: translateY(100%)'));
    assert.ok(!/display\s*:\s*none/.test(rule));
  });

  test('continuous text and all comic modes consume the width preference', () => {
    const source = read('renderer/modules/library/index.js');
    const css = read('renderer/styles/base.css');
    assert.ok(source.includes('--reader-scroll-sheet') && source.includes('--reader-scroll-pad-inline'));
    assert.ok(source.includes('applyComicFitVariables'));
    assert.ok(source.includes('width:min(var(--reader-scroll-sheet,760px),calc(100% - 20px))'));
    assert.ok(css.includes('width: var(--lib-comic-sheet-width, 70%)'));
    assert.ok(css.includes('width: min(var(--lib-comic-render-width, 70%), 100%)'));
    assert.ok(css.includes('height: min(var(--lib-comic-render-block, 70%), 100%)'));
  });

  test('continuous outer resize consumes the viewport pre-change locator and performs a muted refresh', () => {
    const source = read('renderer/modules/library/index.js');
    assert.ok(source.includes('b._textViewport.captureStableLocator?.()'));
    assert.ok(source.includes('viewport.refresh?.({ locator })'));
    const viewport = read('renderer/modules/library/text-viewport.js');
    assert.ok(viewport.includes('captureStableLocator()'));
    assert.ok(viewport.includes('if (locator) compensateToLocator(locator)'));
  });
});
