import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Human } from './human.mjs';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const ROOT = path.resolve('.');
const EXECUTABLE = process.env.MAZZ_E2E_EXECUTABLE ? path.resolve(process.env.MAZZ_E2E_EXECUTABLE) : '';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87-ui-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87-ui-ws-'));
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence');
fs.mkdirSync(EVIDENCE, { recursive: true });
const mainLogs = [];
const rendererErrors = [];
const moduleFrames = { paper: [], ink: [] };
const panelFrames = [];
const themeSamples = {};
let app = null;
let currentPhase = 'launch';

const MODULES = [
  ['markdown', '文档', '# W87 UI 封板\n\n统一视觉合成与全局控件状态。'],
  ['text', '纯文本', 'W87 visual composition runtime'],
  ['sheet', '表格', ''], ['slide', '演示', ''], ['code', '代码', 'const seal = true;'],
  ['math', '计算', ''], ['notes', '笔记', ''], ['search', '搜索', ''], ['mindmap', '导图', ''],
  ['draw', '画板', ''], ['library', '书库', ''], ['viewer', '播放器', ''],
  ['factorydesk', '智能创作台', JSON.stringify({ mark: 'mazz-factorydesk-v1', view: 'workshop' })],
  ['organization', '组织编译台', ''],
];
const PANEL_KINDS = [
  'favmgr', 'pwmgr', 'palette', 'shortcuts', 'annotate', 'settings', 'agreement', 'help',
  'translate', 'plugins', 'recorder', 'dockfloat', 'bookmark', 'ctxmenu', 'splitpreview', 'sync',
  'notif', 'factorycfg', 'newfile', 'picklist', 'fpreview', 'fedit', 'harvest', 'archive',
];

function thumb(buffer, width = 400, height = 250) {
  const source = PNG.sync.read(buffer);
  const target = new PNG({ width, height, colorType: 6 });
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor(y * source.height / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor(x * source.width / width));
      const si = (sy * source.width + sx) * 4;
      const di = (y * width + x) * 4;
      target.data[di] = source.data[si]; target.data[di + 1] = source.data[si + 1];
      target.data[di + 2] = source.data[si + 2]; target.data[di + 3] = source.data[si + 3];
    }
  }
  return target;
}

function contactSheet(frames, targetPath, columns = 4) {
  const cellW = 400, cellH = 250, rows = Math.ceil(frames.length / columns);
  const sheet = new PNG({ width: cellW * columns, height: cellH * rows, colorType: 6 });
  sheet.data.fill(24);
  for (let index = 0; index < frames.length; index += 1) {
    const image = thumb(frames[index].buffer, cellW, cellH);
    const ox = (index % columns) * cellW, oy = Math.floor(index / columns) * cellH;
    PNG.bitblt(image, sheet, 0, 0, cellW, cellH, ox, oy);
  }
  fs.writeFileSync(targetPath, PNG.sync.write(sheet));
}

async function waitPanel(kind, timeout = 12000) {
  const marker = `/panels/${kind}.html`;
  const end = Date.now() + timeout;
  const seenUrls = new Set();
  while (Date.now() < end) {
    const windows = app.windows();
    for (const candidate of windows) seenUrls.add(candidate.url());
    const page = windows.find(candidate => candidate.url().includes(marker));
    if (page) { await page.waitForLoadState('domcontentloaded'); return page; }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  const topology = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({
    id: win.id, kind: win.__panelKind || '', key: win.__panelKey || '', visible: win.isVisible(),
    destroyed: win.isDestroyed(), url: win.webContents?.getURL?.() || '',
  }))).catch(error => [{ topologyError: error.message }]);
  throw new Error(`panel did not open: ${kind}; seen=${JSON.stringify([...seenUrls])}; topology=${JSON.stringify(topology)}`);
}

async function dismissAgreement(win) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const panel = app.windows().find(page => page.url().includes('/panels/agreement.html'));
    if (!panel) break;
    await panel.waitForLoadState('domcontentloaded');
    if (await panel.locator('#nomore').count()) await panel.locator('#nomore').check().catch(() => {});
    if (await panel.locator('#accept').count()) await panel.locator('#accept').click().catch(() => {});
    await win.waitForTimeout(150);
  }
  await win.evaluate(() => Promise.all([
    window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
    window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
  ]));
}

