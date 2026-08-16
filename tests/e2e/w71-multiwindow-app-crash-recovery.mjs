// w71-multiwindow-app-crash-recovery.mjs —— packaged multi-owner data salvage after whole-app hard termination
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_MULTIWINDOW_APP_CRASH_RECOVERY.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-multi-app-crash-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-multi-app-crash-ws-'));
const cases = [
  {
    name: 'main.md', content: '# 主窗事故稿\n\nmain alpha beta', progress: { from: 2, to: 8 },
  },
  {
    name: 'child.md', content: '# 分窗事故稿\n\nchild gamma delta', progress: { from: 3, to: 11 },
  },
].map(item => ({ ...item, path: path.join(workspace, item.name) }));
for (const item of cases) fs.writeFileSync(item.path, `# ${item.name} 磁盘基线\n`, 'utf8');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalized = value => String(value || '').replace(/\\/g, '/').toLowerCase();
const pidAlive = pid => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const killTree = pid => {
  if (!pid || !pidAlive(pid)) return;
  if (process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    process.kill(pid, 'SIGKILL');
  }
};
const quitClean = async application => {
  if (!application) return;
  const pid = application.process()?.pid;
  const closed = application.waitForEvent('close', { timeout: 30000 }).catch(() => null);
  await application.evaluate(({ app }) => app.quit()).catch(() => {});
  await closed;
  for (let i = 0; i < 60 && pidAlive(pid); i++) await sleep(100);
  if (pidAlive(pid)) throw new Error(`正常退出后主进程仍存活：${pid}`);
};
const disposeTestApp = async application => {
  if (!application) return;
  const pid = application.process()?.pid;
  try { await quitClean(application); } catch {
    try { killTree(pid); } catch {}
    for (let i = 0; i < 60 && pidAlive(pid); i++) await sleep(100);
  }
};
const removeTemp = target => {
  try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); }
  catch (error) { console.warn(`[w71-multi-app-crash] 临时目录延迟清理：${target} (${error.code || error.message})`); }
};
const launch = () => electron.launch({
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
const readyMain = async application => {
  const win = await application.firstWindow({ timeout: 120000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  return win;
};
const allTabStates = win => win.evaluate(() => window.MazzShell.paneTree.leaves()
  .flatMap(leaf => leaf.tabs.tabs)
  .map(tab => {
    const inst = window.MazzModules.instances.get(tab.id);
    return {
      id: tab.id, title: tab.title, filePath: tab.filePath,
      content: inst?.def?.getContent(inst.state), dirty: tab.dirty, pinned: tab.pinned,
      progress: inst?.def?.captureProgress?.(inst.state) || null,
    };
  }));
const assertCase = (states, item, label) => {
  const state = states.find(x => normalized(x.filePath) === normalized(item.path));
  if (!state || state.content !== item.content || !state.dirty || !state.pinned
    || state.progress?.from !== item.progress.from || state.progress?.to !== item.progress.to) {
    throw new Error(`${label} 状态漂移：${JSON.stringify({ expected: item, states })}`);
  }
  return state;
};

let app;
let crashedPid = null;
try {
  app = await launch();
  let main = await readyMain(app);
  await main.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
  });

  await main.evaluate(async item => {
    await window.MazzShell.openFile(item.path.replace(/\\/g, '/'));
    const shell = window.MazzShell;
    const tab = shell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    inst.def.setContent(item.content, inst.state);
    inst.def.applyProgress(item.progress, inst.state);
    tab.pinned = true;
    shell.tabs.render();
    window.MazzHost.notifyChange(tab.view);
    await window.mazz.invoke('snapshot:write', { tabId: tab.id, ...shell.snapshotPayload(tab, inst) });
  }, cases[0]);

  await main.evaluate(async item => {
    await window.MazzShell.openFile(item.path.replace(/\\/g, '/'));
    const shell = window.MazzShell;
    const tab = shell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    inst.def.setContent(item.content, inst.state);
    inst.def.applyProgress(item.progress, inst.state);
    tab.pinned = true;
    shell.tabs.render();
    window.MazzHost.notifyChange(tab.view);
  }, cases[1]);
  const existing = new Set(app.windows());
  await main.evaluate(() => window.MazzShell.moveTabToNewWindow(window.MazzShell.tabs.activeId));
  let child;
  for (let i = 0; i < 100 && !child; i++) {
    child = app.windows().find(win => !existing.has(win));
    if (!child) await sleep(100);
  }
  if (!child) throw new Error('分窗未创建');
  await child.waitForLoadState('domcontentloaded');
  await child.waitForFunction(() => !!window.MazzShell?.tabs?.active, null, { timeout: 30000 });
  await child.evaluate(async () => {
    const shell = window.MazzShell;
    const tab = shell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    await window.mazz.invoke('snapshot:write', { tabId: tab.id, ...shell.snapshotPayload(tab, inst) });
  });

  const beforeStates = [...await allTabStates(main), ...await allTabStates(child)];
  const mainBefore = assertCase(beforeStates, cases[0], '事故前主窗');
  const childBefore = assertCase(beforeStates, cases[1], '事故前分窗');
  const beforeSnapshots = await main.evaluate(() => window.mazz.invoke('snapshot:list'));
  if (beforeSnapshots.length !== 2 || new Set(beforeSnapshots.map(x => x.ownerId)).size !== 2) {
    throw new Error(`事故前多 owner 快照异常：${JSON.stringify(beforeSnapshots)}`);
  }
  if (new Set(beforeSnapshots.map(x => x.tabId)).size !== 1) {
    throw new Error(`本门禁未形成跨 renderer 同名 tabId 碰撞：${JSON.stringify(beforeSnapshots)}`);
  }
  const baselineResources = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));

  crashedPid = app.process().pid;
  const crashed = app.waitForEvent('close', { timeout: 30000 }).catch(() => null);
  killTree(crashedPid);
  await crashed;
  for (let i = 0; i < 100 && pidAlive(crashedPid); i++) await sleep(100);
  if (pidAlive(crashedPid)) throw new Error(`强制终止后主进程仍存活：${crashedPid}`);
  app = null;
  await sleep(1000);

  app = await launch();
  main = await readyMain(app);
  await main.waitForSelector('.recovery-bar', { timeout: 30000 });
  const prompt = await main.locator('.recovery-bar').innerText();
  if (!prompt.includes('2 份')) throw new Error(`多窗口恢复提示数量不符：${prompt}`);
  await main.locator('.recovery-bar button').first().click();
  await main.waitForFunction(expected => {
    const states = window.MazzShell.paneTree.leaves().flatMap(leaf => leaf.tabs.tabs).map(tab => {
      const inst = window.MazzModules.instances.get(tab.id);
      return { filePath: tab.filePath, content: inst?.def?.getContent(inst.state), dirty: tab.dirty, pinned: tab.pinned };
    });
    return expected.every(item => states.some(state => String(state.filePath || '').replace(/\\/g, '/').toLowerCase()
      === item.path.replace(/\\/g, '/').toLowerCase()
      && state.content === item.content && state.dirty && state.pinned));
  }, cases, { timeout: 30000 });
  const restoredStates = await allTabStates(main);
  const restored = cases.map(item => assertCase(restoredStates, item, `恢复后 ${item.name}`));
  const afterSnapshots = await main.evaluate(() => window.mazz.invoke('snapshot:list'));
  if (afterSnapshots.length !== 2 || new Set(afterSnapshots.map(x => x.ownerId)).size !== 1) {
    throw new Error(`恢复后快照未收敛到当前主窗 owner：${JSON.stringify(afterSnapshots)}`);
  }
  if (beforeSnapshots.some(old => afterSnapshots.some(current => current.ownerId === old.ownerId))) {
    throw new Error('恢复后仍有旧 renderer owner 持有快照');
  }
  if (fs.existsSync(path.join(userData, 'snapshots', 'RECOVERY_PENDING.flag'))) {
    throw new Error('多 owner 恢复完成后 pending 标记未清除');
  }
  const restoredResources = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));

  await quitClean(app);
  app = null;
  app = await launch();
  main = await readyMain(app);
  await sleep(1500);
  const cleanOffer = await main.evaluate(() => window.mazz.invoke('crash:consumeAppRecovery'));
  if (cleanOffer?.snapshots?.length || await main.locator('.recovery-bar').count()) {
    throw new Error(`正常退出后的下一轮仍误报恢复：${JSON.stringify(cleanOffer)}`);
  }

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    executablePath,
    crashedPid,
    prompt,
    before: {
      windows: 2,
      states: [mainBefore, childBefore],
      snapshots: beforeSnapshots.map(x => ({ ownerId: x.ownerId, tabId: x.tabId, filePath: x.filePath })),
      sameTabIdAcrossOwners: new Set(beforeSnapshots.map(x => x.tabId)).size === 1,
      resources: baselineResources.activeCount,
    },
    restored: {
      fallback: 'flattened-into-main-window',
      states: restored,
      snapshots: afterSnapshots.map(x => ({ ownerId: x.ownerId, tabId: x.tabId, filePath: x.filePath })),
      oneCurrentOwner: new Set(afterSnapshots.map(x => x.ownerId)).size === 1,
      resources: restoredResources.activeCount,
    },
    pendingCleared: !fs.existsSync(path.join(userData, 'snapshots', 'RECOVERY_PENDING.flag')),
    cleanRestartHasNoOffer: true,
    topologyRestored: false,
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await disposeTestApp(app);
  removeTemp(userData);
  removeTemp(workspace);
}
