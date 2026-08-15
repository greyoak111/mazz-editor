// scripts/release-audit.js —— W71 发布物基线：只盘点，不删除开发资产
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const slash = value => String(value).replace(/\\/g, '/');

function walk(dir, accept = () => true) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) stack.push(full);
      else if (item.isFile() && accept(full)) out.push(full);
    }
  }
  return out.sort();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function fileRecord(file) {
  const stat = fs.statSync(file);
  return { path: slash(path.relative(ROOT, file)), bytes: stat.size };
}

function lockedPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const packages = [];
  for (const [location, meta] of Object.entries(lock.packages || {})) {
    if (!location || !location.startsWith('node_modules/')) continue;
    let diskMeta = {};
    try { diskMeta = JSON.parse(fs.readFileSync(path.join(ROOT, location, 'package.json'), 'utf8')); } catch {}
    const legacyLicenses = Array.isArray(diskMeta.licenses)
      ? diskMeta.licenses.map(item => typeof item === 'string' ? item : item?.type).filter(Boolean).join(' OR ')
      : '';
    let licenseFiles = [];
    try {
      licenseFiles = fs.readdirSync(path.join(ROOT, location))
        .filter(name => /^(?:licen[cs]e|copying|copyright)(?:\.|$)/i.test(name));
    } catch {}
    packages.push({
      name: location.slice('node_modules/'.length),
      version: String(meta.version || ''),
      license: String(meta.license || diskMeta.license || legacyLicenses || ''),
      licenseFiles,
      optional: !!meta.optional,
      dev: !!meta.dev,
    });
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

function packagedSpecimen() {
  const releaseDir = path.join(ROOT, 'release');
  const unpackedDir = path.join(releaseDir, 'win-unpacked');
  const asarFile = path.join(unpackedDir, 'resources', 'app.asar');
  const asarUnpackedDir = path.join(unpackedDir, 'resources', 'app.asar.unpacked');
  const installer = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir).find(name => / Setup .*\.exe$/i.test(name))
    : null;
  const unpackedFiles = walk(unpackedDir).map(fileRecord);
  const unpackedNative = walk(asarUnpackedDir, file => file.endsWith('.node')).map(fileRecord);
  let asar = { present: false, bytes: 0, entries: 0, sourceMaps: 0, rootNotices: [] };
  if (fs.existsSync(asarFile)) {
    const record = fileRecord(asarFile);
    try {
      const { listPackage } = require('@electron/asar');
      const entries = listPackage(asarFile);
      asar = {
        present: true, bytes: record.bytes, entries: entries.length,
        sourceMaps: entries.filter(name => name.endsWith('.map')).length,
        rootNotices: entries.filter(name => /^\\(?:LICENSE|NOTICE|THIRD_PARTY_NOTICES\.md)$/.test(name)),
      };
    } catch (error) {
      asar = { present: true, bytes: record.bytes, entries: 0, sourceMaps: null, rootNotices: [], auditError: error.message };
    }
  }
  const installerFile = installer ? path.join(releaseDir, installer) : '';
  return {
    present: fs.existsSync(unpackedDir),
    unpacked: { count: unpackedFiles.length, bytes: unpackedFiles.reduce((n, row) => n + row.bytes, 0) },
    asar,
    asarUnpackedNative: { count: unpackedNative.length, bytes: unpackedNative.reduce((n, row) => n + row.bytes, 0), files: unpackedNative },
    installer: installerFile && fs.existsSync(installerFile)
      ? { ...fileRecord(installerFile), sha256: sha256(installerFile) }
      : { present: false },
  };
}

function auditRelease() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const sourceMaps = walk(path.join(ROOT, 'renderer', 'dist'), file => file.endsWith('.map')).map(fileRecord);
  const nativeBinaries = walk(path.join(ROOT, 'node_modules'), file => file.endsWith('.node')).map(fileRecord);
  const vendoredFfmpeg = walk(path.join(ROOT, 'renderer', 'vendor', 'ffmpeg'), file => !file.endsWith('.md'))
    .map(file => ({ ...fileRecord(file), sha256: sha256(file) }));
  const locked = lockedPackages();
  const sum = rows => rows.reduce((total, row) => total + row.bytes, 0);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: { name: pkg.name, version: pkg.version, license: pkg.license },
    build: {
      output: pkg.build?.directories?.output || '',
      npmRebuild: pkg.build?.npmRebuild,
      asarUnpack: pkg.build?.asarUnpack || [],
      files: pkg.build?.files || [],
    },
    licenses: {
      root: ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'].map(name => ({ name, present: fs.existsSync(path.join(ROOT, name)) })),
      lockedPackageCount: locked.length,
      missingDeclaredLicense: locked.filter(item => !item.license),
      packages: locked,
    },
    rendererSourceMaps: { count: sourceMaps.length, bytes: sum(sourceMaps), files: sourceMaps },
    nativeBinaries: { count: nativeBinaries.length, bytes: sum(nativeBinaries), files: nativeBinaries },
    vendoredFfmpeg: { count: vendoredFfmpeg.length, bytes: sum(vendoredFfmpeg), files: vendoredFfmpeg },
    packagedSpecimen: packagedSpecimen(),
  };
}

function main() {
  const report = auditRelease();
  const index = process.argv.indexOf('--out');
  if (index >= 0 && process.argv[index + 1]) {
    const target = path.resolve(ROOT, process.argv[index + 1]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
    console.log(slash(path.relative(ROOT, target)));
  } else {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
}

if (require.main === module) main();

module.exports = { auditRelease, lockedPackages, packagedSpecimen, sha256, walk };
