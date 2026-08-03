// tests/e2e/probe-newfile.mjs —— 探针：新建文件子窗主题落地直视
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 12; i++) { const acc = await win.evaluate(() => !!document.querySelector('#agree-accept')); if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; } break; }
// 主窗主题基线
const main = await win.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() }));
console.log('MAIN:', JSON.stringify(main));
await win.evaluate(() => window.MazzCommands?.execute('fileTree.newFile'));
await win.waitForTimeout(2600);
const pw = app.windows().find(w => w.url().includes('/panels/newfile.html'));
if (!pw) { console.log('PANEL NOT FOUND'); process.exit(1); }
const st = await pw.evaluate(() => ({
  theme: document.documentElement.dataset.theme ?? null,
  inlineBg: document.documentElement.style.getPropertyValue('--bg') || null,
  computedBg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  pwinBg: getComputedStyle(document.querySelector('.pwin')).backgroundColor,
  styleLen: document.documentElement.style.length,
}));
console.log('PANEL:', JSON.stringify(st));
await app.close().catch(() => {});
process.exit(0);
