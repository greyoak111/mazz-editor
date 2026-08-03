// tests/e2e/probe-chunk.mjs —— 探针：dist chunk 直调 extractRawTextFromDocx
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
import JSZip from 'jszip';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const zip = await JSZip.loadAsync(fs.readFileSync(WS + '/立项报告.docx'));
zip.file('word/media/pad.bin', Buffer.alloc(3_600_000, 7));
fs.writeFileSync(WS + '/超大报告.docx', await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
const chunk = fs.readdirSync(ROOT + '/renderer/dist/chunks').find(f => f.startsWith('docx-io-') && f.endsWith('.js'));
console.log('chunk:', chunk);

const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
win.on('console', m => console.log('[c]', m.text().slice(0, 200)));
win.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2400);
for (let i = 0; i < 12; i++) { const acc = await win.evaluate(() => !!document.querySelector('#agree-accept')); if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; } break; }

const r = await win.evaluate(async ({ p, chunk }) => {
  try {
    const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p });
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const mod = await import('/dist/chunks/' + chunk);
    const out = await mod.extractRawTextFromDocx(bytes.buffer);
    return { len: (out || '').length, head: (out || '').slice(0, 60), exports: Object.keys(mod) };
  } catch (e) { return { err: String(e?.stack || e).slice(0, 400) }; }
}, { p: WS + '/超大报告.docx', chunk });
console.log('CHUNK:', JSON.stringify(r));
await app.close().catch(() => {});
process.exit(0);
