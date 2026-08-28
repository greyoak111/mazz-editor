'use strict';

// W94Fb: an explicit Player -> W93 bridge.  It never turns a Player magnet
// into a Library Candidate.  The caller must provide an already persisted W93
// Candidate fingerprint, Offer and selected file; acquisition remains owned by
// LibraryResourceSurfaceService.

const path = require('node:path');
const PlayerTransportSessionStore = require('./player-transport-session-store');

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
    throw codedError('PLAYER_TRANSPORT_W93_BRIDGE_INVALID', `${label} must be a strict record`);
  }
  return value;
}

function exactText(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('PLAYER_TRANSPORT_W93_BRIDGE_INVALID', `${label} must be an exact string`);
  }
  return value;
}

function opaque(value, label) {
  const text = exactText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw codedError('PLAYER_TRANSPORT_W93_BRIDGE_INVALID', `${label} must be an opaque identity`);
  }
  return text;
}

function publicSession(session) {
  if (!session) return null;
  return Object.freeze({
    sessionId: session.sessionId,
    workspaceId: session.workspaceId,
    infoHash: session.infoHash,
    transportRef: session.transportRef,
    blobRef: session.blobRef,
    selectedFileRef: session.selectedFileRef,
    sourceRefs: Object.freeze([...(session.sourceRefs || [])]),
    capabilityRef: session.capabilityRef,
    title: session.title,
    state: session.state,
    error: session.error,
    files: Object.freeze((session.files || []).map(file => Object.freeze({ ...file }))),
    revision: session.revision,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}

class PlayerTransportW93Bridge {
  constructor({ resourceSurface, sessionStore, workspacePath, now = () => new Date() } = {}) {
    if (!resourceSurface || typeof resourceSurface.describeTorrentBridge !== 'function'
        || typeof resourceSurface.acquireTorrent !== 'function') {
      throw new TypeError('PlayerTransportW93Bridge requires the W93 resource surface');
    }
    if (!sessionStore || typeof sessionStore.get !== 'function'
        || typeof sessionStore.create !== 'function' || typeof sessionStore.update !== 'function') {
      throw new TypeError('PlayerTransportW93Bridge requires the durable Player session store');
    }
    this.resourceSurface = resourceSurface;
    this.sessionStore = sessionStore;
    this.workspacePath = path.resolve(exactText(workspacePath, 'workspacePath'));
    this.now = now;
  }

  async acquire(input) {
    exactKeys(input, new Set([
      'candidateId', 'candidateFingerprint', 'offerId', 'selectedFile', 'intentId',
      'p2pConsent', 'rightsConfirmed',
    ]), 'Player W93 bridge');
    const request = {
      candidateId: opaque(input.candidateId, 'candidateId'),
      candidateFingerprint: exactText(input.candidateFingerprint, 'candidateFingerprint'),
      offerId: opaque(input.offerId, 'offerId'),
      selectedFile: exactText(input.selectedFile, 'selectedFile'),
      ...(input.intentId === undefined ? {} : { intentId: opaque(input.intentId, 'intentId') }),
      p2pConsent: input.p2pConsent,
      rightsConfirmed: input.rightsConfirmed,
    };
    if (request.p2pConsent !== true || request.rightsConfirmed !== true) {
      throw codedError('PLAYER_TRANSPORT_W93_CONFIRMATION_REQUIRED', 'W93 bridge requires explicit P2P and rights confirmation');
    }

    // This lookup is read-only metadata from the durable W93 catalog.  The
    // second call revalidates the same refs and performs the existing W93 Job
    // creation; no Player network owner is started here.
    const descriptor = await this.resourceSurface.describeTorrentBridge(this.workspacePath, request);
    const transport = PlayerTransportSessionStore.deriveTransportProjection({
      infoHash: descriptor.infoHash,
      selectedFile: descriptor.selectedFile,
      declaredSize: descriptor.declaredSize,
    });
    const existing = this.sessionStore.get(descriptor.infoHash);
    if (existing && existing.sourceRefs?.some(value => String(value).startsWith('job:'))) {
      throw codedError('PLAYER_TRANSPORT_W93_BRIDGE_ALREADY_LINKED', 'Player session is already linked to a W93 Job');
    }
    if (existing && existing.workspaceId !== this.sessionStore.workspaceId) {
      throw codedError('PLAYER_TRANSPORT_W93_BRIDGE_WORKSPACE', 'Player session belongs to another Workspace');
    }
    if (existing && existing.transportRef !== 'transport:pending' && existing.transportRef !== transport.transportRef) {
      throw codedError('PLAYER_TRANSPORT_W93_BRIDGE_CONFLICT', 'Player session has a different selected-file identity');
    }
    // This is the only call that creates the W93 durable Job and starts its
    // existing book transport.  The Player daemon itself is not started.
    const acquired = await this.resourceSurface.acquireTorrent(this.workspacePath, request);
    const sourceRefs = [
      `candidate:${descriptor.candidateId}`,
      `offer:${descriptor.offerId}`,
      `job:${acquired.job.jobId}`,
    ];
    if (acquired.decision?.receipt?.evidenceRef) sourceRefs.push(`rights:${acquired.decision.receipt.evidenceRef}`);
    let session = existing;
    const file = {
      path: descriptor.selectedFile,
      name: path.posix.basename(descriptor.selectedFile),
      length: descriptor.declaredSize,
      streamUrl: '',
    };
    if (session) {
      if (session.selectedFileRef !== 'file:pending' && session.selectedFileRef !== transport.selectedFileRef) {
        throw codedError('PLAYER_TRANSPORT_W93_BRIDGE_CONFLICT', 'Player session has a different selected-file identity');
      }
      session = this.sessionStore.update(descriptor.infoHash, session.revision, {
        transportRef: transport.transportRef,
        selectedFileRef: transport.selectedFileRef,
        blobRef: 'blob:unknown',
        capabilityRef: 'none',
        sourceRefs,
        title: descriptor.title,
        files: [file],
        state: acquired.job.state === 'queued' ? 'queued' : acquired.job.state === 'paused' ? 'paused' : 'downloading',
        error: '',
      });
    } else {
      session = this.sessionStore.create({
        infoHash: descriptor.infoHash,
        title: descriptor.title,
        state: acquired.job.state === 'queued' ? 'queued' : acquired.job.state === 'paused' ? 'paused' : 'downloading',
        files: [file],
        transportRef: transport.transportRef,
        selectedFileRef: transport.selectedFileRef,
        blobRef: 'blob:unknown',
        capabilityRef: 'none',
        sourceRefs,
      });
    }
    return Object.freeze({
      bridge: 'player-w93',
      workspaceId: session.workspaceId,
      transport: Object.freeze({ ...transport }),
      session: publicSession(session),
      job: acquired.job,
      decision: acquired.decision,
    });
  }

  async refreshLinkedSessions() {
    const linked = this.sessionStore.list().filter(session =>
      session.sourceRefs?.some(value => String(value).startsWith('job:')));
    if (!linked.length) return 0;
    const snapshot = await this.resourceSurface.snapshot(this.workspacePath);
    let changed = 0;
    for (const session of linked) {
      const jobRef = session.sourceRefs.find(value => String(value).startsWith('job:'));
      const jobId = String(jobRef).slice('job:'.length);
      const job = snapshot.jobs.find(item => item.jobId === jobId);
      if (!job) continue;
      const state = job.state === 'imported' ? 'completed'
        : ['queued', 'downloading', 'paused', 'completed', 'failed', 'cancelled'].includes(job.state)
          ? job.state : session.state;
      const blobRef = job.integrity?.verified && job.integrity?.sha256
        ? `blob:sha256-${job.integrity.sha256}` : session.blobRef;
      if (state === session.state && blobRef === session.blobRef) continue;
      this.sessionStore.update(session.infoHash, session.revision, { state, blobRef });
      changed++;
    }
    return changed;
  }
}

module.exports = PlayerTransportW93Bridge;
module.exports.PlayerTransportW93Bridge = PlayerTransportW93Bridge;
module.exports._forTests = { exactKeys, exactText, opaque, publicSession };
