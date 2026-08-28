import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import coreModule from '../../main/torrent-site-core.js';
import TorrentDaemon from '../../main/torrent-daemon.js';

class FakeBus {
  constructor() { this.handlers = new Map(); }
  handle(name, fn) { this.handlers.set(name, fn); }
  invoke(name, payload = {}) { return this.handlers.get(name)(payload); }
}

class FakeServer {
  listen(_port, _host, callback) { callback(); }
  address() { return { port: 45172 }; }
  close(callback) { callback?.(); }
}

class FakeFile {
  constructor(root, name, bytes) {
    this.path = `${root}/${name}`;
    this.name = name;
    this.bytes = Buffer.from(bytes);
    this.length = this.bytes.length;
    this.streamURL = `/0/${name}`;
  }
  createReadStream({ start = 0, end = this.bytes.length - 1 } = {}) {
    return Readable.from(this.bytes.subarray(start, end + 1));
  }
  async *[Symbol.asyncIterator]() { yield this.bytes; }
}

class FakeTorrent extends EventEmitter {
  constructor(infoHash) {
    super();
    this.infoHash = infoHash;
    this.name = `W94F-${infoHash.slice(0, 8)}`;
    this.ready = true;
    this.info = true;
    this.progress = 0;
    this.downloaded = 0;
    this.length = 1;
    this.downloadSpeed = 0;
    this.uploadSpeed = 0;
    this.numPeers = 0;
    this.done = false;
    this.files = [new FakeFile(this.name, 'video.mp4', Buffer.from('0123456789abcdef'))];
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  destroy(_options, callback) { if (typeof _options === 'function') _options(); else callback?.(); }
}

class FakeWebTorrent {
  constructor() { this.server = new FakeServer(); }
  createServer() { return this.server; }
  add(magnet) { return new FakeTorrent(coreModule.normalizeInfoHash(magnet)); }
  destroy(callback) { callback?.(); }
}

function hashFor(index) {
  return crypto.createHash('sha1').update(`w94f-queue-${index}`, 'utf8').digest('hex');
}

describe('W94Fa Player transport queue', () => {
  test('不同 BTIH 任务不因固定队列条数业务门被拒，退出后 owner 归零', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w94f-queue-'));
    const bus = new FakeBus();
    const daemon = new TorrentDaemon({
      bus,
      workspace: () => workspace,
      session: null,
      loadWebTorrent: async () => ({ default: FakeWebTorrent }),
    });
    try {
      const hashes = Array.from({ length: 51 }, (_, index) => hashFor(index));
      const jobs = await Promise.all(hashes.map((infoHash, index) => bus.invoke('tor:addBuffer', {
        magnet: `magnet:?xt=urn:btih:${infoHash}`,
        name: `W94F queue ${index}`,
      })));
      assert.equal(jobs.length, 51);
      assert.equal(new Set(jobs.map(job => job.infoHash)).size, 51);
      assert.equal((await bus.invoke('tor:queue')).length, 51);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal((await bus.invoke('tor:queue')).filter(job => job.state === 'downloading').length, 51);
    } finally {
      await daemon.destroy('w94f-test');
      assert.deepEqual(await bus.invoke('tor:queue'), []);
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('W94Fb 重启只恢复 durable paused projection，不自动恢复网络', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w94fb-restart-'));
    const hash = hashFor(9001);
    let loaderCalls = 0;
    const load = async () => { loaderCalls += 1; return { default: FakeWebTorrent }; };
    const firstBus = new FakeBus();
    const first = new TorrentDaemon({
      bus: firstBus, workspace: () => workspace, session: null, loadWebTorrent: load,
    });
    try {
      await firstBus.invoke('tor:addBuffer', {
        magnet: `magnet:?xt=urn:btih:${hash}`,
        name: 'W94Fb restart fixture',
      });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal((await firstBus.invoke('tor:queue'))[0].state, 'downloading');
      await first.destroy('w94fb-restart');

      const secondBus = new FakeBus();
      const second = new TorrentDaemon({
        bus: secondBus, workspace: () => workspace, session: null, loadWebTorrent: load,
      });
      try {
        const restored = await secondBus.invoke('tor:queue');
        assert.equal(restored.length, 1);
        assert.equal(restored[0].state, 'paused');
        assert.equal(loaderCalls, 1, 'restart hydration must not start WebTorrent');
        const resumed = await secondBus.invoke('tor:resume', { infoHash: hash });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(resumed.state, 'queued');
        assert.equal((await secondBus.invoke('tor:queue'))[0].state, 'downloading');
        await secondBus.invoke('tor:remove', { infoHash: hash, deleteFiles: false });
      } finally {
        await second.destroy('w94fb-test');
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('W94Fc 播放器文件只经短时 capability 与 Range 流读取', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w94fc-capability-'));
    const bus = new FakeBus();
    const daemon = new TorrentDaemon({
      bus, workspace: () => workspace, session: null,
      loadWebTorrent: async () => ({ default: FakeWebTorrent }),
    });
    const hash = hashFor(9403);
    try {
      const added = await bus.invoke('tor:add', { magnet: `magnet:?xt=urn:btih:${hash}`, name: 'W94Fc capability fixture' });
      const filePath = added.files[0].path;
      const grant = await bus.invoke('tor:fileCapabilityUrl', { infoHash: hash, filePath });
      assert.match(grant.url, /^mazz-res:\/\/tor-cap\/player-file-/);
      assert.equal(grant.capabilityRef.startsWith('capability:'), true);
      const token = decodeURIComponent(new URL(grant.url).pathname.slice(1));
      const opened = await daemon.openFileCapability(token, { range: 'bytes=2-5' });
      const chunks = [];
      for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
      assert.equal(opened.status, 206);
      assert.equal(opened.headers['Content-Range'], 'bytes 2-5/16');
      assert.equal(Buffer.concat(chunks).toString(), '2345');

      const sender = new EventEmitter();
      sender.id = 9403;
      const ownedGrant = await bus.handlers.get('tor:fileCapabilityUrl')({ infoHash: hash, filePath }, { sender, });
      const ownedToken = decodeURIComponent(new URL(ownedGrant.url).pathname.slice(1));
      sender.emit('destroyed');
      await assert.rejects(() => daemon.openFileCapability(ownedToken), /unavailable/);
    } finally {
      await daemon.destroy('w94fc-test');
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
