// W88 Library experience gate.
//
// Real Electron only. This runner exercises the public Library command entry
// and the real renderer DOM with a 1,000-record shelf. It intentionally does
// not use Computer Use, private module imports, or a browser-only DOM shim.
// Missing product probes are hard failures; no assertion is converted to SKIP.
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
const requestedShelfCount = Number(process.env.MAZZ_W88_SHELF_COUNT || 1000);
const requestedDomMax = Number(process.env.MAZZ_W88_SHELF_DOM_MAX || 96);
const SHELF_COUNT = Number.isFinite(requestedShelfCount) ? Math.max(1000, Math.trunc(requestedShelfCount)) : 1000;
const DOM_CARD_MAX = Number.isFinite(requestedDomMax) ? Math.max(24, Math.trunc(requestedDomMax)) : 96;
const KEEP_TMP = process.env.MAZZ_W88_KEEP_TMP === '1';
const EVIDENCE_DIR = path.resolve(process.env.MAZZ_W88_EVIDENCE_DIR
  || path.join(ROOT, 'docs', 'engineering', 'evidence'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w88-experience-${MODE}-user-`));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w88-experience-${MODE}-ws-`));
const booksDir = path.join(workspace, '书库');
fs.mkdirSync(booksDir, { recursive: true });

const targetIndex = Math.min(SHELF_COUNT - 1, 777);
const target = Object.freeze({
  id: `w88x-book-${String(targetIndex).padStart(4, '0')}`,
  title: `W88 体验目标 ${String(targetIndex).padStart(4, '0')} 密钥`,
  marker: 'W88_EXPERIENCE_TARGET_MARKER',
  path: path.join(booksDir, 'W88-体验目标.epub'),
  format: 'epub',
  chapters: 4,
});

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

async function writeEpub(file) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const manifest = [];
  const spine = [];
  const nav = [];
  for (let index = 0; index < target.chapters; index += 1) {
    const no = String(index + 1).padStart(2, '0');
    const id = `chapter-${no}`;
    const href = `chapter-${no}.xhtml`;
    manifest.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    nav.push(`<navPoint id="nav-${no}" playOrder="${index + 1}"><navLabel><text>第 ${no} 章</text></navLabel><content src="${href}"/></navPoint>`);
    zip.file(`OEBPS/${href}`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xml(target.title)} 第 ${no} 章</title></head>
<body><h1>第 ${no} 章</h1><p>${target.marker} · chapter-${no}</p>
    <p>${'真实 Electron 键盘输入与阅读偏好持久化验证。'.repeat(20)}</p></body></html>`);
  }
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${xml(target.title)}</dc:title><dc:creator>W88 E2E</dc:creator><dc:language>zh-CN</dc:language>
    <dc:identifier id="book-id">urn:mazz:w88:experience</dc:identifier>
  </metadata>
  <manifest>${manifest.join('')}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
  <spine toc="ncx">${spine.join('')}</spine>
</package>`);
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:mazz:w88:experience"/></head>
  <docTitle><text>${xml(target.title)}</text></docTitle><navMap>${nav.join('')}</navMap>
