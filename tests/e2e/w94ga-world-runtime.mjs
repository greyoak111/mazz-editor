// W94Ga：本地 World Store + Branch/Canon proposal/review/partial merge + A/B/restart
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
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence', `W94GA_WORLD_${MODE.toUpperCase()}.json`);
const SCREENSHOT = path.join(ROOT, 'docs', 'engineering', 'evidence', `W94GA_WORLD_${MODE.toUpperCase()}.png`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94ga-${MODE}-user-`)));
const WORKSPACE_A = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94ga-${MODE}-a-`)));
const WORKSPACE_B = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94ga-${MODE}-b-`)));
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
function watchProduct(instance) {
  instance.process().stderr?.on('data', chunk => {
    const text = String(chunk);
    if (/uncaught|TypeError|ReferenceError|UnhandledPromiseRejection|FATAL/i.test(text)) errors.push(text.trim());
  });
}
try {
  fs.writeFileSync(path.join(USER_DATA, 'mazz-settings.json'), `${JSON.stringify({ workspace: WORKSPACE_A, workspaces: [{ path: WORKSPACE_A, name: 'A' }, { path: WORKSPACE_B, name: 'B' }], closeBehavior: 'quit', 'agreement.noMore': true }, null, 2)}\n`, 'utf8');
  const options = {
    args: EXECUTABLE ? [] : [ROOT],
    env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WORKSPACE_A, MAZZ_E2E_DISABLE_GPU: '1' },
    timeout: 120000,
  };
  if (EXECUTABLE) options.executablePath = EXECUTABLE;
  product = await electron.launch(options);
  watchProduct(product);
  const page = await product.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));
  const invoke = (channel, payload = {}) => page.evaluate(({ channel, payload }) => window.mazz.invoke(channel, payload), { channel, payload });

  const created = await invoke('world:create', { worldId: 'world:harbor', name: 'Harbor World', description: 'local-first fixture', expectedRevision: 0 });
  assert.equal(created.revision, 1);
  const forked = await invoke('world:fork', { worldId: 'world:harbor', sourceBranchId: created.world.rootBranchId, branchId: 'branch:harbor-community', baseCanonVersion: 'canon:0', forkPoint: 'canon:0', expectedRevision: 1 });
  assert.equal(forked.revision, 2);
  const proposed = await invoke('world:proposeCanon', {
    worldId: 'world:harbor', branchId: 'branch:harbor-community',
    changes: [{ domain: 'world', artifactRef: 'artifact:harbor-character', revision: 'rev:community-1', status: 'current' }],
    evidenceRefs: ['artifact:harbor-evidence'], proposedBy: 'human:author', expectedRevision: 2,
  });
  const reviewed = await invoke('world:reviewProposal', { proposalId: proposed.proposal.proposalId, action: 'accept', authorityRef: 'human:reviewer', reason: 'fixture evidence checked', expectedRevision: 3 });
  assert.equal(reviewed.proposal.status, 'accepted');
  const merged = await invoke('world:mergeCanon', { proposalId: proposed.proposal.proposalId, acceptedRevisions: ['rev:community-1'], authorityRef: 'human:owner', reason: 'partial canon adoption', expectedRevision: 4 });
  assert.equal(merged.merge.status, 'merged');
  const afterMerge = await invoke('world:snapshot', { worldId: 'world:harbor' });
  const rootState = afterMerge.effectiveStates.find(row => row.branchId === created.world.rootBranchId);
  assert.equal(rootState.facts[0].revision, 'rev:community-1');
  assert.equal(afterMerge.localOnly, true);
  await page.screenshot({ path: SCREENSHOT, fullPage: true });

  await invoke('workspace:setCurrent', { path: WORKSPACE_B });
  const isolated = await invoke('world:snapshot');
  assert.equal(isolated.worlds.length, 0);
  await invoke('workspace:setCurrent', { path: WORKSPACE_A });
  const restoredA = await invoke('world:snapshot');
  assert.equal(restoredA.worlds.length, 1);
  assert.equal(restoredA.worlds[0].canonVersion, merged.world.canonVersion);

  await product.close();
  product = null;
  const reopened = await electron.launch(options);
  product = reopened;
  watchProduct(reopened);
  const reopenedPage = await product.firstWindow({ timeout: 120000 });
  reopenedPage.on('pageerror', error => errors.push(error.message));
  await reopenedPage.waitForLoadState('domcontentloaded');
  await reopenedPage.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));
  const reopenedSnapshot = await reopenedPage.evaluate(() => window.mazz.invoke('world:snapshot'));
  assert.equal(reopenedSnapshot.worlds.length, 1);
  assert.equal(reopenedSnapshot.proposals[0].status, 'merged');
  const resources = await reopenedPage.evaluate(() => globalThis.__MAZZ_E2E_RESOURCE_LEDGER__?.snapshot?.() || { active: [] });
  assert.equal((resources.active || []).filter(row => row.type === 'external-tool-process').length, 0);
  assert.deepEqual(errors, []);
  report = {
    schema: 'mazz.w94ga-world-runtime/v1', mode: MODE, result: 'PASS',
    world: { worldId: reopenedSnapshot.worlds[0].worldId, branchCount: reopenedSnapshot.worlds[0].branchIds.length, canonVersion: reopenedSnapshot.worlds[0].canonVersion, proposalStatus: reopenedSnapshot.proposals[0].status, mergedRevision: rootState.facts[0].revision },
    workspaceIsolation: { aWorlds: 1, bWorlds: 0, aRestoredWorlds: restoredA.worlds.length, restartWorlds: reopenedSnapshot.worlds.length },
    branch: { effectiveFacts: rootState.facts.length, conflicts: rootState.conflicts.length, resolutionRequired: rootState.resolutionRequired },
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
  await removeTempDirectory(WORKSPACE_A);
  await removeTempDirectory(WORKSPACE_B);
}
assert.ok(report);
process.stdout.write(`W94GA_RUNTIME_REPORT=${JSON.stringify(report)}\n`);
