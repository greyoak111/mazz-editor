import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const contract = require('../../main/capability-execution-contract.js');
const {
  CapabilityExecutionStore,
  createCapabilityExecutionOwnerCapability,
} = require('../../main/capability-execution-store.js');
const { CapabilityExecutionService } = require('../../main/capability-execution-service.js');
const { registerCapabilityExecutionIpc } = require('../../main/capability-execution-ipc.js');
const { createFixtureCapabilityAdapter } = require('../../main/capabilities/fixture-capability-adapter.js');
const { ResourceLedger } = require('../../main/resource-ledger.js');

const NOW = '2026-08-25T01:00:00.000Z';
const INPUT_HASH = `sha256-${'a'.repeat(64)}`;

function tempWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w94a-'));
  const canonical = fs.realpathSync.native?.(root) || fs.realpathSync(root);
  t.after(() => fs.rmSync(canonical, { recursive: true, force: true }));
  return canonical;
}

function ids() {
  let value = 0;
  return () => `w94a-${++value}`;
}

function service(options = {}) {
  const resourceLedger = options.resourceLedger || new ResourceLedger();
  const instance = new CapabilityExecutionService({
    resourceLedger,
    clock: () => new Date(NOW),
    randomId: ids(),
    ...options,
  });
  return { instance, resourceLedger };
}

function proposal(overrides = {}) {
  return {
    taskId: 'task:w94a',
    seatId: 'seat:human-maintainer',
    capabilityId: 'mazz.fixture.echo',
    capabilityVersion: '1.0.0',
    adapterId: 'mazz.fixture.echo.main',
    inputs: [{
      artifactId: 'artifact-input', contentHash: INPUT_HASH,
      role: 'source', schema: 'mazz.fixture-input/v1',
    }],
    parameters: { operation: 'echo', value: '施工事实' },
    expectedOutputs: ['mazz.fixture-output/v1'],
    constraints: { deterministic: true },
    authorityRef: 'human:mazz-maintainer',
    ...overrides,
  };
}

test('W94A descriptor/proposal contracts reject unknown fields, invalid enums and secrets', () => {
  const adapter = createFixtureCapabilityAdapter();
  assert.equal(contract.normalizeCapabilityDescriptor(adapter.descriptor).schema, contract.CAPABILITY_DESCRIPTOR_SCHEMA);
  assert.throws(() => contract.normalizeCapabilityDescriptor({ ...adapter.descriptor, magic: true }), /未冻结字段/);
  assert.throws(() => contract.normalizeCapabilityDescriptor({ ...adapter.descriptor, kind: 'everything' }), /不支持/);
  assert.throws(() => contract.normalizeCapabilityDescriptor({ ...adapter.descriptor, provenance: { apiKey: 'secret-value' } }), /secret/i);
  assert.throws(() => contract.normalizeAdapter({ ...adapter, protocol: 'other' }), /protocol/);
  const workspaceIdentity = `workspace-sha256-${'b'.repeat(64)}`;
  assert.throws(() => contract.normalizeProposal({
    schema: contract.EXECUTION_PROPOSAL_SCHEMA,
    workspaceIdentity,
    ...proposal({ parameters: { authorization: 'Bearer abcdefghijklmnop' } }),
    determinism: 'deterministic',
    state: 'proposed', receiptIds: [], artifactIds: [], activeLeaseId: '', failureCode: '',
  }, { now: NOW }), /secret|凭据/i);
  assert.throws(() => contract.normalizeProposal({
    schema: contract.EXECUTION_PROPOSAL_SCHEMA,
    workspaceIdentity,
    ...proposal({ parameters: { cwd: 'C:\\Users\\Alice\\private-work' } }),
    determinism: 'deterministic',
    state: 'proposed', receiptIds: [], artifactIds: [], activeLeaseId: '', failureCode: '',
  }, { now: NOW }), /绝对路径|外部 URI/i);
});

