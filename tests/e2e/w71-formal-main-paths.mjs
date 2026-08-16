// W71 C2: packaged formal main-path gate for Library / Notes / Viewer ownership
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidenceDir = path.join(root, 'docs', 'engineering', 'evidence');
const evidencePath = path.join(evidenceDir, 'W71_FORMAL_MAIN_PATHS.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

fs.mkdirSync(evidenceDir, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-formal-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-formal-ws-'));
const bookPath = path.join(workspace, '书库', '封板样书.txt');
const notePath = path.join(workspace, '封板笔记.md');
fs.mkdirSync(path.dirname(bookPath), { recursive: true });
fs.writeFileSync(bookPath, 'W71 packaged library fixture\n第二段。\n', 'utf8');
fs.writeFileSync(notePath, '# 封板笔记\n\n初始内容。\n', 'utf8');
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
  const pageErrors = [];
  main.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
  await main.waitForLoadState('domcontentloaded');
  await main.waitForFunction(() => !!window.MazzShell?.tabs && !!window.MazzModules, null, { timeout: 30000 });
  await main.evaluate(async ({ bookPath }) => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('settings:set', {
      key: 'library.books',
      value: [{ id: 'w71-packaged-book', title: '封板样书', author: '', cover: '', path: bookPath, format: 'txt', addedAt: 1 }],
    });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
  }, { bookPath });

  await main.evaluate(() => window.MazzCommands.execute('file.newLibrary'));
  await main.waitForFunction(() => !!window.__activeLibraryCtl && document.querySelector('.tab.on .t-icon'));
  const libraryCreate = await main.evaluate(() => {
    const tab = window.MazzShell.tabs.active;
    const icon = document.querySelector('.tab.on .t-icon');
    return { title: tab.title, iconId: tab.iconId, domIconId: icon?.dataset.iconId, svg: icon?.innerHTML || '' };
  });
  if (libraryCreate.iconId !== 'module.library' || libraryCreate.domIconId !== 'module.library' || !libraryCreate.svg.startsWith('<svg')) {
    throw new Error(`书库创建路径未走稳定 iconId：${JSON.stringify(libraryCreate)}`);
  }

  await main.evaluate(() => window.__activeLibraryCtl.openBook('w71-packaged-book'));
  await main.waitForFunction(() => window.__activeLibraryCtl?.book?.meta?.id === 'w71-packaged-book');
  const libraryBook = await main.evaluate(() => {
    const tab = window.MazzShell.tabs.active;
    const icon = document.querySelector('.tab.on .t-icon');
    return { title: tab.title, iconId: tab.iconId, domIconId: icon?.dataset.iconId, svg: icon?.innerHTML || '' };
  });
  if (libraryBook.title !== '封板样书' || libraryBook.iconId !== libraryCreate.iconId || libraryBook.svg !== libraryCreate.svg) {
    throw new Error(`书库开书路径图标漂移：${JSON.stringify(libraryBook)}`);
  }
  const themeStates = {};
  for (const theme of ['paper', 'ink']) {
    await main.evaluate(theme => window.MazzShell.setTheme(theme), theme);
    await main.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    themeStates[theme] = await main.evaluate(() => {
      const body = getComputedStyle(document.body);
      const reader = getComputedStyle(document.querySelector('.lib-reader'));
      return { background: body.backgroundColor, foreground: body.color, readerBackground: reader.backgroundColor };
    });
  }
  if (themeStates.paper.background === themeStates.ink.background) throw new Error('Paper/Ink 主题未形成可见差异');
  await main.evaluate(() => window.MazzShell.setTheme('paper'));
  await main.locator('[data-a="back"]').focus();
  const interactionStates = await main.evaluate(() => {
    const button = document.querySelector('[data-a="back"]');
    const focused = getComputedStyle(button);
    const focus = { style: focused.outlineStyle, width: focused.outlineWidth, color: focused.outlineColor };
    button.disabled = true;
    const disabled = getComputedStyle(button);
    const disabledState = { opacity: disabled.opacity, cursor: disabled.cursor };
    button.disabled = false;
    return { focus, disabled: disabledState };
  });
  if (interactionStates.focus.style === 'none' || parseFloat(interactionStates.focus.width) < 1.5) {
    throw new Error(`键盘焦点不可见：${JSON.stringify(interactionStates.focus)}`);
  }
  if (parseFloat(interactionStates.disabled.opacity) >= 0.8) throw new Error(`禁用态区分不足：${JSON.stringify(interactionStates.disabled)}`);
  await main.screenshot({ path: path.join(evidenceDir, 'W71_FORMAL_LIBRARY_BOOK.png') });

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed() && candidate.isVisible());
    win?.setSize(1024, 720);
  });
  await main.waitForFunction(() => innerWidth <= 1024);
  const narrowState = await main.evaluate(async () => {
    const bar = document.querySelector('.lib-reader-bar');
    const back = bar.querySelector('[data-a="back"]');
    const last = bar.querySelector('[data-a="clean-rules"]');
    const barRect = bar.getBoundingClientRect();
    const backRect = back.getBoundingClientRect();
    const backVisible = backRect.left >= barRect.left && backRect.right <= barRect.right;
    bar.scrollLeft = bar.scrollWidth;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const lastRect = last.getBoundingClientRect();
    return {
      innerWidth,
      overflowX: getComputedStyle(bar).overflowX,
      scrollWidth: bar.scrollWidth,
      clientWidth: bar.clientWidth,
      scrollLeft: bar.scrollLeft,
      backVisible,
      lastVisibleAfterScroll: lastRect.left >= barRect.left - 1 && lastRect.right <= barRect.right + 1,
    };
  });
  if (narrowState.overflowX !== 'auto' || !narrowState.backVisible || !narrowState.lastVisibleAfterScroll) {
    throw new Error(`窄窗书库控件不可达：${JSON.stringify(narrowState)}`);
  }
  await main.evaluate(() => window.MazzShell.setTheme('ink'));
  await main.screenshot({ path: path.join(evidenceDir, 'W71_FORMAL_LIBRARY_NARROW_INK.png') });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed() && candidate.isVisible());
    win?.setSize(1800, 1024);
  });

  await main.locator('[data-a="back"]').click();
  const libraryBack = await main.evaluate(() => {
    const tab = window.MazzShell.tabs.active;
    return { title: tab.title, iconId: tab.iconId, domIconId: document.querySelector('.tab.on .t-icon')?.dataset.iconId };
  });
  if (libraryBack.title !== '书库' || libraryBack.title.includes('📚') || libraryBack.iconId !== 'module.library') {
    throw new Error(`书库返回路径写入了图标标题或 iconId 漂移：${JSON.stringify(libraryBack)}`);
  }
  await main.evaluate(() => window.MazzShell.closeTabFlow(window.MazzShell.tabs.activeId));

  await main.waitForFunction(() => window.MazzModules.get('library')._forTests.instances.size === 0);

  const restored = await main.evaluate(async () => {
    const ok = await window.MazzShell.receiveHandoff({
      schemaVersion: 1,
      moduleId: 'library',
      iconId: 'module.library',
      title: '封板样书（已恢复）',
      filePath: null,
      content: JSON.stringify({ mark: 'mazz-library-v2', bookId: 'w71-packaged-book' }),
      dirty: false,
      pinned: false,
      progress: null,
    });
    const tab = window.MazzShell.tabs.active;
    return { ok, title: tab?.title, iconId: tab?.iconId, bookId: window.__activeLibraryCtl?.book?.meta?.id || null };
  });
  if (!restored.ok || restored.iconId !== 'module.library' || restored.bookId !== 'w71-packaged-book') {
    throw new Error(`书库恢复路径失败：${JSON.stringify(restored)}`);
  }
  await main.evaluate(() => window.MazzShell.closeTabFlow(window.MazzShell.tabs.activeId));

  await main.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'library.books', value: [] });
    window.MazzCommands.execute('file.newLibrary');
  });
  await main.waitForFunction(() => !!document.querySelector('.lib-empty'));
  const emptyState = await main.locator('.lib-empty').textContent();
  if (!emptyState.includes('导入书籍')) throw new Error(`书库空态缺少恢复动作：${emptyState}`);
  await main.evaluate(() => window.MazzShell.closeTabFlow(window.MazzShell.tabs.activeId));
  await main.waitForFunction(() => window.MazzModules.get('library')._forTests.instances.size === 0);

  await main.evaluate(() => window.MazzCommands.execute('file.newNotes'));
  await main.waitForFunction(() => {
    const def = window.MazzModules.get('notes');
    const ctl = [...def._forTests.instances.values()][0];
    return !!ctl;
  }, null, { timeout: 30000 });
  await main.evaluate(notePath => {
    const ctl = [...window.MazzModules.get('notes')._forTests.instances.values()][0];
    return ctl.openNote(notePath);
  }, notePath);
  await main.waitForFunction(notePath => {
    const ctl = [...window.MazzModules.get('notes')._forTests.instances.values()][0];
    return ctl?.currentPath === notePath;
  }, notePath, { timeout: 30000 });
  await main.evaluate(() => {
    const ctl = [...window.MazzModules.get('notes')._forTests.instances.values()][0];
    ctl.edState.setMarkdown('# 封板笔记\n\n自动保存已落盘。\n');
  });
  await main.waitForFunction(() => {
    const ctl = [...window.MazzModules.get('notes')._forTests.instances.values()][0];
    return ctl?.lastContent.includes('自动保存已落盘');
  }, null, { timeout: 10000 });
  await main.evaluate(() => window.MazzShell.closeTabFlow(window.MazzShell.tabs.activeId));
  await main.waitForFunction(() => window.MazzModules.get('notes')._forTests.instances.size === 0);
  const savedNote = fs.readFileSync(notePath, 'utf8');
  if (!savedNote.includes('自动保存已落盘')) throw new Error(`关闭屏障未等待笔记落盘：${savedNote}`);

  await main.evaluate(missingPath => window.MazzShell.openTab('viewer', {
    title: '不支持的样本.xyz', filePath: missingPath, content: { path: missingPath },
  }), path.join(workspace, '不支持的样本.xyz'));
  await main.waitForFunction(() => !!window.__activeViewerCtl && !!document.querySelector('.viewer-fallback'));
  const viewerFallback = await main.locator('.vf-reason').textContent();
  if (!viewerFallback.includes('暂不支持')) throw new Error(`Viewer 不支持态不诚实：${viewerFallback}`);
  await main.evaluate(() => window.MazzShell.closeTabFlow(window.MazzShell.tabs.activeId));
  await main.waitForFunction(() => window.MazzModules.get('viewer')._forTests.instances.size === 0);

  if (pageErrors.length) throw new Error(`渲染错误：${pageErrors.join('\n')}`);
  const evidence = {
    gate: 'W71 C2 packaged formal main paths',
    executablePath: executablePath.replace(/\\/g, '/'),
    library: {
      create: libraryCreate, book: libraryBook, back: libraryBack, restored,
      themes: themeStates, interactions: interactionStates, narrow: narrowState,
      emptyState, ownerCountAfterClose: 0,
    },
    notes: { path: notePath.replace(/\\/g, '/'), autoSavePersisted: true, ownerCountAfterClose: 0 },
    viewer: { unsupportedState: viewerFallback, ownerCountAfterClose: 0 },
    noRendererErrors: true,
    screenshot: 'evidence/W71_FORMAL_LIBRARY_BOOK.png',
    narrowScreenshot: 'evidence/W71_FORMAL_LIBRARY_NARROW_INK.png',
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
