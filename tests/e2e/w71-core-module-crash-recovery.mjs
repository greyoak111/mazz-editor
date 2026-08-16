// w71-core-module-crash-recovery.mjs —— packaged representative serializable-module crash recovery gate
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_CORE_MODULE_CRASH_RECOVERY.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-module-crash-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-module-crash-ws-'));
const cases = [
  {
    moduleId: 'text', title: '纯文本事故稿.txt',
    content: 'W71 纯文本事故恢复\n第二行：不可丢失',
    expect: { text: 'W71 纯文本事故恢复\n第二行：不可丢失' },
  },
  {
    moduleId: 'code', title: '代码事故稿.js',
    content: 'export const recovered = "W71-code";\nconsole.log(recovered);',
    expect: { text: 'export const recovered = "W71-code";\nconsole.log(recovered);' },
  },
  {
    moduleId: 'sheet', title: '表格事故稿.mazzsheet',
    content: JSON.stringify({
      mark: 'mazz-sheet-v1', active: 0,
      sheets: [{
        name: 'Recovery',
        cells: {
          '0,0': { v: 'W71-SHEET', f: null, s: { bold: true } },
          '1,0': { v: 71, f: null, s: null },
          '1,1': { v: null, f: '=A2+1', s: null },
        },
        merges: [], freezeR: 1, freezeC: 0, colW: [], rowH: [],
        filter: null, validations: [], condFormats: [],
      }],
    }),
    expect: { sheetName: 'Recovery', marker: 'W71-SHEET', value: 71, formula: '=A2+1', freezeR: 1 },
  },
  {
    moduleId: 'slide', title: '演示事故稿.mazzslide',
    content: JSON.stringify({
      v: 2, name: 'W71-SLIDE', theme: 'night', design: { w: 1600, h: 900 },
      slides: {
        'recovery-slide': {
          id: 'recovery-slide', group: null, color: null, notes: '事故恢复备注', bg: null,
          items: [{
            id: 'recovery-title', type: 'text', left: 10, top: 20, width: 80, height: 20,
            rotate: 0, style: { size: 44, bold: true }, bindings: ['main'], reveal: null,
            source: null, lines: [{ text: 'W71-SLIDE-TITLE', style: null }],
          }],
        },
      },
      layouts: { main: { name: '主放映', frames: [{ slideId: 'recovery-slide', disabled: false, transition: 'fade', nextAfter: 0, actions: null }] } },
      outputs: { main: { type: 'window', screen: null, background: 'theme', speakerNotes: false } },
      meta: { createdAt: 1, modifiedAt: 2 },
    }),
    expect: { name: 'W71-SLIDE', slideId: 'recovery-slide', title: 'W71-SLIDE-TITLE', notes: '事故恢复备注' },
  },
  {
    moduleId: 'mindmap', title: '导图事故稿.mazzmap',
    content: JSON.stringify({
      v: 4, mode: 'radial', scheme: 2,
      roots: [{ id: 'root-w71', text: 'W71-MINDMAP', children: [{ id: 'child-w71', text: '事故恢复子节点', children: [], collapsed: false }], collapsed: false }],
      notes: [], refLines: [], parentLinks: [{ id: 'pl-w71', from: 'child-w71', to: 'root-w71' }],
      swimlanes: [], frames: [], linkStyle: null, showGrid: true,
      sourceRef: { path: 'D:/evidence/source.md', blockId: 'w71-anchor' },
    }),
    expect: { mode: 'radial', root: 'W71-MINDMAP', child: '事故恢复子节点', parentLink: 'pl-w71', sourceBlock: 'w71-anchor' },
  },
  {
    moduleId: 'draw', title: '画板事故稿.mazzdraw',
    content: JSON.stringify({
      mark: 'mazz-draw-v1', current: 0,
      frames: [{
        id: 'frame-w71',
        layers: [{
          id: 'layer-w71', name: '事故恢复图层', visible: true, opacity: 0.8, images: [],
          strokes: [{ id: 'stroke-w71', color: '#ff0055', size: 7, pts: [{ x: 11, y: 22 }, { x: 71, y: 88 }] }],
        }],
      }],
    }),
    expect: { mark: 'mazz-draw-v1', layer: '事故恢复图层', stroke: 'stroke-w71', color: '#ff0055', lastX: 71 },
  },
];

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
  catch (error) { console.warn(`[w71-module-crash] 临时目录延迟清理：${target} (${error.code || error.message})`); }
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
const projectContent = (moduleId, content) => {
  if (moduleId === 'text' || moduleId === 'code') return { text: content };
  const doc = JSON.parse(content);
  if (moduleId === 'sheet') {
    const sheet = doc.sheets[0];
    return {
      sheetName: sheet.name, marker: sheet.cells['0,0']?.v, value: sheet.cells['1,0']?.v,
      formula: sheet.cells['1,1']?.f, freezeR: sheet.freezeR,
    };
  }
  if (moduleId === 'slide') {
    const slideId = doc.layouts.main.frames[0].slideId;
    const slide = doc.slides[slideId];
    return { name: doc.name, slideId, title: slide.items[0].lines[0].text, notes: slide.notes };
  }
  if (moduleId === 'mindmap') {
    return {
      mode: doc.mode, root: doc.roots[0].text, child: doc.roots[0].children[0].text,
      parentLink: doc.parentLinks[0].id, sourceBlock: doc.sourceRef.blockId,
    };
  }
  if (moduleId === 'draw') {
    const layer = doc.frames[0].layers[0];
    return {
      mark: doc.mark, layer: layer.name, stroke: layer.strokes[0].id,
      color: layer.strokes[0].color, lastX: layer.strokes[0].pts[1].x,
    };
  }
  throw new Error(`未知投影模块：${moduleId}`);
};
const readStates = win => win.evaluate(() => window.MazzShell.paneTree.leaves()
  .flatMap(leaf => leaf.tabs.tabs)
  .map(tab => {
    const inst = window.MazzModules.instances.get(tab.id);
    return {
      id: tab.id, title: tab.title, moduleId: inst?.name || tab.moduleId,
      content: inst?.def?.getContent(inst.state), dirty: tab.dirty, pinned: tab.pinned,
    };
  }));
