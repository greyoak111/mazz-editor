import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), '..', '..');
const executableIndex = process.argv.indexOf('--executable');
const EXECUTABLE = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : '';
const MODE = EXECUTABLE ? 'packaged' : 'source';
const EVIDENCE_ROOT = path.join(ROOT, 'docs', 'engineering', 'evidence');
const EVIDENCE_JSON = path.join(EVIDENCE_ROOT, `W93G_LIBRARY_CONVERGENCE_${MODE.toUpperCase()}.json`);
const EVIDENCE_PNG = path.join(EVIDENCE_ROOT, `W93G_LIBRARY_CONVERGENCE_${MODE.toUpperCase()}.png`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w93g-${MODE}-user-`)));
const SOURCE_WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w93g-${MODE}-source-`)));
const COPY_PARENT = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w93g-${MODE}-copy-`)));
const TARGET_WORKSPACE = path.join(COPY_PARENT, 'Moved Workspace');
const TEXT_BODY = 'W93G portable catalog keeps the stable book identity.';
const PDF_BODY = '%PDF-0123456789-W93G';
const TEXT_ID = 'w93g-stable-text';
const PDF_ID = 'w93g-stable-pdf';

fs.mkdirSync(path.join(SOURCE_WORKSPACE, '书库'));
const sourceText = path.join(SOURCE_WORKSPACE, '书库', 'original.txt');
const sourcePdf = path.join(SOURCE_WORKSPACE, '书库', 'range.pdf');
fs.writeFileSync(sourceText, TEXT_BODY);
fs.writeFileSync(sourcePdf, PDF_BODY);

const slash = value => String(value || '').replace(/\\/g, '/');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function launch(errors) {
  const options = {
    args: EXECUTABLE ? [] : [ROOT],
    env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: USER_DATA,
      MAZZ_E2E_WORKSPACE: SOURCE_WORKSPACE, MAZZ_E2E_DISABLE_GPU: '1', MAZZ_E2E_ALLOW_LIVE_PROVIDER: '0' },
    timeout: 120000,
  };
  if (EXECUTABLE) options.executablePath = EXECUTABLE;
  const app = await electron.launch(options);
  const page = await app.firstWindow({ timeout: 120000 });
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => errors.push(`[pageerror] ${error.stack || error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!/Autofill|SharedArrayBuffer|ERR_FILE_NOT_FOUND|ffmpeg_common/i.test(text)) errors.push(`[console.error] ${text}`);
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz && window.MazzCommands && window.MazzShell));
  return { app, page };
}

async function openLibrary(page) {
  await page.evaluate(async () => {
    await Promise.all([
      window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
      window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
    ]);
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
    await window.MazzCommands.execute('file.newLibrary');
  });
  await page.waitForFunction(() => {
    const binding = window.__activeLibraryCtl?.repositoryBinding;
    return Boolean(binding?.repository?.identity?.canonical && !binding.retiring && binding.pending?.size === 0);
  });
}

