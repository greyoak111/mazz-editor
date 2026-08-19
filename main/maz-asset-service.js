'use strict';

const fs = require('fs');
const path = require('path');
const { LIMITS, inspectMazBytes, migrateLegacyStyle } = require('./foundation/maz-production-asset');

function readBounded(file) {
  const target = path.resolve(String(file || ''));
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('.maz 必须是普通文件');
  if (stat.size > LIMITS.packageBytes) throw new Error('.maz 包超过 64 MiB');
  return { target, bytes: fs.readFileSync(target) };
}

class MazAssetService {
  constructor({ bus }) {
    bus.handle('mazAsset:inspect', async ({ path: file }) => {
      const { target, bytes } = readBounded(file);
      return { path: target, ...(await inspectMazBytes(bytes)) };
    });
    bus.handle('mazAsset:migrateStyle', async ({ path: file, destination, semanticId, version, authorityRef }) => {
      if (!String(authorityRef || '').startsWith('human:')) throw new Error('.maz migration 需要 human Authority');
      const { bytes } = readBounded(file);
      const target = path.resolve(String(destination || ''));
      if (fs.existsSync(target)) throw new Error('迁移目标已存在，拒绝覆盖');
      const result = await migrateLegacyStyle(bytes, { semanticId, version });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(temp, result.output, { flag: 'wx' });
      fs.renameSync(temp, target);
      return { path: target, bytes: result.output.length, preview: result.preview, originalOverwritten: false };
    });
  }
}

module.exports = { MazAssetService, readBounded };
