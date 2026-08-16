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
      const explorerOpenWithKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${spec.ext}\\OpenWithProgids`;
      return {
        ...spec,
        extensionKey: registryKeySnapshot(extensionKey),
        defaultValue: registryValueSnapshot(extensionKey),
        backup: registryValueSnapshot(extensionKey, `${spec.progId}_backup`),
        legacyBackup: registryValueSnapshot(extensionKey, spec.legacyBackup),
        classKey: registryKeySnapshot(classKey),
        command: registryValueSnapshot(`${classKey}\\shell\\open\\command`),
        explorerOpenWithProgId: registryValueSnapshot(explorerOpenWithKey, spec.progId),
      };
    }),
  };
}

function userChoiceSnapshot() {
  return associationSpecs.map(spec => {
    const key = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${spec.ext}\\UserChoice`;
    return {
      ext: spec.ext,
      key: registryKeySnapshot(key),
      progId: registryValueSnapshot(key, 'ProgId'),
      hash: registryValueSnapshot(key, 'Hash'),
    };
  });
}

function compactUserChoices(snapshot) {
  return snapshot.map(item => ({
    ext: item.ext,
    keyExists: item.key.exists,
    progIdExists: item.progId.exists,
    progId: item.progId.value,
    hashExists: item.hash.exists,
    hash: item.hash.value,
  }));
}

function userChoicesUnchanged(before, current) {
  return JSON.stringify(compactUserChoices(current)) === JSON.stringify(compactUserChoices(before));
}

function assertUserChoicesPreserved(before, current, phase) {
  if (!userChoicesUnchanged(before, current)) {
    throw new Error(`Windows UserChoice changed during ${phase}: ${JSON.stringify({
      before: compactUserChoices(before),
      current: compactUserChoices(current),
    })}`);
  }
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
      return defaultRestored && !item.backup.exists && !item.legacyBackup.exists && !item.classKey.exists
        && !item.explorerOpenWithProgId.exists;
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
      explorerOpenWithProgIdExists: item.explorerOpenWithProgId.exists,
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

async function waitForExecutableRelease(file) {
  const probe = `${file}.w71-release-probe`;
  const deadline = Date.now() + 30000;
  let attempts = 0;
  let lastError = null;
  while (Date.now() < deadline) {
    attempts += 1;
    let moved = false;
    try {
      fs.renameSync(file, probe);
      moved = true;
      fs.renameSync(probe, file);
      return { released: true, attempts };
    } catch (error) {
      lastError = error;
      if (moved && fs.existsSync(probe)) {
        try { fs.renameSync(probe, file); } catch (restoreError) {
          throw new Error(`Executable release probe could not restore the installed EXE: ${restoreError.message}`);
        }
      }
      await delay(250);
    }
  }
  return {
    released: false,
    attempts,
    error: lastError instanceof Error ? lastError.message : String(lastError || ''),
  };
}

function installedProcessSnapshot(executable) {
  const script = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$target = [IO.Path]::GetFullPath($env:MAZZ_E2E_TARGET_EXE)',
    '$rows = @(Get-CimInstance Win32_Process -Filter "Name = \'Mazz Editor.exe\'" | Where-Object {',
    '  $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $target',
    '} | ForEach-Object {',
    '  try {',
    '    $p = Get-Process -Id $_.ProcessId -ErrorAction Stop',
    '    [pscustomobject]@{ processId = $_.ProcessId; executablePath = $_.ExecutablePath; commandLine = $_.CommandLine; mainWindowHandle = [Int64]$p.MainWindowHandle; mainWindowTitle = $p.MainWindowTitle }',
    '  } catch {}',
    '})',
    'ConvertTo-Json -Compress -InputObject $rows',
  ].join('\n');
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, MAZZ_E2E_TARGET_EXE: executable },
    timeout: 30000,
  });
  if (result.status !== 0) throw new Error(`Installed process census failed: ${result.stderr || result.stdout}`);
  const output = String(result.stdout || '').trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function waitForColdStartWindow(executable, expectedTitle) {
  const deadline = Date.now() + 60000;
  let last = [];
  while (Date.now() < deadline) {
    last = installedProcessSnapshot(executable);
    const windowProcess = last.find(item => item.mainWindowHandle && String(item.mainWindowTitle || '').includes(expectedTitle));
    if (windowProcess) return { observed: true, expectedTitle, windowProcess, processCount: last.length };
    await delay(250);
  }
  return { observed: false, expectedTitle, processCount: last.length, processes: last };
}

