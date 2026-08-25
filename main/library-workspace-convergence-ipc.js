'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.has(key))) {
    throw codedError('LIBRARY_CONVERGENCE_INVALID_IPC', `${label} 必须是严格普通对象`);
  }
  return value;
}

function exactText(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_CONVERGENCE_INVALID_IPC', `${label} 必须是原生精确字符串`);
  }
  return value;
}

function canonical(fsImpl, value) {
  const resolved = path.resolve(exactText(value, 'workspacePath'));
  const native = fsImpl.realpathSync?.native;
  return path.resolve(typeof native === 'function' ? native(resolved) : fsImpl.realpathSync(resolved));
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32'
    ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b;
}

function workspaceToken(workspacePath) {
  return crypto.createHash('sha256').update(path.resolve(workspacePath).toLocaleLowerCase('en-US')).digest('hex');
}

function registerLibraryWorkspaceConvergenceIpc({
  bus,
  service,
  currentWorkspace,
  isTrustedSender,
  isStartupReady = () => true,
  fsImpl = fs,
} = {}) {
  if (!bus || typeof bus.handle !== 'function') throw new TypeError('Library convergence IPC requires bus');
  if (!service || typeof service.save !== 'function') throw new TypeError('Library convergence IPC requires service');
  if (typeof currentWorkspace !== 'function') throw new TypeError('Library convergence IPC requires currentWorkspace');

  const gate = (payload, event, allowed, label) => {
    if (typeof isTrustedSender !== 'function' || isTrustedSender(event) !== true) {
      throw codedError('LIBRARY_CONVERGENCE_UNTRUSTED_SENDER', 'Library convergence IPC requires trusted app shell');
    }
    if (isStartupReady() !== true) throw codedError('LIBRARY_CONVERGENCE_STARTUP_HOLD', 'Library startup recovery 尚未完成');
    const request = exactKeys(payload, allowed, label);
    const owned = canonical(fsImpl, currentWorkspace());
    const requested = canonical(fsImpl, request.workspacePath);
    if (!samePath(owned, requested)) throw codedError('LIBRARY_CONVERGENCE_WORKSPACE_MISMATCH', '请求不属于当前 Workspace');
    return { request, workspace: owned };
  };

  const assertCurrent = before => {
    if (!samePath(before, canonical(fsImpl, currentWorkspace()))) {
      throw codedError('LIBRARY_CONVERGENCE_WORKSPACE_MISMATCH', '操作期间 Workspace 已变化');
    }
  };

  bus.handle('library:portableCatalogSave', async (payload, event) => {
    const { request, workspace } = gate(payload, event, new Set(['workspacePath', 'snapshot']), 'catalog save');
    const result = await service.save(workspace, request.snapshot);
    assertCurrent(workspace);
    return result;
  });

  bus.handle('library:portableCatalogRebuild', async (payload, event) => {
    const { workspace } = gate(payload, event, new Set(['workspacePath']), 'catalog rebuild');
    const result = await service.rebuild(workspace);
    assertCurrent(workspace);
    return result;
  });

  bus.handle('library:derivedCachePlan', async (payload, event) => {
    const { request, workspace } = gate(payload, event, new Set(['workspacePath', 'liveBookIds']), 'cache plan');
    const result = service.planDerivedCacheGc(workspace, request.liveBookIds);
    assertCurrent(workspace);
    return result;
  });

  bus.handle('library:derivedCacheCommit', async (payload, event) => {
    const { request, workspace } = gate(payload, event, new Set(['workspacePath', 'planId', 'liveBookIds']), 'cache commit');
    const result = service.commitDerivedCacheGc(workspace, request.planId, request.liveBookIds);
    assertCurrent(workspace);
    return result;
  });

  bus.handle('library:portableAssetUrl', async (payload, event) => {
    const { request, workspace } = gate(payload, event, new Set(['workspacePath', 'path']), 'portable asset URL');
    const target = path.resolve(exactText(request.path, 'path'));
    const relative = path.relative(workspace, target).split(path.sep).join('/');
    const asset = service.openReadableAsset(workspace, relative);
    assertCurrent(workspace);
    return `mazz-res://library/${workspaceToken(workspace)}/${encodeURIComponent(asset.relativePath)}`;
  });

  return Object.freeze({ channels: Object.freeze([
    'library:portableCatalogSave', 'library:portableCatalogRebuild',
    'library:derivedCachePlan', 'library:derivedCacheCommit', 'library:portableAssetUrl',
  ]) });
}

module.exports = { registerLibraryWorkspaceConvergenceIpc, workspaceToken, samePath };
