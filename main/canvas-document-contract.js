'use strict';

const crypto = require('crypto');
const capability = require('./capability-execution-contract');

const DOCUMENT_SCHEMA = 'mazz.canvas-document/v1';
const RECORD_SCHEMA = 'mazz.canvas-record/v1';
const OPERATION_SCHEMA = 'mazz.canvas-operation/v1';
const RECEIPT_SCHEMA = 'mazz.canvas-operation-receipt/v1';
const EXPORT_SCHEMA = 'mazz.canvas-export/v1';
const NODE_KINDS = Object.freeze(['rect', 'ellipse', 'path', 'text', 'image', 'group']);
const OPERATION_KINDS = Object.freeze(['insert', 'update', 'remove', 'reorder', 'set-selection', 'replace-document']);
const HEX = /^#[0-9a-f]{6}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ACTOR_REF = /^(?:human|agent):[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function error(code, message, details = {}) { return capability.codedError(code, message, details); }
function plain(value) { return capability.isPlainRecord(value); }
function exactText(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim() || CONTROL.test(value)) throw error('CANVAS_CONTRACT_INVALID', `${label} 必须是精确非空字符串`);
  return value;
}
function optionalText(value, label) {
  if (value === undefined || value === null || value === '') return '';
  return exactText(value, label);
}
function safeId(value, label) {
  const text = exactText(value, label);
  if (!SAFE_ID.test(text) || text === '.' || text === '..') throw error('CANVAS_CONTRACT_INVALID', `${label} 不是安全标识`);
  return text;
}
function positiveInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw error('CANVAS_CONTRACT_INVALID', `${label} 必须是正整数`);
  return value;
}
function finiteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw error('CANVAS_CONTRACT_INVALID', `${label} 必须是有限数值`);
  return Object.is(value, -0) ? 0 : value;
}
function color(value, label, fallback = '#000000') {
  const text = value === undefined ? fallback : exactText(value, label);
  if (!HEX.test(text)) throw error('CANVAS_CONTRACT_INVALID', `${label} 必须是 #RRGGBB 实色`);
  return text.toLowerCase();
}
function clone(value, label = 'value') { return capability.clonePortable(value, label); }
function canonical(value) { return capability.canonical(value); }
function hash(value) { return `sha256-${crypto.createHash('sha256').update(typeof value === 'string' ? value : capability.canonicalJson(value)).digest('hex')}`; }
function assertNoSecrets(value, label) { capability.assertNoSecrets(value, label); capability.assertNoPrivateLocators(value, label); }
function exactKeys(value, allowed, label) { return capability.exactKeys(value, allowed, label); }

function normalizePoints(value, label = 'points') {
  if (!Array.isArray(value)) throw error('CANVAS_CONTRACT_INVALID', `${label} 必须是数组`);
  return value.map((point, index) => {
    exactKeys(point, ['x', 'y'], `${label}[${index}]`);
    return Object.freeze({ x: finiteNumber(point.x, `${label}[${index}].x`), y: finiteNumber(point.y, `${label}[${index}].y`) });
  });
}

