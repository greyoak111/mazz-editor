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
const { LibraryCatalogHttpClient } = require('../../main/library-catalog-http-client');
const { LibrarySourceCheckpointStore } = require('../../main/library-source-checkpoint-store');
const { LibraryFederatedDiscovery } = require('../../main/library-federated-discovery');

const NOW = '2026-08-25T01:00:00.000Z';
const POLICY_AT = '2026-08-25T00:00:00.000Z';

function descriptor(providerId, extra = {}) {
  return {
    schema: source.DESCRIPTOR_SCHEMA,
    providerId,
    displayName: extra.displayName || providerId,
    adapterVersion: extra.adapterVersion || `${providerId}-v1`,
    capabilities: extra.capabilities || ['discover', 'health', 'resolve', 'search'],
    policy: {
      policyVersion: extra.policyVersion || `${providerId}-policy-v1`,
      checkedAt: POLICY_AT,
      jurisdictions: extra.jurisdictions || [],
      rightsModes: extra.rightsModes || ['unknown'],
      termsUrl: extra.termsUrl || '',
      rightsUrl: extra.rightsUrl || '',
    },
  };
}

function response(statusCode, headers, body) {
  return { statusCode, headers, body: Readable.from([Buffer.from(body || '')]) };
}

function publicResolver(hostname) {
  assert.match(hostname, /example\.org|gutenberg\.org/);
  return [{ address: '93.184.216.34', family: 4 }];
}

const OPDS1 = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">
  <title>Fixture Catalog</title>
  <link rel="self" href="https://catalog.example.org/search?q=pride" />
  <link rel="next" href="https://catalog.example.org/search?q=pride&amp;page=2" />
  <entry>
    <id>urn:uuid:pride-fixture</id><title>Pride and Prejudice</title>
    <updated>2026-08-01T00:00:00Z</updated>
    <author><name>Jane Austen</name></author><dc:language>en</dc:language>
    <dc:identifier>urn:isbn:9780306406157</dc:identifier>
    <summary>A fixture description.</summary>
    <link rel="http://opds-spec.org/acquisition/open-access" href="https://files.example.org/pride.epub" type="application/epub+zip" length="321" />
    <link rel="http://opds-spec.org/acquisition/buy" href="https://files.example.org/pride.pdf" type="application/pdf" />
  </entry>
</feed>`;

const OPDS2 = JSON.stringify({
  metadata: { title: 'JSON Fixture Catalog' },
  links: [
    { rel: 'self', href: 'https://json.example.org/opds?q=pride' },
    { rel: 'next', href: 'https://json.example.org/opds?q=pride&page=2' },
  ],
  groups: [{ publications: [{
    metadata: {
      title: 'Pride and Prejudice',
      identifier: 'urn:isbn:9780306406157',
      author: [{ name: 'Jane Austen' }],
      language: ['en'],
      description: 'JSON fixture.',
    },
    links: [
      { rel: 'download', href: 'https://files.example.org/pride.pdf', type: 'application/pdf', properties: { length: 456 } },
      { rel: 'preview', href: 'https://files.example.org/preview.pdf', type: 'application/pdf' },
    ],
  }] }],
});

function makeCandidate(providerId, resourceId, { title = 'Fixture Book', isbn = '', observedAt = NOW } = {}) {
  const identifiers = { isbn: isbn ? [isbn] : [], olid: [], ia: [], gutenberg: [], doi: [] };
  const identity = isbn ? { identifiers } : { identifiers, providerId, resourceId };
  const workId = contract.deriveWorkId(identity);
  const editionId = contract.deriveEditionId(identity);
  const offer = {
    providerId, resourceId, editionId, format: 'epub', transport: 'https', size: null,
    checksum: '', infoHash: '', sourceUrl: `https://files.example.org/${resourceId}.epub`,
    acquisitionRef: '', selectableFiles: [],
  };
  offer.offerId = contract.deriveOfferId(offer);
  return contract.normalizeCandidate({
    schema: contract.CANDIDATE_SCHEMA,
    candidateId: `candidate-${providerId}-${resourceId}`,
    work: { workId, title, authors: [], languages: [], subjects: [], identifiers },
    editions: [{ editionId, title, language: '', publisher: '', publishedAt: '', identifiers, description: '' }],
    offers: [offer],
    rights: {
      status: 'unknown', licenseId: '', rightsStatement: '', jurisdiction: '', evidenceUrl: '',
      assertedBy: providerId, checkedAt: observedAt, confidence: null,
    },
    provenance: [{ providerId, resourceId, pageUrl: '', observedAt, adapterVersion: `${providerId}-v1` }],
  });
}

