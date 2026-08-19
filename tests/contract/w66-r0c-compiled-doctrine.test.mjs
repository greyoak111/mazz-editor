// W66-R0c Compiled View / Manifest / Rule Drift → new Attempt
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  HOST_FACTS_SCHEMA,
  CURRENT_SSOT_SCHEMA,
  compileDoctrineAttempt,
  createToolCapabilitySnapshot,
  currentAttemptManifest,
  loadDoctrineInjectionBundle,
  resolveDoctrineProfiles,
  sha256,
  snapshotR0aFoundation,
} = require('../../main/agent-doctrine.js');

const registry = JSON.parse(fs.readFileSync('docs/engineering/doctrine/MAZZ_STABLE_RULE_REGISTRY.v0.json', 'utf8'));
const lineage = JSON.parse(fs.readFileSync('docs/engineering/doctrine/MAZZ_INCIDENT_LINEAGE.v0.json', 'utf8'));

function context() {
  const hostFacts = {
    schemaVersion: HOST_FACTS_SCHEMA,
    factId: 'host:windows-local',
    capturedAt: '2026-08-19T03:00:00.000Z',
    os: 'windows', shell: 'powershell', executionMode: 'local', workspacePersistence: 'durable',
    sandbox: false, packagedRuntime: 'electron', electron: true, network: true, remoteTarget: false,
  };
  const profileIndex = resolveDoctrineProfiles(hostFacts, {
    projectId: 'mazz-editor',
    domainProfiles: ['async-runtime', 'electron-media', 'software-testing'],
  });
  const currentSsot = {
    schemaVersion: CURRENT_SSOT_SCHEMA,
    taskId: 'mazz:w66-r0c', wave: 'W66-R0c', status: 'RUNNING', branch: 'main',
    head: '8cb8964', remoteHead: '482bc2d',
    openItems: ['W66-R0d', 'W66-R0e', 'W66-R1-R6', 'W79', 'W82', 'W69', 'W64', 'W62e'],
    stopLine: 'R0c 只编译 Attempt 规则环境；不接 Spawn Gate 或真实 Adapter。',
    authorityRef: 'human:mazz-maintainer', capturedAt: '2026-08-19T03:00:00.000Z',
    sourceRefs: ['authority:Mazz 当前未落地全景-W71归并版.md', 'spec:W66_REAL_AGENT_ADAPTER_ACTIVATION.md'],
  };
  const toolCapability = createToolCapabilitySnapshot({
    adapterId: 'foundation:test', adapterVersion: '0.0.0-foundation', capturedAt: '2026-08-19T03:00:00.000Z',
    tools: [{
      name: 'exec', argsSchemaHash: sha256(Buffer.from('exec-schema-v1')), limits: { outputTokens: 10000 },
      resultEnvelope: 'mazz.result-envelope/v0', handleKinds: ['process-session'], continuationApis: ['write-stdin'],
    }],
  });
  return { hostFacts, profileIndex, currentSsot, toolCapability };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w66-r0c-'));
  const sourcePath = path.join(root, 'rules.md');
  const rawA = Buffer.from('# Canonical Rules\r\n\r\nVersion A\r\n', 'utf8');
  fs.writeFileSync(sourcePath, rawA);
  return {
    root, sourcePath, rawA, rawB: Buffer.from('# Canonical Rules\r\n\r\nVersion B\r\n', 'utf8'),
    doctrineRoot: path.join(root, '.mazz', 'agent-doctrine'),
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function r0a(item, capturedAt = '2026-08-19T03:01:00.000Z') {
  return snapshotR0aFoundation({
    sourcePath: item.sourcePath, doctrineRoot: item.doctrineRoot, authorityRef: 'human:test-maintainer',
    ruleRegistry: registry, incidentLineage: lineage, clock: () => new Date(capturedAt),
  });
}

function compile(item, sourceReceipt, attemptId, options = {}) {
  return compileDoctrineAttempt({
    doctrineRoot: item.doctrineRoot, attemptId, authorityRef: 'human:test-maintainer', sourceReceipt,
    ruleRegistry: registry, incidentLineage: lineage, ...context(), projectId: 'mazz-editor',
    clock: () => new Date(options.compiledAt || '2026-08-19T03:02:00.000Z'),
    previousAttemptId: options.previousAttemptId || null,
    changeAcceptance: options.changeAcceptance || null,
  });
}

describe('W66-R0c Compiled View / Manifest', () => {
  test('每个 Attempt 同时携带完整 Raw Source、适用索引、Current SSoT、Capability 与全组件 hash', () => {
    const item = fixture();
    try {
      const foundation = r0a(item);
      const manifest = compile(item, foundation.sourceReceipt, 'attempt-a');
      const bundle = loadDoctrineInjectionBundle({ doctrineRoot: item.doctrineRoot, attemptId: 'attempt-a' });
      assert.equal(bundle.rawSource.equals(item.rawA), true, 'Raw Source 必须逐字节完整，Compiled View 不得替代它');
      assert.equal(bundle.compiledView.rawSource.injection, 'REQUIRED_FULL_BYTES');
      assert.equal(bundle.manifest.compiledRulePackHash, manifest.compiledRulePackHash);
      for (const field of [
        'hostFactsHash', 'profileIndexHash', 'ruleRegistryHash', 'incidentLineageHash',
        'projectDoctrineHash', 'currentPolicyHash', 'toolCapabilityHash', 'gatePackHash',
        'regressionPackHash', 'applicableRuleIndexHash', 'compiledViewHash', 'compiledRulePackHash',
      ]) assert.match(manifest[field], /^[a-f0-9]{64}$/, `${field} 必须是 SHA-256`);
      const index = JSON.parse(fs.readFileSync(path.join(item.doctrineRoot, 'attempts', 'attempt-a', 'applicable-rule-index.json'), 'utf8'));
      assert.ok(index.active.some(rule => rule.ruleId === 'MAZZ-RULE-PACK-001'));
      assert.ok(index.inactive.some(rule => rule.ruleId === 'SANDBOX-DURABILITY-001'), 'Cloud 处方必须保留但不对 Windows 激活');
      const again = compile(item, foundation.sourceReceipt, 'attempt-a', { compiledAt: '2026-08-19T09:00:00.000Z' });
      assert.equal(again.compiledRulePackHash, manifest.compiledRulePackHash, '同 Attempt 重试必须读取已冻结工件而非重编译');
      assert.equal(again.compiledAt, manifest.compiledAt);
    } finally { item.dispose(); }
  });

  test('任何组件被篡改后，Injection load 在进入 Adapter 前 fail closed', () => {
    const item = fixture();
    try {
      const foundation = r0a(item);
      compile(item, foundation.sourceReceipt, 'attempt-a');
      const target = path.join(item.doctrineRoot, 'attempts', 'attempt-a', 'current-ssot.json');
      const tampered = JSON.parse(fs.readFileSync(target, 'utf8'));
      tampered.status = 'FAKE_COMPLETE';
      fs.writeFileSync(target, JSON.stringify(tampered), 'utf8');
      assert.throws(
        () => loadDoctrineInjectionBundle({ doctrineRoot: item.doctrineRoot, attemptId: 'attempt-a' }),
        error => error.code === 'COMPILED_MANIFEST_INVALID',
      );
    } finally { item.dispose(); }
  });
});

describe('W66-R0c Rule drift → new Attempt', () => {
  test('原 Attempt 不暗更新；新 hash 需要 human acceptance、新 Attempt 与 supersedes 证据', () => {
    const item = fixture();
    try {
      const firstFoundation = r0a(item);
      const first = compile(item, firstFoundation.sourceReceipt, 'attempt-a');
      const oldManifestBytes = fs.readFileSync(path.join(item.doctrineRoot, 'attempts', 'attempt-a', 'manifest.json'));
      fs.writeFileSync(item.sourcePath, item.rawB);
      const secondFoundation = r0a(item, '2026-08-19T03:03:00.000Z');

      assert.throws(
        () => compile(item, secondFoundation.sourceReceipt, 'attempt-b', { previousAttemptId: 'attempt-a' }),
        error => error.code === 'RULE_PACK_CHANGED_WITHOUT_ACCEPTANCE',
      );
      assert.throws(
        () => compile(item, secondFoundation.sourceReceipt, 'attempt-b', {
          previousAttemptId: 'attempt-a',
          changeAcceptance: { authorityRef: 'agent:auto', reason: 'silent update', acceptedAt: '2026-08-19T03:04:00.000Z', supersedesAttemptId: 'attempt-a' },
        }),
        error => error.code === 'RULE_PACK_CHANGED_WITHOUT_ACCEPTANCE',
      );
      const second = compile(item, secondFoundation.sourceReceipt, 'attempt-b', {
        previousAttemptId: 'attempt-a', compiledAt: '2026-08-19T03:05:00.000Z',
        changeAcceptance: {
          authorityRef: 'human:test-maintainer', reason: '接受 Canonical Rule Source vB',
          acceptedAt: '2026-08-19T03:04:00.000Z', supersedesAttemptId: 'attempt-a',
        },
      });
      assert.equal(second.previousAttemptId, 'attempt-a');
      assert.equal(second.ruleDrift.fromRulePackHash, first.canonicalSource.sha256);
      assert.equal(second.ruleDrift.toRulePackHash, secondFoundation.sourceReceipt.sha256);
      assert.notEqual(first.compiledRulePackHash, second.compiledRulePackHash);
      assert.equal(loadDoctrineInjectionBundle({ doctrineRoot: item.doctrineRoot, attemptId: 'attempt-a' }).rawSource.equals(item.rawA), true);
      assert.equal(loadDoctrineInjectionBundle({ doctrineRoot: item.doctrineRoot, attemptId: 'attempt-b' }).rawSource.equals(item.rawB), true);
      assert.equal(fs.readFileSync(path.join(item.doctrineRoot, 'attempts', 'attempt-a', 'manifest.json')).equals(oldManifestBytes), true, '旧 Attempt 必须原字节冻结');
      assert.equal(currentAttemptManifest(item.doctrineRoot).attemptId, 'attempt-b');
      assert.throws(
        () => compile(item, secondFoundation.sourceReceipt, 'attempt-a'),
        error => error.code === 'DOCTRINE_IMMUTABLE_CONFLICT',
      );
    } finally { item.dispose(); }
  });

  test('已有 Attempt 时禁止省略 previousAttemptId 另起孤儿链', () => {
    const item = fixture();
    try {
      const foundation = r0a(item);
      compile(item, foundation.sourceReceipt, 'attempt-a');
      assert.throws(
        () => compile(item, foundation.sourceReceipt, 'attempt-orphan'),
        error => error.code === 'PREVIOUS_ATTEMPT_REQUIRED',
      );
    } finally { item.dispose(); }
  });
});
