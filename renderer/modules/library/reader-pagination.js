// Reader pagination geometry.  A page is deliberately modelled as three
// different things: the physical sheet, its inner gutters, and the readable
// text measure.  Keeping those values separate is what prevents a "60% page"
// from degenerating into an 60%-wide, zero-margin text clipping window.

export const READER_MARGIN_PROFILES = Object.freeze({
  compact: Object.freeze({
    label: '紧凑', inlineRatio: 0.045, inlineMin: 24, inlineMax: 52,
    blockRatio: 0.045, blockMin: 24, blockMax: 40, maxMeasureEm: 48,
  }),
  comfortable: Object.freeze({
    label: '舒适', inlineRatio: 0.0625, inlineMin: 36, inlineMax: 68,
    blockRatio: 0.06, blockMin: 32, blockMax: 52, maxMeasureEm: 40,
  }),
  spacious: Object.freeze({
    label: '宽松', inlineRatio: 0.085, inlineMin: 48, inlineMax: 96,
    blockRatio: 0.075, blockMin: 42, blockMax: 64, maxMeasureEm: 36,
  }),
});

// The reader deliberately has one restrained transition.  Keeping obsolete
// values in the public domain made CSS, preferences and navigation disagree
// about what a "page turn" meant.  Old slide/none records are migrated by the
// normalizer below; newly persisted records can only contain fade.
export const READER_TURN_EFFECTS = Object.freeze(new Set(['fade']));
export const READER_MODES = Object.freeze(new Set(['single', 'double', 'scroll']));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeReaderMargin(value) {
  const key = String(value || '').trim().toLowerCase();
  return Object.hasOwn(READER_MARGIN_PROFILES, key) ? key : 'comfortable';
}

export function normalizeReaderTurnEffect(value) {
  const key = String(value || '').trim().toLowerCase();
  return READER_TURN_EFFECTS.has(key) ? key : 'fade';
}

/** Retire the incomplete vertical prototype without stranding old records. */
export function normalizeReaderMode(value) {
  const key = String(value || '').trim().toLowerCase();
  return READER_MODES.has(key) ? key : 'single';
}

/**
 * Snap a semantic content position onto the physical-page grid.
 *
 * `contentOffset` is layout evidence only; it is never persisted.  Reflow
 * resolves a DOM/text locator again, then calls this helper using the *new*
 * pitch.  Flooring keeps the located block visible instead of moving it to
 * the following page when it begins midway through a column.
 */
export function physicalPageOffset({ contentOffset = 0, pagePaddingInline = 0, pagePitch = 1, maxOffset = Infinity } = {}) {
  const pitch = Math.max(1, Number(pagePitch) || 1);
  const raw = Math.max(0, (Number(contentOffset) || 0) - Math.max(0, Number(pagePaddingInline) || 0));
  const max = Number.isFinite(Number(maxOffset)) ? Math.max(0, Number(maxOffset)) : raw;
  const last = Math.max(0, Math.floor(max / pitch) * pitch);
  return Math.min(last, Math.floor(raw / pitch) * pitch);
}

/** One command always advances one physical page, including spread view. */
export function advancePhysicalPage(index, delta, count) {
  const total = Math.max(0, Math.trunc(Number(count) || 0));
  if (!total) return 0;
  const current = clamp(Math.trunc(Number(index) || 0), 0, total - 1);
  return clamp(current + Math.sign(Number(delta) || 0), 0, total - 1);
}

/** Build the temporary two-chapter bridge used by a one-page boundary turn. */
export function chapterBridgeLocator(current, next, count) {
  const total = Math.max(0, Math.trunc(Number(count) || 0));
  if (!total) return null;
  const from = clamp(Math.trunc(Number(current) || 0), 0, total - 1);
  const to = clamp(Math.trunc(Number(next) || 0), 0, total - 1);
  if (from === to) return null;
  return {
    kind: 'chapter-bridge',
    low: Math.min(from, to),
    high: Math.max(from, to),
    direction: Math.sign(to - from),
    m: to,
  };
}

/** Keep one normal chapter, or exactly the two chapters owned by a bridge. */
export function pagedSectionWindow(center, count, bridge = null) {
  const total = Math.max(0, Math.trunc(Number(count) || 0));
  if (!total) return [];
  const current = clamp(Math.trunc(Number(center) || 0), 0, total - 1);
  if (bridge?.kind !== 'chapter-bridge') return [current];
  const low = clamp(Math.trunc(Number(bridge.low) || 0), 0, total - 1);
  const high = clamp(Math.trunc(Number(bridge.high) || 0), 0, total - 1);
  return low === high ? [low] : [Math.min(low, high), Math.max(low, high)];
}

/** Show [low:last, high:first] on the physical-page grid. */
export function chapterBridgeOffset({ highOffset = 0, pagePitch = 1, maxOffset = Infinity } = {}) {
  const pitch = Math.max(1, Number(pagePitch) || 1);
  const max = Number.isFinite(Number(maxOffset)) ? Math.max(0, Number(maxOffset)) : Infinity;
  return Math.min(max, Math.max(0, (Number(highOffset) || 0) - pitch));
}

