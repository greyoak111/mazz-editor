// W71 C4 strict RC evidence runner.
//
// Each numbered invocation executes the complete frozen-specimen gate and writes
// one self-contained manifest. `verify` accepts the three manifests only when
// every command passed and the frozen installer/app.asar hashes stayed fixed.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'engineering', 'evidence');
const AGGREGATE_PATH = path.join(EVIDENCE_DIR, 'W71_RC_THREE_RUN_MANIFEST.json');
const FROZEN = {
  productSourceCommit: 'e753dd0',
  installer: {
    path: 'release/Mazz Editor Setup 0.2.0.exe',
    bytes: 133676213,
    sha256: '69940814475FCF2C294EB280BC1A6AFF2755DFB2F28DDCCCA422BBA3D41A41FA',
  },
  appAsar: {
    path: 'release/win-unpacked/resources/app.asar',
    bytes: 257845274,
    sha256: '35961F6770A469DA0E2216BACDC7CC8EB588B93E5F10FD79C7AF63C363F312CC',
  },
};

const EVIDENCE_FILES = [
  'W71_PRODUCT_MATURITY.json',
  'W71_FORMAL_MAIN_PATHS.json',
  'W71_FFMPEG_DISTRIBUTION_DECISION.json',
  'W71_MEDIA_RUNTIME.json',
  'W71_INSTALLER_CYCLE.json',
  'W71_RELEASE_BASELINE.json',
  'W71_SECRET_AUDIT.json',
];
const EVIDENCE_ASSETS = [
  'W71_PRODUCT_MATURITY_DOCK.png',
  'W71_PRODUCT_MATURITY_HELP.png',
  'W71_FORMAL_LIBRARY_BOOK.png',
  'W71_FORMAL_LIBRARY_NARROW_INK.png',
];

const COMMANDS = [
  { id: 'full-test-suite', executable: process.execPath, args: ['tests/run.js'], expect: /153\s*\/\s*153/ },
  { id: 'product-maturity', executable: process.execPath, args: ['tests/e2e/w71-product-maturity.mjs'] },
  { id: 'formal-main-paths', executable: process.execPath, args: ['tests/e2e/w71-formal-main-paths.mjs'] },
  { id: 'ffmpeg-boundary', executable: process.execPath, args: ['tests/e2e/w71-ffmpeg-runtime.mjs'] },
  { id: 'native-media-boundary', executable: process.execPath, args: ['tests/e2e/w71-media-runtime.mjs'] },
  { id: 'packaged-lifecycle', executable: process.execPath, args: ['tests/e2e/w71-packaged-smoke.mjs'] },
  { id: 'installer-cycle', executable: process.execPath, args: ['tests/e2e/w71-installer-cycle.mjs'] },
  { id: 'release-audit', executable: process.execPath, args: ['scripts/release-audit.js', '--out', 'docs/engineering/evidence/W71_RELEASE_BASELINE.json'] },
  { id: 'secret-audit', executable: process.execPath, args: ['scripts/secret-audit.js', '--out', 'docs/engineering/evidence/W71_SECRET_AUDIT.json'] },
];

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function fileRecord(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`missing evidence/artifact: ${relativePath}`);
  const bytes = fs.readFileSync(absolutePath);
  return { path: relativePath.replace(/\\/g, '/'), bytes: bytes.length, sha256: sha256Buffer(bytes) };
}

function jsonFile(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function atomicJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : 'UNKNOWN';
}

function lastJsonObject(output) {
  const lines = String(output || '').trim().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      return JSON.parse(line);
    } catch (_) {
      // Some commands print formatted JSON. Its immutable digest remains in the
      // manifest even when there is no safe single-line summary to retain.
    }
  }
  return null;
}

