// Reader appearance preferences, deliberately separate from reading locators.
//
// A locator is evidence of *where* the user was and belongs in the durable
// progress pipeline. Appearance is a reversible view preference.  Older Mazz
// records mixed both in one flat object; the helpers below can split that shape
// without discarding fields introduced by future versions or extensions.

import { canonicalWorkspace, canonicalBookPath, stableHash } from './repository.js';

const SCHEMA = 1;
const PREFIX = 'library.reader.v1';

export const DEFAULT_READER_APPEARANCE = Object.freeze({
  mode: 'single',
  direction: 'ltr',
  font: '',
  fontSize: 16,
  lineHeight: 1.8,
  pageWidth: 0.7,
  theme: 'paper',
  zoom: 100,
  spread: Object.freeze({ cover: true, parity: 0, fit: 'contain' }),
});

const APPEARANCE_KEYS = new Set([
  'mode', 'direction', 'font', 'fontSize', 'lineHeight', 'pageWidth', 'theme', 'zoom', 'spread',
  // Legacy controller/storage aliases.
  'fontFamily', 'readTheme', 'mangaZoom', 'coverSingle', 'spreadCover',
  'spreadParity', 'spreadOffset', 'fit', 'fitMode',
]);
const LOCATOR_KEYS = new Set([
  'chapter', 'page', 'ratio', 'pct', 'anchor', 'spineItemId', 'href', 'textQuote',
  'scrollTop', 'scrollLeft', 'cfi', 'position', 'progression', 'updatedAt',
]);
const STRUCTURAL_KEYS = new Set(['schema', 'appearance', 'locator']);
const keyTails = new Map();

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback = null) {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? fallback : JSON.parse(json);
  } catch {
    return fallback;
  }
}

function numberIn(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
}

function cleanString(value, max = 256) {
  return typeof value === 'string' ? value.trim().slice(0, max) : null;
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function alias(source, primary, ...legacy) {
  if (own(source, primary)) return source[primary];
  for (const key of legacy) if (own(source, key)) return source[key];
  return undefined;
}

function normalizeSpread(source, defaults) {
  const nested = plainObject(source.spread);
  const base = defaults ? cloneJson(DEFAULT_READER_APPEARANCE.spread, {}) : {};
  // Preserve extension fields inside spread while canonical values win.
  const spread = { ...base, ...cloneJson(nested, {}) };
  const cover = alias(nested, 'cover');
  const legacyCover = alias(source, 'coverSingle', 'spreadCover');
  if (typeof (cover ?? legacyCover) === 'boolean') spread.cover = cover ?? legacyCover;

  const parityValue = alias(nested, 'parity', 'offset') ?? alias(source, 'spreadParity', 'spreadOffset');
  if (Number.isFinite(Number(parityValue))) spread.parity = Math.abs(Math.trunc(Number(parityValue))) % 2;

  const fitValue = alias(nested, 'fit') ?? alias(source, 'fit', 'fitMode');
  const fit = cleanString(fitValue, 32);
  if (fit) spread.fit = fit;
  return spread;
}

/** Normalize appearance fields and retain unknown extension properties. */
export function normalizeReaderAppearance(value, { defaults = true } = {}) {
  const source = plainObject(value);
  const output = defaults ? cloneJson(DEFAULT_READER_APPEARANCE, {}) : {};

  // An appearance object is an extension boundary. Unknown fields stay here
  // instead of disappearing during a read-modify-write cycle.
  for (const [key, item] of Object.entries(source)) {
    if (!APPEARANCE_KEYS.has(key)) output[key] = cloneJson(item, item);
  }

  const mode = cleanString(alias(source, 'mode'), 24);
  if (mode && ['single', 'double', 'scroll', 'vertical'].includes(mode)) output.mode = mode;
  const direction = alias(source, 'direction');
  if (direction === 'ltr' || direction === 'rtl') output.direction = direction;

  const font = cleanString(alias(source, 'font', 'fontFamily'), 256);
  if (font != null) output.font = font;
  const fontSize = numberIn(alias(source, 'fontSize'), 10, 72);
  if (fontSize != null) output.fontSize = fontSize;
  const lineHeight = numberIn(alias(source, 'lineHeight'), 1, 3.2);
  if (lineHeight != null) output.lineHeight = lineHeight;
  const pageWidth = numberIn(alias(source, 'pageWidth'), 0.2, 1);
  if (pageWidth != null) output.pageWidth = pageWidth;
  const theme = cleanString(alias(source, 'theme', 'readTheme'), 64);
  if (theme) output.theme = theme;
  const zoom = numberIn(alias(source, 'zoom', 'mangaZoom'), 25, 400);
  if (zoom != null) output.zoom = zoom;

  const hasSpread = own(source, 'spread')
    || ['coverSingle', 'spreadCover', 'spreadParity', 'spreadOffset', 'fit', 'fitMode'].some(key => own(source, key));
  if (defaults || hasSpread) output.spread = normalizeSpread(source, defaults);
  return output;
}

/** Normalize locator evidence while retaining future locator fields. */
export function normalizeReaderLocator(value) {
  const source = plainObject(value);
  const output = cloneJson(source, {});
  for (const key of ['chapter', 'page']) {
    if (own(source, key)) {
      const number = Number(source[key]);
      if (Number.isFinite(number)) output[key] = Math.max(0, Math.trunc(number));
      else delete output[key];
    }
  }
  for (const key of ['ratio', 'pct', 'progression']) {
    if (own(source, key)) {
      const number = numberIn(source[key], 0, 1);
      if (number != null) output[key] = number;
      else delete output[key];
    }
  }
  for (const key of ['spineItemId', 'href', 'cfi']) {
    if (own(source, key)) {
      const text = cleanString(source[key], 2048);
      if (text != null) output[key] = text; else delete output[key];
    }
  }
  return output;
}

/**
 * Split a nested v1 record or the legacy flat progress/preferences record.
 * Unknown top-level fields are returned separately and migrateReaderRecord()
 * writes them back at the same level.
 */
export function splitReaderRecord(value) {
  const source = plainObject(value);
  const appearanceSource = { ...plainObject(source.appearance) };
  const locatorSource = { ...plainObject(source.locator) };
  const unknown = {};

  for (const [key, item] of Object.entries(source)) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    if (APPEARANCE_KEYS.has(key)) {
      if (!own(appearanceSource, key)) appearanceSource[key] = item;
    } else if (LOCATOR_KEYS.has(key)) {
      if (!own(locatorSource, key)) locatorSource[key] = item;
    } else {
      unknown[key] = cloneJson(item, item);
    }
  }
  return {
    schema: SCHEMA,
    locator: normalizeReaderLocator(locatorSource),
    appearance: normalizeReaderAppearance(appearanceSource, { defaults: false }),
    unknown,
  };
}