function normalizeNode(input, { partial = false, label = 'node' } = {}) {
  if (!plain(input)) throw error('CANVAS_CONTRACT_INVALID', `${label} 必须是普通对象`);
  const allowed = ['nodeId', 'kind', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'fill', 'stroke', 'strokeWidth', 'text', 'points', 'assetRef', 'children'];
  exactKeys(input, allowed, label);
  if (partial && input.nodeId !== undefined) safeId(input.nodeId, `${label}.nodeId`);
  if (!partial || input.nodeId !== undefined) safeId(input.nodeId, `${label}.nodeId`);
  if (!partial || input.kind !== undefined) {
    const kind = exactText(input.kind, `${label}.kind`);
    if (!NODE_KINDS.includes(kind)) throw error('CANVAS_CONTRACT_INVALID', `${label}.kind 不支持`);
  }
  const output = {};
  const fields = ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'strokeWidth'];
  for (const field of fields) if (input[field] !== undefined) output[field] = finiteNumber(input[field], `${label}.${field}`, { min: ['width', 'height', 'strokeWidth'].includes(field) ? 0 : (field === 'opacity' ? 0 : -Infinity), max: field === 'opacity' ? 1 : Infinity });
  if (!partial) {
    for (const field of ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'strokeWidth']) if (output[field] === undefined) output[field] = field === 'opacity' ? 1 : (field === 'strokeWidth' ? 1 : 0);
  }
  if (input.visible !== undefined) { if (typeof input.visible !== 'boolean') throw error('CANVAS_CONTRACT_INVALID', `${label}.visible 必须是 boolean`); output.visible = input.visible; }
  else if (!partial) output.visible = true;
  if (input.fill !== undefined) output.fill = color(input.fill, `${label}.fill`);
  else if (!partial) output.fill = '#ffffff';
  if (input.stroke !== undefined) output.stroke = color(input.stroke, `${label}.stroke`);
  else if (!partial) output.stroke = '#000000';
  if (input.text !== undefined) { if (typeof input.text !== 'string' || CONTROL.test(input.text)) throw error('CANVAS_CONTRACT_INVALID', `${label}.text 必须是纯文本`); output.text = input.text; }
  else if (!partial) output.text = '';
  if (input.points !== undefined) output.points = normalizePoints(input.points, `${label}.points`);
  else if (!partial) output.points = [];
  if (input.assetRef !== undefined) {
    if (input.assetRef !== null && (typeof input.assetRef !== 'string' || !/^artifact-sha256-[0-9a-f]{64}$/.test(input.assetRef))) throw error('CANVAS_ASSET_REF_INVALID', `${label}.assetRef 必须是已持久 Artifact Ref`);
    output.assetRef = input.assetRef;
  } else if (!partial) output.assetRef = null;
  if (input.children !== undefined) {
    if (!Array.isArray(input.children)) throw error('CANVAS_CONTRACT_INVALID', `${label}.children 必须是数组`);
    output.children = input.children.map((id, index) => safeId(id, `${label}.children[${index}]`));
    if (new Set(output.children).size !== output.children.length) throw error('CANVAS_CONTRACT_INVALID', `${label}.children 不能重复`);
  } else if (!partial) output.children = [];
  if (partial) {
    if (input.nodeId !== undefined) output.nodeId = safeId(input.nodeId, `${label}.nodeId`);
    if (input.kind !== undefined) output.kind = exactText(input.kind, `${label}.kind`);
    return Object.freeze(output);
  }
  return Object.freeze({ nodeId: safeId(input.nodeId, `${label}.nodeId`), kind: exactText(input.kind, `${label}.kind`), ...output });
}

function normalizeLayer(input, label = 'layer') {
  exactKeys(input, ['layerId', 'name', 'visible', 'opacity', 'nodeIds'], label);
  const nodeIds = capability.exactStringList(input.nodeIds, `${label}.nodeIds`).map((id, index) => safeId(id, `${label}.nodeIds[${index}]`));
  return Object.freeze({
    layerId: safeId(input.layerId, `${label}.layerId`),
    name: exactText(input.name, `${label}.name`),
    visible: input.visible === undefined ? true : (typeof input.visible === 'boolean' ? input.visible : (() => { throw error('CANVAS_CONTRACT_INVALID', `${label}.visible 必须是 boolean`); })()),
    opacity: finiteNumber(input.opacity === undefined ? 1 : input.opacity, `${label}.opacity`, { min: 0, max: 1 }),
    nodeIds,
  });
}

