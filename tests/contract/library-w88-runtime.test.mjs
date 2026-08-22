// tests/contract/library-w88-runtime.test.mjs
// W88 Library bounded-runtime contracts: comic page window and owner release,
// persistent shelf covers, and native/cached EPUB chapter resource ownership.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const wait = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));

const { pageWindow, createComicViewport } = await import('../../renderer/modules/library/comic-viewport.js');
const { persistCover, stableMediaUrl, COVER_LIMITS } = await import('../../renderer/modules/library/cover-cache.js');
const {
  parseEpub, makeOwnedChapterLoader, readZipEntryBounded, EPUB_CHAPTER_IMAGE_LIMITS,
  MAX_EPUB_ARCHIVE_ENTRIES, assertZipEntryCount,
} = await import('../../renderer/modules/library/epub.js');
const { writeBookCache, readBookCache, _forTests: cacheLimits } = await import('../../renderer/modules/library/cache.js');
const { makeBytesPager } = await import('../../renderer/modules/library/cbz.js');
const { lz77, parseMobi, MOBI_RESOURCE_LIMITS } = await import('../../renderer/modules/library/mobi.js');
const { decodeText, shouldTreatMobiAsComic } = await import('../../renderer/modules/library/index.js');

const PNG = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

async function makeOwnedEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>');
  zip.file('OPS/content.opf', `<?xml version="1.0"?>
    <package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>Owner Test</dc:title><meta name="cover" content="cover"/></metadata>
      <manifest>
        <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
        <item id="i1" href="i1.png" media-type="image/png"/>
        <item id="i2" href="i2.png" media-type="image/png"/>
        <item id="cover" href="cover.png" media-type="image/png"/>
      </manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
    </package>`);
  zip.file('OPS/c1.xhtml', '<html><body><p>one</p><img src="i1.png"/></body></html>');
  zip.file('OPS/c2.xhtml', '<html><body><p>two</p><img src="i2.png"/></body></html>');
  zip.file('OPS/i1.png', PNG);
  zip.file('OPS/i2.png', PNG);
  zip.file('OPS/cover.png', PNG);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('W88 comic viewport', () => {
  test('pageWindow clamps both ends and never exceeds the requested neighbour budget', () => {
    assert.deepEqual([...pageWindow(0, 10)], [0, 1, 2, 3]);
    assert.deepEqual([...pageWindow(5, 10)], [3, 4, 5, 6, 7, 8]);
    assert.deepEqual([...pageWindow(9, 10)], [7, 8, 9]);
    assert.deepEqual([...pageWindow(-50, 3)], [0, 1, 2]);
    assert.deepEqual([...pageWindow(50, 3)], [0, 1, 2]);
    assert.deepEqual([...pageWindow(2, 6, 1, 1)], [1, 2, 3]);
    assert.equal(pageWindow(0, 0).size, 0);
  });

  test('viewport and CBZ pager keep a bounded owner window and destroy releases all URLs', async () => {
    const host = document.createElement('div');
    const mount = document.createElement('div');
    host.appendChild(mount);
    document.body.appendChild(host);

    const source = Array.from({ length: 20 }, (_, i) => i);
    let rawReads = 0;
    const pager = makeBytesPager(source, async (i) => {
      rawReads++;
      return { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, i]) };
    });
    const raw = await pager.readPage(7);
    assert.equal(raw.bytes[4], 7, 'readPage must expose stable cover/source bytes');
    assert.equal(pager.cachedCount(), 0, 'raw cover reads must not create a session URL owner');

    const releases = [];
    const viewport = createComicViewport({
      host, mount, count: 20, initialPage: 0,
      loadPage: (i) => pager.loadPage(i),
      releaseOutside: (keep) => { releases.push([...keep].sort((a, b) => a - b)); pager.unloadOutside(keep); },
    });
    await wait(50);
    assert.equal(viewport.activePage, 0);
    assert.ok(viewport.residentCount <= 4, `first edge window must stay <=4 (actual ${viewport.residentCount})`);
    assert.ok(pager.cachedCount() <= 4, `first CBZ URL window must stay <=4 (actual ${pager.cachedCount()})`);

    await viewport.goTo(10);
    await wait(50);
    assert.equal(viewport.activePage, 10);
    assert.ok(viewport.residentCount <= 6, `middle resident window must stay <=6 (actual ${viewport.residentCount})`);
    assert.ok(pager.cachedCount() <= 6, `middle CBZ URL window must stay <=6 (actual ${pager.cachedCount()})`);
    assert.ok(releases.some(keep => keep.includes(8) && keep.includes(13) && !keep.includes(0)),
      `owner release must converge to the new page window (actual ${JSON.stringify(releases)})`);

    viewport.destroy();
    assert.equal(viewport.residentCount, 0);
    assert.equal(pager.cachedCount(), 0, 'destroy must call unloadOutside(empty)');
    assert.deepEqual(releases.at(-1), []);
    assert.ok(!mount.classList.contains('lib-page--virtual'));
    assert.ok(rawReads >= 8 && rawReads < 20, `viewport must prefetch a bounded subset, not all pages (${rawReads})`);
    host.remove();
  });

  test('failed page load degrades to an error slot and destroy stays idempotent', async () => {
    const host = document.createElement('div');
    const mount = document.createElement('div');
    host.appendChild(mount);
    document.body.appendChild(host);
    const releases = [];
    const viewport = createComicViewport({
      host, mount, count: 2,
      loadPage: async () => { throw new Error('corrupt page'); },
      releaseOutside: keep => releases.push([...keep]),
    });
    await wait(30);
    assert.ok(mount.querySelector('[data-i="0"]')?.classList.contains('is-error'));
    assert.equal(viewport.residentCount, 0);
    viewport.destroy();
    viewport.destroy();
    assert.deepEqual(releases.at(-1), []);
    host.remove();
  });

  test('CBZ owner generation drops a late page and cannot clobber its replacement', async () => {
    const first = deferred();
    const firstStarted = deferred();
    let reads = 0;
    const pager = makeBytesPager([0], async () => {
      reads++;
      if (reads === 1) {
        firstStarted.resolve();
        return first.promise;
      }
      return { mime: 'image/png', bytes: PNG };
    });

    const stale = pager.loadPage(0);
    await firstStarted.promise;
    assert.equal(pager.pendingCount(), 1);
    pager.unloadOutside(new Set());
    assert.equal(pager.pendingCount(), 0);

    const replacement = await pager.loadPage(0);
    assert.ok(replacement?.startsWith('blob:') || replacement?.startsWith('data:image/'));
    assert.equal(pager.cachedCount(), 1);

    first.resolve({ mime: 'image/png', bytes: PNG });
    assert.equal(await stale, null, 'retired page request must be discarded');
    assert.equal(pager.cachedCount(), 1, 'late retired request must not remove the replacement owner');
    assert.equal(await pager.loadPage(0), replacement, 'replacement URL must remain the canonical cached owner');

    pager.unloadAll();
    assert.equal(pager.cachedCount(), 0);
    assert.equal(pager.pendingCount(), 0);
    assert.equal(pager.liveCount(), 0);
  });

  test('CBZ unloadAll is terminal for an unresolved byte read', async () => {
    const bytes = deferred();
    const started = deferred();
    const pager = makeBytesPager([0], async () => {
      started.resolve();
      return bytes.promise;
    });
    const late = pager.loadPage(0);
    await started.promise;
    pager.unloadAll();
    bytes.resolve({ mime: 'image/png', bytes: PNG });
    assert.equal(await late, null);
    assert.equal(pager.cachedCount(), 0);
    assert.equal(pager.pendingCount(), 0);
    assert.equal(pager.liveCount(), 0);
    assert.equal(await pager.loadPage(0), null, 'disposed pager must not accept a new owner');
  });
});

