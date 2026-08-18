import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import promotionModule from '../../main/promotion-ledger.js';
import ingestionModule from '../../main/ingestion-pipeline.js';
import { createHarvestRuntime } from '../../renderer/modules/browser/harvest-runtime.js';

const {
  EVIDENCE_PROJECTION_CATALOG_SCHEMA,
  EVIDENCE_PROJECTION_REQUEST_SCHEMA,
  PROMOTION_MANAGEMENT_QUERY_SCHEMA,
  PROMOTION_REVOKE_REQUEST_SCHEMA,
  PUBLIC_EVIDENCE_PROJECTION_SCHEMA,
  PromotionLedger,
  parseProjectionEventLog,
  projectionPaths,
} = promotionModule;
const { IngestionPipeline } = ingestionModule;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w74c3-'));
  return Promise.resolve().then(() => fn(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function reviewRequest(projectPath, suffix, overrides = {}) {
  const kind = overrides.kind || 'decision';
  return {
    schema: 'mazz.structured-promotion-review-request/v0',
    projectId: 'workspace:conversation-assets', projectPath, kind,
    title: `证据链核对顺序 ${suffix}`,
    markdown: `# 证据链核对顺序 ${suffix}\n\n先对齐时间戳，再核对证据 ${suffix}。\n`,
    sourceRef: {
      kind: 'ai-conversation-structured-candidate', adapterId: 'chatgpt', site: 'ChatGPT',
      url: `https://chatgpt.com/c/${suffix}`, capturedAt: '2026-08-18T01:00:00.000Z',
      messageIds: [`M-${suffix}`], candidateKind: kind,
    },
    proposedBy: 'system:w62f-structured-draft', proposedAt: '2026-08-18T01:01:00.000Z',
    action: 'approve', authorityRef: 'human:interactive-local-user',
    reason: '用户明确批准本次结构化候选', decidedAt: '2026-08-18T01:02:00.000Z',
    supersedes: [], ...overrides,
  };
}

function managementQuery(projectPath) {
  return {
    schema: PROMOTION_MANAGEMENT_QUERY_SCHEMA,
    projectId: 'workspace:conversation-assets', projectPath,
  };
}

function projectionRequest(projectPath, promotionId, action, overrides = {}) {
  return {
    schema: EVIDENCE_PROJECTION_REQUEST_SCHEMA,
    projectId: 'workspace:conversation-assets', projectPath, action, promotionId,
    authorityRef: 'human:interactive-local-user',
    reason: action === 'project' ? '人工确认生成安全证据投影' : '人工确认撤回证据投影',
    decidedAt: action === 'project' ? '2026-08-18T02:00:00.000Z' : '2026-08-18T03:00:00.000Z',
    ...overrides,
  };
}

describe('W74c-3 Promotion 管理与替代状态机', () => {
  test('管理查询可见全状态；同类批准可替代，跨类替代 fail closed，active 可人工撤销', async () => withProject(async root => {
    const ledger = new PromotionLedger();
    const ingestion = new IngestionPipeline();
    const first = await ledger.reviewStructuredConversationCandidate(reviewRequest(root, 'A'), ingestion);
    const cross = await ledger.reviewStructuredConversationCandidate(reviewRequest(root, 'B', {
      kind: 'finding', sourceRef: { ...reviewRequest(root, 'B').sourceRef, candidateKind: 'finding' },
      supersedes: [first.promotionId],
    }), ingestion);
    assert.equal(cross.ok, false);
    assert.match(cross.promotion.message, /类型不一致/);

    const second = await ledger.reviewStructuredConversationCandidate(reviewRequest(root, 'C', {
      supersedes: [first.promotionId],
    }), ingestion);
    assert.equal(second.ok, true);
    let management = await ledger.listManagement(managementQuery(root));
    assert.equal(management.promotions.entries.find(row => row.promotionId === first.promotionId).status, 'superseded');
    assert.equal(management.promotions.entries.find(row => row.promotionId === second.promotionId).status, 'active');
    assert.deepEqual(management.boundaries, {
      automaticPromotion: false, publicationGranted: false,
      publicProjectionContainsBody: false, independentPublicationGateRequired: true,
    });

    const revoked = await ledger.revokePromotion({
      schema: PROMOTION_REVOKE_REQUEST_SCHEMA,
      projectId: 'workspace:conversation-assets', projectPath: root,
      promotionId: second.promotionId, authorityRef: 'human:interactive-local-user',
      reason: '人工确认该决策已经失效', decidedAt: '2026-08-18T04:00:00.000Z',
    });
    assert.equal(revoked.ok, true);
    management = await ledger.listManagement(managementQuery(root));
    assert.equal(management.promotions.entries.find(row => row.promotionId === second.promotionId).status, 'revoked');
  }));

  test('非 human 撤销、未知字段和对 inactive 的重复撤销均不得改状态', async () => withProject(async root => {
    const ledger = new PromotionLedger();
    const ingestion = new IngestionPipeline();
    const row = await ledger.reviewStructuredConversationCandidate(reviewRequest(root, 'D'), ingestion);
    assert.throws(() => ledger.revokePromotion({
      schema: PROMOTION_REVOKE_REQUEST_SCHEMA, projectId: 'workspace:conversation-assets', projectPath: root,
      promotionId: row.promotionId, authorityRef: 'system:auto', reason: '自动撤销', decidedAt: '2026-08-18T04:00:00.000Z',
    }), /human:\*/);
    assert.throws(() => ledger.listManagement({ ...managementQuery(root), rogue: true }), /未冻结字段/);
    const request = {
      schema: PROMOTION_REVOKE_REQUEST_SCHEMA, projectId: 'workspace:conversation-assets', projectPath: root,
      promotionId: row.promotionId, authorityRef: 'human:interactive-local-user', reason: '人工确认撤销', decidedAt: '2026-08-18T04:00:00.000Z',
    };
    assert.equal((await ledger.revokePromotion(request)).ok, true);
    const retry = await ledger.revokePromotion({ ...request, decidedAt: '2026-08-18T04:00:30.000Z' });
    assert.equal(retry.code, 'ALREADY_APPLIED');
    const repeated = await ledger.revokePromotion({ ...request, reason: '再次尝试撤销', decidedAt: '2026-08-18T04:01:00.000Z' });
    assert.equal(repeated.ok, false);
    assert.equal(repeated.code, 'PROMOTION_COMMAND_CONFLICT');
  }));
});

describe('W74c-3 公共证据投影边界', () => {
  test('显式投影只输出公开安全字段，绝不携带正文、路径、URL、消息 ID 或发布授权', async () => withProject(async root => {
    const ledger = new PromotionLedger();
    const ingestion = new IngestionPipeline();
    const promoted = await ledger.reviewStructuredConversationCandidate(reviewRequest(root, 'E'), ingestion);
    const projected = await ledger.manageEvidenceProjection(projectionRequest(root, promoted.promotionId, 'project'));
    assert.equal(projected.ok, true);
    const retried = await ledger.manageEvidenceProjection(projectionRequest(root, promoted.promotionId, 'project', { decidedAt: '2026-08-18T02:00:30.000Z' }));
    assert.equal(retried.code, 'ALREADY_APPLIED');
    assert.equal(parseProjectionEventLog(fs.readFileSync(projectionPaths(root).events, 'utf8')).events.length, 1);
    const artifact = JSON.parse(fs.readFileSync(projected.artifactPath, 'utf8'));
    assert.equal(artifact.schema, PUBLIC_EVIDENCE_PROJECTION_SCHEMA);
    assert.equal(artifact.sourcePromotionId, promoted.promotionId);
    assert.equal(artifact.boundaries.contentIncluded, false);
    assert.equal(artifact.boundaries.localPathIncluded, false);
    assert.equal(artifact.boundaries.sourceUrlIncluded, false);
    assert.equal(artifact.boundaries.messageIdsIncluded, false);
    assert.equal(artifact.boundaries.publicationGranted, false);
    assert.equal(artifact.boundaries.published, false);
    const artifactText = JSON.stringify(artifact);
    assert.doesNotMatch(artifactText, /先对齐时间戳|chatgpt\.com|M-E|mazz-w74c3|interactive-local-user/);
    assert.equal(Object.hasOwn(artifact.assetRef, 'path'), false);

    const management = await ledger.listManagement(managementQuery(root));
    assert.equal(management.projections.schema, EVIDENCE_PROJECTION_CATALOG_SCHEMA);
    assert.equal(management.projections.entries[0].status, 'active');
    assert.equal(management.projections.publicationGranted, false);
  }));

  test('投影可人工撤回；坏尾隔离后仍可恢复，历史 artifact 保留但目录状态为 withdrawn', async () => withProject(async root => {
    const ledger = new PromotionLedger();
    const ingestion = new IngestionPipeline();
    const promoted = await ledger.reviewStructuredConversationCandidate(reviewRequest(root, 'F'), ingestion);
    const projected = await ledger.manageEvidenceProjection(projectionRequest(root, promoted.promotionId, 'project'));
    fs.appendFileSync(projectionPaths(root).events, '{broken-tail\n', 'utf8');
    const withdrawn = await ledger.manageEvidenceProjection(projectionRequest(root, promoted.promotionId, 'withdraw'));
    assert.equal(withdrawn.ok, true);
    assert.ok(withdrawn.recoveryPath && fs.existsSync(withdrawn.recoveryPath));
    assert.ok(fs.existsSync(projected.artifactPath), '撤回只改变 append-only 状态，不销毁历史安全投影');
    const events = parseProjectionEventLog(fs.readFileSync(projectionPaths(root).events, 'utf8')).events;
    assert.equal(events.length, 2);
    assert.ok(events.every(event => event.automaticPublication === false && event.publicationGranted === false));
    const management = await ledger.listManagement(managementQuery(root));
    assert.equal(management.projections.entries[0].status, 'withdrawn');
  }));

  test('inactive Promotion、非 human 决定、secret 与非法投影 ID 均 fail closed', async () => withProject(async root => {
    const ledger = new PromotionLedger();
    const ingestion = new IngestionPipeline();
    const promoted = await ledger.reviewStructuredConversationCandidate(reviewRequest(root, 'G'), ingestion);
    assert.throws(() => ledger.manageEvidenceProjection(projectionRequest(root, promoted.promotionId, 'project', { authorityRef: 'system:auto' })), /human:\*/);
    assert.throws(() => ledger.manageEvidenceProjection(projectionRequest(root, promoted.promotionId, 'project', { apiKey: 'secret' })), /未冻结字段|禁止 secret/);
    assert.throws(() => ledger.manageEvidenceProjection(projectionRequest(root, promoted.promotionId, 'project', { projectionId: 'projection:forged' })), /确定性派生/);
    await ledger.revokePromotion({
      schema: PROMOTION_REVOKE_REQUEST_SCHEMA, projectId: 'workspace:conversation-assets', projectPath: root,
      promotionId: promoted.promotionId, authorityRef: 'human:interactive-local-user', reason: '人工确认撤销', decidedAt: '2026-08-18T04:00:00.000Z',
    });
    const blocked = await ledger.manageEvidenceProjection(projectionRequest(root, promoted.promotionId, 'project'));
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'PROJECTION_STATE_CONFLICT');
  }));
});

describe('W74c-3 既有 AI 对话整理面板接线', () => {
  test('runtime 只经显式 human 动作查询、撤销、投影与撤回，并把同类替代目标送入批准请求', async () => {
    const calls = [];
    window.mazz = { invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'workspace:get') return 'D:/workspace';
      if (channel === 'promotion:listManagement') return { ok: true, promotions: { entries: [] }, projections: { entries: [] } };
      if (channel === 'promotion:revoke') return { ok: true };
      if (channel === 'promotion:manageEvidenceProjection') return { ok: true };
      if (channel === 'promotion:reviewConversationCandidate') return { ok: true, promotion: { ok: true } };
      throw new Error(`unexpected ${channel}`);
    } };
    const runtime = createHarvestRuntime({});
    await runtime.promotionManagement();
    await runtime.revokePromotion({ promotionId: 'promotion:decision:old', reason: '人工确认撤销' });
    await runtime.manageEvidenceProjection({ action: 'project', promotionId: 'promotion:decision:old', reason: '人工生成投影' });
    await runtime.manageEvidenceProjection({ action: 'withdraw', promotionId: 'promotion:decision:old', reason: '人工撤回投影' });
    await runtime.reviewPromotionCandidate({
      meta: { adapterId: 'chatgpt', site: 'ChatGPT', topic: '证据链', url: 'https://chatgpt.com/c/abc', capturedAt: '2026-08-18T01:00:00.000Z' },
      messages: [{ id: 'M001', role: 'assistant', roleLabel: 'AI', text: '冻结证据。' }],
      review: { kind: 'decision', title: '新决策', statement: '替代旧决策。', action: 'approve', proposedAt: '2026-08-18T01:01:00.000Z', supersedes: ['promotion:decision:old'] },
    });
    assert.deepEqual(calls.filter(row => row.channel.startsWith('promotion:')).map(row => row.channel), [
      'promotion:listManagement', 'promotion:revoke', 'promotion:manageEvidenceProjection',
      'promotion:manageEvidenceProjection', 'promotion:reviewConversationCandidate',
    ]);
    assert.ok(calls.filter(row => /revoke|manageEvidenceProjection/.test(row.channel)).every(row => row.payload.authorityRef === 'human:interactive-local-user'));
    assert.deepEqual(calls.at(-1).payload.supersedes, ['promotion:decision:old']);
    await assert.rejects(() => runtime.revokePromotion({ promotionId: 'promotion:x', reason: '短' }), /至少 4 个字/);
  });

  test('同一面板具备管理、撤销、同类替代、投影/撤回与“不等于发布”说明，main/preload 只暴露三条窄 IPC', () => {
    const panel = fs.readFileSync(path.join(repoRoot, 'renderer', 'panels', 'harvest.html'), 'utf8');
    const runtime = fs.readFileSync(path.join(repoRoot, 'renderer', 'modules', 'browser', 'harvest-runtime.js'), 'utf8');
    const browser = fs.readFileSync(path.join(repoRoot, 'renderer', 'modules', 'browser', 'index.js'), 'utf8');
    const main = fs.readFileSync(path.join(repoRoot, 'main', 'main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(repoRoot, 'preload', 'bridge.js'), 'utf8');
    for (const id of ['promotion-manager', 'promotion-revoke', 'promotion-supersede', 'promotion-project', 'projection-withdraw']) {
      assert.match(panel, new RegExp(`id="${id}"`));
    }
    assert.match(panel, /不会把内容发布到 Hub 或公开网络/);
    assert.match(panel, /不含正文、本地路径、来源网址或消息 ID/);
    for (const channel of ['promotion:listManagement', 'promotion:revoke', 'promotion:manageEvidenceProjection']) {
      assert.match(runtime + main + preload, new RegExp(channel));
    }
    assert.match(browser, /harvest\(\?:PromotionList\|PromotionRevoke\|PromotionProject\|ProjectionWithdraw\)/);
    assert.doesNotMatch(runtime + browser, /publicationGranted\s*:\s*true|publishToHub|automaticPublication\s*:\s*true/);
  });
});
