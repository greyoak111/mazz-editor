import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { extractFile: extractAsarFile, listPackage: listAsarPackage } = require('@electron/asar');
const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), '..', '..');
const REPORT_PREFIX = 'W93C_RUNTIME_REPORT=';
const NOW = '2026-08-25T08:00:00.000Z';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function packagedEntry(moduleRoot, name) {
  const asarPath = path.dirname(moduleRoot);
  const entry = `main/${name}`;
  return { asarPath, entry };
}

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
  return crypto.createHash('sha256').update(extractAsarFile(asarPath, entry)).digest('hex');
}

function descriptor(source) {
  return {
    schema: source.DESCRIPTOR_SCHEMA,
    providerId: 'fixture-source',
    displayName: 'Fixture Source',
    adapterVersion: 'fixture-v1',
    capabilities: ['discover', 'resolve', 'health'],
    policy: {
      policyVersion: 'policy-2026-08',
      checkedAt: '2026-08-01T00:00:00.000Z',
      jurisdictions: ['US'],
      rightsModes: ['public-domain'],
      termsUrl: 'https://example.org/terms',
      rightsUrl: 'https://example.org/rights',
    },
  };
}

function candidate(contract, resourceId) {
  const workIdentifiers = { ia: [`${resourceId}-work`] };
  const editionIdentifiers = { ia: [`${resourceId}-edition`] };
  const editionId = contract.deriveEditionId({ identifiers: editionIdentifiers });
  const offerBase = {
    editionId,
    providerId: 'fixture-source',
    resourceId,
    format: 'epub',
    transport: 'https',
    size: null,
    checksum: '',
    infoHash: '',
    sourceUrl: `https://example.org/books/${resourceId}.epub`,
    acquisitionRef: '',
    selectableFiles: [],
  };
  return {
    schema: contract.CANDIDATE_SCHEMA,
    candidateId: `candidate-${resourceId}`,
    work: {
      workId: contract.deriveWorkId({ identifiers: workIdentifiers }),
      title: `Runtime Fixture ${resourceId}`,
      authors: ['Fixture Author'],
      languages: ['en'],
      subjects: ['fixture'],
      identifiers: workIdentifiers,
    },
    editions: [{
      editionId,
      title: `Runtime Fixture ${resourceId}`,
      language: 'en',
      publisher: 'Fixture Press',
      publishedAt: '1900',
      identifiers: editionIdentifiers,
      description: 'Offline runtime fixture.',
    }],
    offers: [{ ...offerBase, offerId: contract.deriveOfferId(offerBase) }],
    rights: {
      status: 'public-domain',
      licenseId: 'PD-US',
      rightsStatement: 'Fixture source public-domain assertion for the selected jurisdiction.',
      jurisdiction: 'US',
      evidenceUrl: 'https://example.org/rights/public-domain',
      assertedBy: 'fixture-source',
      checkedAt: '2026-08-20T00:00:00.000Z',
      confidence: 1,
    },
    provenance: [{
      providerId: 'fixture-source',
      resourceId,
      pageUrl: `https://example.org/catalog/${resourceId}`,
      observedAt: '2026-08-20T00:00:00.000Z',
      adapterVersion: 'fixture-v1',
    }],
  };
}

function page(source, candidates, nextCursor = null) {
  return {
    schema: source.PAGE_SCHEMA,
    providerId: 'fixture-source',
    adapterVersion: 'fixture-v1',
    policyVersion: 'policy-2026-08',
    candidates,
    nextCursor,
  };
}

