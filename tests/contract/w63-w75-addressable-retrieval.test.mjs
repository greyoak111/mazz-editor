import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const evidence = require('../../main/foundation/addressable-evidence.js');
const retrieval = require('../../main/foundation/relation-retrieval.js');
const { AddressableEvidenceService } = require('../../main/addressable-evidence-service.js');

function anchor(mediaType, logicalLocation, overrides = {}) {
  return evidence.createContentAnchor({
    assetId: `asset:${mediaType}:fixture`,
    mediaType,
    logicalLocation,
    physicalLocation: null,
    quote: '',
    context: null,
    provenance: { source: 'w63-w75-contract' },
    resolver: { strategy: 'deterministic-then-fallback' },
    status: 'active',
    ...overrides,
  });
}

function episode(episodeId = 'episode:packaging') {
  return {
    episodeId,
    label: 'Windows packaged runtime 排查',
    workspaceRef: 'workspace:mazz',
    startedAt: '2026-08-18T09:00:00.000Z',
    endedAt: '2026-08-18T12:00:00.000Z',
    anchorRefs: ['anchor:package-json'],
    eventRefs: ['event:terminal-abi'],
    contextRefs: ['context:w71', 'context:packaging'],
    provenance: { source: 'workspace-event-ledger' },
    rebuildable: true,
  };
}

