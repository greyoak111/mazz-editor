// W94E：两个真实 Electron Mazz 实例的 Relation/Branch/State-fact A/B 运行边界
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const ROOT = path.resolve('.');
const executableIndex = process.argv.indexOf('--executable');
const EXECUTABLE = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : '';
const MODE = EXECUTABLE ? 'packaged' : 'source';
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence', `W94E_RELATION_BRANCH_DUAL_${MODE.toUpperCase()}.json`);
const WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94e-dual-${MODE}-workspace-`)));
const USER_DATA_A = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94e-dual-${MODE}-a-`)));
const USER_DATA_B = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94e-dual-${MODE}-b-`)));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function removeTempDirectory(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === 19) throw error;
      await delay(250);
    }
  }
}

function settings(userData) {
  fs.writeFileSync(path.join(userData, 'mazz-settings.json'), `${JSON.stringify({
    workspace: WORKSPACE,
    closeBehavior: 'quit',
    'agreement.noMore': true,
  }, null, 2)}\n`, 'utf8');
}

function launchOptions(userData) {
  const options = {
    args: EXECUTABLE ? [] : [ROOT],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: WORKSPACE,
      MAZZ_E2E_DISABLE_GPU: '1',
    },
    timeout: 120000,
  };
  if (EXECUTABLE) options.executablePath = EXECUTABLE;
  return options;
}

const errors = [];
const products = [];

function track(app, label) {
  app.process().stderr?.on('data', chunk => {
    const text = String(chunk);
    if (/uncaught|TypeError|ReferenceError|UnhandledPromiseRejection|FATAL/i.test(text)) errors.push(`${label}: ${text.trim()}`);
  });
}

async function openProduct(userData, label) {
  settings(userData);
  const app = await electron.launch(launchOptions(userData));
  track(app, label);
  const page = await app.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));
  products.push(app);
  return { app, page, label };
}

function invoke(product, channel, payload = {}) {
  return product.page.evaluate(({ channel, payload }) => window.mazz.invoke(channel, payload), { channel, payload });
}

async function resourceSnapshot(product) {
  return product.app.evaluate(() => globalThis.__MAZZ_E2E_RESOURCE_LEDGER__?.snapshot?.() || { active: [], activeCount: 0, byType: {} });
}

let report = null;
let host = null;
try {
  const a = await openProduct(USER_DATA_A, 'mazz-a');
  const b = await openProduct(USER_DATA_B, 'mazz-b');

  const captured = await invoke(a, 'events:capture', {
    idempotencyKey: 'w94e:dual:save',
    occurredAt: '2026-08-28T00:00:00.000Z',
    actorType: 'human', sourceModule: 'calc', action: 'save',
    subjectRefs: ['artifact:dual-sheet'], objectRefs: [], contextRefs: ['context:w94e-dual'],
    outcome: 'success', provenance: { source: 'w94e-dual-runtime' }, summary: 'dual runtime operational event', retentionClass: 'keep',
  });
  assert.equal(captured.recorded, true);

  // B reads A's durable Workspace Event Ledger and writes the human negative fact.
  const query = { schema: 'mazz.recollection-query/v0', queryId: 'query:w94e-dual', semanticHints: ['save'], relationRefs: [], currentContextRefs: [], limit: 20 };
  const bFirst = await invoke(b, 'relation:query', { query });
  assert.equal(bFirst.workspaceId, await invoke(a, 'relation:snapshot').then(snapshot => snapshot.workspaceId));
  assert.ok(bFirst.candidates.length >= 1);
  const candidateRef = bFirst.candidates[0].candidateRef;
  const rejection = await invoke(b, 'relation:rejectCandidate', { queryId: query.queryId, candidateRef, authorityRef: 'human:w94e-dual', reason: 'dual runtime negative fact' });
  assert.equal(rejection.rejected, true);
  const aReplay = await invoke(a, 'relation:query', { query });
  assert.equal(aReplay.candidates.some(row => row.candidateRef === candidateRef), false);

  // A mutates the durable branch store; B rebuilds the same Workspace projection.
  const left = await invoke(a, 'branch:create', { branchId: 'branch:dual-left', revisions: [{ domain: 'calc', artifactRef: 'artifact:dual-sheet', revision: 'rev:left', status: 'current' }], provenance: { source: 'w94e-dual-runtime' } });
  const right = await invoke(a, 'branch:create', { branchId: 'branch:dual-right', revisions: [{ domain: 'calc', artifactRef: 'artifact:dual-sheet', revision: 'rev:right', status: 'current' }], provenance: { source: 'w94e-dual-runtime' }, expectedRevision: left.revision });
  const merge = await invoke(a, 'branch:create', { branchId: 'branch:dual-merge', parentBranchIds: ['branch:dual-left', 'branch:dual-right'], revisions: [], provenance: { source: 'w94e-dual-runtime' }, expectedRevision: right.revision });
  const bConflict = await invoke(b, 'branch:snapshot');
  const bConflictState = bConflict.effectiveStates.find(row => row.branchId === 'branch:dual-merge');
  assert.equal(bConflictState.conflicts.length, 1);
  const resolved = await invoke(a, 'branch:resolveConflict', { key: 'calc:dual-sheet', resolvedRevision: 'rev:right', previousRevisions: ['rev:left', 'rev:right'], authorityRef: 'human:w94e-dual', reason: 'dual runtime human resolution', sourceRefs: ['branch:dual-merge'], expectedRevision: merge.revision });
  assert.equal(resolved.resolution.authorityRef, 'human:w94e-dual');
  const bFinal = await invoke(b, 'branch:rebuild');
  const bFinalState = bFinal.effectiveStates.find(row => row.branchId === 'branch:dual-merge');
  assert.equal(bFinalState.conflicts.length, 0);
  assert.equal(bFinalState.facts[0].revision, 'rev:right');

  // State facts use the existing TLS pairing track, never the file frame.
  const stateFact = await invoke(a, 'sync:stateFactPut', { factKind: 'branch', factId: 'branch:dual-merge', revision: 'rev:right', payloadRef: 'artifact:dual-sheet' });
  assert.equal(stateFact.accepted, true);
  host = await invoke(a, 'sync:host', { port: 0 });
  assert.ok(host.port > 0 && host.pairCode);
  const joined = await invoke(b, 'sync:join', { host: '127.0.0.1', port: host.port, pairCode: host.pairCode });
  assert.equal(joined.stateFactConflicts.length, 0);
  const bFacts = await invoke(b, 'sync:stateFacts');
  assert.equal(bFacts.length, 1);
  assert.equal(bFacts[0].factId, 'branch:dual-merge');
  assert.equal(bFacts[0].revision, 'rev:right');
  await invoke(a, 'sync:stopHost');
  host = null;

  const resourcesA = await resourceSnapshot(a);
  const resourcesB = await resourceSnapshot(b);
  assert.equal((resourcesA.active || []).filter(row => row.type === 'external-tool-process').length, 0);
  assert.equal((resourcesB.active || []).filter(row => row.type === 'external-tool-process').length, 0);
  assert.deepEqual(errors, []);

  report = {
    schema: 'mazz.w94e-relation-branch-dual-runtime/v1', mode: MODE, result: 'PASS', secondMazzRuntime: true,
    workspace: { sameIdentity: true, workspacePathExposed: false },
    relation: { producer: 'mazz-a', consumer: 'mazz-b', candidateCount: bFirst.candidates.length, rejectedAfterReplay: aReplay.candidates.every(row => row.candidateRef !== candidateRef), humanAuthority: rejection.entry.authorityRef },
    branch: { producer: 'mazz-a', consumer: 'mazz-b', conflictCountBeforeResolution: bConflictState.conflicts.length, conflictCountAfterResolution: bFinalState.conflicts.length, resolvedRevision: bFinalState.facts[0].revision },
    stateFacts: { tlsLoopback: true, fileFramesSeparate: true, acceptedOnB: bFacts.length, factId: bFacts[0].factId },
    resources: { aActiveCount: resourcesA.activeCount, bActiveCount: resourcesB.activeCount },
    runtimeErrors: errors,
    executableSha256: EXECUTABLE ? sha256File(EXECUTABLE) : null,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
} finally {
  if (host) {
    try { await products[0]?.evaluate(() => window.mazz.invoke('sync:stopHost')); } catch {}
  }
  for (const app of [...products]) {
    const closed = await Promise.race([app.close().then(() => true), delay(30000).then(() => false)]).catch(() => false);
    if (!closed) { try { app.process().kill(); } catch {} }
  }
  await removeTempDirectory(USER_DATA_A);
  await removeTempDirectory(USER_DATA_B);
  await removeTempDirectory(WORKSPACE);
}

assert.ok(report);
process.stdout.write(`W94E_DUAL_RUNTIME_REPORT=${JSON.stringify(report)}\n`);
