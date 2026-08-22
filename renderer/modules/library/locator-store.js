// renderer/modules/library/locator-store.js
// Library reading-position persistence boundary.
//
// The caller owns the mutable reader controller. This store deliberately does
// not: put() snapshots bookId/path/record synchronously, before the first await,
// then serializes the legacy settings read-modify-write and mirrors the same
// immutable record to MazzProgress.

const DEFAULT_KEY = 'library.progress';

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : JSON.parse(json);
  } catch {
    return null;
  }
}

function recordTimestamp(record, fallback = 0) {
  const direct = Number(record?.updatedAt);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const outer = Number(fallback);
  return Number.isFinite(outer) && outer > 0 ? outer : 0;
}

/**
 * Reconcile the workspace-local locator with the LAN projection.
 *
 * The local repository is the tie-breaker because it is the canonical durable
 * ledger for the active workspace.  A projection with no timestamp must never
 * roll a timestamped local write backwards; conversely, a genuinely newer LAN
 * record is allowed to advance the reader. Locator records are selected as an
 * atomic winner: mixing an old anchor/spine id with a newer chapter/page would
 * manufacture a position that never existed.
 */
export function mergeLocatorRecords(localRecord, syncedEnvelope) {
  const local = cloneJson(plainObject(localRecord)) || {};
  const remote = cloneJson(plainObject(syncedEnvelope?.value)) || {};
  const hasLocal = Object.keys(local).length > 0;
  const hasRemote = Object.keys(remote).length > 0;
  if (!hasRemote) return local;
  const remoteTime = recordTimestamp(remote, syncedEnvelope?.updatedAt);
  if (!hasLocal) {
    return remoteTime > 0 && !recordTimestamp(remote)
      ? { ...remote, updatedAt: remoteTime }
      : remote;
  }
  const localTime = recordTimestamp(local);
  if (remoteTime <= localTime) return local;
  if (!recordTimestamp(remote) && remoteTime > 0) remote.updatedAt = remoteTime;
  return remote;
}

function snapshotWrite(input, pathArg, recordArg) {
  const source = input && typeof input === 'object' && arguments.length === 1
    ? input
    : { bookId: input, path: pathArg, record: recordArg };
  const bookId = String(source.bookId ?? '').trim();
  const path = String(source.path ?? '');
  const record = cloneJson(source.record ?? source.rec);
  if (!bookId || !record || typeof record !== 'object' || Array.isArray(record)) return null;
  return Object.freeze({ bookId, path, record: Object.freeze(record) });
}

export class LibraryLocatorStore {
  constructor({ invoke, progress, settingsKey = DEFAULT_KEY } = {}) {
    const globalInvoke = globalThis.window?.mazz?.invoke;
    this.invoke = typeof invoke === 'function'
      ? invoke
      : (typeof globalInvoke === 'function' ? globalInvoke.bind(globalThis.window.mazz) : null);
    this.progress = progress ?? globalThis.window?.MazzProgress ?? null;
    this.settingsKey = settingsKey || DEFAULT_KEY;
    this._settingsTail = Promise.resolve();
    this._pendingByBook = new Map();
    this._failuresByBook = new Map();
  }

