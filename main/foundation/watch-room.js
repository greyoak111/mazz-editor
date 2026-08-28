'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const WATCH_ROOM_MANIFEST_SCHEMA = 'mazz.watch-room-manifest/v0';
const WATCH_ROOM_EVENT_SCHEMA = 'mazz.watch-room-event/v0';
const WATCH_ROOM_PERMISSIONS = Object.freeze({ join: 'invite', control: 'host', chat: 'members' });
const WATCH_ROOM_EVENT_KINDS = new Set([
  'play', 'pause', 'seek', 'buffer', 'rate',
  'host-transfer', 'member-join', 'member-leave', 'chat-ref', 'danmaku-ref',
]);
const CONTROL_EVENT_KINDS = new Set(['play', 'pause', 'seek', 'buffer', 'rate']);
const ROOM_STORE_KEY = 'sync.watchRooms';
const ROOM_EVENTS_PREFIX = 'sync.watchRoomEvents:';
const ROOM_EPOCHS_PREFIX = 'sync.watchRoomEpochs:';
const ROOM_MEMBER_LIMIT = 256;
const ROOM_EVENT_LIMIT = 10_000;

const WORKSPACE = /^workspace:[0-9a-f]{64}$/;
const MEDIA = /^(?:blob|transport):[0-9a-f]{64}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,511}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isPlain(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function knownKeys(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label} 包含未知字段: ${key}`);
}

function stable(value, label, pattern = REF) {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\s\r\n\t]/.test(value)
    || value.includes('://') || value.includes('..') || /[\\/]/.test(value) || !pattern.test(value)) {
    throw new Error(`${label} 不是受控引用`);
  }
  return value;
}

function id(value, prefix, label) {
  return stable(value, label, new RegExp(`^${prefix}:[A-Za-z0-9][A-Za-z0-9._~-]{1,127}$`));
}

function iso(value, label) {
  if (typeof value !== 'string' || !ISO.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`${label} 时间无效`);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value) { return crypto.createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }
function now() { return new Date().toISOString(); }
function token(prefix) { return `${prefix}:${crypto.randomBytes(12).toString('hex')}`; }
function epochForTransfer(eventId) { return `epoch:${digest({ transfer: eventId }).slice(0, 24)}`; }

function signatureBody(event) {
  const body = { ...event };
  delete body.signature;
  return body;
}

function verifyEventSignature(event) {
  return typeof event.signature === 'string' && event.signature === `sig:${digest(signatureBody(event))}`;
}

function normalizeMember(raw) {
  if (!isPlain(raw)) throw new Error('Watch Room member 必须是对象');
  knownKeys(raw, ['memberId', 'deviceId', 'role', 'joinedAt', 'status'], 'Watch Room member');
  const memberId = id(raw.memberId, 'member', 'memberId');
  const deviceId = stable(raw.deviceId, 'deviceId');
  const role = raw.role == null ? 'member' : raw.role;
  const status = raw.status == null ? 'active' : raw.status;
  if (role !== 'host' && role !== 'member') throw new Error('member role 非法');
  if (status !== 'active' && status !== 'left') throw new Error('member status 非法');
  return { memberId, deviceId, role, joinedAt: iso(raw.joinedAt, 'joinedAt'), status };
}

function normalizeManifest(input, { workspaceId } = {}) {
  if (!isPlain(input)) throw new Error('Watch Room manifest 必须是对象');
  knownKeys(input, [
    'schema', 'type', 'roomId', 'workspaceId', 'mediaRef', 'hostMemberId', 'clockEpoch',
    'members', 'permissions', 'eventCursor', 'createdAt', 'updatedAt',
  ], 'Watch Room manifest');
  if (input.schema != null && input.schema !== WATCH_ROOM_MANIFEST_SCHEMA) throw new Error('Watch Room manifest schema 非法');
  if (input.type != null && input.type !== 'watch-room') throw new Error('Watch Room manifest type 非法');
  const roomId = id(input.roomId, 'room', 'roomId');
  const actualWorkspace = stable(input.workspaceId, 'workspaceId', WORKSPACE);
  if (workspaceId != null && actualWorkspace !== workspaceId) throw new Error('Watch Room Workspace identity 不匹配');
  const mediaRef = stable(input.mediaRef, 'mediaRef', MEDIA);
  const hostMemberId = id(input.hostMemberId, 'member', 'hostMemberId');
  const clockEpoch = id(input.clockEpoch, 'epoch', 'clockEpoch');
  if (!Array.isArray(input.members) || input.members.length === 0 || input.members.length > ROOM_MEMBER_LIMIT) throw new Error('Watch Room members 无效');
  const members = input.members.map(normalizeMember);
  const memberIds = new Set();
  for (const member of members) {
    if (memberIds.has(member.memberId)) throw new Error('Watch Room memberId 重复');
    memberIds.add(member.memberId);
  }
  const host = members.find(member => member.memberId === hostMemberId);
  if (!host || host.status !== 'active' || host.role !== 'host') throw new Error('Watch Room host 必须是 active host member');
  for (const member of members) if (member.memberId !== hostMemberId && member.role !== 'member') throw new Error('非 host member role 非法');
  if (!isPlain(input.permissions)) throw new Error('Watch Room permissions 无效');
  knownKeys(input.permissions, ['join', 'control', 'chat'], 'Watch Room permissions');
  if (input.permissions.join !== 'invite' || input.permissions.control !== 'host' || input.permissions.chat !== 'members') throw new Error('Watch Room permissions 必须 fail-closed');
  const eventCursor = id(input.eventCursor, 'event', 'eventCursor');
  const createdAt = iso(input.createdAt, 'createdAt');
  const updatedAt = iso(input.updatedAt, 'updatedAt');
  return {
    schema: WATCH_ROOM_MANIFEST_SCHEMA,
    type: 'watch-room',
    roomId,
    workspaceId: actualWorkspace,
    mediaRef,
    hostMemberId,
    clockEpoch,
    members,
    permissions: { ...WATCH_ROOM_PERMISSIONS },
    eventCursor,
    createdAt,
    updatedAt,
  };
}

function normalizeEvent(input, { workspaceId, roomId } = {}) {
  if (!isPlain(input)) throw new Error('Watch Room event 必须是对象');
  knownKeys(input, [
    'schema', 'type', 'roomId', 'workspaceId', 'clockEpoch', 'sequence', 'eventId', 'memberId',
    'kind', 'mediaTimeMs', 'rate', 'ref', 'revision', 'signature',
  ], 'Watch Room event');
  if (input.schema != null && input.schema !== WATCH_ROOM_EVENT_SCHEMA) throw new Error('Watch Room event schema 非法');
  if (input.type != null && input.type !== 'watch-room-event') throw new Error('Watch Room event type 非法');
  const actualRoom = id(input.roomId, 'room', 'roomId');
  if (roomId != null && actualRoom !== roomId) throw new Error('Watch Room roomId 不匹配');
  const actualWorkspace = stable(input.workspaceId, 'workspaceId', WORKSPACE);
  if (workspaceId != null && actualWorkspace !== workspaceId) throw new Error('Watch Room event Workspace identity 不匹配');
  const clockEpoch = id(input.clockEpoch, 'epoch', 'clockEpoch');
  const sequence = Number(input.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Watch Room event sequence 无效');
  const eventId = id(input.eventId, 'event', 'eventId');
  const memberId = id(input.memberId, 'member', 'memberId');
  const kind = String(input.kind || '');
  if (!WATCH_ROOM_EVENT_KINDS.has(kind)) throw new Error(`Watch Room event kind 非法: ${kind}`);
  const mediaTimeMs = Number(input.mediaTimeMs);
  if (!Number.isFinite(mediaTimeMs) || mediaTimeMs < 0 || mediaTimeMs > Number.MAX_SAFE_INTEGER) throw new Error('Watch Room mediaTimeMs 无效');
  const out = {
    schema: WATCH_ROOM_EVENT_SCHEMA,
    type: 'watch-room-event',
    roomId: actualRoom,
    workspaceId: actualWorkspace,
    clockEpoch,
    sequence,
    eventId,
    memberId,
    kind,
    mediaTimeMs: Math.floor(mediaTimeMs),
    revision: id(input.revision, 'rev', 'revision'),
    signature: stable(input.signature, 'signature', /^sig:[0-9a-f]{64}$/),
  };
  if (input.rate != null) {
    const rate = Number(input.rate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 16) throw new Error('Watch Room rate 无效');
    out.rate = rate;
  }
  if (input.ref != null) out.ref = stable(input.ref, 'ref');
  if ((kind === 'chat-ref' || kind === 'danmaku-ref' || kind === 'member-join' || kind === 'member-leave' || kind === 'host-transfer') && !out.ref) {
    throw new Error(`${kind} 必须只携带受控 ref`);
  }
  if ((kind === 'chat-ref' && !/^chat:/.test(out.ref)) || (kind === 'danmaku-ref' && !/^danmaku:/.test(out.ref))) throw new Error('chat/danmaku 只能携带来源引用');
  if (kind === 'host-transfer' && !/^member:/.test(out.ref)) throw new Error('host-transfer ref 必须是 member 引用');
  if ((kind === 'member-join' || kind === 'member-leave') && !/^member:/.test(out.ref)) throw new Error('member 事件 ref 必须是 member 引用');
  if (!verifyEventSignature(out)) throw new Error('Watch Room event signature rejected');
  return out;
}

function createEvent(input = {}) {
  const body = {
    ...input,
    schema: WATCH_ROOM_EVENT_SCHEMA,
    type: 'watch-room-event',
  };
  if (!body.signature) body.signature = `sig:${digest(signatureBody(body))}`;
  return normalizeEvent(body);
}

function eventKey(event) { return `${event.clockEpoch}:${event.sequence}`; }

class WatchRoomService {
  constructor({ store, workspace, memberIdentity } = {}) {
    if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') throw new Error('Watch Room 需要可持久化 store');
    this.store = store;
    this.workspace = workspace;
    this.memberIdentity = typeof memberIdentity === 'function' ? memberIdentity : () => String(memberIdentity || 'local-device');
  }

  workspaceId() {
    const raw = typeof this.workspace === 'function' ? this.workspace() : this.workspace;
    try { return `workspace:${crypto.createHash('sha256').update(path.resolve(String(raw || '')).toLocaleLowerCase('en-US')).digest('hex')}`; }
    catch { return ''; }
  }

  ownMemberId() {
    return `member:${crypto.createHash('sha256').update(`${this.workspaceId()}\0${this.memberIdentity()}`, 'utf8').digest('hex').slice(0, 32)}`;
  }

  _roomMap() {
    const rows = this.store.get(ROOM_STORE_KEY, {});
    return isPlain(rows) ? rows : {};
  }

  _events(roomId) {
    const rows = this.store.get(`${ROOM_EVENTS_PREFIX}${roomId}`, []);
    return Array.isArray(rows) ? rows : [];
  }

  _save(manifest, events, epochs) {
    const map = this._roomMap();
    map[manifest.roomId] = manifest;
    this.store.set(ROOM_STORE_KEY, map);
    this.store.set(`${ROOM_EVENTS_PREFIX}${manifest.roomId}`, events);
    if (Array.isArray(epochs) && epochs.length) this.store.set(`${ROOM_EPOCHS_PREFIX}${manifest.roomId}`, [...new Set(epochs)]);
  }

  _epochOrder(roomId, currentEpoch) {
    const stored = this.store.get(`${ROOM_EPOCHS_PREFIX}${roomId}`, []);
    const epochs = Array.isArray(stored) ? stored.filter(value => typeof value === 'string') : [];
    if (currentEpoch && !epochs.includes(currentEpoch)) epochs.push(currentEpoch);
    return epochs;
  }

  _newMember(memberId = this.ownMemberId(), deviceId = this.memberIdentity(), role = 'member') {
    return normalizeMember({ memberId, deviceId, role, joinedAt: now(), status: 'active' });
  }

  _baseManifest({ roomId = token('room'), mediaRef, memberId = this.ownMemberId(), deviceId = this.memberIdentity() } = {}) {
    if (!MEDIA.test(String(mediaRef || ''))) throw new Error('mediaRef 必须是 blob/transport identity');
    const stamp = now();
    return normalizeManifest({
      schema: WATCH_ROOM_MANIFEST_SCHEMA, type: 'watch-room', roomId,
      workspaceId: this.workspaceId(), mediaRef, hostMemberId: memberId,
      clockEpoch: token('epoch'), members: [this._newMember(memberId, deviceId, 'host')],
      permissions: WATCH_ROOM_PERMISSIONS, eventCursor: token('event'), createdAt: stamp, updatedAt: stamp,
    }, { workspaceId: this.workspaceId() });
  }

  createRoom(input = {}) {
    const manifest = this._baseManifest(input);
    if (this._roomMap()[manifest.roomId]) throw new Error('Watch Room roomId 已存在');
    this._save(manifest, [], [manifest.clockEpoch]);
    return manifest;
  }

  getRoom(roomId) {
    const raw = this._roomMap()[String(roomId || '')];
    if (!raw) return null;
    try { return normalizeManifest(raw, { workspaceId: this.workspaceId() }); } catch { return null; }
  }

  listRooms() { return Object.values(this._roomMap()).map(row => { try { return normalizeManifest(row, { workspaceId: this.workspaceId() }); } catch { return null; } }).filter(Boolean); }

  roomEvents(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return [];
    return this._events(room.roomId).map(row => { try { return normalizeEvent(row, { workspaceId: room.workspaceId, roomId: room.roomId }); } catch { return null; } }).filter(Boolean);
  }

  _orderedEvents(roomId) {
    const room = this.getRoom(roomId);
    const order = this._epochOrder(roomId, room?.clockEpoch);
    const epochs = new Map(order.map((epoch, index) => [epoch, index]));
    for (const event of this.roomEvents(roomId)) if (!epochs.has(event.clockEpoch)) epochs.set(event.clockEpoch, epochs.size);
    return this.roomEvents(roomId).sort((a, b) => (epochs.get(a.clockEpoch) - epochs.get(b.clockEpoch)) || (a.sequence - b.sequence) || a.eventId.localeCompare(b.eventId));
  }

  _nextSequence(roomId, epoch) {
    const events = this.roomEvents(roomId).filter(event => event.clockEpoch === epoch);
    return events.reduce((max, event) => Math.max(max, event.sequence), 0) + 1;
  }

  _member(room, memberId) { return room.members.find(member => member.memberId === memberId); }

  _append(room, raw, { allowNewMember = false } = {}) {
    const events = this.roomEvents(room.roomId);
    const event = normalizeEvent(raw, { workspaceId: room.workspaceId, roomId: room.roomId });
    if (event.clockEpoch !== room.clockEpoch) throw new Error('Watch Room stale clock epoch');
    if (event.sequence !== this._nextSequence(room.roomId, room.clockEpoch)) throw new Error('Watch Room sequence 必须单调递增');
    const actor = this._member(room, event.memberId);
    const target = event.ref && /^member:/.test(event.ref) ? event.ref : null;
    if (event.kind === 'member-join') {
      if (!target || (target !== event.memberId && this._member(room, target))) throw new Error('member-join target 非法');
      if (!actor && !allowNewMember) throw new Error('member-join actor 未配对');
      if (!actor) room.members.push(this._newMember(target, target, 'member'));
    } else if (!actor || actor.status !== 'active') throw new Error('Watch Room member 未加入');
    if (CONTROL_EVENT_KINDS.has(event.kind) && event.memberId !== room.hostMemberId) throw new Error('只有当前 host 可以控制播放');
    if (event.kind === 'member-leave' && target !== event.memberId) throw new Error('member-leave 只能由本人发出');
    if (event.kind === 'host-transfer') {
      if (event.memberId !== room.hostMemberId) throw new Error('只有当前 host 可以转移控制权');
      const next = this._member(room, target);
      if (!next || next.status !== 'active') throw new Error('host-transfer target 未加入');
    }
    const index = new Map(events.map(row => [eventKey(row), row]));
    if (index.has(eventKey(event))) throw new Error('Watch Room sequence duplicate');
    events.push(event);
    if (event.kind === 'member-join') {
      const targetMember = this._member(room, target);
      targetMember.status = 'active';
    } else if (event.kind === 'member-leave') {
      this._member(room, event.memberId).status = 'left';
    } else if (event.kind === 'host-transfer') {
      for (const member of room.members) member.role = member.memberId === target ? 'host' : 'member';
      room.hostMemberId = target;
      room.clockEpoch = epochForTransfer(event.eventId);
    }
    room.eventCursor = event.eventId;
    room.updatedAt = now();
    const normalized = normalizeManifest(room, { workspaceId: this.workspaceId() });
    if (events.length > ROOM_EVENT_LIMIT) throw new Error('Watch Room event store resource limit');
    const epochs = this._epochOrder(room.roomId, room.clockEpoch);
    if (!epochs.includes(event.clockEpoch)) epochs.push(event.clockEpoch);
    if (!epochs.includes(normalized.clockEpoch)) epochs.push(normalized.clockEpoch);
    this._save(normalized, events, epochs);
    return { manifest: normalized, event };
  }

  appendEvent({ roomId, kind, mediaTimeMs = 0, rate, ref, memberId = this.ownMemberId(), revision = token('rev') } = {}) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Watch Room 不存在');
    const eventId = token('event');
    const body = { roomId: room.roomId, workspaceId: room.workspaceId, clockEpoch: room.clockEpoch, sequence: this._nextSequence(room.roomId, room.clockEpoch), eventId, memberId, kind, mediaTimeMs, revision };
    if (rate != null) body.rate = rate;
    if (ref != null) body.ref = ref;
    body.signature = `sig:${digest({ ...body, schema: WATCH_ROOM_EVENT_SCHEMA, type: 'watch-room-event' })}`;
    return this._append(room, { ...body, schema: WATCH_ROOM_EVENT_SCHEMA, type: 'watch-room-event' }, { allowNewMember: kind === 'member-join' });
  }

  joinRoom({ manifest, paired = false, memberId = this.ownMemberId(), deviceId = this.memberIdentity() } = {}) {
    if (!paired) throw new Error('Watch Room 只接受显式配对邀请');
    const incoming = normalizeManifest(manifest, { workspaceId: this.workspaceId() });
    let room = this.getRoom(incoming.roomId);
    if (!room) { room = incoming; this._save(room, [], [room.clockEpoch]); }
    else if (room.mediaRef !== incoming.mediaRef || room.workspaceId !== incoming.workspaceId) throw new Error('Watch Room manifest identity 冲突');
    const existing = this._member(room, memberId);
    if (existing?.status === 'active') return room;
    if (existing) { existing.status = 'active'; existing.deviceId = stable(deviceId, 'deviceId'); }
    else room.members.push(this._newMember(memberId, deviceId));
    if (room.members.length > ROOM_MEMBER_LIMIT) throw new Error('Watch Room member store resource limit');
    // Persist the membership before appending its join fact.  appendEvent
    // reloads the durable manifest, so an in-memory-only member would make a
    // legitimate join look unpaired on the very next validation step.
    this._save(normalizeManifest(room, { workspaceId: this.workspaceId() }), this.roomEvents(room.roomId));
    const event = this.appendEvent({ roomId: room.roomId, kind: 'member-join', mediaTimeMs: 0, ref: memberId, memberId });
    return event.manifest;
  }

  leaveRoom({ roomId, memberId = this.ownMemberId() } = {}) {
    return this.appendEvent({ roomId, kind: 'member-leave', mediaTimeMs: 0, ref: memberId, memberId });
  }

  transferHost({ roomId, targetMemberId, memberId = this.ownMemberId() } = {}) {
    return this.appendEvent({ roomId, kind: 'host-transfer', mediaTimeMs: 0, ref: targetMemberId, memberId });
  }

  mergeRemote({ rooms = [], workspaceId, paired = false } = {}) {
    if (!paired) return { accepted: 0, duplicates: 0, rejected: [{ reason: 'explicit-pairing-required' }] };
    if (workspaceId !== this.workspaceId()) return { accepted: 0, duplicates: 0, rejected: [{ reason: 'workspace-mismatch' }] };
    const result = { accepted: 0, duplicates: 0, rejected: [] };
    for (const raw of Array.isArray(rooms) ? rooms : []) {
      try {
        const manifest = normalizeManifest(raw.manifest, { workspaceId: this.workspaceId() });
        const incomingEvents = Array.isArray(raw.events) ? raw.events : [];
        let room = this.getRoom(manifest.roomId);
        if (!room) {
          for (const eventRaw of incomingEvents) normalizeEvent(eventRaw, { workspaceId: this.workspaceId(), roomId: manifest.roomId });
          const epochs = [];
          for (const event of incomingEvents) if (!epochs.includes(event.clockEpoch)) epochs.push(event.clockEpoch);
          if (!epochs.includes(manifest.clockEpoch)) epochs.push(manifest.clockEpoch);
          this._save(manifest, incomingEvents, epochs);
          room = manifest;
          result.accepted += incomingEvents.length;
        } else if (room.mediaRef !== manifest.mediaRef) throw new Error('media identity conflict');
        const known = new Map(this.roomEvents(room.roomId).map(event => [eventKey(event), event]));
        const pending = incomingEvents.map(event => normalizeEvent(event, { workspaceId: this.workspaceId(), roomId: room.roomId }));
        // Replay one epoch at a time.  A lexical sort of opaque epoch IDs can
        // place a post-transfer event before the transfer that authorizes it.
        // The current epoch is the only admissible next group; transfer then
        // deterministically opens the next epoch.
        for (let i = pending.length - 1; i >= 0; i--) {
          const prior = known.get(eventKey(pending[i]));
          if (!prior) continue;
          if (prior.eventId !== pending[i].eventId || prior.signature !== pending[i].signature) throw new Error('sequence conflict');
          pending.splice(i, 1);
          result.duplicates++;
        }
        while (pending.length) {
          const currentEpoch = room.clockEpoch;
          const batch = pending.filter(event => event.clockEpoch === currentEpoch)
            .sort((a, b) => a.sequence - b.sequence || a.eventId.localeCompare(b.eventId));
          if (!batch.length) throw new Error('Watch Room stale or unknown clock epoch');
          for (const event of batch) {
            const index = pending.indexOf(event);
            if (index >= 0) pending.splice(index, 1);
            const applied = this._append(room, event, { allowNewMember: event.kind === 'member-join' });
            room = applied.manifest;
            known.set(eventKey(event), event);
            result.accepted++;
          }
        }
        if (!this._member(room, this.ownMemberId())) this.joinRoom({ manifest: room, paired: true });
      } catch (error) { result.rejected.push({ roomId: String(raw?.manifest?.roomId || ''), reason: error.message }); }
    }
    return result;
  }

  exportRooms() { return this.listRooms().map(manifest => ({ manifest, events: this.roomEvents(manifest.roomId) })); }

  replay(roomId) {
    const manifest = this.getRoom(roomId);
    if (!manifest) return null;
    return { manifest, events: this._orderedEvents(roomId), cursor: manifest.eventCursor };
  }
}

module.exports = {
  WATCH_ROOM_MANIFEST_SCHEMA,
  WATCH_ROOM_EVENT_SCHEMA,
  WATCH_ROOM_EVENT_KINDS,
  WATCH_ROOM_PERMISSIONS,
  ROOM_STORE_KEY,
  ROOM_EVENTS_PREFIX,
  normalizeMember,
  normalizeManifest,
  normalizeEvent,
  createEvent,
  verifyEventSignature,
  WatchRoomService,
};
