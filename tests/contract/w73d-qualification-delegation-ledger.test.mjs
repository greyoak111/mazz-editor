import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  QUALIFICATION_RECORD_SCHEMA, DELEGATION_RECORD_SCHEMA,
  normalizeQualificationRecord, replayQualificationRecords, evaluateQualification,
  openQualificationLedger, openDelegationLedger, QualificationDelegationService,
} from '../../renderer/modules/factory/qualification-delegation.js';

class MemoryIo {
  constructor() { this.files = new Map(); this.delayMs = 0; }
  async exists(path) { return this.files.has(path); }
  async read(path) { if (!this.files.has(path)) throw new Error(`ENOENT ${path}`); return this.files.get(path); }
  async write(path, content) {
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    this.files.set(path, String(content)); return true;
  }
}

const EVIDENCE = [{ kind: 'evidence', id: 'probe-result', path: 'D:/evidence/probe.json', type: 'application/json', role: 'qualification-evidence' }];

function qualificationRows({
  definitionId = 'qualification:editor-v1', attemptId = 'attempt:editor:001', certificateId = 'certificate:editor:001',
  executorRef = 'agent-runtime:closed', seatRefs = ['seat:restricted-editor'],
  issuedAt = '2026-08-17T01:00:00.000Z', validFrom = '2026-08-17T01:00:00.000Z', expiresAt = '2026-09-17T01:00:00.000Z',
} = {}) {
  return [
    {
      recordId: `${definitionId}:defined`, type: 'qualification-defined', definitionId, seatRefs,
      probePackRef: 'asset:probe-pack/editor', probePackVersion: '1.4.0', passingScore: 80,
      actorRef: 'human:maintainer', authorityRef: 'human:maintainer', message: '受限编辑席资格定义',
    },
    {
      recordId: `${attemptId}:recorded`, type: 'qualification-attempt-recorded', definitionId, attemptId,
      executorRef, runId: 'run-w73d-001', score: 91, outcome: 'passed', evidenceRefs: EVIDENCE,
      startedAt: '2026-08-17T00:00:00.000Z', completedAt: '2026-08-17T00:30:00.000Z', actorRef: 'inspector:probe-runner',
    },
    {
      recordId: `${certificateId}:issued`, type: 'qualification-certificate-issued', definitionId, attemptId,
      certificateId, executorRef, seatRefs, authorityRef: 'human:maintainer', evidenceRefs: EVIDENCE,
      issuedAt, validFrom, expiresAt, message: '人工核验后签发',
    },
  ];
}

async function ledgers({ clock = () => Date.parse('2026-08-17T02:00:00.000Z') } = {}) {
  const io = new MemoryIo();
  const qualification = await openQualificationLedger({ io, path: 'D:/Factory/.mazz/qualifications.ndjson', clock, idFactory: () => 'qid' });
  const delegation = await openDelegationLedger({ io, path: 'D:/Factory/.mazz/runs/run-w73d-001/delegations.ndjson', runId: 'run-w73d-001', clock, idFactory: () => 'did' });
  return { io, qualification, delegation, clock };
}

