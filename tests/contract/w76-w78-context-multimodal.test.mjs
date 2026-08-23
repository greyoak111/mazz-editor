import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const graph = require('../../main/foundation/context-relations.js');
const evidence = require('../../main/foundation/addressable-evidence.js');
const multimodal = require('../../main/foundation/multimodal-evidence.js');
const { ContextRelationService, canonicalUrl } = require('../../main/context-relation-service.js');

function node(kind, canonicalRef, label = canonicalRef) {
  return graph.normalizeNode({ kind, assetRef: `asset:${canonicalRef}`, canonicalRef, label, provenance: { source: 'fixture' } });
}
function context(label, parents = []) { return graph.normalizeContext({ label, parentContextIds: parents, provenance: { source: 'fixture' } }); }
function edge(edgeId, fromRef, toRef, kind = 'observed') {
  return { edgeId, kind, relationType: 'co-used-with', fromRef, toRef, confidence: 0.72, evidenceRefs: ['event:1'], provenance: { source: 'fixture' } };
}

describe('W76 Node ≠ Placement 与多父 Navigation Context', () => {
  test('同一 Node 可有多个 Placement，各自别名/备注，删除 Placement 不删除资产节点', () => {
    const asset = node('file', 'asset:stable', 'Factory.md');
    const project = context('W71');
    const release = context('Release Engineering');
    let state = graph.emptyGraph();
    state = graph.upsertNode(state, asset);
    state = graph.addContext(state, project);
    state = graph.addContext(state, release);
    state = graph.addPlacement(state, { nodeId: asset.nodeId, contextId: project.contextId, alias: '包装决议', note: 'W71 局部名', order: 1, provenance: {} });
    state = graph.addPlacement(state, { nodeId: asset.nodeId, contextId: release.contextId, alias: 'Factory 规格', note: '发布视角', order: 2, provenance: {} });
    assert.equal(state.nodes.length, 1);
    assert.equal(state.placements.length, 2);
    assert.notEqual(state.placements[0].alias, state.placements[1].alias);
    const removed = graph.removePlacement(state, state.placements[0].placementId);
    assert.equal(removed.nodes.length, 1);
    assert.equal(removed.placements.length, 1);
  });

  test('Navigation Context 必须是 DAG，Relation Graph 明确允许有向环', () => {
    const a = context('A'), b = context('B');
    assert.throws(() => graph.normalizeGraph({
      nodes: [], placements: [], shadowEdges: [], promotedEdges: [], promotions: [],
      contexts: [{ ...a, parentContextIds: [b.contextId] }, { ...b, parentContextIds: [a.contextId] }],
    }), /必须保持 DAG/);

    const na = node('file', 'asset:a'), nb = node('file', 'asset:b');
    const cyclicRelations = graph.normalizeGraph({
      nodes: [na, nb], contexts: [], placements: [], promotedEdges: [], promotions: [],
      shadowEdges: [edge('edge:a-b', na.nodeId, nb.nodeId), edge('edge:b-a', nb.nodeId, na.nodeId, 'inferred')],
    });
    assert.equal(cyclicRelations.shadowEdges.length, 2);
  });

  test('URL canonical identity 去 fragment/默认端口，同一网页多父不复制本体', () => {
    assert.equal(canonicalUrl('HTTPS://Example.COM:443/a#fragment'), 'https://example.com/a');
    const memory = new Map();
    const store = { get: (key, fallback) => memory.has(key) ? memory.get(key) : fallback, set: (key, value) => memory.set(key, value) };
    const service = new ContextRelationService({ rootProvider: () => 'D:/workspace', store, evidenceService: { scan: () => ({ documents: [] }) } });
    service.addSubject({ kind: 'url', url: 'https://example.com/a#one', label: 'Example', contextLabel: 'Project' });
    const state = service.addSubject({ kind: 'url', url: 'https://EXAMPLE.com:443/a#two', label: 'Example Again', contextLabel: 'Research' });
    assert.equal(state.nodes.length, 1);
    assert.equal(state.placements.length, 2);
  });

  test('传统文件身份由 W63 服务供应，不允许上下文层自己拿路径冒充 semantic identity', () => {
    const memory = new Map();
    const store = { get: (key, fallback) => memory.has(key) ? memory.get(key) : fallback, set: (key, value) => memory.set(key, value) };
    const filePath = 'D:/workspace/docs/Factory.md';
    const service = new ContextRelationService({ rootProvider: () => 'D:/workspace', store, evidenceService: { scan: () => ({ documents: [{ path: filePath, assetId: 'asset:workspace-file:stable' }] }) } });
    const state = service.addSubject({ kind: 'file', filePath, label: 'Factory.md', contextLabel: 'W82' });
    assert.equal(state.nodes[0].canonicalRef, 'asset:workspace-file:stable');
    assert.notEqual(state.nodes[0].canonicalRef, filePath);
  });

  test('传统浏览器收藏可无损投影到 Context，原收藏不删且不制造二次迁移权威', () => {
    const memory = new Map();
    const store = { get: (key, fallback) => memory.has(key) ? memory.get(key) : fallback, set: (key, value) => memory.set(key, value) };
    const service = new ContextRelationService({ rootProvider: () => 'D:/workspace', store, evidenceService: { scan: () => ({ documents: [] }) } });
    const result = service.importBookmarks({
      folders: [{ id: 'research', name: '研究' }, { id: 'project', name: '项目' }],
      bookmarks: [
        { url: 'https://example.com/paper', name: 'Paper', folder: 'research' },
        { url: 'https://example.com/project', name: 'Project', folder: 'project' },
      ],
    });
    assert.equal(result.imported, 2);
    assert.equal(result.sourceRetained, true);
    assert.equal(result.destructiveMigration, false);
    assert.deepEqual(result.graph.contexts.map(item => item.label).sort((a, b) => a.localeCompare(b, 'zh-CN')), ['项目', '研究'].sort((a, b) => a.localeCompare(b, 'zh-CN')));
    assert.equal(result.graph.shadowEdges.length, 0, '批量收藏投影不能制造 O(n²) 推断关系');
  });
});

