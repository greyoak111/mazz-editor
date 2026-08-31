'use strict';

// W94H read-only convergence seal.  It never publishes, deploys, mutates a
// server, or turns a scoped/local result into W94 COMPLETE.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'docs', 'engineering', 'evidence');
const convergenceInputs = [
  'package.json', 'tests/run.js', 'main/main.js', 'preload/bridge.js',
  'main/world-runtime-service.js', 'main/world-hub-publication-service.js', 'main/publication-signing-service.js',
  'main/local-publication-bridge-service.js', 'renderer/modules/world/index.js', 'renderer/modules/viewer/index.js', 'server/hub-origin.js',
  'tests/contract/w94gb-publication-hub.test.mjs', 'tests/contract/w94gc-server-origin.test.mjs',
  'tests/contract/w94g-local-publication-signing.test.mjs', 'tests/contract/w94g-local-publication-bridge.test.mjs',
  'tests/contract/w94h-release-seal.test.mjs', 'tests/e2e/w94gb-publication-hub-runtime.mjs',
  'tests/e2e/w94g-local-workbench-runtime.mjs',
  'tests/e2e/w94gc-server-origin-runtime.mjs', 'tests/e2e/w94gc-server-staging-runtime.mjs',
  'scripts/w94h-release-seal.js', 'scripts/w94gc-fixture.js', 'deploy/mazz-hub/backup-hub.sh',
  'deploy/mazz-hub/mazz-hub.service', 'deploy/mazz-hub/nginx.mazz-hub.conf',
];

function readJson(name) {
  const file = path.join(evidenceDir, name);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function hashFile(name) {
  const file = path.join(evidenceDir, name);
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function convergenceDigest() {
  const hash = crypto.createHash('sha256');
  for (const relative of convergenceInputs) {
    const file = path.join(root, relative);
    hash.update(relative, 'utf8');
    hash.update(fs.existsSync(file) ? fs.readFileSync(file) : '<missing>', 'utf8');
  }
  return hash.digest('hex');
}

function collect() {
  const gaSource = readJson('W94GA_WORLD_SOURCE.json');
  const gaPackaged = readJson('W94GA_WORLD_PACKAGED.json');
  const gbSource = readJson('W94GB_HUB_SOURCE.json');
  const gbPackaged = readJson('W94GB_HUB_PACKAGED.json');
  const gc = readJson('W94GC_SERVER_BASELINE.json');
  const gcStaging = readJson('W94GC_SERVER_STAGING.json');
  const eventCoverage = readJson('W94E_DOMAIN_EVENT_COVERAGE.json');
  const workbenchSource = readJson('W94G_LOCAL_WORKBENCH_SOURCE.json');
  const workbenchPackaged = readJson('W94G_LOCAL_WORKBENCH_PACKAGED.json');
  const regression = readJson('W94H_FULL_REGRESSION.json');
  const localBlockers = [];
  if (eventCoverage?.status !== 'PASS') localBlockers.push('W94E local domain event coverage incomplete');
  if (gaSource?.result !== 'PASS' || gaPackaged?.result !== 'PASS') localBlockers.push('W94Ga Source/Packaged evidence incomplete');
  if (gbSource?.result !== 'PASS' || gbPackaged?.result !== 'PASS') localBlockers.push('W94Gb Source/Packaged evidence incomplete');
  if (workbenchSource?.result !== 'PASS' || workbenchPackaged?.result !== 'PASS') localBlockers.push('W94G desktop Artifact/World/Publication workbench Source/Packaged evidence incomplete');
  const blockers = [];
  if (gcStaging?.result !== 'PASS_WITH_SCOPE') blockers.push('W94Gc staging origin evidence incomplete');
  blockers.push('W94Gc production gates remain open: apex DNS/TLS parity, monitoring and authorized incident/publication drill');
  blockers.push('W94F public P2P and physical cross-machine acceptance remain explicit opt-in/external scope');
  const currentDigest = convergenceDigest();
  const fullRegression = regression?.codeDigest === currentDigest
    ? { status: regression.status, expectedFiles: regression.expectedFiles, failedFiles: regression.failedFiles || [], generatedAt: regression.generatedAt }
    : { status: 'REQUIRES_RUN_AFTER_LAST_W94_CHANGE', expectedFiles: null, failedFiles: [] };
  if (fullRegression.status !== 'PASS') localBlockers.push('W94 full regression must pass after the last W94 change');
  const localComplete = localBlockers.length === 0;
  return {
    schema: 'mazz.w94h-release-seal/v1',
    status: blockers.length ? 'PARTIAL/BLOCKED' : 'PASS',
    localStatus: localComplete ? 'PASS' : 'BLOCKED',
    localCompleteClaim: localComplete,
    completeClaim: false,
    publicEffectAuthorized: false,
    gates: {
      W94A: 'PASS', W94B: 'PASS', W94C: 'PASS', W94D: 'PASS', W94E: eventCoverage?.status === 'PASS' ? 'PASS' : 'BLOCKED', W94F: 'LOCAL_PASS / EXTERNAL_SCOPE_OPEN',
      W94Ga: gaSource?.result === 'PASS' && gaPackaged?.result === 'PASS' ? 'PASS' : 'BLOCKED',
      W94Gb: gbSource?.result === 'PASS' && gbPackaged?.result === 'PASS' && workbenchSource?.result === 'PASS' && workbenchPackaged?.result === 'PASS' ? 'LOCAL_PASS' : 'BLOCKED',
      W94Gc: gcStaging?.result || gc?.result || 'NOT_RUN',
    },
    fullRegression,
    evidence: {
      W94GA_WORLD_SOURCE: hashFile('W94GA_WORLD_SOURCE.json'), W94GA_WORLD_PACKAGED: hashFile('W94GA_WORLD_PACKAGED.json'),
      W94GB_HUB_SOURCE: hashFile('W94GB_HUB_SOURCE.json'), W94GB_HUB_PACKAGED: hashFile('W94GB_HUB_PACKAGED.json'),
      W94GC_SERVER_BASELINE: hashFile('W94GC_SERVER_BASELINE.json'),
      W94GC_SERVER_STAGING: hashFile('W94GC_SERVER_STAGING.json'), W94GC_SERVER_RECOVERY: hashFile('W94GC_SERVER_RECOVERY.json'),
      W94GC_ORIGIN_SOURCE: hashFile('W94GC_ORIGIN_SOURCE.json'),
      W94E_DOMAIN_EVENT_COVERAGE: hashFile('W94E_DOMAIN_EVENT_COVERAGE.json'),
      W94G_LOCAL_WORKBENCH_SOURCE: hashFile('W94G_LOCAL_WORKBENCH_SOURCE.json'),
      W94G_LOCAL_WORKBENCH_PACKAGED: hashFile('W94G_LOCAL_WORKBENCH_PACKAGED.json'),
    },
    localBlockers, blockers,
    next: localComplete
      ? 'W94 local scope is sealed. Public P2P/physical peer and production Hub gates require separate explicit authorization and evidence.'
      : 'Finish the listed local blockers; do not enable public effect.',
  };
}

if (require.main === module) {
  const outArg = process.argv.indexOf('--out');
  const output = outArg >= 0 ? process.argv[outArg + 1] : '';
  const report = collect();
  if (output) {
    const target = path.resolve(output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

module.exports = { collect, convergenceDigest };
