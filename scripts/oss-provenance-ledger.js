// scripts/oss-provenance-ledger.js —— W72c 可重复 OSS 来源/许可账本；不联网、不作法律结论
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANUAL = 'docs/engineering/OSS_PROVENANCE_MANUAL.json';
const DEFAULT_LEDGER = '.mazz/audit/oss-provenance-ledger.json';
const slash = value => String(value).replace(/\\/g, '/');

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function packageNameFromLocation(location) {
  return slash(location).replace(/^node_modules\//, '').split('/node_modules/').pop();
}

function fileEvidence(root, relative, expectedSha256 = '') {
  const normalized = slash(relative);
  const full = path.join(root, ...normalized.split('/'));
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return { path: normalized, present: false, expectedSha256: expectedSha256 || '' };
  }
  const bytes = fs.statSync(full).size;
  const sha256 = sha256File(full);
  const record = { path: normalized, present: true, bytes, sha256 };
  if (expectedSha256) {
    record.expectedSha256 = String(expectedSha256).toUpperCase();
    record.matchesExpected = sha256 === record.expectedSha256;
  }
  return record;
}

function listPatchFiles(root) {
  const dir = path.join(root, 'patches');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(item => item.isFile() && item.name.endsWith('.patch'))
    .map(item => `patches/${item.name}`)
    .sort();
}

