import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';
import { openProductionRunLedger } from '../../renderer/modules/factory/production-run.js';
import { inspectFactoryRunConvergence } from '../../renderer/modules/factory/runtime-convergence.js';

const require = createRequire(import.meta.url);
const slice = require('../../main/foundation/software-release-slice.js');
const kernel = require('../../main/foundation/organizational-kernel.js');

const sha = value => `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;

class MemoryIo {
  constructor() { this.files = new Map(); }
  async exists(target) { return this.files.has(target); }
  async mkdir() { return true; }
  async read(target) {
    if (!this.files.has(target)) throw new Error(`missing ${target}`);
    return this.files.get(target);
  }
  async write(target, content) { this.files.set(target, String(content)); return true; }
}

function artifactVersions(workflow) {
  return Object.fromEntries(workflow.artifacts.map((item, index) => [item.artifactId, `fixture:${index + 1}`]));
}

function receipt(stage, status = 'passed', index = 0) {
  return {
    schema: slice.SOFTWARE_RELEASE_RECEIPT_SCHEMA,
    receiptId: `receipt:${stage}:${index + 1}`,
    stage,
    operationRef: `operation:w82b:${stage}`,
    toolRef: stage === 'build' ? 'npm:build' : stage === 'test' ? 'node:targeted-contracts' : stage === 'security' ? 'mazz:provenance-audit' : 'mazz:local-specimen-manifest',
    toolVersion: 'fixture:1',
    status,
    exitCode: status === 'passed' ? 0 : status === 'failed' ? 1 : null,
    startedAt: `2026-08-19T0${index}:00:00.000Z`,
    endedAt: `2026-08-19T0${index}:01:00.000Z`,
    inputDigest: sha(`${stage}:input`),
    outputDigest: sha(`${stage}:output:${status}`),
    evidenceRefs: [`evidence:w82b:${stage}`],
    nonProduction: true,
    pushed: false,
    published: false,
    externalMutation: false,
    message: `${stage} ${status}`,
  };
}

const authorityByGate = {
  'gate:build-review': ['authority:change-review', 'human:independent-reviewer'],
  'gate:test-security': ['authority:security-review', 'human:security-reviewer'],
  'gate:release': ['authority:release-owner', 'human:release-owner'],
};

function decision(gateId, outcome = 'approve', actorOverride = '') {
  const [authorityRef, actorRef] = authorityByGate[gateId];
  return {
    schema: slice.SOFTWARE_RELEASE_DECISION_SCHEMA,
    decisionId: `decision:${gateId.split(':').at(-1)}:${outcome}`,
    gateId,
    authorityRef,
    actorRef: actorOverride || actorRef,
    decision: outcome,
    scope: 'local-specimen',
    evidenceRefs: [`evidence:${gateId}`],
    reason: `${gateId} ${outcome} for a local specimen only`,
  };
}

function evaluationInput(overrides = {}) {
  const workflowPackage = slice.createSoftwareReleaseWorkflowPackage();
  return {
    workflowPackage,
    compileRequest: slice.createSoftwareReleaseCompileRequest(),
    artifactVersions: artifactVersions(workflowPackage),
    receipts: [receipt('build', 'passed', 1), receipt('test', 'passed', 2), receipt('security', 'passed', 3), receipt('package', 'passed', 4)],
    decisions: [decision('gate:build-review'), decision('gate:test-security'), decision('gate:release')],
    provenance: { source: 'W82b contract fixture', productionMutationAuthorized: false },
    ...overrides,
  };
}

async function appendProjection(ledger, result) {
  for (const event of slice.toW73ProductionRunEvents(result)) await ledger.append(event);
}

describe('W82b Software Release Organization Slice contracts', () => {
  test('完整软件发布组织冻结七工件、三 Gate 与开发/审查/发布分权', () => {
    const workflow = slice.createSoftwareReleaseWorkflowPackage();
    const request = slice.createSoftwareReleaseCompileRequest();
    const plan = kernel.compileOrganization(workflow, request);
    assert.equal(workflow.artifacts.length, 7);
    assert.equal(workflow.seats.length, 6);
    assert.deepEqual(workflow.gates.map(item => item.gateId), ['gate:build-review', 'gate:release', 'gate:test-security']);
    assert.equal(plan.status, 'READY');
    assert.equal(plan.compilerBoundary.executes, false);
    assert.equal(plan.compilerBoundary.publishes, false);
    const bindings = new Map(plan.authoritySchedule.map(item => [item.authorityRef, item.binding.actorRef]));
    assert.equal(bindings.get('authority:change-review'), 'human:independent-reviewer');
    assert.equal(bindings.get('authority:security-review'), 'human:security-reviewer');
    assert.equal(bindings.get('authority:release-owner'), 'human:release-owner');
    assert.notEqual(bindings.get('authority:release-owner'), plan.routing.find(item => item.seatId === 'seat:developer').selectedExecutorRef);
  });

  test('typed receipt fail closed：未知字段、secret、伪成功和越界 mutation 均被拒绝', () => {
    const unknown = receipt('build'); unknown.command = 'arbitrary shell';
    assert.throws(() => slice.normalizeSoftwareReleaseReceipt(unknown), /未冻结字段/);
    const secret = receipt('build'); secret.apiKey = 'must-not-enter';
    assert.throws(() => slice.normalizeSoftwareReleaseReceipt(secret), /禁止 secret/);
    const falsePass = receipt('build'); falsePass.exitCode = 1;
    assert.throws(() => slice.normalizeSoftwareReleaseReceipt(falsePass), /exitCode=0/);
    const pushed = receipt('package'); pushed.pushed = true;
    assert.throws(() => slice.normalizeSoftwareReleaseReceipt(pushed), /nonProduction=true/);
    const productionScope = decision('gate:release'); productionScope.scope = 'production';
    assert.throws(() => slice.normalizeSoftwareReleaseDecision(productionScope), /scope 不支持/);
  });

  test('全证据链只批准本地 specimen，且投影到 W73 后成为唯一 completed 运行真相', async () => {
    const result = slice.evaluateSoftwareReleaseSlice(evaluationInput());
    assert.equal(result.schema, slice.SOFTWARE_RELEASE_RESULT_SCHEMA);
    assert.equal(result.planStatus, 'READY');
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.localSealAllowed, true);
    assert.deepEqual(result.transitions.map(item => item.status), ['APPROVED', 'APPROVED', 'APPROVED']);
    assert.equal(result.executionBoundary.nonProduction, true);
    assert.equal(result.executionBoundary.productionReleaseAuthorized, false);
    assert.equal(result.executionBoundary.pushed, false);
    assert.equal(result.executionBoundary.published, false);

    const io = new MemoryIo();
    const ledger = await openProductionRunLedger({
      io, folder: 'C:/fixture/w82b-success', runId: 'run-w82b-success', taskId: 'task-w82b-success',
      workflowRef: result.workflowRef.workflowId, workflowVersion: result.workflowRef.version,
      domain: 'software-release', taskType: 'w82b.local-specimen',
      clock: (() => { let now = Date.parse('2026-08-19T10:00:00.000Z'); return () => (now += 1000); })(),
    });
    await appendProjection(ledger, result);
    assert.equal(ledger.snapshot.status, 'completed');
    assert.equal(ledger.snapshot.recoveryState.required, false);
    assert.ok(ledger.snapshot.gateRefs.includes('gate:release'));
    assert.ok(ledger.snapshot.outputArtifactRefs.some(item => item.role === 'local-non-production-specimen'));
    const checkpoint = inspectFactoryRunConvergence({ task: { id: 'task-w82b-success' }, runLedger: ledger });
    assert.equal(checkpoint.safeToSeal, true);
    await ledger.dispose();
  });

  test('Security 失败只失效安全报告及其下游，并进入可重开的 W73 Recovery State', async () => {
    const input = evaluationInput();
    input.receipts = input.receipts.map(item => item.stage === 'security' ? receipt('security', 'failed', 3) : item);
    input.decisions = input.decisions.map(item => item.gateId === 'gate:test-security' ? decision('gate:test-security', 'reject') : item);
    const result = slice.evaluateSoftwareReleaseSlice(input);
    assert.equal(result.status, 'RECOVERY_REQUIRED');
    assert.equal(result.localSealAllowed, false);
    assert.equal(result.recovery.recoveryPointId, 'recovery:assurance');
    assert.deepEqual(result.recovery.affectedArtifactIds, ['artifact:release-specimen', 'artifact:security-report']);
    assert.equal(result.recovery.affectedArtifactIds.includes('artifact:build-report'), false);

    const io = new MemoryIo();
    let ledger = await openProductionRunLedger({ io, folder: 'C:/fixture/w82b-failure', runId: 'run-w82b-failure', taskId: 'task-w82b-failure' });
    await appendProjection(ledger, result);
    assert.equal(ledger.snapshot.status, 'blocked');
    assert.equal(ledger.snapshot.recoveryState.required, true);
    assert.ok(ledger.snapshot.reworkRefs.includes('artifact:security-report'));
    await ledger.dispose();
    ledger = await openProductionRunLedger({ io, folder: 'C:/fixture/w82b-failure', runId: 'run-w82b-failure', taskId: 'task-w82b-failure', recoverOrphaned: true });
    assert.equal(ledger.snapshot.status, 'blocked');
    await ledger.append({ type: 'run-started', toStatus: 'running', reasonCode: 'EXPLICIT_LOCAL_REPAIR' });
    assert.equal(ledger.snapshot.status, 'running');
    assert.equal(ledger.snapshot.recoveryState.required, false);
    await ledger.dispose();
  });

  test('缺证据保持 UNKNOWN；Authority actor 与编译绑定不一致时必须 BLOCKED', () => {
    const missing = evaluationInput();
    missing.receipts = missing.receipts.filter(item => item.stage !== 'test');
    missing.decisions = missing.decisions.filter(item => item.gateId !== 'gate:test-security');
    const unknown = slice.evaluateSoftwareReleaseSlice(missing);
    assert.equal(unknown.status, 'UNKNOWN');
    assert.equal(unknown.localSealAllowed, false);
    assert.equal(slice.toW73ProductionRunEvents(unknown).at(-1).type, 'run-paused');

    const mismatch = evaluationInput();
    mismatch.decisions = mismatch.decisions.map(item => item.gateId === 'gate:release'
      ? decision('gate:release', 'approve', 'human:unbound-release-actor') : item);
    const blocked = slice.evaluateSoftwareReleaseSlice(mismatch);
    assert.equal(blocked.status, 'RECOVERY_REQUIRED');
    assert.ok(blocked.transitions.find(item => item.gateId === 'gate:release').reasons.includes('AUTHORITY_ACTOR_MISMATCH'));
  });

  test('开发者自占独立审查或发布 Authority 时，编译计划先行 BLOCKED', () => {
    const input = evaluationInput();
    const request = structuredClone(input.compileRequest);
    request.authorityBindings.find(item => item.authorityRef === 'authority:release-owner').actorRef = 'human:developer';
    input.compileRequest = request;
    input.decisions = input.decisions.map(item => item.gateId === 'gate:release'
      ? decision('gate:release', 'approve', 'human:developer') : item);
    const result = slice.evaluateSoftwareReleaseSlice(input);
    assert.equal(result.planStatus, 'BLOCKED');
    assert.equal(result.status, 'RECOVERY_REQUIRED');
    assert.ok(result.recovery.reasons.includes('AUTHORITY_SEPARATION_VIOLATION'));
  });

  test('W82b 模块不含任意进程、网络、文件或 Electron 执行能力', () => {
    const source = fs.readFileSync(new URL('../../main/foundation/software-release-slice.js', import.meta.url), 'utf8');
    for (const forbidden of [
      "require('child_process')", "require('fs')", "require('http')", "require('https')",
      "require('electron')", 'ipcMain', 'ipcRenderer', '.spawn(', '.exec(', 'fetch(', 'WebSocket',
    ]) assert.equal(source.includes(forbidden), false, `W82b slice 不得携带运行时能力: ${forbidden}`);
  });

  test('实施证据诚实区分 scoped validation、历史 full suite 与生产发布边界', () => {
    const evidence = JSON.parse(fs.readFileSync(new URL('../../docs/engineering/evidence/W82B_SOFTWARE_RELEASE_SPECIMEN.json', import.meta.url), 'utf8'));
    assert.equal(evidence.schema, 'mazz.w82b-implementation-evidence/v0');
    assert.equal(evidence.actualChecks.length, 4);
    assert.ok(evidence.actualChecks.every(item => item.status === 'passed' && item.exitCode === 0));
    assert.equal(evidence.fullSuite.rerunThisWave, false);
    assert.equal(evidence.boundary.nonProduction, true);
    assert.equal(evidence.boundary.installerBuilt, false);
    assert.equal(evidence.boundary.productionReleaseAuthorized, false);
    assert.match(evidence.stopLine, /W82c-W82h.*remain open/);
  });
});
