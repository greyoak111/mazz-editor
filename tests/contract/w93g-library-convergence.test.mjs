import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createLibraryRepository } from '../../renderer/modules/library/repository.js';
import { restorePortableCatalog, savePortableCatalog } from '../../renderer/modules/library/portable-catalog.js';

const require = createRequire(import.meta.url);
const {
  CATALOG_FILE,
  LibraryWorkspaceConvergenceService,
  normalizeCatalog,
  safeRelativePath,
  parseByteRange,
} = require('../../main/library-workspace-convergence');
const { registerLibraryWorkspaceConvergenceIpc, workspaceToken } = require('../../main/library-workspace-convergence-ipc');

const NOW = '2026-08-25T12:00:00.000Z';

async function temporary(action) {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w93g-'));
  const root = fs.realpathSync.native ? fs.realpathSync.native(created) : fs.realpathSync(created);
  fs.mkdirSync(path.join(root, '书库'));
  try { return await action(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function service() {
  return new LibraryWorkspaceConvergenceService({ now: () => new Date(NOW), randomId: () => 'fixture' });
}

function snapshot(root, bookPath, id = 'book-one') {
  return {
    books: [{ id, title: 'Portable Book', author: 'Author', format: 'txt', category: '测试',
      addedAt: 1, lastOpenedAt: 2, favorite: true, path: bookPath }],
    categories: ['测试'],
    progress: { [id]: { chapter: 7, ratio: 0.5 } },
    bookmarks: { [id]: { marks: [{ quote: 'portable' }] } },
  };
}

function repositoryInvoke(workspace, convergence) {
  const values = new Map();
  return async (channel, payload = {}) => {
    if (channel === 'workspace:get') return workspace;
    if (channel === 'settings:get') return structuredClone(values.get(payload.key));
    if (channel === 'settings:set') { values.set(payload.key, structuredClone(payload.value)); return true; }
    if (channel === 'settings:compareAndSet') {
      const entries = Array.isArray(payload.entries) ? payload.entries : [payload];
      const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const conflict = entries.find(entry => !equal(values.get(entry.key), entry.expected));
      if (conflict) return { ok: false, key: conflict.key, current: structuredClone(values.get(conflict.key)) };
      for (const entry of entries) values.set(entry.key, structuredClone(entry.value));
      return { ok: true };
    }
    if (channel === 'library:portableCatalogSave') return convergence.save(workspace, payload.snapshot);
    if (channel === 'library:portableCatalogRebuild') return convergence.rebuild(workspace);
    throw new Error(`unexpected channel ${channel}`);
  };
}

test('W93G relative path and range contracts fail closed', () => {
  assert.equal(safeRelativePath('书库/book.pdf'), '书库/book.pdf');
  for (const value of ['../book.pdf', '/book.pdf', 'C:/book.pdf', '书库\\book.pdf', '书库/CON.pdf', '书库/book.pdf ']) {
    assert.throws(() => safeRelativePath(value), /路径|相对|精确字符串/);
  }
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
  for (const value of ['bytes=1-2,4-5', 'items=0-1', 'bytes=10-', 'bytes=5-2', 'bytes=-0']) {
    assert.equal(parseByteRange(value, 10).invalid, true);
  }
});

test('W93G saves a path-private portable catalog and reopens it', async () => temporary(async root => {
  const bookPath = path.join(root, '书库', 'book.txt');
  fs.writeFileSync(bookPath, 'portable bytes');
  const first = await service().save(root, snapshot(root, bookPath));
  assert.match(first.catalogId, /^catalog-sha256-[a-f0-9]{64}$/);
  assert.equal(first.books[0].relativePath, '书库/book.txt');
  assert.equal(first.books[0].sha256.length, 64);
  const raw = fs.readFileSync(path.join(root, '书库', CATALOG_FILE), 'utf8');
  assert.equal(raw.includes(root), false);
  assert.equal(normalizeCatalog(JSON.parse(raw)).books[0].id, 'book-one');
  const second = await service().save(root, snapshot(root, bookPath));
  assert.equal(second.revision, 2);
  assert.equal(second.catalogId, first.catalogId);
}));

test('W93G copy rebuild preserves book identity, progress and bookmarks', async () => temporary(async source => {
  const sourceBook = path.join(source, '书库', 'nested', 'book.txt');
  fs.mkdirSync(path.dirname(sourceBook));
  fs.writeFileSync(sourceBook, 'same book');
  await service().save(source, snapshot(source, sourceBook));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w93g-copy-'));
  const target = path.join(parent, 'Moved Workspace');
  try {
    fs.cpSync(source, target, { recursive: true });
    const rebuilt = await service().rebuild(target);
    assert.equal(rebuilt.source, 'catalog');
    assert.equal(rebuilt.books[0].id, 'book-one');
    assert.equal(rebuilt.books[0].missing, false);
    const real = value => (fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value)).toLocaleLowerCase('en-US');
    assert.equal(real(rebuilt.books[0].path), real(path.join(target, '书库', 'nested', 'book.txt')));
    assert.equal(rebuilt.progress['book-one'].chapter, 7);
    assert.equal(rebuilt.bookmarks['book-one'].marks[0].quote, 'portable');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
}));

test('W93G renderer repository restores copied catalog with one multi-partition CAS', async () => temporary(async source => {
  const bookPath = path.join(source, '书库', 'book.txt');
  fs.writeFileSync(bookPath, 'repository portable');
  const sourceService = service();
  const sourceRepository = createLibraryRepository({ invoke: repositoryInvoke(source, sourceService), workspace: source });
  await sourceRepository.init();
  await sourceRepository.mutateBooks(() => [{ id: 'stable-book', title: 'Stable', author: '', format: 'txt',
    category: '测试', path: bookPath, sourcePath: bookPath, sourceHash: 'legacy', addedAt: 1 }]);
  await sourceRepository.set('categories', ['测试']);
  await sourceRepository.set('progress', { 'stable-book': { chapter: 9 } });
  await sourceRepository.set('bookmarks', { 'stable-book': { marks: [{ quote: 'kept' }] } });
  await savePortableCatalog({ invoke: repositoryInvoke(source, sourceService), repository: sourceRepository });

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w93g-repo-copy-'));
  const target = path.join(parent, 'Moved');
  try {
    fs.cpSync(source, target, { recursive: true });
    const targetService = service();
    const invoke = repositoryInvoke(target, targetService);
    const targetRepository = createLibraryRepository({ invoke, workspace: target });
    await targetRepository.init();
    const restored = await restorePortableCatalog({ invoke, repository: targetRepository });
    assert.equal(restored.restored, true);
    assert.equal((await targetRepository.listBooks())[0].id, 'stable-book');
    assert.equal((await targetRepository.getValue('progress'))['stable-book'].chapter, 9);
    assert.equal((await targetRepository.getValue('bookmarks'))['stable-book'].marks[0].quote, 'kept');
    const second = await targetRepository.restorePortableSnapshot(restored.rebuilt);
    assert.equal(second.conflict, true);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
}));

test('W93G uniquely relocates renamed assets by full SHA-256', async () => temporary(async root => {
  const original = path.join(root, '书库', 'original.txt');
  const renamed = path.join(root, '书库', 'renamed.txt');
  fs.writeFileSync(original, 'rename me');
  await service().save(root, snapshot(root, original));
  fs.renameSync(original, renamed);
  const rebuilt = await service().rebuild(root);
  assert.equal(rebuilt.books[0].path, renamed);
  assert.equal(rebuilt.books[0].missing, false);
  assert.equal(rebuilt.missing, 0);
}));

test('W93G never guesses between duplicate hash matches and marks zero matches missing', async () => temporary(async root => {
  const original = path.join(root, '书库', 'original.txt');
  fs.writeFileSync(original, 'duplicate bytes');
  await service().save(root, snapshot(root, original));
  fs.renameSync(original, path.join(root, '书库', 'one.txt'));
  fs.writeFileSync(path.join(root, '书库', 'two.txt'), 'duplicate bytes');
  const conflict = await service().rebuild(root);
  assert.equal(conflict.books[0].missing, true);
  assert.equal(conflict.books[0].repairConflict, true);
  assert.equal(conflict.ambiguous, 1);
  fs.unlinkSync(path.join(root, '书库', 'one.txt'));
  fs.unlinkSync(path.join(root, '书库', 'two.txt'));
  const absent = await service().rebuild(root);
  assert.equal(absent.books[0].missing, true);
  assert.equal(absent.missing, 1);
}));

test('W93G catalog corruption fails closed and preserves original bytes', async () => temporary(async root => {
  const catalogPath = path.join(root, '书库', CATALOG_FILE);
  fs.writeFileSync(catalogPath, '{broken');
  await assert.rejects(service().rebuild(root), /catalog 损坏/);
  assert.equal(fs.readFileSync(catalogPath, 'utf8'), '{broken');
}));

test('W93G PDF readable asset streams strict 200/206/HEAD/416 responses', async () => temporary(async root => {
  const pdf = path.join(root, '书库', 'book.pdf');
  fs.writeFileSync(pdf, Buffer.from('%PDF-0123456789'));
  const asset = service().openReadableAsset(root, '书库/book.pdf');
  const partial = asset.createResponse({ range: 'bytes=5-8' });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers['Content-Range'], 'bytes 5-8/15');
  const chunks = [];
  for await (const chunk of partial.body) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), '0123');
  const suffix = asset.createResponse({ range: 'bytes=-2' });
  const suffixChunks = [];
  for await (const chunk of suffix.body) suffixChunks.push(chunk);
  assert.equal(Buffer.concat(suffixChunks).toString(), '89');
  assert.equal(asset.createResponse({ method: 'HEAD' }).body, null);
  assert.equal(asset.createResponse({ range: 'bytes=99-' }).status, 416);
  assert.equal(asset.createResponse({ range: 'bytes=1-2,4-5' }).status, 416);
}));

test('W93G readable asset rejects owner replacement after capability capture', async () => temporary(async root => {
  const pdf = path.join(root, '书库', 'book.pdf');
  fs.writeFileSync(pdf, '%PDF-original');
  const asset = service().openReadableAsset(root, '书库/book.pdf');
  fs.renameSync(pdf, `${pdf}.old`);
  fs.writeFileSync(pdf, '%PDF-replaced');
  assert.throws(() => asset.createResponse({ range: 'bytes=0-1' }), /owner 已变化/);
}));

test('W93G GC deletes only orphan derived files and rejects plan drift', async () => temporary(async root => {
  const cache = path.join(root, '书库', '.cache');
  const covers = path.join(root, '书库', '.covers');
  fs.mkdirSync(cache); fs.mkdirSync(covers);
  fs.writeFileSync(path.join(cache, 'live.zip'), 'keep');
  fs.writeFileSync(path.join(cache, 'dead.zip'), 'drop');
  fs.writeFileSync(path.join(covers, 'live.webp'), 'keep');
  fs.writeFileSync(path.join(root, '书库', 'formal.txt'), 'never delete');
  const owner = service();
  const plan = owner.planDerivedCacheGc(root, ['live']);
  assert.deepEqual(plan.entries.map(entry => entry.relativePath), ['.cache/dead.zip']);
  const result = owner.commitDerivedCacheGc(root, plan.planId, ['live']);
  assert.deepEqual(result.deleted, ['.cache/dead.zip']);
  assert.equal(fs.existsSync(path.join(cache, 'live.zip')), true);
  assert.equal(fs.existsSync(path.join(root, '书库', 'formal.txt')), true);
  const stale = owner.planDerivedCacheGc(root, ['live']);
  fs.writeFileSync(path.join(covers, 'late.webp'), 'late');
  assert.throws(() => owner.commitDerivedCacheGc(root, stale.planId, ['live']), /变化|重新规划/);
}));

test('W93G IPC is trusted/current-Workspace scoped and signs only contained assets', async () => temporary(async root => {
  const handlers = new Map();
  const owner = service();
  registerLibraryWorkspaceConvergenceIpc({
    bus: { handle(channel, handler) { handlers.set(channel, handler); } },
    service: owner,
    currentWorkspace: () => root,
    isTrustedSender: event => event?.trusted === true,
  });
  const pdf = path.join(root, '书库', 'book.pdf');
  fs.writeFileSync(pdf, '%PDF-fixture');
  await assert.rejects(handlers.get('library:portableAssetUrl')({ workspacePath: root, path: pdf }, { trusted: false }), /trusted/);
  await assert.rejects(handlers.get('library:portableCatalogRebuild')({ workspacePath: path.dirname(root) }, { trusted: true }), /当前 Workspace/);
  const url = await handlers.get('library:portableAssetUrl')({ workspacePath: root, path: pdf }, { trusted: true });
  const physical = fs.realpathSync.native ? fs.realpathSync.native(root) : fs.realpathSync(root);
  assert.equal(url, `mazz-res://library/${workspaceToken(physical)}/${encodeURIComponent('书库/book.pdf')}`);
  await assert.rejects(handlers.get('library:portableAssetUrl')({ workspacePath: root, path: path.join(path.dirname(root), 'outside.pdf') }, { trusted: true }), /越界|不存在|不安全路径/);
}));

test('W93G static contract contains no fixed book, catalog or cache count/size gate', () => {
  const source = fs.readFileSync(new URL('../../main/library-workspace-convergence.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:MAX_(?:BOOK|CATALOG|CACHE)|slice\(0,\s*\d+|books\.length\s*[>=])/);
  assert.match(source, /createReadStream/);
  assert.doesNotMatch(source, /readFileSync\(target\)|Buffer\.concat/);
  const renderer = fs.readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');
  assert.match(renderer, /repaired = !!duplicate/);
  assert.match(renderer, /library:portableAssetUrl/);
  assert.doesNotMatch(renderer, /book\.format === 'pdf'\)[\s\S]{0,180}fs:readFileBase64/);
  const main = fs.readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8');
  assert.match(main, /rel\.startsWith\('library\/'\)/);
  assert.match(main, /libraryWorkspaceToken\(physicalWorkspace\)/);
});
