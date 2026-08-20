// Real-file playback regression probe. Paths are supplied by environment and never copied into the workspace.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const inputs = [process.env.MAZZ_REAL_VIDEO_AVC, process.env.MAZZ_REAL_VIDEO_HEVC].filter(Boolean);
const gpuMode = process.env.MAZZ_REAL_VIDEO_GPU_MODE || 'hardware';
const extraArgs = String(process.env.MAZZ_REAL_VIDEO_EXTRA_ARGS || '').split(/\s+/).filter(Boolean);
const seekSeconds = String(process.env.MAZZ_REAL_VIDEO_SEEKS || '').split(',').map(Number);
const expectations = String(process.env.MAZZ_REAL_VIDEO_EXPECT || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
if (!inputs.length) throw new Error('Set MAZZ_REAL_VIDEO_AVC and/or MAZZ_REAL_VIDEO_HEVC');
for (const input of inputs) {
  if (!fs.existsSync(input)) throw new Error(`Real video is missing: ${input}`);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-real-video-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-real-video-ws-'));
const shotDir = path.join(root, 'tests', 'e2e', 'shots');
fs.mkdirSync(shotDir, { recursive: true });
const mainErrors = [];
const rendererErrors = [];
const graphicsLogs = [];
let app;

try {
  app = await electron.launch({
    args: [root, ...extraArgs],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: gpuMode,
    },
    timeout: 120000,
  });
  app.process()?.stdout?.on('data', chunk => {
    const text = String(chunk);
    if (/图形.*模式/.test(text)) graphicsLogs.push(text.trim());
    if (/\b(?:uncaught|TypeError|ReferenceError|Error:)\b/i.test(text)) mainErrors.push(text.trim());
  });
  app.process()?.stderr?.on('data', chunk => {
    const text = String(chunk);
    if (/Unsupported pixel format|\b(?:uncaught|TypeError|ReferenceError|Error:)\b/i.test(text)) mainErrors.push(text.trim());
  });

  const win = await app.firstWindow({ timeout: 120000 });
  win.on('pageerror', error => rendererErrors.push(error.message));
  win.on('console', message => {
    if (message.type() === 'error') rendererErrors.push(message.text());
  });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
  });

  const results = [];
  const graphicsMode = await win.evaluate(() => window.mazz.invoke('app:graphicsMode'));
  for (const [index, input] of inputs.entries()) {
    await win.evaluate(target => window.MazzShell.openFile(target), input);
    await win.waitForFunction(target => {
      const media = [...document.querySelectorAll('video.mz-media')]
        .find(item => item.getBoundingClientRect().width > 0);
      return !!media && decodeURIComponent(media.currentSrc || media.src || '').includes(target.replace(/\\/g, '/'));
    }, input, { timeout: 30000 });
    await win.waitForFunction(() => {
      const media = [...document.querySelectorAll('video.mz-media')]
        .find(item => item.getBoundingClientRect().width > 0);
      return media?.readyState >= 1 && Number.isFinite(media.duration);
    }, null, { timeout: 30000 });
    await win.evaluate(async targetTime => {
      const media = [...document.querySelectorAll('video.mz-media')]
        .find(item => item.getBoundingClientRect().width > 0);
      window.__realVideoFrames = 0;
      const count = () => {
        window.__realVideoFrames += 1;
        if (window.__realVideoFrames < 30) media.requestVideoFrameCallback?.(count);
      };
      media.requestVideoFrameCallback?.(count);
      media.muted = true;
      if (Number.isFinite(targetTime) && targetTime >= 0 && targetTime < media.duration) {
        await new Promise(resolve => {
          const done = () => resolve();
          media.addEventListener('seeked', done, { once: true });
          media.currentTime = targetTime;
          setTimeout(done, 5000);
        });
      }
      await media.play().catch(() => {});
    }, Number.isFinite(seekSeconds[index]) ? seekSeconds[index] : 60);
    await win.waitForTimeout(6000);
    const result = await win.evaluate(inputPath => {
      const media = [...document.querySelectorAll('video.mz-media')]
        .find(item => item.getBoundingClientRect().width > 0);
      const quality = media.getVideoPlaybackQuality?.();
      const probe = document.createElement('video');
      const root = media.closest('.mz-player');
      const controls = root?.querySelector('.mz-controls');
      const bar = root?.querySelector('.mz-bar');
      const rectOf = element => {
        const rect = element?.getBoundingClientRect?.();
        return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
      };
      return {
        path: inputPath,
        readyState: media.readyState,
        networkState: media.networkState,
        error: media.error ? { code: media.error.code, message: media.error.message } : null,
        duration: media.duration,
        currentTime: media.currentTime,
        paused: media.paused,
        videoWidth: media.videoWidth,
        videoHeight: media.videoHeight,
        totalVideoFrames: quality?.totalVideoFrames ?? null,
        droppedVideoFrames: quality?.droppedVideoFrames ?? null,
        frameCallbacks: window.__realVideoFrames,
        hevcCanPlay: probe.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') || '',
        blackFrameOverlay: !!document.querySelector('.mz-decode-failure'),
        controlSurface: {
          rootClass: root?.className || '',
          controlsClass: controls?.className || '',
          opacity: controls ? getComputedStyle(controls).opacity : null,
          pointerEvents: controls ? getComputedStyle(controls).pointerEvents : null,
          controlsRect: rectOf(controls),
          barRect: rectOf(bar),
          stageRect: rectOf(root?.querySelector('.mz-stage')),
          density: controls?.dataset.density || null,
          snapshot: root?.__playerControlSurface?.snapshot?.() || null,
          fullscreen: !!document.fullscreenElement,
        },
      };
    }, input);
    const expectation = expectations[index] || 'frames';
    result.expectation = expectation;
    result.pass = expectation === 'overlay'
      ? result.blackFrameOverlay && result.paused
      : result.videoWidth > 0
        && result.videoHeight > 0
        && Number(result.totalVideoFrames || 0) > 0
        && Number(result.frameCallbacks || 0) > 0
        && !result.blackFrameOverlay
        && !result.error;
    results.push(result);
    await win.screenshot({ path: path.join(shotDir, `real-video-${index + 1}.png`) });
  }
  console.log(JSON.stringify({ graphicsMode, results, graphicsLogs, mainErrors, rendererErrors }, null, 2));
  const failures = results.filter(result => !result.pass);
  if (failures.length || mainErrors.length || rendererErrors.length) {
    throw new Error(`Real video regression failed: ${failures.length} playback, ${mainErrors.length} main, ${rendererErrors.length} renderer`);
  }
} finally {
  try { await app?.close(); } catch {}
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
