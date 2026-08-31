// Browser 密码面板手动填充 + Webbridge 投稿注入：真实 WebContentsView/bv:js 闭环。
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('.');
const TEMP_ROOT = path.resolve(os.tmpdir());
const USER_DATA = fs.mkdtempSync(path.join(TEMP_ROOT, 'mazz-browser-bridge-user-'));
const WORKSPACE = fs.mkdtempSync(path.join(TEMP_ROOT, 'mazz-browser-bridge-ws-'));
const MARKDOWN_NAME = 'Webbridge真实注入.md';
const MARKDOWN_TITLE = 'Webbridge真实注入';
const MARKDOWN_BODY = '# 投稿链\n\nWCV_BRIDGE_BODY_20260831';
fs.writeFileSync(path.join(WORKSPACE, MARKDOWN_NAME), MARKDOWN_BODY, 'utf8');

async function pollRenderer(page, fn, arg, { timeout = 20000, interval = 150, label = 'renderer condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(fn, arg).catch(error => ({ __pollError: error.message }));
    if (last && !last.__pollError) return last;
    await page.waitForTimeout(interval);
  }
  throw new Error(`${label} timeout: ${JSON.stringify(last)}`);
}

async function closeElectron(appInstance) {
  let timer = null;
  try {
    await Promise.race([
      appInstance.close(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Electron close timeout')), 10000); }),
    ]);
  } catch {
    appInstance.process()?.kill?.();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const fixture = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  if (req.url?.startsWith('/login')) {
    res.end(`<!doctype html><meta charset="utf-8"><form><input name="user"><input type="password"><button>登录</button></form>`);
    return;
  }
  res.end(`<!doctype html><meta charset="utf-8"><input placeholder="文章标题"><textarea></textarea><script>
    window.__bridgeEvents = { title: 0, body: 0 };
    document.querySelector('input').addEventListener('input', () => window.__bridgeEvents.title++);
    document.querySelector('textarea').addEventListener('input', () => window.__bridgeEvents.body++);
  </script>`);
});
const port = await new Promise((resolve, reject) => {
  fixture.once('error', reject);
  fixture.listen(0, '127.0.0.1', () => resolve(fixture.address().port));
});
const baseUrl = `http://127.0.0.1:${port}`;

let app = null;
try {
  app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      MAZZ_E2E_USER_DATA: USER_DATA,
      MAZZ_E2E_WORKSPACE: WORKSPACE,
      MAZZ_GPU_MODE: 'safe',
      NODE_ENV: 'test',
    },
    timeout: 120000,
  });
  const main = await app.firstWindow();
  await main.waitForLoadState('domcontentloaded');
  await main.waitForFunction(() => !!(window.MazzCommands && window.MazzShell && document.documentElement.dataset.appReady === '1'), null, { timeout: 30000 });
  for (let i = 0; i < 12; i++) {
    if (!(await main.locator('.mazz-palette-mask').count())) break;
    await main.keyboard.press('Escape');
    await main.waitForTimeout(150);
  }

  const passwordId = await main.evaluate(() => window.mazz.invoke('pw:save', {
    entry: { site: '127.0.0.1', username: 'manual@mazz.test', password: 'ManualPass-94' },
  }));
  await main.evaluate(() => window.MazzCommands.execute('file.newBrowser'));
  const passwordView = await main.waitForFunction(() => {
    const ctl = window.__activeBrowserCtl;
    const tab = ctl?.tabs?.find(item => item.id === ctl.activeId) || ctl?.tabs?.[0];
    return tab?.viewId || null;
  }, null, { timeout: 20000 }).then(handle => handle.jsonValue());
  await main.evaluate(url => window.__activeBrowserCtl.openUrl(url), `${baseUrl}/login`);
  await pollRenderer(main, async viewId => {
    const value = await window.mazz.invoke('bv:js', { tabId: viewId, code: 'location.pathname + ":" + document.readyState' }).catch(() => '');
    const ctl = window.__activeBrowserCtl;
    const tab = ctl?.tabs?.find(item => item.viewId === viewId);
    return /^\/login:(interactive|complete)$/.test(value) && tab?.url?.includes('/login');
  }, passwordView, { timeout: 20000, label: 'password fixture ready' });
  await main.evaluate(async viewId => {
    await window.mazz.invoke('bv:js', { tabId: viewId, code: `(() => {
      window.__manualEvents = { user: 0, password: 0 };
      const user = document.querySelector('[name=user]');
      const password = document.querySelector('[type=password]');
      user.value = ''; password.value = '';
      user.addEventListener('input', () => window.__manualEvents.user++);
      password.addEventListener('input', () => window.__manualEvents.password++);
      return true;
    })()` });
  }, passwordView);

  await main.evaluate(() => window.MazzCommands.execute('browser.passwordManager'));
  const passwordPanel = await (async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const page = app.windows().find(item => item.url().includes('/panels/pwmgr.html'));
      if (page) return page;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('密码管理器面板未打开');
  })();
  await passwordPanel.waitForSelector(`.row[data-id="${passwordId}"] button[data-a="fill"]`, { timeout: 10000 });
  await passwordPanel.click(`.row[data-id="${passwordId}"] button[data-a="fill"]`);
  const manualFillJson = await pollRenderer(main, async viewId => {
    const value = await window.mazz.invoke('bv:js', { tabId: viewId, code: `({
      username: document.querySelector('[name=user]')?.value,
      password: document.querySelector('[type=password]')?.value,
      events: window.__manualEvents
    })` }).catch(() => null);
    return value?.username === 'manual@mazz.test' && value?.password === 'ManualPass-94'
      && value.events?.user > 0 && value.events?.password > 0 ? JSON.stringify(value) : '';
  }, passwordView, { timeout: 10000, label: 'password panel manual fill' });
  const manualFill = JSON.parse(manualFillJson);
  await main.evaluate(() => window.mazz.invoke('panel:close', { kind: 'pwmgr' }));

  await app.evaluate(({ session }, redirectUrl) => {
    const author = session.fromPartition('persist:mazz-author');
    author.webRequest.onBeforeRequest({ urls: ['https://juejin.cn/*'] }, (details, callback) => {
      callback(details.resourceType === 'mainFrame' ? { redirectURL: redirectUrl } : {});
    });
  }, `${baseUrl}/editor`);
  await main.evaluate(file => window.MazzCommands.execute('file.openPath', { path: file }), path.join(WORKSPACE, MARKDOWN_NAME));
  await main.waitForFunction(expected => window.__activeMarkdownCtl?.getMarkdown?.().includes(expected), 'WCV_BRIDGE_BODY_20260831', { timeout: 20000 });
  await main.evaluate(() => window.MazzCommands.execute('bridge.docToWeb'));
  await main.waitForSelector('.mazz-palette-mask .wb-chk[data-id="juejin"]', { timeout: 10000 });
  await main.check('.mazz-palette-mask .wb-chk[data-id="juejin"]');
  await main.click('.mazz-palette-mask #wb-single');

  const publicationJson = await pollRenderer(main, async ({ title, body }) => {
    const ctl = window.__activeBrowserCtl;
    const tab = ctl?.tabs?.find(item => item.partition === 'persist:mazz-author');
    if (!tab?.viewId) return null;
    const value = await ctl.execJs(tab.viewId, `({
      url: location.href,
      title: document.querySelector('input')?.value,
      body: document.querySelector('textarea')?.value,
      events: window.__bridgeEvents
    })`).catch(() => null);
    return value?.title === title && value?.body === body && value.events?.title > 0 && value.events?.body > 0
      ? JSON.stringify({ ...value, viewId: tab.viewId, partition: tab.partition })
      : '';
  }, { title: MARKDOWN_TITLE, body: MARKDOWN_BODY }, { timeout: 30000, label: 'Webbridge publication injection' });
  const publication = JSON.parse(publicationJson);

  if (manualFill.username !== 'manual@mazz.test' || manualFill.password !== 'ManualPass-94'
      || manualFill.events.user < 1 || manualFill.events.password < 1) {
    throw new Error(`密码面板手动填充链失败：${JSON.stringify(manualFill)}`);
  }
  if (!publication?.viewId || publication.partition !== 'persist:mazz-author'
      || publication.title !== MARKDOWN_TITLE || publication.body !== MARKDOWN_BODY) {
    throw new Error(`Webbridge 投稿注入链失败：${JSON.stringify(publication)}`);
  }
  console.log(JSON.stringify({ ok: true, manualFill, publication }));
} finally {
  if (app) {
    await app.evaluate(({ session }) => {
      try { session.fromPartition('persist:mazz-author').webRequest.onBeforeRequest(null); } catch {}
    }).catch(() => {});
    await closeElectron(app);
  }
  fixture.closeAllConnections?.();
  await new Promise(resolve => fixture.close(resolve));
  for (const target of [USER_DATA, WORKSPACE]) {
    const resolved = path.resolve(target);
    if (resolved.startsWith(TEMP_ROOT + path.sep) && path.basename(resolved).startsWith('mazz-browser-bridge-')) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    }
  }
}

// Electron/Playwright 在 Windows 偶发保留已关闭连接的诊断句柄；产品进程与夹具已显式收尾。
process.exit(0);
