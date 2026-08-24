// W93B Browser Download bridge: pre-registration, staging ownership and offline completion.
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const contract = require('../../main/library-resource-contract.js');
const LibraryBrowserAcquisitionBridge = require('../../main/library-browser-acquisition-bridge.js');
const StoreModule = require('../../main/library-acquisition-store.js');
const LibraryAcquisitionStore = StoreModule.LibraryAcquisitionStore || StoreModule;
const LibraryAcquisitionService = require('../../main/library-acquisition-service.js');
const LibraryImportService = require('../../main/library-import-service.js');

const NOW = '2026-08-24T00:00:00.000Z';
const SOURCE_URL = 'https://downloads.example.org/books/bridge.txt';

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function fixtureCandidate(overrides = {}) {
  const identifiers = { gutenberg: ['9302'] };
  const workId = contract.deriveWorkId({ identifiers });
  const editionId = contract.deriveEditionId({ identifiers });
  const offer = {
    editionId,
    providerId: 'browser-fixture',
    resourceId: 'browser-fixture-9302',
    format: 'txt',
    transport: 'https',
    size: null,
    checksum: '',
    infoHash: '',
    sourceUrl: SOURCE_URL,
    acquisitionRef: 'browser-fixture-9302',
    selectableFiles: [],
    ...(overrides.offer || {}),
  };
  offer.offerId = contract.deriveOfferId(offer);
  return {
    schema: contract.CANDIDATE_SCHEMA,
    candidateId: 'candidate-browser-9302',
    work: {
      workId,
      title: 'Browser Fixture',
      authors: ['Fixture'],
      languages: ['en'],
      subjects: [],
      identifiers,
    },
    editions: [{
      editionId,
      title: 'Browser Fixture',
      language: 'en',
      publisher: '',
      publishedAt: '',
      identifiers,
      description: '',
    }],
    offers: [offer],
    rights: {
      status: 'public-domain',
      licenseId: 'fixture-pd',
      rightsStatement: 'Fixture public-domain evidence',
      jurisdiction: 'US',
      evidenceUrl: 'https://example.org/rights/browser-fixture',
      assertedBy: 'browser-fixture',
      checkedAt: NOW,
      confidence: 1,
      ...(overrides.rights || {}),
    },
    provenance: [{
      providerId: 'browser-fixture',
      resourceId: 'browser-fixture-9302',
      pageUrl: '',
      observedAt: NOW,
      adapterVersion: 'fixture-v1',
    }],
  };
}

