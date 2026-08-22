// tests/contract/w71-lifecycle-security.test.mjs —— W71 长期资源与发布安全闭环
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { ResourceLedger } = require('../../main/resource-ledger.js');
const FileWatcher = require('../../main/file-watcher.js');
const TorrentDaemon = require('../../main/torrent-daemon.js');
const PythonKernel = require('../../main/python-kernel.js');
const DebugService = require('../../main/debug.js');
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

class FakeFsWatcher extends EventEmitter {
  constructor() {
    super();
    this.closed = false;
    this.added = [];
    this.unwatched = [];
  }
  add(paths) { this.added.push(...(Array.isArray(paths) ? paths : [paths])); }
  unwatch(paths) {
    this.unwatched.push(...(Array.isArray(paths) ? paths : [paths]));
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

class FakeWebTorrent {
  constructor() { this.server = new FakeServer(); }
  createServer() { return this.server; }
  destroy(callback) { callback?.(); }
}

class FakePythonProcess extends EventEmitter {
  constructor({ probe = false } = {}) {
    super();
    this.killed = false;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = {
      write: (line) => {
        const marker = String(line).trim().split(' ').slice(1).join(' ');
        queueMicrotask(() => this.stdout.emit('data', Buffer.from(`2\n${marker}\n`)));
        return true;
      },
    };
    if (probe) queueMicrotask(() => {
      this.stdout.emit('data', Buffer.from('3\n'));
      this.emit('close', 0);
    });
  }
  kill() {
    if (this.killed) return;
    this.killed = true;
    queueMicrotask(() => this.emit('exit', 0, null));
  }
}

class FakeDapProcess extends EventEmitter {
  constructor() {
    super();
    this.killed = false;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = { write: raw => this.respond(raw) };
  }
  respond(raw) {
    const body = String(raw).split('\r\n\r\n').slice(1).join('\r\n\r\n');
    const req = JSON.parse(body);
    const payload = JSON.stringify({
      seq: req.seq + 1000, type: 'response', request_seq: req.seq,
      command: req.command, success: true, body: {},
    });
    const frame = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
    queueMicrotask(() => this.stdout.emit('data', Buffer.from(frame)));
    return true;
  }
  kill() {
    if (this.killed) return;
    this.killed = true;
    queueMicrotask(() => this.emit('exit', 0, null));
  }
}

class HandshakeDapProcess extends FakeDapProcess {
  constructor() {
    super();
    this.launchRequest = null;
  }
  frame(payload) {
    const body = JSON.stringify(payload);
    queueMicrotask(() => this.stdout.emit('data', Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)));
  }
  respond(raw) {
    const body = String(raw).split('\r\n\r\n').slice(1).join('\r\n\r\n');
    const req = JSON.parse(body);
    if (req.command === 'launch') {
      this.launchRequest = req;
      this.frame({ seq: req.seq + 500, type: 'event', event: 'initialized', body: {} });
      return true;
    }
    this.frame({
      seq: req.seq + 1000, type: 'response', request_seq: req.seq,
      command: req.command, success: true, body: {},
    });
    if (req.command === 'configurationDone' && this.launchRequest) {
      const launch = this.launchRequest;
      this.launchRequest = null;
      this.frame({
        seq: launch.seq + 2000, type: 'response', request_seq: launch.seq,
        command: 'launch', success: true, body: {},
      });
    }
    return true;
  }
}

const read = file => fs.readFileSync(path.resolve(file), 'utf8');

describe('W71 长期资源生命周期', () => {
  test('FileWatcher 连续 20 次挂载/卸载均回到账本基线', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-watch-'));
    const file = path.join(dir, 'watched.md');
    const extraDir = path.join(dir, 'extra-root');
    fs.mkdirSync(extraDir);
    fs.writeFileSync(file, '# watcher\n');
    const ledger = new ResourceLedger({ historyLimit: 100 });
    const bus = new FakeBus();
    const broadcasts = [];
    const watcher = new FileWatcher({
      bus,
      windowManager: {
        broadcastShells(channel, payload) { broadcasts.push({ channel, payload }); },
      },
      resourceLedger: ledger,
    });
    try {
      for (let index = 0; index < 20; index++) {
        await bus.invoke('fs:watch', { paths: [dir] });
        assert.equal(ledger.snapshot().byType['file-watcher'], 1, `第 ${index + 1} 次 watcher 未登记`);
        if (index === 0) {
          const warning = console.warn;
          const error = console.error;
          console.warn = () => {};
          console.error = () => {};
          try {
            for (const code of ['EPERM', 'ENOENT']) {
              const transient = Object.assign(new Error('sensitive absolute path'), { code, path: file });
              assert.doesNotThrow(() => watcher.watcher.emit('error', transient), `${code} 子路径原子替换不得升级为 uncaughtException`);
              const entry = ledger.snapshot().active[0];
              assert.equal(entry.state, 'watching', `${code} 子路径竞态后 watcher 必须保持 watching`);
              assert.equal(entry.meta.reason, `watch-transient:${code}`);
            }

            const fatalErrors = [
              Object.assign(new Error('root permission denied'), { code: 'EACCES', path: dir }),
              Object.assign(new Error('root atomic permission failure'), { code: 'EPERM', path: dir }),
              Object.assign(new Error('outside path disappeared'), { code: 'ENOENT', path: path.join(os.tmpdir(), 'outside-watch-root') }),
              ...['EIO', 'EMFILE', 'ENOSPC'].map(code => Object.assign(new Error('fatal watcher failure'), { code, path: file })),
            ];
            for (const fatal of fatalErrors) {
              assert.doesNotThrow(() => watcher.watcher.emit('error', fatal), `${fatal.code} 必须降级而非成为 uncaughtException`);
              const entry = ledger.snapshot().active[0];
              assert.equal(entry.state, 'degraded', `${fatal.code} 不得伪装成 watching`);
              assert.equal(entry.meta.reason, `watch-error:${fatal.code}`);
            }
            assert.equal(broadcasts.length, fatalErrors.length, '每个致命 watcher 错误都必须通知工作台壳');
            for (const item of broadcasts) {
              assert.equal(item.channel, 'file:watch-error');
              assert.equal(item.payload.state, 'degraded');
              assert.equal(Object.hasOwn(item.payload, 'path'), false, '降级广播不得携带用户绝对路径');
              assert.equal(JSON.stringify(item.payload).includes(dir), false, '降级广播不得泄露监视根目录');
            }

            await assert.rejects(
              () => bus.invoke('fs:watch', { paths: [extraDir] }),
              error => error?.code === 'ENOSPC',
              'degraded watcher 不得因追加根而假报成功',
            );
            assert.equal(ledger.snapshot().active[0].state, 'degraded', '追加监视根不得洗掉 degraded');
            await bus.invoke('fs:unwatch', { paths: [extraDir] });
            assert.equal(ledger.snapshot().active[0].state, 'degraded', '卸载部分监视根不得洗掉 degraded');
          } finally {
            console.warn = warning;
            console.error = error;
          }
        } else if (index === 1) {
          assert.equal(ledger.snapshot().active[0].state, 'watching', 'close/reopen 后必须恢复 watching');
        }
        await bus.invoke('fs:unwatch', { paths: [dir] });
        assert.equal(ledger.snapshot().activeCount, 0, `第 ${index + 1} 次 watcher 未释放`);
      }
      assert.equal(ledger.snapshot({ includeReleased: true }).released.length, 21, '首轮 fail-closed 重建会额外释放一次旧 owner');
    } finally {
      await watcher.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('FileWatcher degraded 重启原子保留工作区目录与外部文件根', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-restart-workspace-'));
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-restart-external-'));
    const workspaceFile = path.join(workspaceDir, 'chapter.md');
    const externalFile = path.join(externalDir, 'reference.md');
    fs.writeFileSync(workspaceFile, '# chapter\n');
    fs.writeFileSync(externalFile, '# reference\n');
    const ledger = new ResourceLedger({ historyLimit: 20 });
    const bus = new FakeBus();
    const watcher = new FileWatcher({
      bus,
      windowManager: { broadcastShells() {} },
      resourceLedger: ledger,
    });
    try {
      await bus.invoke('fs:watch', { paths: [workspaceDir, externalFile] });
      assert.deepEqual([...watcher.watched], [workspaceDir, externalFile]);
      const oldWatcher = watcher.watcher;
      const originalError = console.error;
      console.error = () => {};
      try {
        const fatal = Object.assign(new Error('workspace I/O failure'), { code: 'EIO', path: workspaceFile });
        assert.doesNotThrow(() => oldWatcher.emit('error', fatal));
      } finally {
        console.error = originalError;
      }
      assert.equal(ledger.snapshot().active[0].state, 'degraded');

      const restarted = await bus.invoke('fs:restartWatch');
      assert.deepEqual(restarted, { ok: true, reason: 'restarted', roots: 2 });
      assert.notEqual(watcher.watcher, oldWatcher, '必须创建全新的 chokidar 实例');
      assert.equal(oldWatcher.closed, true, '旧 watcher 必须先释放');
      assert.deepEqual([...watcher.watched], [workspaceDir, externalFile], '目录根与外部独立文件根必须完整保留');
      const active = ledger.snapshot().active[0];
      assert.equal(active.state, 'watching', '成功重启后账本必须恢复 watching');
      assert.equal(active.meta.reason, 'restart-ready');
      const released = ledger.snapshot({ includeReleased: true }).released;
      assert.equal(released.length, 1, '重启必须释放旧 watcher owner');
      assert.equal(released[0].releaseReason, 'watch-restart');

      await bus.invoke('fs:closeAll');
      assert.equal(ledger.snapshot().activeCount, 0);
      assert.deepEqual(
        await bus.invoke('fs:restartWatch'),
        { ok: false, reason: 'no-watch-roots', roots: 0 },
        '没有任何根时必须明确拒绝空重建',
      );
    } finally {
      await watcher.close();
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(externalDir, { recursive: true, force: true });
    }
  });

  test('FileWatcher 重建只在真实 ready 后成功，失败后 old/new root 均可完整自愈', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-scripted-workspace-'));
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-scripted-external-'));
    const workspaceFile = path.join(workspaceDir, 'chapter.md');
    const externalFile = path.join(externalDir, 'reference.md');
    const newExternalFile = path.join(externalDir, 'second-reference.md');
    fs.writeFileSync(workspaceFile, '# chapter\n');
    fs.writeFileSync(externalFile, '# reference\n');
    fs.writeFileSync(newExternalFile, '# second reference\n');
    const ledger = new ResourceLedger({ historyLimit: 30 });
    const bus = new FakeBus();
    const behaviors = ['ready'];
    const createdRoots = [];
    let owner = null;
    const watchFactory = roots => {
      const behavior = behaviors.shift() || 'ready';
      createdRoots.push([...roots]);
      if (behavior === 'throw') {
        const failure = new Error('synchronous watch factory failure');
        failure.code = 'EMFILE';
        throw failure;
      }
      const runtime = new FakeFsWatcher();
      queueMicrotask(() => {
        if (behavior === 'ready') runtime.emit('ready');
        else if (behavior === 'fatal-before-ready') {
          runtime.emit('error', Object.assign(new Error('private workspace path'), { code: 'EIO', path: workspaceFile }));
          runtime.emit('ready');
        } else if (behavior === 'closed-before-ready') {
          owner.close({ clearRoots: false, reason: 'injected-close' }).catch(() => {});
        }
        // timeout 刻意不发 ready，由注入的短超时有界结算。
      });
      return runtime;
    };
    const broadcasts = [];
    owner = new FileWatcher({
      bus,
      windowManager: { broadcastShells(channel, payload) { broadcasts.push({ channel, payload }); } },
      resourceLedger: ledger,
      watchFactory,
      readyTimeoutMs: 5,
    });
    const originalError = console.error;
    console.error = () => {};
    try {
      const initialWatch = bus.invoke('fs:watch', { paths: [workspaceDir, externalFile] });
      await Promise.resolve();
      assert.equal(ledger.snapshot().active[0].state, 'starting', '真实 ready 前账本不得假报 watching');
      await initialWatch;
      assert.equal(ledger.snapshot().active[0].state, 'watching');

      owner.watcher.emit('error', Object.assign(new Error('force restart'), { code: 'EIO', path: workspaceFile }));
      behaviors.push('fatal-before-ready');
      await assert.rejects(
        () => bus.invoke('fs:restartWatch'),
        error => error?.code === 'EIO',
        'ready 前 fatal 即使随后发 ready 也不得返回成功',
      );
      assert.equal(owner.watcher, null);
      assert.equal(ledger.snapshot().active[0].state, 'degraded');
      assert.deepEqual([...owner.watched], [workspaceDir, externalFile]);

      behaviors.push('ready');
      await bus.invoke('fs:watch', { paths: [workspaceDir] });
      assert.deepEqual(createdRoots.at(-1), [workspaceDir, externalFile], 'failed restart 后 watch 旧根必须重装全部 preserved roots');
      assert.equal(ledger.snapshot().active[0].state, 'watching');

      owner.watcher.emit('error', Object.assign(new Error('force sync failure'), { code: 'EIO', path: workspaceFile }));
      behaviors.push('throw');
      await assert.rejects(
        () => bus.invoke('fs:restartWatch'),
        error => error?.code === 'EMFILE',
        '同步创建失败必须 reject',
      );
      assert.equal(owner.watcher, null);
      assert.equal(ledger.snapshot().active[0].state, 'degraded');

      behaviors.push('ready');
      await bus.invoke('fs:watch', { paths: [newExternalFile] });
      assert.deepEqual(
        createdRoots.at(-1),
        [workspaceDir, externalFile, newExternalFile],
        'failed restart 后 watch 新根必须把新根与全部 preserved roots 一起重装',
      );
      assert.equal(ledger.snapshot().active[0].state, 'watching');

      owner.watcher.emit('error', Object.assign(new Error('force timeout'), { code: 'EIO', path: workspaceFile }));
      behaviors.push('timeout');
      const timeoutKeepAlive = setTimeout(() => {}, 50);
      try {
        await assert.rejects(
          () => bus.invoke('fs:restartWatch'),
          error => error?.code === 'WATCH_READY_TIMEOUT',
          'ready timeout 必须有界失败',
        );
      } finally {
        clearTimeout(timeoutKeepAlive);
      }
      assert.equal(owner.watcher, null);
      assert.equal(ledger.snapshot().active[0].state, 'degraded');

      behaviors.push('closed-before-ready');
      await assert.rejects(
        () => bus.invoke('fs:watch', { paths: [workspaceDir] }),
        error => error?.code === 'WATCH_CLOSED',
        'ready 前实例被关闭不得假报成功',
      );
      assert.equal(owner.watcher, null);
      assert.equal(ledger.snapshot().active[0].state, 'degraded');
      assert.deepEqual([...owner.watched], [workspaceDir, externalFile, newExternalFile]);

      behaviors.push('ready');
      await bus.invoke('fs:watch', { paths: [workspaceDir] });
      await owner.suspend();
      assert.equal(owner.watcher, null);
      assert.deepEqual([...owner.watched], [workspaceDir, externalFile, newExternalFile], 'suspend 必须保留全部 roots');
      behaviors.push('ready');
      assert.equal(await owner.resume(), true);
      assert.deepEqual(createdRoots.at(-1), [workspaceDir, externalFile, newExternalFile]);
      assert.equal(ledger.snapshot().active[0].state, 'watching');

      await owner.suspend();
      behaviors.push('fatal-before-ready');
      await assert.rejects(
        () => owner.resume(),
        error => error?.code === 'EIO',
        'resume 的异步 fatal 必须 reject',
      );
      assert.equal(owner.watcher, null);
      assert.equal(ledger.snapshot().active[0].state, 'degraded');
      assert.deepEqual([...owner.watched], [workspaceDir, externalFile, newExternalFile]);
      assert.ok(broadcasts.every(item => !Object.hasOwn(item.payload, 'path')), '所有失败广播均不得携带绝对路径');
    } finally {
      console.error = originalError;
      await owner.close();
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(externalDir, { recursive: true, force: true });
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

  test('Python 内核连续 20 次执行/终止会同时释放进程与临时驱动', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-python-'));
    const ledger = new ResourceLedger({ historyLimit: 100 });
    let driverSpawns = 0;
    const kernel = new PythonKernel({
      bus: new FakeBus(), windowManager: { broadcast() {} }, resourceLedger: ledger, tempDir,
      spawnProcess: (_cmd, args) => {
        if (args[0] === '-u') driverSpawns++;
        return new FakePythonProcess({ probe: args[0] === '-c' });
      },
    });
    try {
      for (let index = 0; index < 20; index++) {
        if (index === 0) {
          await Promise.all([kernel.ensure(), kernel.ensure(), kernel.ensure()]);
          assert.equal(driverSpawns, 1, '并发 ensure 必须汇聚到同一个 Python 进程');
        }
        const result = await kernel.exec('1 + 1', 1000);
        assert.equal(result.output, '2');
        assert.deepEqual(ledger.snapshot().byType, { 'temp-file': 1, 'python-process': 1 });
        kernel.kill('test-cycle');
        assert.equal(ledger.snapshot().activeCount, 0, `第 ${index + 1} 次 Python 内核未释放`);
        assert.equal(fs.readdirSync(tempDir).length, 0, `第 ${index + 1} 次 Python 驱动未删除`);
      }
      assert.equal(driverSpawns, 20);
      assert.equal(ledger.snapshot({ includeReleased: true }).released.length, 40);
    } finally {
      kernel.kill('test-finally');
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('DAP 连续 20 次替换/停止不会被旧进程退出回调清空新会话', async () => {
    const ledger = new ResourceLedger({ historyLimit: 100 });
    const debug = new DebugService({
      bus: new FakeBus(), windowManager: { broadcast() {} }, resourceLedger: ledger,
      spawnProcess: () => new FakeDapProcess(), requestTimeout: 1000,
    });
    for (let index = 0; index < 20; index++) {
      const started = await debug.start({ type: 'python', program: 'fixture.py', cwd: os.tmpdir() });
      assert.equal(started.ok, true);
      assert.equal(ledger.snapshot().byType['debug-process'], 1);
      const previous = debug.session;
      const replacement = await debug.start({ type: 'python', program: 'fixture.py', cwd: os.tmpdir() });
      assert.equal(replacement.ok, true);
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(debug.session && debug.session !== previous, `第 ${index + 1} 次旧 exit 覆盖了新 DAP 会话`);
      debug.kill('test-cycle');
      assert.equal(ledger.snapshot().activeCount, 0, `第 ${index + 1} 次 DAP 未释放`);
    }
    assert.equal(ledger.snapshot({ includeReleased: true }).released.length, 40);
  });

  test('DAP 标准握手在 initialized 后放行 configurationDone，不等待 launch response 自锁', async () => {
    const process = new HandshakeDapProcess();
    const debug = new DebugService({
      bus: new FakeBus(), windowManager: { broadcast() {} },
      spawnProcess: () => process, requestTimeout: 1000,
    });
    const started = await Promise.race([
      debug.start({ type: 'python', program: 'fixture.py', cwd: os.tmpdir() }),
      new Promise(resolve => setTimeout(() => resolve({ error: 'start-timeout' }), 500)),
    ]);
    assert.equal(started.ok, true, 'initialized 事件后必须把控制权交还客户端');
    assert.ok(debug.session.pending.size >= 1, 'configurationDone 前 launch response 应保持待决');
    const configured = await debug.request('configurationDone', {});
    assert.equal(configured.error, undefined);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(debug.session.pending.size, 0, 'configurationDone 后 launch 与配置请求均应消账');
    debug.kill('test-handshake');
  });

  test('DAP terminated 事件立即结束 adapter 会话并释放资源', async () => {
    const ledger = new ResourceLedger({ historyLimit: 10 });
    const process = new FakeDapProcess();
    const debug = new DebugService({
      bus: new FakeBus(), windowManager: { broadcast() {} }, resourceLedger: ledger,
      spawnProcess: () => process, requestTimeout: 1000,
    });
    const started = await debug.start({ type: 'python', program: 'fixture.py', cwd: os.tmpdir() });
    assert.equal(started.ok, true);
    assert.equal(ledger.snapshot().byType['debug-process'], 1);
    debug.onMessage({ type: 'event', event: 'terminated', body: {} }, debug.session);
    assert.equal(debug.session, null);
    assert.equal(process.killed, true);
    assert.equal(ledger.snapshot().activeCount, 0);
    assert.equal(ledger.snapshot({ includeReleased: true }).released[0].releaseReason, 'adapter-terminated');
  });

  test('总装配将 watcher/torrent/Python/DAP 接入同一账本并在退出时销毁', () => {
    const main = read('main/main.js');
    assert.ok(main.includes('new FileWatcher({ bus, windowManager: wm, resourceLedger })'));
    assert.ok(/new TorrentDaemon\(\{[\s\S]{0,180}resourceLedger/.test(main));
    assert.ok(main.includes("torrentDaemon.destroy().catch"));
    assert.ok(main.includes('new PythonKernel({ bus, windowManager: wm, resourceLedger })'));
    assert.ok(main.includes("pyKernel.kill('app-quit')"));
    assert.ok(main.includes('new DebugService({ bus, windowManager: wm, resourceLedger })'));
    assert.ok(main.includes("debugService.kill('app-quit')"));
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
