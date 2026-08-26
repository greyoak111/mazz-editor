'use strict';

// W94Fb: durable, Workspace-scoped projection for the legacy Player transport.
// This store is intentionally smaller than the W93 book Job schema: a Player
// magnet may be a video/audio asset and therefore may not have a W93 Candidate
// or Rights Receipt yet.  It still uses the same Workspace boundary and
// revision/CAS discipline, and never exposes the transport coordinates to the
// renderer as a public projection.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contract = require('./library-resource-contract');

const SCHEMA = 'mazz.player-transport-session-store/v1';
const SESSION_SCHEMA = 'mazz.player-transport-session/v0';
const INFO_HASH = /^[a-f0-9]{40}$/;
const STATES = new Set(['queued', 'downloading', 'paused', 'completed', 'failed', 'cancelled']);

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function workspaceIdentity(workspacePath) {
  return contract.deriveWorkspaceIdentity(path.resolve(workspacePath));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw codedError('PLAYER_TRANSPORT_SESSION_CORRUPT', 'Player transport session is not an object');
  }
  if (input.schema !== SESSION_SCHEMA || typeof input.sessionId !== 'string'
      || !input.sessionId || typeof input.workspaceId !== 'string'
      || typeof input.infoHash !== 'string' || !INFO_HASH.test(input.infoHash)
      || !STATES.has(input.state) || !Number.isSafeInteger(input.revision)
      || input.revision < 1 || !Array.isArray(input.files)) {
    throw codedError('PLAYER_TRANSPORT_SESSION_CORRUPT', 'Player transport session shape is invalid');
  }
  const files = input.files.map(file => {
    if (!file || typeof file !== 'object' || typeof file.path !== 'string'
        || !Number.isSafeInteger(file.length) || file.length < 0) {
      throw codedError('PLAYER_TRANSPORT_SESSION_CORRUPT', 'Player transport session file fact is invalid');
    }
    return {
      path: file.path,
      name: typeof file.name === 'string' ? file.name : path.posix.basename(file.path),
      length: file.length,
      streamUrl: typeof file.streamUrl === 'string' ? file.streamUrl : '',
    };
  });
  return {
    schema: SESSION_SCHEMA,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    infoHash: input.infoHash,
    title: typeof input.title === 'string' ? input.title : '',
    state: input.state,
    error: typeof input.error === 'string' ? input.error : '',
    files,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date(0).toISOString(),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date(0).toISOString(),
    revision: input.revision,
  };
}

class PlayerTransportSessionStore {
  constructor({ workspacePath, fsImpl = fs, now = () => new Date() } = {}) {
    if (typeof workspacePath !== 'string' || !workspacePath) {
      throw codedError('PLAYER_TRANSPORT_WORKSPACE_REQUIRED', 'Player transport requires a Workspace path');
    }
    this.fs = fsImpl;
    this.workspacePath = path.resolve(workspacePath);
    this.workspaceId = workspaceIdentity(this.workspacePath);
    this.now = now;
    this.root = path.join(this.workspacePath, '书库', '.resources');
    this.filePath = path.join(this.root, 'player-transport-sessions.json');
    this.sessions = new Map();
    this.corruption = null;
    this._ensureLayout();
    this._load();
  }

  _ensureLayout() {
    this.fs.mkdirSync(this.root, { recursive: true });
    const rootStat = this.fs.lstatSync(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw codedError('PLAYER_TRANSPORT_WORKSPACE_INVALID', 'Player transport store root is not a directory');
    }
  }

