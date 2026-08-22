// tests/contract/library-locator-store.test.mjs
// Library locator persistence: immutable caller snapshot + serialized legacy
// settings mutation + immediate MazzProgress projection + strict durability flush.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  createLibraryLocatorStore,
  mergeLocatorRecords,
} from '../../renderer/modules/library/locator-store.js';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function fixture({ failSettings = false, failProgress = false } = {}) {
  let settings = {
    'library.progress': {
      legacy: { chapter: 7, anchor: { p: '1/2', t: '旧记录', m: 0 } },
    },
  };
  const calls = [];
  const invoke = async (channel, payload) => {
    calls.push({ channel, payload });
    await wait(channel === 'settings:get' ? 8 : 2);
    if (failSettings) throw new Error('settings offline');
    if (channel === 'settings:get') return settings[payload.key];
    if (channel === 'settings:set') {
      settings = { ...settings, [payload.key]: payload.value };
      return true;
    }
    throw new Error('unexpected channel');
  };
  const projections = [];
  const progress = {
    async put(kind, path, value, options) {
      await wait(1);
      if (failProgress) throw new Error('relay offline');
      projections.push({ kind, path, value, options });
      return true;
    },
    async flushAll() { return true; },
  };
  return {
    invoke, progress, calls, projections,
    read: () => settings['library.progress'],
  };
}

