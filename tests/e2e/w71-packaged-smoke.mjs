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
  const result = await win.evaluate(async (watchedFile) => {
    const waitFor = async (predicate, message, timeout = 8000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const value = await window.mazz.invoke('resources:snapshot');
        if (predicate(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(message);
    };
    const baseline = await window.mazz.invoke('resources:snapshot');
    let during = null;
    let panelDuring = null;
    let viewDuring = null;
    let watcherDuring = null;
    let torrentDuring = null;
    let pythonDuring = null;
    for (let index = 0; index < 20; index++) {
      const term = await window.mazz.invoke('term:create', { id: `w71-packaged-smoke-${index}`, cols: 40, rows: 8 });
      if (term?.error) throw new Error(term.error);
      during = await waitFor(value => value.byType.pty === 1, `PTY 第 ${index + 1} 次未进入账本`);
      await window.mazz.invoke('term:kill', { id: term.id });
      await waitFor(value => value.activeCount === baseline.activeCount, `PTY 第 ${index + 1} 次释放后未回基线`);

      await window.mazz.invoke('panel:open', { kind: 'settings' });
      panelDuring = await waitFor(value => value.byType['panel-window'] === 1, `PanelWindow 第 ${index + 1} 次未进入资源账本`);
      await window.mazz.invoke('panel:close', { kind: 'settings' });
      await waitFor(value => value.activeCount === baseline.activeCount, `PanelWindow 第 ${index + 1} 次关闭后未释放`);

      const tabId = `w71-ledger-view-${index}`;
      await window.mazz.invoke('bv:create', { tabId, partition: 'persist:mazz-browser', url: 'about:blank' });
      viewDuring = await waitFor(value => value.byType['web-contents-view'] === 1, `WebContentsView 第 ${index + 1} 次未进入资源账本`);
      await window.mazz.invoke('bv:destroy', { tabId });
      await waitFor(value => value.activeCount === baseline.activeCount, `WebContentsView 第 ${index + 1} 次关闭后未释放`);

      await window.mazz.invoke('fs:watch', { paths: [watchedFile] });
      watcherDuring = await waitFor(value => value.byType['file-watcher'] === 1, `FileWatcher 第 ${index + 1} 次未进入资源账本`);
      await window.mazz.invoke('fs:unwatch', { paths: [watchedFile] });
      await waitFor(value => value.activeCount === baseline.activeCount, `FileWatcher 第 ${index + 1} 次关闭后未释放`);

      const probe = await window.mazz.invoke('tor:runtimeProbe');
      if (!probe?.running || !probe?.listening || !probe?.port) throw new Error(`WebTorrent 第 ${index + 1} 次 runtime probe 失败`);
      torrentDuring = await waitFor(value => value.byType['torrent-client'] === 1 && value.byType['torrent-server'] === 1,
        `WebTorrent 第 ${index + 1} 次未进入资源账本`, 15000);
      await window.mazz.invoke('tor:runtimeReset');
      await waitFor(value => value.activeCount === baseline.activeCount, `WebTorrent 第 ${index + 1} 次关闭后未释放`, 15000);

      const python = await window.mazz.invoke('py:exec', { code: '1 + 1', timeout: 5000 });
      if (String(python?.output).trim() !== '2') throw new Error(`Python 第 ${index + 1} 次真实执行失败`);
      pythonDuring = await waitFor(value => value.byType['python-process'] === 1 && value.byType['temp-file'] === 1,
        `Python 第 ${index + 1} 次未进入资源账本`, 10000);
      await window.mazz.invoke('py:runtimeReset');
      await waitFor(value => value.activeCount === baseline.activeCount, `Python 第 ${index + 1} 次关闭后未释放`, 10000);
    }
    const resources = await window.mazz.invoke('resources:snapshot', { includeReleased: true });
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
      fileWatcherObserved: watcherDuring.byType['file-watcher'] === 1,
      torrentRuntimeObserved: torrentDuring.byType['torrent-client'] === 1 && torrentDuring.byType['torrent-server'] === 1,
      pythonRuntimeObserved: pythonDuring.byType['python-process'] === 1 && pythonDuring.byType['temp-file'] === 1,
      lifecycleCycles: 20,
      releasedResourcesRetained: resources.released?.length || 0,
      adapters: adapters.length,
      sessions: sessions.length,
    };
  }, path.join(workspace, 'packaged-smoke.md'));
  if (!result.title || result.resourceVersion !== 1 || !result.mainWindowObserved || !result.ptyObserved
    || !result.panelObserved || !result.webContentsViewObserved || !result.fileWatcherObserved || !result.torrentRuntimeObserved
    || !result.pythonRuntimeObserved || result.lifecycleCycles !== 20 || result.releasedResourcesRetained < 140
    || result.activeResources !== result.baselineResources || result.sessions !== 0) {
    throw new Error(`packaged smoke 断言失败：${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