describe('W73d Qualification Definition / Attempt / Certificate', () => {
  test('三种身份分离，probe pack/版本/分数/evidence/Seat/期限均可重放', async () => {
    const { io, qualification } = await ledgers();
    const rows = qualificationRows();
    await qualification.appendBatch(rows);
    assert.equal(qualification.records.every(row => row.schema === QUALIFICATION_RECORD_SCHEMA), true);
    assert.equal(qualification.state.definitions.size, 1);
    assert.equal(qualification.state.attempts.size, 1);
    assert.equal(qualification.state.certificates.size, 1);
    const [definition] = qualification.state.definitions.values();
    const [attempt] = qualification.state.attempts.values();
    const [certificate] = qualification.state.certificates.values();
    assert.equal(new Set([definition.definitionId, attempt.attemptId, certificate.certificateId]).size, 3);
    assert.equal(definition.probePackVersion, '1.4.0');
    assert.equal(attempt.score, 91);
    assert.equal(attempt.evidenceRefs.length, 1);
    assert.deepEqual(certificate.seatRefs, ['seat:restricted-editor']);
    const reopened = await openQualificationLedger({ io, path: qualification.path });
    assert.equal(reopened.state.certificates.get('certificate:editor:001').expiresAt, '2026-09-17T01:00:00.000Z');
  });

  test('分数与 outcome 必须一致，未通过 Attempt 不得签证', () => {
    const rows = qualificationRows();
    const invalidAttempt = { ...rows[1], score: 70, outcome: 'passed', sequence: 2, occurredAt: '2026-08-17T02:00:00.000Z' };
    const definition = normalizeQualificationRecord({ ...rows[0], sequence: 1, occurredAt: '2026-08-17T02:00:00.000Z' });
    assert.throws(() => replayQualificationRecords([definition, invalidAttempt]), /分数与 outcome 不一致/);
    const failed = normalizeQualificationRecord({ ...rows[1], score: 70, outcome: 'failed', sequence: 2, occurredAt: '2026-08-17T02:00:01.000Z' });
    const certificate = normalizeQualificationRecord({ ...rows[2], sequence: 3, occurredAt: '2026-08-17T02:00:02.000Z' });
    assert.throws(() => replayQualificationRecords([definition, failed, certificate]), /只能引用已通过 Attempt/);
  });

  test('模型和 Provider 不能自签或撤证；未知字段与 secret 同样拒绝', () => {
    const certificate = qualificationRows()[2];
    assert.throws(() => normalizeQualificationRecord({ ...certificate, authorityRef: 'model:gpt' }, { sequence: 1, occurredAt: '2026-08-17T02:00:00.000Z' }), /human Authority/);
    assert.throws(() => normalizeQualificationRecord({ ...certificate, authorityRef: 'provider:moonshot' }, { sequence: 1, occurredAt: '2026-08-17T02:00:00.000Z' }), /human Authority/);
    assert.throws(() => normalizeQualificationRecord({ ...certificate, apiKey: 'nope' }, { sequence: 1, occurredAt: '2026-08-17T02:00:00.000Z' }), /secret/);
    assert.throws(() => normalizeQualificationRecord({ ...certificate, level: 'gold' }, { sequence: 1, occurredAt: '2026-08-17T02:00:00.000Z' }), /未冻结字段/);
  });

  test('受限 Seat 对无证、错执行器、过期与撤销即时阻断', async () => {
    const { qualification } = await ledgers();
    await qualification.appendBatch(qualificationRows());
    const base = { restricted: true, executorRef: 'agent-runtime:closed', seatRef: 'seat:restricted-editor' };
    assert.equal(evaluateQualification(qualification.state, { ...base, certificateRef: '' }).code, 'QUALIFICATION_REQUIRED');
    assert.equal(evaluateQualification(qualification.state, { ...base, certificateRef: 'certificate:editor:001', executorRef: 'other' }).code, 'QUALIFICATION_EXECUTOR_MISMATCH');
    assert.equal(evaluateQualification(qualification.state, { ...base, certificateRef: 'certificate:editor:001', at: '2026-10-01T00:00:00.000Z' }).code, 'QUALIFICATION_EXPIRED');
    assert.equal(evaluateQualification(qualification.state, { ...base, certificateRef: 'certificate:editor:001', at: '2026-08-18T00:00:00.000Z' }).ok, true);
    await qualification.appendBatch([{
      recordId: 'certificate:editor:001:revoked', type: 'qualification-certificate-revoked',
      certificateId: 'certificate:editor:001', authorityRef: 'human:maintainer',
      revokedAt: '2026-08-18T00:00:00.000Z', revocationReason: 'probe pack evidence invalidated', evidenceRefs: EVIDENCE,
    }]);
    assert.equal(evaluateQualification(qualification.state, { ...base, certificateRef: 'certificate:editor:001', at: '2026-08-18T01:00:00.000Z' }).code, 'QUALIFICATION_REVOKED');
  });

  test('精确重复幂等、同键异义拒绝；损坏尾隔离并阻断续写', async () => {
    const { io, qualification } = await ledgers();
    const rows = qualificationRows();
    await qualification.appendBatch(rows);
    await qualification.appendBatch(rows);
    assert.equal(qualification.records.length, 3);
    await assert.rejects(() => qualification.appendBatch([{ ...rows[0], passingScore: 99 }]), /幂等键冲突/);
    await qualification.dispose();
    io.files.set(qualification.path, `${io.files.get(qualification.path)}{"broken":`);
    const recovered = await openQualificationLedger({ io, path: qualification.path });
    assert.equal(recovered.healthSnapshot().recoveryRequired, true);
    assert.equal(io.files.get(`${qualification.path}.corrupt-tail.txt`), '{"broken":');
    await assert.rejects(() => recovered.appendBatch(rows), /恢复阻断态/);
  });
});

