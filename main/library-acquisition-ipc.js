// Narrow renderer bridge for W93B durable Library acquisition Inbox facts.
//
// The renderer can only consume the Inbox belonging to the currently selected
// Workspace.  It cannot open an arbitrary Store, start a transport, provide an
// artifact path, or repair acquisition locks through this bridge.
'use strict';

const fs = require('fs');
const path = require('path');

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactText(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_ACQUISITION_INVALID_IPC', `${label} must be an exact non-empty string`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  if (!isPlainRecord(value)) {
    throw codedError('LIBRARY_ACQUISITION_INVALID_IPC', `${label} must be a plain object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw codedError('LIBRARY_ACQUISITION_INVALID_IPC', `${label} contains an unsupported field`);
    }
  }
  return value;
}

function canonicalPhysicalPath(fsImpl, value) {
  const resolved = path.resolve(exactText(value, 'workspacePath'));
  const nativeRealpath = fsImpl.realpathSync?.native;
  const physical = typeof nativeRealpath === 'function'
    ? nativeRealpath(resolved)
    : fsImpl.realpathSync(resolved);
  return path.resolve(physical);
}

function sameFilesystemPath(left, right) {
  if (process.platform === 'win32') return left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US');
  return left === right;
}

function assertTrusted(event, isTrustedSender) {
  if (typeof isTrustedSender !== 'function' || isTrustedSender(event) !== true) {
    throw codedError('LIBRARY_ACQUISITION_UNTRUSTED_SENDER', 'Library acquisition IPC requires a trusted app shell');
  }
}

async function currentWorkspaceContext({ service, currentWorkspace, workspacePath: ownedWorkspacePath, fsImpl }) {
  const workspacePath = exactText(ownedWorkspacePath ?? currentWorkspace(), 'current Workspace');
  const physicalPath = canonicalPhysicalPath(fsImpl, workspacePath);
  const opened = service.openWorkspace(workspacePath);
  const recovery = await service.ensureWorkspaceRecovery(opened);
  const latestWorkspacePath = exactText(currentWorkspace(), 'current Workspace');
  const latestPhysicalPath = canonicalPhysicalPath(fsImpl, latestWorkspacePath);
  if (!sameFilesystemPath(latestPhysicalPath, physicalPath)) {
    throw codedError(
      'LIBRARY_ACQUISITION_WORKSPACE_MISMATCH',
      'current Workspace changed while acquisition recovery was settling',
    );
  }
  return {
    workspacePath,
    physicalPath,
    opened,
    recovery,
  };
}

function registerLibraryAcquisitionIpc({
  bus,
  service,
  currentWorkspace,
  isTrustedSender,
  isStartupReady = () => true,
  fsImpl = fs,
} = {}) {
  if (!bus || typeof bus.handle !== 'function') throw new TypeError('Library acquisition IPC requires an IPC bus');
  if (!service || typeof service.openWorkspace !== 'function'
      || typeof service.ensureWorkspaceRecovery !== 'function'
      || typeof service.listInbox !== 'function' || typeof service.completeInbox !== 'function') {
    throw new TypeError('Library acquisition IPC requires LibraryAcquisitionService');
  }
  if (typeof currentWorkspace !== 'function') throw new TypeError('Library acquisition IPC requires currentWorkspace');

  bus.handle('library:acquisitionInboxList', async (payload, event) => {
    assertTrusted(event, isTrustedSender);
    if (isStartupReady() !== true) {
      throw codedError('LIBRARY_ACQUISITION_STARTUP_HOLD', 'Library acquisition startup recovery is not complete');
    }
    const request = exactKeys(payload, new Set(['workspacePath', 'state']), 'Inbox list request');
    if (request.state !== 'pending') {
      throw codedError('LIBRARY_ACQUISITION_INVALID_IPC', 'renderer may only list pending Inbox receipts');
    }
    const requestedPath = path.resolve(exactText(request.workspacePath, 'workspacePath'));
    const ownedWorkspacePath = exactText(currentWorkspace(), 'current Workspace');
    const resolvedOwnedWorkspacePath = path.resolve(ownedWorkspacePath);
    // Reject an arbitrary renderer path before any realpath/stat probe. Only
    // the main-owned current Workspace is allowed to reach the filesystem.
    if (!sameFilesystemPath(requestedPath, resolvedOwnedWorkspacePath)) {
      throw codedError('LIBRARY_ACQUISITION_WORKSPACE_MISMATCH', 'Library repository is not bound to the current Workspace');
    }
    const current = await currentWorkspaceContext({
      service, currentWorkspace, workspacePath: ownedWorkspacePath, fsImpl,
    });
    const result = service.listInbox({ ...current.opened, state: 'pending' });
    // artifact.path is an immutable Store fact and must round-trip byte for
    // byte into the completion receipt. Do not rewrite Windows separators at
    // the IPC boundary; the renderer never gets authority to choose a path.
    return Object.freeze({
      workspacePath: path.resolve(current.workspacePath),
      workspaceIdentity: result.workspaceIdentity,
      workspaceToken: result.workspaceToken,
      receipts: result.receipts,
    });
  });

  bus.handle('library:acquisitionInboxCommit', async (payload, event) => {
    assertTrusted(event, isTrustedSender);
    if (isStartupReady() !== true) {
      throw codedError('LIBRARY_ACQUISITION_STARTUP_HOLD', 'Library acquisition startup recovery is not complete');
    }
    const request = exactKeys(payload, new Set([
      'receiptId', 'workspaceToken', 'bookId', 'workspaceIdentity', 'contentHash', 'path',
    ]), 'Inbox commit request');
    const current = await currentWorkspaceContext({ service, currentWorkspace, fsImpl });
    const workspaceIdentity = exactText(request.workspaceIdentity, 'workspaceIdentity');
    const workspaceToken = exactText(request.workspaceToken, 'workspaceToken');
    if (workspaceIdentity !== current.opened.workspaceIdentity
        || workspaceToken !== current.opened.workspaceToken) {
      throw codedError('LIBRARY_ACQUISITION_WORKSPACE_MISMATCH', 'Inbox capability is stale or belongs to another Workspace');
    }
    const result = await service.completeInbox({ workspaceIdentity, workspaceToken }, exactText(request.receiptId, 'receiptId'), {
      receiptId: request.receiptId,
      bookId: exactText(request.bookId, 'bookId'),
      workspaceIdentity,
      contentHash: exactText(request.contentHash, 'contentHash'),
      path: exactText(request.path, 'path'),
    });
    return result;
  });

  return Object.freeze({
    channels: Object.freeze(['library:acquisitionInboxList', 'library:acquisitionInboxCommit']),
  });
}

async function initializeCurrentLibraryAcquisition({
  service,
  currentWorkspace,
  repairOrphanLocks = true,
  recoverAfterRestart = true,
} = {}) {
  if (!service || typeof service.openWorkspace !== 'function') {
    throw new TypeError('Library acquisition startup requires LibraryAcquisitionService');
  }
  if (typeof currentWorkspace !== 'function') throw new TypeError('Library acquisition startup requires currentWorkspace');
  const opened = service.openWorkspace(exactText(currentWorkspace(), 'current Workspace'));
  if (typeof service.ensureWorkspaceRecovery === 'function') {
    return service.ensureWorkspaceRecovery(opened, { repairOrphanLocks, recoverAfterRestart });
  }
  const actions = [];
  if (repairOrphanLocks) {
    actions.push(Object.freeze({ action: 'LOCK_REPAIR', result: await service.repairOrphanLocks(opened) }));
  }
  if (recoverAfterRestart) actions.push(...await service.recoverAfterRestart(opened));
  else actions.push(...await service.reconcileWorkspace(opened));
  return Object.freeze({ ...opened, actions: Object.freeze(actions) });
}

module.exports = {
  registerLibraryAcquisitionIpc,
  initializeCurrentLibraryAcquisition,
  _forTests: { canonicalPhysicalPath, sameFilesystemPath },
};
