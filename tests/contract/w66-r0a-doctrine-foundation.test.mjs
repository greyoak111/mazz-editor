// W66-R0a Canonical raw snapshot / Stable Rule Registry / Incident Lineage
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  readCanonicalRuleSource,
  sha256,
  snapshotCanonicalRuleSource,
  snapshotR0aFoundation,
  validateCatalogLinkage,
  validateIncidentLineage,
  validateRuleRegistry,
} = require('../../main/agent-doctrine.js');

const registry = JSON.parse(fs.readFileSync('docs/engineering/doctrine/MAZZ_STABLE_RULE_REGISTRY.v0.json', 'utf8'));
const lineage = JSON.parse(fs.readFileSync('docs/engineering/doctrine/MAZZ_INCIDENT_LINEAGE.v0.json', 'utf8'));
const fixedClock = () => new Date('2026-08-19T01:00:00.000Z');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w66-r0a-'));
  const sourcePath = path.join(root, 'Mazz Editor 开发军规.md');
  const bytes = Buffer.from('# 军规\r\n\r\n完整原字节必须保留。\r\n', 'utf8');
  fs.writeFileSync(sourcePath, bytes);
  return {
    root,
    sourcePath,
    bytes,
    doctrineRoot: path.join(root, '.mazz', 'agent-doctrine'),
    dispose() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

describe('W66-R0a Canonical Raw Source', () => {
  test('快照逐字节一致，SHA-256/byteLength/引用均来自磁盘真值', () => {
    const item = fixture();
    try {
      const read = readCanonicalRuleSource({ sourcePath: item.sourcePath });
      assert.equal(read.sha256, sha256(item.bytes));
      assert.equal(read.byteLength, item.bytes.length);
      assert.equal(read.bytes.equals(item.bytes), true);

      const receipt = snapshotCanonicalRuleSource({
        sourcePath: item.sourcePath,
        doctrineRoot: item.doctrineRoot,
        authorityRef: 'human:test-maintainer',
        clock: fixedClock,
      });
      const snapshot = fs.readFileSync(path.join(item.doctrineRoot, receipt.snapshotRef));
      assert.equal(snapshot.equals(item.bytes), true);
      assert.equal(sha256(snapshot), receipt.sha256);
      assert.equal(receipt.byteLength, item.bytes.length);

      const again = snapshotCanonicalRuleSource({
        sourcePath: item.sourcePath,
        doctrineRoot: item.doctrineRoot,
        authorityRef: 'human:test-maintainer',
        clock: fixedClock,
      });
      assert.equal(again.snapshotRef, receipt.snapshotRef, '相同原文快照必须幂等');
    } finally { item.dispose(); }
  });

  test('缺失、非法 UTF-8 与快照失败返回确定性错误，且没有 child process 路径', () => {
    const item = fixture();
    try {
      assert.throws(
        () => readCanonicalRuleSource({ sourcePath: path.join(item.root, 'missing.md') }),
        error => error.code === 'RULE_PACK_REQUIRED',
      );
      const invalidPath = path.join(item.root, 'invalid.md');
      fs.writeFileSync(invalidPath, Buffer.from([0xc3, 0x28]));
      assert.throws(
        () => readCanonicalRuleSource({ sourcePath: invalidPath }),
        error => error.code === 'RULE_PACK_ENCODING_INVALID',
      );
      const blockedRoot = path.join(item.root, 'not-a-directory');
      fs.writeFileSync(blockedRoot, 'occupied');
      assert.throws(
        () => snapshotCanonicalRuleSource({ sourcePath: item.sourcePath, doctrineRoot: blockedRoot, authorityRef: 'human:test', clock: fixedClock }),
        error => error.code === 'RULE_PACK_SNAPSHOT_FAILED',
      );
    } finally { item.dispose(); }
  });
});

describe('W66-R0a Stable Rule Registry / Incident Lineage', () => {
  test('当前 sidecar 使用稳定 Rule ID，所有事故引用均能回到尸检叙事', () => {
    assert.equal(validateRuleRegistry(registry), registry);
    assert.equal(validateIncidentLineage(lineage), lineage);
    assert.equal(validateCatalogLinkage(registry, lineage), true);
    assert.equal(new Set(registry.rules.map(rule => rule.id)).size, registry.rules.length);
    assert.ok(registry.rules.some(rule => rule.id === 'MAZZ-RULE-PACK-001'));
    assert.ok(lineage.incidents.some(incident => incident.id === 'MAZZ-W74-WAVE-SKIP'));
  });

  test('重复 Rule ID 与悬空 Incident 引用 fail closed', () => {
    const duplicate = structuredClone(registry);
    duplicate.rules[1].id = duplicate.rules[0].id;
    assert.throws(() => validateRuleRegistry(duplicate), error => error.code === 'RULE_REGISTRY_INVALID');

    const missing = structuredClone(registry);
    missing.rules[0].origin.incidents = ['INCIDENT-DOES-NOT-EXIST'];
    assert.throws(() => validateCatalogLinkage(missing, lineage), error => error.code === 'INCIDENT_LINEAGE_INVALID');
  });

  test('R0a 基础包只保存不可变 raw/catalog 引用，不启动 Adapter', () => {
    const item = fixture();
    try {
      const foundation = snapshotR0aFoundation({
        sourcePath: item.sourcePath,
        doctrineRoot: item.doctrineRoot,
        authorityRef: 'human:test-maintainer',
        ruleRegistry: registry,
        incidentLineage: lineage,
        clock: fixedClock,
      });
      assert.equal(foundation.schemaVersion, 'mazz.doctrine-r0a-foundation/v0');
      assert.equal(fs.existsSync(path.join(item.doctrineRoot, foundation.ruleRegistryRef)), true);
      assert.equal(fs.existsSync(path.join(item.doctrineRoot, foundation.incidentLineageRef)), true);
      assert.equal('adapterId' in foundation, false);
      assert.equal('childProcess' in foundation, false);
    } finally { item.dispose(); }
  });
});
