'use strict';

const crypto = require('crypto');
const { CanvasDocumentStore } = require('./canvas-document-store');
const { CapabilityArtifactStore } = require('./capability-artifact-store');
const { renderCanvasSvg } = require('./canvas-svg-exporter');
const contract = require('./canvas-document-contract');
const capability = require('./capability-execution-contract');
const { captureDomainEvent } = require('./foundation/domain-event-capture');

function coded(code, message, details = {}) { return capability.codedError(code, message, details); }

class CanvasDocumentService {
  constructor({ storeFactory = options => new CanvasDocumentStore(options), artifactStoreFactory = options => new CapabilityArtifactStore(options), rootProvider = null, resourceLedger = null, randomId = () => crypto.randomUUID(), eventService = null } = {}) {
    this.storeFactory = storeFactory;
    this.artifactStoreFactory = artifactStoreFactory;
    this.rootProvider = rootProvider;
    this.resourceLedger = resourceLedger;
    this.randomId = randomId;
    this.eventService = eventService;
    this.stores = new Map();
    this.artifacts = new Map();
    this.grants = new Map();
    this.accepting = true;
  }
  _workspacePath(value) {
    const selected = value === undefined || value === null || value === '' ? this.rootProvider?.() : value;
    if (typeof selected !== 'string' || !selected || selected !== selected.trim()) throw coded('CANVAS_WORKSPACE_INVALID', 'Canvas Workspace unavailable');
    return selected;
  }
  openWorkspace(workspacePath = undefined) {
    if (!this.accepting) throw coded('CANVAS_SERVICE_CLOSED', 'Canvas Service closed');
    const store = this.storeFactory({ workspacePath: this._workspacePath(workspacePath) });
    const current = this.stores.get(store.workspaceIdentity);
    if (current) return current;
    this.stores.set(store.workspaceIdentity, store);
    return store;
  }
  _store(workspacePath) { return this.openWorkspace(workspacePath); }
  _artifactStore(store) {
    let artifact = this.artifacts.get(store.workspaceIdentity);
    if (artifact) return artifact;
    artifact = this.artifactStoreFactory({ workspacePath: store.workspacePath });
    if (artifact.workspaceIdentity !== store.workspaceIdentity) throw coded('CANVAS_WORKSPACE_MISMATCH', 'Canvas Artifact Store workspace mismatch');
    this.artifacts.set(store.workspaceIdentity, artifact);
    return artifact;
  }
  createDocument({ workspacePath, documentId, title = '' } = {}) {
    try {
      const result = this._store(workspacePath).createDocument({ documentId, title });
      captureDomainEvent(this.eventService, { domain: 'canvas', action: 'create', outcome: 'success', actorType: 'human', subjectId: result.document.documentId, objectId: result.document.documentId });
      return result;
    } catch (error) {
      captureDomainEvent(this.eventService, { domain: 'canvas', action: 'create', outcome: 'failed', subjectId: documentId || 'document' });
      throw error;
    }
  }
  getDocument({ workspacePath, documentId } = {}) { return this._store(workspacePath).getDocument(documentId); }
  listDocuments({ workspacePath } = {}) { return this._store(workspacePath).listDocuments(); }
  async _assertAssetRefs(store, operation) {
    const refs = [];
    const collect = node => { if (node?.assetRef) refs.push(node.assetRef); };
    if (operation.kind === 'insert') collect(operation.payload.node);
    else if (operation.kind === 'update') collect(operation.payload.patch);
    else if (operation.kind === 'replace-document') for (const node of Object.values(operation.payload.document?.nodes || {})) collect(node);
    if (!refs.length) return;
    const unique = [...new Set(refs)];
    const artifact = this._artifactStore(store);
    for (const ref of unique) {
      const hex = ref.slice('artifact-sha256-'.length);
      const opened = await artifact.open(`capability-blob:${hex}`, { expectedHash: `sha256-${hex}` });
      opened.stream.destroy();
    }
  }
  async applyOperation({ workspacePath, operation } = {}) {
    if (!this.accepting) throw coded('CANVAS_SERVICE_CLOSED', 'Canvas Service closed');
    const normalized = contract.normalizeOperation(operation);
    const store = this._store(workspacePath);
    try {
      await this._assertAssetRefs(store, normalized);
      const result = store.applyOperation(normalized);
      captureDomainEvent(this.eventService, { domain: 'canvas', action: 'operation', outcome: 'success', actorType: normalized.actor?.kind || 'human', subjectId: normalized.documentId, objectId: normalized.operationId });
      return result;
    } catch (error) {
      captureDomainEvent(this.eventService, { domain: 'canvas', action: 'operation', outcome: 'failed', actorType: normalized.actor?.kind || 'system', subjectId: normalized.documentId, objectId: normalized.operationId });
      throw error;
    }
  }
  undo({ workspacePath, documentId, expectedRevision, actor } = {}) {
    try {
      const result = this._store(workspacePath).undo({ documentId, expectedRevision, actor });
      captureDomainEvent(this.eventService, { domain: 'canvas', action: 'undo', outcome: 'success', actorType: actor?.kind || 'human', subjectId: documentId });
      return result;
    } catch (error) {
      captureDomainEvent(this.eventService, { domain: 'canvas', action: 'undo', outcome: 'failed', actorType: actor?.kind || 'system', subjectId: documentId || 'document' });
      throw error;
    }
  }
  redo({ workspacePath, documentId, expectedRevision, actor } = {}) {
    try {
      const result = this._store(workspacePath).redo({ documentId, expectedRevision, actor });
      captureDomainEvent(this.eventService, { domain: 'canvas', action: 'redo', outcome: 'success', actorType: actor?.kind || 'human', subjectId: documentId });
      return result;
    } catch (error) {
      captureDomainEvent(this.eventService, { domain: 'canvas', action: 'redo', outcome: 'failed', actorType: actor?.kind || 'system', subjectId: documentId || 'document' });
      throw error;
    }
  }
  listReceipts({ workspacePath, documentId } = {}) { return this._store(workspacePath).listReceipts(documentId); }
  listExports({ workspacePath, documentId } = {}) { return this._store(workspacePath).listExports(documentId); }
  async exportSvg({ workspacePath, documentId, expectedRevision, actor = { kind: 'human', ref: 'human:canvas-export' } } = {}) {
    if (!this.accepting) throw coded('CANVAS_SERVICE_CLOSED', 'Canvas Service closed');
    const store = this._store(workspacePath);
    const document = store.getDocument(documentId);
    if (expectedRevision !== undefined && expectedRevision !== document.revision) throw coded('CANVAS_REVISION_CONFLICT', 'Canvas export revision stale', { currentRevision: document.revision, document });
    const exportId = `canvas-export-${this.randomId()}`;
    if (actor?.kind === 'human') {
      captureDomainEvent(this.eventService, {
        domain: 'canvas', action: 'export', outcome: 'approval', actorType: 'human',
        subjectId: document.documentId, objectId: exportId,
        idempotencyKey: `w94e:canvas:export:approval:${exportId}`,
      });
    }
    let svg;
    let artifact;
    try {
      svg = renderCanvasSvg(document);
      artifact = await this._artifactStore(store).publishBytes(Buffer.from(svg, 'utf8'));
    } catch (error) {
      captureDomainEvent(this.eventService, { domain: 'canvas', action: 'export', outcome: 'failed', actorType: actor?.kind || 'human', subjectId: document.documentId });
      throw error;
    }
    const exportRecord = contract.normalizeExport({
      schema: contract.EXPORT_SCHEMA,
      exportId,
      documentId: document.documentId,
      revision: document.revision,
      documentHash: contract.hash(document),
      contentHash: artifact.contentHash,
      storageRef: artifact.storageRef,
      size: artifact.size,
      contentSchema: 'mazz.canvas-svg/v1',
      createdAt: new Date().toISOString(),
    });
    const stored = store.putExport(exportRecord);
    captureDomainEvent(this.eventService, { domain: 'canvas', action: 'export', outcome: 'success', actorType: actor?.kind || 'human', subjectId: document.documentId, objectId: exportRecord.exportId });
    return Object.freeze({ export: stored.export, artifact: { contentHash: artifact.contentHash, storageRef: artifact.storageRef, size: artifact.size, contentSchema: 'mazz.canvas-svg/v1' }, document });
  }
  grantExport({ workspacePath, exportId } = {}) {
    const store = this._store(workspacePath);
    const exportRecord = store.listExports().find(row => row.exportId === contract.safeId(exportId, 'exportId'));
    if (!exportRecord) throw coded('CANVAS_EXPORT_NOT_FOUND', 'Canvas export not found');
    const token = `canvas-grant-${this.randomId()}`;
    this.grants.set(token, { workspaceIdentity: store.workspaceIdentity, exportRecord, expiresAt: Date.now() + 60_000 });
    return Object.freeze({ token, url: `mazz-res://canvas-artifact/${token}`, contentHash: exportRecord.contentHash, contentSchema: exportRecord.contentSchema, size: exportRecord.size });
  }
  async openExportGrant(token) {
    if (typeof token !== 'string' || !token.startsWith('canvas-grant-')) throw coded('CANVAS_GRANT_INVALID', 'Canvas grant invalid');
    const grant = this.grants.get(token);
    if (!grant || grant.expiresAt < Date.now()) { this.grants.delete(token); throw coded('CANVAS_GRANT_EXPIRED', 'Canvas grant expired'); }
    this.grants.delete(token);
    const store = this.stores.get(grant.workspaceIdentity);
    if (!store) throw coded('CANVAS_WORKSPACE_NOT_OPEN', 'Canvas workspace closed');
    const opened = await this._artifactStore(store).open(grant.exportRecord.storageRef, { expectedHash: grant.exportRecord.contentHash });
    return Object.freeze({ stream: opened.stream, size: opened.size, contentHash: opened.contentHash, contentSchema: grant.exportRecord.contentSchema });
  }
  snapshot({ workspacePath } = {}) { return this._store(workspacePath).snapshot(); }
  snapshotAll() { return Object.freeze([...this.stores.values()].map(store => store.snapshot())); }
  shutdown() { this.accepting = false; this.grants.clear(); return Object.freeze({ closed: true, snapshots: this.snapshotAll() }); }
}

module.exports = { CanvasDocumentService };
