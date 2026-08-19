import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const cognition = require('../../main/foundation/cognition-protocol.js');
const { CognitionService } = require('../../main/cognition-service.js');
const NOW = '2026-08-19T09:00:00.000Z';

function source(ref = 'asset:source') {
  return { ref, kind: 'asset', hash: 'sha256:abc', observedAt: NOW, health: 'HEALTHY', evidenceRefs: ['evidence:1'], provenance: { fixture: true } };
}
function item(overrides = {}) {
  return {
    identityKey: 'identity:one', type: 'Finding', title: '幻锚复活', sourceRefs: [source()],
    maturity: 'DEVELOPING', validity: 'SUPPORTED', implementation: 'NOT_STARTED', lifecycle: 'ACTIVE',
    authorityState: 'CANDIDATE', authorityRef: '', supersedes: [], supersededBy: '', createdAt: NOW, updatedAt: NOW,
    provenance: { producer: 'fixture' }, ...overrides,
  };
}
function fixtureService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w70-'));
  const captured = [];
  const evidenceService = { scan: () => ({ documents: [{ assetId: 'asset:source', fingerprint: 'fingerprint-source' }] }) };
  const service = new CognitionService({ rootProvider: () => root, evidenceService, eventService: { capture: event => captured.push(event) }, now: () => new Date(NOW), idFactory: (() => { let i = 0; return () => `identity:${++i}`; })() });
  return { root, captured, service };
}