const runtimeErrors = [];
let product = null;
let report = null;
try {
  product = await launch(runtimeErrors);
  await openLibrary(product.page);
  await product.page.evaluate(async fixture => {
    const ctl = window.__activeLibraryCtl;
    const repository = ctl.repositoryBinding.repository;
    await repository.mutateBooks(() => [
      { id: fixture.textId, title: 'Portable Text', author: 'Fixture', format: 'txt', category: 'W93G',
        path: fixture.textPath, sourcePath: fixture.textPath, sourceHash: 'legacy-text', addedAt: 1 },
      { id: fixture.pdfId, title: 'Range PDF', author: 'Fixture', format: 'pdf', category: 'W93G',
        path: fixture.pdfPath, sourcePath: fixture.pdfPath, sourceHash: 'legacy-pdf', addedAt: 2 },
    ]);
    await repository.set('categories', ['W93G']);
    await repository.set('progress', { [fixture.textId]: { chapter: 7, ratio: 0.5 } });
    await repository.set('bookmarks', { [fixture.textId]: { marks: [{ quote: 'portable' }] } });
    await ctl.resumePortableCatalog();
    await ctl.repositoryBinding.portableCatalog.request();
    await ctl.repositoryBinding.portableCatalog.flush();
  }, { textId: TEXT_ID, pdfId: PDF_ID, textPath: slash(sourceText), pdfPath: slash(sourcePdf) });

  const catalogPath = path.join(SOURCE_WORKSPACE, '书库', '.mazz-library-catalog.json');
  assert.equal(fs.existsSync(catalogPath), true);
  const catalogRaw = fs.readFileSync(catalogPath, 'utf8');
  assert.equal(catalogRaw.includes(SOURCE_WORKSPACE), false);
  assert.equal(JSON.parse(catalogRaw).books.every(book => /^[a-f0-9]{64}$/.test(book.sha256)), true);

  fs.cpSync(SOURCE_WORKSPACE, TARGET_WORKSPACE, { recursive: true });
  const movedText = path.join(TARGET_WORKSPACE, '书库', 'renamed.txt');
  fs.renameSync(path.join(TARGET_WORKSPACE, '书库', 'original.txt'), movedText);
  fs.mkdirSync(path.join(TARGET_WORKSPACE, '书库', '.cache'), { recursive: true });
  fs.writeFileSync(path.join(TARGET_WORKSPACE, '书库', '.cache', `${TEXT_ID}.zip`), 'live');
  fs.writeFileSync(path.join(TARGET_WORKSPACE, '书库', '.cache', 'orphan.zip'), 'orphan');

  await product.page.evaluate(target => window.mazz.invoke('workspace:setCurrent', { path: target }), slash(TARGET_WORKSPACE));
  await product.page.waitForFunction(target => {
    const binding = window.__activeLibraryCtl?.repositoryBinding;
    return binding?.repository?.identity?.canonical?.replace(/\\/g, '/').toLowerCase()
      === target.toLowerCase() && binding.pending?.size === 0;
  }, slash(TARGET_WORKSPACE));
  await product.page.waitForFunction(id => window.__activeLibraryCtl?.shelf?.records?.some(book => book.id === id), TEXT_ID);

  const restored = await product.page.evaluate(async fixture => {
    const ctl = window.__activeLibraryCtl;
    const repository = ctl.repositoryBinding.repository;
    const books = await repository.listBooks();
    const progress = await repository.getValue('progress');
    const bookmarks = await repository.getValue('bookmarks');
    const pdf = books.find(book => book.id === fixture.pdfId);
    const pdfUrl = await window.mazz.invoke('library:portableAssetUrl', {
      workspacePath: repository.identity.canonical, path: pdf.path,
    });
    const range = await fetch(pdfUrl, { headers: { Range: 'bytes=5-8' } });
    const rangeText = new TextDecoder().decode(await range.arrayBuffer());
    const liveBookIds = books.map(book => book.id);
    const plan = await window.mazz.invoke('library:derivedCachePlan', {
      workspacePath: repository.identity.canonical, liveBookIds,
    });
    const committed = await window.mazz.invoke('library:derivedCacheCommit', {
      workspacePath: repository.identity.canonical, planId: plan.planId, liveBookIds,
    });
    return {
      books, progress, bookmarks, pdfUrl,
      rangeStatus: range.status,
      contentRange: range.headers.get('content-range'),
      rangeText,
      plan,
      committed,
      portable: ctl.repositoryBinding.portableCatalog.snapshot(),
    };
  }, { pdfId: PDF_ID });

  const textBook = restored.books.find(book => book.id === TEXT_ID);
  assert.equal(path.basename(textBook.path), 'renamed.txt');
  assert.equal(textBook.sourceHash, sha256(movedText));
  assert.equal(textBook.missing, false);
  assert.equal(restored.progress[TEXT_ID].chapter, 7);
  assert.equal(restored.bookmarks[TEXT_ID].marks[0].quote, 'portable');
  assert.equal(restored.rangeStatus, 206);
  assert.equal(restored.contentRange, 'bytes 5-8/20');
  assert.equal(restored.rangeText, '0123');
  assert.deepEqual(restored.plan.entries.map(entry => entry.relativePath), ['.cache/orphan.zip']);
  assert.deepEqual(restored.committed.deleted, ['.cache/orphan.zip']);
  assert.equal(fs.existsSync(path.join(TARGET_WORKSPACE, '书库', '.cache', `${TEXT_ID}.zip`)), true);
  assert.equal(fs.existsSync(path.join(TARGET_WORKSPACE, '书库', 'range.pdf')), true);
  assert.equal(restored.portable.timerCount, 0);

  await product.page.screenshot({ path: EVIDENCE_PNG, fullPage: true });
  const resources = await product.app.evaluate(() => globalThis.__MAZZ_E2E_LIBRARY_CONVERGENCE__.snapshot());
  assert.deepEqual(resources, { gcPlanCount: 0, timerCount: 0, listenerCount: 0, networkOwnerCount: 0 });
  assert.deepEqual(runtimeErrors, []);
  report = {
    schema: 'mazz.w93g-library-convergence-runtime/v1', mode: MODE, result: 'PASS',
    product: EXECUTABLE ? 'win-unpacked' : 'source', portableCatalogPrivate: true,
    copiedWorkspaceRestored: true, stableBookId: textBook.id, relocatedLeaf: path.basename(textBook.path),
    fullSha256: textBook.sourceHash, progressRestored: true, bookmarksRestored: true,
    pdfRange: { status: restored.rangeStatus, contentRange: restored.contentRange, body: restored.rangeText },
    cacheGc: { planned: restored.plan.entries.length, deleted: restored.committed.deleted.length, formalAssetsRetained: true },
    networkCalls: 0, resources, runtimeErrors,
    screenshot: path.basename(EVIDENCE_PNG), rendererBundleSha256: sha256(path.join(ROOT, 'renderer', 'dist', 'app.js')),
    executableSha256: EXECUTABLE ? sha256(EXECUTABLE) : null, generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(EVIDENCE_JSON, `${JSON.stringify(report, null, 2)}\n`);
  await product.app.close();
  product = null;
} finally {
  if (product) await product.app.close().catch(() => {});
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(SOURCE_WORKSPACE, { recursive: true, force: true });
  fs.rmSync(COPY_PARENT, { recursive: true, force: true });
}

assert.equal(fs.existsSync(USER_DATA), false);
assert.equal(fs.existsSync(SOURCE_WORKSPACE), false);
assert.equal(fs.existsSync(COPY_PARENT), false);
assert.ok(report);
process.stdout.write(`W93G_RUNTIME_REPORT=${JSON.stringify(report)}\n`);
