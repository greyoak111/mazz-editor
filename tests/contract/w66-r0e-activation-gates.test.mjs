import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { AgentHarnessRegistry } = require('../../main/agent-harness.js');
const {
  createSpawnGate, createCompletionReceipt, assertCompletionGate,
  scanOutboundSecrets, assertSecretHygiene, assertIncidentClosure,
  validateGateRegistry, validateRegressionRegistry,
} = require('../../main/agent-activation-gates.js');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function bundle(raw = Buffer.from('完整军规\n')) {
  return {
    rawSource: raw,
    rawSourceText: raw.toString('utf8'),
    compiledView: { rawSource: { injection: 'REQUIRED_FULL_BYTES' } },
    manifest: {
      rulePackId: `rule-pack:${hash(raw)}`,
      canonicalSource: { sha256: hash(raw), byteLength: raw.length },
      compiledRulePackHash: hash(Buffer.from('compiled')),
    },
  };
}

function adapter(counter) {
  return {
    id: 'real-fixture',
    async detect() { return { available: true }; }, async probe() { return { ok: true }; },
    async capabilities() { return { workspace: true }; },
    async createSession(input) { counter.count++; counter.input = input; return {}; },
    async send() {}, async interrupt() {}, async dispose() {}, async events() { return () => {}; },
  };
}

describe('W66-R0e Spawn Gate', () => {
  test('Rule Pack/permission 失败时 Adapter createSession 调用数为零', async () => {
    const counter = { count: 0 };
    const registry = new AgentHarnessRegistry({ activationGate: createSpawnGate({ bundleLoader: () => { const error = new Error('missing'); error.code = 'RULE_PACK_REQUIRED'; throw error; } }) });
    registry.register(adapter(counter));
    await assert.rejects(() => registry.createSession({ adapterId: 'real-fixture', activation: { doctrineRoot: 'x', attemptId: 'a', permissionPreview: { status: 'approved', profileRef: 'p' } } }), error => error.code === 'RULE_PACK_REQUIRED');
    assert.equal(counter.count, 0);

    const permitted = new AgentHarnessRegistry({ activationGate: createSpawnGate({ bundleLoader: () => bundle() }) });
    permitted.register(adapter(counter));
    await assert.rejects(() => permitted.createSession({ adapterId: 'real-fixture', activation: { doctrineRoot: 'x', attemptId: 'a' } }), error => error.code === 'PERMISSION_PREVIEW_REQUIRED');
    assert.equal(counter.count, 0);
  });

  test('通过 Gate 后三个 Adapter 形态收到同一完整 Raw + Compiled hash', async () => {
    const raw = Buffer.from('军规全文原字节\n');
    const receipts = [];
    for (const id of ['kimi-code', 'claude-code', 'codex']) {
      const counter = { count: 0 };
      const fake = adapter(counter); fake.id = id;
      const registry = new AgentHarnessRegistry({ idFactory: () => `session-${id}`, activationGate: createSpawnGate({ bundleLoader: () => bundle(raw) }) });
      registry.register(fake);
      const created = await registry.createSession({ adapterId: id, activation: { doctrineRoot: 'x', attemptId: 'attempt-1', permissionPreview: { status: 'restricted', profileRef: 'permission:safe' } } });
      receipts.push(created.rulePackHash);
      assert.equal(counter.input.rulePackInjection.rawSource.equals(raw), true);
      assert.equal(counter.input.rulePackInjection.compiledView.rawSource.injection, 'REQUIRED_FULL_BYTES');
      await registry.dispose(created.id);
    }
    assert.equal(new Set(receipts).size, 1);
  });
});

describe('W66-R0e Completion / Secret / Incident Gate', () => {
  test('缺来源或缺完成证据时 COMPLETE 不可达', () => {
    const base = {
      status: 'COMPLETE', exactGateId: 'G-02', artifactRefs: ['a'], testsRun: ['t'], testsNotRun: [],
      acceptancePaths: { packagedRuntime: 'PASS' }, evidenceRefs: ['e'], artifactHashes: { a: hash(Buffer.from('a')) },
      commit: 'abcdef1', remoteState: 'not-pushed', remainingWork: [],
    };
    assert.throws(() => assertCompletionGate(createCompletionReceipt({ ...base, sourceManifest: { required: ['s'], retrieved: [], missing: ['s'] } })), error => error.code === 'SOURCE_MANIFEST_INCOMPLETE');
    assert.throws(() => assertCompletionGate(createCompletionReceipt({ ...base, testsRun: [], sourceManifest: { required: [], retrieved: [], missing: [] } })), error => error.code === 'COMPLETION_EVIDENCE_INCOMPLETE');
    assert.equal(assertCompletionGate(createCompletionReceipt({ ...base, sourceManifest: { required: [], retrieved: [], missing: [] } })), true);
  });

  test('secret canary 只返回种类/路径/hash，不回显秘密原值', () => {
    const canary = 'password=R0e-canary-very-secret';
    const receipt = scanOutboundSecrets({ chat: canary });
    assert.equal(receipt.allowed, false);
    assert.equal(JSON.stringify(receipt).includes('R0e-canary-very-secret'), false);
    assert.throws(() => assertSecretHygiene({ screenshot: canary }), error => error.code === 'SECRET_HYGIENE_BLOCKED');
  });

  test('Incident 缺 RED/GREEN/Regression/Doctrine 决议时不能关闭', () => {
    assert.throws(() => assertIncidentClosure({ id: 'I', symptom: 'x' }), error => error.code === 'INCIDENT_PROMOTION_INCOMPLETE');
    const closed = assertIncidentClosure({
      id: 'MAZZ-TEST', symptom: '重复错误', rootCause: '缺 Gate', redFixture: 'fixture:red', fixRef: 'commit:1',
      greenEvidence: 'test:green', regressionId: 'REG-TEST-GATE', doctrineDecision: 'no-change', gateDecision: 'added',
    });
    assert.equal(closed.closed, true);
  });

  test('Gate/Regression Registry 使用稳定 ID 且无重复', () => {
    const gates = JSON.parse(fs.readFileSync('docs/engineering/doctrine/MAZZ_GATE_REGISTRY.v0.json', 'utf8'));
    const regressions = JSON.parse(fs.readFileSync('docs/engineering/doctrine/MAZZ_REGRESSION_REGISTRY.v0.json', 'utf8'));
    assert.equal(validateGateRegistry(gates), gates);
    assert.equal(validateRegressionRegistry(regressions), regressions);
    assert.ok(gates.gates.some(row => row.id === 'G-R0-09'));
    assert.ok(regressions.regressions.some(row => row.id === 'REG-RULE-PACK-ZERO-SPAWN'));
  });
});
