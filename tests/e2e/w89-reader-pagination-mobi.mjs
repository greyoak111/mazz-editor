// W89 real-Electron reader gate: physical page/measure separation, visible
// page-turn feedback, and the pre-W88 image-dominant MOBI compatibility route.
import { _electron as electron } from 'playwright';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const { extractFile: extractAsarFile } = require('@electron/asar');

const ROOT = path.resolve('.');
const EXECUTABLE = String(process.env.MAZZ_W89_EXECUTABLE || '');
const MODE = EXECUTABLE ? 'packaged' : 'source';
const actualMobi = path.resolve(process.env.MAZZ_W89_MOBI
  || 'D:/mazzworkplace/书库/[成田良悟] 无头骑士异闻录1-10.mobi');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w89-reader-${MODE}-user-`));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w89-reader-${MODE}-ws-`));
const booksDir = path.join(workspace, '书库');
const evidenceDir = path.resolve(process.env.MAZZ_W89_EVIDENCE_DIR
  || path.join(ROOT, 'docs', 'engineering', 'evidence'));
fs.mkdirSync(booksDir, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

const epubPath = path.join(booksDir, 'W89-分页版心.epub');
const paperShot = path.join(evidenceDir, `W89_READER_PAPER_${MODE.toUpperCase()}.png`);
const mobiShot = path.join(evidenceDir, `W89_MOBI_COMPAT_${MODE.toUpperCase()}.png`);
const reportPath = path.join(evidenceDir, `W89_READER_PAGINATION_MOBI_${MODE.toUpperCase()}.json`);
const runtimeErrors = [];
const gates = [];
let app;
let win;

const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const packagedArtifact = () => {
  if (!EXECUTABLE || !fs.existsSync(EXECUTABLE)) return null;
  const executable = path.resolve(EXECUTABLE);
  const appAsar = path.join(path.dirname(executable), 'resources', 'app.asar');
  if (!fs.existsSync(appAsar)) return { executable, sha256: sha256(executable), appAsar: null, embeddedBundle: null };
  const embedded = extractAsarFile(appAsar, path.join('renderer', 'dist', 'app.js'));
  return {
    executable,
    sha256: sha256(executable),
    appAsar: { path: appAsar, sha256: sha256(appAsar) },
    embeddedBundle: {
      path: 'renderer/dist/app.js',
      sha256: createHash('sha256').update(embedded).digest('hex'),
    },
  };
};
const assert = (condition, message, code = 'W89_ASSERT') => {
  if (!condition) throw Object.assign(new Error(`${code}: ${message}`), { code });
};

async function gate(name, action) {
  const startedAt = Date.now();
  try {
    const detail = await action();
    gates.push({ name, verdict: 'PASS', durationMs: Date.now() - startedAt, detail });
    console.log(`[W89] PASS ${name}`);
    return detail;
  } catch (error) {
    gates.push({ name, verdict: 'FAIL', durationMs: Date.now() - startedAt, code: error.code || 'W89_GATE', error: error.message });
    console.error(`[W89] FAIL ${name}: ${error.stack || error.message}`);
    return null;
  }
}

async function writeFixtureEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
  zip.file('OPS/book.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>W89 分页版心</dc:title><dc:creator>真实阅读门</dc:creator></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`);
  const paragraphs = Array.from({ length: 80 }, (_, index) =>
    `<p>第 ${index + 1} 段。真正耐读的分页，应当把纸张、页内留白与正文行宽分开计算；文字不贴边，翻页也不闪白。${'书页需要呼吸感。'.repeat(6)}</p>`).join('');
  zip.file('OPS/c1.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>W89</title></head><body><h1>分页不是裁切</h1>${paragraphs}</body></html>`);
  fs.writeFileSync(epubPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function openBook(id) {
  const card = win.locator(`.lib-shelf-view:visible .lib-card[data-id="${id}"]`);
  await card.waitFor({ state: 'visible', timeout: 30000 });
  await card.click();
  await win.waitForFunction(bookId => window.__activeLibraryCtl?.book?.meta?.id === bookId, id, { timeout: 120000 });
}

async function setReaderSelect(selector, value, field) {
  await win.evaluate(({ selector, value }) => {
    const select = window.__activeLibraryCtl?.root?.querySelector(selector);
    if (!select) throw new Error(`missing reader select ${selector}`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, value });
  await win.waitForFunction(({ field, value }) => String(window.__activeLibraryCtl?.[field]) === String(value), { field, value });
}

async function backToShelf() {
  await win.locator('.lib-reader:visible [data-a="back"]').click();
  await win.waitForFunction(() => !window.__activeLibraryCtl?.book
    && getComputedStyle(window.__activeLibraryCtl?.root?.querySelector('.lib-shelf-view')).display !== 'none', null, { timeout: 60000 });
}

try {
  assert(fs.existsSync(actualMobi), `compatibility specimen not found: ${actualMobi}`, 'W89_SPECIMEN_MISSING');
  await writeFixtureEpub();
  const records = [
    {
      id: 'w89-paper', title: 'W89 分页版心', author: '真实阅读门', cover: '', path: epubPath,
      sourcePath: epubPath, format: 'epub', category: '未分类', addedAt: Date.now(),
    },
    {
      id: 'w89-mobi', title: '凉宫春日的分裂', author: '谷川流', cover: '', path: actualMobi,
      sourcePath: actualMobi, format: 'mobi', category: '未分类', addedAt: Date.now() - 1,
      repositoryScope: 'external',
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
  win.setDefaultTimeout(120000);
  win.on('pageerror', error => runtimeErrors.push(`[pageerror] ${error.message}`));
  win.on('console', message => {
    if (message.type() === 'error' && !/Autofill|SharedArrayBuffer|deprecat|ERR_FILE_NOT_FOUND/i.test(message.text())) {
      runtimeErrors.push(`[console.error] ${message.text()}`);
    }
  });
  await win.waitForFunction(() => !!window.MazzCommands && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async records => {
    await Promise.all([
      window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
      window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
      window.mazz.invoke('settings:set', { key: 'library.books', value: records }),
      window.mazz.invoke('settings:set', { key: 'library.categories', value: ['未分类'] }),
      window.mazz.invoke('settings:set', { key: 'library.progress', value: {} }),
    ]);
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
    await window.MazzCommands.execute('file.newLibrary');
  }, records);
  await win.waitForFunction(() => window.__activeLibraryCtl?.shelf?.records?.length === 2, null, { timeout: 60000 });

  await gate('60% paper retains a readable inner measure', async () => {
    await openBook('w89-paper');
    await setReaderSelect('.lib-pagew', '0.6', 'pageWidth');
    await setReaderSelect('.lib-margin', 'comfortable', 'pageMargin');
    await win.waitForFunction(() => window.__activeLibraryCtl?._pageGeometry?.profile === 'comfortable');
    const detail = await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      const frame = ctl.root.querySelector('iframe.lib-book-frame');
      const doc = frame.contentDocument;
      const wrap = doc.querySelector('.lib-flow-wrap');
      const flow = doc.querySelector('.lib-flow');
      const block = flow.querySelector('h1,p');
      const paper = wrap.getBoundingClientRect();
      const text = block.getBoundingClientRect();
      const style = getComputedStyle(flow);
      return {
        geometry: ctl._pageGeometry,
        frameWidth: doc.documentElement.clientWidth,
        paper: { left: paper.left, right: paper.right, width: paper.width },
        text: { left: text.left, right: text.right, width: text.width },
        computedPaddingInline: parseFloat(style.paddingInlineStart),
        stageBackground: getComputedStyle(doc.documentElement).backgroundColor,
        paperBackground: getComputedStyle(wrap).backgroundColor,
      };
    });
    const g = detail.geometry;
    assert(Math.abs(g.sheetWidth - detail.frameWidth * 0.6) <= 2, `paper is not 60%: ${JSON.stringify(detail)}`, 'W89_PAPER_WIDTH');
    assert(g.pagePaddingInline >= 36 && g.contentWidth <= 640, `inner measure not bounded: ${JSON.stringify(g)}`, 'W89_TEXT_MEASURE');
    assert(detail.text.left - detail.paper.left >= g.pagePaddingInline - 3,
      `text touches left paper edge: ${JSON.stringify(detail)}`, 'W89_LEFT_MARGIN');
    assert(detail.paper.right - detail.text.right >= g.pagePaddingInline - 3,
      `text touches right paper edge: ${JSON.stringify(detail)}`, 'W89_RIGHT_MARGIN');
    assert(detail.stageBackground !== detail.paperBackground, 'paper surface is not visually separated from the stage', 'W89_PAPER_SURFACE');
    await win.screenshot({ path: paperShot });
    return detail;
  });

  await gate('page turn advances one exact pitch with visible, bounded feedback', async () => {
    const before = await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      const wrap = ctl._flowWrap;
      wrap.ownerDocument.defaultView.__w89TurnClasses = [];
      const observer = new MutationObserver(() => wrap.ownerDocument.defaultView.__w89TurnClasses.push(wrap.className));
      observer.observe(wrap, { attributes: true, attributeFilter: ['class'] });
      wrap.ownerDocument.defaultView.__w89TurnObserver = observer;
      return { offset: ctl._flowOffset || 0, pitch: ctl._pageGeometry.pagePitch, reduced: ctl._frame.contentWindow.matchMedia('(prefers-reduced-motion: reduce)').matches };
    });
    await win.locator('.lib-reader:visible [data-a="next"]').click();
    await win.waitForFunction(offset => (window.__activeLibraryCtl?._flowOffset || 0) > offset, before.offset, { timeout: 30000 });
    await win.waitForTimeout(240);
    const after = await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      const view = ctl._flowWrap.ownerDocument.defaultView;
      view.__w89TurnObserver?.disconnect();
      return { offset: ctl._flowOffset || 0, classes: view.__w89TurnClasses || [] };
    });
    assert(Math.abs((after.offset - before.offset) - before.pitch) <= 2,
      `turn drift ${JSON.stringify({ before, after })}`, 'W89_TURN_PITCH');
    if (!before.reduced) assert(after.classes.some(value => /is-turn-fade/.test(value)),
      `turn feedback never became visible: ${JSON.stringify(after.classes)}`, 'W89_TURN_FEEDBACK');
    return { before, after };
  });

  await gate('progress fold keeps iframe geometry and semantic reading point stable', async () => {
    const before = await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      return {
        frameHeight: ctl._frame.getBoundingClientRect().height,
        barHeight: ctl.root.querySelector('.lib-progress').getBoundingClientRect().height,
        offset: ctl._flowOffset,
        anchor: ctl.captureProgress()?.anchor,
      };
    });
    await win.locator('.lib-reader:visible [data-a="prog-fold"]').click();
    await win.waitForTimeout(320);
    const folded = await win.evaluate(() => ({
      frameHeight: window.__activeLibraryCtl._frame.getBoundingClientRect().height,
      barHeight: window.__activeLibraryCtl.root.querySelector('.lib-progress').getBoundingClientRect().height,
      offset: window.__activeLibraryCtl._flowOffset,
      display: getComputedStyle(window.__activeLibraryCtl.root.querySelector('.lib-progress')).display,
      visibility: getComputedStyle(window.__activeLibraryCtl.root.querySelector('.lib-progress')).visibility,
      opacity: Number(getComputedStyle(window.__activeLibraryCtl.root.querySelector('.lib-progress')).opacity),
      trackWidth: window.__activeLibraryCtl.root.querySelector('.lib-prog-track').getBoundingClientRect().width,
      position: window.__activeLibraryCtl.root.querySelector('.lib-pos').textContent,
      toggleExpanded: window.__activeLibraryCtl.root.querySelector('[data-a="prog-fold"]').getAttribute('aria-expanded'),
    }));
    await win.locator('.lib-reader:visible [data-a="prog-fold"]').click();
    await win.waitForTimeout(320);
    const expanded = await win.evaluate(() => ({
      frameHeight: window.__activeLibraryCtl._frame.getBoundingClientRect().height,
      barHeight: window.__activeLibraryCtl.root.querySelector('.lib-progress').getBoundingClientRect().height,
      offset: window.__activeLibraryCtl._flowOffset,
      anchor: window.__activeLibraryCtl.captureProgress()?.anchor,
    }));
    assert(folded.display === 'flex', `collapsed bar left layout: ${JSON.stringify(folded)}`, 'W89_PROGRESS_SLOT');
    assert(folded.visibility === 'visible' && folded.opacity > .99 && folded.trackWidth >= 48
      && /\d+\s*\/\s*\d+/.test(folded.position) && /\d+%/.test(folded.position)
      && folded.toggleExpanded === 'false',
    `collapsed bar lost compact progress controls: ${JSON.stringify(folded)}`, 'W89_PROGRESS_COMPACT');
    assert(Math.abs(before.frameHeight - folded.frameHeight) < .01 && Math.abs(before.frameHeight - expanded.frameHeight) < .01
      && Math.abs(before.barHeight - folded.barHeight) < .01 && Math.abs(before.barHeight - expanded.barHeight) < .01,
      `progress bar resized page grid: ${JSON.stringify({ before, folded, expanded })}`, 'W89_PROGRESS_REFLOW');
    assert(Math.abs(before.offset - folded.offset) < 1 && Math.abs(before.offset - expanded.offset) < 1,
      `progress bar moved reading point: ${JSON.stringify({ before, folded, expanded })}`, 'W89_PROGRESS_LOCATOR');
    return { before, folded, expanded };
  });

  await gate('double view still advances one physical page pitch', async () => {
    await setReaderSelect('.lib-mode', 'double', 'mode');
    await win.waitForFunction(() => window.__activeLibraryCtl?._pageGeometry?.effectiveMode === 'double'
      && !!window.__activeLibraryCtl?._flowWrap);
    const before = await win.evaluate(() => ({
      offset: window.__activeLibraryCtl._flowOffset,
      pitch: window.__activeLibraryCtl._pageGeometry.pagePitch,
      wrapWidth: window.__activeLibraryCtl._flowWrap.clientWidth,
    }));
    await win.locator('.lib-reader:visible [data-a="next"]').click();
    await win.waitForFunction(offset => window.__activeLibraryCtl._flowOffset > offset, before.offset);
    const after = await win.evaluate(() => ({ offset: window.__activeLibraryCtl._flowOffset }));
    assert(Math.abs((after.offset - before.offset) - before.pitch) <= 2,
      `double view skipped a physical page: ${JSON.stringify({ before, after })}`, 'W89_DOUBLE_PHYSICAL_PAGE');
    assert(before.wrapWidth > before.pitch, `double view is not showing two sheets: ${JSON.stringify(before)}`, 'W89_DOUBLE_VISIBLE_SPREAD');
    return { before, after };
  });

  await backToShelf();
  await gate('57.6 MiB legacy image MOBI bypasses the 32 MiB text parser cliff', async () => {
    await openBook('w89-mobi');
    await win.waitForFunction(() => {
      const ctl = window.__activeLibraryCtl;
      const image = ctl?.root?.querySelector('.lib-reader .lib-manga-page');
      return ctl?.book?.mobiRoute === 'image-dominant' && ctl?.book?.cbz?.count > 0
        && image && (image.complete || image.naturalWidth > 0);
    }, null, { timeout: 120000 });
    const detail = await win.evaluate(() => {
      const ctl = window.__activeLibraryCtl;
      const image = ctl.root.querySelector('.lib-reader .lib-manga-page');
      return {
        id: ctl.book.meta.id,
        runtimeFormat: ctl.book.meta.format,
        route: ctl.book.mobiRoute,
        pages: ctl.book.cbz.count,
        cached: ctl.book.cbz.cachedCount?.() ?? null,
        page: ctl.pageIdx,
        image: { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
      };
    });
    assert(detail.route === 'image-dominant' && detail.runtimeFormat === 'cbz', JSON.stringify(detail), 'W89_MOBI_ROUTE');
    assert(detail.pages === 336, `expected 336 image pages, got ${detail.pages}`, 'W89_MOBI_PAGES');
    assert(detail.cached <= 6, `MOBI image owner is not bounded: ${detail.cached}`, 'W89_MOBI_RESIDENCY');
    assert(detail.image.naturalWidth > 0 && detail.image.naturalHeight > 0, `MOBI page did not decode: ${JSON.stringify(detail.image)}`, 'W89_MOBI_DECODE');
    await win.screenshot({ path: mobiShot });
    return detail;
  });

  await gate('reader leaves no renderer runtime errors', async () => {
    assert(runtimeErrors.length === 0, runtimeErrors.join('\n'), 'W89_RUNTIME_ERRORS');
    return { runtimeErrors };
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
    protocol: 'mazz.w89-reader-pagination-mobi/v1',
    generatedAt: new Date().toISOString(),
    mode: MODE,
    verdict: gates.length === 6 && gates.every(item => item.verdict === 'PASS') ? 'PASS' : 'FAIL',
    gates,
    runtimeErrors,
    specimen: fs.existsSync(actualMobi) ? { path: actualMobi, size: fs.statSync(actualMobi).size, sha256: sha256(actualMobi) } : null,
    artifacts: {
      bundle: fs.existsSync(path.join(ROOT, 'renderer', 'dist', 'app.js')) ? sha256(path.join(ROOT, 'renderer', 'dist', 'app.js')) : null,
      executable: EXECUTABLE && fs.existsSync(EXECUTABLE) ? sha256(EXECUTABLE) : null,
      packaged: packagedArtifact(),
      paperScreenshot: fs.existsSync(paperShot) ? { path: paperShot, sha256: sha256(paperShot) } : null,
      mobiScreenshot: fs.existsSync(mobiShot) ? { path: mobiShot, sha256: sha256(mobiShot) } : null,
    },
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (process.env.MAZZ_W89_KEEP_TMP !== '1') {
    for (const dir of [userData, workspace]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
  console.log(`[W89] ${report.verdict} ${reportPath}`);
  if (report.verdict !== 'PASS') process.exitCode = 1;
}
