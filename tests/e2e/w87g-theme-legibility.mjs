import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const ROOT = path.resolve('.');
const EXECUTABLE = process.env.MAZZ_E2E_EXECUTABLE ? path.resolve(process.env.MAZZ_E2E_EXECUTABLE) : '';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87g-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w87g-ws-'));
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence');
const MODE = EXECUTABLE ? 'PACKAGED' : 'SOURCE';
const THEMES = ['paper', 'ink'];
const failures = [];
const rendererErrors = [];
const frames = { modules: { paper: [], ink: [] }, panels: { paper: [], ink: [] }, quicknote: { paper: [], ink: [] } };
let app;

const MODULES = [
  ['welcome', '欢迎页', ''],
  ['markdown', '文档', '# 主题辨识度门禁\n\n次级文字与 SVG 图标必须清晰。'],
  ['text', '纯文本', 'Paper / Ink legibility'],
  ['sheet', '表格', ''], ['slide', '演示', ''], ['code', '代码', 'const legible = true;'],
  ['math', '计算', ''], ['notes', '笔记', ''], ['search', '搜索', ''], ['mindmap', '导图', ''],
  ['draw', '画板', ''], ['library', '书库', ''], ['viewer', '播放器', ''],
  ['factorydesk', '智能创作台', JSON.stringify({ mark: 'mazz-factorydesk-v1', view: 'workshop' })],
  ['organization', '组织编译台', ''], ['browser', '隐私浏览器', ''],
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
      const si = (sy * source.width + sx) * 4, di = (y * width + x) * 4;
      target.data[di] = source.data[si]; target.data[di + 1] = source.data[si + 1];
      target.data[di + 2] = source.data[si + 2]; target.data[di + 3] = source.data[si + 3];
    }
  }
  return target;
}

function contactSheet(items, targetPath, columns = 4) {
  if (!items.length) return;
  const cellW = 400, cellH = 250, rows = Math.ceil(items.length / columns);
  const sheet = new PNG({ width: cellW * columns, height: cellH * rows, colorType: 6 });
  sheet.data.fill(24);
  items.forEach((item, index) => {
    const image = thumb(item.buffer, cellW, cellH);
    PNG.bitblt(image, sheet, 0, 0, cellW, cellH, (index % columns) * cellW, Math.floor(index / columns) * cellH);
  });
  fs.writeFileSync(targetPath, PNG.sync.write(sheet));
}

