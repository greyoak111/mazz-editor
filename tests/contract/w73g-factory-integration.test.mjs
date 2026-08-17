import fs from 'node:fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { FactoryPanel } from '../../renderer/modules/factory/index.js';
import { W68_PROTOCOL } from '../../renderer/modules/factory/review.js';
import { ElasticStaffingCoordinator } from '../../renderer/modules/factory/joint-scheduler.js';
import { parseFactoryArchive } from '../../renderer/modules/factory/workshop.js';
import { FACTORY_PROCESS_PROTOCOL_SCHEMA, FACTORY_PROCESS_PROJECTION_SCHEMA } from '../../renderer/modules/factory/process-protocol-assets.js';

function specimen() {
  const files = new Map(); const directories = new Set();
  window.mazz = { invoke: async (channel, payload = {}) => {
    if (channel === 'fs:stat') return files.has(payload.path)
      ? { exists: true, isDir: false, size: files.get(payload.path).length }
      : { exists: directories.has(payload.path), isDir: directories.has(payload.path) };
    if (channel === 'fs:readFile') { if (!files.has(payload.path)) throw new Error(`ENOENT ${payload.path}`); return files.get(payload.path); }
    if (channel === 'fs:writeFile') { files.set(payload.path, String(payload.content)); return true; }
    if (channel === 'fs:mkdir') { directories.add(payload.path); return true; }
    if (channel === 'harness:adapters') return [];
    throw new Error(`unexpected channel ${channel}`);
  } };
  const panel = Object.create(FactoryPanel.prototype);
  panel.productionRunLedgers = new Map(); panel.reworkAuditLedgers = new Map(); panel.qualificationLedgers = new Map();
  panel.delegationLedgers = new Map(); panel.qualificationDelegationServices = new Map(); panel.scheduleLedgers = new Map();
  panel.economicsEvaluationLedgers = new Map(); panel.workshopWrites = new Map(); panel.staffingCoordinator = new ElasticStaffingCoordinator({ capacity: 1 });
  panel.concurrency = 1; panel.schedulerSequence = 0; panel.tasks = []; panel.runningTasks = new Set();
  panel.cfg = { providerId: 'provider-a', model: 'model-a', apiKey: 'TOP-SECRET-KEY' }; panel.persistTasks = () => {};
  return { panel, files };
}

function task(overrides = {}) {
  return {
    id: 'task-w73g-integration', label: 'W73g 集成样本', folder: 'D:/Factory/W73gIntegration', mode: 'single',
    reviewProtocol: W68_PROTOCOL, reviewRitual: 'light', reviewBudgetCap: 32000, ...overrides,
  };
}

describe('W73g same-Run Factory Desk integration', () => {
  test('ensure 在同一 Run 建立协议/包络/投影，并由现有工厂群档案供 Factory Desk 消费', async () => {
    const { panel, files } = specimen(); const target = task(); const run = await panel.ensureProductionRun(target, { id: 'novel' });
    assert.equal(target.processProtocolSchema, FACTORY_PROCESS_PROTOCOL_SCHEMA);
    assert.equal(target.processProtocolProjectionSchema, FACTORY_PROCESS_PROJECTION_SCHEMA);
    for (const path of [target.processProtocolPath, target.processProtocolEnvelopePath, target.processProtocolProjectionPath, target.processProtocolProjectionEnvelopePath]) {
      assert.equal(files.has(path), true, `缺 ${path}`);
    }
    assert.equal(run.snapshot.protocolRefs.length, 2);
    const archive = files.get(`${target.folder}/工厂群.md`);
    const events = parseFactoryArchive(archive).filter(row => row.stage === 'process-protocol');
    assert.equal(events.length, 1);
    assert.match(events[0].content, /Director stages：7|Handoffs：7|Artifact roles：12/);
    assert.equal(events[0].artifactPath, target.processProtocolProjectionPath.replace(/projection\.json$/, 'README.md'));
    assert.doesNotMatch([...files.values()].join('\n'), /TOP-SECRET-KEY/);
  });

  test('同一 sequence 重开幂等；新增 Run 事实后生成新投影版本并保留旧版本', async () => {
    const { panel, files } = specimen(); const target = task(); const run = await panel.ensureProductionRun(target, { id: 'novel' });
    const firstProjection = target.processProtocolProjectionPath; const firstSequence = run.snapshot.lastSequence;
    await panel.ensureW73gProtocolAssets(target, run);
    assert.equal(run.snapshot.lastSequence, firstSequence);
    assert.equal(parseFactoryArchive(files.get(`${target.folder}/工厂群.md`)).filter(row => row.stage === 'process-protocol').length, 1);
    await panel.appendProductionRun(target, {
      type: 'review-recorded', gateRefs: ['w68:machine:pass'], findingRefs: ['finding:integration'],
      artifactRefs: [{ kind: 'artifact', id: 'artifact:draft', path: `${target.folder}/工件/001/02-扩写稿.md`, type: 'text/markdown', role: 'draft' }],
    });
    await panel.ensureW73gProtocolAssets(target, run);
    assert.notEqual(target.processProtocolProjectionPath, firstProjection);
    assert.equal(files.has(firstProjection), true);
    const current = JSON.parse(files.get(target.processProtocolProjectionPath));
    assert.deepEqual(current.gateRefs, ['w68:machine:pass']);
    assert.deepEqual(current.findingRefs, ['finding:integration']);
    assert.equal(current.artifactRefs.some(ref => ref.role === 'draft'), true);
    assert.equal(parseFactoryArchive(files.get(`${target.folder}/工厂群.md`)).filter(row => row.stage === 'process-protocol').length, 2);
  });

  test('终态投影可刷新但不向已完成 Run 追加幽灵事件', async () => {
    const { panel, files } = specimen(); const target = task(); const run = await panel.ensureProductionRun(target, { id: 'novel' });
    await panel.appendProductionRun(target, { type: 'run-completed', toStatus: 'completed', artifactRefs: [{ kind: 'artifact', path: `${target.folder}/正文.md`, role: 'final-output' }] });
    const terminalSequence = run.snapshot.lastSequence;
    await panel.ensureW73gProtocolAssets(target, run);
    assert.equal(run.snapshot.lastSequence, terminalSequence);
    const current = JSON.parse(files.get(target.processProtocolProjectionPath));
    assert.equal(current.runRef.status, 'completed');
    assert.equal(current.artifactRefs.some(ref => ref.role === 'final-output'), true);
  });

  test('max/legacy 不偷迁；实现不注册第二 Factory/导演中心或执行器', async () => {
    const { panel } = specimen();
    assert.equal(await panel.ensureProductionRun(task({ mode: 'max' }), {}), null);
    assert.equal(await panel.ensureProductionRun(task({ reviewProtocol: 'legacy' }), {}), null);
    const source = fs.readFileSync(new URL('../../renderer/modules/factory/process-protocol-assets.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /registerModule|createSession|chatStream|child_process|execute\s*\(|automaticFallback:\s*true|Promotion.*trigger|Publication.*trigger/);
    assert.match(source, /不执行、不调度、不持有 Run 真相/);
  });
});
