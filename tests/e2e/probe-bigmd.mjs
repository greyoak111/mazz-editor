import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const big = WS + '/超大.md';
fs.writeFileSync(big, Buffer.from(Array.from({ length: 100000 }, (_, i) => `## 第${i + 1}节\n\n正文 ${i + 1}\n`).join('\n')));
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 12; i++) { const acc = await win.evaluate(() => !!document.querySelector('#agree-accept')); if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; } break; }
const t0 = Date.now();
await win.evaluate((p) => window.MazzShell?.openFile?.(p), big);
await win.waitForTimeout(6000);
const st = await win.evaluate(() => {
  const ctl = window.__activeCodeCtl;
  return {
    lang: ctl?.language, lines: ctl?.editor?.getModel()?.getLineCount() ?? -1,
    val: (ctl?.editor?.getValue() || '').length,
    firstLine: ctl?.editor?.getModel()?.getLineContent(1) || null,
    viewLines: document.querySelectorAll('.view-lines > div').length,
    tabTitle: window.MazzShell?.paneTree?.tabs?.active?.title || null,
  };
});
console.log(`MD@${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(st));
await app.close().catch(() => {});
process.exit(0);
