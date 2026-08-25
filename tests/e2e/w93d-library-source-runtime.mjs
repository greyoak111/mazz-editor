import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { extractFile: extractAsarFile, listPackage: listAsarPackage } = require('@electron/asar');
const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), '..', '..');
const REPORT_PREFIX = 'W93D_RUNTIME_REPORT=';
const NOW = '2026-08-25T08:00:00.000Z';

function sha256Bytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function sha256(file) { return sha256Bytes(fs.readFileSync(file)); }
function packagedEntry(moduleRoot, name) { return { asarPath: path.dirname(moduleRoot), entry: `main/${name}` }; }
function moduleFileExists(mode, moduleRoot, name) {
  if (mode === 'source') return fs.existsSync(path.join(moduleRoot, name));
  const { asarPath, entry } = packagedEntry(moduleRoot, name);
  if (!fs.existsSync(asarPath)) return false;
  const entries = new Set(listAsarPackage(asarPath).map(item => item.replace(/^[/\\]/, '').replace(/\\/g, '/')));
  return entries.has(entry);
}
function moduleFileHash(mode, moduleRoot, name) {
  if (mode === 'source') return sha256(path.join(moduleRoot, name));
  const { asarPath, entry } = packagedEntry(moduleRoot, name);
  return sha256Bytes(extractAsarFile(asarPath, entry));
}

function descriptor(source, providerId, version) {
  return {
    schema: source.DESCRIPTOR_SCHEMA,
    providerId,
    displayName: providerId,
    adapterVersion: `${providerId}-v1`,
    capabilities: ['discover', 'health', 'resolve', 'search'],
    policy: {
      policyVersion: `${providerId}-policy-v1`, checkedAt: '2026-08-25T00:00:00.000Z',
      jurisdictions: [], rightsModes: ['unknown'], termsUrl: '', rightsUrl: '',
    },
  };
}

