// tests/e2e/scenes75.mjs —— W61a 生成流、目录换档、双实例阶梯实证
export async function scenes75({ app, win, human, scenario, shotDir }) {
  let first = null;

  await scenario('生成即开预览·流式 Markdown 只读可见', async () => {
    await human.evaluate(async () => {
      await window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'mock://w61a', model: 'w61a-local' } });
      await window.mazz.invoke('secret:set', { key: 'factory.apiKey', value: 'local-test-key' });
      window.MazzShell.sideDock.show();
      window.MazzShell.sideDock.showTab('factory');
      const fp = window.MazzShell.sideDock.factoryPanel;
      await fp.reload();
      const tpl = fp.genres.find(g => /小说/.test(g.name)) || fp.genres[0];
      fp.genre = tpl;
      fp.values = { 书名: 'W61a北向一号', 作品类型: '科幻', premise: '一名观测员追踪失落的北向洋流信号。', protagonist: '林澈，海洋观测员', 每章字数: '2000' };
      fp.dumpEl.value = 'W61a 只读预览实证';
      fp.setAutoPreview(true);
      const make = (id, label) => {
        const t = fp.makeTask(false, 1);
        t.id = id; t.label = label; t.values = { ...t.values, 书名: label, 作品类型: '科幻' }; t.autoPreview = true;
        return t;
      };
      fp.tasks = [make('w61a-task-one', 'W61a北向一号'), make('w61a-task-two', 'W61a北向二号')];
      fp.persistTasks();
      void fp.runAllTasks();
    });
    for (let i = 0; i < 80 && !first; i++) {
      first = app.windows().find(w => /fpreview\.html/.test(w.url()));
      if (!first) await win.waitForTimeout(100);
    }
    await human.assert(!!first, '生成任务必须自动打开 fpreview 原生窗');
    await first.waitForSelector('body[data-task-id="w61a-task-one"]', { timeout: 8000 });
    await first.waitForFunction(() => document.querySelector('#status')?.textContent.includes('生成中'), null, { timeout: 8000 });
    const live = await first.evaluate(() => ({ status: document.querySelector('#status')?.textContent, text: document.querySelector('#doc')?.textContent, inputs: document.querySelectorAll('input,textarea').length }));
    await human.assert(live.inputs === 0, '预览窗必须严格零 input/textarea');
    await human.assert(live.status.includes('生成中') && live.text.length > 20, '流式正文与生成中状态必须同时可见');
    await first.screenshot({ path: shotDir + '/w61a-preview-streaming.png' });
  });

  await scenario('双任务双窗共存·右列坐标逐窗 44px', async () => {
    let previews = [];
    for (let i = 0; i < 160; i++) {
      previews = app.windows().filter(w => /fpreview\.html/.test(w.url()));
      const done = previews.length === 2 && await Promise.all(previews.map(w => w.evaluate(() => document.querySelector('#status')?.textContent.includes('全部完成')).catch(() => false)));
      if (previews.length === 2 && done.every(Boolean)) break;
      await win.waitForTimeout(150);
    }
    await human.assert(previews.length === 2, '两个 taskId 必须保有两个预览窗');
    const ids = await Promise.all(previews.map(w => w.evaluate(() => document.body.dataset.taskId)));
    await human.assert(new Set(ids).size === 2 && ids.includes('w61a-task-one') && ids.includes('w61a-task-two'), '两个窗口必须各守各的 taskId');
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .filter(w => w.webContents.getURL().includes('/panels/fpreview.html'))
      .map(w => ({ id: w.__panelInstanceId, b: w.getBounds() })).sort((a, b) => a.b.y - b.b.y));
    await human.assert(bounds.length === 2 && bounds[0].b.x === bounds[1].b.x && bounds[1].b.y - bounds[0].b.y === 44, '右对齐阶梯坐标必须为 y + 44px');
  });

  await scenario('完成目录含蓝图/正文/快照·点击换档渲染', async () => {
    const previews = app.windows().filter(w => /fpreview\.html/.test(w.url()));
    first = previews[0];
    for (const w of previews) { if ((await w.evaluate(() => document.body.dataset.taskId)) === 'w61a-task-one') { first = w; break; } }
    const names = await first.locator('#files .file .name').allTextContents();
    await human.assert(names.includes('创作蓝图.md') && names.some(x => /^第001章/.test(x)) && names.some(x => /状态快照/.test(x)), '完成目录必须有蓝图、正文、快照');
    await first.locator('#files .file', { hasText: '创作蓝图.md' }).click();
    await first.waitForFunction(() => document.querySelector('#path')?.textContent === '创作蓝图.md' && document.querySelector('#doc')?.textContent.length > 50, null, { timeout: 5000 });
    const chapter = first.locator('#files .file').filter({ hasText: '第001章' }).first();
    await chapter.click();
    await first.waitForFunction(() => /^第001章/.test(document.querySelector('#path')?.textContent || '') && /本节记录实验报告/.test(document.querySelector('#doc')?.textContent || ''), null, { timeout: 5000 });
    await first.screenshot({ path: shotDir + '/w61a-preview-completed-directory.png' });
  });
}
