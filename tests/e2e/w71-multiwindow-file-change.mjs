// tests/e2e/w71-multiwindow-file-change.mjs —— packaged 主窗/分窗同文件外改与脏稿保护
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_MULTIWINDOW_FILE_CHANGE.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-multi-file-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-multi-file-ws-'));
const targetPath = path.join(workspace, 'multiwindow.md');
fs.writeFileSync(targetPath, '# 共同初始版本\n', 'utf8');
const normalizedPath = targetPath.replace(/\\/g, '/');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  await main.evaluate(async filePath => {
    await window.MazzShell.openFile(filePath);
    await window.mazz.invoke('fs:watch', { paths: [filePath] });
  }, normalizedPath);
  const baseline = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));

  const existingWindows = new Set(app.windows());
  await main.evaluate(() => window.mazz.invoke('window:openChild', { handoff: {} }));
  let child;
  for (let i = 0; i < 60 && !child; i++) {
    child = app.windows().find(win => !existingWindows.has(win));
    if (!child) await sleep(100);
  }
  if (!child) throw new Error('分窗未创建');
  await child.waitForLoadState('domcontentloaded');
  await child.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await child.evaluate(async filePath => {
    await window.MazzShell.openFile(filePath);
    await window.mazz.invoke('fs:watch', { paths: [filePath] });
  }, normalizedPath);
  await Promise.all([main, child].map(win => win.waitForFunction(() => {
    const tab = window.MazzShell.tabs.active;
    const inst = tab && window.MazzModules.instances.get(tab.id);
    return inst?.def.getContent(inst.state).includes('共同初始版本');
  }, null, { timeout: 15000 })));
  const withChildResources = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));
  if (withChildResources.activeCount !== baseline.activeCount + 1) {
    throw new Error(`分窗资源账本未按预期增长：${baseline.activeCount} -> ${withChildResources.activeCount}`);
  }

  const mainTitleBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(win => !win.isDestroyed() && !win.webContents.getURL().includes('role=child'))?.getTitle());
  await child.evaluate(() => window.mazz.invoke('window:setTitle', { title: 'W71 子窗所有权证明' }));
  const titleOwnership = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
    const mainWindow = windows.find(win => !win.webContents.getURL().includes('role=child'));
    const childWindow = windows.find(win => win.webContents.getURL().includes('role=child'));
    return { main: mainWindow?.getTitle(), child: childWindow?.getTitle() };
  });
  if (titleOwnership.main !== mainTitleBefore || titleOwnership.child !== 'W71 子窗所有权证明') {
    throw new Error(`分窗标题写错宿主：${JSON.stringify({ mainTitleBefore, titleOwnership })}`);
  }

  const childFullScreenOn = await child.evaluate(() => window.mazz.invoke('window:toggleFullScreen'));
  await child.waitForFunction(() => window.mazz.invoke('window:isFullScreen'), null, { timeout: 15000 });
  const fullScreenOwnership = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
    const mainWindow = windows.find(win => !win.webContents.getURL().includes('role=child'));
    const childWindow = windows.find(win => win.webContents.getURL().includes('role=child'));
    return { main: mainWindow?.isFullScreen(), child: childWindow?.isFullScreen() };
  });
  if (!childFullScreenOn || fullScreenOwnership.main || !fullScreenOwnership.child) {
    throw new Error(`分窗全屏写错宿主：${JSON.stringify({ childFullScreenOn, fullScreenOwnership })}`);
  }
  await child.evaluate(() => window.mazz.invoke('window:toggleFullScreen'));
  await child.waitForFunction(() => window.mazz.invoke('window:isFullScreen').then(on => !on), null, { timeout: 15000 });
  const childMaximized = await child.evaluate(() => window.mazz.invoke('window:toggleMaximize'));
  await child.waitForFunction(() => window.mazz.invoke('window:isMaximized'), null, { timeout: 15000 });
  const maximizeOwnership = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
    const mainWindow = windows.find(win => !win.webContents.getURL().includes('role=child'));
    const childWindow = windows.find(win => win.webContents.getURL().includes('role=child'));
    return { main: mainWindow?.isMaximized(), child: childWindow?.isMaximized() };
  });
  if (!childMaximized || maximizeOwnership.main || !maximizeOwnership.child) {
    throw new Error(`分窗最大化查询写错宿主：${JSON.stringify({ childMaximized, maximizeOwnership })}`);
  }
  await child.evaluate(() => window.mazz.invoke('window:toggleMaximize'));
  await child.waitForFunction(() => window.mazz.invoke('window:isMaximized').then(on => !on), null, { timeout: 15000 });

  await main.evaluate(() => {
    const tab = window.MazzShell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    inst.def.setContent('# 主窗本地脏稿\n', inst.state);
    window.MazzHost.notifyChange(tab.view);
  });
  fs.writeFileSync(targetPath, '# 磁盘外部版本\n', 'utf8');

  await main.waitForFunction(() => document.querySelector('.mazz-toast')?.textContent.includes('本地未保存内容已保留'), null, { timeout: 15000 });
  await child.waitForFunction(() => {
    const tab = window.MazzShell.tabs.active;
    const inst = tab && window.MazzModules.instances.get(tab.id);
    return !tab.dirty && inst?.def.getContent(inst.state).includes('磁盘外部版本');
  }, null, { timeout: 15000 });
  await sleep(800);

  const stateOf = win => win.evaluate(() => {
    const tab = window.MazzShell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    return {
      dirty: tab.dirty,
      content: inst.def.getContent(inst.state),
      actions: [...document.querySelectorAll('.mazz-toast button')].map(button => button.textContent),
    };
  });
  const beforeDecision = {
    main: await stateOf(main),
    child: await stateOf(child),
  };
  if (!beforeDecision.main.dirty || !beforeDecision.main.content.includes('主窗本地脏稿')
    || beforeDecision.main.content.includes('磁盘外部版本')) {
    throw new Error(`主窗脏稿未保留：${JSON.stringify(beforeDecision.main)}`);
  }
  if (beforeDecision.child.dirty || !beforeDecision.child.content.includes('磁盘外部版本')) {
    throw new Error(`分窗未同步磁盘版本：${JSON.stringify(beforeDecision.child)}`);
  }
  if (!beforeDecision.main.actions.includes('另存当前…') || !beforeDecision.main.actions.includes('从磁盘载入')) {
    throw new Error(`主窗冲突决策不完整：${JSON.stringify(beforeDecision.main.actions)}`);
  }

  await main.locator('.mazz-toast button', { hasText: '从磁盘载入' }).click();
  await main.waitForFunction(() => {
    const tab = window.MazzShell.tabs.active;
    const inst = tab && window.MazzModules.instances.get(tab.id);
    return !tab.dirty && inst?.def.getContent(inst.state).includes('磁盘外部版本');
  }, null, { timeout: 15000 });
  const converged = { main: await stateOf(main), child: await stateOf(child) };

  const childClosed = child.waitForEvent('close', { timeout: 15000 });
  await child.evaluate(() => window.mazz.invoke('window:close'));
  await childClosed;
  await main.waitForFunction(expected => window.mazz.invoke('resources:snapshot').then(x => x.activeCount === expected), baseline.activeCount, { timeout: 15000 });
  const finalResources = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    executablePath,
    beforeDecision,
    converged,
    titleOwnership,
    fullScreenOwnership,
    maximizeOwnership,
    resources: {
      baseline: baseline.activeCount,
      withChild: withChildResources.activeCount,
      final: finalResources.activeCount,
    },
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try { await app?.close(); } catch {}
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
