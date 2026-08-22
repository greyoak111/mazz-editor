import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';

const require = createRequire(import.meta.url);
const { extractFile: extractAsarFile } = require('@electron/asar');

const W92_RUNTIME_BINDINGS = Object.freeze([
  'renderer/dist/app.js',
  'renderer/panels/factorycfg.html',
  'main/main.js',
  'main/factory-sse.js',
  'main/panel-windows.js',
  'main/file-watcher.js',
  'main/audio-artwork.js',
  'preload/bridge.js',
  'node_modules/chokidar/lib/nodefs-handler.js',
]);

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function record(root, file, label = '') {
  if (!file || !fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return {
    path: label || path.relative(root, file).replace(/\\/g, '/'),
    bytes: stat.size,
    sha256: sha256File(file),
  };
}

function packageCoordinate(value = {}) {
  return {
    name: value.name || '',
    version: value.version || '',
    main: value.main || '',
    productName: value.productName || '',
    description: value.description || '',
    author: value.author || '',
    license: value.license || '',
    dependencies: value.dependencies || {},
    overrides: value.overrides || {},
  };
}

export function collectW92Artifacts({ root, executablePath = '', screenshotPath = '' } = {}) {
  const bundlePath = path.join(root, 'renderer', 'dist', 'app.js');
  const sourceFiles = Object.fromEntries(W92_RUNTIME_BINDINGS.map(relative => {
    const file = path.join(root, ...relative.split('/'));
    const artifact = record(root, file, relative);
    if (!artifact) throw new Error(`Source runtime binding is unavailable: ${relative}`);
    return [relative, artifact];
  }));
  const result = {
    sourceBundle: record(root, bundlePath, 'renderer/dist/app.js'),
    sourceFiles,
    sourcePackage: record(root, path.join(root, 'package.json'), 'package.json'),
    screenshot: record(root, screenshotPath),
  };
  const chokidarPatchPath = path.join(root, 'patches', 'chokidar+3.6.0.patch');
  const chokidarPatch = record(root, chokidarPatchPath, 'patches/chokidar+3.6.0.patch');
  if (!chokidarPatch) throw new Error('Chokidar close-race patch is unavailable');
  const patchSource = fs.readFileSync(chokidarPatchPath, 'utf8');
  const installedHandler = fs.readFileSync(path.join(root, 'node_modules', 'chokidar', 'lib', 'nodefs-handler.js'), 'utf8');
  for (const marker of ['if (this.fsw.closed)', 'const previousChildren = previous.getChildren()', 'previousChildren.filter']) {
    if (!patchSource.includes(marker) || !installedHandler.includes(marker)) {
      throw new Error(`Chokidar close-race patch is not installed: ${marker}`);
    }
  }
  result.sourcePatches = { chokidar: chokidarPatch };
  if (!executablePath) return result;

  const appAsarPath = path.join(path.dirname(executablePath), 'resources', 'app.asar');
  if (!fs.existsSync(appAsarPath)) throw new Error(`Packaged app.asar is unavailable: ${appAsarPath}`);
  const embeddedFiles = Object.fromEntries(W92_RUNTIME_BINDINGS.map(relative => {
    const bytes = extractAsarFile(appAsarPath, path.join(...relative.split('/')));
    return [relative, {
      path: `${relative} (inside app.asar)`,
      bytes: bytes.length,
      sha256: sha256Bytes(bytes),
    }];
  }));
  const embeddedBundle = embeddedFiles['renderer/dist/app.js'];
  const embeddedPackageBytes = extractAsarFile(appAsarPath, 'package.json');
  const sourcePackageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const embeddedPackageJson = JSON.parse(embeddedPackageBytes.toString('utf8'));
  const sourceCoordinate = packageCoordinate(sourcePackageJson);
  const embeddedCoordinate = packageCoordinate(embeddedPackageJson);
  result.sourcePackage.coordinate = sourceCoordinate;
  result.executable = record(root, executablePath);
  result.appAsar = record(root, appAsarPath);
  result.embeddedBundle = embeddedBundle;
  result.embeddedFiles = embeddedFiles;
  result.embeddedPackage = {
    path: 'package.json (inside app.asar)',
    bytes: embeddedPackageBytes.length,
    sha256: sha256Bytes(embeddedPackageBytes),
    coordinate: embeddedCoordinate,
  };
  if (!isDeepStrictEqual(sourceCoordinate, embeddedCoordinate)) {
    throw new Error('Packaged package coordinate or runtime dependencies are stale');
  }
  for (const relative of W92_RUNTIME_BINDINGS) {
    const sourceSha = sourceFiles[relative]?.sha256;
    const embeddedSha = embeddedFiles[relative]?.sha256;
    if (sourceSha !== embeddedSha) {
      throw new Error(`Packaged runtime is stale at ${relative}: source=${sourceSha} embedded=${embeddedSha}`);
    }
  }
  return result;
}
