// tests/e2e/probe-codecs.mjs —— Electron 解码真相实证：canPlayType 矩阵 + 真 H264 三态试播
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-codec-user-'));
const WS = '/tmp/mkvtest';
const log = (...a) => console.log('[codec]', ...a);

let app, win;
async function main() {
  app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
  win = await app.firstWindow();
  await win.waitForFunction(() => !!window.mazz, null, { timeout: 15000 });
  await win.waitForTimeout(500);

  // 1：canPlayType 矩阵（含专利编解码探测）
  const matrix = await win.evaluate(() => {
    const v = document.createElement('video');
    const probes = {
      'h264-baseline': 'video/mp4; codecs="avc1.42E01E"',
      'h264-high': 'video/mp4; codecs="avc1.640028"',
      'hevc-main': 'video/mp4; codecs="hev1.1.6.L93.B0"',
      'hevc-main10': 'video/mp4; codecs="hev1.2.4.L93.B0"',
      'vp8': 'video/webm; codecs="vp8"',
      'vp9': 'video/webm; codecs="vp9"',
      'av1': 'video/mp4; codecs="av01.0.04M.08"',
      'aac-lc': 'audio/mp4; codecs="mp4a.40.2"',
      'mp3': 'audio/mpeg',
      'flac-mp4': 'audio/mp4; codecs="flac"',
      'opus': 'audio/ogg; codecs="opus"',
      'h264-mkv': 'video/x-matroska; codecs="avc1.640028"',
      'hevc-mkv': 'video/x-matroska; codecs="hev1.1.6.L93.B0"',
    };
    const r = {};
    for (const [k, s] of Object.entries(probes)) r[k] = v.canPlayType(s) || '(空)';
    return r;
  });
  log('canPlayType 矩阵:', JSON.stringify(matrix, null, 1));

  // 2：真 H264 三态试播（faststart mp4 / 非 faststart mp4 / mkv）
  for (const f of ['h264-fast.mp4', 'h264-slow.mp4', 'h264.mkv', 'hevc.mp4', 'aac.mp4', 'aac.aac']) {
    const r = await win.evaluate(async ([p]) => {
      const v = document.createElement('video');
      v.muted = true;
      v.src = 'file://' + p;
      const t0 = Date.now();
      return await new Promise(res => {
        const to = setTimeout(() => res({ state: 'timeout', rs: v.readyState, err: v.error?.code || 0, ms: Date.now() - t0 }), 8000);
        v.onloadedmetadata = () => { clearTimeout(to); res({ state: 'metadata-ok', rs: v.readyState, dur: +v.duration.toFixed(2), vw: v.videoWidth, ms: Date.now() - t0 }); };
        v.onerror = () => { clearTimeout(to); res({ state: 'error', err: v.error?.code || 0, rs: v.readyState, ms: Date.now() - t0 }); };
      });
    }, [WS + '/' + f]);
    log(`试播 ${f}:`, JSON.stringify(r));
  }
}
main().catch(e => { console.error('[codec] 崩溃:', e.message); process.exitCode = 1; })
  .finally(async () => {
    try { if (app) await Promise.race([app.close(), new Promise(r => setTimeout(r, 8000))]); } catch {}
    await new Promise(r => setTimeout(r, 400));
    try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