describe('LibraryLocatorStore', () => {
  test('本地与同步 locator 按 updatedAt 双向 newer-wins，缺失时间戳时本地优先', () => {
    const localNew = { chapter: 8, ratio: 0.6, updatedAt: 200 };
    const syncOld = { value: { chapter: 2, ratio: 0.1, updatedAt: 100 }, updatedAt: 100 };
    assert.deepEqual(mergeLocatorRecords(localNew, syncOld), localNew,
      '旧 LAN 投影不得覆盖已经耐久落盘的本地新位置');

    const localOld = { chapter: 2, ratio: 0.1, updatedAt: 100, spineItemId: 'old-spine', anchor: { t: '旧锚点' } };
    const syncNew = { value: { chapter: 9, ratio: 0.75 }, updatedAt: 300 };
    assert.deepEqual(mergeLocatorRecords(localOld, syncNew), {
      chapter: 9, ratio: 0.75, updatedAt: 300,
    }, '更新的 LAN 位置必须作为原子 winner，不能混入旧 spine/anchor 造出不存在的位置');

    const localUntimed = { chapter: 5, ratio: 0.4 };
    assert.deepEqual(mergeLocatorRecords(localUntimed, { value: { chapter: 1 } }), localUntimed,
      '两边都没有可信时间戳时必须以 workspace 本地账为准');
  });

  test('put 在调用瞬间快照 id/path/record，并保持旧数据形态兼容', async () => {
    const fx = fixture();
    const store = createLibraryLocatorStore({ invoke: fx.invoke, progress: fx.progress });
    const input = {
      bookId: 'book-a',
      path: 'D:/workspace/书库/a.epub',
      rec: { chapter: 2, ratio: 0.25, anchor: { p: '3/1', t: '原始句', m: 2 } },
    };
    const done = store.put(input);
    input.bookId = 'book-b';
    input.path = 'D:/workspace/书库/b.epub';
    input.rec.chapter = 99;
    input.rec.anchor.t = '已被调用方改写';
    const receipt = await done;

    assert.equal(receipt.ok, true);
    assert.equal(fx.read().legacy.chapter, 7, '旧 library.progress 记录必须原样保留');
    assert.equal(fx.read()['book-a'].chapter, 2, '写入必须使用调用瞬间的 record');
    assert.equal(fx.read()['book-a'].anchor.t, '原始句');
    assert.equal(fx.read()['book-b'], undefined, '不得在 await 后重新读取可变 bookId');
    assert.deepEqual(fx.projections, [{
      kind: 'library',
      path: 'D:/workspace/书库/a.epub',
      value: { chapter: 2, ratio: 0.25, anchor: { p: '3/1', t: '原始句', m: 2 } },
      options: { immediate: true },
    }], 'MazzProgress 必须收到同一份不可变快照并立即投影');
  });

  test('不同书与同一本书的 read-modify-write 全部串行，不丢记录', async () => {
    const fx = fixture();
    const store = createLibraryLocatorStore({ invoke: fx.invoke, progress: fx.progress });
    const p1 = store.put('book-a', 'A.epub', { chapter: 1 });
    const p2 = store.put('book-b', 'B.epub', { chapter: 4 });
    const p3 = store.put('book-a', 'A.epub', { chapter: 3 });
    await store.flush('book-a');
    await Promise.all([p1, p2, p3]);

    assert.equal(fx.read().legacy.chapter, 7);
    assert.equal(fx.read()['book-a'].chapter, 3, '同书后写必须稳定覆盖先写');
    assert.equal(fx.read()['book-b'].chapter, 4, '异书并发不得被整对象 RMW 覆盖掉');
    const channels = fx.calls.map(call => call.channel);
    assert.deepEqual(channels, [
      'settings:get', 'settings:set',
      'settings:get', 'settings:set',
      'settings:get', 'settings:set',
    ], '每次 legacy object mutation 必须完整串行');
  });

  test('两个 renderer 的 locator store 只提交单书语义补丁，不用陈旧全量快照回滚另一书', async () => {
    let ledger = { a: { chapter: 0 }, b: { chapter: 0 } };
    let reads = 0;
    let releaseReads;
    const bothRead = new Promise(resolve => { releaseReads = resolve; });
    const invoke = async (channel, payload = {}) => {
      if (channel === 'settings:get') {
        const snapshot = JSON.parse(JSON.stringify(ledger));
        reads++;
        if (reads === 2) releaseReads();
        await bothRead;
        return snapshot;
      }
      if (channel === 'settings:set') {
        const patch = payload.libraryLocatorPatch;
        assert.ok(patch?.bookId && patch?.record, 'repository bridge must receive one-book semantic patch');
        ledger = { ...ledger, [patch.bookId]: JSON.parse(JSON.stringify(patch.record)) };
        return true;
      }
      throw new Error(`unexpected ${channel}`);
    };
    const progress = { put: async () => true, flushAll: async () => true };
    const storeA = createLibraryLocatorStore({ invoke, progress });
    const storeB = createLibraryLocatorStore({ invoke, progress });
    await Promise.all([
      storeA.put({ bookId: 'a', path: 'a.epub', record: { chapter: 8 } }),
      storeB.put({ bookId: 'b', path: 'b.epub', record: { chapter: 9 } }),
    ]);
    assert.equal(ledger.a.chapter, 8);
    assert.equal(ledger.b.chapter, 9);
  });

  test('put 以失败回执收口 UI，flush(bookId/all) 向关闭耐久闸显式报错', async () => {
    const fx = fixture({ failSettings: true, failProgress: true });
    const store = createLibraryLocatorStore({ invoke: fx.invoke, progress: fx.progress });
    const pending = store.put({ bookId: 'broken', path: 'broken.epub', record: { chapter: 1 } });
    const receipt = await pending;

    assert.equal(receipt.accepted, true);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.settings, false);
    assert.equal(receipt.projection, false);
    await assert.rejects(() => store.flush('broken'), error => (
      error?.code === 'LIBRARY_LOCATOR_DURABILITY_FAILED'
      && error.bookId === 'broken'
    ), '按书 flush 必须把已经完成但失败的回执升级为耐久错误');
    await assert.rejects(() => store.flushAll(), error => (
      error?.code === 'LIBRARY_LOCATOR_DURABILITY_FAILED'
      && error.failures?.[0]?.bookId === 'broken'
    ), '全量 flush 不得把失败伪装成空成功回执');
  });

  test('无效或不可序列化记录被安静拒绝，不污染队列', async () => {
    const fx = fixture();
    const store = createLibraryLocatorStore({ invoke: fx.invoke, progress: fx.progress });
    const circular = {}; circular.self = circular;
    const a = await store.put({ bookId: '', path: 'x', record: { chapter: 1 } });
    const b = await store.put({ bookId: 'x', path: 'x', record: circular });
    assert.equal(a.accepted, false);
    assert.equal(b.accepted, false);
    assert.equal(fx.calls.length, 0);
    assert.equal(fx.projections.length, 0);
  });
});
