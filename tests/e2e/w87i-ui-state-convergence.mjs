// W87i —— 标题栏 / Ribbon / Status Seat / Construct Panel / 子窗尺寸策略的真实 Electron 门。
// 只使用 Playwright + Electron API，不使用 Computer Use。
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const EXECUTABLE = process.env.MAZZ_E2E_EXECUTABLE ? path.resolve(process.env.MAZZ_E2E_EXECUTABLE) : '';
const MODE = EXECUTABLE ? 'PACKAGED' : 'SOURCE';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87i-state-user-'));
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87i-state-ws-'));
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence');
const reportPath = path.join(EVIDENCE, `W87I_UI_STATE_CONVERGENCE_${MODE}.json`);
const shotPath = label => path.join(EVIDENCE, `W87I_${label}_${MODE}.png`);
const rendererErrors = [];
let app;

const assert = (value, message) => { if (!value) throw new Error(message); };
const rounded = value => Number.parseFloat(String(value || '0')) || 0;

const PANEL_KINDS = [
  'favmgr', 'pwmgr', 'palette', 'shortcuts', 'settings', 'agreement', 'help',
  'translate', 'plugins', 'recorder', 'dockfloat', 'bookmark', 'ctxmenu', 'sync',
  'notif', 'factorycfg', 'newfile', 'picklist', 'fpreview', 'fedit', 'harvest', 'archive',
];
const FIXED_PANELS = new Set(['palette', 'shortcuts', 'agreement', 'bookmark', 'newfile', 'picklist', 'ctxmenu']);

async function mainWindowSize(width, height = 800) {
  await app.evaluate(({ BrowserWindow }, { width, height }) => {
    const main = BrowserWindow.getAllWindows().find(win => !win.__panelKind && !win.getParentWindow());
    if (!main) throw new Error('main window missing');
    main.setSize(width, height);
    main.show();
  }, { width, height });
}

