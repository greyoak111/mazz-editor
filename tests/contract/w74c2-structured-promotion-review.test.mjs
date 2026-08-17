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
  PROMOTION_CATALOG_SCHEMA, PromotionLedger, STRUCTURED_PROMOTION_REVIEW_REQUEST_SCHEMA,
  normalizeStructuredPromotionReviewRequest, parseEventLog, promotionPaths,
} = promotionModule;
const { IngestionPipeline } = ingestionModule;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w74c2-'));
  return Promise.resolve().then(() => fn(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function reviewRequest(projectPath, overrides = {}) {
  return {
    schema: STRUCTURED_PROMOTION_REVIEW_REQUEST_SCHEMA,
    projectId: 'workspace:conversation-assets', projectPath,
    kind: 'decision', title: '证据链核对顺序',
    markdown: '# 证据链核对顺序\n\n先按时间戳对齐，再核对航标、潮位和值班簿。\n',
    sourceRef: {
      kind: 'ai-conversation-structured-candidate', adapterId: 'chatgpt', site: 'ChatGPT',
      url: 'https://chatgpt.com/c/abc', capturedAt: '2026-08-17T12:00:00.000Z',
      messageIds: ['M001', 'M002'], candidateKind: 'decision',
    },
    proposedBy: 'system:w62f-structured-draft', proposedAt: '2026-08-17T12:01:00.000Z',
    action: 'approve', authorityRef: 'human:interactive-local-user',
    reason: '用户在结构化候选审阅区明确批准入库', decidedAt: '2026-08-17T12:02:00.000Z', supersedes: [],
    ...overrides,
  };
}

describe('W74c-2 结构化候选严格合同', () => {
  test('四类类型可用；未知字段、asset、revoke、secret、正文偷渡和非 human 决定全部拒绝', () => withProject(root => {
    for (const kind of ['stage-summary', 'decision', 'method', 'finding']) {
      assert.equal(normalizeStructuredPromotionReviewRequest(reviewRequest(root, { kind })).kind, kind);
    }
    assert.throws(() => normalizeStructuredPromotionReviewRequest(reviewRequest(root, { rogue: true })), /未冻结字段/);
    assert.throws(() => normalizeStructuredPromotionReviewRequest(reviewRequest(root, { kind: 'asset' })), /非法结构化候选类型/);
    assert.throws(() => normalizeStructuredPromotionReviewRequest(reviewRequest(root, { action: 'revoke' })), /approve\/reject/);
    assert.throws(() => normalizeStructuredPromotionReviewRequest(reviewRequest(root, { authorityRef: 'system:auto' })), /human:\*/);
    assert.throws(() => normalizeStructuredPromotionReviewRequest(reviewRequest(root, { sourceRef: { body: '正文偷渡' } })), /不得夹带正文/);
    assert.throws(() => normalizeStructuredPromotionReviewRequest(reviewRequest(root, { sourceRef: { apiKey: 'secret' } })), /禁止 secret/);
  }));

  test('批准与驳回都登记 W74a 证据，但只有批准为 active，Promotion 账不含正文', async () => withProject(async root => {
    const ledger = new PromotionLedger();
    const ingestion = new IngestionPipeline();
    const approved = await ledger.reviewStructuredConversationCandidate(reviewRequest(root), ingestion);
    const rejected = await ledger.reviewStructuredConversationCandidate(reviewRequest(root, {
      kind: 'finding', title: '航标记录存在时间差',
      markdown: '# 航标记录存在时间差\n\n该表述证据不足，人工驳回。\n',
      sourceRef: { ...reviewRequest(root).sourceRef, candidateKind: 'finding', messageIds: ['M003'] },
      action: 'reject', reason: '用户在结构化候选审阅区明确驳回候选',
    }), ingestion);
    assert.equal(approved.ok, true);
    assert.equal(rejected.ok, true);
    const catalog = JSON.parse(fs.readFileSync(promotionPaths(root).catalog, 'utf8'));
    assert.equal(catalog.schema, PROMOTION_CATALOG_SCHEMA);
    assert.equal(catalog.entryCount, 2);
    assert.equal(catalog.entries.find(row => row.candidate.kind === 'decision').status, 'active');
    assert.equal(catalog.entries.find(row => row.candidate.kind === 'finding').status, 'rejected');
    const materials = JSON.parse(fs.readFileSync(path.join(root, '.mazz', 'materials', 'catalog.json'), 'utf8'));
    assert.equal(materials.entryCount, 2);
    const promotionText = fs.readFileSync(promotionPaths(root).events, 'utf8') + fs.readFileSync(promotionPaths(root).catalog, 'utf8');
    assert.doesNotMatch(promotionText, /先按时间戳对齐|该表述证据不足/);
    assert.ok(parseEventLog(fs.readFileSync(promotionPaths(root).events, 'utf8')).events
      .every(event => event.automaticPromotion === false && event.publicationGranted === false));
  }));

  test('同候选同决定重试幂等，时间重试不复制材料或事件', async () => withProject(async root => {
    const ledger = new PromotionLedger();
    const ingestion = new IngestionPipeline();
    const first = await ledger.reviewStructuredConversationCandidate(reviewRequest(root), ingestion);
    const second = await ledger.reviewStructuredConversationCandidate(reviewRequest(root, {
      decidedAt: '2026-08-17T15:00:00.000Z',
    }), ingestion);
    assert.equal(first.code, 'APPLIED');
    assert.equal(second.code, 'ALREADY_APPLIED');
    assert.equal(first.assetId, second.assetId);
    assert.equal(parseEventLog(fs.readFileSync(promotionPaths(root).events, 'utf8')).events.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.mazz', 'materials', 'catalog.json'), 'utf8')).entryCount, 1);
  }));
});

describe('W74c-2 W62f 人工审阅接线', () => {
  test('runtime 只提交冻结选择、结构化正文、system 草稿与 human 决定', async () => {
    const calls = [];
    window.mazz = { invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'workspace:get') return 'D:/workspace';
      if (channel === 'promotion:reviewConversationCandidate') return { ok: true, assetId: 'asset:decision:1', promotionId: 'promotion:decision:1' };
      throw new Error(`unexpected ${channel}`);
    } };
    const runtime = createHarvestRuntime({});
    const result = await runtime.reviewPromotionCandidate({
      meta: { adapterId: 'chatgpt', site: 'ChatGPT', topic: '证据链', url: 'https://chatgpt.com/c/abc', capturedAt: '2026-08-17T12:00:00.000Z' },
      messages: [{ id: 'M002', role: 'assistant', roleLabel: 'AI', text: '只使用冻结选择。' }],
      review: { kind: 'decision', title: '核对顺序', statement: '先对齐时间戳。', action: 'approve', proposedAt: '2026-08-17T12:01:00.000Z' },
    });
    const call = calls.find(row => row.channel === 'promotion:reviewConversationCandidate');
    assert.equal(result.action, 'approve');
    assert.equal(call.payload.kind, 'decision');
    assert.equal(call.payload.authorityRef, 'human:interactive-local-user');
    assert.equal(call.payload.proposedBy, 'system:w62f-structured-draft');
    assert.deepEqual(call.payload.sourceRef.messageIds, ['M002']);
    assert.match(call.payload.markdown, /审阅正文[\s\S]*先对齐时间戳/);
    assert.match(call.payload.markdown, /来源对话证据[\s\S]*只使用冻结选择/);
  });

  test('现有面板提供四类可编辑候选及批准/驳回；没有自动批准或公共投影', () => {
    const panel = fs.readFileSync(path.join(repoRoot, 'renderer', 'panels', 'harvest.html'), 'utf8');
    const runtime = fs.readFileSync(path.join(repoRoot, 'renderer', 'modules', 'browser', 'harvest-runtime.js'), 'utf8');
    const browser = fs.readFileSync(path.join(repoRoot, 'renderer', 'modules', 'browser', 'index.js'), 'utf8');
    const main = fs.readFileSync(path.join(repoRoot, 'main', 'main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(repoRoot, 'preload', 'bridge.js'), 'utf8');
    for (const token of ['stage-summary', 'decision', 'method', 'finding']) assert.match(panel, new RegExp(token));
    assert.match(panel, /id="candidate-statement"/);
    assert.match(panel, /id="candidate-approve">批准入库/);
    assert.match(panel, /id="candidate-reject">驳回候选/);
    assert.match(runtime + browser + main + preload, /promotion:reviewConversationCandidate/);
    assert.match(browser, /harvest\(\?:Export\|Style\|Mindmap\|Promote\|ReviewPromotion\)/);
    assert.match(browser, /preserveSelection:\s*pl\.type\s*===\s*'harvestReviewPromotion'/);
    assert.match(panel, /payload\.preserveSelection/);
    assert.doesNotMatch(runtime + browser, /autoApprove|publishToHub|publicationGranted\s*:\s*true|Canon/);
  });
});
