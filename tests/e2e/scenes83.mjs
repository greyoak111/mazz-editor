// W62：真实 Electron + 本地 SearXNG 台架 + 人工来源审批 + 落盘索引 + 工厂 M0。
import fs from 'node:fs';
import path from 'node:path';

export async function scenes83({ app, win, human, scenario, shotDir, workspace, origin, metrics }) {
  const topic = 'W62 确定性证据链';

  await scenario('主进程配置本地台架并完成检索实例自检', async () => {
    const result = await human.evaluate(({ origin }) => window.mazz.invoke('searx:setConfig', { url: origin, user: '', pass: '' }), { origin });
    await human.assert(result?.ok === true, 'SearXNG 台架自检应通过');
    metrics.active = 0; metrics.maxActive = 0; metrics.searches = 0; metrics.articles = 0;
  });

  await scenario('检索页执行七步取材、二并发闸与来源清单人批', async () => {
    await human.evaluate(() => window.MazzCommands.execute('file.newSearch'));
    await human.until(() => !!document.querySelector('.gs-root'), { timeout: 8000, msg: '全局搜索模块打开' });
    await human.evaluate(() => { document.querySelector('.gs-research').open = true; });
    await human.type('.gs-research-topic', topic);
    await human.click('[data-a=research-prepare]');
    await human.until(() => document.querySelectorAll('.gs-research-source [data-source-id]').length > 0, { timeout: 20000, msg: '来源清单形成' });
    const state = await human.evaluate(() => ({ count: document.querySelectorAll('.gs-research-source').length, stage: document.querySelector('.gs-research-stage')?.textContent || '', checked: document.querySelectorAll('.gs-research-source input:checked').length }));
    await human.assert(state.count > 0 && state.count === state.checked, `来源应显式列出并默认待核（${state.count}/${state.checked}）`);
    await human.assert(state.stage.includes('人工'), '合成前必须停在人工核准关口');
    await human.assert(metrics.maxActive === 2, `SearXNG 搜索并发峰值应为 2（实际 ${metrics.maxActive}）`);
    await win.screenshot({ path: path.join(shotDir, 'w62-research-source-approval.png') });
  });

  await scenario('核准后报告才落盘，网页指令被隔离且引文审计齐全', async () => {
    await human.click('[data-a=research-finish]');
    await human.until(() => document.querySelector('.gs-research-stage')?.textContent.includes('报告已保存'), { timeout: 20000, msg: '报告写入工作区' });
    const locked = await human.evaluate(() => document.querySelector('[data-a=research-finish]')?.disabled && [...document.querySelectorAll('[data-source-id]')].every(input => input.disabled));
    await human.assert(locked, '本轮落盘后应锁定来源与合成按钮，防止重复写入');
    const dir = path.join(workspace, '检索');
    const names = fs.readdirSync(dir).filter(name => name.endsWith('.md'));
    await human.assert(names.length === 1, `检索目录应形成一份报告（实际 ${names.length}）`);
    const report = fs.readFileSync(path.join(dir, names[0]), 'utf8');
    await human.assert(report.includes('## 来源清单') && report.includes('## 七步管线审计'), '报告应有来源清单和七步审计');
    await human.assert(/\[1\]/.test(report), '报告中的事实必须带编号引文');
    await human.assert(!/ignore previous|delete files/i.test(report), '网页提示注入不得进入报告');
  });

  await scenario('新报告即时登记全文索引并能原地回搜', async () => {
    await human.type('.gs-input', topic);
    await human.until(() => !!document.querySelector('.gs-file'), { timeout: 8000, msg: '新报告进入全文索引' });
    const result = await human.evaluate(() => document.querySelector('.gs-results')?.textContent || '');
    await human.assert(result.includes('检索') || result.includes('W62'), '回搜结果应命中新落盘报告');
    await win.screenshot({ path: path.join(shotDir, 'w62-research-indexed-report.png') });
  });

  await scenario('工厂 M0 复用同一取材链并在远程立项窗完成人批投喂', async () => {
    await human.until(() => !!window.MazzShell?.sideDock?.factoryPanel, { timeout: 10000, msg: '工厂面板就绪' });
    const prepared = await human.evaluate(async ({ topic }) => {
      const fp = window.MazzShell.sideDock.factoryPanel;
      fp.el.querySelector('.fc-search').value = topic + ' 工厂M0';
      await fp.webSearch();
      await fp.openProjectWizard();
      return { sources: fp.researchPrepared?.sources.length || 0, selected: fp.researchSelected.size };
    }, { topic });
    await human.assert(prepared.sources > 0 && prepared.sources === prepared.selected, '工厂 M0 应形成待人工核准来源');
    let panel;
    for (let i = 0; i < 40 && !panel; i++) {
      panel = app.windows().find(window => /panels\/factorycfg\.html/.test(window.url()));
      if (!panel) await win.waitForTimeout(200);
    }
    await human.assert(!!panel, '远程立项原生窗应打开');
    await panel.waitForSelector('[data-pa=researchApprove]', { state: 'attached', timeout: 8000 });
    await panel.waitForTimeout(500);
    await panel.evaluate(() => { const advanced = document.querySelector('.advanced'); if (advanced) advanced.open = true; });
    const before = await panel.evaluate(() => ({ text: document.body.textContent, checked: document.querySelectorAll('[data-pa=researchToggle]:checked').length }));
    await human.assert(before.text.includes('来源清单（人工核准）') && before.checked > 0, '远程窗应显示来源清单与勾选态');
    await panel.evaluate(() => document.querySelector('[data-pa=researchApprove]')?.scrollIntoView({ block: 'center' }));
    await panel.screenshot({ path: path.join(shotDir, 'w62-factory-m0-approval.png') });
    await panel.evaluate(() => document.querySelector('[data-pa=researchApprove]')?.click());
    await human.until(() => window.MazzShell.sideDock.factoryPanel.embeds.some(item => String(item.name).startsWith('M0检索：')), { timeout: 20000, msg: 'M0 报告投喂嵌入资料' });
    const after = await human.evaluate(() => {
      const fp = window.MazzShell.sideDock.factoryPanel;
      return { status: fp.researchStatus, resultPath: fp.researchResultPath, embed: fp.embeds.find(item => String(item.name).startsWith('M0检索：')) };
    });
    await human.assert(after.status.includes('已核准') && after.resultPath && after.embed?.note?.includes('/检索/'), 'M0 应在核准后落盘、锁定本轮并作为嵌入资料投喂');
    await panel.locator('#p-close').click().catch(() => {});
  });
}