async function waitPanel(kind, timeout = 15000) {
  const end = Date.now() + timeout;
  const marker = `/panels/${kind}.html`;
  while (Date.now() < end) {
    const page = app.windows().find(candidate => candidate.url().includes(marker));
    if (page) {
      await page.waitForLoadState('domcontentloaded');
      if (!['splitpreview', 'annotate'].includes(kind)) {
        await page.waitForFunction(() => document.documentElement.dataset.panelRuntime === 'v1', null, { timeout: 10000 });
      }
      return page;
    }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(`panel did not open: ${kind}`);
}

async function closePanel(main, kind, instanceId = '') {
  await main.evaluate(({ kind, instanceId }) => window.mazz.invoke('panel:close', { kind, instanceId }).catch(() => {}), { kind, instanceId });
  await main.waitForTimeout(80);
}

async function closeAgreement(main) {
  const open = app.windows().find(page => page.url().includes('/panels/agreement.html'));
  if (open) {
    await open.waitForLoadState('domcontentloaded');
    await open.locator('#nomore').check().catch(() => {});
    await open.locator('#accept').click().catch(() => {});
    await main.waitForTimeout(120);
  }
  await main.evaluate(() => Promise.all([
    window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
    window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
  ]));
}

async function setTheme(main, id) {
  await main.evaluate(theme => window.MazzShell.setTheme(theme), id);
  await main.waitForFunction(theme => document.documentElement.dataset.theme === theme, id, { timeout: 10000 });
  await main.waitForTimeout(180);
}

async function panelNativeState(kind) {
  return app.evaluate(({ BrowserWindow }, requestedKind) => {
    const win = BrowserWindow.getAllWindows().find(candidate => candidate.__panelKind === requestedKind);
    if (!win) return null;
    return {
      kind: requestedKind,
      resizable: win.isResizable(),
      maximizable: win.isMaximizable(),
      fullscreenable: win.isFullScreenable(),
      size: win.getSize(),
      minimumSize: win.getMinimumSize(),
      maximumSize: win.getMaximumSize(),
      resizeMode: win.__panelResizeMode,
    };
  }, kind);
}

async function auditHardEdges(panel, kind) {
  return panel.evaluate(requestedKind => {
    const visible = element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > .01 && rect.width > 1 && rect.height > 1;
    };
    const selector = [
      '.pwin', '.head', '.foot', '.tabs', '.tab',
      'button', 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])', 'select', 'textarea',
      '.row', '.item', '.folder', '.plg', '.pw', '.nft', '.rec-src',
      '.w-drop', '.w-ow-card', '.tg-card', '.fc-task', '.df-card',
      '.project-card', '.length-card', '.advanced', '.research-source',
      '.feed-summary', '.feed-cluster', '.provider-card', '.route-row',
      '.manager-row', '.toc-item', '.preview', '[role="dialog"]',
    ].join(',');
    const preserved = '.choice-chip,.provider-chip,.df-chip,.status-pill,.role,.state,.word-chips>button,.dot,.key-dot,.dirty,.c,.avatar,.user-avatar,.agent-avatar';
    const controls = [...document.querySelectorAll(selector)].filter(visible);
    const offenders = controls.filter(element => !element.matches(preserved))
      .map(element => ({
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${typeof element.className === 'string' && element.className.trim() ? '.' + element.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`,
        radius: getComputedStyle(element).borderTopLeftRadius,
      }))
      .filter(row => (Number.parseFloat(row.radius) || 0) > .1);
    const pwin = document.querySelector('.pwin');
    return {
      kind: requestedKind,
      theme: document.documentElement.dataset.theme,
      structure: document.documentElement.dataset.themeStructure,
      resize: document.documentElement.dataset.panelResize,
      pwinRadius: pwin ? getComputedStyle(pwin).borderTopLeftRadius : null,
      audited: controls.length,
      offenders: offenders.slice(0, 40),
      runtime: window.__MazzPanelRuntime?.audit?.() || null,
    };
  }, kind);
}

await seedFixtures(WORKSPACE, WORKSPACE);
fs.mkdirSync(EVIDENCE, { recursive: true });

try {
  app = await electron.launch({
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : { args: [ROOT] }),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: USER_DATA,
      MAZZ_E2E_WORKSPACE: WORKSPACE,
      MAZZ_E2E_DISABLE_GPU: '1',
    },
    timeout: 120000,
  });
  app.on('window', page => {
    page.on('pageerror', error => rendererErrors.push(`${page.url()} pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') rendererErrors.push(`${page.url()} console.error: ${message.text()}`); });
  });

  const main = await app.firstWindow({ timeout: 120000 });
  await main.waitForFunction(() => !!window.MazzShell && document.documentElement.dataset.appReady === '1', null, { timeout: 30000 });
  await closeAgreement(main);
  await mainWindowSize(1440, 900);
  await main.waitForTimeout(200);

  // 1) Windows caption 是独立光学图元，三个命中盒完全同尺寸、SVG 真居中。
  const titlebar = await main.evaluate(() => ({
    buttons: [...document.querySelectorAll('.titlebar .tb-btn')].map(button => {
      const rect = button.getBoundingClientRect(), svg = button.querySelector('svg')?.getBoundingClientRect();
      return {
        action: button.dataset.act,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        svg: svg ? { x: svg.x, y: svg.y, width: svg.width, height: svg.height } : null,
        strokeWidth: svg ? Number.parseFloat(getComputedStyle(button.querySelector('svg')).strokeWidth) : null,
        color: getComputedStyle(button).color,
        centerDelta: svg ? {
          x: Math.abs((rect.x + rect.width / 2) - (svg.x + svg.width / 2)),
          y: Math.abs((rect.y + rect.height / 2) - (svg.y + svg.height / 2)),
        } : null,
        markup: button.innerHTML,
      };
    }),
  }));
  assert(titlebar.buttons.length === 3, `caption count=${titlebar.buttons.length}`);
  assert(titlebar.buttons.every(row => Math.abs(row.rect.width - 46) <= .5 && Math.abs(row.rect.height - 36) <= .5 && row.svg && Math.abs(row.svg.width - 12) <= .5 && Math.abs(row.svg.height - 12) <= .5), `caption geometry unhealthy: ${JSON.stringify(titlebar)}`);
  assert(titlebar.buttons.every(row => row.centerDelta.x <= .75 && row.centerDelta.y <= .75), `caption optical center drift: ${JSON.stringify(titlebar)}`);
  assert(titlebar.buttons.every(row => Math.abs(row.strokeWidth - 1) <= .01), `caption optical stroke was overridden: ${JSON.stringify(titlebar)}`);
  assert(titlebar.buttons.every(row => /^rgba?\(/.test(row.color) && row.color !== 'rgba(0, 0, 0, 0)'), `caption contrast token missing: ${JSON.stringify(titlebar)}`);
  assert(new Set(titlebar.buttons.map(row => row.markup)).size === 3, 'caption primitives must be distinct');

  // 2) Markdown Ribbon 按自身容器降级，不再把中文压成竖排；颜色块有确定默认值。
  await main.evaluate(() => window.MazzHost.openTab('markdown', { title: 'W87i Ribbon.md', content: '# W87i\n' }));
  await main.waitForFunction(() => window.MazzShell?.tabs?.active?.moduleId === 'markdown', null, { timeout: 15000 });
  // Markdown 会在首次 mount 后再注册字体/段落等组；先等最终组数稳定，
  // 否则会把“按钮还在加载”误当成 resize 往返漂移。
  await main.waitForTimeout(750);
  const ribbonWidths = [];
  for (const width of [1920, 1440, 1100, 960, 1100, 1440, 1920]) {
    await mainWindowSize(width, 800);
    await main.waitForTimeout(180);
    const state = await main.evaluate(requestedWidth => {
      const panel = document.querySelector('.ribbon-panel');
      const labels = [...panel.querySelectorAll('.rb-btn > span')].filter(element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 2 && rect.height > 2;
      }).map(element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return { text: element.textContent.trim(), width: rect.width, height: rect.height, writingMode: style.writingMode, whiteSpace: style.whiteSpace, wordBreak: style.wordBreak };
      });
      const buttons = [...panel.querySelectorAll('.rb-btn')].filter(element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 2 && rect.height > 2;
      });
      const overlaps = [];
      for (let i = 0; i < buttons.length; i += 1) for (let j = i + 1; j < buttons.length; j += 1) {
        if (buttons[i].parentElement !== buttons[j].parentElement) continue;
        const a = buttons[i].getBoundingClientRect(), b = buttons[j].getBoundingClientRect();
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5) overlaps.push([i, j]);
      }
      return {
        width: requestedWidth,
        density: document.querySelector('.ribbon')?.dataset.ribbonDensity,
        overflow: panel.scrollWidth - panel.clientWidth,
        overflowMode: panel.dataset.ribbonOverflow,
        overflowX: getComputedStyle(panel).overflowX,
        maxScroll: Math.max(0, panel.scrollWidth - panel.clientWidth),
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        labels,
        overlaps,
      };
    }, width);
    assert(['full', 'compact', 'icon'].includes(state.density), `ribbon density missing at ${width}: ${JSON.stringify(state)}`);
    assert(state.labels.every(row => row.writingMode === 'horizontal-tb' && row.whiteSpace === 'nowrap' && row.height <= 28), `ribbon label squeezed at ${width}: ${JSON.stringify(state.labels)}`);
    assert(state.overlaps.length === 0 && state.documentOverflow <= 1, `ribbon overlap/document overflow at ${width}: ${JSON.stringify(state)}`);
    assert(state.overflowMode === String(state.overflow > 1), `ribbon residual-overflow state drift at ${width}: ${JSON.stringify(state)}`);
    assert(state.overflow <= 1 || (['auto', 'scroll'].includes(state.overflowX) && state.maxScroll > 0),
      `ribbon residual actions are clipped instead of explicitly scrollable at ${width}: ${JSON.stringify(state)}`);
    ribbonWidths.push(state);
  }
  assert(['compact', 'icon'].includes(ribbonWidths.find(row => row.width === 960)?.density), `960px must use an ordered reduced density: ${JSON.stringify(ribbonWidths)}`);
  const repeated1920 = ribbonWidths.filter(row => row.width === 1920);
  assert(repeated1920.length === 2 && repeated1920[0].density === repeated1920[1].density
    && Math.abs(repeated1920[0].overflow - repeated1920[1].overflow) <= 1,
  `Ribbon resize roundtrip was not stable: ${JSON.stringify(repeated1920)}`);

  const swatches = await main.evaluate(() => ({
    text: getComputedStyle(document.querySelector('#md-color-picker .pk-swatch')).backgroundColor,
    highlight: getComputedStyle(document.querySelector('#md-highlight-picker .pk-swatch')).backgroundColor,
  }));
  assert(swatches.text === 'rgb(0, 0, 0)', `text swatch=${swatches.text}`);
  assert(swatches.highlight === 'rgb(255, 0, 0)', `highlight swatch=${swatches.highlight}`);
  await mainWindowSize(1440, 800);
  await main.waitForTimeout(180);
  await main.screenshot({ path: shotPath('RIBBON_STATUS') });

  // 3) Help 和 Agreement 是同级纯文字；所有普通 toast 进独立中央 Seat。
  const headerRoutes = await main.evaluate(() => {
    const rows = ['协议', '帮助'].map(text => {
      const element = [...document.querySelectorAll('.ribbon-tab')].find(node => node.textContent.trim() === text);
      const style = element ? getComputedStyle(element) : null;
      return { text, exists: !!element, svg: element?.querySelectorAll('svg').length || 0, className: element?.className || '', color: style?.color, weight: style?.fontWeight };
    });
    return rows;
  });
  assert(headerRoutes.every(row => row.exists && row.svg === 0 && row.className === 'ribbon-tab'), `header routes not neutral text peers: ${JSON.stringify(headerRoutes)}`);
  assert(headerRoutes[0].color === headerRoutes[1].color && headerRoutes[0].weight === headerRoutes[1].weight, `help/agreement style drift: ${JSON.stringify(headerRoutes)}`);

  const toastState = await main.evaluate(async () => {
    const { toast } = await import('./shell/shell.js');
    toast('已完成当前操作', [{ label: '查看', fn() {} }], 0);
    const element = document.querySelector('.mazz-toast');
    const rect = element.getBoundingClientRect();
    const left = document.querySelector('.statusbar-left').getBoundingClientRect();
    const right = document.querySelector('.statusbar-right').getBoundingClientRect();
    return { host: element.parentElement.id, rect, left, right, viewport: innerWidth };
  });
  assert(toastState.host === 'status-toast-slot', `toast host=${toastState.host}`);
  assert(Math.abs((toastState.rect.left + toastState.rect.width / 2) - toastState.viewport / 2) <= 2, `toast not centered: ${JSON.stringify(toastState)}`);
  assert(toastState.rect.left >= toastState.left.right - .5 && toastState.rect.right <= toastState.right.left + .5, `toast overlaps status sides: ${JSON.stringify(toastState)}`);

  const focusModeToast = await main.evaluate(async () => {
    document.querySelectorAll('.mazz-toast').forEach(element => element.remove());
    document.body.classList.add('focus-mode');
    const { toast } = await import('./shell/shell.js');
    toast('聚焦模式提示仍归状态栏', [], 0);
    const element = document.querySelector('.mazz-toast');
    const rect = element.getBoundingClientRect();
    const left = document.querySelector('.statusbar-left').getBoundingClientRect();
    const right = document.querySelector('.statusbar-right').getBoundingClientRect();
    const result = { host: element.parentElement.id, rect, left, right, viewport: innerWidth };
    document.body.classList.remove('focus-mode');
    element.remove();
    return result;
  });
  assert(focusModeToast.host === 'status-toast-slot', `focus-mode toast escaped its visible Seat: ${JSON.stringify(focusModeToast)}`);
  assert(Math.abs((focusModeToast.rect.left + focusModeToast.rect.width / 2) - focusModeToast.viewport / 2) <= 2
    && focusModeToast.rect.left >= focusModeToast.left.right - .5 && focusModeToast.rect.right <= focusModeToast.right.left + .5,
  `focus-mode toast geometry drift: ${JSON.stringify(focusModeToast)}`);

  // 4) Construct hover 中图标不再与背景同色。
  await mainWindowSize(1440, 900);
  await setTheme(main, 'construct');
  await main.evaluate(() => { window.MazzShell.hideWelcome(); window.MazzShell.showWelcome(); });
  await main.waitForSelector('.welcome .w-card');
  await main.locator('.welcome .w-card').first().hover();
  await main.waitForTimeout(100);
  const constructHover = await main.evaluate(() => {
    const card = document.querySelector('.welcome .w-card');
    const icon = card.querySelector('.mz-ico');
    return { card: getComputedStyle(card).backgroundColor, icon: getComputedStyle(icon).color, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), accentFg: getComputedStyle(document.documentElement).getPropertyValue('--accent-fg').trim() };
  });
  assert(constructHover.icon !== constructHover.card && constructHover.icon !== constructHover.accent, `Construct hover icon disappeared: ${JSON.stringify(constructHover)}`);
  await main.screenshot({ path: shotPath('CONSTRUCT_HOVER') });

  // 5) 不是所有 PanelWindow 都可拉伸；同时全部常规子窗在 Construct 中投影矩形结构。
  const panels = [];
  for (const kind of PANEL_KINDS) {
    const instanceId = ['fpreview', 'fedit'].includes(kind) ? `w87i-${MODE.toLowerCase()}-${kind}` : '';
    const result = await main.evaluate(({ kind, instanceId }) => window.mazz.invoke('panel:open', { kind, opts: { instanceId, title: `W87i ${kind}`, x: 80, y: 100 } }), { kind, instanceId });
    assert(!result?.error, `${kind} open rejected: ${result?.error}`);
    const panel = await waitPanel(kind);
    await panel.waitForFunction(() => document.documentElement.dataset.themeStructure === 'hard-edge', null, { timeout: 10000 });
    const native = await panelNativeState(kind);
    const structure = await auditHardEdges(panel, kind);
    const shouldResize = !FIXED_PANELS.has(kind);
    assert(native && native.resizable === shouldResize && native.maximizable === shouldResize, `${kind} native resize policy drift: ${JSON.stringify(native)}`);
    if (!shouldResize) {
      // Windows 10 may report a one-device-pixel outer-height adjustment for
      // frameless fixed windows.  The contract is min=max (no user resize),
      // with the live outer bounds allowed that compositor rounding pixel.
      assert(native.minimumSize[0] === native.maximumSize[0] && native.minimumSize[1] === native.maximumSize[1]
        && Math.abs(native.size[0] - native.minimumSize[0]) <= 1 && Math.abs(native.size[1] - native.minimumSize[1]) <= 1,
      `${kind} fixed min/max drift: ${JSON.stringify(native)}`);
      const maxDisplay = await panel.locator('#p-max').count() ? await panel.locator('#p-max').evaluate(element => getComputedStyle(element).display) : 'absent';
      assert(maxDisplay === 'none' || maxDisplay === 'absent', `${kind} fixed panel still exposes maximize`);
    }
    assert(structure.structure === 'hard-edge' && rounded(structure.pwinRadius) === 0, `${kind} outer structure drift: ${JSON.stringify(structure)}`);
    assert(structure.offenders.length === 0, `${kind} rounded rectangular surfaces: ${JSON.stringify(structure.offenders)}`);
    panels.push({ native, structure });
    await closePanel(main, kind, instanceId);
  }

  // 6) 已打开子窗热切“自定义构成包”时，颜色与结构一次到位；切回 Paper 恢复软边。
  await main.evaluate(() => window.mazz.invoke('panel:open', { kind: 'settings' }));
  const settings = await waitPanel('settings');
  await settings.waitForFunction(() => document.documentElement.dataset.themeStructure === 'hard-edge', null, { timeout: 10000 });
  await main.evaluate(async () => {
    const { applyPack } = await import('./lib/theme-store.js');
    applyPack('w87i-construct', {
      name: 'W87i 自定义构成', base: 'paper', structure: 'construct',
      vars: { accent: '#1359c7', 'accent-fg': '#ffffff', border: '#172033' },
    });
    window.MazzShell._broadcastThemeNow();
  });
  await settings.waitForFunction(() => document.documentElement.dataset.theme === 'pack:w87i-construct' && document.documentElement.dataset.themeStructure === 'hard-edge', null, { timeout: 10000 });
  const packPanel = await settings.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    structure: document.documentElement.dataset.themeStructure,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    outerRadius: getComputedStyle(document.querySelector('.pwin')).borderTopLeftRadius,
    buttonRadius: getComputedStyle(document.querySelector('.btn')).borderTopLeftRadius,
  }));
  assert(packPanel.accent === '#1359c7' || packPanel.accent === 'rgb(19, 89, 199)', `pack color did not reach open panel: ${JSON.stringify(packPanel)}`);
  assert(rounded(packPanel.outerRadius) === 0 && rounded(packPanel.buttonRadius) === 0, `pack structure did not reach open panel: ${JSON.stringify(packPanel)}`);
  await settings.screenshot({ path: shotPath('PANEL_STRUCTURE') });

  await setTheme(main, 'paper');
  await settings.waitForFunction(() => document.documentElement.dataset.theme === 'paper' && document.documentElement.dataset.themeStructure === 'soft', null, { timeout: 10000 });
  const restored = await settings.evaluate(() => ({
    outerRadius: getComputedStyle(document.querySelector('.pwin')).borderTopLeftRadius,
    buttonRadius: getComputedStyle(document.querySelector('.btn')).borderTopLeftRadius,
  }));
  assert(rounded(restored.outerRadius) > 0 && rounded(restored.buttonRadius) > 0, `soft theme did not restore rounded semantics: ${JSON.stringify(restored)}`);
  await closePanel(main, 'settings');

  // 7) Async pack/custom restoration must never overtake the user's newer
  // built-in choice.  Delaying the real IPC catches the historical race rather
  // than merely inspecting source strings.
  const themeRace = await main.evaluate(async workspace => {
    const slash = value => String(value).replace(/\\/g, '/');
    const themesDir = `${slash(workspace)}/themes`;
    const packPath = `${themesDir}/w87i-race.json`;
    await window.mazz.invoke('fs:mkdir', { path: themesDir });
    await window.mazz.invoke('fs:writeFile', { path: packPath, content: JSON.stringify({
      id: 'w87i-race', name: 'W87i Race', base: 'paper', structure: 'construct', vars: { accent: '#c4151c' },
    }) });
    const original = window.mazz.invoke.bind(window.mazz);
    let delayList = true;
    window.mazz.invoke = async (channel, payload) => {
      if (delayList && channel === 'fs:listDir') {
        delayList = false;
        await new Promise(resolve => setTimeout(resolve, 220));
      }
      return original(channel, payload);
    };
    window.MazzShell.setTheme('pack:w87i-race');
    await new Promise(resolve => setTimeout(resolve, 20));
    window.MazzShell.setTheme('paper');
    await new Promise(resolve => setTimeout(resolve, 420));
    const packThenPaper = {
      theme: document.documentElement.dataset.theme,
      structure: document.documentElement.dataset.themeStructure,
    };

    let delayThemeGet = true;
    window.mazz.invoke = async (channel, payload) => {
      if (delayThemeGet && channel === 'settings:get' && payload?.key === 'theme') {
        delayThemeGet = false;
        await new Promise(resolve => setTimeout(resolve, 220));
      }
      return original(channel, payload);
    };
    window.MazzShell.setTheme('custom');
    await new Promise(resolve => setTimeout(resolve, 20));
    window.MazzShell.setTheme('ink');
    await new Promise(resolve => setTimeout(resolve, 420));
    const customThenInk = {
      theme: document.documentElement.dataset.theme,
      structure: document.documentElement.dataset.themeStructure,
    };
    window.mazz.invoke = original;
    return { packThenPaper, customThenInk };
  }, WORKSPACE);
  assert(themeRace.packThenPaper.theme === 'paper' && themeRace.packThenPaper.structure === 'soft',
    `stale pack completion overrode Paper: ${JSON.stringify(themeRace)}`);
  assert(themeRace.customThenInk.theme === 'ink' && themeRace.customThenInk.structure === 'soft',
    `stale custom completion overrode Ink: ${JSON.stringify(themeRace)}`);

  assert(rendererErrors.length === 0, `renderer errors: ${rendererErrors.join('\n')}`);
  const report = {
    protocol: 'mazz.w87i-ui-state-convergence/v1',
    createdAt: new Date().toISOString(),
    mode: MODE,
    executable: EXECUTABLE || 'electron-source',
    ok: true,
    verdict: 'PASS',
    computerUse: 'DISABLED / NOT USED',
    titlebar,
    ribbonWidths,
    swatches,
    headerRoutes,
    toastState,
    focusModeToast,
    constructHover,
    panels,
    packPanel,
    restored,
    themeRace,
    rendererErrors,
    screenshots: [shotPath('RIBBON_STATUS'), shotPath('CONSTRUCT_HOVER'), shotPath('PANEL_STRUCTURE')].map(file => path.relative(ROOT, file).replace(/\\/g, '/')),
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ protocol: report.protocol, mode: MODE, verdict: report.verdict, panelCount: panels.length, ribbonWidths: ribbonWidths.map(row => [row.width, row.density, row.overflow]), rendererErrors: rendererErrors.length }, null, 2));
} finally {
  try { await app?.close(); } catch {}
  try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); } catch {}
  try { fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); } catch {}
}
