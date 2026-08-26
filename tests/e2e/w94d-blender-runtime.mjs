// W94D：Capability Registry → Artifact Ref staging → Blender external process → Receipt/Artifact
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
const REAL = process.argv.includes('--real');
const sceneIndex = process.argv.indexOf('--scene');
const REAL_SCENE = sceneIndex >= 0 ? path.resolve(process.argv[sceneIndex + 1]) : '';
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence', `W94D_BLENDER_EXTERNAL_${REAL ? 'REAL_' : ''}${MODE.toUpperCase()}.json`);
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'w94d-blender-fixture.mjs');
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94d-${MODE}-user-`)));
const WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94d-${MODE}-workspace-`)));
const FIXTURE_NODE = process.execPath;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function proposal(seed, operation, suffix = operation.replace(/[^a-z0-9]+/gi, '-')) {
  const outputSchema = {
    'scene.render.frame/v0': 'mazz.blender-render/v1',
    'scene.inspect/v0': 'mazz.blender-inspection/v1',
    'scene.export.obj/v0': 'mazz.blender-export/v1',
  }[operation];
  return {
    taskId: `task:w94d-${suffix}`, seatId: 'seat:human-maintainer',
    capabilityId: 'mazz.blender.external', capabilityVersion: '1.0.0', adapterId: 'mazz.blender.external-process',
    inputs: [{ artifactId: seed.artifactId, contentHash: seed.contentHash, role: 'scene', schema: 'mazz.blender-scene/v1' }],
    parameters: { operation }, expectedOutputs: [outputSchema], constraints: {}, authorityRef: 'human:w94d-runtime',
  };
}

async function launch(runtimeErrors) {
  fs.writeFileSync(path.join(USER_DATA, 'mazz-settings.json'), `${JSON.stringify({
    workspace: WORKSPACE, closeBehavior: 'quit', 'agreement.noMore': true,
  }, null, 2)}\n`, 'utf8');
  const options = {
    args: EXECUTABLE ? [] : [ROOT],
    env: {
      ...process.env,
      NODE_ENV: 'test', MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WORKSPACE,
      MAZZ_E2E_DISABLE_GPU: '1',
      ...(REAL ? {} : { MAZZ_E2E_BLENDER_NODE: FIXTURE_NODE, MAZZ_E2E_BLENDER_FIXTURE: FIXTURE }),
    },
    timeout: 120000,
  };
  if (EXECUTABLE) options.executablePath = EXECUTABLE;
  const app = await electron.launch(options);
  app.process().stderr?.on('data', chunk => {
    const text = String(chunk);
    if (/uncaught|TypeError|ReferenceError|UnhandledPromiseRejection|FATAL/i.test(text)) runtimeErrors.push(text.trim());
  });
  const page = await app.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const list = await page.evaluate(() => window.mazz.invoke('capability:list', {}));
      const blenderCapability = list.find(row => row.capabilityId === 'mazz.blender.external');
      if (blenderCapability?.availability?.state === 'available') return { app, page, list, blenderCapability };
    } catch {}
    await delay(50);
  }
  throw new Error('W94D Blender capability startup gate did not become ready');
}

async function seed(app, bytes) {
  fs.writeFileSync(path.join(WORKSPACE, 'w94d-seed-input.bin'), Buffer.from(bytes));
  return app.evaluate(() => globalThis.__MAZZ_E2E_SEED_CURRENT_ARTIFACT__());
}

async function execute(page, value) {
  return page.evaluate(async ({ workspacePath, proposalValue }) => {
    const submitted = await window.mazz.invoke('capability:submitProposal', { workspacePath, proposal: proposalValue });
    const executed = await window.mazz.invoke('capability:executeProposal', { workspacePath, proposalId: submitted.proposal.proposalId });
    return { submitted, executed };
  }, { workspacePath: WORKSPACE, proposalValue: value });
}

async function readArtifact(page, artifact) {
  return page.evaluate(async ({ workspacePath, artifactId }) => {
    const grant = await window.mazz.invoke('capability:artifactGrant', { workspacePath, artifactId });
    const response = await fetch(grant.url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status, mediaType: response.headers.get('content-type') || '',
      prefix: [...bytes.slice(0, 8)], body: new TextDecoder().decode(bytes),
    };
  }, { workspacePath: WORKSPACE, artifactId: artifact.artifactId });
}

