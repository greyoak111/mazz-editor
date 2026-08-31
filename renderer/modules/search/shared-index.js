// renderer/modules/search/shared-index.js —— W62c 外壳/搜索可共享的全文索引读侧
import { SearchIndex, isIndexablePath, listTextFiles } from './indexer.js';

export const sharedSearchIndex = new SearchIndex();
let ready = false;
let building = null;

export async function ensureSharedSearchIndex({ force = false } = {}) {
  if (building) return building;
  if (ready && !force) return sharedSearchIndex;
  building = (async () => {
    const files = await listTextFiles();
    await sharedSearchIndex.reconcile(files, { force });
    ready = true;
    return sharedSearchIndex;
  })().finally(() => { building = null; });
  return building;
}

export async function refreshSharedIndexFile(path) {
  if (!ready || !path) return;
  if (!isIndexablePath(path)) return;
  await sharedSearchIndex.updateFile(path);
}

export async function removeSharedIndexPath(path) {
  if (!ready || !path) return;
  const root = String(path).replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = root + '/';
  for (const key of [...sharedSearchIndex.mem.keys()]) {
    const normalized = String(key).replace(/\\/g, '/');
    if (normalized === root || normalized.startsWith(prefix)) {
      sharedSearchIndex.mem.delete(key);
      await sharedSearchIndex.store.delete(key).catch(() => {});
    }
  }
}

export function invalidateSharedSearchIndex() { ready = false; }
