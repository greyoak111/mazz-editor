// tests/e2e/scenes76.mjs —— W61b 默认串行、双路并发、编辑回写与左右阶梯实证
export async function scenes76({ app, win, human, scenario, shotDir, fs }) {
  const setupTasks = async (prefix, concurrency) => human.evaluate(async ({ prefix, concurrency }) => {
    await window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'mock://w61b', model: 'w61b-local' } });
    await window.mazz.invoke('secret:set', { key: 'factory.apiKey', value: 'local-test-key' });
    window.MazzShell.sideDock.show();
    window.MazzShell.sideDock.showTab('factory');
    const fp = window.MazzShell.sideDock.factoryPanel;
    await fp.reload();
    const tpl = fp.genres.find(g => /小说/.test(g.name)) || fp.genres[0];
    fp.genre = tpl;
    fp.values = { 书名: `${prefix}一号`, 作品类型: '科幻', premise: '并行调度与人工修订实证。', protagonist: '林澈，海洋观测员' };
    fp.dumpEl.value = 'W61b 编辑回写与调度实证';
    fp.setAutoPreview(true);
    const initialConcurrency = fp.concurrency;
    fp.setConcurrency(concurrency);
    const make = (suffix, label) => {
      const task = fp.makeTask(false, 0);
      task.id = `${prefix}-${suffix}`; task.label = label;
      task.values = { ...task.values, 书名: label, 作品类型: '科幻' }; task.autoPreview = true;
      return task;
    };
    fp.tasks = [make('one', `${prefix}一号`), make('two', `${prefix}二号`)];
    fp.persistTasks();
    window.__w61bPrefix = prefix;
    window.__w61bObserved = [];
    clearInterval(window.__w61bWatch);
    window.__w61bWatch = setInterval(() => window.__w61bObserved.push(fp.runningTasks.size), 20);
    void fp.runAllTasks();
    return { initialConcurrency, concurrency: fp.concurrency };
  }, { prefix, concurrency });

  const waitDone = async prefix => human.until(() => {
    const fp = window.MazzShell?.sideDock?.factoryPanel;
    return fp?.tasks?.length === 2 && fp.tasks.every(t => t.id.startsWith(window.__w61bPrefix) && (t.status === 'done' || t.status === 'done-warn'));
  }, { timeout: 30000, interval: 80, msg: `${prefix} 两任务完成` });

  await scenario('默认并发 1·两任务严格串行', async () => {
    const configured = await setupTasks('w61b-serial', 1);
    await human.assert(configured.initialConcurrency === 1 && configured.concurrency === 1, '调度器默认值必须为 1');
    await waitDone('w61b-serial');
    const max = await human.evaluate(() => { clearInterval(window.__w61bWatch); return Math.max(...window.__w61bObserved); });
    await human.assert(max === 1, '并发=1 时运行集合峰值必须恰为 1');
  });

  await scenario('并发 2·两任务真并行且各守独立预览', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().includes('/panels/fpreview.html')).forEach(w => w.close()));
    for (let i = 0; i < 100 && app.windows().some(w => /fpreview\.html/.test(w.url())); i++) await win.waitForTimeout(30);
    await setupTasks('w61b-parallel', 2);
    await human.until(() => window.MazzShell.sideDock.factoryPanel.runningTasks.size === 2, { timeout: 8000, interval: 20, msg: '双路同时在跑' });
    let previews = [];
    for (let i = 0; i < 100; i++) {
      previews = app.windows().filter(w => /fpreview\.html/.test(w.url()));
      if (previews.length === 2) {
        const readyIds = await Promise.all(previews.map(w => w.evaluate(() => document.body.dataset.taskId).catch(() => '')));
        if (readyIds.every(id => id?.startsWith('w61b-parallel'))) break;
      }
      await win.waitForTimeout(50);
    }
    const ids = await Promise.all(previews.map(w => w.evaluate(() => document.body.dataset.taskId)));
    await human.assert(previews.length === 2 && new Set(ids).size === 2, '并发双任务必须各有独立 fpreview');
    await waitDone('w61b-parallel');
    const max = await human.evaluate(() => { clearInterval(window.__w61bWatch); return Math.max(...window.__w61bObserved); });
    await human.assert(max === 2, '并发=2 时运行集合峰值必须恰为 2');
  });

  await scenario('去编辑·Ctrl+S 回写文件并同步原预览', async () => {
    const previews = app.windows().filter(w => /fpreview\.html/.test(w.url()));
    const first = previews[0];
    await first.waitForFunction(() => !document.querySelector('#edit')?.disabled, null, { timeout: 8000 });
    const mdPath = await first.evaluate(() => document.querySelector('#path')?.textContent && document.querySelector('.file.on')?.dataset.path);
    await first.click('#edit');
    let editor = null;
    for (let i = 0; i < 100 && !editor; i++) {
      editor = app.windows().find(w => /fedit\.html/.test(w.url()));
      if (!editor) await win.waitForTimeout(50);
    }
    await editor.waitForSelector('body[data-task-id]', { timeout: 5000 });
    await editor.locator('#editor').fill((await editor.locator('#editor').inputValue()) + '\n\n人工修订：北向洋流观测值已复核。');
    await editor.keyboard.press('Control+S');
    await editor.waitForFunction(() => document.querySelector('#status')?.textContent.includes('预览已同步'), null, { timeout: 8000 });
    await first.waitForFunction(() => document.querySelector('#status')?.textContent.includes('预览已同步') && document.querySelector('#doc')?.textContent.includes('北向洋流观测值已复核'), null, { timeout: 8000 });
    const savedPath = await editor.evaluate(() => document.body.dataset.path);
    await human.assert(fs.readFileSync(savedPath, 'utf8').includes('北向洋流观测值已复核'), 'Ctrl+S 必须写回磁盘实际目标');
    if (savedPath !== mdPath) await human.assert(/补遗-\d{14}\.md$/i.test(savedPath), 'W68 封存正文只能另立带时间戳补遗');
    const revision = await human.evaluate(() => {
      const fp = window.MazzShell.sideDock.factoryPanel;
      const index = fp.tasks.findIndex(t => t.manualRevision?.count);
      const revised = fp.tasks[index];
      return { count: revised?.manualRevision?.count || 0, title: fp.tasksSnapshot()[index]?.title || '' };
    });
    await human.assert(revision.count === 1 && revision.title.includes('✎人工修订×1'), '任务必须显示一次人工修订标');
    await editor.screenshot({ path: shotDir + '/w61b-fedit-saved.png' });
    await first.screenshot({ path: shotDir + '/w61b-preview-synced.png' });
  });

  await scenario('双编辑窗左列 44px 阶梯·一键收拢', async () => {
    const previews = app.windows().filter(w => /fpreview\.html/.test(w.url()));
    for (const p of previews) {
      await p.waitForFunction(() => !document.querySelector('#edit')?.disabled, null, { timeout: 5000 });
      await p.click('#edit');
    }
    let edits = [];
    for (let i = 0; i < 100; i++) {
      edits = app.windows().filter(w => /fedit\.html/.test(w.url()));
      if (edits.length === 2) break;
      await win.waitForTimeout(50);
    }
    await edits[0].click('#arrange');
    await win.waitForTimeout(250);
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .filter(w => w.webContents.getURL().includes('/panels/fedit.html'))
      .map(w => ({ id: w.__panelInstanceId, b: w.getBounds() })).sort((a, b) => a.b.y - b.b.y));
    await human.assert(bounds.length === 2 && bounds[0].b.x === bounds[1].b.x && bounds[1].b.y - bounds[0].b.y === 44, 'fedit 收拢后必须左列 y + 44px');
    await edits[0].screenshot({ path: shotDir + '/w61b-editor-left-column.png' });
    await previews[0].screenshot({ path: shotDir + '/w61b-preview-right-column.png' });
  });
}
