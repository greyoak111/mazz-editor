'use strict';

const crypto = require('node:crypto');
const {
  assertKnownKeys, clonePlain, deepFreeze, isPlainObject, optionalString, requiredString, stringList,
} = require('./plain-value');
const { normalizeEdge } = require('./relation-retrieval');

const CONTEXT_GRAPH_SCHEMA = 'mazz.context-graph/v0';
const CONTEXT_NODE_SCHEMA = 'mazz.context-node/v0';
const CONTEXT_SCHEMA = 'mazz.navigation-context/v0';
const PLACEMENT_SCHEMA = 'mazz.context-placement/v0';
const PROMOTION_SCHEMA = 'mazz.relation-promotion/v0';
const NODE_KINDS = new Set(['file', 'url', 'collection', 'anchor', 'episode']);
const SECRET_KEY = /(?:api.?key|secret|token|authorization|password|credential|private.?key)/i;

function assertNoSecrets(value, label, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SECRET_KEY.test(key)) throw new Error(`${label} 禁止 secret 字段: ${childPath}`);
    assertNoSecrets(child, label, childPath);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex');
}

function normalizeNode(input) {
  if (!isPlainObject(input)) throw new Error('Context Node 必须是对象');
  assertKnownKeys(input, ['schema', 'nodeId', 'kind', 'assetRef', 'canonicalRef', 'label', 'provenance', 'status'], 'Context Node');
  assertNoSecrets(input, 'Context Node');
  const kind = requiredString(input.kind, 'kind');
  if (!NODE_KINDS.has(kind)) throw new Error(`Context Node kind 非法: ${kind}`);
  const canonicalRef = requiredString(input.canonicalRef, 'canonicalRef');
  const expectedId = `node:${digest({ kind, canonicalRef })}`;
  const nodeId = optionalString(input.nodeId) || expectedId;
  if (nodeId !== expectedId) throw new Error('nodeId 与 kind/canonicalRef 不匹配');
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  return deepFreeze({
    schema: CONTEXT_NODE_SCHEMA,
    nodeId, kind,
    assetRef: requiredString(input.assetRef, 'assetRef'),
    canonicalRef,
    label: requiredString(input.label, 'label'),
    provenance: clonePlain(input.provenance, 'provenance'),
    status: optionalString(input.status) || 'active',
  });
}

function normalizeContext(input) {
  if (!isPlainObject(input)) throw new Error('Navigation Context 必须是对象');
  assertKnownKeys(input, ['schema', 'contextId', 'label', 'parentContextIds', 'provenance', 'status'], 'Navigation Context');
  assertNoSecrets(input, 'Navigation Context');
  const label = requiredString(input.label, 'label');
  const contextId = optionalString(input.contextId) || `context:${digest({ label })}`;
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  return deepFreeze({
    schema: CONTEXT_SCHEMA, contextId, label,
    parentContextIds: stringList(input.parentContextIds || [], 'parentContextIds'),
    provenance: clonePlain(input.provenance, 'provenance'),
    status: optionalString(input.status) || 'active',
  });
}

function normalizePlacement(input) {
  if (!isPlainObject(input)) throw new Error('Placement 必须是对象');
  assertKnownKeys(input, ['schema', 'placementId', 'nodeId', 'contextId', 'alias', 'note', 'order', 'provenance', 'status'], 'Placement');
  assertNoSecrets(input, 'Placement');
  const row = { nodeId: requiredString(input.nodeId, 'nodeId'), contextId: requiredString(input.contextId, 'contextId') };
  const expectedId = `placement:${digest(row)}`;
  const placementId = optionalString(input.placementId) || expectedId;
  if (placementId !== expectedId) throw new Error('placementId 与 Node/Context 不匹配');
  const order = Number(input.order ?? 0);
  if (!Number.isFinite(order)) throw new Error('order 必须是有限数值');
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  return deepFreeze({
    schema: PLACEMENT_SCHEMA, placementId, ...row,
    alias: optionalString(input.alias), note: optionalString(input.note), order,
    provenance: clonePlain(input.provenance, 'provenance'),
    status: optionalString(input.status) || 'active',
  });
}

