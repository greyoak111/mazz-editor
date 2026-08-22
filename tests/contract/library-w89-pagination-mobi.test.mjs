// W89 Reader polish and compatibility regression gates.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  READER_MARGIN_PROFILES,
  computeReaderPageGeometry,
  normalizeReaderMargin,
  normalizeReaderTurnEffect,
} from '../../renderer/modules/library/reader-pagination.js';
import {
  inspectMobiStructure,
  MOBI_RESOURCE_LIMITS,
} from '../../renderer/modules/library/mobi.js';

const u16 = (bytes, offset, value) => {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
};
const u32 = (bytes, offset, value) => {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
};

function syntheticMobi({ imageCount = 10, imageBytes = 1024, textBytes = 180 } = {}) {
  const records = 2 + imageCount; // Palm header + one text record + images.
  const tableEnd = 78 + records * 8;
  const headerBytes = 64;
  const total = tableEnd + headerBytes + textBytes + imageCount * imageBytes;
  const bytes = new Uint8Array(total);
  u16(bytes, 76, records);
  let cursor = tableEnd;
  for (let i = 0; i < records; i++) {
    u32(bytes, 78 + i * 8, cursor);
    cursor += i === 0 ? headerBytes : i === 1 ? textBytes : imageBytes;
  }
  const record0 = tableEnd;
  u32(bytes, record0 + 4, textBytes);
  u16(bytes, record0 + 8, 1);
  bytes.set([0x4d, 0x4f, 0x42, 0x49], record0 + 16); // MOBI
  for (let i = 0; i < imageCount; i++) {
    const offset = tableEnd + headerBytes + textBytes + i * imageBytes;
    bytes.set([0xff, 0xd8, 0xff, 0xe0], offset);
  }
  return bytes;
}

describe('W89 Reader · paper, margins and stable pagination geometry', () => {
  test('60% controls the sheet while a comfortable text measure retains real inner gutters', () => {
    const page = computeReaderPageGeometry({
      viewportWidth: 1470,
      viewportHeight: 628,
      mode: 'single',
      pageWidth: 0.6,
      margin: 'comfortable',
      fontSize: 16,
      lineHeight: 1.8,
    });
    assert.equal(page.sheetWidth, 882, '60% must describe the physical paper');
    assert.ok(page.pagePaddingInline >= 100, `wide paper needs a readable inner gutter (actual ${page.pagePaddingInline})`);
    assert.ok(page.contentWidth <= 640, `CJK measure must stay bounded near 40 glyphs (actual ${page.contentWidth})`);
    assert.equal(page.contentWidth + page.pagePaddingInline * 2, page.sheetWidth);
    assert.equal(page.pagePitch, page.sheetWidth, 'single-page turns must land on an exact sheet grid');
  });

  test('margin profiles change the text measure without changing the requested sheet', () => {
    const pages = ['compact', 'comfortable', 'spacious'].map(margin => computeReaderPageGeometry({
      viewportWidth: 1180, viewportHeight: 720, pageWidth: 0.8, margin, fontSize: 16,
    }));
    assert.deepEqual(pages.map(page => page.sheetWidth), [944, 944, 944]);
    assert.ok(pages[0].pagePaddingInline < pages[1].pagePaddingInline);
    assert.ok(pages[1].pagePaddingInline < pages[2].pagePaddingInline);
    assert.ok(pages[0].contentWidth > pages[1].contentWidth);
    assert.ok(pages[1].contentWidth > pages[2].contentWidth);
  });

  test('double mode respects the width control and keeps a drift-free two-column pitch', () => {
    const narrow = computeReaderPageGeometry({ viewportWidth: 1440, viewportHeight: 760, mode: 'double', pageWidth: 0.5 });
    const wide = computeReaderPageGeometry({ viewportWidth: 1440, viewportHeight: 760, mode: 'double', pageWidth: 1 });
    assert.equal(narrow.effectiveMode, 'double');
    assert.equal(wide.effectiveMode, 'double');
    assert.ok(narrow.wrapWidth < wide.wrapWidth, 'double-page width control must not be a no-op');
    assert.equal(wide.contentWidth + wide.columnGap, wide.pagePitch);
    assert.equal(wide.wrapWidth, wide.sheetWidth * 2 + wide.physicalGutter);
    assert.equal(500 * (2 * wide.pagePitch), 1000 * wide.pagePitch, 'integer pitch cannot accumulate fractional turn drift');
  });

  test('cramped double pages fall back visually and preference normalization is deterministic', () => {
    const cramped = computeReaderPageGeometry({ viewportWidth: 620, viewportHeight: 700, mode: 'double', pageWidth: 0.5 });
    assert.equal(cramped.effectiveMode, 'single');
    const sliver = computeReaderPageGeometry({ viewportWidth: 240, viewportHeight: 320, mode: 'single', pageWidth: 0.5, margin: 'spacious' });
    assert.equal(sliver.contentWidth + sliver.pagePaddingInline * 2, sliver.sheetWidth,
      'even the narrowest supported pane must not grow its text column beyond the paper');
    assert.ok(sliver.contentWidth >= 180);
    assert.equal(normalizeReaderMargin('SPACIOUS'), 'spacious');
    assert.equal(normalizeReaderMargin('invented'), 'comfortable');
    assert.equal(normalizeReaderTurnEffect('fade'), 'fade');
    assert.equal(normalizeReaderTurnEffect('curl-3d'), 'fade');
    assert.ok(Object.isFrozen(READER_MARGIN_PROFILES.comfortable));
  });
});

