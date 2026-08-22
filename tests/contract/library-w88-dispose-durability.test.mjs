// W88 close durability: whole-window close is a prepare/commit transaction.
import './_setup.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, test, assert } from '../harness.mjs';
import { ModuleRegistry, modules } from '../../renderer/core/module-registry.js';
import { SnapshotService, snapshots } from '../../renderer/core/snapshot-service.js';
import { Shell } from '../../renderer/shell/shell.js';

const shellSource = readFileSync(new URL('../../renderer/shell/shell.js', import.meta.url), 'utf8');
const librarySource = readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');
const windowManagerSource = readFileSync(new URL('../../main/window-manager.js', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../../main/store.js', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function instance(def = {}, name = 'library') {
  return {
    name,
    container: {},
    state: {},
    ownerGeneration: 1,
    def: { deactivate() {}, dispose() {}, ...def },
  };
}

function loadWindowManager(appMock) {
  const filename = path.resolve('main/window-manager.js');
  const source = readFileSync(filename, 'utf8');
  const module = { exports: {} };
  const electron = {
    app: appMock,
    BrowserWindow: class {},
    screen: { getAllDisplays: () => [] },
    nativeTheme: { shouldUseDarkColors: false },
  };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require(id) {
      if (id === 'electron') return electron;
      if (id === 'path') return path;
      throw new Error(`unexpected require: ${id}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Promise,
  }, { filename });
  return module.exports;
}

function loadStore(fsMock) {
  const filename = path.resolve('main/store.js');
  const module = { exports: {} };
  vm.runInNewContext(storeSource, {
    module,
    exports: module.exports,
    require(id) {
      if (id === 'fs') return fsMock;
      if (id === 'path') return path;
      throw new Error(`unexpected require: ${id}`);
    },
  }, { filename });
  return module.exports;
}

class FakeWebContents extends EventEmitter {
  constructor(run) {
    super();
    this.run = run;
    this.calls = [];
    this.sent = [];
    this.destroyed = false;
  }
  isDestroyed() { return this.destroyed; }
  executeJavaScript(script, userGesture) {
    this.calls.push({ script, userGesture });
    return this.run();
  }
  send(channel, payload) { this.sent.push({ channel, payload }); }
}

class FakeWindow extends EventEmitter {
  constructor(webContents) {
    super();
    this.webContents = webContents;
    this.destroyed = false;
    this.closeCalls = 0;
    this.allowedCloses = 0;
  }
  isDestroyed() { return this.destroyed; }
  close() {
    this.closeCalls++;
    const event = {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    this.emit('close', event);
    if (!event.defaultPrevented) {
      this.allowedCloses++;
      this.destroyed = true;
      this.webContents.destroyed = true;
      this.webContents.emit('destroyed');
    }
  }
}

function makeManager(run = () => Promise.resolve({ ok: true }), { main = false } = {}) {
  const appMock = { quitCalls: 0, quit() { this.quitCalls++; } };
  const WindowManager = loadWindowManager(appMock);
  const manager = new WindowManager({ store: { get: () => null }, iconPath: '' });
  const webContents = new FakeWebContents(run);
  const win = new FakeWindow(webContents);
  manager.wireDurableClose(win, { main });
  return { appMock, manager, webContents, win };
}

describe('W88 close · ModuleRegistry two-phase owner transaction', () => {
  test('single-tab prepare keeps the active owner installed until durability succeeds', async () => {
    const gate = deferred();
    let deactivated = 0;
    let committed = 0;
    const registry = new ModuleRegistry();
    const live = instance({
      prepareDispose: () => gate.promise,
      commitDispose(receipt) { assert.equal(receipt.token, 'durable'); committed++; },
      deactivate() { deactivated++; },
    });
    registry.instances.set('tab-a', live);
    const sibling = instance({}, 'markdown');
    sibling.ownerGeneration = 2;
    registry.instances.set('tab-b', sibling);

    const pending = registry.detach('tab-a');
    assert.equal(registry.instances.get('tab-a'), live);
    assert.equal(deactivated, 0, 'durability preflight must not deactivate the active tab');
    assert.equal(registry.detach('tab-a'), pending, 'duplicate close reuses exactly one attempt');
    gate.resolve({ token: 'durable' });
    assert.equal(await pending, true);
    assert.equal(registry.instances.has('tab-a'), false);
    assert.equal(registry.instances.get('tab-b'), sibling, 'single-tab commit must not disturb sibling owners');
    assert.equal(deactivated, 1);
    assert.equal(committed, 1);
  });

  test('failed single-tab preflight aborts without deactivate and a clean retry is isolated', async () => {
    let tries = 0;
    let aborted = 0;
    let deactivated = 0;
    const registry = new ModuleRegistry();
    const live = instance({
      prepareDispose() {
        tries++;
        if (tries === 1) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        return { try: tries };
      },
      abortDispose() { aborted++; },
      commitDispose() { return true; },
      deactivate() { deactivated++; },
    });
    registry.instances.set('retry', live);
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.equal(await registry.detach('retry'), false);
      assert.equal(registry.instances.get('retry'), live);
      assert.equal(deactivated, 0);
      assert.equal(aborted, 1);
      assert.equal(registry.disposalByTab.has('retry'), false);
      assert.equal(await registry.detach('retry'), true);
    } finally {
      console.error = originalError;
    }
    assert.equal(tries, 2);
    assert.equal(deactivated, 1);
    assert.equal(registry.instances.has('retry'), false);
  });

  test('prepareAll failure aborts prepared receipts and tears down no module', async () => {
    const calls = [];
    const registry = new ModuleRegistry();
    registry.instances.set('one', instance({
      prepareDispose() { calls.push('prepare-one'); return { one: true }; },
      abortDispose() { calls.push('abort-one'); },
      deactivate() { calls.push('deactivate-one'); },
    }, 'one'));
    registry.instances.set('two', instance({
      prepareDispose() { calls.push('prepare-two'); throw new Error('expected failure'); },
      abortDispose() { calls.push('abort-two'); },
      deactivate() { calls.push('deactivate-two'); },
    }, 'two'));

    await assert.rejects(() => registry.prepareAll({ reason: 'test' }), /expected failure/);
    assert.equal(registry.instances.size, 2);
    assert.deepEqual(calls, ['prepare-one', 'prepare-two', 'abort-two', 'abort-one']);
  });

  test('commitPrepared validates the whole owner set before the first deactivate', async () => {
    const calls = [];
    const registry = new ModuleRegistry();
    const first = instance({
      prepareDispose() { calls.push('prepare-one'); return 'one'; },
      commitDispose() { calls.push('commit-one'); },
      deactivate() { calls.push('deactivate-one'); },
    }, 'one');
    const second = instance({
      prepareDispose() { calls.push('prepare-two'); return 'two'; },
      commitDispose() { calls.push('commit-two'); },
      deactivate() { calls.push('deactivate-two'); },
    }, 'two');
    registry.instances.set('one', first);
    registry.instances.set('two', second);
    const attempt = await registry.prepareAll({ reason: 'window-close' });
    assert.equal(registry.instances.size, 2, 'prepare phase may not detach any owner');
    assert.deepEqual(calls, ['prepare-one', 'prepare-two']);
    assert.equal(await registry.commitPrepared(attempt), true);
    assert.equal(registry.instances.size, 0);
    assert.deepEqual(calls, [
      'prepare-one', 'prepare-two',
      'deactivate-one', 'commit-one', 'deactivate-two', 'commit-two',
    ]);
  });

  test('owner replacement during prepare aborts the old receipt and preserves the new owner', async () => {
    const gate = deferred();
    let aborted = 0;
    let deactivated = 0;
    const registry = new ModuleRegistry();
    const oldOwner = instance({
      prepareDispose: () => gate.promise,
      abortDispose() { aborted++; },
      deactivate() { deactivated++; },
    });
    const newOwner = instance({}, 'replacement');
    newOwner.ownerGeneration = 2;
    registry.instances.set('same', oldOwner);
    const pending = registry.prepareAll();
    registry.instances.set('same', newOwner);
    gate.resolve({ ok: true });
    await assert.rejects(() => pending, /owner/);
    assert.equal(registry.instances.get('same'), newOwner);
    assert.equal(aborted, 1);
    assert.equal(deactivated, 0);
  });

  test('whole-window prepare owns the registry lock and rejects a racing single-tab detach', async () => {
    const gate = deferred();
    let deactivated = 0;
    const registry = new ModuleRegistry();
    const first = instance({
      prepareDispose: () => gate.promise,
      deactivate() { deactivated++; },
    }, 'first');
    const second = instance({ deactivate() { deactivated++; } }, 'second');
    registry.instances.set('first', first);
    registry.instances.set('second', second);

    const preparing = registry.prepareAll({ reason: 'window-close' });
    assert.equal(await registry.detach('second'), false,
      'a tab close may not start while the all-owner snapshot is being prepared');
    assert.equal(registry.instances.get('first'), first);
    assert.equal(registry.instances.get('second'), second);
    assert.equal(deactivated, 0);

    gate.resolve({ ok: true });
    const attempt = await preparing;
    assert.equal(await registry.abortPrepared(attempt), true);
    assert.equal(registry._registryDisposeAttempt, null);
    assert.equal(await registry.detach('second'), true,
      'abort must release only its own registry attempt so a retry can proceed');
  });
});

describe('W88 close · strict snapshot retry ledger', () => {
  test('flushStrict removes only successful exact revisions and retains a failed tab', async () => {
    const originalMazz = window.mazz;
    const service = new SnapshotService();
    service.track('ok', () => ({ content: 'A' }));
    service.track('fail', () => ({ content: 'B' }));
    service.markDirty('ok');
    service.markDirty('fail');
    window.mazz = {
      isElectron: true,
      async invoke(_channel, { tabId }) {
        if (tabId === 'fail') throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
        return true;
      },
    };
    const originalError = console.error;
    console.error = () => {};
    try { await assert.rejects(() => service.flushStrict(), /ENOSPC/); }
    finally { console.error = originalError; window.mazz = originalMazz; }
    assert.equal(service.dirty.has('ok'), false);
    assert.equal(service.dirty.has('fail'), true);
  });

  test('edit arriving during snapshot IPC remains dirty after the older receipt', async () => {
    const originalMazz = window.mazz;
    const gate = deferred();
    const service = new SnapshotService();
    service.track('draft', () => ({ content: 'latest' }));
    service.markDirty('draft');
    window.mazz = { isElectron: true, invoke: () => gate.promise };
    const pending = service.flushStrict();
    service.markDirty('draft');
    gate.resolve(true);
    await pending;
    window.mazz = originalMazz;
    assert.equal(service.dirty.has('draft'), true, 'late edit must survive an older in-flight receipt');
  });

  test('untrackStrict rejection preserves getter and dirty retry state', async () => {
    const originalMazz = window.mazz;
    const service = new SnapshotService();
    service.track('draft', () => ({ content: 'x' }));
    service.markDirty('draft');
    window.mazz = { isElectron: true, invoke: async () => { throw new Error('clear failed'); } };
    await assert.rejects(() => service.untrackStrict('draft'), /clear failed/);
    window.mazz = originalMazz;
    assert.equal(service.getters.has('draft'), true);
    assert.equal(service.dirty.has('draft'), true);
  });

  test('flushStrict treats a missing live getter as a durability failure and retains dirty', async () => {
    const originalMazz = window.mazz;
    const service = new SnapshotService();
    service.dirty.add('orphan');
    service.dirtyRevision.set('orphan', 1);
    window.mazz = { isElectron: true, invoke: async () => true };
    const originalError = console.error;
    console.error = () => {};
    try {
      await assert.rejects(() => service.flushStrict(), error => error?.code === 'SNAPSHOT_DURABILITY_SKIPPED');
    } finally {
      console.error = originalError;
      window.mazz = originalMazz;
    }
    assert.equal(service.dirty.has('orphan'), true);
    assert.equal(service.dirtyRevision.get('orphan'), 1);
  });
});

describe('W88 close · Shell whole-window preflight behavior', () => {
  async function withShellFixture({ choice = 1, snapshotFailure = null, snapshotFailureTab = null,
    save = null, sibling = false } = {}, run) {
    const originalMazz = window.mazz;
    const originalInstances = modules.instances;
    const originalWrite = snapshots.writePayloadStrict;
    const originalUntrack = snapshots.untrack;
    const tab = { id: 'draft', title: '未命名.md', dirty: true, filePath: null, moduleId: 'markdown' };
    const events = [];
    let content = '最后一个字';
    const inst = instance({
      readOnly: false,
      managedSave: false,
      getContent() { return content; },
      beforeClose() { events.push('beforeClose'); return true; },
      prepareDispose() { events.push('prepare'); return { durable: true }; },
      abortDispose() { events.push('abort'); },
      commitDispose() { events.push('commit'); },
      deactivate() { events.push('deactivate'); },
    }, 'markdown');
    const siblingTab = { id: 'library', title: '书库', dirty: false, filePath: null, moduleId: 'library' };
    const siblingInst = instance({
      readOnly: true,
      beforeClose() { events.push('sibling-beforeClose'); return true; },
      prepareDispose() { events.push('sibling-prepare'); return { durable: 'library' }; },
      abortDispose() { events.push('sibling-abort'); },
      commitDispose() { events.push('sibling-commit'); },
      deactivate() { events.push('sibling-deactivate'); },
      getContent() { return 'library-owner'; },
    }, 'library');
    const fixtureTabs = sibling ? [tab, siblingTab] : [tab];
    modules.instances = new Map(sibling ? [['draft', inst], ['library', siblingInst]] : [['draft', inst]]);
    window.mazz = {
      isElectron: true,
      async invoke(channel) {
        if (channel === 'dialog:confirm') return choice;
        throw new Error(`unexpected invoke: ${channel}`);
      },
    };
    const snapshotsSeen = [];
    snapshots.writePayloadStrict = async (id, payload) => {
      snapshotsSeen.push(structuredClone(payload));
      if (snapshotFailure && (!snapshotFailureTab || snapshotFailureTab === id)) throw snapshotFailure;
      return { ok: true };
    };
    snapshots.untrack = id => events.push(`untrack:${id}`);
    const root = document.createElement('div');
    const shell = Object.create(Shell.prototype);
    Object.assign(shell, {
      root,
      paneTree: { leaves: () => [{ tabs: { tabs: fixtureTabs } }] },
      findTabById: id => {
        const found = fixtureTabs.find(candidate => candidate.id === id);
        return found ? { tab: found } : null;
      },
      saveTab: async target => {
        events.push('save');
        if (save === false) return false;
        target.dirty = false;
        content = '已保存的最后一个字';
        return true;
      },
      captureProgressFor: () => Promise.resolve({ ok: true }),
      progressRelay: { async flushAll() { events.push('progress'); } },
      externalChanges: { dispose() { events.push('external-dispose'); } },
      _provisionalHandoffs: new Map(),
      _handoffSourceLock: null,
      _progressTimer: setInterval(() => {}, 60_000),
      _prepareClosePromise: null,
    });
    try { await run({ shell, tab, inst, siblingTab, siblingInst, events, snapshotsSeen }); }
    finally {
      clearInterval(shell._progressTimer);
      modules.instances = originalInstances;
      snapshots.writePayloadStrict = originalWrite;
      snapshots.untrack = originalUntrack;
      window.mazz = originalMazz;
    }
  }

  test('不保存 still snapshots the live last keystroke, then clears recovery only after commit', async () => {
    await withShellFixture({ choice: 1 }, async ({ shell, tab, events, snapshotsSeen }) => {
      const result = await shell.prepareForClose('test');
      assert.equal(result.ok, true);
      assert.equal(snapshotsSeen[0].content, '最后一个字');
      assert.equal(snapshotsSeen[0].dirty, true);
      assert.equal(tab.dirty, true, '不保存 decision remains explicit until the window commit');
      assert.ok(events.indexOf('prepare') < events.indexOf('commit'));
      assert.ok(events.indexOf('progress') < events.indexOf('commit'));
      assert.ok(events.indexOf('commit') < events.indexOf('untrack:draft'));
    });
  });

  test('strict snapshot failure aborts prepared Library-style owner without deactivate', async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      await withShellFixture({ choice: 1, snapshotFailure: Object.assign(new Error('disk full'), { code: 'ENOSPC' }) },
        async ({ shell, tab, inst, events }) => {
          const result = await shell.prepareForClose('test');
          assert.equal(result.ok, false);
          assert.equal(result.code, 'ENOSPC');
          assert.equal(modules.instances.get(tab.id), inst);
          assert.equal(tab.dirty, true);
          assert.equal(shell.root.inert, false);
          assert.ok(events.includes('abort'));
          assert.equal(events.includes('deactivate'), false);
          await Promise.resolve();
          assert.equal(shell._prepareClosePromise, null, 'failed attempt must permit a fresh retry');
        });
    } finally { console.error = originalError; }
  });

  test('a later tab snapshot failure aborts every prepared owner before any teardown', async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      await withShellFixture({
        choice: 1,
        sibling: true,
        snapshotFailureTab: 'library',
        snapshotFailure: Object.assign(new Error('second snapshot failed'), { code: 'ENOSPC' }),
      }, async ({ shell, tab, inst, siblingTab, siblingInst, events, snapshotsSeen }) => {
        const result = await shell.prepareForClose('test');
        assert.equal(result.ok, false);
        assert.equal(result.code, 'ENOSPC');
        assert.deepEqual(snapshotsSeen.map(payload => payload.content), ['最后一个字', 'library-owner']);
        assert.equal(modules.instances.get(tab.id), inst);
        assert.equal(modules.instances.get(siblingTab.id), siblingInst);
        assert.equal(events.includes('deactivate'), false);
        assert.equal(events.includes('sibling-deactivate'), false);
        assert.ok(events.includes('abort'));
        assert.ok(events.includes('sibling-abort'));
        assert.equal(shell.root.inert, false);
      });
    } finally { console.error = originalError; }
  });

  test('取消 occurs before freeze and starts no module durability work', async () => {
    await withShellFixture({ choice: 2 }, async ({ shell, events, snapshotsSeen }) => {
      const result = await shell.prepareForClose('test');
      assert.equal(result.ok, false);
      assert.equal(result.cancelled, true);
      assert.equal(!!shell.root.inert, false);
      assert.deepEqual(events, []);
      assert.deepEqual(snapshotsSeen, []);
    });
  });

  test('保存 decision snapshots post-save content before teardown', async () => {
    await withShellFixture({ choice: 0 }, async ({ shell, tab, events, snapshotsSeen }) => {
      const result = await shell.prepareForClose('test');
      assert.equal(result.ok, true);
      assert.equal(tab.dirty, false);
      assert.equal(snapshotsSeen[0].content, '已保存的最后一个字');
      assert.equal(events[0], 'save');
    });
  });
});

describe('W88 close · main-process close handshake', () => {
  test('Store write failure keeps the last in-memory snapshot and throws to its caller', () => {
    let renamed = false;
    let unlinked = false;
    const Store = loadStore({
      existsSync: () => false,
      mkdirSync: () => {},
      writeFileSync: () => {},
      renameSync: () => { renamed = true; throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
      unlinkSync: () => { unlinked = true; },
    });
    const store = new Store('D:/state/mazz.json', { stable: 1 });
    assert.throws(() => store.set('library', { revision: 2 }), error => error?.code === 'ENOSPC');
    assert.equal(renamed, true);
    assert.equal(unlinked, true);
    assert.equal(store.get('stable'), 1);
    assert.equal(store.get('library'), undefined);
  });

  test('product wiring contains dirty choice, strict snapshot and explicit prepare/commit/abort', () => {
    const closeStart = shellSource.indexOf('prepareForClose(reason');
    const closeEnd = shellSource.indexOf('\n  /** Ribbon', closeStart);
    const close = shellSource.slice(closeStart, closeEnd);
    for (const token of [
      "invoke('dialog:confirm'", 'this.saveTab(tab)', 'modules.prepareAll(',
      'snapshots.writePayloadStrict(', 'this.progressRelay.flushAll()',
      'modules.commitPrepared(', 'modules.abortPrepared(',
    ]) assert.ok(close.includes(token), `window close transaction missing ${token}`);
    for (const token of ['prepareDispose(', 'commitDispose(', 'abortDispose(']) {
      assert.ok(librarySource.includes(token), `Library missing ${token}`);
    }
    assert.match(windowManagerSource, /this\.wireDurableClose\(win, \{ main: true \}\)/);
    assert.match(windowManagerSource, /this\.wireDurableClose\(win\)/);
  });

  test('duplicate close runs one fixed script and closes only after a positive ACK', async () => {
    const gate = deferred();
    const { webContents, win } = makeManager(() => gate.promise);
    win.close();
    win.close();
    assert.equal(webContents.calls.length, 1);
    assert.equal(webContents.calls[0].script,
      'globalThis.MazzShell?.prepareForClose?.("window-close") ?? true');
    assert.equal(webContents.calls[0].userGesture, true);
    assert.equal(win.allowedCloses, 0);
    gate.resolve({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(win.allowedCloses, 1);
  });

  test('renderer NACK keeps the window open and a later close starts a fresh attempt', async () => {
    const { webContents, win } = makeManager(() => Promise.resolve({
      ok: false, code: 'ENOSPC', message: 'disk full',
    }));
    const originalError = console.error;
    console.error = () => {};
    try {
      win.close();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(win.allowedCloses, 0);
      assert.equal(win.__durableCloseReady, false);
      assert.equal(win.__durableClosePending, null);
      assert.equal(webContents.sent.at(-1).payload.channel, 'window:durability-failed');
      assert.equal(webContents.sent.at(-1).payload.payload.code, 'ENOSPC');
      win.close();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(webContents.calls.length, 2);
    } finally { console.error = originalError; }
  });

  test('active renderer timeout warns but does not clear pending or force close; late ACK commits', async () => {
    const gate = deferred();
    const { manager, webContents, win } = makeManager(() => gate.promise);
    manager.closeDurabilityTimeoutMs = 5;
    win.close();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(win.allowedCloses, 0);
    assert.equal(win.__durableCloseReady, false);
    assert.ok(win.__durableClosePending);
    assert.equal(webContents.sent.at(-1).payload.payload.code, 'WINDOW_CLOSE_DURABILITY_PENDING');
    gate.resolve({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(win.allowedCloses, 1);
  });

  test('renderer gone is the only no-ACK path that closes immediately', async () => {
    const { webContents, win } = makeManager(() => new Promise(() => {}));
    win.close();
    webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(win.allowedCloses, 1);
  });

  test('onCloseRequest/Store exception is caught after the initial veto and notifies renderer', async () => {
    const { manager, webContents, win } = makeManager(() => Promise.resolve({ ok: true }), { main: true });
    manager.onCloseRequest = () => { throw Object.assign(new Error('store failed'), { code: 'ENOSPC' }); };
    const originalError = console.error;
    console.error = () => {};
    try { win.close(); await new Promise(resolve => setTimeout(resolve, 0)); }
    finally { console.error = originalError; }
    assert.equal(win.allowedCloses, 0);
    assert.equal(webContents.calls.length, 0, 'policy failure must not start renderer teardown');
    assert.equal(webContents.sent.at(-1).payload.payload.code, 'ENOSPC');
  });

  test('app quit resumes only after the durability ACK', async () => {
    const gate = deferred();
    const { appMock, manager, win } = makeManager(() => gate.promise);
    manager.forceClose = true;
    win.close();
    gate.resolve({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(appMock.quitCalls, 1);
    assert.equal(win.__durableCloseReady, true);
  });

  test('multi-window app quit keeps one idempotent transaction per live renderer', async () => {
    const gates = [deferred(), deferred()];
    const windows = [];
    const appMock = {
      quitCalls: 0,
      quit() {
        this.quitCalls++;
        for (const win of windows) if (!win.isDestroyed()) win.close();
      },
    };
    const WindowManager = loadWindowManager(appMock);
    const manager = new WindowManager({ store: { get: () => null }, iconPath: '' });
    manager.forceClose = true;
    for (const gate of gates) {
      const webContents = new FakeWebContents(() => gate.promise);
      const win = new FakeWindow(webContents);
      windows.push(win);
      manager.wireDurableClose(win);
    }

    appMock.quit();
    assert.deepEqual(windows.map(win => win.webContents.calls.length), [1, 1]);
    assert.deepEqual(windows.map(win => win.allowedCloses), [0, 0]);

    gates[0].resolve({ ok: true });
    await windows[0].__durableClosePending;
    assert.equal(windows[0].destroyed, true);
    assert.equal(windows[1].destroyed, false);
    assert.equal(windows[1].webContents.calls.length, 1,
      'the second app.quit pass must reuse the already-running renderer transaction');

    gates[1].resolve({ ok: true });
    await windows[1].__durableClosePending;
    assert.deepEqual(windows.map(win => win.destroyed), [true, true]);
    assert.deepEqual(windows.map(win => win.webContents.calls.length), [1, 1]);
  });
});
