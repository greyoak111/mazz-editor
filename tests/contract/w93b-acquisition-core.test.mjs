// W93B main-process acquisition core: offline streaming, restart truth and Inbox saga.
import {
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import * as nativeFs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const contract = require('../../main/library-resource-contract.js');
const StoreModule = require('../../main/library-acquisition-store.js');
const LibraryAcquisitionStore = StoreModule.LibraryAcquisitionStore || StoreModule;
const LibraryHttpAcquisition = require('../../main/library-http-acquisition.js');
const LibraryAcquisitionService = require('../../main/library-acquisition-service.js');
const LibraryImportService = require('../../main/library-import-service.js');
const { verifyPayload } = LibraryAcquisitionService;
const JSZip = require('jszip');

const NOW = '2026-08-24T00:00:00.000Z';

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureCandidate(payload, overrides = {}) {
  const workIdentifiers = { gutenberg: ['9001'] };
  const editionIdentifiers = { gutenberg: ['9001'] };
  const workId = contract.deriveWorkId({ identifiers: workIdentifiers });
  const editionId = contract.deriveEditionId({ identifiers: editionIdentifiers });
  const offer = {
    editionId,
    providerId: 'fixture-source',
    resourceId: 'fixture-9001-txt',
    format: 'txt',
    transport: 'https',
    size: payload.length,
    checksum: `sha256:${sha(payload)}`,
    infoHash: '',
    sourceUrl: 'https://downloads.example.org/books/9001.txt',
    acquisitionRef: 'fixture-9001-txt',
    selectableFiles: [],
    ...(overrides.offer || {}),
  };
  offer.offerId = contract.deriveOfferId(offer);
  return {
    schema: contract.CANDIDATE_SCHEMA,
    candidateId: overrides.candidateId || 'candidate-fixture-9001',
    work: {
      workId,
      title: 'Fixture Book',
      authors: ['Fixture Author'],
      languages: ['en'],
      subjects: [],
      identifiers: workIdentifiers,
    },
    editions: [{
      editionId,
      title: 'Fixture Book',
      language: 'en',
      publisher: '',
      publishedAt: '',
      identifiers: editionIdentifiers,
      description: '',
    }],
    offers: [offer],
    rights: {
      status: 'public-domain',
      licenseId: 'fixture-license',
      rightsStatement: 'Fixture public-domain evidence',
      jurisdiction: 'US',
      evidenceUrl: 'https://example.org/rights/fixture',
      assertedBy: 'fixture-adapter',
      checkedAt: NOW,
      confidence: 1,
    },
    provenance: [{
      providerId: 'fixture-source',
      resourceId: 'fixture-9001',
      pageUrl: overrides.pageUrl ?? '',
      observedAt: NOW,
      adapterVersion: 'fixture-v1',
    }],
  };
}

function fixtureJob(store, candidateInput, overrides = {}) {
  const candidate = contract.normalizeCandidate(candidateInput);
  const offer = candidate.offers[0];
  return {
    schema: contract.JOB_SCHEMA,
    revision: 1,
    jobId: overrides.jobId || 'job-fixture-9001',
    intentId: overrides.intentId || 'intent-fixture-9001',
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
      decision: 'public-domain',
      authority: 'source-evidence',
      evidenceRef: 'fixture-rights-receipt',
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

function fixturePromoter() {
  return {
    async materializePath({ workspace, sourcePath, name }) {
      const safeName = basename(name).replace(/[^A-Za-z0-9._ -]/g, '_');
      const finalPath = join(workspace, '书库', safeName);
      linkSync(sourcePath, finalPath);
      const bytes = readFileSync(finalPath);
      return {
        finalPath,
        path: finalPath,
        sha256: sha(bytes),
        sourceHash: sha(bytes),
        size: bytes.length,
        created: true,
        reused: false,
      };
    },
  };
}

function publicResolver(counter = null) {
  return async hostname => {
    if (counter) counter.calls += 1;
    assert.equal(typeof hostname, 'string');
    return [{ address: '93.184.216.34', family: 4 }];
  };
}

function response(statusCode, headers, chunks) {
  return { statusCode, headers, body: Readable.from(chunks) };
}

function serviceFixture(workspace, candidate, requester, extra = {}) {
  const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW });
  const http = new LibraryHttpAcquisition({
    requester,
    resolver: extra.resolver || publicResolver(extra.dnsCounter),
    now: () => NOW,
    fsImpl: extra.fsImpl,
  });
  const service = new LibraryAcquisitionService({
    store,
    httpAcquisition: http,
    promoter: extra.promoter || new LibraryImportService(),
    now: () => NOW,
    resourceLedger: extra.resourceLedger || null,
    singleInstanceOwnerCapability: extra.singleInstanceOwnerCapability || null,
    onInboxReady: extra.onInboxReady || null,
    fsImpl: extra.fsImpl,
  });
  const workspaceHandle = service.openWorkspace(workspace);
  const job = store.createJob(fixtureJob(store, candidate, extra.jobOverrides), { candidate });
  return { store, service, workspaceHandle, job };
}

async function withWorkspace(run) {
  const workspace = mkdtempSync(join(tmpdir(), 'mazz-w93b-core-'));
  try { await run(workspace); }
  finally { rmSync(workspace, { recursive: true, force: true }); }
}

async function eventually(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5));
  }
  throw new Error('fixture condition was not reached');
}

function observedFs({ payloadPath, metadataPath = '', events = [], onPayloadFsync = null, onPayloadClose = null } = {}) {
  const descriptors = new Map();
  const payload = payloadPath ? resolve(payloadPath) : '';
  const metadata = metadataPath ? resolve(metadataPath) : '';
  const implementation = {
    ...nativeFs,
    openSync(target, ...args) {
      const fd = nativeFs.openSync(target, ...args);
      descriptors.set(fd, resolve(String(target)));
      return fd;
    },
    createWriteStream(target, options) {
      const streamTarget = resolve(String(target));
      const stream = nativeFs.createWriteStream(target, options);
      let streamFd = Number.isInteger(options?.fd) ? options.fd : null;
      if (streamFd !== null) descriptors.set(streamFd, resolve(String(target)));
      stream.once('open', fd => {
        streamFd = fd;
        descriptors.set(fd, resolve(String(target)));
      });
      stream.once('close', () => {
        if (streamTarget === payload) events.push('payload-stream-close');
        descriptors.delete(streamFd);
      });
      return stream;
    },
    fsyncSync(fd) {
      const target = descriptors.get(fd) || '';
      if (target === payload) {
        events.push('payload-fsync');
        onPayloadFsync?.({ fd, target, events });
      }
      return nativeFs.fsyncSync(fd);
    },
    closeSync(fd) {
      const target = descriptors.get(fd) || '';
      let result;
      try { result = nativeFs.closeSync(fd); }
      finally { descriptors.delete(fd); }
      if (target === payload) {
        events.push('payload-close');
        onPayloadClose?.({ fd, target, events });
      }
      return result;
    },
    renameSync(from, to) {
      const result = nativeFs.renameSync(from, to);
      if (metadata && resolve(String(to)) === metadata) events.push('metadata-publish');
      return result;
    },
  };
  return implementation;
}

function fileReadGateFs(readOrdinal = 1) {
  let target = '';
  let intercepted = false;
  let matchingReads = 0;
  let announceStart;
  let releaseHash;
  const started = new Promise(resolveStart => { announceStart = resolveStart; });
  const released = new Promise(resolveRelease => { releaseHash = resolveRelease; });
  return {
    fsImpl: {
      ...nativeFs,
      createReadStream(filePath, options) {
        if (target && resolve(String(filePath)) === target) matchingReads += 1;
        if (target && !intercepted && resolve(String(filePath)) === target
          && matchingReads === readOrdinal) {
          intercepted = true;
          const output = new PassThrough();
          announceStart();
          released.then(() => {
            const source = nativeFs.createReadStream(filePath, options);
            source.on('error', error => output.destroy(error));
            source.pipe(output);
          });
          return output;
        }
        return nativeFs.createReadStream(filePath, options);
      },
    },
    started,
    setTarget(payloadPath) { target = resolve(payloadPath); },
    release() { releaseHash(); },
  };
}

function writerFinalGateFs() {
  let target = '';
  let intercepted = false;
  let announceStart;
  let releaseFinal;
  const started = new Promise(resolveStart => { announceStart = resolveStart; });
  const released = new Promise(resolveRelease => { releaseFinal = resolveRelease; });
  return {
    fsImpl: {
      ...nativeFs,
      createWriteStream(filePath, options) {
        const stream = nativeFs.createWriteStream(filePath, options);
        if (target && !intercepted && resolve(String(filePath)) === target) {
          intercepted = true;
          const originalEnd = stream.end.bind(stream);
          stream.end = (...args) => {
            announceStart();
            released.then(
              () => originalEnd(...args),
              error => stream.destroy(error),
            );
            return stream;
          };
        }
        return stream;
      },
    },
    started,
    setTarget(payloadPath) { target = resolve(payloadPath); },
    release() { releaseFinal(); },
  };
}

