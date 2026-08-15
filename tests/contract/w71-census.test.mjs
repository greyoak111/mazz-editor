// tests/contract/w71-census.test.mjs —— W71 Wave 0 Census 可重复性与边界契约
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve('.');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

describe('W71 Wave 0 Census', () => {
  test('审计脚本可重复生成四类证据', () => {
    const result = spawnSync(process.execPath, ['scripts/w71-census.js'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const file of ['ui-census.json', 'layout-debt.json', 'surface-census.json', 'agent-runtime-census.json']) {
      assert.ok(fs.existsSync(path.join(root, '.mazz', 'audit', file)), `缺 ${file}`);
    }
  });

  test('UI Census 排除构建物和 vendored 代码，并冻结对比度基线', () => {
    const data = readJson('.mazz/audit/ui-census.json');
    assert.equal(data.schemaVersion, 1);
    assert.deepEqual(data.scope.excluded, ['renderer/dist', 'renderer/vendor']);
    assert.equal(data.thresholds.normalTextContrast, 4.5);
    assert.equal(data.thresholds.largeTextKeyIconFocusContrast, 3);
    for (const key of ['visual', 'icon', 'theme', 'layout']) assert.ok(data[key].summary.totalFindings > 0, `${key} 应有事实样本`);
  });

  test('Surface 清单只冻结接口，不授权迁移或删除 workaround', () => {
    const data = readJson('.mazz/audit/surface-census.json');
    assert.equal(data.surfaceV1InterfaceDraft.status, 'DRAFT_ONLY_NO_MIGRATION');
    assert.match(data.decision, /NO SurfaceManager/);
    assert.ok(data.workaroundRegister.length >= 9);
    assert.ok(data.workaroundRegister.every(x => x.status === 'KEEP' && x.removalGate));
  });

  test('Agent 清单保持真实 Adapter 数量与认证边界', () => {
    const data = readJson('.mazz/audit/agent-runtime-census.json');
    assert.equal(data.harnessContract.registeredAdapterCount, 0);
    assert.equal(data.candidates.length, 4);
    assert.ok(data.candidates.every(x => x.authentication.status === 'NOT_PROBED'));
  });
});
