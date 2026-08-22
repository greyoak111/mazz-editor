// W88 Library resident-set gate.
// Real Electron only: two-book identity switching, 100-chapter EPUB bounded
// residency, 300-page CBZ virtualization, and shelf-return resource release.
// Missing product probes are hard failures; this runner never converts them to SKIP/PASS.
import { _electron as electron } from 'playwright';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const { extractFile: extractAsarFile } = require('@electron/asar');

const ROOT = path.resolve('.');
const MODE = String(process.env.MAZZ_W88_MODE || (process.env.MAZZ_W88_EXECUTABLE ? 'packaged' : 'source')).toLowerCase();
const EXECUTABLE = String(process.env.MAZZ_W88_EXECUTABLE || '');
const EPUB_RESIDENT_MAX = Number(process.env.MAZZ_W88_EPUB_RESIDENT_MAX || 7);
const CBZ_RESIDENT_MAX = Number(process.env.MAZZ_W88_CBZ_RESIDENT_MAX || 6);
const KEEP_TMP = process.env.MAZZ_W88_KEEP_TMP === '1';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w88-library-${MODE}-user-`));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w88-library-${MODE}-ws-`));
const booksDir = path.join(workspace, '书库');
fs.mkdirSync(booksDir, { recursive: true });

const fixtures = {
  a: { id: 'w88-epub-a', title: 'W88 百章甲卷', marker: 'W88_A_ASSET_MARKER', path: path.join(booksDir, 'W88-百章甲卷.epub'), format: 'epub' },
  b: { id: 'w88-epub-b', title: 'W88 乙卷', marker: 'W88_B_ASSET_MARKER', path: path.join(booksDir, 'W88-乙卷.epub'), format: 'epub' },
  cbz: { id: 'w88-cbz-300', title: 'W88 三百页漫画', path: path.join(booksDir, 'W88-三百页漫画.cbz'), format: 'cbz' },
};

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

async function writeEpub(file, { title, marker, chapters }) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const manifest = [];
  const spine = [];
  const nav = [];
  for (let index = 0; index < chapters; index += 1) {
    const no = String(index + 1).padStart(3, '0');
    const id = `chapter-${no}`;
    const href = `chapters/ch${no}.xhtml`;
    manifest.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    nav.push(`<navPoint id="nav-${no}" playOrder="${index + 1}"><navLabel><text>第 ${no} 章</text></navLabel><content src="${href}"/></navPoint>`);
    zip.file(`OEBPS/${href}`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xml(title)} 第 ${no} 章</title></head>
<body><h1>第 ${no} 章</h1><p>${xml(marker)} · chapter-${no}</p>
<p>${'本章用于验证跨书切换身份、有限章节驻留与资源回收。'.repeat(10)}</p>
<img src="../images/pixel.png" alt="W88-${no}"/></body></html>`);
  }
  zip.file('OEBPS/images/pixel.png', onePixelPng);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${xml(title)}</dc:title><dc:creator>W88 E2E</dc:creator><dc:language>zh-CN</dc:language>
    <dc:identifier id="book-id">urn:mazz:w88:${xml(marker)}</dc:identifier>
  </metadata>
  <manifest>${manifest.join('')}<item id="pixel" href="images/pixel.png" media-type="image/png"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
  <spine toc="ncx">${spine.join('')}</spine>
</package>`);
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:mazz:w88:${xml(marker)}"/></head>
  <docTitle><text>${xml(title)}</text></docTitle><navMap>${nav.join('')}</navMap>
