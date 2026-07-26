// tests/e2e/probe-sub.mjs —— 探针：CC 显隐与连播取消的内部流转直视
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);

await (async () => {})();
const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' },
  timeout: 120000,
});
const win = await app.firstWindow();
win.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 10; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  const masks = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length);
  if (!masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
}

await win.evaluate(() => {
  const W = window.Worker;
  window.__workerLog = [];
  window.Worker = class extends W {
    constructor(url, opts) {
      window.__workerLog.push({ ev: 'create', url: String(url).slice(0, 80), type: opts?.type });
      super(url, opts);
      this.addEventListener('error', (e) => window.__workerLog.push({ ev: 'error', msg: String(e.message || e.type).slice(0, 160), file: e.filename, line: e.lineno }));
      this.addEventListener('messageerror', (e) => window.__workerLog.push({ ev: 'messageerror', msg: String(e.type) }));
      this.addEventListener('message', (e) => window.__workerLog.push({ ev: 'msg', data: String(JSON.stringify(e.data)).slice(0, 120) }));
      const _pm = this.postMessage.bind(this);
      this.postMessage = (d, t) => { window.__workerLog.push({ ev: 'out', data: String(JSON.stringify(d)).slice(0, 120) }); return _pm(d, t); };
    }
  };
});
// 造视频与字幕
await win.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 180;
  const ctx = c.getContext('2d');
  const stream = c.captureStream(15);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const t = setInterval(() => { ctx.fillStyle = '#336'; ctx.fillRect(0, 0, 320, 180); ctx.fillStyle = '#fff'; ctx.fillText('EP', 20, 100); }, 120);
  rec.start(500);
  await new Promise(r => setTimeout(r, 2000));
  clearInterval(t);
  const done = new Promise(r => { rec.onstop = r; });
  rec.stop(); await done;
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  const ws = await window.mazz.invoke('workspace:get');
  await window.mazz.invoke('fs:writeFileBase64', { path: ws + '/剧集/探针番 S01E01.webm', base64: btoa(s) });
  const ass = `[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, Bold, Alignment, Encoding\nStyle: Default, sans-serif, 16, &H00FFFFFF, -1, 8, 1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0, 0:00:00.00, 0:00:59.00, Default, , 0, 0, 0, , 探针字幕\n`;
  await window.mazz.invoke('fs:writeFile', { path: ws + '/剧集/探针番 S01E01.ass', content: ass });
});
await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/剧集/探针番 S01E01.webm']);

const dump = async (tag) => {
  const r = await win.evaluate(() => {
    const sub = document.querySelector('canvas.mz-sub-canvas');
    const allCv = [...document.querySelectorAll('canvas')].map(c => ({ cls: c.className.slice(0, 40), w: c.width, h: c.height, inDom: c.isConnected, disp: getComputedStyle(c).display }));
    const allLib = [...document.querySelectorAll('.libassjs-canvas-parent')].map(p => ({ conn: p.isConnected, kids: p.children.length }));
    const subRefCv = window.__subRef ? { cls: window.__subRef.canvas?.className, conn: window.__subRef.canvas?.isConnected, parentConn: window.__subRef.canvasParent?.isConnected } : null;
    const btns = [...document.querySelectorAll('[data-a=sub]')].map(b => ({ vis: b.getBoundingClientRect().width > 0, cls: b.className, op: b.style.opacity }));
    return {
      subCanvas: !!sub, display: sub?.style.display ?? '(none-el)', btns,
      attached: typeof window.__subAttachedProbe === 'function' ? window.__subAttachedProbe() : 'n/a',
      allCv, allLib, subRefCv,
    };
  });
  console.log(tag, JSON.stringify(r));
};

// 直视失败 toast 原因
// 等字幕挂上（canvas 出现且尺寸非零）
for (let i = 0; i < 20; i++) {
  await win.waitForTimeout(500);
  const s = await win.evaluate(() => { const c = document.querySelector('canvas.mz-sub-canvas'); return c && c.width > 100 ? 1 : 0; });
  if (s) break;
}
const stage = await win.evaluate(async () => {
  const ws = await window.mazz.invoke('workspace:get');
  const vp = ws + '/剧集/探针番 S01E01.webm';
  const norm = vp.replace(/\\/g, '/');
  const dir = norm.split('/').slice(0, -1).join('/');
  const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(e => ({ err: e.message }));
  const subsw = await window.mazz.invoke('settings:get', { key: 'player.subtitleEnabled' }).catch(e => ({ err: e.message }));
  const assets = await window.mazz.invoke('player:jassubAssets').catch(e => ({ err: String(e.message || e) }));
  const rd = await window.mazz.invoke('fs:readFile', { path: vp.replace('.webm', '.ass') }).catch(e => null);
  return {
    dir, entriesIsArray: Array.isArray(entries), entryNames: Array.isArray(entries) ? entries.map(e => e.name) : entries,
    subsw, assetsKeys: assets ? Object.keys(assets) : assets, assetsErr: assets?.err || null,
    workerJsLen: assets?.workerJs?.length || 0, wasmLen: assets?.wasm?.length || 0, font: !!assets?.fallbackFont,
    assRead: rd ? rd.length : null,
  };
});
console.log('分段直视:', JSON.stringify(stage, null, 1).slice(0, 900));
const failToast = await win.evaluate(() => { const t = [...document.querySelectorAll('.mazz-toast')].map(x => x.textContent.slice(0, 120)).join(' | '); return t || '(无toast)'; });
console.log('失败toast:', failToast);
console.log('subErr:', await win.evaluate(() => window.__subErr || '(none)'));
console.log('subFlow:', JSON.stringify(await win.evaluate(() => window.__subFlow || '(none)')), '| subStage:', JSON.stringify(await win.evaluate(() => window.__subStage || '(none)')));
console.log('workerLog:', JSON.stringify((await win.evaluate(() => window.__workerLog || [])).slice(0, 12), null, 1));
await dump('挂载后:');
await win.evaluate(() => { [...document.querySelectorAll('[data-a=sub]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
await win.waitForTimeout(500);
await dump('CC第一次后:');
await win.evaluate(() => { [...document.querySelectorAll('[data-a=sub]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
await win.waitForTimeout(500);
await dump('CC第二次后:');

// 连播取消直视
await win.evaluate(() => {
  const m = document.querySelector('video.mz-media');
  if (m && isFinite(m.duration)) { m.currentTime = Math.max(0, m.duration - 0.3); m.play().catch(() => {}); }
});
await win.waitForTimeout(1500);
const toastInfo = await win.evaluate(() => {
  const t = document.querySelector('.mazz-toast');
  const btns = [...document.querySelectorAll('.mazz-toast button')].map(b => b.textContent);
  return { toast: t ? t.textContent.slice(0, 50) : null, btns };
});
console.log('连播 toast:', JSON.stringify(toastInfo));
await win.evaluate(() => { [...document.querySelectorAll('.mazz-toast button')].find(b => b.textContent.includes('取消连播'))?.click(); });
await win.waitForTimeout(3600);
const name = await win.evaluate(() => [...document.querySelectorAll('.mz-name')].map(e => e.textContent).join('|'));
console.log('取消后片名:', name);

await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
