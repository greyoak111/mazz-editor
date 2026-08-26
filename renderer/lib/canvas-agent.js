// W94C narrow Canvas client: structured operations only; no DOM/Canvas command or path IPC.
export function createCanvasAgentClient({ bridge = globalThis.window?.mazz, workspacePath } = {}) {
  if (!bridge || typeof bridge.invoke !== 'function') throw new TypeError('Canvas client requires bridge');
  if (typeof workspacePath !== 'string' || !workspacePath || workspacePath !== workspacePath.trim()) throw new TypeError('Canvas client requires exact workspacePath');
  const invoke = (channel, payload = {}) => bridge.invoke(channel, { workspacePath, ...payload });
  return Object.freeze({
    create: ({ documentId, title = '' } = {}) => invoke('canvas:documentCreate', { documentId, title }),
    snapshot: documentId => invoke('canvas:documentSnapshot', { documentId }),
    list: () => invoke('canvas:documentList'),
    apply: operation => invoke('canvas:operationApply', { operation }),
    undo: ({ documentId, expectedRevision, actor } = {}) => invoke('canvas:undo', { documentId, expectedRevision, actor }),
    redo: ({ documentId, expectedRevision, actor } = {}) => invoke('canvas:redo', { documentId, expectedRevision, actor }),
    exportSvg: ({ documentId, expectedRevision, actor } = {}) => invoke('canvas:exportSvg', { documentId, expectedRevision, actor }),
    grantExport: exportId => invoke('canvas:exportGrant', { exportId }),
    receipts: documentId => invoke('canvas:receipts', { documentId }),
    exports: documentId => invoke('canvas:exports', { documentId }),
  });
}

export function makeInsertOperation({ documentId, expectedRevision, actor, layerId, node }) {
  return { schema: 'mazz.canvas-operation/v1', operationId: `canvas-op-${crypto.randomUUID()}`, documentId, expectedRevision, actor, kind: 'insert', affectedIds: [node.nodeId], precondition: {}, payload: { layerId, node } };
}

export const makeUpdateOperation = ({ documentId, expectedRevision, actor, nodeId, patch }) => ({ schema: 'mazz.canvas-operation/v1', operationId: `canvas-op-${crypto.randomUUID()}`, documentId, expectedRevision, actor, kind: 'update', affectedIds: [nodeId], precondition: {}, payload: { nodeId, patch } });
