// tests/e2e/probe-seq.mjs —— 探针：大md 开关后 docx 降级的 __activeCodeCtl 归属
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';
import JSZip from 'jszip';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);
fs.writeFileSync(WS + '/超大.md', Buffer.from(Array.from({ length: 100000 }, (_, i) => `## 第${i + 1}节\n\n正文 ${i + 1}\n`).join('\n')));
const zip = await JSZip.loadAsync(fs.readFileSync(WS + '/立项报告.docx'));
zip.file('word/media/pad.bin', Buffer.alloc(3_600_000, 7));
fs.writeFileSync(WS + '/超大报告.docx', await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));

const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 12; i++) { const acc = await win.evaluate(() => !!document.querySelector('#agree-accept')); if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; } break; }
await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));

await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/超大.md');
await win.waitForTimeout(7000);
const md = await win.evaluate(() => ({ fp: window.__activeCodeCtl?.filePath, val: (window.__activeCodeCtl?.editor?.getValue() || '').length }));
console.log('MD:', JSON.stringify(md));
await win.evaluate(() => window.MazzCommands?.execute('file.closeTab'));
await win.waitForTimeout(800);
const mid = await win.evaluate(() => ({ ctl: window.__activeCodeCtl?.filePath ?? 'null', tabs: window.MazzShell?.paneTree?.tabs?.tabs?.length }));
console.log('CLOSED:', JSON.stringify(mid));
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/超大报告.docx');
for (let i = 0; i < 6; i++) {
  await win.waitForTimeout(1500);
  const st = await win.evaluate(() => ({
    fp: window.__activeCodeCtl?.filePath ?? 'null',
    val: (window.__activeCodeCtl?.editor?.getValue() || '').length,
    pending: (window.__activeCodeCtl?._pendingText || '').length,
    activeTabFp: window.MazzShell?.paneTree?.tabs?.active?.filePath ?? 'null',
    activeMod: window.MazzShell?.paneTree?.tabs?.active?.moduleId,
  }));
  console.log(`T${(i + 1) * 1500}:`, JSON.stringify(st));
}
await app.close().catch(() => {});
process.exit(0);
