import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const contract = require('../../main/library-resource-contract');
const source = require('../../main/library-source-registry');
const pack = require('../../main/library-source-pack');
const { LibraryResourceCatalogStore } = require('../../main/library-resource-catalog-store');
const {
  LibraryResourceSurfaceService,
  normalizeConfig,
} = require('../../main/library-resource-surface-service');
const { registerLibraryResourceSurfaceIpc } = require('../../main/library-resource-surface-ipc');

const NOW = '2026-08-25T12:00:00.000Z';

function manualDescriptor() {
  return source.normalizeDescriptor({
    schema: source.DESCRIPTOR_SCHEMA,
    providerId: 'manual-https',
    displayName: 'Manual HTTPS',
    adapterVersion: 'manual-https-v1',
    capabilities: [],
    policy: {
      policyVersion: 'manual-rights-v1', checkedAt: NOW,
      jurisdictions: ['unspecified'], rightsModes: ['unknown'], termsUrl: '', rightsUrl: '',
    },
  }, { now: NOW });
}

function canonicalWorkspace() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w93e-'));
  return fs.realpathSync.native ? fs.realpathSync.native(base) : fs.realpathSync(base);
}

async function withWorkspace(action) {
  const workspace = canonicalWorkspace();
  try { return await action(workspace); }
  finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}

function memorySettings(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get(key, fallback) { return values.has(key) ? structuredClone(values.get(key)) : fallback; },
    set(key, value) { values.set(key, structuredClone(value)); },
  };
}

class FakeAcquisition {
  constructor() {
    this.contexts = new Map();
    this.starts = [];
    this.pauses = [];
    this.cancels = [];
    this.reconciles = [];
  }
  openWorkspace(workspacePath) {
    const canonical = fs.realpathSync.native ? fs.realpathSync.native(workspacePath) : fs.realpathSync(workspacePath);
    const workspaceIdentity = contract.deriveWorkspaceIdentity(canonical);
    if (!this.contexts.has(workspaceIdentity)) {
      this.contexts.set(workspaceIdentity, { workspacePath: canonical, jobs: [], inbox: [] });
    }
    return { workspaceIdentity, workspaceToken: `token-${workspaceIdentity}` };
  }
  async ensureWorkspaceRecovery(opened) { return { ...opened, actions: [] }; }
  listJobs(selector) { return structuredClone(this.contexts.get(selector.workspaceIdentity || selector).jobs); }
  listInbox(selector) {
    const id = selector.workspaceIdentity || selector;
    return { workspaceIdentity: id, workspaceToken: `token-${id}`, receipts: structuredClone(this.contexts.get(id).inbox) };
  }
  createJob(selector, job) {
    this.contexts.get(selector.workspaceIdentity || selector).jobs.push(structuredClone(job));
    return structuredClone(job);
  }
  startHttp(selector, jobId, options) {
    this.starts.push({ selector, jobId, options: structuredClone(options) });
    return Promise.resolve(this.listJobs(selector).find(job => job.jobId === jobId));
  }
  resumeHttp(selector, jobId, options) { return this.startHttp(selector, jobId, options); }
  async pause(selector, jobId) {
    this.pauses.push(jobId);
    const context = this.contexts.get(selector.workspaceIdentity || selector);
    const job = context.jobs.find(item => item.jobId === jobId);
    job.state = 'paused'; job.retryFrom = 'downloading'; job.revision += 1;
    return structuredClone(job);
  }
  async cancel(selector, jobId) {
    this.cancels.push(jobId);
    const context = this.contexts.get(selector.workspaceIdentity || selector);
    const job = context.jobs.find(item => item.jobId === jobId);
    job.state = 'cancelled'; job.revision += 1;
    return structuredClone(job);
  }
  async reconcileWorkspace(selector) { this.reconciles.push(selector); return []; }
}

function response(body, contentType = 'application/atom+xml') {
  return {
    statusCode: 200,
    headers: { 'content-type': contentType },
    body: Readable.from([Buffer.from(body)]),
  };
}

const GUTENBERG_XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">
  <title>Gutenberg fixture</title>
  <link rel="self" href="https://www.gutenberg.org/ebooks/search.opds/?query=pride" />
  <link rel="next" href="https://www.gutenberg.org/ebooks/search.opds/?query=pride&amp;start_index=26" />
  <entry>
    <id>https://www.gutenberg.org/ebooks/1342</id><title>Pride and Prejudice</title>
    <updated>2026-08-01T00:00:00Z</updated><author><name>Jane Austen</name></author>
    <dc:language>en</dc:language>
    <link rel="http://opds-spec.org/acquisition/open-access" href="https://www.gutenberg.org/cache/epub/1342/pg1342.epub" type="application/epub+zip" length="321" />
  </entry>
