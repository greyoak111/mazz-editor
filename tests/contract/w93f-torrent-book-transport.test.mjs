import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const contract = require('../../main/library-resource-contract');
const rights = require('../../main/library-rights-policy');
const { createSingleInstanceOwnerCapability } = require('../../main/library-acquisition-store');
const LibraryAcquisitionService = require('../../main/library-acquisition-service');
const LibraryImportService = require('../../main/library-import-service');
const {
  LibraryTorrentBookTransport,
  parsePublicDhtMagnet,
  normalizeTorrentFileCatalog,
} = require('../../main/library-torrent-book-transport');
const {
  LibraryResourceSurfaceService,
  descriptorForTorrent,
  torrentCandidateFromInspection,
} = require('../../main/library-resource-surface-service');
const { registerLibraryResourceSurfaceIpc } = require('../../main/library-resource-surface-ipc');

const INFO_HASH = '0123456789abcdef0123456789abcdef01234567';
const NOW = '2026-08-25T10:00:00.000Z';

function workspace() {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w93f-'));
  return fs.realpathSync.native ? fs.realpathSync.native(created) : fs.realpathSync(created);
}

async function withinWorkspace(action) {
  const root = workspace();
  try { return await action(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function memorySettings(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get(key, fallback) { return values.has(key) ? structuredClone(values.get(key)) : fallback; },
    set(key, value) { values.set(key, structuredClone(value)); },
  };
}

function fakeWebTorrentLoader({
  files = [
    { path: 'books/one.txt', chunks: [Buffer.from('hello '), Buffer.from('torrent')] },
    { path: 'extras/cover.jpg', chunks: [Buffer.from('jpg')] },
  ],
  privateTorrent = false,
  announce = [],
} = {}) {
  const calls = { clients: [], adds: [], selects: [], destroys: 0 };
  class FakeWebTorrent extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      calls.clients.push(options);
    }

    add(magnet, options) {
      calls.adds.push({ magnet, options });
      const torrent = new EventEmitter();
      torrent.ready = false;
      torrent.destroyed = false;
      torrent.name = 'Fixture books';
      torrent.private = privateTorrent;
      torrent.announce = [...announce];
      torrent.urlList = [];
      const total = files.reduce((sum, item) => sum + item.chunks.reduce((n, chunk) => n + chunk.length, 0), 0);
      let store = null;
      if (typeof options.store === 'function') store = new options.store(16, { length: total });
      torrent.files = files.map(item => {
        const length = item.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        return {
          path: item.path,
          length,
          select(priority) { calls.selects.push({ path: item.path, priority }); },
          [Symbol.asyncIterator]() {
            let index = 0;
            return {
              async next() {
                if (index >= item.chunks.length) return { done: true, value: undefined };
                return { done: false, value: item.chunks[index++] };
              },
              async return() { index = item.chunks.length; return { done: true }; },
            };
          },
        };
      });
      torrent.destroy = (destroyOptions, callback) => {
        if (typeof destroyOptions === 'function') { callback = destroyOptions; destroyOptions = {}; }
        torrent.destroyed = true;
        const done = error => { calls.destroys += 1; callback?.(error); };
        if (destroyOptions?.destroyStore && store?.destroy) store.destroy(done);
        else queueMicrotask(() => done(null));
      };
      queueMicrotask(() => { torrent.ready = true; torrent.emit('ready'); });
      return torrent;
    }

    destroy(callback) {
      this.destroyed = true;
      queueMicrotask(() => callback?.(null));
    }
  }
  return { load: async () => ({ default: FakeWebTorrent }), calls };
}

function makeAcquisition(root, torrentTransport) {
  return new LibraryAcquisitionService({
    promoter: new LibraryImportService(),
    torrentTransport,
    resolver: async () => ['93.184.216.34'],
    requester: async () => { throw new Error('HTTP must remain offline'); },
    singleInstanceOwnerCapability: createSingleInstanceOwnerCapability(),
    now: () => new Date(NOW),
  });
}

