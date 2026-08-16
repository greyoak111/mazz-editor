// w71-app-crash-recovery.mjs —— packaged main-process hard termination / next-launch recovery
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_APP_CRASH_RECOVERY.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-app-crash-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-app-crash-ws-'));
const targetPath = path.join(workspace, 'app-crash.md');
const expectedContent = '# 整应用异常退出恢复\n\nalpha beta gamma';
fs.writeFileSync(targetPath, '# 磁盘基线\n', 'utf8');
const normalizedPath = targetPath.replace(/\\/g, '/');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  catch (error) { console.warn(`[w71-app-crash] 临时目录延迟清理：${target} (${error.code || error.message})`); }
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

const readyMain = async app => {
  const win = await app.firstWindow({ timeout: 120000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  return win;
};

const stateOf = win => win.evaluate(() => {
  const tab = window.MazzShell?.tabs?.active;
  if (!tab) return null;
  const inst = window.MazzModules.instances.get(tab.id);
  return {
    id: tab.id, title: tab.title, filePath: tab.filePath,
    content: inst.def.getContent(inst.state), dirty: tab.dirty, pinned: tab.pinned,
    progress: inst.def.captureProgress?.(inst.state) || null,
  };
});

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
  await main.evaluate(async filePath => window.MazzShell.openFile(filePath), normalizedPath);
  await main.waitForFunction(() => !!window.MazzShell.tabs.active, null, { timeout: 15000 });
  const before = await main.evaluate(async content => {
    const shell = window.MazzShell;
    const tab = shell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    inst.def.setContent(content, inst.state);
    inst.def.applyProgress({ from: 5, to: 14 }, inst.state);
    tab.pinned = true;
    shell.tabs.render();
    window.MazzHost.notifyChange(tab.view);
    await window.mazz.invoke('snapshot:write', { tabId: tab.id, ...shell.snapshotPayload(tab, inst) });
    const snapshots = await window.mazz.invoke('snapshot:list');
    return { tabId: tab.id, ownerId: snapshots[0]?.ownerId, snapshots: snapshots.length };
  }, expectedContent);
  if (before.snapshots !== 1) throw new Error(`事故前快照数量异常：${before.snapshots}`);

  crashedPid = app.process().pid;
  const crashed = app.waitForEvent('close', { timeout: 30000 }).catch(() => null);
  killTree(crashedPid);
  await crashed;
  for (let i = 0; i < 100 && pidAlive(crashedPid); i++) await sleep(100);
  if (pidAlive(crashedPid)) throw new Error(`强制终止后主进程仍存活：${crashedPid}`);
  app = null;
  await sleep(1000);
  if (!fs.existsSync(path.join(userData, 'snapshots', 'RUNNING.flag'))) {
    throw new Error('强制终止后 RUNNING.flag 未保留，事故证据无效');
  }

  app = await launch();
  main = await readyMain(app);
  await main.waitForSelector('.recovery-bar', { timeout: 30000 });
  const prompt = await main.locator('.recovery-bar').innerText();
  if (!prompt.includes('1 份')) throw new Error(`恢复提示数量不符：${prompt}`);
  await main.locator('.recovery-bar button').first().click();
  await main.waitForFunction(content => {
    const tab = window.MazzShell?.tabs?.active;
    const inst = tab && window.MazzModules.instances.get(tab.id);
    const progress = inst?.def?.captureProgress?.(inst.state);
    return inst?.def?.getContent(inst.state) === content
      && tab.dirty && tab.pinned && progress?.from === 5 && progress?.to === 14;
  }, expectedContent, { timeout: 30000 });
  const restored = await stateOf(main);
  const after = await main.evaluate(() => window.mazz.invoke('snapshot:list'));
  if (after.length !== 1) throw new Error(`恢复后旧/新快照未收敛：${after.length}`);
  if (after[0].ownerId === before.ownerId) throw new Error('恢复后仍由旧 run owner 持有快照');
  if (fs.existsSync(path.join(userData, 'snapshots', 'RECOVERY_PENDING.flag'))) {
    throw new Error('完成恢复后 pending 标记未清除');
  }

  await quitClean(app);
  app = null;
  if (fs.existsSync(path.join(userData, 'snapshots', 'RUNNING.flag'))) {
    throw new Error('正常退出后 RUNNING.flag 未清除');
  }

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
    before,
    prompt,
    restored,
    recoverySnapshotsAfterRestore: after.map(x => ({
      ownerId: x.ownerId, tabId: x.tabId, dirty: x.dirty, pinned: x.pinned, progress: x.progress,
    })),
    pendingCleared: !fs.existsSync(path.join(userData, 'snapshots', 'RECOVERY_PENDING.flag')),
    cleanRestartHasNoOffer: true,
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await disposeTestApp(app);
  removeTemp(userData);
  removeTemp(workspace);
}
