import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CliSupervisor } = require('../../main/agent-cli-supervisor.js');
const { ResourceLedger } = require('../../main/resource-ledger.js');
const { CapabilityArtifactStore } = require('../../main/capability-artifact-store.js');
const { createBlenderHeadlessAdapter } = require('../../main/external-tools/blender-headless-adapter.js');
const blender = require('../../main/capabilities/blender-external-adapter.js');

const FIXTURE = path.resolve('tests/fixtures/w94d-blender-fixture.mjs');
const SCRIPT = path.resolve('resources/tools/blender/mazz_blender_capability.py');

function workspace(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w94d-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function setup(t, sceneBytes = Buffer.from('SUCCESS')) {
  const root = workspace(t);
  const ledger = new ResourceLedger();
  const supervisor = new CliSupervisor({
    resourceLedger: ledger,
    resourceType: 'external-tool-process',
    handleOwnerTool: 'external-tool-supervisor',
    forceKillTreeOnTerminate: true,
  });
  const artifacts = new CapabilityArtifactStore({ workspacePath: root });
  const publication = await artifacts.publishBytes(sceneBytes);
  const scene = {
    artifactId: 'artifact-source-scene',
    workspaceIdentity: artifacts.workspaceIdentity,
    kind: 'blender-scene',
    mediaType: 'application/x-blender',
    contentSchema: blender.SCENE_SCHEMA,
    contentHash: publication.contentHash,
    storageRef: publication.storageRef,
    sourceArtifacts: [],
  };
  const toolAdapter = createBlenderHeadlessAdapter({
    supervisor,
    executablePath: process.execPath,
    commandPrefix: [FIXTURE],
    scriptPath: SCRIPT,
    allowedRootsProvider: () => [root],
    operations: blender.OPERATIONS,
  });
  const adapter = blender.createBlenderExternalCapabilityAdapter({
    toolAdapter,
    executablePath: process.execPath,
    commandPrefix: [FIXTURE],
  });
  const context = {
    workspacePath: root,
    workspaceIdentity: artifacts.workspaceIdentity,
    getArtifact: id => id === scene.artifactId ? scene : null,
    open: (...args) => artifacts.open(...args),
    publishReadable: (...args) => artifacts.publishReadable(...args),
    snapshot: () => artifacts.snapshot(),
  };
  t.after(async () => { await adapter.dispose('test-end'); });
  return { root, ledger, artifacts, scene, adapter, context };
}

function executeInput(scene, operation, id) {
  return {
    proposalId: id,
    parameters: { operation },
    constraints: {},
    inputs: [{ artifactId: scene.artifactId, contentHash: scene.contentHash, role: 'scene', schema: blender.SCENE_SCHEMA }],
  };
}

test('W94D descriptor freezes render/inspect/export and explicit external provenance', async t => {
  const { adapter } = await setup(t);
  assert.equal(adapter.descriptor.capabilityId, blender.CAPABILITY_ID);
  assert.equal(adapter.descriptor.executionPlane, 'external-process');
  assert.deepEqual(adapter.descriptor.outputSchemas.sort(), [
    'mazz.blender-export/v1', 'mazz.blender-inspection/v1', 'mazz.blender-render/v1',
  ]);
  assert.equal(adapter.descriptor.provenance.bundledWithMazz, false);
  assert.equal(adapter.descriptor.provenance.scriptPolicy, 'mazz-owned-fixed-mode');
});

test('W94D Artifact Ref staging produces verified render/inspect/export artifacts', async t => {
  const { adapter, context, artifacts, scene, ledger } = await setup(t);
  for (const operation of blender.OPERATIONS) {
    const id = `proposal-${operation.replace(/[^a-z0-9]+/gi, '-')}`;
    const result = await adapter.execute({ proposal: executeInput(scene, operation, id), signal: new AbortController().signal, artifacts: context });
    assert.equal(result.status, 'completed');
    assert.equal(result.outputs.length, 1);
    const output = result.outputs[0];
    assert.equal(output.sourceArtifacts[0], scene.artifactId);
    const opened = await artifacts.open(output.storageRef, { expectedHash: output.contentHash });
    const chunks = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    if (operation === 'scene.render.frame/v0') assert.deepEqual(bytes.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (operation === 'scene.inspect/v0') assert.equal(JSON.parse(bytes.toString('utf8')).schema, 'mazz.blender-inspection/v1');
    if (operation === 'scene.export.obj/v0') assert.match(bytes.toString('utf8'), /^(?:#|v\s|o\s)/m);
    assert.equal(ledger.snapshot().activeCount, 0);
  }
  assert.equal(artifacts.snapshot().stagingCount, 0);
});

test('W94D rejects missing/hash/type/path inputs before external spawn', async t => {
  const { adapter, context, scene, ledger } = await setup(t);
  const signal = new AbortController().signal;
  const missing = executeInput(scene, 'scene.render.frame/v0', 'bad-missing');
  missing.inputs = [{ ...missing.inputs[0], artifactId: 'missing' }];
  await assert.rejects(() => adapter.execute({ proposal: missing, signal, artifacts: context }), error => error.code === 'CAPABILITY_BLENDER_INPUT_NOT_FOUND');
  const badHash = executeInput(scene, 'scene.render.frame/v0', 'bad-hash');
  badHash.inputs = [{ ...badHash.inputs[0], contentHash: `sha256-${'0'.repeat(64)}` }];
  await assert.rejects(() => adapter.execute({ proposal: badHash, signal, artifacts: context }), error => error.code === 'CAPABILITY_BLENDER_INPUT_HASH_MISMATCH');
  const badOperation = executeInput(scene, 'scene.render.frame/v0', 'bad-op');
  badOperation.parameters = { operation: 'shell.exec' };
  await assert.rejects(() => adapter.execute({ proposal: badOperation, signal, artifacts: context }), error => error.code === 'CAPABILITY_BLENDER_OPERATION_NOT_ALLOWED');
  assert.equal(ledger.snapshot().activeCount, 0);
  assert.equal(context.workspaceIdentity, scene.workspaceIdentity);
});

test('W94D cancellation reaches external process-tree and leaves no staging owner', async t => {
  const { adapter, context, scene, ledger } = await setup(t, Buffer.from('SLEEP'));
  const proposalId = 'proposal-cancel';
  const controller = new AbortController();
  const running = adapter.execute({ proposal: executeInput(scene, 'scene.render.frame/v0', proposalId), signal: controller.signal, artifacts: context });
  let cancelled = false;
  for (let i = 0; i < 100; i += 1) {
    await delay(20);
    cancelled = await adapter.cancel({ proposalId });
    if (cancelled) break;
  }
  assert.equal(cancelled, true);
  controller.abort();
  await assert.rejects(running, error => error.code === 'CAPABILITY_CANCELLED');
  await delay(100);
  assert.equal(ledger.snapshot().activeCount, 0);
});
