// W89b independent real-Electron reader stability gate.
//
// Run after the product line converges:
//   node tests/e2e/w89b-reader-stability.mjs
//   MAZZ_W89B_EXECUTABLE=<installed exe> node tests/e2e/w89b-reader-stability.mjs
//
// This file is deliberately not wired into a broad runner while the RED gates
// are being fixed.  It owns only temporary EPUB/CBZ fixtures and evidence JSON.
import { _electron as electron } from 'playwright';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

const ROOT = path.resolve('.');
const EXECUTABLE = String(process.env.MAZZ_W89B_EXECUTABLE || '');
const MODE = EXECUTABLE ? 'packaged' : 'source';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w89b-reader-${MODE}-user-`));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w89b-reader-${MODE}-ws-`));
const booksDir = path.join(workspace, '书库');
const evidenceDir = path.resolve(process.env.MAZZ_W89B_EVIDENCE_DIR
  || path.join(ROOT, 'docs', 'engineering', 'evidence'));
const reportPath = path.join(evidenceDir, `W89B_READER_STABILITY_${MODE.toUpperCase()}.json`);
fs.mkdirSync(booksDir, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

const epubPath = path.join(booksDir, 'W89b-reader-grid.epub');
const cbzPath = path.join(booksDir, 'W89b-comic-grid.cbz');
const gates = [];
const runtimeErrors = [];
let app;
let win;

const assert = (condition, message, code = 'W89B_ASSERT') => {
  if (!condition) throw Object.assign(new Error(`${code}: ${message}`), { code });
};
const near = (actual, expected, tolerance = 2) => Math.abs(Number(actual) - Number(expected)) <= tolerance;
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function gate(name, operation) {
  const startedAt = Date.now();
  try {
    const detail = await operation();
    gates.push({ name, verdict: 'PASS', durationMs: Date.now() - startedAt, detail });
    console.log(`[W89b] PASS ${name}`);
    return detail;
  } catch (error) {
    gates.push({
      name,
      verdict: 'FAIL',
      durationMs: Date.now() - startedAt,
      code: error.code || 'W89B_GATE',
      error: error.message,
    });
    console.error(`[W89b] FAIL ${name}: ${error.stack || error.message}`);
    return null;
  }
}

async function writeFixtures() {
  const epub = new JSZip();
  epub.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  epub.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
  epub.file('OPS/book.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>W89b 阅读稳定性</dc:title><dc:creator>门禁</dc:creator></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
  for (let chapter = 1; chapter <= 2; chapter++) {
    const paragraphs = Array.from({ length: 130 }, (_, index) => {
      const marker = `W89B-C${chapter}-P${String(index + 1).padStart(3, '0')}`;
      return `<p>${marker}。视口高度改变时，这个逻辑位置必须留下；双页每次只推进一个物理页，不能把章节号当页码。${'稳定排版需要可靠锚点。'.repeat(5)}</p>`;
    }).join('');
    epub.file(`OPS/c${chapter}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${chapter}章</title></head><body><h1>第 ${chapter} 章</h1>${paragraphs}</body></html>`);
  }
  fs.writeFileSync(epubPath, await epub.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

  const comic = new JSZip();
  // Valid 8x16 portrait PNG. The deliberately tall aspect catches the old
  // width-only CSS where max-height won and 50/70/100% rendered identical
  // visible pixels in paged single/double modes.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAQCAYAAAArij59AAAAFUlEQVR4nGO4Iyf3Hx9mGFUwkhQAANPtC5BfFK/KAAAAAElFTkSuQmCC', 'base64');
  for (let page = 1; page <= 18; page++) {
    comic.file(`pages/page-${String(page).padStart(3, '0')}.png`, png, { binary: true });
  }
  fs.writeFileSync(cbzPath, await comic.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
}

async function mainWindowSize(width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const main = BrowserWindow.getAllWindows().find(candidate => !candidate.__panelKind && !candidate.getParentWindow());
    if (!main) throw new Error('main BrowserWindow missing');
    main.setSize(size.width, size.height);
    main.show();
    main.focus();
  }, { width, height });
  await win.waitForTimeout(280);
}

async function openBook(id) {
  const card = win.locator(`.lib-shelf-view:visible .lib-card[data-id="${id}"]`);
  await card.waitFor({ state: 'visible', timeout: 30000 });
  await card.click();
  await win.waitForFunction(bookId => window.__activeLibraryCtl?.book?.meta?.id === bookId, id, { timeout: 60000 });
}

async function backToShelf() {
  await win.locator('.lib-reader:visible [data-a="back"]').click();
  await win.waitForFunction(() => !window.__activeLibraryCtl?.book
    && getComputedStyle(window.__activeLibraryCtl?.root?.querySelector('.lib-shelf-view')).display !== 'none', null, { timeout: 30000 });
}

async function setReaderSelect(selector, value, field) {
  await win.evaluate(({ selector: query, value: next }) => {
    const select = window.__activeLibraryCtl?.root?.querySelector(query);
    if (!select) throw new Error(`missing select ${query}`);
    select.value = String(next);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, value });
  await win.waitForFunction(({ field: key, value: expected }) => (
    String(window.__activeLibraryCtl?.[key]) === String(expected)
  ), { field, value });
  await win.waitForTimeout(420);
}

async function waitPaged(mode) {
  await win.waitForFunction(expected => {
    const ctl = window.__activeLibraryCtl;
    return ctl?.mode === expected && typeof ctl?._flowNav === 'function'
      && ctl?._flowWrap?.isConnected && Number(ctl?._pageGeometry?.pagePitch) > 0;
  }, mode, { timeout: 60000 });
  await win.waitForTimeout(360);
}

async function pagedProbe() {
  return win.evaluate(() => {
    const ctl = window.__activeLibraryCtl;
    const frame = ctl?.root?.querySelector('iframe.lib-book-frame');
    const doc = frame?.contentDocument;
    const wrap = ctl?._flowWrap;
    const flow = doc?.querySelector('.lib-flow');
    if (!ctl || !frame || !doc || !wrap || !flow) return null;
    const paper = wrap.getBoundingClientRect();
    const pitch = Number(ctl._pageGeometry?.pagePitch) || 1;
    const offset = Number(ctl._flowOffset) || 0;
    const max = Math.max(0, flow.scrollWidth - wrap.clientWidth);
    const stableAnchor = ctl._captureStableAnchor?.() || null;
    let stableCharOffset = null;
    let stableRect = null;
    let stableVisible = false;
    if (stableAnchor?.tp && Number.isFinite(Number(stableAnchor.o))) {
      let target = flow;
      for (const index of String(stableAnchor.tp).split('/').map(Number)) {
        target = target?.childNodes?.[index] || null;
        if (!target) break;
      }
      if (target) {
        const prefix = doc.createRange();
        prefix.selectNodeContents(flow);
        try {
          prefix.setEnd(target, Math.max(0, Math.min(String(target.textContent || '').length, Number(stableAnchor.o) || 0)));
          stableCharOffset = prefix.toString().length;
          const point = doc.createRange();
          const length = String(target.textContent || '').length;
          const start = Math.max(0, Math.min(length, Number(stableAnchor.o) || 0));
          point.setStart(target, start);
          point.setEnd(target, Math.min(length, start + 1));
          const rect = point.getClientRects?.()[0] || point.getBoundingClientRect?.();
          if (rect) {
            stableRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
            stableVisible = rect.right >= paper.left - 2 && rect.left <= paper.right + 2
              && rect.bottom >= paper.top - 2 && rect.top <= paper.bottom + 2;
          }
        } catch { /* diagnostic stays null */ }
      }
    }

    let charOffset = null;
    const caretAt = doc.caretRangeFromPoint?.bind(doc);
    if (caretAt) {
      const xs = ctl.mode === 'vertical'
        ? [paper.right - 36, paper.right - 70, paper.left + paper.width * 0.7]
        : [paper.left + 42, paper.left + Math.min(paper.width * 0.25, 180)];
      outer: for (const x of xs) {
        for (let y = paper.top + 38; y < paper.bottom - 24; y += 22) {
          const caret = caretAt(x, y);
          if (!caret?.startContainer || !flow.contains(caret.startContainer)) continue;
          const prefix = doc.createRange();
          prefix.selectNodeContents(flow);
          try {
            prefix.setEnd(caret.startContainer, caret.startOffset);
            charOffset = prefix.toString().length;
            break outer;
          } catch { /* keep scanning */ }
        }
      }
    }
    const residual = Math.min(
      Math.abs(offset - Math.round(offset / pitch) * pitch),
      Math.abs(offset - max),
    );
    return {
      mode: ctl.mode,
      chapter: ctl.chapterIdx,
      offset,
      pitch,
      physicalPage: Math.round(offset / pitch),
      max,
      residual,
      charOffset,
      stableCharOffset,
      stableRect,
      stableVisible,
      stableAnchor: stableAnchor ? {
        kind: stableAnchor.kind,
        edge: stableAnchor.edge,
        m: stableAnchor.m,
        p: stableAnchor.p,
        tp: stableAnchor.tp,
        o: stableAnchor.o,
        q: stableAnchor.q,
      } : null,
      frameHeight: frame.getBoundingClientRect().height,
      viewportHeight: doc.documentElement.clientHeight,
      paper: { width: paper.width, height: paper.height },
      progressCollapsed: ctl.root.querySelector('.lib-progress')?.classList.contains('collapsed') || false,
      transform: getComputedStyle(flow).transform,
      effectiveMode: ctl._pageGeometry?.effectiveMode,
      mountedChapters: [...flow.querySelectorAll('.lib-chap-mark')].map(mark => Number(mark.dataset.i)),
    };
  });
}

async function revealProgress() {
  await win.evaluate(() => {
    const root = window.__activeLibraryCtl?.root;
    const peek = root?.querySelector('.lib-progress-peek');
    if (peek && getComputedStyle(peek).display !== 'none') peek.click();
    else root?.querySelector('.lib-content')?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
  });
  await win.waitForFunction(() => !window.__activeLibraryCtl?.root?.querySelector('.lib-progress')?.classList.contains('collapsed'));
  await win.waitForTimeout(360);
}

async function collapseProgress({ manual = true } = {}) {
  if (manual) {
    await win.evaluate(() => window.__activeLibraryCtl?.root?.querySelector('[data-a="prog-fold"]')?.click());
  } else {
    await win.waitForFunction(() => window.__activeLibraryCtl?.root?.querySelector('.lib-progress')?.classList.contains('collapsed'), null, { timeout: 5000 });
  }
  await win.waitForFunction(() => window.__activeLibraryCtl?.root?.querySelector('.lib-progress')?.classList.contains('collapsed'));
  await win.waitForTimeout(360);
}

async function imageProbe() {
  return win.evaluate(() => {
    const ctl = window.__activeLibraryCtl;
    const host = ctl?.root?.querySelector('.lib-content');
    const viewport = ctl?.book?._comicViewport;
    const page = viewport?.activePage;
    const slot = ctl?.root?.querySelector(`.lib-comic-slot[data-i="${page}"]`);
    const image = slot?.querySelector('.lib-manga-page');
    const hostRect = host?.getBoundingClientRect();
    const slotRect = slot?.getBoundingClientRect();
    const imageRect = image?.getBoundingClientRect();
    return {
      activePage: page,
      scrollTop: host?.scrollTop,
      hostHeight: hostRect?.height,
      hostWidth: hostRect?.width,
      slotTop: slotRect && hostRect ? slotRect.top - hostRect.top : null,
      slotHeight: slotRect?.height,
      imageWidth: imageRect?.width,
      pageWidth: ctl?.pageWidth,
    };
  });
}

async function pagedImageProbe() {
  return win.evaluate(() => {
    const ctl = window.__activeLibraryCtl;
    const image = ctl?.root?.querySelector('.lib-page.lib-manga-mode .lib-manga-page');
    const host = ctl?.root?.querySelector('.lib-content');
    const box = image?.getBoundingClientRect();
    const hostBox = host?.getBoundingClientRect();
    const naturalWidth = Number(image?.naturalWidth) || 1;
    const naturalHeight = Number(image?.naturalHeight) || 1;
    const containScale = Math.min((box?.width || 0) / naturalWidth, (box?.height || 0) / naturalHeight);
    return {
      mode: ctl?.mode,
      pageWidth: ctl?.pageWidth,
      boxWidth: box?.width,
      boxHeight: box?.height,
      hostWidth: hostBox?.width,
      hostHeight: hostBox?.height,
      visibleWidth: naturalWidth * containScale,
      visibleHeight: naturalHeight * containScale,
      naturalWidth,
      naturalHeight,
    };
  });
}

async function scrollTextProbe() {
  return win.evaluate(() => {
    const ctl = window.__activeLibraryCtl;
    const doc = ctl?._frame?.contentDocument;
    const viewport = ctl?.book?._textViewport;
    const active = viewport?.activeSection;
    const slot = doc?.querySelector(`.lib-text-slot.is-loaded[data-i="${active}"]`)
      || doc?.querySelector('.lib-text-slot.is-loaded');
    const content = slot?.querySelector('.lib-text-section-content') || slot?.firstElementChild;
    const slotRect = slot?.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    return {
      width: contentRect?.width,
      contentHeight: contentRect?.height,
      slotHeight: slotRect?.height,
      inlineMinHeight: Number.parseFloat(slot?.style?.minHeight || '') || 0,
      viewport: doc?.documentElement?.clientWidth,
      locator: viewport?.captureLocator?.(),
    };
  });
}

try {
  await writeFixtures();
  const records = [
    {
      id: 'w89b-text', title: 'W89b 阅读稳定性', author: '门禁', cover: '', path: epubPath,
      sourcePath: epubPath, format: 'epub', category: '未分类', addedAt: Date.now(),
    },
    {
      id: 'w89b-comic', title: 'W89b 漫画稳定性', author: '门禁', cover: '', path: cbzPath,
      sourcePath: cbzPath, format: 'cbz', category: '未分类', addedAt: Date.now() - 1,
    },
  ];
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
  if (EXECUTABLE) launch.executablePath = path.resolve(EXECUTABLE);
  app = await electron.launch(launch);
  win = await app.firstWindow({ timeout: 120000 });
  win.setDefaultTimeout(60000);
  win.on('pageerror', error => runtimeErrors.push(`[pageerror] ${error.message}`));
  win.on('console', message => {
    if (message.type() === 'error' && !/Autofill|SharedArrayBuffer|deprecat|ERR_FILE_NOT_FOUND/i.test(message.text())) {
      runtimeErrors.push(`[console.error] ${message.text()}`);
    }
  });
  await win.waitForFunction(() => !!window.MazzCommands && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async seeded => {
    await Promise.all([
      window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
      window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
      window.mazz.invoke('settings:set', { key: 'library.books', value: seeded }),
      window.mazz.invoke('settings:set', { key: 'library.categories', value: ['未分类'] }),
      window.mazz.invoke('settings:set', { key: 'library.progress', value: {} }),
    ]);
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
    await window.MazzCommands.execute('file.newLibrary');
  }, records);
  await mainWindowSize(1440, 900);
  await win.waitForFunction(() => window.__activeLibraryCtl?.shelf?.records?.length === 2, null, { timeout: 30000 });

  await gate('progress collapsed/expanded reserves one invariant reader viewport, including first open', async () => {
    // Force the exact delayed-shelf ordering that made first open random in the
    // old implementation: the 3 s timer could collapse this hidden control.
    await win.evaluate(() => window.__activeLibraryCtl?.root?.querySelector('[data-a="prog-fold"]')?.click());
    await openBook('w89b-text');
    await waitPaged('single');
    const hiddenFirstOpen = await pagedProbe();
    assert(hiddenFirstOpen?.progressCollapsed, JSON.stringify(hiddenFirstOpen), 'W89B_PROGRESS_PRECONDITION');

    await revealProgress();
    const expanded = await pagedProbe();
    assert(near(expanded.frameHeight, hiddenFirstOpen.frameHeight, 1)
      && near(expanded.viewportHeight, hiddenFirstOpen.viewportHeight, 1),
    `progress reveal changed pagination height: ${JSON.stringify({ hiddenFirstOpen, expanded })}`, 'W89B_PROGRESS_HEIGHT');
    assert(expanded.physicalPage === hiddenFirstOpen.physicalPage
      && expanded.chapter === hiddenFirstOpen.chapter
      && expanded.charOffset === hiddenFirstOpen.charOffset,
    `progress reveal changed reading point: ${JSON.stringify({ hiddenFirstOpen, expanded })}`, 'W89B_PROGRESS_LOCATOR');

    await collapseProgress({ manual: false });
    const autoHidden = await pagedProbe();
    assert(near(autoHidden.frameHeight, expanded.frameHeight, 1)
      && near(autoHidden.viewportHeight, expanded.viewportHeight, 1),
    `auto-hide changed pagination height: ${JSON.stringify({ expanded, autoHidden })}`, 'W89B_PROGRESS_AUTO_HIDE');
    assert(autoHidden.physicalPage === expanded.physicalPage && autoHidden.charOffset === expanded.charOffset,
      `auto-hide moved page grid: ${JSON.stringify({ expanded, autoHidden })}`, 'W89B_PROGRESS_GRID');
    return { hiddenFirstOpen, expanded, autoHidden };
  });

  await gate('double mode advances one physical page per action (overlapping spread)', async () => {
    await revealProgress();
    await setReaderSelect('.lib-mode', 'double', 'mode');
    await waitPaged('double');
    await win.evaluate(() => window.__activeLibraryCtl?._applyOffset?.(0));
    const before = await pagedProbe();
    assert(before.effectiveMode === 'double', JSON.stringify(before), 'W89B_DOUBLE_PRECONDITION');
    await win.locator('.lib-reader:visible [data-a="next"]').click();
    await win.waitForFunction(offset => (window.__activeLibraryCtl?._flowOffset || 0) > offset + 1, before.offset);
    const afterOne = await pagedProbe();
    await win.locator('.lib-reader:visible [data-a="next"]').click();
    await win.waitForFunction(offset => (window.__activeLibraryCtl?._flowOffset || 0) > offset + 1, afterOne.offset);
    const afterTwo = await pagedProbe();
    assert(near(afterOne.offset - before.offset, before.pitch, 2),
      `N/N+1 did not advance to N+1/N+2: ${JSON.stringify({ before, afterOne })}`, 'W89B_DOUBLE_ONE_PAGE');
    assert(near(afterTwo.offset - afterOne.offset, afterOne.pitch, 2),
      `second spread accumulated a non-page stride: ${JSON.stringify({ afterOne, afterTwo })}`, 'W89B_DOUBLE_DRIFT');
    assert(afterOne.residual <= 2 && afterTwo.residual <= 2,
      `spread is off the physical page grid: ${JSON.stringify({ afterOne, afterTwo })}`, 'W89B_DOUBLE_GRID');

    // Force the final physical page of chapter 0, then cross the chapter edge.
    // The bridge must show [chapter0:last, chapter1:first]; the next/previous
    // commands move exactly one pitch over that same two-chapter rail.
    await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      const flow = ctl?._flowWrap?.querySelector('.lib-flow');
      ctl?._applyOffset?.(Math.max(0, (flow?.scrollWidth || 0) - (ctl?._flowWrap?.clientWidth || 0)));
    });
    const chapterEnd = await pagedProbe();
    await win.locator('.lib-reader:visible [data-a="next"]').click();
    await win.waitForFunction(() => {
      const ctl = window.__activeLibraryCtl;
      return ctl?._flowWrap?.querySelectorAll('.lib-chap-mark')?.length === 2;
    });
    await win.waitForTimeout(420);
    const bridge = await pagedProbe();
    assert(JSON.stringify(bridge.mountedChapters) === JSON.stringify([0, 1]),
      `chapter bridge did not own exactly two adjacent chapters: ${JSON.stringify({ chapterEnd, bridge })}`,
      'W89B_DOUBLE_CHAPTER_BRIDGE');
    await win.locator('.lib-reader:visible [data-a="next"]').click();
    await win.waitForFunction(offset => (window.__activeLibraryCtl?._flowOffset || 0) > offset + 1, bridge.offset);
    const bridgeForward = await pagedProbe();
    assert(near(bridgeForward.offset - bridge.offset, bridge.pitch, 2),
      `forward chapter overlap skipped a physical page: ${JSON.stringify({ bridge, bridgeForward })}`,
      'W89B_DOUBLE_CHAPTER_FORWARD');
    assert(bridgeForward.chapter === 1 && bridgeForward.stableAnchor?.m === 1
      && (bridgeForward.stableAnchor?.kind === 'chapter-edge' || bridgeForward.stableVisible),
      `bridge retained an off-screen low-chapter anchor: ${JSON.stringify({ bridge, bridgeForward })}`,
      'W89B_DOUBLE_CHAPTER_VISIBLE_ANCHOR');

    // The overlap is not complete until its high-chapter anchor survives a
    // real ResizeObserver burst. This used to jump all the way to book start.
    await mainWindowSize(1180, 700);
    await waitPaged('double');
    const bridgeCompact = await pagedProbe();
    await mainWindowSize(1500, 920);
    await waitPaged('double');
    const bridgeRestored = await pagedProbe();
    assert(bridgeCompact.chapter === 1 && bridgeRestored.chapter === 1
      && bridgeCompact.stableAnchor?.m === 1 && bridgeRestored.stableAnchor?.m === 1
      && (bridgeCompact.stableAnchor?.kind === 'chapter-edge' || bridgeCompact.stableVisible)
      && (bridgeRestored.stableAnchor?.kind === 'chapter-edge' || bridgeRestored.stableVisible),
    `bridge resize jumped to the low chapter: ${JSON.stringify({ bridgeForward, bridgeCompact, bridgeRestored })}`,
    'W89B_DOUBLE_CHAPTER_RESIZE');
    await win.locator('.lib-reader:visible [data-a="prev"]').click();
    await win.waitForFunction(offset => (window.__activeLibraryCtl?._flowOffset || 0) < offset - 1, bridgeRestored.offset);
    const bridgeBackward = await pagedProbe();
    // The window round-trip changed page pitch, so the old pre-resize pixel
    // offset is not comparable. The invariant is one current-geometry pitch
    // back onto the low chapter, with a live low-chapter semantic anchor.
    assert(near(bridgeRestored.offset - bridgeBackward.offset, bridgeRestored.pitch, 2)
      && bridgeBackward.chapter === 0
      && bridgeBackward.stableAnchor?.m === 0
      && (bridgeBackward.stableAnchor?.kind === 'chapter-edge' || bridgeBackward.stableVisible),
    `backward chapter overlap skipped a physical page: ${JSON.stringify({ bridge, bridgeForward, bridgeRestored, bridgeBackward })}`,
    'W89B_DOUBLE_CHAPTER_BACKWARD');
    return { before, afterOne, afterTwo, chapterEnd, bridge, bridgeForward, bridgeCompact, bridgeRestored, bridgeBackward };
  });

  await gate('single mode crosses chapter edges in one command without a bridge repeat', async () => {
    await setReaderSelect('.lib-mode', 'single', 'mode');
    await waitPaged('single');
    await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      const flow = ctl?._flowWrap?.querySelector('.lib-flow');
      ctl?._applyOffset?.(Math.max(0, (flow?.scrollWidth || 0) - (ctl?._flowWrap?.clientWidth || 0)));
    });
    await win.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const lowEnd = await pagedProbe();
    assert(JSON.stringify(lowEnd.mountedChapters) === JSON.stringify([0]), JSON.stringify(lowEnd),
      'W89B_SINGLE_LOW_PRECONDITION');
    await win.locator('.lib-reader:visible [data-a="next"]').click();
    await win.waitForFunction(() => {
      const ctl = window.__activeLibraryCtl;
      const marks = [...(ctl?._flowWrap?.querySelectorAll('.lib-chap-mark') || [])].map(mark => Number(mark.dataset.i));
      return marks.length === 1 && marks[0] === 1;
    });
    await win.waitForTimeout(420);
    const highStart = await pagedProbe();
    assert(highStart.physicalPage === 0 && highStart.chapter === 1,
      `single next repeated the previous chapter tail: ${JSON.stringify({ lowEnd, highStart })}`,
      'W89B_SINGLE_FORWARD_EDGE');

    await win.locator('.lib-reader:visible [data-a="prev"]').click();
    await win.waitForFunction(() => {
      const ctl = window.__activeLibraryCtl;
      const marks = [...(ctl?._flowWrap?.querySelectorAll('.lib-chap-mark') || [])].map(mark => Number(mark.dataset.i));
      return marks.length === 1 && marks[0] === 0;
    });
    await win.waitForTimeout(420);
    const lowRestored = await pagedProbe();
    assert(lowRestored.chapter === 0 && lowRestored.physicalPage > 0
      && near(lowRestored.offset, lowRestored.max, lowRestored.pitch + 2),
    `single previous did not reach the preceding chapter end: ${JSON.stringify({ highStart, lowRestored })}`,
    'W89B_SINGLE_BACKWARD_EDGE');
    return { lowEnd, highStart, lowRestored };
  });

  await gate('paged locator survives real viewport ResizeObserver height/width changes', async () => {
    await setReaderSelect('.lib-mode', 'single', 'mode');
    await waitPaged('single');
    await win.evaluate(() => window.__activeLibraryCtl?._applyOffset?.(
      Math.min(window.__activeLibraryCtl?._pageGeometry?.pagePitch * 4, window.__activeLibraryCtl?._flowWrap?.ownerDocument?.querySelector('.lib-flow')?.scrollWidth || 0),
    ));
    await win.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = await pagedProbe();
    await mainWindowSize(1120, 690);
    await waitPaged('single');
    const compact = await pagedProbe();
    await mainWindowSize(1500, 920);
    await waitPaged('single');
    const restored = await pagedProbe();
    assert(compact.chapter === before.chapter && restored.chapter === before.chapter,
      `resize crossed a chapter: ${JSON.stringify({ before, compact, restored })}`, 'W89B_RESIZE_CHAPTER');
    assert(compact.residual <= 2 && restored.residual <= 2,
      `resize left the transform off-grid: ${JSON.stringify({ compact, restored })}`, 'W89B_RESIZE_GRID');
    assert(before.stableCharOffset != null
      && compact.stableCharOffset === before.stableCharOffset
      && restored.stableCharOffset === before.stableCharOffset
      && before.stableVisible && compact.stableVisible && restored.stableVisible
      && compact.stableAnchor?.q === before.stableAnchor?.q
      && restored.stableAnchor?.q === before.stableAnchor?.q,
    `resize lost the visible semantic anchor: ${JSON.stringify({ before, compact, restored })}`,
    'W89B_RESIZE_LOCATOR');
    return { before, compact, restored, semanticAnchorExact: true };
  });

  await gate('unfinished vertical prototype is retired and legacy mode converges to single', async () => {
    const detail = await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      const select = ctl.root.querySelector('.lib-mode');
      const hasVerticalOption = [...select.options].some(option => option.value === 'vertical');
      select.value = 'vertical';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return { hasVerticalOption, selectedValue: select.value };
    });
    await win.waitForFunction(() => window.__activeLibraryCtl?.mode === 'single');
    await waitPaged('single');
    const probe = await pagedProbe();
    const frameState = await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      return {
        bodyClass: ctl._frame?.contentDocument?.body?.className || '',
        mode: ctl.mode,
      };
    });
    assert(!detail.hasVerticalOption && frameState.mode === 'single',
      `legacy vertical mode remained selectable: ${JSON.stringify({ detail, frameState })}`, 'W89B_VERTICAL_RETIRED');
    assert(!/lib-vertical/.test(frameState.bodyClass) && probe.residual <= 2,
      `legacy mode left vertical layout residue: ${JSON.stringify({ frameState, probe })}`, 'W89B_VERTICAL_RESIDUE');
    return { detail, frameState, probe };
  });

  await gate('scroll text pageWidth changes measure without drifting its locator', async () => {
    await setReaderSelect('.lib-mode', 'scroll', 'mode');
    await win.waitForFunction(() => !!window.__activeLibraryCtl?.book?._textViewport, null, { timeout: 60000 });
    await win.evaluate(async () => {
      await window.__activeLibraryCtl.book._textViewport.restoreLocator(
        { section: 1, sectionId: 'c2', ratio: 0.45 }, { notify: false },
      );
    });
    await setReaderSelect('.lib-pagew', '0.5', 'pageWidth');
    const narrow = await scrollTextProbe();
    await setReaderSelect('.lib-pagew', '1', 'pageWidth');
    const wide = await scrollTextProbe();
    assert(wide.width > narrow.width + Math.max(100, narrow.viewport * 0.15),
      `scroll text pageWidth is a no-op: ${JSON.stringify({ narrow, wide })}`, 'W89B_SCROLL_TEXT_WIDTH');
    assert(near(narrow.slotHeight, narrow.contentHeight, 3)
      && near(wide.slotHeight, wide.contentHeight, 3),
    `loaded slot did not converge to natural content height: ${JSON.stringify({ narrow, wide })}`,
    'W89B_SCROLL_TEXT_NATURAL_HEIGHT');
    assert(wide.slotHeight < narrow.slotHeight - Math.max(160, narrow.slotHeight * 0.08),
      `wide reflow could not shrink the old narrow minHeight: ${JSON.stringify({ narrow, wide })}`,
      'W89B_SCROLL_TEXT_SHRINK');
    assert(wide.locator.sectionId === narrow.locator.sectionId
      && Math.abs(wide.locator.ratio - narrow.locator.ratio) <= 0.02,
    `pageWidth reflow drifted scroll locator: ${JSON.stringify({ narrow, wide })}`, 'W89B_SCROLL_TEXT_LOCATOR');

    await setReaderSelect('.lib-pagew', '0.5', 'pageWidth');
    const narrowAgain = await scrollTextProbe();
    assert(near(narrowAgain.slotHeight, narrowAgain.contentHeight, 3)
      && narrowAgain.slotHeight > wide.slotHeight + Math.max(160, wide.slotHeight * 0.08),
    `narrow reflow did not grow back from the wide measurement: ${JSON.stringify({ wide, narrowAgain })}`,
    'W89B_SCROLL_TEXT_REGROW');
    assert(narrowAgain.locator.sectionId === narrow.locator.sectionId
      && Math.abs(narrowAgain.locator.ratio - narrow.locator.ratio) <= 0.02,
    `narrow-wide-narrow reflow drifted locator: ${JSON.stringify({ narrow, wide, narrowAgain })}`,
    'W89B_SCROLL_TEXT_ROUNDTRIP_LOCATOR');

    const beforeResize = narrowAgain;
    await mainWindowSize(1180, 700);
    await win.waitForTimeout(520);
    const compact = await win.evaluate(() => ({
      locator: window.__activeLibraryCtl?.book?._textViewport?.captureLocator?.(),
      viewport: window.__activeLibraryCtl?._frame?.contentDocument?.documentElement?.clientWidth,
    }));
    await mainWindowSize(1500, 920);
    await win.waitForTimeout(520);
    const restored = await win.evaluate(() => ({
      locator: window.__activeLibraryCtl?.book?._textViewport?.captureLocator?.(),
      viewport: window.__activeLibraryCtl?._frame?.contentDocument?.documentElement?.clientWidth,
    }));
    assert(compact.locator.sectionId === beforeResize.locator.sectionId
      && restored.locator.sectionId === beforeResize.locator.sectionId
      && Math.abs(compact.locator.ratio - beforeResize.locator.ratio) <= 0.02
      && Math.abs(restored.locator.ratio - beforeResize.locator.ratio) <= 0.02,
    `scroll text window resize drifted locator: ${JSON.stringify({ beforeResize, compact, restored })}`,
    'W89B_SCROLL_TEXT_RESIZE_LOCATOR');
    return { narrow, wide, narrowAgain, compact, restored };
  });

  await backToShelf();
  await gate('scroll comic pageWidth is effective and viewport resize pins the active page', async () => {
    await openBook('w89b-comic');

    await setReaderSelect('.lib-mode', 'single', 'mode');
    await win.waitForFunction(() => !!window.__activeLibraryCtl?.root
      ?.querySelector('.lib-page.lib-manga-mode > .lib-manga-page'));
    await setReaderSelect('.lib-pagew', '0.5', 'pageWidth');
    const singleNarrow = await pagedImageProbe();
    await setReaderSelect('.lib-pagew', '1', 'pageWidth');
    const singleWide = await pagedImageProbe();
    assert(singleWide.visibleHeight > singleNarrow.visibleHeight + singleWide.hostHeight * 0.2,
      `single portrait visible pixels ignored pageWidth: ${JSON.stringify({ singleNarrow, singleWide })}`,
      'W89B_COMIC_SINGLE_VISIBLE_SCALE');

    await setReaderSelect('.lib-mode', 'double', 'mode');
    await win.waitForFunction(() => !!window.__activeLibraryCtl?.root
      ?.querySelector('.lib-page.lib-manga-mode .lib-double .lib-manga-page'));
    await setReaderSelect('.lib-pagew', '0.5', 'pageWidth');
    const doubleNarrow = await pagedImageProbe();
    await setReaderSelect('.lib-pagew', '1', 'pageWidth');
    const doubleWide = await pagedImageProbe();
    assert(doubleWide.visibleHeight > doubleNarrow.visibleHeight + doubleWide.hostHeight * 0.15,
      `double portrait visible pixels ignored pageWidth: ${JSON.stringify({ doubleNarrow, doubleWide })}`,
      'W89B_COMIC_DOUBLE_VISIBLE_SCALE');

    await setReaderSelect('.lib-mode', 'scroll', 'mode');
    await win.waitForFunction(() => !!window.__activeLibraryCtl?.book?._comicViewport
      && !!window.__activeLibraryCtl?.root?.querySelector('.lib-comic-slot.is-loaded .lib-manga-page'), null, { timeout: 60000 });
    await win.evaluate(async () => window.__activeLibraryCtl.book._comicViewport.goTo(7));
    await win.waitForFunction(() => window.__activeLibraryCtl?.book?._comicViewport?.activePage === 7);
    await win.waitForTimeout(360);

    await setReaderSelect('.lib-pagew', '0.5', 'pageWidth');
    const narrow = await imageProbe();
    await setReaderSelect('.lib-pagew', '1', 'pageWidth');
    const wide = await imageProbe();
    assert(wide.imageWidth > narrow.imageWidth + wide.hostWidth * 0.25,
      `comic pageWidth is a no-op: ${JSON.stringify({ narrow, wide })}`, 'W89B_COMIC_WIDTH');

    const beforeWidthResize = wide;
    await mainWindowSize(1120, 920);
    await win.waitForTimeout(650);
    const compactWidth = await imageProbe();
    await mainWindowSize(1500, 920);
    await win.waitForTimeout(650);
    const restoredWidth = await imageProbe();
    assert(compactWidth.activePage === beforeWidthResize.activePage
      && restoredWidth.activePage === beforeWidthResize.activePage,
    `comic width-only resize changed page: ${JSON.stringify({ beforeWidthResize, compactWidth, restoredWidth })}`,
    'W89B_COMIC_WIDTH_PAGE');
    assert(Math.abs(compactWidth.slotTop - beforeWidthResize.slotTop) <= 3
      && Math.abs(restoredWidth.slotTop - beforeWidthResize.slotTop) <= 3,
    `comic width-only resize did not pin active slot: ${JSON.stringify({ beforeWidthResize, compactWidth, restoredWidth })}`,
    'W89B_COMIC_WIDTH_PIN');

    const beforeResize = restoredWidth;
    await mainWindowSize(1500, 650);
    await win.waitForTimeout(650);
    const afterResize = await imageProbe();
    assert(afterResize.activePage === beforeResize.activePage,
      `comic resize changed page: ${JSON.stringify({ beforeResize, afterResize })}`, 'W89B_COMIC_PAGE');
    assert(Math.abs(afterResize.slotTop - beforeResize.slotTop) <= 3,
      `comic resize did not pin active slot: ${JSON.stringify({ beforeResize, afterResize })}`, 'W89B_COMIC_PIN');
    return {
      singleNarrow, singleWide, doubleNarrow, doubleWide,
      narrow, wide, beforeWidthResize, compactWidth, restoredWidth, beforeResize, afterResize,
    };
  });

  await gate('reader stability run has no renderer exception', async () => {
    assert(runtimeErrors.length === 0, runtimeErrors.join('\n'), 'W89B_RUNTIME_ERRORS');
    return { runtimeErrors: [] };
  });
} finally {
  try {
    if (app) {
      await Promise.race([
        app.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('close timeout')), 15000)),
      ]);
    }
  } catch {
    try { app?.process()?.kill(); } catch {}
  }
  const report = {
    protocol: 'mazz.w89b-reader-stability/v1',
    generatedAt: new Date().toISOString(),
    mode: MODE,
    verdict: gates.length === 8 && gates.every(item => item.verdict === 'PASS') ? 'PASS' : 'FAIL',
    gates,
    runtimeErrors,
    fixtures: {
      epub: fs.existsSync(epubPath) ? { bytes: fs.statSync(epubPath).size, sha256: sha256(epubPath) } : null,
      cbz: fs.existsSync(cbzPath) ? { bytes: fs.statSync(cbzPath).size, sha256: sha256(cbzPath) } : null,
    },
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (process.env.MAZZ_W89B_KEEP_TMP !== '1') {
    for (const dir of [userData, workspace]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
  console.log(`[W89b] ${report.verdict} ${reportPath}`);
  if (report.verdict !== 'PASS') process.exitCode = 1;
}
