import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const [{ FactoryPanel }, { W68_PROTOCOL }] = await Promise.all([
  import('../../renderer/modules/factory/index.js'),
  import('../../renderer/modules/factory/review.js'),
]);

function specimen() {
  const files = new Map();
  const directories = new Set();
  window.mazz = {
    invoke: async (channel, payload = {}) => {
      if (channel === 'fs:stat') return files.has(payload.path)
        ? { exists: true, isDir: false, size: files.get(payload.path).length }
        : { exists: directories.has(payload.path), isDir: directories.has(payload.path) };
      if (channel === 'fs:readFile') {
        if (!files.has(payload.path)) throw new Error(`ENOENT ${payload.path}`);
        return files.get(payload.path);
      }
      if (channel === 'fs:writeFile') { files.set(payload.path, String(payload.content)); return true; }
      if (channel === 'fs:mkdir') { directories.add(payload.path); return true; }
      throw new Error(`unexpected channel ${channel}`);
    },
  };
  const panel = Object.create(FactoryPanel.prototype);
  panel.productionRunLedgers = new Map();
  panel.reworkAuditLedgers = new Map();
  panel.cfg = { providerId: 'provider-a', model: 'model-a', apiKey: 'TOP-SECRET-KEY' };
  panel.persistTasks = () => {};
  return { panel, files, directories };
}

function task(overrides = {}) {
  return {
    id: 'task-w73c-integration', label: 'W73c 集成样本', folder: 'D:/Factory/W73c', mode: 'single',
    reviewProtocol: W68_PROTOCOL, reviewRitual: 'light', reviewBudgetCap: 32000, ...overrides,
  };
}

function result() {
  const finding = { id: 'source-title', severity: 'critical', artifactRef: 'draft:title', ruleRef: 'W68-SOURCE', message: '标题缺来源' };
  return {
    sealed: false, verdict: 'block', reason: '仍有裁决旗语', transitions: ['repair:1', 'blocked'],
    machineHistory: [{ round: 1, report: { pass: false, findings: [finding] } }],
    machine: { pass: true, findings: [] }, pointReports: [], point: { decision: 'pass' },
    objections: [{ id: 'o1', reviewer: 'M4', ruleRef: 'W68-R8', claim: '关键证据仍不足 TOP-SECRET-KEY', status: 'sustained' }], answers: [],
    reworkHistory: [{
      source: 'machine:1', stage: 'draft', reasonCode: 'MACHINE_FINDING', attempt: 1, assignedSeatRef: 'seat:M3',
      beforeText: '不可进入账本的改前正文', afterText: '不可进入账本的改后正文', residueReport: { pass: true, findings: [] },
      order: { source: 'machine:1', protectionList: ['保护段落 A'], items: [{ id: 'R1', error: finding.message, reason: 'W68-SOURCE' }] },
    }],
  };
}

describe('W73c Factory W68 单次真路径集成', () => {
  test('审计账、回炉三旁证与 Production Run 引用一次落齐，正文不进 NDJSON', async () => {
    const { panel, files, directories } = specimen();
    const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    const artifactDir = `${target.folder}/工件/第001章`;
    const batch = await panel.appendW73cAudit(target, result(), { artifactDir, unitNo: 1 });
    assert.equal(directories.has(`${artifactDir}/回炉记录`), true);
    assert.equal(files.get(`${artifactDir}/回炉记录/R01-改前.md`), '不可进入账本的改前正文');
    assert.equal(files.get(`${artifactDir}/回炉记录/R01-改后.md`), '不可进入账本的改后正文');
    assert.match(files.get(`${artifactDir}/回炉记录/R01-复验.json`), /"pass": true/);
    assert.doesNotMatch(files.get(run.paths.findings), /不可进入账本的改[前后]正文/);
    assert.doesNotMatch(files.get(run.paths.findings), /TOP-SECRET-KEY/);
    assert.match(files.get(run.paths.findings), /\[REDACTED\]/);
    assert.doesNotMatch(files.get(run.paths.findings), /literal:保护段落/);
    assert.equal(run.snapshot.reworkRefs.length, 1);
    assert.ok(run.snapshot.findingRefs.length >= 2);
    assert.equal(target.auditReworkCount, 1);
    assert.equal(target.auditUnresolvedFindings, 1);
    assert.equal(batch.health.recoveryRequired, false);
  });

  test('正式 W68 单次有 Run 无 Audit 即阻断；max/legacy 继续排除', async () => {
    const { panel } = specimen();
    const target = task();
    await panel.ensureProductionRun(target, { id: 'novel' });
    await panel.reworkAuditLedgers.get(target.id).dispose();
    panel.reworkAuditLedgers.delete(target.id);
    await assert.rejects(() => panel.appendW73cAudit(target, result(), { artifactDir: `${target.folder}/工件/第001章` }), /缺失或与 Production Run 不一致/);
    assert.equal(await panel.appendW73cAudit(task({ mode: 'max' }), result(), { artifactDir: 'D:/ignored' }), null);
    assert.equal(await panel.appendW73cAudit(task({ reviewProtocol: 'legacy' }), result(), { artifactDir: 'D:/ignored' }), null);
  });

  test('审计尾损坏后 ensure 转入 blocked，未结 accepted 旗语仍可重放', async () => {
    const { panel, files } = specimen();
    const target = task();
    const run = await panel.ensureProductionRun(target, { id: 'novel' });
    await panel.appendW73cAudit(target, result(), { artifactDir: `${target.folder}/工件/第001章`, unitNo: 1 });
    const audit = panel.reworkAuditLedgers.get(target.id);
    await audit.dispose();
    panel.reworkAuditLedgers.delete(target.id);
    files.set(run.paths.findings, `${files.get(run.paths.findings)}{"broken":`);
    await assert.rejects(() => panel.ensureProductionRun(target, { id: 'novel' }), error => error?.code === 'W73_AUDIT_RECOVERY_REQUIRED');
    const recovered = panel.reworkAuditLedgers.get(target.id);
    assert.equal(recovered.healthSnapshot().recoveryRequired, true);
    assert.equal(recovered.healthSnapshot().unresolvedFindings, 1);
    assert.equal(run.snapshot.status, 'blocked');
  });

  test('W73c 只旁路消费 W68 结果，不引入 W73d+ 资格/排程/路由概念', () => {
    const source = String(FactoryPanel.prototype.appendW73cAudit);
    assert.match(source, /buildW68AuditBatch/);
    assert.doesNotMatch(source, /qualification|scheduler|Router|marketplace|Hub|KPI/);
  });
});
