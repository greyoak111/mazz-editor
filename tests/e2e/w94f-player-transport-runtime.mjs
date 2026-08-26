// W94F Fa：真实 Electron IPC → Player TorrentDaemon（fake WebTorrent）队列与退出收敛
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const ROOT = path.resolve('.');
const executableIndex = process.argv.indexOf('--executable');
const EXECUTABLE = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : '';
const MODE = EXECUTABLE ? 'packaged' : 'source';
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence', `W94F_PLAYER_TRANSPORT_${MODE.toUpperCase()}.json`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94f-${MODE}-user-`)));
const WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94f-${MODE}-workspace-`)));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hashFor = index => crypto.createHash('sha1').update(`w94f-runtime-${index}`, 'utf8').digest('hex');
const torrentResources = snapshot => (snapshot.active || []).filter(row => row.owner === 'torrent-daemon' || String(row.type || '').startsWith('torrent'));

async function removeTempDirectory(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); return; }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === 19) throw error; await delay(250); }
  }
}

async function installFakeRuntime(app) {
  await app.evaluate(({ app: _app }) => {
    const daemon = globalThis.__MAZZ_E2E_TORRENT_DAEMON__;
    if (!daemon) throw new Error('W94F TorrentDaemon test hook missing');
    class FakeServer {
      listen(_port, _host, callback) { callback(); }
      address() { return { port: 45173 }; }
      close(callback) { callback?.(); }
    }
    class FakeTorrent {
      constructor(infoHash) {
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
        this.files = [{ path: `${this.name}/video.mp4`, name: 'video.mp4', length: 1, streamURL: '/0/video.mp4' }];
        this.listeners = new Map();
      }
      once(name, listener) { this.listeners.set(name, listener); }
      pause() { this.paused = true; }
      resume() { this.paused = false; }
      destroy(_options, callback) { if (typeof _options === 'function') _options(); else callback?.(); }
    }
    class FakeWebTorrent {
      constructor() { this.server = new FakeServer(); }
      createServer() { return this.server; }
      add(magnet) {
        const match = String(magnet).match(/urn:btih:([0-9a-f]{40})/i);
        if (!match) throw new Error('fake BTIH invalid');
        return new FakeTorrent(match[1].toLowerCase());
      }
      destroy(callback) { callback?.(); }
    }
    daemon.loadWebTorrent = async () => ({ default: FakeWebTorrent });
    globalThis.__MAZZ_E2E_W94F_FAKE__ = true;
  });
}

const errors = [];
let product = null;
let report = null;
try {
  fs.writeFileSync(path.join(USER_DATA, 'mazz-settings.json'), `${JSON.stringify({ workspace: WORKSPACE, closeBehavior: 'quit', 'agreement.noMore': true }, null, 2)}\n`, 'utf8');
  const options = {
    args: EXECUTABLE ? [] : [ROOT],
    env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WORKSPACE, MAZZ_E2E_DISABLE_GPU: '1' },
    timeout: 120000,
  };
  if (EXECUTABLE) options.executablePath = EXECUTABLE;
  const trackProduct = app => {
    app.process().stderr?.on('data', chunk => {
      const text = String(chunk);
      if (/uncaught|TypeError|ReferenceError|UnhandledPromiseRejection|FATAL/i.test(text)) errors.push(text.trim());
    });
  };
  product = await electron.launch(options);
  trackProduct(product);
  let page = await product.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));

  await installFakeRuntime(product);

  const hashes = Array.from({ length: 51 }, (_, index) => hashFor(index));
  const invoke = (channel, payload = {}) => page.evaluate(({ channel, payload }) => window.mazz.invoke(channel, payload), { channel, payload });
  const jobs = await page.evaluate(values => Promise.all(values.map((infoHash, index) => window.mazz.invoke('tor:addBuffer', {
    magnet: `magnet:?xt=urn:btih:${infoHash}`,
    name: `W94F queue ${index}`,
  }))), hashes);
  assert.equal(jobs.length, 51);
  assert.equal(new Set(jobs.map(job => job.infoHash)).size, 51);
  const queued = await invoke('tor:queue');
  assert.equal(queued.length, 51);
  await page.waitForFunction(async () => {
    const rows = await window.mazz.invoke('tor:queue');
    return rows.length === 51 && rows.every(row => row.state === 'downloading');
  });

  for (const infoHash of hashes) await invoke('tor:remove', { infoHash, deleteFiles: false });
  assert.deepEqual(await invoke('tor:queue'), []);
  const restartHash = hashFor(1001);
  await invoke('tor:addBuffer', { magnet: `magnet:?xt=urn:btih:${restartHash}`, name: 'W94F restart fixture' });
  await page.waitForFunction(async infoHash => {
    const row = (await window.mazz.invoke('tor:queue')).find(item => item.infoHash === infoHash);
    return row?.state === 'downloading';
  }, restartHash);
  await product.evaluate(() => globalThis.__MAZZ_E2E_TORRENT_DAEMON__?.destroy('w94f-restart'));
  await product.close();
  product = null;

  // Relaunch against the same Workspace. The durable projection must restore
  // the session as paused without creating a WebTorrent client until resume.
  product = await electron.launch(options);
  trackProduct(product);
  page = await product.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));
  await installFakeRuntime(product);
  const restored = await page.evaluate(() => window.mazz.invoke('tor:queue'));
  assert.equal(restored.length, 1);
  assert.equal(restored[0].infoHash, restartHash);
  assert.equal(restored[0].state, 'paused');
  await invoke('tor:resume', { infoHash: restartHash });
  await page.waitForFunction(async infoHash => {
    const row = (await window.mazz.invoke('tor:queue')).find(item => item.infoHash === infoHash);
    return row?.state === 'downloading';
  }, restartHash);
  const beforeDestroy = await product.evaluate(() => globalThis.__MAZZ_E2E_RESOURCE_LEDGER__?.snapshot?.() || { active: [] });
  await invoke('tor:remove', { infoHash: restartHash, deleteFiles: false });
  assert.deepEqual(await invoke('tor:queue'), []);
  await product.evaluate(() => globalThis.__MAZZ_E2E_TORRENT_DAEMON__?.destroy('w94f-runtime'));
  const afterDestroy = await product.evaluate(() => globalThis.__MAZZ_E2E_RESOURCE_LEDGER__?.snapshot?.() || { active: [] });
  assert.equal(torrentResources(afterDestroy).length, 0);
  assert.deepEqual(errors, []);

  report = {
    schema: 'mazz.w94f-player-transport-runtime/v1',
    mode: MODE,
    result: 'PASS',
    fakeRuntime: true,
    fixedQueueLimit: false,
    queueAccepted: jobs.length,
    queueAfterCleanup: (await invoke('tor:queue')).length,
    restart: { restoredCount: restored.length, restoredState: restored[0].state, resumedState: 'downloading' },
    resources: { torrentActiveBeforeDestroy: torrentResources(beforeDestroy).length, torrentActiveAfterDestroy: torrentResources(afterDestroy).length },
    networkCalls: 0,
    runtimeErrors: errors,
    executableSha256: EXECUTABLE ? sha256File(EXECUTABLE) : null,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
} finally {
  if (product) {
    const closed = await Promise.race([product.close().then(() => true), delay(30000).then(() => false)]).catch(() => false);
    if (!closed) { try { product.process().kill(); } catch {} }
  }
  await removeTempDirectory(USER_DATA);
  await removeTempDirectory(WORKSPACE);
}
assert.ok(report);
process.stdout.write(`W94F_PLAYER_TRANSPORT_REPORT=${JSON.stringify(report)}\n`);
