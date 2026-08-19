import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';
import { openProductionRunLedger } from '../../renderer/modules/factory/production-run.js';

const require = createRequire(import.meta.url);
const animation = require('../../main/foundation/animation-short-slice.js');
const kernel = require('../../main/foundation/organizational-kernel.js');
const sha = value => `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;

class MemoryIo {
  constructor() { this.files = new Map(); }
  async exists(target) { return this.files.has(target); }
  async mkdir() { return true; }
  async read(target) { if (!this.files.has(target)) throw new Error(`missing ${target}`); return this.files.get(target); }
  async write(target, content) { this.files.set(target, String(content)); return true; }
}

const stages = [
  'storyboard-coverage', 'visual-shot-01-render', 'visual-shot-02-render',
  'audio-render', 'timeline-assembly', 'qc', 'master-manifest',
];
const authorityByGate = {
  'gate:preproduction': ['authority:creative-director', 'human:creative-director'],
  'gate:asset-production': ['authority:creative-director', 'human:creative-director'],
  'gate:timeline-qc': ['authority:qc-owner', 'human:qc-reviewer'],
  'gate:master': ['authority:master-owner', 'human:master-owner'],
};

function executorFor(stage) {
  if (stage.startsWith('visual-shot')) return 'tool:visual-primary';
  if (stage === 'audio-render') return 'tool:audio-renderer';
  if (stage === 'timeline-assembly') return 'script:timeline-assembler';
  if (stage === 'qc') return 'tool:media-qc';
  if (stage === 'storyboard-coverage') return 'script:storyboard-check';
  return 'script:master-manifest';
}

function receipt(stage, status = 'passed', index = stages.indexOf(stage) + 1) {
  return {
    schema: animation.ANIMATION_RECEIPT_SCHEMA,
    receiptId: `receipt:w82d:${stage}:${index}`,
    stage,
    operationRef: `operation:w82d:${stage}`,
    toolRef: `tool:w82d:${stage}`,
    toolVersion: 'fixture:1',
    executorRef: executorFor(stage),
    status,
    exitCode: status === 'passed' ? 0 : status === 'failed' ? 3 : null,
    startedAt: `2026-08-19T${String(index + 10).padStart(2, '0')}:00:00.000Z`,
    endedAt: `2026-08-19T${String(index + 10).padStart(2, '0')}:01:00.000Z`,
    inputDigest: sha(`${stage}:input`),
    outputDigest: sha(`${stage}:output:${status}`),
    evidenceRefs: [`evidence:w82d:${stage}`],
    scope: 'local-animation-specimen',
    published: false,
    externalMutation: false,
    message: `${stage} ${status}`,
  };
}

function decision(gateId, outcome = 'approve', actorOverride = '') {
  const [authorityRef, actorRef] = authorityByGate[gateId];
  return {
    schema: animation.ANIMATION_DECISION_SCHEMA,
    decisionId: `decision:w82d:${gateId.split(':').at(-1)}:${outcome}`,
    gateId,
    authorityRef,
    actorRef: actorOverride || actorRef,
    decision: outcome,
    scope: 'local-animation-specimen',
    evidenceRefs: [`evidence:w82d:${gateId}`],
    reason: `${gateId} ${outcome}; local manifest only`,
  };
}

function input(overrides = {}) {
  const workflowPackage = animation.createAnimationWorkflowPackage();
  return {
    workflowPackage,
    compileRequest: animation.createAnimationCompileRequest({ durationSeconds: 60 }),
    artifactVersions: Object.fromEntries(workflowPackage.artifacts.map((item, index) => [item.artifactId, `fixture:${index + 1}`])),
    receipts: stages.map((stage, index) => receipt(stage, 'passed', index + 1)),
    decisions: Object.keys(authorityByGate).map(gateId => decision(gateId)),
    provenance: { source: 'W82d contract fixture', binaryMasterProduced: false, publicationAuthorized: false },
    ...overrides,
  };
}

async function appendEvents(ledger, result) {
  for (const event of animation.toW73AnimationEvents(result)) await ledger.append(event);
}

describe('W82d Animation Short Vertical Slice contracts', () => {
  test('30–180 秒边界与 Script→Storyboard→Visual/Audio→Timeline→QC→Master DAG 被严格冻结', () => {
    const workflow = animation.createAnimationWorkflowPackage();
    const plan = kernel.compileOrganization(workflow, animation.createAnimationCompileRequest({ durationSeconds: 90 }));
    assert.equal(plan.status, 'READY');
    assert.equal(workflow.artifacts.length, 9);
    assert.equal(workflow.seats.length, 7);
    assert.equal(workflow.gates.length, 4);
    assert.throws(() => animation.createAnimationCompileRequest({ durationSeconds: 29 }), /30–180/);
    assert.throws(() => animation.createAnimationCompileRequest({ durationSeconds: 181 }), /30–180/);
    const tampered = input();
    tampered.compileRequest = structuredClone(tampered.compileRequest);
    tampered.compileRequest.constraints.find(item => item.type === 'duration-seconds').valueRef = '300';
    assert.throws(() => animation.evaluateAnimationSlice(tampered), /30–180/);
  });

  test('同一 Visual Seat 可在两个合格 Executor 间替换而不改 Artifact/Gate 契约', () => {
    const workflow = animation.createAnimationWorkflowPackage();
    const primary = kernel.compileOrganization(workflow, animation.createAnimationCompileRequest({ requestId: 'request:w82d-primary', visualExecutorRef: 'tool:visual-primary' }));
    const backup = kernel.compileOrganization(workflow, animation.createAnimationCompileRequest({ requestId: 'request:w82d-backup', visualExecutorRef: 'tool:visual-backup' }));
    const primarySeat = primary.routing.find(item => item.seatId === 'seat:visual-producer');
    const backupSeat = backup.routing.find(item => item.seatId === 'seat:visual-producer');
    assert.deepEqual(primarySeat.candidates, ['tool:visual-backup', 'tool:visual-primary']);
    assert.deepEqual(backupSeat.candidates, primarySeat.candidates);
    assert.equal(primarySeat.selectedExecutorRef, 'tool:visual-primary');
    assert.equal(backupSeat.selectedExecutorRef, 'tool:visual-backup');
    assert.equal(primary.provenance.workflowDigest, backup.provenance.workflowDigest);
    assert.deepEqual(primary.artifactDag.map(item => item.artifactId), backup.artifactDag.map(item => item.artifactId));
  });

  test('严格 receipt/decision 拒绝任意命令、secret、伪成功、发布越界和自动 Authority', () => {
    const arbitrary = receipt('timeline-assembly'); arbitrary.command = 'ffmpeg arbitrary args';
    assert.throws(() => animation.normalizeAnimationReceipt(arbitrary), /未冻结字段/);
    const secret = receipt('audio-render'); secret.authorization = 'must-not-enter';
    assert.throws(() => animation.normalizeAnimationReceipt(secret), /禁止 secret/);
    const falsePass = receipt('qc'); falsePass.exitCode = 1;
    assert.throws(() => animation.normalizeAnimationReceipt(falsePass), /exitCode=0/);
    const published = receipt('master-manifest'); published.published = true;
    assert.throws(() => animation.normalizeAnimationReceipt(published), /published=false/);
    const auto = decision('gate:master'); auto.actorRef = 'agent:director';
    assert.throws(() => animation.normalizeAnimationDecision(auto), /human:\*/);
  });

  test('完整本地 fixture 经 W73 完成，但只生成 master manifest，不冒充二进制影片或 Sample D', async () => {
    const result = animation.evaluateAnimationSlice(input());
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.localSealAllowed, true);
    assert.deepEqual(result.transitions.map(item => item.status), ['APPROVED', 'APPROVED', 'APPROVED', 'APPROVED']);
    assert.equal(result.boundary.masterManifestOnly, true);
    assert.equal(result.boundary.binaryMasterProduced, false);
    assert.equal(result.boundary.sampleDPassed, false);
    assert.equal(result.boundary.publicationGranted, false);

    const io = new MemoryIo();
    const ledger = await openProductionRunLedger({ io, folder: 'C:/fixture/w82d-success', runId: 'run-w82d-success', taskId: 'task-w82d-success', domain: 'animation-short', taskType: 'w82d.local-manifest' });
    await appendEvents(ledger, result);
    assert.equal(ledger.snapshot.status, 'completed');
    assert.ok(ledger.snapshot.outputArtifactRefs.some(item => item.id === 'artifact:master'));
    await ledger.dispose();
  });

  test('单镜头 01 失败只重做该镜头与下游，不重跑镜头 02 或音频', () => {
    const failedInput = input();
    failedInput.receipts = failedInput.receipts.map(item => item.stage === 'visual-shot-01-render' ? receipt('visual-shot-01-render', 'failed') : item);
    const result = animation.evaluateAnimationSlice(failedInput);
    assert.equal(result.status, 'RECOVERY_REQUIRED');
    assert.equal(result.recovery.changedArtifactId, 'artifact:visual-shot-01');
    assert.ok(result.recovery.affectedArtifactIds.includes('artifact:timeline'));
    assert.ok(result.recovery.affectedArtifactIds.includes('artifact:master'));
    assert.equal(result.recovery.affectedArtifactIds.includes('artifact:visual-shot-02'), false);
    assert.equal(result.recovery.affectedArtifactIds.includes('artifact:audio-track'), false);
    assert.equal(result.recovery.affectedArtifactIds.includes('artifact:storyboard'), false);
  });

  test('音频、QC 和 Master 失败分别局部回退；缺 receipt 保持 UNKNOWN', () => {
    const audioInput = input();
    audioInput.receipts = audioInput.receipts.map(item => item.stage === 'audio-render' ? receipt('audio-render', 'failed') : item);
    const audio = animation.evaluateAnimationSlice(audioInput);
    assert.equal(audio.recovery.changedArtifactId, 'artifact:audio-track');
    assert.equal(audio.recovery.affectedArtifactIds.includes('artifact:visual-shot-01'), false);
    assert.ok(audio.recovery.affectedArtifactIds.includes('artifact:timeline'));

    const qcInput = input();
    qcInput.receipts = qcInput.receipts.map(item => item.stage === 'qc' ? receipt('qc', 'failed') : item);
    const qc = animation.evaluateAnimationSlice(qcInput);
    assert.deepEqual(qc.recovery.affectedArtifactIds, ['artifact:master', 'artifact:qc-report']);

    const masterInput = input();
    masterInput.receipts = masterInput.receipts.map(item => item.stage === 'master-manifest' ? receipt('master-manifest', 'failed') : item);
    const master = animation.evaluateAnimationSlice(masterInput);
    assert.deepEqual(master.recovery.affectedArtifactIds, ['artifact:master']);

    const missing = input();
    missing.receipts = missing.receipts.filter(item => item.stage !== 'timeline-assembly');
    assert.equal(animation.evaluateAnimationSlice(missing).status, 'UNKNOWN');
  });

  test('失败投影进入 W73 blocked，显式恢复后才可继续', async () => {
    const failureInput = input();
    failureInput.receipts = failureInput.receipts.map(item => item.stage === 'qc' ? receipt('qc', 'failed') : item);
    failureInput.decisions = failureInput.decisions.map(item => item.gateId === 'gate:timeline-qc' ? decision('gate:timeline-qc', 'reject') : item);
    const result = animation.evaluateAnimationSlice(failureInput);
    const io = new MemoryIo();
    let ledger = await openProductionRunLedger({ io, folder: 'C:/fixture/w82d-failure', runId: 'run-w82d-failure', taskId: 'task-w82d-failure' });
    await appendEvents(ledger, result);
    assert.equal(ledger.snapshot.status, 'blocked');
    assert.equal(ledger.snapshot.recoveryState.required, true);
    await ledger.dispose();
    ledger = await openProductionRunLedger({ io, folder: 'C:/fixture/w82d-failure', runId: 'run-w82d-failure', taskId: 'task-w82d-failure', recoverOrphaned: true });
    await ledger.append({ type: 'run-started', toStatus: 'running', reasonCode: 'EXPLICIT_SHOT_OR_QC_REPAIR' });
    assert.equal(ledger.snapshot.status, 'running');
    assert.equal(ledger.snapshot.recoveryState.required, false);
    await ledger.dispose();
  });

  test('生产 Seat 自占 Master Authority 或 decision actor 未绑定时必须 BLOCKED', () => {
    const self = input();
    const request = structuredClone(self.compileRequest);
    request.authorityBindings.find(item => item.authorityRef === 'authority:master-owner').actorRef = 'tool:visual-primary';
    self.compileRequest = request;
    assert.equal(animation.evaluateAnimationSlice(self).planStatus, 'BLOCKED');

    const mismatch = input();
    mismatch.decisions = mismatch.decisions.map(item => item.gateId === 'gate:master' ? decision('gate:master', 'approve', 'human:unbound-master-owner') : item);
    const result = animation.evaluateAnimationSlice(mismatch);
    assert.equal(result.status, 'RECOVERY_REQUIRED');
    assert.ok(result.transitions.find(item => item.gateId === 'gate:master').reasons.includes('AUTHORITY_ACTOR_MISMATCH'));
  });

  test('W82d Foundation 不含任意进程、文件、网络或 Electron 执行能力', () => {
    const source = fs.readFileSync(new URL('../../main/foundation/animation-short-slice.js', import.meta.url), 'utf8');
    for (const forbidden of ["require('child_process')", "require('fs')", "require('http')", "require('electron')", '.spawn(', '.exec(', 'fetch(', 'WebSocket']) {
      assert.equal(source.includes(forbidden), false, `W82d 不得包含 ${forbidden}`);
    }
  });

  test('实施证据不把本地 manifest 冒充视频二进制、外部工具运行或 Sample D/E', () => {
    const evidence = JSON.parse(fs.readFileSync(new URL('../../docs/engineering/evidence/W82D_ANIMATION_SHORT_SPECIMEN.json', import.meta.url), 'utf8'));
    assert.equal(evidence.schema, 'mazz.w82d-implementation-evidence/v0');
    assert.equal(evidence.actualChecks.length, 4);
    assert.ok(evidence.actualChecks.every(item => item.status === 'passed' && item.exitCode === 0));
    assert.equal(evidence.fullSuite.rerunThisWave, false);
    assert.equal(evidence.boundary.masterManifestOnly, true);
    assert.equal(evidence.boundary.binaryMasterProduced, false);
    assert.equal(evidence.boundary.realExternalToolExecuted, false);
    assert.equal(evidence.boundary.sampleDPassed, false);
    assert.equal(evidence.boundary.sampleEPassed, false);
    assert.equal(evidence.boundary.published, false);
    assert.match(evidence.stopLine, /W82e-W82h.*remain open/);
  });
});