describe('W70 file-first Cognition Protocol', () => {
  test('稳定 ID/schema/source health 与三条独立状态轴', () => {
    const row = cognition.normalizeCognitionItem(item());
    assert.match(row.cognitionId, /^cognition:[a-f0-9]{64}$/); assert.equal(row.schemaVersion, 'mazz.cognition/v0'); assert.equal(row.sourceHealth, 'HEALTHY');
    assert.equal(row.maturity, 'DEVELOPING'); assert.equal(row.validity, 'SUPPORTED'); assert.equal(row.implementation, 'NOT_STARTED');
    assert.equal(cognition.normalizeCognitionItem({ ...row, title: '改标题' }).cognitionId, row.cognitionId);
  });

  test('AI 可写 Candidate 但不能批准、替代或伪造 sourceHealth', () => {
    assert.throws(() => cognition.normalizeCognitionItem(item({ authorityState: 'HUMAN_APPROVED', authorityRef: 'agent:auto' })), /human:\*/);
    assert.throws(() => cognition.normalizeCognitionItem(item({ supersedes: ['cognition:old'] })), /Human Approved/);
    assert.throws(() => cognition.normalizeCognitionItem(item({ sourceHealth: 'MISSING' })), /必须由 sourceRefs 推导/);
    assert.throws(() => cognition.normalizeCognitionItem({ ...item(), apiToken: 'secret' }), /未冻结字段|禁止 secret/);
  });

  test('普通 Markdown roundtrip 保留正文，metadata 严格且可检查', () => {
    const row = cognition.normalizeCognitionItem(item()); const markdown = cognition.serializeCognitionMarkdown(row, '这仍然是**普通 Markdown**。');
    assert.match(markdown, /^<!-- mazz-cognition/); assert.match(markdown, /# 幻锚复活/); assert.match(markdown, /普通 Markdown/);
    const parsed = cognition.parseCognitionMarkdown(markdown); assert.equal(parsed.item.cognitionId, row.cognitionId); assert.equal(parsed.body, '这仍然是**普通 Markdown**。');
    assert.throws(() => cognition.parseCognitionMarkdown('<!-- mazz-cognition\n{bad}\n-->'), /metadata 损坏/);
  });

  test('StageSummary 只聚合已批准事实/决策并保留未决和候选，不授予 Authority', () => {
    const rows = [
      item({ identityKey: 'evidence', type: 'Evidence', authorityState: 'HUMAN_APPROVED', authorityRef: 'human:owner', validity: 'SUPPORTED' }),
      item({ identityKey: 'decision', type: 'Decision', authorityState: 'HUMAN_APPROVED', authorityRef: 'human:owner' }),
      item({ identityKey: 'question', type: 'Question', validity: 'DISPUTED' }),
      item({ identityKey: 'candidate', type: 'Method', authorityState: 'CANDIDATE' }),
    ];
    const summary = cognition.buildStageSummary(rows, { stageRef: 'wave:W70', generatedAt: NOW });
    assert.equal(summary.confirmedFacts.length, 1); assert.equal(summary.decisions.length, 1); assert.equal(summary.blockedQuestions.length, 1); assert.equal(summary.futureCandidates.length, 2); assert.equal(summary.authorityGrantedBySummary, false);
  });
});

describe('W70 Cognition Markdown Service / product slice', () => {
  test('创建、改名、重开保持身份；W81 只接语义事件', () => {
    const { root, captured, service } = fixtureService();
    try {
      const created = service.create({ title: 'Factory 方法', type: 'Method', body: '正文', sourceRefs: [source()], actorType: 'agent' });
      assert.equal(created.item.authorityState, 'CANDIDATE'); assert.equal(captured.length, 1); assert.equal(Object.hasOwn(captured[0], 'body'), false);
      const renamed = path.join(path.dirname(created.path), '改名后.md'); fs.renameSync(created.path, renamed);
      assert.equal(service.read(renamed).item.cognitionId, created.item.cognitionId);
      assert.equal(service.list().length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('批准和替代必须 human Authority；旧文件保留并显式指向新项', () => {
    const { root, service } = fixtureService();
    try {
      const old = service.create({ title: '旧策略', type: 'Decision', body: '旧', actorType: 'agent' });
      const next = service.create({ title: '新策略', type: 'Decision', body: '新', actorType: 'agent' });
      assert.throws(() => service.approve({ path: old.path, authorityRef: 'agent:auto', reason: 'x' }), /human:\*/);
      assert.equal(service.approve({ path: next.path, authorityRef: 'human:owner', reason: '人工复核' }).item.authorityState, 'HUMAN_APPROVED');
      const result = service.supersede({ priorPath: old.path, replacementPath: next.path, authorityRef: 'human:owner', reason: '正式替代' });
      assert.equal(result.prior.item.lifecycle, 'SUPERSEDED'); assert.equal(result.prior.item.supersededBy, result.replacement.item.cognitionId);
      assert.deepEqual(result.replacement.item.supersedes, [result.prior.item.cognitionId]); assert.equal(fs.existsSync(old.path), true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('损坏 Markdown 不阻断其他资产，列表显式暴露 invalid', () => {
    const { root, service } = fixtureService();
    try {
      service.create({ title: '正常', type: 'Concept', body: 'ok', actorType: 'human' });
      fs.writeFileSync(path.join(root, '认知资产', '损坏.md'), '<!-- mazz-cognition\n{bad}\n-->', 'utf8');
      const rows = service.list(); assert.equal(rows.length, 2); assert.equal(rows.filter(row => row.invalid).length, 1); assert.equal(rows.filter(row => row.item).length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('正式 Cognition 侧栏和白名单 IPC 已接线，不把 Mindmap/Factory 当真源', () => {
    const read = relative => fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
    const main = read('main/main.js'), preload = read('preload/bridge.js'), sidebar = read('renderer/shell/sidebar-panels.js');
    for (const channel of ['cognition:list', 'cognition:create', 'cognition:approve', 'cognition:supersede', 'cognition:summary']) { assert.match(main, new RegExp(channel)); assert.match(preload, new RegExp(channel)); }
    assert.match(sidebar, /普通 Markdown 是真源/); assert.match(sidebar, /AI 只能写候选/); assert.match(sidebar, /人工批准/);
    const service = read('main/cognition-service.js'); assert.doesNotMatch(service, /mindmap.*write|factory.*append/i);
  });
});