describe('W63 Addressable Evidence 与块级活引用契约', () => {
  test('身份只由资产与逻辑位置决定，布局或路径变化不改 Anchor ID', () => {
    const first = anchor('markdown', { kind: 'markdown-block', blockId: 'decision-42' }, {
      physicalLocation: { path: 'before.md', charRange: [10, 30] },
    });
    const moved = anchor('markdown', { kind: 'markdown-block', blockId: 'decision-42' }, {
      physicalLocation: { path: 'renamed/after.md', charRange: [800, 820] },
    });
    const changed = anchor('markdown', { kind: 'markdown-block', blockId: 'decision-43' });
    assert.equal(first.anchorId, moved.anchorId);
    assert.notEqual(first.anchorId, changed.anchorId);
    assert.equal(Object.isFrozen(first.logicalLocation), true);
  });

  test('所有领域选择器都有最小可寻址契约，缺稳定选择器立即拒绝', () => {
    const cases = [
      ['sheet', { kind: 'sheet-cell', sheetId: 'Sheet1', cellRange: 'B2:D7' }],
      ['mindmap', { kind: 'mindmap-node', nodeId: 'node-7' }],
      ['code', { kind: 'code-symbol', symbol: 'createWindow' }],
      ['pdf', { kind: 'pdf-quote', page: 7, textQuote: '许可闭环' }],
      ['epub', { kind: 'epub-cfi', spineItemId: 'chapter-2', cfi: 'epubcfi(/6/4!/4/2)' }],
      ['comic', { kind: 'comic-panel', page: 8, panelId: 'panel-3' }],
      ['image', { kind: 'image-region', bbox: [1, 2, 300, 200] }],
      ['video', { kind: 'video-range', startMs: 42000, endMs: 47000 }],
      ['audio', { kind: 'audio-range', startMs: 1200 }],
      ['conversation', { kind: 'conversation-turn', turnId: 'turn-8' }],
      ['browser', { kind: 'browser-quote', canonicalUrl: 'https://example.test/a', textQuote: 'ABI' }],
    ];
    for (const [type, selector] of cases) assert.equal(anchor(type, selector).mediaType, type);
    assert.throws(() => anchor('sheet', { kind: 'sheet-cell', sheetId: 'Sheet1' }), /稳定选择器/);
    assert.throws(() => anchor('video', { kind: 'video-range', startMs: 8, endMs: 2 }), /不能早于/);
  });

  test('Markdown ref 语法绑定显式 block，移动后仍按 blockId 精确解析', () => {
    const refs = evidence.parseLiveReferences('决定采用严格 ABI 审计 {{ref:package.json!^builder}} ^source-decision', 'asset:decision-log');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].targetAssetRef, 'package.json');
    assert.equal(refs[0].targetAnchorRef, '^builder');
    const sourceAnchor = anchor('markdown', { kind: 'markdown-block', blockId: 'source-decision' }, { assetId: 'asset:decision-log' });
    assert.equal(refs[0].sourceAnchorId, sourceAnchor.anchorId);

    const target = anchor('markdown', { kind: 'markdown-block', blockId: 'builder' }, { assetId: 'asset:package' });
    const resolved = evidence.resolveContentAnchor(target, { assetId: 'asset:package', text: '前言\n\n移动到很后面。 ^builder\n\n尾声' });
    assert.equal(resolved.status, 'RESOLVED');
    assert.equal(resolved.method, 'markdown:block-id');
  });

  test('quote fallback 区分唯一、歧义与丢失，不静默指错内容', () => {
    const target = anchor('markdown', { kind: 'markdown-quote', textQuote: '唯一决议' });
    assert.equal(evidence.resolveContentAnchor(target, { assetId: target.assetId, text: 'a\n\n唯一决议\n\nb' }).status, 'RESOLVED');
    assert.equal(evidence.resolveContentAnchor(target, { assetId: target.assetId, text: '唯一决议\n\n唯一决议' }).status, 'AMBIGUOUS');
    assert.equal(evidence.resolveContentAnchor(target, { assetId: target.assetId, text: '已删除' }).status, 'MISSING');
  });

  test('Sheet、Mindmap、时间轴和声明式多模态选择器可判真并拒绝越界', () => {
    const sheet = anchor('sheet', { kind: 'sheet-cell', sheetId: 'S1', cellRange: 'C9' });
    assert.equal(evidence.resolveContentAnchor(sheet, { assetId: sheet.assetId, sheets: { S1: { C9: 42 } } }).status, 'RESOLVED');
    const map = anchor('mindmap', { kind: 'mindmap-node', nodeId: 'child' });
    assert.equal(evidence.resolveContentAnchor(map, { assetId: map.assetId, roots: [{ id: 'root', children: [{ id: 'child' }] }] }).status, 'RESOLVED');
    const video = anchor('video', { kind: 'video-range', startMs: 9000, endMs: 12000 });
    assert.equal(evidence.resolveContentAnchor(video, { assetId: video.assetId, durationMs: 10000 }).status, 'MISSING');
    const pdf = anchor('pdf', { kind: 'pdf-quote', page: 3, textQuote: 'roundtrip' });
    assert.equal(evidence.resolveContentAnchor(pdf, { assetId: pdf.assetId, selectors: [{ logicalLocation: pdf.logicalLocation, physicalLocation: { page: 3, charRange: [2, 11] } }] }).status, 'RESOLVED');
  });

  test('可重建引用索引同时回答我引用谁、谁引用我与变更影响面', () => {
    const source = anchor('markdown', { kind: 'markdown-block', blockId: 'src' }, { assetId: 'asset:source' });
    const ref = evidence.createLiveReference({
      sourceAssetId: 'asset:source', sourceAnchorId: source.anchorId,
      targetAssetRef: 'asset:target', targetAnchorRef: '^target',
      provenance: { source: 'fixture' },
    });
    const index = evidence.buildReferenceIndex({ anchors: [source], references: [ref], builtAt: '2026-08-19T00:00:00Z' });
    assert.deepEqual(index.outgoing['asset:source'], [ref.referenceId]);
    assert.deepEqual(index.incoming['asset:target!^target'], [ref.referenceId]);
    assert.deepEqual(evidence.impactedReferences(index, 'asset:target'), [ref.referenceId]);
    assert.equal(index.rebuildable, true);
    assert.equal(index.sourceOfTruth, 'domain-files');
    assert.throws(() => evidence.buildReferenceIndex({ anchors: [source], references: [ref, ref] }), /Reference ID 不能重复/);
  });

  test('未知字段、secret、伪造 ID 和运行时能力均被拒绝', () => {
    const base = { assetId: 'asset:x', mediaType: 'markdown', logicalLocation: { kind: 'markdown-block', blockId: 'x' }, provenance: {}, resolver: {} };
    assert.throws(() => evidence.createContentAnchor({ ...base, universalPayload: {} }), /未冻结字段/);
    assert.throws(() => evidence.createContentAnchor({ ...base, provenance: { apiKey: 'no' } }), /禁止 secret/);
    assert.throws(() => evidence.createContentAnchor({ ...base, anchorId: 'anchor:forged' }), /不匹配/);
    assert.throws(() => evidence.resolveContentAnchor(evidence.createContentAnchor(base), { assetId: 'asset:x', command: 'rm' }), /未冻结字段/);
    const source = fs.readFileSync(new URL('../../main/foundation/addressable-evidence.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /child_process|electron|require\(['"](?:fs|node:fs|net|http|https)/);
  });
});

