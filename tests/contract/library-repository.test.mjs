// W88 LibraryRepository: workspace partitioning, one-key transaction queues,
// conservative v1 migration and path/content duplicate detection.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  createLibraryRepository,
  canonicalWorkspace,
  stableHash,
  sameBook,
  dedupeBooks,
  createLibraryRepositoryCoordinator,
  LIBRARY_REPOSITORY_SCHEMA,
} from '../../renderer/modules/library/repository.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function jsonEqual(left, right) {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function casFixture(initial = {}) {
  const settings = new Map(Object.entries(initial));
  const calls = [];
  const invoke = async (channel, payload = {}) => {
    calls.push({ channel, payload });
    if (channel === 'workspace:get') return 'D:/default';
    if (channel === 'settings:get') return structuredClone(settings.get(payload.key));
    if (channel === 'settings:set') {
      settings.set(payload.key, structuredClone(payload.value));
      return true;
    }
    if (channel === 'settings:compareAndSet') {
      const entries = Array.isArray(payload.entries)
        ? payload.entries
        : [{ key: payload.key, expected: payload.expected, value: payload.value }];
      const current = entries.map(entry => settings.get(entry.key));
      const conflict = entries.findIndex((entry, index) => !jsonEqual(current[index], entry.expected));
      if (conflict >= 0) {
        return { ok: false, key: entries[conflict].key, current: structuredClone(current[conflict]) };
      }
      // Deliberately no await: this models one synchronous main-process IPC
      // handler turn, including the all-or-nothing multi-key boundary.
      for (const entry of entries) settings.set(entry.key, structuredClone(entry.value));
      return { ok: true };
    }
    throw new Error(`unexpected channel ${channel}`);
  };
  return { settings, calls, invoke };
}

function fixture(initial = {}) {
  const settings = new Map(Object.entries(initial));
  const calls = [];
  const invoke = async (channel, payload) => {
    calls.push({ channel, payload });
    if (channel === 'workspace:get') return 'D:/default';
    if (channel === 'settings:get') {
      await wait(2);
      return structuredClone(settings.get(payload.key));
    }
    if (channel === 'settings:set') {
      await wait(1);
      settings.set(payload.key, structuredClone(payload.value));
      return true;
    }
    throw new Error(`unexpected channel ${channel}`);
  };
  return { settings, calls, invoke };
}

function legacyFixture() {
  return fixture({
    'library.books': [
      { id: 'same-id', title: 'A 本地', path: 'D:\\Alpha\\书库\\a.epub', sourceHash: 'HASH-A', category: '技术' },
      { id: 'out-1', title: '外部书', path: 'E:/Shared/out.cbz', sourceHash: 'HASH-X', category: '漫画', repositoryScope: 'external' },
      { id: 'dup-path', title: '重复路径', path: 'd:/alpha/书库/./a.epub', category: '技术' },
    ],
    'library.categories': ['技术', '漫画', '无关分类'],
    'library.progress': {
      'same-id': { chapter: 3 },
      'out-1': { page: 8 },
      orphan: { chapter: 99 },
    },
    'library.bookmarks': {
      'same-id': [{ name: '本地签', pos: 2 }],
      'out-1': [{ name: '外部签', pos: 7 }],
      orphan: [{ name: '孤儿签', pos: 1 }],
    },
    'library.cleanrules': [
      { id: 'global', pattern: 'watermark', scope: 'all', type: 'delete', match: 'plain' },
      { id: 'local-rule', pattern: 'alpha', scope: 'book', bookId: 'same-id', type: 'delete', match: 'plain' },
      { id: 'orphan-rule', pattern: 'orphan', scope: 'book', bookId: 'orphan', type: 'delete', match: 'plain' },
    ],
  });
}