async function audit(page, scope, theme) {
  const result = await page.evaluate(({ scope, theme }) => {
    const parse = value => {
      const match = String(value || '').match(/rgba?\((\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*(?:\.\d+)?))?\)/i);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined || match[4] === '' ? 1 : Number(match[4])] : null;
    };
    const composite = (front, back, alpha = front[3]) => [
      front[0] * alpha + back[0] * (1 - alpha), front[1] * alpha + back[1] * (1 - alpha),
      front[2] * alpha + back[2] * (1 - alpha), 1,
    ];
    const luminance = color => {
      const linear = color.slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    };
    const contrast = (a, b) => {
      const al = luminance(a), bl = luminance(b);
      return (Math.max(al, bl) + .05) / (Math.min(al, bl) + .05);
    };
    const visible = element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > .01 && rect.width > 1 && rect.height > 1;
    };
    const effectiveOpacity = element => {
      let opacity = 1, node = element;
      while (node instanceof Element) { opacity *= Number(getComputedStyle(node).opacity || 1); node = node.parentElement; }
      return opacity;
    };
    const background = element => {
      let node = element;
      let color = [255, 255, 255, 1];
      const layers = [];
      while (node instanceof Element) {
        const parsed = parse(getComputedStyle(node).backgroundColor);
        if (parsed && parsed[3] > .001) layers.push(parsed);
        node = node.parentElement;
      }
      for (let index = layers.length - 1; index >= 0; index -= 1) color = composite(layers[index], color);
      return color;
    };
    const descriptor = element => {
      const id = element.id ? `#${element.id}` : '';
      const cls = typeof element.className === 'string' && element.className.trim()
        ? '.' + element.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      return `${element.tagName.toLowerCase()}${id}${cls}`.slice(0, 160);
    };
    const directText = element => [...element.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
    const issues = [];
    const samples = [];
    const inspect = (element, kind, text, pseudo = '') => {
      if (!visible(element) || effectiveOpacity(element) <= .01 || element.closest('[aria-hidden="true"]')) return;
      const style = getComputedStyle(element, pseudo || undefined);
      if (pseudo && (style.display === 'none' || style.visibility === 'hidden')) return;
      const stroke = kind === 'icon' && style.stroke !== 'none' ? parse(style.stroke) : null;
      const fill = kind === 'icon' && style.fill !== 'none' ? parse(style.fill) : null;
      const paint = stroke || fill || parse(style.color);
      const paintOpacity = stroke ? Number(style.strokeOpacity || 1) : fill ? Number(style.fillOpacity || 1) : 1;
      const fg = paint;
      let bg = background(element);
      const pseudoBackground = pseudo ? parse(style.backgroundColor) : null;
      if (pseudoBackground && pseudoBackground[3] > .001) bg = composite(pseudoBackground, bg);
      if (!fg || !bg) return;
      const pseudoOpacity = pseudo ? Number(style.opacity || 1) : 1;
      const opacity = Math.min(1, fg[3] * paintOpacity * pseudoOpacity * effectiveOpacity(element));
      const painted = composite(fg, bg, opacity);
      const ratio = contrast(painted, bg);
      const disabled = element.matches(':disabled,[aria-disabled="true"]') || !!element.closest(':disabled,[aria-disabled="true"]');
      const fontSize = Number.parseFloat(style.fontSize) || 12;
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const threshold = kind === 'icon' || disabled || large ? 3 : 4.5;
      const sample = { kind, selector: descriptor(element), text: String(text || '').slice(0, 60), ratio: Number(ratio.toFixed(2)), threshold, color: kind === 'icon' ? (stroke ? style.stroke : fill ? style.fill : style.color) : style.color, background: bg.slice(0, 3).map(Math.round).join(','), opacity: Number(opacity.toFixed(2)), disabled };
      samples.push(sample);
      if (ratio + .01 < threshold) issues.push(sample);
    };
    const all = [...document.body.querySelectorAll('*')];
    for (const element of all) {
      if (element instanceof SVGElement) continue;
      const text = directText(element);
      if (text && (!/^[\p{Extended_Pictographic}\s]+$/u.test(text) || element.matches('button,[role="button"]'))) inspect(element, 'text', text);
      if (element.matches('input,textarea') && element.getAttribute('placeholder')) {
        const pseudo = getComputedStyle(element, '::placeholder');
        if (pseudo?.color) inspect(element, 'placeholder', element.getAttribute('placeholder'), '::placeholder');
      }
      if (element.matches('input,textarea,select') && !element.matches('input[type="hidden"],input[type="checkbox"],input[type="radio"],input[type="color"],input[type="range"],input[type="file"]')) {
        const value = element instanceof HTMLSelectElement ? element.selectedOptions[0]?.textContent : element.value;
        if (String(value || '').trim()) inspect(element, 'text', value);
      }
      for (const pseudoName of ['::before', '::after']) {
        const pseudo = getComputedStyle(element, pseudoName);
        const raw = String(pseudo.content || '');
        if (!raw || raw === 'none' || raw === 'normal' || raw === '""' || raw === "''") continue;
        const content = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
        if (content.trim()) inspect(element, 'text', content, pseudoName);
      }
    }
    const icons = [...document.querySelectorAll('.mz-ico,button svg,[role="button"] svg')];
    for (const icon of icons) inspect(icon, 'icon', icon.closest('button,[role="button"]')?.getAttribute('aria-label') || icon.closest('button,[role="button"]')?.title || 'svg');
    const unique = [...new Map(issues.map(issue => [`${issue.kind}|${issue.selector}|${issue.text}|${issue.ratio}`, issue])).values()];
    return { scope, theme, audited: samples.length, issues: unique.slice(0, 300), worst: [...samples].sort((a, b) => a.ratio - b.ratio).slice(0, 20) };
  }, { scope, theme });
  failures.push(...result.issues.map(issue => ({ scope, theme, ...issue })));
  return result;
}

