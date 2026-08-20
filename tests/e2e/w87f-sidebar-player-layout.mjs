// W87f —— Workspace Sidebar label layout + empty Player side-panel geometry.
// This gate runs entirely through Electron/Playwright. It deliberately does not use Computer Use.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence');
const mode = String(process.env.MAZZ_W87F_MODE || 'source').toUpperCase();
const executablePath = process.env.MAZZ_W87F_EXECUTABLE || '';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w87f-${mode.toLowerCase()}-user-`));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w87f-${mode.toLowerCase()}-ws-`));
await seedFixtures(workspace, workspace);
fs.mkdirSync(EVIDENCE, { recursive: true });

const errors = { main: [], renderer: [] };
let app;

async function sidebarState(win, width) {
  await win.evaluate(value => {
    const ctl = window.MazzShell?.sidebarCtl;
    ctl?.setCollapsed(false);
    ctl?.setWidth(value);
  }, width);
  await win.waitForTimeout(100);
  return win.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    const bar = sidebar?.querySelector('.sb-tabbar');
    const tabs = [...(bar?.querySelectorAll('.sb-tab') || [])];
    const barRect = bar?.getBoundingClientRect();
    const rows = [...new Set(tabs.map(tab => Math.round(tab.getBoundingClientRect().top)))];
    return {
      width: Math.round(sidebar?.getBoundingClientRect().width || 0),
      clientWidth: bar?.clientWidth || 0,
      scrollWidth: bar?.scrollWidth || 0,
      rows: rows.length,
      iconCount: tabs.filter(tab => {
        const icon = tab.querySelector('.sb-tab-icon');
        return icon && getComputedStyle(icon).display !== 'none';
      }).length,
      tabs: tabs.map(tab => {
        const rect = tab.getBoundingClientRect();
        const label = tab.querySelector('span');
        const labelRect = label.getBoundingClientRect();
        const style = getComputedStyle(label);
        return {
          id: tab.dataset.t,
          text: label.textContent.trim(),
          outside: rect.left < barRect.left - 1 || rect.right > barRect.right + 1,
          nowrap: style.whiteSpace === 'nowrap',
          clipped: label.scrollWidth > label.clientWidth + 1,
          wrapped: labelRect.height > (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2) * 1.25,
        };
      }),
    };
  });
}

function assertSidebar(state, requested) {
  if (Math.abs(state.width - requested) > 1) throw new Error(`sidebar width ${state.width}, expected ${requested}`);
  if (state.scrollWidth > state.clientWidth + 1) throw new Error(`sidebar tabbar overflow ${state.scrollWidth}/${state.clientWidth} at ${requested}`);
  if (state.rows !== 2) throw new Error(`sidebar tabs must form two rows at ${requested}, got ${state.rows}`);
  if (state.tabs.length !== 8) throw new Error(`sidebar tab count ${state.tabs.length}, expected 8`);
  const bad = state.tabs.filter(tab => tab.outside || !tab.nowrap || tab.clipped || tab.wrapped);
  if (bad.length) throw new Error(`sidebar label geometry failed at ${requested}: ${JSON.stringify(bad)}`);
  const expectedIcons = requested <= 260 ? 0 : 8;
  if (state.iconCount !== expectedIcons) throw new Error(`sidebar icon density ${state.iconCount}, expected ${expectedIcons} at ${requested}`);
}

