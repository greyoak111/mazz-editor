// renderer/modules/library/repository.js
// Workspace-scoped persistence boundary for the Library.
//
// The v1 Library stored every workspace in four process-global settings keys.
// This repository keeps those keys readable as migration sources, but never
// mutates or deletes them.  V2 writes are isolated by a canonical workspace
// identity and every read-modify-write for the same settings key is serialized
// across all LibraryRepository instances in this renderer.

const SCHEMA = 2;
const PREFIX = 'library.repository.v2';
const LEGACY_KEYS = Object.freeze({
  shelf: 'library.books',
  categories: 'library.categories',
  progress: 'library.progress',
  bookmarks: 'library.bookmarks',
  cleanRules: 'library.cleanrules',
});
const PARTITIONS = Object.freeze(['shelf', 'external', 'categories', 'progress', 'bookmarks', 'cleanRules']);
const PARTITION_SET = new Set(PARTITIONS);
const BOOK_PARTITION_SET = new Set(['shelf', 'external']);
const DEFAULTS = Object.freeze({
  shelf: Object.freeze([]),
  external: Object.freeze([]),
  categories: Object.freeze([]),
  progress: Object.freeze({}),
  bookmarks: Object.freeze({}),
  cleanRules: Object.freeze([]),
});

// Two open Library tabs in one renderer share this coordinator. Electron child
// windows load a different module realm, so this is only a latency/order aid;
// correctness across renderer processes comes from the main-process CAS below.

function cloneJson(value, fallback = null) {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? fallback : JSON.parse(json);
  } catch {
    return fallback;
  }
}

function normalizeSegments(pathname) {
  const input = String(pathname || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const prefix = input.startsWith('/') ? '/' : '';
  const parts = [];
  for (const part of input.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts.at(-1) !== '..') parts.pop();
      else if (!prefix) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  return prefix + parts.join('/');
}

/** Return a deterministic, separator-safe workspace identity string. */
export function canonicalWorkspace(value) {
  let raw = String(value ?? '').trim();
  if (!raw) return '@no-workspace';
  // file:// is accepted because browser-mode and Electron-mode fixtures may
  // represent the same workspace differently.
  raw = raw
    .replace(/^file:\/\/\/(?=[a-z]:[\\/])/i, '')
    .replace(/^file:\/\//i, '/');
  let normalized = normalizeSegments(raw).replace(/\/+$/, '');
  if (!normalized) normalized = '/';
  // Windows drive and UNC paths are case-insensitive. POSIX paths are not.
  if (/^[a-z]:(?:\/|$)/i.test(normalized) || /^\/[^/]+\/[^/]+/.test(normalized)) {
    normalized = normalized.toLocaleLowerCase('en-US');
  }
  return normalized;
}

/** Stable, synchronous 64-bit-ish identifier (two independent FNV-1a lanes). */
export function stableHash(value) {
  const text = String(value ?? '');
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 0x01000193) >>> 0;
    b ^= code + ((i + 1) * 131);
    b = Math.imul(b, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function workspaceIdentity(value) {
  const canonical = canonicalWorkspace(value);
  return Object.freeze({ canonical, hash: stableHash(canonical) });
}

/** Canonical comparison form for a local book path. */
export function canonicalBookPath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return canonicalWorkspace(raw);
}

export function isPathInsideWorkspace(path, workspace) {
  const candidate = canonicalBookPath(path);
  const root = canonicalWorkspace(workspace);
  if (!candidate || root === '@no-workspace') return false;
  return candidate === root || candidate.startsWith(root === '/' ? '/' : root + '/');
}

function contentFingerprint(book) {
  const raw = book?.contentFingerprint ?? book?.sourceHash ?? book?.contentHash ?? book?.hash ?? '';
  return String(raw).trim().toLocaleLowerCase('en-US');
}

/** Stable identity used for duplicate import checks and legacy external claims. */
export function bookFingerprint(book) {
  const content = contentFingerprint(book);
  if (content) return `content:${content}`;
  const path = canonicalBookPath(book?.path || book?.sourcePath);
  if (path) return `path:${stableHash(path)}`;
  const id = String(book?.id ?? '').trim();
  return id ? `id:${stableHash(id)}` : '';
}

export function sameBook(a, b) {
  const aPath = canonicalBookPath(a?.path || a?.sourcePath);
  const bPath = canonicalBookPath(b?.path || b?.sourcePath);
  if (aPath && bPath && aPath === bPath) return true;
  const aContent = contentFingerprint(a);
  const bContent = contentFingerprint(b);
  return !!(aContent && bContent && aContent === bContent);
}

/** Keep the first occurrence of each path/content fingerprint. */
export function dedupeBooks(books) {
  const output = [];
  const paths = new Set();
  const contents = new Set();
  for (const candidate of Array.isArray(books) ? books : []) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const path = canonicalBookPath(candidate.path || candidate.sourcePath);
    const content = contentFingerprint(candidate);
    if ((path && paths.has(path)) || (content && contents.has(content))) continue;
    if (path) paths.add(path);
    if (content) contents.add(content);
    output.push(cloneJson(candidate, {}));
  }
  return output;
}

/**
 * Normalize logical book records without ever guessing a replacement identity.
 *
 * A book id owns progress, bookmarks and book-scoped clean rules. Two distinct
 * sources with the same id are therefore not a cosmetic duplicate: silently
 * keeping both would make UI selection/removal affect both records, while
 * re-keying here would orphan the associated partitions. Fail closed and leave
 * identity repair to an explicit migration that can remap every dependent key.
 */
export function normalizeBooks(books, context = 'library books') {
  const normalized = dedupeBooks(books);
  const seen = new Set();
  const duplicateIds = new Set();
  for (const book of normalized) {
    const id = String(book?.id ?? '').trim();
    if (!id) continue;
    if (seen.has(id)) duplicateIds.add(id);
    else seen.add(id);
  }
  if (duplicateIds.size) {
    const ids = [...duplicateIds].sort();
    const error = new Error(`Library duplicate book id in ${context}: ${ids.join(', ')}`);
    error.code = 'LIBRARY_DUPLICATE_BOOK_ID';
    error.context = context;
    error.duplicateIds = ids;
    throw error;
  }
  return normalized;
}

function defaultValue(partition) {
  return cloneJson(DEFAULTS[partition], Array.isArray(DEFAULTS[partition]) ? [] : {});
}

function validPartition(partition) {
  const name = String(partition || '');
  if (!PARTITION_SET.has(name)) throw new TypeError(`Unknown LibraryRepository partition: ${name}`);
  return name;
}

export function createLibraryRepositoryCoordinator() {
  const keyTails = new Map();
  return (key, operation) => {
    const previous = keyTails.get(key) || Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const tail = run.then(() => undefined, () => undefined);
    keyTails.set(key, tail);
    tail.finally(() => {
      if (keyTails.get(key) === tail) keyTails.delete(key);
    });
    return run;
  };
}

const withKeyQueue = createLibraryRepositoryCoordinator();

function jsonValueEqual(left, right) {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return false; }
}