test('W94A adapter metadata cannot persist user paths or encoded external locators', async t => {
  const workspace = tempWorkspace(t);
  const fixture = createFixtureCapabilityAdapter();
  const unsafe = {
    ...fixture,
    async execute(context) {
      const result = await fixture.execute(context);
      return { ...result, environment: { runtime: 'node', cwd: 'C%3A%5CUsers%5CAlice%5Cprivate' } };
    },
  };
  const { instance } = service();
  instance.register(unsafe);
  const submitted = instance.submitProposal(workspace, proposal());
  await assert.rejects(instance.executeProposal(workspace, submitted.proposal.proposalId), error => (
    error.code === 'CAPABILITY_PRIVATE_LOCATOR_FORBIDDEN'
      && error.durableReceipt?.state === 'failed'
      && error.cause?.code === 'CAPABILITY_PRIVATE_LOCATOR_FORBIDDEN'
  ));
  const snapshot = instance.workspaceSnapshot(workspace);
  assert.equal(snapshot.proposals[0].state, 'failed');
  assert.equal(snapshot.receipts[0].state, 'failed');
  assert.equal(JSON.stringify(snapshot).includes('Alice'), false);
});

test('W94A Store is canonical, atomic, CAS guarded and reopens exact facts', t => {
  const workspace = tempWorkspace(t);
  const first = new CapabilityExecutionStore({ workspacePath: workspace, now: () => new Date(NOW), randomId: ids() });
  assert.equal(first.snapshot().revision, 1);
  const second = new CapabilityExecutionStore({ workspacePath: workspace, now: () => new Date(NOW), randomId: ids() });
  const updated = first.mutate({ expectedRevision: 1, apply: state => state });
  assert.equal(updated.revision, 2);
  assert.throws(() => second.mutate({ expectedRevision: 1, apply: state => state }), error => error.code === 'CAPABILITY_STORE_CONFLICT');
  assert.equal(new CapabilityExecutionStore(workspace).snapshot().revision, 2);
  assert.equal(fs.readdirSync(first.paths.runtimeRoot).some(name => name.endsWith('.tmp')), false);
});

test('W94A submit is exact idempotent, version-bound and Workspace isolated', t => {
  const a = tempWorkspace(t);
  const b = tempWorkspace(t);
  const { instance } = service();
  instance.register(createFixtureCapabilityAdapter());
  const first = instance.submitProposal(a, proposal());
  const replay = instance.submitProposal(a, proposal());
  const other = instance.submitProposal(b, proposal());
  assert.equal(first.idempotent, false);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.proposal.proposalId, first.proposal.proposalId);
  assert.notEqual(other.proposal.proposalId, first.proposal.proposalId);
  assert.equal(instance.workspaceSnapshot(a).proposals.length, 1);
  assert.equal(instance.workspaceSnapshot(b).proposals.length, 1);
  assert.throws(() => instance.submitProposal(a, proposal({ capabilityVersion: '2.0.0' })), /未登记/);
});

test('W94A fixture executes once and persists receipt/artifact lineage across reopen', async t => {
  const workspace = tempWorkspace(t);
  let calls = 0;
  const { instance, resourceLedger } = service();
  instance.register(createFixtureCapabilityAdapter({ onExecute: () => { calls += 1; } }));
  const submitted = instance.submitProposal(workspace, proposal());
  const [left, right] = await Promise.all([
    instance.executeProposal(workspace, submitted.proposal.proposalId),
    instance.executeProposal(workspace, submitted.proposal.proposalId),
  ]);
  assert.equal(calls, 1);
  assert.equal(left.receipt.receiptId, right.receipt.receiptId);
  assert.equal(left.proposal.state, 'completed');
  assert.equal(left.artifacts.length, 1);
  assert.match(left.artifacts[0].contentHash, /^sha256-[0-9a-f]{64}$/);
  assert.deepEqual(left.artifacts[0].sourceArtifacts, ['artifact-input']);
  assert.equal(JSON.stringify({ receipt: left.receipt, artifacts: left.artifacts }).includes('施工事实'), false,
    'receipt/artifact facts must not duplicate proposal body');
  assert.equal(resourceLedger.snapshot().activeCount, 0);
  const reopened = new CapabilityExecutionStore(workspace).snapshot();
  assert.equal(reopened.proposals[0].state, 'completed');
  assert.equal(reopened.receipts.length, 1);
  assert.equal(reopened.artifacts.length, 1);
  const replay = await instance.executeProposal(workspace, submitted.proposal.proposalId);
  assert.equal(replay.idempotent, true);
  assert.equal(calls, 1);
});

