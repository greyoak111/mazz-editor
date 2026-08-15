// tests/contract/w71-lifecycle-security.test.mjs —— W71 长期资源与发布安全闭环
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { ResourceLedger } = require('../../main/resource-ledger.js');
const FileWatcher = require('../../main/file-watcher.js');
const TorrentDaemon = require('../../main/torrent-daemon.js');
const SearxService = require('../../main/searx.js');
const Updater = require('../../main/updater.js');

class FakeBus {
  constructor() { this.handlers = new Map(); }
  handle(name, fn) { this.handlers.set(name, fn); }
  invoke(name, payload = {}) { return this.handlers.get(name)(payload); }
}

class FakeStore {
  constructor(data = {}) { this.data = data; }
  get(key, fallback) { return key in this.data ? this.data[key] : fallback; }
  set(key, value) { this.data[key] = value; }
}

class FakeServer {
  listen(_port, _host, callback) { callback(); }
  address() { return { port: 45171 }; }
  close(callback) { callback?.(); }
}

class FakeWebTorrent {
  constructor() { this.server = new FakeServer(); }
  createServer() { return this.server; }
  destroy(callback) { callback?.(); }
}

const read = file => fs.readFileSync(path.resolve(file), 'utf8');

describe('W71 长期资源生命周期', () => {
  test('FileWatcher 连续 20 次挂载/卸载均回到账本基线', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-watch-'));
    const file = path.join(dir, 'watched.md');
    fs.writeFileSync(file, '# watcher\n');
    const ledger = new ResourceLedger({ historyLimit: 100 });
    const bus = new FakeBus();
    const watcher = new FileWatcher({ bus, windowManager: { broadcast() {} }, resourceLedger: ledger });
    try {
      for (let index = 0; index < 20; index++) {
        await bus.invoke('fs:watch', { paths: [file] });
        assert.equal(ledger.snapshot().byType['file-watcher'], 1, `第 ${index + 1} 次 watcher 未登记`);
        await bus.invoke('fs:unwatch', { paths: [file] });
        assert.equal(ledger.snapshot().activeCount, 0, `第 ${index + 1} 次 watcher 未释放`);
      }
      assert.equal(ledger.snapshot({ includeReleased: true }).released.length, 20);
    } finally {
      await watcher.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('WebTorrent client/server 连续 20 次启动/销毁均回到账本基线', async () => {
    const ledger = new ResourceLedger({ historyLimit: 100 });
    const daemon = new TorrentDaemon({
      bus: new FakeBus(), workspace: () => os.tmpdir(), session: null, resourceLedger: ledger,
      loadWebTorrent: async () => ({ default: FakeWebTorrent }),
    });
    for (let index = 0; index < 20; index++) {
      await daemon.ensureClient();
      assert.deepEqual(ledger.snapshot().byType, { 'torrent-client': 1, 'torrent-server': 1 });
      await daemon.destroy('test-cycle');
      assert.equal(ledger.snapshot().activeCount, 0, `第 ${index + 1} 次 Torrent runtime 未释放`);
    }
    assert.equal(ledger.snapshot({ includeReleased: true }).released.length, 40);
  });

  test('总装配将 watcher/torrent 接入同一账本并在退出时销毁', () => {
    const main = read('main/main.js');
    assert.ok(main.includes('new FileWatcher({ bus, windowManager: wm, resourceLedger })'));
    assert.ok(/new TorrentDaemon\(\{[\s\S]{0,180}resourceLedger/.test(main));
    assert.ok(main.includes("torrentDaemon.destroy().catch"));
  });
});

describe('W71 搜索与更新链安全', () => {
  test('SearXNG 明文旧配置迁移为密文，运行配置只在主进程解密', () => {
    const store = new FakeStore({ searx: { url: 'https://search.example', user: 'reader', pass: 'plain-secret' } });
    const service = new SearxService({
      bus: new FakeBus(), store, session: null,
      encryptSecret: value => ({ enc: true, data: `sealed:${value}` }),
      decryptSecret: payload => String(payload.data).replace(/^sealed:/, ''),
    });
    assert.equal(Object.hasOwn(store.data.searx, 'pass'), false);
    assert.deepEqual(store.data.searx.passEnc, { enc: true, data: 'sealed:plain-secret' });
    assert.equal(service.config().pass, 'plain-secret');
    assert.equal(service.maskedConfig().hasPass, true);
    assert.equal(Object.hasOwn(service.maskedConfig(), 'pass'), false);
  });

  test('TLS 指纹严格归一，Updater 拒绝明文 HTTP', async () => {
    const pin = 'AA:'.repeat(31) + 'AA';
    assert.equal(SearxService.normalizeTlsPin(pin), 'AA'.repeat(32));
    assert.throws(() => SearxService.normalizeTlsPin('1234'), /64 位/);
    await assert.rejects(() => SearxService.nodeFetch('http://search.example/query'), /必须使用 HTTPS/);
    await assert.rejects(() => Updater.getJson('http://updates.example/manifest.json'), /必须使用 HTTPS/);
  });

  test('产品源码不再含固定实例、明文凭据或通用 TLS 绕过', () => {
    const searx = read('main/searx.js');
    const legacySearx = read('searx.js');
    const main = read('main/main.js');
    const updater = read('main/updater.js');
    const translate = read('main/translate.js');
    const historicalE2e = read('tests/e2e/scenes66.mjs');
    assert.equal(/107\.174\.|737037/.test(searx + legacySearx + main), false);
    assert.equal(/sk-[A-Za-z0-9_-]{20,}/.test(historicalE2e), false);
    assert.equal(searx.includes('applyCertWhitelist'), false);
    assert.equal(main.includes('host === instHost'), false);
    assert.equal(updater.includes('rejectUnauthorized: false'), false);
    assert.equal(translate.includes('rejectUnauthorized: false'), false);
    assert.equal(read('renderer/shell/shell.js').includes("settings:get', { key: 'searx'"), false);
  });
});