  _load() {
    if (!this.fs.existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'));
      if (!raw || raw.schema !== SCHEMA || raw.workspaceId !== this.workspaceId || !Array.isArray(raw.sessions)) {
        throw codedError('PLAYER_TRANSPORT_SESSION_CORRUPT', 'Player transport store envelope is invalid');
      }
      for (const item of raw.sessions) {
        const record = exactRecord(item);
        if (record.workspaceId !== this.workspaceId || this.sessions.has(record.infoHash)) {
          throw codedError('PLAYER_TRANSPORT_SESSION_CORRUPT', 'Player transport store has a duplicate or foreign session');
        }
        this.sessions.set(record.infoHash, record);
      }
    } catch (error) {
      // Fail closed: do not reinterpret a corrupt file as an empty queue and
      // do not overwrite evidence.  The daemon exposes the error in its
      // runtime snapshot while keeping the app shell alive.
      this.corruption = codedError('PLAYER_TRANSPORT_SESSION_CORRUPT', 'Player transport durable state is unreadable');
      this.corruption.causeCode = error?.code || '';
      this.sessions.clear();
    }
  }

  _write() {
    if (this.corruption) throw this.corruption;
    const payload = JSON.stringify({
      schema: SCHEMA,
      workspaceId: this.workspaceId,
      sessions: [...this.sessions.values()].map(clone),
    }, null, 2);
    const temporary = `${this.filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    const fd = this.fs.openSync(temporary, 'wx', 0o600);
    try {
      this.fs.writeFileSync(fd, payload, 'utf8');
      this.fs.fsyncSync(fd);
    } finally {
      this.fs.closeSync(fd);
    }
    try {
      this.fs.renameSync(temporary, this.filePath);
    } catch (error) {
      try { this.fs.unlinkSync(temporary); } catch {}
      throw error;
    }
  }

  list() {
    return [...this.sessions.values()].map(clone);
  }

  get(infoHash) {
    const record = this.sessions.get(infoHash);
    return record ? clone(record) : null;
  }

  create({ infoHash, title = '', state = 'queued', files = [] } = {}) {
    if (!INFO_HASH.test(String(infoHash || '')) || !STATES.has(state)) {
      throw codedError('PLAYER_TRANSPORT_SESSION_INVALID', 'Player transport session identity or state is invalid');
    }
    const existing = this.sessions.get(infoHash);
    if (existing) return clone(existing);
    const at = this.now().toISOString();
    const record = exactRecord({
      schema: SESSION_SCHEMA,
      sessionId: `player-session:${infoHash}`,
      workspaceId: this.workspaceId,
      infoHash,
      title: String(title || ''),
      state,
      error: '',
      files,
      createdAt: at,
      updatedAt: at,
      revision: 1,
    });
    this.sessions.set(infoHash, record);
    this._write();
    return clone(record);
  }

  update(infoHash, expectedRevision, patch = {}) {
    const current = this.sessions.get(infoHash);
    if (!current) throw codedError('PLAYER_TRANSPORT_SESSION_NOT_FOUND', 'Player transport session does not exist');
    if (current.revision !== expectedRevision) {
      throw codedError('PLAYER_TRANSPORT_SESSION_REVISION_CONFLICT', 'Player transport session revision changed');
    }
    const next = exactRecord({
      ...current,
      ...patch,
      schema: SESSION_SCHEMA,
      workspaceId: this.workspaceId,
      infoHash,
      sessionId: current.sessionId,
      createdAt: current.createdAt,
      updatedAt: this.now().toISOString(),
      revision: current.revision + 1,
    });
    this.sessions.set(infoHash, next);
    this._write();
    return clone(next);
  }

  remove(infoHash, expectedRevision = null) {
    const current = this.sessions.get(infoHash);
    if (!current) return null;
    if (expectedRevision !== null && current.revision !== expectedRevision) {
      throw codedError('PLAYER_TRANSPORT_SESSION_REVISION_CONFLICT', 'Player transport session revision changed');
    }
    this.sessions.delete(infoHash);
    this._write();
    return clone(current);
  }
}

module.exports = PlayerTransportSessionStore;
module.exports.PlayerTransportSessionStore = PlayerTransportSessionStore;
module.exports.SCHEMA = SCHEMA;
module.exports.SESSION_SCHEMA = SESSION_SCHEMA;
module.exports._forTests = { workspaceIdentity, exactRecord };