function safeSummary(command, stdout) {
  if (command.id === 'full-test-suite') {
    const match = stdout.match(/(\d+)\s*\/\s*(\d+)/g);
    return { testFiles: match?.at(-1)?.replace(/\s/g, '') || 'UNKNOWN' };
  }
  const parsed = lastJsonObject(stdout);
  if (!parsed) return null;
  if (command.id === 'packaged-lifecycle') {
    return {
      ok: parsed.ok === true,
      lifecycleCycles: parsed.lifecycleCycles,
      viewerLifecycleCycles: parsed.viewerLifecycleCycles,
      factoryLifecycleCycles: parsed.factoryLifecycleCycles,
      monacoLifecycleCycles: parsed.monacoLifecycleCycles,
      activeResources: parsed.activeResources,
      baselineResources: parsed.baselineResources,
      sessions: parsed.sessions,
    };
  }
  return { ok: parsed.ok === true || parsed.status === 'PASS' };
}

function commandArgs(command, evidenceDir) {
  if (command.id === 'release-audit') {
    return ['scripts/release-audit.js', '--out', slash(path.relative(ROOT, path.join(evidenceDir, 'W71_RELEASE_BASELINE.json')))];
  }
  if (command.id === 'secret-audit') {
    return ['scripts/secret-audit.js', '--out', slash(path.relative(ROOT, path.join(evidenceDir, 'W71_SECRET_AUDIT.json')))];
  }
  return command.args;
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function runCommand(command, runContext) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const args = commandArgs(command, runContext.evidenceDir);
  console.log(`[C4] START ${command.id}`);
  const result = spawnSync(command.executable, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      CI: '1',
      MAZZ_W71_EVIDENCE_DIR: runContext.evidenceDir,
      MAZZ_W71_EVIDENCE_SUFFIX: '',
    },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const expectedOutputObserved = !command.expect || command.expect.test(stdout);
  const passed = !result.error && result.status === 0 && expectedOutputObserved;
  const record = {
    id: command.id,
    command: [path.basename(command.executable), ...args].join(' '),
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    exitCode: result.status,
    signal: result.signal || null,
    stdoutBytes: Buffer.byteLength(stdout),
    stdoutSha256: sha256Buffer(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stderrSha256: sha256Buffer(stderr),
    expectedOutputObserved,
    summary: safeSummary(command, stdout),
    status: passed ? 'PASS' : 'FAIL',
  };
  console.log(`[C4] ${record.status} ${command.id} (${record.durationMs} ms)`);
  if (!passed) {
    const reason = result.error?.message || stderr.trim().slice(-2000) || stdout.trim().slice(-2000) || 'unknown failure';
    const error = new Error(`${command.id} failed: ${reason}`);
    error.commandRecord = record;
    throw error;
  }
  return record;
}

function frozenArtifacts() {
  const installer = fileRecord(FROZEN.installer.path);
  const appAsar = fileRecord(FROZEN.appAsar.path);
  return {
    installer,
    appAsar,
    hashesUnchanged: installer.bytes === FROZEN.installer.bytes
      && installer.sha256 === FROZEN.installer.sha256
      && appAsar.bytes === FROZEN.appAsar.bytes
      && appAsar.sha256 === FROZEN.appAsar.sha256,
  };
}

function evidenceFiles() {
  return [...EVIDENCE_FILES, ...EVIDENCE_ASSETS];
}

function evidenceRecords(runContext) {
  return evidenceFiles().map(name => {
    const relativePath = slash(path.relative(ROOT, path.join(runContext.evidenceDir, name)));
    const record = fileRecord(relativePath);
    if (name.endsWith('.png')) return { ...record, generatedAt: null, declaredPass: true };
    const value = jsonFile(relativePath);
    return {
      ...record,
      generatedAt: value.generatedAt || null,
      declaredPass: evidencePass(name, value),
    };
  });
}

function evidencePass(name, value) {
  if (value.ok === true || value.status === 'PASS') return true;
  if (name === 'W71_FFMPEG_DISTRIBUTION_DECISION.json') {
    return value.distribution?.mode === 'DEFERRED_NOT_BUNDLED'
      && value.distribution?.repoCoreArtifacts?.length === 0
      && value.distribution?.packagedCoreArtifacts?.length === 0
      && value.runtime?.ensureRejected === true
      && value.runtime?.transcodeRejected === true
      && value.runtime?.messageIsExplicit === true
      && value.runtime?.resourceLedger?.baseline === value.runtime?.resourceLedger?.final
      && value.conclusion?.currentReleaseLicenseGate === 'CLOSED_BY_NON_DISTRIBUTION';
  }
  if (name === 'W71_MEDIA_RUNTIME.json') {
    return value.nativePlayback?.gifButtonVisible === false
      && value.nativePlayback?.afterClose?.contextStates?.every(state => state === 'closed')
      && value.optionalFfmpegRuntime?.mode === 'DEFERRED_NOT_BUNDLED'
      && value.optionalFfmpegRuntime?.gifEntryHidden === true
      && value.resources?.baseline === value.resources?.final;
  }
  if (name === 'W71_INSTALLER_CYCLE.json') {
    return value.install?.exitCode === 0
      && value.install?.uninstallRegistrationCreated === true
      && value.sameVersionReinstall?.exitCode === 0
      && value.coldStartShell?.allVisibleTargetsObserved === true
      && value.coldStartShell?.allGracefullyReleased === true
      && value.coldStartShell?.allAssociationOutcomesValid === true
      && value.installedRuntime?.smokeExitCode === 0
      && value.installedRuntime?.smokeResult?.ok === true
      && value.uninstall?.exitCode === 0
      && value.uninstall?.executableRemoved === true
      && value.uninstall?.uninstallRegistrationRemoved === true
      && value.uninstall?.shortcutsRemoved === true
      && value.uninstall?.windowsIntegrationRemoved === true;
  }
  if (name === 'W71_RELEASE_BASELINE.json') {
    return value.licenses?.root?.every(item => item.present)
      && value.ffmpegDistribution?.mode === 'DEFERRED_NOT_BUNDLED'
      && value.ffmpegDistribution?.repositoryCoreArtifactsPresent?.length === 0
      && value.packagedSpecimen?.asar?.sourceMaps === 0
      && value.packagedSpecimen?.asar?.ffmpegCoreArtifacts?.every(item => item.present === false)
      && value.packagedSpecimen?.archiveRuntime?.gate === 'PASS_PACKAGED_ARCHIVE_RUNTIME'
      && value.packagedSpecimen?.archiveRuntime?.violations?.length === 0;
  }
  if (name === 'W71_SECRET_AUDIT.json') {
    return value.gate === 'PASS_NO_CURRENT_TREE_SECRET_CANDIDATES'
      && value.findings?.length === 0;
  }
  return false;
}

function batchIdNow() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
  return `${timestamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function runContext(batchId, runId) {
  const evidenceDir = path.join(EVIDENCE_DIR, 'w71-rc', batchId, `run-${runId}`);
  return { batchId, runId, evidenceDir };
}

function runNumbered(runId, batchId) {
  const context = runContext(batchId, runId);
  const target = path.join(context.evidenceDir, `W71_RC_RUN_${runId}.json`);
  const manifest = {
    schemaVersion: 2,
    protocol: 'W71_C4_STRICT_INDEPENDENT_RC_RUN',
    batchId,
    runId,
    status: 'RUNNING',
    productSourceCommit: FROZEN.productSourceCommit,
    repositoryHeadAtRun: gitHead(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    evidenceDirectory: slash(path.relative(ROOT, context.evidenceDir)),
    frozenArtifactsBefore: frozenArtifacts(),
    commands: [],
    generatedEvidence: [],
    frozenArtifactsAfter: null,
  };
  try {
    if (!manifest.frozenArtifactsBefore.hashesUnchanged) throw new Error('frozen artifact hash mismatch before run');
    for (const command of COMMANDS) {
      manifest.commands.push(runCommand(command, context));
    }
    manifest.generatedEvidence = evidenceRecords(context);
    manifest.frozenArtifactsAfter = frozenArtifacts();
    if (!manifest.generatedEvidence.every(item => item.declaredPass)) throw new Error('one or more evidence files do not declare PASS');
    if (!manifest.frozenArtifactsAfter.hashesUnchanged) throw new Error('frozen artifact hash mismatch after run');
    manifest.status = 'PASS';
  } catch (error) {
    if (error.commandRecord && !manifest.commands.some(item => item.id === error.commandRecord.id)) {
      manifest.commands.push(error.commandRecord);
    }
    manifest.status = 'FAIL';
    manifest.failure = String(error.message || error);
  } finally {
    manifest.endedAt = new Date().toISOString();
    atomicJson(target, manifest);
  }
  if (manifest.status !== 'PASS') throw new Error(`C4 run ${runId} failed; see ${path.relative(ROOT, target)}`);
  console.log(`[C4] RUN ${runId} PASS -> ${path.relative(ROOT, target)}`);
}

function verifyRuns(batchId) {
  const runs = [1, 2, 3].map(runId => {
    const context = runContext(batchId, runId);
    const relativePath = slash(path.relative(ROOT, path.join(context.evidenceDir, `W71_RC_RUN_${runId}.json`)));
    const value = jsonFile(relativePath);
    const manifest = fileRecord(relativePath);
    const commandIds = value.commands?.map(item => item.id) || [];
    const valid = value.runId === runId
      && value.status === 'PASS'
      && commandIds.length === COMMANDS.length
      && COMMANDS.every(item => commandIds.includes(item.id))
      && value.commands.every(item => item.status === 'PASS')
      && value.batchId === batchId
      && value.generatedEvidence?.length === evidenceFiles().length
      && value.generatedEvidence.every(item => item.declaredPass)
      && value.generatedEvidence.every(item => {
        const current = fileRecord(item.path);
        return current.bytes === item.bytes && current.sha256 === item.sha256;
      })
      && value.frozenArtifactsBefore?.hashesUnchanged
      && value.frozenArtifactsAfter?.hashesUnchanged;
    if (!valid) throw new Error(`independent manifest ${runId} did not satisfy the strict gate`);
    return {
      id: runId,
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      status: value.status,
      testFiles: value.commands.find(item => item.id === 'full-test-suite')?.summary?.testFiles,
      commandCount: value.commands.length,
      evidenceCount: value.generatedEvidence.length,
      artifactHashesUnchanged: true,
      manifest,
    };
  });
  const aggregate = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    decision: 'SEAL_UNSIGNED_INTERNAL_RC',
    protocol: 'THREE_INDEPENDENT_PACKAGED_RELEASE_MANIFESTS',
    batchId,
    productSourceCommit: FROZEN.productSourceCommit,
    frozenArtifacts: {
      installer: FROZEN.installer,
      appAsar: FROZEN.appAsar,
      winUnpacked: { files: 438, bytes: 565148574 },
      packagedSourceMaps: 0,
      packagedFfmpegCoreArtifacts: 0,
      unpackedNative: { files: 10, bytes: 2625024, target: 'win32-x64' },
    },
    runs,
    invariants: {
      independentManifestCount: runs.length,
      commandCountPerRun: COMMANDS.length,
      evidenceCountPerRun: evidenceFiles().length,
      artifactHashesIdenticalAcrossRuns: true,
      allRunsPassed: true,
    },
  };
  const batchAggregatePath = path.join(EVIDENCE_DIR, 'w71-rc', batchId, 'W71_RC_THREE_RUN_MANIFEST.json');
  atomicJson(batchAggregatePath, aggregate);
  atomicJson(AGGREGATE_PATH, aggregate);
  console.log(`[C4] VERIFY PASS -> ${path.relative(ROOT, AGGREGATE_PATH)}`);
}

function main() {
  const operation = process.argv[2];
  if (operation === 'verify') {
    const batchId = process.argv[3];
    if (!batchId) throw new Error('verify requires a batch id');
    return verifyRuns(batchId);
  }
  if (operation === 'all') {
    const batchId = batchIdNow();
    console.log(`[C4] BATCH ${batchId}`);
    for (const runId of [1, 2, 3]) runNumbered(runId, batchId);
    return verifyRuns(batchId);
  }
  const runId = Number(operation);
  if (![1, 2, 3].includes(runId)) {
    throw new Error('usage: node scripts/w71-rc-evidence-run.js <1|2|3|all|verify>');
  }
  const batchId = process.argv[3] || batchIdNow();
  return runNumbered(runId, batchId);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}
