// W93B default-offline runtime gate.
//
// Source is the authoritative pre-main network coordinate: a temporary
// bootstrap installs a fail-closed Node/Electron network guard before loading
// the real product main. Packaged runs bind the same assertions to the files
// embedded in app.asar and retain the command-line deny proxy plus an in-main
// guard for every post-startup operation. No live endpoint is contacted.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { extractFile: extractAsarFile } = require('@electron/asar');
const JSZip = require('jszip');
const contract = require('../../main/library-resource-contract.js');
const StoreModule = require('../../main/library-acquisition-store.js');
const LibraryAcquisitionStore = StoreModule.LibraryAcquisitionStore || StoreModule;
const LibraryImportService = require('../../main/library-import-service.js');
const { verifyPayload } = require('../../main/library-acquisition-service.js');

const ROOT = path.resolve('.');
const cli = process.argv.slice(2);
const cliExecutable = (() => {
  const inline = cli.find(value => value.startsWith('--executable='));
  if (inline) return inline.slice('--executable='.length);
  const index = cli.indexOf('--executable');
  return index >= 0 ? cli[index + 1] : '';
})();
const EXECUTABLE = path.resolve(String(
  cliExecutable
  || process.env.MAZZ_W93B_EXECUTABLE
  || process.env.MAZZ_E2E_EXECUTABLE
  || '',
).trim() || ROOT);
const PACKAGED = EXECUTABLE !== ROOT;
const MODE = PACKAGED ? 'packaged' : 'source';
const physicalTemp = prefix => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const USER_DATA = physicalTemp(`mazz-w93b-${MODE}-user-`);
const WORKSPACE = physicalTemp(`mazz-w93b-${MODE}-workspace-`);
const DOWNLOAD_WORKSPACE = physicalTemp(`mazz-w93b-${MODE}-download-workspace-`);
const BOOTSTRAP = PACKAGED ? null : physicalTemp('mazz-w93b-source-bootstrap-');
const STARTUP_GATE_ENTERED = BOOTSTRAP ? path.join(BOOTSTRAP, 'startup-gate-entered') : null;
const STARTUP_GATE_RELEASE = BOOTSTRAP ? path.join(BOOTSTRAP, 'startup-gate-release') : null;
const PRODUCT_MAIN_ROOT = PACKAGED
  ? path.join(path.dirname(EXECUTABLE), 'resources', 'app.asar', 'main')
  : path.join(ROOT, 'main');
const NOW = '2026-08-24T00:00:00.000Z';
const AWAITING_JOB_ID = 'job-runtime-awaiting-import';
const RECOVERY_JOB_ID = 'job-runtime-recover-download';
const DOWNLOAD_JOB_ID = 'job-runtime-browser-download';
const NETWORK_BLOCK_SWITCHES = [
  '--proxy-server=http://127.0.0.1:9',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
];

let app = null;
let appClosed = false;
let stdout = '';
let stderr = '';
let cleanupState = null;
let phase = 'bootstrap';
let failedPhase = '';
let failure = null;
const runtimeErrors = [];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function slash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32'
    ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US')
    : a === b;
}

