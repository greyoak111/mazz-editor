import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const LanSync = require('../../main/lansync.js');
const {
  WatchRoomService,
  normalizeManifest,
  normalizeEvent,
  WATCH_ROOM_MANIFEST_SCHEMA,
  WATCH_ROOM_EVENT_SCHEMA,
} = require('../../main/foundation/watch-room.js');

const memStore = () => {
  const map = new Map();
  return { get: (key, fallback) => map.has(key) ? map.get(key) : fallback, set: (key, value) => map.set(key, value) };
};

function workspace(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `mazz-room-${name}-`)); }
function mediaRef() { return `blob:${'a'.repeat(64)}`; }

describe('W94Fd Local/LAN Watch Room', () => {
  test('manifest/event strictness：拒绝路径、URL、正文、未知字段和坏签名', () => {
    const service = new WatchRoomService({ store: memStore(), workspace: '/tmp/room-strict', memberIdentity: () => 'strict-device' });
    const manifest = service.createRoom({ mediaRef: mediaRef() });
    assert.throws(() => normalizeManifest({ ...manifest, extra: 'body' }));
    assert.throws(() => normalizeManifest({ ...manifest, mediaRef: 'http://example.test/media' }));
    const event = service.appendEvent({ roomId: manifest.roomId, kind: 'play', mediaTimeMs: 12 }).event;
    assert.equal(event.schema, WATCH_ROOM_EVENT_SCHEMA);
    assert.throws(() => normalizeEvent({ ...event, text: '聊天正文' }));
    assert.throws(() => normalizeEvent({ ...event, signature: 'sig:deadbeef' }));
    assert.equal(manifest.schema, WATCH_ROOM_MANIFEST_SCHEMA);
  });

  test('media-clock 重放：play/pause/seek/buffer/rate 顺序稳定，重复帧幂等', () => {
    const service = new WatchRoomService({ store: memStore(), workspace: '/tmp/room-clock', memberIdentity: () => 'clock-device' });
    const room = service.createRoom({ mediaRef: mediaRef() });
    for (const [kind, at, rate] of [['play', 0], ['seek', 1200], ['pause', 2400], ['buffer', 2400], ['rate', 2400, 1.25]]) {
      service.appendEvent({ roomId: room.roomId, kind, mediaTimeMs: at, ...(rate ? { rate } : {}) });
    }
    const replay = service.replay(room.roomId);
    assert.deepEqual(replay.events.map(event => event.kind), ['play', 'seek', 'pause', 'buffer', 'rate']);
    const duplicate = service.mergeRemote({ workspaceId: service.workspaceId(), paired: true, rooms: [{ manifest: replay.manifest, events: replay.events }] });
    assert.equal(duplicate.rejected.length, 0);
    assert.equal(duplicate.duplicates, replay.events.length);
  });

  test('显式配对成员、host transfer 与权限 fail-closed', () => {
    const store = memStore();
    const host = new WatchRoomService({ store, workspace: '/tmp/room-members', memberIdentity: () => 'host-device' });
    const room = host.createRoom({ mediaRef: mediaRef() });
    const guestId = 'member:' + 'b'.repeat(32);
    assert.throws(() => host.joinRoom({ manifest: room, memberId: guestId }));
    const joined = host.joinRoom({ manifest: room, paired: true, memberId: guestId, deviceId: 'guest-device' });
    assert.equal(joined.members.filter(member => member.status === 'active').length, 2);
    assert.throws(() => host.appendEvent({ roomId: room.roomId, kind: 'seek', mediaTimeMs: 9, memberId: guestId }));
    const transferred = host.transferHost({ roomId: room.roomId, targetMemberId: guestId });
    assert.equal(transferred.manifest.hostMemberId, guestId);
    assert.notEqual(transferred.manifest.clockEpoch, room.clockEpoch);
    assert.throws(() => host.appendEvent({ roomId: room.roomId, kind: 'pause', mediaTimeMs: 10, memberId: host.ownMemberId() }));
    host.appendEvent({ roomId: room.roomId, kind: 'chat-ref', mediaTimeMs: 10, ref: 'chat:message-1', memberId: guestId });
    assert.throws(() => host.appendEvent({ roomId: room.roomId, kind: 'chat-ref', mediaTimeMs: 10, ref: 'chat:聊天正文', memberId: guestId }));
  });

  test('save → close/reopen → replay：Workspace A/B 隔离且事件可恢复', () => {
    const store = memStore();
    const root = workspace('durable');
    try {
      const first = new WatchRoomService({ store, workspace: root, memberIdentity: () => 'durable-device' });
      const room = first.createRoom({ mediaRef: mediaRef() });
      first.appendEvent({ roomId: room.roomId, kind: 'play', mediaTimeMs: 321 });
      const reopened = new WatchRoomService({ store, workspace: root, memberIdentity: () => 'durable-device' });
      assert.equal(reopened.replay(room.roomId).events[0].mediaTimeMs, 321);
      const other = new WatchRoomService({ store: memStore(), workspace: workspace('other'), memberIdentity: () => 'durable-device' });
      assert.equal(other.getRoom(room.roomId), null);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('真实 TLS 配对轨：room frame 与 file/state-fact frame 分离并可重连收敛', async () => {
    const root = workspace('lan');
    const storeA = memStore();
    const storeB = memStore();
    const a = new LanSync({ store: storeA, workspace: root });
    const b = new LanSync({ store: storeB, workspace: root });
    try {
      const room = a.watchRoom.createRoom({ mediaRef: mediaRef() });
      const host = await a.host({ port: 0 });
      await b.join({ host: '127.0.0.1', port: host.port, pairCode: host.pairCode });
      assert.ok(b.watchRoom.getRoom(room.roomId));
      const guest = b.watchRoom.getRoom(room.roomId);
      assert.equal(guest.members.length, 2);
      await a.stopHost();
      const host2 = await a.host({ port: 0 });
      await b.join({ host: '127.0.0.1', port: host2.port, pairCode: host2.pairCode });
      assert.equal(a.watchRoom.getRoom(room.roomId).members.length, 2);
      assert.ok(a.lastResult && Object.hasOwn(a.lastResult, 'watchRoomConflicts'));
      assert.equal(a.stateFacts().length, 0, 'room 事件不能混入 state-fact store');
      await a.stopHost();
    } finally {
      await a.stop();
      await b.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
