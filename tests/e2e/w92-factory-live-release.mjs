// Explicitly opt-in release gate for the user's already-saved encrypted
// Factory credential.  It never enables itself in default CI because it makes
// real provider requests and may consume quota.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { collectW92Artifacts } from './w92-evidence-artifacts.mjs';

const root = path.resolve('.');
const executable = path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe');
const evidenceDir = path.join(root, 'docs', 'engineering', 'evidence');
const manifestPath = path.join(evidenceDir, 'W92_FACTORY_LIVE_RELEASE_MANIFEST.json');

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

if (process.env.MAZZ_E2E_ALLOW_LIVE_PROVIDER !== '1') {
  throw new Error('Live release gate is opt-in; set MAZZ_E2E_ALLOW_LIVE_PROVIDER=1');
}
writeJsonAtomic(manifestPath, {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  result: 'RUNNING',
  evidence: {},
});
if (!fs.existsSync(executable)) throw new Error(`Final packaged executable is unavailable: ${executable}`);
const releaseArtifacts = collectW92Artifacts({ root, executablePath: executable });

function run(script, packaged) {
  const env = { ...process.env, MAZZ_E2E_ALLOW_LIVE_PROVIDER: '1' };
  if (packaged) env.MAZZ_E2E_EXECUTABLE = executable;
  else delete env.MAZZ_E2E_EXECUTABLE;
  const result = spawnSync(process.execPath, [path.join(root, 'tests', 'e2e', script)], {
    cwd: root,
    env,
    stdio: 'inherit',
    timeout: 10 * 60 * 1000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} (${packaged ? 'PACKAGED' : 'SOURCE'}) failed with exit code ${result.status}`);
}

for (const packaged of [false, true]) {
  run('w92-factory-live-provider.mjs', packaged);
  run('w92-factory-live-workflow.mjs', packaged);
}
const evidenceFiles = [
  'W92_FACTORY_LIVE_PROVIDER_SOURCE.json',
  'W92_FACTORY_LIVE_WORKFLOW_SOURCE.json',
  'W92_FACTORY_LIVE_PROVIDER_PACKAGED.json',
  'W92_FACTORY_LIVE_WORKFLOW_PACKAGED.json',
];
const evidence = Object.fromEntries(evidenceFiles.map(name => [name, JSON.parse(fs.readFileSync(path.join(evidenceDir, name), 'utf8'))]));
writeJsonAtomic(manifestPath, {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  result: 'PASS',
  releaseArtifacts,
  evidence,
});
console.log('W92 live release gate: PASS (Source + Packaged; provider ping + full workflow)');
