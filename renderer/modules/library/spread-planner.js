// Pure comic spread planning.
//
// Page indices always follow the source/read order (0..count - 1). `direction`
// only changes their visual placement.  Keeping those two orders separate is
// important: an RTL book still advances from source page 4 to source page 5.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function ratioOf(value) {
  if (typeof value === 'boolean') return value ? Infinity : 0;
  if (typeof value === 'number') return value;
  if (Array.isArray(value) && value.length >= 2) {
    const [width, height] = value.map(Number);
    return height > 0 ? width / height : 0;
  }
  if (value && typeof value === 'object') {
    if (typeof value.wide === 'boolean') return value.wide ? Infinity : 0;
    if (Number.isFinite(Number(value.aspect))) return Number(value.aspect);
    const width = Number(value.width ?? value.w);
    const height = Number(value.height ?? value.h);
    return height > 0 ? width / height : 0;
  }
  return 0;
}

function createWideResolver({ widePages, aspect, aspectResolver, wideThreshold = 1.15 }) {
  const source = aspectResolver ?? aspect;
  return (index) => {
    if (widePages instanceof Set && widePages.has(index)) return true;
    if (Array.isArray(widePages) && widePages.includes(index)) return true;
    if (widePages && typeof widePages !== 'function' && typeof widePages.has === 'function' && widePages.has(index)) return true;
    const value = typeof widePages === 'function'
      ? widePages(index)
      : (typeof source === 'function' ? source(index) : null);
    return ratioOf(value) > Number(wideThreshold || 1.15);
  };
}

const page = (index, extra = {}) => Object.freeze({ kind: 'page', index, ...extra });
const blank = (reason) => Object.freeze({ kind: 'blank', reason });

function visualPair(indices, direction) {
  const ordered = direction === 'rtl' ? [...indices].reverse() : [...indices];
  return {
    layout: 'spread',
    slots: { left: page(ordered[0]), right: page(ordered[1]) },
    pages: ordered.map(index => page(index)),
    readingPages: indices.map(index => page(index)),
    logical: indices,
  };
}

function leadingSingle(index, direction, reason) {
  // A cover/alignment singleton sits on the closing edge of the empty book:
  // right in LTR books, left in RTL books.
  const item = page(index);
  const empty = blank(reason);
  return direction === 'rtl'
    ? { layout: 'singleton', slots: { left: item, right: empty }, pages: [item], readingPages: [item], logical: [index] }
    : { layout: 'singleton', slots: { left: empty, right: item }, pages: [item], readingPages: [item], logical: [index] };
}

function trailingSingle(index, direction, reason) {
  // An unmatched first page of a spread occupies its normal reading-start
  // slot: left in LTR books, right in RTL books.
  const item = page(index);
  const empty = blank(reason);
  return direction === 'rtl'
    ? { layout: 'singleton', slots: { left: empty, right: item }, pages: [item], readingPages: [item], logical: [index] }
    : { layout: 'singleton', slots: { left: item, right: empty }, pages: [item], readingPages: [item], logical: [index] };
}

function wideSpread(index, direction, splitWide) {
  if (splitWide) {
    // Crops are expressed in visual order. A renderer can show the same source
    // image in both slots without first materialising two bitmap copies.
    const left = page(index, { slice: 'left', wide: true });
    const right = page(index, { slice: 'right', wide: true });
    return {
      layout: 'split-wide',
      slots: { left, right },
      pages: [left, right],
      readingPages: direction === 'rtl' ? [right, left] : [left, right],
      logical: [index],
    };
  }
  const item = page(index, { wide: true, span: 'both' });
  return {
    layout: 'wide',
    slots: { left: item, right: item },
    pages: [item],
    readingPages: [item],
    logical: [index],
  };
}

function singlePage(index) {
  const item = page(index);
  return {
    layout: 'single', slots: { left: null, right: null },
    pages: [item], readingPages: [item], logical: [index],
  };
}