async function playerState(win) {
  return win.evaluate(() => {
    const root = document.querySelector('.pane.active .mz-player') || document.querySelector('.mz-player');
    const stage = root?.querySelector('.mz-stage');
    const empty = root?.querySelector('.mz-empty');
    const controls = root?.querySelector('.mz-controls');
    const side = root?.querySelector('.mz-side');
    const rect = element => {
      const value = element?.getBoundingClientRect();
      return value ? { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    return {
      fatal: !root || !stage || !empty || !controls || !side ? 'empty Player geometry missing' : '',
      sideOpen: !!stage?.classList.contains('side-open'),
      sideOverlay: !!stage?.classList.contains('side-overlay'),
      emptyInlineRight: empty?.style.right || '',
      stage: rect(stage), empty: rect(empty), controls: rect(controls), side: rect(side),
    };
  });
}

function near(a, b, tolerance = 1) { return Math.abs(a - b) <= tolerance; }
function assertClosed(state, label) {
  if (state.fatal) throw new Error(`${label}: ${state.fatal}`);
  if (state.sideOpen || state.side.width !== 0) throw new Error(`${label}: side must be closed ${JSON.stringify(state)}`);
  if (state.emptyInlineRight !== '') throw new Error(`${label}: stale inline right '${state.emptyInlineRight}'`);
  if (!near(state.empty.left, state.stage.left) || !near(state.empty.right, state.stage.right)
    || !near(state.controls.left, state.stage.left) || !near(state.controls.right, state.stage.right)) {
    throw new Error(`${label}: empty surface and controls must fill stage ${JSON.stringify(state)}`);
  }
}

function assertOpen(state, label) {
  if (state.fatal) throw new Error(`${label}: ${state.fatal}`);
  if (!state.sideOpen || state.side.width <= 0) throw new Error(`${label}: side must be open ${JSON.stringify(state)}`);
  if (!state.sideOverlay && (!near(state.empty.right, state.side.left, 2) || !near(state.controls.right, state.side.left, 2))) {
    throw new Error(`${label}: empty surface and controls must share side boundary ${JSON.stringify(state)}`);
  }
  if (state.sideOverlay && (!near(state.empty.right, state.stage.right) || !near(state.controls.right, state.stage.right))) {
    throw new Error(`${label}: overlay side must not shrink media/control seat ${JSON.stringify(state)}`);
  }
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
  await win.waitForFunction(() => !!window.MazzShell?.sidebarCtl && !!window.mazz, null, { timeout: 30000 });
  await win.setViewportSize({ width: 1600, height: 900 }).catch(() => {});

  const sidebar = [];
  for (const width of [180, 232, 320]) {
    const state = await sidebarState(win, width);
    assertSidebar(state, width);
    sidebar.push(state);
    if (width === 232) {
      await win.screenshot({ path: path.join(EVIDENCE, `W87F_SIDEBAR_PLAYER_LAYOUT_${mode}_SIDEBAR_232.png`) });
    }
  }

  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('settings:set', { key: 'player.listSide', value: { width: 260, open: false } });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
    window.MazzCommands.execute('file.newViewer');
  });
  await win.waitForSelector('.pane.active .mz-player .mz-empty', { timeout: 30000 });
  await win.waitForFunction(() => document.querySelector('.pane.active .mz-controls[data-density]'), null, { timeout: 30000 });

  const initial = await playerState(win);
  assertClosed(initial, 'initial');
  await win.screenshot({ path: path.join(EVIDENCE, `W87F_SIDEBAR_PLAYER_LAYOUT_${mode}_CLOSED.png`) });

  await win.evaluate(() => document.querySelector('.pane.active .mz-player [data-a=list]')?.click());
  await win.waitForFunction(() => document.querySelector('.pane.active .mz-stage')?.classList.contains('side-open'));
  await win.waitForTimeout(220);
  const opened = await playerState(win);
  assertOpen(opened, 'opened');

  await win.evaluate(() => document.querySelector('.pane.active .mz-player .mz-side-x')?.click());
  await win.waitForFunction(() => !document.querySelector('.pane.active .mz-stage')?.classList.contains('side-open'));
  await win.waitForTimeout(220);
  const reclosed = await playerState(win);
  assertClosed(reclosed, 'reclosed');

  const soak = [];
  for (let cycle = 1; cycle <= 20; cycle++) {
    await win.evaluate(() => document.querySelector('.pane.active .mz-player [data-a=list]')?.click());
    await win.waitForFunction(() => document.querySelector('.pane.active .mz-stage')?.classList.contains('side-open'));
    await win.waitForTimeout(180);
    const open = await playerState(win);
    assertOpen(open, `soak-${cycle}-open`);
    await win.evaluate(() => document.querySelector('.pane.active .mz-player .mz-side-x')?.click());
    await win.waitForFunction(() => !document.querySelector('.pane.active .mz-stage')?.classList.contains('side-open'));
    await win.waitForTimeout(180);
    const closed = await playerState(win);
    assertClosed(closed, `soak-${cycle}-closed`);
    soak.push({ cycle, open, closed });
  }

  if (errors.main.length || errors.renderer.length) throw new Error(`runtime errors: ${JSON.stringify(errors)}`);
  const report = {
    protocol: 'mazz.w87f-sidebar-player-layout/v1',
    createdAt: new Date().toISOString(),
    mode: mode.toLowerCase(),
    ok: true,
    verdict: 'PASS',
    sidebar,
    player: { initial, opened, reclosed, soak },
    errors,
  };
  fs.writeFileSync(path.join(EVIDENCE, `W87F_SIDEBAR_PLAYER_LAYOUT_${mode}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ protocol: report.protocol, mode: report.mode, verdict: report.verdict, sidebarWidths: sidebar.map(item => item.width), soak: soak.length }, null, 2));
} finally {
  try { await app?.close(); } catch {}
  try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  try { fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
}