function assertNavigationDag(contexts) {
  const ids = new Set(contexts.map(item => item.contextId));
  const graph = new Map(contexts.map(item => [item.contextId, item.parentContextIds]));
  for (const context of contexts) {
    for (const parent of context.parentContextIds) {
      if (!ids.has(parent)) throw new Error(`Context parent 不存在: ${parent}`);
      if (parent === context.contextId) throw new Error('Navigation Context 不得自环');
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) throw new Error('Navigation Context 必须保持 DAG');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of graph.get(id) || []) visit(parent);
    visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
}

function normalizePromotion(input) {
  if (!isPlainObject(input)) throw new Error('Relation Promotion 必须是对象');
  assertKnownKeys(input, ['schema', 'promotionId', 'shadowEdgeId', 'promotedEdgeId', 'authorityRef', 'reason', 'decidedAt', 'status', 'supersedes'], 'Relation Promotion');
  assertNoSecrets(input, 'Relation Promotion');
  const authorityRef = requiredString(input.authorityRef, 'authorityRef');
  if (!authorityRef.startsWith('human:')) throw new Error('Relation Promotion 必须由 human:* 决定');
  const row = {
    shadowEdgeId: requiredString(input.shadowEdgeId, 'shadowEdgeId'),
    promotedEdgeId: requiredString(input.promotedEdgeId, 'promotedEdgeId'),
    authorityRef,
    reason: requiredString(input.reason, 'reason'),
    decidedAt: requiredString(input.decidedAt, 'decidedAt'),
  };
  return deepFreeze({
    schema: PROMOTION_SCHEMA,
    promotionId: optionalString(input.promotionId) || `relation-promotion:${digest(row)}`,
    ...row,
    status: optionalString(input.status) || 'active',
    supersedes: optionalString(input.supersedes),
  });
}