</ncx>`);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function writeCbz(file, pages = 300) {
  const zip = new JSZip();
  for (let index = 1; index <= pages; index += 1) {
    zip.file(`page-${String(index).padStart(4, '0')}.png`, onePixelPng);
  }
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
}

const results = [];
const runtimeErrors = [];
const observations = { switch: {}, epub: [], cbz: [], cleanup: {} };
let app;
let win;

function assert(condition, message, code = 'W88_ASSERT') {
  if (!condition) throw Object.assign(new Error(`${code}: ${message}`), { code });
}

function assertFreshSourceBuild() {
  if (EXECUTABLE) return;
  const bundle = path.join(ROOT, 'renderer', 'dist', 'app.js');
  const inputs = [
    'renderer/modules/library/index.js',
    'renderer/modules/library/epub.js',
    'renderer/modules/library/cbz.js',
    'renderer/modules/library/cache.js',
    'renderer/modules/library/comic-viewport.js',
  ].map(file => path.join(ROOT, file)).filter(file => fs.existsSync(file));
  assert(fs.existsSync(bundle), 'renderer/dist/app.js missing; run npm run build first', 'W88_RENDERER_BUILD_MISSING');
  const bundleMtime = fs.statSync(bundle).mtimeMs;
  const newer = inputs.filter(file => fs.statSync(file).mtimeMs > bundleMtime + 1000).map(file => path.relative(ROOT, file));
  assert(newer.length === 0,
    `renderer/dist/app.js is older than ${newer.join(', ')}; run npm run build before the source gate`,
    'W88_RENDERER_DIST_STALE');
}

async function gate(name, fn) {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    results.push({ name, verdict: 'PASS', durationMs: Date.now() - startedAt, detail });
    console.log(`[W88] PASS ${name}`);
    return detail;
  } catch (error) {
    results.push({
      name,
      verdict: 'FAIL',
      durationMs: Date.now() - startedAt,
      code: error.code || 'W88_GATE_FAILURE',
      error: error.message,
    });
    console.error(`[W88] FAIL ${name}: ${error.stack || error.message}`);
    return null;
  }
}

function fingerprint(snapshot) {
  const payload = JSON.stringify({
    id: snapshot.id,
    path: snapshot.path,
    title: snapshot.title,
    format: snapshot.format,
    spineCount: snapshot.spineCount,
    firstSpine: snapshot.firstSpine,
    lastSpine: snapshot.lastSpine,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function sha256File(file) {
  if (!file || !fs.existsSync(file)) return null;
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runtimeArtifact() {
  if (!EXECUTABLE) {
    const bundle = path.join(ROOT, 'renderer', 'dist', 'app.js');
    return { kind: 'source', bundle: 'renderer/dist/app.js', sha256: sha256File(bundle) };
  }
  const executable = path.resolve(EXECUTABLE);
  const appAsar = path.join(path.dirname(executable), 'resources', 'app.asar');
  const embeddedBundleSha256 = createHash('sha256')
    .update(extractAsarFile(appAsar, path.join('renderer', 'dist', 'app.js')))
    .digest('hex');
  return {
    kind: 'packaged',
    executable,
    sha256: sha256File(executable),
    appAsar: { path: appAsar, sha256: sha256File(appAsar) },
    embeddedBundle: { path: 'renderer/dist/app.js', sha256: embeddedBundleSha256 },
  };
}

function gitCoordinate() {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return { head, dirty };
  } catch {
    return { head: null, dirty: null };
  }
}

async function installBlobProbe() {
  const state = await win.evaluate(() => {
    if (window.__w88UrlProbe) return window.__w88UrlProbe.snapshot();
    const originalCreate = URL.createObjectURL?.bind(URL);
    const originalRevoke = URL.revokeObjectURL?.bind(URL);
    if (!originalCreate || !originalRevoke) return { installed: false, reason: 'URL blob API unavailable' };
    const live = new Set();
    let created = 0;
    let revoked = 0;
    URL.createObjectURL = (blob) => {
      const value = originalCreate(blob);
      live.add(value);
      created += 1;
      return value;
    };
    URL.revokeObjectURL = (value) => {
      if (live.delete(value)) revoked += 1;
      return originalRevoke(value);
    };
    window.__w88UrlProbe = {
      snapshot: () => ({ installed: true, created, revoked, live: live.size, urls: [...live].slice(0, 8) }),
      has: value => live.has(value),
    };
    return window.__w88UrlProbe.snapshot();
  });
  assert(state.installed, state.reason || 'blob URL probe did not install', 'W88_PROBE_MISSING');
}

async function setLibrarySelect(selector, value) {
  const state = await win.evaluate(({ selector, value }) => {
    const view = document.defaultView;
    const select = window.__activeLibraryCtl?.root?.querySelector(selector)
      || document.querySelector(`.pane.active .lib-reader ${selector}`);
    if (!view || !(select instanceof view.HTMLSelectElement)) return { ok: false, reason: `missing ${selector}` };
    const option = [...select.options].find(item => item.value === value);
    if (!option) return { ok: false, reason: `missing option ${value}` };
    const setter = Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, 'value')?.set;
    if (setter) setter.call(select, value);
    else select.value = value;
    select.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
    select.dispatchEvent(new view.Event('change', { bubbles: true, composed: true }));
    const proxy = select.nextElementSibling?.matches?.('.selmenu-btn') ? select.nextElementSibling : null;
    const label = proxy?.querySelector('.selmenu-label')?.textContent?.trim() || '';
    return { ok: select.value === value && (!proxy || label === option.textContent.trim()), value: select.value, label, proxied: !!proxy };
  }, { selector, value });
  assert(state.ok, `select ${selector} -> ${value}: ${JSON.stringify(state)}`, 'W88_SELECT_SEMANTICS');
  return state;
}

async function registerBooks() {
  await win.evaluate(async (records) => {
    await window.mazz.invoke('settings:set', { key: 'library.books', value: records.map(record => ({
      ...record,
      author: 'W88 E2E',
      cover: '',
      category: '未分类',
      addedAt: Date.now(),
    })) });
    await window.MazzCommands.execute('file.newLibrary');
  }, Object.values(fixtures));
  await win.waitForSelector('.lib-shelf .lib-card', { state: 'attached', timeout: 30000 });
}

async function openFromShelf(book) {
  const card = win.locator(`.lib-card[data-id="${book.id}"]`).last();
  await card.waitFor({ state: 'visible', timeout: 30000 });
  await card.click();
  await waitForBook(book);
}

async function switchBook(book) {
  const accepted = await win.evaluate(id => window.__activeLibraryCtl?.openBook?.(id), book.id);
  assert(accepted === true, `openBook(${book.id}) returned ${String(accepted)}`, 'W88_BOOK_SWITCH_REJECTED');
  await waitForBook(book);
}

async function waitForBook(book) {
  try {
    await win.waitForFunction(({ id, marker, format }) => {
      const ctl = window.__activeLibraryCtl;
      const frame = document.querySelector('.lib-reader iframe.lib-book-frame');
      if (ctl?.book?.meta?.id !== id) return false;
      if (format === 'epub') return (frame?.contentDocument?.body?.textContent || '').includes(marker);
      if (format === 'cbz') return ctl.book?.cbz?.count > 0 && document.querySelectorAll('.lib-reader .lib-manga-page').length > 0;
      return true;
    }, { id: book.id, marker: book.marker || '', format: book.format }, { timeout: 60000 });
  } catch (error) {
    const state = await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      const frame = document.querySelector('.lib-reader iframe.lib-book-frame');
      return {
        activeId: ctl?.book?.meta?.id || null,
        activePath: ctl?.book?.meta?.path || null,
        chapterIdx: ctl?.chapterIdx ?? null,
        frameText: (frame?.contentDocument?.body?.textContent || '').trim().slice(0, 160),
      };
    }).catch(() => null);
    throw Object.assign(new Error(`book ${book.id} did not converge: ${JSON.stringify(state)} (${error.message})`), { code: 'W88_BOOK_READY_TIMEOUT' });
  }
}

async function epubSnapshot(marker) {
  return win.evaluate(markerValue => {
    const ctl = window.__activeLibraryCtl;
    const book = ctl?.book;
    const epub = book?.epub;
    const frame = document.querySelector('.lib-reader iframe.lib-book-frame');
    const doc = frame?.contentDocument;
    const spine = epub?.spine || [];
    const images = [...(doc?.querySelectorAll('img') || [])];
    return {
      id: book?.meta?.id || '',
      path: book?.meta?.path || '',
      title: book?.meta?.title || '',
      format: book?.meta?.format || '',
      chapterIdx: ctl?.chapterIdx,
      spineCount: spine.length,
      firstSpine: spine[0] ? { id: spine[0].id, href: spine[0].href } : null,
      lastSpine: spine.at(-1) ? { id: spine.at(-1).id, href: spine.at(-1).href } : null,
      markerVisible: (doc?.body?.textContent || '').includes(markerValue),
      frameTextLength: (doc?.body?.textContent || '').length,
      frameImages: images.length,
      decodedFrameImages: images.filter(image => image.complete && image.naturalWidth > 0).length,
      frameImageUrlsLive: images.every(image => !image.src.startsWith('blob:') || window.__w88UrlProbe?.has?.(image.src)),
      domChapterCount: doc?.querySelectorAll('.lib-chap-mark, .lib-scroll-page, .lib-text-slot.is-loaded').length || 0,
      textSlotCount: doc?.querySelectorAll('.lib-text-slot').length || 0,
      hasTextViewport: !!book?._textViewport,
      textResidentCount: Number.isInteger(book?._textViewport?.residentCount) ? book._textViewport.residentCount : null,
      textPendingCount: Number.isInteger(book?._textViewport?.pendingCount) ? book._textViewport.pendingCount : null,
      loadedCount: typeof epub?.loadedCount === 'function' ? epub.loadedCount() : null,
      liveImageCount: typeof epub?.liveImageCount === 'function' ? epub.liveImageCount() : null,
      procCacheCount: ctl?._procCache ? Object.keys(ctl._procCache).length : null,
      blob: window.__w88UrlProbe?.snapshot?.() || null,
    };
  }, marker);
}

function assertEpubProbe(snapshot, expectedChapters, { requireTextViewport = false } = {}) {
  assert(snapshot.spineCount === expectedChapters, `spine=${snapshot.spineCount}, expected ${expectedChapters}`, 'W88_EPUB_FIXTURE');
  assert(snapshot.markerVisible, `book marker missing for ${snapshot.id}`, 'W88_BOOK_FINGERPRINT');
  assert(Number.isInteger(snapshot.loadedCount), 'epub.loadedCount() probe is required', 'W88_PROBE_MISSING');
  assert(Number.isInteger(snapshot.liveImageCount), 'epub.liveImageCount() probe is required', 'W88_PROBE_MISSING');
  assert(Number.isInteger(snapshot.procCacheCount), 'ctl._procCache residency probe is required', 'W88_PROBE_MISSING');
  // A resource-bearing chapter deliberately bypasses processed-HTML caching:
  // persisting materialized blob URLs would resurrect revoked sources after a
  // virtual section leaves and re-enters the resident window. The real-content
  // gate is loaded owner + live image + decoded frame; procCache may be zero.
  assert(snapshot.loadedCount >= 1 && snapshot.liveImageCount >= 1,
    `EPUB fixture did not materialize a real chapter/image ${JSON.stringify(snapshot)}`, 'W88_EPUB_NOT_MATERIALIZED');
  assert(snapshot.frameImages >= 1 && snapshot.decodedFrameImages >= 1 && snapshot.frameImageUrlsLive,
    `EPUB frame owns missing/revoked image URLs ${JSON.stringify(snapshot)}`, 'W88_EPUB_STALE_BLOB');
  assert(snapshot.loadedCount <= EPUB_RESIDENT_MAX, `loaded chapters ${snapshot.loadedCount} > ${EPUB_RESIDENT_MAX}`, 'W88_EPUB_RESIDENT_OVERFLOW');
  assert(snapshot.liveImageCount <= EPUB_RESIDENT_MAX, `live EPUB image URLs ${snapshot.liveImageCount} > ${EPUB_RESIDENT_MAX}`, 'W88_EPUB_BLOB_OVERFLOW');
  assert(snapshot.procCacheCount <= EPUB_RESIDENT_MAX, `processed chapters ${snapshot.procCacheCount} > ${EPUB_RESIDENT_MAX}`, 'W88_EPUB_PROC_CACHE_OVERFLOW');
  assert(snapshot.blob?.live >= 1 && snapshot.blob.live <= EPUB_RESIDENT_MAX,
    `tracked EPUB blob residents outside 1..${EPUB_RESIDENT_MAX}: ${JSON.stringify(snapshot.blob)}`, 'W88_EPUB_BLOB_OVERFLOW');
  if (snapshot.domChapterCount) {
    assert(snapshot.domChapterCount <= EPUB_RESIDENT_MAX, `resident chapter DOM ${snapshot.domChapterCount} > ${EPUB_RESIDENT_MAX}`, 'W88_EPUB_DOM_OVERFLOW');
  }
  if (requireTextViewport) {
    assert(snapshot.hasTextViewport, 'book._textViewport is required in EPUB scroll mode', 'W88_PROBE_MISSING');
    assert(Number.isInteger(snapshot.textResidentCount), 'text viewport residentCount is required', 'W88_PROBE_MISSING');
    assert(Number.isInteger(snapshot.textPendingCount), 'text viewport pendingCount is required', 'W88_PROBE_MISSING');
    assert(snapshot.textResidentCount <= EPUB_RESIDENT_MAX,
      `text viewport residents ${snapshot.textResidentCount} > ${EPUB_RESIDENT_MAX}`, 'W88_EPUB_VIEWPORT_OVERFLOW');
    assert(snapshot.textPendingCount <= EPUB_RESIDENT_MAX,
      `text viewport pending ${snapshot.textPendingCount} > ${EPUB_RESIDENT_MAX}`, 'W88_EPUB_PENDING_OVERFLOW');
    assert(snapshot.textSlotCount === expectedChapters,
      `text virtual rail slots ${snapshot.textSlotCount}, expected ${expectedChapters}`, 'W88_EPUB_VIRTUAL_RAIL');
  }
}

async function captureHandle(name, kind) {
  await win.evaluate(({ name, kind }) => {
    window.__w88Handles ||= {};
    const book = window.__activeLibraryCtl?.book;
    window.__w88Handles[name] = kind === 'epub'
      ? { kind, epub: book?.epub }
      : { kind, cbz: book?.cbz, viewport: book?._comicViewport };
  }, { name, kind });
}

async function handleSnapshot(name) {
  return win.evaluate(handleName => {
    const handle = window.__w88Handles?.[handleName];
    if (!handle) return null;
    return {
      kind: handle.kind,
      loadedCount: typeof handle.epub?.loadedCount === 'function' ? handle.epub.loadedCount() : null,
      liveImageCount: typeof handle.epub?.liveImageCount === 'function' ? handle.epub.liveImageCount() : null,
      cachedCount: typeof handle.cbz?.cachedCount === 'function' ? handle.cbz.cachedCount() : null,
      residentCount: Number.isInteger(handle.viewport?.residentCount) ? handle.viewport.residentCount : null,
    };
  }, name);
}

async function goToEpubChapter(index) {
  const found = await win.evaluate(target => {
    const item = document.querySelector(`.lib-toc-item[data-i="${target}"]`);
    item?.click();
    return !!item;
  }, index);
  assert(found, `TOC item ${index} missing`, 'W88_EPUB_NAVIGATION');
  await win.waitForFunction(target => window.__activeLibraryCtl?.chapterIdx === target, index, { timeout: 30000 });
  await win.waitForTimeout(500);
}

async function goToTextSection(index) {
  const state = await win.evaluate(async target => {
    const ctl = window.__activeLibraryCtl;
    const viewport = ctl?.book?._textViewport;
    if (!viewport?.goTo) return { ok: false, reason: 'book._textViewport.goTo missing' };
    await viewport.goTo(target);
    return { ok: true };
  }, index);
  assert(state.ok, state.reason, 'W88_PROBE_MISSING');
  await win.waitForFunction(target => window.__activeLibraryCtl?.book?._textViewport?.activeSection === target, index, { timeout: 30000 });
  await win.waitForTimeout(500);
}

async function backToShelf(handleName, kind) {
  await captureHandle(handleName, kind);
  await win.locator('.lib-reader [data-a="back"]').click();
  await win.waitForFunction(() => {
    const ctl = window.__activeLibraryCtl;
    const shelf = document.querySelector('.lib-shelf-view');
    return ctl && !ctl.book && shelf && getComputedStyle(shelf).display !== 'none';
  }, null, { timeout: 30000 });
  await win.waitForTimeout(350);
}

async function shelfCleanupSnapshot(handleName) {
  const handle = await handleSnapshot(handleName);
  const dom = await win.evaluate(() => ({
    activeBook: window.__activeLibraryCtl?.book?.meta?.id || null,
    readerVisible: (() => { const el = document.querySelector('.lib-reader'); return !!el && getComputedStyle(el).display !== 'none'; })(),
    frames: document.querySelectorAll('.lib-reader iframe.lib-book-frame').length,
    mangaImages: document.querySelectorAll('.lib-reader .lib-manga-page').length,
    blobImages: [...document.querySelectorAll('.lib-reader img')].filter(img => img.src.startsWith('blob:')).length,
    blob: window.__w88UrlProbe?.snapshot?.() || null,
  }));
  return { handle, dom };
}

function assertShelfCleanup(snapshot, kind) {
  assert(snapshot.dom.activeBook === null, `active book remains ${snapshot.dom.activeBook}`, 'W88_SHELF_OWNER_LEAK');
  assert(!snapshot.dom.readerVisible, 'reader remains visible on shelf', 'W88_SHELF_VISUAL_LEAK');
  assert(snapshot.dom.frames === 0 && snapshot.dom.mangaImages === 0 && snapshot.dom.blobImages === 0,
    `reader DOM remains ${JSON.stringify(snapshot.dom)}`, 'W88_SHELF_DOM_LEAK');
  assert(snapshot.dom.blob?.live === 0, `tracked blob URLs remain ${JSON.stringify(snapshot.dom.blob)}`, 'W88_SHELF_BLOB_LEAK');
  assert(snapshot.handle, 'captured resource handle missing', 'W88_PROBE_MISSING');
  if (kind === 'epub') {
    assert(snapshot.handle.loadedCount === 0 && snapshot.handle.liveImageCount === 0,
      `EPUB handle not empty ${JSON.stringify(snapshot.handle)}`, 'W88_EPUB_RELEASE_LEAK');
  } else {
    assert(snapshot.handle.cachedCount === 0, `CBZ cache not empty ${JSON.stringify(snapshot.handle)}`, 'W88_CBZ_RELEASE_LEAK');
    assert(snapshot.handle.residentCount === 0, `comic viewport not empty ${JSON.stringify(snapshot.handle)}`, 'W88_CBZ_VIEWPORT_LEAK');
  }
}

async function cbzSnapshot() {
  return win.evaluate(() => {
    const ctl = window.__activeLibraryCtl;
    const book = ctl?.book;
    const pager = book?.cbz;
    const viewport = book?._comicViewport;
    const images = [...document.querySelectorAll('.lib-reader .lib-manga-page')];
    return {
      id: book?.meta?.id || '',
      count: pager?.count ?? null,
      pageIdx: ctl?.pageIdx ?? null,
      hasViewport: !!viewport,
      residentCount: Number.isInteger(viewport?.residentCount) ? viewport.residentCount : null,
      cachedCount: typeof pager?.cachedCount === 'function' ? pager.cachedCount() : null,
      domImages: images.length,
      decodedImages: images.filter(image => image.complete && image.naturalWidth > 0).length,
      imageUrlsLive: images.every(image => !image.src.startsWith('blob:') || window.__w88UrlProbe?.has?.(image.src)),
      domSlots: document.querySelectorAll('.lib-reader .lib-comic-slot').length,
      blob: window.__w88UrlProbe?.snapshot?.() || null,
    };
  });
}

function assertCbzProbe(snapshot) {
  assert(snapshot.count === 300, `CBZ page count ${snapshot.count}, expected 300`, 'W88_CBZ_FIXTURE');
  assert(snapshot.hasViewport, 'book._comicViewport is required in scroll mode', 'W88_PROBE_MISSING');
  assert(Number.isInteger(snapshot.residentCount), 'comic viewport residentCount is required', 'W88_PROBE_MISSING');
  assert(Number.isInteger(snapshot.cachedCount), 'cbz.cachedCount() is required', 'W88_PROBE_MISSING');
  assert(snapshot.residentCount >= 1 && snapshot.cachedCount >= 1 && snapshot.domImages >= 1,
    `CBZ fixture did not materialize a real image ${JSON.stringify(snapshot)}`, 'W88_CBZ_NOT_MATERIALIZED');
  assert(snapshot.decodedImages >= 1 && snapshot.imageUrlsLive,
    `CBZ viewport owns missing/revoked image URLs ${JSON.stringify(snapshot)}`, 'W88_CBZ_STALE_BLOB');
  assert(snapshot.residentCount <= CBZ_RESIDENT_MAX, `resident images ${snapshot.residentCount} > ${CBZ_RESIDENT_MAX}`, 'W88_CBZ_RESIDENT_OVERFLOW');
  assert(snapshot.cachedCount <= CBZ_RESIDENT_MAX, `cached blobs ${snapshot.cachedCount} > ${CBZ_RESIDENT_MAX}`, 'W88_CBZ_CACHE_OVERFLOW');
  assert(snapshot.domImages <= CBZ_RESIDENT_MAX, `resident image DOM ${snapshot.domImages} > ${CBZ_RESIDENT_MAX}`, 'W88_CBZ_DOM_OVERFLOW');
  assert(snapshot.blob?.live >= 1 && snapshot.blob.live <= CBZ_RESIDENT_MAX,
    `tracked CBZ blob residents outside 1..${CBZ_RESIDENT_MAX}: ${JSON.stringify(snapshot.blob)}`, 'W88_CBZ_BLOB_OVERFLOW');
  assert(snapshot.domSlots === 300, `virtual rail slots ${snapshot.domSlots}, expected 300`, 'W88_CBZ_VIRTUAL_RAIL');
}

async function goToComicPage(index) {
  const state = await win.evaluate(async target => {
    const ctl = window.__activeLibraryCtl;
    const viewport = ctl?.book?._comicViewport;
    if (!viewport?.goTo) return { ok: false, reason: 'book._comicViewport.goTo missing' };
    await viewport.goTo(target);
    return { ok: true };
  }, index);
  assert(state.ok, state.reason, 'W88_PROBE_MISSING');
  await win.waitForFunction(target => window.__activeLibraryCtl?.book?._comicViewport?.activePage === target, index, { timeout: 30000 });
  await win.waitForTimeout(500);
}

try {
  assertFreshSourceBuild();
  await Promise.all([
    writeEpub(fixtures.a.path, { title: fixtures.a.title, marker: fixtures.a.marker, chapters: 100 }),
    writeEpub(fixtures.b.path, { title: fixtures.b.title, marker: fixtures.b.marker, chapters: 5 }),
    writeCbz(fixtures.cbz.path, 300),
  ]);
  const launch = {
    args: EXECUTABLE ? [] : [ROOT],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_E2E_DISABLE_GPU: '1',
    },
    timeout: 120000,
  };
  if (EXECUTABLE) launch.executablePath = EXECUTABLE;
  app = await electron.launch(launch);
  app.process()?.stdout?.on('data', chunk => {
    const text = String(chunk);
    if (/\b(?:uncaught|TypeError|ReferenceError|Error:)\b/i.test(text) && !/Debugger listening/i.test(text)) runtimeErrors.push(`[main:stdout] ${text.trim()}`);
  });
  app.process()?.stderr?.on('data', chunk => {
    const text = String(chunk);
    if (/\b(?:uncaught|TypeError|ReferenceError|Error:)\b/i.test(text) && !/Debugger listening/i.test(text)) runtimeErrors.push(`[main:stderr] ${text.trim()}`);
  });
  win = await app.firstWindow({ timeout: 120000 });
  win.setDefaultTimeout(60000);
  win.on('pageerror', error => runtimeErrors.push(`[pageerror] ${error.message}`));
  win.on('console', message => {
    const text = message.text();
    // Revoking a blob still referenced by a frame/image may make Chromium emit this
    // generic console line; the explicit URL/DOM release gates above remain authoritative.
    if (message.type() === 'error' && !/Autofill|SharedArrayBuffer|deprecat|Failed to load resource: net::ERR_FILE_NOT_FOUND/i.test(text)) {
      runtimeErrors.push(`[console.error] ${text}`);
    }
  });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzCommands && !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await Promise.all([
      window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
      window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
    ]);
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
  });
  await installBlobProbe();
  await registerBooks();

  await gate('两书切换保持独立且稳定的资产/渲染指纹', async () => {
    await openFromShelf(fixtures.a);
    const a1 = await epubSnapshot(fixtures.a.marker);
    await captureHandle('a-before-b', 'epub');
    await switchBook(fixtures.b);
    const b = await epubSnapshot(fixtures.b.marker);
    const oldA = await handleSnapshot('a-before-b');
    assert(oldA?.loadedCount === 0 && oldA?.liveImageCount === 0,
      `switch A->B retained A resources ${JSON.stringify(oldA)}`, 'W88_SWITCH_OWNER_LEAK');
    await captureHandle('b-before-a', 'epub');
    await switchBook(fixtures.a);
    const a2 = await epubSnapshot(fixtures.a.marker);
    const oldB = await handleSnapshot('b-before-a');
    assert(oldB?.loadedCount === 0 && oldB?.liveImageCount === 0,
      `switch B->A retained B resources ${JSON.stringify(oldB)}`, 'W88_SWITCH_OWNER_LEAK');
    const fpA1 = fingerprint(a1);
    const fpB = fingerprint(b);
    const fpA2 = fingerprint(a2);
    assert(fpA1 !== fpB, 'different EPUB assets produced the same fingerprint', 'W88_BOOK_FINGERPRINT');
    assert(fpA1 === fpA2, 'A fingerprint changed after A->B->A', 'W88_BOOK_FINGERPRINT');
    assert(a1.markerVisible && b.markerVisible && a2.markerVisible, 'render marker crossed books or disappeared', 'W88_BOOK_FINGERPRINT');
    observations.switch = { a1: fpA1, b: fpB, a2: fpA2, oldA, oldB };
    return observations.switch;
  });

  await gate('100 章 EPUB 在分页与滚动模式均保持 bounded resident set', async () => {
    if (await win.evaluate(() => window.__activeLibraryCtl?.book?.meta?.id) !== fixtures.a.id) await switchBook(fixtures.a);
    for (const index of [0, 49, 99]) {
      await goToEpubChapter(index);
      const snapshot = await epubSnapshot(fixtures.a.marker);
      assertEpubProbe(snapshot, 100);
      observations.epub.push({ mode: 'single', ...snapshot });
    }
    await setLibrarySelect('.lib-mode', 'scroll');
    await win.waitForFunction(() => !!window.__activeLibraryCtl?.book?._textViewport, null, { timeout: 30000 });
    for (const index of [0, 49, 99]) {
      await goToTextSection(index);
      const snapshot = await epubSnapshot(fixtures.a.marker);
      assertEpubProbe(snapshot, 100, { requireTextViewport: true });
      observations.epub.push({ mode: 'scroll', ...snapshot });
    }
    return { max: EPUB_RESIDENT_MAX, samples: observations.epub };
  });

  await gate('EPUB 返回书架后 iframe/cache/blob 全归零', async () => {
    await backToShelf('epub-before-shelf', 'epub');
    const snapshot = await shelfCleanupSnapshot('epub-before-shelf');
    observations.cleanup.epub = snapshot;
    assertShelfCleanup(snapshot, 'epub');
    return snapshot;
  });

  await gate('300 页 CBZ 滚动模式保持虚拟 rail 与 bounded resident set', async () => {
    const onShelf = await win.evaluate(() => !window.__activeLibraryCtl?.book);
    if (!onShelf) await backToShelf('pre-cbz-shelf', 'epub');
    await openFromShelf(fixtures.cbz);
    await setLibrarySelect('.lib-mode', 'scroll');
    await win.waitForFunction(() => {
      const ctl = window.__activeLibraryCtl;
      const viewport = ctl?.book?._comicViewport;
      return (viewport && viewport.residentCount >= 1) || document.querySelectorAll('.lib-reader .lib-manga-page').length >= 300;
    }, null, { timeout: 60000 });
    let snapshot = await cbzSnapshot();
    assertCbzProbe(snapshot);
    observations.cbz.push(snapshot);
    for (const index of [149, 299, 0]) {
      await goToComicPage(index);
      snapshot = await cbzSnapshot();
      assertCbzProbe(snapshot);
      observations.cbz.push(snapshot);
    }
    return { max: CBZ_RESIDENT_MAX, samples: observations.cbz };
  });

  await gate('CBZ 返回书架后 viewport/cache/blob 全归零', async () => {
    const hasBook = await win.evaluate(() => !!window.__activeLibraryCtl?.book);
    if (!hasBook) throw Object.assign(new Error('CBZ cleanup precondition missing: reader already left'), { code: 'W88_CLEANUP_PRECONDITION' });
    await backToShelf('cbz-before-shelf', 'cbz');
    const snapshot = await shelfCleanupSnapshot('cbz-before-shelf');
    observations.cleanup.cbz = snapshot;
    assertShelfCleanup(snapshot, 'cbz');
    return snapshot;
  });

  await gate('W88 全程零主进程/renderer 异常', async () => {
    assert(runtimeErrors.length === 0, runtimeErrors.slice(0, 8).join('\n'), 'W88_RUNTIME_ERROR');
    return { errors: [] };
  });
} catch (error) {
  results.push({ name: 'runner bootstrap', verdict: 'FAIL', code: error.code || 'W88_BOOTSTRAP', error: error.message });
  console.error('[W88] bootstrap failure:', error.stack || error.message);
} finally {
  try { await app?.close(); } catch {}
  if (!KEEP_TMP) {
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
    try { fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  }
}

const failed = results.filter(result => result.verdict !== 'PASS');
const report = {
  protocol: 'mazz.w88-library-residency/v1',
  createdAt: new Date().toISOString(),
  mode: MODE,
  git: gitCoordinate(),
  runtime: runtimeArtifact(),
  verdict: failed.length ? 'FAIL' : 'PASS',
  bounds: { epubResidentMax: EPUB_RESIDENT_MAX, cbzResidentMax: CBZ_RESIDENT_MAX },
  fixtures: { epubChapters: 100, cbzPages: 300 },
  results,
  runtimeErrors,
  observations,
  temp: KEEP_TMP ? { userData, workspace } : null,
};
const evidenceDir = path.join(ROOT, 'docs', 'engineering', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const evidenceFile = path.join(evidenceDir, `W88_LIBRARY_RESIDENCY_${MODE === 'packaged' ? 'PACKAGED' : 'SOURCE'}.json`);
fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2) + '\n');
console.log(`W88_RESULT=${JSON.stringify(report)}`);
process.exit(failed.length ? 1 : 0);
