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
  panel.cfg = { providerId: 'provider-a', model: 'model-a', apiKey: 'TOP-SECRET-KEY' };
  panel.persistCount = 0;
  panel.persistTasks = () => { panel.persistCount += 1; };
  return { panel, files, directories };
}

function task(overrides = {}) {
  return {
    id: 'task-integration-001', label: '集成样本', folder: 'D:/Factory/Integration', mode: 'single',
    reviewProtocol: W68_PROTOCOL, reviewRitual: 'light', reviewBudgetCap: 32000,
    ...overrides,
  };
}

describe('W73b Factory single-path runtime integration', () => {
  test('ensure 在真实 FactoryPanel 方法上创建五件套并持久化 task→run 指针', async () => {
    const { panel, files } = specimen();
    const target = task();
    const ledger = await panel.ensureProductionRun(target, { id: 'novel' });
    assert.equal(ledger.snapshot.status, 'running');
    assert.equal(target.productionRunId, ledger.runId);
    assert.equal(target.productionRunStatus, 'running');
    assert.ok(target.productionRunPath.endsWith(`/.mazz/runs/${ledger.runId}`));
    for (const path of [ledger.paths.snapshot, ledger.paths.events, ledger.paths.findings, ledger.paths.economics, ledger.paths.references]) {
      assert.equal(files.has(path), true, `缺少 ${path}`);
    }
    assert.doesNotMatch([...files.values()].join('\n'), /TOP-SECRET-KEY/);
    assert.ok(panel.persistCount >= 2);
  });

  test('审理与完成事件经 FactoryPanel 写入；完成后重跑产生新 Run 并链接 previousRunId', async () => {
    const { panel } = specimen();
    const target = task();
    const first = await panel.ensureProductionRun(target, { id: 'novel' });
    await panel.appendProductionRun(target, {
      type: 'review-recorded', gateRefs: ['w68:machine:pass'],
      artifactRefs: [{ kind: 'artifact', path: '工件/第001章/manifest.json', role: 'manifest' }],
    });
    await panel.appendProductionRun(target, {
      type: 'run-completed', toStatus: 'completed',
      artifactRefs: [{ kind: 'artifact', path: '第001章.md', role: 'final-output' }],
    });
    assert.equal(first.snapshot.status, 'completed');
    const firstId = first.runId;
    const second = await panel.ensureProductionRun(target, { id: 'novel' });
    assert.notEqual(second.runId, firstId);
    assert.equal(second.snapshot.previousRunId, firstId);
    assert.equal(second.snapshot.status, 'running');
  });

  test('W68 单次缺账即阻断；max 与 legacy 明确不进入 W73b', async () => {
    const { panel } = specimen();
    await assert.rejects(() => panel.appendProductionRun(task(), { type: 'review-recorded' }), /无账继续/);
    assert.equal(await panel.ensureProductionRun(task({ mode: 'max' }), {}), null);
    assert.equal(await panel.ensureProductionRun(task({ reviewProtocol: 'legacy' }), {}), null);
  });

  test('错误消息中的当前 Provider key 在入账前脱敏', () => {
    const { panel } = specimen();
    assert.equal(panel.redactProductionRunMessage('HTTP failed TOP-SECRET-KEY'), 'HTTP failed [REDACTED]');
  });
});
