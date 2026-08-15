// W69 architecture intake contract: preserve the registered design without implying implementation.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const capsulePath = path.resolve('docs/plans/W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md');
const capsule = fs.readFileSync(capsulePath, 'utf8');
const planIndex = fs.readFileSync(path.resolve('docs/plans/README.md'), 'utf8');
const w71Spec = fs.readFileSync(path.resolve('docs/engineering/W71_FINAL_CONVERGENCE_EXECUTION_SPEC.md'), 'utf8');

describe('W69 Local-first Content Network architecture intake', () => {
  test('source identity and non-implementation status remain explicit', () => {
    assert.ok(capsule.includes('089FD81DDFC5F07829199F9A7DCA6250E4AC902E1E92F4FEFDAD46EF15837195'));
    assert.ok(capsule.includes('E5DAF440261A56AAE97EF99B8453298D1D76D0205A0D9C4A90A27AA0E2A2D127'));
    assert.ok(capsule.includes('DESIGN REGISTERED / POST-W71 / NOT APPROVED FOR IMPLEMENTATION'));
    assert.ok(planIndex.includes('W69a–W69l 已拆波，未施工'));
  });

  test('three-plane truth boundary and portable publication identity remain intact', () => {
    for (const plane of ['Private Plane', 'Public Plane', 'Distribution Plane']) {
      assert.ok(capsule.includes(plane), `missing plane: ${plane}`);
    }
    assert.ok(capsule.includes('Private Workspace ≠ Public Profile'));
    assert.ok(capsule.includes('publicationId != URL'));
    assert.ok(capsule.includes('Hub database = 作品唯一真相'));
  });

  test('content model, public events and governance stay separated', () => {
    for (const object of ['Work / Publication / Edition / Version', 'Content Manifest', 'Event Feed']) {
      assert.ok(capsule.includes(object), `missing object boundary: ${object}`);
    }
    assert.ok(capsule.includes('Canon ≠ Popularity ≠ Quality ≠ Permission'));
    assert.ok(capsule.includes('Fork 权尽量自由，Merge 权严格归属'));
    assert.ok(capsule.includes('Partial Merge'));
  });

  test('all registered design waves are indexed in dependency order', () => {
    for (const wave of ['W69a', 'W69b', 'W69c', 'W69d', 'W69e', 'W69f', 'W69g', 'W69h', 'W69i', 'W69j', 'W69k', 'W69l']) {
      assert.ok(capsule.includes(`### ${wave} —`), `missing design wave: ${wave}`);
    }
    assert.ok(capsule.indexOf('### W69a —') < capsule.indexOf('### W69l —'));
  });

  test('all three hard validation samples and origin fallback remain mandatory', () => {
    assert.ok(capsule.includes('Content Fabric Sample A'));
    assert.ok(capsule.includes('World Network Sample B'));
    assert.ok(capsule.includes('Production Market Sample C'));
    assert.ok(capsule.includes('Origin fallback'));
    assert.ok(capsule.includes('A/B/C 未全部跑通，不得宣称五柱闭环完成'));
  });

  test('production records remain local truth and public evidence stays reversible', () => {
    assert.ok(capsule.includes('ProductionRun` 的本地事实层属于 Factory/W73'));
    assert.ok(capsule.includes('Hub 不得成为生产记录唯一真相'));
    assert.ok(capsule.includes('逐字段同意、脱敏、撤回和导出'));
    assert.ok(capsule.includes('Model/Harness/Formula/Metric/World Canon 均带版本'));
  });

  test('AI market is a transparent projection rather than one overall score', () => {
    assert.ok(capsule.includes('Production Score、Author Score、Audience Score 三张互不代替的成绩单'));
    assert.ok(capsule.includes('Pareto Frontiers'));
    assert.ok(capsule.includes('AUTO Router'));
    assert.ok(capsule.includes('用户可换 Worker、改权重、禁 Provider、锁模型'));
  });

  test('market, factory and audience signals never acquire canon authority', () => {
    assert.ok(capsule.includes('Challenge Winner、AI Rank、Factory Pass 均不自动成为 Canon'));
    assert.ok(capsule.includes('AI Rank / Audience Rank / Factory Pass → Canon'));
    assert.ok(capsule.includes('Canon Merge 提升事实而不吞并 Branch'));
  });

  test('W71 freezes W69 runtime and keeps adjacent scopes distinct', () => {
    assert.ok(w71Spec.includes('W69a–W69l'));
    assert.ok(w71Spec.includes('公开 Comment/Danmaku Event Feed、人类多人 P2P 共看 Room 与 W64 AI 陪看三者明确分离'));
    assert.ok(w71Spec.includes('Hub 服务、账号系统、公共 Seed、World runtime'));
  });
});
