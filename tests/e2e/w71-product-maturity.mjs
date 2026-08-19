// W71 C1: packaged product-entry maturity gate (formal / preview / hidden)
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidenceDir = path.resolve(process.env.MAZZ_W71_EVIDENCE_DIR
  || path.join(root, 'docs', 'engineering', 'evidence'));
const evidencePath = path.join(evidenceDir, 'W71_PRODUCT_MATURITY.json');
const evidenceSuffix = String(process.env.MAZZ_W71_EVIDENCE_SUFFIX || '').replace(/[^A-Za-z0-9_-]/g, '');
const dockScreenshotName = `W71_PRODUCT_MATURITY_DOCK${evidenceSuffix}.png`;
const helpScreenshotName = `W71_PRODUCT_MATURITY_HELP${evidenceSuffix}.png`;
const evidenceReference = name => path.relative(
  path.join(root, 'docs', 'engineering'),
  path.join(evidenceDir, name),
).replace(/\\/g, '/');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

fs.mkdirSync(evidenceDir, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-maturity-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-maturity-ws-'));
const unsupportedMediaPath = path.join(workspace, 'sealed-runtime.mkv');
fs.writeFileSync(unsupportedMediaPath, 'not-a-media-container', 'utf8');
let app;

async function waitPanel(fragment, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const page = app.windows().find(candidate => candidate.url().includes(fragment));
    if (page) {
      await page.waitForLoadState('domcontentloaded');
      return page;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`未打开原生面板：${fragment}`);
}

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
  const pageErrors = [];
  main.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
  await main.waitForLoadState('domcontentloaded');
  await main.waitForFunction(() => !!window.MazzShell?.sideDock?.toolsEl && !!window.MazzCommands, null, { timeout: 30000 });
  await main.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
  });

  const commandState = await main.evaluate(() => {
    const ids = ['update.check', 'ocr.image', 'rec.screen', 'plugin.manage', 'plugin.reload', 'archive.openPanel'];
    return Object.fromEntries(ids.map(id => {
      const item = window.MazzCommands.get(id);
      return [id, item ? { title: item.title, maturity: item.maturity } : null];
    }));
  });
  if (commandState['update.check'] !== null) throw new Error('Updater Hidden 入口仍被注册');
  for (const id of ['ocr.image', 'rec.screen', 'plugin.manage', 'plugin.reload', 'archive.openPanel']) {
    const item = commandState[id];
    if (item?.maturity !== 'preview' || !item.title.includes('（预览）')) {
      throw new Error(`Preview 命令未显式标识：${id} ${JSON.stringify(item)}`);
    }
  }

  const dock = await main.evaluate(() => {
    window.MazzShell.sideDock.show();
    window.MazzShell.sideDock.showTab('tools');
    const text = window.MazzShell.sideDock.toolsEl.textContent || '';
    return { text, hasUpdateCommand: !!window.MazzShell.sideDock.toolsEl.querySelector('[data-cmd="update.check"]') };
  });
  if (dock.hasUpdateCommand || dock.text.includes('检查更新')) throw new Error('Updater 仍暴露在工具坞');
  for (const label of ['压缩包', '图片文字识别（预览）', '全局内录（预览）']) {
    if (!dock.text.includes(label)) throw new Error(`工具坞缺少诚实的 Preview 标识：${label}`);
  }
  await main.screenshot({ path: path.join(evidenceDir, dockScreenshotName) });

  await main.evaluate(() => window.MazzCommands.execute('help.open'));
  const help = await waitPanel('/panels/help.html');
  await help.waitForFunction(() => document.querySelectorAll('.toc-item').length > 0, null, { timeout: 15000 });
  const helpState = await help.evaluate(() => ({
    ids: [...document.querySelectorAll('.toc-item')].map(item => item.dataset.id),
    text: document.querySelector('#toc')?.textContent || '',
  }));
  if (helpState.ids.includes('mobile')) throw new Error('Hidden 移动壳仍暴露在 Electron 原生帮助窗');
  await help.screenshot({ path: path.join(evidenceDir, helpScreenshotName) });
  await help.close();

  const panelTitles = {};
  let recorderFormats = [];
  for (const [command, fragment] of [
    ['plugin.manage', '/panels/plugins.html'],
    ['archive.openPanel', '/panels/archive.html'],
    ['rec.screen', '/panels/recorder.html'],
  ]) {
    await main.evaluate(id => window.MazzCommands.execute(id), command);
    const panel = await waitPanel(fragment);
    panelTitles[command] = await panel.title();
    if (!panelTitles[command].includes('（预览）')) {
      throw new Error(`原生面板标题未标识 Preview：${command} ${panelTitles[command]}`);
    }
    if (command === 'rec.screen') {
      recorderFormats = await panel.locator('#rec-fmt option').evaluateAll(items => items.map(item => item.value));
      if (JSON.stringify(recorderFormats) !== JSON.stringify(['webm'])) {
        throw new Error(`封板 Recorder 仍暴露依赖 GPL core 的输出：${JSON.stringify(recorderFormats)}`);
      }
    }
    await panel.close();
  }

  await main.evaluate(file => window.MazzShell.openFile(file), unsupportedMediaPath);
  await main.waitForSelector('.viewer-fallback', { timeout: 30000 });
  const mediaFallback = await main.evaluate(() => ({
    hasTranscode: !!document.querySelector('.viewer-fallback .vf-tc'),
    hasExternalOpen: !!document.querySelector('.viewer-fallback .vf-open'),
    text: document.querySelector('.viewer-fallback')?.textContent || '',
  }));
  if (mediaFallback.hasTranscode || !mediaFallback.hasExternalOpen) {
    throw new Error(`封板 Viewer 降级入口不诚实：${JSON.stringify(mediaFallback)}`);
  }
  await main.evaluate(async () => {
    const tab = window.MazzShell.tabs.active;
    tab.forceClose = true;
    await window.MazzShell.closeTabFlow(tab.id);
    window.MazzShell.openTab('viewer', { title: '播放器' });
  });
  await main.waitForSelector('.mz-player', { timeout: 15000 });
  const playerGifHidden = await main.evaluate(() => !document.querySelector('.mz-player [data-a="gif"]'));
  if (!playerGifHidden) throw new Error('封板 Player 仍暴露依赖 GPL core 的 GIF 入口');

  await main.evaluate(() => window.mazz.invoke('panel:open', { kind: 'sync' }));
  const sync = await waitPanel('/panels/sync.html');
  const syncState = await sync.evaluate(() => ({
    title: document.title,
    hasUpdateTab: !!document.querySelector('[data-t="update"]'),
    visibleText: `${document.querySelector('.head')?.textContent || ''}\n${document.querySelector('main')?.textContent || ''}`,
  }));
  if (syncState.hasUpdateTab || syncState.visibleText.includes('检查更新')) throw new Error('Updater 仍暴露在同步面板');
  await sync.close();

  const sites = await main.evaluate(() => window.mazz.invoke('sites:list'));
  const dmhy = sites.find(site => site.id === 'dmhy');
  if (!dmhy || dmhy.name.includes('（预览）')) throw new Error(`W65 已过门禁但数据源仍停留 Preview：${JSON.stringify(dmhy)}`);
  if (pageErrors.length) throw new Error(`渲染错误：${pageErrors.join('\n')}`);

  const evidence = {
    gate: 'W71 C1 packaged product-entry maturity',
    executablePath: executablePath.replace(/\\/g, '/'),
    commandState,
    dock: {
      updaterHidden: !dock.hasUpdateCommand && !dock.text.includes('检查更新'),
      previewLabelsVisible: true,
      screenshot: evidenceReference(dockScreenshotName),
    },
    help: {
      nativeMobileHidden: !helpState.ids.includes('mobile'),
      sectionCount: helpState.ids.length,
      screenshot: evidenceReference(helpScreenshotName),
    },
    panelTitles,
    optionalFfmpegRuntime: {
      recorderFormats,
      viewerTranscodeHidden: !mediaFallback.hasTranscode,
      viewerExternalOpenAvailable: mediaFallback.hasExternalOpen,
      playerGifHidden,
    },
    sync: { updaterHidden: !syncState.hasUpdateTab && !syncState.visibleText.includes('检查更新') },
    dmhy,
    noRendererErrors: true,
    ok: true,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
