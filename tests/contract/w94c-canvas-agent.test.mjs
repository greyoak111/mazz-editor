import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const contract = require('../../main/canvas-document-contract.js');
const { CanvasDocumentStore } = require('../../main/canvas-document-store.js');
const { CanvasDocumentService } = require('../../main/canvas-document-service.js');
const { CapabilityArtifactStore } = require('../../main/capability-artifact-store.js');
const { renderCanvasSvg } = require('../../main/canvas-svg-exporter.js');
const drawModel = await import('../../renderer/modules/draw/model.js');

function workspace(t, prefix = 'mazz-w94c-') {
  const requested = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const canonical = fs.realpathSync.native?.(requested) || fs.realpathSync(requested);
  t.after(() => fs.rmSync(canonical, { recursive: true, force: true }));
  return canonical;
}
function actor(kind = 'human') { return { kind, ref: `${kind}:w94c-test` }; }
function rect(nodeId, overrides = {}) {
  return { nodeId, kind: 'rect', x: 10, y: 20, width: 120, height: 60, rotation: 0, opacity: 1, visible: true, fill: '#ffffff', stroke: '#000000', strokeWidth: 1, text: '', points: [], assetRef: null, children: [], ...overrides };
}
function op({ documentId, expectedRevision, operationId = `canvas-op-${crypto.randomUUID()}`, kind = 'insert', affectedIds = [], payload = {}, actorRef = actor() }) {
  return { schema: contract.OPERATION_SCHEMA, operationId, documentId, expectedRevision, actor: actorRef, kind, affectedIds, precondition: {}, payload };
}
function initial(t) {
  const store = new CanvasDocumentStore({ workspacePath: workspace(t) });
  const created = store.createDocument({ documentId: 'canvas-doc-w94c', title: 'W94C' });
  return { store, document: created.document };
}

test('W94C contract rejects path-bearing actors and negative geometry', () => {
  assert.throws(() => contract.normalizeNode(rect('n', { width: -1 })), /有限数值|CANVAS_CONTRACT_INVALID/);
  assert.throws(() => contract.normalizeOperation(op({ documentId: 'doc', expectedRevision: 1, actorRef: { kind: 'agent', ref: 'agent:../secret' }, affectedIds: ['n'], payload: { layerId: 'l', node: rect('n') } })), /无路径|不透明/);
  assert.throws(() => contract.normalizeOperation(op({ documentId: 'doc', expectedRevision: 1, actorRef: { kind: 'human', ref: 'human:file:///tmp/x' }, affectedIds: ['n'], payload: { layerId: 'l', node: rect('n') } })), /无路径|不透明/);
});

test('W94C structured insert/update/CAS/idempotency and durable receipts', (t) => {
  const { store, document } = initial(t);
  const layerId = document.layers[0].layerId;
  const insert = op({ documentId: document.documentId, expectedRevision: 1, operationId: 'canvas-op-insert', affectedIds: ['node-a'], payload: { layerId, node: rect('node-a') } });
  const first = store.applyOperation(insert);
  assert.equal(first.document.revision, 2);
  assert.equal(store.applyOperation(insert).idempotent, true);
  assert.throws(() => store.applyOperation({ ...insert, payload: { ...insert.payload, node: rect('node-a', { x: 99 }) } }), /不同 operation|CANVAS_OPERATION_CONFLICT/);
  const updated = store.applyOperation(op({ documentId: document.documentId, expectedRevision: 2, operationId: 'canvas-op-update', kind: 'update', affectedIds: ['node-a'], payload: { nodeId: 'node-a', patch: { x: 99 } } }));
  assert.equal(updated.document.nodes['node-a'].x, 99);
  assert.throws(() => store.applyOperation(op({ documentId: document.documentId, expectedRevision: 2, operationId: 'canvas-op-stale', affectedIds: ['node-b'], payload: { layerId, node: rect('node-b') } })), /stale|REVISION/);
  const reopened = new CanvasDocumentStore({ workspacePath: store.workspacePath });
  assert.equal(reopened.getDocument(document.documentId).revision, 3);
  assert.equal(reopened.listReceipts(document.documentId).length, 2);
  assert.match(reopened.listReceipts(document.documentId)[0].operationHash, /^sha256-/);
});

