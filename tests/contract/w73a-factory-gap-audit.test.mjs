import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, assert } from '../harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const matrixPath = path.join(root, 'docs/engineering/evidence/W73_FACTORY_GAP_MATRIX.json');
const specPath = path.join(root, 'docs/engineering/W73_FACTORY_ORGANIZATIONAL_COMPLETION_SPEC.md');
const checkpointPath = path.join(root, 'docs/engineering/W73A_FACTORY_GAP_AUDIT_2026-08-17.md');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));

describe('W73a Factory gap audit', () => {
  test('22 项恢复账只有五种明确分类且计数闭合', () => {
    assert.equal(matrix.schemaVersion, 1);
    assert.equal(matrix.coordinate, 'main@94a82aa');
    assert.equal(matrix.status, 'W73G_IMPLEMENTED');
    assert.deepEqual(matrix.classificationEnum, ['LANDED', 'PARTIAL', 'METHOD_ASSET', 'POST_W71', 'OBSOLETE']);
    assert.equal(matrix.items.length, 22);
    const counts = Object.fromEntries(matrix.classificationEnum.map(value => [value, 0]));
    for (const item of matrix.items) {
      assert.ok(matrix.classificationEnum.includes(item.classification), `${item.id} 分类非法`);
      counts[item.classification] += 1;
    }
    assert.deepEqual(counts, matrix.classificationCounts);
    assert.deepEqual(counts, { LANDED: 1, PARTIAL: 10, METHOD_ASSET: 6, POST_W71: 3, OBSOLETE: 2 });
  });

  test('每项当前事实都能回到仓库文件与精确证据针', () => {
    for (const item of matrix.items) {
      assert.ok(item.currentEvidence.length > 0, `${item.id} 无当前证据`);
      for (const evidence of item.currentEvidence) {
        assert.equal(path.isAbsolute(evidence.path), false, `${item.id} 不得用不可移植绝对仓库路径`);
        const target = path.join(root, evidence.path);
        assert.equal(fs.existsSync(target), true, `${item.id} 缺文件 ${evidence.path}`);
        const source = fs.readFileSync(target, 'utf8');
        assert.ok(source.includes(evidence.needle), `${item.id} 缺证据针 ${evidence.needle}`);
        assert.ok(evidence.claim.length >= 12, `${item.id} claim 过短`);
      }
    }
  });

  test('已落地 W68 审理被保留，旧身份混写与旧 Factory 壳被淘汰', () => {
    const byId = Object.fromEntries(matrix.items.map(item => [item.id, item]));
    assert.equal(byId.F04.classification, 'LANDED');
    assert.match(byId.F04.decision, /Preserve|compatibility/);
    for (const id of ['F01', 'F03', 'F05', 'F07', 'F09', 'F10', 'F12', 'F13', 'F16', 'F20']) {
      assert.equal(byId[id].classification, 'PARTIAL', `${id} 不得误报完全未落地`);
    }
    assert.equal(byId.F21.classification, 'OBSOLETE');
    assert.equal(byId.F22.classification, 'OBSOLETE');
    assert.ok(matrix.forbidden.some(value => /second Factory/.test(value)));
    assert.ok(matrix.forbidden.some(value => /identity conflation/.test(value)));
  });

  test('W74/W79/W64 项显式出表，seal 不得偷换 Promotion', () => {
    const routes = Object.fromEntries(matrix.routedOut.map(row => [row.itemId, row.target]));
    assert.deepEqual(routes, { F02: 'W74a', F08: 'W79', F11: 'W64', F19: 'W74c' });
    const byId = Object.fromEntries(matrix.items.map(item => [item.id, item]));
    assert.equal(byId.F19.classification, 'POST_W71');
    assert.match(byId.F19.decision, /never auto-promotes/);
    assert.ok(matrix.invariants.some(value => /Hub receives only explicit W74c/.test(value)));
    assert.ok(matrix.invariants.some(value => /W82 compiles organizations/.test(value)));
  });

  test('施工依赖从 W73a 到 W73h 单向，W73a-g 完成且唯一下一波是未批准 W73h', () => {
    assert.deepEqual(matrix.waves.map(row => row.id), ['W73a', 'W73b', 'W73c', 'W73d', 'W73e', 'W73f', 'W73g', 'W73h']);
    assert.equal(matrix.waves[0].status, 'COMPLETE_BY_THIS_CHANGE');
    assert.equal(matrix.waves[1].status, 'COMPLETE_AT_B443908');
    assert.equal(matrix.waves[2].status, 'COMPLETE_AT_95F51A4');
    assert.equal(matrix.waves[3].status, 'COMPLETE_BY_THIS_CHANGE');
    assert.equal(matrix.waves[4].status, 'COMPLETE_BY_THIS_CHANGE');
    assert.equal(matrix.waves[5].status, 'COMPLETE_BY_THIS_CHANGE');
    assert.equal(matrix.waves[6].status, 'COMPLETE_BY_THIS_CHANGE');
    const next = matrix.waves.filter(row => row.status === 'NEXT_RECOMMENDED_NOT_APPROVED');
    assert.deepEqual(next.map(row => row.id), ['W73h']);
    assert.equal(matrix.waves[0].runtimeChange, false);
    assert.equal(matrix.waves.slice(1).every(row => row.runtimeChange), true);
    assert.ok(matrix.waves.find(row => row.id === 'W73d').dependsOn.includes('W66_REAL_ADAPTER_FOR_EXTERNAL_EXECUTION'));
    assert.ok(matrix.waves.find(row => row.id === 'W73h').dependsOn.includes('W73g'));
  });

  test('规格冻结文件优先 Run、透明 Router、防 Goodhart 与审计停工线', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const checkpoint = fs.readFileSync(checkpointPath, 'utf8');
    for (const needle of [
      'W73g IMPLEMENTED / W73h NOT APPROVED',
      '一个运行一个目录 + append-only 事件 + 小型快照',
      'Model != Provider != Harness != Seat',
      '不提供 One Overall Score',
      'W66 至少一个真实 Adapter',
      'Factory seal 不等于 Promotion',
      '需要重写 `runW68Review()` 才能接 Ledger',
      '20 次生产/关闭',
    ]) assert.ok(spec.includes(needle), `规格缺少：${needle}`);
    assert.ok(checkpoint.includes('PASS — SPEC ONLY / NO RUNTIME CHANGE'));
    assert.ok(checkpoint.includes('W73b Production Run Identity & Append-only Ledger'));
    assert.ok(checkpoint.includes('未改 `renderer/`、`main/`、`preload/`、IPC、UI 或产品状态'));
  });
});
