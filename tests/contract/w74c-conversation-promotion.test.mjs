import './_setup.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, assert } from '../harness.mjs';
import { createHarvestRuntime } from '../../renderer/modules/browser/harvest-runtime.js';

const require = createRequire(import.meta.url);
const { IngestionPipeline } = require('../../main/ingestion-pipeline.js');
const {
  CONVERSATION_PROMOTION_REQUEST_SCHEMA,
  PROMOTION_CATALOG_SCHEMA,
  PROMOTION_COMMAND_SCHEMA,
  PROMOTION_EVENT_SCHEMA,
  PromotionLedger,
  normalizeCommand,
  normalizeConversationPromotionRequest,
  parseEventLog,
  promotionPaths,
} = require('../../main/promotion-ledger.js');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w74c-'));
  return Promise.resolve().then(() => fn(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function conversationRequest(projectPath, overrides = {}) {
  return {
    schema: CONVERSATION_PROMOTION_REQUEST_SCHEMA,
    projectId: 'workspace:conversation-assets',
    projectPath,
    title: 'AI 对话：北向洋流',
    markdown: '# AI 对话：北向洋流\n\n## 用户\n证据链是什么？\n\n## AI\n航标、潮位与值班簿。\n',
    sourceRef: { kind: 'ai-conversation', adapterId: 'chatgpt', site: 'ChatGPT', url: 'https://chatgpt.com/c/abc', capturedAt: '2026-08-17T12:00:00.000Z', messageIds: ['M001', 'M002'] },
    capturedAt: '2026-08-17T12:00:00.000Z',
    authorityRef: 'human:interactive-local-user',
    reason: '用户明确选择升格为本地资产',
    decidedAt: '2026-08-17T12:01:00.000Z',
    ...overrides,
  };
}

async function ingestAsset(root, id, text = `正文 ${id}`) {
  const ingestion = new IngestionPipeline();
  return ingestion.register({
    schema: 'mazz.ingestion-request/v0', assetId: id, projectId: 'project:w74c', projectPath: root,
    title: `${id}.md`, mediaType: 'text/markdown; charset=utf-8', layer: 'derived', text,
    sourceRef: { kind: 'fixture', id }, provenance: { kind: 'derived', source: 'w74c-test', protocol: 'W74c-1' },
    importedAt: '2026-08-17T12:00:00.000Z',
  });
}

function command(root, asset, promotionId, overrides = {}) {
  return {
    schema: PROMOTION_COMMAND_SCHEMA,
    commandId: `command:${promotionId}:approve`, promotionId,
    projectId: 'project:w74c', projectPath: root, action: 'approve',
    candidate: {
      candidateId: `candidate:${promotionId}`, kind: 'asset',
      assetRef: { id: asset.manifest.assetId, path: asset.paths.envelope, type: asset.manifest.mediaType, version: asset.manifest.version },
      sourceRef: { kind: 'fixture', id: asset.manifest.assetId }, proposedBy: 'system:test', proposedAt: '2026-08-17T12:00:00.000Z',
    },
    authorityRef: 'human:test-owner', reason: '人工核准', decidedAt: '2026-08-17T12:01:00.000Z', supersedes: [],
    ...overrides,
  };
}

describe('W74c-1 严格本地 Promotion 契约', () => {
  test('未知字段、secret、非 human Authority、正文偷渡和非法动作全部 fail closed', () => withProject(root => {
    const normalized = normalizeConversationPromotionRequest(conversationRequest(root));
    assert.equal(normalized.schema, CONVERSATION_PROMOTION_REQUEST_SCHEMA);
    assert.throws(() => normalizeConversationPromotionRequest(conversationRequest(root, { rogue: true })), /未冻结字段/);
    assert.throws(() => normalizeConversationPromotionRequest(conversationRequest(root, { sourceRef: { apiKey: 'leak' } })), /禁止 secret/);
    assert.throws(() => normalizeConversationPromotionRequest(conversationRequest(root, { sourceRef: { kind: 'ai-conversation', body: '偷塞正文' } })), /不得夹带正文/);
    assert.throws(() => normalizeConversationPromotionRequest(conversationRequest(root, { authorityRef: 'system:auto' })), /human:\*/);
    const fakeAsset = { manifest: { assetId: 'asset:a', mediaType: 'text/plain', version: 'v1' }, paths: { envelope: path.join(root, 'a.json') } };
    assert.throws(() => normalizeCommand(command(root, fakeAsset, 'promotion:a', { candidate: { ...command(root, fakeAsset, 'promotion:a').candidate, body: '不得进入账本' } })), /未冻结字段/);
    assert.throws(() => normalizeCommand(command(root, fakeAsset, 'promotion:a', { action: 'publish' })), /非法 Promotion action/);
  }));

  test('长对话正文、标题和人工理由完整进入升格请求', () => withProject(root => {
    const marker = '对话正文尾部不可丢';
    const markdown = `${'# 对话\n\n'}${'正文'.repeat(250_100)}${marker}`;
    const title = `${'长标题'.repeat(180)}标题尾部`;
    const reason = `${'人工理由'.repeat(350)}理由尾部`;
    const normalized = normalizeConversationPromotionRequest(conversationRequest(root, { markdown, title, reason }));
    assert.equal(normalized.markdown, markdown);
    assert.equal(normalized.title, title);
    assert.equal(normalized.reason, reason);
  }));

  test('supersedes/revoke 状态机要求 active 前态，批准不授予 Publication', async () => withProject(async root => {
    const ledger = new PromotionLedger();
    const a = await ingestAsset(root, 'asset:test:a');
    const b = await ingestAsset(root, 'asset:test:b');
    const c = await ingestAsset(root, 'asset:test:c');
    const first = await ledger.apply(command(root, a, 'promotion:test:a'));
    const second = await ledger.apply(command(root, b, 'promotion:test:b', { supersedes: ['promotion:test:a'] }));
    const revoked = await ledger.apply({
      schema: PROMOTION_COMMAND_SCHEMA, commandId: 'command:promotion:test:b:revoke', promotionId: 'promotion:test:b',
      projectId: 'project:w74c', projectPath: root, action: 'revoke', candidate: null,
      authorityRef: 'human:test-owner', reason: '人工撤销', decidedAt: '2026-08-17T12:03:00.000Z', supersedes: [],
    });
    assert.equal(first.ok, true);
    assert.equal(second.catalog.entries.find(row => row.promotionId === 'promotion:test:a').status, 'superseded');
    assert.equal(second.catalog.entries.find(row => row.promotionId === 'promotion:test:a').supersededBy, 'promotion:test:b');
    assert.equal(revoked.catalog.entries.find(row => row.promotionId === 'promotion:test:b').status, 'revoked');
    assert.ok([first.event, second.event, revoked.event].every(event => event.publicationGranted === false && event.automaticPromotion === false));
    const rejected = await ledger.apply(command(root, c, 'promotion:test:rejected', { action: 'reject', commandId: 'command:promotion:test:rejected' }));
    assert.equal(rejected.catalog.entries.find(row => row.promotionId === 'promotion:test:rejected').status, 'rejected');
    const bad = await ledger.apply({ ...command(root, a, 'promotion:test:c'), supersedes: ['promotion:test:a'] });
    assert.equal(bad.code, 'PROMOTION_STATE_CONFLICT');
  }));
});

describe('W74c-1 对话 → W74a Asset → 显式 Promotion', () => {
  test('一次明确动作生成本地材料和 Promotion；二次调用幂等且账本/目录不含正文', async () => withProject(async root => {
    const ingestion = new IngestionPipeline();
    const ledger = new PromotionLedger();
    const first = await ledger.promoteConversation(conversationRequest(root), ingestion);
    const second = await ledger.promoteConversation(conversationRequest(root, { decidedAt: '2026-08-17T13:00:00.000Z' }), ingestion);
    assert.equal(first.ok, true);
    assert.equal(first.code, 'APPLIED');
    assert.equal(second.code, 'ALREADY_APPLIED');
    assert.equal(first.assetId, second.assetId);
    assert.equal(fs.readFileSync(first.ingestion.paths.content, 'utf8'), conversationRequest(root).markdown);
    const paths = promotionPaths(root);
    const parsed = parseEventLog(fs.readFileSync(paths.events, 'utf8'));
    assert.equal(parsed.events.length, 1);
    assert.equal(parsed.events[0].schema, PROMOTION_EVENT_SCHEMA);
    const catalog = JSON.parse(fs.readFileSync(paths.catalog, 'utf8'));
    assert.equal(catalog.schema, PROMOTION_CATALOG_SCHEMA);
    assert.equal(catalog.entries[0].status, 'active');
    assert.doesNotMatch(fs.readFileSync(paths.events, 'utf8') + fs.readFileSync(paths.catalog, 'utf8'), /航标、潮位与值班簿/);
    assert.equal(ledger.healthSnapshot().activeProjects, 0);
    assert.equal(ingestion.healthSnapshot().activeProjects, 0);
  }));

  test('损坏尾被隔离后可继续；同 commandId 异决定只落冲突、不改状态', async () => withProject(async root => {
    const ledger = new PromotionLedger();
    const a = await ingestAsset(root, 'asset:tail:a');
    const b = await ingestAsset(root, 'asset:tail:b');
    const first = await ledger.apply(command(root, a, 'promotion:tail:a'));
    fs.appendFileSync(first.paths.events, '{broken-tail\n', 'utf8');
    const recovered = await ledger.apply(command(root, b, 'promotion:tail:b'));
    assert.equal(recovered.ok, true);
    assert.ok(recovered.recoveryPath && fs.existsSync(recovered.recoveryPath));
    const conflict = await ledger.apply(command(root, b, 'promotion:tail:b', { reason: '另一个决定内容' }));
    assert.equal(conflict.code, 'PROMOTION_COMMAND_CONFLICT');
    assert.ok(fs.existsSync(conflict.conflictPath));
    const validLines = fs.readFileSync(recovered.paths.events, 'utf8').trim().split('\n');
    assert.equal(parseEventLog(validLines.join('\n')).events.length, 2);
    assert.throws(() => parseEventLog([validLines[0], '{broken-middle', validLines[1]].join('\n')), /中段损坏/);
  }));

  test('W62f runtime 只在显式动作时提交当前选择、来源与 human Authority', async () => {
    const calls = [];
    window.mazz = {
      invoke: async (channel, payload) => {
        calls.push({ channel, payload });
        if (channel === 'workspace:get') return 'D:/workspace';
        if (channel === 'promotion:promoteConversation') return { ok: true, assetId: 'asset:conversation:abc', promotionId: 'promotion:conversation:abc' };
        throw new Error(`unexpected ${channel}`);
      },
    };
    const runtime = createHarvestRuntime({});
    const result = await runtime.promoteSelection({
      meta: { adapterId: 'chatgpt', site: 'ChatGPT', topic: '证据链', url: 'https://chatgpt.com/c/abc', capturedAt: '2026-08-17T12:00:00.000Z' },
      messages: [{ id: 'M002', role: 'assistant', text: '只升格当前选择。' }],
    });
    const call = calls.find(row => row.channel === 'promotion:promoteConversation');
    assert.equal(result.assetId, 'asset:conversation:abc');
    assert.equal(call.payload.authorityRef, 'human:interactive-local-user');
    assert.deepEqual(call.payload.sourceRef.messageIds, ['M002']);
    assert.match(call.payload.markdown, /只升格当前选择/);
    assert.doesNotMatch(call.payload.markdown, /未选择内容/);
  });

  test('现有面板增加单一显式本地升格动作；没有自动 Promotion、Publication、Hub 或 Canon', () => {
    const panel = fs.readFileSync(path.join(repoRoot, 'renderer/panels/harvest.html'), 'utf8');
    const runtime = fs.readFileSync(path.join(repoRoot, 'renderer/modules/browser/harvest-runtime.js'), 'utf8');
    const browser = fs.readFileSync(path.join(repoRoot, 'renderer/modules/browser/index.js'), 'utf8');
    const main = fs.readFileSync(path.join(repoRoot, 'main/main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(repoRoot, 'preload/bridge.js'), 'utf8');
    assert.match(panel, /id="promote">升格为本地资产/);
    assert.match(panel, /send\('harvestPromote'/);
    assert.match(runtime, /async function promoteSelection/);
    assert.match(browser, /harvestPromote/);
    assert.match(main, /promotion:promoteConversation/);
    assert.match(preload, /promotion:promoteConversation/);
    assert.doesNotMatch(runtime + browser, /autoPromotion|Publication|publishToHub|Canon/);
  });
});