describe('W88 LibraryRepository', () => {
  test('workspace identity 与存储 key 稳定，Windows 大小写/分隔符不分裂', async () => {
    assert.equal(canonicalWorkspace(' D:\\Project\\Books\\..\\Mazz\\ '), 'd:/project/mazz');
    assert.equal(canonicalWorkspace('d:/project/mazz/'), 'd:/project/mazz');
    assert.equal(canonicalWorkspace('file:///D:/Project/Mazz'), 'd:/project/mazz');
    assert.equal(canonicalWorkspace('D:\\'), 'd:');
    assert.equal(stableHash(canonicalWorkspace('D:\\Project\\Mazz')),
      stableHash(canonicalWorkspace('d:/project/mazz/')));

    const fx = fixture();
    const a = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:\\Project\\Mazz' });
    const b = createLibraryRepository({ invoke: fx.invoke, workspace: 'd:/project/mazz/' });
    await Promise.all([a.init(), b.init()]);
    assert.equal(a.key('shelf'), b.key('shelf'));
    assert.ok(a.key('shelf').endsWith('.shelf'));
  });

  test('v1 只读迁移：本地进 shelf，外部带归属进 external，孤儿位置不继承', async () => {
    const fx = legacyFixture();
    const repo = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Alpha', now: () => 100 });
    const shelf = await repo.get('shelf');
    const external = await repo.get('external');
    const progress = await repo.getValue('progress');
    const bookmarks = await repo.getValue('bookmarks');
    const cleanRules = await repo.getValue('cleanRules');

    assert.equal(shelf.schema, LIBRARY_REPOSITORY_SCHEMA);
    assert.equal(shelf.revision, 1);
    assert.equal(shelf.migrated, true);
    assert.deepEqual(shelf.value.map(book => book.id), ['same-id'], '当前 workspace 内路径才进入正式书架，重复路径去重');
    assert.deepEqual(external.value.map(book => book.id), ['out-1']);
    assert.equal(external.value[0].repositoryScope, 'external');
    assert.equal(external.value[0].repositoryWorkspace, repo.identity.hash);
    assert.deepEqual(Object.keys(progress).sort(), ['out-1', 'same-id']);
    assert.deepEqual(Object.keys(bookmarks).sort(), ['out-1', 'same-id']);
    assert.deepEqual(cleanRules.map(rule => rule.id), ['global', 'local-rule'],
      '全局规则只认领一次，本书规则只迁移当前 workspace 已接管书籍');
    assert.equal(progress.orphan, undefined, '无所属书籍的旧进度不得污染新 workspace');
    assert.equal(fx.settings.get('library.books').length, 3, '旧 key 保持原样可读，不删不改');
    assert.equal(fx.settings.get('library.progress').orphan.chapter, 99);
    assert.ok(fx.settings.has(repo.metaKey()), '迁移必须留下 schema/revision 元数据');
  });

  test('同一 legacy external 只能被一个 workspace 自动接管', async () => {
    const fx = legacyFixture();
    const alpha = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Alpha' });
    const beta = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Beta' });
    const alphaExternal = await alpha.getValue('external');
    const betaExternal = await beta.getValue('external');
    const betaRules = await beta.getValue('cleanRules');

    assert.deepEqual(alphaExternal.map(book => book.id), ['out-1']);
    assert.deepEqual(betaExternal, [], '第二 workspace 不得从全局 v1 key 自动继承已归属的 external');
    assert.deepEqual(betaRules, [], '第二 workspace 不得继承第一 workspace 已认领的 legacy 全书规则');
    assert.deepEqual(await beta.getValue('shelf'), [], '另一 workspace 也不得继承 Alpha 本地书');
  });

  test('A/B 并发迁移在 claim 锁内重读，legacy external 与全局规则都只有一个 owner', async () => {
    const externalClaimKey = 'library.repository.v2.legacy-external-claims';
    const cleanRuleClaimKey = 'library.repository.v2.legacy-cleanrule-claims';
    const settings = new Map(Object.entries({
      'library.books': [
        { id: 'shared-external', title: '共享旧书', path: 'E:/Legacy/shared.epub', repositoryScope: 'external' },
      ],
      'library.categories': [],
      'library.progress': {},
      'library.bookmarks': {},
      'library.cleanrules': [
        { id: 'shared-rule', pattern: 'watermark', scope: 'all', type: 'delete', match: 'plain' },
      ],
    }));
    const preloads = new Map();
    const invoke = async (channel, payload) => {
      if (channel === 'settings:get') {
        if (payload.key === externalClaimKey || payload.key === cleanRuleClaimKey) {
          const state = preloads.get(payload.key) || { count: 0, waiters: [] };
          preloads.set(payload.key, state);
          state.count++;
          // Hold only the two migration preloads and release them with the
          // same empty snapshot. Later reads are the authoritative reads made
          // inside the shared claim-key queue and must observe prior writes.
          if (state.count <= 2) {
            const snapshot = structuredClone(settings.get(payload.key));
            const pending = new Promise(resolve => state.waiters.push(() => resolve(snapshot)));
            if (state.count === 2) state.waiters.splice(0).forEach(resolve => resolve());
            return pending;
          }
        }
        return structuredClone(settings.get(payload.key));
      }
      if (channel === 'settings:set') {
        settings.set(payload.key, structuredClone(payload.value));
        return true;
      }
      if (channel === 'settings:compareAndSet') {
        const entries = Array.isArray(payload.entries)
          ? payload.entries
          : [{ key: payload.key, expected: payload.expected, value: payload.value }];
        const current = entries.map(entry => settings.get(entry.key));
        const conflict = entries.findIndex((entry, index) => !jsonEqual(current[index], entry.expected));
        if (conflict >= 0) return { ok: false, key: entries[conflict].key, current: structuredClone(current[conflict]) };
        for (const entry of entries) settings.set(entry.key, structuredClone(entry.value));
        return { ok: true };
      }
      if (channel === 'workspace:get') throw new Error('explicit workspace should not query the live workspace');
      throw new Error(`unexpected channel ${channel}`);
    };
    // Separate coordinators model two renderer module realms. Only main-process
    // CAS may arbitrate their shared claim ledgers.
    const alpha = createLibraryRepository({
      invoke, workspace: 'D:/Concurrent-A', coordinator: createLibraryRepositoryCoordinator(),
    });
    const beta = createLibraryRepository({
      invoke, workspace: 'D:/Concurrent-B', coordinator: createLibraryRepositoryCoordinator(),
    });

    await Promise.all([alpha.listBooks(), beta.listBooks()]);

    const alphaExternal = await alpha.getValue('external');
    const betaExternal = await beta.getValue('external');
    assert.equal(alphaExternal.length + betaExternal.length, 1,
      '同一 legacy external 在并发迁移中也只能进入一个 workspace');
    const externalOwner = alphaExternal.length ? alpha.identity.hash : beta.identity.hash;
    assert.deepEqual(Object.values(settings.get(externalClaimKey)?.claims || {}), [externalOwner],
      'external ledger 必须保留唯一实际 owner，不能被迟到旧快照覆盖');

    const alphaRules = await alpha.getValue('cleanRules');
    const betaRules = await beta.getValue('cleanRules');
    assert.equal(alphaRules.length + betaRules.length, 1,
      '同一 legacy 全局规则在并发迁移中也只能进入一个 workspace');
    const cleanRuleOwner = alphaRules.length ? alpha.identity.hash : beta.identity.hash;
    assert.deepEqual(Object.values(settings.get(cleanRuleClaimKey)?.claims || {}), [cleanRuleOwner],
      'clean-rule ledger 必须合并锁内最新值，不能丢失既有 claim');
  });

  test('混合 legacy 工作区只迁各自本地路径，未显式 external 的异区书不混入', async () => {
    const fx = fixture({
      'library.books': [
        { id: 'alpha', path: 'D:/Alpha/书库/a.epub' },
        { id: 'beta', path: 'D:/Beta/书库/b.epub' },
        { id: 'shared', path: 'E:/Shared/c.epub', repositoryScope: 'external' },
      ],
    });
    const alpha = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Alpha' });
    const beta = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Beta' });

    assert.deepEqual((await alpha.listBooks()).map(book => book.id), ['alpha', 'shared']);
    assert.deepEqual((await beta.listBooks()).map(book => book.id), ['beta']);
    assert.deepEqual(fx.settings.get('library.books').map(book => book.id), ['alpha', 'beta', 'shared'], 'v1 source remains untouched');
  });

  test('多个 Library tab 并发 mutate 同 key 完整串行，不发生 lost update', async () => {
    const fx = fixture();
    const a = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Concurrent' });
    const b = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Concurrent' });
    await Promise.all([a.get('progress'), b.get('progress')]);

    const one = a.mutate('progress', async draft => {
      await wait(12);
      draft['book-a'] = { chapter: 1 };
    });
    const two = b.mutate('progress', draft => {
      draft['book-b'] = { chapter: 9 };
    });
    const [r1, r2] = await Promise.all([one, two]);
    const final = await a.get('progress');

    assert.equal(r1.revision + 1, r2.revision);
    assert.equal(final.revision, r2.revision);
    assert.equal(final.value['book-a'].chapter, 1);
    assert.equal(final.value['book-b'].chapter, 9);
  });

  test('净化规则按 workspace 分区且多页签串行，不跨区或丢更新', async () => {
    const fx = fixture();
    const a = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Rules-A' });
    const a2 = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Rules-A' });
    const b = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Rules-B' });
    await Promise.all([a.get('cleanRules'), a2.get('cleanRules'), b.get('cleanRules')]);

    await Promise.all([
      a.mutate('cleanRules', async draft => {
        await wait(12);
        draft.push({ id: 'one', pattern: 'A', scope: 'all' });
      }),
      a2.mutate('cleanRules', draft => { draft.push({ id: 'two', pattern: 'B', scope: 'all' }); }),
      b.mutate('cleanRules', draft => { draft.push({ id: 'other', pattern: 'C', scope: 'all' }); }),
    ]);

    assert.deepEqual((await a.getValue('cleanRules')).map(rule => rule.id), ['one', 'two']);
    assert.deepEqual((await b.getValue('cleanRules')).map(rule => rule.id), ['other']);
    assert.notEqual(a.key('cleanRules'), b.key('cleanRules'));
  });

  test('迁移源任一 settings read 失败即零写入中止，绝不把故障解释为空库', async () => {
    const fx = fixture({
      'library.books': [{ id: 'kept', path: 'D:/ReadFailure/kept.epub' }],
    });
    const writes = [];
    const normalInvoke = fx.invoke;
    const failingInvoke = async (channel, payload) => {
      if (channel === 'workspace:get') return 'D:/ReadFailure';
      if (channel === 'settings:get') throw Object.assign(new Error('transient read failure'), { code: 'EIO' });
      if (channel === 'settings:set') { writes.push(payload.key); return true; }
      return normalInvoke(channel, payload);
    };
    const repo = createLibraryRepository({ invoke: failingInvoke, workspace: 'D:/ReadFailure' });
    await assert.rejects(() => repo.listBooks(), /transient read failure/);
    assert.deepEqual(writes, [], 'failed migration reads must not write empty partitions, claims or meta');

    repo.invoke = normalInvoke;
    const recovered = await repo.listBooks();
    assert.deepEqual(recovered.map(book => book.id), ['kept'], 'retry after transport recovery must retain legacy data');
  });

  test('legacy 两个不同源共用 book id 时迁移 fail-closed，零 claim/分区写入', async () => {
    const fx = fixture({
      'library.books': [
        { id: 'colliding-id', path: 'D:/DuplicateMigration/a.epub' },
        { id: 'colliding-id', path: 'D:/DuplicateMigration/b.epub' },
      ],
    });
    const repo = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/DuplicateMigration' });
    let failure;
    try { await repo.listBooks(); } catch (error) { failure = error; }

    assert.equal(failure?.code, 'LIBRARY_DUPLICATE_BOOK_ID');
    assert.deepEqual(failure?.duplicateIds, ['colliding-id']);
    assert.equal([...fx.settings.keys()].some(key => key.startsWith('library.repository.v2.')), false,
      '身份冲突不可写 claim、workspace partition 或 meta；必须由显式全关联迁移修复');
    assert.equal(fx.settings.get('library.books').length, 2, 'v1 证据保持原样');
  });

  test('两个 workspace 内相同 book id 仍物理隔离，revision receipt 可做冲突门', async () => {
    const fx = fixture();
    const a = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/A' });
    const b = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/B' });
    const [a0, b0] = await Promise.all([a.get('progress'), b.get('progress')]);
    await Promise.all([
      a.mutate('progress', draft => { draft.shared = { chapter: 2 }; }),
      b.mutate('progress', draft => { draft.shared = { chapter: 8 }; }),
    ]);

    assert.equal((await a.getValue('progress')).shared.chapter, 2);
    assert.equal((await b.getValue('progress')).shared.chapter, 8);
    assert.notEqual(a.key('progress'), b.key('progress'));
    const conflict = await a.set('progress', { shared: { chapter: 10 } }, { expectedRevision: a0.revision });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.conflict, true);
    assert.ok(conflict.revision > a0.revision);
    assert.equal(b0.schema, LIBRARY_REPOSITORY_SCHEMA);
  });

  test('逻辑书架事务同时收敛 workspace 与 external，跨页签不复活已删记录', async () => {
    const fx = fixture();
    const a = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Work/A' });
    const b = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Work/A' });
    await Promise.all([a.init(), b.init()]);
    await Promise.all([
      a.mutateBooks(books => [...books, { id: 'local', path: 'D:/Work/A/书库/a.epub', sourceHash: 'aa' }]),
      b.mutateBooks(books => [...books, { id: 'external', path: 'E:/Books/b.cbz', sourceHash: 'bb' }]),
    ]);
    assert.deepEqual((await a.listBooks()).map(x => x.id).sort(), ['external', 'local']);
    await Promise.all([
      a.mutateBooks(books => books.filter(x => x.id !== 'local')),
      b.mutateBooks(books => books.map(x => x.id === 'external' ? { ...x, title: 'B2' } : x)),
    ]);
    const final = await a.listBooks();
    assert.deepEqual(final.map(x => x.id), ['external']);
    assert.equal(final[0].title, 'B2');
    assert.equal(final[0].repositoryScope, 'external');
  });

  test('mutateBooks 与公开 shelf mutate 共用同一事务队列，不覆盖并发更新', async () => {
    const fx = fixture();
    const a = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/MixedQueue' });
    const b = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/MixedQueue' });
    await a.mutateBooks(() => [{ id: 'seed', path: 'D:/MixedQueue/seed.epub' }]);
    let release;
    let entered;
    const gate = new Promise(resolve => { release = resolve; });
    const inside = new Promise(resolve => { entered = resolve; });
    const composite = a.mutateBooks(async books => {
      entered();
      await gate;
      return [...books, { id: 'composite', path: 'D:/MixedQueue/composite.epub' }];
    });
    await inside;
    const single = b.mutate('shelf', books => [...books, { id: 'single', path: 'D:/MixedQueue/single.epub' }]);
    release();
    await Promise.all([composite, single]);
    assert.deepEqual((await a.listBooks()).map(book => book.id), ['seed', 'composite', 'single']);
  });

  test('隔离 renderer 协调器并发 mutate 同分区，主进程 CAS 冲突重试不丢更新', async () => {
    const fx = casFixture();
    const a = createLibraryRepository({
      invoke: fx.invoke, workspace: 'D:/CrossRenderer', coordinator: createLibraryRepositoryCoordinator(),
    });
    const b = createLibraryRepository({
      invoke: fx.invoke, workspace: 'D:/CrossRenderer', coordinator: createLibraryRepositoryCoordinator(),
    });
    await a.get('progress');
    await b.get('progress');

    let arrivals = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const meetOnFirstAttempt = async (attempt) => {
      if (attempt !== 0) return;
      arrivals++;
      if (arrivals === 2) release();
      await gate;
    };
    const [left, right] = await Promise.all([
      a.mutate('progress', async (draft, context) => {
        await meetOnFirstAttempt(context.attempt);
        draft.left = { page: 1 };
      }),
      b.mutate('progress', async (draft, context) => {
        await meetOnFirstAttempt(context.attempt);
        draft.right = { page: 2 };
      }),
    ]);

    assert.deepEqual(await a.getValue('progress'), { left: { page: 1 }, right: { page: 2 } });
    assert.ok(left.attempts > 1 || right.attempts > 1,
      '同一 revision 的两个 renderer 必须有一方经历 CAS 冲突后重放 updater');
  });

  test('隔离 renderer 并发 mutateBooks add/delete，两分区+journal 主进程原子且不复活', async () => {
    const fx = casFixture();
    const a = createLibraryRepository({
      invoke: fx.invoke, workspace: 'D:/CrossBooks', coordinator: createLibraryRepositoryCoordinator(),
    });
    const b = createLibraryRepository({
      invoke: fx.invoke, workspace: 'D:/CrossBooks', coordinator: createLibraryRepositoryCoordinator(),
    });
    await a.mutateBooks(() => [
      { id: 'remove-me', path: 'D:/CrossBooks/remove.epub' },
      { id: 'keep-external', path: 'E:/Books/keep.cbz', repositoryScope: 'external' },
    ]);
    await b.listBooks();

    let arrivals = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const meetOnFirstAttempt = async (attempt) => {
      if (attempt !== 0) return;
      arrivals++;
      if (arrivals === 2) release();
      await gate;
    };
    const [added, deleted] = await Promise.all([
      a.mutateBooks(async (books, context) => {
        await meetOnFirstAttempt(context.attempt);
        return [...books, { id: 'added-concurrently', path: 'D:/CrossBooks/added.epub' }];
      }),
      b.mutateBooks(async (books, context) => {
        await meetOnFirstAttempt(context.attempt);
        return books.filter(book => book.id !== 'remove-me');
      }),
    ]);

    const final = await a.listBooks();
    assert.deepEqual(final.map(book => book.id).sort(), ['added-concurrently', 'keep-external']);
    assert.equal(fx.settings.get(a.booksJournalKey()), null, '并发事务收敛后 journal 必须清空');
    assert.equal(added.atomic, true);
    assert.equal(deleted.atomic, true);
    assert.ok(added.attempts > 1 || deleted.attempts > 1,
      '两个 renderer 从同一代书架起跑时必须有一方 CAS 重试');
    const atomicCommit = fx.calls.find(call => call.channel === 'settings:compareAndSet'
      && Array.isArray(call.payload.entries)
      && call.payload.entries.map(entry => entry.key).includes(a.booksJournalKey())
      && call.payload.entries.map(entry => entry.key).includes(a.key('shelf'))
      && call.payload.entries.map(entry => entry.key).includes(a.key('external')));
    assert.ok(atomicCommit, '真正提交必须是 shelf/external/journal 三 key 同一 CAS，不是 renderer 连续三写');
  });

  test('mutateBooks 拒绝两个不同书共用 id，CAS/journal/两分区保持零写', async () => {
    const fx = casFixture();
    const repo = createLibraryRepository({
      invoke: fx.invoke, workspace: 'D:/DuplicateMutation', coordinator: createLibraryRepositoryCoordinator(),
    });
    await repo.listBooks();
    const shelfKey = repo.key('shelf');
    const externalKey = repo.key('external');
    const journalKey = repo.booksJournalKey();
    const before = {
      shelf: structuredClone(fx.settings.get(shelfKey)),
      external: structuredClone(fx.settings.get(externalKey)),
      journal: structuredClone(fx.settings.get(journalKey)),
    };
    const writesBefore = fx.calls.filter(call =>
      call.channel === 'settings:set' || call.channel === 'settings:compareAndSet').length;

    let failure;
    try {
      await repo.mutateBooks(() => [
        { id: 'same-id', path: 'D:/DuplicateMutation/one.epub' },
        { id: 'same-id', path: 'E:/Elsewhere/two.cbz', repositoryScope: 'external' },
      ]);
    } catch (error) { failure = error; }

    assert.equal(failure?.code, 'LIBRARY_DUPLICATE_BOOK_ID');
    assert.deepEqual(failure?.duplicateIds, ['same-id']);
    assert.deepEqual(fx.settings.get(shelfKey), before.shelf);
    assert.deepEqual(fx.settings.get(externalKey), before.external);
    assert.deepEqual(fx.settings.get(journalKey), before.journal);
    assert.equal(fx.calls.filter(call =>
      call.channel === 'settings:set' || call.channel === 'settings:compareAndSet').length, writesBefore,
    '冲突必须在 prepared journal 之前拒绝，不能留下任何 CAS 写');
  });

  test('第二分区写失败会回滚；回滚也失败时 journal 在下一次读取恢复', async () => {
    const fx = fixture();
    const repo = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/Journal' });
    await repo.mutateBooks(() => [{ id: 'local', path: 'D:/Journal/local.epub' }]);

    const normalInvoke = repo.invoke;
    let oneFailure = true;
    repo.invoke = async (channel, payload) => {
      if (channel === 'settings:set' && payload.key === repo.key('external') && oneFailure) {
        oneFailure = false;
        throw new Error('injected one-shot external failure');
      }
      return normalInvoke(channel, payload);
    };
    let rolledBackFailure;
    try {
      await repo.mutateBooks(books => books.map(book => ({ ...book, path: 'E:/first-move.epub', repositoryScope: 'external' })));
    } catch (error) {
      rolledBackFailure = error;
    }
    assert.equal(rolledBackFailure?.receipt?.rolledBack, true);
    assert.equal(rolledBackFailure?.receipt?.recoverable, false);
    repo.invoke = normalInvoke;
    assert.deepEqual((await repo.listBooks()).map(book => [book.id, book.path]), [['local', 'D:/Journal/local.epub']]);

    let externalFailures = 0;
    repo.invoke = async (channel, payload) => {
      if (channel === 'settings:set' && payload.key === repo.key('external') && externalFailures++ < 2) {
        throw new Error('injected external write failure');
      }
      return normalInvoke(channel, payload);
    };
    let failure;
    try {
      await repo.mutateBooks(books => books.map(book => ({ ...book, path: 'E:/moved.epub', repositoryScope: 'external' })));
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.code, 'LIBRARY_BOOKS_COMMIT_FAILED');
    assert.equal(failure?.receipt?.atomic, false);
    assert.equal(failure?.receipt?.recoverable, true);
    assert.equal(failure?.receipt?.rolledBack, false);

    repo.invoke = normalInvoke;
    assert.deepEqual((await repo.listBooks()).map(book => [book.id, book.path]), [['local', 'D:/Journal/local.epub']]);
    assert.equal(fx.settings.get(repo.booksJournalKey()), null, 'successful recovery clears the journal tombstone');
  });

  test('journal get 失败必须零写 fail-closed；重试先恢复半写事务再 mutate', async () => {
    const fx = fixture();
    const repo = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/JournalReadFailure', now: () => 700 });
    await repo.mutateBooks(() => [
      { id: 'local-before', path: 'D:/JournalReadFailure/local.epub' },
      { id: 'external-before', path: 'E:/Books/external.cbz', repositoryScope: 'external' },
    ]);

    const shelfKey = repo.key('shelf');
    const externalKey = repo.key('external');
    const journalKey = repo.booksJournalKey();
    const beforeShelf = structuredClone(fx.settings.get(shelfKey));
    const beforeExternal = structuredClone(fx.settings.get(externalKey));
    const afterShelf = {
      ...structuredClone(beforeShelf),
      revision: beforeShelf.revision + 1,
      value: [{ id: 'half-written-local', path: 'D:/JournalReadFailure/half.epub' }],
    };
    const afterExternal = {
      ...structuredClone(beforeExternal),
      revision: beforeExternal.revision + 1,
      value: [{ id: 'intended-external', path: 'E:/Books/intended.cbz', repositoryScope: 'external' }],
    };
    fx.settings.set(shelfKey, structuredClone(afterShelf));
    fx.settings.set(externalKey, structuredClone(beforeExternal));
    fx.settings.set(journalKey, {
      schema: LIBRARY_REPOSITORY_SCHEMA,
      kind: 'library-books-journal',
      state: 'prepared',
      transactionId: 'prepared-half-write',
      workspace: { ...repo.identity },
      updatedAt: 700,
      before: { shelf: beforeShelf, external: beforeExternal },
      after: { shelf: afterShelf, external: afterExternal },
    });

    const normalInvoke = repo.invoke;
    let rejectJournalRead = true;
    let writes = 0;
    repo.invoke = async (channel, payload) => {
      if (channel === 'settings:get' && payload.key === journalKey && rejectJournalRead) {
        rejectJournalRead = false;
        throw new Error('injected journal read failure');
      }
      if (channel === 'settings:set') writes++;
      return normalInvoke(channel, payload);
    };

    let updaterCalls = 0;
    await assert.rejects(
      () => repo.mutateBooks(books => {
        updaterCalls++;
        return [...books, { id: 'must-not-write', path: 'D:/JournalReadFailure/forbidden.epub' }];
      }),
      /injected journal read failure/,
    );
    assert.equal(writes, 0, 'journal 读取失败后不得写分区或新 journal');
    assert.equal(updaterCalls, 0, 'journal 状态不可知时不得进入 updater');
    assert.deepEqual(fx.settings.get(shelfKey), afterShelf, '失败尝试不得擅自修改半写现场');
    assert.deepEqual(fx.settings.get(externalKey), beforeExternal);

    let booksSeenByRetry;
    const retry = await repo.mutateBooks(books => {
      booksSeenByRetry = books.map(book => book.id).sort();
      return [...books, { id: 'after-recovery', path: 'D:/JournalReadFailure/recovered.epub' }];
    });
    assert.equal(retry.recoveredBeforeCommit, true);
    assert.deepEqual(booksSeenByRetry, ['external-before', 'local-before'],
      '重试 updater 只能看到 prepared journal 回滚后的同一代数据');
    const final = await repo.listBooks();
    assert.deepEqual(final.map(book => book.id).sort(), ['after-recovery', 'external-before', 'local-before']);
    assert.equal(final.some(book => book.id === 'half-written-local' || book.id === 'intended-external'), false,
      '不得混入半写 after 分区');
    assert.equal(fx.settings.get(journalKey), null, '恢复并完成新事务后必须清除 journal');
  });

  test('future/malformed scoped envelope fail closed；只有真实 null 才允许初始化', async () => {
    const fx = casFixture();
    const repo = createLibraryRepository({ invoke: fx.invoke, workspace: 'D:/FutureSchema', now: () => 800 });
    await repo.mutateBooks(() => [{ id: 'keep', path: 'D:/FutureSchema/keep.epub' }]);

    const shelfKey = repo.key('shelf');
    const future = {
      schema: LIBRARY_REPOSITORY_SCHEMA + 1,
      revision: 99,
      partition: 'shelf',
      workspace: { ...repo.identity },
      value: [{ id: 'future-book', path: 'D:/FutureSchema/future.epub' }],
    };
    fx.settings.set(shelfKey, structuredClone(future));
    const callsBeforeFutureRead = fx.calls.length;
    await assert.rejects(() => repo.getValue('shelf'), error => (
      error?.code === 'LIBRARY_PARTITION_INVALID'
      && error.partition === 'shelf'
      && error.observedSchema === LIBRARY_REPOSITORY_SCHEMA + 1
    ));
    assert.deepEqual(fx.settings.get(shelfKey), future, '未来 schema 原文必须原封不动保留');
    assert.equal(fx.calls.slice(callsBeforeFutureRead)
      .some(call => call.channel === 'settings:set' || call.channel === 'settings:compareAndSet'), false,
    '读取未来 schema 时不得做任何修复写');

    const progressKey = repo.key('progress');
    const malformed = { schema: LIBRARY_REPOSITORY_SCHEMA, partition: 'wrong', value: { keep: true } };
    fx.settings.set(progressKey, structuredClone(malformed));
    await assert.rejects(() => repo.getValue('progress'), error => error?.code === 'LIBRARY_PARTITION_INVALID');
    assert.deepEqual(fx.settings.get(progressKey), malformed, '非 null 损坏值不得被默认空对象覆盖');

    fx.settings.set(progressKey, null);
    assert.deepEqual(await repo.getValue('progress'), {}, '明确 null 才表示可初始化的缺失分区');
    assert.equal(fx.settings.get(progressKey).schema, LIBRARY_REPOSITORY_SCHEMA);
  });

  test('重复 helper 同时识别路径别名与内容 fingerprint', () => {
    const a = { id: 'a', path: 'D:\\Books\\A.epub', sourceHash: 'content-a' };
    const pathAlias = { id: 'b', path: 'd:/books/./a.epub' };
    const contentAlias = { id: 'c', path: 'D:/Elsewhere/c.epub', contentFingerprint: 'CONTENT-A' };
    const unique = { id: 'd', path: 'D:/Books/d.epub', sourceHash: 'content-d' };
    assert.equal(sameBook(a, pathAlias), true);
    assert.equal(sameBook(a, contentAlias), true);
    assert.equal(sameBook(a, unique), false);
    assert.deepEqual(dedupeBooks([a, pathAlias, contentAlias, unique]).map(book => book.id), ['a', 'd']);
  });
});