describe('W88 stable cover cache', () => {
  test('successful persistence returns a stable media URL, never a session blob URL', async () => {
    const calls = [];
    const invoke = async (channel, payload) => { calls.push({ channel, payload }); return true; };
    const out = await persistCover({
      invoke, workspace: 'D:\\books\\workspace\\', bookId: 'book:unsafe/name',
      bytes: PNG, mime: 'image/png', ext: 'png',
    });
    assert.ok(out.coverPath.replace(/\\/g, '/').endsWith('/书库/.covers/book_unsafe_name.png'),
      `cover path must be stable and filename-safe (actual ${out.coverPath})`);
    assert.equal(out.cover, stableMediaUrl(out.coverPath));
    assert.ok(out.cover.startsWith('mazz-res://media/'));
    assert.ok(!out.cover.startsWith('blob:'), 'shelf records must never persist session blob URLs');
    assert.deepEqual(calls.map(x => x.channel), ['fs:mkdir', 'fs:writeFileBase64']);
    assert.equal(calls[1].payload.base64, Buffer.from(PNG).toString('base64'));
  });

  test('thumbnail/write failure degrades to a stable data URL without throwing', async () => {
    const priorBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async () => { throw new Error('decoder unavailable'); };
    try {
      const out = await persistCover({
        invoke: async () => { throw new Error('workspace read-only'); },
        workspace: 'D:/readonly', bookId: 'book', bytes: PNG, mime: 'image/png', ext: 'png',
      });
      assert.equal(out.coverPath, '');
      assert.ok(out.cover.startsWith('data:image/png;base64,'));
      assert.ok(!out.cover.startsWith('blob:'));
    } finally {
      if (priorBitmap === undefined) delete globalThis.createImageBitmap;
      else globalThis.createImageBitmap = priorBitmap;
    }
  });

  test('empty cover bytes produce an explicit empty record and no I/O', async () => {
    let calls = 0;
    const out = await persistCover({
      invoke: async () => { calls++; }, workspace: 'D:/ws', bookId: 'empty', bytes: new Uint8Array(), mime: 'image/png',
    });
    assert.deepEqual(out, { cover: '', coverPath: '' });
    assert.equal(calls, 0);
  });

  test('oversized or undecodable covers never fall back to unbounded shelf data URLs', async () => {
    let calls = 0;
    const tooLarge = await persistCover({
      invoke: async () => { calls++; }, workspace: 'D:/ws', bookId: 'huge',
      bytes: new Uint8Array(COVER_LIMITS.inputBytes + 1), mime: 'image/png',
    });
    assert.equal(tooLarge.cover, '');
    assert.equal(tooLarge.skipped, 'input-too-large');
    assert.equal(calls, 0, 'rejected covers must not enter filesystem IPC');

    const priorBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async () => { throw new Error('decode bomb'); };
    try {
      const decodeFailure = await persistCover({
        invoke: async () => { calls++; }, workspace: 'D:/ws', bookId: 'decode',
        bytes: new Uint8Array(COVER_LIMITS.persistedBytes + 1), mime: 'image/png',
      });
      assert.equal(decodeFailure.cover, '');
      assert.equal(decodeFailure.skipped, 'thumbnail-failed');
      assert.equal(calls, 0, 'large decoder failures must not encode or persist original bytes');
    } finally {
      if (priorBitmap === undefined) delete globalThis.createImageBitmap;
      else globalThis.createImageBitmap = priorBitmap;
    }
  });
});