function opds1({ host = 'catalog.example.org', id = 'urn:uuid:runtime-one', next = true, gutenberg = false } = {}) {
  const sourceId = gutenberg ? 'https://www.gutenberg.org/ebooks/1342' : id;
  const file = gutenberg
    ? 'https://www.gutenberg.org/cache/epub/1342/pg1342.epub'
    : `https://files.example.org/${encodeURIComponent(id)}.epub`;
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">
  <title>Runtime OPDS1</title><link rel="self" href="https://${host}/feed" />
  ${next ? `<link rel="next" href="https://${host}/feed?page=2" />` : ''}
  <entry><id>${sourceId}</id><title>Runtime Shared Work</title><updated>2026-08-01T00:00:00Z</updated>
  <author><name>Runtime Author</name></author><dc:language>en</dc:language>
  <dc:identifier>urn:isbn:9780306406157</dc:identifier>
  <link rel="http://opds-spec.org/acquisition/open-access" href="${file}" type="application/epub+zip" /></entry></feed>`;
}

function opds2(next = true) {
  return JSON.stringify({
    metadata: { title: 'Runtime OPDS2' },
    links: [
      { rel: 'self', href: 'https://json.example.org/feed' },
      ...(next ? [{ rel: 'next', href: 'https://json.example.org/feed?page=2' }] : []),
    ],
    publications: [{
      metadata: { title: 'Runtime Shared Work', identifier: 'urn:isbn:9780306406157', author: 'Runtime Author', language: 'en' },
      links: [{ rel: 'download', href: 'https://files.example.org/runtime.pdf', type: 'application/pdf' }],
    }],
  });
}

function response(statusCode, headers, body) {
  return { statusCode, headers, body: Readable.from([Buffer.from(body)]) };
}

async function childMain() {
  const mode = process.argv[process.argv.indexOf('--child-mode') + 1];
  const moduleRoot = path.resolve(process.argv[process.argv.indexOf('--module-root') + 1]);
  const network = { http: 0, https: 0, net: 0 };
  for (const [owner, names, key] of [
    [require('node:http'), ['request', 'get'], 'http'],
    [require('node:https'), ['request', 'get'], 'https'],
    [require('node:net'), ['connect', 'createConnection'], 'net'],
  ]) for (const name of names) owner[name] = () => {
    network[key] += 1;
    throw new Error(`W93D_OFFLINE_NETWORK_FORBIDDEN_${key.toUpperCase()}`);
  };

  const source = require(path.join(moduleRoot, 'library-source-registry.js'));
  const pack = require(path.join(moduleRoot, 'library-source-pack.js'));
  const { LibraryCatalogHttpClient } = require(path.join(moduleRoot, 'library-catalog-http-client.js'));
  const { LibrarySourceCheckpointStore } = require(path.join(moduleRoot, 'library-source-checkpoint-store.js'));
  const { LibraryFederatedDiscovery } = require(path.join(moduleRoot, 'library-federated-discovery.js'));
  const requestLog = [];
  const catalog = new LibraryCatalogHttpClient({
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    requester: async input => {
      requestLog.push({ url: input.url, userAgent: input.headers['User-Agent'] });
      const url = new URL(input.url);
      const terminal = url.searchParams.get('page') === '2';
      if (url.hostname === 'catalog.example.org') {
        return response(200, { 'content-type': 'application/atom+xml' }, opds1({ next: !terminal, id: terminal ? 'urn:uuid:runtime-page-two' : 'urn:uuid:runtime-one' }));
      }
      if (url.hostname === 'json.example.org') {
        return response(200, { 'content-type': 'application/opds+json' }, opds2(!terminal));
      }
      if (url.hostname === 'www.gutenberg.org') {
        return response(200, { 'content-type': 'application/atom+xml' }, opds1({ host: 'www.gutenberg.org', next: false, gutenberg: true }));
      }
      throw new Error('unexpected fixture URL');
    },
    productToken: 'MazzEditor/0.2', contact: 'ops@example.org', now: () => Date.parse(NOW),
  });

  const createdWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w93d-${mode}-`));
  const workspace = fs.realpathSync.native(createdWorkspace);
  let cleanup = false;
  let report;
  try {
    const registry = new source.LibrarySourceRegistry({ now: NOW });
    registry.register(new pack.OpdsLibrarySourceAdapter({
      descriptor: descriptor(source, 'opds-one', '1.2'), client: catalog,
      rootUrl: 'https://catalog.example.org/feed', searchTemplate: 'https://catalog.example.org/feed?query={query}',
      version: '1.2', now: NOW,
    }));
    registry.register(new pack.OpdsLibrarySourceAdapter({
      descriptor: descriptor(source, 'opds-two', '2.0'), client: catalog,
      rootUrl: 'https://json.example.org/feed', searchTemplate: 'https://json.example.org/feed{?query}',
      version: '2.0', now: NOW,
    }));
    const checkpoints = new LibrarySourceCheckpointStore({ workspacePath: workspace, now: () => NOW });
    const federated = new LibraryFederatedDiscovery({ registry, checkpointStore: checkpoints });
    const first = await federated.search({ query: 'runtime' });
    assert.equal(first.candidates.length, 2);
    assert.equal(first.groups.length, 1);
    assert.equal(first.continuations.length, 2);
    const opdsOneContinuation = first.continuations.filter(item => item.providerId === 'opds-one');
    assert.equal(opdsOneContinuation.length, 1);
    federated.close(); registry.close(); checkpoints.close();

    const reopenedRegistry = new source.LibrarySourceRegistry({ now: NOW });
    reopenedRegistry.register(new pack.OpdsLibrarySourceAdapter({
      descriptor: descriptor(source, 'opds-one', '1.2'), client: catalog,
      rootUrl: 'https://catalog.example.org/feed', searchTemplate: 'https://catalog.example.org/feed?query={query}',
      version: '1.2', now: NOW,
    }));
    const reopenedCheckpoints = new LibrarySourceCheckpointStore({ workspacePath: workspace, now: () => NOW });
    const durableCursor = reopenedCheckpoints.load({
      providerId: 'opds-one', adapterVersion: 'opds-one-v1', policyVersion: 'opds-one-policy-v1', query: 'runtime',
    });
    assert.equal(durableCursor.status, 'ready');
    reopenedRegistry.restoreCursor('opds-one', {
      cursorToken: durableCursor.record.cursorToken,
      nextUrl: durableCursor.record.nextUrl,
    });
    const reopenedFederated = new LibraryFederatedDiscovery({ registry: reopenedRegistry, checkpointStore: reopenedCheckpoints });
    const second = await reopenedFederated.search({
      query: 'runtime', providers: ['opds-one'], continuations: opdsOneContinuation,
    });
    assert.equal(second.candidates.length, 1, JSON.stringify(second));
    assert.equal(second.continuations.length, 0);

    const gutenbergRegistry = new source.LibrarySourceRegistry({ now: NOW });
    gutenbergRegistry.register(new pack.GutenbergLibrarySourceAdapter({ client: catalog, now: NOW, policyCheckedAt: NOW }));
    const gutenberg = await gutenbergRegistry.search('project-gutenberg', { query: 'pride' });
    assert.equal(gutenberg.candidates[0].rights.status, 'public-domain');
    assert.equal(gutenberg.candidates[0].rights.jurisdiction, 'US');
    const manual = pack.createManualHttpsCandidate({
      url: 'https://files.example.org/manual.epub', format: 'epub', title: 'Manual Runtime', observedAt: NOW,
    });
    assert.equal(manual.rights.status, 'unknown');

    const reopenedSnapshot = reopenedFederated.close();
    const registrySnapshot = reopenedRegistry.close();
    const gutenbergSnapshot = gutenbergRegistry.close();
    const checkpointSnapshot = reopenedCheckpoints.close();
    const catalogSnapshot = catalog.close();
    assert.deepEqual(network, { http: 0, https: 0, net: 0 });
    assert.equal(requestLog.every(item => /^MazzEditor\/0\.2 \(\+ops@example\.org\)$/.test(item.userAgent)), true);
    for (const snapshot of [reopenedSnapshot, registrySnapshot, gutenbergSnapshot, checkpointSnapshot, catalogSnapshot]) {
      assert.equal(snapshot.timerCount, 0);
      assert.equal(snapshot.listenerCount, 0);
      assert.equal(snapshot.networkOwnerCount || 0, 0);
    }
    report = {
      schema: 'mazz.w93d-runtime/v1', mode, result: 'PASS', groupedCandidates: first.candidates.length,
      groupCount: first.groups.length, durableContinuation: second.candidates.length,
      gutenbergRights: gutenberg.candidates[0].rights.status, manualRights: manual.rights.status,
      requestCount: requestLog.length, network, resources: { registrySnapshot, checkpointSnapshot, catalogSnapshot },
      runtimeErrors: [],
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    cleanup = !fs.existsSync(workspace);
  }
  assert.equal(cleanup, true);
  report.cleanup = cleanup;
  process.stdout.write(`${REPORT_PREFIX}${JSON.stringify(report)}\n`);
}