function redactDiagnostic(value) {
  let text = String(value ?? '');
  const paths = [
    [DOWNLOAD_WORKSPACE, '<DOWNLOAD_WORKSPACE>'],
    [USER_DATA, '<USER_DATA>'],
    [WORKSPACE, '<WORKSPACE>'],
    [BOOTSTRAP, '<BOOTSTRAP>'],
    [PACKAGED ? EXECUTABLE : '', '<EXECUTABLE>'],
    [ROOT, '<PRODUCT_ROOT>'],
  ].filter(([target]) => target).sort((left, right) => right[0].length - left[0].length);
  for (const [target, replacement] of paths) {
    for (const form of [...new Set([
      target,
      slash(target),
      encodeURI(slash(target)),
      `file:///${slash(target)}`,
    ])].sort((left, right) => right.length - left.length)) {
      const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(escaped, 'gi'), replacement);
    }
  }
  return text
    .replace(/(?:[A-Za-z]:[\\/]|file:\/{2,3}[A-Za-z]:[\\/])[^\r\n"']+/gi, '<ABSOLUTE_PATH>')
    .replace(/\\\\[^\\/\s]+[\\/][^\r\n"']+/g, '<UNC_PATH>');
}

function diagnosticTail(value, maxLines = 80, maxChars = 12000) {
  const lines = redactDiagnostic(value).split(/\r?\n/).slice(-maxLines).join('\n');
  return lines.length <= maxChars ? lines : lines.slice(-maxChars);
}

function compactError(error) {
  return {
    name: String(error?.name || 'Error'),
    code: typeof error?.code === 'string' ? error.code : null,
    message: diagnosticTail(error?.message || error, 12, 1600),
    stack: diagnosticTail(error?.stack || '', 30, 6000),
  };
}

function assertPlainMetadata(value, label = 'Inbox response') {
  const forbidden = /(?:bytes|base64|url|cookie|authorization|secret|api[-_]?key|password)/i;
  const visit = (item, trail) => {
    if (Array.isArray(item)) return item.forEach((entry, index) => visit(entry, `${trail}[${index}]`));
    if (!item || typeof item !== 'object') return;
    for (const [key, entry] of Object.entries(item)) {
      assert.equal(forbidden.test(key), false, `${label} leaked forbidden field ${trail}.${key}`);
      visit(entry, `${trail}.${key}`);
    }
  };
  visit(value, label);
}

function readProductFile(relative) {
  if (!PACKAGED) return fs.readFileSync(path.join(ROOT, relative), 'utf8');
  const appAsar = path.join(path.dirname(EXECUTABLE), 'resources', 'app.asar');
  assert.equal(fs.existsSync(appAsar), true, `packaged app.asar missing: ${appAsar}`);
  return extractAsarFile(appAsar, relative.replace(/\\/g, '/')).toString('utf8');
}

function assertProductBinding() {
  const main = readProductFile('main/main.js');
  const ipc = readProductFile('main/library-acquisition-ipc.js');
  const bridge = readProductFile('main/library-browser-acquisition-bridge.js');
  const preload = readProductFile('preload/bridge.js');
  const library = readProductFile('renderer/modules/library/index.js');
  const runtimeBundle = readProductFile('renderer/dist/app.js');

  const startup = main.indexOf('await initializeCurrentLibraryAcquisition({');
  const firstWindow = main.indexOf('wm.createMain()', startup);
  assert.ok(startup >= 0 && firstWindow > startup,
    'acquisition startup recovery must be awaited before the first shell window');
  const startupSettled = main.indexOf('libraryAcquisitionStartupSettled = true;', startup);
  assert.ok(startupSettled > startup && startupSettled < firstWindow,
    'the single-instance startup gate must settle before the authoritative first window');
  assert.match(main, /isStartupReady:\s*\(\)\s*=>\s*libraryAcquisitionStartupReady/);
  assert.match(ipc, /if\s*\(isStartupReady\(\)\s*!==\s*true\)/);
  assert.match(ipc, /await\s+service\.repairOrphanLocks\(opened\)/);
  assert.match(ipc, /await\s+service\.recoverAfterRestart\(opened\)/);

  const secondStart = main.indexOf("app.on('second-instance'");
  const secondEnd = main.indexOf('// ---------- mazz://', secondStart);
  const secondInstance = main.slice(secondStart, secondEnd);
  const secondHold = secondInstance.indexOf('if (!libraryAcquisitionStartupSettled)');
  const secondQueue = secondInstance.indexOf('pendingOpenFiles.push(...files)', secondHold);
  const secondReturn = secondInstance.indexOf('return;', secondQueue);
  const secondCreate = secondInstance.indexOf('wm.createMain()', secondReturn);
  assert.ok(secondStart >= 0 && secondEnd > secondStart
    && secondHold >= 0 && secondQueue > secondHold && secondReturn > secondQueue
    && secondCreate > secondReturn,
  'a startup-time second instance may queue intent but must not create the first shell');

  const quitStart = main.indexOf('Acquisition shutdown is a second-stage durability gate');
  const quitEnd = main.indexOf('globalShortcuts.registerAll()', quitStart);
  const quit = main.slice(quitStart, quitEnd);
  assert.match(quit, /app\.on\('will-quit'/);
  assert.ok(quit.indexOf('libraryBrowserAcquisition?.dispose?.()') < quit.indexOf('libraryAcquisitionService.shutdown()'),
    'Browser Download ownership must close before acquisition service shutdown');
  assert.match(quit, /serviceState\.activeCount\s*!==\s*0/);
  assert.match(quit, /bridgeState\.activeItemCount\s*!==\s*0/);
  assert.match(quit, /bridgeState\.pendingCompletionCount\s*!==\s*0/);
  assert.match(quit, /LIBRARY_ACQUISITION_QUIT_BOUNDARY_FAILED/);
  assert.doesNotMatch(quit, /Promise\.race|setTimeout/);
  const quitSuccess = quit.slice(quit.indexOf('.then(() =>'), quit.indexOf('.catch(error =>'));
  const quitFailure = quit.slice(quit.indexOf('.catch(error =>'));
  assert.match(quitSuccess, /libraryAcquisitionQuitReady\s*=\s*true[\s\S]*app\.quit\(\)/,
    'only a converged Browser/service shutdown may release the second will-quit turn');
  assert.doesNotMatch(quitFailure, /libraryAcquisitionQuitReady\s*=\s*true|app\.quit\(\)/,
    'a rejected Browser/service durability boundary must hold the process open');

  for (const [name, source] of [['main', main], ['preload', preload], ['renderer library', library]]) {
    assert.doesNotMatch(source, /library:download/, `${name} retains transient library:download wiring`);
  }
  assert.doesNotMatch(main, /\bEBOOK_EXTS\b|\.setSavePath\s*\(/,
    'main retains the old direct author-session formal-library write');
  assert.match(bridge, /item\.setSavePath\(preparation\.savePath\)/);
  assert.doesNotMatch(bridge, /setSavePath\([^\n]*(?:workspacePath|libraryRoot|书库)/);
  assert.match(preload, /'library:acquisitionInboxList'/);
  assert.match(preload, /'library:acquisitionInboxCommit'/);
  assert.match(preload, /'library:acquisitionInboxReady'/);
  assert.match(library, /import\s+\{\s*drainAcquisitionInbox\s*\}/);
  assert.match(library, /repositoryReady\.then\(\(\)\s*=>\s*drainPendingAcquisition\(repositoryBinding\)\)/);
  assert.match(library, /window\.mazz\.on\('library:acquisitionInboxReady',\s*\(\)\s*=>/);
  assert.match(runtimeBundle, /library:acquisitionInboxList/,
    `${MODE} runtime bundle does not contain durable Inbox list wiring`);
  assert.match(runtimeBundle, /library:acquisitionInboxReady/,
    `${MODE} runtime bundle does not contain durable Inbox wake wiring`);
  assert.match(runtimeBundle, /acquisitionAbortController/,
    `${MODE} runtime bundle predates provisional/retirement acquisition cancellation`);
  assert.match(runtimeBundle, /handoff-provisional/,
    `${MODE} runtime bundle predates provisional Library write suppression`);
  assert.doesNotMatch(runtimeBundle, /library:download/,
    `${MODE} runtime bundle retains transient library:download wiring`);

  if (!PACKAGED) {
    const bundle = path.join(ROOT, 'renderer', 'dist', 'app.js');
    const librarySource = path.join(ROOT, 'renderer', 'modules', 'library', 'index.js');
    assert.equal(fs.existsSync(bundle), true, 'renderer/dist/app.js missing; run npm run build');
    assert.ok(fs.statSync(bundle).mtimeMs + 1 >= fs.statSync(librarySource).mtimeMs,
      'Source renderer bundle predates renderer/modules/library/index.js; run npm run build after product freeze');
    const bundleText = fs.readFileSync(bundle, 'utf8');
    assert.equal(sha256(bundleText), sha256(runtimeBundle), 'Source runtime bundle read drifted during binding audit');
  }

  return {
    mainSha256: sha256(main),
    ipcSha256: sha256(ipc),
    bridgeSha256: sha256(bridge),
    preloadSha256: sha256(preload),
    rendererLibrarySha256: sha256(library),
    runtimeBundleSha256: sha256(runtimeBundle),
  };
}

function sourceBootstrapText() {
  // Kept CommonJS because Electron loads this file as an application main.
  return String.raw`'use strict';
const path = require('node:path');
const fs = require('node:fs');
const electron = require('electron');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');

const state = {
  schema: 'mazz.w93b-network-guard/v1',
  phase: 'startup',
  calls: [],
  blockedExternalCount: 0,
  acquisitionCallCount: 0,
  allowedLoopbackCount: 0,
  hookErrors: [],
};
const stackIsAcquisition = stack => /library-(?:http-)?acquisition/i.test(stack || '');
const hostOf = value => {
  try {
    if (value instanceof URL) return { protocol: value.protocol, host: value.hostname };
    if (typeof value === 'string') {
      const parsed = new URL(value);
      return { protocol: parsed.protocol, host: parsed.hostname };
    }
    if (value && typeof value === 'object') {
      if (value.href) return hostOf(value.href);
      if (value.url) return hostOf(value.url);
      return { protocol: String(value.protocol || ''), host: String(value.hostname || value.host || '') };
    }
  } catch {}
  return { protocol: '', host: '' };
};
const loopback = host => {
  const value = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  return value === 'localhost' || value === '::1' || value === '0.0.0.0'
    || value === '127.0.0.1' || value.startsWith('127.');
};
const record = (kind, target) => {
  const stack = new Error().stack || '';
  const parsed = hostOf(target);
  const acquisition = stackIsAcquisition(stack);
  state.blockedExternalCount += 1;
  if (acquisition) state.acquisitionCallCount += 1;
  state.calls.push({
    phase: state.phase,
    kind,
    acquisition,
    protocol: parsed.protocol,
    hostSha256: require('node:crypto').createHash('sha256').update(parsed.host).digest('hex'),
  });
  const error = new Error('W93B default-offline network guard blocked an external request');
  error.code = 'W93B_REAL_NETWORK_BLOCKED';
  throw error;
};
const guardRequest = (owner, key, kind) => {
  const original = owner[key];
  if (typeof original !== 'function') return;
  owner[key] = function guardedRequest(...args) {
    const parsed = hostOf(args[0]);
    if (loopback(parsed.host)) {
      state.allowedLoopbackCount += 1;
      return original.apply(this, args);
    }
    return record(kind, args[0]);
  };
};
try { guardRequest(http, 'request', 'node:http.request'); guardRequest(http, 'get', 'node:http.get'); }
catch (error) { state.hookErrors.push('node:http:' + String(error.code || error.message)); }
try { guardRequest(https, 'request', 'node:https.request'); guardRequest(https, 'get', 'node:https.get'); }
catch (error) { state.hookErrors.push('node:https:' + String(error.code || error.message)); }
try {
  const originalLookup = dns.lookup;
  dns.lookup = function guardedLookup(hostname, ...args) {
    if (loopback(hostname)) return originalLookup.call(this, hostname, ...args);
    return record('node:dns.lookup', 'https://' + String(hostname));
  };
  const originalPromiseLookup = dns.promises.lookup.bind(dns.promises);
  dns.promises.lookup = function guardedPromiseLookup(hostname, ...args) {
    if (loopback(hostname)) return originalPromiseLookup(hostname, ...args);
    return record('node:dns.promises.lookup', 'https://' + String(hostname));
  };
} catch (error) { state.hookErrors.push('node:dns:' + String(error.code || error.message)); }
state.snapshot = () => ({
  schema: state.schema,
  phase: state.phase,
  calls: state.calls.slice(),
  blockedExternalCount: state.blockedExternalCount,
  acquisitionCallCount: state.acquisitionCallCount,
  allowedLoopbackCount: state.allowedLoopbackCount,
  hookErrors: state.hookErrors.slice(),
});
state.setPhase = phase => { state.phase = String(phase || 'unknown'); };
globalThis.__MAZZ_W93B_NETWORK_GUARD__ = state;

const root = path.resolve(process.env.MAZZ_W93B_PRODUCT_ROOT);
const startupGateRoot = process.env.MAZZ_W93B_STARTUP_GATE_ROOT;
if (startupGateRoot) {
  const enteredPath = path.join(startupGateRoot, 'startup-gate-entered');
  const releasePath = path.join(startupGateRoot, 'startup-gate-release');
  const observations = [];
  globalThis.__MAZZ_W93B_STARTUP_PROBE__ = { observations };
  electron.app.on('second-instance', (_event, argv) => {
    observations.push({
      probeArgument: argv.includes('--w93b-second-instance-probe'),
      beforeStartupRelease: !fs.existsSync(releasePath),
      browserWindowCount: electron.BrowserWindow.getAllWindows().filter(item => !item.isDestroyed()).length,
    });
  });
  const acquisitionIpc = require(path.join(root, 'main', 'library-acquisition-ipc.js'));
  const initialize = acquisitionIpc.initializeCurrentLibraryAcquisition;
  acquisitionIpc.initializeCurrentLibraryAcquisition = async function gatedStartup(...args) {
    fs.writeFileSync(enteredPath, 'entered', 'utf8');
    while (!fs.existsSync(releasePath)) await new Promise(resolve => setTimeout(resolve, 10));
    return initialize.apply(this, args);
  };
}
// Keep this temporary application's own identity so a developer's running
// Mazz window cannot steal the E2E single-instance lock. Product assets and
// preload paths are rooted by main/main.js __dirname; only optional developer
// shortcut/tool discovery observes app.getAppPath(), and is not used here.
process.chdir(root);
require(path.join(root, 'main', 'main.js'));
`;
}

function prepareSourceBootstrap() {
  if (PACKAGED) return;
  fs.writeFileSync(path.join(BOOTSTRAP, 'package.json'), JSON.stringify({
    name: 'mazz-w93b-source-bootstrap',
    version: '1.0.0',
    main: 'main.cjs',
  }), 'utf8');
  fs.writeFileSync(path.join(BOOTSTRAP, 'main.cjs'), sourceBootstrapText(), 'utf8');
}

async function waitFor(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const error = new Error(`timed out waiting for ${label}`);
  if (lastError) error.cause = lastError;
  throw error;
}

async function exerciseSourceSecondInstanceDuringStartup(launchEnv) {
  if (PACKAGED) return Object.freeze({ runtimeObserved: false, productBinding: true });
  let child = null;
  let childExited = false;
  let childOutput = '';
  try {
    await waitFor(() => fs.existsSync(STARTUP_GATE_ENTERED), 'source startup recovery gate');
    const windowsBefore = await app.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows().filter(item => !item.isDestroyed()).length
    ));
    assert.equal(windowsBefore, 0, 'the first shell was created before startup recovery was released');

    const electronExecutable = require('electron');
    child = spawn(electronExecutable, [
      BOOTSTRAP,
      ...NETWORK_BLOCK_SWITCHES,
      '--w93b-second-instance-probe',
    ], {
      env: launchEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', chunk => { childOutput += String(chunk); });
    child.stderr?.on('data', chunk => { childOutput += String(chunk); });
    const exit = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        childExited = true;
        resolve({ code, signal });
      });
    });
    const observation = await waitFor(async () => {
      const values = await app.evaluate(() => globalThis.__MAZZ_W93B_STARTUP_PROBE__?.observations || []);
      return values.find(value => value.probeArgument) || null;
    }, 'startup-time second-instance delivery');
    assert.equal(observation.beforeStartupRelease, true);
    assert.equal(observation.browserWindowCount, 0,
      'a startup-time second instance stole authority to create the first shell');
    fs.writeFileSync(STARTUP_GATE_RELEASE, 'release', 'utf8');
    const childResult = await Promise.race([
      exit,
      new Promise((_, reject) => setTimeout(() => reject(new Error('second-instance probe did not exit')), 30000)),
    ]);
    assert.equal(childResult.code, 0,
      `second-instance probe exit failed (${childResult.signal || childResult.code}): ${childOutput}`);
    return Object.freeze({
      runtimeObserved: true,
      productBinding: true,
      queuedBeforeStartupRelease: true,
      browserWindowsBeforeRelease: observation.browserWindowCount,
    });
  } finally {
    if (!fs.existsSync(STARTUP_GATE_RELEASE)) {
      try { fs.writeFileSync(STARTUP_GATE_RELEASE, 'release', 'utf8'); } catch {}
    }
    if (child && !childExited) {
      try { child.kill(); } catch {}
    }
  }
}

async function installRuntimeNetworkProbe() {
  return app.evaluate(({ session }, mode) => {
    const existing = globalThis.__MAZZ_W93B_NETWORK_GUARD__;
    const state = existing || {
      schema: 'mazz.w93b-network-guard/v1',
      phase: 'post-startup',
      calls: [],
      blockedExternalCount: 0,
      acquisitionCallCount: 0,
      allowedLoopbackCount: 0,
      hookErrors: [],
    };
    if (typeof state.snapshot !== 'function') {
      state.snapshot = () => ({
        schema: state.schema,
        phase: state.phase,
        calls: state.calls.slice(),
        blockedExternalCount: state.blockedExternalCount,
        acquisitionCallCount: state.acquisitionCallCount,
        allowedLoopbackCount: state.allowedLoopbackCount,
        hookErrors: state.hookErrors.slice(),
      });
      state.setPhase = phase => { state.phase = String(phase || 'unknown'); };
      globalThis.__MAZZ_W93B_NETWORK_GUARD__ = state;
    }
    if (!existing) {
      const crypto = process.getBuiltinModule('node:crypto');
      const hostOf = value => {
        try {
          if (value instanceof URL) return { protocol: value.protocol, host: value.hostname };
          if (typeof value === 'string') {
            const parsed = new URL(value);
            return { protocol: parsed.protocol, host: parsed.hostname };
          }
          if (value && typeof value === 'object') {
            if (value.href) return hostOf(value.href);
            if (value.url) return hostOf(value.url);
            return { protocol: String(value.protocol || ''), host: String(value.hostname || value.host || '') };
          }
        } catch {}
        return { protocol: '', host: '' };
      };
      const loopbackHost = host => {
        const value = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
        return value === 'localhost' || value === '::1' || value === '0.0.0.0'
          || value === '127.0.0.1' || value.startsWith('127.');
      };
      const record = (kind, target) => {
        const stack = new Error().stack || '';
        const parsed = hostOf(target);
        const acquisition = /library-(?:http-)?acquisition/i.test(stack);
        state.blockedExternalCount += 1;
        if (acquisition) state.acquisitionCallCount += 1;
        state.calls.push({
          phase: state.phase,
          kind,
          acquisition,
          protocol: parsed.protocol,
          hostSha256: crypto.createHash('sha256').update(parsed.host).digest('hex'),
        });
        const error = new Error('W93B default-offline network guard blocked an external request');
        error.code = 'W93B_REAL_NETWORK_BLOCKED';
        throw error;
      };
      const guardRequest = (owner, key, kind) => {
        const original = owner[key];
        if (typeof original !== 'function') throw new Error(`${kind} unavailable`);
        owner[key] = function guardedRequest(...args) {
          const parsed = hostOf(args[0]);
          if (loopbackHost(parsed.host)) {
            state.allowedLoopbackCount += 1;
            return original.apply(this, args);
          }
          return record(kind, args[0]);
        };
      };
      try {
        const http = process.getBuiltinModule('node:http');
        guardRequest(http, 'request', 'node:http.request');
        guardRequest(http, 'get', 'node:http.get');
      } catch (error) { state.hookErrors.push(`node:http:${String(error.code || error.message)}`); }
      try {
        const https = process.getBuiltinModule('node:https');
        guardRequest(https, 'request', 'node:https.request');
        guardRequest(https, 'get', 'node:https.get');
      } catch (error) { state.hookErrors.push(`node:https:${String(error.code || error.message)}`); }
      try {
        const dns = process.getBuiltinModule('node:dns');
        const originalLookup = dns.lookup;
        dns.lookup = function guardedLookup(hostname, ...args) {
          if (loopbackHost(hostname)) return originalLookup.call(this, hostname, ...args);
          return record('node:dns.lookup', `https://${String(hostname)}`);
        };
        const originalPromiseLookup = dns.promises.lookup.bind(dns.promises);
        dns.promises.lookup = function guardedPromiseLookup(hostname, ...args) {
          if (loopbackHost(hostname)) return originalPromiseLookup(hostname, ...args);
          return record('node:dns.promises.lookup', `https://${String(hostname)}`);
        };
      } catch (error) { state.hookErrors.push(`node:dns:${String(error.code || error.message)}`); }
    }
    state.setPhase('post-startup');

    const crypto = process.getBuiltinModule('node:crypto');
    const loopback = host => {
      const value = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
      return value === 'localhost' || value === '::1' || value === '0.0.0.0'
        || value === '127.0.0.1' || value.startsWith('127.');
    };
    const observed = [];
    for (const partition of ['', 'persist:mazz-browser', 'persist:mazz-author']) {
      const target = partition ? session.fromPartition(partition) : session.defaultSession;
      target.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
        let host = '';
        try { host = new URL(details.url).hostname; } catch {}
        if (loopback(host)) return callback({});
        observed.push({
          phase: state.phase,
          partition: partition || 'default',
          hostSha256: crypto.createHash('sha256').update(host).digest('hex'),
          resourceType: String(details.resourceType || ''),
        });
        callback({ cancel: true });
      });
    }
    globalThis.__MAZZ_W93B_SESSION_NETWORK__ = {
      snapshot: () => observed.slice(),
    };
    return { mode, guard: state.snapshot(), sessionRequests: observed.slice() };
  }, MODE);
}

async function networkSnapshot(phase) {
  return app.evaluate(({}, wantedPhase) => {
    const guard = globalThis.__MAZZ_W93B_NETWORK_GUARD__;
    guard?.setPhase?.(wantedPhase);
    return {
      guard: guard?.snapshot?.() || null,
      sessionRequests: globalThis.__MAZZ_W93B_SESSION_NETWORK__?.snapshot?.() || [],
    };
  }, phase);
}

function assertNoAcquisitionNetwork(before, after, label) {
  assert.ok(before.guard && after.guard, `${label}: main network guard missing`);
  for (const [point, snapshot] of [['baseline', before], ['terminal', after]]) {
    assert.equal(snapshot.guard.acquisitionCallCount, 0,
      `${label} ${point}: acquisition attempted DNS/socket/HTTP`);
    assert.equal(snapshot.guard.blockedExternalCount, 0,
      `${label} ${point}: product attempted external Node HTTP/DNS`);
    assert.equal(snapshot.sessionRequests.length, 0,
      `${label} ${point}: renderer/session attempted external HTTP(S)`);
  }
}

function acquisitionResourceOwners(snapshot) {
  return (snapshot?.active || []).filter(entry => (
    entry.type === 'library-acquisition'
    || entry.type === 'library-browser-download'
    || String(entry.owner || '').startsWith('library-acquisition:')
  ));
}

function acquisitionLayout() {
  const resources = path.join(WORKSPACE, '书库', '.resources');
  const names = ['jobs', 'inbox', 'staging', 'quarantine', 'locks'];
  const entries = {};
  assert.equal(fs.existsSync(resources), true, '.resources layout was not created during awaited startup');
  const physicalRoot = fs.realpathSync.native?.(WORKSPACE) || fs.realpathSync(WORKSPACE);
  for (const name of names) {
    const directory = path.join(resources, name);
    const stat = fs.lstatSync(directory);
    assert.equal(stat.isDirectory(), true, `${name} is not a directory`);
    assert.equal(stat.isSymbolicLink(), false, `${name} must not be a linked owner`);
    const physical = fs.realpathSync.native?.(directory) || fs.realpathSync(directory);
    assert.equal(path.relative(physicalRoot, physical).startsWith('..'), false, `${name} escaped Workspace`);
    entries[name] = fs.readdirSync(directory).sort();
  }
  return { resources: '书库/.resources', entries };
}

function assertSeededLayout(layout, seed, label) {
  assert.deepEqual(layout.entries.jobs, seed.layout.jobs, `${label}: durable Job set drifted`);
  assert.deepEqual(layout.entries.inbox, seed.layout.inbox, `${label}: durable Inbox set drifted`);
  assert.deepEqual(layout.entries.staging, seed.layout.staging, `${label}: resumable staging set drifted`);
  assert.deepEqual(layout.entries.quarantine, [], `${label}: default-offline recovery created quarantine`);
  assert.deepEqual(layout.entries.locks, [], `${label}: mutation lock leaked`);
}

async function minimalEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>W93B Runtime Fixture</dc:title><dc:identifier id="book-id">urn:mazz:w93b:runtime</dc:identifier>
  </metadata>
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`);
  zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>W93B</title></head>
<body><h1>W93B Runtime Fixture</h1><p>Durable Inbox replay without live network.</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function fixtureCandidate(label, bytes) {
  const identifiers = { ia: [`w93b-${label}`] };
  const workId = contract.deriveWorkId({ identifiers });
  const editionId = contract.deriveEditionId({ identifiers });
  const digest = sha256(bytes);
  const offer = {
    editionId,
    providerId: 'w93b-runtime-fixture',
    resourceId: `w93b-${label}-epub`,
    format: 'epub',
    transport: 'https',
    size: bytes.length,
    checksum: `sha256:${digest}`,
    infoHash: '',
    sourceUrl: `https://downloads.example.org/w93b/${label}.epub`,
    acquisitionRef: `w93b-${label}-epub`,
    selectableFiles: [],
  };
  offer.offerId = contract.deriveOfferId(offer);
  return contract.normalizeCandidate({
    schema: contract.CANDIDATE_SCHEMA,
    candidateId: `candidate-w93b-${label}`,
    work: {
      workId,
      title: `W93B ${label}`,
      authors: ['W93B Runtime'],
      languages: ['en'],
      subjects: [],
      identifiers,
    },
    editions: [{
      editionId,
      title: `W93B ${label}`,
      language: 'en',
      publisher: '',
      publishedAt: '',
      identifiers,
      description: '',
    }],
    offers: [offer],
    rights: {
      status: 'public-domain',
      licenseId: 'w93b-runtime-fixture',
      rightsStatement: 'Deterministic public-domain runtime fixture',
      jurisdiction: 'US',
      evidenceUrl: 'https://example.org/w93b/runtime-rights',
      assertedBy: 'w93b-runtime-fixture',
      checkedAt: NOW,
      confidence: 1,
    },
    provenance: [{
      providerId: 'w93b-runtime-fixture',
      resourceId: `w93b-${label}`,
      pageUrl: '',
      observedAt: NOW,
      adapterVersion: 'fixture-v1',
    }],
  });
}