describe('W88 ZIP entry pre-decompression limits', () => {
  test('central-directory expansion bombs are rejected before JSZip async allocation', async () => {
    let asyncCalls = 0;
    const entry = {
      name: 'bomb.xhtml',
      _data: { uncompressedSize: cacheLimits.MAX_CACHE_TEXT_ITEM_BYTES + 1 },
      async: async () => { asyncCalls++; return 'never'; },
    };
    await assert.rejects(
      () => readZipEntryBounded(entry, 'text', {
        maxBytes: cacheLimits.MAX_CACHE_TEXT_ITEM_BYTES,
        label: 'bomb chapter',
      }),
      error => error?.code === 'LIBRARY_ZIP_ENTRY_TOO_LARGE'
        && error.declaredBytes === cacheLimits.MAX_CACHE_TEXT_ITEM_BYTES + 1,
    );
    assert.equal(asyncCalls, 0, 'limit must be checked before entry.async() starts decompression');
  });

  test('forged central-directory sizes cannot bypass the streaming expansion budget', async () => {
    const zip = new JSZip();
    zip.file('forged.xhtml', new Uint8Array(1024 * 1024).fill(0x41));
    const archive = await zip.generateAsync({
      type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 },
    });
    const loaded = await JSZip.loadAsync(archive);
    const entry = loaded.file('forged.xhtml');
    entry._data.uncompressedSize = 1; // attacker-controlled central-directory metadata
    const maxBytes = 64 * 1024;
    await assert.rejects(
      () => readZipEntryBounded(entry, 'uint8array', { maxBytes, label: 'forged chapter' }),
      error => error?.code === 'LIBRARY_ZIP_ENTRY_TOO_LARGE'
        && error.actualBytes > maxBytes
        && error.actualBytes <= maxBytes + (16 * 1024),
    );
  });
});

