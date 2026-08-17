// W71 C3: prove native packaged playback remains usable while the optional GIF path is sealed off.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidenceDir = path.resolve(process.env.MAZZ_W71_EVIDENCE_DIR
  || path.join(root, 'docs', 'engineering', 'evidence'));
const evidencePath = path.join(evidenceDir, 'W71_MEDIA_RUNTIME.json');
if (!fs.existsSync(executablePath)) throw new Error(`Packaged app is missing: ${executablePath}`);

function makeWav(seconds = 3, frequency = 440) {
  const sampleRate = 8000;
  const sampleCount = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + sampleCount * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index++) {
    buffer.writeInt16LE(Math.round(Math.sin(index / sampleRate * frequency * 2 * Math.PI) * 8000), 44 + index * 2);
  }
  return buffer;
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-media-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-media-ws-'));
const audioPath = path.join(workspace, 'w71-native-playback.wav');
fs.writeFileSync(audioPath, makeWav());
let app;

try {
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
    const NativeAudioContext = window.AudioContext;
    window.__w71AudioContexts = [];
    window.AudioContext = class W71AudioContext extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        const record = { context: this, closeCalls: 0, resumeCalls: 0 };
        window.__w71AudioContexts.push(record);
        const nativeClose = this.close.bind(this);
        const nativeResume = this.resume.bind(this);
        this.close = (...closeArgs) => { record.closeCalls++; return nativeClose(...closeArgs); };
        this.resume = (...resumeArgs) => { record.resumeCalls++; return nativeResume(...resumeArgs); };
      }
    };
  });

  const baseline = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  await win.evaluate(async targetPath => {
    await window.mazz.invoke('settings:set', { key: 'player.audioGain', value: 1.5 });
    await window.MazzShell.openFile(targetPath);
  }, audioPath);
  await win.waitForFunction(() => {
    const media = document.querySelector('audio.mz-media');
    return media?.readyState >= 1 && media.duration > 0;
  }, null, { timeout: 30000 });
  await win.evaluate(() => document.querySelector('audio.mz-media')?.pause());
  await win.locator('.mz-player:has(audio.mz-media) [data-a=play]').click();
  await win.waitForFunction(() => document.querySelector('audio.mz-media')?.currentTime > 0.1
    && window.__w71AudioContexts.some(item => item.context.state === 'running'), null, { timeout: 10000 });

  const runtime = await win.evaluate(() => ({
    currentTime: document.querySelector('audio.mz-media')?.currentTime || 0,
    metadata: document.querySelector('.mz-meta')?.textContent || '',
    gifButtonVisible: !!document.querySelector('.mz-player [data-a=gif]'),
    contexts: window.__w71AudioContexts.length,
    contextStates: window.__w71AudioContexts.map(item => item.context.state),
  }));
  if (!runtime.contexts || runtime.gifButtonVisible) {
    throw new Error(`Media runtime maturity mismatch: ${JSON.stringify(runtime)}`);
  }

  await win.evaluate(async () => {
    const tab = window.MazzShell.tabs.active;
    tab.forceClose = true;
    await window.MazzShell.closeTabFlow(tab.id);
  });
  await win.waitForFunction(() => window.__w71AudioContexts.every(item => item.context.state === 'closed'), null, { timeout: 10000 });
  await win.waitForFunction(activeCount => window.mazz.invoke('resources:snapshot')
    .then(snapshot => snapshot.activeCount === activeCount), baseline.activeCount, { timeout: 10000 });

  const afterClose = await win.evaluate(() => ({
    contextStates: window.__w71AudioContexts.map(item => item.context.state),
    closeCalls: window.__w71AudioContexts.map(item => item.closeCalls),
  }));
  const finalResources = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const evidence = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    executablePath,
    nativePlayback: { ...runtime, afterClose },
    optionalFfmpegRuntime: {
      mode: 'DEFERRED_NOT_BUNDLED',
      gifEntryHidden: !runtime.gifButtonVisible,
      futureActivationGate: 'OPEN',
    },
    resources: { baseline: baseline.activeCount, final: finalResources.activeCount },
    realMediaDeviceUsed: false,
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try { await app?.close(); } catch {}
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
