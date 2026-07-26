// tests/e2e/probe-audtracks.mjs —— 探针：Chromium audioTracks 对 mkv/mp4 双轨的实况（多音轨路线判定）
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const app = await electron.launch({
  args: [path.resolve('.')],
  env: { ...process.env, NODE_ENV: 'test' },
  timeout: 120000,
});
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);

const out = await win.evaluate(async () => {
  const test = (src) => new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    const to = setTimeout(() => resolve({ src, timeout: true, at: v.audioTracks?.length ?? 'n/a' }), 8000);
    v.addEventListener('loadedmetadata', () => {
      setTimeout(() => {
        clearTimeout(to);
        resolve({ src, at: v.audioTracks?.length ?? 'n/a', duration: v.duration });
      }, 600);
    });
    v.addEventListener('error', () => { clearTimeout(to); resolve({ src, error: v.error?.code }); });
    v.src = src;
  });
  return {
    mkv: await test('file:///tmp/audtracks/t2.mkv'),
    mp4: await test('file:///tmp/audtracks/t2.mp4'),
  };
});
console.log(JSON.stringify(out, null, 1));
await app.close().catch(() => {});