describe('W77 Shadow Relation 与人工 Promotion', () => {
  test('同 Context 共置只生成 observed 建议，并公开 confidence/evidence', () => {
    const memory = new Map();
    const store = { get: (key, fallback) => memory.has(key) ? memory.get(key) : fallback, set: (key, value) => memory.set(key, value) };
    const service = new ContextRelationService({ rootProvider: () => 'D:/workspace', store, evidenceService: { scan: () => ({ documents: [] }) } });
    service.addSubject({ kind: 'url', url: 'https://example.com/a', label: 'A', contextLabel: 'Episode' });
    const state = service.addSubject({ kind: 'url', url: 'https://example.com/b', label: 'B', contextLabel: 'Episode' });
    assert.equal(state.shadowEdges.length, 1);
    assert.equal(state.shadowEdges[0].kind, 'observed');
    assert.equal(state.shadowEdges[0].confidence, 0.7);
    assert.equal(state.shadowEdges[0].evidenceRefs.length, 1);
    assert.equal(state.promotedEdges.length, 0);
  });

  test('近义/共置不能自动 sameConcept；升格必须 human，关系建议可丢弃后重建', () => {
    const a = node('url', 'https://a.test'), b = node('url', 'https://b.test');
    let state = graph.normalizeGraph({ nodes: [a, b], contexts: [], placements: [], shadowEdges: [edge('edge:shadow', a.nodeId, b.nodeId, 'inferred')], promotedEdges: [], promotions: [] });
    assert.equal(state.shadowEdges[0].relationType, 'co-used-with');
    assert.throws(() => graph.promoteEdge(state, { shadowEdgeId: 'edge:shadow', authorityRef: 'agent:auto', reason: 'semantic similarity', decidedAt: '2026-08-19T00:00:00Z' }), /human:\*/);
    state = graph.promoteEdge(state, { shadowEdgeId: 'edge:shadow', authorityRef: 'human:maintainer', reason: '人工核对来源', decidedAt: '2026-08-19T00:00:00Z' });
    assert.equal(state.promotedEdges[0].kind, 'promoted');
    assert.equal(state.promotedEdges[0].confidence, 0.72);
    assert.deepEqual(state.promotedEdges[0].evidenceRefs, ['event:1']);
    assert.equal(state.promotions[0].authorityRef, 'human:maintainer');
    assert.equal(graph.removeShadowEdge(state, 'edge:shadow').shadowEdges.length, 0);
  });
});

