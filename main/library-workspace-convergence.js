'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const CATALOG_SCHEMA = 'mazz.library-portable-catalog/v1';
const CATALOG_FILE = '.mazz-library-catalog.json';
const SUPPORTED_EXTENSIONS = new Set(['.epub', '.pdf', '.txt', '.mobi', '.azw3', '.cbz']);
const DERIVED_DIRS = Object.freeze(['.cache', '.covers']);

function codedError(code, message, details) {
  return Object.assign(new Error(message), { code, ...(details || {}) });
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactText(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_CONVERGENCE_INVALID', `${label} 必须是原生精确字符串`);
  }
  return value;
}

function optionalText(value, label) {
  if (value === undefined || value === null || value === '') return '';
  return exactText(value, label);
}

function safeBookId(value) {
  const text = exactText(value, 'book.id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw codedError('LIBRARY_CONVERGENCE_INVALID', 'book.id 非法');
  }
  return text;
}

function safeRelativePath(value, label = 'relativePath') {
  const text = exactText(value, label);
  if (text.includes('\\') || text.startsWith('/') || /^[A-Za-z]:/.test(text)) {
    throw codedError('LIBRARY_CONVERGENCE_UNSAFE_PATH', `${label} 必须是 POSIX 相对路径`);
  }
  const parts = text.split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..'
      || /[\u0000-\u001f\u007f]/.test(part) || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      || part.includes(':'))) {
    throw codedError('LIBRARY_CONVERGENCE_UNSAFE_PATH', `${label} 含不安全路径段`);
  }
  return parts.join('/');
}