async function withWorkspace(action) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w93d-'));
  const workspace = fs.realpathSync.native ? fs.realpathSync.native(base) : fs.realpathSync(base);
  try { return await action(workspace); }
  finally { fs.rmSync(base, { recursive: true, force: true }); }
}

test('catalog client pins public DNS, strips validators on redirect and emits a contact User-Agent', async () => {
  const calls = [];
  const client = new LibraryCatalogHttpClient({
    resolver: publicResolver,
    productToken: 'MazzEditor/0.2',
    contact: 'ops@example.org',
    now: () => Date.parse(NOW),
    requester: async input => {
      calls.push(input);
      if (calls.length === 1) return response(302, { location: 'https://cdn.example.org/feed' }, '');
      return response(200, { 'content-type': 'application/atom+xml' }, OPDS1);
    },
  });
  const result = await client.get({
    providerId: 'fixture', url: 'https://catalog.example.org/feed', accept: pack.OPDS1_ACCEPT,
    etag: '"private-origin-validator"', minIntervalMs: 0,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['If-None-Match'], '"private-origin-validator"');
  assert.equal(calls[1].headers['If-None-Match'], undefined);
  assert.equal(calls[1].headers.Authorization, undefined);
  assert.match(calls[0].headers['User-Agent'], /^MazzEditor\/0\.2 \(\+ops@example\.org\)$/);
  assert.equal(calls[0].address, '93.184.216.34');
  assert.deepEqual(client.close(), {
    closed: true, activeRequests: 0, queuedProviders: 0, timerCount: 0, listenerCount: 0,
  });
});

test('catalog client rejects private DNS, missing contact, rate violations and Retry-After without timers', async () => {
  assert.throws(() => new LibraryCatalogHttpClient({
    resolver: publicResolver, requester: async () => response(200, {}, ''), productToken: 'MazzEditor/0.2', contact: '',
  }), /contact/);
  const privateClient = new LibraryCatalogHttpClient({
    resolver: async () => [{ address: '127.0.0.1', family: 4 }],
    requester: async () => { throw new Error('must not request'); },
    productToken: 'MazzEditor/0.2', contact: 'ops@example.org', now: () => Date.parse(NOW),
  });
  await assert.rejects(privateClient.get({
    providerId: 'private', url: 'https://catalog.example.org/feed', accept: pack.OPDS1_ACCEPT,
  }), /unsafe|public|address|地址/i);
  privateClient.close();

  let calls = 0;
  const polite = new LibraryCatalogHttpClient({
    resolver: publicResolver, requester: async () => {
      calls += 1;
      return response(calls === 1 ? 200 : 503, calls === 1
        ? { 'content-type': 'application/atom+xml' }
        : { 'retry-after': '120' }, calls === 1 ? OPDS1 : '');
    },
    productToken: 'MazzEditor/0.2', contact: 'https://example.org/contact', now: () => Date.parse(NOW),
  });
  await polite.get({ providerId: 'polite', url: 'https://catalog.example.org/feed', accept: pack.OPDS1_ACCEPT, minIntervalMs: 2000 });
  await assert.rejects(polite.get({
    providerId: 'polite', url: 'https://catalog.example.org/feed', accept: pack.OPDS1_ACCEPT, minIntervalMs: 2000,
  }), error => error.code === 'LIBRARY_CATALOG_RATE_LIMITED' && /2026-08-25T01:00:02/.test(error.availableAt));
  await assert.rejects(polite.get({
    providerId: 'retry', url: 'https://catalog.example.org/feed', accept: pack.OPDS1_ACCEPT,
  }), error => error.code === 'LIBRARY_CATALOG_RETRY_LATER' && /2026-08-25T01:02:00/.test(error.availableAt));
  assert.equal(polite.snapshot().timerCount, 0);
  polite.close();
});

test('OPDS1 parser and adapter preserve all supported offers, next cursor and strict feed semantics', async () => {
  const parsed = pack.parseOpds1(Buffer.from(OPDS1), 'https://catalog.example.org/search?q=pride');
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.nextUrl, 'https://catalog.example.org/search?q=pride&page=2');
  assert.throws(() => pack.parseOpds1(Buffer.from(OPDS1.replace('<updated>2026-08-01T00:00:00Z</updated>', '')), 'https://catalog.example.org/feed'), /id\/title\/updated/);
  assert.throws(() => pack.parseOpds1(Buffer.from('<!DOCTYPE feed><feed/>'), 'https://catalog.example.org/feed'), /DTD|ENTITY/);

  const calls = [];
  const adapter = new pack.OpdsLibrarySourceAdapter({
    descriptor: descriptor('opds-one'),
    client: { get: async request => {
      calls.push(request);
      return { statusCode: 200, url: request.url, headers: { 'content-type': 'application/atom+xml' }, body: Buffer.from(OPDS1), notModified: false };
    } },
    rootUrl: 'https://catalog.example.org/root',
    searchTemplate: 'https://catalog.example.org/search?query={query}',
    version: '1.2', now: NOW,
  });
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  registry.register(adapter);
  const page = await registry.search('opds-one', { query: 'pride & prejudice' });
  assert.equal(page.candidates.length, 1);
  assert.equal(page.candidates[0].offers.length, 1);
  assert.equal(page.candidates[0].offers[0].format, 'epub');
  assert.equal(page.candidates[0].rights.status, 'unknown');
  assert.match(page.nextCursor, /^cursor-[a-f0-9]{64}$/);
  assert.match(calls[0].url, /pride%20%26%20prejudice/);
  await assert.rejects(registry.collect('opds-one', 'search', { query: 'pride' }), /用户明确继续/);
  registry.close();

  const badMime = new pack.OpdsLibrarySourceAdapter({
    descriptor: descriptor('bad-mime'),
    client: { get: async request => ({
      statusCode: 200, url: request.url, headers: { 'content-type': 'text/html' },
      body: Buffer.from('<html/>'), notModified: false,
    }) },
    rootUrl: 'https://catalog.example.org/root', searchTemplate: 'https://catalog.example.org/search?q={query}',
    version: '1.2', now: NOW,
  });
  const badMimeRegistry = new source.LibrarySourceRegistry({ now: NOW });
  badMimeRegistry.register(badMime);
  await assert.rejects(badMimeRegistry.search('bad-mime', { query: 'x' }), /MIME/);
  badMimeRegistry.close();
});