async function waitForOwnedProcessExit(executable) {
  const deadline = Date.now() + 30000;
  let attempts = 0;
  let last = [];
  while (Date.now() < deadline) {
    attempts += 1;
    last = installedProcessSnapshot(executable);
    if (!last.length) return { exited: true, attempts };
    await delay(250);
  }
  return { exited: false, attempts, processes: last };
}

function closeInstalledMainWindow(executable, processId) {
  assertInsideTemp(executable);
  const script = [
    '$target = [IO.Path]::GetFullPath($env:MAZZ_E2E_TARGET_EXE)',
    '$p = Get-Process -Id $env:MAZZ_E2E_TARGET_PID -ErrorAction Stop',
    'if ([IO.Path]::GetFullPath($p.Path) -ne $target) { exit 3 }',
    'if (-not $p.CloseMainWindow()) { exit 4 }',
  ].join('\n');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, MAZZ_E2E_TARGET_EXE: executable, MAZZ_E2E_TARGET_PID: String(processId) },
    timeout: 30000,
  });
}

function stopOwnedInstalledProcesses(executable) {
  assertInsideTemp(executable);
  const script = [
    '$target = [IO.Path]::GetFullPath($env:MAZZ_E2E_TARGET_EXE)',
    '$owned = @(Get-CimInstance Win32_Process -Filter "Name = \'Mazz Editor.exe\'" | Where-Object {',
    '  $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $target',
    '})',
    '$owned | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    'Write-Output $owned.Count',
  ].join('\n');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, MAZZ_E2E_TARGET_EXE: executable },
    timeout: 30000,
  });
}

async function runColdStartTarget(executable, kind, dispatchMode = 'windows-shell') {
  const userData = fs.mkdtempSync(path.join(tempRoot, `MazzW71Cold-${kind}-user-`));
  const workspace = fs.mkdtempSync(path.join(tempRoot, `MazzW71Cold-${kind}-ws-`));
  const associatedFile = kind === 'protocol' ? null : path.join(workspace, `cold-start-file.${kind}`);
  if (associatedFile) fs.writeFileSync(associatedFile, '# cold start shell\n', 'utf8');
  fs.writeFileSync(path.join(userData, 'mazz-settings.json'), JSON.stringify({
    workspace,
    closeBehavior: 'quit',
    'agreement.noMore': true,
  }, null, 2), 'utf8');

  const target = kind === 'protocol' ? 'mazz://home' : associatedFile;
  const expectedTitle = kind === 'protocol' ? '隐私浏览器 — Mazz Editor' : `cold-start-file.${kind} — Mazz Editor`;
  const launchEnv = {
    ...process.env,
    MAZZ_E2E_USER_DATA: userData,
    MAZZ_E2E_WORKSPACE: workspace,
    MAZZ_E2E_SHELL_TARGET: target,
    MAZZ_E2E_TARGET_EXE: executable,
    MAZZ_GPU_MODE: 'safe',
    NODE_ENV: 'test',
  };
  let observation = null;
  let closeExitCode = null;
  let processExit = null;
  let release = null;
  let forcedCleanupProcesses = 0;
  try {
    // Shell 冷启动必须保持可见；windowsHide 会被关联链传给新主进程，造成“进程已起但窗口永久隐藏”。
    // 公共扩展走已核对过的注册命令显式启动，避免在 UserChoice 未选 Mazz 时弹出无人值守“打开方式”。
    const launchCommand = dispatchMode === 'windows-shell'
      ? 'Start-Process -FilePath $env:MAZZ_E2E_SHELL_TARGET'
      : 'Start-Process -FilePath $env:MAZZ_E2E_TARGET_EXE -ArgumentList @($env:MAZZ_E2E_SHELL_TARGET)';
    const launched = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      launchCommand,
    ], {
      env: launchEnv,
      timeout: 30000,
      windowsHide: false,
    });
    if (launched.status !== 0) throw new Error(`Cold-start ${kind} ${dispatchMode} dispatch failed: ${launched.stderr || launched.stdout}`);
    observation = await waitForColdStartWindow(executable, expectedTitle);
    if (!observation.observed) throw new Error(`Cold-start ${kind} target did not reach a visible renderer window: ${JSON.stringify(observation)}`);
    const closed = closeInstalledMainWindow(executable, observation.windowProcess.processId);
    closeExitCode = closed.status;
    if (closeExitCode !== 0) throw new Error(`Cold-start ${kind} main window did not accept graceful close: ${closed.stderr || closed.stdout}`);
    processExit = await waitForOwnedProcessExit(executable);
    if (!processExit.exited) throw new Error(`Cold-start ${kind} left owned processes after graceful close: ${JSON.stringify(processExit)}`);
    release = await waitForExecutableRelease(executable);
    if (!release.released) throw new Error(`Cold-start ${kind} executable remained locked: ${JSON.stringify(release)}`);
    return {
      kind,
      target: kind === 'protocol' ? target : path.basename(target),
      launchMode: dispatchMode === 'windows-shell'
        ? 'windows-shell-cold-start'
        : 'registered-command-direct-cold-start',
      visibleRendererTargetObserved: true,
      mainWindowTitle: observation.windowProcess.mainWindowTitle,
      processCountAtObservation: observation.processCount,
      gracefulCloseExitCode: closeExitCode,
      processExit,
      executableRelease: release,
      forcedCleanupProcesses,
    };
  } finally {
    const remaining = installedProcessSnapshot(executable);
    if (remaining.length) {
      const cleanup = stopOwnedInstalledProcesses(executable);
      forcedCleanupProcesses = Number(String(cleanup.stdout || '').trim()) || remaining.length;
      await waitForExecutableRelease(executable);
    }
    await removeOwnedTempDirectory(userData);
    await removeOwnedTempDirectory(workspace);
  }
}

