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

function exactKeys(value, allowed, label) {
  if (!isPlainRecord(value) || Object.keys(value).some(key => !allowed.has(key))) {
    throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID_IPC', `${label} 必须是严格普通对象`);
  }
  return value;
}

function exactText(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID_IPC', `${label} 必须是原生精确字符串`);
  }
  return value;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32'
    ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b;
}

function realpath(fsImpl, target) {
  const native = fsImpl.realpathSync?.native;
  return path.resolve(typeof native === 'function' ? native(target) : fsImpl.realpathSync(target));
}

function assertTrusted(event, isTrustedSender) {
  if (typeof isTrustedSender !== 'function' || isTrustedSender(event) !== true) {
    throw codedError('LIBRARY_RESOURCE_SURFACE_UNTRUSTED_SENDER', 'Library resource IPC requires a trusted app shell');
  }
}

async function currentWorkspace(payload, { currentWorkspace: owner, fsImpl }) {
  const requested = path.resolve(exactText(payload.workspacePath, 'workspacePath'));
  const owned = path.resolve(exactText(owner(), 'current Workspace'));
  // Reject renderer-controlled paths before realpath/stat probes.
  if (!samePath(requested, owned)) {
    throw codedError('LIBRARY_RESOURCE_SURFACE_WORKSPACE_MISMATCH', 'Library resource view is not bound to current Workspace');
  }
  const physical = realpath(fsImpl, owned);
  return Object.freeze({ requested, owned, physical });
}