test('OPDS2 parses publications and groups, filters preview links and supports query URI templates', async () => {
  const adapter = new pack.OpdsLibrarySourceAdapter({
    descriptor: descriptor('opds-two'),
    client: { get: async request => ({
      statusCode: 200, url: request.url, headers: { 'content-type': 'application/opds+json; charset=utf-8' },
      body: Buffer.from(OPDS2), notModified: false,
    }) },
    rootUrl: 'https://json.example.org/opds',
    searchTemplate: 'https://json.example.org/opds{?query}',
    version: '2.0', now: NOW,
  });
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  registry.register(adapter);
  const page = await registry.search('opds-two', { query: 'pride' });
  assert.equal(page.candidates.length, 1);
  assert.equal(page.candidates[0].offers.length, 1);
  assert.equal(page.candidates[0].offers[0].format, 'pdf');
  assert.match(page.nextCursor, /^cursor-/);
  assert.throws(() => pack.parseOpds2(Buffer.from('{broken'), 'https://json.example.org/opds'), /JSON/);
  assert.throws(() => pack.parseOpds2({
    metadata: { title: 'Bad' },
    links: [{ rel: 'self', href: 'https://json.example.org/opds' }],
    publications: [{ metadata: { identifier: 'urn:uuid:no-title' }, links: [] }],
  }, 'https://json.example.org/opds'), /title\/identifier/);
  registry.close();
});

