// W71: silent NSIS install -> installed executable smoke -> silent uninstall -> residue audit.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const releaseDir = path.join(root, 'release');
const installerName = fs.readdirSync(releaseDir).find(name => /^Mazz Editor Setup .*\.exe$/i.test(name));
if (!installerName) throw new Error('NSIS installer is missing');
const installer = path.join(releaseDir, installerName);
const tempRoot = path.resolve(os.tmpdir());
const evidenceDir = path.join(root, 'docs', 'engineering', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const shortcutPaths = [
  path.join(os.homedir(), 'Desktop', 'Mazz Editor.lnk'),
  path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Mazz Editor.lnk'),
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function assertInsideTemp(target) {
  const resolved = path.resolve(target);
  const relative = path.relative(tempRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing cleanup outside the test temp root: ${resolved}`);
  }
}

function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 240000,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function registrySnapshot() {
  const result = run('reg.exe', [
    'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    '/s', '/f', 'Mazz Editor',
  ], { timeout: 30000 });
  return { exitCode: result.status, output: String(result.stdout || '').trim() };
}

function shortcutSnapshot() {
  return shortcutPaths.filter(file => fs.existsSync(file));
}

async function delay(milliseconds) {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function removeOwnedTempDirectory(target) {
  assertInsideTemp(target);
  const deadline = Date.now() + 30000;
  let attempts = 0;
  let lastError = null;
  while (Date.now() < deadline) {
    attempts += 1;
    if (!fs.existsSync(target)) return { attempted: true, removed: true, attempts };
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return { attempted: true, removed: !fs.existsSync(target), attempts };
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  return {
    attempted: true,
    removed: !fs.existsSync(target),
    attempts,
    error: lastError instanceof Error ? lastError.message : String(lastError || ''),
  };
}

const before = {
  registry: registrySnapshot(),
  shortcuts: shortcutSnapshot(),
};
if (before.registry.exitCode === 0 || before.shortcuts.length) {
  throw new Error(`Existing Mazz Editor installation/shortcut found; refusing destructive installer test: ${JSON.stringify(before)}`);
}

const installDir = fs.mkdtempSync(path.join(tempRoot, 'MazzW71Install-'));
const installedExe = path.join(installDir, 'Mazz Editor.exe');

let installExitCode = null;
let smokeExitCode = null;
let uninstallExitCode = null;
let installRegistry = null;
let installedExeHash = '';
let uninstaller = '';
let smokeResult = null;
let primaryError = null;

try {
  const installed = run(installer, ['/S', `/D=${installDir}`]);
  installExitCode = installed.status;
  if (installExitCode !== 0 || !fs.existsSync(installedExe)) {
    throw new Error(`Silent install failed: exit=${installExitCode}, exe=${fs.existsSync(installedExe)}`);
  }
  installedExeHash = sha256(installedExe);
  uninstaller = fs.readdirSync(installDir)
    .map(name => path.join(installDir, name))
    .find(file => /uninstall.*\.exe$/i.test(path.basename(file))) || '';
  if (!uninstaller) throw new Error('Installed uninstaller is missing');
  installRegistry = registrySnapshot();
  if (installRegistry.exitCode !== 0) throw new Error('NSIS install did not register an uninstall entry');

  const smoke = run(process.execPath, [path.join(root, 'tests', 'e2e', 'w71-packaged-smoke.mjs')], {
    env: { ...process.env, MAZZ_E2E_EXECUTABLE: installedExe },
  });
  smokeExitCode = smoke.status;
  const smokeLine = String(smoke.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
  try {
    smokeResult = JSON.parse(smokeLine);
  } catch {
    smokeResult = { raw: smokeLine };
  }
  if (smokeExitCode !== 0) {
    throw new Error(`Installed executable smoke failed: ${smoke.stderr || smoke.stdout}`);
  }
} catch (error) {
  primaryError = error;
} finally {
  if (!uninstaller && fs.existsSync(installDir)) {
    uninstaller = fs.readdirSync(installDir)
      .map(name => path.join(installDir, name))
      .find(file => /uninstall.*\.exe$/i.test(path.basename(file))) || '';
  }
  if (uninstaller && fs.existsSync(uninstaller)) {
    const removed = run(uninstaller, ['/S']);
    uninstallExitCode = removed.status;
  }
}

const uninstallDeadline = Date.now() + 30000;
let after;
do {
  after = {
    registry: registrySnapshot(),
    shortcuts: shortcutSnapshot(),
    installedExeExists: fs.existsSync(installedExe),
  };
  if (!after.installedExeExists && after.registry.exitCode !== 0 && after.shortcuts.length === 0) break;
  await delay(250);
} while (Date.now() < uninstallDeadline);

const residue = fs.existsSync(installDir) ? fs.readdirSync(installDir) : [];
const productResidueRemoved = !after.installedExeExists
  && after.registry.exitCode !== 0
  && after.shortcuts.length === 0;
const guardedTempCleanup = productResidueRemoved
  ? await removeOwnedTempDirectory(installDir)
  : { attempted: false, removed: !fs.existsSync(installDir), attempts: 0 };

const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  installer: {
    file: `release/${installerName}`,
    bytes: fs.statSync(installer).size,
    sha256: sha256(installer),
  },
  isolatedTarget: path.basename(installDir),
  preflight: { noExistingInstallRegistration: before.registry.exitCode !== 0, noExistingShortcuts: before.shortcuts.length === 0 },
  install: {
    exitCode: installExitCode,
    uninstallRegistrationCreated: installRegistry?.exitCode === 0,
    installedExeSha256: installedExeHash,
  },
  installedRuntime: { smokeExitCode, smokeResult },
  uninstall: {
    exitCode: uninstallExitCode,
    executableRemoved: !after.installedExeExists,
    uninstallRegistrationRemoved: after.registry.exitCode !== 0,
    shortcutsRemoved: after.shortcuts.length === 0,
    residueBeforeGuardedTempCleanup: residue,
    guardedTempCleanup,
  },
};
fs.writeFileSync(path.join(evidenceDir, 'W71_INSTALLER_CYCLE.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');

if (primaryError) throw primaryError;
if (uninstallExitCode !== 0 || !productResidueRemoved || !guardedTempCleanup.removed) {
  throw new Error(`Silent uninstall left product residue: ${JSON.stringify(evidence.uninstall)}`);
}
console.log(JSON.stringify({ ok: true, ...evidence.install, ...evidence.installedRuntime, ...evidence.uninstall }));