test('W94C selection/reorder undo and redo preserve inverse affectedIds', (t) => {
  const { store, document } = initial(t);
  const layerId = document.layers[0].layerId;
  for (const [index, id] of ['node-a', 'node-b'].entries()) store.applyOperation(op({ documentId: document.documentId, expectedRevision: index + 1, operationId: `canvas-op-${id}`, affectedIds: [id], payload: { layerId, node: rect(id, { x: index * 10 }) } }));
  const selected = store.applyOperation(op({ documentId: document.documentId, expectedRevision: 3, operationId: 'canvas-op-select', kind: 'set-selection', affectedIds: ['node-b'], payload: { nodeIds: ['node-b'] } }));
  const undone = store.undo({ documentId: document.documentId, expectedRevision: selected.document.revision, actor: actor() });
  assert.deepEqual(undone.document.selection, []);
  const redone = store.redo({ documentId: document.documentId, expectedRevision: undone.document.revision, actor: actor() });
  assert.deepEqual(redone.document.selection, ['node-b']);
  const reordered = store.applyOperation(op({ documentId: document.documentId, expectedRevision: redone.document.revision, operationId: 'canvas-op-reorder', kind: 'reorder', affectedIds: ['node-b', 'node-a'], payload: { layerId, nodeIds: ['node-b', 'node-a'] } }));
  const reorderUndo = store.undo({ documentId: document.documentId, expectedRevision: reordered.document.revision, actor: actor() });
  assert.deepEqual(reorderUndo.document.layers[0].nodeIds, ['node-a', 'node-b']);
});

test('W94C replace-document is human-only and round-trips through undo/redo', (t) => {
  const { store, document } = initial(t);
  const replacement = { ...document, title: 'changed', layers: document.layers.map(row => ({ ...row })), nodes: {} };
  const replaced = store.applyOperation(op({ documentId: document.documentId, expectedRevision: 1, operationId: 'canvas-op-replace', kind: 'replace-document', payload: { document: replacement }, actorRef: actor() }));
  assert.equal(replaced.document.title, 'changed');
  assert.throws(() => store.applyOperation(op({ documentId: document.documentId, expectedRevision: replaced.document.revision, operationId: 'canvas-op-agent-replace', kind: 'replace-document', payload: { document: replaced.document }, actorRef: actor('agent') })), /human|AUTHORITY/);
  const undone = store.undo({ documentId: document.documentId, expectedRevision: replaced.document.revision, actor: actor() });
  assert.equal(undone.document.title, 'W94C');
  const redone = store.redo({ documentId: document.documentId, expectedRevision: undone.document.revision, actor: actor() });
  assert.equal(redone.document.title, 'changed');
});

test('W94C startup recovers orphan staging and dead locks, but rejects corrupt records', (t) => {
  const { store, document } = initial(t);
  fs.writeFileSync(path.join(store.paths.staging, 'orphan.part'), 'partial');
  fs.writeFileSync(path.join(store.paths.locks, 'dead.lock'), JSON.stringify({ owner: '999999:dead' }));
  const recovered = new CanvasDocumentStore({ workspacePath: store.workspacePath });
  assert.equal(fs.readdirSync(recovered.paths.staging).length, 0);
  assert.equal(fs.readdirSync(recovered.paths.locks).length, 0);
  fs.writeFileSync(path.join(recovered.paths.documents, `${document.documentId}.json`), '{broken');
  assert.throws(() => recovered.getDocument(document.documentId), /corrupt|CORRUPT/i);
});