function normalizeDocument(input, { durable = false } = {}) {
  if (!plain(input)) throw error('CANVAS_CONTRACT_INVALID', 'Canvas Document 必须是普通对象');
  exactKeys(input, ['schema', 'documentId', 'workspaceIdentity', 'revision', 'title', 'width', 'height', 'background', 'layers', 'nodes', 'selection', 'headOperationId'], 'Canvas Document');
  if (input.schema !== DOCUMENT_SCHEMA) throw error('CANVAS_SCHEMA_UNSUPPORTED', 'Canvas Document schema 不支持');
  const doc = {
    schema: DOCUMENT_SCHEMA,
    documentId: safeId(input.documentId, 'documentId'),
    workspaceIdentity: safeId(input.workspaceIdentity, 'workspaceIdentity'),
    revision: positiveInt(input.revision, 'revision'),
    title: typeof input.title === 'string' && !CONTROL.test(input.title) ? input.title : (() => { throw error('CANVAS_CONTRACT_INVALID', 'title 必须是纯文本'); })(),
    width: finiteNumber(input.width, 'width', { min: 1 }),
    height: finiteNumber(input.height, 'height', { min: 1 }),
    background: color(input.background, 'background', '#ffffff'),
    layers: Array.isArray(input.layers) ? input.layers.map((row, i) => normalizeLayer(row, `layers[${i}]`)) : (() => { throw error('CANVAS_CONTRACT_INVALID', 'layers 必须是数组'); })(),
    nodes: {},
    selection: capability.exactStringList(input.selection, 'selection').map((id, i) => safeId(id, `selection[${i}]`)),
    headOperationId: input.headOperationId === null ? null : safeId(input.headOperationId, 'headOperationId'),
  };
  if (new Set(doc.layers.map(layer => layer.layerId)).size !== doc.layers.length) throw error('CANVAS_REFERENCE_INVALID', 'layerId 不能重复');
  if (!plain(input.nodes)) throw error('CANVAS_CONTRACT_INVALID', 'nodes 必须是普通对象');
  for (const [key, value] of Object.entries(input.nodes)) {
    const node = normalizeNode(value, { label: `nodes.${key}` });
    if (key !== node.nodeId) throw error('CANVAS_CONTRACT_INVALID', 'nodes key 与 nodeId 不一致');
    if (doc.nodes[key]) throw error('CANVAS_CONTRACT_INVALID', 'nodeId 重复');
    doc.nodes[key] = node;
  }
  const seen = new Set();
  for (const layer of doc.layers) for (const nodeId of layer.nodeIds) {
    if (!doc.nodes[nodeId] || seen.has(nodeId)) throw error('CANVAS_REFERENCE_INVALID', 'layer.nodeIds 必须引用唯一存在节点');
    seen.add(nodeId);
  }
  for (const nodeId of Object.keys(doc.nodes)) if (!seen.has(nodeId)) throw error('CANVAS_REFERENCE_INVALID', '每个 node 必须属于一个 layer');
  for (const nodeId of doc.selection) if (!doc.nodes[nodeId]) throw error('CANVAS_REFERENCE_INVALID', 'selection 引用了不存在节点');
  for (const node of Object.values(doc.nodes)) if (node.kind === 'group') {
    const parentLayer = doc.layers.find(layer => layer.nodeIds.includes(node.nodeId));
    for (const childId of node.children) {
      if (!doc.nodes[childId] || childId === node.nodeId) throw error('CANVAS_REFERENCE_INVALID', 'group children 引用非法或自环');
      const childLayer = doc.layers.find(layer => layer.nodeIds.includes(childId));
      if (!parentLayer || parentLayer.layerId !== childLayer?.layerId) throw error('CANVAS_REFERENCE_INVALID', 'group children 必须位于同一 layer');
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visitGroup = nodeId => {
    if (visiting.has(nodeId)) throw error('CANVAS_REFERENCE_INVALID', 'group children 不能形成环');
    if (visited.has(nodeId)) return;
    const node = doc.nodes[nodeId];
    if (!node || node.kind !== 'group') { visited.add(nodeId); return; }
    visiting.add(nodeId);
    for (const childId of node.children) visitGroup(childId);
    visiting.delete(nodeId); visited.add(nodeId);
  };
  for (const node of Object.values(doc.nodes)) if (node.kind === 'group') visitGroup(node.nodeId);
  assertNoSecrets(doc, 'Canvas Document');
  if (durable && (!input.revision || !input.workspaceIdentity)) throw error('CANVAS_DURABLE_CORRUPT', 'durable Canvas Document 缺少 revision/workspaceIdentity');
  doc.nodes = Object.fromEntries(Object.entries(doc.nodes).sort(([a], [b]) => a.localeCompare(b, 'en')));
  return Object.freeze(doc);
}

function normalizeActor(input) {
  exactKeys(input, ['kind', 'ref'], 'actor');
  const kind = exactText(input.kind, 'actor.kind');
  if (!['human', 'agent'].includes(kind)) throw error('CANVAS_CONTRACT_INVALID', 'actor.kind 不支持');
  const ref = capability.opaqueRef(input.ref, 'actor.ref');
  if (!ACTOR_REF.test(ref) || !ref.startsWith(`${kind}:`)) throw error(kind === 'human' ? 'CANVAS_AUTHORITY_REQUIRED' : 'CANVAS_CONTRACT_INVALID', `${kind} actor.ref 必须是无路径不透明标识`);
  return Object.freeze({ kind, ref });
}

function normalizeOperation(input) {
  exactKeys(input, ['schema', 'operationId', 'documentId', 'expectedRevision', 'actor', 'kind', 'affectedIds', 'precondition', 'payload'], 'Canvas Operation');
  if (input.schema !== OPERATION_SCHEMA) throw error('CANVAS_SCHEMA_UNSUPPORTED', 'Canvas Operation schema 不支持');
  const kind = exactText(input.kind, 'operation.kind');
  if (!OPERATION_KINDS.includes(kind)) throw error('CANVAS_OPERATION_INVALID', 'operation.kind 不支持');
  const operation = {
    schema: OPERATION_SCHEMA,
    operationId: safeId(input.operationId, 'operationId'),
    documentId: safeId(input.documentId, 'documentId'),
    expectedRevision: positiveInt(input.expectedRevision, 'expectedRevision'),
    actor: normalizeActor(input.actor),
    kind,
    affectedIds: capability.exactStringList(input.affectedIds, 'affectedIds').map((id, i) => safeId(id, `affectedIds[${i}]`)),
    precondition: plain(input.precondition) ? clone(input.precondition, 'precondition') : (() => { throw error('CANVAS_CONTRACT_INVALID', 'precondition 必须是普通对象'); })(),
    payload: plain(input.payload) ? clone(input.payload, 'payload') : (() => { throw error('CANVAS_CONTRACT_INVALID', 'payload 必须是普通对象'); })(),
  };
  assertNoSecrets(operation, 'Canvas Operation');
  return Object.freeze(operation);
}

function normalizeRecord(input, { durable = false } = {}) {
  exactKeys(input, ['schema', 'document', 'history', 'redoStack', 'receipts', 'updatedAt'], 'Canvas Record');
  if (input.schema !== RECORD_SCHEMA) throw error('CANVAS_SCHEMA_UNSUPPORTED', 'Canvas Record schema 不支持');
  const document = normalizeDocument(input.document, { durable });
  if (!Array.isArray(input.history) || !Array.isArray(input.redoStack) || !Array.isArray(input.receipts)) throw error('CANVAS_DURABLE_CORRUPT', 'Canvas Record history/redo/receipts 必须是数组');
  const receipts = input.receipts.map(row => normalizeReceipt(row, { durable }));
  if (new Set(receipts.map(row => row.receiptId)).size !== receipts.length) throw error('CANVAS_DURABLE_CORRUPT', 'receiptId 不能重复');
  const normalizeEntry = (entry, label) => {
    exactKeys(entry, ['operation', 'inverse', 'receipt'], label);
    const operation = normalizeOperation(entry.operation);
    const receipt = normalizeReceipt(entry.receipt, { durable });
    if (operation.documentId !== document.documentId || receipt.documentId !== document.documentId || receipt.operationId !== operation.operationId) throw error('CANVAS_DURABLE_CORRUPT', `${label} document/operation linkage invalid`);
    if (operation.expectedRevision !== receipt.beforeRevision || receipt.afterRevision !== receipt.beforeRevision + 1) throw error('CANVAS_DURABLE_CORRUPT', `${label} revision linkage invalid`);
    if (receipt.operationHash !== hash(operation)) throw error('CANVAS_DURABLE_CORRUPT', `${label} operationHash linkage invalid`);
    const inverse = clone(entry.inverse, `${label}.inverse`);
    assertNoSecrets(inverse, `${label}.inverse`);
    return { operation, inverse, receipt };
  };
  const history = Array.isArray(input.history) ? input.history.map((row, index) => normalizeEntry(row, `history[${index}]`)) : (() => { throw error('CANVAS_DURABLE_CORRUPT', 'history 必须是数组'); })();
  const redoStack = Array.isArray(input.redoStack) ? input.redoStack.map((row, index) => normalizeEntry(row, `redoStack[${index}]`)) : (() => { throw error('CANVAS_DURABLE_CORRUPT', 'redoStack 必须是数组'); })();
  const allEntries = [...history, ...redoStack];
  if (new Set(allEntries.map(row => row.operation.operationId)).size !== allEntries.length) throw error('CANVAS_DURABLE_CORRUPT', 'history/redo operationId 不能重复');
  if (new Set(allEntries.map(row => row.receipt.receiptId)).size !== allEntries.length) throw error('CANVAS_DURABLE_CORRUPT', 'history/redo receiptId 不能重复');
  for (const receipt of receipts) if (receipt.documentId !== document.documentId || receipt.afterRevision > document.revision) throw error('CANVAS_DURABLE_CORRUPT', 'receipt 与当前 document revision 不一致');
  if (typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt))) throw error('CANVAS_DURABLE_CORRUPT', 'Canvas Record updatedAt 非法');
  return Object.freeze({ schema: RECORD_SCHEMA, document, history, redoStack, receipts, updatedAt: input.updatedAt });
}