async function childMain() {
  const modeIndex = process.argv.indexOf('--child-mode');
  const rootIndex = process.argv.indexOf('--module-root');
  const mode = process.argv[modeIndex + 1];
  const moduleRoot = path.resolve(process.argv[rootIndex + 1]);
  const network = { http: 0, https: 0, net: 0 };
  const http = require('node:http');
  const https = require('node:https');
  const net = require('node:net');
  for (const [owner, names, key] of [
    [http, ['request', 'get'], 'http'],
    [https, ['request', 'get'], 'https'],
    [net, ['connect', 'createConnection'], 'net'],
  ]) {
    for (const name of names) {
      owner[name] = () => {
        network[key] += 1;
        throw new Error(`W93C_OFFLINE_NETWORK_FORBIDDEN_${key.toUpperCase()}`);
      };
    }
  }

  const contract = require(path.join(moduleRoot, 'library-resource-contract.js'));
  const source = require(path.join(moduleRoot, 'library-source-registry.js'));
  const rights = require(path.join(moduleRoot, 'library-rights-policy.js'));
  const Store = require(path.join(moduleRoot, 'library-acquisition-store.js'));
  const pages = [];
  for (let index = 0; index < 57; index += 1) {
    pages.push(page(source, [candidate(contract, `runtime-${index}`)], index === 56 ? null : `cursor-${index + 1}`));
  }
  const adapter = new source.FixtureLibrarySourceAdapter({
    descriptor: descriptor(source),
    discoverPages: pages,
    resolved: { 'runtime-0': candidate(contract, 'runtime-0') },
    now: NOW,
  });
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  registry.register(adapter);
  const collected = await registry.collect('fixture-source', 'discover');
  assert.equal(collected.length, 57);
  const resolved = await registry.resolve('fixture-source', { resourceId: 'runtime-0' });
  const decision = rights.evaluateRights({
    candidate: resolved,
    descriptor: descriptor(source),
    jurisdiction: 'US',
    now: NOW,
  });
  assert.equal(decision.outcome, 'pass');

  const createdWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w93c-${mode}-`));
  const workspace = fs.realpathSync.native(createdWorkspace);
  let cleanup = false;
  let durable;
  try {
    const store = new Store({ workspacePath: workspace, recoverOnOpen: false, now: () => NOW });
    const prepared = rights.prepareAcquisitionJob({
      jobId: 'job-runtime',
      intentId: 'intent-runtime',
      workspaceIdentity: store.workspaceIdentity,
      workspacePath: store.workspacePath,
      candidate: resolved,
      offerId: resolved.offers[0].offerId,
      descriptor: descriptor(source),
      jurisdiction: 'US',
      decision,
      selectedFiles: [],
      createdAt: NOW,
    });
    store.createJob(prepared, { candidate: resolved });
    const reopened = new Store({ workspacePath: workspace, recoverOnOpen: false, now: () => NOW });
    durable = reopened.getJob('job-runtime');
    assert.equal(durable.state, 'queued');
    assert.equal(durable.rightsReceipt.evidenceRef, decision.receipt.evidenceRef);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    cleanup = !fs.existsSync(workspace);
  }
  const beforeClose = registry.snapshot();
  const afterClose = registry.close();
  assert.deepEqual(network, { http: 0, https: 0, net: 0 });
  assert.equal(beforeClose.activeCalls, 0);
  assert.equal(afterClose.registeredCount, 0);
  assert.equal(afterClose.timerCount + afterClose.listenerCount + afterClose.networkOwnerCount, 0);
  assert.equal(cleanup, true);
  const report = {
    schema: 'mazz.w93c-runtime/v1',
    mode,
    result: 'PASS',
    candidates: collected.length,
    discoverCalls: adapter.snapshot().discover,
    decision: decision.outcome,
    durableState: durable.state,
    receiptBound: durable.rightsReceipt.evidenceRef === decision.receipt.evidenceRef,
    network,
    resources: afterClose,
    cleanup,
    runtimeErrors: [],
  };
  process.stdout.write(`${REPORT_PREFIX}${JSON.stringify(report)}\n`);
}

function parseReport(stdout) {
  const line = stdout.split(/\r?\n/).find(item => item.startsWith(REPORT_PREFIX));
  if (!line) throw new Error(`W93C runtime report missing\n${stdout}`);
  return JSON.parse(line.slice(REPORT_PREFIX.length));
}

function runtimeExecutable(explicit) {
  if (explicit) return path.resolve(explicit);
  return require('electron');
}

function runChild(mode, executable, moduleRoot) {
  const result = spawnSync(executable, [SCRIPT, '--child-mode', mode, '--module-root', moduleRoot], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MAZZ_E2E_ALLOW_LIVE_PROVIDER: '0',
    },
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`W93C ${mode} runtime failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return parseReport(result.stdout);
}

async function parentMain() {
  const executableIndex = process.argv.indexOf('--executable');
  const packagedExecutable = executableIndex >= 0 ? process.argv[executableIndex + 1] : '';
  const mode = packagedExecutable ? 'packaged' : 'source';
  const executable = runtimeExecutable(packagedExecutable);
  const moduleRoot = packagedExecutable
    ? path.join(path.dirname(path.resolve(packagedExecutable)), 'resources', 'app.asar', 'main')
    : path.join(ROOT, 'main');
  for (const name of [
    'library-resource-contract.js', 'library-source-registry.js',
    'library-rights-policy.js', 'library-acquisition-store.js',
  ]) {
    assert.equal(moduleFileExists(mode, moduleRoot, name), true, `${mode} missing ${name}`);
  }
  const report = runChild(mode, executable, moduleRoot);
  assert.equal(report.result, 'PASS');
  assert.equal(report.candidates, 57);
  assert.equal(report.discoverCalls, 57);
  assert.deepEqual(report.network, { http: 0, https: 0, net: 0 });
  assert.equal(report.resources.activeCalls, 0);
  assert.equal(report.resources.registeredCount, 0);
  assert.equal(report.cleanup, true);

  const fileHashes = {};
  for (const name of ['library-source-registry.js', 'library-rights-policy.js']) {
    fileHashes[name] = moduleFileHash(mode, moduleRoot, name);
  }
  process.stdout.write(`${JSON.stringify({ ...report, fileHashes })}\n`);
}

if (process.argv.includes('--child-mode')) {
  childMain().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
} else {
  parentMain().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
