// tests/e2e/probe-sameorigin.mjs —— 页面同源化冒烟：app 起/本地片协议播/P2P流 metadata-ok
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-so-user-'));
const WS = '/tmp/mkvtest';
const log = (...a) => console.log('[so]', ...a);
const BBB = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337';

let app, win;
async function main() {
  app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  const pageUrl = win.url();
  log('页面 URL:', pageUrl);
  await win.waitForFunction(() => !!(window.MazzCommands && window.mazz), null, { timeout: 15000 });
  log('壳初始化 ✓');

  // 1：本地 H264 mkv 经协议播（打开文件→video readyState+src 形态）
  await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/h264.mkv']);
  const local = await win.waitForFunction(() => {
    const m = [...document.querySelectorAll('video.mz-media')].find(e => e.getBoundingClientRect().width > 0);
    return m && m.readyState >= 1 ? { src: m.src.slice(0, 70), rs: m.readyState, vw: m.videoWidth } : false;
  }, null, { timeout: 9000 }).then(r => r.jsonValue()).catch(() => null);
  log('本地 H264 mkv:', JSON.stringify(local));

  // 2：P2P 流 metadata-ok（BBB faststart mp4——本轮总目标）
  const added = await win.evaluate(async ([m]) => {
    try {
      const race = await Promise.race([
        window.mazz.invoke('tor:add', { magnet: m }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-35s')), 35000)),
      ]);
      const mp4 = race.files.find(f => /\.mp4$/i.test(f.path));
      return { ok: true, infoHash: race.infoHash, mp4: mp4?.path };
    } catch (e) { return { err: String(e.message || e).slice(0, 90) }; }
  }, [BBB]);
  log('tor:add:', JSON.stringify(added));
  if (added.ok && added.mp4) {
    const play = await win.evaluate(async ([ih, fp]) => {
      const raw = await window.mazz.invoke('tor:streamUrl', { infoHash: ih, filePath: fp });
      const v = document.createElement('video');
      v.muted = true;
      document.body.appendChild(v);
      v.src = 'mazz-res://tor/' + encodeURI(raw).replace('http://', '');
      const t0 = Date.now();
      return await new Promise(res => {
        const to = setTimeout(() => res({ state: 'timeout', rs: v.readyState, err: v.error?.code || 0, ms: Date.now() - t0 }), 45000);
        v.onloadedmetadata = () => { clearTimeout(to); res({ state: 'metadata-ok', rs: v.readyState, dur: +v.duration.toFixed(1), vw: v.videoWidth, ms: Date.now() - t0 }); };
        v.onerror = () => { clearTimeout(to); res({ state: 'error', err: v.error?.code || 0, rs: v.readyState, ms: Date.now() - t0 }); };
      });
    }, [added.infoHash, added.mp4]);
    log('P2P 流试播:', JSON.stringify(play));
    await win.evaluate(async ([ih]) => await window.mazz.invoke('tor:remove', { infoHash: ih, deleteFiles: true }), [added.infoHash]);
  }
}
main().catch(e => { console.error('[so] 崩溃:', e.message); process.exitCode = 1; })
  .finally(async () => {
    try { if (app) await Promise.race([app.close(), new Promise(r => setTimeout(r, 8000))]); } catch {}
    await new Promise(r => setTimeout(r, 400));
    try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
