// tests/e2e/probe-rec.mjs —— 探针：内录 webm duration 修复实证（真实录制管线）
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);

const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' },
  timeout: 120000,
});
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2800);
for (let i = 0; i < 10; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  const masks = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length);
  if (!masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
}

await win.evaluate(() => window.MazzCommands?.execute('file.newDraw'));
await win.waitForTimeout(2000);

const r = await win.evaluate(async () => {
  try {
    const c = document.querySelector('.draw-canvas, .draw-root canvas');
    if (!c) return { err: 'no-canvas' };
    const ctx = c.getContext('2d');
    ctx.strokeStyle = '#e11'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(50, 50); ctx.lineTo(300, 300); ctx.stroke();
    // 真实管线：recorder.js 的 Recorder 封装（含静态 fixWebmDuration）
    const { startCanvasRecorder } = await import('/renderer/lib/recorder.js');
    const rec = await startCanvasRecorder(c, { name: '实证内录' });
    if (!rec) return { err: 'recorder 创建失败' };
    await new Promise(r => setTimeout(r, 3000));
    const saved = await new Promise((resolve) => { rec.onstop = (p) => resolve(p); rec.stop(); });
    return { saved: typeof saved === 'string' ? saved.split('/').pop() : String(saved) };
  } catch (e) { return { err: e.message.slice(0, 100) }; }
});
console.log('录制产出:', JSON.stringify(r));

// 读产出文件，video 解码验证 duration
const meta = await win.evaluate(async ([fname]) => {
  try {
    const ws = await window.mazz.invoke('workspace:get');
    const b64 = await window.mazz.invoke('fs:readFileBase64', { path: ws + '/录制/' + fname });
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.src = url;
    return await new Promise((res) => {
      const to = setTimeout(() => res({ timeout: true }), 5000);
      v.onloadedmetadata = () => { clearTimeout(to); res({ duration: v.duration, vw: v.videoWidth, size: bytes.length }); };
      v.onerror = () => { clearTimeout(to); res({ err: 'video error code ' + (v.error?.code || '?') }); };
    });
  } catch (e) { return { err: e.message.slice(0, 80) }; }
}, [r.saved]);
console.log('产出 webm 解码:', JSON.stringify(meta));

await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
