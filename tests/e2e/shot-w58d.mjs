// tests/e2e/shot-w58d.mjs —— W58d 实证截图（军规⑤：看图零连带/PDF 真嵌/超大md 降级）
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const OUT = process.env.SHOT_DIR || '/mnt/agents/output';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);

// 造一张拿得出手的测试图（SVG——查看器支持，免并发启 app）
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a5f"/><stop offset="1" stop-color="#4f46e5"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/><text x="400" y="210" fill="#fff" font-size="44" font-weight="bold" text-anchor="middle" font-family="sans-serif">W58d 看图零连带</text><text x="400" y="260" fill="#dbe4ff" font-size="24" text-anchor="middle" font-family="sans-serif">图片查看器 · 不再带出播放器</text></svg>`;
fs.writeFileSync(WS + '/演示图.svg', SVG);
fs.writeFileSync(WS + '/演示文档.pdf', Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 260]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 78>>stream\nBT /F1 22 Tf 40 100 Td (W58d PDF EMBED OK) Tj ET\nBT /F1 14 Tf 40 140 Td (object-src + frame-src) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'));

const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 15; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  const n = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length);
  if (!n) break; await win.keyboard.press('Escape'); await win.waitForTimeout(250);
}
await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));

// ① 看图零连带（图片独占查看器）
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/演示图.svg');
await win.waitForTimeout(2600);
await win.screenshot({ path: OUT + '/w58d-看图零连带.png' });

// ② PDF 真嵌档（embed 渲染——CSP 放行实证）
await win.evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
await win.waitForTimeout(500);
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/演示文档.pdf');
await win.waitForTimeout(3000);
await win.screenshot({ path: OUT + '/w58d-pdf真嵌档.png' });

// ③ 超大 md Monaco 降级（40 万行虚拟化）
fs.writeFileSync(WS + '/超大演示.md', Buffer.from(Array.from({ length: 100000 }, (_, i) => `## 第${i + 1}节 标题\n\n正文段落 ${i + 1}：Monaco 虚拟化轻快滚动。\n`).join('\n')));
await win.evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
await win.waitForTimeout(500);
await win.evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/超大演示.md');
await win.waitForTimeout(8000);
// 滚到中段证虚拟化
await win.evaluate(() => window.__activeCodeCtl?.editor?.revealLine(200000, 0));
await win.waitForTimeout(1200);
await win.screenshot({ path: OUT + '/w58d-超大md降级.png' });
await app.close().catch(() => {});
console.log('SHOTS_DONE');