const assertMatrix = (states, label) => cases.map(item => {
  const state = states.find(x => x.moduleId === item.moduleId);
  if (!state) throw new Error(`${label} 缺少 ${item.moduleId}：${JSON.stringify(states)}`);
  const actual = projectContent(item.moduleId, state.content);
  if (JSON.stringify(actual) !== JSON.stringify(item.expect) || !state.dirty || !state.pinned) {
    throw new Error(`${label} ${item.moduleId} 状态漂移：${JSON.stringify({ expected: item.expect, actual, dirty: state.dirty, pinned: state.pinned })}`);
  }
  return { ...state, content: undefined, projection: actual };
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

  await main.evaluate(async matrix => {
    for (const item of matrix) {
      const shell = window.MazzShell;
      const { tab, inst } = shell.openTab(item.moduleId, { title: item.title, content: item.content });
      tab.pinned = true;
      shell.tabs.render();
      window.MazzHost.notifyChange(tab.view);
      await window.mazz.invoke('snapshot:write', { tabId: tab.id, ...shell.snapshotPayload(tab, inst) });
    }
  }, cases.map(({ moduleId, title, content }) => ({ moduleId, title, content })));
  await main.waitForTimeout(1800);
  const beforeStates = await readStates(main);
  const before = assertMatrix(beforeStates, '事故前');
  const beforeSnapshots = await main.evaluate(() => window.mazz.invoke('snapshot:list'));
  if (beforeSnapshots.length !== cases.length || new Set(beforeSnapshots.map(x => x.ownerId)).size !== 1) {
    throw new Error(`事故前六模块快照异常：${JSON.stringify(beforeSnapshots)}`);
  }
  const beforeOwner = beforeSnapshots[0].ownerId;

  crashedPid = app.process().pid;
  const crashed = app.waitForEvent('close', { timeout: 30000 }).catch(() => null);
  killTree(crashedPid);
  await crashed;
  for (let i = 0; i < 100 && pidAlive(crashedPid); i++) await sleep(100);
  if (pidAlive(crashedPid)) throw new Error(`强制终止后主进程仍存活：${crashedPid}`);
  app = null;
  await sleep(1000);
  if (!fs.existsSync(path.join(userData, 'snapshots', 'RUNNING.flag'))) {
    throw new Error('强制终止后 RUNNING.flag 未保留');
  }

  app = await launch();
  main = await readyMain(app);
  await main.waitForSelector('.recovery-bar', { timeout: 30000 });
  const prompt = await main.locator('.recovery-bar').innerText();
  if (!prompt.includes(`${cases.length} 份`)) throw new Error(`六模块恢复提示数量不符：${prompt}`);
  await main.locator('.recovery-bar button').first().click();
  await main.waitForFunction(expectedCount => window.MazzShell.paneTree.leaves()
    .flatMap(leaf => leaf.tabs.tabs).filter(tab => tab.dirty && tab.pinned).length === expectedCount,
  cases.length, { timeout: 45000 });
  await main.waitForTimeout(1800);
  const restoredStates = await readStates(main);
  const restored = assertMatrix(restoredStates, '恢复后');
  const afterSnapshots = await main.evaluate(() => window.mazz.invoke('snapshot:list'));
  if (afterSnapshots.length !== cases.length || new Set(afterSnapshots.map(x => x.ownerId)).size !== 1) {
    throw new Error(`恢复后快照未收敛到当前 owner：${JSON.stringify(afterSnapshots)}`);
  }
  if (afterSnapshots.some(x => x.ownerId === beforeOwner)) throw new Error('恢复后仍由事故前 owner 持有快照');
  if (fs.existsSync(path.join(userData, 'snapshots', 'RECOVERY_PENDING.flag'))) {
    throw new Error('六模块全部恢复后 pending 标记未清除');
  }

  // 恢复后的新标签仍是合法的“当前未保存稿”；正常退出后再次提示属于正确的数据保全语义。
  // 本门禁只需证明旧事故批次不会诈尸，因此先显式放弃测试生成的当前未保存快照，再做干净启动断言。
  await main.evaluate(() => window.mazz.invoke('snapshot:clearAll'));
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
    coverage: cases.map(x => x.moduleId),
    before: { ownerId: beforeOwner, states: before },
    restored: { ownerIds: [...new Set(afterSnapshots.map(x => x.ownerId))], states: restored },
    invariants: {
      contentProjectionPreserved: true,
      dirtyPreserved: true,
      pinnedPreserved: true,
      oldOwnerRetired: true,
      pendingCleared: true,
      currentUnsavedSnapshotsExplicitlyDiscardedForCleanRestartCheck: true,
      cleanRestartHasNoOffer: true,
    },
    deferredByDesign: [
      'original-window-pane-focus-order topology restoration',
      'all-module/all-combination exhaustive recovery',
      'notes/library/viewer runtime-reference recovery matrix',
    ],
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await disposeTestApp(app);
  removeTemp(userData);
  removeTemp(workspace);
}
