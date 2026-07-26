// tests/e2e/probe-streammp4.mjs —— P2P mp4 流可播性实证：BBB 流 range 试播 + moov 位置判定
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-smp4-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-smp4-ws-'));
const log = (...a) => console.log('[smp4]', ...a);
const BBB = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337';

let app, win;
async function main() {
  app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
  win = await app.firstWindow();
  await win.waitForFunction(() => !!window.mazz, null, { timeout: 15000 });
  await win.waitForTimeout(500);
  const added = await win.evaluate(async ([m]) => {
    try {
      const race = await Promise.race([
        window.mazz.invoke('tor:add', { magnet: m }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-35s')), 35000)),
      ]);
      return { ok: true, infoHash: race.infoHash, files: race.files.map(f => ({ path: f.path, length: f.length })) };
    } catch (e) { return { err: String(e.message || e).slice(0, 90) }; }
  }, [BBB]);
  log('add:', JSON.stringify(added));
  if (!added.ok) { log('swarm 不可达，弃'); return; }
  const mp4 = added.files.find(f => /\.mp4$/i.test(f.path));
  if (!mp4) { log('无 mp4', JSON.stringify(added.files)); return; }
  // moov 位置判定（读头部 64KB 看 box 序）
  const headInfo = await win.evaluate(async ([ih, fp]) => {
    const bytes = await window.mazz.invoke('tor:fileBytesHead', { infoHash: ih, filePath: fp, length: 65536 }).catch(() => null);
    if (!bytes) {
      // 无 head 通道就走流 range 读
      const url = await window.mazz.invoke('tor:streamUrl', { infoHash: ih, filePath: fp });
      const r = await fetch('mazz-res://tor/' + url.replace('http://', ''), { headers: { Range: 'bytes=0-65535' } });
      const buf = new Uint8Array(await r.arrayBuffer());
      const boxes = [];
      let off = 0;
      while (off + 8 <= buf.length && boxes.length < 8) {
        const dv = new DataView(buf.buffer, buf.byteOffset + off);
        const size = dv.getUint32(0);
        const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
        boxes.push(type + ':' + size);
        if (!size || size < 8) break;
        off += size;
      }
      return { via: 'range', status: r.status, boxes };
    }
    return { via: 'head' };
  }, [added.infoHash, mp4.path]);
  log('头部 box 序:', JSON.stringify(headInfo));
  // 网络层诊断：fetch 流 URL 看真实响应（video 0ms error=请求未发）
  const net = await win.evaluate(async ([ih, fp]) => {
    const url = await window.mazz.invoke('tor:streamUrl', { infoHash: ih, filePath: fp });
    const out = { url };
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
      out.fetch = { status: r.status, ct: r.headers.get('content-type'), len: (await r.arrayBuffer()).byteLength };
    } catch (e) { out.fetchErr = String(e).slice(0, 100); }
    try {
      const r2 = await fetch('mazz-res://tor/' + url.replace('http://', ''), { headers: { Range: 'bytes=0-1023' } });
      out.proxy = { status: r2.status, ct: r2.headers.get('content-type'), len: (await r2.arrayBuffer()).byteLength };
    } catch (e) { out.proxyErr = String(e).slice(0, 100); }
    return out;
  }, [added.infoHash, mp4.path]);
  log('网络诊断:', JSON.stringify(net));
  // 请求级追踪 + DOM 挂载试播（0ms error=请求未发层嫌疑定位）
  const reqs = [];
  win.on('request', r => { if (/webtorrent|mazz-res/.test(r.url())) reqs.push({ phase: 'req', url: r.url().slice(0, 90), headers: r.headers()['range'] || '' }); });
  win.on('requestfailed', r => { if (/webtorrent|mazz-res/.test(r.url())) reqs.push({ phase: 'FAIL', url: r.url().slice(0, 90), err: r.failure()?.errorText || '' }); });
  win.on('response', r => { if (/webtorrent|mazz-res/.test(r.url())) reqs.push({ phase: 'resp', status: r.status(), url: r.url().slice(0, 80) }); });
  const play = await win.evaluate(async ([ih, fp]) => {
    const url = await window.mazz.invoke('tor:streamUrl', { infoHash: ih, filePath: fp });
    const v = document.createElement('video');
    v.muted = true;
    document.body.appendChild(v); // 挂 DOM（贴近真实播放器）
    v.src = 'mazz-res://tor/' + encodeURI(url).replace('http://', '');
    const t0 = Date.now();
    return await new Promise(res => {
      const to = setTimeout(() => res({ state: 'timeout', rs: v.readyState, err: v.error?.code || 0, ms: Date.now() - t0 }), 45000);
      v.onloadedmetadata = () => { clearTimeout(to); res({ state: 'metadata-ok', rs: v.readyState, dur: +v.duration.toFixed(1), vw: v.videoWidth, ms: Date.now() - t0 }); };
      v.onerror = () => { clearTimeout(to); res({ state: 'error', err: v.error?.code || 0, rs: v.readyState, ms: Date.now() - t0 }); };
    });
  }, [added.infoHash, mp4.path]);
  log('流试播(proxy-dom):', JSON.stringify(play));
  log('请求轨迹:', JSON.stringify(reqs, null, 1));
  await win.evaluate(async ([ih]) => await window.mazz.invoke('tor:remove', { infoHash: ih, deleteFiles: true }), [added.infoHash]);
}
main().catch(e => { console.error('[smp4] 崩溃:', e.message); process.exitCode = 1; })
  .finally(async () => {
    try { if (app) await Promise.race([app.close(), new Promise(r => setTimeout(r, 8000))]); } catch {}
    await new Promise(r => setTimeout(r, 400));
    try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
