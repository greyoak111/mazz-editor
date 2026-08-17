import fs from 'node:fs';
import { describe, test, assert } from '../harness.mjs';
import {
  FINDING_KINDS,
  HALLUCINATED_ANCHOR_KINDS,
  REWORK_AUDIT_RECORD_SCHEMA,
  buildW68AuditBatch,
  normalizeReworkAuditRecord,
  openReworkAuditLedger,
  parseReworkAuditLog,
} from '../../renderer/modules/factory/rework-audit.js';

class MemoryAuditIo {
  constructor() { this.files = new Map(); this.delayMs = 0; }
  async exists(path) { return this.files.has(path); }
  async read(path) {
    if (!this.files.has(path)) throw new Error(`ENOENT ${path}`);
    return this.files.get(path);
  }
  async write(path, content) {
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    this.files.set(path, String(content));
    return true;
  }
}

const clock = (() => {
  let now = Date.parse('2026-08-17T08:00:00.000Z');
  return () => (now += 1000);
})();

const path = 'D:/Factory/Specimen/.mazz/runs/run-w73c-001/findings.ndjson';
const open = (io, extra = {}) => openReworkAuditLedger({ io, path, runId: 'run-w73c-001', clock, ...extra });
const ref = (name, role = 'evidence') => ({ kind: 'artifact', path: `D:/Factory/工件/${name}`, role });

function raised(id, kind = 'audit-flag', extra = {}) {
  return {
    recordId: `${id}:raised`, type: 'finding-raised', findingId: id, findingKind: kind,
    severity: 'major', status: 'open', artifactRefs: [ref('02-扩写稿.md', 'affected-artifact')],
    anchorRef: `draft:${id}`, sourceRef: 'rule:W68-R1', evidenceRefs: [ref('03-机检报告.md')],
    message: `finding ${id}`, ...extra,
  };
}

function status(id, fromStatus, toStatus) {
  return {
    recordId: `${id}:${toStatus}`, type: 'finding-status-changed', findingId: id,
    fromStatus, toStatus, authorityRef: 'seat:M6', resolutionRef: `D:/Factory/裁决.md#${id}`,
    evidenceRefs: [ref('10-裁决书.md', 'resolution-evidence')],
  };
}

function w68Result() {
  const machineFinding = {
    id: 'source-title', severity: 'critical', artifactRef: 'draft:title',
    ruleRef: 'W68-SOURCE', message: '标题来源锚点缺失',
  };
  return {
    sealed: true, verdict: 'pass', reason: '四闸全开', transitions: ['repair:1', 'sealed'],
    machineHistory: [{ round: 1, report: { pass: false, findings: [machineFinding] } }],
    machine: { pass: true, findings: [] },
    pointReports: [{ round: 1, findings: [{ id: 'point-1', severity: 'major', artifactRef: 'draft:p1', ruleRef: 'W68-R1', message: '验收点一偏离' }] }],
    point: { decision: 'pass', findings: [] },
    objections: [{ id: 'objection-1', reviewer: 'M4', ruleRef: 'W68-R8', claim: '证据链仍需裁决', status: 'sustained' }],
    answers: [],
    reworkHistory: [{
      source: 'machine:1', stage: 'draft', reasonCode: 'MACHINE_FINDING', attempt: 1,
      assignedSeatRef: 'seat:M3', beforeText: '旧正文 SHOULD_NOT_ENTER_LEDGER',
      afterText: '新正文 SHOULD_NOT_ENTER_LEDGER', residueReport: { pass: true, findings: [] },
      order: {
        source: 'machine:1', protectionList: ['保留已核定标题'],
        items: [{ id: 'R1', position: 'draft:title', error: machineFinding.message, change: '补回证据', reason: 'W68-SOURCE' }],
      },
    }],
  };
}