function uniqueEvidence(records) {
  const byPath = new Map();
  for (const record of records) {
    if (record?.path && !byPath.has(record.path)) byPath.set(record.path, record);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function buildLedger(root = ROOT, manualRelative = DEFAULT_MANUAL) {
  const pkg = readJson(root, 'package.json');
  const lock = readJson(root, 'package-lock.json');
  const manual = readJson(root, manualRelative);
  const blockers = [];
  const warnings = [
    'Latest-version status is not checked: this ledger performs no network access.',
    'Vulnerability status is NOT_ASSESSED_OFFLINE; run an independently reviewed advisory scan before public release.',
    'Runtime-graph candidates are not proof of actual installer contents; release-audit remains the packaged-specimen gate.',
  ];
  const allEvidence = [
    fileEvidence(root, 'package.json'),
    fileEvidence(root, 'package-lock.json'),
    fileEvidence(root, manualRelative),
    fileEvidence(root, 'scripts/oss-provenance-ledger.js'),
  ];

  const licenseOverrides = new Map((manual.npmLicenseOverrides || []).map(item => [`${item.package}@${item.version}`, item]));
  const modifications = new Map((manual.packageModifications || []).map(item => [`${item.package}@${item.version}`, item]));
  const evidenceRequirements = new Map((manual.packageEvidenceRequirements || []).map(item => [`${item.package}@${item.version}`, item]));
  const packageRows = Object.entries(lock.packages || {})
    .filter(([location]) => location.startsWith('node_modules/'))
    .map(([location, meta]) => ({ location: slash(location), meta }))
    .sort((a, b) => a.location.localeCompare(b.location));
  const foundKeys = new Set();
  const mappedPatchFiles = new Set();

  const packages = packageRows.map(({ location, meta }) => {
    const name = packageNameFromLocation(location);
    const version = String(meta.version || '');
    const key = `${name}@${version}`;
    foundKeys.add(key);
    const override = licenseOverrides.get(key);
    const modification = modifications.get(key);
    const requirement = evidenceRequirements.get(key);
    const license = String(meta.license || override?.license || '').trim();
    if (!name || !version) blockers.push(`LOCK_PACKAGE_IDENTITY_MISSING:${location}`);
    if (!license) blockers.push(`LOCK_PACKAGE_LICENSE_MISSING:${key}`);
    if (!meta.resolved) blockers.push(`LOCK_PACKAGE_SOURCE_MISSING:${key}`);
    if (!meta.integrity) blockers.push(`LOCK_PACKAGE_INTEGRITY_MISSING:${key}`);
    const requiredEvidence = [];
    if (override || requirement || modification) {
      const installedMetadata = { ...fileEvidence(root, `${location}/package.json`), role: 'INSTALLED_PACKAGE_METADATA' };
      requiredEvidence.push(installedMetadata);
      if (installedMetadata.present) {
        try {
          const installed = readJson(root, `${location}/package.json`);
          if (String(installed.version || '') !== version) blockers.push(`INSTALLED_PACKAGE_VERSION_MISMATCH:${key}`);
          if (override) {
            const legacy = Array.isArray(installed.licenses)
              ? installed.licenses.map(item => typeof item === 'string' ? item : item?.type).filter(Boolean)
              : [];
            const declarations = [installed.license, ...legacy].filter(Boolean).map(String);
            if (!declarations.includes(override.license)) blockers.push(`LICENSE_OVERRIDE_METADATA_MISMATCH:${key}`);
          }
        } catch {
          blockers.push(`INSTALLED_PACKAGE_METADATA_INVALID:${key}`);
        }
      }
    }
    if (override?.licenseFile) requiredEvidence.push({ ...fileEvidence(root, override.licenseFile), role: 'LICENSE_OVERRIDE_EVIDENCE' });
    for (const item of requirement?.files || []) requiredEvidence.push({ ...fileEvidence(root, item.path), role: item.role });
    for (const record of requiredEvidence) {
      allEvidence.push(record);
      if (!record.present) blockers.push(`PACKAGE_EVIDENCE_MISSING:${key}:${record.path}`);
    }
    const packageModifications = [];
    if (modification) {
      const patch = fileEvidence(root, modification.patch);
      mappedPatchFiles.add(slash(modification.patch));
      allEvidence.push(patch);
      if (!patch.present) blockers.push(`PACKAGE_PATCH_MISSING:${key}:${patch.path}`);
      packageModifications.push({ kind: modification.kind, reason: modification.reason, patch });
    }
    const directRuntime = location === `node_modules/${name}` && Object.prototype.hasOwnProperty.call(pkg.dependencies || {}, name);
    const directDevelopment = location === `node_modules/${name}` && Object.prototype.hasOwnProperty.call(pkg.devDependencies || {}, name);
    return {
      location,
      name,
      version,
      scope: meta.dev ? 'development' : 'runtime-graph-candidate',
      direct: directRuntime || directDevelopment,
      optional: !!meta.optional,
      distributionStatus: requirement?.distributionStatus || (meta.dev ? 'BUILD_ONLY_NOT_SHIPPED_BY_APP_POLICY' : 'VERIFY_IN_PACKAGED_SPECIMEN'),
      source: { resolved: String(meta.resolved || ''), integrity: String(meta.integrity || ''), status: meta.resolved && meta.integrity ? 'LOCKED_ARTIFACT' : 'INCOMPLETE' },
      license: {
        expression: license,
        evidenceState: override ? override.evidenceState : 'PACKAGE_LOCK_DECLARATION',
        reviewState: 'DECLARED_NOT_LEGALLY_REVIEWED',
        repository: override?.repository || '',
      },
      modifications: packageModifications,
      requiredEvidence,
      noticeStatus: requiredEvidence.length ? 'REQUIRED_EVIDENCE_RECORDED' : 'PACKAGE_METADATA_ONLY_VERIFY_AT_RELEASE',
      updateStatus: 'LOCKED_NOT_CHECKED_LATEST',
      vulnerabilityStatus: 'NOT_ASSESSED_OFFLINE',
    };
  });

  for (const key of licenseOverrides.keys()) if (!foundKeys.has(key)) blockers.push(`UNUSED_LICENSE_OVERRIDE:${key}`);
  for (const key of modifications.keys()) if (!foundKeys.has(key)) blockers.push(`UNUSED_PACKAGE_MODIFICATION:${key}`);
  for (const key of evidenceRequirements.keys()) if (!foundKeys.has(key)) blockers.push(`UNUSED_PACKAGE_EVIDENCE_REQUIREMENT:${key}`);
  for (const patch of listPatchFiles(root)) if (!mappedPatchFiles.has(patch)) blockers.push(`UNDECLARED_PACKAGE_PATCH:${patch}`);

  const rootEvidence = (manual.rootEvidence || []).map(relative => fileEvidence(root, relative));
  for (const record of rootEvidence) {
    allEvidence.push(record);
    if (!record.present) blockers.push(`ROOT_EVIDENCE_MISSING:${record.path}`);
  }

  const vendoredComponents = (manual.vendoredComponents || []).map(component => {
    const files = (component.files || []).map(item => ({ ...fileEvidence(root, item.path, item.sha256), role: item.role }));
    const evidenceFiles = (component.evidenceFiles || []).map(relative => fileEvidence(root, relative));
    const mustBeAbsent = (component.mustBeAbsent || []).map(relative => {
      const record = fileEvidence(root, relative);
      return { path: record.path, absent: !record.present };
    });
    for (const record of [...files, ...evidenceFiles]) {
      allEvidence.push(record);
      if (!record.present) blockers.push(`VENDORED_EVIDENCE_MISSING:${component.componentId}:${record.path}`);
      if (record.matchesExpected === false) blockers.push(`VENDORED_HASH_MISMATCH:${component.componentId}:${record.path}`);
    }
    for (const record of mustBeAbsent) if (!record.absent) blockers.push(`FORBIDDEN_VENDORED_ARTIFACT_PRESENT:${component.componentId}:${record.path}`);
    return {
      componentId: component.componentId,
      name: component.name,
      version: component.version,
      source: component.source,
      sourceRef: component.sourceRef,
      sourceArtifactSha256: component.sourceArtifactSha256,
      declaredLicense: component.declaredLicense,
      distributionStatus: component.distributionStatus,
      modifications: component.modifications,
      gate: component.gate,
      files,
      evidenceFiles,
      mustBeAbsent,
      historicalArtifacts: component.historicalArtifacts || [],
      updateStatus: 'FIXED_VERSION_NOT_CHECKED_LATEST',
      vulnerabilityStatus: 'NOT_ASSESSED_OFFLINE',
    };
  });

  const runtimePackages = packages.filter(item => item.scope === 'runtime-graph-candidate');
  const developmentPackages = packages.filter(item => item.scope === 'development');
  const inputs = uniqueEvidence(allEvidence);
  return {
    schema: 'mazz.oss-provenance-ledger/v0',
    deterministic: true,
    legalConclusion: 'NONE — engineering evidence only; independent license/security review still required',
    policy: {
      sourcePriority: ['package-lock resolved+integrity', 'published package metadata', 'manual evidence with exact version', 'vendored fixed hashes'],
      packageContentModificationsMustBeDeclared: true,
      unknownLicenseMustBlockLedger: true,
      packagedSpecimenRemainsSeparateGate: true,
      networkAccess: 'FORBIDDEN_BY_THIS_GENERATOR',
    },
    inputs: { files: inputs },
    dependencyGraph: {
      lockfileVersion: lock.lockfileVersion,
      packageManager: `npm@${String(lock.packageManager || 'lockfile-v3')}`,
      dependencyOverrides: pkg.overrides || {},
      packages,
    },
    rootEvidence,
    vendoredComponents,
    summary: {
      lockedPackages: packages.length,
      runtimeGraphCandidates: runtimePackages.length,
      developmentPackages: developmentPackages.length,
      directRuntimeDependencies: Object.keys(pkg.dependencies || {}).length,
      packagesWithDeclaredModifications: packages.filter(item => item.modifications.length).length,
      manualLicenseOverridesApplied: packages.filter(item => item.license.evidenceState !== 'PACKAGE_LOCK_DECLARATION').length,
      missingLicense: packages.filter(item => !item.license.expression).length,
      missingSourceOrIntegrity: packages.filter(item => item.source.status !== 'LOCKED_ARTIFACT').length,
      vendoredComponents: vendoredComponents.length,
    },
    gates: {
      overall: blockers.length ? 'BLOCKED' : 'PASS_REPOSITORY_PROVENANCE_BASELINE',
      blockers: [...new Set(blockers)].sort(),
      warnings,
      deferredActivation: vendoredComponents.filter(item => item.gate.startsWith('DEFERRED')).map(item => ({ componentId: item.componentId, gate: item.gate })),
    },
  };
}

function serializeLedger(ledger) {
  return JSON.stringify(ledger, null, 2) + '\n';
}

function checkLedger(root = ROOT, targetRelative = DEFAULT_LEDGER, manualRelative = DEFAULT_MANUAL) {
  const target = path.join(root, targetRelative);
  if (!fs.existsSync(target)) return { ok: false, reason: 'LEDGER_MISSING', target: slash(targetRelative) };
  const expected = fs.readFileSync(target, 'utf8');
  const actual = serializeLedger(buildLedger(root, manualRelative));
  return { ok: expected === actual, reason: expected === actual ? 'CURRENT' : 'LEDGER_DRIFT', target: slash(targetRelative) };
}

function main() {
  const outIndex = process.argv.indexOf('--out');
  const checkIndex = process.argv.indexOf('--check');
  if (outIndex >= 0) {
    const relative = slash(process.argv[outIndex + 1] || DEFAULT_LEDGER);
    const ledger = buildLedger();
    const target = path.join(ROOT, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, serializeLedger(ledger));
    console.log(`${relative} ${ledger.gates.overall}`);
    if (ledger.gates.blockers.length) process.exitCode = 1;
    return;
  }
  if (checkIndex >= 0) {
    const result = checkLedger(ROOT, slash(process.argv[checkIndex + 1] || DEFAULT_LEDGER));
    console.log(`${result.target} ${result.reason}`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  process.stdout.write(serializeLedger(buildLedger()));
}

if (require.main === module) main();

module.exports = {
  DEFAULT_LEDGER,
  DEFAULT_MANUAL,
  buildLedger,
  checkLedger,
  fileEvidence,
  packageNameFromLocation,
  serializeLedger,
  sha256File,
};
