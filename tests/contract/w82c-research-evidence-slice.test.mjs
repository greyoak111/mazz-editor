import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';
import { openProductionRunLedger } from '../../renderer/modules/factory/production-run.js';

const require = createRequire(import.meta.url);
const research = require('../../main/foundation/research-evidence-slice.js');
const kernel = require('../../main/foundation/organizational-kernel.js');
const sha = value => `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;

class MemoryIo {
  constructor() { this.files = new Map(); }
  async exists(target) { return this.files.has(target); }
  async mkdir() { return true; }
  async read(target) { if (!this.files.has(target)) throw new Error(`missing ${target}`); return this.files.get(target); }
  async write(target, content) { this.files.set(target, String(content)); return true; }
}

const stages = ['citations', 'data-integrity', 'statistics', 'analysis-trace', 'replication', 'report-audit'];
const authorityByGate = {
  'gate:evidence-method': ['authority:method-owner', 'human:method-lead'],
  'gate:analysis-review': ['authority:analysis-review', 'human:adversarial-reviewer'],
  'gate:replication': ['authority:replication-owner', 'human:replication-owner'],
  'gate:report': ['authority:research-lead', 'human:research-lead'],
};

function receipt(stage, status = 'passed', index = stages.indexOf(stage) + 1) {
  return {
    schema: research.RESEARCH_RECEIPT_SCHEMA,
    receiptId: `receipt:w82c:${stage}:${index}`,
    stage,
    operationRef: `operation:w82c:${stage}`,
    toolRef: `tool:w82c:${stage}`,
    toolVersion: 'fixture:1',
    executorRef: ['analysis-trace'].includes(stage) ? 'agent:evidence-analyst' : `script:${stage}`,
    status,
    exitCode: status === 'passed' ? 0 : status === 'failed' ? 2 : null,
    startedAt: `2026-08-19T${String(index).padStart(2, '0')}:00:00.000Z`,
    endedAt: `2026-08-19T${String(index).padStart(2, '0')}:01:00.000Z`,
    inputDigest: sha(`${stage}:input`),
    outputDigest: sha(`${stage}:output:${status}`),
    evidenceRefs: [`evidence:w82c:${stage}`],
    scope: 'local-research-specimen',
    published: false,
    externalMutation: false,
    message: `${stage} ${status}`,
  };
}

function decision(gateId, outcome = 'approve', actorOverride = '') {
  const [authorityRef, actorRef] = authorityByGate[gateId];
  return {
    schema: research.RESEARCH_DECISION_SCHEMA,
    decisionId: `decision:w82c:${gateId.split(':').at(-1)}:${outcome}`,
    gateId,
    authorityRef,
    actorRef: actorOverride || actorRef,
    decision: outcome,
    scope: 'local-research-specimen',
    evidenceRefs: [`evidence:w82c:${gateId}`],
    reason: `${gateId} ${outcome}; no publication granted`,
  };
}

function input(overrides = {}) {
  const workflowPackage = research.createResearchWorkflowPackage();
  return {
    workflowPackage,
    compileRequest: research.createResearchCompileRequest(),
    artifactVersions: Object.fromEntries(workflowPackage.artifacts.map((item, index) => [item.artifactId, `fixture:${index + 1}`])),
    receipts: stages.map((stage, index) => receipt(stage, 'passed', index + 1)),
    decisions: Object.keys(authorityByGate).map(gateId => decision(gateId)),
    provenance: { source: 'W82c contract fixture', publicationAuthorized: false },
    ...overrides,
  };
}

async function appendEvents(ledger, result) {
  for (const event of research.toW73ResearchEvents(result)) await ledger.append(event);
}

describe('W82c Research / Evidence Organization Slice contracts', () => {
  test('Question→Literature→Method→Data→Analysis→Review→Replication→Report 由同一 W82 内核编译 READY', () => {
    const workflow = research.createResearchWorkflowPackage();
    const plan = kernel.compileOrganization(workflow, research.createResearchCompileRequest());
    assert.equal(workflow.artifacts.length, 9);
    assert.equal(workflow.seats.length, 8);
    assert.equal(workflow.gates.length, 4);
    assert.equal(plan.status, 'READY');
    assert.equal(plan.compilerBoundary.runtimeOwner, 'W73');
    assert.equal(plan.compilerBoundary.executes, false);
    assert.ok(workflow.artifacts.some(item => item.artifactId === 'artifact:statistics' && item.producedBySeatId === 'seat:statistician'));
    assert.ok(workflow.artifacts.some(item => item.artifactId === 'artifact:analysis' && item.producedBySeatId === 'seat:analyst'));
  });

  test('确定性计算、模型判断、独立复核和 Human Final 不得混写', () => {
    const plan = kernel.compileOrganization(research.createResearchWorkflowPackage(), research.createResearchCompileRequest());
    assert.equal(plan.routing.find(item => item.seatId === 'seat:statistician').selectedExecutorRef, 'script:statistics');
    assert.equal(plan.routing.find(item => item.seatId === 'seat:analyst').selectedExecutorRef, 'agent:evidence-analyst');
    assert.equal(plan.authoritySchedule.find(item => item.authorityRef === 'authority:analysis-review').binding.actorRef, 'human:adversarial-reviewer');
    assert.equal(plan.authoritySchedule.find(item => item.authorityRef === 'authority:research-lead').binding.actorRef, 'human:research-lead');
    assert.equal(new Set(['script:statistics', 'agent:evidence-analyst', 'human:adversarial-reviewer', 'human:research-lead']).size, 4);
  });

  test('严格 receipt/decision 拒绝未知字段、secret、伪成功和 publication 越界', () => {
    const arbitrary = receipt('statistics'); arbitrary.command = 'hidden shell';
    assert.throws(() => research.normalizeResearchReceipt(arbitrary), /未冻结字段/);
    const secret = receipt('citations'); secret.apiKey = 'must-not-enter';
    assert.throws(() => research.normalizeResearchReceipt(secret), /禁止 secret/);
    const falsePass = receipt('replication'); falsePass.exitCode = 9;
    assert.throws(() => research.normalizeResearchReceipt(falsePass), /exitCode=0/);
    const published = receipt('report-audit'); published.published = true;
    assert.throws(() => research.normalizeResearchReceipt(published), /published=false/);
    const auto = decision('gate:report'); auto.actorRef = 'agent:research-lead';
    assert.throws(() => research.normalizeResearchDecision(auto), /human:\*/);
  });

  test('完整证据产生本地 report，并经 W73 成为 completed 运行真相但不授予 publication', async () => {
    const result = research.evaluateResearchSlice(input());
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.localSealAllowed, true);
    assert.deepEqual(result.transitions.map(item => item.status), ['APPROVED', 'APPROVED', 'APPROVED', 'APPROVED']);
    assert.equal(result.boundary.reportPublished, false);
    assert.equal(result.boundary.modelJudgmentAuthority, false);

    const io = new MemoryIo();
    const ledger = await openProductionRunLedger({ io, folder: 'C:/fixture/w82c-success', runId: 'run-w82c-success', taskId: 'task-w82c-success', domain: 'evidence-research', taskType: 'w82c.local-report' });
    await appendEvents(ledger, result);
    assert.equal(ledger.snapshot.status, 'completed');
    assert.ok(ledger.snapshot.outputArtifactRefs.some(item => item.id === 'artifact:report'));
    assert.ok(ledger.snapshot.gateRefs.includes('gate:report'));
    await ledger.dispose();
  });

  test('缺 citation 保持 UNKNOWN；citation 失败局部回退但不污染 Question', () => {
    const missing = input();
    missing.receipts = missing.receipts.filter(item => item.stage !== 'citations');
    assert.equal(research.evaluateResearchSlice(missing).status, 'UNKNOWN');

    const failed = input();
    failed.receipts = failed.receipts.map(item => item.stage === 'citations' ? receipt('citations', 'failed') : item);
    const result = research.evaluateResearchSlice(failed);
    assert.equal(result.status, 'RECOVERY_REQUIRED');
    assert.equal(result.recovery.recoveryPointId, 'recovery:evidence-method');
    assert.equal(result.recovery.changedArtifactId, 'artifact:literature');
    assert.equal(result.recovery.affectedArtifactIds.includes('artifact:question'), false);
    assert.ok(result.recovery.affectedArtifactIds.includes('artifact:report'));
  });

  test('统计、复现和方法失败分别只回退对应分支及下游', () => {
    const statsInput = input();
    statsInput.receipts = statsInput.receipts.map(item => item.stage === 'statistics' ? receipt('statistics', 'failed') : item);
    const stats = research.evaluateResearchSlice(statsInput);
    assert.equal(stats.recovery.changedArtifactId, 'artifact:statistics');
    assert.equal(stats.recovery.affectedArtifactIds.includes('artifact:data'), false);
    assert.ok(stats.recovery.affectedArtifactIds.includes('artifact:analysis'));

    const replicationInput = input();
    replicationInput.receipts = replicationInput.receipts.map(item => item.stage === 'replication' ? receipt('replication', 'failed') : item);
    const replication = research.evaluateResearchSlice(replicationInput);
    assert.deepEqual(replication.recovery.affectedArtifactIds, ['artifact:replication', 'artifact:report']);

    const methodInput = input();
    methodInput.decisions = methodInput.decisions.map(item => item.gateId === 'gate:evidence-method' ? decision('gate:evidence-method', 'reject') : item);
    const method = research.evaluateResearchSlice(methodInput);
    assert.equal(method.recovery.changedArtifactId, 'artifact:method');
    assert.equal(method.recovery.affectedArtifactIds.includes('artifact:literature'), false);
    assert.ok(method.recovery.affectedArtifactIds.includes('artifact:data'));
  });

  test('失败投影进入 W73 blocked，重开后必须显式恢复', async () => {
    const failureInput = input();
    failureInput.receipts = failureInput.receipts.map(item => item.stage === 'replication' ? receipt('replication', 'failed') : item);
    failureInput.decisions = failureInput.decisions.map(item => item.gateId === 'gate:replication' ? decision('gate:replication', 'reject') : item);
    const result = research.evaluateResearchSlice(failureInput);
    const io = new MemoryIo();
    let ledger = await openProductionRunLedger({ io, folder: 'C:/fixture/w82c-failure', runId: 'run-w82c-failure', taskId: 'task-w82c-failure' });
    await appendEvents(ledger, result);
    assert.equal(ledger.snapshot.status, 'blocked');
    assert.equal(ledger.snapshot.recoveryState.required, true);
    await ledger.dispose();
    ledger = await openProductionRunLedger({ io, folder: 'C:/fixture/w82c-failure', runId: 'run-w82c-failure', taskId: 'task-w82c-failure', recoverOrphaned: true });
    await ledger.append({ type: 'run-started', toStatus: 'running', reasonCode: 'EXPLICIT_REPLICATION_REPAIR' });
    assert.equal(ledger.snapshot.status, 'running');
    assert.equal(ledger.snapshot.recoveryState.required, false);
    await ledger.dispose();
  });

  test('分析者自占 Human Final 或 decision actor 未绑定时必须 BLOCKED', () => {
    const self = input();
    const request = structuredClone(self.compileRequest);
    request.authorityBindings.find(item => item.authorityRef === 'authority:research-lead').actorRef = 'agent:evidence-analyst';
    self.compileRequest = request;
    assert.equal(research.evaluateResearchSlice(self).planStatus, 'BLOCKED');

    const mismatch = input();
    mismatch.decisions = mismatch.decisions.map(item => item.gateId === 'gate:report' ? decision('gate:report', 'approve', 'human:unbound-editor') : item);
    const result = research.evaluateResearchSlice(mismatch);
    assert.equal(result.status, 'RECOVERY_REQUIRED');
    assert.ok(result.transitions.find(item => item.gateId === 'gate:report').reasons.includes('AUTHORITY_ACTOR_MISMATCH'));
  });

  test('W82c Foundation 不含任意进程、文件、网络或 Electron 执行能力', () => {
    for (const file of ['../../main/foundation/evidence-slice-runtime.js', '../../main/foundation/research-evidence-slice.js']) {
      const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const forbidden of ["require('child_process')", "require('fs')", "require('http')", "require('electron')", '.spawn(', '.exec(', 'fetch(', 'WebSocket']) {
        assert.equal(source.includes(forbidden), false, `${file} 不得包含 ${forbidden}`);
      }
    }
  });

  test('实施证据区分本地 specimen、真实研究主张、Publication 与历史 full suite', () => {
    const evidence = JSON.parse(fs.readFileSync(new URL('../../docs/engineering/evidence/W82C_RESEARCH_EVIDENCE_SPECIMEN.json', import.meta.url), 'utf8'));
    assert.equal(evidence.schema, 'mazz.w82c-implementation-evidence/v0');
    assert.equal(evidence.actualChecks.length, 4);
    assert.ok(evidence.actualChecks.every(item => item.status === 'passed' && item.exitCode === 0));
    assert.equal(evidence.fullSuite.rerunThisWave, false);
    assert.equal(evidence.boundary.realResearchClaimValidated, false);
    assert.equal(evidence.boundary.published, false);
    assert.match(evidence.stopLine, /W82d-W82h.*remain open/);
  });
});
