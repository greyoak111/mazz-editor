// W87i —— Pane 页签右锚 + 坞拖出初始坐标 + 浮动指令台（Electron/Playwright，不用 Computer Use）
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const EXECUTABLE = process.env.MAZZ_E2E_EXECUTABLE ? path.resolve(process.env.MAZZ_E2E_EXECUTABLE) : '';
const MODE = EXECUTABLE ? 'PACKAGED' : 'SOURCE';
const evidenceDir = path.join(ROOT, 'docs', 'engineering', 'evidence');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87i-dock-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87i-dock-ws-'));
await seedFixtures(workspace, workspace);
fs.mkdirSync(evidenceDir, { recursive: true });
let app;

const assert = (value, message) => { if (!value) throw new Error(message); };

async function tabGeometry(win) {
  return win.evaluate(() => window.MazzShell.paneTree.leaves().map(leaf => {
    const bar = leaf.el.querySelector('.tabbar');
    const tabs = [...bar.querySelectorAll('.tab')];
    const br = bar.getBoundingClientRect();
    const last = tabs.at(-1)?.getBoundingClientRect();
    const active = bar.querySelector('.tab.on');
    const ar = active?.getBoundingClientRect();
    const maxScroll = Math.max(0, bar.scrollWidth - bar.clientWidth);
    return {
      paneId: leaf.id,
      count: tabs.length,
      rightGap: last ? Math.round(br.right - last.right) : null,
      clientWidth: bar.clientWidth,
      scrollWidth: bar.scrollWidth,
      scrollLeft: Math.round(bar.scrollLeft),
      maxScroll: Math.round(maxScroll),
      rightPinned: maxScroll - bar.scrollLeft <= 2,
      activeId: active?.dataset.tabId || null,
      activeTitle: active?.querySelector('.t-label')?.textContent || null,
      activeVisible: !!ar && ar.left >= br.left - 2 && ar.right <= br.right + 2,
      activeLeft: ar ? Math.round(ar.left - br.left) : null,
    };
  }));
}

const rightSealed = row => row.rightPinned && Math.abs(row.rightGap) <= 2 && row.activeVisible;

