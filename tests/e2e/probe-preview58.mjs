// tests/e2e/probe-preview58.mjs —— 探针：html 运行预览链直视（tryNav 后仍败的根因）
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);

const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' },
  timeout: 120000,
});
const win = await app.firstWindow();
win.on('console', (m) => console.log('[c]', m.text().slice(0, 160)));
win.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 12; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  break;
}

// 与 scene56 同序：newCode → 写 html → openFile → runFile
await win.evaluate(() => window.MazzCommands?.execute('file.newCode'));
await win.waitForTimeout(1400);
await win.evaluate(async (ws) => {
  const ctl = window.__activeCodeCtl;
  if (ctl?.editor) ctl.editor.setValue('<html><body><h1 id="w58mark">W58预览</h1></body></html>');
  const p = ws + '/验收-page.html';
  await window.mazz.invoke('fs:writeFile', { path: p, content: '<html><body><h1 id="w58mark">W58预览</h1></body></html>' });
  await window.MazzShell?.openFile?.(p);
}, WS);
await win.waitForTimeout(1400);
const pre = await win.evaluate(() => ({
  lang: window.__activeCodeCtl?.language,
  fp: window.__activeCodeCtl?.filePath,
  runnerHtml: !!window.__activeCodeCtl,
}));
console.log('PRE:', JSON.stringify(pre));

await win.evaluate(() => window.MazzCommands?.execute('code.runFile'));
// 每 400ms 采样一次浏览器 ctl 状态，共 12 次（4.8s）
for (let i = 0; i < 12; i++) {
  await win.waitForTimeout(400);
  const s = await win.evaluate(async () => {
    const bctl = window.__activeBrowserCtl;
    const t = bctl?.tabs?.find(x => x.id === bctl.activeId) || bctl?.tabs?.[0];
    let mark = null, url = null;
    if (t) {
      url = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: 'location.href' }).catch(e => 'ERR:' + e.message);
      mark = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "!!document.getElementById('w58mark')" }).catch(e => 'ERR:' + e.message);
    }
    return { hasBctl: !!bctl, tabs: bctl?.tabs?.length ?? 0, activeId: bctl?.activeId ?? null, url, mark };
  });
  console.log(`T${i * 400 + 400}ms:`, JSON.stringify(s));
  if (s.mark === true) { console.log('PREVIEW_OK'); break; }
}
// —— 直视层：手动重放整条链，每步拿真错误 ——
const diag = await win.evaluate(async (ws) => {
  const out = {};
  const bctl = window.__activeBrowserCtl;
  const t = bctl?.tabs?.find(x => x.id === bctl.activeId) || bctl?.tabs?.[0];
  if (!t) return { fatal: 'no tab' };
  out.tab = { id: t.id, viewId: t.viewId, url: t.url, hostConnected: !!t.host?.isConnected, hasViewReady: !!t.viewReady };
  const url = 'mazz-res://media/' + encodeURIComponent(String(ws + '/验收-page.html').replace(/\\/g, '/'));
  // ① 直接 bv:nav（绕 queueNav）
  out.directNav = await window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url }).then(() => 'ok').catch(e => 'ERR:' + e.message);
  await new Promise(r => setTimeout(r, 1200));
  out.afterDirect = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: 'location.href' }).catch(e => 'ERR:' + e.message);
  out.markAfterDirect = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "!!document.getElementById('w58mark')" }).catch(e => 'ERR:' + e.message);
  // ② openUrl（走 queueNav 闸）
  if (out.markAfterDirect !== true && bctl.openUrl) {
    bctl.openUrl(url);
    await new Promise(r => setTimeout(r, 1500));
    out.afterOpenUrl = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: 'location.href' }).catch(e => 'ERR:' + e.message);
    out.markAfterOpenUrl = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "!!document.getElementById('w58mark')" }).catch(e => 'ERR:' + e.message);
  }
  // ③ 对照：普通 data: URL 能不能导航（证 nav 管道本身死活）
  if (out.markAfterDirect !== true && out.markAfterOpenUrl !== true) {
    out.dataNav = await window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: 'data:text/html,<h1>probe</h1>' }).then(() => 'ok').catch(e => 'ERR:' + e.message);
    await new Promise(r => setTimeout(r, 800));
    out.afterData = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: 'location.href' }).catch(e => 'ERR:' + e.message);
  }
  return out;
}, WS);
console.log('DIAG:', JSON.stringify(diag, null, 1));
await app.close().catch(() => {});
process.exit(0);