async function setTheme(win, id) {
  const immediate = await win.evaluate(themeId => {
    window.MazzShell.setTheme(themeId);
    return { requested: themeId, applied: document.documentElement.dataset.theme };
  }, id);
  await win.waitForTimeout(180);
  const sample = await win.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      id: document.documentElement.dataset.theme,
      bg: style.getPropertyValue('--bg').trim().toLowerCase(),
      fg: style.getPropertyValue('--fg').trim().toLowerCase(),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    };
  });
  if (sample.id !== id) throw new Error(`${id} theme id did not converge: ${JSON.stringify({ immediate, sample })}`);
  const expected = id === 'paper' ? '#f7f6f3' : id === 'ink' ? '#16181d' : null;
  if (expected && sample.bg !== expected) throw new Error(`${id} theme did not converge: ${JSON.stringify(sample)}`);
  themeSamples[id] = sample;
}

async function auditMainUi(win, scopeName) {
  const result = await win.evaluate(name => {
    const active = window.MazzShell?.tabs?.active;
    const root = active?.container || document.body;
    const visible = element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const rawEmoji = [...document.querySelectorAll('button,[role=button],.ico,.pi-icon')]
      .filter(visible)
      .map(element => element.textContent?.trim() || '')
      .filter(text => /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(text));
    const unlabeled = [...document.querySelectorAll('button,[role=button]')].filter(visible).filter(element => {
      const hasGraphic = !!element.querySelector('svg,img,.ico');
      const text = element.textContent?.trim() || '';
      return hasGraphic && !text && !element.getAttribute('aria-label') && !element.getAttribute('title');
    }).map(element => element.outerHTML.slice(0, 180));
    const overflow = [];
    for (const element of [root, ...root.querySelectorAll(':scope > *, main, section, [class$="-root"], [class$="-body"]')]) {
      const style = getComputedStyle(element);
      if (!visible(element) || /auto|scroll/.test(style.overflowX)) continue;
      if (element.scrollWidth > element.clientWidth + 4) overflow.push({ className: String(element.className).slice(0, 100), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth });
    }
    return {
      name, moduleId: active?.moduleId, rawEmoji: [...new Set(rawEmoji)].slice(0, 20),
      unlabeled: unlabeled.slice(0, 20), overflow: overflow.slice(0, 20),
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      runtime: window.MazzVisualComposition?.snapshot?.(),
    };
  }, scopeName);
  if (result.rawEmoji.length) throw new Error(`${scopeName} raw control emoji: ${JSON.stringify(result.rawEmoji)}`);
  if (result.unlabeled.length) throw new Error(`${scopeName} unlabeled icon controls: ${JSON.stringify(result.unlabeled)}`);
  if (result.documentOverflow > 4) throw new Error(`${scopeName} document horizontal overflow: ${result.documentOverflow}`);
  if (!result.runtime?.planeConnected) throw new Error(`${scopeName} overlay plane disconnected`);
  return result;
}