try {
  app = await electron.launch({
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : { args: [ROOT] }),
    env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: userData, MAZZ_E2E_WORKSPACE: workspace },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell?.paneTree && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
    const library = window.MazzShell.openTab('library', { title: '书库', content: '' }).tab;
    const text = [];
    for (let i = 1; i <= 11; i++) {
      text.push(window.MazzShell.openTab('text', {
        title: `W87i-${String(i).padStart(2, '0')}-超长页签名称-保持右缘稳定.txt`,
        content: String(i),
      }).tab);
    }
    window.__w87iOverflowTabs = { library: library.id, text: text.map(tab => tab.id), last: text.at(-1).id };
  });
  await win.waitForTimeout(250);
  const single = await tabGeometry(win);
  assert(single.length === 1 && single[0].count === 12 && single[0].scrollWidth > single[0].clientWidth && rightSealed(single[0]), `overflow tabs not right sealed: ${JSON.stringify(single)}`);

  // active 位于右缘时，dirty + rename 重建不能把 scrollLeft 弹回左边。
  await win.evaluate(() => {
    const tabs = window.MazzShell.paneTree.active.tabs;
    tabs.setDirty(window.__w87iOverflowTabs.last, true);
    tabs.setTitle(window.__w87iOverflowTabs.last, 'W87i-11-已重命名且未保存-右缘仍固定.txt');
  });
  await win.waitForTimeout(100);
  const rightMutation = await tabGeometry(win);
  assert(rightSealed(rightMutation[0]), `dirty/rename broke right seal: ${JSON.stringify(rightMutation)}`);

  // 激活早期的真实书库页签：活动项必须完整可见；随后重命名/dirty 不得横跳。
  await win.evaluate(() => window.MazzShell.paneTree.active.tabs.activate(window.__w87iOverflowTabs.library));
  await win.waitForTimeout(100);
  const libraryActive = await tabGeometry(win);
  assert(libraryActive[0].activeTitle === '书库' && libraryActive[0].activeVisible, `library tab not visible after activation: ${JSON.stringify(libraryActive)}`);
  await win.evaluate(() => {
    const tabs = window.MazzShell.paneTree.active.tabs;
    tabs.setDirty(window.__w87iOverflowTabs.library, true);
    tabs.setTitle(window.__w87iOverflowTabs.library, '书库 · 长标题重命名后仍留在原阅读位置');
  });
  await win.waitForTimeout(100);
  const libraryMutation = await tabGeometry(win);
  assert(libraryMutation[0].activeVisible && Math.abs(libraryMutation[0].activeLeft - libraryActive[0].activeLeft) <= 2,
    `library dirty/rename caused tab-strip jump: ${JSON.stringify({ libraryActive, libraryMutation })}`);

  // 回到最后一签，恢复右缘锚，再进入 split/join 往返。
  await win.evaluate(() => window.MazzShell.paneTree.active.tabs.activate(window.__w87iOverflowTabs.last));
  await win.waitForTimeout(100);
  const resealed = await tabGeometry(win);
  assert(rightSealed(resealed[0]), `reactivating last tab did not reseal right edge: ${JSON.stringify(resealed)}`);

  await win.evaluate(() => window.MazzShell.splitRight());
  await win.waitForTimeout(250);
  const split = await tabGeometry(win);
  assert(split.length === 2 && split.reduce((sum, row) => sum + row.count, 0) === 12
    && split.every(row => rightSealed(row)), `split pane overflow tabs drifted: ${JSON.stringify(split)}`);

  await win.evaluate(() => window.MazzShell.paneTree.joinAll());
  await win.waitForTimeout(250);
  const joined = await tabGeometry(win);
  assert(joined.length === 1 && joined[0].count === 12 && rightSealed(joined[0]), `joined pane overflow tabs drifted: ${JSON.stringify(joined)}`);

  await win.evaluate(() => window.MazzShell.paneTree.active.tabs.activate(window.__w87iOverflowTabs.library));
  await win.waitForTimeout(100);
  const libraryAfterJoin = await tabGeometry(win);
  assert(libraryAfterJoin[0].activeVisible, `library tab lost after split/join roundtrip: ${JSON.stringify(libraryAfterJoin)}`);
  await win.evaluate(() => window.MazzShell.paneTree.active.tabs.activate(window.__w87iOverflowTabs.last));
  await win.waitForTimeout(100);

  await win.evaluate(() => {
    const dock = window.MazzShell.sideDock;
    dock.show();
    dock.state.width = 300;
    dock.el.style.width = '300px';
  });
  await win.waitForFunction(() => !!window.MazzShell.sideDock?.factoryPanel?.el?.querySelector('.fc-command-dock'), null, { timeout: 30000 });
  const narrow = await win.evaluate(() => {
    const dock = document.querySelector('.side-dock');
    const command = dock.querySelector('.fc-command-dock');
    const harness = command.querySelector('.fc-harness-bar');
    const dr = dock.getBoundingClientRect(), cr = command.getBoundingClientRect();
    return {
      dockWidth: Math.round(dr.width),
      commandInside: cr.left >= dr.left - 1 && cr.right <= dr.right + 1,
      commandOverflow: command.scrollWidth - command.clientWidth,
      harnessOverflow: harness.scrollWidth - harness.clientWidth,
    };
  });
  assert(narrow.commandInside && narrow.commandOverflow <= 1 && narrow.harnessOverflow <= 1, `narrow Factory command desk overflow: ${JSON.stringify(narrow)}`);

  // 真实 renderer pointer 序列拖出；不直接调用 toggleFloat，也不靠静态字符串证明连续性。
  const dragStart = await win.evaluate(() => {
    const bar = document.querySelector('.side-dock .sd-bar');
    const r = bar.getBoundingClientRect();
    for (let y = Math.ceil(r.top + 3); y < Math.floor(r.bottom - 3); y += 3) {
      for (let x = Math.ceil(r.left + 3); x < Math.floor(r.right - 3); x += 3) {
        const hit = document.elementFromPoint(x, y);
        if (hit && bar.contains(hit) && !hit.closest('button')) return { x, y };
      }
    }
    throw new Error('no draggable side-dock bar point');
  });
  const pointerTargets = [
    { x: dragStart.x - 24, y: dragStart.y + 8 },
    { x: dragStart.x - 60, y: dragStart.y + 18 },
    { x: dragStart.x - 96, y: dragStart.y + 30 },
  ];
  await win.mouse.move(dragStart.x, dragStart.y);
  await win.mouse.down();
  await win.mouse.move(pointerTargets[0].x, pointerTargets[0].y);
  let dockfloat;
  for (let i = 0; i < 60; i++) {
    dockfloat = app.windows().find(page => page.url().includes('/panels/dockfloat.html'));
    if (dockfloat) break;
    await win.waitForTimeout(100);
  }
  assert(dockfloat, 'dockfloat did not open');
  await dockfloat.waitForLoadState('domcontentloaded');
  await dockfloat.waitForSelector('.df-command', { timeout: 30000 });
  const panelState = async () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(candidate => candidate.__panelKind === 'dockfloat');
    return w ? { passthrough: !!w.__panelDragPassthrough, active: !!w.__panelDragActive, origin: w.__panelDragOrigin || null, bounds: w.getBounds() } : null;
  });
  const duringDrag = await panelState();
  assert(duringDrag?.passthrough && duringDrag?.active, `dockfloat did not enter cross-window passthrough: ${JSON.stringify(duringDrag)}`);

  const pointerFrames = [];
  const captureFrame = async (pointer, previous = null) => {
    if (previous) await win.mouse.move(pointer.x, pointer.y);
    let frame;
    for (let i = 0; i < 50; i++) {
      frame = await dockfloat.evaluate(() => ({ x: window.screenX, y: window.screenY }));
      if (!previous || (Math.abs((frame.x - previous.frame.x) - (pointer.x - previous.pointer.x)) <= 3
        && Math.abs((frame.y - previous.frame.y) - (pointer.y - previous.pointer.y)) <= 3)) break;
      await win.waitForTimeout(20);
    }
    const row = { pointer, frame };
    pointerFrames.push(row);
    return row;
  };
  let previous = await captureFrame(pointerTargets[0]);
  previous = await captureFrame(pointerTargets[1], previous);
  previous = await captureFrame(pointerTargets[2], previous);
  for (let i = 1; i < pointerFrames.length; i++) {
    const a = pointerFrames[i - 1], b = pointerFrames[i];
    assert(Math.abs((b.frame.x - a.frame.x) - (b.pointer.x - a.pointer.x)) <= 3
      && Math.abs((b.frame.y - a.frame.y) - (b.pointer.y - a.pointer.y)) <= 3,
    `dockfloat broke pointer continuity at frame ${i}: ${JSON.stringify(pointerFrames)}`);
  }
  await win.mouse.up();
  let afterDrag;
  for (let i = 0; i < 50; i++) {
    afterDrag = await panelState();
    if (afterDrag && !afterDrag.passthrough && !afterDrag.active) break;
    await win.waitForTimeout(20);
  }
  assert(afterDrag && !afterDrag.passthrough && !afterDrag.active, `dragEnd did not restore dockfloat hit testing: ${JSON.stringify(afterDrag)}`);

  const floating = await dockfloat.evaluate(() => ({
    x: window.screenX,
    y: window.screenY,
    width: window.outerWidth,
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    command: !!document.querySelector('.df-command #df-agent-input'),
  }));
  assert(floating.command && floating.horizontalOverflow <= 1, `floating command desk unhealthy: ${JSON.stringify(floating)}`);

  // owner 快照刷新不得吞掉浮窗本地正在编辑的指令、selection/focus 与 harness 选择。
  const draftSeed = await dockfloat.evaluate(() => {
    document.querySelector('[data-t="factory"]')?.click();
    const input = document.querySelector('#df-agent-input');
    const adapter = document.querySelector('#df-adapter');
    const model = document.querySelector('#df-model');
    const enabled = [...(adapter?.options || [])].filter(option => !option.disabled);
    if (adapter && enabled.length) {
      adapter.value = enabled.at(-1).value;
      adapter.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (model) {
      model.value = 'w87i-local-model-draft';
      model.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.value = 'W87i snapshot 保留这段未提交草稿';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    input.setSelectionRange(6, 14, 'forward');
    return { draft: input.value, adapter: adapter?.value || '', model: model?.value || '', start: input.selectionStart, end: input.selectionEnd };
  });
  await dockfloat.evaluate(() => window.mazz.invoke('panel:action', { type: 'dockFloatInit' }));
  await dockfloat.waitForTimeout(500);
  const draftAfterSnapshot = await dockfloat.evaluate(() => {
    const input = document.querySelector('#df-agent-input');
    return {
      draft: input?.value || '',
      adapter: document.querySelector('#df-adapter')?.value || '',
      model: document.querySelector('#df-model')?.value || '',
      activeId: document.activeElement?.id || '',
      start: input?.selectionStart ?? null,
      end: input?.selectionEnd ?? null,
    };
  });
  assert(draftAfterSnapshot.draft === draftSeed.draft
    && draftAfterSnapshot.adapter === draftSeed.adapter
    && draftAfterSnapshot.model === draftSeed.model
    && draftAfterSnapshot.activeId === 'df-agent-input'
    && draftAfterSnapshot.start === draftSeed.start
    && draftAfterSnapshot.end === draftSeed.end,
  `factory snapshot swallowed local edit state: ${JSON.stringify({ draftSeed, draftAfterSnapshot })}`);

  // 浮窗自身二次拖拽必须保留 hit-test/pointer capture；不得沿用主窗拖出阶段的 mouse passthrough。
  const secondaryStart = await dockfloat.evaluate(() => {
    const r = document.querySelector('.p-drag').getBoundingClientRect();
    return { x: Math.round(r.left + 54), y: Math.max(3, Math.round(r.top + r.height / 2)) };
  });
  const secondaryTargets = [
    { x: secondaryStart.x - 12, y: secondaryStart.y + 2 },
    { x: secondaryStart.x - 25, y: secondaryStart.y + 4 },
    { x: secondaryStart.x - 39, y: secondaryStart.y + 6 },
  ];
  await dockfloat.mouse.move(secondaryStart.x, secondaryStart.y);
  await dockfloat.mouse.down();
  const secondaryFrames = [];
  for (const pointer of secondaryTargets) {
    await dockfloat.mouse.move(pointer.x, pointer.y);
    await dockfloat.waitForTimeout(60);
    const state = await panelState();
    secondaryFrames.push({ pointer, ...state });
    assert(state?.active && state.origin === 'float' && !state.passthrough,
      `secondary float drag lost hit testing: ${JSON.stringify(secondaryFrames)}`);
  }
  assert(secondaryFrames.every((row, index) => index === 0
    || row.bounds.x !== secondaryFrames[index - 1].bounds.x
    || row.bounds.y !== secondaryFrames[index - 1].bounds.y),
  `secondary float drag did not produce three real frames: ${JSON.stringify(secondaryFrames)}`);
  await dockfloat.mouse.up();
  let afterSecondaryDrag = null;
  for (let i = 0; i < 50; i++) {
    afterSecondaryDrag = await panelState();
    if (afterSecondaryDrag && !afterSecondaryDrag.active && !afterSecondaryDrag.passthrough && !afterSecondaryDrag.origin) break;
    await dockfloat.waitForTimeout(20);
  }
  assert(afterSecondaryDrag && !afterSecondaryDrag.active && !afterSecondaryDrag.passthrough && !afterSecondaryDrag.origin,
    `secondary float pointerup did not clean drag owner: ${JSON.stringify(afterSecondaryDrag)}`);

  await dockfloat.click('[data-t="tools"]');
  await dockfloat.waitForFunction(() => document.querySelectorAll('.tg-card').length > 0, null, { timeout: 10000 });
  const tools = await dockfloat.evaluate(() => ({ cards: document.querySelectorAll('.tg-card').length, loading: document.querySelector('#m')?.textContent.includes('加载工具清单') }));
  assert(tools.cards > 0 && !tools.loading, `floating tools were not prefetched: ${JSON.stringify(tools)}`);

  // 真 persisted-float 冷启动：先把状态同步写入临时 profile，再走正式 app.quit() 并重新 launch。
  await win.evaluate(() => localStorage.setItem('mazz.sideDock', JSON.stringify({
    _v: 2, open: true, tab: 'tools', width: 400, height: 620, zoom: 1,
    float: { x: 260, y: 180 }, collapsed: false,
  })));
  const firstClose = app.waitForEvent('close');
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {});
  await firstClose;
  app = await electron.launch({
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : { args: [ROOT] }),
    env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: userData, MAZZ_E2E_WORKSPACE: workspace },
    timeout: 120000,
  });
  const coldWin = await app.firstWindow({ timeout: 120000 });
  await coldWin.waitForLoadState('domcontentloaded');
  await coldWin.waitForFunction(() => !!window.MazzShell?.sideDock && !!window.mazz, null, { timeout: 30000 });
  let coldFloat = null;
  for (let i = 0; i < 100; i++) {
    coldFloat = app.windows().find(page => page.url().includes('/panels/dockfloat.html'));
    if (coldFloat) break;
    await coldWin.waitForTimeout(100);
  }
  assert(coldFloat, 'persisted-float cold start did not reopen dockfloat');
  await coldFloat.waitForLoadState('domcontentloaded');
  await coldFloat.click('[data-t="tools"]');
  await coldFloat.waitForFunction(() => document.querySelectorAll('.tg-card').length > 0, null, { timeout: 15000 });
  const coldTools = await coldFloat.evaluate(() => ({
    cards: document.querySelectorAll('.tg-card').length,
    loading: document.querySelector('#m')?.textContent.includes('加载工具清单'),
    labels: [...document.querySelectorAll('.tg-card .t')].slice(0, 4).map(node => node.textContent),
  }));
  assert(coldTools.cards > 0 && !coldTools.loading, `persisted-float cold start tools stayed empty: ${JSON.stringify(coldTools)}`);

  const report = {
    protocol: 'mazz.w87i-pane-dock-continuity/v4', createdAt: new Date().toISOString(), mode: MODE, verdict: 'PASS',
    single, rightMutation, libraryActive, libraryMutation, resealed, split, joined, libraryAfterJoin,
    narrow, dragStart, pointerFrames, duringDrag, afterDrag, floating,
    draftSeed, draftAfterSnapshot, secondaryStart, secondaryFrames, afterSecondaryDrag, tools, coldTools,
  };
  fs.writeFileSync(path.join(evidenceDir, `W87I_PANE_DOCK_CONTINUITY_${MODE}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { await app?.close(); } catch {}
  try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); } catch {}
  try { fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); } catch {}
}