/**
 * Spread-planner parity that makes `index` the first logical page of the
 * visible pair. Page zero may remain a cover singleton; after that, parity
 * alternates as the physical-page cursor advances by one.
 */
export function spreadOffsetForPhysicalPage(index, { coverSingle = true } = {}) {
  const page = Math.max(0, Math.trunc(Number(index) || 0));
  if (coverSingle && page === 0) return 0;
  return (coverSingle ? 1 : 0) ^ (page % 2);
}

/**
 * Compute stable multi-column geometry in CSS pixels.
 *
 * Invariant for horizontal pagination:
 *   contentWidth = sheetWidth - 2 * pagePadding
 *   columnGap    = 2 * pagePadding + physicalGutter
 *   pagePitch    = contentWidth + columnGap
 *
 * Therefore every generated CSS column receives the same left/right page
 * gutter and the Nth page is always exactly N * pagePitch away.  The formulas
 * remain stable across thousands of turns and are shared by single/spread UI.
 */
export function computeReaderPageGeometry({
  viewportWidth,
  viewportHeight,
  mode = 'single',
  pageWidth = 0.7,
  margin = 'comfortable',
  fontSize = 16,
  lineHeight = 1.8,
} = {}) {
  const width = Math.max(240, Math.floor(Number(viewportWidth) || 0));
  const height = Math.max(240, Math.floor(Number(viewportHeight) || 0));
  const profileKey = normalizeReaderMargin(margin);
  const profile = READER_MARGIN_PROFILES[profileKey];
  const requested = clamp(Number(pageWidth) || 0.7, 0.2, 1);
  const outerInline = clamp(Math.round(width * 0.016), 10, 24);
  const outerBlock = clamp(Math.round(height * 0.018), 8, 16);
  const physicalGutter = mode === 'double' ? clamp(Math.round(width * 0.014), 14, 22) : 0;
  const maxUsable = Math.max(220, width - outerInline * 2);

  let effectiveMode = mode;
  let sheetWidth;
  if (mode === 'double') {
    // In spread mode the width selector controls the whole spread, rather than
    // becoming a no-op.  Map its 50–100% UI range to a useful 75–100% spread.
    const spreadRatio = clamp(0.75 + (requested - 0.5) * 0.5, 0.75, 1);
    const spreadWidth = Math.min(maxUsable, Math.max(0, Math.floor(width * spreadRatio)));
    sheetWidth = Math.floor((spreadWidth - physicalGutter) / 2);
    // Two cramped slivers are worse than honoring the user's content.  This is
    // a visual fallback only: the persisted preference remains "double".
    if (sheetWidth < 320) {
      effectiveMode = 'single';
      sheetWidth = Math.min(maxUsable, Math.max(Math.min(520, maxUsable), Math.floor(width * requested)));
    }
  } else {
    sheetWidth = Math.min(maxUsable, Math.max(Math.min(520, maxUsable), Math.floor(width * requested)));
  }

  const fs = clamp(Number(fontSize) || 16, 10, 72);
  const baseInline = clamp(sheetWidth * profile.inlineRatio, profile.inlineMin, profile.inlineMax);
  const measureLimited = Math.max(0, (sheetWidth - profile.maxMeasureEm * fs) / 2);
  // Preserve the geometry invariant even in an extremely narrow split pane.
  // A hard 24% cap could otherwise leave less than the minimum text measure,
  // after which clamping contentWidth would make the CSS column wider than its
  // physical sheet.  Bound the padding by the space the sheet truly owns.
  const maxPadding = Math.max(20, (sheetWidth - 180) / 2);
  const pagePaddingInline = Math.round(clamp(Math.max(baseInline, measureLimited), 20, maxPadding));
  const pagePaddingBlock = Math.round(clamp(
    height * profile.blockRatio,
    profile.blockMin,
    Math.min(profile.blockMax, Math.max(profile.blockMin, height * 0.18)),
  ));
  const contentWidth = sheetWidth - pagePaddingInline * 2;
  const gutter = effectiveMode === 'double' ? physicalGutter : 0;
  const columnGap = pagePaddingInline * 2 + gutter;
  const pagePitch = contentWidth + columnGap;
  const wrapWidth = effectiveMode === 'double'
    ? sheetWidth * 2 + gutter
    : sheetWidth;
  const rowPitch = Math.max(18, fs * clamp(Number(lineHeight) || 1.8, 1, 3.2));

  return Object.freeze({
    requestedMode: mode,
    effectiveMode,
    profile: profileKey,
    viewportWidth: width,
    viewportHeight: height,
    outerInline,
    outerBlock,
    sheetWidth,
    wrapWidth,
    physicalGutter: gutter,
    pagePaddingInline,
    pagePaddingBlock,
    contentWidth,
    columnGap,
    pagePitch,
    rowPitch,
  });
}