describe('W88 MOBI expansion limits', () => {
  test('PalmDOC expansion and declared text length fail closed before unbounded allocation or fallback', async () => {
    assert.throws(
      () => lz77(new Uint8Array([0x02, 0x41, 0x42, 0x80, 0x08]), { maxOutputBytes: 4 }),
      error => error?.code === 'LIBRARY_MOBI_RESOURCE_LIMIT',
    );

    const bytes = new Uint8Array(240);
    const view = new DataView(bytes.buffer);
    view.setUint16(76, 2, false);
    view.setUint32(78, 100, false);
    view.setUint32(86, 200, false);
    view.setUint16(100, 1, false);
    view.setUint32(104, MOBI_RESOURCE_LIMITS.textBytes + 1, false);
    view.setUint16(108, 1, false);
    bytes.set(new TextEncoder().encode('MOBI'), 116);
    await assert.rejects(
      () => parseMobi(bytes.buffer),
      error => error?.code === 'LIBRARY_MOBI_RESOURCE_LIMIT'
        && error.textLength === MOBI_RESOURCE_LIMITS.textBytes + 1,
    );
  });

  test('encoding sniffing samples 64 KiB but decodes the complete classic MOBI body', async () => {
    const expected = 'hello world '.repeat(7000);
    const body = new TextEncoder().encode(expected);
    const bytes = new Uint8Array(256 + body.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(76, 2, false);
    view.setUint32(78, 100, false);
    view.setUint32(86, 256, false);
    view.setUint16(100, 1, false);
    view.setUint32(104, body.length, false);
    view.setUint16(108, 1, false);
    bytes.set(new TextEncoder().encode('MOBI'), 116);
    view.setUint32(120, 232, false);
    view.setUint32(128, 65001, false);
    bytes.set(body, 256);
    const parsed = await parseMobi(bytes.buffer);
    assert.ok(parsed.text.length > 65536, 'long classic MOBI must not be truncated to the sniff sample');
    assert.equal(parsed.text, expected.trim());
  });

  test('malformed EXTH counts and zero-length records fail before an unbounded metadata loop', async () => {
    const body = new TextEncoder().encode('safe body');
    const bytes = new Uint8Array(256 + body.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(76, 2, false);
    view.setUint32(78, 100, false);
    view.setUint32(86, 256, false);
    view.setUint16(100, 1, false);
    view.setUint32(104, body.length, false);
    view.setUint16(108, 1, false);
    bytes.set(new TextEncoder().encode('MOBI'), 116);
    view.setUint32(120, 120, false);
    view.setUint32(128, 65001, false);
    view.setUint32(228, 0x40, false);
    bytes.set(new TextEncoder().encode('EXTH'), 236);
    view.setUint32(240, 20, false);
    view.setUint32(244, 0xffffffff, false);
    bytes.set(body, 256);
    await assert.rejects(
      () => parseMobi(bytes.buffer),
      error => error?.code === 'LIBRARY_MOBI_METADATA_INVALID',
    );
  });
});

describe('W88 text and illustrated-MOBI classification', () => {
  test('TXT uses strict UTF-8 probing and reaches the GBK fallback without damaging valid UTF-8', () => {
    assert.equal(
      decodeText(Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4])),
      '中文测试',
    );
    assert.equal(decodeText(new TextEncoder().encode('UTF-8 正常')), 'UTF-8 正常');
  });

  test('three illustrations do not turn a readable MOBI into a comic', () => {
    assert.equal(shouldTreatMobiAsComic({ imageCount: 3, text: '正文'.repeat(410) }), false);
    assert.equal(shouldTreatMobiAsComic({ imageCount: 3, text: '短诗'.repeat(20) }), false);
    assert.equal(shouldTreatMobiAsComic({ imageCount: 3, text: '' }), true);
    assert.equal(shouldTreatMobiAsComic({ imageCount: 2, text: '' }), false);
  });
});

