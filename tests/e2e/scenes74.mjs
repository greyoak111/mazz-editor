// tests/e2e/scenes74.mjs —— W60b 真实窗口/落盘/读取链
export async function scenes74({ app, win, human, WS, scenario, shotDir }) {
  const wait = ms => win.waitForTimeout(ms);

  await scenario('日常车间无常驻表单·独立立项向导四卡联动', async () => {
    await human.evaluate(async () => {
      await window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'mock://w60b', model: 'w60b-local' } });
      await window.mazz.invoke('secret:set', { key: 'factory.apiKey', value: 'local-test-key' });
      window.MazzShell?.sideDock?.show();
      window.MazzShell?.sideDock?.showTab('factory');
    });
    await human.until(() => {
      const el = document.querySelector('.fc-projectbar');
      const r = el?.getBoundingClientRect();
      return !!r && r.width > 0 && r.height > 0;
    }, { timeout: 8000, msg: '车间执行台出现' });
    const shape = await human.evaluate(() => {
      const visible = el => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
      return { bar: visible(document.querySelector('.fc-projectbar')), form: visible(document.querySelector('.fc-form')) };
    });
    await human.assert(shape.bar && !shape.form, '日常车间只显示执行台，立项表单不得常驻');
    await human.click('[data-a=project]');
    let project = null;
    for (let i = 0; i < 40 && !project; i++) {
      project = app.windows().find(p => /factorycfg\.html/.test(p.url()));
      if (!project) await wait(100);
    }
    await human.assert(!!project, '必须打开原生独立立项窗口');
    await project.waitForSelector('#m', { timeout: 8000 });
    await project.screenshot({ path: shotDir + '/w60b-project-window-debug.png' });
    await project.waitForSelector('#pj-genre', { timeout: 8000 });
    await project.evaluate(() => {
      const sel = document.querySelector('#pj-genre');
      const opt = [...sel.options].find(o => /小说/.test(o.textContent));
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await project.waitForTimeout(500);
    await project.waitForSelector('[data-preset=short]');
    const cardCount = await project.locator('.length-card').count();
    await human.assert(cardCount === 4, '立项向导必须有短/中/长/无限四卡');
    await project.fill('#pj-total', '2000');
    await project.dispatchEvent('#pj-total', 'change');
    await project.waitForTimeout(300);
    await project.click('[data-words="2000"]');
    await project.waitForTimeout(300);
    const linked = await project.inputValue('.smart-row label:last-child input');
    await human.assert(linked === '1', '总字数÷每章字数必须联动为 1 章');
    await project.fill('#pj-batch', 'W60b实证书\nW60b批量二\nW60b批量三');
    const put = async (id, value) => {
      const sel = `[data-p-field="${id}"]`;
      await project.fill(sel, value);
      await project.dispatchEvent(sel, 'input');
    };
    await put('premise', '一名归航员必须找回失落的航海日志。');
    await put('书名', 'W60b实证书');
    await put('作品类型', '科幻');
    await put('protagonist', '林澈，归航员，畏惧再次出发');
    await project.click('details.advanced summary');
    await project.selectOption('#pj-format', 'rst');
    const formats = await project.locator('#pj-format option').allTextContents();
    for (const ext of ['.rst', '.adoc', '.textile', '.opml', '.org', '.mw']) await human.assert(formats.includes(ext), `导出选单包含 ${ext}`);
    await project.screenshot({ path: shotDir + '/w60b-project-wizard.png' });
    await project.click('#pj-add');
    await wait(600);
    const queued = await human.evaluate(() => [...document.querySelectorAll('.fc-task-label')].filter(x => x.textContent.includes('W60b')).length);
    await human.assert(queued === 3, '三行书名必须共享表单并入队三个任务');
  });

  await scenario('Output 四层目录·蓝图章节快照状态·RST 真落盘可读', async () => {
    await human.evaluate(() => {
      const rows = [...document.querySelectorAll('.fc-task')];
      const row = rows.find(x => x.textContent.includes('W60b实证书'));
      const cb = row?.querySelector('input[type=checkbox]');
      if (cb) cb.checked = true;
      document.querySelector('[data-a=startsel]')?.click();
    });
    const root = await human.until(async () => {
      const ws = await window.mazz.invoke('workspace:get');
      const dirs = await window.mazz.invoke('fs:listDir', { path: ws + '/Output/小说/科幻' }).catch(() => []);
      const hit = dirs.find(x => x.isDir && x.name.startsWith('W60b实证书_'));
      if (!hit) return '';
      const statePath = hit.path + '/任务状态.json';
      const stat = await window.mazz.invoke('fs:stat', { path: statePath }).catch(() => ({ exists: false }));
      if (!stat?.exists || stat.isDir) return '';
      const raw = await window.mazz.invoke('fs:readFile', { path: statePath }).catch(() => '');
      try { return JSON.parse(raw).status === 'done' ? hit.path : ''; } catch { return ''; }
    }, { timeout: 20000, msg: 'W60b 项目完成状态' });
    const evidence = await human.evaluate(async root => {
      const files = await window.mazz.invoke('fs:listDir', { path: root });
      const names = files.map(x => x.name);
      const rst = names.find(x => /第0*1章-[^/]+\.rst$/.test(x));
      return { names, rst, text: rst ? await window.mazz.invoke('fs:readFile', { path: root + '/' + rst }) : '' };
    }, root);
    await human.assert(evidence.names.includes('创作蓝图.md'), '创作蓝图已落盘');
    await human.assert(evidence.names.includes('任务状态.json'), '任务状态已按 W60b 新名落盘');
    await human.assert(evidence.names.some(x => /第0*1章-[^/]+\.md$/.test(x)), '带章题的章节 Markdown 已落盘');
    await human.assert(evidence.names.some(x => /状态快照_第0*1章后\.md$/.test(x)), '滚动状态快照已落盘');
    await human.assert(!!evidence.rst && evidence.text.includes('W60b实证书') && evidence.text.length > 100, 'RST 尾巴必须真落盘且正文可读');
    await human.evaluate(path => window.MazzShell.openFile(path), root + '/' + evidence.rst);
    await wait(900);
    const visible = await human.evaluate(() => [...document.querySelectorAll('textarea, .ProseMirror, .editor-area')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map(el => el.value || el.textContent || '').join('\n'));
    await human.assert(visible.includes('W60b实证书'), 'RST 文件必须能被 Mazz 重新打开阅读');
    await win.screenshot({ path: shotDir + '/w60b-output-rst.png' });
  });
}