function isUnsupportedCasError(error) {
  return /(?:no handler registered|not handled|unknown|unexpected|unsupported).*(?:settings:compareAndSet)|(?:settings:compareAndSet).*(?:no handler|unknown|unexpected|unsupported)/i
    .test(String(error?.message || error || ''));
}

const CAS_RETRY_LIMIT = 16;

function validEnvelope(raw, identity, partition) {
  return !!raw
    && typeof raw === 'object'
    && !Array.isArray(raw)
    && raw.schema === SCHEMA
    && raw.partition === partition
    && raw.workspace?.hash === identity.hash
    && Object.prototype.hasOwnProperty.call(raw, 'value');
}

function invalidPartitionError(raw, identity, partition) {
  const error = new Error(`Library partition is not a supported ${SCHEMA} envelope: ${partition}`);
  error.code = 'LIBRARY_PARTITION_INVALID';
  error.partition = partition;
  error.workspaceId = identity?.hash || '';
  error.observedSchema = raw && typeof raw === 'object' ? raw.schema : undefined;
  return error;
}

function assertMissingOrValidEnvelope(raw, identity, partition) {
  if (raw != null && !validEnvelope(raw, identity, partition)) {
    throw invalidPartitionError(raw, identity, partition);
  }
}

function receipt(repository, partition, envelope, extra = {}) {
  return {
    ok: true,
    schema: SCHEMA,
    revision: Number(envelope?.revision) || 0,
    partition,
    key: repository.key(partition),
    workspace: repository.identity.canonical,
    workspaceId: repository.identity.hash,
    value: cloneJson(envelope?.value, defaultValue(partition)),
    ...extra,
  };
}

function categoryName(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return String(value.id ?? value.name ?? '');
  return '';
}

export class LibraryRepository {
  constructor({ invoke, workspace, now = () => Date.now(), coordinator } = {}) {
    const globalInvoke = globalThis.window?.mazz?.invoke;
    this.invoke = typeof invoke === 'function'
      ? invoke
      : (typeof globalInvoke === 'function' ? globalInvoke.bind(globalThis.window.mazz) : null);
    if (!this.invoke) throw new TypeError('LibraryRepository requires an invoke function');
    this._workspaceInput = workspace;
    this.now = typeof now === 'function' ? now : (() => Date.now());
    this._withKeyQueue = typeof coordinator === 'function' ? coordinator : withKeyQueue;
    this._casCapability = null;
    this.identity = null;
    this._contextPromise = null;
    this._migrationPromise = null;
  }

  async init() {
    if (this.identity) return this;
    if (!this._contextPromise) {
      this._contextPromise = (async () => {
        const workspace = this._workspaceInput !== undefined
          ? this._workspaceInput
          : await this.invoke('workspace:get');
        this.identity = workspaceIdentity(workspace);
        return this;
      })();
    }
    return this._contextPromise;
  }