test('W94A cooperative cancel durably settles and releases Lease/resource owner', async t => {
  const workspace = tempWorkspace(t);
  let releaseGate;
  const gate = new Promise(resolve => { releaseGate = resolve; });
  let cancelled = 0;
  const { instance, resourceLedger } = service();
  instance.register(createFixtureCapabilityAdapter({ gate, onCancel: () => { cancelled += 1; } }));
  const submitted = instance.submitProposal(workspace, proposal());
  const running = instance.executeProposal(workspace, submitted.proposal.proposalId);
  await new Promise(resolve => setImmediate(resolve));
  const cancelling = instance.cancelProposal(workspace, submitted.proposal.proposalId, 'human:mazz-maintainer');
  releaseGate();
  await assert.rejects(running, error => error.code === 'CAPABILITY_CANCELLED' && !!error.durableReceipt);
  await assert.rejects(cancelling, error => error.code === 'CAPABILITY_CANCELLED' && !!error.durableReceipt);
  const snapshot = instance.workspaceSnapshot(workspace);
  assert.equal(cancelled, 1);
  assert.equal(snapshot.proposals[0].state, 'cancelled');
  assert.equal(snapshot.leases[0].state, 'released');
  assert.equal(snapshot.receipts[0].state, 'cancelled');
  assert.equal(resourceLedger.snapshot().activeCount, 0);
});

test('W94A adapter business failure has durable failed receipt without leaking message', async t => {
  const workspace = tempWorkspace(t);
  const { instance, resourceLedger } = service();
  instance.register(createFixtureCapabilityAdapter({ fail: Object.assign(new Error('private response body'), { code: 'FIXTURE_FAILED' }) }));
  const submitted = instance.submitProposal(workspace, proposal());
  await assert.rejects(instance.executeProposal(workspace, submitted.proposal.proposalId), error => (
    error.code === 'FIXTURE_FAILED' && error.durableReceipt?.state === 'failed'
  ));
  const snapshot = instance.workspaceSnapshot(workspace);
  assert.equal(snapshot.proposals[0].failureCode, 'FIXTURE_FAILED');
  assert.equal(snapshot.receipts[0].diagnostics.code, 'FIXTURE_FAILED');
  assert.equal(JSON.stringify(snapshot).includes('private response body'), false);
  assert.equal(resourceLedger.snapshot().activeCount, 0);
});

test('W94A explicit single-instance recovery pauses orphan active facts without requiring the old adapter', t => {
  const workspace = tempWorkspace(t);
  const ownerCapability = createCapabilityExecutionOwnerCapability();
  const { instance } = service({ ownerCapability });
  instance.register(createFixtureCapabilityAdapter());
  const submitted = instance.submitProposal(workspace, proposal());
  const store = instance._store(workspace);
  const at = NOW;
  const leaseId = 'lease-orphan';
  store.mutate({ apply: state => {
    const current = state.proposals[0];
    state.leases.push(contract.normalizeLease({
      schema: contract.EXECUTION_LEASE_SCHEMA,
      leaseId, workspaceIdentity: store.workspaceIdentity, proposalId: current.proposalId,
      ownerKind: 'main-process', ownerId: 'process:999999', state: 'active',
      acquiredAt: at, heartbeatAt: at, cancelRequestedAt: '', releasedAt: '', releaseReason: '',
    }));
    state.proposals[0] = contract.normalizeProposal({
      ...current, state: 'running', activeLeaseId: leaseId, revision: current.revision + 1, updatedAt: at,
    }, { durable: true });
    return state;
  } });
  assert.equal(new CapabilityExecutionStore(workspace).snapshot().proposals[0].state, 'running');
  const recovering = new CapabilityExecutionService({
    ownerCapability,
    clock: () => new Date(NOW),
    randomId: ids(),
  });
  recovering.openWorkspace(workspace);
  const result = recovering.recoverWorkspace(workspace);
  const recovered = recovering.workspaceSnapshot(workspace);
  assert.deepEqual(result.recovered, [submitted.proposal.proposalId]);
  assert.equal(recovered.proposals[0].state, 'paused');
  assert.equal(recovered.receipts.at(-1).diagnostics.code, 'APP_RESTART_RECOVERY');
  assert.equal(recovered.leases[0].state, 'released');
});

