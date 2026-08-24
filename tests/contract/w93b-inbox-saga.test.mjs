import { readFileSync } from 'node:fs';
import { describe, test, assert } from '../harness.mjs';
import {
  ACQUISITION_INBOX_CHANNELS,
  consumeAcquisitionInboxReceipt,
  drainAcquisitionInbox,
  stableAcquisitionBookId,
} from '../../renderer/modules/library/acquisition-inbox.js';
import {
  createLibraryRepository,
  createLibraryRepositoryCoordinator,
} from '../../renderer/modules/library/repository.js';

const WORKSPACE = 'D:/Workspace/A';
const WORKSPACE_ID = `workspace-${'1'.repeat(64)}`;
const WORKSPACE_TOKEN = 'opaque-token-A';
const CREATED_AT = '2026-08-24T08:00:00.000Z';

function clone(value) {
  return structuredClone(value);
}

function receipt(index = 1, overrides = {}) {
  const hash = index.toString(16).padStart(64, '0');
  const base = {
    schema: 'mazz.library-acquisition-inbox/v1',
    revision: 1,
    receiptId: `receipt-${index}`,
    jobId: `job-${index}`,
    workspaceIdentity: WORKSPACE_ID,
    kind: 'library-asset-ready',
    state: 'pending',
    artifact: {
      path: `${WORKSPACE}/书库/Book ${index}.epub`,
      sha256: hash,
      size: index,
      format: 'epub',
    },
    createdAt: CREATED_AT,
    acknowledgedAt: null,
  };
  return {
    ...base,
    ...overrides,
    artifact: { ...base.artifact, ...(overrides.artifact || {}) },
  };
}

function simpleRepository(workspace = WORKSPACE, initial = []) {
  let books = clone(initial);
  const calls = [];
  const repository = {
    identity: { canonical: workspace, hash: 'renderer-short-hash' },
    async mutateBooks(updater) {
      calls.push('mutateBooks');
      const proposed = await updater(clone(books), {
        workspace,
        workspaceId: 'renderer-short-hash',
        attempt: 0,
      });
      books = clone(proposed);
      return { ok: true, value: clone(books), workspace, workspaceId: 'renderer-short-hash' };
    },
  };
  return { repository, calls, books: () => clone(books) };
}

function makeBinding(repository, overrides = {}) {
  return {
    repository,
    ready: Promise.resolve(repository),
    pending: new Set(),
    retiring: false,
    ...overrides,
  };
}

function currentBinding({ binding }) {
  return binding.retiring !== true && binding.stale !== true;
}

function inboxBridge(inputReceipts, options = {}) {
  const records = new Map(inputReceipts.map(item => [item.receiptId, clone(item)]));
  const jobs = new Map(inputReceipts.map(item => [item.jobId, {
    jobId: item.jobId,
    workspaceIdentity: item.workspaceIdentity,
    state: 'awaiting-import',
    bookId: '',
  }]));
  const calls = [];
  let commitAttempts = 0;
  return {
    records,
    jobs,
    calls,
    async listInbox(request) {
      calls.push({ method: 'list', request: clone(request) });
      if (typeof options.listBarrier === 'function') await options.listBarrier();
      return {
        workspacePath: options.workspacePath || WORKSPACE,
        workspaceIdentity: options.workspaceIdentity || WORKSPACE_ID,
        workspaceToken: options.workspaceToken || WORKSPACE_TOKEN,
        receipts: [...records.values()].filter(item => item.state === 'pending').map(clone),
      };
    },
    async commitShelfReceipt(receiptId, commit, capability) {
      commitAttempts += 1;
      calls.push({
        method: 'complete', receiptId, commit: clone(commit), capability: clone(capability),
      });
      if (capability.workspaceToken !== (options.workspaceToken || WORKSPACE_TOKEN)) {
        throw new Error('wrong workspace token');
      }
      if (options.failBeforeCommitAt === commitAttempts) throw new Error('commit transport failed before durable write');
      const current = records.get(receiptId);
      if (!current) throw new Error('missing receipt');
      const job = jobs.get(current.jobId);
      const idempotent = current.state === 'acknowledged';
      if (!idempotent) {
        assert.equal(commit.workspaceIdentity, current.workspaceIdentity);
        assert.equal(commit.contentHash, current.artifact.sha256);
        assert.equal(commit.path, current.artifact.path);
        job.bookId = commit.bookId;
        job.state = 'imported';
        records.set(receiptId, {
          ...current,
          revision: current.revision + 1,
          state: 'acknowledged',
          acknowledgedAt: '2026-08-24T08:01:00.000Z',
        });
      } else if (job.bookId !== commit.bookId) {
        throw new Error('idempotent bookId conflict');
      }
      if (options.loseResponseAt === commitAttempts) throw new Error('reply lost after durable write');
      return { receipt: clone(records.get(receiptId)), job: clone(job), idempotent };
    },
  };
}

