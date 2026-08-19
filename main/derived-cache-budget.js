'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AUDCACHE_POLICY = Object.freeze({ maxFiles: 64, maxBytes: 2 * 1024 * 1024 * 1024, maxAgeMs: 30 * 86400_000 });

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pruneDerivedCache(root, { maxFiles, maxBytes, maxAgeMs, preserve = '', fsApi = fs, now = Date.now() } = {}) {
  const resolvedRoot = path.resolve(root);
  if (path.basename(resolvedRoot) !== '.audcache') throw new Error('仅允许轮转 .audcache 派生缓存');
  const preserved = preserve ? path.resolve(preserve) : '';
  if (preserved && !isInside(resolvedRoot, preserved)) throw new Error('preserve 越出派生缓存目录');
  let entries = [];
  try {
    entries = fsApi.readdirSync(resolvedRoot, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
      const filePath = path.join(resolvedRoot, entry.name);
      const stat = fsApi.statSync(filePath);
      return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
    }).sort((left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath));
  } catch { return { scanned: 0, removed: 0, removedBytes: 0, remaining: 0, remainingBytes: 0 }; }
  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  let removed = 0;
  let removedBytes = 0;
  for (const entry of entries) {
    if (entry.filePath === preserved) continue;
    const expired = Number(maxAgeMs) > 0 && now - entry.mtimeMs > Number(maxAgeMs);
    const overCount = Number(maxFiles) >= 0 && entries.length - removed > Number(maxFiles);
    const overBytes = Number(maxBytes) >= 0 && totalBytes > Number(maxBytes);
    if (!expired && !overCount && !overBytes) continue;
    try {
      fsApi.unlinkSync(entry.filePath);
      removed += 1;
      removedBytes += entry.size;
      totalBytes -= entry.size;
    } catch {}
  }
  return { scanned: entries.length, removed, removedBytes, remaining: entries.length - removed, remainingBytes: totalBytes };
}

module.exports = { AUDCACHE_POLICY, isInside, pruneDerivedCache };
