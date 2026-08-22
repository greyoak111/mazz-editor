// tests/e2e/w71-window-handoff-runtime.mjs —— packaged 多窗口标签两阶段交接与 20 次往返
import { _electron as electron } from 'playwright';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_WINDOW_HANDOFF_RUNTIME.json');
const bundlePath = path.join(root, 'renderer', 'dist', 'app.js');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);
if (!fs.existsSync(bundlePath)) throw new Error(`renderer bundle 不存在：${bundlePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-handoff-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-handoff-ws-'));
const targetPath = path.join(workspace, 'handoff.md');
const expectedContent = '# 交接证明\n\nalpha beta gamma delta';
fs.writeFileSync(targetPath, '# 磁盘基线\n', 'utf8');
const normalizedPath = targetPath.replace(/\\/g, '/');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const requestedCycles = Math.max(1, Number(process.env.MAZZ_W71_CYCLES || 20) || 20);
const actionTimeoutMs = Math.max(15000, Number(process.env.MAZZ_W71_ACTION_TIMEOUT_MS || 45000) || 45000);
const totalTimeoutMs = Math.max(60000, Number(process.env.MAZZ_W71_TOTAL_TIMEOUT_MS || 300000) || 300000);
const startedAt = Date.now();
const phaseDurations = [];
const sha256File = filePath => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const trace = (phase, detail = '') => {
  const elapsed = String(Date.now() - startedAt).padStart(6, ' ');
  console.log(`[w71-handoff +${elapsed}ms] ${phase}${detail ? ` :: ${detail}` : ''}`);
};
const timed = async (phase, task, timeoutMs = actionTimeoutMs) => {
  trace(`${phase}:start`);
  const phaseStartedAt = Date.now();
  let timer;
  try {
    const value = await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${phase} 超过 ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    phaseDurations.push({ phase, durationMs: Date.now() - phaseStartedAt, status: 'pass' });
    trace(`${phase}:done`);
    return value;
  } catch (error) {
    phaseDurations.push({ phase, durationMs: Date.now() - phaseStartedAt, status: 'fail', error: error?.message || String(error) });
    trace(`${phase}:failed`, error?.stack || error?.message || String(error));
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
const stableResourceSummary = snapshot => {
  const active = (snapshot?.active || []).filter(entry => entry.type !== 'agent-cli-process');
  const byType = {};
  for (const entry of active) byType[entry.type] = (byType[entry.type] || 0) + 1;
  return { activeCount: active.length, byType };
};

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
let watchdog;
const neutralizeTestTabs = async () => {
  await Promise.race([
    Promise.allSettled((app?.windows() || []).map(win => win.evaluate(() => {
      for (const leaf of window.MazzShell?.paneTree?.leaves?.() || []) {
        for (const tab of leaf.tabs.tabs) {
          tab.dirty = false;
          tab.forceClose = true;
        }
      }
    }))),
    sleep(3000),
  ]);
};
const closeTestAppBounded = async (timeoutMs = 5000) => {
  await neutralizeTestTabs().catch(() => {});
  const closed = await Promise.race([
    Promise.resolve().then(() => app?.close()).then(() => true, () => false),
    sleep(timeoutMs).then(() => false),
  ]);
  if (!closed) {
    try { app?.process()?.kill(); } catch {}
    await sleep(250);
  }
  return closed;
};
try {
  watchdog = setTimeout(() => {
    trace('total-timeout', `${totalTimeoutMs}ms；强制关闭 Electron`);
    void closeTestAppBounded(3000).catch(() => {
      try { app?.process()?.kill(); } catch {}
    }).finally(() => { process.exit(124); });
  }, totalTimeoutMs);
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
  app.on('console', message => {
    const type = typeof message?.type === 'function' ? message.type() : 'log';
    const body = typeof message?.text === 'function' ? message.text() : String(message || '');
    trace(`electron:${type}`, body);
  });
  const main = await app.firstWindow({ timeout: 120000 });
  main.on('console', message => trace(`main-renderer:${message.type()}`, message.text()));
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
  await timed('initial main->new-child command', () => main.evaluate(async () => {
    const shell = window.MazzShell;
    await shell.moveTabToNewWindow(shell.tabs.activeId);
  }));
  let child;
  for (let i = 0; i < 80 && !child; i++) {
    child = app.windows().find(win => !existing.has(win));
    if (!child) await sleep(100);
  }
  if (!child) throw new Error('分窗未创建');
  trace('child discovered');
  child.on('console', message => trace(`child-renderer:${message.type()}`, message.text()));
  await timed('child domcontentloaded', () => child.waitForLoadState('domcontentloaded'));
  await timed('child shell ready', () => child.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 }));
  await timed('initial child owner', () => waitOwner(child));
  await timed('initial main empty', () => waitEmpty(main));
  const withChild = await timed('child resource snapshot', () => main.evaluate(() => window.mazz.invoke('resources:snapshot')));
  const baselineStable = stableResourceSummary(baseline);
  const withChildStable = stableResourceSummary(withChild);
  if (withChildStable.activeCount !== baselineStable.activeCount + 1
      || (withChildStable.byType['browser-window'] || 0) !== (baselineStable.byType['browser-window'] || 0) + 1) {
    throw new Error(`分窗资源未入账：${JSON.stringify({ baseline, withChild })}`);
  }

  // 目标已有同文件时必须 NACK，源脏稿仍留在原 owner，不能被“发送成功”假象删除。
  await timed('duplicate target open', () => main.evaluate(async filePath => window.MazzShell.openFile(filePath), normalizedPath));
  await timed('duplicate target active', () => main.waitForFunction(() => !!window.MazzShell.tabs.active, null, { timeout: 15000 }));
  await timed('duplicate child->main command', () => child.evaluate(() => window.MazzCommands.execute('tab.moveToMainWindow')));
  const rejected = await assertOwnerState(child, '重复文件 NACK 后子窗');
  const duplicateMain = await tabState(main);
  if (!duplicateMain || !duplicateMain.content.includes('磁盘基线') || duplicateMain.content === expectedContent || duplicateMain.dirty) {
    throw new Error(`重复文件 NACK 未保留目标原标签：${JSON.stringify(duplicateMain)}`);
  }
  await timed('duplicate target close', () => main.evaluate(() => window.MazzShell.closeTabFlow(window.MazzShell.tabs.activeId)));
  await timed('duplicate target empty', () => waitEmpty(main));

  const samples = [];
  for (let cycle = 1; cycle <= requestedCycles; cycle++) {
    await timed(`cycle ${cycle} child->main command`, () => child.evaluate(() => window.MazzCommands.execute('tab.moveToMainWindow')));
    await timed(`cycle ${cycle} main owner`, () => waitOwner(main));
    await timed(`cycle ${cycle} child empty`, () => waitEmpty(child));
    const mainState = await assertOwnerState(main, `第 ${cycle} 轮主窗`);

    const childId = await main.evaluate(async () => (await window.mazz.invoke('window:listChildren'))[0]?.id);
    if (!childId) throw new Error(`第 ${cycle} 轮找不到既有分窗`);
    await timed(`cycle ${cycle} main->child command`, () => main.evaluate(async id => {
      const shell = window.MazzShell;
      await shell.moveTabToNewWindow(shell.tabs.activeId, { childId: id });
    }, childId));
    await timed(`cycle ${cycle} child owner`, () => waitOwner(child));
    await timed(`cycle ${cycle} main empty`, () => waitEmpty(main));
    const childState = await assertOwnerState(child, `第 ${cycle} 轮子窗`);
    await child.waitForFunction(() => window.mazz.invoke('snapshot:list').then(items => items.length === 1), null, { timeout: 15000 });
    if (cycle === 1 || cycle === 10 || cycle === requestedCycles) {
      samples.push({ cycle, mainTabId: mainState.id, childTabId: childState.id });
    }
  }

  await timed('final child->main command', () => child.evaluate(() => window.MazzCommands.execute('tab.moveToMainWindow')));
  await timed('final main owner', () => waitOwner(main));
  await timed('final child empty', () => waitEmpty(child));
  const finalState = await assertOwnerState(main, '最终主窗');
  const childClosed = child.waitForEvent('close', { timeout: 15000 });
  await child.evaluate(() => window.mazz.invoke('window:close'));
  await childClosed;
  await main.waitForFunction(expected => window.mazz.invoke('resources:snapshot').then(x => {
    const stable = (x.active || []).filter(entry => entry.type !== 'agent-cli-process');
    const windows = stable.filter(entry => entry.type === 'browser-window').length;
    return stable.length === expected.activeCount && windows === expected.browserWindows;
  }), {
    activeCount: baselineStable.activeCount,
    browserWindows: baselineStable.byType['browser-window'] || 0,
  }, { timeout: 15000 });
  await main.waitForFunction(() => window.mazz.invoke('snapshot:list').then(items => items.length === 1), null, { timeout: 15000 });
  const finalResources = await main.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const recovery = await main.evaluate(() => window.mazz.invoke('snapshot:list'));

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    executablePath,
    artifacts: {
      executablePath,
      executableSha256: sha256File(executablePath),
      bundlePath,
      bundleSha256: sha256File(bundlePath),
    },
    rejectedDuplicate: {
      sourcePreserved: rejected.content === expectedContent && rejected.dirty,
      targetPreserved: duplicateMain.content.includes('磁盘基线') && !duplicateMain.dirty,
    },
    roundTrips: requestedCycles,
    transfers: requestedCycles * 2 + 2,
    samples,
    phaseDurations,
    commandDurations: phaseDurations.filter(row => row.phase.includes('command')),
    final: finalState,
    recoverySnapshots: recovery.map(item => ({ ownerId: item.ownerId, tabId: item.tabId, content: item.content, filePath: item.filePath })),
    resources: {
      baseline: baselineStable,
      withChild: withChildStable,
      final: stableResourceSummary(finalResources),
    },
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  trace('scenario failed', error?.stack || error?.message || String(error));
  throw error;
} finally {
  clearTimeout(watchdog);
  // The scenario deliberately keeps the proof document dirty. Neutralize only
  // the test-owned tabs before graceful teardown so an assertion failure cannot
  // be hidden forever behind the unsaved-changes modal.
  try {
    if (!await closeTestAppBounded(10000)) throw new Error('Electron close timeout; process killed');
  } catch (error) {
    trace('cleanup warning', error?.message || String(error));
    try { app?.process()?.kill(); } catch {}
    await sleep(1000);
  }
  try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch (error) { trace('userData cleanup warning', error?.message || String(error)); }
  try { fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch (error) { trace('workspace cleanup warning', error?.message || String(error)); }
}
