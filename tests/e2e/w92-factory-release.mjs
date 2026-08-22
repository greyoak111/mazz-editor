// W92 deterministic release gate: one Source coordinate plus two sequential
// runs against the same final packaged executable.  This is intentionally
// separate from the broad legacy scene runner so its evidence and ownership
// boundaries remain explicit.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { collectW92Artifacts } from './w92-evidence-artifacts.mjs';

const root = path.resolve('.');
const executable = path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe');
const evidenceDir = path.join(root, 'docs', 'engineering', 'evidence');
const manifestPath = path.join(evidenceDir, 'W92_FACTORY_RELEASE_MANIFEST.json');

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

// A previous PASS must never survive a partially completed rerun.  Individual
// coordinates may be replaced while this wrapper is running, so the manifest
// is the atomic authority: RUNNING/FAILED evidence is never releasable.
writeJsonAtomic(manifestPath, {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  result: 'RUNNING',
  runs: [],
});
if (!fs.existsSync(executable)) throw new Error(`Final packaged executable is unavailable: ${executable}`);
// Fail before launching any product process if the package is not the final
// source bundle.  The wrapper is independently usable outside npm scripts.
const releaseArtifacts = collectW92Artifacts({ root, executablePath: executable });

function run(label, packaged) {
  const env = { ...process.env, MAZZ_E2E_RUN_LABEL: label };
  if (packaged) env.MAZZ_E2E_EXECUTABLE = executable;
  else delete env.MAZZ_E2E_EXECUTABLE;
  const result = spawnSync(process.execPath, [path.join(root, 'tests', 'e2e', 'w92-factory-workflow.mjs')], {
    cwd: root,
    env,
    stdio: 'inherit',
    timeout: 10 * 60 * 1000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`W92 ${label} failed with exit code ${result.status}`);
  const coordinate = packaged ? 'PACKAGED' : 'SOURCE';
  const baseJson = path.join(evidenceDir, `W92_FACTORY_WORKFLOW_${coordinate}.json`);
  const evidence = JSON.parse(fs.readFileSync(baseJson, 'utf8'));
  if (packaged) {
    const ordinal = /-(\d+)$/.exec(label)?.[1] || label;
    const basePng = path.join(evidenceDir, 'W92_FACTORY_WORKFLOW_PACKAGED.png');
    const snapshotPng = path.join(evidenceDir, `W92_FACTORY_WORKFLOW_PACKAGED_${ordinal}.png`);
    const snapshotJson = path.join(evidenceDir, `W92_FACTORY_WORKFLOW_PACKAGED_${ordinal}.json`);
    fs.copyFileSync(basePng, snapshotPng);
    evidence.screenshot = path.relative(root, snapshotPng).replace(/\\/g, '/');
    if (evidence.artifacts?.screenshot) evidence.artifacts.screenshot.path = evidence.screenshot;
    fs.writeFileSync(snapshotJson, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    return { label, evidenceFile: path.relative(root, snapshotJson).replace(/\\/g, '/'), evidence };
  }
  return { label, evidenceFile: path.relative(root, baseJson).replace(/\\/g, '/'), evidence };
}

const runs = [
  run('source-final', false),
  run('packaged-1', true),
  run('packaged-2', true),
];
writeJsonAtomic(manifestPath, {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  result: 'PASS',
  releaseArtifacts,
  runs,
});
console.log('W92 deterministic release gate: PASS (Source + Packaged x2)');