</ncx>`);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

function createShelfRecords() {
  const formats = ['epub', 'pdf', 'cbz', 'mobi'];
  const categories = ['文学', '漫画', '研究', '待阅读'];
  const base = Date.UTC(2026, 7, 20, 0, 0, 0);
  return Array.from({ length: SHELF_COUNT }, (_, index) => {
    const no = String(index).padStart(4, '0');
    const format = index === targetIndex ? target.format : formats[index % formats.length];
    return {
      id: `w88x-book-${no}`,
      title: index === targetIndex ? target.title : `W88 书架样本 ${String(SHELF_COUNT - index).padStart(4, '0')}`,
      author: index === targetIndex ? 'W88 键盘作者' : `作者 ${String(index % 37).padStart(2, '0')}`,
      cover: '',
      path: index === targetIndex ? target.path : path.join(booksDir, `W88-虚拟-${no}.${format}`),
      sourcePath: index === targetIndex ? target.path : path.join(booksDir, `W88-虚拟-${no}.${format}`),
      format,
      category: index === targetIndex ? '待阅读' : categories[index % categories.length],
      addedAt: base - (index * 10_000),
      lastOpenedAt: index % 9 === 0 ? base + index : 0,
      favorite: index === targetIndex || index % 10 === 0,
      missing: index === targetIndex ? false : index % 17 === 0,
    };
  });
}

const records = createShelfRecords();
const expected = Object.freeze({
  epub: records.filter(book => book.format === 'epub').length,
  favorite: records.filter(book => book.favorite).length,
  missing: records.filter(book => book.missing).length,
});
const seededProgress = Object.freeze({
  [target.id]: {
    chapter: 1,
    totalPages: target.chapters,
    ratio: 0.17,
    pct: 0.62,
    overallRatio: 0.62,
    updatedAt: Date.UTC(2026, 7, 21, 8, 0, 0),
  },
});

const results = [];
const runtimeErrors = [];
const observations = { shelf: {}, query: {}, progress: {}, input: {}, preferences: {}, cleanup: {} };
let app;
let win;

function assert(condition, message, code = 'W88X_ASSERT') {
  if (!condition) throw Object.assign(new Error(`${code}: ${message}`), { code });
}

async function gate(name, operation) {
  const startedAt = Date.now();
  try {
    const detail = await operation();
    results.push({ name, verdict: 'PASS', durationMs: Date.now() - startedAt, detail });
    console.log(`[W88X] PASS ${name}`);
    return detail;
  } catch (error) {
    results.push({
      name,
      verdict: 'FAIL',
      durationMs: Date.now() - startedAt,
      code: error.code || 'W88X_GATE_FAILURE',
      error: error.message,
    });
    console.error(`[W88X] FAIL ${name}: ${error.stack || error.message}`);
    return null;
  }
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

function assertFreshSourceBuild() {
  if (EXECUTABLE) return;
  const bundle = path.join(ROOT, 'renderer', 'dist', 'app.js');
  const inputs = [
    'renderer/modules/library/index.js',
    'renderer/modules/library/repository.js',
    'renderer/modules/library/shelf-model.js',
    'renderer/modules/library/shelf-view.js',
    'renderer/modules/library/reader-input.js',
    'renderer/modules/library/reader-prefs.js',
    'renderer/modules/library/text-viewport.js',
  ].map(file => path.join(ROOT, file)).filter(file => fs.existsSync(file));
  assert(fs.existsSync(bundle), 'renderer/dist/app.js missing; run npm run build first', 'W88X_RENDERER_BUILD_MISSING');
  const builtAt = fs.statSync(bundle).mtimeMs;
  const newer = inputs.filter(file => fs.statSync(file).mtimeMs > builtAt + 1000).map(file => path.relative(ROOT, file));
  assert(!newer.length, `renderer/dist/app.js is older than ${newer.join(', ')}; run npm run build first`, 'W88X_RENDERER_DIST_STALE');
}

async function seedAndOpenLibrary() {
  await win.evaluate(async ({ records, progress, categories }) => {
    await Promise.all([
      window.mazz.invoke('settings:set', { key: 'library.books', value: records }),
      window.mazz.invoke('settings:set', { key: 'library.progress', value: progress }),
      window.mazz.invoke('settings:set', { key: 'library.categories', value: categories }),
    ]);
    await window.MazzCommands.execute('file.newLibrary');
  }, { records, progress: seededProgress, categories: ['文学', '漫画', '研究', '待阅读'] });
  await win.waitForFunction(count => {
    const ctl = window.__activeLibraryCtl;
    return ctl?.shelf?.snapshot?.total === count
      && ctl?.shelfView?.metrics?.total === count
      && document.querySelector('.lib-shelf-view')?.getBoundingClientRect().width > 0;
  }, SHELF_COUNT, { timeout: 60000 });
}

async function shelfSnapshot() {
  return win.evaluate(() => {
    const ctl = window.__activeLibraryCtl;
    const host = ctl?.root?.querySelector('.lib-shelf');
    const snapshot = ctl?.shelf?.snapshot;
    const metrics = ctl?.shelfView?.metrics;
    return {
      total: snapshot?.total ?? null,
      filteredTotal: snapshot?.filteredTotal ?? null,
      query: snapshot?.query ?? null,
      sort: snapshot?.sort ?? null,
      filters: snapshot?.filters || null,
      first: snapshot?.items?.[0] ? {
        id: snapshot.items[0].book?.id,
        title: snapshot.items[0].book?.title,
        format: snapshot.items[0].book?.format,
        favorite: snapshot.items[0].book?.favorite,
        missing: snapshot.items[0].book?.missing,
        progress: snapshot.items[0].progress,
      } : null,
      metrics: metrics ? { ...metrics } : null,
      domCards: host?.querySelectorAll('.lib-card').length ?? -1,
      domIds: [...(host?.querySelectorAll('.lib-card') || [])].map(card => card.dataset.id),
      clientHeight: host?.clientHeight ?? 0,
      scrollHeight: host?.scrollHeight ?? 0,
      scrollTop: host?.scrollTop ?? 0,
      countLabel: ctl?.root?.querySelector('.lib-count')?.textContent?.trim() || '',
    };
  });
}

async function setShelfQuery(value) {
  const input = win.locator('.lib-shelf-view:visible .lib-shelf-query');
  await input.fill(value);
  await win.waitForFunction(expected => window.__activeLibraryCtl?.shelf?.snapshot?.query === expected, value, { timeout: 15000 });
  return shelfSnapshot();
}

async function setShelfSelect(selector, value, stateKey, expectedValue = value) {
  const result = await win.evaluate(({ selector, value }) => {
    const ctl = window.__activeLibraryCtl;
    const select = ctl?.root?.querySelector(selector);
    if (!select) return { ok: false, reason: `missing ${selector}` };
    const option = [...select.options].find(item => item.value === value);
    if (!option) return { ok: false, reason: `missing option ${value}`, options: [...select.options].map(item => item.value) };
    select.value = value;
    select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    select.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return { ok: true, value: select.value };
  }, { selector, value });
  assert(result.ok, JSON.stringify(result), 'W88X_SELECT_SEMANTICS');
  await win.waitForFunction(({ stateKey, expectedValue }) => {
    const ctl = window.__activeLibraryCtl;
    const actual = stateKey === 'catFilter' ? ctl?.catFilter : ctl?.shelf?.[stateKey];
    return String(actual ?? '') === String(expectedValue);
  }, { stateKey, expectedValue }, { timeout: 15000 });
  return shelfSnapshot();
}

async function resetShelfFilters() {
  await setShelfQuery('');
  await setShelfSelect('.lib-cat-filter', '', 'catFilter', '');
  await setShelfSelect('.lib-shelf-format', '', 'format', '');
  await setShelfSelect('.lib-shelf-missing', 'all', 'missing', 'all');
  const favorite = await win.evaluate(() => !!window.__activeLibraryCtl?.shelf?.favoriteOnly);
  if (favorite) {
    await win.locator('.lib-shelf-view:visible [data-a="shelf-favorite"]').click();
    await win.waitForFunction(() => window.__activeLibraryCtl?.shelf?.favoriteOnly === false);
  }
  await setShelfSelect('.lib-shelf-sort', 'recent', 'sort', 'recent');
}

async function waitForTargetBook() {
  await win.waitForFunction(({ id, marker }) => {
    const ctl = window.__activeLibraryCtl;
    const frame = ctl?.root?.querySelector('iframe.lib-book-frame');
    let text = '';
    try { text = frame?.contentDocument?.body?.textContent || ''; } catch {}
    return ctl?.book?.meta?.id === id && text.includes(marker);
  }, { id: target.id, marker: target.marker }, { timeout: 60000 });
}

async function openTargetFromKeyboard() {
  await setShelfQuery('体验目标 密钥');
  await win.waitForFunction(id => {
    const ctl = window.__activeLibraryCtl;
    return ctl?.shelf?.snapshot?.filteredTotal === 1
      && ctl?.root?.querySelector('.lib-card')?.dataset.id === id;
  }, target.id, { timeout: 15000 });
  const card = win.locator(`.lib-shelf-view:visible .lib-card[data-id="${target.id}"]`);
  await card.focus();
  await card.press('Enter');
  await waitForTargetBook();
}

async function setReaderSelect(selector, value, controllerField, expectedValue = value) {
  const state = await win.evaluate(({ selector, value }) => {
    const ctl = window.__activeLibraryCtl;
    const select = ctl?.root?.querySelector(selector);
    if (!select) return { ok: false, reason: `missing ${selector}` };
    if (![...select.options].some(item => item.value === value)) {
      return { ok: false, reason: `missing option ${value}`, options: [...select.options].map(item => item.value) };
    }
    select.value = value;
    select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    select.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return { ok: true };
  }, { selector, value });
  assert(state.ok, JSON.stringify(state), 'W88X_READER_SELECT');
  await win.waitForFunction(({ controllerField, expectedValue }) => {
    const actual = window.__activeLibraryCtl?.[controllerField];
    return String(actual) === String(expectedValue);
  }, { controllerField, expectedValue }, { timeout: 30000 });
}

async function backToShelf() {
  await win.locator('.lib-reader:visible [data-a="back"]').click();
  await win.waitForFunction(id => {
    const ctl = window.__activeLibraryCtl;
    const shelf = ctl?.root?.querySelector('.lib-shelf-view');
    return ctl && !ctl.book && shelf && getComputedStyle(shelf).display !== 'none'
      && document.activeElement?.classList?.contains('lib-card')
      && document.activeElement?.dataset?.id === id;
  }, target.id, { timeout: 60000 });
}

try {
  assertFreshSourceBuild();
  await writeEpub(target.path);
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

  await gate('Source 正式命令入口加载 1,000 条 workspace 书架', async () => {
    await seedAndOpenLibrary();
    const snapshot = await shelfSnapshot();
    assert(snapshot.total === SHELF_COUNT, `shelf total ${snapshot.total}, expected ${SHELF_COUNT}`, 'W88X_SHELF_COUNT');
    assert(snapshot.countLabel === `${SHELF_COUNT} 本`, `count label ${snapshot.countLabel}`, 'W88X_SHELF_COUNT_LABEL');
    assert(snapshot.metrics && snapshot.metrics.total === SHELF_COUNT, `missing shelf metrics ${JSON.stringify(snapshot)}`, 'W88X_SHELF_PROBE');
    observations.shelf.entry = snapshot;
    return { command: 'file.newLibrary', mode: MODE, ...snapshot };
  });

  await gate('1,000 条书架首屏与远端滚动均保持有界 DOM', async () => {
    let before = await shelfSnapshot();
    assert(before.domCards > 0 && before.domCards <= DOM_CARD_MAX,
      `initial card DOM ${before.domCards}, bound ${DOM_CARD_MAX}`, 'W88X_SHELF_DOM_BOUND');
    assert(before.metrics.endIndex - before.metrics.startIndex === before.domCards,
      `window/card mismatch ${JSON.stringify(before.metrics)} vs ${before.domCards}`, 'W88X_SHELF_WINDOW');
    assert(before.scrollHeight > before.clientHeight, `shelf is not scrollable ${JSON.stringify(before)}`, 'W88X_SHELF_VIRTUAL_RAIL');

    await win.evaluate(() => {
      const host = window.__activeLibraryCtl?.root?.querySelector('.lib-shelf');
      host.scrollTop = host.scrollHeight;
      host.dispatchEvent(new Event('scroll'));
    });
    await win.waitForFunction(() => window.__activeLibraryCtl?.shelfView?.metrics?.startIndex > 0, null, { timeout: 15000 });
    const after = await shelfSnapshot();
    assert(after.domCards > 0 && after.domCards <= DOM_CARD_MAX,
      `far card DOM ${after.domCards}, bound ${DOM_CARD_MAX}`, 'W88X_SHELF_DOM_BOUND');
    assert(after.metrics.startIndex > before.metrics.startIndex,
      `virtual window did not advance ${before.metrics.startIndex} -> ${after.metrics.startIndex}`, 'W88X_SHELF_WINDOW');
    assert(after.domIds.some(id => !before.domIds.includes(id)), 'far scroll retained only the initial cards', 'W88X_SHELF_WINDOW');
    observations.shelf.virtual = { before, after };
    return observations.shelf.virtual;
  });

  await gate('搜索、排序、格式、收藏与缺失筛选共享同一书架投影', async () => {
    await resetShelfFilters();
    const searched = await setShelfQuery('体验目标 密钥');
    assert(searched.filteredTotal === 1 && searched.first?.id === target.id,
      `target search mismatch ${JSON.stringify(searched)}`, 'W88X_SHELF_SEARCH');

    await setShelfQuery('');
    const sorted = await setShelfSelect('.lib-shelf-sort', 'title', 'sort', 'title');
    assert(sorted.filteredTotal === SHELF_COUNT && sorted.first?.id,
      `title sort lost records ${JSON.stringify(sorted)}`, 'W88X_SHELF_SORT');
    assert(sorted.domIds[0] === sorted.first.id,
      `DOM/model first mismatch ${sorted.domIds[0]} vs ${sorted.first.id}`, 'W88X_SHELF_SORT');

    const epub = await setShelfSelect('.lib-shelf-format', 'epub', 'format', 'epub');
    assert(epub.filteredTotal === expected.epub && epub.first?.format === 'epub',
      `EPUB filter ${epub.filteredTotal}, expected ${expected.epub}`, 'W88X_SHELF_FORMAT');
    await setShelfSelect('.lib-shelf-format', '', 'format', '');

    const missing = await setShelfSelect('.lib-shelf-missing', 'only', 'missing', 'only');
    assert(missing.filteredTotal === expected.missing && missing.first?.missing === true,
      `missing filter ${missing.filteredTotal}, expected ${expected.missing}`, 'W88X_SHELF_MISSING');
    await setShelfSelect('.lib-shelf-missing', 'all', 'missing', 'all');

    await win.locator('.lib-shelf-view:visible [data-a="shelf-favorite"]').click();
    await win.waitForFunction(() => window.__activeLibraryCtl?.shelf?.favoriteOnly === true);
    const favorite = await shelfSnapshot();
    assert(favorite.filteredTotal === expected.favorite && favorite.first?.favorite === true,
      `favorite filter ${favorite.filteredTotal}, expected ${expected.favorite}`, 'W88X_SHELF_FAVORITE');
    observations.query = { searched, sorted, epub, missing, favorite, expected };
    return observations.query;
  });

  await gate('书架卡片使用全书进度投影，不误用章内 ratio', async () => {
    await resetShelfFilters();
    const snapshot = await setShelfQuery('体验目标 密钥');
    const progress = snapshot.first?.progress;
    const dom = await win.evaluate(id => {
      const card = window.__activeLibraryCtl?.root?.querySelector(`.lib-card[data-id="${id}"]`);
      const bar = card?.querySelector('.lib-card-progress');
      const fill = card?.querySelector('.lib-card-progress-fill');
      return {
        card: !!card,
        value: bar?.getAttribute('aria-valuenow') || null,
        cssValue: fill?.style?.getPropertyValue('--lib-progress') || null,
      };
    }, target.id);
    assert(progress?.status === 'reading' && Math.abs(progress.ratio - 0.62) < 1e-9,
      `projected progress ${JSON.stringify(progress)}`, 'W88X_SHELF_PROGRESS');
    assert(dom.card && dom.value === '62' && dom.cssValue === '62%',
      `progress DOM ${JSON.stringify(dom)}`, 'W88X_SHELF_PROGRESS_DOM');
    observations.progress = { model: progress, dom, legacyChapterRatio: seededProgress[target.id].ratio };
    return observations.progress;
  });

  await gate('书架 Enter 开书与 iframe PageDown 通过统一输入边界', async () => {
    await openTargetFromKeyboard();
    await win.waitForFunction(() => {
      const ctl = window.__activeLibraryCtl;
      return Number(ctl?.readerInput?.attachedCount || 0) >= 2
        && typeof ctl?._flowNav === 'function';
    }, null, { timeout: 30000 });
    const before = await win.evaluate(() => ({
      id: window.__activeLibraryCtl?.book?.meta?.id,
      chapter: window.__activeLibraryCtl?.chapterIdx,
      flowOffset: window.__activeLibraryCtl?._flowOffset || 0,
      attachedInputTargets: window.__activeLibraryCtl?.readerInput?.attachedCount,
      flowReady: typeof window.__activeLibraryCtl?._flowNav === 'function',
      frame: !!window.__activeLibraryCtl?.root?.querySelector('iframe.lib-book-frame'),
    }));
    assert(before.id === target.id && before.frame, `keyboard open state ${JSON.stringify(before)}`, 'W88X_KEYBOARD_OPEN');
    const frameBody = win.frameLocator('.lib-reader:visible iframe.lib-book-frame').locator('body');
    await frameBody.waitFor({ state: 'attached', timeout: 30000 });
    const focusProbe = await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      const frame = ctl?.root?.querySelector('iframe.lib-book-frame');
      const body = frame?.contentDocument?.body;
      if (!frame || !body) return { parentActive: null, active: null, frameFocused: false };
      const frameWindow = frame.contentWindow;
      frameWindow.__w88ReaderInputProbe = { key: null, count: 0, target: null };
      frameWindow.__w88ReaderInputProbeListener = event => {
        frameWindow.__w88ReaderInputProbe = {
          key: event.key,
          count: Number(frameWindow.__w88ReaderInputProbe?.count || 0) + 1,
          target: event.target?.tagName || null,
        };
      };
      frame.contentDocument.addEventListener('keydown', frameWindow.__w88ReaderInputProbeListener, true);
      return {
        parentActive: document.activeElement?.tagName || null,
        active: frame.contentDocument.activeElement?.tagName || null,
        frameFocused: frame.contentDocument.hasFocus(),
        focusPending: !!ctl?.readerInput?.focusPending,
      };
    });
    assert(focusProbe.parentActive === 'IFRAME' && focusProbe.active === 'BODY' && focusProbe.frameFocused,
      `product did not hand shelf focus to reader frame ${JSON.stringify(focusProbe)}`, 'W88X_READER_FOCUS');
    await win.keyboard.press('PageDown');
    try {
      await win.waitForFunction(previous => {
        const ctl = window.__activeLibraryCtl;
        return Number(ctl?.chapterIdx) === Number(previous.chapter) + 1;
      }, before, { timeout: 30000 });
    } catch (error) {
      const diagnostic = await win.evaluate(() => {
        const ctl = window.__activeLibraryCtl;
        const frame = ctl?.root?.querySelector('iframe.lib-book-frame');
        const inputProbe = frame?.contentWindow?.__w88ReaderInputProbe || null;
        const listener = frame?.contentWindow?.__w88ReaderInputProbeListener;
        if (listener) frame.contentDocument.removeEventListener('keydown', listener, true);
        return {
          chapter: ctl?.chapterIdx,
          flowOffset: ctl?._flowOffset || 0,
          flowReady: typeof ctl?._flowNav === 'function',
          attachedInputTargets: ctl?.readerInput?.attachedCount,
          frameFocused: frame?.contentDocument?.hasFocus?.() || false,
          activeElement: frame?.contentDocument?.activeElement?.tagName || null,
          inputProbe,
        };
      });
      observations.input = { before, diagnostic, command: 'PageDown', timedOut: true };
      throw Object.assign(new Error(`PageDown navigation timeout ${JSON.stringify(observations.input)}`), {
        code: 'W88X_READER_INPUT_TIMEOUT',
        cause: error,
      });
    }
    const after = await win.evaluate(() => ({
      chapter: window.__activeLibraryCtl?.chapterIdx,
      flowOffset: window.__activeLibraryCtl?._flowOffset || 0,
      attachedInputTargets: window.__activeLibraryCtl?.readerInput?.attachedCount,
      marker: window.__activeLibraryCtl?.root?.querySelector('iframe.lib-book-frame')?.contentDocument?.body?.textContent?.includes('W88_EXPERIENCE_TARGET_MARKER') || false,
      inputProbe: (() => {
        const frame = window.__activeLibraryCtl?.root?.querySelector('iframe.lib-book-frame');
        const probe = frame?.contentWindow?.__w88ReaderInputProbe || null;
        const listener = frame?.contentWindow?.__w88ReaderInputProbeListener;
        if (listener) frame.contentDocument.removeEventListener('keydown', listener, true);
        return probe;
      })(),
    }));
    assert(before.chapter === 1 && after.chapter === 2 && after.marker,
      `PageDown did not navigate current book ${JSON.stringify({ before, after })}`, 'W88X_READER_INPUT');
    assert(after.attachedInputTargets >= 2,
      `host+iframe input targets not attached ${after.attachedInputTargets}`, 'W88X_READER_INPUT_BINDING');
    assert(after.inputProbe?.key === 'PageDown' && after.inputProbe?.count === 1,
      `iframe did not receive exactly one PageDown ${JSON.stringify(after.inputProbe)}`, 'W88X_READER_INPUT_DELIVERY');
    const tocButton = win.locator('.lib-reader:visible [data-a="toc"]');
    await tocButton.focus();
    await win.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await win.waitForTimeout(360);
    const toolbarFocus = await win.evaluate(() => ({
      activeAction: document.activeElement?.dataset?.a || null,
      activeTag: document.activeElement?.tagName || null,
      frameFocused: window.__activeLibraryCtl?.root?.querySelector('iframe.lib-book-frame')?.contentDocument?.hasFocus?.() || false,
      focusPending: !!window.__activeLibraryCtl?.readerInput?.focusPending,
    }));
    assert(toolbarFocus.activeAction === 'toc' && toolbarFocus.activeTag === 'BUTTON'
      && !toolbarFocus.frameFocused && !toolbarFocus.focusPending,
    `reader focus retry stole toolbar focus ${JSON.stringify(toolbarFocus)}`, 'W88X_READER_FOCUS_OWNERSHIP');
    observations.input = { before, after, toolbarFocus, command: 'PageDown' };
    return observations.input;
  });

  await gate('连续阅读章内 locator 经模式切换与返回重开保持稳定', async () => {
    await setReaderSelect('.lib-mode', 'scroll', 'mode', 'scroll');
    await win.waitForFunction(() => !!window.__activeLibraryCtl?.book?._textViewport, null, { timeout: 30000 });
    const seeded = await win.evaluate(async () => {
      const ctl = window.__activeLibraryCtl;
      const viewport = ctl?.book?._textViewport;
      await viewport?.ready;
      await viewport?.restoreLocator?.({ section: 2, sectionId: 'chapter-03', ratio: 0.45 }, { notify: false });
      return viewport?.captureLocator?.() || null;
    });
    assert(seeded?.sectionId === 'chapter-03' && Math.abs(Number(seeded.ratio) - 0.45) <= 0.03,
      `failed to seed continuous locator ${JSON.stringify(seeded)}`, 'W88X_SCROLL_LOCATOR_SEED');

    await setReaderSelect('.lib-mode', 'single', 'mode', 'single');
    await win.waitForFunction(() => !window.__activeLibraryCtl?.book?._textViewport
      && typeof window.__activeLibraryCtl?._flowNav === 'function', null, { timeout: 30000 });
    await setReaderSelect('.lib-mode', 'scroll', 'mode', 'scroll');
    await win.waitForFunction(() => !!window.__activeLibraryCtl?.book?._textViewport, null, { timeout: 30000 });
    const modeRoundTrip = await win.evaluate(async () => {
      const viewport = window.__activeLibraryCtl?.book?._textViewport;
      await viewport?.ready;
      return viewport?.captureLocator?.() || null;
    });
    assert(modeRoundTrip?.sectionId === seeded.sectionId
      && Math.abs(Number(modeRoundTrip.ratio) - Number(seeded.ratio)) <= 0.03,
    `mode roundtrip drifted ${JSON.stringify({ seeded, modeRoundTrip })}`, 'W88X_SCROLL_LOCATOR_MODE');

    await win.waitForTimeout(250);
    await backToShelf();
    await openTargetFromKeyboard();
    await win.waitForFunction(() => !!window.__activeLibraryCtl?.book?._textViewport, null, { timeout: 30000 });
    const reopened = await win.evaluate(async () => {
      const viewport = window.__activeLibraryCtl?.book?._textViewport;
      await viewport?.ready;
      return viewport?.captureLocator?.() || null;
    });
    assert(reopened?.sectionId === seeded.sectionId
      && Math.abs(Number(reopened.ratio) - Number(seeded.ratio)) <= 0.03,
    `reopen drifted ${JSON.stringify({ seeded, reopened })}`, 'W88X_SCROLL_LOCATOR_REOPEN');
    observations.locator = { seeded, modeRoundTrip, reopened, tolerance: 0.03 };
    return observations.locator;
  });

  await gate('阅读主题/方向/字号/页宽/模式返回书架后重开仍持久', async () => {
    const before = await win.evaluate(() => ({
      fontSize: window.__activeLibraryCtl?.fontSize,
      direction: window.__activeLibraryCtl?.direction,
      theme: window.__activeLibraryCtl?.readTheme,
      mode: window.__activeLibraryCtl?.mode,
      pageWidth: window.__activeLibraryCtl?.pageWidth,
    }));
    await setReaderSelect('.lib-read-theme', 'night', 'readTheme', 'night');
    await setReaderSelect('.lib-pagew', '0.8', 'pageWidth', 0.8);
    await setReaderSelect('.lib-mode', 'double', 'mode', 'double');
    await win.locator('.lib-reader:visible [data-a="direction"]').click();
    await win.waitForFunction(() => window.__activeLibraryCtl?.direction === 'rtl');
    await win.locator('.lib-reader:visible [data-a="font-plus"]').click();
    await win.locator('.lib-reader:visible [data-a="font-plus"]').click();
    await win.waitForFunction(expected => window.__activeLibraryCtl?.fontSize === expected, before.fontSize + 2);
    await win.waitForTimeout(250);

    const changed = await win.evaluate(() => ({
      fontSize: window.__activeLibraryCtl?.fontSize,
      direction: window.__activeLibraryCtl?.direction,
      theme: window.__activeLibraryCtl?.readTheme,
      mode: window.__activeLibraryCtl?.mode,
      pageWidth: window.__activeLibraryCtl?.pageWidth,
    }));
    await backToShelf();
    await openTargetFromKeyboard();
    const restored = await win.evaluate(async () => {
      const ctl = window.__activeLibraryCtl;
      const keys = ctl?.book?._prefs?.keys || null;
      const stored = keys?.book ? await window.mazz.invoke('settings:get', { key: keys.book }).catch(() => null) : null;
      return {
        fontSize: ctl?.fontSize,
        direction: ctl?.direction,
        theme: ctl?.readTheme,
        mode: ctl?.mode,
        pageWidth: ctl?.pageWidth,
        keys,
        stored,
      };
    });
    assert(restored.fontSize === before.fontSize + 2, `fontSize ${restored.fontSize}`, 'W88X_PREFS_PERSIST');
    assert(restored.direction === 'rtl' && restored.theme === 'night' && restored.mode === 'double',
      `reader preferences ${JSON.stringify(restored)}`, 'W88X_PREFS_PERSIST');
    assert(Math.abs(Number(restored.pageWidth) - 0.8) < 1e-9, `pageWidth ${restored.pageWidth}`, 'W88X_PREFS_PERSIST');
    assert(restored.keys?.book && restored.stored?.appearance,
      `durable preference envelope missing ${JSON.stringify(restored)}`, 'W88X_PREFS_STORAGE');
    assert(restored.stored.appearance.theme === 'night' && restored.stored.appearance.direction === 'rtl',
      `durable appearance mismatch ${JSON.stringify(restored.stored)}`, 'W88X_PREFS_STORAGE');
    assert(!Object.prototype.hasOwnProperty.call(restored.stored.appearance, 'chapter')
      && !Object.prototype.hasOwnProperty.call(restored.stored.appearance, 'ratio'),
    `locator leaked into appearance ${JSON.stringify(restored.stored.appearance)}`, 'W88X_PREFS_LOCATOR_LEAK');
    observations.preferences = { before, changed, restored };
    return observations.preferences;
  });

  await gate('返回书架后阅读 owner 退役且 W88X 全程零运行时异常', async () => {
    await backToShelf();
    await win.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await win.waitForTimeout(180);
    const focusRestore = await win.evaluate(() => ({
      activeBookCard: document.activeElement?.classList?.contains('lib-card')
        ? document.activeElement?.dataset?.id || null
        : null,
      focusPending: !!window.__activeLibraryCtl?.readerInput?.focusPending,
    }));
    assert(focusRestore.activeBookCard === target.id && !focusRestore.focusPending,
      `shelf focus was not stably restored ${JSON.stringify(focusRestore)}`, 'W88X_SHELF_FOCUS_RESTORE');
    const cleanup = await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      return {
        activeBook: ctl?.book?.meta?.id || null,
        readerVisible: ctl?.root?.querySelector('.lib-reader')?.getBoundingClientRect().width > 0,
        shelfVisible: ctl?.root?.querySelector('.lib-shelf-view')?.getBoundingClientRect().width > 0,
        frameCount: ctl?.root?.querySelectorAll('iframe.lib-book-frame').length ?? -1,
        inputTargets: ctl?.readerInput?.attachedCount ?? -1,
      };
    });
    assert(cleanup.activeBook === null && !cleanup.readerVisible && cleanup.shelfVisible,
      `reader owner remains ${JSON.stringify(cleanup)}`, 'W88X_READER_CLEANUP');
    assert(cleanup.frameCount === 0 && cleanup.inputTargets === 1,
      `reader frame/input binding remains ${JSON.stringify(cleanup)}`, 'W88X_READER_CLEANUP');
    assert(runtimeErrors.length === 0, runtimeErrors.slice(0, 8).join('\n'), 'W88X_RUNTIME_ERROR');
    await resetShelfFilters();
    observations.cleanup = { ...cleanup, focusRestore };
    return { ...cleanup, focusRestore, runtimeErrors: [] };
  });

  if (results.every(result => result.verdict === 'PASS')) {
    const screenshot = path.join(EVIDENCE_DIR, `W88_LIBRARY_EXPERIENCE_${MODE === 'packaged' ? 'PACKAGED' : 'SOURCE'}.png`);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await win.screenshot({ path: screenshot, fullPage: false });
    observations.screenshot = path.relative(ROOT, screenshot).replace(/\\/g, '/');
  }
} catch (error) {
  results.push({ name: 'runner bootstrap', verdict: 'FAIL', code: error.code || 'W88X_BOOTSTRAP', error: error.message });
  console.error(`[W88X] bootstrap failure: ${error.stack || error.message}`);
} finally {
  try { await app?.close(); } catch {}
  if (!KEEP_TMP) {
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
    try { fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  }
}

const failed = results.filter(result => result.verdict !== 'PASS');
const report = {
  protocol: 'mazz.w88-library-experience/v1',
  createdAt: new Date().toISOString(),
  mode: MODE,
  git: gitCoordinate(),
  runtime: runtimeArtifact(),
  verdict: failed.length ? 'FAIL' : 'PASS',
  bounds: { shelfRecords: SHELF_COUNT, renderedCardsMax: DOM_CARD_MAX },
  fixtures: { targetBook: target, expected },
  results,
  runtimeErrors,
  observations,
  temp: KEEP_TMP ? { userData, workspace } : null,
};
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const evidenceFile = path.join(EVIDENCE_DIR, `W88_LIBRARY_EXPERIENCE_${MODE === 'packaged' ? 'PACKAGED' : 'SOURCE'}.json`);
fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2) + '\n');
console.log(`W88X_RESULT=${JSON.stringify(report)}`);
process.exit(failed.length ? 1 : 0);
