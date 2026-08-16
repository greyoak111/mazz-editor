// tests/e2e/w71-media-runtime.mjs —— packaged AudioContext + GIF 成功/中断生命周期真激活
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedFixtures } from './fixtures.mjs';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_MEDIA_RUNTIME.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-media-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-media-ws-'));
await seedFixtures(workspace, workspace);
const audioPath = path.join(workspace, '测试音.wav');
const videoPath = path.join(workspace, 'w71-synthetic.webm');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  });

  const videoFixture = await win.evaluate(async targetPath => {
    const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('当前 packaged Chromium 不支持 WebM MediaRecorder');
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(12);
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    const stopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
    recorder.start(200);
    const startedAt = performance.now();
    await new Promise(resolve => {
      const frame = now => {
        const t = (now - startedAt) / 1000;
        ctx.fillStyle = `hsl(${Math.round(t * 150) % 360} 75% 45%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif';
        ctx.fillText(`W71 ${t.toFixed(1)}s`, 65, 100);
        if (t < 2.4) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
    recorder.stop();
    await stopped;
    stream.getTracks().forEach(track => track.stop());
    const blob = new Blob(chunks, { type: mimeType });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    await window.mazz.invoke('fs:writeFileBase64', { path: targetPath, base64: btoa(binary) });
    return { mimeType, bytes: bytes.length };
  }, videoPath);
  if (videoFixture.bytes < 1000) throw new Error(`合成 WebM 过小：${videoFixture.bytes}`);

  await win.evaluate(() => {
    const NativeAudioContext = window.AudioContext;
    const NativeMediaRecorder = window.MediaRecorder;
    window.__w71MediaProbe = { contexts: [], recorders: [] };
    window.AudioContext = class W71AudioContext extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        const record = { context: this, closeCalls: 0, resumeCalls: 0 };
        window.__w71MediaProbe.contexts.push(record);
        const nativeClose = this.close.bind(this);
        const nativeResume = this.resume.bind(this);
        this.close = (...closeArgs) => { record.closeCalls++; return nativeClose(...closeArgs); };
        this.resume = (...resumeArgs) => { record.resumeCalls++; return nativeResume(...resumeArgs); };
      }
    };
    window.MediaRecorder = class W71MediaRecorder extends NativeMediaRecorder {
      constructor(stream, options) {
        super(stream, options);
        const record = { recorder: this, stream, stopEvents: 0 };
        this.addEventListener('stop', () => { record.stopEvents++; });
        window.__w71MediaProbe.recorders.push(record);
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
    return media?.readyState >= 1 && media.duration > 0 && document.querySelector('.mz-meta')?.textContent.includes('kHz');
  }, null, { timeout: 30000 });
  await win.evaluate(() => document.querySelector('audio.mz-media')?.pause());
  await win.locator('.mz-player:has(audio.mz-media) [data-a=play]').click();
  try {
    await win.waitForFunction(() => document.querySelector('audio.mz-media')?.currentTime > 0.1
      && window.__w71MediaProbe.contexts.some(item => item.context.state === 'running'), null, { timeout: 10000 });
  } catch (error) {
    const state = await win.evaluate(() => ({
      media: (() => { const item = document.querySelector('audio.mz-media'); return item && { paused: item.paused, currentTime: item.currentTime, readyState: item.readyState, error: item.error?.code || 0 }; })(),
      contexts: window.__w71MediaProbe.contexts.map(item => ({ state: item.context.state, resumeCalls: item.resumeCalls, closeCalls: item.closeCalls })),
    }));
    throw new Error(`AudioContext 播放激活超时：${JSON.stringify(state)}；${error.message}`);
  }
  const audioRuntime = await win.evaluate(() => ({
    metadata: document.querySelector('.mz-meta')?.textContent || '',
    currentTime: document.querySelector('audio.mz-media')?.currentTime || 0,
    contexts: window.__w71MediaProbe.contexts.length,
    contextStates: window.__w71MediaProbe.contexts.map(item => item.context.state),
    resumeCalls: window.__w71MediaProbe.contexts.map(item => item.resumeCalls),
  }));
  if (!audioRuntime.contexts || !audioRuntime.metadata.includes('声道')) throw new Error(`AudioContext 未真实激活：${JSON.stringify(audioRuntime)}`);
  await win.evaluate(async () => {
    const tab = window.MazzShell.tabs.active;
    tab.forceClose = true;
    await window.MazzShell.closeTabFlow(tab.id);
  });
  await win.waitForFunction(() => window.__w71MediaProbe.contexts.every(item => item.context.state === 'closed'), null, { timeout: 10000 });
  const audioAfterClose = await win.evaluate(() => ({
    states: window.__w71MediaProbe.contexts.map(item => item.context.state),
    closeCalls: window.__w71MediaProbe.contexts.map(item => item.closeCalls),
  }));

  await win.evaluate(async targetPath => {
    await window.mazz.invoke('settings:set', { key: 'player.audioGain', value: 1 });
    await window.MazzShell.openFile(targetPath);
  }, videoPath);
  await win.waitForFunction(() => {
    const media = document.querySelector('video.mz-media');
    return media?.readyState >= 2 && media.videoWidth > 0 && media.duration > 0;
  }, null, { timeout: 30000 });
  await win.evaluate(() => document.querySelector('video.mz-media')?.pause());
  await win.locator('.mz-player:has(video.mz-media) [data-a=play]').click();
  await win.waitForFunction(() => document.querySelector('video.mz-media')?.currentTime > 0.15, null, { timeout: 10000 });
  const beforeGif = await win.evaluate(async () => {
    const dir = `${await window.mazz.invoke('settings:get', { key: 'workspace' })}/录制`;
    const files = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
    return files.filter(item => /\.gif$/i.test(item.name)).map(item => item.name);
  });
  const gifButton = win.locator('.mz-player:has(video.mz-media) [data-a=gif]');
  await gifButton.click();
  await win.waitForFunction(() => document.querySelector('[data-a=gif]')?.classList.contains('on')
    && window.__w71MediaProbe.recorders.at(-1)?.recorder.state === 'recording', null, { timeout: 10000 });
  await sleep(1300);
  await gifButton.click();
  await win.waitForFunction(() => window.__w71MediaProbe.recorders.at(-1)?.stopEvents === 1, null, { timeout: 10000 });
  let gifArtifact = null;
  const gifUntil = Date.now() + 180000;
  while (Date.now() < gifUntil && !gifArtifact) {
    gifArtifact = await win.evaluate(async previous => {
      const workspacePath = await window.mazz.invoke('settings:get', { key: 'workspace' });
      const dir = `${workspacePath}/录制`;
      const files = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
      const created = files.find(item => /\.gif$/i.test(item.name) && !previous.includes(item.name));
      if (!created) return null;
      const stat = await window.mazz.invoke('fs:stat', { path: created.path });
      const base64 = await window.mazz.invoke('fs:readFileBase64', { path: created.path });
      return { name: created.name, path: created.path, size: stat.size || 0, signature: atob(base64.slice(0, 8)).slice(0, 6) };
    }, beforeGif);
    if (!gifArtifact) await sleep(250);
  }
  if (!gifArtifact) {
    const state = await win.evaluate(() => ({
      button: document.querySelector('.mz-player:has(video.mz-media) [data-a=gif]')?.textContent || '',
      toasts: [...document.querySelectorAll('.mazz-toast,.toast')].map(item => item.textContent).slice(-5),
      recorder: (() => { const item = window.__w71MediaProbe.recorders.at(-1); return item && { state: item.recorder.state, stopEvents: item.stopEvents }; })(),
    }));
    throw new Error(`GIF 产物等待超时：${JSON.stringify(state)}`);
  }
  if (!/^GIF8[79]a$/.test(gifArtifact.signature) || gifArtifact.size < 100) {
    throw new Error(`GIF 产物无效：${JSON.stringify(gifArtifact)}`);
  }
  const successfulRecorder = await win.evaluate(() => {
    const item = window.__w71MediaProbe.recorders.at(-1);
    return { state: item.recorder.state, stopEvents: item.stopEvents, tracks: item.stream.getTracks().map(track => track.readyState) };
  });
  if (successfulRecorder.state !== 'inactive' || successfulRecorder.stopEvents !== 1
    || successfulRecorder.tracks.some(state => state !== 'ended')) {
    throw new Error(`GIF 成功路径未收尸：${JSON.stringify(successfulRecorder)}`);
  }

  await gifButton.click();
  await win.waitForFunction(() => window.__w71MediaProbe.recorders.at(-1)?.recorder.state === 'recording', null, { timeout: 10000 });
  const interruptedIndex = await win.evaluate(() => window.__w71MediaProbe.recorders.length - 1);
  await win.evaluate(async () => {
    const tab = window.MazzShell.tabs.active;
    tab.forceClose = true;
    await window.MazzShell.closeTabFlow(tab.id);
  });
  await win.waitForFunction(index => {
    const item = window.__w71MediaProbe.recorders[index];
    return item?.recorder.state === 'inactive' && item.stream.getTracks().every(track => track.readyState === 'ended');
  }, interruptedIndex, { timeout: 10000 });
  const interruptedRecorder = await win.evaluate(index => {
    const item = window.__w71MediaProbe.recorders[index];
    return { state: item.recorder.state, stopEvents: item.stopEvents, tracks: item.stream.getTracks().map(track => track.readyState) };
  }, interruptedIndex);
  await win.waitForFunction(activeCount => window.mazz.invoke('resources:snapshot')
    .then(value => value.activeCount === activeCount), baseline.activeCount, { timeout: 10000 });
  const finalResources = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    executablePath,
    syntheticVideo: videoFixture,
    audio: { ...audioRuntime, afterClose: audioAfterClose },
    gif: { artifact: gifArtifact, recorder: successfulRecorder },
    interruptedGif: interruptedRecorder,
    resources: { baseline: baseline.activeCount, final: finalResources.activeCount },
    realMediaDeviceUsed: false,
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try { await app?.close(); } catch {}
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
