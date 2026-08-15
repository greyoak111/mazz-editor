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
    assert.ok(capsule.includes('DESIGN REGISTERED / POST-W71 / NOT APPROVED FOR IMPLEMENTATION'));
    assert.ok(planIndex.includes('W69a–W69i 已拆波，未施工'));
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

  test('all approved design waves are indexed in dependency order', () => {
    for (const wave of ['W69a', 'W69b', 'W69c', 'W69d', 'W69e', 'W69f', 'W69g', 'W69h', 'W69i']) {
      assert.ok(capsule.includes(`### ${wave} —`), `missing design wave: ${wave}`);
    }
    assert.ok(capsule.indexOf('### W69a —') < capsule.indexOf('### W69i —'));
  });

  test('both hard validation samples and origin fallback remain mandatory', () => {
    assert.ok(capsule.includes('Content Fabric Sample A'));
    assert.ok(capsule.includes('World Network Sample B'));
    assert.ok(capsule.includes('Origin fallback'));
    assert.ok(capsule.includes('二者未跑通前，不得宣称'));
  });

  test('W71 freezes W69 runtime and keeps adjacent scopes distinct', () => {
    assert.ok(w71Spec.includes('W69a–W69i'));
    assert.ok(w71Spec.includes('公开 Comment/Danmaku Event Feed、人类多人 P2P 共看 Room 与 W64 AI 陪看三者明确分离'));
    assert.ok(w71Spec.includes('Hub 服务、账号系统、公共 Seed、World runtime'));
  });
});
