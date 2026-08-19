import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  FACTORY_LIVE_REF_MIME,
  classifyInstructionMailbox,
  createArtifactLiveReference,
  createArtifactRevision,
  createFactoryFeedEnvelope,
  createMobileApprovalRequest,
  decideMobileApproval,
  makeBibleConflictCard,
  normalizeFactoryUsageRecord,
  reconcileLockedBible,
  reconcileMonthlyUsage,
} from '../../renderer/modules/factory/bridge-runtime.js';

test('工件双态生成可读 diff，已入库工件修改强制回到重审且不自动执行', () => {
  const revision = createArtifactRevision({ taskId: 'task:one', path: 'D:/work/正文.md', before: '# A\nold\n', after: '# A\nnew\n', reviewStatus: 'sealed', at: '2026-08-19T01:00:00Z' });
  assert.equal(revision.changed, true);
  assert.equal(revision.nextReviewStatus, 'RE_REVIEW_REQUIRED');
  assert.equal(revision.executionStarted, false);
  assert.match(revision.diff, /- old[\s\S]*\+ new/);
  assert.notEqual(revision.beforeHash, revision.afterHash);
});

test('设定集三方核对不覆盖并发手改，冲突必须由人二选一', () => {
  const conflict = reconcileLockedBible({ base: '# 圣经\n旧', human: '# 圣经\n人工', aiProposal: '# 圣经\nAI' });
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.merged, null);
  assert.deepEqual(conflict.choices, ['keep-human', 'accept-ai']);
  const card = makeBibleConflictCard({ targetPath: 'D:/project/圣经.md', base: '# 圣经\n旧', human: '# 圣经\n人工', aiProposal: '# 圣经\nAI', instruction: '统一口径' });
  assert.equal(card.kind, 'bible-conflict');
  assert.equal(card.reconciliation.requiresHumanDecision, true);
  assert.equal(reconcileLockedBible({ base: 'a', human: 'a', aiProposal: 'b' }).status, 'ai-only');
});

test('异步指令邮箱 L0-L3 保持分类与执行权限分离', () => {
  assert.equal(classifyInstructionMailbox('你好').level, 'L0');
  assert.equal(classifyInstructionMailbox('第三章').level, 'L1');
  assert.equal(classifyInstructionMailbox('以后术语一律统一').level, 'L2');
  const production = classifyInstructionMailbox('继续写第三章');
  assert.equal(production.level, 'L3');
  assert.equal(production.automaticExecution, false);
  assert.equal(production.requiresExplicitDispatch, true);
});

test('随处投喂只生成派生材料信封，永不暗启 Factory', () => {
  const row = createFactoryFeedEnvelope({ assetPath: 'D:/work/证据.md', at: '2026-08-19T02:00:00Z' });
  assert.equal(row.queueState, 'material-only');
  assert.equal(row.automaticStart, false);
  assert.equal(row.executionAuthorized, false);
  assert.match(row.assetId, /^asset:factory-feed:/);
});

test('车间卡生成 W63 可解析的块级活引用，不复制工件', () => {
  const ref = createArtifactLiveReference({ artifactPath: 'D:/project/工件/正文.md', eventId: 'fe:12' });
  assert.equal(ref.mime, FACTORY_LIVE_REF_MIME);
  assert.equal(ref.copiedAsset, false);
  assert.match(ref.syntax, /^\{\{ref:D:\/project\/工件\/正文\.md!\^factory-event-/);
});

test('usage 实收、估算、结算、unknown 分栏对账，缺配额明确灰显', () => {
  const rows = [
    { kind: 'estimate', taskRef: 't', totalTokens: 100, observedAt: '2026-08-02T00:00:00Z' },
    { kind: 'provider-reported', taskRef: 't', inputTokens: 80, outputTokens: 40, sourceRef: 'provider-response:req1', observedAt: '2026-08-03T00:00:00Z' },
    { kind: 'settled-actual', taskRef: 't', amount: 2.5, currency: 'USD', sourceRef: 'invoice:aug', observedAt: '2026-08-04T00:00:00Z' },
    { kind: 'unknown', taskRef: 't', reason: '供应商未返回 usage', observedAt: '2026-08-05T00:00:00Z' },
  ].map(normalizeFactoryUsageRecord);
  const gray = reconcileMonthlyUsage(rows, { month: '2026-08' });
  assert.equal(gray.tokensByKind['provider-reported'], 120);
  assert.equal(gray.amountsByKind['settled-actual'].USD, 2.5);
  assert.equal(gray.estimatedVarianceTokens, 20);
  assert.equal(gray.unknownCount, 1);
  assert.equal(gray.quota.state, 'gray');
  assert.equal(reconcileMonthlyUsage(rows, { month: '2026-08', quotaTokens: 100 }).quota.state, 'blocked');
  assert.throws(() => normalizeFactoryUsageRecord({ kind: 'provider-reported', totalTokens: 1 }), /sourceRef/);
});

test('手机审批本地包校验对象、时效、Authority 与重放，客户端保持条件门', () => {
  const request = createMobileApprovalRequest({ taskId: 'task:one', gateId: 'gate:final', artifactRefs: ['a.md'], at: '2026-08-19T00:00:00Z', expiresAt: '2026-08-20T00:00:00Z' });
  assert.equal(request.fieldClientAvailable, false);
  assert.equal(request.clientGate, 'CONDITIONAL_MOBILE_CLIENT');
  const decision = decideMobileApproval(request, { decision: 'approve', authorityRef: 'human:owner', payloadDigest: request.payloadDigest, decidedAt: '2026-08-19T03:00:00Z' });
  assert.equal(decision.executionAuthorized, true);
  assert.throws(() => decideMobileApproval(request, { decision: 'approve', authorityRef: 'agent:x', payloadDigest: request.payloadDigest, decidedAt: '2026-08-19T03:00:00Z' }), /human Authority/);
  assert.throws(() => decideMobileApproval(request, { decision: 'approve', authorityRef: 'human:x', payloadDigest: 'changed', decidedAt: '2026-08-19T03:00:00Z' }), /对象已变化/);
  assert.throws(() => decideMobileApproval(request, { decision: 'approve', authorityRef: 'human:x', payloadDigest: request.payloadDigest, decidedAt: '2026-08-21T03:00:00Z' }), /过期/);
  assert.throws(() => decideMobileApproval(request, { decision: 'approve', authorityRef: 'human:x', payloadDigest: request.payloadDigest, decidedAt: '2026-08-19T03:00:00Z', seenRequestIds: [request.requestId] }), /重放/);
});

test('正式 UI 装配投喂入口、重审台账、看板钻取、拖拽活引用和手机条件包', () => {
  const shell = fs.readFileSync(path.resolve('renderer/shell/shell.js'), 'utf8');
  const index = fs.readFileSync(path.resolve('renderer/modules/factory/index.js'), 'utf8');
  const desk = fs.readFileSync(path.resolve('renderer/modules/factory/desk.js'), 'utf8');
  const markdown = fs.readFileSync(path.resolve('renderer/modules/markdown/index.js'), 'utf8');
  assert.match(shell, /factory\.feedActiveAsset/);
  assert.match(index, /createArtifactRevision/);
  assert.match(index, /工件修订台账\.ndjson/);
  assert.match(desk, /data-drill-path/);
  assert.match(desk, /bible-conflict/);
  assert.match(desk, /CONDITIONAL_MOBILE_CLIENT|createMobileApprovalRequest/);
  assert.match(markdown, /application\/x-mazz-live-reference/);
});