async function waitPanel(kind, timeout = 12000) {
  const end = Date.now() + timeout, marker = `/panels/${kind}.html`;
  while (Date.now() < end) {
    const page = app.windows().find(candidate => candidate.url().includes(marker));
    if (page) { await page.waitForLoadState('domcontentloaded'); return page; }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(`panel did not open: ${kind}`);
}

async function setTheme(main, theme) {
  await main.evaluate(id => window.MazzShell.setTheme(id), theme);
  await main.waitForFunction(id => document.documentElement.dataset.theme === id, theme);
  await main.waitForTimeout(180);
}

async function closeAgreement(main) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    const page = app.windows().find(candidate => candidate.url().includes('/panels/agreement.html'));
    if (!page) break;
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#nomore').check().catch(() => {});
    await page.locator('#accept').click().catch(() => {});
    await main.waitForTimeout(100);
  }
  await main.evaluate(() => Promise.all([
    window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
    window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
  ]));
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
  const main = await app.firstWindow({ timeout: 120000 });
  await main.waitForFunction(() => !!window.MazzShell && document.documentElement.dataset.appReady === '1', null, { timeout: 30000 });
  await closeAgreement(main);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(candidate => !candidate.__panelKind && !candidate.getParentWindow());
    win.setSize(1280, 800); win.show(); win.focus();
  });

  for (const theme of THEMES) {
    await setTheme(main, theme);
    for (const [moduleId, title, content] of MODULES) {
      if (moduleId === 'welcome') {
        await main.evaluate(() => { window.MazzShell.hideWelcome(); window.MazzShell.showWelcome(); });
        await main.waitForTimeout(120);
      } else {
        await main.evaluate(({ moduleId, title, content }) => window.MazzHost.openTab(moduleId, { title, content }), { moduleId, title, content });
        await main.waitForFunction(id => window.MazzShell?.tabs?.active?.moduleId === id, moduleId, { timeout: 15000 });
        await main.waitForTimeout(['browser', 'factorydesk', 'organization'].includes(moduleId) ? 500 : 180);
      }
      const report = await audit(main, `module/${moduleId}`, theme);
      frames.modules[theme].push({ name: moduleId, buffer: await main.screenshot() });
      process.stdout.write(`[w87g] ${theme} module ${moduleId}: ${report.issues.length}/${report.audited}\n`);
    }
  }

  await main.evaluate(() => window.MazzHost.openTab('markdown', { title: 'Panel Host', content: '# Panel Host' }));
  for (const theme of THEMES) {
    await setTheme(main, theme);
    for (const kind of PANEL_KINDS) {
      const result = await main.evaluate(({ kind, theme }) => window.mazz.invoke('panel:open', { kind, opts: { instanceId: `w87g-${theme}-${kind}`, title: `W87g ${kind}`, x: 40, y: 80 } }), { kind, theme });
      if (result?.error) throw new Error(`${kind} open rejected: ${result.error}`);
      const panel = await waitPanel(kind);
      if (kind !== 'splitpreview') await panel.waitForFunction(() => document.documentElement.dataset.panelRuntime === 'v1', null, { timeout: 10000 });
      await panel.waitForFunction(id => document.documentElement.dataset.theme === id, theme, { timeout: 5000 }).catch(() => {});
      const report = await audit(panel, `panel/${kind}`, theme);
      if (!['annotate', 'splitpreview'].includes(kind)) frames.panels[theme].push({ name: kind, buffer: await panel.screenshot({ omitBackground: false }) });
      process.stdout.write(`[w87g] ${theme} panel ${kind}: ${report.issues.length}/${report.audited}\n`);
      const closed = panel.waitForEvent('close', { timeout: 5000 }).then(() => true).catch(() => false);
      await main.evaluate(({ kind, theme }) => window.mazz.invoke('panel:close', { kind, instanceId: `w87g-${theme}-${kind}` }), { kind, theme });
      if (!await closed) throw new Error(`${kind} panel did not close`);
    }
  }

  for (const theme of THEMES) {
    await setTheme(main, theme);
    await app.evaluate(async ({ BrowserWindow }, options) => {
      const win = new BrowserWindow({
        width: 420, height: 260, show: false, frame: false, backgroundColor: options.background,
        webPreferences: { preload: options.preload, contextIsolation: true, sandbox: false, nodeIntegration: false },
      });
      globalThis.__w87gQuickNote = win;
      await win.loadURL('mazz-res://app/quicknote.html');
      win.show();
      win.webContents.send('mazz:event', { channel: 'theme:changed', payload: { id: options.theme } });
    }, { theme, background: theme === 'paper' ? '#f7f6f3' : '#16181d', preload: path.join(ROOT, 'preload', 'quicknote-preload.js') });
    const quick = app.windows().find(candidate => candidate.url().includes('/quicknote.html'));
    if (!quick) throw new Error('quicknote did not open');
    await quick.waitForLoadState('domcontentloaded');
    await quick.waitForFunction(id => document.documentElement.dataset.theme === id, theme, { timeout: 5000 });
    const report = await audit(quick, 'quicknote', theme);
    frames.quicknote[theme].push({ name: 'quicknote', buffer: await quick.screenshot() });
    process.stdout.write(`[w87g] ${theme} quicknote: ${report.issues.length}/${report.audited}\n`);
    await app.evaluate(() => { globalThis.__w87gQuickNote?.destroy(); globalThis.__w87gQuickNote = null; });
    await main.waitForTimeout(80);
  }

  for (const theme of THEMES) {
    contactSheet(frames.modules[theme], path.join(EVIDENCE, `W87G_UI_MODULE_MATRIX_${MODE}_${theme.toUpperCase()}.png`));
    contactSheet(frames.panels[theme], path.join(EVIDENCE, `W87G_UI_PANEL_MATRIX_${MODE}_${theme.toUpperCase()}.png`));
    contactSheet(frames.quicknote[theme], path.join(EVIDENCE, `W87G_UI_QUICKNOTE_${MODE}_${theme.toUpperCase()}.png`), 1);
  }
  const report = {
    generatedAt: new Date().toISOString(), protocol: 'mazz.w87g-theme-legibility/v1', runtimeMode: MODE.toLowerCase(),
    themes: THEMES, modules: MODULES.map(item => item[0]), panels: PANEL_KINDS, quicknote: true,
    auditedScopes: THEMES.length * (MODULES.length + PANEL_KINDS.length + 1), failures,
    rendererErrors, verdict: failures.length || rendererErrors.length ? 'FAIL' : 'PASS', ok: failures.length === 0 && rendererErrors.length === 0,
  };
  fs.writeFileSync(path.join(EVIDENCE, `W87G_THEME_LEGIBILITY_${MODE}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, verdict: report.verdict, auditedScopes: report.auditedScopes, failures: failures.length, rendererErrors: rendererErrors.length }));
  if (!report.ok) throw new Error(`W87g legibility gate failed: contrast=${failures.length}, renderer=${rendererErrors.length}`);
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  fs.rmSync(WS, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