describe('W93B Library acquisition core · offline streaming and durable convergence', () => {
  test('optional provenance pageUrl remains empty while any supplied value stays strict', () => {
    const normalized = contract.normalizeCandidate(fixtureCandidate(Buffer.from('book')));
    assert.equal(normalized.provenance[0].pageUrl, '');
    assert.throws(
      () => contract.normalizeCandidate(fixtureCandidate(Buffer.from('book'), { pageUrl: 'http://example.org/book' })),
      /HTTPS/i,
    );
    assert.throws(
      () => contract.normalizeCandidate(fixtureCandidate(Buffer.from('book'), { pageUrl: 'https://example.org/book?token=secret' })),
      /敏感 query|secret/i,
    );
  });

  test('explicit start streams into the bound Workspace then creates pending Inbox and converges exactly once', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('streamed fixture text');
      const candidate = fixtureCandidate(payload);
      const requestCalls = [];
      const requester = async request => {
        requestCalls.push(request);
        return response(200, {
          'content-length': String(payload.length),
          etag: '"fixture-v1"',
        }, [payload.subarray(0, 5), payload.subarray(5, 12), payload.subarray(12)]);
      };
      const { service, workspaceHandle, job } = serviceFixture(workspace, candidate, requester);
      assert.equal(requestCalls.length, 0, 'construct/open/list stays offline');
      assert.equal(service.listJobs(workspaceHandle.workspaceIdentity).length, 1);
      assert.equal(service.listInbox({ workspacePath: workspace }).receipts.length, 0);
      assert.equal(requestCalls.length, 0);

      const waiting = await service.startHttp(workspaceHandle.workspaceIdentity, job.jobId, {
        candidate,
        expectedRevision: job.revision,
      });
      assert.equal(waiting.state, 'awaiting-import');
      assert.equal(waiting.bytes.received, payload.length);
      assert.equal(waiting.integrity.sha256, sha(payload));
      assert.match(basename(waiting.finalPath), new RegExp(sha(payload)));
      assert.equal(readFileSync(waiting.finalPath, 'utf8'), payload.toString('utf8'));
      assert.equal(requestCalls.length, 1);
      assert.equal(requestCalls[0].address, '93.184.216.34', 'requester receives the reviewed pinned address');

      const envelope = service.listInbox({ workspacePath: workspace, state: 'pending' });
      assert.equal(envelope.workspaceIdentity, workspaceHandle.workspaceIdentity);
      assert.equal(envelope.receipts.length, 1);
      const receipt = envelope.receipts[0];
      const commit = {
        bookId: 'book-fixture-9001',
        workspaceIdentity: envelope.workspaceIdentity,
        contentHash: receipt.artifact.sha256,
        path: receipt.artifact.path,
      };
      const completed = await service.commitShelfReceipt(receipt.receiptId, commit, {
        workspaceToken: envelope.workspaceToken,
      });
      assert.equal(completed.receipt.state, 'acknowledged');
      assert.equal(completed.job.state, 'imported');
      const replay = await service.commitShelfReceipt(receipt.receiptId, commit, {
        workspaceToken: envelope.workspaceToken,
      });
      assert.equal(replay.idempotent, true);
      assert.equal(replay.job.bookId, completed.job.bookId);
    });
  });

  test('service binds verified hash, size, and physical source identity into formal promotion', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('promotion expectation fixture');
      const candidate = fixtureCandidate(payload);
      const delegate = new LibraryImportService();
      let observed = null;
      const fixture = serviceFixture(workspace, candidate, async () => response(200, {
        'content-length': String(payload.length), etag: '"promotion-bind-v1"',
      }, [payload]), {
        promoter: {
          materializePath(options) {
            observed = options;
            return delegate.materializePath(options);
          },
        },
      });
      const waiting = await fixture.service.startHttp(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      assert.equal(waiting.state, 'awaiting-import');
      assert.equal(observed.expectedSha256, sha(payload));
      assert.equal(observed.expectedSize, payload.length);
      assert.match(observed.expectedIdentity.dev, /^.+$/);
      assert.match(observed.expectedIdentity.ino, /^.+$/);
      assert.equal(observed.expectedIdentity.size, payload.length);
      assert(Number.isFinite(observed.expectedIdentity.ctimeMs));
    });
  });

  test('pre-registered Browser completion imports from staging without transport and Inbox wakeup remains a hint', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('browser-owned fixture text');
      const candidate = fixtureCandidate(payload);
      let requests = 0;
      const wakeups = [];
      const fixture = serviceFixture(workspace, candidate, async () => {
        requests += 1;
        throw new Error('Browser completion must never start HTTP');
      }, {
        onInboxReady(event) {
          wakeups.push(event);
          return Promise.reject(new Error('closed renderer window'));
        },
      });
      const prepared = fixture.service.prepareBrowserDownload(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      assert.equal(requests, 0);
      assert.match(resolve(prepared.savePath), /[\\/]\.resources[\\/]staging[\\/]/);
      assert.equal(statSync(prepared.savePath).isFile(), true);
      assert.equal(statSync(prepared.savePath).size, 0);
      assert.equal(fixture.store.getJob(fixture.job.jobId).state, 'downloading');
      assert.throws(
        () => fixture.service.completeBrowserDownload(prepared.handleId, {
          state: 'completed', candidate, expectedRevision: prepared.revision + 1,
        }),
        error => error?.code === 'LIBRARY_ACQUISITION_REVISION_CONFLICT',
      );
      assert.equal(fixture.service.getBrowserDownload(prepared.handleId).state, 'downloading', 'bad CAS does not consume the handle');

      writeFileSync(prepared.savePath, payload);
      const progress = fixture.service.updateBrowserDownload(prepared.handleId, {
        expectedRevision: prepared.revision,
        total: payload.length,
      });
      assert.equal(fixture.service.getBrowserDownload(prepared.handleId).revision, progress.revision);
      const waiting = await fixture.service.completeBrowserDownload(prepared.handleId, { state: 'completed' });
      assert.equal(waiting.state, 'awaiting-import');
      assert.equal(waiting.bytes.received, payload.length);
      assert.equal(readFileSync(waiting.finalPath, 'utf8'), payload.toString('utf8'));
      assert.equal(requests, 0);
      assert.deepEqual(wakeups, [{
        workspaceIdentity: fixture.workspaceHandle.workspaceIdentity,
        receiptId: fixture.store.listInboxReceipts({ state: 'pending' })[0].receiptId,
      }]);
      assert.deepEqual(Object.keys(wakeups[0]).sort(), ['receiptId', 'workspaceIdentity']);
      assert.equal(fixture.service.snapshot().browserActiveCount, 0);
      assert.throws(
        () => fixture.service.getBrowserDownload(prepared.handleId),
        error => error?.code === 'LIBRARY_ACQUISITION_BROWSER_HANDLE_NOT_FOUND',
      );
    });
  });

  test('Browser interruption persists exact staging progress and explicit retry starts from a clean owner', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('browser interruption fixture');
      const candidate = fixtureCandidate(payload);
      let requests = 0;
      const fixture = serviceFixture(workspace, candidate, async () => {
        requests += 1;
        throw new Error('Browser path must remain offline');
      });
      const prepared = fixture.service.prepareBrowserDownload(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      const partial = payload.subarray(0, 8);
      writeFileSync(prepared.savePath, partial);
      const paused = await fixture.service.completeBrowserDownload(prepared.handleId, { state: 'interrupted' });
      assert.equal(paused.state, 'paused');
      assert.equal(paused.retryFrom, 'downloading');
      assert.deepEqual(paused.bytes, { received: partial.length, total: null });
      assert.equal(readFileSync(prepared.savePath, 'utf8'), partial.toString('utf8'));
      assert.equal(fixture.store.listInboxReceipts().length, 0);
      assert.equal(requests, 0);

      const restarted = fixture.service.prepareBrowserDownload(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: paused.revision },
      );
      const restartedStat = statSync(restarted.savePath);
      assert.equal(restartedStat.isFile(), true);
      assert.equal(restartedStat.size, 0, 'an explicit Browser retry replaces unvalidated prior bytes with a fresh owned leaf');
      assert.equal(restartedStat.nlink, 1);
      const cancelled = await fixture.service.completeBrowserDownload(restarted.handleId, { state: 'cancelled' });
      assert.equal(cancelled.state, 'cancelled');
      assert.equal(existsSync(join(workspace, '书库', '.resources', 'staging', fixture.job.jobId)), false);
      assert.equal(requests, 0);
    });
  });

  test('Candidate/revision/rights preconditions reject before DNS or requester', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('precondition fixture');
      const candidate = fixtureCandidate(payload);
      const dnsCounter = { calls: 0 };
      let requests = 0;
      const fixture = serviceFixture(workspace, candidate, async () => {
        requests += 1;
        return response(200, { 'content-length': String(payload.length) }, [payload]);
      }, { dnsCounter });
      assert.throws(
        () => fixture.service.startHttp(fixture.workspaceHandle.workspaceIdentity, fixture.job.jobId, {
          candidate,
          expectedRevision: fixture.job.revision + 1,
        }),
        error => error?.code === 'LIBRARY_ACQUISITION_REVISION_CONFLICT',
      );
      const changed = fixtureCandidate(payload, { candidateId: 'candidate-other-snapshot' });
      assert.throws(
        () => fixture.service.startHttp(fixture.workspaceHandle.workspaceIdentity, fixture.job.jobId, {
          candidate: changed,
          expectedRevision: fixture.job.revision,
        }),
        error => error?.code === 'LIBRARY_ACQUISITION_CANDIDATE_MISMATCH',
      );
      assert.equal(dnsCounter.calls, 0);
      assert.equal(requests, 0);
    });
  });

  test('mixed/private DNS and a private redirect hop fail closed before that socket', async () => {
    await withWorkspace(async workspace => {
      assert.equal(LibraryHttpAcquisition.isUnsafeAddress('::ffff:127.0.0.1'), true);
      assert.equal(LibraryHttpAcquisition.isUnsafeAddress('2001:db8::1'), true);
      assert.equal(LibraryHttpAcquisition.isUnsafeAddress('2606:4700:4700::1111'), false);
      const staging = join(workspace, '书库', '.resources', 'staging', 'job-direct');
      mkdirSync(staging, { recursive: true });
      let requested = 0;
      const transport = new LibraryHttpAcquisition({
        resolver: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
        requester: async () => {
          requested += 1;
          return response(200, { 'content-length': '1' }, [Buffer.from('x')]);
        },
        now: () => NOW,
      });
      const job = {
        jobId: 'job-direct', offerId: 'offer-direct',
        candidateFingerprint: `candidate-sha256-${'a'.repeat(64)}`,
        bytes: { received: 0, total: null },
      };
      const offer = { transport: 'https', sourceUrl: 'https://public.example.org/book.txt' };
      await assert.rejects(transport.download({
        job, offer, stagingRoot: join(workspace, '书库', '.resources', 'staging'),
        payloadPath: join(staging, 'payload.txt.part'), metadataPath: join(staging, 'transfer.json'),
      }), error => error?.code === 'LIBRARY_HTTP_SSRF_BLOCKED');
      assert.equal(requested, 0);

      let resolverCalls = 0;
      requested = 0;
      const redirecting = new LibraryHttpAcquisition({
        resolver: async hostname => {
          resolverCalls += 1;
          return hostname === 'private.example.org'
            ? [{ address: '10.0.0.9', family: 4 }]
            : [{ address: '93.184.216.34', family: 4 }];
        },
        requester: async () => {
          requested += 1;
          return response(302, { location: 'https://private.example.org/book.txt' }, []);
        },
        now: () => NOW,
      });
      await assert.rejects(redirecting.download({
        job, offer, stagingRoot: join(workspace, '书库', '.resources', 'staging'),
        payloadPath: join(staging, 'payload.txt.part'), metadataPath: join(staging, 'transfer.json'),
      }), error => error?.code === 'LIBRARY_HTTP_SSRF_BLOCKED');
      assert.equal(resolverCalls, 2);
      assert.equal(requested, 1, 'private redirect target never reaches requester');

      requested = 0;
      const signedRedirect = new LibraryHttpAcquisition({
        resolver: publicResolver(),
        requester: async () => {
          requested += 1;
          return response(302, { location: 'https://public.example.org/book.txt?signature=secret' }, []);
        },
        now: () => NOW,
      });
      await assert.rejects(signedRedirect.download({
        job, offer, stagingRoot: join(workspace, '书库', '.resources', 'staging'),
        payloadPath: join(staging, 'payload.txt.part'), metadataPath: join(staging, 'transfer.json'),
      }), error => error?.code === 'LIBRARY_HTTP_URL_REJECTED');
      assert.equal(requested, 1, 'signed redirect is rejected before its target DNS/socket');
    });
  });

  test('IANA non-global IPv6 special ranges fail closed without rejecting adjacent global assignments', () => {
    const blocked = [
      '2001::1',
      '2001:2::1',
      '2001:10::1',
      '2001:20::1',
      '3fff::1',
      '5f00::1',
      '2002::1',
      '100:0:0:1::1',
    ];
    for (const address of blocked) {
      assert.equal(LibraryHttpAcquisition.isUnsafeAddress(address), true, address);
      assert.throws(
        () => LibraryHttpAcquisition.normalizeResolvedAddresses([
          { address: '93.184.216.34', family: 4 },
          { address, family: 6 },
        ]),
        error => error?.code === 'LIBRARY_HTTP_SSRF_BLOCKED',
        `mixed resolver answer containing ${address}`,
      );
    }
    for (const address of ['2001:1::1', '2001:3::1', '3fff:1000::1', '2606:4700:4700::1111']) {
      assert.equal(LibraryHttpAcquisition.isUnsafeAddress(address), false, address);
    }
  });

  test('cross-origin redirect strips opaque resume headers and restarts without joining prior bytes', async () => {
    await withWorkspace(async workspace => {
      const root = join(workspace, '书库', '.resources', 'staging');
      const staging = join(root, 'job-cross-origin');
      mkdirSync(staging, { recursive: true });
      const payloadPath = join(staging, 'payload.txt.part');
      const metadataPath = join(staging, 'transfer.json');
      const requests = [];
      let call = 0;
      const transport = new LibraryHttpAcquisition({
        resolver: publicResolver(),
        requester: async request => {
          requests.push(request);
          call += 1;
          if (call === 1) {
            return {
              statusCode: 200,
              headers: { 'content-length': '6', etag: '"origin-a-v1"' },
              body: Readable.from((async function* () {
                yield Buffer.from('old');
                throw Object.assign(new Error('fixture disconnect'), { code: 'ECONNRESET' });
              })()),
            };
          }
          if (call === 2) {
            return response(302, { location: 'https://cdn-b.example.org/final.txt' }, []);
          }
          return response(200, {
            'content-length': '6', etag: '"origin-b-v1"',
          }, [Buffer.from('NEW123')]);
        },
        now: () => NOW,
      });
      const baseJob = {
        jobId: 'job-cross-origin', offerId: 'offer-cross-origin',
        candidateFingerprint: `candidate-sha256-${'e'.repeat(64)}`,
        bytes: { received: 0, total: null },
      };
      const offer = { transport: 'https', sourceUrl: 'https://origin-a.example.org/book.txt' };
      await assert.rejects(transport.download({
        job: baseJob, offer, stagingRoot: root, payloadPath, metadataPath,
      }));
      const result = await transport.download({
        job: { ...baseJob, bytes: { received: 3, total: 6 } },
        offer, stagingRoot: root, payloadPath, metadataPath,
      });
      assert.equal(requests[1].url, 'https://origin-a.example.org/book.txt');
      assert.equal(requests[1].headers.Range, 'bytes=3-');
      assert.equal(requests[1].headers['If-Range'], '"origin-a-v1"');
      assert.equal(requests[2].url, 'https://cdn-b.example.org/final.txt');
      assert.equal(requests[2].headers.Range, undefined);
      assert.equal(requests[2].headers['If-Range'], undefined);
      assert.equal(requests[2].headers['Accept-Encoding'], 'identity');
      assert.equal(readFileSync(payloadPath, 'utf8'), 'NEW123');
      assert.equal(result.bytes, 6);
      assert.equal(result.sha256, sha(Buffer.from('NEW123')));
      assert.equal(JSON.parse(readFileSync(metadataPath, 'utf8')).validator, null,
        'a redirected-origin validator is never persisted for replay to the offer origin');
    });
  });

  test('same-origin redirect aliases never persist validators or join bytes after target drift', async () => {
    await withWorkspace(async workspace => {
      const root = join(workspace, '书库', '.resources', 'staging');
      const staging = join(root, 'job-same-origin-redirect');
      mkdirSync(staging, { recursive: true });
      const payloadPath = join(staging, 'payload.txt.part');
      const metadataPath = join(staging, 'transfer.json');
      const requests = [];
      let call = 0;
      const transport = new LibraryHttpAcquisition({
        resolver: publicResolver(),
        requester: async request => {
          requests.push(request);
          call += 1;
          if (call === 1) {
            return response(302, { location: '/book.txt' }, []);
          }
          if (call === 2) {
            return {
              statusCode: 200,
              headers: { 'content-length': '4', etag: '"same"' },
              body: Readable.from((async function* () {
                yield Buffer.from('AB');
                throw Object.assign(new Error('fixture disconnect'), { code: 'ECONNRESET' });
              })()),
            };
          }
          if (call === 3) {
            // The redirect alias now serves a different representation directly.
            // A stale ranged replay here would incorrectly produce ABXY.
            return response(206, {
              'content-length': '2',
              'content-range': 'bytes 2-3/4',
              etag: '"same"',
            }, [Buffer.from('XY')]);
          }
          return response(200, {
            'content-length': '4', etag: '"fresh"',
          }, [Buffer.from('WXYZ')]);
        },
        now: () => NOW,
      });
      const baseJob = {
        jobId: 'job-same-origin-redirect', offerId: 'offer-same-origin-redirect',
        candidateFingerprint: `candidate-sha256-${'f'.repeat(64)}`,
        bytes: { received: 0, total: null },
      };
      const offer = { transport: 'https', sourceUrl: 'https://downloads.example.org/start' };

      await assert.rejects(transport.download({
        job: baseJob, offer, stagingRoot: root, payloadPath, metadataPath,
      }));
      const partial = JSON.parse(readFileSync(metadataPath, 'utf8'));
      assert.equal(partial.bytes, 2);
      assert.equal(partial.validator, null,
        'a validator learned behind even a same-origin redirect is not resumable evidence');
      assert.equal(readFileSync(payloadPath, 'utf8'), 'AB');

      const result = await transport.download({
        job: { ...baseJob, bytes: { received: 2, total: 4 } },
        offer, stagingRoot: root, payloadPath, metadataPath,
      });
      assert.equal(requests[1].url, 'https://downloads.example.org/book.txt');
      assert.equal(requests[1].headers.Range, undefined);
      assert.equal(requests[1].headers['If-Range'], undefined);
      assert.equal(requests[2].url, 'https://downloads.example.org/start');
      assert.equal(requests[2].headers.Range, undefined,
        'redirected partial bytes are discarded before contacting the alias again');
      assert.equal(requests[2].headers['If-Range'], undefined);
      assert.equal(readFileSync(payloadPath, 'utf8'), 'WXYZ');
      assert.equal(result.bytes, 4);
      assert.equal(result.sha256, sha(Buffer.from('WXYZ')));
    });
  });

  test('strong validator resumes with Range/If-Range and coherent 206 without joining two versions', async () => {
    await withWorkspace(async workspace => {
      const root = join(workspace, '书库', '.resources', 'staging');
      const staging = join(root, 'job-range');
      mkdirSync(staging, { recursive: true });
      const payloadPath = join(staging, 'payload.txt.part');
      const metadataPath = join(staging, 'transfer.json');
      const requests = [];
      let call = 0;
      const transport = new LibraryHttpAcquisition({
        resolver: publicResolver(),
        requester: async request => {
          requests.push(request);
          call += 1;
          if (call === 1) {
            return {
              statusCode: 200,
              headers: { 'content-length': '6', etag: '"range-v1"' },
              body: Readable.from((async function* () {
                yield Buffer.from('abc');
                throw Object.assign(new Error('fixture reset'), { code: 'ECONNRESET' });
              })()),
            };
          }
          return response(206, {
            'content-length': '3',
            'content-range': 'bytes 3-5/6',
            etag: '"range-v1"',
          }, [Buffer.from('d'), Buffer.from('ef')]);
        },
        now: () => NOW,
      });
      const baseJob = {
        jobId: 'job-range', offerId: 'offer-range',
        candidateFingerprint: `candidate-sha256-${'b'.repeat(64)}`,
        bytes: { received: 0, total: null },
      };
      const offer = { transport: 'https', sourceUrl: 'https://public.example.org/book.txt' };
      await assert.rejects(transport.download({
        job: baseJob, offer, stagingRoot: root, payloadPath, metadataPath,
      }));
      const partial = JSON.parse(readFileSync(metadataPath, 'utf8'));
      assert.equal(partial.bytes, 3);
      assert.equal(readFileSync(payloadPath, 'utf8'), 'abc');
      const complete = await transport.download({
        job: { ...baseJob, bytes: { received: 3, total: 6 } },
        offer, stagingRoot: root, payloadPath, metadataPath,
      });
      assert.equal(readFileSync(payloadPath, 'utf8'), 'abcdef');
      assert.equal(complete.sha256, sha(Buffer.from('abcdef')));
      assert.equal(requests[1].headers.Range, 'bytes=3-');
      assert.equal(requests[1].headers['If-Range'], '"range-v1"');
    });
  });

  test('a Range 200 or changed validator restarts from byte zero, and completed 416 verifies local EOF', async () => {
    await withWorkspace(async workspace => {
      const root = join(workspace, '书库', '.resources', 'staging');
      const staging = join(root, 'job-restart');
      mkdirSync(staging, { recursive: true });
      const payloadPath = join(staging, 'payload.txt.part');
      const metadataPath = join(staging, 'transfer.json');
      const requests = [];
      let call = 0;
      const transport = new LibraryHttpAcquisition({
        resolver: publicResolver(),
        requester: async request => {
          requests.push(request);
          call += 1;
          if (call === 1) {
            return {
              statusCode: 200,
              headers: { 'content-length': '6', etag: '"old-version"' },
              body: Readable.from((async function* () {
                yield Buffer.from('old');
                throw new Error('fixture disconnect');
              })()),
            };
          }
          if (call === 2) {
            return response(206, {
              'content-length': '3', 'content-range': 'bytes 3-5/6', etag: '"new-version"',
            }, [Buffer.from('BAD')]);
          }
          if (call === 3) {
            return response(200, {
              'content-length': '6', etag: '"new-version"',
            }, [Buffer.from('new123')]);
          }
          return response(416, { 'content-range': 'bytes */6', etag: '"new-version"' }, []);
        },
        now: () => NOW,
      });
      const baseJob = {
        jobId: 'job-restart', offerId: 'offer-restart',
        candidateFingerprint: `candidate-sha256-${'c'.repeat(64)}`,
        bytes: { received: 0, total: null },
      };
      const offer = { transport: 'https', sourceUrl: 'https://public.example.org/book.txt' };
      await assert.rejects(transport.download({ job: baseJob, offer, stagingRoot: root, payloadPath, metadataPath }));
      const restarted = await transport.download({
        job: { ...baseJob, bytes: { received: 3, total: 6 } },
        offer, stagingRoot: root, payloadPath, metadataPath,
      });
      assert.equal(readFileSync(payloadPath, 'utf8'), 'new123');
      assert.equal(restarted.bytes, 6);
      assert.equal(requests[1].headers.Range, 'bytes=3-');
      assert.equal(requests[2].headers.Range, undefined, 'validator mismatch forces an un-ranged fresh request');
      const eof = await transport.download({
        job: { ...baseJob, bytes: { received: 6, total: 6 } },
        offer, stagingRoot: root, payloadPath, metadataPath,
      });
      assert.equal(eof.bytes, 6);
      assert.equal(eof.sha256, sha(Buffer.from('new123')));
      assert.equal(requests[3].headers.Range, 'bytes=6-');
    });
  });

  test('a partial response without a validator is discarded before the explicit fresh request', async () => {
    await withWorkspace(async workspace => {
      const root = join(workspace, '书库', '.resources', 'staging');
      const staging = join(root, 'job-no-validator');
      mkdirSync(staging, { recursive: true });
      const payloadPath = join(staging, 'payload.txt.part');
      const metadataPath = join(staging, 'transfer.json');
      const requests = [];
      let call = 0;
      const transport = new LibraryHttpAcquisition({
        resolver: publicResolver(),
        requester: async request => {
          requests.push(request);
          call += 1;
          if (call === 1) {
            return {
              statusCode: 200,
              headers: { 'content-length': '6' },
              body: Readable.from((async function* () {
                yield Buffer.from('abc');
                throw new Error('fixture disconnect');
              })()),
            };
          }
          return response(200, { 'content-length': '6' }, [Buffer.from('UVWXYZ')]);
        },
        now: () => NOW,
      });
      const baseJob = {
        jobId: 'job-no-validator', offerId: 'offer-no-validator',
        candidateFingerprint: `candidate-sha256-${'d'.repeat(64)}`,
        bytes: { received: 0, total: null },
      };
      const offer = { transport: 'https', sourceUrl: 'https://public.example.org/book.txt' };
      await assert.rejects(transport.download({ job: baseJob, offer, stagingRoot: root, payloadPath, metadataPath }));
      const progress = [];
      await transport.download({
        job: { ...baseJob, bytes: { received: 3, total: 6 } },
        offer, stagingRoot: root, payloadPath, metadataPath,
        onProgress: snapshot => progress.push(snapshot),
      });
      assert.equal(requests[1].headers.Range, undefined);
      assert.deepEqual(progress[0], { received: 0, total: null });
      assert.equal(readFileSync(payloadPath, 'utf8'), 'UVWXYZ');
    });
  });

  test('first-chunk abort fsyncs payload before metadata/Job progress and closes before returning partial durability', async () => {
    await withWorkspace(async workspace => {
      const root = join(workspace, '书库', '.resources', 'staging');
      const staging = join(root, 'job-abort-order');
      mkdirSync(staging, { recursive: true });
      const payloadPath = join(staging, 'payload.txt.part');
      const metadataPath = join(staging, 'transfer.json');
      const events = [];
      const fsImpl = observedFs({ payloadPath, metadataPath, events });
      const controller = new AbortController();
      const transport = new LibraryHttpAcquisition({
        fsImpl,
        resolver: publicResolver(),
        requester: async () => response(200, {
          'content-length': '6', etag: '"abort-order-v1"',
        }, [Buffer.from('abc'), Buffer.from('def')]),
        now: () => NOW,
      });
      const job = {
        jobId: 'job-abort-order', offerId: 'offer-abort-order',
        candidateFingerprint: `candidate-sha256-${'f'.repeat(64)}`,
        bytes: { received: 0, total: null },
      };
      let thrown;
      try {
        await transport.download({
          job,
          offer: { transport: 'https', sourceUrl: 'https://public.example.org/abort.txt' },
          stagingRoot: root,
          payloadPath,
          metadataPath,
          signal: controller.signal,
          onProgress(progress) {
            events.push('job-result');
            assert.deepEqual(progress, { received: 3, total: 6 });
            controller.abort();
          },
        });
      } catch (error) {
        thrown = error;
        events.push('returned');
      }
      assert.equal(thrown?.code, 'LIBRARY_ACQUISITION_ABORTED');
      assert.equal(thrown?.partialDurable, true);
      assert.equal(readFileSync(payloadPath, 'utf8'), 'abc');
      assert.equal(JSON.parse(readFileSync(metadataPath, 'utf8')).bytes, 3);
      assert(events.indexOf('payload-fsync') < events.indexOf('metadata-publish'));
      assert(events.indexOf('metadata-publish') < events.indexOf('job-result'));
      assert(events.indexOf('job-result') < events.indexOf('payload-stream-close'));
      assert(events.lastIndexOf('payload-close') < events.indexOf('returned'));
    });
  });

  test('pause while the payload writer is finalizing converges on close instead of waiting forever for finish', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('writer-final-race');
      const candidate = fixtureCandidate(payload);
      const gate = writerFinalGateFs();
      const fixture = serviceFixture(workspace, candidate, async () => response(200, {
        'content-length': String(payload.length), etag: '"writer-final-race-v1"',
      }, [payload]), { fsImpl: gate.fsImpl });
      const payloadPath = join(
        fixture.store.paths.stagingRoot, 'job-fixture-9001', 'payload.txt.part',
      );
      gate.setTarget(payloadPath);
      const running = fixture.service.startHttp(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      running.catch(() => {});
      await Promise.race([
        gate.started,
        new Promise((_, reject) => setTimeout(() => reject(new Error('writer final gate was not reached')), 2000)),
      ]);
      const pausing = fixture.service.pause(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
      );
      gate.release();
      const paused = await Promise.race([
        pausing,
        new Promise((_, reject) => setTimeout(() => reject(new Error('writer-close pause did not settle')), 2000)),
      ]);
      assert.equal(await running, paused);
      assert.equal(paused.state, 'paused');
      assert.equal(paused.retryFrom, 'downloading');
      assert.deepEqual(paused.bytes, { received: payload.length, total: payload.length });
      assert.equal(fixture.service.snapshot().activeCount, 0);
    });
  });

  test('stream primary error survives partial fsync and close cleanup failures', async () => {
    await withWorkspace(async workspace => {
      const root = join(workspace, '书库', '.resources', 'staging');
      const staging = join(root, 'job-primary-order');
      mkdirSync(staging, { recursive: true });
      const payloadPath = join(staging, 'payload.txt.part');
      const metadataPath = join(staging, 'transfer.json');
      const primary = Object.assign(new Error('fixture stream EPIPE'), { code: 'EPIPE' });
      const fsyncFailure = Object.assign(new Error('fixture seal fsync EIO'), { code: 'EIO' });
      const closeFailure = Object.assign(new Error('fixture seal close EIO'), { code: 'EIO' });
      let payloadFsyncs = 0;
      const fsImpl = observedFs({
        payloadPath,
        metadataPath,
        onPayloadFsync() {
          payloadFsyncs += 1;
          if (payloadFsyncs === 2) throw fsyncFailure;
        },
        onPayloadClose() {
          if (payloadFsyncs >= 2) throw closeFailure;
        },
      });
      const transport = new LibraryHttpAcquisition({
        fsImpl,
        resolver: publicResolver(),
        requester: async () => ({
          statusCode: 200,
          headers: { 'content-length': '6', etag: '"primary-v1"' },
          body: Readable.from((async function* () {
            yield Buffer.from('abc');
            throw primary;
          })()),
        }),
        now: () => NOW,
      });
      let thrown;
      try {
        await transport.download({
          job: {
            jobId: 'job-primary-order', offerId: 'offer-primary-order',
            candidateFingerprint: `candidate-sha256-${'0'.repeat(64)}`,
            bytes: { received: 0, total: null },
          },
          offer: { transport: 'https', sourceUrl: 'https://public.example.org/primary.txt' },
          stagingRoot: root,
          payloadPath,
          metadataPath,
        });
      } catch (error) {
        thrown = error;
      }
      assert.equal(thrown, primary);
      assert.equal(thrown.partialDurable, false);
      assert.equal(thrown.durabilityError, fsyncFailure);
      assert.equal(thrown.cleanupError, fsyncFailure);
      assert(thrown.cleanupErrors.includes(fsyncFailure));
      assert(thrown.cleanupErrors.includes(closeFailure));
    });
  });

  test('pause fsyncs exact progress, releases stream owner, and explicit resume finishes', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('abcdef');
      const candidate = fixtureCandidate(payload);
      const firstBody = new PassThrough();
      let call = 0;
      const ledger = {
        active: new Set(), released: [],
        register(entry) { const key = `resource-${entry.id}`; this.active.add(key); return key; },
        update() {},
        release(key) { this.active.delete(key); this.released.push(key); },
      };
      const requester = async request => {
        call += 1;
        if (call === 1) {
          request.signal.addEventListener('abort', () => firstBody.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
          return { statusCode: 200, headers: { 'content-length': '6', etag: '"pause-v1"' }, body: firstBody };
        }
        return response(206, {
          'content-length': '3', 'content-range': 'bytes 3-5/6', etag: '"pause-v1"',
        }, [Buffer.from('def')]);
      };
      const fixture = serviceFixture(workspace, candidate, requester, { resourceLedger: ledger });
      const running = fixture.service.startHttp(fixture.workspaceHandle.workspaceIdentity, fixture.job.jobId, {
        candidate, expectedRevision: fixture.job.revision,
      });
      firstBody.write(Buffer.from('abc'));
      await eventually(() => fixture.store.getJob(fixture.job.jobId).bytes.received === 3);
      const paused = await fixture.service.pause(fixture.workspaceHandle.workspaceIdentity, fixture.job.jobId);
      await running;
      assert.equal(paused.state, 'paused');
      assert.equal(paused.retryFrom, 'downloading');
      assert.equal(paused.bytes.received, 3);
      assert.equal(ledger.active.size, 0);
      const resumed = await fixture.service.resumeHttp(fixture.workspaceHandle.workspaceIdentity, fixture.job.jobId, {
        candidate, expectedRevision: paused.revision,
      });
      assert.equal(resumed.state, 'awaiting-import');
      assert.equal(readFileSync(resumed.finalPath, 'utf8'), 'abcdef');
      assert.equal(ledger.active.size, 0);
      assert.equal(ledger.released.length, 2);
    });
  });

  test('pause during the final transport hash preserves the complete durable transfer as paused', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('final-hash-pause');
      const candidate = fixtureCandidate(payload);
      const gate = fileReadGateFs();
      const fixture = serviceFixture(workspace, candidate, async () => response(200, {
        'content-length': String(payload.length), etag: '"final-hash-pause-v1"',
      }, [payload]), { fsImpl: gate.fsImpl });
      const payloadPath = join(
        fixture.store.paths.stagingRoot, 'job-fixture-9001', 'payload.txt.part',
      );
      gate.setTarget(payloadPath);

      const running = fixture.service.startHttp(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      running.catch(() => {});
      await Promise.race([
        gate.started,
        new Promise((_, reject) => setTimeout(() => reject(new Error('final hash gate was not reached')), 2000)),
      ]);
      await eventually(() => {
        const current = fixture.store.getJob(fixture.job.jobId);
        return current.bytes.received === payload.length && current.bytes.total === payload.length;
      });
      const pausing = fixture.service.pause(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
      );
      gate.release();
      const paused = await pausing;
      assert.equal(await running, paused);
      assert.equal(paused.state, 'paused');
      assert.equal(paused.retryFrom, 'downloading');
      assert.deepEqual(paused.bytes, { received: payload.length, total: payload.length });
      assert.equal(readFileSync(payloadPath, 'utf8'), payload.toString('utf8'));
      assert.equal(fixture.store.listInboxReceipts().length, 0);
      assert.equal(fixture.service.snapshot().activeCount, 0);
    });
  });

  test('shutdown during the final transport hash settles the complete durable transfer before exit', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('final-hash-shutdown');
      const candidate = fixtureCandidate(payload);
      const gate = fileReadGateFs();
      const fixture = serviceFixture(workspace, candidate, async () => response(200, {
        'content-length': String(payload.length), etag: '"final-hash-shutdown-v1"',
      }, [payload]), { fsImpl: gate.fsImpl });
      const payloadPath = join(
        fixture.store.paths.stagingRoot, 'job-fixture-9001', 'payload.txt.part',
      );
      gate.setTarget(payloadPath);

      const running = fixture.service.startHttp(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      running.catch(() => {});
      await Promise.race([
        gate.started,
        new Promise((_, reject) => setTimeout(() => reject(new Error('final hash gate was not reached')), 2000)),
      ]);
      await eventually(() => {
        const current = fixture.store.getJob(fixture.job.jobId);
        return current.bytes.received === payload.length && current.bytes.total === payload.length;
      });
      const shuttingDown = fixture.service.shutdown();
      gate.release();
      await shuttingDown;
      const paused = await running;
      assert.equal(paused.state, 'paused');
      assert.equal(paused.retryFrom, 'downloading');
      assert.deepEqual(paused.bytes, { received: payload.length, total: payload.length });
      assert.equal(readFileSync(payloadPath, 'utf8'), payload.toString('utf8'));
      assert.equal(fixture.store.listInboxReceipts().length, 0);
      assert.equal(fixture.service.snapshot().activeCount, 0);
    });
  });

  test('shutdown treats a durably recorded verification failure as a settled product outcome', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('verification-failure-at-quit');
      const candidate = fixtureCandidate(payload, {
        offer: { checksum: `sha256:${'0'.repeat(64)}` },
      });
      const gate = fileReadGateFs(2);
      const fixture = serviceFixture(workspace, candidate, async () => response(200, {
        'content-length': String(payload.length), etag: '"verification-quit-v1"',
      }, [payload]), { fsImpl: gate.fsImpl });
      const payloadPath = join(
        fixture.store.paths.stagingRoot, 'job-fixture-9001', 'payload.txt.part',
      );
      gate.setTarget(payloadPath);
      const running = fixture.service.startHttp(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      running.catch(() => {});
      await Promise.race([
        gate.started,
        new Promise((_, reject) => setTimeout(() => reject(new Error('verification gate was not reached')), 2000)),
      ]);
      await eventually(() => fixture.store.getJob(fixture.job.jobId).state === 'verifying');
      const shuttingDown = fixture.service.shutdown();
      gate.release();
      await shuttingDown;
      await assert.rejects(running, error => error?.code === 'LIBRARY_ACQUISITION_INTEGRITY_FAILED');
      const failed = fixture.store.getJob(fixture.job.jobId);
      assert.equal(failed.state, 'failed');
      assert.equal(failed.retryFrom, 'verifying');
      assert.equal(failed.error.code, 'LIBRARY_ACQUISITION_INTEGRITY_FAILED');
      assert.equal(fixture.service.snapshot().activeCount, 0);
    });
  });

  test('shutdown never treats a rename-visible directory-fsync failure as a durable completion', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('verification-directory-fsync-failure');
      const candidate = fixtureCandidate(payload, {
        offer: { checksum: `sha256:${'0'.repeat(64)}` },
      });
      const gate = fileReadGateFs(2);
      const fixture = serviceFixture(workspace, candidate, async () => response(200, {
        'content-length': String(payload.length), etag: '"verification-dir-fsync-v1"',
      }, [payload]), { fsImpl: gate.fsImpl });
      const payloadPath = join(
        fixture.store.paths.stagingRoot, 'job-fixture-9001', 'payload.txt.part',
      );
      gate.setTarget(payloadPath);
      const directoryFailure = Object.assign(new Error('fixture jobs directory fsync failed'), { code: 'EIO' });
      const originalDirectoryFsync = fixture.store._fsyncDirectory.bind(fixture.store);
      let failNextJobsDirectoryFsync = false;
      fixture.store._fsyncDirectory = directory => {
        if (failNextJobsDirectoryFsync
          && resolve(directory) === resolve(fixture.store.paths.jobsRoot)) {
          failNextJobsDirectoryFsync = false;
          throw directoryFailure;
        }
        return originalDirectoryFsync(directory);
      };

      const running = fixture.service.startHttp(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      running.catch(() => {});
      await Promise.race([
        gate.started,
        new Promise((_, reject) => setTimeout(() => reject(new Error('verification fsync gate was not reached')), 2000)),
      ]);
      await eventually(() => fixture.store.getJob(fixture.job.jobId).state === 'verifying');
      const shuttingDown = fixture.service.shutdown();
      failNextJobsDirectoryFsync = true;
      gate.release();
      await assert.rejects(
        shuttingDown,
        error => error?.code === 'LIBRARY_ACQUISITION_SHUTDOWN_DURABILITY_FAILED'
          && error?.primaryCode === 'EIO',
      );
      let runningError;
      try { await running; } catch (error) { runningError = error; }
      assert.equal(runningError?.code, 'EIO');
      assert.equal(fixture.service.getDurableCompletionReceipt(runningError), null,
        'only a fully returned Store transition may mint a completion receipt');
      assert.equal(fixture.store.getJob(fixture.job.jobId).state, 'failed',
        'rename visibility alone is deliberately insufficient durability evidence');
      assert.equal(fixture.service.snapshot().activeCount, 0);
    });
  });

  test('shutdown rejects when partial fsync fails and persists failed rather than a false paused receipt', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('abcdef');
      const candidate = fixtureCandidate(payload);
      const payloadPath = join(
        workspace, '书库', '.resources', 'staging',
        'job-fixture-9001', 'payload.txt.part',
      );
      const events = [];
      const durabilityFailure = Object.assign(new Error('fixture shutdown fsync failed'), { code: 'EIO' });
      let failCheckpoint = false;
      const fsImpl = observedFs({
        payloadPath,
        events,
      });
      const durableFsync = fsImpl.fsyncSync;
      fsImpl.fsyncSync = fd => {
        if (failCheckpoint) throw durabilityFailure;
        return durableFsync(fd);
      };
      const body = new PassThrough();
      const fixture = serviceFixture(workspace, candidate, async request => {
        request.signal.addEventListener('abort', () => {
          body.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
        return {
          statusCode: 200,
          headers: { 'content-length': '6', etag: '"shutdown-v1"' },
          body,
        };
      }, { fsImpl });
      fixture.service.startHttp(fixture.workspaceHandle.workspaceIdentity, fixture.job.jobId, {
        candidate, expectedRevision: fixture.job.revision,
      });
      body.write(Buffer.from('abc'));
      await eventually(() => fixture.store.getJob(fixture.job.jobId).bytes.received === 3);
      failCheckpoint = true;
      await assert.rejects(
        fixture.service.shutdown(),
        error => error?.code === 'LIBRARY_ACQUISITION_SHUTDOWN_DURABILITY_FAILED'
          && error?.primaryCode === 'EIO',
      );
      const failed = fixture.store.getJob(fixture.job.jobId);
      assert.equal(failed.state, 'failed');
      assert.equal(failed.retryFrom, 'downloading');
      assert.equal(failed.error.code, 'EIO');
      assert.equal(fixture.service.snapshot().activeCount, 0, 'all HTTP owners settle before shutdown reports failure');
    });
  });

  test('Browser progress and interrupted settlement never persist bytes when payload fsync fails', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('browser checkpoint');
      const candidate = fixtureCandidate(payload);
      const payloadPath = join(
        workspace, '书库', '.resources', 'staging',
        'job-fixture-9001', 'payload.txt.part',
      );
      const fsyncFailure = Object.assign(new Error('fixture Browser fsync failed'), { code: 'EIO' });
      let failCheckpoint = false;
      const fsImpl = observedFs({
        payloadPath,
      });
      const durableFsync = fsImpl.fsyncSync;
      fsImpl.fsyncSync = fd => {
        if (failCheckpoint) throw fsyncFailure;
        return durableFsync(fd);
      };
      const fixture = serviceFixture(workspace, candidate, async () => {
        throw new Error('Browser fixture is offline');
      }, { fsImpl });
      const prepared = fixture.service.prepareBrowserDownload(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      writeFileSync(prepared.savePath, payload.subarray(0, 7));
      failCheckpoint = true;
      assert.throws(
        () => fixture.service.updateBrowserDownload(prepared.handleId, {
          expectedRevision: prepared.revision,
          total: payload.length,
        }),
        error => error === fsyncFailure,
      );
      assert.deepEqual(fixture.store.getJob(fixture.job.jobId).bytes, { received: 0, total: null });
      await assert.rejects(
        fixture.service.completeBrowserDownload(prepared.handleId, { state: 'interrupted' }),
        error => error?.code === 'EIO',
      );
      const failed = fixture.store.getJob(fixture.job.jobId);
      assert.equal(failed.state, 'failed');
      assert.equal(failed.retryFrom, 'downloading');
      assert.deepEqual(failed.bytes, { received: 0, total: null });
      assert.equal(fixture.service.snapshot().activeCount, 0);
    });
  });

  test('service shutdown retains an unobserved Browser writer owner and fails closed', async () => {
    await withWorkspace(async workspace => {
      const candidate = fixtureCandidate(Buffer.from('browser shutdown'));
      const fixture = serviceFixture(workspace, candidate, async () => {
        throw new Error('Browser fixture is offline');
      });
      const prepared = fixture.service.prepareBrowserDownload(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      writeFileSync(prepared.savePath, 'possibly-still-writing');
      await assert.rejects(
        fixture.service.shutdown(),
        error => error?.code === 'LIBRARY_ACQUISITION_SHUTDOWN_DURABILITY_FAILED'
          && error?.primaryCode === 'LIBRARY_ACQUISITION_BROWSER_SHUTDOWN_UNSETTLED',
      );
      const held = fixture.store.getJob(fixture.job.jobId);
      assert.equal(held.state, 'downloading');
      assert.deepEqual(held.bytes, { received: 0, total: null });
      assert.equal(fixture.service.snapshot().browserActiveCount, 1);
    });
  });

  test('Browser completion adopts Chromium final rename at done and promotes only that closed identity', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('browser identity fixture');
      const candidate = fixtureCandidate(payload);
      const fixture = serviceFixture(workspace, candidate, async () => {
        throw new Error('Browser fixture is offline');
      });
      const prepared = fixture.service.prepareBrowserDownload(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      nativeFs.unlinkSync(prepared.savePath);
      writeFileSync(prepared.savePath, payload);
      const completed = await fixture.service.completeBrowserDownload(
        prepared.handleId,
        { state: 'completed' },
      );
      assert.equal(completed.state, 'awaiting-import');
      assert.equal(completed.integrity.sha256, sha(payload));
      assert.equal(readFileSync(completed.finalPath, 'utf8'), payload.toString('utf8'));
      const inbox = fixture.store.listInboxReceipts();
      assert.equal(inbox.length, 1);
      assert.equal(inbox[0].artifact.sha256, sha(payload));
    });
  });

  test('HTTP active writer rejects and quarantines a same-path regular replacement before verification', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('abcdef');
      const candidate = fixtureCandidate(payload);
      const payloadPath = join(
        workspace, '书库', '.resources', 'staging',
        'job-fixture-9001', 'payload.txt.part',
      );
      let replaced = false;
      const fixture = serviceFixture(workspace, candidate, async () => ({
        statusCode: 200,
        headers: { 'content-length': '6', etag: '"identity-v1"' },
        body: Readable.from((async function* () {
          yield Buffer.from('abc');
          nativeFs.unlinkSync(payloadPath);
          writeFileSync(payloadPath, 'EVIL!!');
          replaced = true;
          yield Buffer.from('def');
        })()),
      }));
      await assert.rejects(
        fixture.service.startHttp(fixture.workspaceHandle.workspaceIdentity, fixture.job.jobId, {
          candidate, expectedRevision: fixture.job.revision,
        }),
        error => error?.code === 'LIBRARY_HTTP_PAYLOAD_IDENTITY_CHANGED',
      );
      assert.equal(replaced, true);
      const failed = fixture.store.getJob(fixture.job.jobId);
      assert.equal(failed.state, 'failed');
      assert.equal(failed.retryFrom, 'downloading');
      assert.equal(failed.finalPath, '');
      assert.equal(fixture.store.listInboxReceipts().length, 0);
      const quarantineRoot = join(workspace, '书库', '.resources', 'quarantine', fixture.job.jobId);
      assert.equal(existsSync(quarantineRoot), true);
      assert(readdirSync(quarantineRoot).some(name => name.startsWith('payload-')));
    });
  });

  test('HTTP final verification rejects a stable same-inode rewrite that differs from the streamed digest', async () => {
    await withWorkspace(async workspace => {
      const root = join(workspace, '书库', '.resources', 'staging');
      const staging = join(root, 'job-inode-rewrite');
      mkdirSync(staging, { recursive: true });
      const payloadPath = join(staging, 'payload.txt.part');
      const metadataPath = join(staging, 'transfer.json');
      const transport = new LibraryHttpAcquisition({
        resolver: publicResolver(),
        requester: async () => response(200, {
          'content-length': '6', etag: '"inode-v1"',
        }, [Buffer.from('abcdef')]),
        now: () => NOW,
      });
      const job = {
        jobId: 'job-inode-rewrite', offerId: 'offer-inode-rewrite',
        candidateFingerprint: `candidate-sha256-${'1'.repeat(64)}`,
        bytes: { received: 0, total: null },
      };
      const before = { ino: null, dev: null };
      let thrown;
      try {
        await transport.download({
          job,
          offer: { transport: 'https', sourceUrl: 'https://public.example.org/inode.txt' },
          stagingRoot: root,
          payloadPath,
          metadataPath,
          onProgress() {
            const stat = statSync(payloadPath);
            before.ino = String(stat.ino);
            before.dev = String(stat.dev);
            writeFileSync(payloadPath, 'UVWXYZ');
          },
        });
      } catch (error) {
        thrown = error;
      }
      const after = statSync(payloadPath);
      assert.equal(String(after.ino), before.ino);
      assert.equal(String(after.dev), before.dev);
      assert.equal(thrown?.code, 'LIBRARY_HTTP_PAYLOAD_IDENTITY_CHANGED');
      assert.equal(thrown?.quarantine, true);
      assert.equal(thrown?.partialDurable, false);
      assert.equal(readFileSync(payloadPath, 'utf8'), 'UVWXYZ');
      assert.notEqual(sha(Buffer.from('UVWXYZ')), JSON.parse(readFileSync(metadataPath, 'utf8')).sha256);
    });
  });

  test('cancel during streaming aborts response, removes only Job staging, and publishes no final fact', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('cancel-me');
      const candidate = fixtureCandidate(payload);
      const body = new PassThrough();
      const fixture = serviceFixture(workspace, candidate, async request => {
        request.signal.addEventListener('abort', () => body.destroy(), { once: true });
        return { statusCode: 200, headers: { 'content-length': String(payload.length), etag: '"cancel-v1"' }, body };
      });
      const running = fixture.service.startHttp(fixture.workspaceHandle.workspaceIdentity, fixture.job.jobId, {
        candidate, expectedRevision: fixture.job.revision,
      });
      body.write(payload.subarray(0, 3));
      await eventually(() => fixture.store.getJob(fixture.job.jobId).bytes.received === 3);
      const cancelled = await fixture.service.cancel(fixture.workspaceHandle.workspaceIdentity, fixture.job.jobId);
      await running;
      assert.equal(cancelled.state, 'cancelled');
      assert.equal(fixture.store.listInboxReceipts().length, 0);
      assert.equal(existsSync(join(workspace, '书库', '.resources', 'staging', fixture.job.jobId)), false);
      assert.equal(readdirSync(join(workspace, '书库')).filter(name => name.endsWith('.txt')).length, 0);
    });
  });

  test('magic/checksum failure moves only payload to quarantine and never calls promoter or creates Inbox', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from([0x41, 0x00, 0x42]);
      const candidate = fixtureCandidate(payload);
      let promoted = 0;
      const fixture = serviceFixture(workspace, candidate, async () => response(200, {
        'content-length': String(payload.length), etag: '"binary-v1"',
      }, [payload]), {
        promoter: { async materializePath() { promoted += 1; throw new Error('must not run'); } },
      });
      await assert.rejects(
        fixture.service.startHttp(fixture.workspaceHandle.workspaceIdentity, fixture.job.jobId, {
          candidate, expectedRevision: fixture.job.revision,
        }),
        error => error?.code === 'LIBRARY_ACQUISITION_FORMAT_MISMATCH',
      );
      const failed = fixture.store.getJob(fixture.job.jobId);
      assert.equal(failed.state, 'failed');
      assert.equal(failed.retryFrom, 'verifying');
      assert.equal(failed.finalPath, '');
      assert.equal(promoted, 0);
      assert.equal(fixture.store.listInboxReceipts().length, 0);
      const quarantineRoot = join(workspace, '书库', '.resources', 'quarantine', fixture.job.jobId);
      const quarantined = readdirSync(quarantineRoot);
      assert.equal(quarantined.length, 2);
      const quarantinedPayload = quarantined.find(name => name.startsWith('payload-'));
      assert.equal(statSync(join(quarantineRoot, quarantinedPayload)).size, payload.length);
    });
  });

  test('all six admitted formats use sequential full hash plus their declared magic/container contract', async () => {
    await withWorkspace(async workspace => {
      const epub = new JSZip();
      epub.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      epub.file('META-INF/container.xml', '<container/>');
      const cbz = new JSZip();
      cbz.file('page-1.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      const fixtures = {
        txt: Buffer.from('plain text fixture'),
        pdf: Buffer.from('%PDF-1.7\nfixture'),
        mobi: Buffer.concat([Buffer.alloc(60), Buffer.from('BOOKMOBI'), Buffer.alloc(16)]),
        azw3: Buffer.concat([Buffer.alloc(60), Buffer.from('BOOKMOBI'), Buffer.alloc(16)]),
        epub: await epub.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
        cbz: await cbz.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
      };
      for (const [format, bytes] of Object.entries(fixtures)) {
        const filePath = join(workspace, `fixture.${format}`);
        writeFileSync(filePath, bytes);
        const result = await verifyPayload({
          filePath,
          format,
          declaredChecksum: `sha256:${sha(bytes)}`,
          expectedSize: bytes.length,
        });
        assert.equal(result.sha256, sha(bytes));
        assert.equal(result.size, bytes.length);
      }
    });
  });

  test('Workspace token prevents A/B Inbox crossover and startup recovery performs no network', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mazz-w93b-ab-'));
    const workspaceA = join(root, 'A');
    const workspaceB = join(root, 'B');
    mkdirSync(workspaceA);
    mkdirSync(workspaceB);
    try {
      let networkCalls = 0;
      const service = new LibraryAcquisitionService({
        requester: async () => { networkCalls += 1; throw new Error('offline gate'); },
        resolver: async () => { networkCalls += 1; throw new Error('offline gate'); },
        promoter: fixturePromoter(),
        now: () => NOW,
      });
      const handleA = service.openWorkspace(workspaceA);
      const handleB = service.openWorkspace(workspaceB);
      assert.notEqual(handleA.workspaceIdentity, handleB.workspaceIdentity);
      assert.notEqual(handleA.workspaceToken, handleB.workspaceToken);
      assert.equal(service.listInbox({ workspacePath: workspaceA }).receipts.length, 0);
      assert.equal(service.listInbox({ workspacePath: workspaceB }).receipts.length, 0);
      assert.deepEqual(await service.recoverAfterRestart(), []);
      assert.equal(networkCalls, 0);
      await assert.rejects(
        service.completeInbox({
          workspaceIdentity: handleA.workspaceIdentity,
          workspaceToken: handleB.workspaceToken,
        }, 'receipt-missing', {}),
        error => error?.code === 'LIBRARY_ACQUISITION_WORKSPACE_TOKEN_INVALID',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('acknowledged Inbox plus durable bookId reconciles to imported after restart without transport', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.from('restart saga fixture');
      const candidate = fixtureCandidate(payload);
      const fixture = serviceFixture(workspace, candidate, async () => response(200, {
        'content-length': String(payload.length), etag: '"saga-v1"',
      }, [payload]));
      const waiting = await fixture.service.startHttp(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      const receipt = fixture.store.listInboxReceipts({ state: 'pending' })[0];
      const withBook = fixture.store.updateJob(waiting.jobId, {
        expectedRevision: waiting.revision,
        patch: { bookId: 'book-restart-saga' },
      });
      fixture.store.acknowledgeInboxReceipt(receipt.receiptId, { expectedRevision: receipt.revision });

      let networkCalls = 0;
      const reopened = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW });
      const restarted = new LibraryAcquisitionService({
        store: reopened,
        requester: async () => { networkCalls += 1; throw new Error('must remain offline'); },
        resolver: async () => { networkCalls += 1; throw new Error('must remain offline'); },
        promoter: fixturePromoter(),
        now: () => NOW,
      });
      const actions = await restarted.recoverAfterRestart(reopened.workspaceIdentity);
      assert(actions.some(item => item.action === 'IMPORTED_RECONCILED'));
      const imported = reopened.getJob(withBook.jobId);
      assert.equal(imported.state, 'imported');
      assert.equal(imported.bookId, 'book-restart-saga');
      assert.equal(reopened.getInboxReceipt(receipt.receiptId).state, 'acknowledged');
      assert.equal(networkCalls, 0);
    });
  });

  test('concurrent exact Inbox consumers converge as one commit plus one idempotent replay', async () => {
    await withWorkspace(async workspace => {
      const payload = Buffer.alloc(1024 * 1024, 0x78);
      const candidate = fixtureCandidate(payload);
      let delayReads = false;
      const fsImpl = {
        ...nativeFs,
        createReadStream(target, options) {
          const source = nativeFs.createReadStream(target, { ...options, highWaterMark: 64 * 1024 });
          if (!delayReads) return source;
          return Readable.from((async function* () {
            for await (const chunk of source) {
              await new Promise(resolvePromise => setImmediate(resolvePromise));
              yield chunk;
            }
          })());
        },
      };
      const fixture = serviceFixture(workspace, candidate, async () => response(200, {
        'content-length': String(payload.length), etag: '"inbox-race-v1"',
      }, [payload]), { fsImpl });
      const waiting = await fixture.service.startHttp(
        fixture.workspaceHandle.workspaceIdentity,
        fixture.job.jobId,
        { candidate, expectedRevision: fixture.job.revision },
      );
      const receipt = fixture.store.listInboxReceipts({ state: 'pending' })[0];
      const selector = {
        workspaceIdentity: fixture.workspaceHandle.workspaceIdentity,
        workspaceToken: fixture.workspaceHandle.workspaceToken,
      };
      const commit = {
        receiptId: receipt.receiptId,
        bookId: 'book-concurrent-inbox',
        workspaceIdentity: fixture.workspaceHandle.workspaceIdentity,
        contentHash: receipt.artifact.sha256,
        path: receipt.artifact.path,
        expectedJobRevision: waiting.revision,
      };
      delayReads = true;
      const results = await Promise.all([
        fixture.service.completeInbox(selector, receipt.receiptId, commit),
        fixture.service.completeInbox(selector, receipt.receiptId, commit),
      ]);
      assert.deepEqual(results.map(result => result.idempotent).sort(), [false, true]);
      assert(results.every(result => result.job.bookId === 'book-concurrent-inbox'));
      assert.equal(fixture.store.getJob(waiting.jobId).state, 'imported');
      assert.equal(fixture.store.getInboxReceipt(receipt.receiptId).state, 'acknowledged');
    });
  });

  test('orphan lock repair is unavailable to ordinary Store and explicit single-instance owner removes only dead locks', async () => {
    await withWorkspace(async workspace => {
      const store = new LibraryAcquisitionStore({ workspacePath: workspace, now: () => NOW });
      const orphan = join(store.paths.locksRoot, 'fixture-orphan.lock');
      writeFileSync(orphan, JSON.stringify({ pid: 999999999, token: 'dead-owner', acquiredAt: NOW }));
      assert.throws(
        () => store.repairOrphanLocks(Object.freeze({})),
        error => error?.code === 'LIBRARY_ACQUISITION_SINGLE_INSTANCE_OWNER_REQUIRED',
      );
      assert.equal(existsSync(orphan), true);
      const capability = StoreModule.createSingleInstanceOwnerCapability();
      const result = store.repairOrphanLocks(capability);
      assert.deepEqual(result.removed, ['fixture-orphan.lock']);
      assert.equal(existsSync(orphan), false);
    });
  });

  test('directory fsync keeps the primary media failure and attaches descriptor cleanup failure', () => {
    const primary = Object.assign(new Error('fixture fsync failed'), { code: 'EIO' });
    const cleanup = Object.assign(new Error('fixture close failed'), { code: 'EIO' });
    const service = new LibraryAcquisitionService({
      fsImpl: {
        openSync() { return 41; },
        fsyncSync() { throw primary; },
        closeSync() { throw cleanup; },
      },
      promoter: fixturePromoter(),
    });
    assert.throws(
      () => service._fsyncDirectory('fixture-directory'),
      error => error === primary && error.cleanupError === cleanup && error.cleanupErrors.includes(cleanup),
    );

    const httpDirectoryPrimary = Object.assign(new Error('fixture HTTP directory fsync failed'), { code: 'EIO' });
    const httpDirectoryCleanup = Object.assign(new Error('fixture HTTP directory close failed'), { code: 'EIO' });
    const httpDirectory = new LibraryHttpAcquisition({
      fsImpl: {
        openSync() { return 42; },
        fsyncSync() { throw httpDirectoryPrimary; },
        closeSync() { throw httpDirectoryCleanup; },
      },
    });
    assert.throws(
      () => httpDirectory._fsyncDirectory('fixture-directory'),
      error => error === httpDirectoryPrimary
        && error.cleanupError === httpDirectoryCleanup
        && error.cleanupErrors.includes(httpDirectoryCleanup),
    );

    const payloadPrimary = Object.assign(new Error('fixture payload fsync failed'), { code: 'EIO' });
    const payloadCleanup = Object.assign(new Error('fixture payload close failed'), { code: 'EIO' });
    const httpPayload = new LibraryHttpAcquisition({
      fsImpl: {
        openSync() { return 43; },
        fstatSync() {
          return {
            isFile: () => true,
            nlink: 1,
            dev: 1,
            ino: 43,
            birthtimeMs: 1,
            ctimeMs: 1,
            mtimeMs: 1,
            size: 1,
          };
        },
        fsyncSync() { throw payloadPrimary; },
        closeSync() { throw payloadCleanup; },
      },
    });
    assert.throws(
      () => httpPayload._fsyncPayload('fixture-payload'),
      error => error === payloadPrimary
        && error.cleanupError === payloadCleanup
        && error.cleanupErrors.includes(payloadCleanup),
    );
  });

  test('core contains no content-size, queue, text, token, Base64 or whole-response admission path', () => {
    const sources = [
      readFileSync(new URL('../../main/library-http-acquisition.js', import.meta.url), 'utf8'),
      readFileSync(new URL('../../main/library-acquisition-service.js', import.meta.url), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(sources, /\b(?:maxBytes|maxFiles|maxJobs|maxQueue|maxTokens|wordLimit|pageLimit)\b/);
    assert.doesNotMatch(sources, /readFileBase64|\batob\s*\(|arrayBuffer\s*\(|Buffer\.concat\s*\(/);
    assert.match(sources, /createWriteStream/);
    assert.match(sources, /for await \(const/);
  });
});
