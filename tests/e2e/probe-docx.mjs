// tests/e2e/probe-docx.mjs —— 探针：extractRawTextFromDocx 直视
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
import JSZip from 'jszip';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
const src = fs.readFileSync(WS + '/立项报告.docx');
const zip = await JSZip.loadAsync(src);
zip.file('word/media/pad.bin', Buffer.alloc(3_600_000, 7));
fs.writeFileSync(WS + '/超大报告.docx', await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));

const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
win.on('console', m => console.log('[c]', m.text().slice(0, 200)));
win.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 240)));
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2400);
for (let i = 0; i < 12; i++) { const acc = await win.evaluate(() => !!document.querySelector('#agree-accept')); if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; } break; }

// 真路径：openFile → openLargeFile → 逐拍看 ctl 状态
await win.evaluate((p) => window.MazzShell?.openFile?.(p).catch(e => console.log('OPENFILE_ERR', e.message)), WS + '/超大报告.docx');
for (let i = 0; i < 8; i++) {
  await win.waitForTimeout(1500);
  const st = await win.evaluate(() => {
    const ctl = window.__activeCodeCtl;
    return {
      hasCtl: !!ctl, hasEditor: !!ctl?.editor,
      pending: (ctl?._pendingText || '').length,
      val: (ctl?.editor?.getValue() || '').length,
      loading: !!ctl?._loading, lang: ctl?.language,
      tabMod: window.MazzShell?.paneTree?.tabs?.active?.moduleId,
    };
  });
  console.log(`T${(i + 1) * 1500}ms:`, JSON.stringify(st));
}
await app.close().catch(() => {});
process.exit(0);