  key(partition) {
    validPartition(partition);
    if (!this.identity) throw new Error('LibraryRepository.init() must resolve before key()');
    return `${PREFIX}.${this.identity.hash}.${partition}`;
  }

  metaKey() {
    if (!this.identity) throw new Error('LibraryRepository.init() must resolve before metaKey()');
    return `${PREFIX}.${this.identity.hash}.meta`;
  }

  _envelope(partition, value, revision, migration = null) {
    return {
      schema: SCHEMA,
      revision,
      partition,
      workspace: { ...this.identity },
      updatedAt: this.now(),
      value: cloneJson(value, defaultValue(partition)),
      ...(migration ? { migration: cloneJson(migration, null) } : {}),
    };
  }

  async _rawGet(key) {
    return this.invoke('settings:get', { key });
  }

  async _rawSet(key, value) {
    await this.invoke('settings:set', { key, value });
    return value;
  }

  async _rawCompareAndSetMany(entries) {
    const normalized = (Array.isArray(entries) ? entries : []).map(entry => ({
      key: String(entry?.key || ''),
      expected: entry?.expected === undefined ? undefined : cloneJson(entry.expected, entry.expected),
      value: entry?.value === undefined ? undefined : cloneJson(entry.value, entry.value),
    }));
    if (!normalized.length || normalized.some(entry => !entry.key)) {
      throw new TypeError('LibraryRepository CAS requires non-empty keyed entries');
    }

    if (this._casCapability !== false) {
      try {
        const payload = normalized.length === 1
          ? normalized[0]
          : { entries: normalized };
        const result = await this.invoke('settings:compareAndSet', payload);
        if (result && typeof result.ok === 'boolean') {
          this._casCapability = true;
          return { ...result, supported: true };
        }
        // Browser/test bridges predating the channel commonly return null for
        // unknown messages. Cache that fact and retain the old renderer-local
        // queue semantics there; Electron production never takes this branch.
        if (result == null) this._casCapability = false;
        else throw new Error('settings:compareAndSet returned an invalid receipt');
      } catch (error) {
        if (!isUnsupportedCasError(error)) throw error;
        this._casCapability = false;
      }
    }

    // Compatibility path for old/non-Electron bridges. Callers already hold
    // this repository's key coordinator. It is intentionally marked
    // unsupported so multi-partition mutations retain the legacy journal path.
    const current = [];
    for (const entry of normalized) current.push(await this._rawGet(entry.key));
    const conflict = normalized.findIndex((entry, index) => !jsonValueEqual(current[index], entry.expected));
    if (conflict >= 0) {
      return { ok: false, supported: false, key: normalized[conflict].key, current: current[conflict] };
    }
    for (const entry of normalized) await this._rawSet(entry.key, entry.value);
    return { ok: true, supported: false };
  }

  async _rawCompareAndSet(key, expected, value) {
    return this._rawCompareAndSetMany([{ key, expected, value }]);
  }

  booksQueueKey() {
    if (!this.identity) throw new Error('LibraryRepository.init() must resolve before booksQueueKey()');
    return `${PREFIX}.${this.identity.hash}.books-transaction`;
  }

  booksJournalKey() {
    if (!this.identity) throw new Error('LibraryRepository.init() must resolve before booksJournalKey()');
    return `${PREFIX}.${this.identity.hash}.books-journal`;
  }

