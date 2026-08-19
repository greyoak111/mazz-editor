// W69 architecture intake contract: preserve the registered design without implying implementation.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const capsulePath = path.resolve('docs/plans/W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md');
const capsule = fs.readFileSync(capsulePath, 'utf8');
const workflowCapsule = fs.readFileSync(path.resolve('docs/plans/W82_ORGANIZATIONAL_COMPILER.md'), 'utf8');
const planIndex = fs.readFileSync(path.resolve('docs/plans/README.md'), 'utf8');
const w71Spec = fs.readFileSync(path.resolve('docs/engineering/W71_FINAL_CONVERGENCE_EXECUTION_SPEC.md'), 'utf8');

describe('W69 Local-first Content Network architecture intake', () => {
  test('source identity and non-implementation status remain explicit', () => {
    assert.ok(capsule.includes('089FD81DDFC5F07829199F9A7DCA6250E4AC902E1E92F4FEFDAD46EF15837195'));
    assert.ok(capsule.includes('E5DAF440261A56AAE97EF99B8453298D1D76D0205A0D9C4A90A27AA0E2A2D127'));
    assert.ok(capsule.includes('92736DB6477616CD15321BC6A9168680DADB1CACE57F7863BDD8D4A2886E4679'));
    assert.ok(capsule.includes('EF11DB0F77AFE04610A2FA55E62DE6B3703A1D50E460057AF33B27417595212E'));
    assert.ok(capsule.includes('79A1588A2971E134B6CEB1CFD02AC4D27AB4981968A0E46285DEA0EE3D039408'));
    assert.ok(capsule.includes('98EDCEBFE850836AD9ED96AC3D99F9C43BAD72BC6E5EFE22D547871CDCE450C0'));
    assert.ok(capsule.includes('DESIGN REGISTERED / POST-W71 / NOT APPROVED FOR IMPLEMENTATION'));
    assert.ok(planIndex.includes('W69a–W69m 已拆波，未施工'));
    assert.ok(planIndex.includes('W82a–W82h 本地受控切片全部 LANDED；W69 发布除外'));
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
    for (const wave of ['W69a', 'W69b', 'W69c', 'W69d', 'W69e', 'W69f', 'W69g', 'W69h', 'W69i', 'W69j', 'W69k', 'W69l', 'W69m']) {
      assert.ok(capsule.includes(`### ${wave} —`), `missing design wave: ${wave}`);
    }
    assert.ok(capsule.indexOf('### W69a —') < capsule.indexOf('### W69m —'));
  });

  test('all five hard validation samples and origin fallback remain mandatory', () => {
    assert.ok(capsule.includes('Content Fabric Sample A'));
    assert.ok(capsule.includes('World Network Sample B'));
    assert.ok(capsule.includes('Production Market Sample C'));
    assert.ok(capsule.includes('Media Workflow Sample D'));
    assert.ok(capsule.includes('Organizational Invariance Sample E'));
    assert.ok(capsule.includes('Origin fallback'));
    assert.ok(capsule.includes('A/B/C/D/E 未全部跑通，不得宣称六柱闭环完成'));
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

  test('organizational compiler is local infrastructure while W69m is only its public projection', () => {
    assert.ok(workflowCapsule.includes('W82 / Local Mazz'));
    assert.ok(workflowCapsule.includes('W69 / MazzHub'));
    assert.ok(workflowCapsule.includes('W69m 是 W82 的公共投影，不是第二个 Compiler 或 Factory Runtime'));
    assert.ok(capsule.includes('W69 只承担 Workflow Publication、发现、Fork、透明市场视图'));
  });

  test('workflow package compiles proven organizational boundaries without conflating seats and executors', () => {
    for (const mapping of ['职业 / 岗位          → Seat', '交接物               → Artifact Contract', '质检 / 审稿 / Review → Gate / Reviewer', '行业 SOP             → Workflow Package']) {
      assert.ok(workflowCapsule.includes(mapping), `missing workflow mapping: ${mapping}`);
    }
    assert.ok(workflowCapsule.includes('Seat != Model'));
    assert.ok(workflowCapsule.includes('为动画重造 NLE / 为游戏重造 Engine / 为音频重造 DAW'));
  });

  test('organization archaeology removes historical friction and cross-domain proof is mandatory', () => {
    assert.ok(workflowCapsule.includes('Compile the invariant structure of production'));
    assert.ok(workflowCapsule.includes('管边界，不管手脚'));
    assert.ok(workflowCapsule.includes('能证明的不推理，能计算的不生成'));
    assert.ok(workflowCapsule.includes('W82b — Software Release Organization Slice'));
    assert.ok(workflowCapsule.includes('W82c — Research / Evidence Organization Slice'));
    assert.ok(workflowCapsule.includes('Hard Validation Sample E — Cross-domain invariance'));
    assert.ok(workflowCapsule.includes('Sample E 未通过，不得使用“Organizational Compiler”'));
  });

  test('sample D requires mixed execution, local repair and safe workflow publication', () => {
    assert.ok(workflowCapsule.includes('Hard Validation Sample D'));
    assert.ok(workflowCapsule.includes('rerun only affected branch'));
    assert.ok(workflowCapsule.includes('another user inspects, forks, checks local capability and recompiles'));
    assert.ok(workflowCapsule.includes('Sample D 未通过，不得宣称 Media Production Workflow'));
  });

  test('W71 freezes W69 runtime and keeps adjacent scopes distinct', () => {
    assert.ok(w71Spec.includes('W69a–W69m'));
    assert.ok(w71Spec.includes('W82_ORGANIZATIONAL_COMPILER.md'));
    assert.ok(w71Spec.includes('不批准 W63–W86'));
    assert.ok(w71Spec.includes('公开 Comment/Danmaku Event Feed、人类多人 P2P 共看 Room 与 W64 AI 陪看三者明确分离'));
    assert.ok(w71Spec.includes('Hub 服务、账号系统、公共 Seed、World runtime'));
  });
});
