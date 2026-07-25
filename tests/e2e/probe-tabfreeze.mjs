// tests/e2e/probe-tabfreeze.mjs —— 探针：关闭新标签页后原标签僵死复现与修法验证
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));

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

await win.evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
await win.waitForTimeout(2500);

// 导航到带 window.open 跳转按钮的测试页（复刻 B站跳新标签页场景）
const testPage = 'data:text/html,' + encodeURIComponent('<html><body style="height:2000px"><button id="b" onclick="window.__clicks=(window.__clicks||0)+1;this.textContent=window.__clicks">点我</button><button id="open" onclick="window.open(\'data:text/html,<body>新页</body>\',\'_blank\')">跳转新标签</button><div style="height:1500px"></div><script>window.__scrolls=0;addEventListener("scroll",()=>window.__scrolls++)</script></body></html>');
await win.evaluate(async ([u]) => {
  const wv = [...document.querySelectorAll('webview')].find(v => v.getBoundingClientRect().width > 0);
  await wv.loadURL(u).catch(() => {});
}, [testPage]);
await win.waitForTimeout(1500);

const activeWv = () => win.evaluate(() => {
  const wvs = [...document.querySelectorAll('webview')].filter(v => v.getBoundingClientRect().width > 0);
  return wvs.length;
});

// 测原标签点击/滚动响应（基线）
const testInput = async (tag) => {
  const r = await win.evaluate(async () => {
    const wv = [...document.querySelectorAll('webview')].find(v => v.getBoundingClientRect().width > 0);
    if (!wv) return { err: 'no-wv' };
    try {
      return await wv.executeJavaScript(`
        document.getElementById('b').click();
        window.scrollTo(0, 500);
        ({ clicks: window.__clicks || 0, scrolls: window.__scrolls || 0, scrollY: window.scrollY })
      `);
    } catch (e) { return { err: e.message.slice(0, 80) }; }
  });
  console.log(tag, JSON.stringify(r));
  return r;
};

await testInput('【关新标签前】');

// 点页面内"跳转新标签"按钮（window.open → setWindowOpenHandler deny → browser:openUrl 开 Mazz 标签）
await win.evaluate(async () => {
  const wv = [...document.querySelectorAll('webview')].find(v => v.getBoundingClientRect().width > 0);
  await wv.executeJavaScript(`document.getElementById('open').click()`);
});
await win.waitForTimeout(1500);
console.log('window.open 后 br-tab 数:', await win.evaluate(() => document.querySelectorAll('.br-tab').length));

// 关掉跳出的新标签（最后一个 br-tab-close）
await win.evaluate(() => {
  const btns = [...document.querySelectorAll('.br-tab-close')];
  btns[btns.length - 1]?.click();
});
await win.waitForTimeout(1500);
console.log('关新标签后 br-tab 数:', await win.evaluate(() => document.querySelectorAll('.br-tab').length));
// 切回原标签（第一个）
await win.evaluate(() => { document.querySelectorAll('.br-tab')[0]?.click(); });
await win.waitForTimeout(600);

// 回原标签测响应
const r2 = await testInput('【关新标签后】');
const frozen = r2.err || (r2.clicks === 0 && r2.scrollY === 0);
console.log(frozen ? '❄️ 复现：原标签僵死' : '✅ 原标签仍活');

if (frozen) {
  // 试修法 A：唤醒 focus
  await win.evaluate(() => { const wv = [...document.querySelectorAll('webview')].find(v => v.getBoundingClientRect().width > 0); wv?.focus?.(); });
  await win.waitForTimeout(400);
  const rA = await testInput('【focus 唤醒后】');
  console.log((rA.clicks > 0 || rA.scrollY > 0) ? '✅ focus 唤醒有效' : '❌ focus 唤醒无效');
}

await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