test('Gutenberg adapter freezes official US evidence and user-driven single-page access', async () => {
  const gutenbergXml = OPDS1
    .replaceAll('https://catalog.example.org', 'https://www.gutenberg.org')
    .replace('urn:uuid:pride-fixture', 'https://www.gutenberg.org/ebooks/1342')
    .replace('https://files.example.org/pride.epub', 'https://www.gutenberg.org/cache/epub/1342/pg1342.epub');
  const calls = [];
  const adapter = new pack.GutenbergLibrarySourceAdapter({
    client: { get: async request => {
      calls.push(request);
      return { statusCode: 200, url: request.url, headers: { 'content-type': 'application/atom+xml' }, body: Buffer.from(gutenbergXml), notModified: false };
    } },
    now: NOW, policyCheckedAt: POLICY_AT,
  });
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  const frozen = registry.register(adapter);
  assert.deepEqual(frozen.policy.jurisdictions, ['US']);
  assert.equal(registry.paginationMode('project-gutenberg'), 'user-driven');
  const page = await registry.search('project-gutenberg', { query: 'pride' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].minIntervalMs, 2000);
  assert.equal(page.candidates[0].rights.status, 'public-domain');
  assert.equal(page.candidates[0].rights.jurisdiction, 'US');
  assert.equal(page.candidates[0].rights.evidenceUrl, pack.GUTENBERG_TERMS);
  assert.equal(page.candidates[0].provenance[0].pageUrl, 'https://www.gutenberg.org/ebooks/1342');
  const conflicted = gutenbergXml.replace(
    '<summary>A fixture description.</summary>',
    '<rights>Copyrighted; all rights reserved.</rights><summary>A fixture description.</summary>',
  );
  const conflictAdapter = new pack.GutenbergLibrarySourceAdapter({
    client: { get: async request => ({
      statusCode: 200, url: request.url, headers: { 'content-type': 'application/atom+xml' },
      body: Buffer.from(conflicted), notModified: false,
    }) },
    now: NOW, policyCheckedAt: POLICY_AT,
  });
  const conflictRegistry = new source.LibrarySourceRegistry({ now: NOW });
  conflictRegistry.register(conflictAdapter);
  const conflictPage = await conflictRegistry.search('project-gutenberg', { query: 'conflict' });
  assert.equal(conflictPage.candidates[0].rights.status, 'unknown');
  conflictRegistry.close();
  await assert.rejects(registry.collect('project-gutenberg', 'search', { query: 'pride' }), /用户明确继续/);
  registry.close();
});

test('manual HTTPS creates only an unknown-rights candidate and rejects secrets/types/private URLs', () => {
  const candidate = pack.createManualHttpsCandidate({
    url: 'https://files.example.org/book.epub', format: 'epub', title: 'Manual Book',
    authors: ['Author'], language: 'zh', observedAt: NOW,
  });
  assert.equal(candidate.rights.status, 'unknown');
  assert.equal(candidate.offers[0].providerId, 'manual-https');
  assert.equal(candidate.offers[0].sourceUrl, 'https://files.example.org/book.epub');
  for (const invalid of [
    { url: 'https://127.0.0.1/book.epub', format: 'epub', title: 'Bad', observedAt: NOW },
    { url: 'https://files.example.org/book.epub?token=secret-value', format: 'epub', title: 'Bad', observedAt: NOW },
    { url: 'https://files.example.org/book.exe', format: 'exe', title: 'Bad', observedAt: NOW },
    { url: 'https://files.example.org/book.epub', format: 'epub', title: 'Bad', authors: false, observedAt: NOW },
    { url: 'https://files.example.org/book.epub', format: 'epub', title: 'Bad', workIdentifiers: false, observedAt: NOW },
  ]) assert.throws(() => pack.createManualHttpsCandidate(invalid));
});

class PagedAdapter {
  constructor(providerId, pages, { fail = false } = {}) {
    this._descriptor = source.normalizeDescriptor(descriptor(providerId, { capabilities: ['search'] }), { now: NOW });
    this.paginationMode = 'user-driven';
    this.pages = pages;
    this.fail = fail;
    this.calls = 0;
    this.urls = new Map();
  }
  descriptor() { return this._descriptor; }
  search(request) {
    this.calls += 1;
    if (this.fail) {
      const error = new Error('response token=must-not-enter-failure');
      error.code = 'REMOTE_DOWN';
      throw error;
    }
    const index = request.cursor === null ? 0 : Number(request.cursor.split('-').at(-1));
    const candidates = this.pages[index] || [];
    const next = index + 1 < this.pages.length ? `cursor-${this._descriptor.providerId}-${index + 1}` : null;
    if (next) this.urls.set(next, `https://${this._descriptor.providerId}.example.org/page/${index + 1}`);
    return {
      schema: source.PAGE_SCHEMA, providerId: this._descriptor.providerId,
      adapterVersion: this._descriptor.adapterVersion, policyVersion: this._descriptor.policy.policyVersion,
      candidates, nextCursor: next,
    };
  }
  cursorRecord(cursor) { return { cursorToken: cursor, nextUrl: this.urls.get(cursor) }; }
  restoreCursor(record) { this.urls.set(record.cursorToken, record.nextUrl); return record.cursorToken; }
}

