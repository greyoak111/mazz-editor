'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const contract = require('./canvas-document-contract');
const capability = require('./capability-execution-contract');

function coded(code, message, details = {}) { return capability.codedError(code, message, details); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowIso(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw coded('CANVAS_CLOCK_INVALID', 'Canvas clock invalid');
  return date.toISOString();
}
function physicalIdentity(stat) { return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.mode}`; }

class CanvasDocumentStore {
  constructor({ workspacePath, fsApi = fs, now = () => new Date(), randomId = () => crypto.randomUUID() } = {}) {
    this.fs = fsApi;
    this.now = now;
    this.randomId = randomId;
    if (typeof workspacePath !== 'string' || !workspacePath || workspacePath !== workspacePath.trim()) throw coded('CANVAS_WORKSPACE_INVALID', 'Canvas Workspace path invalid');
    const requested = path.resolve(workspacePath);
    if (!this.fs.existsSync(requested)) throw coded('CANVAS_WORKSPACE_MISSING', 'Canvas Workspace missing');
    this.workspacePath = this._realpath(requested);
    this._assertNoLinks(this.workspacePath);
    this.workspaceIdentity = `workspace-sha256-${capability.sha256Hex(Buffer.from(this.workspacePath, 'utf8'))}`;
    const root = path.join(this.workspacePath, '.mazz', 'canvas-documents');
    this.paths = Object.freeze({
      root,
      documents: path.join(root, 'documents'),
      receipts: path.join(root, 'receipts'),
      exports: path.join(root, 'exports'),
      locks: path.join(root, 'locks'),
      staging: path.join(root, 'staging'),
    });
    this._ensureLayout();
    this._recoverTransientState();
    this._layout = new Map(Object.values(this.paths).map(row => [row, this._fingerprint(row)]));
  }

  _recoverTransientState() {
    // Atomic writes leave only staging parts after a crash; they are never authoritative.
    for (const entry of this.fs.readdirSync(this.paths.staging, { withFileTypes: true })) {
      const target = path.join(this.paths.staging, entry.name);
      if (!entry.name.endsWith('.part')) continue;
      const stat = this.fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw coded('CANVAS_LAYOUT_UNSAFE', 'Canvas staging entry must be a regular file');
      this.fs.unlinkSync(target);
    }
    // A lock is retained only while a live process owns a document mutation. Dead owners
    // are recoverable after a crash; malformed locks fail closed instead of being guessed.
    for (const entry of this.fs.readdirSync(this.paths.locks, { withFileTypes: true })) {
      const target = path.join(this.paths.locks, entry.name);
      if (!entry.name.endsWith('.lock') || !entry.isFile()) throw coded('CANVAS_LAYOUT_UNSAFE', 'Canvas lock entry invalid');
      const stat = this.fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw coded('CANVAS_LAYOUT_UNSAFE', 'Canvas lock entry must not be a link');
      let owner;
      try { owner = JSON.parse(this.fs.readFileSync(target, 'utf8')).owner; } catch { throw coded('CANVAS_LAYOUT_UNSAFE', 'Canvas lock owner corrupt'); }
      const match = typeof owner === 'string' && /^(\d+):[A-Za-z0-9._:-]+$/.exec(owner);
      if (!match) throw coded('CANVAS_LAYOUT_UNSAFE', 'Canvas lock owner invalid');
      const pid = Number(match[1]);
      let alive = true;
      try { process.kill(pid, 0); } catch (cause) { alive = cause?.code === 'EPERM'; }
      if (!alive) this.fs.unlinkSync(target);
    }
  }

  _realpath(value) {
    const native = this.fs.realpathSync?.native;
    return path.resolve(typeof native === 'function' ? native(value) : this.fs.realpathSync(value));
  }
  _inside(value, root = this.workspacePath) {
    const a = path.resolve(value).toLocaleLowerCase();
    const b = path.resolve(root).toLocaleLowerCase();
    return a === b || a.startsWith(b + path.sep);
  }
  _assertNoLinks(value) {
    let cursor = path.resolve(value);
    const root = path.parse(cursor).root;
    const chain = [];
    while (true) {
      chain.push(cursor);
      if (cursor === root || this.fs.existsSync(cursor) === false) break;
      cursor = path.dirname(cursor);
    }
    for (const component of chain.reverse()) {
      if (!this.fs.existsSync(component)) continue;
      const stat = this.fs.lstatSync(component);
      if (stat.isSymbolicLink()) throw coded('CANVAS_LAYOUT_UNSAFE', 'Canvas path contains link/reparse component');
    }
  }
  _ensureDir(directory) {
    if (!this._inside(directory)) throw coded('CANVAS_LAYOUT_UNSAFE', 'Canvas layout outside Workspace');
    const missing = [];
    let cursor = path.resolve(directory);
    while (!this.fs.existsSync(cursor)) {
      missing.push(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) throw coded('CANVAS_LAYOUT_UNSAFE', 'Canvas layout has no safe ancestor');
      cursor = parent;
    }
    this._assertNoLinks(cursor);
    for (const item of missing.reverse()) {
      this.fs.mkdirSync(item);
      const stat = this.fs.lstatSync(item);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw coded('CANVAS_LAYOUT_UNSAFE', 'Canvas layout must be physical directory');
    }
    const stat = this.fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || this._realpath(directory) !== path.resolve(directory)) throw coded('CANVAS_LAYOUT_UNSAFE', 'Canvas layout physical identity invalid');
  }
  _ensureLayout() {
    const mazz = path.join(this.workspacePath, '.mazz');
    for (const directory of [mazz, ...Object.values(this.paths)]) this._ensureDir(directory);
  }
  _fingerprint(directory) {
    const stat = this.fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw coded('CANVAS_LAYOUT_UNSAFE', 'Canvas layout replaced');
    return `${this._realpath(directory).toLocaleLowerCase()}:${physicalIdentity(stat)}`;
  }
  _assertLayout() {
    for (const [directory, expected] of this._layout) if (this._fingerprint(directory) !== expected) throw coded('CANVAS_LAYOUT_CHANGED', 'Canvas layout physical identity changed');
  }
  _recordPath(documentId) {
    const id = contract.safeId(documentId, 'documentId');
    const target = path.join(this.paths.documents, `${id}.json`);
    if (path.dirname(target) !== this.paths.documents || path.basename(target) !== `${id}.json`) throw coded('CANVAS_PATH_INVALID', 'Canvas document path invalid');
    return target;
  }
  _receiptPath(receiptId) {
    const id = contract.safeId(receiptId, 'receiptId');
    const target = path.join(this.paths.receipts, `${id}.json`);
    if (path.dirname(target) !== this.paths.receipts) throw coded('CANVAS_PATH_INVALID', 'Canvas receipt path invalid');
    return target;
  }
  _writeAtomic(target, value) {
    this._assertLayout();
    const directory = path.dirname(target);
    if (!this._inside(target) || ![this.paths.documents, this.paths.receipts, this.paths.exports].includes(directory)) throw coded('CANVAS_PATH_INVALID', 'Canvas write target invalid');
    const temp = path.join(this.paths.staging, `canvas-${this.randomId()}.part`);
    let fd;
    let primary = null;
    try {
      fd = this.fs.openSync(temp, 'wx');
      const bytes = Buffer.from(JSON.stringify(value) + '\n', 'utf8');
      let offset = 0;
      while (offset < bytes.length) offset += this.fs.writeSync(fd, bytes, offset, bytes.length - offset);
      this.fs.fsyncSync(fd);
    } catch (error) { primary = error; }
    finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch (cleanup) { if (primary) primary.cleanupError = cleanup; else primary = cleanup; }
      }
    }
    if (primary) { try { if (this.fs.existsSync(temp)) this.fs.unlinkSync(temp); } catch {} throw primary; }
    try {
      this._assertLayout();
      this.fs.renameSync(temp, target);
      let dirFd;
      try { dirFd = this.fs.openSync(directory, 'r'); try { this.fs.fsyncSync(dirFd); } catch (fsyncError) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(fsyncError?.code) && !(process.platform === 'win32' && fsyncError?.code === 'EPERM')) throw fsyncError; } }
      finally { if (dirFd !== undefined) this.fs.closeSync(dirFd); }
    } catch (error) { try { if (this.fs.existsSync(temp)) this.fs.unlinkSync(temp); } catch (cleanup) { error.cleanupError = cleanup; } throw error; }
  }
  _readJson(target) {
    this._assertLayout();
    if (!this.fs.existsSync(target)) return null;
    const stat = this.fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw coded('CANVAS_RECORD_CORRUPT', 'Canvas record must be regular file', { path: target });
    try { return JSON.parse(this.fs.readFileSync(target, 'utf8')); } catch (cause) { throw coded('CANVAS_RECORD_CORRUPT', 'Canvas record JSON corrupt', { path: target, cause }); }
  }
  _readRecord(documentId) {
    const raw = this._readJson(this._recordPath(documentId));
    if (!raw) return null;
    try { return contract.normalizeRecord(raw, { durable: true }); } catch (cause) { throw coded('CANVAS_RECORD_CORRUPT', cause.message, { cause, documentId }); }
  }
  _lock(documentId) {
    this._assertLayout();
    const lockPath = path.join(this.paths.locks, `${contract.safeId(documentId, 'documentId')}.lock`);
    let fd;
    try { fd = this.fs.openSync(lockPath, 'wx'); this.fs.writeSync(fd, JSON.stringify({ owner: `${process.pid}:${this.randomId()}` })); this.fs.closeSync(fd); }
    catch (cause) { try { if (fd !== undefined) this.fs.closeSync(fd); } catch {} if (cause.code === 'EEXIST') throw coded('CANVAS_DOCUMENT_BUSY', 'Canvas document is busy'); throw cause; }
    return () => { try { if (this.fs.existsSync(lockPath)) this.fs.unlinkSync(lockPath); } catch (cause) { throw coded('CANVAS_LOCK_RELEASE_FAILED', cause.message, { cause }); } };
  }
  _createRecord(document) { return { schema: contract.RECORD_SCHEMA, document, history: [], redoStack: [], receipts: [], updatedAt: nowIso(this.now()) }; }
  _receipt({ document, operation, inverse, beforeRevision, kind = 'operation' }) {
    return contract.normalizeReceipt({ schema: contract.RECEIPT_SCHEMA, receiptId: `canvas-receipt-${this.randomId()}`, documentId: document.documentId, operationId: operation.operationId, operationHash: contract.hash(operation), beforeRevision, afterRevision: document.revision, actor: operation.actor, affectedIds: operation.affectedIds, documentHash: contract.hash(document), inverseHash: contract.hash(inverse), kind, createdAt: nowIso(this.now()) });
  }
  _checkPrecondition(document, operation) {
    const pre = operation.precondition || {};
    const keys = Object.keys(pre);
    if (keys.some(key => !['nodeRevisions', 'selectionHash'].includes(key))) throw coded('CANVAS_PRECONDITION_INVALID', 'unknown precondition');
    if (pre.selectionHash !== undefined && pre.selectionHash !== null && pre.selectionHash !== contract.hash(document.selection)) throw coded('CANVAS_PRECONDITION_FAILED', 'selection precondition failed', { currentRevision: document.revision });
    if (pre.nodeRevisions !== undefined) {
      if (!capability.isPlainRecord(pre.nodeRevisions)) throw coded('CANVAS_PRECONDITION_INVALID', 'nodeRevisions must be record');
      if (Object.keys(pre.nodeRevisions).length) throw coded('CANVAS_PRECONDITION_FAILED', 'node revision precondition unavailable without node revision map', { currentRevision: document.revision });
    }
  }
  _persistReceipt(receipt) { try { this._writeAtomic(this._receiptPath(receipt.receiptId), receipt); } catch (cause) { /* document record already contains the durable receipt */ } }
  createDocument({ documentId = `canvas-doc-${this.randomId()}`, title = '' } = {}) {
    this._assertLayout();
    const id = contract.safeId(documentId, 'documentId');
    const target = this._recordPath(id);
    if (this.fs.existsSync(target)) return { created: false, idempotent: true, document: this._readRecord(id).document };
    const document = contract.makeInitialDocument({ documentId: id, workspaceIdentity: this.workspaceIdentity, title });
    this._writeAtomic(target, this._createRecord(document));
    return { created: true, idempotent: false, document };
  }
  getDocument(documentId) { const record = this._readRecord(documentId); if (!record) throw coded('CANVAS_DOCUMENT_NOT_FOUND', 'Canvas document not found'); return clone(record.document); }
  getRecord(documentId) { const record = this._readRecord(documentId); if (!record) throw coded('CANVAS_DOCUMENT_NOT_FOUND', 'Canvas document not found'); return clone(record); }
  listDocuments() {
    this._assertLayout();
    const entries = this.fs.readdirSync(this.paths.documents, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue;
      const target = path.join(this.paths.documents, entry.name);
      const stat = this.fs.lstatSync(target);
      if (!entry.isFile() || stat.isSymbolicLink()) throw coded('CANVAS_RECORD_CORRUPT', 'Canvas document entry must be a regular file', { path: target });
    }
    return entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => this._readRecord(entry.name.slice(0, -5)).document).sort((a, b) => a.documentId.localeCompare(b.documentId, 'en')).map(clone);
  }
  applyOperation(input) {
    const operation = contract.normalizeOperation(input);
    const release = this._lock(operation.documentId);
    try {
      const record = this._readRecord(operation.documentId);
      if (!record) throw coded('CANVAS_DOCUMENT_NOT_FOUND', 'Canvas document not found');
      const operationHash = contract.hash(operation);
      const prior = record.receipts.find(row => row.operationId === operation.operationId);
      if (prior) {
        if (prior.operationHash === operationHash) return { idempotent: true, document: clone(record.document), receipt: clone(prior) };
        throw coded('CANVAS_OPERATION_CONFLICT', 'operationId 已用于不同 operation');
      }
      if (operation.expectedRevision !== record.document.revision) throw coded('CANVAS_REVISION_CONFLICT', 'Canvas revision stale', { currentRevision: record.document.revision, document: clone(record.document) });
      this._checkPrecondition(record.document, operation);
      const result = contract.applyOperation(record.document, operation);
      const receipt = this._receipt({ document: result.next, operation, inverse: result.inverse, beforeRevision: record.document.revision });
      const nextRecord = this._createRecord(result.next);
      nextRecord.history = [...record.history, { operation: clone(operation), inverse: clone(result.inverse), receipt: clone(receipt) }];
      nextRecord.redoStack = [];
      nextRecord.receipts = [...record.receipts, receipt];
      this._writeAtomic(this._recordPath(operation.documentId), nextRecord);
      this._persistReceipt(receipt);
      return { idempotent: false, document: clone(result.next), receipt: clone(receipt) };
    } finally { release(); }
  }
  _inverseOperation(entry, document, actor, operationId) {
    const inverse = entry.inverse;
    let kind = inverse.kind;
    let payload = inverse.payload;
    if (kind === 'insert') { kind = 'remove'; payload = { nodeId: payload.nodeId }; }
    else if (kind === 'remove') { kind = 'insert'; payload = { layerId: payload.layerId, node: payload.node }; }
    let affectedIds = entry.operation.affectedIds;
    if (kind === 'set-selection') affectedIds = payload.nodeIds;
    else if (kind === 'reorder') affectedIds = payload.nodeIds;
    else if (kind === 'replace-document') affectedIds = [];
    if (kind === 'replace-document') payload = { document: { ...payload.document, revision: document.revision } };
    return contract.normalizeOperation({ schema: contract.OPERATION_SCHEMA, operationId, documentId: document.documentId, expectedRevision: document.revision, actor, kind, affectedIds, precondition: {}, payload });
  }
  undo({ documentId, expectedRevision, actor }) {
    const id = contract.safeId(documentId, 'documentId');
    const release = this._lock(id);
    try {
      const record = this._readRecord(id);
      if (record.document.revision !== expectedRevision) throw coded('CANVAS_REVISION_CONFLICT', 'Canvas revision stale', { currentRevision: record.document.revision, document: clone(record.document) });
      const entry = record.history.at(-1);
      if (!entry) throw coded('CANVAS_UNDO_EMPTY', 'Canvas undo stack empty');
      const op = this._inverseOperation(entry, record.document, actor, `canvas-undo-${this.randomId()}`);
      const result = contract.applyOperation(record.document, op);
      const receipt = this._receipt({ document: result.next, operation: op, inverse: result.inverse, beforeRevision: record.document.revision, kind: 'undo' });
      const next = this._createRecord(result.next);
      next.history = record.history.slice(0, -1);
      next.redoStack = [...record.redoStack, entry];
      next.receipts = [...record.receipts, receipt];
      this._writeAtomic(this._recordPath(id), next); this._persistReceipt(receipt);
      return { document: clone(result.next), receipt: clone(receipt), idempotent: false };
    } finally { release(); }
  }
  redo({ documentId, expectedRevision, actor }) {
    const id = contract.safeId(documentId, 'documentId');
    const release = this._lock(id);
    try {
      const record = this._readRecord(id);
      if (record.document.revision !== expectedRevision) throw coded('CANVAS_REVISION_CONFLICT', 'Canvas revision stale', { currentRevision: record.document.revision, document: clone(record.document) });
      const entry = record.redoStack.at(-1);
      if (!entry) throw coded('CANVAS_REDO_EMPTY', 'Canvas redo stack empty');
      const redoPayload = entry.operation.kind === 'replace-document'
        ? { ...entry.operation.payload, document: { ...entry.operation.payload.document, revision: record.document.revision } }
        : entry.operation.payload;
      const op = contract.normalizeOperation({ ...entry.operation, operationId: `canvas-redo-${this.randomId()}`, expectedRevision: record.document.revision, actor, payload: redoPayload });
      const result = contract.applyOperation(record.document, op);
      const receipt = this._receipt({ document: result.next, operation: op, inverse: result.inverse, beforeRevision: record.document.revision, kind: 'redo' });
      const next = this._createRecord(result.next);
      next.history = [...record.history, { operation: clone(op), inverse: clone(result.inverse), receipt: clone(receipt) }];
      next.redoStack = record.redoStack.slice(0, -1);
      next.receipts = [...record.receipts, receipt];
      this._writeAtomic(this._recordPath(id), next); this._persistReceipt(receipt);
      return { document: clone(result.next), receipt: clone(receipt), idempotent: false };
    } finally { release(); }
  }
  listReceipts(documentId) { const record = this._readRecord(documentId); if (!record) throw coded('CANVAS_DOCUMENT_NOT_FOUND', 'Canvas document not found'); return record.receipts.map(clone); }
  putExport(input) {
    const exportRecord = contract.normalizeExport(input);
    if (!exportRecord.exportId.startsWith('canvas-export-')) throw coded('CANVAS_EXPORT_INVALID', 'exportId 必须是 Canvas export');
    const target = path.join(this.paths.exports, `${exportRecord.exportId}.json`);
    if (this.fs.existsSync(target)) {
      const existing = this._readJson(target);
      const normalized = contract.normalizeExport(existing);
      if (capability.canonicalJson(normalized) !== capability.canonicalJson(exportRecord)) throw coded('CANVAS_EXPORT_CONFLICT', 'exportId 已用于不同导出');
      return { created: false, idempotent: true, export: clone(normalized) };
    }
    this._writeAtomic(target, exportRecord);
    return { created: true, idempotent: false, export: clone(exportRecord) };
  }
  listExports(documentId = '') {
    const entries = this.fs.readdirSync(this.paths.exports, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue;
      const target = path.join(this.paths.exports, entry.name);
      const stat = this.fs.lstatSync(target);
      if (!entry.isFile() || stat.isSymbolicLink()) throw coded('CANVAS_RECORD_CORRUPT', 'Canvas export entry must be a regular file', { path: target });
    }
    const rows = entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => contract.normalizeExport(this._readJson(path.join(this.paths.exports, entry.name))));
    return rows.filter(row => !documentId || row.documentId === documentId).sort((a, b) => a.exportId.localeCompare(b.exportId, 'en')).map(clone);
  }
  snapshot() {
    this._assertLayout();
    const documents = this.listDocuments();
    const receipts = documents.reduce((sum, doc) => sum + this.listReceipts(doc.documentId).length, 0);
    return Object.freeze({ schema: 'mazz.canvas-store-snapshot/v1', workspaceIdentity: this.workspaceIdentity, documentCount: documents.length, receiptCount: receipts, exportCount: this.listExports().length, stagingCount: this.fs.readdirSync(this.paths.staging).length, activeLocks: this.fs.readdirSync(this.paths.locks).length });
  }
}

module.exports = { CanvasDocumentStore };
