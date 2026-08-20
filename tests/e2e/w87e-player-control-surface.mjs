// W87e Player Control Surface —— exact-width + real split + More + 20-cycle source/packaged acceptance.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence');
const mode = String(process.env.MAZZ_W87E_MODE || 'source').toUpperCase();
const executablePath = process.env.MAZZ_W87E_EXECUTABLE || '';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w87e-${mode.toLowerCase()}-user-`));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w87e-${mode.toLowerCase()}-ws-`));
await seedFixtures(workspace, workspace);
fs.mkdirSync(EVIDENCE, { recursive: true });

const errors = { main: [], renderer: [] };
let app;

function expectedDensity(width) {
  return width >= 960 ? 'l' : width >= 600 ? 'm' : width >= 440 ? 's' : 'xs';
}

async function geometry(win) {
  return win.evaluate(() => {
    const root = document.querySelector('.mz-player');
    const stage = root?.querySelector('.mz-stage');
    const controls = root?.querySelector('.mz-controls');
    const bar = root?.querySelector('.mz-bar');
    const more = root?.querySelector('[data-a=more-controls]');
    const surface = root?.__playerControlSurface?.snapshot?.();
    if (!root || !stage || !controls || !bar || !surface) return { fatal: 'player control surface missing' };
    const br = bar.getBoundingClientRect();
    const visible = [...bar.children].filter(element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    const rects = visible.map(element => {
      const rect = element.getBoundingClientRect();
      return { id: element.dataset.a || element.dataset.playerLabel || element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const overlaps = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push([a.id, b.id]);
    }
    return {
      width: Math.round(controls.getBoundingClientRect().width),
      density: controls.dataset.density,
      clientWidth: bar.clientWidth,
      scrollWidth: bar.scrollWidth,
      outside: rects.filter(rect => rect.left < br.left - 1 || rect.right > br.right + 1).map(rect => rect.id),
      overlaps,
      inline: surface.inline,
      overflow: surface.overflow,
      moreVisible: getComputedStyle(more).display !== 'none',
      core: {
        play: visible.includes(root.querySelector('[data-a=play]')),
        time: visible.includes(root.querySelector('.mz-time')),
        more: visible.includes(more),
        fullscreen: visible.includes(root.querySelector('[data-a=fullscreen]')),
      },
      sideOpen: stage.classList.contains('side-open'),
      sideOverlay: stage.classList.contains('side-overlay'),
      sideWidth: Math.round(root.querySelector('.mz-side')?.getBoundingClientRect().width || 0),
      sideVar: Math.round(parseFloat(getComputedStyle(stage).getPropertyValue('--mz-side-w')) || 0),
      stageWidth: Math.round(stage.getBoundingClientRect().width),
    };
  });
}

function assertGeometry(result, label) {
  if (result.fatal) throw new Error(`${label}: ${result.fatal}`);
  if (result.scrollWidth > result.clientWidth + 1) throw new Error(`${label}: bar scroll overflow ${result.scrollWidth}/${result.clientWidth}`);
  if (result.outside.length) throw new Error(`${label}: controls outside bar ${result.outside.join(',')}`);
  if (result.overlaps.length) throw new Error(`${label}: controls overlap ${JSON.stringify(result.overlaps)}`);
  if (!result.moreVisible || !result.core.play || !result.core.time || !result.core.more) throw new Error(`${label}: P0 core visibility failed`);
  if (!result.core.fullscreen && result.width >= 280) throw new Error(`${label}: fullscreen should remain inline at ${result.width}`);
}

try {
  const launch = {
    args: executablePath ? [] : [ROOT],
    env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: userData, MAZZ_E2E_WORKSPACE: workspace },
    timeout: 120000,
  };
  if (executablePath) launch.executablePath = executablePath;
  app = await electron.launch(launch);
  app.process()?.stdout?.on('data', chunk => { if (/\b(?:uncaught|TypeError|ReferenceError|Error:)\b/i.test(String(chunk))) errors.main.push(String(chunk).trim()); });
  app.process()?.stderr?.on('data', chunk => { if (/\b(?:uncaught|TypeError|ReferenceError|Error:)\b/i.test(String(chunk))) errors.main.push(String(chunk).trim()); });
  const win = await app.firstWindow({ timeout: 120000 });
  win.on('pageerror', error => errors.renderer.push(error.message));
  win.on('console', message => { if (message.type() === 'error') errors.renderer.push(message.text()); });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
    window.MazzCommands.execute('file.newViewer');
  });
  await win.waitForSelector('.mz-player .mz-controls[data-density]', { timeout: 30000 });
  await win.setViewportSize({ width: 1600, height: 900 }).catch(() => {});

  const exact = [];
  for (const width of [1200, 960, 959, 900, 720, 600, 599, 560, 440, 439, 420, 320]) {
    await win.evaluate(value => {
      const stage = document.querySelector('.mz-stage');
      stage.classList.remove('side-open');
      stage.style.width = `${value}px`;
      stage.style.flex = 'none';
    }, width);
    await win.waitForTimeout(100);
    const result = await geometry(win);
    assertGeometry(result, `exact-${width}`);
    if (result.density !== expectedDensity(result.width)) throw new Error(`exact-${width}: density ${result.density} for ${result.width}`);
    exact.push({ requested: width, ...result });
  }

  // More 使用同一真实 loop 控件；一次 click 只能从 list 走到 single，不能双执行到 sequential。
  await win.evaluate(() => {
    const more = document.querySelector('[data-a=more-controls]');
    more.focus();
    more.click();
  });
  await win.waitForSelector('.mz-control-center:not([hidden])');
  const moreBefore = await win.evaluate(() => {
    const stage = document.querySelector('.mz-stage').getBoundingClientRect();
    const panel = document.querySelector('.mz-control-center').getBoundingClientRect();
    return { withinStage: panel.left >= stage.left - 1 && panel.right <= stage.right + 1 && panel.top >= stage.top - 1 && panel.bottom <= stage.bottom + 1 };
  });
  if (!moreBefore.withinStage) throw new Error('More control center escaped player stage');
  await win.evaluate(() => {
    const loop = document.querySelector('.mz-control-center [data-a=loop]');
    loop.focus();
    loop.click();
  });
  await win.waitForFunction(() => document.querySelector('.mz-control-center').hidden
    && document.activeElement?.dataset?.a === 'more-controls', null, { timeout: 2000 });
  const loopState = await win.evaluate(() => ({
    title: document.querySelector('[data-a=loop]').title,
    panelHidden: document.querySelector('.mz-control-center').hidden,
    focusAction: document.activeElement?.dataset?.a || '',
    focusTag: document.activeElement?.tagName || '',
    focusClass: document.activeElement?.className || '',
    focusInsideHidden: !!document.activeElement?.closest?.('.mz-control-center[hidden]'),
    more: (() => { const item = document.querySelector('[data-a=more-controls]'); return { hidden: item.hidden, disabled: item.disabled, display: getComputedStyle(item).display, connected: item.isConnected }; })(),
  }));
  if (!loopState.title.includes('单集循环') || !loopState.panelHidden || loopState.focusAction !== 'more-controls' || loopState.focusInsideHidden) {
    throw new Error(`More action executed/focused incorrectly: ${JSON.stringify(loopState)}`);
  }

  // 极窄 Pane：侧栏改为局部覆盖，不再挤走 P0 控制位；扩回宽 Pane 必须恢复用户 260px 偏好。
  await win.evaluate(() => {
    const stage = document.querySelector('.mz-stage');
    stage.style.width = '320px';
    document.querySelector('[data-a=list]').click();
  });
  await win.waitForTimeout(120);
  const extreme320 = await geometry(win);
  assertGeometry(extreme320, 'extreme-side-320');
  if (!extreme320.sideOpen || !extreme320.sideOverlay || extreme320.sideWidth > Math.floor(extreme320.stageWidth * 0.72) + 1 || extreme320.width < extreme320.stageWidth - 1) {
    throw new Error(`320px side overlay failed: ${JSON.stringify(extreme320)}`);
  }
  await win.evaluate(() => { document.querySelector('.mz-stage').style.width = '240px'; });
  await win.waitForTimeout(120);
  const extreme240 = await geometry(win);
  assertGeometry(extreme240, 'extreme-side-240');
  if (!extreme240.sideOverlay || extreme240.sideWidth > Math.floor(extreme240.stageWidth * 0.72) + 1 || extreme240.width < extreme240.stageWidth - 1) {
    throw new Error(`240px side overlay failed: ${JSON.stringify(extreme240)}`);
  }
  await win.evaluate(() => { document.querySelector('.mz-stage').style.width = '1200px'; });
  await win.waitForTimeout(120);
  const preferredRecovery = await geometry(win);
  assertGeometry(preferredRecovery, 'preferred-side-recovery');
  if (preferredRecovery.sideOverlay || preferredRecovery.sideVar !== 260 || preferredRecovery.sideWidth !== 260) {
    throw new Error(`side preference was destroyed by narrow layout: ${JSON.stringify(preferredRecovery)}`);
  }

  // 锁定必须只留下一个可见、可聚焦的解锁席位；解锁后焦点回到 More，不能随节点移入隐藏面板。
  await win.evaluate(() => {
    const more = document.querySelector('[data-a=more-controls]');
    more.focus();
    more.click();
  });
  await win.waitForSelector('.mz-control-center:not([hidden])');
  await win.evaluate(() => {
    const lock = document.querySelector('.mz-control-center [data-a=lock]');
    lock.focus();
    lock.click();
  });
  await win.waitForFunction(() => {
    const root = document.querySelector('.mz-player');
    const lock = root?.querySelector('[data-a=lock]');
    return root?.classList.contains('mz-locked') && lock?.parentElement?.classList.contains('mz-bar') && document.activeElement === lock;
  }, null, { timeout: 2000 });
  const lockedState = await win.evaluate(() => {
    const root = document.querySelector('.mz-player');
    const lock = root.querySelector('[data-a=lock]');
    const seek = root.querySelector('.mz-seek-track');
    const others = [...root.querySelectorAll('.mz-stage button, .mz-stage input, .mz-stage select, .mz-stage [role=slider], .mz-stage [tabindex]')].filter(item => item !== lock);
    return {
      locked: root.classList.contains('mz-locked'),
      lockInline: lock.parentElement?.classList.contains('mz-bar'),
      lockFocused: document.activeElement === lock,
      panelHidden: root.querySelector('.mz-control-center').hidden,
      moreExpanded: root.querySelector('[data-a=more-controls]').getAttribute('aria-expanded'),
      enabledOthers: others.filter(item => 'disabled' in item ? !item.disabled : item.getAttribute('tabindex') !== '-1').map(item => item.dataset.a || item.className),
      seekTabIndex: seek.getAttribute('tabindex'),
      lockPressed: lock.getAttribute('aria-pressed'),
    };
  });
  if (!lockedState.locked || !lockedState.lockInline || !lockedState.lockFocused || !lockedState.panelHidden || lockedState.moreExpanded !== 'false' || lockedState.enabledOthers.length || lockedState.seekTabIndex !== '-1' || lockedState.lockPressed !== 'true') {
    throw new Error(`locked control boundary failed: ${JSON.stringify(lockedState)}`);
  }
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => !document.querySelector('.mz-player').classList.contains('mz-locked')
    && document.activeElement?.dataset?.a === 'more-controls', null, { timeout: 2000 });
  const unlockedState = await win.evaluate(() => ({
    locked: document.querySelector('.mz-player').classList.contains('mz-locked'),
    focusAction: document.activeElement?.dataset?.a || '',
    focusInsideHidden: !!document.activeElement?.closest?.('.mz-control-center[hidden]'),
    seekTabIndex: document.querySelector('.mz-seek-track').getAttribute('tabindex'),
    lockPressed: document.querySelector('[data-a=lock]').getAttribute('aria-pressed'),
  }));
  if (unlockedState.locked || unlockedState.focusAction !== 'more-controls' || unlockedState.focusInsideHidden || unlockedState.seekTabIndex !== '0' || unlockedState.lockPressed !== 'false') {
    throw new Error(`unlock focus/state recovery failed: ${JSON.stringify(unlockedState)}`);
  }

  // 播放设置是全局 modal；关闭后焦点必须回到稳定 More，不能回到已藏回控制中心的 pset。
  await win.evaluate(() => document.querySelector('[data-a=more-controls]').click());
  await win.waitForSelector('.mz-control-center:not([hidden])');
  await win.evaluate(() => {
    const pset = document.querySelector('.mz-control-center [data-a=pset]');
    pset.focus();
    if (document.activeElement !== pset) throw new Error('pset focus precondition failed');
    pset.click();
  });
  await win.waitForSelector('.mazz-palette-mask');
  await win.evaluate(() => document.querySelector('.mazz-palette-mask #m-close').click());
  await win.waitForFunction(() => !document.querySelector('.mazz-palette-mask')
    && document.activeElement?.dataset?.a === 'more-controls'
    && !document.activeElement?.closest?.('.mz-control-center[hidden]'), null, { timeout: 2000 });
  const settingsFocus = await win.evaluate(() => ({
    focusAction: document.activeElement?.dataset?.a || '',
    focusInsideHidden: !!document.activeElement?.closest?.('.mz-control-center[hidden]'),
    panelHidden: document.querySelector('.mz-control-center').hidden,
  }));
  if (settingsFocus.focusAction !== 'more-controls' || settingsFocus.focusInsideHidden || !settingsFocus.panelHidden) {
    throw new Error(`settings focus return failed: ${JSON.stringify(settingsFocus)}`);
  }

  // 无边框态也必须允许纯键盘焦点唤回控制栏，不依赖 hover。
  await win.evaluate(() => {
    const more = document.querySelector('[data-a=more-controls]');
    more.focus();
    more.click();
  });
  await win.waitForSelector('.mz-control-center:not([hidden])');
  await win.evaluate(() => {
    const borderless = document.querySelector('.mz-control-center [data-a=borderless]');
    borderless.focus();
    borderless.click();
  });
  await win.waitForFunction(() => document.querySelector('.mz-player').classList.contains('borderless')
    && document.activeElement?.dataset?.a === 'more-controls', null, { timeout: 2000 });
  const borderlessFocus = await win.evaluate(() => {
    const root = document.querySelector('.mz-player');
    const controls = root.querySelector('.mz-controls');
    return {
      borderless: root.classList.contains('borderless'),
      focusAction: document.activeElement?.dataset?.a || '',
      opacity: getComputedStyle(controls).opacity,
      pointerEvents: getComputedStyle(controls).pointerEvents,
    };
  });
  if (!borderlessFocus.borderless || borderlessFocus.focusAction !== 'more-controls' || borderlessFocus.opacity !== '1' || borderlessFocus.pointerEvents !== 'auto') {
    throw new Error(`borderless keyboard reveal failed: ${JSON.stringify(borderlessFocus)}`);
  }
  await win.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true })));
  await win.waitForTimeout(60);
  await win.evaluate(() => document.querySelector('[data-a=list]').click());
  await win.waitForTimeout(80);

  // 还原自然宽，构造用户截图同族的真实左右分屏 + 播放列表推挤。
  await win.evaluate(() => {
    const stage = document.querySelector('.mz-stage');
    stage.style.width = '';
    stage.style.flex = '';
    const viewerTab = window.MazzShell.tabs.tabs.find(tab => tab.moduleId === 'viewer');
    window.MazzCommands.execute('file.newMarkdown');
    window.MazzShell.splitWithTab(viewerTab.id, 'left');
  });
  await win.waitForTimeout(500);
  await win.evaluate(() => document.querySelector('.mz-player [data-a=list]')?.click());
  await win.waitForTimeout(300);
  const split = await geometry(win);
  assertGeometry(split, 'real-split-side-open');
  if (!split.sideOpen || Math.abs(split.sideWidth - split.sideVar) > 2) throw new Error(`side geometry drift: ${JSON.stringify(split)}`);

  const shots = {};
  for (const theme of ['ink', 'paper']) {
    await win.evaluate(value => window.MazzShell.setTheme(value), theme);
    await win.waitForTimeout(200);
    const closedName = `W87E_PLAYER_CONTROLS_${mode}_${theme.toUpperCase()}.png`;
    await win.screenshot({ path: path.join(EVIDENCE, closedName) });
    await win.evaluate(() => document.querySelector('.mz-player [data-a=more-controls]')?.click());
    await win.waitForSelector('.mz-control-center:not([hidden])');
    const openName = `W87E_PLAYER_CONTROL_CENTER_${mode}_${theme.toUpperCase()}.png`;
    await win.screenshot({ path: path.join(EVIDENCE, openName) });
    await win.evaluate(() => document.querySelector('.mz-control-center [data-a=more-close]')?.click());
    shots[theme] = { closed: closedName, open: openName };
  }

  const soak = [];
  for (let i = 0; i < 20; i++) {
    await win.setViewportSize({ width: i % 2 ? 1180 : 1600, height: 900 }).catch(() => {});
    await win.waitForTimeout(35);
    const result = await geometry(win);
    assertGeometry(result, `soak-${i + 1}`);
    const ownership = await win.evaluate(() => {
      const root = document.querySelector('.mz-player');
      const ids = [...root.querySelectorAll('[data-player-min]')];
      return { total: ids.length, unique: new Set(ids).size, panels: root.querySelectorAll('.mz-control-center').length, surfaces: root.__playerControlSurface ? 1 : 0 };
    });
    if (ownership.total !== ownership.unique || ownership.panels !== 1 || ownership.surfaces !== 1) throw new Error(`soak ownership drift: ${JSON.stringify(ownership)}`);
    soak.push({ cycle: i + 1, density: result.density, width: result.width, ownership });
  }

  // 音频能力态：所有 video-only 控件必须既不可见也不可命中，不能被 Control Center 的 display 规则复活。
  await win.evaluate(target => window.MazzShell.openFile(target), path.join(workspace, '测试音.wav'));
  await win.waitForFunction(() => [...document.querySelectorAll('.mz-player')].some(root => root.querySelector('audio.mz-media') && root.getBoundingClientRect().width > 0), null, { timeout: 30000 });
  await win.evaluate(() => {
    const root = [...document.querySelectorAll('.mz-player')].find(item => item.querySelector('audio.mz-media') && item.getBoundingClientRect().width > 0);
    root.querySelector('[data-a=more-controls]').click();
  });
  await win.waitForFunction(() => {
    const root = [...document.querySelectorAll('.mz-player')].find(item => item.querySelector('audio.mz-media') && item.getBoundingClientRect().width > 0);
    return root && !root.querySelector('.mz-control-center').hidden;
  });
  const audioCapability = await win.evaluate(() => {
    const root = [...document.querySelectorAll('.mz-player')].find(item => item.querySelector('audio.mz-media') && item.getBoundingClientRect().width > 0);
    const videoOnly = [...root.querySelectorAll('[data-player-video-only="1"]')].map(item => {
      const rect = item.getBoundingClientRect();
      return { action: item.dataset.a || item.dataset.playerLabel, hidden: item.hidden, display: getComputedStyle(item).display, width: rect.width, height: rect.height };
    });
    return { videoOnly, snapshot: root.__playerControlSurface.snapshot() };
  });
  if (!audioCapability.videoOnly.length || audioCapability.videoOnly.some(item => !item.hidden || item.display !== 'none' || item.width !== 0 || item.height !== 0)) {
    throw new Error(`audio capability leaked video controls: ${JSON.stringify(audioCapability)}`);
  }

  // seek slider 的方向键必须由本地 ARIA 协议独占；document capture 不得重复快进或改音量。
  const seekBefore = await win.evaluate(() => {
    const root = [...document.querySelectorAll('.mz-player')].find(item => item.querySelector('audio.mz-media') && item.getBoundingClientRect().width > 0);
    const media = root.querySelector('audio.mz-media');
    const track = root.querySelector('.mz-seek-track');
    Object.defineProperty(media, 'duration', { configurable: true, value: 120 });
    Object.defineProperty(media, 'currentTime', { configurable: true, writable: true, value: 10 });
    media.volume = 0.4;
    track.focus();
    return { currentTime: media.currentTime, volume: media.volume, valueNow: track.getAttribute('aria-valuenow') };
  });
  await win.keyboard.press('ArrowRight');
  const seekAfterRight = await win.evaluate(() => {
    const root = [...document.querySelectorAll('.mz-player')].find(item => item.querySelector('audio.mz-media') && item.getBoundingClientRect().width > 0);
    const media = root.querySelector('audio.mz-media');
    const track = root.querySelector('.mz-seek-track');
    return { currentTime: media.currentTime, volume: media.volume, valueNow: track.getAttribute('aria-valuenow'), focused: document.activeElement === track };
  });
  await win.keyboard.press('ArrowUp');
  const seekAfterUp = await win.evaluate(() => {
    const root = [...document.querySelectorAll('.mz-player')].find(item => item.querySelector('audio.mz-media') && item.getBoundingClientRect().width > 0);
    const media = root.querySelector('audio.mz-media');
    const track = root.querySelector('.mz-seek-track');
    return { currentTime: media.currentTime, volume: media.volume, valueNow: track.getAttribute('aria-valuenow'), focused: document.activeElement === track };
  });
  const seekKeyboard = { before: seekBefore, afterRight: seekAfterRight, afterUp: seekAfterUp };
  if (seekAfterRight.currentTime !== 15 || seekAfterRight.valueNow !== '15' || !seekAfterRight.focused
    || seekAfterUp.currentTime !== 20 || seekAfterUp.valueNow !== '20' || !seekAfterUp.focused
    || Math.abs(seekAfterRight.volume - seekBefore.volume) > 0.001 || Math.abs(seekAfterUp.volume - seekBefore.volume) > 0.001) {
    throw new Error(`seek keyboard ownership failed: ${JSON.stringify(seekKeyboard)}`);
  }

  const report = {
    protocol: 'mazz.w87e-player-control-surface/v1',
    createdAt: new Date().toISOString(),
    mode: mode.toLowerCase(),
    ok: true,
    verdict: 'PASS',
    exact,
    more: { withinStage: moreBefore.withinStage, loopState },
    sideGeometry: { extreme320, extreme240, preferredRecovery },
    lock: { lockedState, unlockedState },
    settingsFocus,
    borderlessFocus,
    audioCapability,
    seekKeyboard,
    split,
    soak,
    shots,
    errors,
  };
  if (errors.main.length || errors.renderer.length) throw new Error(`runtime errors: ${JSON.stringify(errors)}`);
  fs.writeFileSync(path.join(EVIDENCE, `W87E_PLAYER_CONTROL_SURFACE_${mode}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { await app?.close(); } catch {}
  try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  try { fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
}