test('federated discovery performs exactly one page per provider, groups only strong work IDs and sanitizes failures', async () => {
  const first = new PagedAdapter('first', [[
    makeCandidate('first', 'one', { title: 'Shared Identity', isbn: '9780306406157' }),
    makeCandidate('first', 'same-title', { title: 'Same Title' }),
  ], [makeCandidate('first', 'page-two')]]);
  const second = new PagedAdapter('second', [[
    makeCandidate('second', 'two', { title: 'Another Label', isbn: '9780306406157' }),
    makeCandidate('second', 'same-title', { title: 'Same Title' }),
  ]]);
  const failed = new PagedAdapter('failed', [], { fail: true });
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  registry.register(first); registry.register(second); registry.register(failed);
  const federated = new LibraryFederatedDiscovery({ registry });
  const result = await federated.search({ query: 'fixture' });
  assert.deepEqual([first.calls, second.calls, failed.calls], [1, 1, 1]);
  assert.equal(result.candidates.length, 4);
  assert.equal(result.groups.filter(group => group.candidates.length === 2).length, 1);
  assert.equal(result.groups.length, 3);
  assert.deepEqual(result.failures, [{ providerId: 'failed', code: 'REMOTE_DOWN' }]);
  assert.doesNotMatch(JSON.stringify(result.failures), /token|response|must-not/i);
  assert.deepEqual(result.continuations.map(item => item.providerId), ['first']);
  const secondPage = await federated.search({
    query: 'fixture', providers: ['first'], continuations: result.continuations,
  });
  assert.equal(secondPage.candidates[0].work.title, 'Fixture Book');
  assert.equal(first.calls, 2);
  federated.close(); registry.close();
});

test('333 user-driven continuations are complete without any hidden prefetch or page/count gate', async () => {
  const pages = Array.from({ length: 333 }, (_, index) => [makeCandidate('many', `book-${index}`)]);
  const adapter = new PagedAdapter('many', pages);
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  registry.register(adapter);
  const federated = new LibraryFederatedDiscovery({ registry });
  let continuations = [];
  const ids = new Set();
  for (let index = 0; index < 333; index += 1) {
    const result = await federated.search({ query: 'many', providers: ['many'], continuations });
    assert.equal(result.candidates.length, 1);
    ids.add(result.candidates[0].candidateId);
    continuations = result.continuations;
  }
  assert.equal(adapter.calls, 333);
  assert.equal(ids.size, 333);
  assert.deepEqual(continuations, []);
  federated.close(); registry.close();
});

test('checkpoint store is atomic, CAS-bound, reopenable, version-stale and corruption-blocking', async () => {
  await withWorkspace(async workspace => {
    const store = new LibrarySourceCheckpointStore({ workspacePath: workspace, now: () => NOW });
    const created = store.save({
      providerId: 'opds-one', adapterVersion: 'opds-one-v1', policyVersion: 'opds-one-policy-v1',
      query: 'pride', cursorToken: 'cursor-one', nextUrl: 'https://catalog.example.org/page/2',
      validator: '"opaque-etag"', expectedRevision: 0,
    });
    assert.equal(created.revision, 1);
    assert.match(created.queryHash, /^query-sha256-/);
    assert.match(created.validatorHash, /^validator-sha256-/);
    assert.doesNotMatch(JSON.stringify(created), /pride|opaque-etag/);
    assert.throws(() => store.save({
      providerId: 'opds-one', adapterVersion: 'opds-one-v1', policyVersion: 'opds-one-policy-v1',
      query: 'pride', cursorToken: null, nextUrl: '', expectedRevision: 0,
    }), /revision/);
    const reopened = new LibrarySourceCheckpointStore({ workspacePath: workspace, now: () => NOW });
    const ready = reopened.load({
      providerId: 'opds-one', adapterVersion: 'opds-one-v1', policyVersion: 'opds-one-policy-v1', query: 'pride',
    });
    assert.equal(ready.status, 'ready');
    assert.equal(ready.record.nextUrl, 'https://catalog.example.org/page/2');
    assert.equal(reopened.load({
      providerId: 'opds-one', adapterVersion: 'opds-one-v2', policyVersion: 'opds-one-policy-v1', query: 'pride',
    }).status, 'stale');
    const replaced = reopened.save({
      providerId: 'opds-one', adapterVersion: 'opds-one-v2', policyVersion: 'opds-one-policy-v2',
      query: 'pride', cursorToken: null, nextUrl: '', expectedRevision: ready.record.revision,
    });
    assert.equal(replaced.revision, 2);
    assert.equal(reopened.load({
      providerId: 'opds-one', adapterVersion: 'opds-one-v2', policyVersion: 'opds-one-policy-v2', query: 'pride',
    }).status, 'ready');
    const target = path.join(reopened.sourcesRoot, ready.record.checkpointId + '.json');
    fs.writeFileSync(target, '{broken', 'utf8');
    const corrupt = new LibrarySourceCheckpointStore({ workspacePath: workspace, now: () => NOW });
    assert.equal(corrupt.listCorruptions().length, 1);
    assert.throws(() => corrupt.load({
      providerId: 'opds-one', adapterVersion: 'opds-one-v1', policyVersion: 'opds-one-policy-v1', query: 'pride',
    }), /修复/);
    assert.equal(fs.readFileSync(target, 'utf8'), '{broken');
  });
});