describe('W73c Finding / AuditFlag 冻结契约', () => {
  test('六类幻锚 Finding 全部强制 source + anchor + evidence 三联', () => {
    assert.deepEqual([...HALLUCINATED_ANCHOR_KINDS], FINDING_KINDS.slice(2));
    for (const kind of HALLUCINATED_ANCHOR_KINDS) {
      const base = { ...raised(`finding-${kind}`, kind), runId: 'run-w73c-001', sequence: 1, occurredAt: '2026-08-17T00:00:00.000Z' };
      assert.equal(normalizeReworkAuditRecord(base).schema, REWORK_AUDIT_RECORD_SCHEMA);
      assert.throws(() => normalizeReworkAuditRecord({ ...base, sourceRef: '' }), /sourceRef\/anchorRef\/evidenceRefs/);
      assert.throws(() => normalizeReworkAuditRecord({ ...base, anchorRef: '' }), /sourceRef\/anchorRef\/evidenceRefs/);
      assert.throws(() => normalizeReworkAuditRecord({ ...base, evidenceRefs: [] }), /工件与证据|sourceRef\/anchorRef\/evidenceRefs/);
    }
  });

  test('未知字段、secret、越权状态迁移与无证据回炉均拒绝', () => {
    const base = { ...raised('finding-strict'), runId: 'run-w73c-001', sequence: 1, occurredAt: '2026-08-17T00:00:00.000Z' };
    assert.throws(() => normalizeReworkAuditRecord({ ...base, universalPayload: {} }), /未冻结字段/);
    assert.throws(() => normalizeReworkAuditRecord({ ...base, apiKey: 'secret' }), /禁止 secret/);
    assert.throws(() => normalizeReworkAuditRecord({ ...status('finding-strict', 'open', 'open'), runId: base.runId, sequence: 2, occurredAt: base.occurredAt }), /不允许/);
    assert.throws(() => normalizeReworkAuditRecord({
      recordId: 'rw:1', runId: base.runId, sequence: 2, occurredAt: base.occurredAt,
      type: 'rework-recorded', reworkId: 'rw:1', triggerFindingRefs: ['finding-strict'], stage: 'draft',
      status: 'completed', reasonCode: 'FIX', affectedArtifactRefs: [ref('draft.md')], assignedSeatRef: 'seat:M3',
      verifiedByRef: 'inspector:deterministic', attempt: 1,
    }), /改前、改后与复验证据/);
  });
});

describe('W73c W68 旁路适配与可追责回炉', () => {
  test('一次回炉能回答人/因/证/影响/保护/前后/复验，正文只落旁证文件', async () => {
    const io = new MemoryAuditIo();
    const ledger = await open(io);
    const batch = buildW68AuditBatch({
      runId: ledger.runId, result: w68Result(), artifactDir: 'D:/Factory/Specimen/工件/第001章', unitNo: 1, clock,
    });
    assert.equal(batch.artifactsToWrite.length, 3);
    assert.match(batch.artifactsToWrite[0].content, /旧正文/);
    assert.doesNotMatch(JSON.stringify(batch.records), /SHOULD_NOT_ENTER_LEDGER/);
    await ledger.appendBatch(batch.records);
    assert.equal(ledger.healthSnapshot().reworks, 1);
    const rework = [...ledger.state.reworks.values()][0];
    assert.equal(rework.assignedSeatRef, 'seat:M3');
    assert.equal(rework.verifiedByRef, 'inspector:deterministic');
    assert.equal(rework.reasonCode, 'MACHINE_FINDING');
    assert.equal(rework.affectedArtifactRefs.length, 1);
    assert.equal(rework.protectionRefs.length, 1);
    assert.equal(rework.beforeRefs.length, 1);
    assert.equal(rework.afterRefs.length, 1);
    assert.equal(rework.verificationRefs.length, 1);
    assert.equal(rework.triggerFindingRefs.length, 1);
    assert.equal(rework.status, 'completed');
    assert.equal(ledger.state.findings.get(rework.triggerFindingRefs[0]).status, 'resolved');
    assert.ok(ledger.state.unresolvedFindingIds.some(id => id.includes('objection-1')), '被维持旗语必须留在 accepted 未结态');
  });

  test('三轮不收敛只生成单个人工升级，不创建隐式无限重试', () => {
    const result = { ...w68Result(), sealed: false, verdict: 'return-skeleton', transitions: ['repair:1', 'repair:2', 'repair:3', 'nonconvergence:skeleton'], reason: '三轮未收敛' };
    const batch = buildW68AuditBatch({ runId: 'run-w73c-001', result, artifactDir: 'D:/Factory/Specimen/工件/第002章', unitNo: 2, clock });
    assert.equal(batch.records.filter(row => row.type === 'human-escalation-requested').length, 1);
    assert.equal(batch.records.filter(row => row.type === 'rework-recorded').length, 1);
    assert.equal(batch.records.find(row => row.type === 'human-escalation-requested').reasonCode, 'THREE_ROUND_NONCONVERGENCE');
  });
});

