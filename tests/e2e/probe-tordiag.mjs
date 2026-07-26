// tests/e2e/probe-tordiag.mjs —— 裸 magnet vs 注入 tracker magnet 的元数据分诊
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-diag-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-diag-ws-'));
const log = (...a) => console.log('[diag]', ...a);
const BARE = 'magnet:?xt=urn:btih:1792d149e7089469c66cb6a5c664214ecd9bd5f4';
const TRS = ['udp://tracker.opentrackr.org:1337/announce', 'udp://explodie.org:6969/announce', 'udp://tracker.coppersurfer.tk:6969/announce', 'udp://tracker.empire-js.us:1337/announce', 'udp://tracker.leechers-paradise.org:6969/announce'];
const ENRICHED = BARE + TRS.map(t => '&tr=' + encodeURIComponent(t)).join('');

let app, win;
async function main() {
  app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
  win = await app.firstWindow();
  await win.waitForFunction(() => !!(window.MazzCommands && window.mazz), null, { timeout: 15000 });
  await win.waitForTimeout(500);
  const tryAdd = async (magnet, label, ms) => {
    const t0 = Date.now();
    const r = await win.evaluate(async ([m, timeout]) => {
      try {
        const p = window.mazz.invoke('tor:add', { magnet: m });
        const race = await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('diag-timeout-' + timeout / 1000 + 's')), timeout))]);
        return { ok: true, name: race.name, files: race.files?.length, peers: undefined };
      } catch (e) { return { err: String(e.message || e).slice(0, 100) }; }
    }, [magnet, ms]);
    log(label, Math.round((Date.now() - t0) / 1000) + 's →', JSON.stringify(r));
    return r;
  };
  const enriched = await tryAdd(ENRICHED, '注入tracker版', 90000);
  if (enriched.ok) {
    const ih = await win.evaluate(async () => (await window.mazz.invoke('tor:list'))?.[0]?.infoHash);
    for (let i = 0; i < 6; i++) {
      await win.waitForTimeout(5000);
      const st = await win.evaluate(async ([h]) => await window.mazz.invoke('tor:stats', { infoHash: h }), [ih]);
      log('统计:', JSON.stringify({ peers: st?.numPeers, down: st?.downSpeed, prog: st?.progress }));
      if (st?.numPeers > 0) break;
    }
    await win.evaluate(async ([h]) => await window.mazz.invoke('tor:remove', { infoHash: h, deleteFiles: true }), [ih]);
  } else {
    await tryAdd(BARE, '裸版对照', 45000);
  }
}
main().catch(e => { console.error('[diag] 崩溃:', e.message); process.exitCode = 1; })
  .finally(async () => {
    try { if (app) await Promise.race([app.close(), new Promise(r => setTimeout(r, 8000))]); } catch {}
    await new Promise(r => setTimeout(r, 500));
    try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
