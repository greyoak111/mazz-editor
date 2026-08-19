import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cross = require('../../main/foundation/cross-media-workflow-family.js');
const game = require('../../main/foundation/game-vertical-slice.js');
const { WorkflowLibrary } = require('../../main/workflow-library.js');
const { OrganizationalWorkspaceService } = require('../../main/organizational-workspace-service.js');

const world = version => ({
  schema: cross.WORLD_CONTEXT_SCHEMA, worldId: 'world:sample', version, branchId: 'canon',
  canonEventIds: version === '2' ? ['event:2'] : ['event:1', 'event:2'],
  assetRefs: ['asset:character'], styleRefs: ['style:world'], rightsRefs: ['rights:local'], lockedFactIds: ['fact:hero'],
});

test('W82e 同一 World Event 可派生四种 Edition，Anchor/进度命名空间绝不互相污染', () => {
  const family = cross.createCrossMediaWorkflowFamily();
  assert.deepEqual(family.professionalProfiles.map(row => row.mediaKind).sort(), ['animation', 'audio', 'comic', 'novel']);
  const editions = ['novel', 'comic', 'audio', 'animation'].map(mediaKind => cross.createMediaEditionPlan({
    editionId: `edition:${mediaKind}:1`, mediaKind, world: world('1'), eventIds: ['event:1'],
    adaptationPolicyRef: `adaptation:${mediaKind}:v1`, outputArtifactRefs: [`artifact:${mediaKind}:1`],
  }));
  const isolation = cross.inspectEditionIsolation(editions);
  assert.equal(isolation.isolated, true);
  assert.equal(new Set(editions.map(row => row.anchorNamespace)).size, 4);
  assert.ok(editions.every(row => !row.canonMutationAllowed && !row.publicationAuthorized));
});

test('W82e World 版本迁移只标记引用被移除 Event 的 Edition，不静默重写 Canon', () => {
  const novel = cross.createMediaEditionPlan({ editionId: 'edition:novel', mediaKind: 'novel', world: world('1'), eventIds: ['event:1'], adaptationPolicyRef: 'adapt:novel' });
  const audio = cross.createMediaEditionPlan({ editionId: 'edition:audio', mediaKind: 'audio', world: world('1'), eventIds: ['event:2'], adaptationPolicyRef: 'adapt:audio' });
  const result = cross.previewWorldMigration({ previous: world('1'), next: world('2'), editions: [novel, audio] });
  assert.equal(result.state, 'REVIEW_REQUIRED');
  assert.deepEqual(result.affectedEditionIds, ['edition:novel']);
  assert.equal(result.automaticCanonMutation, false);
  assert.equal(result.automaticEditionRewrite, false);
});

test('W82e 包拒绝 secret 和不存在于钉住 World 的 Event', () => {
  assert.throws(() => cross.normalizeWorldContext({ ...world('1'), password: 'x' }), /secret/);
  assert.throws(() => cross.createMediaEditionPlan({ editionId: 'x', mediaKind: 'novel', world: world('1'), eventIds: ['event:missing'], adaptationPolicyRef: 'a' }), /不在钉住/);
});

test('W82f 最小游戏切片由同一 Kernel 编译，外部引擎可替换且 Mazz 不冒充游戏引擎', () => {
  const ready = game.compileGameVerticalSlice();
  assert.equal(ready.plan.status, 'READY');
  assert.equal(ready.workflow.artifacts.length, 9);
  assert.equal(ready.workflow.gates.length, 4);
  assert.equal(ready.boundary.mazzGameEngineBuilt, false);
  assert.ok(ready.plan.routing.some(row => row.seatId === 'seat:integrator'));
});

test('W82f 工具缺失、失败和取消都形成局部恢复证据，不重跑无关分支', () => {
  const blocked = game.compileGameVerticalSlice({ engineAvailable: false });
  assert.equal(blocked.plan.status, 'BLOCKED');
  assert.match(JSON.stringify(blocked.plan.blockers), /LOCKED_EXECUTOR_INELIGIBLE/);
  const missing = game.evaluateGameToolReceipt({ state: 'tool-missing', stage: 'build', evidenceRefs: ['probe:no-engine'] });
  assert.equal(missing.state, 'BLOCKED_TOOL_MISSING');
  assert.deepEqual(missing.affectedArtifactIds, ['artifact:build', 'artifact:local-manifest', 'artifact:playtest']);
  assert.equal(game.evaluateGameToolReceipt({ state: 'cancelled', stage: 'playtest' }).state, 'RECOVERY_REQUIRED_CANCELLED');
});

