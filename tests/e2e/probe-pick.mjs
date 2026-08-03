// tests/e2e/probe-pick.mjs —— 探针：newfilePick 链路直视
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
win.on('console', m => console.log('[c]', m.text().slice(0, 140)));
win.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 12; i++) { const acc = await win.evaluate(() => !!document.querySelector('#agree-accept')); if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; } break; }
await win.evaluate(() => window.MazzCommands?.execute('fileTree.newFile'));
await win.waitForTimeout(2400);
const pre = await win.evaluate(() => ({ dir: window.MazzShell?._newfileDir ?? 'UNSET' }));
console.log('STASH:', JSON.stringify(pre));
const pw = app.windows().find(w => w.url().includes('/panels/newfile.html'));
console.log('panel:', !!pw);
if (pw) {
  await pw.evaluate(() => { for (const b of document.querySelectorAll('.nft')) if (b.dataset.ext === 'py') { b.click(); return; } });
  await win.waitForTimeout(2000);
}
const post = await win.evaluate(async (ws) => {
  const list = await window.mazz.invoke('fs:listDir', { path: ws }).catch(e => 'ERR:' + e.message);
  return {
    dir: window.MazzShell?._newfileDir ?? 'UNSET',
    toasts: [...document.querySelectorAll('.mazz-toast, [class*=toast]')].map(t => t.textContent.slice(0, 60)),
    list: JSON.stringify(list).slice(0, 300),
    editing: !!window.MazzShell?.fileTree?.editing,
  };
}, WS);
console.log('POST:', JSON.stringify(post, null, 1));
await app.close().catch(() => {});
process.exit(0);
