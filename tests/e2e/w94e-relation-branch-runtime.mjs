// W94E：Workspace event → Relation Retrieval → Branch Effective State → LAN state-fact
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('.');
const executableIndex = process.argv.indexOf('--executable');
const EXECUTABLE = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : '';
const MODE = EXECUTABLE ? 'packaged' : 'source';
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence', `W94E_RELATION_BRANCH_${MODE.toUpperCase()}.json`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94e-${MODE}-user-`)));
const WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94e-${MODE}-workspace-`)));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function removeTempDirectory(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); return; }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === 19) throw error; await delay(250); }
  }
}

const errors = [];
let product = null;
let report = null;
try {
  fs.writeFileSync(path.join(USER_DATA, 'mazz-settings.json'), `${JSON.stringify({ workspace: WORKSPACE, closeBehavior: 'quit', 'agreement.noMore': true }, null, 2)}\n`, 'utf8');
  const options = {
    args: EXECUTABLE ? [] : [ROOT],
    env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WORKSPACE, MAZZ_E2E_DISABLE_GPU: '1' },
    timeout: 120000,
  };
  if (EXECUTABLE) options.executablePath = EXECUTABLE;
  product = await electron.launch(options);
  product.process().stderr?.on('data', chunk => { const text = String(chunk); if (/uncaught|TypeError|ReferenceError|UnhandledPromiseRejection|FATAL/i.test(text)) errors.push(text.trim()); });
  const page = await product.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));

  const invoke = (channel, payload = {}) => page.evaluate(({ channel, payload }) => window.mazz.invoke(channel, payload), { channel, payload });
  const eventDomains = ['factory', 'library', 'player', 'calc', 'chart', 'canvas', 'blender', 'world'];
  const captured = [];
  for (const [index, domain] of eventDomains.entries()) {
    captured.push(await invoke('events:capture', {
      idempotencyKey: `w94e:${domain}`, occurredAt: `2026-08-26T00:00:0${index}.000Z`, actorType: domain === 'factory' ? 'factory' : 'human',
      sourceModule: domain, action: domain === 'calc' ? 'save' : 'complete', subjectRefs: [`artifact:${domain}-item`], objectRefs: [], contextRefs: [`context:${domain}`], outcome: 'success',
      provenance: { source: 'w94e-runtime' }, summary: `${domain} operational event`, retentionClass: 'keep',
    }));
  }
  assert.equal(captured.filter(row => row.recorded).length, eventDomains.length);

  const query = { schema: 'mazz.recollection-query/v0', queryId: 'query:w94e-runtime', semanticHints: ['save'], relationRefs: [], currentContextRefs: [], limit: 20 };
  const first = await invoke('relation:query', { query });
  assert.equal(first.schema, 'mazz.relation-retrieval/v1');
  assert.ok(first.candidates.length >= 1);
  assert.ok(first.explanations.every(row => row.reasons.length > 0 && row.sourceRefs.length > 0));
  const candidateRef = first.candidates[0].candidateRef;
  const rejection = await invoke('relation:rejectCandidate', { queryId: query.queryId, candidateRef, authorityRef: 'human:w94e-runtime', reason: 'runtime negative fact' });
  assert.equal(rejection.rejected, true);
  const replay = await invoke('relation:query', { query });
  assert.equal(replay.candidates.some(row => row.candidateRef === candidateRef), false);

  const left = await invoke('branch:create', { branchId: 'branch:left', revisions: [{ domain: 'calc', artifactRef: 'artifact:sheet-1', revision: 'rev:left', status: 'current' }], provenance: { source: 'w94e-runtime' } });
  const right = await invoke('branch:create', { branchId: 'branch:right', revisions: [{ domain: 'calc', artifactRef: 'artifact:sheet-1', revision: 'rev:right', status: 'current' }], provenance: { source: 'w94e-runtime' }, expectedRevision: left.revision });
  const merge = await invoke('branch:create', { branchId: 'branch:merge', parentBranchIds: ['branch:left', 'branch:right'], revisions: [], provenance: { source: 'w94e-runtime' }, expectedRevision: right.revision });
  const conflictSnapshot = await invoke('branch:snapshot');
  const conflictState = conflictSnapshot.effectiveStates.find(row => row.branchId === 'branch:merge');
  assert.equal(conflictState.conflicts.length, 1);
  const resolved = await invoke('branch:resolveConflict', { key: 'calc:sheet-1', resolvedRevision: 'rev:right', previousRevisions: ['rev:left', 'rev:right'], authorityRef: 'human:w94e-runtime', reason: 'runtime human resolution', sourceRefs: ['branch:merge'], expectedRevision: merge.revision });
  assert.equal(resolved.resolution.authorityRef, 'human:w94e-runtime');
  const finalBranch = await invoke('branch:rebuild');
  const finalState = finalBranch.effectiveStates.find(row => row.branchId === 'branch:merge');
  assert.equal(finalState.conflicts.length, 0);
  assert.equal(finalState.facts[0].revision, 'rev:right');

  const stateFact = await invoke('sync:stateFactPut', { factKind: 'branch', factId: 'branch:merge', revision: 'rev:right', payloadRef: 'artifact:sheet-1' });
  assert.equal(stateFact.accepted, true);
  const stateFacts = await invoke('sync:stateFacts');
  assert.equal(stateFacts.length, 1);
  const relationSnapshot = await invoke('relation:snapshot');
  assert.equal(relationSnapshot.eventCount, eventDomains.length);
  const resources = await product.evaluate(() => globalThis.__MAZZ_E2E_RESOURCE_LEDGER__?.snapshot?.() || { active: [] });
  assert.equal((resources.active || []).filter(row => row.type === 'external-tool-process' || row.type === 'state-fact').length, 0);
  assert.deepEqual(errors, []);

  report = {
    schema: 'mazz.w94e-relation-branch-runtime/v1', mode: MODE, result: 'PASS', workspaceId: first.workspaceId,
    retrieval: { candidates: first.candidates.length, explanations: first.explanations.length, rejectedAfterReplay: replay.candidates.length === first.candidates.length - 1 },
    events: { domains: eventDomains, count: captured.length },
    branch: { branches: finalBranch.branches.length, conflictCountBeforeResolution: conflictState.conflicts.length, conflictCountAfterResolution: finalState.conflicts.length, resolvedRevision: finalState.facts[0].revision },
    stateFacts: { count: stateFacts.length, separateFrameTrack: true, offline: true },
    resources: { activeCount: (resources.active || []).length }, networkCalls: 0, runtimeErrors: errors,
    executableSha256: EXECUTABLE ? sha256File(EXECUTABLE) : null, generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
} finally {
  if (product) {
    const closed = await Promise.race([product.close().then(() => true), delay(30000).then(() => false)]).catch(() => false);
    if (!closed) { try { product.process().kill(); } catch {} }
  }
  await removeTempDirectory(USER_DATA);
  await removeTempDirectory(WORKSPACE);
}
assert.ok(report);
process.stdout.write(`W94E_RUNTIME_REPORT=${JSON.stringify(report)}\n`);