</feed>`;

function makeSurface(workspace, { settings = memorySettings(), requester, acquisition = new FakeAcquisition(), wakes = [] } = {}) {
  return {
    acquisition,
    service: new LibraryResourceSurfaceService({
      acquisitionService: acquisition,
      settings,
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      requester: requester || (async () => { throw new Error('network must not run'); }),
      productToken: 'MazzEditor/0.2',
      now: () => NOW,
      randomId: (() => { let id = 0; return () => `fixture-${++id}`; })(),
      onChanged: event => wakes.push(event.reason),
    }),
  };
}

test('configuration accepts only contact/jurisdiction/public OPDS and rejects secrets or source privilege claims', () => {
  const config = normalizeConfig({
    contact: 'ops@example.org', jurisdiction: 'US',
    opds: [{
      providerId: 'my-opds', displayName: 'My OPDS', rootUrl: 'https://catalog.example.org/root',
      searchTemplate: 'https://catalog.example.org/search?q={query}', version: '1.2',
    }],
  }, { now: NOW });
  assert.equal(config.opds.length, 1);
  assert.equal(config.opds[0].providerId, 'my-opds');
  assert.throws(() => normalizeConfig({ contact: '', jurisdiction: '', opds: [{
    providerId: 'bad', displayName: 'Bad', rootUrl: 'https://127.0.0.1/root',
    searchTemplate: 'https://127.0.0.1/search?q={query}', version: '1.2',
  }] }), /public|HTTPS|公共/i);
  assert.throws(() => normalizeConfig({ contact: 'ops@example.org', jurisdiction: 'US', opds: [{
    providerId: 'bad', displayName: 'Bad', rootUrl: 'https://example.org/root?token=secret',
    searchTemplate: 'https://example.org/search?q={query}', version: '1.2',
  }] }), /secret|敏感|签名|query/i);
  assert.throws(() => normalizeConfig({ contact: 'ops@example.org', jurisdiction: 'US', opds: [], rightsMode: 'public-domain' }), /严格|未知字段/);
});

test('durable Candidate catalog retains every fingerprint so old Jobs can resume after newer observations', async () => {
  await withWorkspace(async workspace => {
    const store = new LibraryResourceCatalogStore({ workspacePath: workspace, now: () => NOW });
    const first = pack.createManualHttpsCandidate({
      url: 'https://example.org/book.epub', format: 'epub', title: 'Fixture', authors: [], language: 'en',
      observedAt: '2026-08-25T10:00:00.000Z',
    });
    const second = pack.createManualHttpsCandidate({
      url: 'https://example.org/book.epub', format: 'epub', title: 'Fixture', authors: [], language: 'en',
      observedAt: '2026-08-25T11:00:00.000Z',
    });
    const a = store.put(first, manualDescriptor()).record;
    const b = store.put(second, manualDescriptor()).record;
    assert.notEqual(a.candidateFingerprint, b.candidateFingerprint);
    assert.equal(store.list().length, 1, 'UI list projects only latest observation');
    assert.equal(store.get(first.candidateId, a.candidateFingerprint).candidateFingerprint, a.candidateFingerprint);
    assert.equal(store.get(second.candidateId, b.candidateFingerprint).candidateFingerprint, b.candidateFingerprint);
    store.close();
    const reopened = new LibraryResourceCatalogStore({ workspacePath: workspace, now: () => NOW });
    assert.equal(reopened.get(first.candidateId, a.candidateFingerprint).candidate.work.title, 'Fixture');
    assert.equal(reopened.snapshot().recordCount, 2);
    reopened.close();
  });
});

test('Candidate catalog holds on malformed/non-regular facts and never overwrites evidence', async () => {
  await withWorkspace(async workspace => {
    const store = new LibraryResourceCatalogStore({ workspacePath: workspace, now: () => NOW });
    fs.mkdirSync(path.join(store.root, `candidate-record-${'a'.repeat(64)}.json`));
    store._scan();
    assert.equal(store.listCorruptions().length, 1);
    const candidate = pack.createManualHttpsCandidate({
      url: 'https://example.org/a.epub', format: 'epub', title: 'A', authors: [], language: '', observedAt: NOW,
    });
    assert.throws(() => store.put(candidate, manualDescriptor()), /修复|损坏/);
    assert.equal(fs.statSync(path.join(store.root, `candidate-record-${'a'.repeat(64)}.json`)).isDirectory(), true);
    store.close();
  });
});

test('snapshot is offline without contact and projections contain no URL, path, secret or raw error body', async () => {
  await withWorkspace(async workspace => {
    let network = 0;
    const { service } = makeSurface(workspace, { requester: async () => { network += 1; throw new Error('no'); } });
    const snapshot = await service.snapshot(workspace);
    assert.equal(snapshot.contactConfigured, false);
    assert.equal(snapshot.providers[0].configured, false);
    assert.equal(network, 0);
    assert.doesNotMatch(JSON.stringify(snapshot), /sourceUrl|acquisitionRef|artifact\.path|Authorization|Bearer|https:\/\//i);
    await assert.rejects(service.search(workspace, {
      query: 'pride', providers: ['project-gutenberg'], continuations: [],
    }), /contact/);
    await service.shutdown();
    assert.deepEqual(service.snapshotResources(), {
      accepting: false, contextCount: 0, operationCount: 0, backgroundCount: 0,
      controllerCount: 0, timerCount: 0, listenerCount: 0,
      torrentActiveCount: 0, torrentInspectCount: 0, torrentDownloadCount: 0,
      torrentInspectorCount: 0,
    });
  });
});

test('Gutenberg search persists Candidate, exposes explicit continuation and passes only matching US Rights', async () => {
  await withWorkspace(async workspace => {
    const requests = [];
    const settings = memorySettings();
    const { service } = makeSurface(workspace, {
      settings,
      requester: async input => { requests.push(input); return response(GUTENBERG_XML); },
    });
    service.configure({ contact: 'ops@example.org', jurisdiction: 'US', opds: [] });
    const page = await service.search(workspace, {
      query: 'pride', providers: ['project-gutenberg'], continuations: [],
    });
    assert.equal(page.candidates.length, 1);
    assert.equal(page.candidates[0].decision.outcome, 'pass');
    assert.equal(page.candidates[0].rights.status, 'public-domain');
    assert.equal(page.continuations.length, 1);
    assert.equal(requests.length, 1, 'one user action advances one page');
    const snapshot = await service.snapshot(workspace);
    assert.equal(snapshot.candidates.length, 1);
    assert.doesNotMatch(JSON.stringify(snapshot.candidates), /gutenberg\.org|sourceUrl|evidenceUrl/);
    service.configure({ contact: 'ops@example.org', jurisdiction: '', opds: [] });
    const unresolved = await service.snapshot(workspace);
    assert.equal(unresolved.candidates[0].decision.outcome, 'awaiting-rights');
    assert.equal(unresolved.candidates[0].decision.reasonCode, 'JURISDICTION_UNRESOLVED');
    await service.shutdown();
  });
});

test('manual HTTPS stays Rights unknown, creates awaiting-rights Job and never starts transport', async () => {
  await withWorkspace(async workspace => {
    const { service, acquisition } = makeSurface(workspace);
    const candidate = await service.addManual(workspace, {
      url: 'https://example.org/manual.epub', format: 'epub', title: 'Manual', authors: ['Owner'], language: 'en',
    });
    assert.equal(candidate.decision.outcome, 'awaiting-rights');
    const acquired = await service.acquire(workspace, {
      candidateId: candidate.candidateId,
      candidateFingerprint: candidate.candidateFingerprint,
      offerId: candidate.offers[0].offerId,
      intentId: 'intent-manual-one',
    });
    assert.equal(acquired.decision.reasonCode, 'RIGHTS_UNKNOWN');
    assert.equal(acquired.job.state, 'awaiting-rights');
    assert.equal(acquisition.starts.length, 0);
    await service.shutdown();
  });
});

test('passing Candidate creates one durable Job and background HTTP start uses the exact stored snapshot', async () => {
  await withWorkspace(async workspace => {
    const { service, acquisition } = makeSurface(workspace, { requester: async () => response(GUTENBERG_XML) });
    service.configure({ contact: 'ops@example.org', jurisdiction: 'US', opds: [] });
    const page = await service.search(workspace, {
      query: 'pride', providers: ['project-gutenberg'], continuations: [],
    });
    const candidate = page.candidates[0];
    const result = await service.acquire(workspace, {
      candidateId: candidate.candidateId,
      candidateFingerprint: candidate.candidateFingerprint,
      offerId: candidate.offers[0].offerId,
      intentId: 'intent-gutenberg-one',
    });
    assert.equal(result.job.state, 'queued');
    assert.equal(acquisition.starts.length, 1);
    assert.equal(contract.deriveCandidateFingerprint(acquisition.starts[0].options.candidate), candidate.candidateFingerprint);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.snapshotResources().backgroundCount, 0);
    await service.shutdown();
  });
});

test('job actions require exact revision and resume from durable Candidate rather than renderer data', async () => {
  await withWorkspace(async workspace => {
    const { service, acquisition } = makeSurface(workspace, { requester: async () => response(GUTENBERG_XML) });
    service.configure({ contact: 'ops@example.org', jurisdiction: 'US', opds: [] });
    const candidate = (await service.search(workspace, {
      query: 'pride', providers: ['project-gutenberg'], continuations: [],
    })).candidates[0];
    const created = await service.acquire(workspace, {
      candidateId: candidate.candidateId, candidateFingerprint: candidate.candidateFingerprint,
      offerId: candidate.offers[0].offerId, intentId: 'intent-actions',
    });
    await service.action(workspace, { jobId: created.job.jobId, expectedRevision: 1, action: 'pause' });
    await assert.rejects(service.action(workspace, {
      jobId: created.job.jobId, expectedRevision: 1, action: 'resume', candidate: { poisoned: true },
    }), /严格|未知字段/);
    await service.action(workspace, { jobId: created.job.jobId, expectedRevision: 2, action: 'resume' });
    assert.equal(acquisition.starts.length, 2);
    assert.equal(contract.deriveCandidateFingerprint(acquisition.starts[1].options.candidate), candidate.candidateFingerprint);
    await new Promise(resolve => setImmediate(resolve));
    await service.shutdown();
  });
});

test('IPC rejects untrusted/provisional callers and arbitrary Workspace paths before service access', async () => {
  await withWorkspace(async workspace => {
    const other = canonicalWorkspace();
    const handlers = new Map();
    const calls = [];
    const fakeService = {
      async snapshot(value) { calls.push(value); return { ok: true }; },
      async search() {}, configure() {}, async addManual() {}, async acquire() {}, async action() {}, async repair() {},
    };
    registerLibraryResourceSurfaceIpc({
      bus: { handle(channel, fn) { handlers.set(channel, fn); } },
      service: fakeService,
      currentWorkspace: () => workspace,
      isTrustedSender: event => event?.trusted === true,
      isStartupReady: () => true,
    });
    await assert.rejects(handlers.get('library:resourceSnapshot')({ workspacePath: workspace }, { trusted: false }), /trusted/i);
    await assert.rejects(handlers.get('library:resourceSnapshot')({ workspacePath: other }, { trusted: true }), /Workspace/);
    await assert.rejects(handlers.get('library:resourceSnapshot')({ workspacePath: workspace, path: 'C:\\secret' }, { trusted: true }), /严格/);
    assert.deepEqual(await handlers.get('library:resourceSnapshot')({ workspacePath: workspace }, { trusted: true }), { ok: true });
    assert.equal(calls.length, 1);
    fs.rmSync(other, { recursive: true, force: true });
  });
});

test('production wiring exposes only narrow channels and renderer lifecycle aborts requests and ignores wake payloads', () => {
  const preload = fs.readFileSync(path.join(process.cwd(), 'preload/bridge.js'), 'utf8');
  const main = fs.readFileSync(path.join(process.cwd(), 'main/main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(process.cwd(), 'renderer/modules/library/index.js'), 'utf8');
  const surface = fs.readFileSync(path.join(process.cwd(), 'renderer/modules/library/resource-surface.js'), 'utf8');
  for (const channel of [
    'library:resourceSnapshot', 'library:resourceConfigure', 'library:resourceSearch',
    'library:resourceManual', 'library:resourceAcquire', 'library:resourceAction', 'library:resourceRepair',
  ]) assert.match(preload, new RegExp(channel.replace(':', '\\:')));
  assert.match(preload, /library:resourceChanged/);
  assert.match(main, /senderFrame !== sender\.mainFrame/);
  assert.match(main, /__handoffReady === false/);
  assert.match(main, /libraryResourceSurface\.stopAccepting\(\)[\s\S]*libraryAcquisitionService\.shutdown\(\)[\s\S]*libraryResourceSurface\.shutdown\(\)/);
  assert.match(renderer, /library:resourceChanged', \(\) => \{\s*void resourceSurface\.resume\(\)/);
  assert.match(renderer, /handoff-provisional[\s\S]*abortAcquisitionBinding/);
  assert.match(renderer, /resourceSurface\.destroy\(\)/);
  assert.match(surface, /controller\?\.abort\(\)/);
  assert.doesNotMatch(surface, /artifact\.path|sourceUrl|Authorization|Cookie|Bearer/);
});