function normalizeReceipt(input, { durable = false } = {}) {
  exactKeys(input, ['schema', 'receiptId', 'documentId', 'operationId', 'operationHash', 'beforeRevision', 'afterRevision', 'actor', 'affectedIds', 'documentHash', 'inverseHash', 'kind', 'createdAt'], 'Canvas Receipt');
  if (input.schema !== RECEIPT_SCHEMA) throw error('CANVAS_SCHEMA_UNSUPPORTED', 'Canvas Receipt schema 不支持');
  const receipt = { schema: RECEIPT_SCHEMA, receiptId: safeId(input.receiptId, 'receiptId'), documentId: safeId(input.documentId, 'receipt.documentId'), operationId: safeId(input.operationId, 'receipt.operationId'), operationHash: capability.normalizeHash(input.operationHash, 'operationHash'), beforeRevision: positiveInt(input.beforeRevision, 'beforeRevision'), afterRevision: positiveInt(input.afterRevision, 'afterRevision'), actor: normalizeActor(input.actor), affectedIds: capability.exactStringList(input.affectedIds, 'receipt.affectedIds').map((id, i) => safeId(id, `receipt.affectedIds[${i}]`)), documentHash: capability.normalizeHash(input.documentHash, 'documentHash'), inverseHash: capability.normalizeHash(input.inverseHash, 'inverseHash'), kind: exactText(input.kind, 'receipt.kind'), createdAt: exactText(input.createdAt, 'createdAt') };
  if (!Number.isFinite(Date.parse(receipt.createdAt)) || new Date(receipt.createdAt).toISOString() !== receipt.createdAt) throw error('CANVAS_DURABLE_CORRUPT', 'receipt.createdAt 必须是规范 ISO 时间');
  if (receipt.afterRevision !== receipt.beforeRevision + 1) throw error('CANVAS_DURABLE_CORRUPT', 'receipt revision 不连续');
  if (durable && !input.receiptId) throw error('CANVAS_DURABLE_CORRUPT', 'durable receipt 缺失 receiptId');
  return Object.freeze(receipt);
}