describe('W88 EPUB resource owners', () => {
  test('chapter aggregate byte budget stops later reads and retires every unresolved placeholder', async () => {
    let reads = 0;
    const chapters = makeOwnedChapterLoader({
      loadRaw: async ({ id }) => ({
        id,
        html: [0, 1, 2, 3].map(i => `<img id="budget-${i}" src="libimg:${i}">`).join('')
          + '<img id="orphan" src="libimg:99">',
        images: [0, 1, 2, 3].map(slot => ({ ext: 'png', slot })),
      }),
      getBytes: async () => { reads++; return new Uint8Array(3); },
      imageLimits: { count: 4, totalBytes: 5 },
    });

    const chapter = await chapters.loadChapter({ id: 'aggregate-budget' });
    assert.equal(reads, 2,
      'the first over-budget image may be measured, but no later entry may be requested');
    assert.doesNotMatch(chapter.html, /libimg:/, 'no live custom-scheme placeholder may reach the reader');
    assert.equal((chapter.html.match(/data-libimg-missing=/g) || []).length, 4,
      `current, remaining and orphan placeholders must retire: ${chapter.html}`);
    assert.match(chapter.html, /(?:blob:|data:image\/)/, 'the one within-budget image remains readable');
    assert.ok(chapters.liveImageCount() <= 1,
      `live URL owners must stay within the successful image budget (${chapters.liveImageCount()})`);

    chapters.unloadAll();
    assert.equal(chapters.liveImageCount(), 0, 'owner retirement must release the already-created URL');
  });

  test('published chapter image limits are finite hard bounds', () => {
    assert.equal(EPUB_CHAPTER_IMAGE_LIMITS.count, 64);
    assert.equal(EPUB_CHAPTER_IMAGE_LIMITS.totalBytes, 96 * 1024 * 1024);
    assert.ok(Object.isFrozen(EPUB_CHAPTER_IMAGE_LIMITS));
  });

  test('chapter owner generation revokes partial materialization after unloadAll', async () => {
    const secondBytes = deferred();
    const secondStarted = deferred();
    let reads = 0;
    const chapters = makeOwnedChapterLoader({
      loadRaw: async ({ id }) => ({
        id,
        html: '<img src="libimg:0"><img src="libimg:1">',
        images: [{ ext: 'png', slot: 0 }, { ext: 'png', slot: 1 }],
      }),
      getBytes: async () => {
        reads++;
        if (reads === 1) return PNG;
        secondStarted.resolve();
        return secondBytes.promise;
      },
    });

    const late = chapters.loadChapter({ id: 'late' });
    await secondStarted.promise;
    assert.equal(chapters.pendingCount(), 1);
    chapters.unloadAll();
    assert.equal(chapters.loadedCount(), 0);
    assert.equal(chapters.pendingCount(), 0);
    assert.equal(chapters.liveImageCount(), 0, 'the first, already-created image owner must be revoked immediately');

    secondBytes.resolve(PNG);
    assert.equal(await late, null, 'destroyed chapter request must be discarded');
    assert.equal(chapters.loadedCount(), 0);
    assert.equal(chapters.pendingCount(), 0);
    assert.equal(chapters.liveImageCount(), 0, 'late bytes must not recreate a blob owner');
  });

  test('retired chapter request cannot revoke a newer owner for the same chapter id', async () => {
    const firstBytes = deferred();
    const firstStarted = deferred();
    let reads = 0;
    const chapters = makeOwnedChapterLoader({
      loadRaw: async ({ id }) => ({ id, html: '<img src="libimg:0">', images: [{ ext: 'png' }] }),
      getBytes: async () => {
        reads++;
        if (reads === 1) {
          firstStarted.resolve();
          return firstBytes.promise;
        }
        return PNG;
      },
    });

    const stale = chapters.loadChapter({ id: 'same' });
    await firstStarted.promise;
    chapters.unloadOutside(new Set());
    const replacement = await chapters.loadChapter({ id: 'same' });
    assert.ok(replacement?.html.includes('blob:') || replacement?.html.includes('data:image/'));
    assert.equal(chapters.loadedCount(), 1);

    firstBytes.resolve(PNG);
    assert.equal(await stale, null);
    assert.equal(chapters.loadedCount(), 1, 'stale finalizer must not delete the replacement chapter');
    const again = await chapters.loadChapter({ id: 'same' });
    assert.equal(again, replacement);
    if (typeof URL.createObjectURL === 'function') {
      assert.equal(chapters.liveImageCount(), 1, 'stale owner cleanup must preserve the replacement blob');
    }

    chapters.unloadAll();
    assert.equal(chapters.loadedCount(), 0);
    assert.equal(chapters.pendingCount(), 0);
    assert.equal(chapters.liveImageCount(), 0);
  });

  test('scoped viewport lease cannot unload chapters owned by a replacement viewport', async () => {
    const chapters = makeOwnedChapterLoader({
      loadRaw: async ({ id }) => ({ id, html: `<p>${id}</p>`, images: [] }),
      getBytes: async () => null,
    });
    const retiredOwner = Symbol('retired-text-viewport');
    const replacementOwner = Symbol('replacement-text-viewport');
    await chapters.loadChapter({ id: 'old-0' }, retiredOwner);
    for (const id of ['new-9', 'new-10', 'new-11']) {
      await chapters.loadChapter({ id }, replacementOwner);
    }
    assert.equal(chapters.loadedCount(), 4);

    chapters.unloadOutside(new Set(['old-0', 'old-1']), retiredOwner);
    assert.equal(chapters.loadedCount(), 4,
      'retired owner keep-set must not revoke replacement owner chapters');
    chapters.releaseOwner(retiredOwner);
    assert.equal(chapters.loadedCount(), 3);
    for (const id of ['new-9', 'new-10', 'new-11']) {
      assert.ok(await chapters.loadChapter({ id }, replacementOwner), `${id} must remain materialized`);
    }
    chapters.releaseOwner(replacementOwner);
    assert.equal(chapters.loadedCount(), 0);
  });

  test('native EPUB unloadOutside releases only retired chapter owners and unloadAll includes cover', async () => {
    const epub = await parseEpub(await makeOwnedEpub());
    const blobs = typeof URL.createObjectURL === 'function';
    await epub.loadChapter(epub.spine[0]);
    await epub.loadChapter(epub.spine[1]);
    assert.equal(epub.loadedCount(), 2);
    if (blobs) assert.equal(epub.liveImageCount(), 3, 'cover + two chapter image owners');

    epub.unloadOutside(new Set(['c2']));
    assert.equal(epub.loadedCount(), 1);
    if (blobs) assert.equal(epub.liveImageCount(), 2, 'cover and retained chapter must survive');
    const c1Again = await epub.loadChapter(epub.spine[0]);
    assert.ok(c1Again.html.includes('blob:') || c1Again.html.includes('data:image/'));
    assert.equal(epub.loadedCount(), 2, 'retired chapter must be safely rematerializable');

    epub.unloadAll();
    assert.equal(epub.loadedCount(), 0);
    assert.equal(epub.liveImageCount(), 0);
  });

  test('cache adapter preserves the same owner/release contract as native EPUB', async () => {
    const previousMazz = window.mazz;
    const files = new Map();
    const stat = { size: 456, mtime: 789 };
    window.mazz = {
      invoke: async (channel, payload = {}) => {
        if (channel === 'workspace:get') return '/w88';
        if (channel === 'fs:mkdir') return true;
        if (channel === 'fs:writeFileBase64') { files.set(payload.path, payload.base64); return true; }
        if (channel === 'fs:stat') return { exists: files.has(payload.path) };
        if (channel === 'fs:readFileBase64') return files.get(payload.path);
        throw new Error(`unexpected ${channel}`);
      },
    };
    const source = {
      title: 'Cached Owner Test', author: 'W88', toc: [],
      spine: [{ id: 'a', href: 'a.xhtml', type: 'application/xhtml+xml' }, { id: 'b', href: 'b.xhtml', type: 'application/xhtml+xml' }],
      coverRaw: { zipPath: 'cover.png', ext: 'png' },
      loadChapterRaw: async (item) => ({
        id: item.id, html: `<p>${item.id}</p><img src="libimg:0">`,
        images: [{ zipPath: `${item.id}.png`, ext: 'png' }],
      }),
      readZipBytes: async () => PNG,
    };
    try {
      assert.equal(await writeBookCache('cache-book', stat, source), true);
      const cached = await readBookCache('cache-book', stat);
      assert.ok(cached?._fromCache);
      await cached.loadChapter(cached.spine[0]);
      await cached.loadChapter(cached.spine[1]);
      assert.equal(cached.loadedCount(), 2);
      if (typeof URL.createObjectURL === 'function') assert.equal(cached.liveImageCount(), 3);

      cached.unloadOutside(new Set(['b']));
      assert.equal(cached.loadedCount(), 1);
      if (typeof URL.createObjectURL === 'function') assert.equal(cached.liveImageCount(), 2);
      cached.unloadAll();
      assert.equal(cached.loadedCount(), 0);
      assert.equal(cached.liveImageCount(), 0);
    } finally {
      window.mazz = previousMazz;
    }
  });

  test('cache I/O stays bound to the repository-captured workspace after global workspace switch', async () => {
    const previousMazz = window.mazz;
    const files = new Map();
    const reads = [];
    const writes = [];
    let liveWorkspace = 'D:/Cache-A';
    const rawStarted = deferred();
    const rawGate = deferred();
    const invoke = async (channel, payload = {}) => {
      if (channel === 'workspace:get') return liveWorkspace;
      if (channel === 'fs:mkdir') return true;
      if (channel === 'fs:writeFileBase64') {
        writes.push(payload.path);
        files.set(payload.path, payload.base64);
        return true;
      }
      if (channel === 'fs:stat') return { exists: files.has(payload.path) };
      if (channel === 'fs:readFileBase64') {
        reads.push(payload.path);
        return files.get(payload.path);
      }
      throw new Error(`unexpected ${channel}`);
    };
    window.mazz = { invoke };
    const stat = { size: 12, mtime: 34 };
    const source = {
      title: 'Workspace Cache', author: '', toc: [], coverRaw: null,
      spine: [{ id: 'one', href: 'one.xhtml', type: 'application/xhtml+xml' }],
      loadChapterRaw: async item => {
        rawStarted.resolve();
        await rawGate.promise;
        return { id: item.id, html: '<p>one</p>', images: [] };
      },
      readZipBytes: async () => null,
    };
    try {
      const delayedWrite = writeBookCache('captured', stat, source, {
        workspace: 'D:/Cache-A', invoke,
      });
      await rawStarted.promise;
      liveWorkspace = 'D:/Cache-B';
      rawGate.resolve();
      assert.equal(await delayedWrite, true);
      assert.deepEqual(writes, ['D:/Cache-A/书库/.cache/captured.zip']);

      liveWorkspace = 'D:/Cache-C';
      const cached = await readBookCache('captured', stat, {
        workspace: 'D:/Cache-A', invoke,
      });
      assert.ok(cached?._fromCache, 'old tab must still address its captured A cache');
      assert.deepEqual(reads, ['D:/Cache-A/书库/.cache/captured.zip']);
      assert.equal(await readBookCache('captured', stat, {
        workspace: liveWorkspace, invoke,
      }), null, 'new workspace must not see the old repository cache');
      assert.ok(!writes.some(path => path.includes('/Cache-B/') || path.includes('/Cache-C/')),
        'global workspace changes must not redirect old-tab writes');
      cached.unloadAll();
    } finally {
      window.mazz = previousMazz;
    }
  });

  test('oversized cache archives fail closed before base64 read and valid reads carry a hard IPC cap', async () => {
    const calls = [];
    const tooLarge = await readBookCache('oversized-cache', { size: 1, mtime: 1 }, {
      workspace: 'D:/Cache-Limit',
      invoke: async (channel, payload = {}) => {
        calls.push({ channel, payload });
        if (channel === 'fs:mkdir') return true;
        if (channel === 'fs:stat') {
          return { exists: true, size: cacheLimits.MAX_CACHE_ARCHIVE_BYTES + 1 };
        }
        if (channel === 'fs:readFileBase64') throw new Error('oversized cache must not be read');
        throw new Error(`unexpected ${channel}`);
      },
    });
    assert.equal(tooLarge, null);
    assert.equal(calls.filter(call => call.channel === 'fs:readFileBase64').length, 0,
      'declared oversized cache must be rejected before base64 allocation');

    let readPayload = null;
    const corruptButBounded = await readBookCache('bounded-corrupt-cache', { size: 1, mtime: 1 }, {
      workspace: 'D:/Cache-Limit',
      invoke: async (channel, payload = {}) => {
        if (channel === 'fs:mkdir') return true;
        if (channel === 'fs:stat') return { exists: true, size: 32 };
        if (channel === 'fs:readFileBase64') {
          readPayload = payload;
          return Buffer.from('not a zip').toString('base64');
        }
        throw new Error(`unexpected ${channel}`);
      },
    });
    assert.equal(corruptButBounded, null);
    assert.equal(readPayload?.maxBytes, cacheLimits.MAX_CACHE_ARCHIVE_BYTES,
      'TOCTOU-safe main-process read must receive the same cache archive cap');
  });

  test('cache writer rejects tiny-source expansion bombs before JSZip output', async () => {
    const previousMazz = window.mazz;
    const writes = [];
    const invoke = async (channel, payload = {}) => {
      if (channel === 'workspace:get') return 'D:/Bomb';
      if (channel === 'fs:mkdir') return true;
      if (channel === 'fs:writeFileBase64') { writes.push(payload.path); return true; }
      throw new Error(`unexpected ${channel}`);
    };
    window.mazz = { invoke };
    const stat = { size: 128, mtime: 1 };
    const giantUtf8 = '界'.repeat(Math.floor(cacheLimits.MAX_CACHE_TEXT_ITEM_BYTES / 3) + 1);
    const rawBomb = {
      title: 'raw bomb', author: '', toc: [], coverRaw: null,
      spine: [{ id: 'raw', href: 'raw.xhtml' }],
      loadChapterRaw: async item => ({ id: item.id, html: giantUtf8, images: [] }),
      readZipBytes: async () => null,
    };
    const imageBomb = {
      title: 'image bomb', author: '', toc: [], coverRaw: null,
      spine: [{ id: 'image', href: 'image.xhtml' }],
      loadChapterRaw: async item => ({
        id: item.id, html: '<p>small</p>', images: [{ zipPath: 'huge.png', ext: 'png' }],
      }),
      readZipBytes: async () => ({ byteLength: cacheLimits.MAX_CACHE_BINARY_ITEM_BYTES + 1 }),
    };
    try {
      assert.equal(await writeBookCache('raw-bomb', stat, rawBomb, { workspace: 'D:/Bomb', invoke }), false);
      assert.equal(await writeBookCache('image-bomb', stat, imageBomb, { workspace: 'D:/Bomb', invoke }), false);
      const budget = cacheLimits.createCacheBudget();
      for (let i = 0; i < 6; i++) {
        assert.equal(budget.reserve(cacheLimits.MAX_CACHE_BINARY_ITEM_BYTES, cacheLimits.MAX_CACHE_BINARY_ITEM_BYTES), true);
      }
      assert.equal(budget.used, cacheLimits.MAX_CACHE_UNCOMPRESSED_BYTES);
      assert.equal(budget.reserve(1, cacheLimits.MAX_CACHE_BINARY_ITEM_BYTES), false,
        'aggregate uncompressed cap must be hard even when every item is individually valid');
      assert.deepEqual(writes, [], 'rejected expansion bombs must never reach fs:writeFileBase64');
    } finally {
      window.mazz = previousMazz;
    }
  });

  test('ZIP central-directory entry amplification is rejected before JSZip builds entry objects', async () => {
    const eocd = (entries) => {
      const centralBytes = entries <= 64 ? entries * 46 : 0;
      const bytes = new Uint8Array(centralBytes + 22);
      const view = new DataView(bytes.buffer);
      if (centralBytes) {
        for (let i = 0; i < entries; i++) view.setUint32(i * 46, 0x02014b50, true);
      }
      view.setUint32(centralBytes, 0x06054b50, true);
      view.setUint16(centralBytes + 8, entries, true);
      view.setUint16(centralBytes + 10, entries, true);
      view.setUint32(centralBytes + 12, centralBytes, true);
      view.setUint32(centralBytes + 16, 0, true);
      return bytes;
    };
    assert.equal(assertZipEntryCount(eocd(12), {
      maxEntries: MAX_EPUB_ARCHIVE_ENTRIES,
      label: 'test archive',
    }), 12);
    assert.throws(() => assertZipEntryCount(eocd(MAX_EPUB_ARCHIVE_ENTRIES + 1), {
      maxEntries: MAX_EPUB_ARCHIVE_ENTRIES,
      label: 'test archive',
    }), error => error?.code === 'LIBRARY_ZIP_TOO_MANY_ENTRIES');
    assert.throws(() => assertZipEntryCount(eocd(0xffff), {
      maxEntries: MAX_EPUB_ARCHIVE_ENTRIES,
      label: 'ZIP64 archive',
    }), error => error?.code === 'LIBRARY_ZIP_TOO_MANY_ENTRIES');

    const real = eocd(MAX_EPUB_ARCHIVE_ENTRIES + 1);
    const fake = eocd(1).slice(-22);
    const disguised = new Uint8Array(real.length + fake.length);
    disguised.set(real);
    disguised.set(fake, real.length);
    new DataView(disguised.buffer).setUint16(20, fake.length, true);
    assert.throws(() => assertZipEntryCount(disguised, {
      maxEntries: MAX_EPUB_ARCHIVE_ENTRIES,
      label: 'comment-disguised archive',
    }), error => error?.code === 'LIBRARY_ZIP_TOO_MANY_ENTRIES',
    'a forged EOCD inside the real archive comment must never lower the declared entry count');
  });
});