describe('W89 MOBI · image-dominant compatibility route', () => {
  test('a long image run is classified before the text compatibility parser', () => {
    const bytes = syntheticMobi({ imageCount: 12, imageBytes: 2048, textBytes: 240 });
    const result = inspectMobiStructure(bytes.buffer);
    assert.equal(result.valid, true);
    assert.equal(result.imageCount ?? result.images.length, 12);
    assert.equal(result.imageDominant, true);
    assert.ok(result.imageRatio > 0.9);
    assert.ok(result.imageBytes > result.declaredTextBytes);
    assert.equal(result.title, '未命名');
    assert.equal(result.author, '');
  });

  test('a normal illustrated text book is never reclassified from only three images', () => {
    const bytes = syntheticMobi({ imageCount: 3, imageBytes: 1024, textBytes: 2048 });
    const result = inspectMobiStructure(bytes.buffer);
    assert.equal(result.images.length, 3);
    assert.equal(result.imageDominant, false);
  });

  test('metadata and image budgets remain finite while the high-confidence route bypasses the 32 MiB text cliff', () => {
    assert.ok(MOBI_RESOURCE_LIMITS.records <= 20_000);
    assert.ok(MOBI_RESOURCE_LIMITS.imageBytes <= MOBI_RESOURCE_LIMITS.imageTotalBytes);
    assert.ok(MOBI_RESOURCE_LIMITS.lingoSourceBytes < MOBI_RESOURCE_LIMITS.imageTotalBytes,
      'image routing is structural, not an unsafe global lingo limit increase');
  });

  test('both import and open route through the same structural probe before parseMobi', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');
    const importStart = source.indexOf("} else if (ext === 'mobi' || ext === 'azw3')");
    const importEnd = source.indexOf("} else if (ext === 'txt' || ext === 'pdf')", importStart);
    const importSlice = source.slice(importStart, importEnd);
    assert.ok(importSlice.indexOf('inspectMobiStructure') < importSlice.indexOf('parseMobi'),
      'import must recognize an image book before invoking the text compatibility parser');
    const openStart = source.indexOf("} else if (book.format === 'txt' || book.format === 'mobi' || book.format === 'azw3')");
    const openInspect = source.indexOf('inspectMobiStructure', openStart);
    const openParse = source.indexOf('parseMobi', openInspect);
    assert.ok(openStart > 0 && openInspect > openStart && openParse > openInspect,
      'open must use the same image-first structural route');
  });
});
