// W71: prove the vendored ffmpeg core inside the packaged Windows runtime.
import { _electron as electron } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe');
if (!fs.existsSync(executablePath)) throw new Error(`Packaged app is missing: ${executablePath}`);

const evidenceDir = path.join(root, 'docs', 'engineering', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-ffmpeg-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-ffmpeg-ws-'));
let app;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

try {
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
      NODE_ENV: 'test',
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  win.setDefaultTimeout(120000);
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
  });

  const runtime = await win.evaluate(async () => {
    const moduleUrl = new URL('lib/ffmpeg-transcode.js', document.baseURI).href;
    const mod = await import(moduleUrl);
    const makeWav = () => {
      const sampleRate = 8000;
      const samples = 1600;
      const bytes = new Uint8Array(44 + samples * 2);
      const view = new DataView(bytes.buffer);
      const word = (offset, value) => {
        for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index);
      };
      word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVE');
      word(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      word(36, 'data'); view.setUint32(40, samples * 2, true);
      for (let index = 0; index < samples; index++) {
        view.setInt16(44 + index * 2, Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 6000), true);
      }
      return bytes;
    };

    const logs = [];
    const first = await mod.ensureFFmpeg();
    const onLog = ({ message }) => logs.push(String(message || ''));
    first.on('log', onLog);
    const versionExitCode = await first.exec(['-version']);
    first.off('log', onLog);

    const progress = [];
    const mp3 = await mod.transcode(makeWav(), 'wav', {
      toAudio: true,
      onProgress: ratio => progress.push(ratio),
    });
    await mod.disposeFFmpeg();

    const second = await mod.ensureFFmpeg();
    const reloadLogs = [];
    const onReloadLog = ({ message }) => reloadLogs.push(String(message || ''));
    second.on('log', onReloadLog);
    const reloadExitCode = await second.exec(['-version']);
    second.off('log', onReloadLog);
    await mod.disposeFFmpeg();

    return {
      versionExitCode,
      reloadExitCode,
      reloadedWithNewInstance: first !== second,
      mp3Bytes: mp3.byteLength,
      mp3MagicHex: [...mp3.slice(0, 4)].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase(),
      progressEvents: progress.length,
      logs,
      reloadLogs,
    };
  });

  if (runtime.versionExitCode !== 0 || runtime.reloadExitCode !== 0) {
    throw new Error(`ffmpeg -version failed: ${JSON.stringify(runtime)}`);
  }
  if (!runtime.reloadedWithNewInstance) throw new Error('disposeFFmpeg did not release the worker instance');
  if (runtime.mp3Bytes < 100) throw new Error(`Synthetic WAV transcode produced ${runtime.mp3Bytes} bytes`);
  const allLogs = [...runtime.logs, ...runtime.reloadLogs];
  const version = allLogs.find(line => /^ffmpeg version /i.test(line)) || '';
  const configuration = allLogs.find(line => /^configuration:/i.test(line)) || '';
  if (!version || !configuration) throw new Error(`Runtime identity was not reported: ${JSON.stringify(allLogs)}`);

  const coreJs = path.join(root, 'renderer', 'vendor', 'ffmpeg', 'ffmpeg-core.js');
  const coreWasm = path.join(root, 'renderer', 'vendor', 'ffmpeg', 'ffmpeg-core.wasm');
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    executable: 'release/win-unpacked/Mazz Editor.exe',
    assets: {
      coreJs: { bytes: fs.statSync(coreJs).size, sha256: sha256(coreJs) },
      coreWasm: { bytes: fs.statSync(coreWasm).size, sha256: sha256(coreWasm) },
    },
    runtime: {
      version,
      configuration,
      libraryVersions: allLogs.filter(line => /^lib(?:av|sw|post)/i.test(line)),
      versionExitCode: runtime.versionExitCode,
      reloadExitCode: runtime.reloadExitCode,
      reloadedWithNewInstance: runtime.reloadedWithNewInstance,
      syntheticWavToMp3: {
        outputBytes: runtime.mp3Bytes,
        magicHex: runtime.mp3MagicHex,
        progressEvents: runtime.progressEvents,
      },
    },
    conclusion: {
      packagedCoreLoads: true,
      realTranscodePasses: true,
      explicitDisposeAndReloadPasses: true,
      exactSourceAndBuildRecipeRecovered: false,
      releaseLicenseGate: 'OPEN',
    },
  };
  fs.writeFileSync(path.join(evidenceDir, 'W71_FFMPEG_RUNTIME.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ ok: true, version, configuration, ...evidence.conclusion }));
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
