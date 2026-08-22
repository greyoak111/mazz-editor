// W88 renderer wiring for main-owned import receipts.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const wait = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));

function createBridge(source = 'reader payload') {
  const settings = new Map();
  const finalizations = [];
  const materializations = [];
  const listeners = new Map();
  let materializeHook = null;
  const encoded = Buffer.from(source).toString('base64');
  const bridge = {
    isElectron: true,
    async invoke(channel, payload = {}) {
      if (channel === 'workspace:get') return 'D:/Atomic-Workspace';
      if (channel === 'settings:get') return settings.has(payload.key) ? structuredClone(settings.get(payload.key)) : null;
      if (channel === 'settings:set') { settings.set(payload.key, structuredClone(payload.value)); return true; }
      if (channel === 'settings:compareAndSet') {
        const entries = Array.isArray(payload.entries) ? payload.entries : [payload];
        for (const entry of entries) {
          const current = settings.has(entry.key) ? settings.get(entry.key) : null;
          if (JSON.stringify(current) !== JSON.stringify(entry.expected)) {
            return { ok: false, key: entry.key, current: structuredClone(current) };
          }
        }
        for (const entry of entries) settings.set(entry.key, structuredClone(entry.value));
        return { ok: true };
      }
      if (channel === 'fs:stat') return { exists: payload.path === 'E:/Incoming/atomic.txt', size: Buffer.byteLength(source) };
      if (channel === 'fs:readFileBase64') return encoded;
      if (channel === 'library:importMaterialize') {
        materializations.push(structuredClone(payload));
        if (materializeHook) await materializeHook(payload);
        return {
          path: 'D:/Atomic-Workspace/书库/atomic.txt', created: true,
          receiptId: `receipt-${materializations.length}`, sourceHash: payload.fingerprint,
        };
      }
      if (channel === 'library:importFinalize') {
        finalizations.push(structuredClone(payload));
        return { ok: true, owned: true, kept: payload.keep === true, deleted: payload.keep !== true };
      }
      if (channel === 'fs:delete') throw new Error('desktop receipt cleanup must not use generic fs:delete');
      return null;
    },
    on(channel, callback) {
      let bucket = listeners.get(channel);
      if (!bucket) listeners.set(channel, bucket = new Set());
      bucket.add(callback);
      return () => bucket.delete(callback);
    },
    setMaterializeHook(hook) { materializeHook = hook; },
    materializations,
    finalizations,
  };
  return bridge;
}

window.MazzCommands = { execute: () => {} };
window.MazzHost = { notifyChange: () => {}, setTabTitle: () => {}, openTab: () => {}, toast: () => {} };
window.MazzProgress = { put: async () => true, flushAll: async () => true };

const { default: libraryModule } = await import('../../renderer/modules/library/index.js');

async function mount(bridge) {
  window.mazz = bridge;
  const container = document.createElement('div');
  document.body.appendChild(container);
  libraryModule.create(container);
  const ctl = libraryModule._forTests.instances.get(container);
  for (let i = 0; i < 40 && !ctl.repository.identity; i++) await wait(10);
  assert.ok(ctl.repository.identity);
  return { ctl, container };
}

describe('W88 Library · renderer import receipt transaction', () => {
  test('desktop renderer persists only the final path returned by main and commits its receipt', async () => {
    const bridge = createBridge();
    const { ctl, container } = await mount(bridge);
    try {
      const id = await ctl.importPath('E:/Incoming/atomic.txt', { silent: true });
      const books = await ctl.repository.listBooks();
      assert.equal(books.length, 1);
      assert.equal(books[0].id, id);
      assert.equal(books[0].path, 'D:/Atomic-Workspace/书库/atomic.txt');
      assert.equal(bridge.materializations.length, 1);
      assert.deepEqual(bridge.finalizations, [{ receiptId: 'receipt-1', keep: true }]);
    } finally {
      await ctl.destroy();
      container.remove();
    }
  });

  test('a CAS winner discovered after materialization causes only this renderer receipt to be rolled back', async () => {
    const bridge = createBridge('duplicate race payload');
    const { ctl, container } = await mount(bridge);
    try {
      bridge.setMaterializeHook(async payload => {
        await ctl.repository.mutateBooks(books => [...books, {
          id: 'winner', title: '并发胜者', author: '', cover: '',
          path: 'D:/Atomic-Workspace/书库/winner.txt', sourcePath: 'Z:/Other/winner.txt',
          sourceHash: payload.fingerprint, format: 'txt', category: '未分类', addedAt: 1,
        }]);
      });
      const id = await ctl.importPath('E:/Incoming/atomic.txt', { silent: true });
      assert.equal(id, 'winner');
      assert.deepEqual(bridge.finalizations, [{ receiptId: 'receipt-1', keep: false }]);
      assert.equal((await ctl.repository.listBooks()).length, 1, 'losing renderer must not append a second record');
    } finally {
      await ctl.destroy();
      container.remove();
    }
  });
});