test('W94A two Service instances cannot execute one Proposal twice', async t => {
  const workspace = tempWorkspace(t);
  let releaseGate;
  const gate = new Promise(resolve => { releaseGate = resolve; });
  let firstCalls = 0;
  let secondCalls = 0;
  const first = service().instance;
  const second = service().instance;
  first.register(createFixtureCapabilityAdapter({ gate, onExecute: () => { firstCalls += 1; } }));
  second.register(createFixtureCapabilityAdapter({ onExecute: () => { secondCalls += 1; } }));
  const submitted = first.submitProposal(workspace, proposal());
  second.openWorkspace(workspace);
  const running = first.executeProposal(workspace, submitted.proposal.proposalId);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(second.executeProposal(workspace, submitted.proposal.proposalId), error => (
    ['CAPABILITY_PROPOSAL_NOT_EXECUTABLE', 'CAPABILITY_STORE_BUSY'].includes(error.code)
  ));
  releaseGate();
  await running;
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 0);
  assert.equal(new CapabilityExecutionStore(workspace).snapshot().receipts.length, 1);
});

test('W94A post-execution durability failure is not guessed successful and holds quit', async t => {
  const workspace = tempWorkspace(t);
  let failCommit = false;
  const resourceLedger = new ResourceLedger();
  const { instance } = service({ resourceLedger });
  instance.register(createFixtureCapabilityAdapter({ onExecute: () => { failCommit = true; } }));
  const submitted = instance.submitProposal(workspace, proposal());
  const store = instance._store(workspace);
  const original = store.transact.bind(store);
  store.transact = options => {
    if (failCommit) {
      failCommit = false;
      throw Object.assign(new Error('directory fsync failed'), { code: 'EIO' });
    }
    return original(options);
  };
  await assert.rejects(instance.executeProposal(workspace, submitted.proposal.proposalId), error => error.code === 'EIO');
  const serviceState = instance.snapshot();
  assert.equal(serviceState.activeCount, 0);
  assert.equal(serviceState.durabilityFailureCount, 1);
  assert.equal(resourceLedger.snapshot().active[0].state, 'durability-failed');
  assert.equal(instance.workspaceSnapshot(workspace).proposals[0].state, 'running');
  await assert.rejects(instance.shutdown('test-quit'), error => error.code === 'CAPABILITY_SHUTDOWN_DURABILITY_FAILED');
});

test('W94A corrupt state is retained and blocks mutation', t => {
  const workspace = tempWorkspace(t);
  const store = new CapabilityExecutionStore(workspace);
  fs.writeFileSync(store.paths.statePath, '{broken', 'utf8');
  assert.throws(() => new CapabilityExecutionStore(workspace), error => error.code === 'CAPABILITY_STORE_CORRUPT');
  assert.equal(fs.readFileSync(store.paths.statePath, 'utf8'), '{broken');
  assert.throws(() => store.mutate({ apply: state => state }), error => error.code === 'CAPABILITY_STORE_CORRUPT');
});

test('W94A orphan lock needs opaque single-instance authority and repairs exact dead owner', t => {
  const workspace = tempWorkspace(t);
  const store = new CapabilityExecutionStore(workspace);
  fs.writeFileSync(store.paths.mutationLock, JSON.stringify({ pid: 999999, token: 'dead-owner', acquiredAt: NOW }), 'utf8');
  assert.throws(() => store.repairOrphanLock({}), /单实例/);
  const result = store.repairOrphanLock(createCapabilityExecutionOwnerCapability());
  assert.equal(result.removed, true);
  assert.equal(fs.existsSync(store.paths.mutationLock), false);
});

