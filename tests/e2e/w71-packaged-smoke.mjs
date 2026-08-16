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
fs.writeFileSync(path.join(workspace, 'packaged-viewer.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2563eb"/></svg>', 'utf8');

let app;
try {
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
      MAZZ_E2E_FACTORY_MOCK: '1',
      MAZZ_E2E_FACTORY_DELAY_MS: '100',
      NODE_ENV: 'test',
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }));
  await win.waitForFunction(() => !!window.MazzShell, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('panel:close', { kind: 'agreement' });
  });
  await new Promise(resolve => setTimeout(resolve, 250));
  await win.evaluate(() => window.mazz.invoke('panel:close', { kind: 'agreement' }));
  const result = await win.evaluate(async ({ watchedFile, viewerFile }) => {
    const waitFor = async (predicate, message, timeout = 8000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const value = await window.mazz.invoke('resources:snapshot');
        if (predicate(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(message);
    };
    const waitForLocal = async (predicate, message, timeout = 8000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const value = predicate();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(message);
    };
    const baseline = await window.mazz.invoke('resources:snapshot');
    await window.MazzCommands.execute('file.newCode');
    const fastCloseCtl = window.__activeCodeCtl;
    const fastCloseTabId = window.MazzShell.tabs.activeId;
    if (!fastCloseCtl || !fastCloseTabId) throw new Error('Monaco 迟到初始化探针未创建宿主');
    await window.MazzShell.closeTabFlow(fastCloseTabId);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const lateInitGuardObserved = fastCloseCtl.disposed && !fastCloseCtl.editor && !fastCloseCtl.model
      && !fastCloseCtl.root?.isConnected && !window.__activeCodeCtl && !document.querySelector('.code-root');
    if (!lateInitGuardObserved) throw new Error('Monaco 标签先关闭后仍被迟到初始化复活');
    let during = null;
    let panelDuring = null;
    let viewDuring = null;
    let watcherDuring = null;
    let torrentDuring = null;
    let pythonDuring = null;
    let viewerDuring = null;
    let factoryDuring = null;
    let monacoDuring = null;
    let monacoWorkerDiagnostics = null;
    let monacoModelsAfterClose = null;
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

      await window.MazzShell.openFile(viewerFile);
      viewerDuring = await waitForLocal(() => {
        const tab = window.MazzShell.paneTree.leaves().flatMap(leaf => leaf.tabs.tabs)
          .find(item => item.moduleId === 'viewer' && item.filePath === viewerFile);
        const registry = window.MazzModulesReal || window.MazzModules;
        const inst = tab && registry?.instances?.get(tab.id);
        const img = inst?.state?.body?.querySelector('img');
        return tab && inst?.state?.root?.isConnected && img?.complete && img.naturalWidth > 0 ? { tabId: tab.id } : null;
      }, `Viewer 第 ${index + 1} 次未完成真实装载`);
      await window.MazzShell.closeTabFlow(viewerDuring.tabId);
      await waitForLocal(() => {
        const registry = window.MazzModulesReal || window.MazzModules;
        const hasViewerInstance = [...(registry?.instances?.values?.() || [])].some(inst => inst.name === 'viewer');
        return !hasViewerInstance && !document.querySelector('.viewer-root') && !window.__activeViewerCtl;
      }, `Viewer 第 ${index + 1} 次关闭后仍有实例、DOM 或活动锚点`);

      await window.MazzCommands.execute('file.newCode');
      monacoDuring = await waitForLocal(() => {
        const ctl = window.__activeCodeCtl;
        const tab = window.MazzShell.paneTree.leaves().flatMap(leaf => leaf.tabs.tabs)
          .find(item => item.moduleId === 'code' && item.id === window.MazzShell.tabs.activeId);
        return ctl?.ready && ctl.model && ctl.editor && ctl.monaco && tab ? { ctl, tabId: tab.id } : null;
      }, `Monaco 第 ${index + 1} 次未完成真实装载`, 15000);
      const { ctl: codeCtl, tabId: codeTabId } = monacoDuring;
      const monaco = codeCtl.monaco;
      const source = `const answer: number = "wrong-${index}";\nanswer;`;
      codeCtl._loading = true;
      try { codeCtl.model.setValue(source); } finally { codeCtl._loading = false; }
      monaco.editor.setModelLanguage(codeCtl.model, 'typescript');
      let typeScriptWorker = null;
      let workerError = null;
      for (let attempt = 0; attempt < 100 && !typeScriptWorker; attempt++) {
        try {
          const getTypeScriptWorker = await monaco.languages.typescript.getTypeScriptWorker();
          typeScriptWorker = await getTypeScriptWorker(codeCtl.model.uri);
        } catch (error) {
          workerError = error;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      if (!typeScriptWorker) throw workerError || new Error('TypeScript worker 未就绪');
      const diagnostics = await typeScriptWorker.getSemanticDiagnostics(codeCtl.model.uri.toString());
      if (!diagnostics.some(item => Number(item.code) === 2322)) {
        throw new Error(`Monaco 第 ${index + 1} 次 TypeScript worker 未返回真实类型诊断`);
      }
      await window.MazzShell.closeTabFlow(codeTabId);
      await waitForLocal(() => {
        const registry = window.MazzModulesReal || window.MazzModules;
        const hasCodeInstance = [...(registry?.instances?.values?.() || [])].some(inst => inst.name === 'code');
        monacoModelsAfterClose = monaco.editor.getModels().length;
        return !hasCodeInstance && !document.querySelector('.code-root') && !window.__activeCodeCtl
          && monacoModelsAfterClose === 0;
      }, `Monaco 第 ${index + 1} 次关闭后仍有实例、DOM、活动锚点或 model`);
      monacoWorkerDiagnostics = codeCtl.getWorkerDiagnostics();

      const requestId = `w71-packaged-factory-${index}`;
      const factoryRequest = window.mazz.invoke('factory:aiChatStream', {
        requestId, baseURL: 'mock://w71-packaged', apiKey: 'local-test-key', model: 'w71-local',
        user: `Factory lifecycle ${index}`, temperature: 0, maxTokens: 200,
      });
      factoryDuring = await waitFor(value => value.byType['factory-ai-request'] === 1,
        `Factory AI 第 ${index + 1} 次未进入资源账本`);
      const cancelled = await window.mazz.invoke('factory:aiCancel', { requestId, reason: 'packaged-smoke' });
      const finished = await factoryRequest;
      if (!cancelled?.cancelled || !finished?.cancelled) throw new Error(`Factory AI 第 ${index + 1} 次取消未贯通`);
      await waitFor(value => value.activeCount === baseline.activeCount, `Factory AI 第 ${index + 1} 次取消后未释放`);
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
      viewerRuntimeObserved: !!viewerDuring?.tabId,
      factoryRequestObserved: factoryDuring.byType['factory-ai-request'] === 1,
      monacoWorkerObserved: (monacoWorkerDiagnostics?.byLabel?.typescript || 0) >= 1,
      monacoLateInitGuardObserved: lateInitGuardObserved,
      monacoWorkersCreated: monacoWorkerDiagnostics?.created || 0,
      monacoWorkersActive: monacoWorkerDiagnostics?.active ?? -1,
      monacoWorkersTerminated: monacoWorkerDiagnostics?.terminated || 0,
      monacoWorkerErrors: monacoWorkerDiagnostics?.errors || 0,
      monacoModelsAfterClose,
      lifecycleCycles: 20,
      viewerLifecycleCycles: 20,
      factoryLifecycleCycles: 20,
      monacoLifecycleCycles: 20,
      releasedResourcesRetained: resources.released?.length || 0,
      adapters: adapters.length,
      sessions: sessions.length,
    };
  }, { watchedFile: path.join(workspace, 'packaged-smoke.md'), viewerFile: path.join(workspace, 'packaged-viewer.svg') });
  if (!result.title || result.resourceVersion !== 1 || !result.mainWindowObserved || !result.ptyObserved
    || !result.panelObserved || !result.webContentsViewObserved || !result.fileWatcherObserved || !result.torrentRuntimeObserved
    || !result.pythonRuntimeObserved || !result.viewerRuntimeObserved || !result.factoryRequestObserved
    || !result.monacoWorkerObserved || !result.monacoLateInitGuardObserved
    || result.monacoWorkerErrors !== 0 || result.monacoModelsAfterClose !== 0
    || result.monacoWorkersActive > 2 || result.monacoWorkersCreated > 22
    || result.monacoWorkersTerminated + result.monacoWorkersActive !== result.monacoWorkersCreated
    || result.lifecycleCycles !== 20 || result.viewerLifecycleCycles !== 20 || result.factoryLifecycleCycles !== 20
    || result.monacoLifecycleCycles !== 20
    || result.releasedResourcesRetained < 160
    || result.activeResources !== result.baselineResources || result.sessions !== 0) {
    throw new Error(`packaged smoke 断言失败：${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
