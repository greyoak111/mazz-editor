// renderer/modules/search/indexer.js —— 全局搜索索引器：IndexedDB 全文索引 + 增量重建 + 正则/类型过滤

const DB_NAME = 'mazz-search';
const STORE = 'files';

// ==================== IndexedDB 适配器 ====================
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'path' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out?._result);
    t.onerror = () => reject(t.error);
  });
}

export function createIdbStore() {
  return {
    async getAll() {
      const db = await openDb();
      return tx(db, 'readonly', (s) => {
        const req = s.getAll();
        req.onsuccess = () => { req._result = req.result; };
        return req;
      });
    },
    async put(entry) {
      const db = await openDb();
      return tx(db, 'readwrite', (s) => s.put(entry));
    },
    async delete(path) {
      const db = await openDb();
      return tx(db, 'readwrite', (s) => s.delete(path));
    },
    async clear() {
      const db = await openDb();
      return tx(db, 'readwrite', (s) => s.clear());
    },
  };
}

/** 内存适配器（测试/无 IDB 环境降级） */
export function createMemoryStore() {
  const map = new Map();
  return {
    getAll: async () => [...map.values()],
    put: async (e) => { map.set(e.path, e); },
    delete: async (p) => { map.delete(p); },
    clear: async () => map.clear(),
  };
}

// ==================== 文本类型分组 ====================
export const TYPE_GROUPS = {
  all: null,
  doc: ['.md', '.txt', '.markdown'],
  sheet: ['.csv', '.tsv'],
  code: ['.js', '.ts', '.py', '.json', '.css', '.html', '.java', '.c', '.cpp', '.h', '.sh', '.mazzcode'],
};
const INDEXABLE = new Set(['.md', '.txt', '.markdown', '.csv', '.tsv', '.js', '.ts', '.py', '.json', '.css', '.html', '.java', '.c', '.cpp', '.h', '.sh', '.mazzcode']);

function extOf(p) {
  const m = /\.[a-z0-9]+$/i.exec(p);
  return m ? m[0].toLowerCase() : '';
}

/** 递归列出工作区可索引文本文件 */
export async function listTextFiles() {
  const ws = await window.mazz.invoke('workspace:get');
  const out = [];
  async function walk(dir, depth) {
    if (depth > 7) return;
    let entries = [];
    try { entries = (await window.mazz.invoke('fs:listDir', { path: dir })) || []; } catch { return; }
    for (const e of entries) {
      if (e.isDir) {
        if (!e.name.startsWith('.') && e.name !== 'node_modules') await walk(e.path, depth + 1);
      } else if (INDEXABLE.has(extOf(e.name))) {
        out.push({ path: e.path, name: e.name, ext: extOf(e.name) });
      }
    }
  }
  await walk(ws, 0);
  return out;
}

// ==================== 索引器 ====================
export class SearchIndex {
  constructor(store) {
    this.store = store || (typeof indexedDB !== 'undefined' ? createIdbStore() : createMemoryStore());
    this.mem = new Map(); // path -> {path, name, ext, content, updatedAt}
    this.loaded = false;
  }

  async load() {
    const all = await this.store.getAll().catch(() => []);
    for (const e of all) this.mem.set(e.path, e);
    this.loaded = true;
  }

  /** 与磁盘对账：新文件入库、失踪文件移除；force 时全量重读 */
  async reconcile(files, { force = false } = {}) {
    if (!this.loaded) await this.load();
    const seen = new Set(files.map(f => f.path));
    for (const p of [...this.mem.keys()]) {
      if (!seen.has(p)) { this.mem.delete(p); await this.store.delete(p).catch(() => {}); }
    }
    for (const f of files) {
      if (force || !this.mem.has(f.path)) await this.updateFile(f.path);
    }
    return this.mem.size;
  }

  async updateFile(path) {
    let content = '';
    try { content = (await window.mazz.invoke('fs:readFile', { path })) || ''; }
    catch { return; }
    if (content.length > 2_000_000) return; // 超大文件不索引
    const name = path.replace(/[\\/]/g, '/').split('/').pop();
    const entry = { path, name, ext: extOf(name), content, updatedAt: Date.now() };
    this.mem.set(path, entry);
    await this.store.put(entry).catch(() => {});
  }

  /** 查询：普通（contains）/正则；返回按文件分组的命中 */
  query(q, { regex = false, caseSensitive = false, type = 'all', maxFileHits = 3, maxFiles = 100 } = {}) {
    if (!q && !regex) return { results: [], total: 0 };
    let matcher;
    try {
      matcher = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
    } catch (e) {
      return { error: '正则表达式无效：' + e.message, results: [], total: 0 };
    }
    const exts = TYPE_GROUPS[type] || null;
    const results = [];
    let total = 0;
    for (const e of this.mem.values()) {
      if (exts && !exts.includes(e.ext)) continue;
      const lines = e.content.split('\n');
      const hits = [];
      for (let i = 0; i < lines.length && hits.length < maxFileHits; i++) {
        matcher.lastIndex = 0;
        if (matcher.test(lines[i])) {
          hits.push({ ln: i + 1, text: lines[i].slice(0, 300) });
          total++;
        }
      }
      if (hits.length) results.push({ path: e.path, name: e.name, hits });
      if (results.length >= maxFiles) break;
    }
    return { results, total };
  }
}

/** 行文本高亮（转义 HTML 后包 <mark>） */
export function highlightLine(text, q, { regex = false, caseSensitive = false } = {}) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let re;
  try {
    re = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  } catch { return esc(text); }
  let out = '', last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}