function normalizeGraph(input = {}) {
  if (!isPlainObject(input)) throw new Error('Context Graph 必须是对象');
  assertKnownKeys(input, ['schema', 'nodes', 'contexts', 'placements', 'shadowEdges', 'promotedEdges', 'promotions', 'updatedAt'], 'Context Graph');
  assertNoSecrets(input, 'Context Graph');
  if (input.schema != null && input.schema !== CONTEXT_GRAPH_SCHEMA) throw new Error(`不支持的 Context Graph schema: ${input.schema}`);
  const nodes = (input.nodes || []).map(normalizeNode);
  const contexts = (input.contexts || []).map(normalizeContext);
  const placements = (input.placements || []).map(normalizePlacement);
  const shadowEdges = (input.shadowEdges || []).map(normalizeEdge);
  const promotedEdges = (input.promotedEdges || []).map(normalizeEdge);
  const promotions = (input.promotions || []).map(normalizePromotion);
  const unique = (rows, key, label) => { if (new Set(rows.map(item => item[key])).size !== rows.length) throw new Error(`${label} 不能重复`); };
  unique(nodes, 'nodeId', 'nodeId'); unique(contexts, 'contextId', 'contextId'); unique(placements, 'placementId', 'placementId');
  unique(shadowEdges, 'edgeId', 'shadow edgeId'); unique(promotedEdges, 'edgeId', 'promoted edgeId'); unique(promotions, 'promotionId', 'promotionId');
  assertNavigationDag(contexts);
  const nodeIds = new Set(nodes.map(item => item.nodeId));
  const contextIds = new Set(contexts.map(item => item.contextId));
  for (const placement of placements) {
    if (!nodeIds.has(placement.nodeId)) throw new Error(`Placement Node 不存在: ${placement.nodeId}`);
    if (!contextIds.has(placement.contextId)) throw new Error(`Placement Context 不存在: ${placement.contextId}`);
  }
  for (const edge of promotedEdges) if (edge.kind !== 'promoted') throw new Error('promotedEdges 只能包含 promoted');
  for (const edge of shadowEdges) if (edge.kind === 'promoted') throw new Error('shadowEdges 不得包含 promoted');
  return deepFreeze({
    schema: CONTEXT_GRAPH_SCHEMA,
    nodes: [...nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    contexts: [...contexts].sort((a, b) => a.contextId.localeCompare(b.contextId)),
    placements: [...placements].sort((a, b) => a.order - b.order || a.placementId.localeCompare(b.placementId)),
    shadowEdges: [...shadowEdges].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
    promotedEdges: [...promotedEdges].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
    promotions: [...promotions].sort((a, b) => a.decidedAt.localeCompare(b.decidedAt) || a.promotionId.localeCompare(b.promotionId)),
    updatedAt: optionalString(input.updatedAt),
  });
}

function mutate(graphInput, operation) {
  const graph = normalizeGraph(graphInput);
  const draft = clonePlain(graph, 'Context Graph draft');
  delete draft.schema;
  operation(draft);
  draft.updatedAt = new Date().toISOString();
  return normalizeGraph(draft);
}

function upsertNode(graphInput, nodeInput) {
  const node = normalizeNode(nodeInput);
  return mutate(graphInput, draft => {
    const index = draft.nodes.findIndex(item => item.nodeId === node.nodeId);
    if (index >= 0) draft.nodes[index] = node; else draft.nodes.push(node);
  });
}

function addContext(graphInput, contextInput) {
  const context = normalizeContext(contextInput);
  return mutate(graphInput, draft => {
    if (draft.contexts.some(item => item.contextId === context.contextId)) throw new Error('Context 已存在');
    draft.contexts.push(context);
  });
}

function addPlacement(graphInput, placementInput) {
  const placement = normalizePlacement(placementInput);
  return mutate(graphInput, draft => {
    if (draft.placements.some(item => item.placementId === placement.placementId)) throw new Error('Node 已在该 Context 中');
    draft.placements.push(placement);
  });
}

function updatePlacement(graphInput, placementId, patch) {
  if (!isPlainObject(patch)) throw new Error('Placement patch 必须是对象');
  assertKnownKeys(patch, ['alias', 'note', 'order'], 'Placement patch');
  assertNoSecrets(patch, 'Placement patch');
  return mutate(graphInput, draft => {
    const index = draft.placements.findIndex(item => item.placementId === placementId);
    if (index < 0) throw new Error('Placement 不存在');
    draft.placements[index] = normalizePlacement({ ...draft.placements[index], ...patch });
  });
}

function removePlacement(graphInput, placementId) {
  return mutate(graphInput, draft => {
    const before = draft.placements.length;
    draft.placements = draft.placements.filter(item => item.placementId !== placementId);
    if (draft.placements.length === before) throw new Error('Placement 不存在');
  });
}

function addShadowEdge(graphInput, edgeInput) {
  const edge = normalizeEdge(edgeInput);
  if (edge.kind === 'promoted') throw new Error('Shadow Edge 不得直接 promoted');
  return mutate(graphInput, draft => {
    if (draft.shadowEdges.some(item => item.edgeId === edge.edgeId)) throw new Error('Shadow Edge 已存在');
    draft.shadowEdges.push(edge);
  });
}

function removeShadowEdge(graphInput, edgeId) {
  return mutate(graphInput, draft => {
    const before = draft.shadowEdges.length;
    draft.shadowEdges = draft.shadowEdges.filter(item => item.edgeId !== edgeId);
    if (draft.shadowEdges.length === before) throw new Error('Shadow Edge 不存在');
  });
}

function promoteEdge(graphInput, { shadowEdgeId, authorityRef, reason, decidedAt, supersedes = '' } = {}) {
  const graph = normalizeGraph(graphInput);
  const shadow = graph.shadowEdges.find(item => item.edgeId === shadowEdgeId);
  if (!shadow) throw new Error('Shadow Edge 不存在');
  const promoted = normalizeEdge({ ...shadow, edgeId: `promoted:${shadow.edgeId}`, kind: 'promoted', authorityRef });
  const promotion = normalizePromotion({ shadowEdgeId, promotedEdgeId: promoted.edgeId, authorityRef, reason, decidedAt, supersedes });
  return mutate(graph, draft => {
    if (draft.promotedEdges.some(item => item.edgeId === promoted.edgeId)) throw new Error('Relation 已升格');
    draft.promotedEdges.push(promoted);
    draft.promotions.push(promotion);
  });
}

function emptyGraph() { return normalizeGraph({ nodes: [], contexts: [], placements: [], shadowEdges: [], promotedEdges: [], promotions: [] }); }

module.exports = {
  CONTEXT_GRAPH_SCHEMA, CONTEXT_NODE_SCHEMA, CONTEXT_SCHEMA, PLACEMENT_SCHEMA, PROMOTION_SCHEMA,
  normalizeNode, normalizeContext, normalizePlacement, normalizePromotion, normalizeGraph,
  upsertNode, addContext, addPlacement, updatePlacement, removePlacement, addShadowEdge, removeShadowEdge, promoteEdge, emptyGraph,
};
