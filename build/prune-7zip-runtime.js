// Keep only the 7-Zip runtime(s) that can execute in the packaged target.
// electron-builder first unpacks the complete npm package; this hook removes
// unrelated OS/architecture binaries from app.asar.unpacked before sealing.
const fs = require('fs');
const path = require('path');

const PLATFORM_DIR = Object.freeze({ win32: 'win', darwin: 'mac', linux: 'linux' });

function archName(value) {
  if (typeof value === 'string') return value;
  try { return require('builder-util').Arch[value]; } catch { return ''; }
}

function targetArchDirs(value) {
  const name = archName(value);
  if (name === 'universal') return ['x64', 'arm64'];
  if (name === 'armv7l') return ['arm'];
  if (['x64', 'ia32', 'arm64', 'arm'].includes(name)) return [name];
  throw new Error(`Unsupported 7-Zip package architecture: ${String(name || value)}`);
}

function packagedResourcesDir(appOutDir, platformName) {
  const root = path.resolve(appOutDir);
  if (platformName !== 'darwin') return path.join(root, 'resources');
  const direct = path.join(root, 'Contents', 'Resources');
  if (fs.existsSync(direct)) return direct;
  const bundles = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.endsWith('.app'));
  if (bundles.length !== 1) throw new Error('Cannot resolve the packaged macOS .app for 7-Zip pruning');
  return path.join(root, bundles[0].name, 'Contents', 'Resources');
}

function assertChild(root, target) {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved === base || !resolved.startsWith(base + path.sep)) {
    throw new Error(`Refusing unsafe 7-Zip package prune target: ${resolved}`);
  }
  return resolved;
}

function removeTree(runtimeRoot, target) {
  const resolved = assertChild(runtimeRoot, target);
  fs.rmSync(resolved, { recursive: true, force: true });
}

function pruneSevenZipRuntime({ appOutDir, electronPlatformName, arch }) {
  const platformDir = PLATFORM_DIR[electronPlatformName];
  if (!platformDir) throw new Error(`Unsupported 7-Zip package platform: ${electronPlatformName}`);
  const resourcesDir = packagedResourcesDir(appOutDir, electronPlatformName);
  const runtimeRoot = path.resolve(resourcesDir, 'app.asar.unpacked', 'node_modules', '7zip-bin-full');
  const appRoot = path.resolve(appOutDir);
  if (!runtimeRoot.startsWith(appRoot + path.sep)) throw new Error('7-Zip runtime root escaped the packaged app');
  if (!fs.statSync(runtimeRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Packaged 7-Zip runtime is missing: ${runtimeRoot}`);
  }

  for (const candidate of ['win', 'mac', 'linux']) {
    if (candidate !== platformDir) removeTree(runtimeRoot, path.join(runtimeRoot, candidate));
  }

  const keep = new Set(targetArchDirs(arch));
  const selectedPlatform = path.join(runtimeRoot, platformDir);
  for (const entry of fs.readdirSync(selectedPlatform, { withFileTypes: true })) {
    if (entry.isDirectory() && !keep.has(entry.name)) removeTree(runtimeRoot, path.join(selectedPlatform, entry.name));
  }

  for (const name of keep) {
    const selected = path.join(selectedPlatform, name);
    const allowed = new Set(platformDir === 'win'
      ? ['7z.exe', '7z.dll', 'History.txt', 'License.txt', 'readme.txt']
      : ['7zz', 'History.txt', 'License.txt', 'readme.txt']);
    for (const entry of fs.readdirSync(selected, { withFileTypes: true })) {
      if (!allowed.has(entry.name)) removeTree(runtimeRoot, path.join(selected, entry.name));
    }
    const binary = path.join(selected, platformDir === 'win' ? '7z.exe' : '7zz');
    if (!fs.statSync(binary, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Selected packaged 7-Zip binary is missing: ${binary}`);
    }
    if (platformDir === 'win' && !fs.statSync(path.join(selected, '7z.dll'), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Selected packaged 7-Zip DLL is missing: ${path.join(selected, '7z.dll')}`);
    }
  }
  return { runtimeRoot, platformDir, archDirs: [...keep] };
}

async function afterPack(context) {
  pruneSevenZipRuntime(context);
}

exports.default = afterPack;
exports.pruneSevenZipRuntime = pruneSevenZipRuntime;
exports.targetArchDirs = targetArchDirs;
