// W66-R0b Host Facts / Profiles / Current SSoT / Tool Capability Snapshot
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  HOST_FACTS_SCHEMA,
  CURRENT_SSOT_SCHEMA,
  createToolCapabilitySnapshot,
  readCurrentDoctrineContext,
  resolveDoctrineProfiles,
  sha256,
  snapshotR0aFoundation,
  snapshotR0bContext,
  validateCurrentSsot,
  validateHostFacts,
  validateToolCapabilitySnapshot,
} = require('../../main/agent-doctrine.js');

const registry = JSON.parse(fs.readFileSync('docs/engineering/doctrine/MAZZ_STABLE_RULE_REGISTRY.v0.json', 'utf8'));
const lineage = JSON.parse(fs.readFileSync('docs/engineering/doctrine/MAZZ_INCIDENT_LINEAGE.v0.json', 'utf8'));

function host(overrides = {}) {
  return {
    schemaVersion: HOST_FACTS_SCHEMA,
    factId: 'host:test',
    capturedAt: '2026-08-19T02:00:00.000Z',
    os: 'windows',
    shell: 'powershell',
    executionMode: 'local',
    workspacePersistence: 'durable',
    sandbox: false,
    packagedRuntime: 'electron',
    electron: true,
    network: true,
    remoteTarget: false,
    ...overrides,
  };
}

function ssot(overrides = {}) {
  return {
    schemaVersion: CURRENT_SSOT_SCHEMA,
    taskId: 'mazz:w66-r0b',
    wave: 'W66-R0b',
    status: 'RUNNING',
    branch: 'main',
    head: '9572d52',
    remoteHead: '482bc2d',
    openItems: ['W66-R0c', 'W66-R0d', 'W66-R0e', 'W66-R1-R6', 'W79', 'W82', 'W69', 'W64', 'W62e'],
    stopLine: 'R0b 不启动真实 Adapter，也不实现 Compiled View 或 Spawn Gate。',
    authorityRef: 'human:mazz-maintainer',
    capturedAt: '2026-08-19T02:00:00.000Z',
    sourceRefs: ['authority:Mazz 当前未落地全景-W71归并版.md', 'spec:W66_REAL_AGENT_ADAPTER_ACTIVATION.md'],
    ...overrides,
  };
}