describe('W75 Relation Retrieval 与可解释回忆契约', () => {
  test('四类关系分层；推断关系不可伪装 Authority，升格必须 human', () => {
    const base = { edgeId: 'edge:1', relationType: 'co-used-with', fromRef: 'asset:a', toRef: 'asset:b', confidence: 0.8, evidenceRefs: ['event:1'], provenance: { source: 'ledger' } };
    assert.equal(retrieval.normalizeEdge({ ...base, kind: 'observed' }).kind, 'observed');
    assert.throws(() => retrieval.normalizeEdge({ ...base, kind: 'inferred', authorityRef: 'agent:auto' }), /不得伪装/);
    assert.throws(() => retrieval.normalizeEdge({ ...base, kind: 'promoted', authorityRef: 'agent:auto' }), /human:\*/);
    assert.equal(retrieval.normalizeEdge({ ...base, kind: 'promoted', authorityRef: 'human:maintainer' }).authorityRef, 'human:maintainer');
    assert.throws(() => retrieval.normalizeEdge({ ...base, kind: 'observed', toRef: 'asset:a' }), /不能自环/);
  });

  test('模糊回忆按 Episode、语义、关系、上下文和时间评分并给出理由', () => {
    const edge = { edgeId: 'edge:abi-license', kind: 'observed', relationType: 'co-used-with', fromRef: 'anchor:abi', toRef: 'anchor:license', confidence: 0.9, evidenceRefs: ['event:terminal-abi'], provenance: { source: 'ledger' } };
    const result = retrieval.recollect({
      query: {
        queryId: 'query:old-question', episodeRefs: ['episode:packaging'], speaker: 'maintainer', itemType: 'question',
        semanticHints: ['VPS', '配置'], relationRefs: ['edge:abi-license'], currentContextRefs: ['context:w71'],
        before: '2026-08-19T00:00:00.000Z', direction: 'earlier', limit: 3, rejectedCandidateRefs: [],
      },
      episodes: [episode()], edges: [edge], candidates: [
        { candidateRef: 'candidate:target', anchorRef: 'anchor:old-question', episodeRefs: ['episode:packaging'], occurredAt: '2026-08-18T10:00:00.000Z', speaker: 'maintainer', itemType: 'question', terms: ['VPS', '配置'], relationRefs: ['edge:abi-license'], contextRefs: ['context:w71'], importance: 'low', preview: '那个 VPS 配置的问题' },
        { candidateRef: 'candidate:noise', anchorRef: 'anchor:noise', episodeRefs: [], occurredAt: '2026-08-18T11:00:00.000Z', speaker: 'other', itemType: 'answer', terms: ['unrelated'], relationRefs: [], contextRefs: [], importance: 'normal', preview: 'noise' },
      ],
    });
    assert.equal(result.candidates[0].candidateRef, 'candidate:target');
    assert.ok(result.candidates[0].score >= 100);
    assert.ok(result.candidates[0].reasons.some(item => item.startsWith('episode:')));
    assert.ok(result.candidates[0].reasons.some(item => item.startsWith('semantic:')));
    assert.equal(result.explanationRequired, true);
    assert.equal(result.indexRebuildable, true);
  });

  test('用户驳回候选后不再返回；同分结果按稳定 ID 排序', () => {
    const query = { queryId: 'query:stable', semanticHints: ['term'], limit: 5, rejectedCandidateRefs: ['candidate:a'] };
    const candidate = id => ({ candidateRef: id, anchorRef: `anchor:${id}`, episodeRefs: [], occurredAt: '2026-08-18T10:00:00Z', terms: ['term'], relationRefs: [], contextRefs: [] });
    const result = retrieval.recollect({ query, episodes: [], edges: [], candidates: [candidate('candidate:b'), candidate('candidate:a'), candidate('candidate:c')] });
    assert.deepEqual(result.candidates.map(item => item.candidateRef), ['candidate:b', 'candidate:c']);
    assert.throws(() => retrieval.recollect({ query: { ...query, rejectedCandidateRefs: [] }, episodes: [], edges: [], candidates: [candidate('candidate:b'), candidate('candidate:b')] }), /candidateRef 不能重复/);
  });

  test('检索内核同样是纯数据能力，不夹带文件、网络或执行权限', () => {
    const source = fs.readFileSync(new URL('../../main/foundation/relation-retrieval.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /child_process|electron|require\(['"](?:fs|node:fs|net|http|https)/);
    assert.throws(() => retrieval.normalizeQuery({ queryId: 'q', semanticHints: [], rejectedCandidateRefs: [], authorizationToken: 'x' }), /未冻结字段|禁止 secret/);
  });
});

describe('W63 主进程工作区索引与真实侧栏接线', () => {
  test('工作区扫描解析跨文件活引用，文件变更失效后可重建双向关系', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w63-'));
    const memory = new Map();
    const identityStore = { get: key => memory.get(key) || {}, set: (key, value) => memory.set(key, value) };
    try {
      const source = path.join(root, 'source.md');
      const target = path.join(root, 'target.md');
      fs.writeFileSync(source, '包装决议 {{ref:target.md!^anchor}} ^source\n', 'utf8');
      fs.writeFileSync(target, '# Target\n\nABI 与许可闭环。 ^anchor\n', 'utf8');
      const service = new AddressableEvidenceService({ rootProvider: () => root, identityStore });
      const first = service.fileRelations({ path: source });
      assert.equal(first.outgoing.length, 1);
      assert.equal(first.outgoing[0].status, 'RESOLVED');
      assert.equal(service.fileRelations({ path: target }).incoming.length, 1);
      fs.writeFileSync(target, '# Target\n\n锚点被删除。\n', 'utf8');
      assert.equal(service.fileRelations({ path: source }).outgoing[0].status, 'RESOLVED', '未失效前读缓存');
      service.invalidate(target);
      const stale = service.fileRelations({ path: source });
      assert.equal(stale.outgoing[0].status, 'MISSING');
      assert.throws(() => service.fileRelations({ path: path.join(root, '..', 'outside.md') }), /当前工作区/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('资产身份表保留同路径编辑身份，也可凭相同内容重接命名后的文件', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w63-id-'));
    const memory = new Map();
    const identityStore = { get: key => memory.get(key) || {}, set: (key, value) => memory.set(key, value) };
    try {
      const before = path.join(root, 'before.md');
      const after = path.join(root, 'after.md');
      fs.writeFileSync(before, '# Stable\n\ncontent\n', 'utf8');
      const service = new AddressableEvidenceService({ rootProvider: () => root, identityStore });
      const first = service.scan().documents[0].assetId;
      fs.renameSync(before, after);
      service.invalidate();
      const renamed = service.scan().documents[0].assetId;
      assert.equal(first, renamed);
      fs.writeFileSync(after, '# Stable\n\ncontent changed\n', 'utf8');
      service.invalidate(after);
      assert.equal(service.scan().documents[0].assetId, first);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('preload 白名单、主进程处理器和既有反链侧栏三端均已接线', () => {
    const preload = fs.readFileSync(new URL('../../preload/bridge.js', import.meta.url), 'utf8');
    const main = fs.readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8');
    const sidebar = fs.readFileSync(new URL('../../renderer/shell/sidebar-panels.js', import.meta.url), 'utf8');
    for (const channel of ['evidence:scanWorkspace', 'evidence:fileRelations', 'evidence:invalidate']) {
      assert.match(preload, new RegExp(channel.replace(':', '\\:')));
      assert.match(main, new RegExp(channel.replace(':', '\\:')));
    }
    assert.match(sidebar, /活引用 · 我引用/);
    assert.match(sidebar, /活引用 · 引用我/);
    assert.match(sidebar, /file:changed[\s\S]+evidence:invalidate/);
  });
});