try {
  app = await electron.launch({
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : { args: [ROOT] }),
    env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, MAZZ_E2E_DISABLE_GPU: '1', NODE_ENV: 'test' },
    timeout: 120000,
  });
  app.on('window', page => {
    page.on('pageerror', error => rendererErrors.push(`${page.url()} pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') rendererErrors.push(`${page.url()} console.error: ${message.text()}`); });
  });
  const proc = app.process?.();
  proc?.stdout?.on?.('data', bytes => { const text = String(bytes); mainLogs.push(text); process.stdout.write('[electron] ' + text); });
  proc?.stderr?.on?.('data', bytes => {
    const text = String(bytes);
    mainLogs.push(`[${currentPhase}] ${text}`);
    process.stdout.write(`[electron:err:${currentPhase}] ` + text);
  });
  const win = await app.firstWindow({ timeout: 120000 });
  const human = new Human(win, { tag: 'w87-ui' });
  human.watchMain(app);
  await win.waitForFunction(() => !!window.MazzShell && !!window.MazzCommands && !!window.MazzVisualComposition, null, { timeout: 30000 });
  await win.evaluate(() => window.MazzBoot);
  await win.waitForFunction(() => document.documentElement.dataset.appReady === '1');
  await dismissAgreement(win);
  currentPhase = 'module-matrix';

  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(candidate => !candidate.__panelKind && !candidate.getParentWindow());
    main.setSize(1280, 800); main.center(); main.show(); main.focus();
  });

  for (const theme of ['paper', 'ink']) {
    await setTheme(win, theme);
    for (const [moduleId, title, content] of MODULES) {
      await win.evaluate(({ moduleId, title, content }) => window.MazzHost.openTab(moduleId, { title: `${title} · ${moduleId}`, content }), { moduleId, title, content });
      await win.waitForFunction(id => window.MazzShell?.tabs?.active?.moduleId === id, moduleId, { timeout: 12000 });
      await win.waitForTimeout(moduleId === 'factorydesk' || moduleId === 'organization' ? 500 : 180);
      const audit = await auditMainUi(win, `${theme}/${moduleId}`);
      if (audit.moduleId !== moduleId) throw new Error(`active module drift: ${moduleId} -> ${audit.moduleId}`);
      moduleFrames[theme].push({ name: moduleId, buffer: await win.screenshot() });
    }
  }
  contactSheet(moduleFrames.paper, path.join(EVIDENCE, 'W87_UI_MODULE_MATRIX_PAPER.png'));
  contactSheet(moduleFrames.ink, path.join(EVIDENCE, 'W87_UI_MODULE_MATRIX_INK.png'));
  if (themeSamples.paper.bg === themeSamples.ink.bg || themeSamples.paper.bodyBackground === themeSamples.ink.bodyBackground) {
    throw new Error(`paper/ink visual samples did not diverge: ${JSON.stringify(themeSamples)}`);
  }

  await setTheme(win, 'ink');
  currentPhase = 'native-overlay';
  await win.evaluate(() => window.MazzCommands.execute('file.newBrowser'));
  const browser = await win.waitForFunction(() => {
    const ctl = window.__activeBrowserCtl, tab = ctl?.tabs?.find(item => item.id === ctl.activeId);
    return tab?.viewId ? { viewId: tab.viewId } : null;
  }, null, { timeout: 20000 }).then(handle => handle.jsonValue());
  const probeUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><style>html,body{height:100%;margin:0;background:linear-gradient(135deg,#172554,#0f766e);color:white;font:600 32px system-ui}body{display:grid;place-items:center}</style><body>W87 Native Surface</body>');
  await win.evaluate(({ viewId, probeUrl }) => window.mazz.invoke('bv:nav', { tabId: viewId, action: 'load', url: probeUrl }), { viewId: browser.viewId, probeUrl });
  await win.waitForFunction(async viewId => { const state = await window.mazz.invoke('bv:state', { tabId: viewId }); return !state.loading && !state.hidden && state.bounds.width > 300; }, browser.viewId, { timeout: 15000 });
  const before = await win.evaluate(viewId => window.mazz.invoke('bv:state', { tabId: viewId }), browser.viewId);

  await win.evaluate(() => {
    const make = label => {
      const mask = document.createElement('div'); mask.className = 'mazz-palette-mask';
      mask.innerHTML = `<div class="mazz-palette" style="padding:28px"><h2>${label}</h2><button title="关闭">✕</button></div>`;
      const handle = window.MazzVisualComposition.mountOverlay(mask, { kind: 'w87-e2e', onDismiss: () => { handle.release(); mask.remove(); } });
      return { mask, handle };
    };
    window.__w87Overlays = [make('第一层视觉仲裁'), make('第二层引用计数')];
  });
  await win.waitForFunction(async viewId => {
    const state = await window.mazz.invoke('bv:state', { tabId: viewId });
    const visual = await window.mazz.invoke('visual:snapshot');
    return state.hidden && state.occluded && visual.overlayCount === 2;
  }, browser.viewId, { timeout: 12000 });
  await win.screenshot({ path: path.join(EVIDENCE, 'W87_UI_OVERLAY_NATIVE_OCCLUSION.png') });
  await win.evaluate(() => { const one = window.__w87Overlays.shift(); one.handle.release(); one.mask.remove(); });
  await win.waitForFunction(async viewId => { const state = await window.mazz.invoke('bv:state', { tabId: viewId }); const visual = await window.mazz.invoke('visual:snapshot'); return state.hidden && state.occluded && visual.overlayCount === 1; }, browser.viewId);
  await win.evaluate(() => { const one = window.__w87Overlays.shift(); one.handle.release(); one.mask.remove(); });
  await win.waitForFunction(async viewId => { const state = await window.mazz.invoke('bv:state', { tabId: viewId }); const visual = await window.mazz.invoke('visual:snapshot'); return !state.hidden && !state.occluded && visual.overlayCount === 0; }, browser.viewId, { timeout: 12000 });
  const after = await win.evaluate(viewId => window.mazz.invoke('bv:state', { tabId: viewId }), browser.viewId);
  const frame = await win.evaluate(viewId => window.mazz.invoke('bv:capture', { tabId: viewId }), browser.viewId);
  if (!frame || frame.length < 1000 || after.reviveGen <= before.reviveGen) throw new Error(`native surface did not revive: ${JSON.stringify({ before, after, frame: frame?.length })}`);

  await win.evaluate(() => window.MazzHost.openTab('markdown', { title: 'Panel Matrix Host', content: '# Panel host' }));
  currentPhase = 'panel-matrix';
  for (const kind of PANEL_KINDS) {
    process.stdout.write(`[w87] panel ${kind}\n`);
    const result = await win.evaluate(kind => window.mazz.invoke('panel:open', { kind, opts: { instanceId: `w87-${kind}`, title: `W87 ${kind}`, x: 40, y: 80 } }), kind);
    if (result?.error) throw new Error(`${kind} open rejected: ${result.error}`);
    const panel = await waitPanel(kind);
    if (kind !== 'splitpreview') {
      await panel.waitForFunction(() => document.documentElement.dataset.panelRuntime === 'v1', null, { timeout: 10000 });
      const audit = await panel.evaluate(() => window.__MazzPanelRuntime?.audit?.());
      if (!audit || audit.rawControlIcons.length) throw new Error(`${kind} panel raw control icons: ${JSON.stringify(audit)}`);
    }
    const topology = await app.evaluate(({ BrowserWindow }, wanted) => {
      const panelWin = BrowserWindow.getAllWindows().find(candidate => candidate.__panelKind === wanted || candidate.__panelKey === wanted);
      return panelWin ? { parentId: panelWin.getParentWindow()?.id || null, hostId: panelWin.__panelHost?.id || null, visible: panelWin.isVisible() } : null;
    }, kind);
    if (!topology || topology.parentId !== topology.hostId) throw new Error(`${kind} host ownership drift: ${JSON.stringify(topology)}`);
    if (!['annotate', 'splitpreview'].includes(kind)) {
      try { panelFrames.push({ name: kind, buffer: await panel.screenshot({ omitBackground: false }) }); }
      catch (error) { throw new Error(`${kind} panel screenshot failed: ${error.message}`); }
    }
    const closed = panel.waitForEvent('close', { timeout: 5000 }).then(() => true).catch(() => false);
    await win.evaluate(({ kind }) => window.mazz.invoke('panel:close', { kind, instanceId: `w87-${kind}` }), { kind });
    if (!await closed) throw new Error(`${kind} panel did not close within 5s`);
    await win.waitForTimeout(60);
  }
  contactSheet(panelFrames, path.join(EVIDENCE, 'W87_UI_PANEL_MATRIX_INK.png'));

  currentPhase = 'minimum-window';
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(candidate => !candidate.__panelKind && !candidate.getParentWindow());
    main.setSize(960, 600); main.show(); main.focus();
  });
  await win.waitForTimeout(250);
  const narrow = await auditMainUi(win, 'ink/960x600');
  if (narrow.runtime.uiSize !== 'md') throw new Error(`960 width size class mismatch: ${narrow.runtime.uiSize}`);
  await win.screenshot({ path: path.join(EVIDENCE, 'W87_UI_MINIMUM_WINDOW_INK.png') });

  const visual = await win.evaluate(() => window.mazz.invoke('visual:snapshot'));
  const fatal = mainLogs.filter(line => /uncaught|unhandled|TypeError|ReferenceError|SyntaxError|FATAL|\bError\b/i.test(line));
  if (fatal.length) throw new Error(`main fatal logs: ${fatal.join('\n').slice(0, 2000)}`);
  if (rendererErrors.length) throw new Error(`renderer errors: ${rendererErrors.join('\n').slice(0, 3000)}`);
  await human.finish({ allow: ['ERR_ABORTED', 'net::ERR_FILE_NOT_FOUND', 'favicon'] });
  const report = {
    generatedAt: new Date().toISOString(), protocol: visual.protocol, runtimeMode: EXECUTABLE ? 'packaged' : 'source',
    modules: { count: MODULES.length, themes: ['paper', 'ink'], screenshots: 2, themeSamples },
    panels: { count: PANEL_KINDS.length, screenshots: panelFrames.length },
    nativeSurface: { before, after, nestedOverlayReferenceCounting: true, captureBytes: Buffer.from(frame, 'base64').length },
    minimumWindow: { width: 960, height: 600, uiSize: narrow.runtime.uiSize },
    fatalMainLogs: fatal.length, rendererErrors: rendererErrors.length,
  };
  const reportText = JSON.stringify(report, null, 2) + '\n';
  fs.writeFileSync(path.join(EVIDENCE, 'W87_UI_CONVERGENCE_RUNTIME.json'), reportText);
  fs.writeFileSync(path.join(EVIDENCE, `W87_UI_CONVERGENCE_RUNTIME_${report.runtimeMode.toUpperCase()}.json`), reportText);
  console.log(JSON.stringify({ ok: true, ...report }));
} finally {
  if (app) await app.close().catch(() => {});
  try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
  try { fs.rmSync(WS, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
}