function capability(version = '1.0.0', suffix = 'v1') {
  return createToolCapabilitySnapshot({
    adapterId: 'foundation:test',
    adapterVersion: version,
    capturedAt: `2026-08-19T02:00:0${version === '1.0.0' ? '0' : '1'}.000Z`,
    tools: [{
      name: 'exec',
      argsSchemaHash: sha256(Buffer.from(`args-${suffix}`)),
      limits: { maxOutputTokens: version === '1.0.0' ? 1000 : 2000 },
      resultEnvelope: 'mazz.result-envelope/v0',
      handleKinds: ['process-session'],
      continuationApis: ['write-stdin'],
    }],
  });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w66-r0b-'));
  const sourcePath = path.join(root, 'rules.md');
  fs.writeFileSync(sourcePath, '# complete raw source\n', 'utf8');
  return { root, sourcePath, doctrineRoot: path.join(root, '.mazz', 'agent-doctrine'), dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe('W66-R0b Host Facts 与 Profile resolution', () => {
  test('Windows Local/Electron、Cloud Sandbox、Remote VPS 得到不同 applicability', () => {
    const windows = resolveDoctrineProfiles(host(), { projectId: 'mazz-editor' });
    const cloud = resolveDoctrineProfiles(host({
      factId: 'host:cloud', os: 'linux', shell: 'bash', executionMode: 'cloud',
      workspacePersistence: 'ephemeral', sandbox: true, packagedRuntime: 'node', electron: false,
    }), { projectId: 'mazz-editor' });
    const remote = resolveDoctrineProfiles(host({
      factId: 'host:remote', os: 'linux', shell: 'bash', executionMode: 'remote',
      packagedRuntime: 'node', electron: false, remoteTarget: true,
    }), { projectId: 'mazz-editor' });
    const ids = value => value.active.map(item => item.id);
    assert.deepEqual(ids(windows), ['universal-core', 'windows-local', 'electron-desktop', 'mazz-project']);
    assert.deepEqual(ids(cloud), ['universal-core', 'cloud-sandbox', 'mazz-project']);
    assert.deepEqual(ids(remote), ['universal-core', 'remote-vps', 'mazz-project']);
    assert.ok(windows.inactiveRetainedInRawSource.includes('cloud-sandbox'), '云沙箱规则保留在 raw，但不得对 Windows 激活');
  });

  test('Host Facts 缺失/自相矛盾 fail closed', () => {
    const missing = host();
    delete missing.shell;
    assert.throws(() => validateHostFacts(missing), error => ['DOCTRINE_SCHEMA_INVALID', 'HOST_FACTS_INVALID'].includes(error.code));
    assert.throws(() => validateHostFacts(host({ remoteTarget: true })), error => error.code === 'HOST_FACTS_INVALID');
  });
});

describe('W66-R0b Current SSoT 与 Tool Capability', () => {
  test('Current SSoT 必须携带 HEAD、停止线、来源和完整历史欠账', () => {
    const current = ssot();
    assert.equal(validateCurrentSsot(current), current);
    assert.throws(() => validateCurrentSsot(ssot({ sourceRefs: [] })), error => error.code === 'CURRENT_POLICY_INVALID');
    assert.throws(() => validateCurrentSsot(ssot({ head: 'not-a-commit' })), error => error.code === 'CURRENT_POLICY_INVALID');
  });

  test('Tool Capability 由 schema/limits/handle/continuation 计算 hash，漂移不可伪装', () => {
    const first = capability();
    assert.equal(validateToolCapabilitySnapshot(first), first);
    const forged = { ...first, toolsetHash: '0'.repeat(64) };
    assert.throws(() => validateToolCapabilitySnapshot(forged), error => error.code === 'TOOL_CAPABILITY_INVALID');
    assert.notEqual(first.toolsetHash, capability('1.1.0', 'v2').toolsetHash);
  });

  test('新上下文显式 supersede 旧能力，R0a 完整 raw 快照不被裁剪或改写', () => {
    const item = fixture();
    try {
      const r0a = snapshotR0aFoundation({
        sourcePath: item.sourcePath, doctrineRoot: item.doctrineRoot, authorityRef: 'human:test',
        ruleRegistry: registry, incidentLineage: lineage, clock: () => new Date('2026-08-19T02:00:00.000Z'),
      });
      const rawBefore = fs.readFileSync(path.join(item.doctrineRoot, r0a.sourceReceipt.snapshotRef));
      const first = snapshotR0bContext({
        doctrineRoot: item.doctrineRoot, hostFacts: host(), projectId: 'mazz-editor', currentSsot: ssot(), toolCapability: capability(),
        clock: () => new Date('2026-08-19T02:01:00.000Z'),
      });
      const second = snapshotR0bContext({
        doctrineRoot: item.doctrineRoot, hostFacts: host(), projectId: 'mazz-editor', currentSsot: ssot(), toolCapability: capability('1.1.0', 'v2'),
        clock: () => new Date('2026-08-19T02:02:00.000Z'),
      });
      const current = readCurrentDoctrineContext(item.doctrineRoot);
      assert.equal(second.supersedesContextHash, first.contextHash);
      assert.equal(current.contextHash, second.contextHash);
      assert.equal(current.toolCapabilityHash, second.toolCapabilityHash);
      assert.notEqual(current.toolCapabilityHash, first.toolCapabilityHash, '旧 Capability Snapshot 不得继续为 CURRENT');
      assert.equal(fs.readFileSync(path.join(item.doctrineRoot, r0a.sourceReceipt.snapshotRef)).equals(rawBefore), true);
    } finally { item.dispose(); }
  });
});