function sagaOptions(repository, binding, bridge, extras = {}) {
  return {
    repository,
    binding,
    bridge,
    bindingVerifier: currentBinding,
    ...extras,
  };
}

function jsonEqual(left, right) {
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return false; }
}

function casFixture() {
  const settings = new Map();
  const invoke = async (channel, payload = {}) => {
    if (channel === 'settings:get') return clone(settings.get(payload.key));
    if (channel === 'settings:set') {
      settings.set(payload.key, clone(payload.value));
      return true;
    }
    if (channel === 'settings:compareAndSet') {
      const entries = Array.isArray(payload.entries)
        ? payload.entries
        : [{ key: payload.key, expected: payload.expected, value: payload.value }];
      const conflict = entries.find(entry => !jsonEqual(settings.get(entry.key), entry.expected));
      if (conflict) return { ok: false, key: conflict.key, current: clone(settings.get(conflict.key)) };
      for (const entry of entries) settings.set(entry.key, clone(entry.value));
      return { ok: true };
    }
    throw new Error(`unexpected channel ${channel}`);
  };
  return { settings, invoke };
}

describe('W93B Renderer Inbox -> shelf saga', () => {
  test('new bookId contains the complete Blob SHA-256 and no truncated identity', () => {
    const hash = 'a'.repeat(64);
    assert.equal(stableAcquisitionBookId(hash), `blob-sha256-${hash}`);
    assert.equal(stableAcquisitionBookId(hash).endsWith(hash), true);
    assert.throws(() => stableAcquisitionBookId(hash.slice(0, 32)), /完整/);
    assert.throws(() => stableAcquisitionBookId(hash.toUpperCase()), /小写/);
  });

  test('drain captures main Workspace identity/token, shelves metadata, then completes main facts', async () => {
    const item = receipt(10);
    const shelf = simpleRepository();
    const binding = makeBinding(shelf.repository);
    const bridge = inboxBridge([item]);
    const seen = [];
    const result = await drainAcquisitionInbox(sagaOptions(shelf.repository, binding, bridge, {
      event: { artifact: { path: 'E:/untrusted-event/redirect.epub' } },
      bindingVerifier(context) {
        seen.push({ phase: context.phase, token: context.workspaceToken });
        return currentBinding(context);
      },
    }));

    assert.equal(result.ok, true);
    assert.equal(result.listed, 1);
    assert.equal(result.completed[0].bookId, `blob-sha256-${item.artifact.sha256}`);
    assert.equal(result.workspaceIdentity, WORKSPACE_ID);
    assert.equal(shelf.books().length, 1);
    assert.deepEqual(shelf.books()[0], {
      id: `blob-sha256-${item.artifact.sha256}`,
      title: 'Book 10',
      author: '',
      cover: '',
      path: item.artifact.path,
      sourcePath: item.artifact.path,
      sourceHash: item.artifact.sha256,
      contentHash: item.artifact.sha256,
      format: 'epub',
      size: 10,
      category: '未分类',
      addedAt: Date.parse(CREATED_AT),
    });
    assert.deepEqual(bridge.calls[0], {
      method: 'list', request: { workspacePath: WORKSPACE, state: 'pending' },
    });
    const complete = bridge.calls.find(call => call.method === 'complete');
    assert.equal(complete.capability.workspaceToken, WORKSPACE_TOKEN);
    assert.equal(complete.commit.path, item.artifact.path);
    assert.equal(complete.commit.contentHash, item.artifact.sha256);
    assert.equal('artifact' in complete.commit, false);
    assert.equal(seen.some(entry => entry.phase === 'before-shelf:receipt-10'
      && entry.token === WORKSPACE_TOKEN), true);
  });

  test('invoke bridge uses the narrow list/complete channels and small metadata payloads', async () => {
    const item = receipt(11);
    const durable = inboxBridge([item]);
    const calls = [];
    const bridge = {
      async invoke(channel, payload) {
        calls.push({ channel, payload: clone(payload) });
        if (channel === ACQUISITION_INBOX_CHANNELS.list) return durable.listInbox(payload);
        if (channel === ACQUISITION_INBOX_CHANNELS.complete) {
          const { receiptId, workspaceToken, ...commit } = payload;
          return durable.commitShelfReceipt(receiptId, commit, { workspaceToken });
        }
        throw new Error(`unexpected channel ${channel}`);
      },
    };
    const shelf = simpleRepository();
    await drainAcquisitionInbox(sagaOptions(
      shelf.repository, makeBinding(shelf.repository), bridge,
    ));
    assert.deepEqual(calls.map(call => call.channel), [
      'library:acquisitionInboxList', 'library:acquisitionInboxCommit',
    ]);
    assert.deepEqual(Object.keys(calls[1].payload).sort(), [
      'bookId', 'contentHash', 'path', 'receiptId', 'workspaceIdentity', 'workspaceToken',
    ]);
  });

  test('wrong A/B receipt and stale binding fail before cross-workspace mutation or completion', async () => {
    const shelfB = simpleRepository('D:/Workspace/B');
    const bindingB = makeBinding(shelfB.repository);
    const bridgeA = inboxBridge([receipt(12)], { workspacePath: 'D:/Workspace/A' });
    await assert.rejects(
      drainAcquisitionInbox(sagaOptions(shelfB.repository, bindingB, bridgeA)),
      error => error.code === 'LIBRARY_INBOX_WORKSPACE_MISMATCH',
    );
    assert.equal(shelfB.calls.length, 0);
    assert.equal(bridgeA.calls.some(call => call.method === 'complete'), false);

    const shelfA = simpleRepository();
    const stale = makeBinding(shelfA.repository, { retiring: true });
    const untouched = inboxBridge([receipt(13)]);
    await assert.rejects(
      drainAcquisitionInbox(sagaOptions(shelfA.repository, stale, untouched)),
      error => error.code === 'LIBRARY_INBOX_STALE_BINDING' && error.stale === true,
    );
    assert.equal(untouched.calls.length, 0);
    assert.equal(shelfA.calls.length, 0);
  });

  test('binding that turns stale after shelf CAS never acknowledges the Inbox', async () => {
    const item = receipt(14);
    const shelf = simpleRepository();
    const binding = makeBinding(shelf.repository);
    const originalMutate = shelf.repository.mutateBooks;
    shelf.repository.mutateBooks = async updater => {
      const committed = await originalMutate(updater);
      binding.stale = true;
      return committed;
    };
    const bridge = inboxBridge([item]);
    await assert.rejects(
      drainAcquisitionInbox(sagaOptions(shelf.repository, binding, bridge)),
      error => error.code === 'LIBRARY_INBOX_STALE_BINDING',
    );
    assert.equal(shelf.books().length, 1, 'shelf CAS is durable and replayable');
    assert.equal(bridge.records.get(item.receiptId).state, 'pending');
    assert.equal(bridge.calls.some(call => call.method === 'complete'), false);
  });

  test('repository failure leaves receipt pending and does not call main completion', async () => {
    const item = receipt(15);
    const repository = {
      identity: { canonical: WORKSPACE, hash: 'renderer-short-hash' },
      async mutateBooks() { throw Object.assign(new Error('settings offline'), { code: 'SETTINGS_OFFLINE' }); },
    };
    const bridge = inboxBridge([item]);
    const result = await drainAcquisitionInbox(sagaOptions(
      repository, makeBinding(repository), bridge,
    ));
    assert.equal(result.ok, false);
    assert.equal(result.failed[0].receiptId, item.receiptId);
    assert.equal(result.failed[0].code, 'SETTINGS_OFFLINE');
    assert.equal(bridge.records.get(item.receiptId).state, 'pending');
    assert.equal(bridge.calls.some(call => call.method === 'complete'), false);
  });

  test('lost completion reply is fail-closed; pending replay reuses the same book', async () => {
    const item = receipt(16);
    const shelf = simpleRepository();
    const binding = makeBinding(shelf.repository);
    const bridge = inboxBridge([item], { failBeforeCommitAt: 1 });

    const first = await drainAcquisitionInbox(sagaOptions(shelf.repository, binding, bridge));
    assert.equal(first.ok, false);
    assert.equal(shelf.books().length, 1);
    assert.equal(bridge.records.get(item.receiptId).state, 'pending');

    const second = await drainAcquisitionInbox(sagaOptions(shelf.repository, binding, bridge));
    assert.equal(second.ok, true);
    assert.equal(second.completed[0].duplicate, true);
    assert.equal(second.completed[0].bookId, shelf.books()[0].id);
    assert.equal(shelf.books().length, 1);
    assert.equal(bridge.records.get(item.receiptId).state, 'acknowledged');
  });

  test('acknowledged durable fact with a lost reply is not replayed from an event payload', async () => {
    const item = receipt(17);
    const shelf = simpleRepository();
    const binding = makeBinding(shelf.repository);
    const bridge = inboxBridge([item], { loseResponseAt: 1 });
    const first = await drainAcquisitionInbox(sagaOptions(shelf.repository, binding, bridge));
    assert.equal(first.ok, false, 'renderer cannot claim an unseen completion response');
    assert.equal(bridge.records.get(item.receiptId).state, 'acknowledged');

    const replay = await consumeAcquisitionInboxReceipt(sagaOptions(shelf.repository, binding, bridge, {
      receiptId: item.receiptId,
      artifact: { path: 'E:/event-forgery.epub' },
    }));
    assert.deepEqual(replay, {
      ok: false,
      status: 'not-pending',
      receiptId: item.receiptId,
      workspaceIdentity: WORKSPACE_ID,
    });
    assert.equal(shelf.books().length, 1);
    assert.equal(bridge.calls.filter(call => call.method === 'complete').length, 1);
  });

  test('two renderer repositories converge through main-process CAS on one full-hash bookId', async () => {
    const item = receipt(18);
    let listCount = 0;
    let releaseLists;
    const bothListed = new Promise(resolve => { releaseLists = resolve; });
    const bridge = inboxBridge([item], {
      async listBarrier() {
        listCount += 1;
        if (listCount === 2) releaseLists();
        await bothListed;
      },
    });
    const settings = casFixture();
    const left = createLibraryRepository({
      invoke: settings.invoke,
      workspace: WORKSPACE,
      coordinator: createLibraryRepositoryCoordinator(),
      now: () => 1,
    });
    const right = createLibraryRepository({
      invoke: settings.invoke,
      workspace: WORKSPACE,
      coordinator: createLibraryRepositoryCoordinator(),
      now: () => 2,
    });
    await Promise.all([left.init(), right.init()]);
    const [a, b] = await Promise.all([
      drainAcquisitionInbox(sagaOptions(left, makeBinding(left), bridge)),
      drainAcquisitionInbox(sagaOptions(right, makeBinding(right), bridge)),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.completed[0].bookId, b.completed[0].bookId);
    assert.equal(a.completed[0].bookId, `blob-sha256-${item.artifact.sha256}`);
    const books = await left.listBooks();
    assert.equal(books.length, 1);
    assert.equal(books[0].sourceHash, item.artifact.sha256);
    assert.equal(bridge.calls.filter(call => call.method === 'complete').length, 2);
  });

  test('drain follows the complete pending collection without a fixed receipt count gate', async () => {
    const items = Array.from({ length: 333 }, (_, index) => receipt(index + 1000));
    const shelf = simpleRepository();
    const bridge = inboxBridge(items);
    const result = await drainAcquisitionInbox(sagaOptions(
      shelf.repository, makeBinding(shelf.repository), bridge,
    ));
    assert.equal(result.ok, true);
    assert.equal(result.listed, items.length);
    assert.equal(result.completed.length, items.length);
    assert.equal(shelf.books().length, items.length);
    assert.equal([...bridge.records.values()].every(item => item.state === 'acknowledged'), true);
  });

  test('AbortSignal stops before I/O and after a durable shelf write without false ack', async () => {
    const pre = new AbortController();
    pre.abort();
    const untouchedShelf = simpleRepository();
    const untouchedBridge = inboxBridge([receipt(20)]);
    await assert.rejects(
      drainAcquisitionInbox(sagaOptions(
        untouchedShelf.repository, makeBinding(untouchedShelf.repository), untouchedBridge,
        { signal: pre.signal },
      )),
      error => error.name === 'AbortError' || error.code === 'ABORT_ERR',
    );
    assert.equal(untouchedBridge.calls.length, 0);

    const item = receipt(21);
    const mid = new AbortController();
    const shelf = simpleRepository();
    const binding = makeBinding(shelf.repository);
    const mutate = shelf.repository.mutateBooks;
    shelf.repository.mutateBooks = async updater => {
      const committed = await mutate(updater);
      mid.abort();
      return committed;
    };
    const bridge = inboxBridge([item]);
    await assert.rejects(
      drainAcquisitionInbox(sagaOptions(shelf.repository, binding, bridge, { signal: mid.signal })),
      error => error.name === 'AbortError' || error.code === 'ABORT_ERR',
    );
    assert.equal(shelf.books().length, 1);
    assert.equal(bridge.records.get(item.receiptId).state, 'pending');
    assert.equal(bridge.calls.some(call => call.method === 'complete'), false);
  });

  test('Library host binds Inbox replay to handoff, rebind, activation and destroy lifecycle gates', () => {
    const source = readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');
    const authority = source.match(/function acquisitionBindingHasWriteAuthority[\s\S]*?\n  \}/)?.[0] || '';
    const drainHost = source.match(/function drainPendingAcquisition[\s\S]*?\n  \}/)?.[0] || '';

    assert.match(source, /acquisitionAbortController:\s*new AbortController\(\)/);
    assert.match(authority, /!ctl\._handoffProvisional/);
    assert.match(authority, /!ctl\._handoffDiscardable/);
    assert.match(drainHost, /signal:\s*binding\.acquisitionAbortController\.signal/);
    assert.match(drainHost, /if \(result && acquisitionBindingIsCurrent\(binding\)\)/);
    assert.doesNotMatch(drainHost, /result\?\.completed/);

    assert.match(
      source,
      /function beginWorkspaceRetirement[\s\S]{0,350}abortAcquisitionBinding\(binding, 'workspace-retirement'\)/,
    );
    assert.match(
      source,
      /ctl\.setHandoffProvisional[\s\S]{0,350}abortAcquisitionBinding\(repositoryBinding, 'handoff-provisional'\)/,
    );
    assert.match(
      source,
      /ctl\.finalizeHandoff[\s\S]{0,220}resumePendingAcquisition\(repositoryBinding\)/,
    );
    assert.match(
      source,
      /ctl\.prepareDestroy[\s\S]{0,350}abortAcquisitionBinding\(repositoryBinding, 'destroy-preflight'\)/,
    );
    assert.match(
      source,
      /activate\(container\)[\s\S]{0,350}ctl\.resumePendingAcquisition\?\.\(\)/,
    );
  });

  test('malformed receipt/list facts fail before any shelf write', async () => {
    const malformed = receipt(22, { artifact: { sha256: 'a'.repeat(32) } });
    const shelf = simpleRepository();
    const bridge = inboxBridge([malformed]);
    await assert.rejects(
      drainAcquisitionInbox(sagaOptions(shelf.repository, makeBinding(shelf.repository), bridge)),
      error => error.code === 'LIBRARY_INBOX_INVALID_RECEIPT',
    );
    assert.equal(shelf.calls.length, 0);
    assert.equal(bridge.calls.some(call => call.method === 'complete'), false);

    const source = readFileSync(new URL('../../renderer/modules/library/acquisition-inbox.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fs:readFile|readFileBase64|\batob\s*\(|\.arrayBuffer\s*\(/);
    assert.doesNotMatch(source, /max(?:Receipts|Inbox|Books)|slice\s*\(\s*0\s*,\s*\d+\s*\)/i);
  });
});