async function waitFor(check, label) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > 5000) throw new Error(`timeout waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function rightsJob(root, candidate, selectedFiles = ['books/one.txt']) {
  const descriptor = descriptorForTorrent('unspecified');
  const candidateFingerprint = contract.deriveCandidateFingerprint(candidate);
  const assertion = {
    schema: rights.USER_ASSERTION_SCHEMA,
    authority: 'user',
    candidateFingerprint,
    jurisdiction: 'unspecified',
    declarationId: 'declaration-fixture',
    confirmedAt: NOW,
  };
  const decision = rights.evaluateRights({
    candidate, descriptor, jurisdiction: 'unspecified', userAssertion: assertion, now: NOW,
  });
  return rights.prepareAcquisitionJob({
    jobId: 'job-fixture', intentId: 'intent-fixture',
    workspaceIdentity: contract.deriveWorkspaceIdentity(root), workspacePath: root,
    candidate, offerId: candidate.offers[0].offerId, descriptor,
    jurisdiction: 'unspecified', userAssertion: assertion, decision, selectedFiles, createdAt: NOW,
  });
}

test('public-DHT magnet parser canonicalizes BTIH and rejects transport coordinates instead of deleting them', () => {
  assert.deepEqual(parsePublicDhtMagnet(`magnet:?xt=urn:btih:${INFO_HASH}&dn=Fixture`), {
    infoHash: INFO_HASH,
    canonicalMagnet: `magnet:?xt=urn:btih:${INFO_HASH}`,
    displayName: 'Fixture',
  });
  assert.equal(
    parsePublicDhtMagnet('magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').infoHash,
    '0000000000000000000000000000000000000000',
  );
  for (const magnet of [
    `magnet:?xt=urn:btih:${INFO_HASH}&tr=udp%3A%2F%2Ftracker.example`,
    `magnet:?xt=urn:btih:${INFO_HASH}&ws=https%3A%2F%2Fexample.org%2Fbook`,
    `magnet:?xt=urn:btih:${INFO_HASH}&so=0`,
    `magnet:?xt=urn:btih:${INFO_HASH}&xt=urn:btih:${'a'.repeat(40)}`,
    `magnet:?xt=urn:btih:${INFO_HASH}&unknown=value`,
  ]) assert.throws(() => parsePublicDhtMagnet(magnet), /magnet|tracker|webseed|parameter|BTIH/i);
});

test('metadata catalog preserves exact readable paths and rejects traversal, aliases and duplicates', () => {
  assert.deepEqual(normalizeTorrentFileCatalog([
    { path: 'books/ A Tale.epub', length: 12 },
    { path: 'covers/front.jpg', length: 2 },
    { path: 'notes/book.txt', length: 5 },
  ]), [
    { path: 'books/ A Tale.epub', size: 12, format: 'epub' },
    { path: 'notes/book.txt', size: 5, format: 'txt' },
  ]);
  for (const bad of [
    '../escape.epub', '/absolute.epub', 'C:/drive.epub', 'book.epub ',
    'safe/CON.txt', 'safe/a:b.epub', 'safe\\book.epub', 'safe/./book.epub',
  ]) assert.throws(() => normalizeTorrentFileCatalog([{ path: bad, length: 1 }]), /path|unsafe|metadata/i);
  assert.throws(() => normalizeTorrentFileCatalog([
    { path: 'book.epub', length: 1 }, { path: 'book.epub', length: 2 },
  ]), /duplicate/i);
});

test('isolated transport inspects deselected metadata then selects and streams exactly one book file', async () => {
  await withinWorkspace(async root => {
    const fake = fakeWebTorrentLoader();
    const transport = new LibraryTorrentBookTransport({ loadWebTorrent: fake.load });
    const inspection = await transport.inspect({
      magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, p2pConsent: true,
    });
    assert.equal(inspection.infoHash, INFO_HASH);
    assert.deepEqual(inspection.files, [{ path: 'books/one.txt', size: 13, format: 'txt' }]);
    assert.equal(fake.calls.selects.length, 0);
    assert.equal(fake.calls.adds[0].options.deselect, true);
    assert.equal(fake.calls.clients[0].tracker, false);
    const chunks = [];
    const result = await transport.download({
      infoHash: INFO_HASH,
      selectedFile: 'books/one.txt',
      pieceStorePath: path.join(root, 'pieces.bin'),
      p2pConsent: true,
      onChunk: async chunk => chunks.push(chunk),
    });
    assert.equal(Buffer.concat(chunks).toString(), 'hello torrent');
    assert.deepEqual(result, { bytes: 13, total: 13, pieceVerified: true });
    assert.deepEqual(fake.calls.selects, [{ path: 'books/one.txt', priority: 1 }]);
    assert.equal(fake.calls.adds.every(call => call.options.deselect === true), true);
    assert.equal(fs.existsSync(path.join(root, 'pieces.bin')), false);
    assert.deepEqual(transport.snapshot(), {
      accepting: true, activeCount: 0, inspectCount: 0, downloadCount: 0,
    });
    await transport.shutdown();
  });
});

test('metadata or P2P consent failures never select a file and release every transport owner', async () => {
  const privateFake = fakeWebTorrentLoader({ privateTorrent: true });
  const transport = new LibraryTorrentBookTransport({ loadWebTorrent: privateFake.load });
  await assert.rejects(transport.inspect({ magnet: `magnet:?xt=urn:btih:${INFO_HASH}` }), /consent/i);
  await assert.rejects(transport.inspect({
    magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, p2pConsent: true,
  }), error => error.code === 'LIBRARY_TORRENT_PRIVATE_COORDINATE_UNSUPPORTED');
  assert.equal(privateFake.calls.selects.length, 0);
  assert.equal(transport.snapshot().activeCount, 0);
  await transport.shutdown();
});

test('an inspection ID lets Library retirement cancel metadata work before any Candidate is durable', async () => {
  await withinWorkspace(async root => {
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const torrentTransport = {
      inspect({ signal }) {
        entered();
        return new Promise((resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('cancelled'), {
            code: 'LIBRARY_TORRENT_ABORTED', name: 'AbortError',
          }));
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
      },
      snapshot() { return { activeCount: 0, inspectCount: 0, downloadCount: 0 }; },
    };
    const acquisition = makeAcquisition(root, torrentTransport);
    const surface = new LibraryResourceSurfaceService({
      acquisitionService: acquisition,
      torrentTransport,
      settings: memorySettings(),
      resolver: async () => ['93.184.216.34'],
      requester: async () => { throw new Error('catalog must remain offline'); },
      now: () => new Date(NOW),
    });
    const inspection = surface.inspectTorrent(root, {
      inspectionId: 'inspection-cancel',
      magnet: `magnet:?xt=urn:btih:${INFO_HASH}`,
      p2pConsent: true,
    });
    await started;
    assert.equal(surface.snapshotResources().torrentInspectorCount, 1);
    assert.deepEqual(await surface.cancelTorrentInspect(root, {
      inspectionId: 'inspection-cancel',
    }), { cancelled: true });
    await assert.rejects(inspection, error => error.code === 'LIBRARY_TORRENT_ABORTED');
    assert.equal(surface.snapshotResources().torrentInspectorCount, 0);
    assert.equal(surface.snapshotResources().controllerCount, 0);
    assert.equal(fs.existsSync(path.join(root, '书库', '.resources', 'candidates')), true);
    assert.deepEqual(
      fs.readdirSync(path.join(root, '书库', '.resources', 'candidates')).filter(name => name.endsWith('.json')),
      [],
    );
    await surface.shutdown();
    await acquisition.shutdown();
  });
});

test('resource surface freezes metadata, requires user-owned assertion, and converges one selected file to Inbox', async () => {
  await withinWorkspace(async root => {
    const fake = fakeWebTorrentLoader();
    const transport = new LibraryTorrentBookTransport({ loadWebTorrent: fake.load });
    const acquisition = makeAcquisition(root, transport);
    const surface = new LibraryResourceSurfaceService({
      acquisitionService: acquisition,
      torrentTransport: transport,
      settings: memorySettings(),
      resolver: async () => ['93.184.216.34'],
      requester: async () => { throw new Error('catalog must remain offline'); },
      now: () => new Date(NOW),
      randomId: (() => { let id = 0; return () => `fixture-${++id}`; })(),
    });
    await assert.rejects(surface.inspectTorrent(root, {
      magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, p2pConsent: false,
    }), /P2P/i);
    const projected = await surface.inspectTorrent(root, {
      inspectionId: 'inspection-fixture',
      magnet: `magnet:?xt=urn:btih:${INFO_HASH}`, p2pConsent: true,
    });
    assert.equal(projected.providerId, 'manual-torrent');
    assert.equal(projected.decision.reasonCode, 'USER_ASSERTION_REQUIRED');
    assert.deepEqual(projected.offers[0].selectableFiles, ['books/one.txt']);
    assert.doesNotMatch(JSON.stringify(projected), /magnet:|btih:|0123456789abcdef|tracker|peer/i);
    await assert.rejects(surface.acquireTorrent(root, {
      candidateId: projected.candidateId,
      candidateFingerprint: projected.candidateFingerprint,
      offerId: projected.offers[0].offerId,
      selectedFile: 'books/one.txt',
      intentId: 'intent-one',
      p2pConsent: true,
      rightsConfirmed: false,
    }), /confirm|确认|声明/i);
    const started = await surface.acquireTorrent(root, {
      candidateId: projected.candidateId,
      candidateFingerprint: projected.candidateFingerprint,
      offerId: projected.offers[0].offerId,
      selectedFile: 'books/one.txt',
      intentId: 'intent-one',
      p2pConsent: true,
      rightsConfirmed: true,
    });
    assert.equal(started.decision.outcome, 'pass');
    const done = await waitFor(() => {
      const job = acquisition.listJobs(contract.deriveWorkspaceIdentity(root))[0];
      return job?.state === 'awaiting-import' ? job : null;
    }, 'Torrent awaiting-import');
    assert.deepEqual(done.selectedFiles, ['books/one.txt']);
    assert.equal(done.integrity.pieceVerified, true);
    assert.equal(done.bytes.received, 13);
    const envelope = acquisition.listInbox(contract.deriveWorkspaceIdentity(root), { state: 'pending' });
    assert.equal(envelope.receipts.length, 1);
    assert.equal(fs.readFileSync(envelope.receipts[0].artifact.path, 'utf8'), 'hello torrent');
    const diskJson = fs.readdirSync(path.join(root, '书库', '.resources', 'candidates'))
      .filter(name => name.endsWith('.json'))
      .map(name => fs.readFileSync(path.join(root, '书库', '.resources', 'candidates', name), 'utf8')).join('\n');
    assert.doesNotMatch(diskJson, /magnet:|tracker|peer/i);
    await acquisition.shutdown();
    await surface.shutdown();
    await transport.shutdown();
    assert.equal(surface.snapshotResources().torrentActiveCount, 0);
  });
});

test('pause fsyncs a torrent checkpoint and a new coordinator resumes from durable identity without renderer paths', async () => {
  await withinWorkspace(async root => {
    const inspection = {
      infoHash: INFO_HASH,
      title: 'Restart fixture',
      files: [{ path: 'books/one.txt', size: 6, format: 'txt' }],
    };
    const candidate = torrentCandidateFromInspection(inspection, {
      jurisdiction: 'unspecified', observedAt: NOW, snapshotId: 'restart',
    });
    let release;
    const slow = {
      async download({ signal, onChunk }) {
        await onChunk(Buffer.from('abc'), { received: 3, total: 6 });
        await new Promise((resolve, reject) => {
          release = resolve;
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {
            code: 'LIBRARY_TORRENT_ABORTED', name: 'AbortError',
          })), { once: true });
        });
        return { bytes: 3, total: 6, pieceVerified: true };
      },
    };
    const first = makeAcquisition(root, slow);
    const opened = first.openWorkspace(root);
    const job = rightsJob(root, candidate);
    const durable = first.createJob(opened.workspaceIdentity, job, { candidate });
    const run = first.startTorrent(opened.workspaceIdentity, durable.jobId, {
      expectedRevision: durable.revision, candidate, p2pConsent: true,
    });
    await waitFor(() => first.listJobs(opened.workspaceIdentity)[0]?.bytes.received === 3, 'torrent checkpoint');
    const paused = await first.pause(opened.workspaceIdentity, durable.jobId);
    assert.equal(paused.state, 'paused');
    assert.equal(paused.retryFrom, 'downloading');
    assert.equal(paused.bytes.received, 3);
    await run;
    release?.();

    const completing = {
      async download({ onChunk }) {
        await onChunk(Buffer.from('abcdef'), { received: 6, total: 6 });
        return { bytes: 6, total: 6, pieceVerified: true };
      },
    };
    const second = makeAcquisition(root, completing);
    const reopened = second.openWorkspace(root);
    await second.ensureWorkspaceRecovery(reopened);
    const restartJob = second.listJobs(reopened.workspaceIdentity)[0];
    assert.equal(restartJob.state, 'paused');
    await second.resumeTorrent(reopened.workspaceIdentity, restartJob.jobId, {
      expectedRevision: restartJob.revision, candidate, p2pConsent: true,
    });
    const finished = second.listJobs(reopened.workspaceIdentity)[0];
    assert.equal(finished.state, 'awaiting-import');
    assert.equal(finished.bytes.received, 6);
    assert.equal(fs.readFileSync(finished.finalPath, 'utf8'), 'abcdef');
    await first.shutdown();
    await second.shutdown();
  });
});

test('IPC and renderer expose only narrow consent-bound Torrent commands', async () => {
  const channels = [];
  const bus = { handle(name) { channels.push(name); } };
  registerLibraryResourceSurfaceIpc({
    bus,
    service: {
      snapshot() {}, search() {}, inspectTorrent() {}, acquireTorrent() {},
      cancelTorrentInspect() {},
    },
    currentWorkspace: () => process.cwd(),
    isTrustedSender: () => true,
  });
  assert.equal(channels.includes('library:resourceTorrentInspect'), true);
  assert.equal(channels.includes('library:resourceTorrentCancelInspect'), true);
  assert.equal(channels.includes('library:resourceTorrentAcquire'), true);
  const preload = fs.readFileSync(path.join(process.cwd(), 'preload/bridge.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(process.cwd(), 'renderer/modules/library/resource-surface.js'), 'utf8');
  const markup = fs.readFileSync(path.join(process.cwd(), 'renderer/modules/library/index.js'), 'utf8');
  assert.match(preload, /library:resourceTorrentInspect/);
  assert.match(preload, /library:resourceTorrentCancelInspect/);
  assert.match(renderer, /inspection-\$\{crypto\.randomUUID\(\)\}/);
  assert.match(renderer, /cancelTorrentInspection\(\)/);
  assert.match(renderer, /p2pConsent:\s*true/);
  assert.match(renderer, /rightsConfirmed:\s*true/);
  assert.match(markup, /public DHT|public-DHT/);
  assert.match(markup, /公网 IP/);
  assert.doesNotMatch(preload, /library:torrent(?:OpenWorkspace|Start|Tracker|Peer|Path)/);
});

test('W93F transport has no public tracker injection, queue cap, Base64 or whole-file aggregation', () => {
  const transport = fs.readFileSync(path.join(process.cwd(), 'main/library-torrent-book-transport.js'), 'utf8');
  const service = fs.readFileSync(path.join(process.cwd(), 'main/library-acquisition-service.js'), 'utf8');
  assert.doesNotMatch(transport, /PUBLIC_TRACKERS|opentrackr|leechers-paradise|Buffer\.concat|readFileSync/);
  assert.doesNotMatch(transport, /jobs\.size\s*[>=]|MAX_(?:FILE|QUEUE|BYTES)/);
  assert.match(transport, /deselect:\s*true/);
  assert.match(transport, /file\.select\(1\)/);
  assert.match(service, /pieceVerified:\s*transfer\.pieceVerified === true/);
});