function registerLibraryResourceSurfaceIpc({
  bus,
  service,
  currentWorkspace: owner,
  isTrustedSender,
  isStartupReady = () => true,
  fsImpl = fs,
} = {}) {
  if (!bus || typeof bus.handle !== 'function') throw new TypeError('Library resource IPC requires bus');
  if (!service || typeof service.snapshot !== 'function' || typeof service.search !== 'function') {
    throw new TypeError('Library resource IPC requires LibraryResourceSurfaceService');
  }
  if (typeof owner !== 'function') throw new TypeError('Library resource IPC requires currentWorkspace');

  const gate = async (payload, event, allowed, label) => {
    assertTrusted(event, isTrustedSender);
    if (isStartupReady() !== true) {
      throw codedError('LIBRARY_RESOURCE_SURFACE_STARTUP_HOLD', 'Library acquisition startup recovery is not complete');
    }
    const request = exactKeys(payload, allowed, label);
    const before = await currentWorkspace(request, { currentWorkspace: owner, fsImpl });
    return { request, before };
  };

  const assertStillCurrent = before => {
    const latest = path.resolve(exactText(owner(), 'current Workspace'));
    if (!samePath(latest, before.owned) || !samePath(realpath(fsImpl, latest), before.physical)) {
      throw codedError('LIBRARY_RESOURCE_SURFACE_WORKSPACE_MISMATCH', 'Workspace changed during resource operation');
    }
  };

  bus.handle('library:resourceSnapshot', async (payload, event) => {
    const { before } = await gate(payload, event, new Set(['workspacePath']), 'resource snapshot');
    const result = await service.snapshot(before.owned);
    assertStillCurrent(before);
    return result;
  });

  bus.handle('library:resourceConfigure', async (payload, event) => {
    const { request, before } = await gate(payload, event, new Set([
      'workspacePath', 'contact', 'jurisdiction', 'opds',
    ]), 'resource configure');
    const result = service.configure({
      contact: request.contact,
      jurisdiction: request.jurisdiction,
      opds: request.opds,
    });
    assertStillCurrent(before);
    return result;
  });

  bus.handle('library:resourceSearch', async (payload, event) => {
    const { request, before } = await gate(payload, event, new Set([
      'workspacePath', 'query', 'providers', 'continuations',
    ]), 'resource search');
    const result = await service.search(before.owned, {
      query: request.query,
      providers: request.providers,
      continuations: request.continuations,
    });
    assertStillCurrent(before);
    return result;
  });

  bus.handle('library:resourceManual', async (payload, event) => {
    const { request, before } = await gate(payload, event, new Set([
      'workspacePath', 'url', 'format', 'title', 'authors', 'language',
    ]), 'manual resource');
    const result = await service.addManual(before.owned, {
      url: request.url,
      format: request.format,
      title: request.title,
      authors: request.authors,
      language: request.language,
    });
    assertStillCurrent(before);
    return result;
  });

  bus.handle('library:resourceTorrentInspect', async (payload, event) => {
    const { request, before } = await gate(payload, event, new Set([
      'workspacePath', 'inspectionId', 'magnet', 'p2pConsent',
    ]), 'torrent inspect');
    const result = await service.inspectTorrent(before.owned, {
      inspectionId: request.inspectionId,
      magnet: request.magnet,
      p2pConsent: request.p2pConsent,
    });
    assertStillCurrent(before);
    return result;
  });

  bus.handle('library:resourceTorrentCancelInspect', async (payload, event) => {
    const { request, before } = await gate(payload, event, new Set([
      'workspacePath', 'inspectionId',
    ]), 'torrent inspect cancel');
    const result = await service.cancelTorrentInspect(before.owned, {
      inspectionId: request.inspectionId,
    });
    assertStillCurrent(before);
    return result;
  });

  bus.handle('library:resourceTorrentAcquire', async (payload, event) => {
    const { request, before } = await gate(payload, event, new Set([
      'workspacePath', 'candidateId', 'candidateFingerprint', 'offerId', 'selectedFile',
      'intentId', 'p2pConsent', 'rightsConfirmed',
    ]), 'torrent acquire');
    const result = await service.acquireTorrent(before.owned, {
      candidateId: request.candidateId,
      candidateFingerprint: request.candidateFingerprint,
      offerId: request.offerId,
      selectedFile: request.selectedFile,
      ...(request.intentId === undefined ? {} : { intentId: request.intentId }),
      p2pConsent: request.p2pConsent,
      rightsConfirmed: request.rightsConfirmed,
    });
    assertStillCurrent(before);
    return result;
  });

  bus.handle('library:resourceAcquire', async (payload, event) => {
    const { request, before } = await gate(payload, event, new Set([
      'workspacePath', 'candidateId', 'candidateFingerprint', 'offerId', 'intentId',
    ]), 'resource acquire');
    const result = await service.acquire(before.owned, {
      candidateId: request.candidateId,
      candidateFingerprint: request.candidateFingerprint,
      offerId: request.offerId,
      ...(request.intentId === undefined ? {} : { intentId: request.intentId }),
    });
    assertStillCurrent(before);
    return result;
  });

  bus.handle('library:resourceAction', async (payload, event) => {
    const { request, before } = await gate(payload, event, new Set([
      'workspacePath', 'jobId', 'expectedRevision', 'action', 'p2pConsent',
    ]), 'resource action');
    const result = await service.action(before.owned, {
      jobId: request.jobId,
      expectedRevision: request.expectedRevision,
      action: request.action,
      ...(request.p2pConsent === undefined ? {} : { p2pConsent: request.p2pConsent }),
    });
    assertStillCurrent(before);
    return result;
  });

  bus.handle('library:resourceRepair', async (payload, event) => {
    const { before } = await gate(payload, event, new Set(['workspacePath']), 'resource repair');
    const result = await service.repair(before.owned);
    assertStillCurrent(before);
    return result;
  });

  return Object.freeze({ channels: Object.freeze([
    'library:resourceSnapshot',
    'library:resourceConfigure',
    'library:resourceSearch',
    'library:resourceManual',
    'library:resourceTorrentInspect',
    'library:resourceTorrentCancelInspect',
    'library:resourceTorrentAcquire',
    'library:resourceAcquire',
    'library:resourceAction',
    'library:resourceRepair',
  ]) });
}

module.exports = {
  registerLibraryResourceSurfaceIpc,
  _forTests: { samePath, realpath },
};