/** Convert any supported record shape into the separated canonical envelope. */
export function migrateReaderRecord(value) {
  const split = splitReaderRecord(value);
  return {
    ...split.unknown,
    schema: SCHEMA,
    locator: split.locator,
    appearance: split.appearance,
  };
}

export function mergeReaderRecord(current, update) {
  const base = splitReaderRecord(current);
  const patch = splitReaderRecord(update);
  return {
    ...base.unknown,
    ...patch.unknown,
    schema: SCHEMA,
    locator: { ...base.locator, ...patch.locator },
    appearance: {
      ...base.appearance,
      ...patch.appearance,
      ...(base.appearance.spread || patch.appearance.spread ? {
        spread: { ...plainObject(base.appearance.spread), ...plainObject(patch.appearance.spread) },
      } : {}),
    },
  };
}

function workspaceHash(workspace) {
  return stableHash(canonicalWorkspace(workspace));
}

function bookIdentity(book) {
  if (book && typeof book === 'object') {
    const path = canonicalBookPath(book.path || book.sourcePath);
    return path || String(book.id ?? book.bookId ?? '').trim() || '@unknown-book';
  }
  const raw = String(book ?? '').trim();
  return /[\\/]|^file:/i.test(raw) ? (canonicalBookPath(raw) || '@unknown-book') : (raw || '@unknown-book');
}

export function readerWorkspacePrefsKey(workspace) {
  return `${PREFIX}.${workspaceHash(workspace)}.appearance`;
}

export function readerBookPrefsKey(workspace, book) {
  return `${PREFIX}.${workspaceHash(workspace)}.book.${stableHash(bookIdentity(book))}.appearance`;
}

export function readerPrefsKeys(workspace, book) {
  return Object.freeze({
    workspace: readerWorkspacePrefsKey(workspace),
    book: readerBookPrefsKey(workspace, book),
  });
}

function queueForKey(key, operation) {
  const previous = keyTails.get(key) || Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const tail = run.then(() => undefined, () => undefined);
  keyTails.set(key, tail);
  tail.finally(() => { if (keyTails.get(key) === tail) keyTails.delete(key); });
  return run;
}

/** Workspace defaults + per-book override store. It never persists locators. */
export class ReaderPreferencesStore {
  constructor({ invoke, workspace, book } = {}) {
    const globalInvoke = globalThis.window?.mazz?.invoke;
    this.invoke = typeof invoke === 'function'
      ? invoke
      : (typeof globalInvoke === 'function' ? globalInvoke.bind(globalThis.window.mazz) : null);
    if (!this.invoke) throw new TypeError('ReaderPreferencesStore requires an invoke function');
    this._workspaceInput = workspace;
    this.book = book;
    this.workspace = null;
    this.keys = null;
    this._initPromise = null;
    this._pending = new Set();
    this._failures = [];
  }

  async init() {
    if (this.keys) return this;
    if (!this._initPromise) {
      this._initPromise = (async () => {
        this.workspace = this._workspaceInput !== undefined
          ? this._workspaceInput
          : await this.invoke('workspace:get');
        this.keys = readerPrefsKeys(this.workspace, this.book);
        return this;
      })();
    }
    return this._initPromise;
  }

