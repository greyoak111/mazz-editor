// scripts/release-audit.js —— W71 发布物基线：只盘点，不删除开发资产
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const slash = value => String(value).replace(/\\/g, '/');
const ARCHIVE_PACKAGE = '7zip-bin-full';
const ARCHIVE_MANUAL = 'docs/engineering/OSS_PROVENANCE_MANUAL.json';

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

function absoluteFileEvidence(file, displayPath, expectedSha256 = '') {
  const expected = String(expectedSha256 || '').toUpperCase();
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    return { path: slash(displayPath), present: false, expectedSha256: expected };
  }
  const actual = sha256(file);
  return {
    path: slash(displayPath),
    present: true,
    bytes: fs.statSync(file).size,
    sha256: actual,
    expectedSha256: expected,
    matchesExpected: !!expected && actual === expected,
  };
}

function archiveRuntimePolicy() {
  try {
    const manual = JSON.parse(fs.readFileSync(path.join(ROOT, ARCHIVE_MANUAL), 'utf8'));
    const requirement = (manual.packageEvidenceRequirements || [])
      .find(item => item.package === ARCHIVE_PACKAGE && item.version === '26.2.1');
    if (!requirement) return { error: 'ARCHIVE_MANUAL_REQUIREMENT_MISSING' };
    return requirement;
  } catch (error) {
    return { error: `ARCHIVE_MANUAL_INVALID:${error.message}` };
  }
}