test('W94C SVG export is deterministic, escaped and free of executable/external content', (t) => {
  const { document } = initial(t);
  const layerId = document.layers[0].layerId;
  const source = { ...document, layers: [{ ...document.layers[0], nodeIds: ['text-a'] }], nodes: { 'text-a': rect('text-a', { kind: 'text', text: '<W94C & safe>', width: 0, height: 0 }) } };
  const left = renderCanvasSvg(source);
  const right = renderCanvasSvg(source);
  assert.equal(left, right);
  assert.match(left, /&lt;W94C &amp; safe&gt;/);
  assert.doesNotMatch(left, /script|foreignObject|(?:href|src)="(?:https?:|data:|file:)|\son[a-z]+=/i);
  assert.equal(layerId, document.layers[0].layerId);
});

test('W94C legacy Draw adapter forks sanitized, collision-free structured nodes', () => {
  const converted = drawModel.legacyFrameToCanvasDocument({ layers: [{ id: 'layer/unsafe', name: 'Legacy', strokes: [{ id: 'same/id', pts: [{ x: 1, y: 2 }], color: '#123456', size: 3 }], shapes: [{ id: 'same/id', kind: 'text', x1: 4, y1: 5, x2: 20, y2: 30, text: '<plain>' }] }] }, { documentId: 'canvas-doc-adapter', workspaceIdentity: 'workspace-sha256-adapter' });
  const normalized = contract.normalizeDocument(converted);
  assert.equal(normalized.layers[0].layerId, 'layer-legacy-layer_unsafe');
  assert.equal(Object.keys(normalized.nodes).length, 2);
  assert.ok(Object.keys(normalized.nodes).every(id => /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)));
  assert.equal(normalized.nodes['shape-same_id'].text, '<plain>');
});

test('W94C service validates durable Artifact refs and grants one-shot SVG export', async t => {
  const workspacePath = workspace(t, 'mazz-w94c-service-');
  const service = new CanvasDocumentService();
  const created = service.createDocument({ workspacePath, documentId: 'canvas-doc-service' });
  const artifactStore = new CapabilityArtifactStore({ workspacePath });
  const published = await artifactStore.publishBytes(Buffer.from('durable image fixture'));
  const hash = published.contentHash.slice('sha256-'.length);
  const image = rect('image-a', { kind: 'image', assetRef: `artifact-sha256-${hash}` });
  const layerId = created.document.layers[0].layerId;
  const applied = await service.applyOperation({ workspacePath, operation: op({ documentId: created.document.documentId, expectedRevision: 1, operationId: 'canvas-op-image', affectedIds: ['image-a'], payload: { layerId, node: image } }) });
  assert.equal(applied.document.nodes['image-a'].assetRef, image.assetRef);
  await assert.rejects(() => service.applyOperation({ workspacePath, operation: op({ documentId: created.document.documentId, expectedRevision: 2, operationId: 'canvas-op-bad-image', affectedIds: ['image-b'], payload: { layerId, node: rect('image-b', { kind: 'image', assetRef: `artifact-sha256-${'a'.repeat(64)}` }) } }) }), /ENOENT|not found|BLOB|CAPABILITY/);
  const exported = await service.exportSvg({ workspacePath, documentId: created.document.documentId, expectedRevision: applied.document.revision });
  const grant = service.grantExport({ workspacePath, exportId: exported.export.exportId });
  const opened = await service.openExportGrant(grant.token);
  let body = '';
  opened.stream.setEncoding('utf8');
  opened.stream.on('data', chunk => { body += chunk; });
  await once(opened.stream, 'end');
  assert.match(body, /mazz\.canvas-svg\/v1/);
  await assert.rejects(() => service.openExportGrant(grant.token), /expired|GRANT/);
  const snapshot = service.snapshot({ workspacePath });
  assert.equal(snapshot.stagingCount, 0);
  service.shutdown();
});

test('W94E Canvas export records the existing human intent as approval metadata', async t => {
  const workspacePath = workspace(t, 'mazz-w94e-canvas-approval-');
  const captured = [];
  const service = new CanvasDocumentService({ eventService: { capture: input => { captured.push(input); return { recorded: true }; } } });
  const created = service.createDocument({ workspacePath, documentId: 'canvas-doc-approval' });
  const exported = await service.exportSvg({ workspacePath, documentId: created.document.documentId, expectedRevision: 1, actor: actor() });
  const approval = captured.find(row => row.outcome === 'approval');
  assert.ok(approval, 'human export intent must be durable approval metadata');
  assert.equal(approval.action, 'export');
  assert.equal(approval.objectRefs[0], `canvas:${exported.export.exportId}`);
  assert.doesNotMatch(JSON.stringify(approval), /(?:C:\\|apiKey|token|password|transcript)/i);
});
