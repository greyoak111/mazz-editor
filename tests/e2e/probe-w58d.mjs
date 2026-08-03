// tests/e2e/probe-w58d.mjs —— 探针：看图/PDF 连带播放器 + 书库 + 超大 md 直视
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);

// 最小真 PNG（2x2 红块）+ 最小真 PDF
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP8z8Dwn4GBgQEACvsC/wvfs+8AAAAASUVORK5CYII=', 'base64');
fs.writeFileSync(WS + '/探针图.png', PNG);
fs.writeFileSync(WS + '/探针文档.pdf', Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 18 Tf 30 100 Td (W58D PDF PROBE) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`));

const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
win.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 15; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  const n = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length);
  if (!n) break; await win.keyboard.press('Escape'); await win.waitForTimeout(250);
}
await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));

const viewerState = () => win.evaluate(() => {
  const ctl = window.__activeViewerCtl;
  return ctl ? {
    kind: ctl.kind, path: ctl.path?.split(/[\\/]/).pop() || null,
    players: ctl.body.querySelectorAll('.mz-player-root').length,
    imgs: ctl.body.querySelectorAll('img').length,
    embeds: ctl.body.querySelectorAll('embed').length,
    kids: ctl.body.children.length,
  } : null;
});

// ① 看图
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/探针图.png');
await win.waitForTimeout(2600);
console.log('PNG:', JSON.stringify(await viewerState()));
// ② PDF（先关图签防已开激活歧路）
await win.evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
await win.waitForTimeout(500);
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/探针文档.pdf');
await win.waitForTimeout(2600);
console.log('PDF:', JSON.stringify(await viewerState()));
// ③ epub 书库
await win.evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
await win.waitForTimeout(500);
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/电子书/潮声集.epub');
await win.waitForTimeout(5000);
const lib = await win.evaluate(() => {
  const root = document.querySelector('.lib-toc, .lib-reader, [class*=lib-]');
  const text = document.body.innerText.slice(0, 300);
  return { hasLib: !!root, toc: document.querySelectorAll('.lib-toc *').length, snippet: text.replace(/\s+/g, ' ').slice(0, 120) };
});
console.log('EPUB:', JSON.stringify(lib));
// ④ 超大 md（10 万行）——打开后 12s 观察
await win.evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
await win.waitForTimeout(400);
const bigPath = WS + '/超大.md';
const buf = Buffer.from(Array.from({ length: 100000 }, (_, i) => `## 第${i + 1}节 标题行\n\n正文第 ${i + 1} 段，内容填充到十万行水平。\n`).join('\n'));
fs.writeFileSync(bigPath, buf);
console.log('大文件字节:', buf.length);
const t0 = Date.now();
await win.evaluate((p) => window.MazzShell?.openFile?.(p), bigPath);
for (let i = 0; i < 6; i++) {
  await win.waitForTimeout(2000);
  const st = await win.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    return { pmKids: pm?.children?.length ?? -1, pmText: (pm?.textContent || '').length, mod: document.querySelector('[class*=markdown]') ? 'md' : '?' };
  }).catch(e => ({ err: String(e).slice(0, 80) }));
  console.log(`MD@${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(st));
  if (st.pmKids > 10) break;
}
await app.close().catch(() => {});
process.exit(0);