describe('W73c append-only、恢复与资源纪律', () => {
  test('open/disputed/accepted 未结旗语重开不丢，resolved/waived 才关闭', async () => {
    const io = new MemoryAuditIo();
    const ledger = await open(io);
    await ledger.appendBatch([
      raised('finding-open'),
      raised('finding-disputed'), status('finding-disputed', 'open', 'disputed'),
      raised('finding-accepted'), status('finding-accepted', 'open', 'accepted'),
      raised('finding-resolved'), status('finding-resolved', 'open', 'resolved'),
      raised('finding-waived'), status('finding-waived', 'open', 'waived'),
    ]);
    await ledger.dispose();
    const reopened = await open(io);
    assert.deepEqual(new Set(reopened.state.unresolvedFindingIds), new Set(['finding-open', 'finding-disputed', 'finding-accepted']));
    assert.equal(reopened.state.findings.get('finding-resolved').status, 'resolved');
    assert.equal(reopened.state.findings.get('finding-waived').status, 'waived');
  });

  test('精确重复幂等、同键异义冲突；并发批次 sequence 串行且 dispose 清零', async () => {
    const io = new MemoryAuditIo();
    const ledger = await open(io);
    const one = raised('finding-one');
    await ledger.appendBatch([one]);
    await ledger.appendBatch([one]);
    assert.equal(ledger.records.length, 1);
    await assert.rejects(() => ledger.appendBatch([{ ...one, message: '同键异义' }]), /幂等键冲突/);
    io.delayMs = 5;
    const writes = Promise.all([
      ledger.appendBatch([raised('finding-two')]),
      ledger.appendBatch([raised('finding-three')]),
      ledger.appendBatch([raised('finding-four')]),
    ]);
    await Promise.resolve();
    const disposed = await ledger.dispose();
    await writes;
    assert.deepEqual(ledger.records.map(row => row.sequence), [1, 2, 3, 4]);
    assert.equal(disposed.activeWrites, 0);
    assert.equal(disposed.disposed, true);
    await assert.rejects(() => ledger.appendBatch([raised('finding-five')]), /已释放/);
  });

  test('损坏尾隔离并保持恢复阻断，中段损坏拒绝猜测', async () => {
    const io = new MemoryAuditIo();
    const ledger = await open(io);
    await ledger.appendBatch([raised('finding-survivor')]);
    io.files.set(path, `${io.files.get(path)}{"broken":`);
    const recovered = await open(io);
    assert.equal(recovered.healthSnapshot().recoveryRequired, true);
    assert.deepEqual(recovered.state.unresolvedFindingIds, ['finding-survivor']);
    assert.equal(io.files.get(path.replace(/findings\.ndjson$/i, 'findings-corrupt-tail.txt')), '{"broken":');
    await assert.rejects(() => recovered.appendBatch([raised('finding-blocked')]), /恢复阻断态/);

    const valid = io.files.get(path).trim().split('\n');
    const middle = `${valid[0]}\n{bad}\n${valid[1]}\n`;
    assert.throws(() => parseReworkAuditLog(middle, { runId: 'run-w73c-001' }), /中段损坏/);
  });

  test('纯审计模块不读取 UI/网络/Provider，也不成为第二 Factory', () => {
    const source = fs.readFileSync(new URL('../../renderer/modules/factory/rework-audit.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /window\.|document\.|localStorage|fetch\s*\(|WebSocket|AgentRuntime|chatStream/);
    assert.ok(source.includes("import { normalizeProductionRunReference } from './production-run.js'"));
  });
});