  async _claimLegacy(localCandidates, externalCandidates, _preloadedRaw) {
    const claimKey = `${PREFIX}.legacy-external-claims`;
    return this._withKeyQueue(claimKey, async () => {
      // `_migrateAll()` preloads this ledger only as a fail-fast read before
      // any migration write. It is never authoritative: workspace migrations
      // use different migration queues and can therefore preload the same old
      // snapshot concurrently. Re-read under the shared claim-key queue so the
      // second claimant observes and merges the first claimant's commit.
      const localFingerprints = new Set(localCandidates.map(bookFingerprint).filter(Boolean));
      const externalFingerprints = new Set(externalCandidates.map(bookFingerprint).filter(Boolean));
      for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt++) {
        const raw = await this._rawGet(claimKey);
        const claims = raw && typeof raw === 'object' && !Array.isArray(raw)
          ? { ...(raw.claims || {}) }
          : {};
        let changed = false;
        const acceptedLocal = [];
        const acceptedExternal = [];
        // Every automatically migrated record has one owner. In particular, a
        // record first seen as local must not later be inherited as another
        // workspace's external book (or vice versa).
        for (const book of dedupeBooks([...localCandidates, ...externalCandidates])) {
          const fingerprint = bookFingerprint(book);
          if (!fingerprint) continue;
          const owner = claims[fingerprint];
          if (!owner) {
            claims[fingerprint] = this.identity.hash;
            changed = true;
          }
          if (owner && owner !== this.identity.hash) continue;
          if (localFingerprints.has(fingerprint)) {
            const record = cloneJson(book, {});
            delete record.repositoryScope;
            delete record.repositoryWorkspace;
            acceptedLocal.push(record);
          } else if (externalFingerprints.has(fingerprint)) {
            acceptedExternal.push({
              ...cloneJson(book, {}),
              repositoryScope: 'external',
              repositoryWorkspace: this.identity.hash,
            });
          }
        }
        if (!changed || (await this._rawCompareAndSet(claimKey, raw, {
          schema: SCHEMA,
          revision: (Number(raw?.revision) || 0) + 1,
          updatedAt: this.now(),
          claims,
        })).ok) {
          return {
            local: dedupeBooks(acceptedLocal),
            external: dedupeBooks(acceptedExternal),
          };
        }
      }
      throw Object.assign(new Error('Library legacy external claim CAS exhausted'), { code: 'LIBRARY_CAS_EXHAUSTED' });
    });
  }

  async _claimLegacyRules(candidates, _preloadedRaw) {
    const claimKey = `${PREFIX}.legacy-cleanrule-claims`;
    return this._withKeyQueue(claimKey, async () => {
      // See `_claimLegacy()`: the preload is a transport/readability gate, not
      // a transaction snapshot. Only a read performed while holding this
      // claim-key queue may decide ownership.
      for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt++) {
        const raw = await this._rawGet(claimKey);
        const claims = raw && typeof raw === 'object' && !Array.isArray(raw)
          ? { ...(raw.claims || {}) }
          : {};
        let changed = false;
        const accepted = [];
        for (const rule of Array.isArray(candidates) ? candidates : []) {
          if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !String(rule.pattern || '')) continue;
          const fingerprint = `rule:${stableHash(JSON.stringify([
            rule.id || '', rule.name || '', rule.pattern || '', rule.match || '', rule.type || '',
            rule.replacement || '', rule.scope || '', rule.bookId || '',
          ]))}`;
          if (!claims[fingerprint]) {
            claims[fingerprint] = this.identity.hash;
            changed = true;
          }
          if (claims[fingerprint] === this.identity.hash) accepted.push(cloneJson(rule, {}));
        }
        if (!changed || (await this._rawCompareAndSet(claimKey, raw, {
          schema: SCHEMA,
          revision: (Number(raw?.revision) || 0) + 1,
          updatedAt: this.now(),
          claims,
        })).ok) return accepted;
      }
      throw Object.assign(new Error('Library legacy clean-rule claim CAS exhausted'), { code: 'LIBRARY_CAS_EXHAUSTED' });
    });
  }

  async _migrateAll() {
    await this.init();
    const migrationKey = `${PREFIX}.${this.identity.hash}.migration`;
    return this._withKeyQueue(migrationKey, async () => {
      const existing = {};
      const existingRaw = {};
      for (const partition of PARTITIONS) {
        const raw = await this._rawGet(this.key(partition));
        existingRaw[partition] = raw;
        // A non-null scoped value is owned data, even when it was written by a
        // newer schema or is malformed.  Never reinterpret it as an absent
        // partition and overwrite it with an empty v2 envelope.
        assertMissingOrValidEnvelope(raw, this.identity, partition);
        if (validEnvelope(raw, this.identity, partition)) existing[partition] = raw;
      }
      if (PARTITIONS.every(partition => existing[partition])) return false;
      const metaRaw = await this._rawGet(this.metaKey());

      // Read every migration source and both claim ledgers before the first
      // write. A transient settings read failure is not an empty library and
      // must leave the workspace entirely untouched for a clean retry.
      const [
        legacyShelfRaw, legacyCategories, legacyProgress, legacyBookmarks,
        legacyCleanRulesRaw, externalClaimsRaw, cleanRuleClaimsRaw,
      ] = await Promise.all([
        this._rawGet(LEGACY_KEYS.shelf),
        this._rawGet(LEGACY_KEYS.categories),
        this._rawGet(LEGACY_KEYS.progress),
        this._rawGet(LEGACY_KEYS.bookmarks),
        this._rawGet(LEGACY_KEYS.cleanRules),
        this._rawGet(`${PREFIX}.legacy-external-claims`),
        this._rawGet(`${PREFIX}.legacy-cleanrule-claims`),
      ]);
      // Validate before claim ledgers or workspace partitions are touched. A
      // duplicate id cannot be migrated safely without remapping progress,
      // bookmarks and book-scoped rules as one explicit identity operation.
      const legacyShelf = normalizeBooks(legacyShelfRaw, 'legacy shelf migration');
      const localCandidates = legacyShelf.filter(book =>
        isPathInsideWorkspace(book.path, this.identity.canonical)
        && String(book.repositoryScope || '').toLowerCase() !== 'external');
      // A process-global v1 shelf does not contain enough information to infer
      // whether an arbitrary outside path belongs to this workspace or to a
      // different one. Only explicitly external records are auto-adopted; all
      // other unowned v1 records remain readable at the untouched legacy key.
      const externalCandidates = legacyShelf.filter(book => {
        if (String(book.repositoryScope || '').toLowerCase() !== 'external') return false;
        const owner = String(book.repositoryWorkspace || '').trim();
        return !owner || owner === this.identity.hash || canonicalWorkspace(owner) === this.identity.canonical;
      });
      const claimed = await this._claimLegacy(localCandidates, externalCandidates, externalClaimsRaw);
      const local = existing.shelf?.value || claimed.local;
      const external = existing.external?.value || claimed.external;
      normalizeBooks([...local, ...external], 'workspace migration');
      const acceptedIds = new Set([...local, ...external].map(book => String(book.id ?? '')).filter(Boolean));

      const usedCategories = new Set([...local, ...external].map(book => String(book.category ?? '')).filter(Boolean));
      const categories = (Array.isArray(legacyCategories) ? legacyCategories : [])
        .filter(category => usedCategories.has(categoryName(category)));

      const filterRecordMap = (raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        return Object.fromEntries(Object.entries(raw)
          .filter(([bookId]) => acceptedIds.has(String(bookId)))
          .map(([bookId, value]) => [bookId, cloneJson(value, null)]));
      };
      const progress = filterRecordMap(legacyProgress);
      const bookmarks = filterRecordMap(legacyBookmarks);
      const cleanRules = await this._claimLegacyRules((Array.isArray(legacyCleanRulesRaw) ? legacyCleanRulesRaw : [])
        .filter(rule => rule?.scope !== 'book' || acceptedIds.has(String(rule.bookId || ''))), cleanRuleClaimsRaw);
      const migratedValues = { shelf: local, external, categories, progress, bookmarks, cleanRules };
      const migration = {
        fromSchema: 1,
        at: this.now(),
        legacyKeys: Object.values(LEGACY_KEYS),
        localBooks: local.length,
        externalBooks: external.length,
      };

      for (const partition of PARTITIONS) {
        if (existing[partition]) continue;
        const key = this.key(partition);
        const envelope = this._envelope(partition, migratedValues[partition], 1, migration);
        let expected = existingRaw[partition];
        let settled = false;
        for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt++) {
          if ((await this._rawCompareAndSet(key, expected, envelope)).ok) {
            settled = true;
            break;
          }
          const current = await this._rawGet(key);
          if (validEnvelope(current, this.identity, partition)) {
            existing[partition] = current;
            settled = true;
            break;
          }
          assertMissingOrValidEnvelope(current, this.identity, partition);
          expected = current;
        }
        if (!settled) throw Object.assign(new Error(`Library migration CAS exhausted: ${partition}`), { code: 'LIBRARY_CAS_EXHAUSTED' });
      }
      const meta = {
        schema: SCHEMA,
        revision: 1,
        workspace: { ...this.identity },
        migratedAt: this.now(),
        legacyReadThrough: true,
      };
      let expectedMeta = metaRaw;
      for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt++) {
        if ((await this._rawCompareAndSet(this.metaKey(), expectedMeta, meta)).ok) break;
        const current = await this._rawGet(this.metaKey());
        if (current?.schema === SCHEMA && current?.workspace?.hash === this.identity.hash) break;
        expectedMeta = current;
        if (attempt === CAS_RETRY_LIMIT - 1) {
          throw Object.assign(new Error('Library migration meta CAS exhausted'), { code: 'LIBRARY_CAS_EXHAUSTED' });
        }
      }
      return true;
    });
  }

  async _ensureMigrated() {
    await this.init();
    if (!this._migrationPromise) {
      this._migrationPromise = this._migrateAll().catch(error => {
        this._migrationPromise = null;
        throw error;
      });
    }
    return this._migrationPromise;
  }

  _validBooksJournal(raw) {
    return !!raw
      && raw.schema === SCHEMA
      && raw.kind === 'library-books-journal'
      && raw.workspace?.hash === this.identity.hash
      && (raw.state === 'prepared' || raw.state === 'committed')
      && raw.before && raw.after;
  }

  async _clearBooksJournal() {
    await this._rawSet(this.booksJournalKey(), null);
  }

  async _recoverBooksJournalUnlocked() {
    const key = this.booksJournalKey();
    // A transport/storage failure is not evidence that no journal exists.
    // Callers hold the books transaction queue here, so propagate the read
    // failure before touching either partition. Treating it as an empty slot
    // could let a new mutation commit on top of a prepared/half-written
    // transaction and permanently mix its two generations.
    for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt++) {
      const raw = await this._rawGet(key);
      if (!this._validBooksJournal(raw)) return { recovered: false };
      const casProtocol = raw.commitProtocol === 'settings-cas-v1';
      const source = raw.state === 'committed' ? raw.after : raw.before;
      const action = casProtocol
        ? (raw.state === 'committed' ? 'finalize-committed' : 'discard-prepared')
        : (raw.state === 'committed' ? 'roll-forward' : 'roll-back');
      try {
        let recovered;
        if (casProtocol) {
          // CAS-v1 writes both partitions and the committed marker in one main
          // process turn. A prepared marker therefore owns no partition data,
          // while a committed marker needs only finalization. Replaying before
          // or after here would overwrite a later single-partition CAS.
          recovered = await this._rawCompareAndSet(key, raw, null);
        } else {
          // Legacy sequential journals may genuinely be half-written. Compare
          // all three current values and repair them in one main-process CAS so
          // a child renderer cannot be overwritten between shelf/external.
          const [shelfCurrent, externalCurrent] = await Promise.all([
            this._rawGet(this.key('shelf')),
            this._rawGet(this.key('external')),
          ]);
          recovered = await this._rawCompareAndSetMany([
            { key: this.key('shelf'), expected: shelfCurrent, value: cloneJson(source.shelf, null) },
            { key: this.key('external'), expected: externalCurrent, value: cloneJson(source.external, null) },
            { key, expected: raw, value: null },
          ]);
        }
        if (recovered.ok) return { recovered: true, action, transactionId: raw.transactionId };
      } catch (cause) {
        const error = new Error(`Library books journal recovery failed (${action}): ${cause?.message || cause}`);
        error.code = 'LIBRARY_BOOKS_RECOVERY_FAILED';
        error.receipt = {
          ok: false,
          atomic: false,
          recoverable: true,
          action,
          transactionId: raw.transactionId,
          journalKey: key,
        };
        throw error;
      }
    }
    throw Object.assign(new Error('Library books journal recovery CAS exhausted'), { code: 'LIBRARY_CAS_EXHAUSTED' });
  }

  async _readPartitionUnlocked(name) {
    const key = this.key(name);
    for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt++) {
      const raw = await this._rawGet(key);
      if (validEnvelope(raw, this.identity, name)) return raw;
      assertMissingOrValidEnvelope(raw, this.identity, name);
      const envelope = this._envelope(name, defaultValue(name), 1);
      if ((await this._rawCompareAndSet(key, raw, envelope)).ok) return envelope;
    }
    throw Object.assign(new Error(`Library partition repair CAS exhausted: ${name}`), { code: 'LIBRARY_CAS_EXHAUSTED' });
  }

  async get(partition) {
    const name = validPartition(partition);
    await this._ensureMigrated();
    const operation = async () => {
      if (BOOK_PARTITION_SET.has(name)) await this._recoverBooksJournalUnlocked();
      const raw = await this._rawGet(this.key(name));
      if (!validEnvelope(raw, this.identity, name)) {
        // Settings may have been manually cleared after initialization. Repair
        // only the scoped v2 key; the v1 source remains untouched.
        const envelope = await this._readPartitionUnlocked(name);
        return receipt(this, name, envelope, { repaired: true });
      }
      return receipt(this, name, raw, { migrated: !!raw.migration });
    };
    return BOOK_PARTITION_SET.has(name)
      ? this._withKeyQueue(this.booksQueueKey(), operation)
      : operation();
  }

  async getValue(partition) {
    return (await this.get(partition)).value;
  }

  async set(partition, value, { expectedRevision } = {}) {
    const name = validPartition(partition);
    await this._ensureMigrated();
    const key = this.key(name);
    const queueKey = BOOK_PARTITION_SET.has(name) ? this.booksQueueKey() : key;
    const snapshot = cloneJson(value, defaultValue(name));
    return this._withKeyQueue(queueKey, async () => {
      for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt++) {
        if (BOOK_PARTITION_SET.has(name)) await this._recoverBooksJournalUnlocked();
        const current = await this._rawGet(key);
        assertMissingOrValidEnvelope(current, this.identity, name);
        const previousRevision = validEnvelope(current, this.identity, name)
          ? Number(current.revision) || 0
          : 0;
        if (expectedRevision !== undefined && Number(expectedRevision) !== previousRevision) {
          return receipt(this, name, current || this._envelope(name, defaultValue(name), previousRevision), {
            ok: false,
            conflict: true,
            expectedRevision: Number(expectedRevision),
            previousRevision,
          });
        }
        const envelope = this._envelope(name, snapshot, previousRevision + 1);
        if ((await this._rawCompareAndSet(key, current, envelope)).ok) {
          return receipt(this, name, envelope, { previousRevision, attempts: attempt + 1 });
        }
      }
      throw Object.assign(new Error(`Library set CAS exhausted: ${name}`), { code: 'LIBRARY_CAS_EXHAUSTED' });
    });
  }

  async mutate(partition, updater, options = {}) {
    const name = validPartition(partition);
    if (typeof updater !== 'function') throw new TypeError('LibraryRepository.mutate requires an updater function');
    await this._ensureMigrated();
    const key = this.key(name);
    const queueKey = BOOK_PARTITION_SET.has(name) ? this.booksQueueKey() : key;
    return this._withKeyQueue(queueKey, async () => {
      for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt++) {
        if (BOOK_PARTITION_SET.has(name)) await this._recoverBooksJournalUnlocked();
        const current = await this._rawGet(key);
        assertMissingOrValidEnvelope(current, this.identity, name);
        const previousRevision = validEnvelope(current, this.identity, name)
          ? Number(current.revision) || 0
          : 0;
        if (options.expectedRevision !== undefined && Number(options.expectedRevision) !== previousRevision) {
          return receipt(this, name, current || this._envelope(name, defaultValue(name), previousRevision), {
            ok: false,
            conflict: true,
            expectedRevision: Number(options.expectedRevision),
            previousRevision,
          });
        }
        const draft = cloneJson(current?.value, defaultValue(name));
        const returned = await updater(draft, {
          schema: SCHEMA,
          revision: previousRevision,
          partition: name,
          workspace: this.identity.canonical,
          workspaceId: this.identity.hash,
          attempt,
        });
        const next = returned === undefined ? draft : returned;
        const envelope = this._envelope(name, cloneJson(next, defaultValue(name)), previousRevision + 1);
        if ((await this._rawCompareAndSet(key, current, envelope)).ok) {
          return receipt(this, name, envelope, { previousRevision, attempts: attempt + 1 });
        }
      }
      throw Object.assign(new Error(`Library mutate CAS exhausted: ${name}`), { code: 'LIBRARY_CAS_EXHAUSTED' });
    });
  }

  async listBooks({ includeExternal = true } = {}) {
    await this._ensureMigrated();
    return this._withKeyQueue(this.booksQueueKey(), async () => {
      await this._recoverBooksJournalUnlocked();
      const shelfRaw = await this._readPartitionUnlocked('shelf');
      const shelf = shelfRaw.value;
      if (!includeExternal) return normalizeBooks(shelf, 'workspace shelf read');
      const externalRaw = await this._readPartitionUnlocked('external');
      const external = externalRaw.value;
      return normalizeBooks(
        [...(Array.isArray(shelf) ? shelf : []), ...(Array.isArray(external) ? external : [])],
        'workspace logical shelf read',
      );
    });
  }

  /**
   * Mutate the logical shelf exposed to the renderer under one renderer-local
   * queue. Persistence spans two settings keys and is therefore journaled, not
   * falsely advertised as a filesystem/database transaction.
   *
   * Workspace-owned and explicitly external books live in separate physical
   * partitions. UI callers must not perform two unrelated read/modify/write
   * cycles: two open Library tabs could otherwise resurrect a removed book or
   * lose a concurrent import. The composite queue is shared per workspace.
   */
  async mutateBooks(updater) {
    if (typeof updater !== 'function') throw new TypeError('LibraryRepository.mutateBooks requires an updater function');
    await this._ensureMigrated();
    return this._withKeyQueue(this.booksQueueKey(), async () => {
      const shelfKey = this.key('shelf');
      const externalKey = this.key('external');
      const journalKey = this.booksJournalKey();
      let recoveredBeforeCommit = false;
      for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt++) {
        const recovery = await this._recoverBooksJournalUnlocked();
        recoveredBeforeCommit ||= recovery.recovered === true;
        // A failed settings read is not an empty library. Propagate transport/I/O
        // errors; only an actually missing envelope is initialized. A non-null
        // malformed or future-schema envelope must fail closed.
        const [shelfRaw, externalRaw] = await Promise.all([
          this._readPartitionUnlocked('shelf'),
          this._readPartitionUnlocked('external'),
        ]);
        const shelfValue = validEnvelope(shelfRaw, this.identity, 'shelf') ? shelfRaw.value : [];
        const externalValue = validEnvelope(externalRaw, this.identity, 'external') ? externalRaw.value : [];
        const original = normalizeBooks([
          ...(Array.isArray(shelfValue) ? shelfValue : []),
          ...(Array.isArray(externalValue) ? externalValue : []),
        ], 'mutateBooks current state');
        const draft = cloneJson(original, []);
        const returned = await updater(draft, {
          schema: SCHEMA,
          workspace: this.identity.canonical,
          workspaceId: this.identity.hash,
          attempt,
        });
        const next = normalizeBooks(returned === undefined ? draft : returned, 'mutateBooks proposed state');
        const local = [];
        const external = [];
        for (const book of next) {
          const explicitExternal = String(book.repositoryScope || '').toLowerCase() === 'external';
          const owned = isPathInsideWorkspace(book.path || book.sourcePath, this.identity.canonical);
          const record = cloneJson(book, {});
          if (explicitExternal || !owned) {
            record.repositoryScope = 'external';
            record.repositoryWorkspace = this.identity.hash;
            external.push(record);
          } else {
            delete record.repositoryScope;
            delete record.repositoryWorkspace;
            local.push(record);
          }
        }
        const shelfRevision = (validEnvelope(shelfRaw, this.identity, 'shelf') ? Number(shelfRaw.revision) : 0) || 0;
        const externalRevision = (validEnvelope(externalRaw, this.identity, 'external') ? Number(externalRaw.revision) : 0) || 0;
        const shelfEnvelope = this._envelope('shelf', local, shelfRevision + 1);
        const externalEnvelope = this._envelope('external', external, externalRevision + 1);
        const transactionId = `${this.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const journal = {
          schema: SCHEMA,
          kind: 'library-books-journal',
          state: 'prepared',
          transactionId,
          workspace: { ...this.identity },
          updatedAt: this.now(),
          before: { shelf: cloneJson(shelfRaw, null), external: cloneJson(externalRaw, null) },
          after: { shelf: shelfEnvelope, external: externalEnvelope },
        };

        // Claim the one journal slot before committing. A different renderer
        // may have prepared since our initial recovery/read; never overwrite it.
        const journalRaw = await this._rawGet(journalKey);
        if (this._validBooksJournal(journalRaw)) continue;
        const casJournal = { ...journal, commitProtocol: 'settings-cas-v1' };
        const prepared = await this._rawCompareAndSet(journalKey, journalRaw, casJournal);
        if (!prepared.ok) continue;

        if (prepared.supported) {
          const committedJournal = { ...casJournal, state: 'committed', committedAt: this.now() };
          const committed = await this._rawCompareAndSetMany([
            { key: shelfKey, expected: shelfRaw, value: shelfEnvelope },
            { key: externalKey, expected: externalRaw, value: externalEnvelope },
            { key: journalKey, expected: casJournal, value: committedJournal },
          ]);
          if (!committed.ok) {
            // CAS-v1 prepared owns no partition values, so discard only our
            // exact marker. A later renderer's marker/value is never touched.
            await this._rawCompareAndSet(journalKey, casJournal, null);
            continue;
          }
          const cleared = await this._rawCompareAndSet(journalKey, committedJournal, null);
          return {
            ok: true,
            atomic: true,
            durability: 'main-process-cas',
            transactionId,
            journalPending: !cleared.ok,
            recoveredBeforeCommit,
            attempts: attempt + 1,
            schema: SCHEMA,
            workspace: this.identity.canonical,
            workspaceId: this.identity.hash,
            shelfRevision: shelfEnvelope.revision,
            externalRevision: externalEnvelope.revision,
            value: normalizeBooks([...local, ...external], 'mutateBooks committed state'),
          };
        }

        // Compatibility bridge: replace the CAS-only marker before performing
        // the historical sequential journal transaction. Renderer-local queues
        // still serialize this path; real Electron always uses the branch above.
        let stage = 'prepare-journal';
        let journalPrepared = false;
        try {
          await this._rawSet(journalKey, journal);
          journalPrepared = true;
          stage = 'write-shelf';
          await this._rawSet(shelfKey, shelfEnvelope);
          stage = 'write-external';
          await this._rawSet(externalKey, externalEnvelope);
          stage = 'commit-journal';
          await this._rawSet(journalKey, { ...journal, state: 'committed', committedAt: this.now() });
        } catch (cause) {
          let rolledBack = !journalPrepared;
          let rollbackError = null;
          let rollbackJournalPending = false;
          if (journalPrepared) {
            try {
              await this._rawSet(shelfKey, cloneJson(shelfRaw, null));
              await this._rawSet(externalKey, cloneJson(externalRaw, null));
              rolledBack = true;
              try { await this._clearBooksJournal(); }
              catch { rollbackJournalPending = true; }
            } catch (error) {
              rollbackError = error;
            }
          }
          const error = new Error(`Library books commit failed at ${stage}: ${cause?.message || cause}`);
          error.code = 'LIBRARY_BOOKS_COMMIT_FAILED';
          error.receipt = {
            ok: false,
            atomic: false,
            durability: 'journaled-two-key',
            recoverable: journalPrepared && (!rolledBack || rollbackJournalPending),
            rolledBack,
            journalPending: journalPrepared && (!rolledBack || rollbackJournalPending),
            transactionId,
            journalKey,
            stage,
            rollbackError: rollbackError ? String(rollbackError.message || rollbackError) : '',
          };
          throw error;
        }
        let journalPending = false;
        try { await this._clearBooksJournal(); }
        catch { journalPending = true; }
        return {
          ok: true,
          atomic: false,
          durability: 'journaled-two-key',
          transactionId,
          journalPending,
          recoveredBeforeCommit,
          attempts: attempt + 1,
          schema: SCHEMA,
          workspace: this.identity.canonical,
          workspaceId: this.identity.hash,
          shelfRevision: shelfEnvelope.revision,
          externalRevision: externalEnvelope.revision,
          value: normalizeBooks([...local, ...external], 'mutateBooks committed state'),
        };
      }
      throw Object.assign(new Error('Library mutateBooks CAS exhausted'), { code: 'LIBRARY_CAS_EXHAUSTED' });
    });
  }
}

export function createLibraryRepository(options) {
  return new LibraryRepository(options);
}

export const LIBRARY_REPOSITORY_SCHEMA = SCHEMA;
export const LIBRARY_REPOSITORY_PARTITIONS = PARTITIONS;
export const _forTests = { cloneJson, withKeyQueue, validEnvelope, contentFingerprint, LEGACY_KEYS, PREFIX };
