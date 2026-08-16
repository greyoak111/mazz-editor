// tests/e2e/w71-child-crash-recovery.mjs —— packaged child renderer crash / reload / owner snapshot restore
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_CHILD_CRASH_RECOVERY.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-child-crash-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-child-crash-ws-'));
const targetPath = path.join(workspace, 'child-crash.md');
const expectedContent = '# 分窗崩溃恢复\n\nalpha beta gamma';
fs.writeFileSync(targetPath, '# 磁盘基线\n', 'utf8');
const normalizedPath = targetPath.replace(/\\/g, '/');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const stateOf = win => win.evaluate(() => {
  const tab = window.MazzShell?.tabs?.active;
  if (!tab) return null;
  const inst = window.MazzModules.instances.get(tab.id);
  return {
    id: tab.id, title: tab.title, filePath: tab.filePath,
    content: inst.def.getContent(inst.state), dirty: tab.dirty, pinned: tab.pinned,
    progress: inst.def.captureProgress?.(inst.state) || null,
    role: new URLSearchParams(location.search).get('role') || 'main',
  };
});

const waitRestored = async win => {
  await win.waitForFunction(content => {
    const shell = window.MazzShell;
    const tab = shell?.tabs?.active;
    const inst = tab && window.MazzModules.instances.get(tab.id);
    const progress = inst?.def?.captureProgress?.(inst.state);
    return inst?.def?.getContent(inst.state) === content
      && tab.dirty && tab.pinned && progress?.from === 3 && progress?.to === 10;
  }, expectedContent, { timeout: 30000 });
  return stateOf(win);
};

const evaluateChild = (electronApp, expression) => electronApp.evaluate(async ({ BrowserWindow }, source) => {
  const target = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=child'));
  if (!target || target.isDestroyed() || target.webContents.isCrashed()) throw new Error('child renderer 尚不可用');
  return Promise.race([
    target.webContents.executeJavaScript(source, true),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('child executeJavaScript timeout')), 800)),
  ]);
}, expression);

const waitChildRestored = async electronApp => {
  let last = null;
  for (let i = 0; i < 200; i++) {
    try {
      const state = await evaluateChild(electronApp, `(() => {
        const tab = window.MazzShell?.tabs?.active;
        const inst = tab && window.MazzModules.instances.get(tab.id);
        const progress = inst?.def?.captureProgress?.(inst.state);
        if (inst?.def?.getContent(inst.state) !== ${JSON.stringify(expectedContent)}
          || !tab.dirty || !tab.pinned || progress?.from !== 3 || progress?.to !== 10) return null;
        return { id: tab.id, title: tab.title, filePath: tab.filePath,
          content: inst.def.getContent(inst.state), dirty: tab.dirty, pinned: tab.pinned,
          progress, role: new URLSearchParams(location.search).get('role') || 'main' };
      })()`);
      if (state) return state;
      last = state;
    } catch (error) { last = String(error?.message || error); }
    await sleep(100);
  }
  const runtime = await electronApp.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=child'));
    return target ? {
      url: target.webContents.getURL(), crashed: target.webContents.isCrashed(), loading: target.webContents.isLoading(),
    } : null;
  }).catch(() => null);
  throw new Error(`child crash 后 renderer 未恢复标签状态：${JSON.stringify({ last, runtime })}`);
};

let app;
try {
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
    },
    timeout: 120000,
  });
  const main = await app.firstWindow({ timeout: 120000 });
  await main.waitForLoadState('domcontentloaded');
  await main.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await main.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
  });
  await main.evaluate(async filePath => window.MazzShell.openFile(filePath), normalizedPath);
  await main.waitForFunction(() => !!window.MazzShell.tabs.active, null, { timeout: 15000 });
  await main.evaluate(content => {
    const shell = window.MazzShell;
    const tab = shell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    inst.def.setContent(content, inst.state);
    inst.def.applyProgress({ from: 3, to: 10 }, inst.state);
    tab.pinned = true;
    shell.tabs.render();
    window.MazzHost.notifyChange(tab.view);
  }, expectedContent);
  const baseline = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));

  const existing = new Set(app.windows());
  await main.evaluate(() => window.MazzShell.moveTabToNewWindow(window.MazzShell.tabs.activeId));
  let child;
  for (let i = 0; i < 80 && !child; i++) {
    child = app.windows().find(win => !existing.has(win));
    if (!child) await sleep(100);
  }
  if (!child) throw new Error('分窗未创建');
  await child.waitForLoadState('domcontentloaded');
  await child.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  const initial = await waitRestored(child);
  const withChild = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));
  if (withChild.activeCount !== baseline.activeCount + 1) throw new Error('分窗资源未入账');

  const cycles = [];
  const requestedCycles = Math.max(1, Number(process.env.MAZZ_E2E_CRASH_CYCLES || 5));
  for (let cycle = 1; cycle <= requestedCycles; cycle++) {
    await app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=child'));
      if (!target) throw new Error('找不到 child BrowserWindow');
      target.webContents.forcefullyCrashRenderer();
    });
    const restored = await waitChildRestored(app);
    const resources = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));
    const recovery = await evaluateChild(app, "window.mazz.invoke('snapshot:list')");
    if (resources.activeCount !== withChild.activeCount) {
      throw new Error(`第 ${cycle} 轮 crash 后资源漂移：${resources.activeCount}/${withChild.activeCount}`);
    }
    if (recovery.length !== 1 || !recovery[0].filePath?.endsWith('child-crash.md')) {
      throw new Error(`第 ${cycle} 轮 owner 快照未收敛：${JSON.stringify(recovery)}`);
    }
    if (restored.title !== 'child-crash.md（已恢复）') {
      throw new Error(`第 ${cycle} 轮恢复标题累加或漂移：${restored.title}`);
    }
    cycles.push({ cycle, tabId: restored.id, title: restored.title, resources: resources.activeCount, snapshots: recovery.length });
    console.log(`[w71-child-crash] ${cycle}/${requestedCycles} PASS`);
  }

  await evaluateChild(app, "window.MazzCommands.execute('tab.moveToMainWindow')");
  await main.waitForFunction(content => {
    const tab = window.MazzShell?.tabs?.active;
    const inst = tab && window.MazzModules.instances.get(tab.id);
    return inst?.def?.getContent(inst.state) === content && tab.dirty && tab.pinned;
  }, expectedContent, { timeout: 20000 });
  const finalState = await stateOf(main);
  await app.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=child'));
    target?.close();
  });
  for (let i = 0; i < 100; i++) {
    const exists = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .some(win => win.webContents.getURL().includes('role=child')));
    if (!exists) break;
    await sleep(100);
  }
  await main.waitForFunction(expected => window.mazz.invoke('resources:snapshot').then(x => x.activeCount === expected), baseline.activeCount, { timeout: 15000 });
  const finalResources = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const finalSnapshots = await main.evaluate(() => window.mazz.invoke('snapshot:list'));

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    executablePath,
    crashCycles: cycles.length,
    initial,
    cycles,
    final: finalState,
    recoverySnapshots: finalSnapshots.map(x => ({
      ownerId: x.ownerId, tabId: x.tabId, dirty: x.dirty, pinned: x.pinned, progress: x.progress,
    })),
    resources: { baseline: baseline.activeCount, withChild: withChild.activeCount, final: finalResources.activeCount },
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try { await app?.close(); } catch {}
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