test('cancelled federation calls never advance a durable checkpoint', async () => {
  await withWorkspace(async workspace => {
    const store = new LibrarySourceCheckpointStore({ workspacePath: workspace, now: () => NOW });
    const adapter = new PagedAdapter('cancelled', [[makeCandidate('cancelled', 'one')]]);
    const registry = new source.LibrarySourceRegistry({ now: NOW });
    registry.register(adapter);
    const federated = new LibraryFederatedDiscovery({ registry, checkpointStore: store });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(federated.search({
      query: 'cancelled', providers: ['cancelled'], signal: controller.signal,
    }), /取消/);
    assert.equal(store.list().length, 0);
    assert.equal(adapter.calls, 0);
    federated.close(); registry.close(); store.close();
  });
});

test('federated continuation survives process-local cursor loss through durable checkpoint restore', async () => {
  await withWorkspace(async workspace => {
    const store = new LibrarySourceCheckpointStore({ workspacePath: workspace, now: () => NOW });
    const firstAdapter = new PagedAdapter('durable', [
      [makeCandidate('durable', 'one')], [makeCandidate('durable', 'two')],
    ]);
    const firstRegistry = new source.LibrarySourceRegistry({ now: NOW });
    firstRegistry.register(firstAdapter);
    const first = new LibraryFederatedDiscovery({ registry: firstRegistry, checkpointStore: store });
    const pageOne = await first.search({ query: 'restart', providers: ['durable'] });
    first.close(); firstRegistry.close();

    const reopenedStore = new LibrarySourceCheckpointStore({ workspacePath: workspace, now: () => NOW });
    const secondAdapter = new PagedAdapter('durable', [
      [makeCandidate('durable', 'one')], [makeCandidate('durable', 'two')],
    ]);
    const secondRegistry = new source.LibrarySourceRegistry({ now: NOW });
    secondRegistry.register(secondAdapter);
    const second = new LibraryFederatedDiscovery({ registry: secondRegistry, checkpointStore: reopenedStore });
    const pageTwo = await second.search({
      query: 'restart', providers: ['durable'], continuations: pageOne.continuations,
    });
    assert.equal(pageTwo.candidates[0].work.title, 'Fixture Book');
    assert.equal(secondAdapter.calls, 1);
    assert.deepEqual(pageTwo.continuations, []);
    second.close(); secondRegistry.close();
  });
});

test('W93D modules default to zero network/timers and contain no business page/item/token/file-size cap', () => {
  for (const file of [
    'main/library-catalog-http-client.js',
    'main/library-source-pack.js',
    'main/library-federated-discovery.js',
    'main/library-source-checkpoint-store.js',
  ]) {
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(text, /\b(?:fetch|https?\.request|net\.connect|setInterval|setTimeout)\s*\(/);
    assert.doesNotMatch(text, /max(?:Pages|Items|Candidates|Tokens|Bytes)|slice\(0,\s*\d+\)/i);
  }
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  const federated = new LibraryFederatedDiscovery({ registry });
  assert.equal(federated.snapshot().networkOwnerCount, 0);
  federated.close(); registry.close();
});