describe('W78 Multimodal Addressable Evidence', () => {
  test('Markdown 长块证据锚保留完整引文，不以 500 字符裁断', () => {
    const shared = '证据正文'.repeat(180);
    const first = evidence.parseLiveReferences(`${shared}甲尾 {{ref:asset:target!anchor:one}}`, 'asset:source');
    const second = evidence.parseLiveReferences(`${shared}乙尾 {{ref:asset:target!anchor:one}}`, 'asset:source');
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.notEqual(first[0].sourceAnchorId, second[0].sourceAnchorId, '500 字后的不同尾部也必须参与锚点身份');
  });

  test('EPUB 字号/页宽重排只改变 physical location，不改变逻辑 Anchor ID', () => {
    const anchor = evidence.createContentAnchor({
      assetId: 'asset:epub:book', mediaType: 'epub',
      logicalLocation: { kind: 'epub-quote', spineItemId: 'chap-2', href: 'c2.xhtml', cfi: 'epubcfi(/6/4!/4/2)', textQuote: '不可逆变化' },
      physicalLocation: { layoutRef: 'font16-width70' }, quote: '不可逆变化', context: null,
      provenance: { source: 'fixture' }, resolver: { strategy: 'cfi-then-quote' }, status: 'active',
    });
    const exact = multimodal.relocateEpub(anchor, { assetId: anchor.assetId, layout: 'font24-width50', spineItems: [{ id: 'chap-2', href: 'c2.xhtml', text: '前文 不可逆变化 后文', cfiRanges: [{ cfi: 'epubcfi(/6/4!/4/2)', physicalLocation: { layoutRef: 'font24-width50', charRange: [3, 9] } }] }] });
    assert.equal(exact.status, 'RESOLVED');
    assert.equal(exact.method, 'epub:cfi');
    const fallback = multimodal.relocateEpub(anchor, { assetId: anchor.assetId, layout: 'font30-width100', spineItems: [{ id: 'chap-2', href: 'c2.xhtml', text: '重排后仍有不可逆变化。', cfiRanges: [] }] });
    assert.equal(fallback.status, 'RESOLVED');
    assert.equal(fallback.method, 'epub:unique-quote');
    assert.equal(anchor.anchorId, evidence.createContentAnchor({ ...anchor, physicalLocation: { layoutRef: 'another-layout' } }).anchorId);
  });

  test('漫画/图片 OCR 为空仍可由视觉标签或感知摘要检索', () => {
    const imageAnchor = evidence.createContentAnchor({ assetId: 'asset:image:page', mediaType: 'image', logicalLocation: { kind: 'image-region', bbox: [10, 20, 300, 200] }, physicalLocation: null, quote: '', context: null, provenance: {}, resolver: {}, status: 'active' });
    const index = multimodal.buildMultimodalIndex({
      anchors: [imageAnchor],
      observations: [{ anchorRef: imageAnchor.anchorId, ocrText: '', visualLabels: ['红色月亮', '双人剪影'], transcript: '', altText: '', perceptualHash: 'phash:abc', provenance: { source: 'vision-local' } }],
      maxChars: 600,
    });
    const hits = multimodal.searchMultimodalIndex(index, '红色月亮');
    assert.equal(hits[0].anchorRef, imageAnchor.anchorId);
    assert.equal(index.chunkIsAsset, false);
    assert.equal(Object.hasOwn(index.chunks[0], 'assetId'), false);
    assert.equal(index.rebuildable, true);
    assert.equal(index.lazy, true);
  });

  test('Chunk 只是索引窗口，未知正文/secret/万能字段均不准进入协议', () => {
    assert.throws(() => multimodal.normalizeChunk({ anchorRef: 'anchor:a', window: { start: 0, end: 4 }, text: 'test', terms: [], provenance: {}, assetId: 'fake' }), /未冻结字段/);
    assert.throws(() => multimodal.normalizeObservation({ anchorRef: 'anchor:a', visualLabels: ['x'], provenance: { apiKey: 'no' } }), /禁止 secret/);
  });

  test('Viewer/Library 正式入口、Context Sidebar 与 IPC 白名单均接线', () => {
    const viewer = fs.readFileSync(new URL('../../renderer/modules/viewer/index.js', import.meta.url), 'utf8');
    const library = fs.readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');
    const sidebar = fs.readFileSync(new URL('../../renderer/shell/sidebar-panels.js', import.meta.url), 'utf8');
    const preload = fs.readFileSync(new URL('../../preload/bridge.js', import.meta.url), 'utf8');
    assert.match(viewer, /复制证据定位/);
    assert.match(library, /证据定位/);
    assert.match(sidebar, /将当前内容加入上下文/);
    assert.match(sidebar, /关系建议/);
    assert.match(sidebar, /置信度/);
    for (const channel of ['evidence:createAnchorForPath', 'context:addSubject', 'context:promoteEdge']) assert.match(preload, new RegExp(channel.replace(':', '\\:')));
  });
});
