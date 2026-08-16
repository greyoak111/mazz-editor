// tests/e2e/w71-window-handoff-runtime.mjs —— packaged 多窗口标签两阶段交接与 20 次往返
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_WINDOW_HANDOFF_RUNTIME.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-handoff-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-handoff-ws-'));
const targetPath = path.join(workspace, 'handoff.md');
const expectedContent = '# 交接证明\n\nalpha beta gamma delta';
fs.writeFileSync(targetPath, '# 磁盘基线\n', 'utf8');
const normalizedPath = targetPath.replace(/\\/g, '/');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const tabState = win => win.evaluate(() => {
  const tab = window.MazzShell.tabs.active;
  if (!tab) return null;
  const inst = window.MazzModules.instances.get(tab.id);
  return {
    id: tab.id,
    filePath: tab.filePath,
    content: inst.def.getContent(inst.state),
    dirty: tab.dirty,
    pinned: tab.pinned,
    progress: inst.def.captureProgress?.(inst.state) || null,
  };
});

const assertOwnerState = async (win, label) => {
  const state = await tabState(win);
  if (!state || state.content !== expectedContent || !state.dirty || !state.pinned
    || state.progress?.from !== 4 || state.progress?.to !== 12) {
    throw new Error(`${label} 交接状态漂移：${JSON.stringify(state)}`);
  }
  return state;
};

const waitOwner = async win => win.waitForFunction(expected => {
  const tab = window.MazzShell.tabs.active;
  if (!tab) return false;
  const inst = window.MazzModules.instances.get(tab.id);
  const progress = inst?.def?.captureProgress?.(inst.state);
  return inst?.def?.getContent(inst.state) === expected
    && tab.dirty && tab.pinned && progress?.from === 4 && progress?.to === 12;
}, expectedContent, { timeout: 20000 });

const waitEmpty = async win => win.waitForFunction(() => !window.MazzShell.tabs.active, null, { timeout: 20000 });

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
    inst.def.applyProgress({ from: 4, to: 12 }, inst.state);
    tab.pinned = true;
    shell.tabs.render();
    window.MazzHost.notifyChange(tab.view);
  }, expectedContent);
  await assertOwnerState(main, '初始主窗');
  const baseline = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));

  const existing = new Set(app.windows());
  await main.evaluate(async () => {
    const shell = window.MazzShell;
    await shell.moveTabToNewWindow(shell.tabs.activeId);
  });
  let child;
  for (let i = 0; i < 80 && !child; i++) {
    child = app.windows().find(win => !existing.has(win));
    if (!child) await sleep(100);
  }
  if (!child) throw new Error('分窗未创建');
  await child.waitForLoadState('domcontentloaded');
  await child.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await waitOwner(child);
  await waitEmpty(main);
  const withChild = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));
  if (withChild.activeCount !== baseline.activeCount + 1) {
    throw new Error(`分窗资源未入账：${baseline.activeCount} -> ${withChild.activeCount}`);
  }

  // 目标已有同文件时必须 NACK，源脏稿仍留在原 owner，不能被“发送成功”假象删除。
  await main.evaluate(async filePath => window.MazzShell.openFile(filePath), normalizedPath);
  await main.waitForFunction(() => !!window.MazzShell.tabs.active, null, { timeout: 15000 });
  await child.evaluate(() => window.MazzCommands.execute('tab.moveToMainWindow'));
  const rejected = await assertOwnerState(child, '重复文件 NACK 后子窗');
  const duplicateMain = await tabState(main);
  if (!duplicateMain || !duplicateMain.content.includes('磁盘基线') || duplicateMain.content === expectedContent || duplicateMain.dirty) {
    throw new Error(`重复文件 NACK 未保留目标原标签：${JSON.stringify(duplicateMain)}`);
  }
  await main.evaluate(() => window.MazzShell.closeTabFlow(window.MazzShell.tabs.activeId));
  await waitEmpty(main);

  const samples = [];
  for (let cycle = 1; cycle <= 20; cycle++) {
    await child.evaluate(() => window.MazzCommands.execute('tab.moveToMainWindow'));
    await waitOwner(main);
    await waitEmpty(child);
    const mainState = await assertOwnerState(main, `第 ${cycle} 轮主窗`);

    const childId = await main.evaluate(async () => (await window.mazz.invoke('window:listChildren'))[0]?.id);
    if (!childId) throw new Error(`第 ${cycle} 轮找不到既有分窗`);
    await main.evaluate(async id => {
      const shell = window.MazzShell;
      await shell.moveTabToNewWindow(shell.tabs.activeId, { childId: id });
    }, childId);
    await waitOwner(child);
    await waitEmpty(main);
    const childState = await assertOwnerState(child, `第 ${cycle} 轮子窗`);
    await child.waitForFunction(() => window.mazz.invoke('snapshot:list').then(items => items.length === 1), null, { timeout: 15000 });
    if (cycle === 1 || cycle === 10 || cycle === 20) {
      samples.push({ cycle, mainTabId: mainState.id, childTabId: childState.id });
    }
  }

  await child.evaluate(() => window.MazzCommands.execute('tab.moveToMainWindow'));
  await waitOwner(main);
  await waitEmpty(child);
  const finalState = await assertOwnerState(main, '最终主窗');
  const childClosed = child.waitForEvent('close', { timeout: 15000 });
  await child.evaluate(() => window.mazz.invoke('window:close'));
  await childClosed;
  await main.waitForFunction(expected => window.mazz.invoke('resources:snapshot').then(x => x.activeCount === expected), baseline.activeCount, { timeout: 15000 });
  await main.waitForFunction(() => window.mazz.invoke('snapshot:list').then(items => items.length === 1), null, { timeout: 15000 });
  const finalResources = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const recovery = await main.evaluate(() => window.mazz.invoke('snapshot:list'));

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    executablePath,
    rejectedDuplicate: {
      sourcePreserved: rejected.content === expectedContent && rejected.dirty,
      targetPreserved: duplicateMain.content.includes('磁盘基线') && !duplicateMain.dirty,
    },
    roundTrips: 20,
    transfers: 42,
    samples,
    final: finalState,
    recoverySnapshots: recovery.map(item => ({ ownerId: item.ownerId, tabId: item.tabId, content: item.content, filePath: item.filePath })),
    resources: {
      baseline: baseline.activeCount,
      withChild: withChild.activeCount,
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