function fixtureJob(workspace, candidateInput, overrides = {}) {
  const candidate = contract.normalizeCandidate(candidateInput);
  const offer = candidate.offers[0];
  const workspaceIdentity = contract.deriveWorkspaceIdentity(workspace);
  return {
    schema: contract.JOB_SCHEMA,
    jobId: 'job-browser-9302',
    intentId: 'intent-browser-9302',
    revision: 1,
    idempotencyAliases: [],
    workspaceIdentity,
    workspacePath: resolve(workspace),
    candidateId: candidate.candidateId,
    candidateFingerprint: contract.deriveCandidateFingerprint(candidate),
    offerId: offer.offerId,
    providerId: offer.providerId,
    transport: offer.transport,
    transportIdentity: contract.deriveTransportIdentity(offer),
    selectedFiles: [],
    rightsStatus: candidate.rights.status,
    rightsReceipt: {
      decision: candidate.rights.status,
      authority: 'source-evidence',
      evidenceRef: 'browser-fixture-rights',
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
    ...overrides,
  };
}

class FakeAcquisitionService {
  constructor(workspace, candidate, jobOverrides = {}) {
    this.workspace = resolve(workspace);
    this.candidate = contract.normalizeCandidate(candidate);
    this.jobs = [fixtureJob(workspace, this.candidate, jobOverrides)];
    this.prepareCalls = [];
    this.completeCalls = [];
    this.startHttpCalls = 0;
    this.handles = new Map();
    this.serial = 0;
    this.failCompletion = false;
    this.failDurability = false;
    this.durableCompletionReceipts = new WeakMap();
    this.completeGate = null;
    this.unsafeSavePath = '';
  }

  listJobs(workspaceIdentity) {
    assert.equal(workspaceIdentity, this.jobs[0].workspaceIdentity);
    return structuredClone(this.jobs);
  }

  startHttp() {
    this.startHttpCalls++;
    throw new Error('Browser bridge must not replace DownloadItem with HTTP transport');
  }

  getDurableCompletionReceipt(error) {
    return this.durableCompletionReceipts.get(error) || null;
  }

  prepareBrowserDownload(workspaceIdentity, jobId, options) {
    this.prepareCalls.push({ workspaceIdentity, jobId, options });
    const job = this.jobs.find(item => item.jobId === jobId);
    assert.ok(job);
    assert.equal(workspaceIdentity, job.workspaceIdentity);
    assert.equal(options.expectedRevision, job.revision);
    const jobRoot = join(this.workspace, '书库', '.resources', 'staging', job.jobId);
    mkdirSync(jobRoot, { recursive: true });
    const savePath = this.unsafeSavePath || join(jobRoot, 'payload.txt.part');
    if (!this.unsafeSavePath) writeFileSync(savePath, '');
    const handleId = `browser-handle-${++this.serial}`;
    this.handles.set(handleId, job.jobId);
    job.state = 'downloading';
    job.revision += 1;
    job.stagingPath = savePath;
    return { handleId, savePath };
  }

  async completeBrowserDownload(handleId, { state }) {
    this.completeCalls.push({ handleId, state });
    const jobId = this.handles.get(handleId);
    assert.ok(jobId, 'completion must use the short-lived coordinator handle');
    const job = this.jobs.find(item => item.jobId === jobId);
    if (this.completeGate) await this.completeGate.promise;
    this.handles.delete(handleId);
    if (this.failDurability) {
      // Model rename-visible / directory-fsync-failed: a readback may expose
      // the new record, but no successful publisher return exists and thus no
      // internal durable receipt may be minted.
      job.state = 'failed';
      job.retryFrom = 'verifying';
      job.error = { code: 'EIO', message: '持久化失败' };
      job.revision += 1;
      throw Object.assign(new Error('fixture durable transition failure'), { code: 'EIO' });
    }
    if (this.failCompletion) {
      job.state = 'failed';
      job.retryFrom = 'verifying';
      job.error = {
        code: 'LIBRARY_ACQUISITION_INTEGRITY_FAILED',
        message: '资源完整性校验失败',
      };
      job.revision += 1;
      const error = Object.assign(new Error('fixture verification failure'), {
        code: 'LIBRARY_ACQUISITION_INTEGRITY_FAILED',
      });
      this.durableCompletionReceipts.set(error, Object.freeze({
        workspaceIdentity: job.workspaceIdentity,
        jobId: job.jobId,
        intentId: job.intentId,
        candidateId: job.candidateId,
        candidateFingerprint: job.candidateFingerprint,
        offerId: job.offerId,
        revision: job.revision,
        state: job.state,
        retryFrom: job.retryFrom,
        errorCode: job.error.code,
      }));
      throw error;
    }
    if (state === 'completed') {
      job.state = 'awaiting-import';
      job.retryFrom = null;
    } else {
      job.state = 'paused';
      job.retryFrom = 'downloading';
    }
    job.revision += 1;
    return structuredClone(job);
  }
}

class FakeSession extends EventEmitter {
  willDownload(event, item, webContents) {
    this.emit('will-download', event, item, webContents);
  }
}

class FakeDownloadItem extends EventEmitter {
  constructor(url, { failSave = false, cancelError = null } = {}) {
    super();
    this.url = url;
    this.failSave = failSave;
    this.cancelError = cancelError;
    this.savePaths = [];
    this.cancelCalls = 0;
    this.urlCalls = 0;
    this.filenameCalls = 0;
    this.urlChainCalls = 0;
    this.existingPathCalls = 0;
  }

  getURL() { this.urlCalls++; return this.url; }
  getFilename() { this.filenameCalls++; throw new Error('filename is untrusted'); }
  getURLChain() { this.urlChainCalls++; throw new Error('URL chain must stay ephemeral'); }
  getSavePath() { this.existingPathCalls++; throw new Error('DownloadItem path is untrusted'); }
  cancel() {
    this.cancelCalls++;
    if (this.cancelError) throw this.cancelError;
  }
  setSavePath(value) {
    if (this.failSave) throw Object.assign(new Error('save path rejected'), { code: 'EACCES' });
    this.savePaths.push(value);
  }
  done(state) { this.emit('done', {}, state); }
}

function downloadEvent() {
  return {
    preventDefaultCalls: 0,
    preventDefault() { this.preventDefaultCalls++; },
  };
}

function intent(service, candidate, overrides = {}) {
  const job = service.jobs[0];
  return {
    workspaceIdentity: job.workspaceIdentity,
    jobId: job.jobId,
    intentId: job.intentId,
    candidate,
    expectedRevision: job.revision,
    webContentsId: 41,
    ...overrides,
  };
}

async function withFixture(run, options = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'mazz-w93b-browser-'));
  try {
    const candidate = options.candidate || fixtureCandidate();
    const service = new FakeAcquisitionService(workspace, candidate, options.jobOverrides);
    const session = new FakeSession();
    const wakes = [];
    const bridge = new LibraryBrowserAcquisitionBridge({
      acquisitionService: service,
      session,
      onWake: event => wakes.push(event),
      randomId: (() => { let id = 0; return () => `fixture-${++id}`; })(),
    });
    await run({ workspace, candidate, service, session, wakes, bridge });
    if (!bridge.disposed) await bridge.dispose();
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe('W93B Library · Browser Download pre-registration bridge', () => {
  test('unregistered downloads remain entirely system-default and trigger no acquisition or network work', async () => {
    await withFixture(async ({ service, session, bridge }) => {
      const event = downloadEvent();
      const item = new FakeDownloadItem('https://unregistered.example.org/file.pdf');
      session.willDownload(event, item, { id: 41 });
      assert.equal(event.preventDefaultCalls, 0);
      assert.equal(item.cancelCalls, 0);
      assert.deepEqual(item.savePaths, []);
      assert.equal(service.prepareCalls.length, 0);
      assert.equal(service.completeCalls.length, 0);
      assert.equal(service.startHttpCalls, 0);
      assert.deepEqual(bridge.snapshot(), {
        attached: true, disposed: false, pendingIntentCount: 0,
        activeItemCount: 0, pendingCompletionCount: 0,
      });
    });
  });

  test('exact authorized item writes to its captured Job staging file then completes through the core', async () => {
    await withFixture(async ({ candidate, service, session, wakes, bridge }) => {
      const registration = bridge.registerIntent(intent(service, candidate));
      assert.equal(registration.workspaceIdentity, service.jobs[0].workspaceIdentity);
      const event = downloadEvent();
      const item = new FakeDownloadItem(SOURCE_URL);

      // A changing app-global Workspace must be irrelevant: the durable Job
      // Workspace captured at creation is the only selector passed onward.
      service.currentWorkspace = 'Z:/unrelated-current-workspace';
      session.willDownload(event, item, { id: 41 });
      assert.equal(event.preventDefaultCalls, 0);
      assert.equal(item.cancelCalls, 0);
      assert.equal(item.savePaths.length, 1);
      assert.match(item.savePaths[0], /[\\/]书库[\\/]\.resources[\\/]staging[\\/]job-browser-9302[\\/]payload\.txt\.part$/);
      assert.equal(service.prepareCalls.length, 1);
      assert.equal(service.prepareCalls[0].workspaceIdentity, registration.workspaceIdentity);
      assert.equal(service.startHttpCalls, 0);
      assert.equal(item.filenameCalls, 0);
      assert.equal(item.urlChainCalls, 0);
      assert.equal(item.existingPathCalls, 0);

      writeFileSync(item.savePaths[0], 'DownloadItem fixture payload');
      item.done('completed');
      await bridge.whenIdle();
      assert.deepEqual(service.completeCalls, [{ handleId: 'browser-handle-1', state: 'completed' }]);
      assert.equal(service.jobs[0].state, 'awaiting-import');
      assert.equal(bridge.snapshot().activeItemCount, 0);
      assert.ok(wakes.some(eventValue => eventValue.status === 'started'));
      assert.ok(wakes.some(eventValue => eventValue.status === 'ready'));
      for (const wake of wakes) {
        assert.deepEqual(Object.keys(wake).sort(), ['jobId', 'schema', 'status', 'type', 'workspaceIdentity'].sort());
        assert.doesNotMatch(JSON.stringify(wake), /payload|\.part|downloads\.example|sourceUrl|savePath|finalPath/i);
      }
    });
  });

  test('real acquisition core consumes the staged DownloadItem offline and creates a durable pending Inbox', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mazz-w93b-browser-core-'));
    try {
      const candidate = contract.normalizeCandidate(fixtureCandidate());
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW });
      let networkCalls = 0;
      let randomSerial = 0;
      const service = new LibraryAcquisitionService({
        store,
        httpAcquisition: {
          async download() {
            networkCalls++;
            throw new Error('Browser DownloadItem completion must remain offline');
          },
        },
        promoter: new LibraryImportService(),
        now: () => NOW,
        randomId: () => `browser-core-${++randomSerial}`,
      });
      const workspaceHandle = service.openWorkspace(workspace);
      const job = store.createJob(fixtureJob(store.workspacePath, candidate, {
        workspaceIdentity: store.workspaceIdentity,
        workspacePath: store.workspacePath,
      }), { candidate });
      const session = new FakeSession();
      const wakes = [];
      const bridge = new LibraryBrowserAcquisitionBridge({
        acquisitionService: service,
        session,
        onWake: event => wakes.push(event),
      });
      bridge.registerIntent({
        workspaceIdentity: workspaceHandle.workspaceIdentity,
        jobId: job.jobId,
        intentId: job.intentId,
        candidate,
        expectedRevision: job.revision,
        webContentsId: 41,
      });

      const item = new FakeDownloadItem(SOURCE_URL);
      const event = downloadEvent();
      session.willDownload(event, item, { id: 41 });
      assert.equal(item.savePaths.length, 1);
      assert.equal(existsSync(item.savePaths[0]), true);
      const staged = lstatSync(item.savePaths[0]);
      assert.equal(staged.isFile(), true);
      assert.equal(staged.isSymbolicLink(), false);
      writeFileSync(item.savePaths[0], 'real core browser fixture');
      item.done('completed');
      await bridge.whenIdle();

      const waiting = store.getJob(job.jobId);
      assert.equal(waiting.state, 'awaiting-import');
      assert.equal(readFileSync(waiting.finalPath, 'utf8'), 'real core browser fixture');
      assert.equal(store.listInboxReceipts({ state: 'pending' }).length, 1);
      assert.equal(networkCalls, 0);
      assert.equal(event.preventDefaultCalls, 0);
      assert.equal(item.cancelCalls, 0);
      assert.ok(wakes.some(value => value.status === 'ready'));
      await bridge.dispose();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('URL, Offer, WebContents and current durable revision must all match exactly before save-path interception', async () => {
    await withFixture(async ({ candidate, service, session, bridge, wakes }) => {
      bridge.registerIntent(intent(service, candidate));
      const wrongUrl = new FakeDownloadItem(`${SOURCE_URL}#other`);
      const wrongUrlEvent = downloadEvent();
      session.willDownload(wrongUrlEvent, wrongUrl, { id: 41 });
      assert.deepEqual(wrongUrl.savePaths, []);
      assert.equal(wrongUrlEvent.preventDefaultCalls, 0);

      const wrongOwner = new FakeDownloadItem(SOURCE_URL);
      session.willDownload(downloadEvent(), wrongOwner, { id: 99 });
      assert.deepEqual(wrongOwner.savePaths, []);

      service.jobs[0].revision += 1;
      const stale = new FakeDownloadItem(SOURCE_URL);
      const staleEvent = downloadEvent();
      session.willDownload(staleEvent, stale, { id: 41 });
      assert.deepEqual(stale.savePaths, []);
      assert.equal(stale.cancelCalls, 0);
      assert.equal(staleEvent.preventDefaultCalls, 0);
      assert.equal(service.prepareCalls.length, 0);
      assert.equal(bridge.snapshot().pendingIntentCount, 0, 'stale short-lived handle is consumed, never revived later');
      assert.ok(wakes.some(eventValue => eventValue.status === 'stale'));
    });
  });

  test('registration rejects missing Rights receipts, signed URLs, and caller-supplied cookie/header/path capabilities', async () => {
    await withFixture(async ({ candidate, service, bridge }) => {
      service.jobs[0].rightsReceipt = null;
      assert.throws(
        () => bridge.registerIntent(intent(service, candidate)),
        error => error?.code === 'LIBRARY_BROWSER_RIGHTS_REQUIRED',
      );
      service.jobs[0] = fixtureJob(service.workspace, candidate);
      for (const extra of [
        { headers: { Authorization: 'secret' } },
        { cookies: 'session=secret' },
        { filename: 'trusted-by-renderer.txt' },
        { path: join(service.workspace, '书库', 'escape.txt') },
      ]) {
        assert.throws(
          () => bridge.registerIntent({ ...intent(service, candidate), ...extra }),
          error => error?.code === 'LIBRARY_BROWSER_FORBIDDEN_CAPABILITY',
        );
      }

      const signed = fixtureCandidate({ offer: { sourceUrl: `${SOURCE_URL}?token=secret` } });
      assert.throws(
        () => bridge.registerIntent(intent(service, signed)),
        error => error?.code === 'LIBRARY_BROWSER_CANDIDATE_INVALID',
      );
      assert.equal(service.prepareCalls.length, 0);
    });
  });

  test('one DownloadItem is prepared and completed exactly once across duplicate events', async () => {
    await withFixture(async ({ candidate, service, session, bridge }) => {
      const first = bridge.registerIntent(intent(service, candidate));
      const replay = bridge.registerIntent(intent(service, candidate));
      assert.equal(replay.registrationId, first.registrationId, 'exact pre-registration replay is idempotent');
      const item = new FakeDownloadItem(SOURCE_URL);
      const event = downloadEvent();
      session.willDownload(event, item, { id: 41 });
      session.willDownload(event, item, { id: 41 });
      assert.equal(service.prepareCalls.length, 1);
      assert.equal(item.savePaths.length, 1);
      item.done('completed');
      item.done('completed');
      await bridge.whenIdle();
      assert.equal(service.completeCalls.length, 1);
      assert.equal(event.preventDefaultCalls, 0);
      assert.equal(item.cancelCalls, 0);
    });
  });

  test('verification failure remains a durable failed Job and wake events expose only a safe error code', async () => {
    await withFixture(async ({ candidate, service, session, bridge, wakes }) => {
      service.failCompletion = true;
      bridge.registerIntent(intent(service, candidate));
      const item = new FakeDownloadItem(SOURCE_URL);
      session.willDownload(downloadEvent(), item, { id: 41 });
      item.done('completed');
      await bridge.whenIdle();
      assert.equal(service.jobs.length, 1, 'bridge must never delete durable failure facts');
      assert.equal(service.jobs[0].state, 'failed');
      assert.equal(service.jobs[0].retryFrom, 'verifying');
      const failure = wakes.find(eventValue => eventValue.status === 'failed');
      assert.equal(failure.errorCode, 'LIBRARY_ACQUISITION_INTEGRITY_FAILED');
      assert.doesNotMatch(JSON.stringify(failure), /[\\/]书库|downloads\.example|sourceUrl|path/i);
      const firstDispose = bridge.dispose();
      const repeatedDispose = bridge.dispose();
      assert.equal(repeatedDispose, firstDispose, 'every caller observes one authoritative disposal result');
      await firstDispose;
      assert.equal(bridge.dispose(), firstDispose, 'settled disposal remains one authoritative result');
      assert.deepEqual(bridge.snapshot(), {
        attached: false, disposed: true, pendingIntentCount: 0,
        activeItemCount: 0, pendingCompletionCount: 0,
      });
    });
  });

  test('a failed durable transition retains the Browser owner and keeps disposal fail closed', async () => {
    await withFixture(async ({ candidate, service, session, bridge, wakes }) => {
      service.failDurability = true;
      bridge.registerIntent(intent(service, candidate));
      const item = new FakeDownloadItem(SOURCE_URL);
      session.willDownload(downloadEvent(), item, { id: 41 });
      item.done('completed');
      await assert.rejects(bridge.whenIdle(), error => error?.code === 'EIO');
      assert.equal(service.jobs[0].state, 'failed',
        'a visible replacement record is not proof that its directory entry was durably committed');
      const failure = wakes.find(eventValue => eventValue.status === 'failed');
      assert.equal(failure.errorCode, 'EIO');
      const firstDispose = bridge.dispose();
      assert.equal(bridge.dispose(), firstDispose);
      await assert.rejects(firstDispose, error => error?.code === 'EIO');
      assert.deepEqual(bridge.snapshot(), {
        attached: false, disposed: true, pendingIntentCount: 0,
        activeItemCount: 1, pendingCompletionCount: 1,
      });
    });
  });

  test('real Store directory-fsync failure stays an unresolved Browser durability owner even after rename visibility', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mazz-w93b-browser-fsync-'));
    try {
      const candidate = contract.normalizeCandidate(fixtureCandidate({
        offer: { checksum: `sha256:${'0'.repeat(64)}` },
      }));
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW });
      const service = new LibraryAcquisitionService({
        store,
        httpAcquisition: { async download() { throw new Error('Browser completion is offline'); } },
        promoter: new LibraryImportService(),
        now: () => NOW,
        randomId: () => 'browser-fsync-core',
      });
      const workspaceHandle = service.openWorkspace(workspace);
      const job = store.createJob(fixtureJob(store.workspacePath, candidate, {
        workspaceIdentity: store.workspaceIdentity,
        workspacePath: store.workspacePath,
      }), { candidate });
      const originalDirectoryFsync = store._fsyncDirectory.bind(store);
      const directoryFailure = Object.assign(new Error('fixture jobs directory fsync failed'), { code: 'EIO' });
      let jobsDirectoryFsyncsUntilFailure = null;
      store._fsyncDirectory = directory => {
        if (jobsDirectoryFsyncsUntilFailure !== null
          && resolve(directory) === resolve(store.paths.jobsRoot)) {
          jobsDirectoryFsyncsUntilFailure -= 1;
          if (jobsDirectoryFsyncsUntilFailure === 0) {
            jobsDirectoryFsyncsUntilFailure = null;
            throw directoryFailure;
          }
        }
        return originalDirectoryFsync(directory);
      };
      const session = new FakeSession();
      const bridge = new LibraryBrowserAcquisitionBridge({ acquisitionService: service, session });
      bridge.registerIntent({
        workspaceIdentity: workspaceHandle.workspaceIdentity,
        jobId: job.jobId,
        intentId: job.intentId,
        candidate,
        expectedRevision: job.revision,
        webContentsId: 41,
      });
      const item = new FakeDownloadItem(SOURCE_URL);
      session.willDownload(downloadEvent(), item, { id: 41 });
      writeFileSync(item.savePaths[0], 'rename-visible-but-not-directory-durable');
      jobsDirectoryFsyncsUntilFailure = 3;
      item.done('completed');
      await assert.rejects(bridge.whenIdle(), error => error?.code === 'EIO');
      const visible = store.getJob(job.jobId);
      assert.equal(visible.state, 'failed');
      assert.equal(service.getDurableCompletionReceipt(directoryFailure), null);
      const disposal = bridge.dispose();
      await assert.rejects(disposal, error => error?.code === 'EIO');
      assert.deepEqual(bridge.snapshot(), {
        attached: false, disposed: true, pendingIntentCount: 0,
        activeItemCount: 1, pendingCompletionCount: 1,
      });
      assert.equal(service.snapshot().activeCount, 0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('save-path rejection and unsafe coordinator paths are abandoned as interrupted durable handles', async () => {
    await withFixture(async ({ candidate, service, session, bridge }) => {
      bridge.registerIntent(intent(service, candidate));
      const failingItem = new FakeDownloadItem(SOURCE_URL, { failSave: true });
      session.willDownload(downloadEvent(), failingItem, { id: 41 });
      await bridge.whenIdle();
      assert.deepEqual(service.completeCalls, [{ handleId: 'browser-handle-1', state: 'interrupted' }]);
      assert.equal(service.jobs[0].state, 'paused');
      assert.equal(failingItem.cancelCalls, 0);
    });

    await withFixture(async ({ candidate, service, session, bridge }) => {
      service.unsafeSavePath = join(service.workspace, '书库', 'must-not-write.txt');
      bridge.registerIntent(intent(service, candidate));
      const item = new FakeDownloadItem(SOURCE_URL);
      session.willDownload(downloadEvent(), item, { id: 41 });
      await bridge.whenIdle();
      assert.deepEqual(item.savePaths, []);
      assert.deepEqual(service.completeCalls, [{ handleId: 'browser-handle-1', state: 'interrupted' }]);
      assert.equal(service.jobs[0].state, 'paused');
    });
  });

  test('dispose waits for real DownloadItem done and persistent completion before releasing owners', async () => {
    await withFixture(async ({ candidate, service, session, bridge }) => {
      bridge.registerIntent(intent(service, candidate));
      assert.equal(bridge.detach(), true);
      const ignored = new FakeDownloadItem(SOURCE_URL);
      session.willDownload(downloadEvent(), ignored, { id: 41 });
      assert.deepEqual(ignored.savePaths, []);
      assert.equal(service.prepareCalls.length, 0);

      bridge.attach(session);
      const active = new FakeDownloadItem(SOURCE_URL);
      session.willDownload(downloadEvent(), active, { id: 41 });
      assert.equal(bridge.snapshot().activeItemCount, 1);
      service.completeGate = deferred();
      let disposeSettled = false;
      const disposal = bridge.dispose();
      disposal.then(
        () => { disposeSettled = true; },
        () => { disposeSettled = true; },
      );
      assert.equal(bridge.cleanup(), disposal, 'cleanup and dispose share the exact authoritative promise');
      await Promise.resolve();
      assert.equal(disposeSettled, false, 'cancel alone is not the Electron writer-close boundary');
      assert.deepEqual(service.completeCalls, []);
      assert.equal(active.cancelCalls, 1);
      assert.deepEqual(bridge.snapshot(), {
        attached: false, disposed: true, pendingIntentCount: 0,
        activeItemCount: 1, pendingCompletionCount: 0,
      });

      active.done('cancelled');
      await Promise.resolve();
      assert.deepEqual(service.completeCalls, [{ handleId: 'browser-handle-1', state: 'interrupted' }]);
      assert.equal(disposeSettled, false, 'service persistence must settle before disposal can succeed');
      assert.equal(bridge.snapshot().activeItemCount, 1);
      assert.equal(bridge.snapshot().pendingCompletionCount, 1);
      service.completeGate.resolve();
      await disposal;
      assert.equal(service.jobs[0].state, 'paused');
      assert.deepEqual(bridge.snapshot(), {
        attached: false, disposed: true, pendingIntentCount: 0,
        activeItemCount: 0, pendingCompletionCount: 0,
      });
      active.done('completed');
      assert.equal(service.completeCalls.length, 1, 'disposed bridge removed the DownloadItem completion listener');
    });
  });

  test('cancel failure is explicit, retained, and cannot be hidden by repeated disposal', async () => {
    await withFixture(async ({ candidate, service, session, bridge }) => {
      bridge.registerIntent(intent(service, candidate));
      const cancelCause = Object.assign(new Error('fixture cancel refused'), { code: 'ELECTRON_CANCEL_REFUSED' });
      const active = new FakeDownloadItem(SOURCE_URL, { cancelError: cancelCause });
      session.willDownload(downloadEvent(), active, { id: 41 });

      const disposal = bridge.dispose();
      assert.equal(bridge.dispose(), disposal);
      await assert.rejects(
        disposal,
        error => error?.code === 'LIBRARY_BROWSER_CANCEL_FAILED'
          && error?.cause === cancelCause,
      );
      assert.equal(active.cancelCalls, 1, 'one authoritative disposal makes one cancellation request');
      assert.deepEqual(service.completeCalls, [], 'no completion is invented without Electron done');
      assert.deepEqual(bridge.snapshot(), {
        attached: false, disposed: true, pendingIntentCount: 0,
        activeItemCount: 1, pendingCompletionCount: 1,
      });
      assert.equal(bridge.cleanup(), disposal, 'failed cleanup remains the same rejected authority');
    });
  });

  test('module and fake-session lifecycle are offline and never call HTTP replacement, cancel, filename, or URL-chain APIs', async () => {
    await withFixture(async ({ candidate, service, session, bridge }) => {
      bridge.registerIntent(intent(service, candidate));
      const item = new FakeDownloadItem(SOURCE_URL);
      const event = downloadEvent();
      session.willDownload(event, item, { id: 41 });
      item.done('cancelled');
      await bridge.whenIdle();
      assert.deepEqual(service.completeCalls, [{ handleId: 'browser-handle-1', state: 'cancelled' }],
        'ordinary cancellation is not rewritten as a shutdown interruption');
      assert.equal(service.startHttpCalls, 0);
      assert.equal(item.cancelCalls, 0);
      assert.equal(event.preventDefaultCalls, 0);
      assert.equal(item.filenameCalls, 0);
      assert.equal(item.urlChainCalls, 0);
      assert.equal(item.existingPathCalls, 0);
      assert.equal(service.jobs[0].state, 'paused');

      const implementation = LibraryBrowserAcquisitionBridge.prototype._onWillDownload.toString();
      assert.doesNotMatch(
        implementation,
        /acquisitionService\.startHttp|item\.(?:getFilename|getURLChain|getSavePath|cancel)\s*\(|event\.preventDefault\s*\(|\b(?:cookie|headers?)\s*:/i,
      );
    });
  });
});