function sha256(value, label = 'sha256') {
  const text = exactText(value, label);
  if (!/^[a-f0-9]{64}$/.test(text)) throw codedError('LIBRARY_CONVERGENCE_INVALID', `${label} 非法`);
  return text;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function catalogIdOf(input) {
  const material = { ...input };
  delete material.catalogId;
  delete material.revision;
  delete material.updatedAt;
  return `catalog-sha256-${crypto.createHash('sha256').update(stableJson(material)).digest('hex')}`;
}

function normalizedMetadata(book) {
  const output = {
    id: safeBookId(book.id),
    title: optionalText(book.title, 'book.title'),
    author: optionalText(book.author, 'book.author'),
    format: exactText(String(book.format || '').toLowerCase(), 'book.format'),
    category: optionalText(book.category, 'book.category') || '未分类',
    addedAt: Number.isFinite(Number(book.addedAt)) ? Number(book.addedAt) : 0,
    lastOpenedAt: Number.isFinite(Number(book.lastOpenedAt)) ? Number(book.lastOpenedAt) : 0,
    favorite: book.favorite === true,
  };
  if (!SUPPORTED_EXTENSIONS.has(`.${output.format}`)) {
    throw codedError('LIBRARY_CONVERGENCE_UNSUPPORTED_FORMAT', `不支持的书籍格式：${output.format}`);
  }
  return output;
}

function normalizeJsonMap(value, allowedIds, label) {
  if (value === undefined || value === null) return Object.freeze({});
  if (!plain(value)) throw codedError('LIBRARY_CONVERGENCE_INVALID', `${label} 必须是普通对象`);
  const output = {};
  for (const [key, record] of Object.entries(value)) {
    if (!allowedIds.has(key)) continue;
    if (!plain(record)) throw codedError('LIBRARY_CONVERGENCE_INVALID', `${label}.${key} 必须是普通对象`);
    const encoded = JSON.stringify(record);
    if (encoded === undefined || /(?:[A-Za-z]:[\\/]|(?:^|["'])\/(?:Users|home|etc|var|private)\/)/i.test(encoded)) {
      throw codedError('LIBRARY_CONVERGENCE_PRIVATE_PATH', `${label}.${key} 不得包含绝对路径`);
    }
    output[key] = clone(record);
  }
  return Object.freeze(output);
}

function normalizeCatalog(input) {
  if (!plain(input)) throw codedError('LIBRARY_CONVERGENCE_INVALID', 'catalog 必须是普通对象');
  const allowed = new Set(['schema', 'catalogId', 'revision', 'updatedAt', 'books', 'categories', 'progress', 'bookmarks']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw codedError('LIBRARY_CONVERGENCE_INVALID', 'catalog 含未知字段');
  if (input.schema !== CATALOG_SCHEMA) throw codedError('LIBRARY_CONVERGENCE_INVALID', 'catalog schema 非法');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw codedError('LIBRARY_CONVERGENCE_INVALID', 'catalog revision 非法');
  const timestamp = Date.parse(exactText(input.updatedAt, 'updatedAt'));
  if (!Number.isFinite(timestamp)) throw codedError('LIBRARY_CONVERGENCE_INVALID', 'updatedAt 非法');
  if (!Array.isArray(input.books)) throw codedError('LIBRARY_CONVERGENCE_INVALID', 'books 必须是数组');
  const ids = new Set();
  const paths = new Set();
  const books = input.books.map((book, index) => {
    if (!plain(book)) throw codedError('LIBRARY_CONVERGENCE_INVALID', `books[${index}] 必须是普通对象`);
    const allowedBook = new Set(['id', 'title', 'author', 'format', 'category', 'addedAt', 'lastOpenedAt', 'favorite', 'relativePath', 'sha256']);
    if (Object.keys(book).some(key => !allowedBook.has(key))) throw codedError('LIBRARY_CONVERGENCE_INVALID', `books[${index}] 含未知字段`);
    const metadata = normalizedMetadata(book);
    const relativePath = safeRelativePath(book.relativePath, `books[${index}].relativePath`);
    const digest = sha256(book.sha256, `books[${index}].sha256`);
    if (ids.has(metadata.id)) throw codedError('LIBRARY_CONVERGENCE_DUPLICATE', 'catalog 含重复 bookId');
    if (paths.has(relativePath.toLocaleLowerCase('en-US'))) throw codedError('LIBRARY_CONVERGENCE_DUPLICATE', 'catalog 含重复路径');
    ids.add(metadata.id);
    paths.add(relativePath.toLocaleLowerCase('en-US'));
    return Object.freeze({ ...metadata, relativePath, sha256: digest });
  }).sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const categories = Array.isArray(input.categories)
    ? [...new Set(input.categories.map((value, index) => exactText(value, `categories[${index}]`)))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    : (() => { throw codedError('LIBRARY_CONVERGENCE_INVALID', 'categories 必须是数组'); })();
  const normalized = {
    schema: CATALOG_SCHEMA,
    catalogId: exactText(input.catalogId, 'catalogId'),
    revision: input.revision,
    updatedAt: new Date(timestamp).toISOString(),
    books: Object.freeze(books),
    categories: Object.freeze(categories),
    progress: normalizeJsonMap(input.progress, ids, 'progress'),
    bookmarks: normalizeJsonMap(input.bookmarks, ids, 'bookmarks'),
  };
  if (normalized.catalogId !== catalogIdOf(normalized)) throw codedError('LIBRARY_CONVERGENCE_CATALOG_MISMATCH', 'catalogId 与内容不匹配');
  return Object.freeze(normalized);
}

function canonicalWorkspace(fsImpl, workspacePath) {
  const requested = path.resolve(exactText(workspacePath, 'workspacePath'));
  const native = fsImpl.realpathSync?.native;
  const physical = path.resolve(typeof native === 'function' ? native(requested) : fsImpl.realpathSync(requested));
  const stat = fsImpl.lstatSync(physical);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw codedError('LIBRARY_CONVERGENCE_UNSAFE_WORKSPACE', 'Workspace 必须是物理目录');
  return physical;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32'
    ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b;
}

function inside(root, target) {
  const base = path.resolve(root);
  const candidate = path.resolve(target);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  return samePath(candidate, base) || (process.platform === 'win32'
    ? candidate.toLocaleLowerCase('en-US').startsWith(prefix.toLocaleLowerCase('en-US'))
    : candidate.startsWith(prefix));
}

async function digestFile(fsImpl, filePath, signal) {
  if (signal?.aborted) throw signal.reason || codedError('ABORT_ERR', '操作已取消');
  const before = fsImpl.lstatSync(filePath);
  if (!before.isFile() || before.isSymbolicLink()) throw codedError('LIBRARY_CONVERGENCE_UNSAFE_PATH', '资产必须是物理 regular file');
  const hash = crypto.createHash('sha256');
  const stream = fsImpl.createReadStream(filePath);
  const abort = () => stream.destroy(signal.reason || codedError('ABORT_ERR', '操作已取消'));
  signal?.addEventListener?.('abort', abort, { once: true });
  try {
    for await (const chunk of stream) hash.update(chunk);
  } finally {
    signal?.removeEventListener?.('abort', abort);
  }
  const after = fsImpl.lstatSync(filePath);
  if (!after.isFile() || after.isSymbolicLink()
      || String(before.dev) !== String(after.dev) || String(before.ino) !== String(after.ino)
      || Number(before.size) !== Number(after.size)
      || Number(before.mtimeMs) !== Number(after.mtimeMs)) {
    throw codedError('LIBRARY_CONVERGENCE_ASSET_CHANGED', '资产在哈希期间发生变化');
  }
  return Object.freeze({ sha256: hash.digest('hex'), size: Number(after.size), stat: after });
}

function catalogPathOf(workspace) {
  return path.join(workspace, '书库', CATALOG_FILE);
}

class LibraryWorkspaceConvergenceService {
  constructor({ fsImpl = fs, now = () => new Date(), randomId = () => crypto.randomBytes(10).toString('hex') } = {}) {
    this.fs = fsImpl;
    this.now = now;
    this.randomId = randomId;
    this.gcPlans = new Map();
  }

  _roots(workspacePath) {
    const workspace = canonicalWorkspace(this.fs, workspacePath);
    const library = path.join(workspace, '书库');
    if (!this.fs.existsSync(library)) this.fs.mkdirSync(library, { recursive: false });
    const stat = this.fs.lstatSync(library);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw codedError('LIBRARY_CONVERGENCE_UNSAFE_LAYOUT', '书库必须是物理目录');
    return Object.freeze({ workspace, library, catalog: catalogPathOf(workspace) });
  }

  _fsyncDirectory(directory) {
    let fd;
    let primary = null;
    try {
      fd = this.fs.openSync(directory, 'r');
      this.fs.fsyncSync(fd);
    } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)
          && !(process.platform === 'win32' && error?.code === 'EPERM')) primary = error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch (error) { if (primary) primary.cleanupError = error; else primary = error; }
      }
    }
    if (primary) throw primary;
  }

  async _snapshotCatalog(roots, snapshot, previousRevision = 0, signal) {
    if (!plain(snapshot) || !Array.isArray(snapshot.books)) throw codedError('LIBRARY_CONVERGENCE_INVALID', 'snapshot 非法');
    const books = [];
    for (const [index, book] of snapshot.books.entries()) {
      if (!plain(book)) throw codedError('LIBRARY_CONVERGENCE_INVALID', `books[${index}] 非法`);
      const filePath = path.resolve(exactText(book.path, `books[${index}].path`));
      if (!inside(roots.workspace, filePath)) continue;
      const relativePath = path.relative(roots.workspace, filePath).split(path.sep).join('/');
      safeRelativePath(relativePath);
      const digest = await digestFile(this.fs, filePath, signal);
      books.push({ ...normalizedMetadata(book), relativePath, sha256: digest.sha256 });
    }
    const ids = new Set(books.map(book => book.id));
    books.sort((left, right) => left.id.localeCompare(right.id, 'en'));
    const categories = Array.isArray(snapshot.categories)
      ? [...new Set(snapshot.categories.map((value, index) => exactText(value, `categories[${index}]`)))]
        .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
      : [];
    const base = {
      schema: CATALOG_SCHEMA,
      revision: previousRevision + 1,
      updatedAt: new Date(this.now()).toISOString(),
      books,
      categories,
      progress: normalizeJsonMap(snapshot.progress, ids, 'progress'),
      bookmarks: normalizeJsonMap(snapshot.bookmarks, ids, 'bookmarks'),
    };
    return normalizeCatalog({ ...base, catalogId: catalogIdOf(base) });
  }

  _read(roots) {
    if (!this.fs.existsSync(roots.catalog)) return null;
    const stat = this.fs.lstatSync(roots.catalog);
    if (!stat.isFile() || stat.isSymbolicLink()) throw codedError('LIBRARY_CONVERGENCE_CATALOG_CORRUPT', 'portable catalog 非普通文件');
    try { return normalizeCatalog(JSON.parse(this.fs.readFileSync(roots.catalog, 'utf8'))); }
    catch (error) {
      if (error?.code) throw error;
      throw codedError('LIBRARY_CONVERGENCE_CATALOG_CORRUPT', 'portable catalog 损坏', { cause: error });
    }
  }

  _write(roots, catalog) {
    const temporary = path.join(roots.library, `.${CATALOG_FILE}.${this.randomId()}.tmp`);
    let fd;
    let primary = null;
    try {
      fd = this.fs.openSync(temporary, 'wx', 0o600);
      this.fs.writeFileSync(fd, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
      this.fs.fsyncSync(fd);
      this.fs.closeSync(fd);
      fd = undefined;
      this.fs.renameSync(temporary, roots.catalog);
      this._fsyncDirectory(roots.library);
    } catch (error) {
      primary = error;
      throw error;
    } finally {
      if (fd !== undefined) {
        try { this.fs.closeSync(fd); } catch (error) { if (primary) primary.cleanupError = error; else throw error; }
      }
      try { this.fs.unlinkSync(temporary); } catch (error) {
        if (error.code !== 'ENOENT') { if (primary) primary.cleanupError = error; else throw error; }
      }
    }
  }

  async save(workspacePath, snapshot, { signal } = {}) {
    const roots = this._roots(workspacePath);
    const previous = this._read(roots);
    const catalog = await this._snapshotCatalog(roots, snapshot, previous?.revision || 0, signal);
    this._write(roots, catalog);
    return clone(catalog);
  }

  async _scanAssets(roots, signal) {
    const files = [];
    const walk = async directory => {
      for (const entry of this.fs.readdirSync(directory, { withFileTypes: true })) {
        if (signal?.aborted) throw signal.reason || codedError('ABORT_ERR', '操作已取消');
        if (entry.name.startsWith('.')) continue;
        const target = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw codedError('LIBRARY_CONVERGENCE_UNSAFE_LAYOUT', '书库资产目录含符号链接');
        if (entry.isDirectory()) await walk(target);
        else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(target);
      }
    };
    await walk(roots.library);
    const indexed = new Map();
    for (const filePath of files) {
      const digest = await digestFile(this.fs, filePath, signal);
      const list = indexed.get(digest.sha256) || [];
      list.push(filePath);
      indexed.set(digest.sha256, list);
    }
    return indexed;
  }

  async rebuild(workspacePath, { signal } = {}) {
    const roots = this._roots(workspacePath);
    const catalog = this._read(roots);
    const index = await this._scanAssets(roots, signal);
    if (!catalog) {
      const books = [];
      for (const [digest, filePaths] of index) {
        for (const filePath of filePaths) {
          const format = path.extname(filePath).slice(1).toLowerCase();
          books.push({
            id: `blob-sha256-${digest}`,
            title: path.basename(filePath, path.extname(filePath)), author: '', format, category: '未分类',
            addedAt: 0, lastOpenedAt: 0, favorite: false,
            path: filePath, sourcePath: filePath, sourceHash: digest, missing: false,
          });
        }
      }
      return Object.freeze({ authority: 'main-process-library-convergence', source: 'scan', catalog: null,
        books: Object.freeze(books), categories: [], progress: {}, bookmarks: {}, missing: 0, ambiguous: 0 });
    }
    let missing = 0;
    let ambiguous = 0;
    const books = [];
    for (const book of catalog.books) {
      const expected = path.resolve(roots.workspace, ...book.relativePath.split('/'));
      let matches = [];
      if (inside(roots.workspace, expected) && this.fs.existsSync(expected)) {
        const digest = await digestFile(this.fs, expected, signal);
        if (digest.sha256 === book.sha256) matches = [expected];
      }
      if (!matches.length) matches = [...(index.get(book.sha256) || [])];
      const conflict = matches.length > 1;
      const absent = matches.length === 0;
      if (absent) missing++;
      if (conflict) ambiguous++;
      const selected = matches.length === 1 ? matches[0] : expected;
      books.push({
        id: book.id, title: book.title, author: book.author, format: book.format, category: book.category,
        addedAt: book.addedAt, lastOpenedAt: book.lastOpenedAt, favorite: book.favorite,
        path: selected, sourcePath: selected, sourceHash: book.sha256,
        missing: absent || conflict, ...(conflict ? { repairConflict: true } : {}),
      });
    }
    return Object.freeze({ authority: 'main-process-library-convergence', source: 'catalog', catalogId: catalog.catalogId, revision: catalog.revision,
      books: Object.freeze(books), categories: clone(catalog.categories), progress: clone(catalog.progress),
      bookmarks: clone(catalog.bookmarks), missing, ambiguous });
  }

  planDerivedCacheGc(workspacePath, liveBookIds) {
    const roots = this._roots(workspacePath);
    if (!Array.isArray(liveBookIds)) throw codedError('LIBRARY_CONVERGENCE_INVALID', 'liveBookIds 必须是数组');
    const live = new Set(liveBookIds.map(safeBookId));
    const entries = [];
    for (const directoryName of DERIVED_DIRS) {
      const directory = path.join(roots.library, directoryName);
      if (!this.fs.existsSync(directory)) continue;
      const stat = this.fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw codedError('LIBRARY_CONVERGENCE_UNSAFE_LAYOUT', `${directoryName} 非物理目录`);
      for (const entry of this.fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink()) throw codedError('LIBRARY_CONVERGENCE_UNSAFE_LAYOUT', `${directoryName} 含非普通文件`);
        const ownerId = entry.name.replace(/\.[^.]+$/, '');
        if (!live.has(ownerId)) entries.push(Object.freeze({ relativePath: `${directoryName}/${safeRelativePath(entry.name, 'cache file')}`, ownerId }));
      }
    }
    const planId = `gc-${crypto.createHash('sha256').update(stableJson({ workspace: roots.workspace, entries })).digest('hex')}`;
    const plan = Object.freeze({ planId, workspace: roots.workspace, entries: Object.freeze(entries), createdAt: new Date(this.now()).toISOString() });
    this.gcPlans.set(planId, plan);
    return clone(plan);
  }

  commitDerivedCacheGc(workspacePath, planId, liveBookIds) {
    const roots = this._roots(workspacePath);
    const id = exactText(planId, 'planId');
    const plan = this.gcPlans.get(id);
    if (!plan || !samePath(plan.workspace, roots.workspace)) throw codedError('LIBRARY_CONVERGENCE_GC_STALE', 'GC plan 不存在或 Workspace 已变化');
    const fresh = this.planDerivedCacheGc(roots.workspace, liveBookIds);
    if (fresh.planId !== id || stableJson(fresh.entries) !== stableJson(plan.entries)) {
      this.gcPlans.delete(id);
      throw codedError('LIBRARY_CONVERGENCE_GC_STALE', 'GC 引用已变化，请重新规划');
    }
    const deleted = [];
    for (const entry of plan.entries) {
      const target = path.resolve(roots.library, ...entry.relativePath.split('/'));
      if (!inside(roots.library, target)) throw codedError('LIBRARY_CONVERGENCE_UNSAFE_PATH', 'GC 路径越界');
      const stat = this.fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw codedError('LIBRARY_CONVERGENCE_GC_STALE', 'GC 文件已变化');
      this.fs.unlinkSync(target);
      deleted.push(entry.relativePath);
    }
    this.gcPlans.delete(id);
    return Object.freeze({ planId: id, deleted: Object.freeze(deleted) });
  }

  openReadableAsset(workspacePath, relativePath) {
    const roots = this._roots(workspacePath);
    const relative = safeRelativePath(relativePath);
    const target = path.resolve(roots.workspace, ...relative.split('/'));
    if (!inside(roots.workspace, target)) throw codedError('LIBRARY_CONVERGENCE_UNSAFE_PATH', 'ReadableAsset 越界');
    const stat = this.fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw codedError('LIBRARY_CONVERGENCE_ASSET_MISSING', 'ReadableAsset 不存在');
    const identity = Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), size: Number(stat.size), mtimeMs: Number(stat.mtimeMs) });
    const assertStable = () => {
      const current = this.fs.lstatSync(target);
      if (!current.isFile() || current.isSymbolicLink() || String(current.dev) !== identity.dev
          || String(current.ino) !== identity.ino || Number(current.size) !== identity.size
          || Number(current.mtimeMs) !== identity.mtimeMs) {
        throw codedError('LIBRARY_CONVERGENCE_ASSET_CHANGED', 'ReadableAsset owner 已变化');
      }
      return current;
    };
    return Object.freeze({
      path: target, relativePath: relative, size: identity.size,
      stat: () => ({ size: identity.size, mtimeMs: identity.mtimeMs }),
      createResponse: ({ range = '', method = 'GET' } = {}) => {
        assertStable();
        const parsed = parseByteRange(range, identity.size);
        const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'application/pdf' };
        if (parsed?.invalid) return { status: 416, headers: { ...headers, 'Content-Range': `bytes */${identity.size}`, 'Content-Length': '0' }, body: null };
        const start = parsed ? parsed.start : 0;
        const end = parsed ? parsed.end : Math.max(0, identity.size - 1);
        const length = identity.size === 0 ? 0 : end - start + 1;
        const status = parsed ? 206 : 200;
        if (parsed) headers['Content-Range'] = `bytes ${start}-${end}/${identity.size}`;
        headers['Content-Length'] = String(length);
        if (method === 'HEAD' || !length) return { status, headers, body: null };
        const body = this.fs.createReadStream(target, { start, end });
        body.once('open', assertStable);
        return { status, headers, body };
      },
    });
  }

  snapshot() {
    return Object.freeze({ gcPlanCount: this.gcPlans.size, timerCount: 0, listenerCount: 0, networkOwnerCount: 0 });
  }
}

function parseByteRange(value, size) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isSafeInteger(size) || size < 0) return { invalid: true };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return { invalid: true };
    end = Math.min(end, size - 1);
  }
  return Object.freeze({ start, end });
}

module.exports = {
  CATALOG_SCHEMA,
  CATALOG_FILE,
  SUPPORTED_EXTENSIONS,
  DERIVED_DIRS,
  LibraryWorkspaceConvergenceService,
  normalizeCatalog,
  safeRelativePath,
  parseByteRange,
  digestFile,
  catalogIdOf,
};