  async _get(key) {
    // A transport/storage failure is not the same thing as an absent
    // preference record.  Let load() reject so an opening candidate cannot
    // install defaults and later overwrite the user's durable appearance.
    return this.invoke('settings:get', { key });
  }

  /** Load effective appearance; legacy locator is returned but never re-saved. */
  async load({ legacyRecord } = {}) {
    await this.init();
    const [workspaceRaw, bookRaw] = await Promise.all([
      this._get(this.keys.workspace), this._get(this.keys.book),
    ]);
    const legacy = splitReaderRecord(legacyRecord);
    const workspace = splitReaderRecord(workspaceRaw);
    const book = splitReaderRecord(bookRaw);
    const appearance = normalizeReaderAppearance({
      ...legacy.appearance,
      ...workspace.appearance,
      ...book.appearance,
      spread: {
        ...plainObject(legacy.appearance.spread),
        ...plainObject(workspace.appearance.spread),
        ...plainObject(book.appearance.spread),
      },
    });
    return {
      appearance,
      locator: { ...legacy.locator, ...workspace.locator, ...book.locator },
      keys: { ...this.keys },
    };
  }

  /**
   * Persist only appearance. The patch is cloned synchronously so a controller
   * switching books after this call cannot redirect or mutate the write.
   */
  saveAppearance(patch, { scope = 'book' } = {}) {
    const snapshot = cloneJson(plainObject(patch).appearance ?? patch, {});
    const requestedScope = scope === 'workspace' ? 'workspace' : 'book';
    const job = (async () => {
      await this.init();
      const key = this.keys[requestedScope];
      return queueForKey(key, async () => {
        // A failed read is not an empty preference record.  Save paths must
        // fail closed or a transient transport error can overwrite a valid
        // envelope with defaults.
        const raw = await this.invoke('settings:get', { key });
        const current = migrateReaderRecord(raw);
        const appearancePatch = normalizeReaderAppearance(snapshot, { defaults: false });
        const next = {
          ...current,
          schema: SCHEMA,
          appearance: {
            ...plainObject(current.appearance),
            ...appearancePatch,
            ...(current.appearance?.spread || appearancePatch.spread ? {
              spread: { ...plainObject(current.appearance?.spread), ...plainObject(appearancePatch.spread) },
            } : {}),
          },
        };
        // Locator is intentionally omitted only for a brand-new preference
        // record. If a legacy value already contained one, retaining it avoids
        // destructive migration; callers receive it from load() and can move it
        // to LibraryLocatorStore at their own durability boundary.
        if (!Object.keys(plainObject(next.locator)).length) delete next.locator;
        await this.invoke('settings:set', { key, value: next });
        return { ok: true, scope: requestedScope, key, appearance: normalizeReaderAppearance(next.appearance) };
      });
    })().catch(error => ({ ok: false, scope: requestedScope, error }));
    this._pending.add(job);
    job.then(receipt => {
      if (receipt?.ok === true) {
        this._failures = this._failures.filter(failure => failure?.key !== receipt.key);
      } else if (receipt?.ok === false) this._failures.push(receipt);
    });
    job.finally(() => this._pending.delete(job));
    return job;
  }

  /** Split one legacy mixed record and move only its appearance into prefs. */
  async migrateLegacy(legacyRecord, options) {
    const split = splitReaderRecord(cloneJson(legacyRecord, {}));
    const receipt = Object.keys(split.appearance).length
      ? await this.saveAppearance(split.appearance, options)
      : { ok: true, skipped: true };
    return { locator: split.locator, appearance: normalizeReaderAppearance(split.appearance), receipt };
  }

  async flush() {
    const receipts = await Promise.all([...this._pending]);
    if (this._failures.length) {
      throw Object.assign(new Error('书库阅读外观未能持久化'), {
        code: 'LIBRARY_APPEARANCE_DURABILITY_FAILED', receipts: [...this._failures],
      });
    }
    this._failures.length = 0;
    return receipts;
  }
}

export function createReaderPreferencesStore(options) {
  return new ReaderPreferencesStore(options);
}

/** Canonical appearance -> current Library controller field aliases. */
export function appearanceForReaderController(value) {
  const appearance = normalizeReaderAppearance(value);
  return {
    mode: appearance.mode,
    direction: appearance.direction,
    fontFamily: appearance.font,
    fontSize: appearance.fontSize,
    lineHeight: appearance.lineHeight,
    pageWidth: appearance.pageWidth,
    readTheme: appearance.theme,
    mangaZoom: appearance.zoom,
    spreadCoverSingle: appearance.spread.cover,
    spreadParity: appearance.spread.parity,
    spreadFit: appearance.spread.fit,
  };
}

export const _forTests = Object.freeze({ bookIdentity, workspaceHash, cloneJson, keyTails });
