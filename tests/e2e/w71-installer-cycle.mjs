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
const protocolKey = 'HKCU\\Software\\Classes\\mazz';
const associationSpecs = [
  { ext: 'md', progId: 'com.mazz.editor.markdown', legacyBackup: 'Markdown Document_backup' },
  { ext: 'markdown', progId: 'com.mazz.editor.markdown', legacyBackup: 'Markdown Document_backup' },
  { ext: 'txt', progId: 'com.mazz.editor.text', legacyBackup: 'Text Document_backup' },
  { ext: 'mazz', progId: 'com.mazz.editor.workspace', legacyBackup: 'Mazz Workspace File_backup', proprietary: true },
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

function registryKeySnapshot(key) {
  const result = run('reg.exe', ['query', key, '/s'], { timeout: 30000 });
  return { exists: result.status === 0, output: String(result.stdout || '').trim() };
}

function registryValueSnapshot(key, name = '') {
  const result = run('reg.exe', ['query', key, name ? '/v' : '/ve', ...(name ? [name] : [])], { timeout: 30000 });
  const output = String(result.stdout || '').trim();
  const valueLine = output.split(/\r?\n/).find(line => /\sREG_[A-Z0-9_]+\s*/i.test(line));
  const match = valueLine?.match(/\sREG_[A-Z0-9_]+\s*(.*)$/i);
  return { exists: result.status === 0, value: match ? match[1].trim() : '', output };
}

function windowsIntegrationSnapshot() {
  return {
    protocol: {
      key: registryKeySnapshot(protocolKey),
      label: registryValueSnapshot(protocolKey),
      marker: registryValueSnapshot(protocolKey, 'URL Protocol'),
      command: registryValueSnapshot(`${protocolKey}\\shell\\open\\command`),
    },
    associations: associationSpecs.map(spec => {
      const extensionKey = `HKCU\\Software\\Classes\\.${spec.ext}`;
      const classKey = `HKCU\\Software\\Classes\\${spec.progId}`;
      return {
        ...spec,
        extensionKey: registryKeySnapshot(extensionKey),
        defaultValue: registryValueSnapshot(extensionKey),
        backup: registryValueSnapshot(extensionKey, `${spec.progId}_backup`),
        legacyBackup: registryValueSnapshot(extensionKey, spec.legacyBackup),
        classKey: registryKeySnapshot(classKey),
        command: registryValueSnapshot(`${classKey}\\shell\\open\\command`),
      };
    }),
  };
}

function integrationInstalled(snapshot, expectedCommand) {
  return snapshot.protocol.key.exists
    && snapshot.protocol.label.value === 'URL:mazz'
    && snapshot.protocol.marker.exists
    && snapshot.protocol.command.value === expectedCommand
    && snapshot.associations.every(item => item.defaultValue.value === item.progId
      && item.backup.exists
      && !item.legacyBackup.exists
      && item.classKey.exists
      && item.command.value === expectedCommand);
}

function originalAssociationBackupsPreserved(before, current) {
  return current.associations.every((item, index) => {
    const previous = before.associations[index];
    return item.backup.exists && item.backup.value === previous.defaultValue.value;
  });
}

function integrationRemoved(before, after) {
  return !after.protocol.key.exists
    && after.associations.every((item, index) => {
      const previous = before.associations[index];
      const defaultRestored = item.proprietary && !previous.defaultValue.value
        ? (!item.extensionKey.exists || item.defaultValue.value === '')
        : item.defaultValue.exists === previous.defaultValue.exists
          && item.defaultValue.value === previous.defaultValue.value;
      return defaultRestored && !item.backup.exists && !item.legacyBackup.exists && !item.classKey.exists;
    });
}

function compactIntegration(snapshot) {
  return {
    protocol: {
      exists: snapshot.protocol.key.exists,
      label: snapshot.protocol.label.value,
      markerExists: snapshot.protocol.marker.exists,
      command: snapshot.protocol.command.value,
    },
    associations: snapshot.associations.map(item => ({
      ext: item.ext,
      progId: item.progId,
      extensionKeyExists: item.extensionKey.exists,
      defaultValueExists: item.defaultValue.exists,
      defaultValue: item.defaultValue.value,
      backupExists: item.backup.exists,
      backupValue: item.backup.value,
      legacyBackupExists: item.legacyBackup.exists,
      classKeyExists: item.classKey.exists,
      command: item.command.value,
    })),
  };
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
  integration: windowsIntegrationSnapshot(),
};
const preexistingIntegration = before.integration.protocol.key.exists
  || before.integration.associations.some(item => item.classKey.exists || item.backup.exists || item.legacyBackup.exists);
if (before.registry.exitCode === 0 || before.shortcuts.length || preexistingIntegration) {
  throw new Error(`Existing Mazz Editor installation/shortcut found; refusing destructive installer test: ${JSON.stringify(before)}`);
}

const installDir = fs.mkdtempSync(path.join(tempRoot, 'MazzW71Install-'));
const installedExe = path.join(installDir, 'Mazz Editor.exe');

let installExitCode = null;
let sameVersionReinstallExitCode = null;
let smokeExitCode = null;
let uninstallExitCode = null;
let installRegistry = null;
let installIntegration = null;
let sameVersionReinstallRegistry = null;
let sameVersionReinstallIntegration = null;
let sameVersionReinstallExeHash = '';
let originalBackupsPreservedAfterInstall = false;
let originalBackupsPreservedAfterReinstall = false;
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
  installIntegration = windowsIntegrationSnapshot();
  const expectedCommand = `"${installedExe}" "%1"`;
  if (!integrationInstalled(installIntegration, expectedCommand)) {
    throw new Error(`Windows integration registration is incomplete: ${JSON.stringify(compactIntegration(installIntegration))}`);
  }
  originalBackupsPreservedAfterInstall = originalAssociationBackupsPreserved(before.integration, installIntegration);
  if (!originalBackupsPreservedAfterInstall) {
    throw new Error(`Initial install did not preserve original association owners: ${JSON.stringify(compactIntegration(installIntegration))}`);
  }

  const reinstalled = run(installer, ['/S', `/D=${installDir}`]);
  sameVersionReinstallExitCode = reinstalled.status;
  if (sameVersionReinstallExitCode !== 0 || !fs.existsSync(installedExe)) {
    throw new Error(`Same-version reinstall failed: exit=${sameVersionReinstallExitCode}, exe=${fs.existsSync(installedExe)}`);
  }
  sameVersionReinstallExeHash = sha256(installedExe);
  if (sameVersionReinstallExeHash !== installedExeHash) {
    throw new Error(`Same-version reinstall changed executable bytes: ${installedExeHash} -> ${sameVersionReinstallExeHash}`);
  }
  uninstaller = fs.readdirSync(installDir)
    .map(name => path.join(installDir, name))
    .find(file => /uninstall.*\.exe$/i.test(path.basename(file))) || '';
  if (!uninstaller) throw new Error('Reinstalled uninstaller is missing');
  sameVersionReinstallRegistry = registrySnapshot();
  if (sameVersionReinstallRegistry.exitCode !== 0) {
    throw new Error('Same-version reinstall removed the uninstall registration');
  }
  sameVersionReinstallIntegration = windowsIntegrationSnapshot();
  if (!integrationInstalled(sameVersionReinstallIntegration, expectedCommand)) {
    throw new Error(`Same-version reinstall broke Windows integration: ${JSON.stringify(compactIntegration(sameVersionReinstallIntegration))}`);
  }
  originalBackupsPreservedAfterReinstall = originalAssociationBackupsPreserved(before.integration, sameVersionReinstallIntegration);
  if (!originalBackupsPreservedAfterReinstall) {
    throw new Error(`Same-version reinstall overwrote original association owners: ${JSON.stringify(compactIntegration(sameVersionReinstallIntegration))}`);
  }

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
const afterIntegration = windowsIntegrationSnapshot();
const windowsIntegrationRemoved = integrationRemoved(before.integration, afterIntegration);
const productResidueRemoved = !after.installedExeExists
  && after.registry.exitCode !== 0
  && after.shortcuts.length === 0
  && windowsIntegrationRemoved;
const guardedTempCleanup = productResidueRemoved
  ? await removeOwnedTempDirectory(installDir)
  : { attempted: false, removed: !fs.existsSync(installDir), attempts: 0 };

const evidence = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  installer: {
    file: `release/${installerName}`,
    bytes: fs.statSync(installer).size,
    sha256: sha256(installer),
  },
  isolatedTarget: path.basename(installDir),
  preflight: {
    noExistingInstallRegistration: before.registry.exitCode !== 0,
    noExistingShortcuts: before.shortcuts.length === 0,
    noExistingMazzIntegration: !preexistingIntegration,
    associationDefaults: compactIntegration(before.integration).associations.map(item => ({
      ext: item.ext,
      defaultValueExists: item.defaultValueExists,
      defaultValue: item.defaultValue,
    })),
  },
  install: {
    exitCode: installExitCode,
    uninstallRegistrationCreated: installRegistry?.exitCode === 0,
    installedExeSha256: installedExeHash,
    originalAssociationBackupsPreserved: originalBackupsPreservedAfterInstall,
    windowsIntegration: installIntegration ? compactIntegration(installIntegration) : null,
  },
  sameVersionReinstall: {
    exitCode: sameVersionReinstallExitCode,
    executablePreserved: sameVersionReinstallExeHash === installedExeHash && sameVersionReinstallExeHash !== '',
    installedExeSha256: sameVersionReinstallExeHash,
    uninstallRegistrationPreserved: sameVersionReinstallRegistry?.exitCode === 0,
    originalAssociationBackupsPreserved: originalBackupsPreservedAfterReinstall,
    windowsIntegration: sameVersionReinstallIntegration ? compactIntegration(sameVersionReinstallIntegration) : null,
  },
  installedRuntime: { smokeExitCode, smokeResult },
  uninstall: {
    exitCode: uninstallExitCode,
    executableRemoved: !after.installedExeExists,
    uninstallRegistrationRemoved: after.registry.exitCode !== 0,
    shortcutsRemoved: after.shortcuts.length === 0,
    windowsIntegrationRemoved,
    windowsIntegrationAfterRemoval: compactIntegration(afterIntegration),
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
