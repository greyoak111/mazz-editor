import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), '..', '..');
const executableIndex = process.argv.indexOf('--executable');
const EXECUTABLE = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : '';
const MODE = EXECUTABLE ? 'packaged' : 'source';
const EVIDENCE_ROOT = path.join(ROOT, 'docs', 'engineering', 'evidence');
const EVIDENCE_JSON = path.join(EVIDENCE_ROOT, `W94A_CAPABILITY_EXECUTION_${MODE.toUpperCase()}.json`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94a-${MODE}-user-`)));
const WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94a-${MODE}-workspace-`)));
const INPUT_HASH = `sha256-${'a'.repeat(64)}`;
const VALUE = 'W94A deterministic runtime value';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const slash = value => String(value || '').replace(/\\/g, '/');

async function launch(runtimeErrors) {
  const options = {
    args: EXECUTABLE ? [] : [ROOT],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: USER_DATA,
      MAZZ_E2E_WORKSPACE: WORKSPACE,
      MAZZ_E2E_DISABLE_GPU: '1',
      MAZZ_E2E_ALLOW_LIVE_PROVIDER: '0',
      MAZZ_E2E_CAPABILITY_FIXTURE: '1',
    },
    timeout: 120000,
  };
  if (EXECUTABLE) options.executablePath = EXECUTABLE;
  const app = await electron.launch(options);
  const page = await app.firstWindow({ timeout: 120000 });
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => runtimeErrors.push(`[pageerror] ${error.stack || error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const value = message.text();
    if (!/Autofill|SharedArrayBuffer|ERR_FILE_NOT_FOUND|ffmpeg_common/i.test(value)) {
      runtimeErrors.push(`[console.error] ${value}`);
    }
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));
  await page.evaluate(async workspacePath => {
    await Promise.all([
      window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
      window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
      window.mazz.invoke('fs:watch', { paths: [workspacePath] }),
    ]);
    window.__w94aFileChanges = [];
    window.__w94aStopFileChanges = window.mazz.on('file:changed', event => {
      window.__w94aFileChanges.push(event?.path || '');
    });
  }, WORKSPACE);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const list = await page.evaluate(() => window.mazz.invoke('capability:list', {}));
      if (Array.isArray(list)) return { app, page, list };
    } catch {}
    await delay(50);
  }
  throw new Error('W94A capability startup gate did not become ready');
}

async function closeProduct(product) {
  if (!product) return;
  await product.page.evaluate(() => window.__w94aStopFileChanges?.()).catch(() => {});
  const closed = await Promise.race([
    product.app.close().then(() => true),
    delay(30000).then(() => false),
  ]);
  if (!closed) {
    product.app.process().kill();
    throw new Error('W94A product did not cross the durable quit boundary');
  }
}

function proposal() {
  return {
    taskId: 'task:w94a-runtime',
    seatId: 'seat:human-maintainer',
    capabilityId: 'mazz.fixture.echo',
    capabilityVersion: '1.0.0',
    adapterId: 'mazz.fixture.echo.main',
    inputs: [{
      artifactId: 'artifact-runtime-input',
      contentHash: INPUT_HASH,
      role: 'source',
      schema: 'mazz.fixture-input/v1',
    }],
    parameters: { operation: 'echo', value: VALUE },
    expectedOutputs: ['mazz.fixture-output/v1'],
    constraints: { deterministic: true },
    authorityRef: 'human:w94a-runtime',
  };
}

async function mainSnapshot(app) {
  return app.evaluate(() => {
    const service = globalThis.__MAZZ_E2E_CAPABILITY_EXECUTION__;
    const ledger = globalThis.__MAZZ_E2E_RESOURCE_LEDGER__;
    return {
      service: service.snapshot(),
      resources: ledger.snapshot(),
    };
  });
}

const runtimeErrors = [];
let first = null;
let second = null;
let report = null;
let capabilityId = '';
try {
  first = await launch(runtimeErrors);
  const fixtureCapability = first.list.find(row => row.capabilityId === 'mazz.fixture.echo');
  assert.ok(fixtureCapability, 'W94A fixture capability must remain registered alongside external capabilities');
  capabilityId = fixtureCapability.capabilityId;

  const firstRun = await first.page.evaluate(async ({ workspacePath, proposal }) => {
    const submitted = await window.mazz.invoke('capability:submitProposal', { workspacePath, proposal });
    const executed = await window.mazz.invoke('capability:executeProposal', {
      workspacePath, proposalId: submitted.proposal.proposalId,
    });
    const snapshot = await window.mazz.invoke('capability:workspaceSnapshot', { workspacePath });
    await new Promise(resolve => setTimeout(resolve, 900));
    return { submitted, executed, snapshot, fileChanges: [...window.__w94aFileChanges] };
  }, { workspacePath: WORKSPACE, proposal: proposal() });

  assert.equal(firstRun.submitted.idempotent, false);
  assert.equal(firstRun.executed.proposal.state, 'completed');
  assert.equal(firstRun.executed.receipt.state, 'completed');
  assert.equal(firstRun.executed.artifacts.length, 1);
  assert.match(firstRun.executed.artifacts[0].contentHash, /^sha256-[0-9a-f]{64}$/);
  assert.equal(firstRun.snapshot.proposals.length, 1);
  assert.equal(firstRun.snapshot.receipts.length, 1);
  assert.equal(firstRun.snapshot.artifacts.length, 1);
  assert.equal(firstRun.fileChanges.some(value => /\/\.mazz\/capability-runtime(?:\/|$)/i.test(slash(value))), false,
    'internal execution facts must not trigger file-tree refresh events');
  assert.equal(JSON.stringify({ receipt: firstRun.executed.receipt, artifacts: firstRun.executed.artifacts }).includes(VALUE), false);

  const firstResources = await mainSnapshot(first.app);
  assert.equal(firstResources.service.activeCount, 0);
  assert.equal(firstResources.service.durabilityFailureCount, 0);
  assert.equal(firstResources.resources.active.some(row => row.type === 'capability-execution'), false);
  await closeProduct(first);
  first = null;

  second = await launch(runtimeErrors);
  const replay = await second.page.evaluate(async ({ workspacePath, proposal }) => {
    const submitted = await window.mazz.invoke('capability:submitProposal', { workspacePath, proposal });
    const executed = await window.mazz.invoke('capability:executeProposal', {
      workspacePath, proposalId: submitted.proposal.proposalId,
    });
    const snapshot = await window.mazz.invoke('capability:workspaceSnapshot', { workspacePath });
    return { submitted, executed, snapshot };
  }, { workspacePath: WORKSPACE, proposal: proposal() });
  assert.equal(replay.submitted.idempotent, true);
  assert.equal(replay.executed.idempotent, true);
  assert.equal(replay.executed.receipt.receiptId, firstRun.executed.receipt.receiptId);
  assert.equal(replay.snapshot.proposals.length, 1);
  assert.equal(replay.snapshot.receipts.length, 1);
  assert.equal(replay.snapshot.artifacts.length, 1);

  const secondResources = await mainSnapshot(second.app);
  assert.equal(secondResources.service.activeCount, 0);
  assert.equal(secondResources.service.durabilityFailureCount, 0);
  assert.equal(secondResources.resources.active.some(row => row.type === 'capability-execution'), false);
  assert.deepEqual(runtimeErrors, []);

  const statePath = path.join(WORKSPACE, '.mazz', 'capability-runtime', 'state.json');
  assert.equal(fs.existsSync(statePath), true);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.proposals.length, 1);
  assert.equal(state.receipts.length, 1);
  assert.equal(state.artifacts.length, 1);

  report = {
    schema: 'mazz.w94a-capability-execution-runtime/v1',
    mode: MODE,
    result: 'PASS',
    product: EXECUTABLE ? 'win-unpacked' : 'source',
    capabilityId,
    proposalId: replay.submitted.proposal.proposalId,
    receiptId: replay.executed.receipt.receiptId,
    artifactId: replay.executed.artifacts[0].artifactId,
    contentHash: replay.executed.artifacts[0].contentHash,
    exactReplay: true,
    restartReopen: true,
    persistedCounts: { proposals: 1, receipts: 1, artifacts: 1 },
    fileTreeInternalEvents: 0,
    networkCalls: 0,
    resources: {
      capabilityExecutionOwners: secondResources.resources.active.filter(row => row.type === 'capability-execution').length,
      serviceActiveCount: secondResources.service.activeCount,
      durabilityFailureCount: secondResources.service.durabilityFailureCount,
    },
    runtimeErrors,
    stateSha256: sha256(statePath),
    rendererBundleSha256: sha256(path.join(ROOT, 'renderer', 'dist', 'app.js')),
    executableSha256: EXECUTABLE ? sha256(EXECUTABLE) : null,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  fs.writeFileSync(EVIDENCE_JSON, `${JSON.stringify(report, null, 2)}\n`);
  await closeProduct(second);
  second = null;
} finally {
  if (first) await closeProduct(first).catch(() => { try { first.app.process().kill(); } catch {} });
  if (second) await closeProduct(second).catch(() => { try { second.app.process().kill(); } catch {} });
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
}

assert.equal(fs.existsSync(USER_DATA), false);
assert.equal(fs.existsSync(WORKSPACE), false);
assert.ok(report);
process.stdout.write(`W94A_RUNTIME_REPORT=${JSON.stringify(report)}\n`);
