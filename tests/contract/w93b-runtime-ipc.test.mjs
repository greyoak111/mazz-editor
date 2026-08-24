import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  registerLibraryAcquisitionIpc,
  initializeCurrentLibraryAcquisition,
} = require('../../main/library-acquisition-ipc.js');
const contract = require('../../main/library-resource-contract.js');
const StoreModule = require('../../main/library-acquisition-store.js');
const LibraryAcquisitionStore = StoreModule.LibraryAcquisitionStore || StoreModule;
const { createSingleInstanceOwnerCapability } = StoreModule;
const ServiceModule = require('../../main/library-acquisition-service.js');
const LibraryAcquisitionService = ServiceModule.LibraryAcquisitionService || ServiceModule;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function fixture({ startupReady = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w93b-ipc-'));
  const workspace = path.join(root, 'Workspace');
  const other = path.join(root, 'Other');
  fs.mkdirSync(workspace);
  fs.mkdirSync(other);
  const handlers = new Map();
  const bus = { handle(channel, fn) { assert.equal(handlers.has(channel), false); handlers.set(channel, fn); } };
  const calls = [];
  const opened = Object.freeze({ workspaceIdentity: 'workspace-sha256-' + 'a'.repeat(64), workspaceToken: 'workspace-token-test' });
  const receipt = Object.freeze({
    schema: 'mazz.library-acquisition-inbox/v1', revision: 1, receiptId: 'receipt-one', jobId: 'job-one',
    workspaceIdentity: opened.workspaceIdentity, kind: 'library-asset-ready', state: 'pending',
    artifact: { path: path.join(workspace, '书库', 'book.epub'), sha256: 'b'.repeat(64), size: 42, format: 'epub' },
    createdAt: '2026-08-24T00:00:00.000Z', acknowledgedAt: null,
  });
  const service = {
    openWorkspace(value) { calls.push(['open', value]); return opened; },
    listInbox(selector) {
      calls.push(['list', selector]);
      return { ...opened, receipts: [receipt] };
    },
    async completeInbox(selector, receiptId, commit) {
      calls.push(['complete', selector, receiptId, commit]);
      assert.equal(commit.path, receipt.artifact.path,
        'renderer must round-trip the immutable Store artifact path exactly');
      return {
        receipt: { ...receipt, state: 'acknowledged', revision: 2, acknowledgedAt: '2026-08-24T00:01:00.000Z' },
        job: { jobId: 'job-one', state: 'imported', bookId: commit.bookId },
        idempotent: false,
      };
    },
    async repairOrphanLocks(selector) { calls.push(['repair', selector]); return { removed: [], retained: [] }; },
    async recoverAfterRestart(selector) { calls.push(['recover', selector]); return [{ action: 'PAUSED_AFTER_RESTART' }]; },
    async reconcileWorkspace(selector) { calls.push(['reconcile', selector]); return []; },
    async ensureWorkspaceRecovery(selector, options = {}) {
      calls.push(['ensure', selector]);
      const actions = [];
      if (options.repairOrphanLocks !== false) {
        actions.push({ action: 'LOCK_REPAIR', result: await this.repairOrphanLocks(selector) });
      }
      if (options.recoverAfterRestart !== false) actions.push(...await this.recoverAfterRestart(selector));
      else actions.push(...await this.reconcileWorkspace(selector));
      return { ...opened, actions };
    },
  };
  registerLibraryAcquisitionIpc({
    bus, service, currentWorkspace: () => workspace,
    isTrustedSender: event => event?.trusted === true,
    isStartupReady: () => startupReady,
  });
  return { root, workspace, other, handlers, calls, opened, receipt, service };
}

function cleanup(item) {
  fs.rmSync(item.root, { recursive: true, force: true });
}

const NOW = '2026-08-24T00:00:00.000Z';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function delayedWorkspaceCandidate(bytes) {
  const identifiers = { ia: ['w93b-delayed-workspace'] };
  const workId = contract.deriveWorkId({ identifiers });
  const editionId = contract.deriveEditionId({ identifiers });
  const offer = {
    editionId,
    providerId: 'w93b-runtime-ipc',
    resourceId: 'delayed-workspace-txt',
    format: 'txt',
    transport: 'https',
    size: bytes.length,
    checksum: `sha256:${sha256(bytes)}`,
    infoHash: '',
    sourceUrl: 'https://downloads.example.org/w93b/delayed-workspace.txt',
    acquisitionRef: 'delayed-workspace-txt',
    selectableFiles: [],
  };
  offer.offerId = contract.deriveOfferId(offer);
  return contract.normalizeCandidate({
    schema: contract.CANDIDATE_SCHEMA,
    candidateId: 'candidate-w93b-delayed-workspace',
    work: {
      workId,
      title: 'W93B delayed Workspace',
      authors: ['W93B Runtime'],
      languages: ['en'],
      subjects: [],
      identifiers,
    },
    editions: [{
      editionId,
      title: 'W93B delayed Workspace',
      language: 'en',
      publisher: '',
      publishedAt: '',
      identifiers,
      description: '',
    }],
    offers: [offer],
    rights: {
      status: 'public-domain',
      licenseId: 'w93b-runtime-ipc-fixture',
      rightsStatement: 'Deterministic public-domain IPC recovery fixture',
      jurisdiction: 'US',
      evidenceUrl: 'https://example.org/w93b/runtime-ipc-rights',
      assertedBy: 'w93b-runtime-ipc',
      checkedAt: NOW,
      confidence: 1,
    },
    provenance: [{
      providerId: 'w93b-runtime-ipc',
      resourceId: 'delayed-workspace-txt',
      pageUrl: '',
      observedAt: NOW,
      adapterVersion: 'fixture-v1',
    }],
  });
}

function queuedWorkspaceJob(store, candidate) {
  const offer = candidate.offers[0];
  return {
    schema: contract.JOB_SCHEMA,
    revision: 1,
    jobId: 'job-w93b-delayed-workspace',
    intentId: 'intent-w93b-delayed-workspace',
    idempotencyAliases: [],
    workspaceIdentity: store.workspaceIdentity,
    workspacePath: store.workspacePath,
    candidateId: candidate.candidateId,
    offerId: offer.offerId,
    providerId: offer.providerId,
    transport: offer.transport,
    transportIdentity: contract.deriveTransportIdentity(offer),
    selectedFiles: [],
    rightsStatus: candidate.rights.status,
    rightsReceipt: {
      decision: candidate.rights.status,
      authority: 'source-evidence',
      evidenceRef: 'rights-w93b-delayed-workspace',
      at: NOW,
    },
    state: 'queued',
    retryFrom: null,
    bytes: { received: 0, total: null },
    error: null,
    integrity: { sha256: '', declaredChecksum: '', pieceVerified: false },
    stagingPath: '',
    finalPath: '',
    bookId: '',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

test('list is bound to the current physical Workspace and returns metadata only', async () => {
  const item = fixture();
  try {
    const result = await item.handlers.get('library:acquisitionInboxList')({
      workspacePath: item.workspace.replace(/\\/g, '/').toLocaleLowerCase('en-US'), state: 'pending',
    }, { trusted: true });
    assert.equal(result.workspaceIdentity, item.opened.workspaceIdentity);
    assert.equal(result.workspaceToken, item.opened.workspaceToken);
    assert.equal(result.receipts.length, 1);
    assert.equal(result.receipts[0].artifact.sha256, 'b'.repeat(64));
    assert.equal(Object.hasOwn(result.receipts[0].artifact, 'bytes'), false);
    assert.equal(item.calls.filter(call => call[0] === 'open').length, 1);
    assert.equal(item.calls.filter(call => call[0] === 'ensure').length, 1);
    assert.deepEqual(item.calls.find(call => call[0] === 'list')[1], { ...item.opened, state: 'pending' });
  } finally { cleanup(item); }
});

test('untrusted, arbitrary Workspace, non-pending and extra-field list requests fail before facts escape', async () => {
  const item = fixture();
  try {
    const list = item.handlers.get('library:acquisitionInboxList');
    await assert.rejects(() => list({ workspacePath: item.workspace, state: 'pending' }, {}),
      error => error.code === 'LIBRARY_ACQUISITION_UNTRUSTED_SENDER');
    await assert.rejects(() => list({ workspacePath: item.other, state: 'pending' }, { trusted: true }),
      error => error.code === 'LIBRARY_ACQUISITION_WORKSPACE_MISMATCH');
    await assert.rejects(() => list({ workspacePath: item.workspace, state: 'acknowledged' }, { trusted: true }),
      error => error.code === 'LIBRARY_ACQUISITION_INVALID_IPC');
    await assert.rejects(() => list({ workspacePath: item.workspace, state: 'pending', url: 'https://example.org' }, { trusted: true }),
      error => error.code === 'LIBRARY_ACQUISITION_INVALID_IPC');
    assert.equal(item.calls.some(call => call[0] === 'open'), false);
    assert.equal(item.calls.some(call => call[0] === 'list'), false);
  } finally { cleanup(item); }
});

test('startup hold rejects list and commit before Store open or filesystem work', async () => {
  const item = fixture({ startupReady: false });
  try {
    const list = item.handlers.get('library:acquisitionInboxList');
    const commit = item.handlers.get('library:acquisitionInboxCommit');
    await assert.rejects(() => list({ workspacePath: item.workspace, state: 'pending' }, { trusted: true }),
      error => error.code === 'LIBRARY_ACQUISITION_STARTUP_HOLD');
    await assert.rejects(() => commit({}, { trusted: true }),
      error => error.code === 'LIBRARY_ACQUISITION_STARTUP_HOLD');
    assert.deepEqual(item.calls, []);
  } finally { cleanup(item); }
});

test('commit accepts one exact current capability and cannot carry URL, bytes or alternate Workspace', async () => {
  const item = fixture();
  try {
    const commit = item.handlers.get('library:acquisitionInboxCommit');
    const listed = await item.handlers.get('library:acquisitionInboxList')({
      workspacePath: item.workspace, state: 'pending',
    }, { trusted: true });
    assert.equal(listed.receipts[0].artifact.path, item.receipt.artifact.path);
    const payload = {
      receiptId: listed.receipts[0].receiptId,
      workspaceToken: listed.workspaceToken,
      bookId: 'blob-sha256-' + listed.receipts[0].artifact.sha256,
      workspaceIdentity: listed.workspaceIdentity,
      contentHash: listed.receipts[0].artifact.sha256,
      path: listed.receipts[0].artifact.path,
    };
    const result = await commit(payload, { trusted: true });
    assert.equal(result.receipt.state, 'acknowledged');
    assert.equal(result.job.state, 'imported');
    const call = item.calls.find(entry => entry[0] === 'complete');
    assert.deepEqual(call[1], item.opened);
    assert.equal(call[2], item.receipt.receiptId);
    assert.deepEqual(Object.keys(call[3]).sort(), [
      'bookId', 'contentHash', 'path', 'receiptId', 'workspaceIdentity',
    ]);
    await assert.rejects(() => commit({ ...payload, workspaceToken: 'workspace-token-stale' }, { trusted: true }),
      error => error.code === 'LIBRARY_ACQUISITION_WORKSPACE_MISMATCH');
    await assert.rejects(() => commit({ ...payload, url: 'https://example.org' }, { trusted: true }),
      error => error.code === 'LIBRARY_ACQUISITION_INVALID_IPC');
    await assert.rejects(() => commit({ ...payload, bytes: 'payload' }, { trusted: true }),
      error => error.code === 'LIBRARY_ACQUISITION_INVALID_IPC');
  } finally { cleanup(item); }
});

test('startup repair and restart recovery are awaited, ordered and transport-free', async () => {
  const item = fixture();
  try {
    item.calls.length = 0;
    const result = await initializeCurrentLibraryAcquisition({
      service: item.service,
      currentWorkspace: () => item.workspace,
    });
    assert.equal(result.workspaceIdentity, item.opened.workspaceIdentity);
    assert.deepEqual(item.calls.map(call => call[0]), ['open', 'ensure', 'repair', 'recover']);
    assert.equal(result.actions[0].action, 'LOCK_REPAIR');
    assert.equal(result.actions[1].action, 'PAUSED_AFTER_RESTART');
  } finally { cleanup(item); }
});

test('first IPC exposure of a non-startup Workspace joins one offline recovery flight', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w93b-ipc-delayed-'));
  const workspaceA = path.join(root, 'A');
  const workspaceB = path.join(root, 'B');
  fs.mkdirSync(workspaceA);
  fs.mkdirSync(workspaceB);
  try {
    const payload = Buffer.from('delayed Workspace durable payload', 'utf8');
    const partial = payload.subarray(0, 11);
    const candidate = delayedWorkspaceCandidate(payload);
    const priorStoreA = new LibraryAcquisitionStore({
      workspacePath: workspaceA,
      now: () => NOW,
      recoverOnOpen: false,
    });
    let active = priorStoreA.createJob(queuedWorkspaceJob(priorStoreA, candidate), { candidate });
    const stagingRoot = path.join(priorStoreA.paths.stagingRoot, active.jobId);
    fs.mkdirSync(stagingRoot);
    const stagingPath = path.join(stagingRoot, 'payload.txt.part');
    fs.writeFileSync(stagingPath, partial);
    active = priorStoreA.transitionJob(active.jobId, 'downloading', {
      expectedRevision: active.revision,
      patch: {
        stagingPath,
        bytes: { received: partial.length, total: payload.length },
      },
    });

    let networkCalls = 0;
    let serial = 0;
    const service = new LibraryAcquisitionService({
      storeFactory: options => new LibraryAcquisitionStore({
        ...options,
        now: () => NOW,
        recoverOnOpen: false,
      }),
      httpAcquisition: {
        async download() {
          networkCalls += 1;
          throw new Error('delayed Workspace recovery must remain offline');
        },
      },
      randomId: () => `w93b-ipc-recovery-${++serial}`,
      now: () => NOW,
      singleInstanceOwnerCapability: createSingleInstanceOwnerCapability(),
    });
    const repairCounts = new Map();
    const recoverCounts = new Map();
    const reconcileCounts = new Map();
    const increment = (counts, selector) => {
      const identity = typeof selector === 'string' ? selector : selector.workspaceIdentity;
      counts.set(identity, (counts.get(identity) || 0) + 1);
      return identity;
    };
    const originalRepair = service.repairOrphanLocks.bind(service);
    const originalRecover = service.recoverAfterRestart.bind(service);
    const originalReconcile = service.reconcileWorkspace.bind(service);
    const recoveryGate = deferred();
    let delayWorkspaceA = false;
    service.repairOrphanLocks = async selector => {
      const identity = increment(repairCounts, selector);
      if (delayWorkspaceA && identity === priorStoreA.workspaceIdentity) await recoveryGate.promise;
      return originalRepair(selector);
    };
    service.recoverAfterRestart = async selector => {
      increment(recoverCounts, selector);
      return originalRecover(selector);
    };
    service.reconcileWorkspace = async selector => {
      increment(reconcileCounts, selector);
      return originalReconcile(selector);
    };

    let currentWorkspace = workspaceB;
    const startup = await initializeCurrentLibraryAcquisition({
      service,
      currentWorkspace: () => currentWorkspace,
    });
    assert.equal(startup.actions[0].action, 'LOCK_REPAIR');
    assert.notEqual(startup.workspaceIdentity, priorStoreA.workspaceIdentity);
    assert.equal(repairCounts.get(startup.workspaceIdentity), 1);
    assert.equal(recoverCounts.get(startup.workspaceIdentity), 1);
    assert.equal(reconcileCounts.get(startup.workspaceIdentity), 1);
    assert.equal(service.listJobs(startup.workspaceIdentity).length, 0);

    const handlers = new Map();
    registerLibraryAcquisitionIpc({
      bus: { handle(channel, handler) { handlers.set(channel, handler); } },
      service,
      currentWorkspace: () => currentWorkspace,
      isTrustedSender: event => event?.trusted === true,
      isStartupReady: () => true,
    });
    currentWorkspace = workspaceA;
    delayWorkspaceA = true;
    const list = handlers.get('library:acquisitionInboxList');
    let firstSettled = false;
    let secondSettled = false;
    const request = { workspacePath: workspaceA, state: 'pending' };
    const first = list(request, { trusted: true }).then(value => {
      firstSettled = true;
      return value;
    });
    const second = list(request, { trusted: true }).then(value => {
      secondSettled = true;
      return value;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(repairCounts.get(priorStoreA.workspaceIdentity), 1,
      'concurrent first access started more than one repair flight');
    assert.equal(recoverCounts.get(priorStoreA.workspaceIdentity) || 0, 0,
      'recovery escaped the intentionally held repair boundary');
    assert.equal(firstSettled, false, 'Inbox facts escaped before delayed recovery');
    assert.equal(secondSettled, false, 'concurrent Inbox facts escaped before delayed recovery');

    recoveryGate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(firstResult.receipts, []);
    assert.deepEqual(secondResult.receipts, []);
    assert.equal(firstResult.workspaceIdentity, priorStoreA.workspaceIdentity);
    assert.equal(secondResult.workspaceToken, firstResult.workspaceToken);
    assert.equal(repairCounts.get(priorStoreA.workspaceIdentity), 1);
    assert.equal(recoverCounts.get(priorStoreA.workspaceIdentity), 1);
    assert.equal(reconcileCounts.get(priorStoreA.workspaceIdentity), 1);

    const paused = service.listJobs(priorStoreA.workspaceIdentity)
      .find(job => job.jobId === active.jobId);
    assert.equal(paused.state, 'paused');
    assert.equal(paused.retryFrom, 'downloading');
    assert.equal(paused.error?.code, 'APP_RESTART_RECOVERY');
    assert.equal(paused.bytes.received, partial.length);
    await list(request, { trusted: true });
    assert.equal(repairCounts.get(priorStoreA.workspaceIdentity), 1,
      'a fulfilled Workspace recovery fact was not memoized');
    assert.equal(recoverCounts.get(priorStoreA.workspaceIdentity), 1);
    assert.equal(reconcileCounts.get(priorStoreA.workspaceIdentity), 1);
    assert.equal(networkCalls, 0);
    await service.shutdown();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production wiring replaces transient events with startup and second-stage durability gates', () => {
  const main = fs.readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8');
  const acquisitionIpc = fs.readFileSync(new URL('../../main/library-acquisition-ipc.js', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../../preload/bridge.js', import.meta.url), 'utf8');
  const library = fs.readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');
  assert.match(main, /new LibraryAcquisitionService\s*\(\s*\{/);
  assert.match(main, /resolver:\s*createLibraryAcquisitionResolver\(\)/);
  assert.match(main, /requester:\s*createLibraryAcquisitionRequester\(\)/);
  assert.match(main, /initializeCurrentLibraryAcquisition\s*\(\s*\{/);
  assert.match(main, /app\.whenReady\(\)\.then\(async\s*\(\)\s*=>/);
  assert.match(main, /await\s+initializeCurrentLibraryAcquisition\s*\(/);
  assert.match(main, /isStartupReady:\s*\(\)\s*=>\s*libraryAcquisitionStartupReady/);
  assert.match(acquisitionIpc, /await\s+service\.ensureWorkspaceRecovery\(opened\)/);
  const secondInstance = main.slice(main.indexOf("app.on('second-instance'"), main.indexOf('// ---------- mazz://'));
  assert.match(secondInstance, /if\s*\(!libraryAcquisitionStartupSettled\)\s*\{/);
  assert.match(secondInstance, /pendingOpenFiles\.push\(\.\.\.files\)/);
  assert.ok(main.indexOf('libraryAcquisitionStartupSettled = true;')
    < main.indexOf('wm.createMain()', main.indexOf('app.whenReady().then(async')),
  'startup must settle before the authoritative first window');
  assert.match(main, /senderFrame\s*!==\s*sender\.mainFrame/);
  assert.match(main, /senderUrl\.protocol\s*===\s*'mazz-res:'/);
  assert.match(main, /senderUrl\.pathname\s*===\s*'\/index\.html'/);
  assert.match(main, /new LibraryBrowserAcquisitionBridge\s*\(\s*\{/);
  assert.match(main, /libraryBrowserAcquisition\?\.dispose\?\.\(\)/);
  assert.match(main, /libraryAcquisitionService\.shutdown\(\)/);
  assert.match(main, /app\.on\('will-quit',\s*event\s*=>\s*\{/);
  assert.match(main, /serviceState\.activeCount\s*!==\s*0/);
  const harnessQuit = main.slice(main.indexOf("let harnessQuitReady = false"), main.indexOf('// —— 集成终端'));
  assert.doesNotMatch(harnessQuit, /libraryAcquisitionService\.shutdown|libraryBrowserAcquisition/);
  assert.doesNotMatch(main, /library:download/);
  assert.doesNotMatch(main, /const\s+EBOOK_EXTS\b/);
  assert.doesNotMatch(main, /setSavePath\s*\(\s*dest\s*\)/);
  assert.match(preload, /'library:acquisitionInboxList'/);
  assert.match(preload, /'library:acquisitionInboxCommit'/);
  assert.match(preload, /'library:acquisitionInboxReady'/);
  assert.doesNotMatch(preload, /'library:download'/);
  assert.match(library, /import\s+\{\s*drainAcquisitionInbox\s*\}/);
  assert.match(library, /window\.mazz\.on\('library:acquisitionInboxReady',\s*\(\)\s*=>/);
  assert.match(library, /void\s+repositoryReady\.then\(\(\)\s*=>\s*drainPendingAcquisition/);
  assert.match(library, /void\s+drainPendingAcquisition\(next\)/);
  assert.doesNotMatch(library, /library:download/);
  assert.doesNotMatch(library, /importDownloaded\s*=/);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}
console.log(`\nW93b runtime IPC contract: ${passed}/${tests.length} passed`);