function parseReport(stdout) {
  const line = stdout.split(/\r?\n/).find(item => item.startsWith(REPORT_PREFIX));
  if (!line) throw new Error(`W93D runtime report missing\n${stdout}`);
  return JSON.parse(line.slice(REPORT_PREFIX.length));
}

function runChild(mode, executable, moduleRoot) {
  const result = spawnSync(executable, [SCRIPT, '--child-mode', mode, '--module-root', moduleRoot], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MAZZ_E2E_ALLOW_LIVE_PROVIDER: '0' },
    encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`W93D ${mode} runtime failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  return parseReport(result.stdout);
}

async function parentMain() {
  const executableIndex = process.argv.indexOf('--executable');
  const packagedExecutable = executableIndex >= 0 ? process.argv[executableIndex + 1] : '';
  const mode = packagedExecutable ? 'packaged' : 'source';
  const executable = packagedExecutable ? path.resolve(packagedExecutable) : require('electron');
  const moduleRoot = packagedExecutable
    ? path.join(path.dirname(path.resolve(packagedExecutable)), 'resources', 'app.asar', 'main')
    : path.join(ROOT, 'main');
  const names = [
    'library-resource-contract.js', 'library-source-registry.js', 'library-source-pack.js',
    'library-catalog-http-client.js', 'library-source-checkpoint-store.js',
    'library-federated-discovery.js', 'library-acquisition-store.js', 'library-http-acquisition.js',
  ];
  for (const name of names) assert.equal(moduleFileExists(mode, moduleRoot, name), true, `${mode} missing ${name}`);
  const report = runChild(mode, executable, moduleRoot);
  assert.equal(report.result, 'PASS');
  assert.equal(report.groupedCandidates, 2);
  assert.equal(report.groupCount, 1);
  assert.equal(report.durableContinuation, 1);
  assert.deepEqual(report.network, { http: 0, https: 0, net: 0 });
  assert.equal(report.cleanup, true);
  const fileHashes = {};
  for (const name of names.slice(1, 6)) fileHashes[name] = moduleFileHash(mode, moduleRoot, name);
  process.stdout.write(`${JSON.stringify({ ...report, fileHashes })}\n`);
}

if (process.argv.includes('--child-mode')) {
  childMain().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
} else {
  parentMain().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}
