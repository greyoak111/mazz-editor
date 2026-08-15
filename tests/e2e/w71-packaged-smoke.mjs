// tests/e2e/w71-packaged-smoke.mjs —— W71 app-unpacked 真启动与 Foundation IPC 探针
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe');
if (!fs.existsSync(executablePath)) throw new Error(`app-unpacked 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-ws-'));
fs.writeFileSync(path.join(workspace, 'packaged-smoke.md'), '# packaged smoke\n', 'utf8');

let app;
try {
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
      NODE_ENV: 'test',
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }));
  const result = await win.evaluate(async () => {
    const waitFor = async (predicate, message) => {
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const value = await window.mazz.invoke('resources:snapshot');
        if (predicate(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(message);
    };
    const baseline = await window.mazz.invoke('resources:snapshot');
    const term = await window.mazz.invoke('term:create', { id: 'w71-packaged-smoke', cols: 40, rows: 8 });
    if (term?.error) throw new Error(term.error);
    const during = await window.mazz.invoke('resources:snapshot');
    await window.mazz.invoke('term:kill', { id: term.id });
    await waitFor(value => value.activeCount === baseline.activeCount, 'PTY 释放后资源未回基线');

    await window.mazz.invoke('panel:open', { kind: 'settings' });
    const panelDuring = await waitFor(value => value.byType['panel-window'] === 1, 'PanelWindow 未进入资源账本');
    await window.mazz.invoke('panel:close', { kind: 'settings' });
    await waitFor(value => !value.byType['panel-window'], 'PanelWindow 关闭后未释放');

    await window.mazz.invoke('bv:create', { tabId: 'w71-ledger-view', partition: 'persist:mazz-browser', url: 'about:blank' });
    const viewDuring = await waitFor(value => value.byType['web-contents-view'] === 1, 'WebContentsView 未进入资源账本');
    await window.mazz.invoke('bv:destroy', { tabId: 'w71-ledger-view' });
    const resources = await waitFor(value => value.activeCount === baseline.activeCount, 'Surface 关闭后资源未回基线');
    const adapters = await window.mazz.invoke('harness:adapters');
    const sessions = await window.mazz.invoke('harness:sessions');
    return {
      title: document.title,
      electron: window.mazz.versions.electron,
      resourceVersion: resources.version,
      baselineResources: baseline.activeCount,
      activeResources: resources.activeCount,
      mainWindowObserved: baseline.byType['browser-window'] === 1,
      ptyObserved: during.byType.pty === 1,
      panelObserved: panelDuring.byType['panel-window'] === 1,
      webContentsViewObserved: viewDuring.byType['web-contents-view'] === 1,
      adapters: adapters.length,
      sessions: sessions.length,
    };
  });
  if (!result.title || result.resourceVersion !== 1 || !result.mainWindowObserved || !result.ptyObserved
    || !result.panelObserved || !result.webContentsViewObserved
    || result.activeResources !== result.baselineResources || result.sessions !== 0) {
    throw new Error(`packaged smoke 断言失败：${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
