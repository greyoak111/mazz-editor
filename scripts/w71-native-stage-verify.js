// scripts/w71-native-stage-verify.js —— 临时移出明确外平台 .node，跑 packaged smoke，随后逐字节恢复
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { auditNative } = require('./w71-native-audit');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_ROOT = path.resolve(ROOT, 'release');
const PACKAGED_ROOT = path.resolve(RELEASE_ROOT, 'win-unpacked', 'resources', 'app.asar.unpacked');
const BACKUP_ROOT = path.resolve(RELEASE_ROOT, '.w71-native-stage-backup');

function assertInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`路径越界或与根重合：${child}`);
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  if (!fs.existsSync(PACKAGED_ROOT)) throw new Error(`packaged specimen 不存在：${PACKAGED_ROOT}`);
  assertInside(RELEASE_ROOT, PACKAGED_ROOT);
  assertInside(RELEASE_ROOT, BACKUP_ROOT);
  if (fs.existsSync(BACKUP_ROOT)) throw new Error(`发现上次未收口的 staging 备份，请先恢复：${BACKUP_ROOT}`);

  const report = auditNative();
  const candidates = report.packaged.files.filter(row => row.status === 'foreign').map(row => {
    const source = path.resolve(ROOT, row.path);
    assertInside(PACKAGED_ROOT, source);
    if (!fs.existsSync(source)) throw new Error(`候选文件不存在：${source}`);
    const relative = path.relative(PACKAGED_ROOT, source);
    const backup = path.resolve(BACKUP_ROOT, relative);
    assertInside(BACKUP_ROOT, backup);
    return { source, backup, relative, hash: sha256(source) };
  });
  if (!candidates.length) throw new Error('没有明确外平台候选，拒绝运行空 staging');

  let testStatus = 1;
  let restoreError = null;
  try {
    for (const item of candidates) {
      fs.mkdirSync(path.dirname(item.backup), { recursive: true });
      fs.renameSync(item.source, item.backup);
    }
    const result = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'e2e', 'w71-packaged-smoke.mjs')], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, MAZZ_W71_NATIVE_STAGE: '1' },
    });
    testStatus = result.status ?? 1;
  } finally {
    try {
      for (const item of [...candidates].reverse()) {
        if (!fs.existsSync(item.backup)) throw new Error(`staging 备份丢失：${item.backup}`);
        fs.mkdirSync(path.dirname(item.source), { recursive: true });
        fs.renameSync(item.backup, item.source);
        if (sha256(item.source) !== item.hash) throw new Error(`恢复后哈希不一致：${item.relative}`);
      }
      assertInside(RELEASE_ROOT, BACKUP_ROOT);
      fs.rmSync(BACKUP_ROOT, { recursive: true, force: true });
    } catch (error) {
      restoreError = error;
    }
  }
  if (restoreError) throw restoreError;
  if (testStatus !== 0) process.exit(testStatus);
  console.log(JSON.stringify({ ok: true, removedDuringProbe: candidates.length, restored: candidates.length }));
}

if (require.main === module) main();

module.exports = { assertInside, sha256 };