test('W94A runtime layout replacement is rejected before fact publication', t => {
  const workspace = tempWorkspace(t);
  const external = tempWorkspace(t);
  const store = new CapabilityExecutionStore(workspace);
  const original = `${store.paths.runtimeRoot}.original`;
  fs.renameSync(store.paths.runtimeRoot, original);
  try {
    fs.symlinkSync(external, store.paths.runtimeRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    fs.renameSync(original, store.paths.runtimeRoot);
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return;
    throw error;
  }
  try {
    assert.throws(() => store.snapshot(), error => ['CAPABILITY_LAYOUT_CHANGED', 'CAPABILITY_UNSAFE_LAYOUT'].includes(error.code));
    assert.equal(fs.readdirSync(external).length, 0);
  } finally {
    fs.unlinkSync(store.paths.runtimeRoot);
    fs.renameSync(original, store.paths.runtimeRoot);
  }
});

test('W94A shutdown reaches zero owners and rejects any uncommitted durability hold', async t => {
  const workspace = tempWorkspace(t);
  const { instance } = service();
  instance.register(createFixtureCapabilityAdapter());
  instance.submitProposal(workspace, proposal());
  const closed = await instance.shutdown('test-complete');
  assert.equal(closed.activeCount, 0);
  assert.equal(closed.durabilityFailureCount, 0);
  assert.throws(() => instance.submitProposal(workspace, proposal()), /停止接收/);
});

test('W94A IPC is trusted-shell/current-Workspace/human-authority only', async t => {
  const workspace = tempWorkspace(t);
  const outside = path.join(path.dirname(workspace), `w94a-not-created-${Date.now()}`);
  const { instance } = service();
  instance.register(createFixtureCapabilityAdapter());
  instance.openWorkspace(workspace);
  const handlers = new Map();
  registerCapabilityExecutionIpc({
    bus: { handle: (channel, handler) => handlers.set(channel, handler) },
    service: instance,
    currentWorkspace: () => workspace,
    isTrustedSender: event => event?.trusted === true,
    isStartupReady: () => true,
  });
  const trusted = { trusted: true };
  await assert.rejects(handlers.get('capability:list')({}, {}), error => error.code === 'CAPABILITY_UNTRUSTED_SENDER');
  await assert.rejects(handlers.get('capability:workspaceSnapshot')({ workspacePath: outside }, trusted), error => error.code === 'CAPABILITY_WORKSPACE_MISMATCH');
  assert.equal(fs.existsSync(outside), false, 'mismatched renderer path must not be probed/created');
  await assert.rejects(handlers.get('capability:submitProposal')({
    workspacePath: workspace,
    proposal: proposal({ authorityRef: 'agent:untrusted' }),
  }, trusted), error => error.code === 'CAPABILITY_HUMAN_AUTHORITY_REQUIRED');
  await assert.rejects(handlers.get('capability:submitProposal')({
    workspacePath: workspace,
    proposal: { ...proposal(), executablePath: 'C:/tool.exe' },
  }, trusted), /未冻结字段/);
  const submitted = await handlers.get('capability:submitProposal')({ workspacePath: workspace, proposal: proposal() }, trusted);
  const executed = await handlers.get('capability:executeProposal')({
    workspacePath: workspace, proposalId: submitted.proposal.proposalId,
  }, trusted);
  assert.equal(executed.proposal.state, 'completed');
  const listed = await handlers.get('capability:list')({}, trusted);
  assert.equal(listed.length, 1);
});

test('W94A production assembly registers narrow IPC, startup recovery, quit gate and no default fixture', () => {
  const main = fs.readFileSync(path.resolve('main/main.js'), 'utf8');
  const preload = fs.readFileSync(path.resolve('preload/bridge.js'), 'utf8');
  const watcher = fs.readFileSync(path.resolve('main/file-watcher.js'), 'utf8');
  assert.match(main, /new CapabilityExecutionService\(\{/);
  assert.match(main, /registerCapabilityExecutionIpc\(\{/);
  assert.match(main, /await initializeCurrentCapabilityExecution\(\{/);
  assert.match(main, /await capabilityExecutionService\.shutdown\('app-quit'\)/);
  assert.match(main, /if \(process\.env\.NODE_ENV === 'test' && process\.env\.MAZZ_E2E_CAPABILITY_FIXTURE === '1'\) \{\s*capabilityExecutionService\.register\(createFixtureCapabilityAdapter\(\)\);\s*\}/);
  assert.equal((main.match(/capabilityExecutionService\.register\(/g) || []).length, 4);
  assert.match(main, /capabilityExecutionService\.register\(createCalcPythonAdapter\(/);
  assert.match(main, /capabilityExecutionService\.register\(createChartSvgAdapter\(/);
  assert.match(main, /capabilityExecutionService\.register\(createBlenderExternalCapabilityAdapter\(/);
  for (const channel of [
    'capability:list', 'capability:workspaceSnapshot', 'capability:submitProposal',
    'capability:executeProposal', 'capability:cancelProposal',
  ]) assert.ok(preload.includes(`'${channel}'`), channel);
  assert.match(watcher, /\\\.mazz\\\/capability-runtime/,
    'internal capability ledger writes must not rebuild the user file tree');
});