function fixtureJob(store, candidate, { jobId, intentId }) {
  const offer = candidate.offers[0];
  return {
    schema: contract.JOB_SCHEMA,
    revision: 1,
    jobId,
    intentId,
    idempotencyAliases: [],
    workspaceIdentity: store.workspaceIdentity,
    workspacePath: store.workspacePath,
    candidateId: candidate.candidateId,
    offerId: offer.offerId,
    providerId: offer.providerId,
    transport: offer.transport,
    transportIdentity: contract.deriveTransportIdentity(offer),
    selectedFiles: [],
    rightsStatus: candidate.rights.status,
    rightsReceipt: {
      decision: 'public-domain',
      authority: 'source-evidence',
      evidenceRef: `rights-${jobId}`,
      at: NOW,
    },
    state: 'queued',
    retryFrom: null,
    bytes: { received: 0, total: null },
    error: null,
    integrity: { sha256: '', declaredChecksum: '', pieceVerified: false },
    stagingPath: '',
    finalPath: '',
    bookId: '',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function seedDurableAcquisition() {
  const epub = await minimalEpub();
  const store = new LibraryAcquisitionStore({ workspacePath: WORKSPACE, now: () => NOW, recoverOnOpen: false });
  const sourcePath = path.join(WORKSPACE, 'w93b-runtime-seed.epub');
  fs.writeFileSync(sourcePath, epub);
  const promotion = await new LibraryImportService().materializePath({
    workspace: store.workspacePath,
    sourcePath,
    name: 'W93B Runtime Fixture.epub',
  });
  fs.unlinkSync(sourcePath);
  const finalPath = promotion.path;
  const digest = promotion.sha256;
  assert.equal(contract.isPathInside(store.paths.libraryRoot, finalPath), true,
    `promoted fixture escaped the Store library root: ${finalPath}`);
  const verified = await verifyPayload({
    filePath: finalPath,
    format: 'epub',
    declaredChecksum: `sha256:${digest}`,
    expectedSize: promotion.size,
  });
  assert.equal(verified.sha256, digest);
  assert.equal(verified.size, promotion.size);

  const awaitingCandidate = fixtureCandidate('awaiting', epub);
  let awaiting = store.createJob(fixtureJob(store, awaitingCandidate, {
    jobId: AWAITING_JOB_ID,
    intentId: 'intent-runtime-awaiting-import',
  }), { candidate: awaitingCandidate });
  const awaitingStaging = path.join(store.paths.stagingRoot, AWAITING_JOB_ID, 'payload.epub.part');
  awaiting = store.transitionJob(awaiting.jobId, 'downloading', {
    expectedRevision: awaiting.revision,
    patch: { stagingPath: awaitingStaging },
  });
  awaiting = store.transitionJob(awaiting.jobId, 'verifying', {
    expectedRevision: awaiting.revision,
    patch: { bytes: { received: epub.length, total: epub.length } },
  });
  awaiting = store.transitionJob(awaiting.jobId, 'materializing', {
    expectedRevision: awaiting.revision,
    patch: {
      bytes: { received: epub.length, total: epub.length },
      integrity: {
        sha256: digest,
        declaredChecksum: awaitingCandidate.offers[0].checksum,
        pieceVerified: false,
      },
    },
  });
  awaiting = store.transitionJob(awaiting.jobId, 'awaiting-import', {
    expectedRevision: awaiting.revision,
    patch: { finalPath },
  });
  const receiptId = `receipt-${sha256(`${awaiting.jobId}:${digest}`)}`;
  store.putInboxReceipt({
    schema: contract.INBOX_SCHEMA,
    revision: 1,
    receiptId,
    jobId: awaiting.jobId,
    workspaceIdentity: store.workspaceIdentity,
    kind: 'library-asset-ready',
    state: 'pending',
    artifact: {
      path: finalPath,
      sha256: digest,
      size: promotion.size,
      format: 'epub',
    },
    createdAt: awaiting.updatedAt,
    acknowledgedAt: null,
  });

  const recoveryBytes = Buffer.concat([epub, Buffer.from('\nrecovery-transport')]);
  const recoveryCandidate = fixtureCandidate('recovery', recoveryBytes);
  let recovery = store.createJob(fixtureJob(store, recoveryCandidate, {
    jobId: RECOVERY_JOB_ID,
    intentId: 'intent-runtime-recover-download',
  }), { candidate: recoveryCandidate });
  const recoveryRoot = path.join(store.paths.stagingRoot, RECOVERY_JOB_ID);
  fs.mkdirSync(recoveryRoot);
  const recoveryStaging = path.join(recoveryRoot, 'payload.epub.part');
  const partial = recoveryBytes.subarray(0, Math.max(1, Math.floor(recoveryBytes.length / 3)));
  fs.writeFileSync(recoveryStaging, partial);
  recovery = store.transitionJob(recovery.jobId, 'downloading', {
    expectedRevision: recovery.revision,
    patch: {
      stagingPath: recoveryStaging,
      bytes: { received: partial.length, total: recoveryBytes.length },
    },
  });

  return Object.freeze({
    awaitingJobId: awaiting.jobId,
    recoveryJobId: recovery.jobId,
    receiptId,
    finalPath,
    digest,
    size: promotion.size,
    partialSize: partial.length,
    layout: Object.freeze({
      jobs: Object.freeze([`${AWAITING_JOB_ID}.json`, `${RECOVERY_JOB_ID}.json`].sort()),
      inbox: Object.freeze([`${receiptId}.json`]),
      staging: Object.freeze([RECOVERY_JOB_ID]),
    }),
  });
}

function readDurableAcquisition(seed) {
  const store = new LibraryAcquisitionStore({ workspacePath: WORKSPACE, recoverOnOpen: false });
  return {
    awaiting: store.getJob(seed.awaitingJobId),
    recovery: store.getJob(seed.recoveryJobId),
    receipt: store.getInboxReceipt(seed.receiptId),
  };
}

async function exerciseRealDownloadItem(bytes, candidate) {
  const input = {
    mainRoot: PRODUCT_MAIN_ROOT,
    workspacePath: DOWNLOAD_WORKSPACE,
    now: NOW,
    jobId: DOWNLOAD_JOB_ID,
    intentId: 'intent-runtime-browser-download',
    partition: `w93b-runtime-download-${sha256(DOWNLOAD_WORKSPACE).slice(0, 16)}`,
    bytesBase64: bytes.toString('base64'),
    candidate,
  };
  return app.evaluate(async ({ BrowserWindow, session }, options) => {
    const { createRequire } = process.getBuiltinModule('node:module');
    const fsImpl = process.getBuiltinModule('node:fs');
    const pathImpl = process.getBuiltinModule('node:path');
    const requireProduct = createRequire(pathImpl.join(options.mainRoot, 'library-acquisition-service.js'));
    const productContract = requireProduct('./library-resource-contract.js');
    const StoreModule = requireProduct('./library-acquisition-store.js');
    const Store = StoreModule.LibraryAcquisitionStore || StoreModule;
    const ServiceModule = requireProduct('./library-acquisition-service.js');
    const Service = ServiceModule.LibraryAcquisitionService || ServiceModule;
    const BridgeModule = requireProduct('./library-browser-acquisition-bridge.js');
    const Bridge = BridgeModule.LibraryBrowserAcquisitionBridge || BridgeModule;
    const ImportService = requireProduct('./library-import-service.js');

    const payload = Buffer.from(options.bytesBase64, 'base64');
    const candidateValue = productContract.normalizeCandidate(options.candidate);
    const offer = candidateValue.offers[0];
    const isolatedSession = session.fromPartition(options.partition);
    const protocolRequests = [];
    const unexpectedRequests = [];
    let protocolIntercepted = false;
    let protocolReleased = false;
    let bridge = null;
    let service = null;
    let window = null;
    let observer = null;
    let preWriteIdentity = null;
    let writerClosedIdentity = null;
    let preparedPath = '';
    let itemSavePath = '';
    let downloadState = '';
    let willDownloadCount = 0;
    let durabilityError = null;
    let disposeError = null;
    let shutdownError = null;
    let primaryError = null;
    let job = null;
    let inbox = [];
    let bridgeBeforeDispose = null;
    let bridgeAfterDispose = null;
    let serviceBeforeShutdown = null;
    let serviceAfterShutdown = null;
    let serial = 0;
    const identity = stat => ({
      dev: String(stat.dev),
      ino: String(stat.ino),
      birthtimeMs: Number(stat.birthtimeMs),
      size: Number(stat.size),
    });
    const sameOwner = (left, right) => Boolean(left && right
      && left.dev === right.dev
      && left.ino === right.ino
      && (!Number.isFinite(left.birthtimeMs)
        || !Number.isFinite(right.birthtimeMs)
        || left.birthtimeMs === right.birthtimeMs));
    const errorFact = error => error ? {
      name: String(error.name || 'Error'),
      code: typeof error.code === 'string' ? error.code : null,
      message: String(error.message || error).slice(0, 500),
    } : null;
    const bounded = (promise, label, timeout = 30000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(
        new Error(`W93B DownloadItem timeout: ${label}`),
        { code: 'W93B_DOWNLOADITEM_TIMEOUT' },
      )), timeout);
      Promise.resolve(promise).then(
        value => { clearTimeout(timer); resolve(value); },
        error => { clearTimeout(timer); reject(error); },
      );
    });

    try {
      isolatedSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*'] },
        (details, callback) => {
          if (details.url === offer.sourceUrl) return callback({});
          unexpectedRequests.push({ resourceType: String(details.resourceType || '') });
          return callback({ cancel: true });
        },
      );
      if (typeof isolatedSession.protocol.interceptBufferProtocol !== 'function'
          || typeof isolatedSession.protocol.uninterceptProtocol !== 'function') {
        throw Object.assign(new Error('Electron buffer protocol interception API is unavailable'), {
          code: 'W93B_DOWNLOADITEM_PROTOCOL_UNAVAILABLE',
        });
      }
      protocolIntercepted = isolatedSession.protocol.interceptBufferProtocol('https', (request, callback) => {
        protocolRequests.push({ exact: request.url === offer.sourceUrl, method: String(request.method || '') });
        if (request.url !== offer.sourceUrl || request.method !== 'GET') {
          unexpectedRequests.push({ resourceType: 'protocol' });
          callback({ error: -3 });
          return;
        }
        callback({
          statusCode: 200,
          mimeType: 'application/epub+zip',
          headers: {
            'Cache-Control': ['no-store'],
            'Content-Disposition': ['attachment; filename="w93b-runtime.epub"'],
            'Content-Length': [String(payload.length)],
          },
          data: payload,
        });
      });
      if (protocolIntercepted !== true) {
        throw Object.assign(new Error('Electron https buffer protocol interception is unavailable'), {
          code: 'W93B_DOWNLOADITEM_PROTOCOL_UNAVAILABLE',
        });
      }

      const store = new Store({
        workspacePath: options.workspacePath,
        now: () => options.now,
        recoverOnOpen: false,
      });
      service = new Service({
        store,
        httpAcquisition: {
          async download() {
            throw Object.assign(new Error('real HTTP transport is forbidden in the DownloadItem coordinate'), {
              code: 'W93B_REAL_NETWORK_FORBIDDEN',
            });
          },
        },
        promoter: new ImportService(),
        now: () => options.now,
        randomId: () => `w93b-browser-runtime-${++serial}`,
      });
      const opened = service.openWorkspace(store.workspacePath);
      job = store.createJob({
        schema: productContract.JOB_SCHEMA,
        revision: 1,
        jobId: options.jobId,
        intentId: options.intentId,
        idempotencyAliases: [],
        workspaceIdentity: store.workspaceIdentity,
        workspacePath: store.workspacePath,
        candidateId: candidateValue.candidateId,
        offerId: offer.offerId,
        providerId: offer.providerId,
        transport: offer.transport,
        transportIdentity: productContract.deriveTransportIdentity(offer),
        selectedFiles: [],
        rightsStatus: candidateValue.rights.status,
        rightsReceipt: {
          decision: candidateValue.rights.status,
          authority: 'source-evidence',
          evidenceRef: 'rights-runtime-browser-download',
          at: options.now,
        },
        state: 'queued',
        retryFrom: null,
        bytes: { received: 0, total: null },
        error: null,
        integrity: { sha256: '', declaredChecksum: '', pieceVerified: false },
        stagingPath: '',
        finalPath: '',
        bookId: '',
        createdAt: options.now,
        updatedAt: options.now,
      }, { candidate: candidateValue });

      bridge = new Bridge({
        acquisitionService: service,
        session: isolatedSession,
        randomId: () => `w93b-browser-bridge-${++serial}`,
      });
      let resolveDone;
      let rejectDone;
      const itemDone = new Promise((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });
      observer = (_event, item, webContents) => {
        if (typeof item?.getURL !== 'function' || item.getURL() !== offer.sourceUrl) return;
        willDownloadCount += 1;
        try {
          const current = store.getJob(options.jobId);
          preparedPath = current.stagingPath;
          itemSavePath = typeof item.getSavePath === 'function' ? item.getSavePath() : '';
          preWriteIdentity = identity(fsImpl.lstatSync(preparedPath));
          item.once('done', (_doneEvent, state) => {
            try {
              downloadState = String(state || '');
              writerClosedIdentity = identity(fsImpl.lstatSync(preparedPath));
              resolveDone(downloadState);
            } catch (error) { rejectDone(error); }
          });
        } catch (error) { rejectDone(error); }
      };
      isolatedSession.on('will-download', observer);

      window = new BrowserWindow({
        show: false,
        webPreferences: {
          session: isolatedSession,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      bridge.registerIntent({
        workspaceIdentity: opened.workspaceIdentity,
        jobId: job.jobId,
        intentId: job.intentId,
        candidate: candidateValue,
        expectedRevision: job.revision,
        webContentsId: window.webContents.id,
      });
      await window.loadURL('data:text/html;charset=utf-8,<title>W93B DownloadItem</title>');
      await window.webContents.executeJavaScript(`(() => {
        const link = document.createElement('a');
        link.href = ${JSON.stringify(offer.sourceUrl)};
        link.download = 'w93b-runtime.epub';
        document.body.appendChild(link);
        link.click();
        link.remove();
      })()`);
      await bounded(itemDone, 'real DownloadItem done');
      try { await bounded(bridge.whenIdle(), 'Bridge durable completion'); }
      catch (error) { durabilityError = error; }

      job = store.getJob(options.jobId);
      inbox = store.listInboxReceipts({ state: 'pending' });
      bridgeBeforeDispose = bridge.snapshot();
      serviceBeforeShutdown = service.snapshot();
    } catch (error) {
      primaryError = error;
    } finally {
      try { if (observer) isolatedSession.removeListener('will-download', observer); }
      catch (error) { if (!primaryError) primaryError = error; }
      try { if (window && !window.isDestroyed()) window.destroy(); }
      catch (error) { if (!primaryError) primaryError = error; }
      if (bridge) {
        try { await bounded(bridge.dispose(), 'Bridge disposal', 10000); }
        catch (error) { disposeError = error; }
        bridgeAfterDispose = bridge.snapshot();
      }
      if (service) {
        try { await bounded(service.shutdown(), 'Service shutdown', 10000); }
        catch (error) { shutdownError = error; }
        serviceAfterShutdown = service.snapshot();
      }
      try { isolatedSession.webRequest.onBeforeRequest(null); }
      catch (error) { if (!primaryError) primaryError = error; }
      try {
        if (protocolIntercepted) protocolReleased = isolatedSession.protocol.uninterceptProtocol('https');
      } catch (error) { if (!primaryError) primaryError = error; }
    }

    return {
      moduleBinding: {
        contractSchema: productContract.JOB_SCHEMA,
        store: Store.name,
        service: Service.name,
        bridge: Bridge.name,
        importer: ImportService.name,
        resolvedFiles: {
          contract: requireProduct.resolve('./library-resource-contract.js'),
          store: requireProduct.resolve('./library-acquisition-store.js'),
          service: requireProduct.resolve('./library-acquisition-service.js'),
          bridge: requireProduct.resolve('./library-browser-acquisition-bridge.js'),
          importer: requireProduct.resolve('./library-import-service.js'),
        },
      },
      protocol: {
        apiAvailable: protocolIntercepted,
        released: protocolReleased,
        exactRequestCount: protocolRequests.filter(item => item.exact && item.method === 'GET').length,
        unexpectedRequestCount: unexpectedRequests.length
          + protocolRequests.filter(item => !item.exact || item.method !== 'GET').length,
      },
      willDownloadCount,
      downloadState,
      preparedPath,
      itemSavePath,
      preWriteIdentity,
      writerClosedIdentity,
      stagingIdentityPreserved: sameOwner(preWriteIdentity, writerClosedIdentity),
      payloadSize: payload.length,
      job: job ? {
        jobId: job.jobId,
        state: job.state,
        finalPath: job.finalPath,
        integritySha256: job.integrity?.sha256 || '',
        bytes: job.bytes,
      } : null,
      inbox: inbox.map(receipt => ({
        receiptId: receipt.receiptId,
        jobId: receipt.jobId,
        state: receipt.state,
        artifact: receipt.artifact,
      })),
      owners: {
        bridgeBeforeDispose,
        bridgeAfterDispose,
        serviceBeforeShutdown,
        serviceAfterShutdown,
        browserWindowDestroyed: !window || window.isDestroyed(),
        willDownloadListenersAfterDispose: isolatedSession.listenerCount('will-download'),
      },
      errors: {
        primary: errorFact(primaryError),
        durability: errorFact(durabilityError),
        dispose: errorFact(disposeError),
        shutdown: errorFact(shutdownError),
      },
    };
  }, input);
}

async function installShutdownObservation() {
  return app.evaluate(({ app: electronApp, session }) => {
    let turns = 0;
    let testHostExitScheduled = false;
    electronApp.on('will-quit', () => {
      turns += 1;
      const resources = globalThis.__MAZZ_E2E_RESOURCE_LEDGER__?.snapshot?.() || { active: [] };
      const scoped = (resources.active || []).filter(entry => (
        entry.type === 'library-acquisition'
        || entry.type === 'library-browser-download'
        || String(entry.owner || '').startsWith('library-acquisition:')
      ));
      const author = session.fromPartition('persist:mazz-author');
      const network = globalThis.__MAZZ_W93B_NETWORK_GUARD__?.snapshot?.() || {};
      const sessionRequests = globalThis.__MAZZ_W93B_SESSION_NETWORK__?.snapshot?.() || [];
      const payload = {
        schema: 'mazz.w93b-runtime-shutdown/v1',
        turn: turns,
        browserWillDownloadListeners: author.listenerCount('will-download'),
        acquisitionNetworkCalls: Number(network.acquisitionCallCount || 0),
        externalNodeNetworkCalls: Number(network.blockedExternalCount || 0),
        sessionExternalNetworkCalls: sessionRequests.length,
        acquisitionResourceOwners: scoped.map(entry => ({ type: entry.type, id: entry.id, owner: entry.owner })),
      };
      // The first will-quit is intentionally vetoed by the product while its
      // durable acquisition close runs. Emit only the second, converged turn.
      if (turns > 1 || (payload.browserWillDownloadListeners === 0 && scoped.length === 0)) {
        const line = `\nW93B_ACQUISITION_SHUTDOWN=${Buffer.from(JSON.stringify(payload)).toString('base64')}\n`;
        if (payload.turn > 1 && payload.browserWillDownloadListeners === 0
            && scoped.length === 0 && !testHostExitScheduled) {
          testHostExitScheduled = true;
          // Node's ordinary exit waits for Playwright's inspector, while the
          // controller waits for this Windows shell child. Write the evidence
          // synchronously, then have a detached Windows helper terminate only
          // this already-validated test tree; a self-signal is deferred until
          // after Electron has already frozen the event loop.
          process.getBuiltinModule('node:fs').writeSync(process.stdout.fd, line);
          process.getBuiltinModule('node:child_process').spawn(
            'taskkill.exe',
            ['/PID', String(process.pid), '/F'],
            { detached: true, stdio: 'ignore', windowsHide: true },
          ).unref();
          return;
        }
        process.stdout.write(line);
      }
    });
    return {
      browserWillDownloadListeners: session.fromPartition('persist:mazz-author').listenerCount('will-download'),
    };
  });
}

function parseShutdownObservation() {
  const matches = [...stdout.matchAll(/W93B_ACQUISITION_SHUTDOWN=([A-Za-z0-9+/=]+)/g)];
  assert.ok(matches.length, 'graceful exit did not publish the converged acquisition shutdown boundary');
  return JSON.parse(Buffer.from(matches.at(-1)[1], 'base64').toString('utf8'));
}

function captureProcessOutput() {
  const child = app.process();
  child?.stdout?.on('data', chunk => { stdout += String(chunk); });
  child?.stderr?.on('data', chunk => { stderr += String(chunk); });
}

function scanRuntimeErrors() {
  const combined = `${stdout}\n${stderr}`;
  const patterns = [
    /\b(?:uncaught exception|unhandled rejection|TypeError|ReferenceError)\b/i,
    /\[library-acquisition\]\s+(?:startup|quit)\s+hold/i,
    /LIBRARY_ACQUISITION_(?:STARTUP|QUIT)_/,
  ];
  for (const line of combined.split(/\r?\n/)) {
    if (patterns.some(pattern => pattern.test(line))) runtimeErrors.push(line.trim());
  }
  assert.deepEqual(runtimeErrors, [], `runtime errors:\n${runtimeErrors.join('\n')}`);
}

const report = {
  schema: 'mazz.w93b-library-acquisition-runtime/v1',
  mode: MODE,
  executable: PACKAGED ? slash(EXECUTABLE) : null,
  productBinding: null,
  startup: null,
  inbox: null,
  library: null,
  downloadItem: null,
  shutdown: null,
  cleanup: null,
  verdict: 'RUNNING',
};

try {
  phase = 'product-binding';
  if (PACKAGED) assert.equal(fs.existsSync(EXECUTABLE), true, `packaged executable missing: ${EXECUTABLE}`);
  report.productBinding = assertProductBinding();
  phase = 'fixture-seed';
  const seed = await seedDurableAcquisition();
  const downloadBytes = await minimalEpub();
  const downloadCandidate = fixtureCandidate('browser-download', downloadBytes);
  prepareSourceBootstrap();

  const launch = {
    args: [...(PACKAGED ? [] : [BOOTSTRAP]), ...NETWORK_BLOCK_SWITCHES],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: USER_DATA,
      MAZZ_E2E_WORKSPACE: WORKSPACE,
      MAZZ_E2E_DISABLE_GPU: '1',
      MAZZ_W93B_PRODUCT_ROOT: ROOT,
      ...(BOOTSTRAP ? { MAZZ_W93B_STARTUP_GATE_ROOT: BOOTSTRAP } : {}),
    },
    timeout: 120000,
  };
  if (PACKAGED) launch.executablePath = EXECUTABLE;
  phase = 'electron-launch';
  app = await electron.launch(launch);
  captureProcessOutput();
  phase = 'startup-second-instance';
  const secondInstance = await exerciseSourceSecondInstanceDuringStartup(launch.env);

  phase = 'first-window';
  const page = await app.firstWindow({ timeout: 120000 });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => runtimeErrors.push(`[pageerror] ${error.stack || error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!/Autofill|SharedArrayBuffer|ERR_FILE_NOT_FOUND|ffmpeg_common/i.test(text)) {
      runtimeErrors.push(`[console.error] ${text}`);
    }
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz && window.MazzCommands && window.MazzShell));

  phase = 'network-baseline';
  const installed = await installRuntimeNetworkProbe();
  assert.deepEqual(installed.guard.hookErrors, [], `network guard hook failures: ${installed.guard.hookErrors.join(', ')}`);
  assert.equal(installed.guard.acquisitionCallCount, 0,
    `${MODE} acquisition constructor/startup recovery attempted DNS/socket/HTTP before the baseline`);
  assert.equal(installed.guard.blockedExternalCount, 0,
    `${MODE} product attempted external Node HTTP/DNS before the baseline`);
  assert.equal(installed.sessionRequests.length, 0,
    `${MODE} renderer/session attempted external HTTP(S) while installing the baseline`);
  const beforeFirstList = await networkSnapshot('first-list');
  assertNoAcquisitionNetwork(installed, beforeFirstList, 'startup network baseline');
  const startupResources = await page.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const startupAcquisitionOwners = acquisitionResourceOwners(startupResources);
  assert.deepEqual(startupAcquisitionOwners, [],
    'acquisition/Browser resource owner existed at the trusted-shell baseline');
  phase = 'startup-recovery-facts';
  const startupLayout = acquisitionLayout();
  assertSeededLayout(startupLayout, seed, 'startup');
  const startupFacts = readDurableAcquisition(seed);
  assert.equal(startupFacts.awaiting.state, 'paused');
  assert.equal(startupFacts.awaiting.retryFrom, 'awaiting-import');
  assert.equal(startupFacts.awaiting.error?.code, 'APP_RESTART_RECOVERY');
  assert.equal(startupFacts.recovery.state, 'paused');
  assert.equal(startupFacts.recovery.retryFrom, 'downloading');
  assert.equal(startupFacts.recovery.error?.code, 'APP_RESTART_RECOVERY');
  assert.equal(startupFacts.recovery.bytes.received, seed.partialSize);
  assert.equal(startupFacts.receipt.state, 'pending');

  phase = 'trusted-inbox-list';
  const inbox = await page.evaluate(workspacePath => window.mazz.invoke('library:acquisitionInboxList', {
    workspacePath,
    state: 'pending',
  }), slash(WORKSPACE));
  assert.deepEqual(Object.keys(inbox).sort(), [
    'receipts', 'workspaceIdentity', 'workspacePath', 'workspaceToken',
  ]);
  assert.equal(Array.isArray(inbox.receipts), true);
  assert.equal(inbox.receipts.length, 1);
  assert.equal(inbox.receipts[0].receiptId, seed.receiptId);
  assert.equal(inbox.receipts[0].artifact.sha256, seed.digest);
  assert.equal(inbox.receipts[0].artifact.size, seed.size);
  assert.equal(samePath(inbox.receipts[0].artifact.path, seed.finalPath), true);
  assert.equal(samePath(inbox.workspacePath, WORKSPACE), true);
  assert.equal(inbox.workspaceIdentity, contract.deriveWorkspaceIdentity(WORKSPACE));
  assert.equal(typeof inbox.workspaceToken, 'string');
  assert.ok(inbox.workspaceToken.length > 0);
  assertPlainMetadata(inbox);
  const afterFirstList = await networkSnapshot('library-open');
  assertNoAcquisitionNetwork(beforeFirstList, afterFirstList, 'first trusted Inbox list');

  phase = 'library-durable-drain';
  await page.evaluate(async () => {
    await Promise.all([
      window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
      window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
    ]);
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
    await window.MazzCommands.execute('file.newLibrary');
  });
  await page.waitForFunction(() => {
    const ctl = window.__activeLibraryCtl;
    const binding = ctl?.repositoryBinding;
    return Boolean(ctl && binding && binding.repository?.identity?.canonical
      && !binding.acquisitionDrain && binding.pending?.size === 0);
  });
  const opened = await page.evaluate(() => {
    const ctl = window.__activeLibraryCtl;
    return {
      workspace: ctl.repositoryBinding.repository.identity.canonical,
      pendingOperations: ctl.repositoryBinding.pending.size,
      acquisitionDrainActive: Boolean(ctl.repositoryBinding.acquisitionDrain),
      shelfBooks: ctl.shelf?.snapshot?.total ?? null,
      shelfBook: ctl.shelf?.records?.[0] ? {
        id: ctl.shelf.records[0].id,
        path: ctl.shelf.records[0].path,
        sourcePath: ctl.shelf.records[0].sourcePath,
        sourceHash: ctl.shelf.records[0].sourceHash,
        contentHash: ctl.shelf.records[0].contentHash,
      } : null,
    };
  });
  assert.equal(samePath(opened.workspace, WORKSPACE), true);
  assert.equal(opened.pendingOperations, 0);
  assert.equal(opened.acquisitionDrainActive, false);
  assert.equal(opened.shelfBooks, 1);
  assert.equal(opened.shelfBook?.id, `blob-sha256-${seed.digest}`);
  assert.equal(opened.shelfBook?.sourceHash, seed.digest);
  assert.equal(opened.shelfBook?.contentHash, seed.digest);
  assert.equal(samePath(opened.shelfBook?.path, seed.finalPath), true);
  assert.equal(samePath(opened.shelfBook?.sourcePath, seed.finalPath), true);
  let converged = readDurableAcquisition(seed);
  assert.equal(converged.awaiting.state, 'imported');
  assert.equal(converged.awaiting.bookId, `blob-sha256-${seed.digest}`);
  assert.equal(samePath(converged.awaiting.finalPath, seed.finalPath), true);
  assert.equal(converged.receipt.state, 'acknowledged');
  assert.equal(samePath(converged.receipt.artifact.path, seed.finalPath), true);
  assert.equal(converged.recovery.state, 'paused');
  assert.equal(converged.recovery.retryFrom, 'downloading');

  // A wake is only a hint. A deliberately poisonous payload must be ignored;
  // the renderer re-lists the now-empty durable Inbox and leaves the already
  // converged one-book shelf unchanged.
  phase = 'poison-wake-relist';
  await page.evaluate(() => {
    const binding = window.__activeLibraryCtl.repositoryBinding;
    const originalReady = binding.ready;
    let release;
    binding.ready = new Promise(resolve => { release = resolve; });
    window.__w93bInboxWakeGate = {
      release() {
        binding.ready = originalReady;
        release();
      },
    };
  });
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed());
    main?.webContents.send('mazz:event', {
      channel: 'library:acquisitionInboxReady',
      payload: { path: 'C:/must-not-be-trusted/book.epub', url: 'https://must-not-be-used.invalid/book.epub' },
    });
  });
  await page.waitForFunction(() => Boolean(window.__activeLibraryCtl?.repositoryBinding?.acquisitionDrain));
  await page.evaluate(() => window.__w93bInboxWakeGate.release());
  await page.waitForFunction(() => {
    const binding = window.__activeLibraryCtl?.repositoryBinding;
    return Boolean(binding && !binding.acquisitionDrain && binding.pending?.size === 0);
  });
  await page.evaluate(() => { delete window.__w93bInboxWakeGate; });
  const shelfAfterWake = await page.evaluate(() => window.__activeLibraryCtl?.shelf?.snapshot?.total ?? null);
  assert.equal(shelfAfterWake, 1, 'poison wake duplicated or replaced the durable shelf fact');
  const pendingAfterWake = await page.evaluate(workspacePath => window.mazz.invoke('library:acquisitionInboxList', {
    workspacePath,
    state: 'pending',
  }), slash(WORKSPACE));
  assert.deepEqual(pendingAfterWake.receipts, []);
  converged = readDurableAcquisition(seed);
  assert.equal(converged.awaiting.state, 'imported');
  assert.equal(converged.receipt.state, 'acknowledged');
  const afterLibrary = await networkSnapshot('pre-quit');
  assertNoAcquisitionNetwork(afterFirstList, afterLibrary, 'Library create + durable drain + wake replay');
  const afterLibraryLayout = acquisitionLayout();
  assertSeededLayout(afterLibraryLayout, seed, 'Library drain');

  phase = 'real-downloaditem-offline';
  const beforeDownloadItem = await networkSnapshot('downloaditem-offline');
  const downloadItem = await exerciseRealDownloadItem(downloadBytes, downloadCandidate);
  const { resolvedFiles: downloadModuleFiles, ...downloadModuleBinding } = downloadItem.moduleBinding;
  assert.deepEqual(downloadModuleBinding, {
    contractSchema: contract.JOB_SCHEMA,
    store: 'LibraryAcquisitionStore',
    service: 'LibraryAcquisitionService',
    bridge: 'LibraryBrowserAcquisitionBridge',
    importer: 'LibraryImportService',
  });
  for (const [name, filename] of Object.entries({
    contract: 'library-resource-contract.js',
    store: 'library-acquisition-store.js',
    service: 'library-acquisition-service.js',
    bridge: 'library-browser-acquisition-bridge.js',
    importer: 'library-import-service.js',
  })) {
    assert.equal(samePath(downloadModuleFiles[name], path.join(PRODUCT_MAIN_ROOT, filename)), true,
      `${MODE} DownloadItem coordinate loaded ${name} outside the bound product source`);
  }
  assert.deepEqual(downloadItem.errors, {
    primary: null,
    durability: null,
    dispose: null,
    shutdown: null,
  });
  assert.deepEqual(downloadItem.protocol, {
    apiAvailable: true,
    released: true,
    exactRequestCount: 1,
    unexpectedRequestCount: 0,
  });
  assert.equal(downloadItem.willDownloadCount, 1,
    'the isolated coordinate did not traverse one real Electron will-download event');
  assert.equal(downloadItem.downloadState, 'completed');
  assert.equal(downloadItem.preWriteIdentity?.size, 0,
    'the coordinator did not hand Chromium its exclusively pre-created empty staging file');
  assert.equal(downloadItem.writerClosedIdentity?.size, downloadBytes.length);
  assert.equal(downloadItem.stagingIdentityPreserved, false,
    'this Electron build did not exercise Chromium\'s temporary-file to final-savePath hand-off');
  assert.equal(samePath(downloadItem.itemSavePath, downloadItem.preparedPath), true,
    'DownloadItem did not retain the coordinator-selected staging path');
  assert.equal(downloadItem.payloadSize, downloadBytes.length);
  assert.equal(downloadItem.job?.jobId, DOWNLOAD_JOB_ID);
  assert.equal(downloadItem.job?.state, 'awaiting-import');
  assert.equal(downloadItem.job?.integritySha256, sha256(downloadBytes));
  assert.deepEqual(downloadItem.job?.bytes, { received: downloadBytes.length, total: downloadBytes.length });
  assert.equal(downloadItem.inbox.length, 1);
  assert.equal(downloadItem.inbox[0].jobId, DOWNLOAD_JOB_ID);
  assert.equal(downloadItem.inbox[0].state, 'pending');
  assert.equal(downloadItem.inbox[0].artifact.sha256, sha256(downloadBytes));
  assert.equal(downloadItem.inbox[0].artifact.size, downloadBytes.length);
  assert.equal(samePath(downloadItem.inbox[0].artifact.path, downloadItem.job.finalPath), true);
  assert.deepEqual(downloadItem.owners.bridgeBeforeDispose, {
    attached: true,
    disposed: false,
    pendingIntentCount: 0,
    activeItemCount: 0,
    pendingCompletionCount: 0,
  });
  assert.deepEqual(downloadItem.owners.bridgeAfterDispose, {
    attached: false,
    disposed: true,
    pendingIntentCount: 0,
    activeItemCount: 0,
    pendingCompletionCount: 0,
  });
  assert.equal(downloadItem.owners.serviceBeforeShutdown?.activeCount, 0);
  assert.equal(downloadItem.owners.serviceBeforeShutdown?.browserActiveCount, 0);
  assert.equal(downloadItem.owners.serviceAfterShutdown?.accepting, false);
  assert.equal(downloadItem.owners.serviceAfterShutdown?.activeCount, 0);
  assert.equal(downloadItem.owners.serviceAfterShutdown?.browserActiveCount, 0);
  assert.equal(downloadItem.owners.browserWindowDestroyed, true);
  assert.equal(downloadItem.owners.willDownloadListenersAfterDispose, 0);

  const downloadStore = new LibraryAcquisitionStore({
    workspacePath: DOWNLOAD_WORKSPACE,
    recoverOnOpen: false,
  });
  const durableDownloadJob = downloadStore.getJob(DOWNLOAD_JOB_ID);
  const durableDownloadInbox = downloadStore.listInboxReceipts({ state: 'pending' });
  assert.equal(durableDownloadJob?.state, 'awaiting-import');
  assert.equal(samePath(durableDownloadJob?.finalPath, downloadItem.job.finalPath), true);
  assert.equal(durableDownloadInbox.length, 1);
  assert.equal(samePath(durableDownloadInbox[0].artifact.path, durableDownloadJob.finalPath), true);
  const verifiedDownload = await verifyPayload({
    filePath: durableDownloadJob.finalPath,
    format: 'epub',
    declaredChecksum: `sha256:${sha256(downloadBytes)}`,
    expectedSize: downloadBytes.length,
  });
  assert.equal(verifiedDownload.sha256, sha256(downloadBytes));
  assert.equal(verifiedDownload.size, downloadBytes.length);
  const afterDownloadItem = await networkSnapshot('post-downloaditem');
  assertNoAcquisitionNetwork(beforeDownloadItem, afterDownloadItem,
    'real DownloadItem isolated buffer-protocol coordinate');

  phase = 'resource-owner-gate';
  const resources = await page.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const acquisitionOwners = acquisitionResourceOwners(resources);
  assert.deepEqual(acquisitionOwners, []);

  phase = 'library-close';
  await page.evaluate(async () => {
    const activeId = window.MazzShell.tabs.activeId;
    await window.MazzShell.closeTabFlow(activeId);
  });
  await page.waitForFunction(() => window.MazzModules.get('library')._forTests.instances.size === 0);
  const shutdownInitial = await installShutdownObservation();
  assert.equal(shutdownInitial.browserWillDownloadListeners, 1,
    'authorized Browser acquisition bridge was not attached after awaited startup');

  report.startup = {
    firstWindowAfterRecovery: true,
    sourcePreMainGuard: !PACKAGED,
    acquisitionNetworkCalls: beforeFirstList.guard.acquisitionCallCount,
    blockedNonAcquisitionExternalCalls: beforeFirstList.guard.blockedExternalCount
      - beforeFirstList.guard.acquisitionCallCount,
    sessionExternalCallsAfterProbe: beforeFirstList.sessionRequests.length,
    acquisitionResourceOwnersAtBaseline: startupAcquisitionOwners.length,
    secondInstance,
    layout: startupLayout,
    recoveredJobs: {
      awaitingImport: {
        state: startupFacts.awaiting.state,
        retryFrom: startupFacts.awaiting.retryFrom,
        errorCode: startupFacts.awaiting.error?.code,
      },
      downloading: {
        state: startupFacts.recovery.state,
        retryFrom: startupFacts.recovery.retryFrom,
        errorCode: startupFacts.recovery.error?.code,
        retainedBytes: startupFacts.recovery.bytes.received,
      },
    },
  };
  report.inbox = {
    trustedShellFirstList: true,
    pendingCount: inbox.receipts.length,
    metadataOnly: true,
    workspaceBound: true,
    durablePathRoundTrip: true,
    receiptId: seed.receiptId,
    finalState: converged.receipt.state,
    jobFinalState: converged.awaiting.state,
    stableBookId: converged.awaiting.bookId,
  };
  report.library = {
    command: 'file.newLibrary',
    durableDrainSettled: true,
    wakePayloadIgnored: true,
    shelfBooks: shelfAfterWake,
    acquisitionNetworkDelta: afterDownloadItem.guard.acquisitionCallCount - beforeFirstList.guard.acquisitionCallCount,
    externalNodeNetworkDelta: afterDownloadItem.guard.blockedExternalCount - beforeFirstList.guard.blockedExternalCount,
    sessionNetworkDelta: afterDownloadItem.sessionRequests.length - beforeFirstList.sessionRequests.length,
    acquisitionResourceOwnersBeforeQuit: acquisitionOwners.length,
  };
  report.downloadItem = {
    realWillDownload: true,
    productModules: `${MODE}:${downloadItem.moduleBinding.bridge}`,
    offlineTransport: 'isolated-session-buffer-protocol',
    syntheticHttpsRequests: downloadItem.protocol.exactRequestCount,
    unexpectedRequests: downloadItem.protocol.unexpectedRequestCount,
    precreatedSavePathBytes: downloadItem.preWriteIdentity.size,
    writerClosedBytes: downloadItem.writerClosedIdentity.size,
    chromiumFinalIdentityHandoff: !downloadItem.stagingIdentityPreserved,
    durableJobState: durableDownloadJob.state,
    durableInboxCount: durableDownloadInbox.length,
    bridgeOwnersAfterDispose: downloadItem.owners.bridgeAfterDispose.activeItemCount
      + downloadItem.owners.bridgeAfterDispose.pendingCompletionCount,
    serviceOwnersAfterShutdown: downloadItem.owners.serviceAfterShutdown.activeCount,
  };

  phase = 'graceful-quit';
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {});
  await app.close();
  appClosed = true;
  await new Promise(resolve => setTimeout(resolve, 100));
  phase = 'shutdown-boundary';
  report.shutdown = parseShutdownObservation();
  assert.equal(report.shutdown.browserWillDownloadListeners, 0);
  assert.equal(report.shutdown.acquisitionNetworkCalls, 0);
  assert.equal(report.shutdown.externalNodeNetworkCalls, 0);
  assert.equal(report.shutdown.sessionExternalNetworkCalls, 0);
  assert.deepEqual(report.shutdown.acquisitionResourceOwners, []);
  assert.ok(report.shutdown.turn >= 2,
    'product did not traverse the two-stage, non-timeout will-quit durability gate');
  assertSeededLayout(acquisitionLayout(), seed, 'process exit');
  scanRuntimeErrors();
  phase = 'complete';
  report.verdict = 'PASS';
} catch (error) {
  failure = error;
  failedPhase = phase;
  report.verdict = 'FAIL';
} finally {
  phase = 'cleanup';
  if (app && !appClosed) {
    try {
      let timeoutId;
      const closeState = await Promise.race([
        app.close().then(() => 'closed', () => 'close-error'),
        new Promise(resolve => { timeoutId = setTimeout(() => resolve('timeout'), 15000); }),
      ]);
      clearTimeout(timeoutId);
      if (closeState === 'timeout') app.process()?.kill?.();
    } catch {
      try { app.process()?.kill?.(); } catch {}
    }
  }
  await new Promise(resolve => setTimeout(resolve, 250));
  for (const target of [USER_DATA, WORKSPACE, DOWNLOAD_WORKSPACE, BOOTSTRAP].filter(Boolean)) {
    try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); } catch {}
  }
  cleanupState = {
    userDataRemoved: !fs.existsSync(USER_DATA),
    workspaceRemoved: !fs.existsSync(WORKSPACE),
    downloadWorkspaceRemoved: !fs.existsSync(DOWNLOAD_WORKSPACE),
    bootstrapRemoved: !BOOTSTRAP || !fs.existsSync(BOOTSTRAP),
  };
  report.cleanup = cleanupState;
}

const expectedCleanup = {
  userDataRemoved: true,
  workspaceRemoved: true,
  downloadWorkspaceRemoved: true,
  bootstrapRemoved: true,
};
if (!failure) {
  try { assert.deepEqual(cleanupState, expectedCleanup); }
  catch (error) {
    failure = error;
    failedPhase = 'cleanup';
    report.verdict = 'FAIL';
  }
}
if (failure) {
  const diagnostic = {
    schema: 'mazz.w93b-library-acquisition-runtime-failure/v1',
    mode: MODE,
    phase: failedPhase || 'unknown',
    error: compactError(failure),
    stdoutTail: diagnosticTail(stdout),
    stderrTail: diagnosticTail(stderr),
    runtimeErrors: runtimeErrors.map(error => diagnosticTail(error, 4, 1000)).slice(-20),
    cleanup: cleanupState,
  };
  console.error(`W93B_RUNTIME_FAILURE=${JSON.stringify(diagnostic)}`);
  const compact = new Error(`W93B ${MODE} runtime failed at ${diagnostic.phase}: ${diagnostic.error.message}`);
  if (diagnostic.error.code) compact.code = diagnostic.error.code;
  throw compact;
}
console.log(`W93B_RUNTIME_RESULT=${JSON.stringify(report)}`);
console.log(`W93B Library acquisition ${MODE} runtime: PASS`);