  /**
   * Queue one immutable position write.
   *
   * Supported call shapes:
   *   put({ bookId, path, record })
   *   put({ bookId, path, rec })       // compatibility convenience
   *   put(bookId, path, record)
   *
   * The returned promise always resolves with a receipt; persistence failures
   * never escape into reader UI event handlers.
   */
  put(input, path, record) {
    // This line must remain before any Promise continuation: mutable controller
    // state may point at another book as soon as the caller yields.
    const write = arguments.length === 1
      ? snapshotWrite(input)
      : snapshotWrite(input, path, record);
    if (!write) return Promise.resolve({ ok: false, accepted: false, settings: false, projection: false });

    const job = this._settingsTail.then(() => this._commit(write));
    const safe = job.catch(() => ({
      ok: false, accepted: true, bookId: write.bookId,
      settings: false, projection: false,
    }));

    // One shared settings queue is intentionally stronger than independent
    // per-book queues: library.progress is one legacy object, so concurrent
    // read-modify-write operations for different books would otherwise clobber
    // each other. _pendingByBook still gives flush(bookId) precise ownership.
    this._settingsTail = safe.then(() => undefined, () => undefined);
    let pending = this._pendingByBook.get(write.bookId);
    if (!pending) this._pendingByBook.set(write.bookId, pending = new Set());
    pending.add(safe);
    safe.then(receipt => {
      if (receipt?.accepted !== true) return;
      // A later successful write contains the complete current locator and
      // supersedes an earlier failed attempt for the same book.
      if (receipt?.ok === true) {
        this._failuresByBook.delete(write.bookId);
        return;
      }
      let failures = this._failuresByBook.get(write.bookId);
      if (!failures) this._failuresByBook.set(write.bookId, failures = []);
      failures.push(receipt);
    });
    safe.finally(() => {
      pending.delete(safe);
      if (!pending.size && this._pendingByBook.get(write.bookId) === pending) {
        this._pendingByBook.delete(write.bookId);
      }
    });
    return safe;
  }

  async _commit(write) {
    let settings = false;
    let projection = !write.path;

    try {
      const current = plainObject(await this.invoke?.('settings:get', { key: this.settingsKey }));
      // Preserve the old on-disk shape: { [bookId]: record }. A shallow copy
      // avoids mutating an object owned by a settings mock/bridge in place.
      const next = { ...current, [write.bookId]: cloneJson(write.record) };
      await this.invoke?.('settings:set', {
        key: this.settingsKey,
        value: next,
        // Repository-backed Library tabs intercept this semantic one-book
        // patch and apply it inside their CAS mutation.  `value` remains for
        // legacy settings bridges, but must never be treated as the patch by
        // a cross-renderer repository owner because it contains a stale
        // read snapshot of every other book.
        libraryLocatorPatch: {
          bookId: write.bookId,
          record: cloneJson(write.record),
        },
      });
      settings = true;
    } catch {
      // The LAN projection is still useful when local settings persistence is
      // temporarily unavailable, so it is attempted independently below.
    }

    if (write.path && typeof this.progress?.put === 'function') {
      try {
        // immediate=true makes flush(bookId) a real durability boundary rather
        // than merely waiting for ProgressRelay's debounce timer to be armed.
        const projected = await this.progress.put('library', write.path, cloneJson(write.record), { immediate: true });
        projection = projected !== false && projected != null && projected?.ok !== false;
      } catch {
        projection = false;
      }
    }

    return {
      ok: settings && projection,
      accepted: true,
      bookId: write.bookId,
      settings,
      projection,
    };
  }

  /** Wait for writes queued for one book, or every book when bookId is absent. */
  async flush(bookId) {
    const key = bookId != null ? String(bookId).trim() : '';
    if (key) {
      const pending = this._pendingByBook.get(key);
      const receipts = pending ? await Promise.all([...pending]) : [];
      const failures = this._failuresByBook.get(key) || [];
      if (failures.length) {
        const error = Object.assign(new Error(`书库阅读位置未能持久化：${key}`), {
          code: 'LIBRARY_LOCATOR_DURABILITY_FAILED', bookId: key, receipts: [...failures],
        });
        throw error;
      }
      this._failuresByBook.delete(key);
      return receipts;
    }
    await this._settingsTail;
    // Defensive compatibility: projections created outside this store may
    // still be debounced. Do not require flushAll to exist, but a real failure
    // must reject the window-close durability gate.
    if (typeof this.progress?.flushAll === 'function') await this.progress.flushAll();
    const failures = [...this._failuresByBook.entries()]
      .flatMap(([failedBookId, receipts]) => receipts.map(receipt => ({ bookId: failedBookId, receipt })));
    if (failures.length) {
      throw Object.assign(new Error('书库阅读位置未能全部持久化'), {
        code: 'LIBRARY_LOCATOR_DURABILITY_FAILED', failures,
      });
    }
    this._failuresByBook.clear();
    return [];
  }

  flushAll() { return this.flush(); }
}

export function createLibraryLocatorStore(options) {
  return new LibraryLocatorStore(options);
}

export const _forTests = { snapshotWrite, cloneJson, recordTimestamp };