function normalizeExport(input) {
  exactKeys(input, ['schema', 'exportId', 'documentId', 'revision', 'documentHash', 'contentHash', 'storageRef', 'size', 'contentSchema', 'createdAt'], 'Canvas Export');
  if (input.schema !== EXPORT_SCHEMA) throw error('CANVAS_SCHEMA_UNSUPPORTED', 'Canvas Export schema 不支持');
  if (input.contentSchema !== 'mazz.canvas-svg/v1') throw error('CANVAS_EXPORT_INVALID', 'export.contentSchema 不支持');
  const createdAt = exactText(input.createdAt, 'export.createdAt');
  if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) throw error('CANVAS_EXPORT_INVALID', 'export.createdAt 必须是规范 ISO 时间');
  return Object.freeze({ schema: EXPORT_SCHEMA, exportId: safeId(input.exportId, 'exportId'), documentId: safeId(input.documentId, 'export.documentId'), revision: positiveInt(input.revision, 'export.revision'), documentHash: capability.normalizeHash(input.documentHash, 'export.documentHash'), contentHash: capability.normalizeHash(input.contentHash, 'export.contentHash'), storageRef: capability.opaqueRef(input.storageRef, 'export.storageRef'), size: positiveInt(input.size, 'export.size'), contentSchema: 'mazz.canvas-svg/v1', createdAt });
}