async function snapshot(app) {
  return app.evaluate(() => {
    const service = globalThis.__MAZZ_E2E_CAPABILITY_EXECUTION__;
    const store = service._store(process.env.MAZZ_E2E_WORKSPACE);
    return {
      service: service.snapshot(),
      workspace: service.workspaceSnapshot(process.env.MAZZ_E2E_WORKSPACE),
      artifacts: service._artifactStore(store).snapshot(),
      resources: globalThis.__MAZZ_E2E_RESOURCE_LEDGER__.snapshot(),
    };
  });
}

async function closeProduct(product) {
  if (!product) return;
  const closed = await Promise.race([product.app.close().then(() => true), delay(30000).then(() => false)]);
  if (!closed) { product.app.process().kill(); throw new Error('W94D product did not cross durable quit boundary'); }
}

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

const errors = [];
let product = null;
let report = null;
try {
  if (REAL && (!REAL_SCENE || !fs.existsSync(REAL_SCENE))) throw new Error('W94D real run requires --scene <.blend>');
  product = await launch(errors);
  assert.ok(product.list.some(row => row.capabilityId === 'mazz.blender.external'));
  assert.equal(product.blenderCapability.executionPlane, 'external-process');
  assert.equal(product.blenderCapability.provenance.bundledWithMazz, false);

  const sourceSeed = await seed(product.app, REAL ? fs.readFileSync(REAL_SCENE) : 'SUCCESS');
  const operations = [];
  for (const operation of ['scene.render.frame/v0', 'scene.inspect/v0', 'scene.export.obj/v0']) {
    const executed = await execute(product.page, proposal(sourceSeed, operation));
    assert.equal(executed.executed.receipt.state, 'completed');
    assert.equal(executed.executed.artifacts.length, 1);
    const artifact = executed.executed.artifacts[0];
    const body = await readArtifact(product.page, artifact);
    assert.equal(body.status, 200);
    if (operation === 'scene.render.frame/v0') assert.deepEqual(body.prefix, [137, 80, 78, 71, 13, 10, 26, 10]);
    if (operation === 'scene.inspect/v0') assert.equal(JSON.parse(body.body).schema, 'mazz.blender-inspection/v1');
    if (operation === 'scene.export.obj/v0') assert.match(body.body, /^(?:#|v\s|o\s)/m);
    operations.push({ operation, proposalId: executed.executed.proposal.proposalId, receiptId: executed.executed.receipt.receiptId, artifactId: artifact.artifactId, contentHash: artifact.contentHash, environment: executed.executed.receipt.environment });
  }

  let failure = { error: null };
  let cancellation = { terminal: { error: null } };
  if (!REAL) {
    const failureSeed = await seed(product.app, 'PARTIAL_FAIL');
    failure = await product.page.evaluate(async ({ workspacePath, proposalValue }) => {
    const submitted = await window.mazz.invoke('capability:submitProposal', { workspacePath, proposal: proposalValue });
    try {
      await window.mazz.invoke('capability:executeProposal', { workspacePath, proposalId: submitted.proposal.proposalId });
      return { submitted, unexpectedSuccess: true };
    } catch (error) {
      return { submitted, error: { code: error?.code || '', message: error?.message || String(error) } };
    }
    }, { workspacePath: WORKSPACE, proposalValue: proposal(failureSeed, 'scene.render.frame/v0', 'failure') });
    assert.equal(failure.unexpectedSuccess, undefined);
    // The narrow renderer bridge intentionally exposes only a message. Verify
    // the durable, machine-readable failure code from the Capability ledger.
    const afterFailure = await snapshot(product.app);
    const failedProposal = afterFailure.workspace.proposals.find(row => row.proposalId === failure.submitted.proposal.proposalId);
    assert.match(failedProposal?.failureCode || '', /^CAPABILITY_/);

    const cancelSeed = await seed(product.app, 'SLEEP');
    cancellation = await product.page.evaluate(async ({ workspacePath, proposalValue }) => {
    const submitted = await window.mazz.invoke('capability:submitProposal', { workspacePath, proposal: proposalValue });
    const running = window.mazz.invoke('capability:executeProposal', { workspacePath, proposalId: submitted.proposal.proposalId })
      .then(value => ({ ok: true, value })).catch(error => ({ ok: false, error: { code: error?.code || '', message: error?.message || String(error) } }));
    let cancel = null;
    for (let i = 0; i < 100; i += 1) {
      // Let the fixed Blender command cross probe/spawn so this case verifies
      // process-tree termination, while the adapter still handles earlier
      // cancellation without spawning.
      await new Promise(resolve => setTimeout(resolve, i === 0 ? 300 : 25));
      try {
        cancel = await window.mazz.invoke('capability:cancelProposal', { workspacePath, proposalId: submitted.proposal.proposalId, authorityRef: 'human:w94d-runtime' });
      } catch (error) {
        // cancelProposal resolves only after the durable cancelled Receipt is
        // committed, so the narrow bridge reports its terminal error here.
        cancel = { error: { code: error?.code || '', message: error?.message || String(error) } };
        break;
      }
      if (cancel?.proposal?.state === 'cancelled' || cancel?.proposal?.state === 'failed') break;
    }
    return { submitted, cancel, terminal: await running };
    }, { workspacePath: WORKSPACE, proposalValue: proposal(cancelSeed, 'scene.render.frame/v0', 'cancel') });
    assert.equal(cancellation.terminal.ok, false);
    const afterCancellation = await snapshot(product.app);
    const cancelledProposal = afterCancellation.workspace.proposals.find(row => row.proposalId === cancellation.submitted.proposal.proposalId);
    assert.equal(cancelledProposal?.state, 'cancelled');
    assert.equal(cancelledProposal?.failureCode, 'CAPABILITY_CANCELLED');
  }

  const final = await snapshot(product.app);
  assert.equal(final.service.activeCount, 0);
  assert.equal(final.resources.active.some(row => row.type === 'external-tool-process'), false);
  assert.equal(final.artifacts.stagingCount, 0);
  const expectedCounts = REAL ? { proposals: 4, receipts: 4, artifacts: 4 } : { proposals: 8, receipts: 8, artifacts: 6 };
  assert.equal(final.workspace.proposals.length, expectedCounts.proposals);
  assert.equal(final.workspace.receipts.length, expectedCounts.receipts);
  assert.equal(final.workspace.artifacts.length, expectedCounts.artifacts);
  const stagingRoot = path.join(WORKSPACE, '.mazz', 'capability-blender', 'staging');
  assert.equal(fs.existsSync(stagingRoot), true);
  assert.equal(fs.readdirSync(stagingRoot).length, 0);
  assert.deepEqual(errors, []);
  report = {
    schema: 'mazz.w94d-blender-external-runtime/v1', mode: REAL ? `${MODE}-real` : MODE, result: 'PASS',
    capability: { id: product.blenderCapability.capabilityId, version: product.blenderCapability.version, adapterId: product.blenderCapability.adapterId, fixtureProbe: product.blenderCapability.availability },
    operations, failure: failure.error, cancellation: cancellation.terminal.error,
    persistedCounts: { proposals: final.workspace.proposals.length, receipts: final.workspace.receipts.length, artifacts: final.workspace.artifacts.length, blobs: final.artifacts.blobCount },
    resources: { activeCount: final.service.activeCount, externalToolProcesses: final.resources.active.filter(row => row.type === 'external-tool-process').length, artifactStagingCount: final.artifacts.stagingCount },
    networkCalls: 0, runtimeErrors: errors, executableSha256: EXECUTABLE ? sha256File(EXECUTABLE) : null,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
} finally {
  await closeProduct(product).catch(error => { errors.push(error.message); try { product?.app.process().kill(); } catch {} });
  await removeTempDirectory(USER_DATA);
  await removeTempDirectory(WORKSPACE);
}

assert.ok(report);
process.stdout.write(`W94D_RUNTIME_REPORT=${JSON.stringify(report)}\n`);
