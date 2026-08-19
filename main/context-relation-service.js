'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const contextGraph = require('./foundation/context-relations');

function digest(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function slash(value) { return String(value || '').replace(/\\/g, '/'); }

function canonicalUrl(value) {
  const url = new URL(String(value || ''));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Context URL 只允许 http/https');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  return url.toString();
}

class ContextRelationService {
  constructor({ rootProvider, store, evidenceService } = {}) {
    if (typeof rootProvider !== 'function' || !store || !evidenceService) throw new Error('ContextRelationService 依赖 root/store/evidenceService');
    this.rootProvider = rootProvider;
    this.store = store;
    this.evidenceService = evidenceService;
  }

  key() { return `w76.context-graph.${digest(path.resolve(this.rootProvider()).toLocaleLowerCase('en-US'))}`; }
  read() {
    const raw = this.store.get(this.key(), null);
    return raw ? contextGraph.normalizeGraph(raw) : contextGraph.emptyGraph();
  }
  write(graph) { const normalized = contextGraph.normalizeGraph(graph); this.store.set(this.key(), normalized); return normalized; }

  ensureContext(graph, label, parentContextIds = []) {
    const wanted = String(label || '收集箱').trim() || '收集箱';
    const existing = graph.contexts.find(item => item.label.toLocaleLowerCase('zh-CN') === wanted.toLocaleLowerCase('zh-CN'));
    if (existing) return { graph, context: existing };
    const context = contextGraph.normalizeContext({ label: wanted, parentContextIds, provenance: { source: 'w76-product-ui' } });
    return { graph: contextGraph.addContext(graph, context), context };
  }

  subject(input = {}) {
    if (input.kind === 'url') {
      const url = canonicalUrl(input.url);
      return contextGraph.normalizeNode({ kind: 'url', assetRef: `url:${url}`, canonicalRef: url, label: input.label || url, provenance: { source: 'browser-context-collection' } });
    }
    if (input.kind === 'file') {
      const target = path.resolve(String(input.filePath || ''));
      const scan = this.evidenceService.scan();
      const doc = scan.documents.find(item => path.resolve(item.path) === target);
      if (!doc) throw new Error('文件不在当前工作区可寻址清单中');
      return contextGraph.normalizeNode({ kind: 'file', assetRef: doc.assetId, canonicalRef: doc.assetId, label: input.label || path.basename(target), provenance: { source: 'workspace-context-collection', filePath: slash(target) } });
    }
    throw new Error('Context subject kind 只允许 file/url');
  }

  addSubject(input = {}) {
    let graph = this.read();
    const node = this.subject(input);
    graph = contextGraph.upsertNode(graph, node);
    const ensured = this.ensureContext(graph, input.contextLabel, input.parentContextIds || []);
    graph = ensured.graph;
    const existing = graph.placements.find(item => item.nodeId === node.nodeId && item.contextId === ensured.context.contextId);
    if (existing) {
      graph = contextGraph.updatePlacement(graph, existing.placementId, { alias: input.alias || existing.alias, note: input.note || existing.note, order: existing.order });
    } else {
      graph = contextGraph.addPlacement(graph, { nodeId: node.nodeId, contextId: ensured.context.contextId, alias: input.alias || '', note: input.note || '', order: Date.now(), provenance: { source: 'w76-product-ui' } });
    }
    const siblings = input.deriveRelations === false ? [] : graph.placements.filter(item => item.contextId === ensured.context.contextId && item.nodeId !== node.nodeId);
    for (const sibling of siblings) {
      const [fromRef, toRef] = [node.nodeId, sibling.nodeId].sort();
      const edgeId = `edge:co-placed:${digest(`${fromRef}|${toRef}|${ensured.context.contextId}`)}`;
      if (graph.shadowEdges.some(item => item.edgeId === edgeId) || graph.promotedEdges.some(item => item.edgeId === `promoted:${edgeId}`)) continue;
      graph = contextGraph.addShadowEdge(graph, {
        edgeId, kind: 'observed', relationType: 'co-placed-with', fromRef, toRef,
        confidence: 0.7, evidenceRefs: [ensured.context.contextId],
        provenance: { source: 'w76-context-co-placement', rebuildable: true }, status: 'active',
      });
    }
    return this.write(graph);
  }

  removePlacement(placementId) { return this.write(contextGraph.removePlacement(this.read(), placementId)); }
  updatePlacement(placementId, patch) { return this.write(contextGraph.updatePlacement(this.read(), placementId, patch)); }
  addShadowEdge(edge) { return this.write(contextGraph.addShadowEdge(this.read(), edge)); }
  dismissShadowEdge(edgeId) { return this.write(contextGraph.removeShadowEdge(this.read(), edgeId)); }
  promoteEdge(payload) { return this.write(contextGraph.promoteEdge(this.read(), payload)); }

  importBookmarks({ folders = [], bookmarks = [] } = {}) {
    if (!Array.isArray(folders) || !Array.isArray(bookmarks)) throw new Error('folders/bookmarks 必须是数组');
    if (folders.length > 200 || bookmarks.length > 2000) throw new Error('收藏导入超过单次上限');
    const names = new Map(folders.map(item => [String(item?.id || ''), String(item?.name || '').trim() || '默认收藏夹']));
    let imported = 0, failed = 0;
    for (const bookmark of bookmarks) {
      try {
        this.addSubject({
          kind: 'url', url: bookmark?.url, label: bookmark?.name || bookmark?.title || bookmark?.url,
          contextLabel: names.get(String(bookmark?.folder || 'default')) || '默认收藏夹',
          alias: bookmark?.name || '', note: '由浏览器收藏降级互操作导入', deriveRelations: false,
        });
        imported++;
      } catch { failed++; }
    }
    return { graph: this.read(), imported, failed, sourceRetained: true, destructiveMigration: false };
  }
}

module.exports = { ContextRelationService, canonicalUrl };