const before = {
  registry: registrySnapshot(),
  shortcuts: shortcutSnapshot(),
  integration: windowsIntegrationSnapshot(),
  userChoices: userChoiceSnapshot(),
};
const preexistingIntegration = before.integration.protocol.key.exists
  || before.integration.associations.some(item => item.classKey.exists || item.backup.exists
    || item.legacyBackup.exists || item.explorerOpenWithProgId.exists);
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
let installUserChoices = null;
let sameVersionReinstallRegistry = null;
let sameVersionReinstallIntegration = null;
let sameVersionReinstallUserChoices = null;
let sameVersionReinstallExeHash = '';
let originalBackupsPreservedAfterInstall = false;
let originalBackupsPreservedAfterReinstall = false;
let installedExeHash = '';
let uninstaller = '';
let smokeResult = null;
let executableRelease = null;
let coldStartProtocol = null;
let coldStartFiles = {};
let coldStartUserChoices = null;
let installedRuntimeUserChoices = null;
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
  installUserChoices = userChoiceSnapshot();
  assertUserChoicesPreserved(before.userChoices, installUserChoices, 'initial install');
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
  sameVersionReinstallUserChoices = userChoiceSnapshot();
  assertUserChoicesPreserved(before.userChoices, sameVersionReinstallUserChoices, 'same-version reinstall');
  if (!integrationInstalled(sameVersionReinstallIntegration, expectedCommand)) {
    throw new Error(`Same-version reinstall broke Windows integration: ${JSON.stringify(compactIntegration(sameVersionReinstallIntegration))}`);
  }
  originalBackupsPreservedAfterReinstall = originalAssociationBackupsPreserved(before.integration, sameVersionReinstallIntegration);
  if (!originalBackupsPreservedAfterReinstall) {
    throw new Error(`Same-version reinstall overwrote original association owners: ${JSON.stringify(compactIntegration(sameVersionReinstallIntegration))}`);
  }

  for (const { ext } of associationSpecs) {
    const protectedChoice = compactUserChoices(before.userChoices).find(item => item.ext === ext);
    const spec = associationSpecs.find(item => item.ext === ext);
    const dispatchMode = spec?.proprietary ? 'windows-shell' : 'registered-command-direct';
    coldStartFiles[ext] = {
      ...await runColdStartTarget(installedExe, ext, dispatchMode),
      baselineUserChoice: protectedChoice,
      defaultShellDispatchAsserted: !!spec?.proprietary,
    };
  }
  coldStartProtocol = await runColdStartTarget(installedExe, 'protocol');
  coldStartUserChoices = userChoiceSnapshot();
  assertUserChoicesPreserved(before.userChoices, coldStartUserChoices, 'cold-start Shell matrix');

  const smoke = run(process.execPath, [path.join(root, 'tests', 'e2e', 'w71-packaged-smoke.mjs')], {
    env: { ...process.env, MAZZ_E2E_EXECUTABLE: installedExe, MAZZ_E2E_WINDOWS_SHELL: '1' },
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
  if (smokeResult.integrationLaunchMode !== 'windows-shell-protocol+registered-command-file') {
    throw new Error(`Installed executable smoke bypassed Windows Shell: ${JSON.stringify(smokeResult)}`);
  }
  executableRelease = await waitForExecutableRelease(installedExe);
  if (!executableRelease.released) {
    throw new Error(`Installed executable remained locked after app shutdown: ${JSON.stringify(executableRelease)}`);
  }
  installedRuntimeUserChoices = userChoiceSnapshot();
  assertUserChoicesPreserved(before.userChoices, installedRuntimeUserChoices, 'installed runtime smoke');
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
const afterUserChoices = userChoiceSnapshot();
const windowsIntegrationRemoved = integrationRemoved(before.integration, afterIntegration);
const userChoicePhases = {
  afterInstall: installUserChoices,
  afterSameVersionReinstall: sameVersionReinstallUserChoices,
  afterColdStarts: coldStartUserChoices,
  afterInstalledRuntime: installedRuntimeUserChoices,
  afterUninstall: afterUserChoices,
};
const userChoiceUnchangedAfterEachPhase = Object.fromEntries(Object.entries(userChoicePhases).map(([phase, snapshot]) => [
  phase,
  !!snapshot && userChoicesUnchanged(before.userChoices, snapshot),
]));
const allUserChoicesUnchanged = Object.values(userChoiceUnchangedAfterEachPhase).every(Boolean);
const productResidueRemoved = !after.installedExeExists
  && after.registry.exitCode !== 0
  && after.shortcuts.length === 0
  && windowsIntegrationRemoved;
const guardedTempCleanup = productResidueRemoved
  ? await removeOwnedTempDirectory(installDir)
  : { attempted: false, removed: !fs.existsSync(installDir), attempts: 0 };

const evidence = {
  schemaVersion: 5,
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
    userChoices: compactUserChoices(before.userChoices),
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
  coldStartShell: {
    protocol: coldStartProtocol,
    associatedFiles: coldStartFiles,
    protectedUserChoiceExtensions: associationSpecs
      .filter(({ ext }) => coldStartFiles[ext]?.baselineUserChoice?.keyExists)
      .map(({ ext }) => ext),
    shellDefaultNotAssertedExtensions: associationSpecs.filter(item => !item.proprietary).map(item => item.ext),
    proprietaryShellExtensions: associationSpecs.filter(item => item.proprietary).map(item => item.ext),
    allVisibleTargetsObserved: !!coldStartProtocol?.visibleRendererTargetObserved
      && associationSpecs.every(({ ext }) => !!coldStartFiles[ext]?.visibleRendererTargetObserved),
    allGracefullyReleased: !!coldStartProtocol?.executableRelease?.released
      && associationSpecs.every(({ ext }) => !!coldStartFiles[ext]?.executableRelease?.released),
    allAssociationOutcomesValid: associationSpecs.every(({ ext }) => !!coldStartFiles[ext]?.visibleRendererTargetObserved
      && !!coldStartFiles[ext]?.executableRelease?.released),
  },
  userChoicePreservation: {
    baseline: compactUserChoices(before.userChoices),
    snapshots: Object.fromEntries(Object.entries(userChoicePhases).map(([phase, snapshot]) => [
      phase,
      snapshot ? compactUserChoices(snapshot) : null,
    ])),
    unchangedAfterEachPhase: userChoiceUnchangedAfterEachPhase,
    allUnchanged: allUserChoicesUnchanged,
  },
  installedRuntime: { smokeExitCode, smokeResult, executableRelease },
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
if (!allUserChoicesUnchanged) {
  throw new Error(`Windows UserChoice was not preserved across the installer cycle: ${JSON.stringify(evidence.userChoicePreservation)}`);
}
if (uninstallExitCode !== 0 || !productResidueRemoved || !guardedTempCleanup.removed) {
  throw new Error(`Silent uninstall left product residue: ${JSON.stringify(evidence.uninstall)}`);
}
console.log(JSON.stringify({ ok: true, ...evidence.install, ...evidence.installedRuntime, ...evidence.uninstall }));
