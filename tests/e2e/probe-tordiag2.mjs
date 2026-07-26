// tests/e2e/probe-tordiag2.mjs —— 链路对照（BBB）+ 当日首行种热度诊断
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-diag2-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-diag2-ws-'));
const log = (...a) => console.log('[diag2]', ...a);
const TRS = ['udp://tracker.opentrackr.org:1337/announce', 'udp://explodie.org:6969/announce', 'udp://tracker.coppersurfer.tk:6969/announce', 'udp://tracker.empire-js.us:1337/announce', 'udp://tracker.leechers-paradise.org:6969/announce'];
const BBB = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny' + TRS.map(t => '&tr=' + encodeURIComponent(t)).join('');
const TODAY = 'magnet:?xt=urn:btih:99b8e11606881c40435d1b796dcd617c4341fddd' + TRS.map(t => '&tr=' + encodeURIComponent(t)).join('');

let app, win;
async function tryAdd(magnet, label, ms) {
  const t0 = Date.now();
  const r = await win.evaluate(async ([m, timeout]) => {
    try {
      const race = await Promise.race([
        window.mazz.invoke('tor:add', { magnet: m }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('diag-timeout-' + timeout / 1000 + 's')), timeout)),
      ]);
      return { ok: true, name: race.name, files: race.files?.length, first: race.files?.[0]?.path };
    } catch (e) { return { err: String(e.message || e).slice(0, 90) }; }
  }, [magnet, ms]);
  log(label, Math.round((Date.now() - t0) / 1000) + 's →', JSON.stringify(r));
  return r;
}
async function main() {
  app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
  win = await app.firstWindow();
  await win.waitForFunction(() => !!(window.MazzCommands && window.mazz), null, { timeout: 15000 });
  await win.waitForTimeout(500);
  const bbb = await tryAdd(BBB, 'BBB对照(链路验证)', 40000);
  if (bbb.ok) {
    const l = await win.evaluate(async () => (await window.mazz.invoke('tor:list'))?.[0]);
    if (l?.infoHash) await win.evaluate(async ([h]) => await window.mazz.invoke('tor:remove', { infoHash: h, deleteFiles: true }), [l.infoHash]);
  }
  const today = await tryAdd(TODAY, '当日首行种(enriched)', 50000);
  if (today.ok) {
    for (let i = 0; i < 8; i++) {
      await win.waitForTimeout(5000);
      const l2 = await win.evaluate(async () => (await window.mazz.invoke('tor:list'))?.[0]);
      const st = l2 && await win.evaluate(async ([h]) => await window.mazz.invoke('tor:stats', { infoHash: h }), [l2.infoHash]);
      log('当日种统计:', JSON.stringify({ peers: st?.numPeers, down: st?.downSpeed, prog: st?.progress, name: st?.name }));
      if (st?.numPeers > 0) break;
    }
  }
}
main().catch(e => { console.error('[diag2] 崩溃:', e.message); process.exitCode = 1; })
  .finally(async () => {
    try { if (app) await Promise.race([app.close(), new Promise(r => setTimeout(r, 8000))]); } catch {}
    await new Promise(r => setTimeout(r, 500));
    try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