describe('W73d internal and external delegation', () => {
  test('内部闭集 AgentRuntime 只在通过资格门后写 task/result evidence', async () => {
    const { qualification, delegation } = await ledgers();
    await qualification.appendBatch(qualificationRows());
    const runtime = { submit: async instruction => ({ status: 'done', message: `完成 ${instruction}` }) };
    const service = new QualificationDelegationService({ qualificationLedger: qualification, delegationLedger: delegation, clock: () => Date.parse('2026-08-18T00:00:00.000Z'), idFactory: () => 'internal-1' });
    const result = await service.delegateInternal({
      taskRef: 'factory-task:001', seatRef: 'seat:restricted-editor', executorRef: 'agent-runtime:closed',
      certificateRef: 'certificate:editor:001', restricted: true, instructionRef: 'artifact:instruction#1',
      resultRef: 'artifact:result#1', evidenceRefs: EVIDENCE, instruction: '执行闭集命令', runtime,
    });
    assert.equal(result.status, 'completed');
    assert.equal(delegation.records.every(row => row.schema === DELEGATION_RECORD_SCHEMA), true);
    assert.deepEqual(delegation.records.map(row => row.type), ['assignment-created', 'delegation-started', 'delegation-completed']);
    assert.equal(delegation.records.at(-1).resultRef, 'artifact:result#1');
    assert.equal(delegation.records.some(row => 'providerRef' in row || 'modelRef' in row), false);
  });

  test('无真 Adapter 时确定性 BLOCKED: HARNESS_UNAVAILABLE，零 Session 调用', async () => {
    const { qualification, delegation } = await ledgers();
    await qualification.appendBatch(qualificationRows({ executorRef: 'harness-executor:none', seatRefs: ['seat:external-agent'] }));
    let sessions = 0;
    const harnessClient = { listAdapters: async () => [], createSession: async () => { sessions++; } };
    const service = new QualificationDelegationService({ qualificationLedger: qualification, delegationLedger: delegation, harnessClient, clock: () => Date.parse('2026-08-18T00:00:00.000Z'), idFactory: () => 'external-none' });
    const result = await service.delegateExternal({
      taskRef: 'factory-task:001', seatRef: 'seat:external-agent', executorRef: 'harness-executor:none',
      certificateRef: 'certificate:editor:001', restricted: true, instructionRef: 'artifact:instruction#2', instruction: '外部执行',
    });
    assert.deepEqual({ status: result.status, code: result.code, message: result.message }, { status: 'blocked', code: 'HARNESS_UNAVAILABLE', message: 'BLOCKED: HARNESS_UNAVAILABLE' });
    assert.equal(sessions, 0);
    assert.equal(delegation.state.delegations.get(result.delegationId).terminalStatus, 'blocked');
  });

  test('真实 Harness 协议保留 Session/result/dispose；失败不改写成 Provider 成功', async () => {
    const { io, qualification, delegation } = await ledgers();
    await qualification.appendBatch(qualificationRows({ executorRef: 'harness-executor:real', seatRefs: ['seat:external-agent'] }));
    const calls = [];
    const harnessClient = {
      listAdapters: async () => [{ id: 'real' }],
      createSession: async payload => { calls.push(['create', payload]); return { id: 'session-1' }; },
      send: async (id, input) => { calls.push(['send', id, input]); return { artifactRef: 'artifact:external-result' }; },
      interrupt: async id => calls.push(['interrupt', id]),
      dispose: async (id, reason) => calls.push(['dispose', id, reason]),
    };
    const service = new QualificationDelegationService({ qualificationLedger: qualification, delegationLedger: delegation, harnessClient, clock: () => Date.parse('2026-08-18T00:00:00.000Z'), idFactory: () => 'external-real' });
    const result = await service.delegateExternal({
      taskRef: 'factory-task:001', seatRef: 'seat:external-agent', executorRef: 'harness-executor:real',
      certificateRef: 'certificate:editor:001', restricted: true, adapterId: 'real', instructionRef: 'artifact:instruction#3',
      resultRef: 'artifact:external-result', instruction: '执行', payload: { command: 'bounded-task' },
    });
    assert.equal(result.status, 'completed');
    assert.equal(delegation.records.some(row => row.harnessSessionRef === 'harness-session:session-1'), true);
    assert.equal(delegation.records.at(-1).type, 'delegation-disposed');
    assert.equal(calls.some(row => row[0] === 'dispose'), true);
    assert.doesNotMatch(io.files.get(delegation.path), /provider-success|providerBoundary|providerRef|modelRef/);

    harnessClient.send = async () => { throw Object.assign(new Error('external executor failed'), { code: 'EXECUTOR_FAILED' }); };
    const failed = await service.delegateExternal({
      delegationId: 'delegation:run-w73d-001:failure', taskRef: 'factory-task:002', seatRef: 'seat:external-agent',
      executorRef: 'harness-executor:real', certificateRef: 'certificate:editor:001', restricted: true,
      adapterId: 'real', instructionRef: 'artifact:instruction#4', instruction: '失败样本',
    });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.code, 'EXECUTOR_FAILED');
    assert.equal(delegation.records.some(row => row.delegationId === failed.delegationId && row.type === 'delegation-completed'), false);
  });

  test('在飞外部委托可 interrupt/cancel/dispose，资源回到 activeExternal=0', async () => {
    const { qualification, delegation } = await ledgers();
    await qualification.appendBatch(qualificationRows({ executorRef: 'harness-executor:real', seatRefs: ['seat:external-agent'] }));
    let releaseSend;
    const calls = [];
    const harnessClient = {
      listAdapters: async () => [{ id: 'real' }], createSession: async () => ({ id: 'session-cancel' }),
      send: async () => new Promise(resolve => { releaseSend = resolve; }),
      interrupt: async id => calls.push(['interrupt', id]), dispose: async (id, reason) => calls.push(['dispose', id, reason]),
    };
    const service = new QualificationDelegationService({ qualificationLedger: qualification, delegationLedger: delegation, harnessClient, clock: () => Date.parse('2026-08-18T00:00:00.000Z'), idFactory: () => 'external-cancel' });
    const running = service.delegateExternal({
      taskRef: 'factory-task:003', seatRef: 'seat:external-agent', executorRef: 'harness-executor:real',
      certificateRef: 'certificate:editor:001', restricted: true, adapterId: 'real', instructionRef: 'artifact:instruction#5', instruction: '长任务',
    });
    for (let i = 0; i < 20 && service.healthSnapshot().activeExternal === 0; i++) await Promise.resolve();
    assert.equal(service.healthSnapshot().activeExternal, 1);
    const [delegationId] = service.activeExternal.keys();
    await service.cancel(delegationId, 'test-cancel');
    releaseSend({ late: true });
    const result = await running;
    assert.equal(result.status, 'cancelled');
    assert.equal(service.healthSnapshot().activeExternal, 0);
    assert.equal(calls.some(row => row[0] === 'interrupt'), true);
    assert.equal(calls.some(row => row[0] === 'dispose'), true);
    const types = delegation.records.filter(row => row.delegationId === delegationId).map(row => row.type);
    assert.deepEqual(types, ['assignment-created', 'delegation-started', 'delegation-cancelled', 'delegation-disposed']);
  });

  test('dispose 等待在飞写，两个账本最终 activeWrites=0', async () => {
    const { qualification, delegation } = await ledgers();
    qualification.io.delayMs = 5;
    const writing = qualification.appendBatch(qualificationRows());
    await Promise.resolve();
    const qHealth = await qualification.dispose();
    await writing;
    const dHealth = await delegation.dispose();
    assert.equal(qHealth.activeWrites, 0);
    assert.equal(dHealth.activeWrites, 0);
    assert.equal(qHealth.disposed, true);
    assert.equal(dHealth.disposed, true);
  });
});