function makeInitialDocument({ documentId, workspaceIdentity, title = '' } = {}) {
  const id = safeId(documentId, 'documentId');
  const identity = safeId(workspaceIdentity, 'workspaceIdentity');
  const layerId = `layer-${crypto.randomUUID()}`;
  const doc = { schema: DOCUMENT_SCHEMA, documentId: id, workspaceIdentity: identity, revision: 1, title: typeof title === 'string' ? title : '', width: 960, height: 540, background: '#ffffff', layers: [{ layerId, name: 'Layer 1', visible: true, opacity: 1, nodeIds: [] }], nodes: {}, selection: [], headOperationId: null };
  return normalizeDocument(doc);
}

function applyOperation(document, operation) {
  const doc = normalizeDocument(document);
  const op = normalizeOperation(operation);
  if (op.documentId !== doc.documentId) throw error('CANVAS_DOCUMENT_MISMATCH', 'Operation documentId 不一致');
  if (op.expectedRevision !== doc.revision) throw error('CANVAS_REVISION_CONFLICT', 'Canvas revision stale', { currentRevision: doc.revision });
  if (op.precondition?.selectionHash && op.precondition.selectionHash !== hash(doc.selection)) throw error('CANVAS_PRECONDITION_FAILED', 'selection precondition failed', { currentRevision: doc.revision });
  const next = clone(doc, 'document');
  const inverse = { schema: 'mazz.canvas-inverse/v1', kind: op.kind, payload: {} };
  const findLayer = id => next.layers.find(layer => layer.layerId === id);
  const findNode = id => next.nodes[id];
  if (op.kind === 'insert') {
    exactKeys(op.payload, ['layerId', 'node'], 'insert.payload');
    const layer = findLayer(safeId(op.payload.layerId, 'insert.layerId'));
    if (!layer) throw error('CANVAS_REFERENCE_INVALID', 'insert layer 不存在');
    const node = normalizeNode(op.payload.node, { label: 'insert.node' });
    if (findNode(node.nodeId)) throw error('CANVAS_OPERATION_CONFLICT', 'insert node 已存在');
    if (!op.affectedIds.includes(node.nodeId) || op.affectedIds.length !== 1) throw error('CANVAS_OPERATION_INVALID', 'insert affectedIds 必须是 nodeId');
    next.nodes[node.nodeId] = node;
    layer.nodeIds.push(node.nodeId);
    inverse.payload = { layerId: layer.layerId, nodeId: node.nodeId };
  } else if (op.kind === 'update') {
    exactKeys(op.payload, ['nodeId', 'patch'], 'update.payload');
    const nodeId = safeId(op.payload.nodeId, 'update.nodeId');
    if (op.affectedIds.length !== 1 || op.affectedIds[0] !== nodeId) throw error('CANVAS_OPERATION_INVALID', 'update affectedIds 不匹配');
    const current = findNode(nodeId);
    if (!current) throw error('CANVAS_REFERENCE_INVALID', 'update node 不存在');
    const patch = normalizeNode(op.payload.patch, { partial: true, label: 'update.patch' });
    if (patch.nodeId !== undefined || patch.kind !== undefined) throw error('CANVAS_OPERATION_INVALID', 'update 不得修改 nodeId/kind');
    inverse.payload = { nodeId, patch: {} };
    for (const key of Object.keys(patch)) inverse.payload.patch[key] = current[key];
    next.nodes[nodeId] = normalizeNode({ ...current, ...patch }, { label: 'updated.node' });
  } else if (op.kind === 'remove') {
    exactKeys(op.payload, ['nodeId'], 'remove.payload');
    const nodeId = safeId(op.payload.nodeId, 'remove.nodeId');
    if (op.affectedIds.length !== 1 || op.affectedIds[0] !== nodeId) throw error('CANVAS_OPERATION_INVALID', 'remove affectedIds 不匹配');
    const current = findNode(nodeId);
    if (!current) throw error('CANVAS_REFERENCE_INVALID', 'remove node 不存在');
    const layer = next.layers.find(row => row.nodeIds.includes(nodeId));
    inverse.payload = { layerId: layer.layerId, node: current };
    layer.nodeIds = layer.nodeIds.filter(id => id !== nodeId);
    delete next.nodes[nodeId];
    next.selection = next.selection.filter(id => id !== nodeId);
  } else if (op.kind === 'reorder') {
    exactKeys(op.payload, ['layerId', 'nodeIds'], 'reorder.payload');
    const layer = findLayer(safeId(op.payload.layerId, 'reorder.layerId'));
    if (!layer) throw error('CANVAS_REFERENCE_INVALID', 'reorder layer 不存在');
    const ids = capability.exactStringList(op.payload.nodeIds, 'reorder.nodeIds').map((id, i) => safeId(id, `reorder.nodeIds[${i}]`));
    if (ids.length !== layer.nodeIds.length || ids.some(id => !layer.nodeIds.includes(id))) throw error('CANVAS_REFERENCE_INVALID', 'reorder 必须覆盖当前 layer 全部 node');
    if (op.affectedIds.length !== ids.length || op.affectedIds.some(id => !ids.includes(id))) throw error('CANVAS_OPERATION_INVALID', 'reorder affectedIds 不匹配');
    inverse.payload = { layerId: layer.layerId, nodeIds: [...layer.nodeIds] };
    layer.nodeIds = ids;
  } else if (op.kind === 'set-selection') {
    exactKeys(op.payload, ['nodeIds'], 'set-selection.payload');
    const ids = capability.exactStringList(op.payload.nodeIds, 'selection.nodeIds').map((id, i) => safeId(id, `selection.nodeIds[${i}]`));
    if (ids.some(id => !findNode(id)) || op.affectedIds.length !== ids.length || op.affectedIds.some(id => !ids.includes(id))) throw error('CANVAS_REFERENCE_INVALID', 'selection 引用非法');
    inverse.payload = { nodeIds: [...next.selection] };
    next.selection = ids;
  } else if (op.kind === 'replace-document') {
    exactKeys(op.payload, ['document'], 'replace-document.payload');
    if (op.actor.kind !== 'human') throw error('CANVAS_AUTHORITY_REQUIRED', 'replace-document 必须由 human actor 提交');
    const replacement = normalizeDocument(op.payload.document);
    if (replacement.documentId !== doc.documentId || replacement.workspaceIdentity !== doc.workspaceIdentity || replacement.revision !== doc.revision) throw error('CANVAS_OPERATION_INVALID', 'replace-document 只能保留 document identity/revision');
    inverse.payload = { document: doc };
    return { next: normalizeDocument({ ...replacement, revision: doc.revision + 1, headOperationId: op.operationId }), inverse };
  }
  next.revision = doc.revision + 1;
  next.headOperationId = op.operationId;
  return { next: normalizeDocument(next), inverse };
}

module.exports = { DOCUMENT_SCHEMA, RECORD_SCHEMA, OPERATION_SCHEMA, RECEIPT_SCHEMA, EXPORT_SCHEMA, NODE_KINDS, OPERATION_KINDS, exactText, safeId, hash, normalizeNode, normalizeDocument, normalizeOperation, normalizeRecord, normalizeReceipt, normalizeExport, makeInitialDocument, applyOperation, canonicalJson: capability.canonicalJson };