function makeSpreads({ count, mode, direction, pairOffset, isWide, splitWide }) {
  if (mode !== 'double') return Array.from({ length: count }, (_, index) => singlePage(index));

  const spreads = [];
  let index = 0;
  if (pairOffset && count) {
    spreads.push(leadingSingle(0, direction, pairOffset.reason));
    index = 1;
  }

  while (index < count) {
    if (isWide(index)) {
      spreads.push(wideSpread(index, direction, splitWide));
      index += 1;
      continue;
    }

    if (index + 1 >= count) {
      spreads.push(trailingSingle(index, direction, 'unpaired-tail'));
      break;
    }

    if (isWide(index + 1)) {
      spreads.push(trailingSingle(index, direction, 'wide-boundary'));
      index += 1;
      continue;
    }

    spreads.push(visualPair([index, index + 1], direction));
    index += 2;
  }
  return spreads;
}

function blankSummary(slots, empty = false) {
  const left = empty || slots.left?.kind === 'blank';
  const right = empty || slots.right?.kind === 'blank';
  return Object.freeze({
    left,
    right,
    any: left || right,
    reasons: Object.freeze({
      left: empty ? 'empty' : (left ? slots.left.reason : null),
      right: empty ? 'empty' : (right ? slots.right.reason : null),
    }),
  });
}

/**
 * Resolve the visual spread and navigation destinations for a comic page.
 *
 * `offset` toggles double-page parity.  Therefore coverSingle=true/offset=0
 * leaves page 0 by itself, while offset=1 pairs pages 0+1; without coverSingle,
 * offset=1 creates the leading singleton.  This mirrors a reader's "shift
 * spread" switch without changing source page indices.
 *
 * `widePages` may be a Set/array, or a resolver returning boolean, aspect ratio,
 * [width,height], or { width,height }. `aspect`/`aspectResolver` are equivalent
 * resolver aliases. Wide pages own a complete spread. With splitWide enabled,
 * the result exposes left/right crop descriptors for that one source page.
 */
export function planSpread(options = {}) {
  const count = Math.max(0, integer(options.count));
  const direction = options.direction === 'rtl' ? 'rtl' : 'ltr';
  const mode = options.mode === 'double' ? 'double' : 'single';
  const requestedIndex = count ? clamp(integer(options.index), 0, count - 1) : null;
  const offset = Math.abs(integer(options.offset)) % 2;
  const coverParity = options.coverSingle ? 1 : 0;
  const shifted = Boolean(coverParity ^ offset);
  const pairOffset = shifted ? {
    reason: options.coverSingle && !offset ? 'cover-single' : 'alignment-offset',
  } : null;
  const isWide = createWideResolver(options);
  const spreads = makeSpreads({
    count, mode, direction, pairOffset, isWide,
    splitWide: Boolean(options.splitWide),
  });

  if (!count) {
    const slots = Object.freeze({ left: blank('empty'), right: blank('empty') });
    return Object.freeze({
      count, mode, direction, requestedIndex, index: null,
      spreadIndex: -1, spreadCount: 0, layout: 'empty',
      pages: Object.freeze([]), pageIndices: Object.freeze([]), readingPages: Object.freeze([]),
      slots, blank: blankSummary(slots, true),
      prevIndex: null, nextIndex: null,
    });
  }

  const spreadIndex = Math.max(0, spreads.findIndex(spread => spread.logical.includes(requestedIndex)));
  const spread = spreads[spreadIndex];
  const prev = spreads[spreadIndex - 1];
  const next = spreads[spreadIndex + 1];
  const slots = Object.freeze({ left: spread.slots.left, right: spread.slots.right });
  const pageIndices = [...new Set(spread.pages.map(item => item.index))];

  return Object.freeze({
    count, mode, direction, requestedIndex,
    index: spread.logical[0],
    spreadIndex, spreadCount: spreads.length, layout: spread.layout,
    pages: Object.freeze(spread.pages),
    pageIndices: Object.freeze(pageIndices),
    readingPages: Object.freeze(spread.readingPages),
    slots,
    blank: blankSummary(slots),
    prevIndex: prev ? prev.logical[0] : null,
    nextIndex: next ? next.logical[0] : null,
  });
}

export const _forTests = Object.freeze({ ratioOf, createWideResolver });
