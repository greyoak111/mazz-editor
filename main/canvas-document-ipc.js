'use strict';

const contract = require('./capability-execution-contract');

function samePath(left, right) {
  const path = require('path');
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b;
}
function assertTrusted(event, isTrustedSender) {
  if (typeof isTrustedSender !== 'function' || isTrustedSender(event) !== true) throw contract.codedError('CANVAS_UNTRUSTED_SENDER', 'Canvas IPC 只允许可信 Mazz app shell');
}
function assertReady(isStartupReady) {
  if (typeof isStartupReady !== 'function' || isStartupReady() !== true) throw contract.codedError('CANVAS_STARTUP_HOLD', 'Canvas startup recovery 尚未完成');
}
function workspace(payload, currentWorkspace) {
  const requested = contract.exactText(payload.workspacePath, 'workspacePath');
  const owned = contract.exactText(currentWorkspace(), 'current Workspace');
  if (!samePath(requested, owned)) throw contract.codedError('CANVAS_WORKSPACE_MISMATCH', 'Canvas request 不属于当前 Workspace');
  return owned;
}
function registerCanvasDocumentIpc({ bus, service, currentWorkspace, isTrustedSender, isStartupReady = () => true } = {}) {
  if (!bus || typeof bus.handle !== 'function') throw new TypeError('Canvas IPC 需要 bus');
  if (!service || typeof service.createDocument !== 'function' || typeof service.getDocument !== 'function' || typeof service.applyOperation !== 'function' || typeof service.undo !== 'function' || typeof service.redo !== 'function' || typeof service.exportSvg !== 'function' || typeof service.grantExport !== 'function') throw new TypeError('Canvas IPC 需要 CanvasDocumentService');
  const guard = (payload, event, keys) => { assertTrusted(event, isTrustedSender); assertReady(isStartupReady); const request = contract.exactKeys(payload || {}, keys, 'Canvas IPC request'); return { request, workspacePath: workspace(request, currentWorkspace) }; };
  bus.handle('canvas:documentCreate', async (payload, event) => { const { request, workspacePath } = guard(payload, event, ['workspacePath', 'documentId', 'title']); return service.createDocument({ workspacePath, documentId: request.documentId, title: request.title }); });
  bus.handle('canvas:documentSnapshot', async (payload, event) => { const { request, workspacePath } = guard(payload, event, ['workspacePath', 'documentId']); return service.getDocument({ workspacePath, documentId: request.documentId }); });
  bus.handle('canvas:documentList', async (payload, event) => { const { workspacePath } = guard(payload, event, ['workspacePath']); return service.listDocuments({ workspacePath }); });
  bus.handle('canvas:operationApply', async (payload, event) => { const { request, workspacePath } = guard(payload, event, ['workspacePath', 'operation']); return service.applyOperation({ workspacePath, operation: request.operation }); });
  bus.handle('canvas:undo', async (payload, event) => { const { request, workspacePath } = guard(payload, event, ['workspacePath', 'documentId', 'expectedRevision', 'actor']); return service.undo({ workspacePath, documentId: request.documentId, expectedRevision: request.expectedRevision, actor: request.actor }); });
  bus.handle('canvas:redo', async (payload, event) => { const { request, workspacePath } = guard(payload, event, ['workspacePath', 'documentId', 'expectedRevision', 'actor']); return service.redo({ workspacePath, documentId: request.documentId, expectedRevision: request.expectedRevision, actor: request.actor }); });
  bus.handle('canvas:exportSvg', async (payload, event) => { const { request, workspacePath } = guard(payload, event, ['workspacePath', 'documentId', 'expectedRevision', 'actor']); return service.exportSvg({ workspacePath, documentId: request.documentId, expectedRevision: request.expectedRevision, actor: request.actor }); });
  bus.handle('canvas:exportGrant', async (payload, event) => { const { request, workspacePath } = guard(payload, event, ['workspacePath', 'exportId']); return service.grantExport({ workspacePath, exportId: request.exportId }); });
  bus.handle('canvas:receipts', async (payload, event) => { const { request, workspacePath } = guard(payload, event, ['workspacePath', 'documentId']); return service.listReceipts({ workspacePath, documentId: request.documentId }); });
  bus.handle('canvas:exports', async (payload, event) => { const { request, workspacePath } = guard(payload, event, ['workspacePath', 'documentId']); return service.listExports({ workspacePath, documentId: request.documentId }); });
  return Object.freeze({ channels: Object.freeze(['canvas:documentCreate', 'canvas:documentSnapshot', 'canvas:documentList', 'canvas:operationApply', 'canvas:undo', 'canvas:redo', 'canvas:exportSvg', 'canvas:exportGrant', 'canvas:receipts', 'canvas:exports']) });
}

module.exports = { registerCanvasDocumentIpc, _forTests: { samePath, workspace } };