test('W82g 本地库支持 create/export/import/fork/diff/deprecate 且从不携 Runtime', () => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w82g-a-'));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w82g-b-'));
  try {
    const a = new WorkflowLibrary({ rootProvider: () => rootA, now: () => '2026-08-19T00:00:00.000Z' });
    const original = a.create(game.createGameVerticalSliceWorkflow(), { authorityRef: 'human:test' });
    const exported = path.join(rootA, 'game.workflow.json');
    a.exportFile(original.workflowId, original.version, exported);
    const b = new WorkflowLibrary({ rootProvider: () => rootB, now: () => '2026-08-19T00:00:01.000Z' });
    const imported = b.importFile(exported, { authorityRef: 'human:test' });
    assert.equal(imported.packageDigest, original.packageDigest);
    assert.equal(imported.runtimeIncluded, false);
    const forked = b.fork(imported.workflowId, imported.version, { workflowId: 'workflow:game-fork', name: 'Game Fork', authorityRef: 'human:test' });
    assert.notEqual(forked.workflowId, imported.workflowId);
    assert.equal(b.diff({ workflowId: imported.workflowId, version: imported.version }, { workflowId: forked.workflowId, version: forked.version }).changed, true);
    assert.equal(b.deprecate(imported.workflowId, imported.version, { authorityRef: 'human:test', reason: 'superseded by explicit fork' }).status, 'DEPRECATED');
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true }); fs.rmSync(rootB, { recursive: true, force: true });
  }
});

test('W82g compatibility 分开报告 Capability 与 Human Authority 缺件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w82g-compat-'));
  try {
    const library = new WorkflowLibrary({ rootProvider: () => root });
    const record = library.create(game.createGameVerticalSliceWorkflow(), { authorityRef: 'human:test' });
    const result = library.compatibility(record.workflowId, record.version, { capabilityIds: [], authorityRefs: [] });
    assert.equal(result.compatible, false);
    assert.ok(result.missingCapabilities.includes('capability:external-engine-build'));
    assert.ok(result.missingAuthorities.includes('authority:release-owner'));
    assert.equal(result.executionAuthorized, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('W82h 从 Intent 编译四行业预览，明示成本/缺件/人工 Gate 且不启动执行', () => {
  const handlers = {};
  const service = new OrganizationalWorkspaceService({ bus: { handle: (name, fn) => { handlers[name] = fn; } }, rootProvider: () => os.tmpdir() });
  for (const templateId of ['animation-short', 'game-vertical-slice', 'software-release', 'research-report']) {
    const preview = service.preview({ goal: `deliver ${templateId}`, templateId, budget: 500 });
    assert.ok(preview.organization.seats.length > 0);
    assert.ok(preview.organization.artifacts.length > 0);
    assert.ok(preview.organization.gates.every(gate => gate.requiresHumanAuthority));
    assert.equal(preview.previewOnly, true);
    assert.equal(preview.executionStarted, false);
    assert.equal(preview.authority.bypassAllowed, false);
    assert.equal(preview.boundary.runtimeTruthOwner, 'W73');
  }
  assert.ok(handlers['organization:preview'] && handlers['organization:save']);
});

test('W82h 正式入口和 preload IPC 均已装配', () => {
  const app = fs.readFileSync(path.resolve('renderer/app.js'), 'utf8');
  const shell = fs.readFileSync(path.resolve('renderer/shell/shell.js'), 'utf8');
  const preload = fs.readFileSync(path.resolve('preload/bridge.js'), 'utf8');
  assert.match(app, /modules\.register\('organization'/);
  assert.match(shell, /factory\.openOrganization/);
  for (const channel of ['organization:templates', 'organization:preview', 'organization:save', 'organization:list', 'organization:compatibility']) assert.ok(preload.includes(`'${channel}'`));
});

test('W82g 同 identity/version 内容漂移与非人类写入均 fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w82g-drift-'));
  try {
    const library = new WorkflowLibrary({ rootProvider: () => root });
    const workflow = game.createGameVerticalSliceWorkflow();
    library.create(workflow, { authorityRef: 'human:test' });
    assert.throws(() => library.save({ ...workflow, name: 'silent drift' }, { authorityRef: 'human:test' }), /内容漂移/);
    assert.throws(() => library.save({ ...workflow, workflowId: 'workflow:agent-write' }, { authorityRef: 'agent:test' }), /human Authority/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