function probeArchiveRuntime(binary, expectedVersion, requiredCapabilities) {
  if (!fs.statSync(binary, { throwIfNoEntry: false })?.isFile()) {
    return { attempted: false, status: 'BINARY_MISSING', version: '', capabilities: [] };
  }
  if (process.platform !== 'win32') {
    return { attempted: false, status: 'HOST_INCOMPATIBLE', version: '', capabilities: [] };
  }
  const result = spawnSync(binary, ['i'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const version = output.match(/7-Zip\s+([0-9]+\.[0-9]+)/i)?.[1] || '';
  const formatNames = new Set(output.split(/\r?\n/).map(line => {
    const match = line.match(/^\s*\d+\s+\S+\s+(\S+)\s+/);
    return match?.[1] || '';
  }).filter(Boolean));
  const capabilities = requiredCapabilities.filter(name => formatNames.has(name));
  const adjacentDll = path.join(path.dirname(binary), '7z.dll');
  const normalizedOutput = output.replace(/\\/g, '/').toLowerCase();
  const loadedAdjacentLibrary = normalizedOutput.includes(slash(adjacentDll).toLowerCase());
  return {
    attempted: true,
    status: result.error ? 'EXECUTION_ERROR' : result.status === 0 ? 'PASS' : 'NONZERO_EXIT',
    exitCode: result.status,
    signal: result.signal || '',
    error: result.error?.message || '',
    version,
    expectedVersion,
    versionMatches: version === expectedVersion,
    capabilities,
    requiredCapabilities,
    capabilitiesMatch: requiredCapabilities.every(name => formatNames.has(name)),
    loadedAdjacentLibrary,
  };
}

function archiveRuntimeSpecimen(unpackedDir, asarFile) {
  const policy = archiveRuntimePolicy();
  const runtimeRoot = path.join(unpackedDir, 'resources', 'app.asar.unpacked', 'node_modules', ARCHIVE_PACKAGE);
  const asarUnpackedDir = path.join(unpackedDir, 'resources', 'app.asar.unpacked');
  const present = fs.statSync(unpackedDir, { throwIfNoEntry: false })?.isDirectory() || false;
  const violations = [];
  if (policy.error) violations.push(policy.error);

  let asarEntries = [];
  let normalizedEntries = new Map();
  let extractFile = null;
  let asarAuditError = '';
  if (fs.statSync(asarFile, { throwIfNoEntry: false })?.isFile()) {
    try {
      const asarApi = require('@electron/asar');
      extractFile = asarApi.extractFile;
      asarEntries = asarApi.listPackage(asarFile);
      normalizedEntries = new Map(asarEntries.map(name => [slash(name).replace(/^\//, ''), name]));
    } catch (error) {
      asarAuditError = error.message;
      violations.push(`ASAR_INSPECTION_FAILED:${error.message}`);
    }
  } else if (present) {
    violations.push('PACKAGED_ASAR_MISSING');
  }

  const requiredFiles = (policy.files || []).map(item => {
    const sourceFile = path.join(ROOT, ...slash(item.path).split('/'));
    const source = absoluteFileEvidence(sourceFile, item.path, item.sha256);
    let packaged;
    if (item.container === 'ASAR_UNPACKED') {
      const packagedFile = path.join(asarUnpackedDir, ...slash(item.packagedPath).split('/'));
      packaged = absoluteFileEvidence(
        packagedFile,
        `release/win-unpacked/resources/app.asar.unpacked/${slash(item.packagedPath)}`,
        item.sha256,
      );
    } else {
      const entry = normalizedEntries.get(slash(item.packagedPath));
      if (!entry || !extractFile) {
        packaged = {
          path: `release/win-unpacked/resources/app.asar::${slash(item.packagedPath)}`,
          present: false,
          expectedSha256: String(item.sha256 || '').toUpperCase(),
        };
      } else {
        try {
          const content = extractFile(asarFile, entry.replace(/^\\/, ''));
          const actual = crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
          packaged = {
            path: `release/win-unpacked/resources/app.asar::${slash(item.packagedPath)}`,
            present: true,
            bytes: content.length,
            sha256: actual,
            expectedSha256: String(item.sha256 || '').toUpperCase(),
            matchesExpected: actual === String(item.sha256 || '').toUpperCase(),
          };
        } catch (error) {
          packaged = {
            path: `release/win-unpacked/resources/app.asar::${slash(item.packagedPath)}`,
            present: false,
            expectedSha256: String(item.sha256 || '').toUpperCase(),
            error: error.message,
          };
        }
      }
    }
    if (!source.present) violations.push(`ARCHIVE_SOURCE_EVIDENCE_MISSING:${item.path}`);
    else if (!source.matchesExpected) violations.push(`ARCHIVE_SOURCE_HASH_MISMATCH:${item.path}`);
    if (present) {
      if (!packaged.present) violations.push(`ARCHIVE_PACKAGED_FILE_MISSING:${item.packagedPath}`);
      else if (!packaged.matchesExpected) violations.push(`ARCHIVE_PACKAGED_HASH_MISMATCH:${item.packagedPath}`);
    }
    return { role: item.role, container: item.container, source, packaged };
  });

  const sourcePackage = path.join(ROOT, 'node_modules', ARCHIVE_PACKAGE, 'package.json');
  const packagedPackage = path.join(runtimeRoot, 'package.json');
  const packageIdentity = {
    expectedName: ARCHIVE_PACKAGE,
    expectedVersion: policy.version || '',
    directDependency: '',
    source: { present: false, name: '', version: '', license: '' },
    packaged: { present: false, name: '', version: '', license: '' },
  };
  try {
    packageIdentity.directDependency = String(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies?.[ARCHIVE_PACKAGE] || '');
  } catch {}
  for (const [key, file] of [['source', sourcePackage], ['packaged', packagedPackage]]) {
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
      packageIdentity[key] = { present: true, name: String(meta.name || ''), version: String(meta.version || ''), license: String(meta.license || '') };
    } catch (error) {
      packageIdentity[key] = { present: true, invalid: true, error: error.message, name: '', version: '', license: '' };
    }
  }
  if (packageIdentity.directDependency !== policy.version) violations.push('ARCHIVE_DIRECT_DEPENDENCY_NOT_EXACT');
  if (packageIdentity.source.name !== ARCHIVE_PACKAGE || packageIdentity.source.version !== policy.version || packageIdentity.source.license !== 'MIT') {
    violations.push('ARCHIVE_SOURCE_PACKAGE_IDENTITY_MISMATCH');
  }
  if (present && (packageIdentity.packaged.name !== ARCHIVE_PACKAGE
    || packageIdentity.packaged.version !== policy.version
    || packageIdentity.packaged.license !== 'MIT')) {
    violations.push('ARCHIVE_PACKAGED_PACKAGE_IDENTITY_MISMATCH');
  }

  const allowedRuntimeFiles = new Set(policy.target?.allowedRuntimeFiles || []);
  const packagedRuntimeFiles = walk(runtimeRoot).map(file => slash(path.relative(runtimeRoot, file)));
  const targetPayloadFiles = packagedRuntimeFiles.filter(file => /^(?:win|mac|linux)\//.test(file));
  const foreignOrCustomRuntime = targetPayloadFiles.filter(file => !allowedRuntimeFiles.has(file));
  if (present) {
    for (const file of foreignOrCustomRuntime) violations.push(`ARCHIVE_FOREIGN_OR_CUSTOM_RUNTIME:${file}`);
  }

  const unpackedRelativeFiles = walk(asarUnpackedDir).map(file => slash(path.relative(asarUnpackedDir, file)));
  const legacyRuntimeFiles = [
    ...unpackedRelativeFiles.filter(file => file.startsWith('node_modules/7zip-bin/')),
    ...asarEntries.map(name => slash(name).replace(/^\//, '')).filter(file => file.startsWith('node_modules/7zip-bin/')),
  ].filter((item, index, all) => all.indexOf(item) === index).sort();
  if (present && legacyRuntimeFiles.length) violations.push('ARCHIVE_LEGACY_7ZIP_BIN_PRESENT');

  const binary = path.join(runtimeRoot, 'win', 'x64', '7z.exe');
  const probe = probeArchiveRuntime(binary, policy.runtimeVersion || '', policy.target?.requiredCapabilities || []);
  if (present && process.platform === 'win32') {
    if (probe.status !== 'PASS') violations.push(`ARCHIVE_RUNTIME_PROBE_${probe.status}`);
    if (!probe.versionMatches) violations.push('ARCHIVE_RUNTIME_VERSION_MISMATCH');
    if (!probe.capabilitiesMatch) violations.push('ARCHIVE_RUNTIME_CAPABILITY_MISMATCH');
    if (!probe.loadedAdjacentLibrary) violations.push('ARCHIVE_RUNTIME_ADJACENT_LIBRARY_NOT_LOADED');
  }

  const uniqueViolations = [...new Set(violations)].sort();
  return {
    present,
    gate: !present ? 'NOT_BUILT' : uniqueViolations.length ? 'BLOCKED' : 'PASS_PACKAGED_ARCHIVE_RUNTIME',
    expected: {
      package: ARCHIVE_PACKAGE,
      packageVersion: policy.version || '',
      wrapperLicense: policy.declaredLicense || '',
      runtimeVersion: policy.runtimeVersion || '',
      target: policy.target || {},
    },
    packageIdentity,
    requiredFiles,
    packagedRuntimeFiles,
    foreignOrCustomRuntime,
    legacyRuntimeFiles,
    probe,
    asarAuditError,
    violations: uniqueViolations,
  };
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

function provenanceLedgerStatus() {
  const relative = '.mazz/audit/oss-provenance-ledger.json';
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) return { present: false, path: relative, status: 'MISSING' };
  try {
    const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
    const inputs = (ledger.inputs?.files || []).map(record => {
      const current = path.join(ROOT, ...String(record.path || '').split('/'));
      const present = !!record.path && fs.existsSync(current) && fs.statSync(current).isFile();
      const currentSha256 = present ? sha256(current) : '';
      return { path: record.path, present, currentSha256, matchesLedger: present && currentSha256 === record.sha256 };
    });
    const current = inputs.length > 0 && inputs.every(item => item.matchesLedger);
    return {
      present: true,
      path: relative,
      sha256: sha256(file),
      schema: ledger.schema || '',
      status: current ? ledger.gates?.overall || 'UNKNOWN' : 'STALE_INPUTS',
      current,
      summary: ledger.summary || {},
      blockers: ledger.gates?.blockers || [],
      staleInputs: inputs.filter(item => !item.matchesLedger),
    };
  } catch (error) {
    return { present: true, path: relative, status: 'INVALID', error: error.message };
  }
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
  const requiredFfmpegNotices = [
    'renderer/vendor/ffmpeg/COPYING.GPLv2',
    'renderer/vendor/ffmpeg/LICENSE.wrapper-MIT',
    'renderer/vendor/ffmpeg/NOTICE.md',
    'renderer/vendor/ffmpeg/PROVENANCE.md',
    'renderer/vendor/ffmpeg/SOURCE_REPRODUCIBILITY.md',
  ];
  const forbiddenFfmpegCore = [
    'renderer/vendor/ffmpeg/ffmpeg-core.js',
    'renderer/vendor/ffmpeg/ffmpeg-core.wasm',
  ];
  let asar = { present: false, bytes: 0, entries: 0, sourceMaps: 0, rootNotices: [], ffmpegNotices: [], ffmpegCoreArtifacts: [] };
  if (fs.existsSync(asarFile)) {
    const record = fileRecord(asarFile);
    try {
      const { extractFile, listPackage } = require('@electron/asar');
      const entries = listPackage(asarFile);
      const normalizedEntries = new Map(entries.map(name => [slash(name).replace(/^\//, ''), name]));
      const sourceMapFiles = entries.filter(name => name.endsWith('.map')).map(name => ({
        path: slash(name).replace(/^\//, ''),
        bytes: extractFile(asarFile, name.replace(/^\\/, '')).length,
      }));
      const ffmpegNotices = requiredFfmpegNotices.map(expectedPath => {
        const entry = normalizedEntries.get(expectedPath);
        if (!entry) return { path: expectedPath, present: false };
        const content = extractFile(asarFile, entry.replace(/^\\/, ''));
        return {
          path: expectedPath,
          present: true,
          bytes: content.length,
          sha256: crypto.createHash('sha256').update(content).digest('hex').toUpperCase(),
        };
      });
      const ffmpegCoreArtifacts = forbiddenFfmpegCore.map(expectedPath => {
        const entry = normalizedEntries.get(expectedPath);
        if (!entry) return { path: expectedPath, present: false };
        const content = extractFile(asarFile, entry.replace(/^\\/, ''));
        return { path: expectedPath, present: true, bytes: content.length };
      });
      asar = {
        present: true, bytes: record.bytes, entries: entries.length,
        sourceMaps: sourceMapFiles.length,
        sourceMapBytes: sourceMapFiles.reduce((total, file) => total + file.bytes, 0),
        sourceMapFiles,
        rootNotices: entries.filter(name => /^\\(?:LICENSE|NOTICE|THIRD_PARTY_NOTICES\.md|KNOWN_LIMITATIONS\.md)$/.test(name)),
        ffmpegNotices,
        ffmpegCoreArtifacts,
      };
    } catch (error) {
      asar = { present: true, bytes: record.bytes, entries: 0, sourceMaps: null, rootNotices: [], ffmpegNotices: [], auditError: error.message };
    }
  }
  const installerFile = installer ? path.join(releaseDir, installer) : '';
  return {
    present: fs.existsSync(unpackedDir),
    unpacked: { count: unpackedFiles.length, bytes: unpackedFiles.reduce((n, row) => n + row.bytes, 0) },
    asar,
    asarUnpackedNative: { count: unpackedNative.length, bytes: unpackedNative.reduce((n, row) => n + row.bytes, 0), files: unpackedNative },
    archiveRuntime: archiveRuntimeSpecimen(unpackedDir, asarFile),
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
  let licenseEvidence = null;
  try {
    licenseEvidence = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'engineering', 'evidence', 'W71_LICENSE_AUDIT.json'), 'utf8'));
  } catch {}
  const sum = rows => rows.reduce((total, row) => total + row.bytes, 0);
  const ffmpegCorePaths = ['renderer/vendor/ffmpeg/ffmpeg-core.js', 'renderer/vendor/ffmpeg/ffmpeg-core.wasm'];
  const ffmpegExclusions = ffmpegCorePaths.map(item => `!${item}`);
  const buildFiles = pkg.build?.files || [];
  return {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    app: { name: pkg.name, version: pkg.version, license: pkg.license },
    build: {
      output: pkg.build?.directories?.output || '',
      npmRebuild: pkg.build?.npmRebuild,
      asarUnpack: pkg.build?.asarUnpack || [],
      files: buildFiles,
    },
    licenses: {
      root: ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'].map(name => ({ name, present: fs.existsSync(path.join(ROOT, name)) })),
      lockedPackageCount: locked.length,
      missingDeclaredLicense: locked.filter(item => !item.license),
      packages: locked,
      evidence: licenseEvidence,
      provenanceLedger: provenanceLedgerStatus(),
    },
    rendererSourceMaps: { count: sourceMaps.length, bytes: sum(sourceMaps), files: sourceMaps },
    nativeBinaries: { count: nativeBinaries.length, bytes: sum(nativeBinaries), files: nativeBinaries },
    vendoredFfmpeg: { count: vendoredFfmpeg.length, bytes: sum(vendoredFfmpeg), files: vendoredFfmpeg },
    ffmpegDistribution: {
      mode: 'DEFERRED_NOT_BUNDLED',
      activationGate: 'COMPLETE_CORRESPONDING_SOURCE_AND_DURABLE_DELIVERY',
      repositoryCoreArtifactsPresent: ffmpegCorePaths.filter(item => fs.existsSync(path.join(ROOT, item))),
      buildExclusions: ffmpegExclusions.map(rule => ({ rule, present: buildFiles.includes(rule) })),
    },
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

module.exports = {
  archiveRuntimePolicy,
  archiveRuntimeSpecimen,
  auditRelease,
  lockedPackages,
  packagedSpecimen,
  probeArchiveRuntime,
  provenanceLedgerStatus,
  sha256,
  walk,
};
