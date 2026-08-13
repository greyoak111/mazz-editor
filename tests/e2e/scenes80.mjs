// W68b 活稿车间：正式工件入流、三视图、折叠记忆、百万字虚拟化、辩论线、归档重开与宿主分屏。
import fs from 'fs';
import path from 'path';

export async function scenes80({ win, human, scenario, shotDir }) {
  let taskId = '';
  let folder = '';

  await scenario('W68b 正式生产工件入群档并从 Ribbon/侧坞命令打开', async () => {
    await human.until(() => !!window.MazzShell.sideDock?.factoryPanel, { timeout: 10000, msg: '工厂侧坞初始化' });
    const seeded = await human.evaluate(async () => {
      const fp = window.MazzShell.sideDock.factoryPanel;
      const { normalizeFactoryEvent } = await import('./modules/factory/workshop.js');
      const ws = String(await window.mazz.invoke('workspace:get')).replace(/\\/g, '/').replace(/\/$/, '');
      const folder = `${ws}/Output/小说/20260813-活稿车间实证`;
      const task = { id: 'w68b-live-desk', label: '活稿车间实证', folder, genreId: 'xiaoshuo', values: { 书名: '活稿车间实证' }, mode: 'max', status: 'done', doneChapters: 4, maxChapters: 4, reviewProtocol: 'W68a', reviewRitual: 'full', reviewBudgetCap: 40000, outputProtocol: 'W60b' };
      fp.tasks = fp.tasks.filter(x => x.id !== task.id).concat(task); fp.persistTasks();
      await window.mazz.invoke('fs:mkdir', { path: folder });
      const mk = (unitNo) => ({
        sealed: true, verdict: 'pass', ritual: { requested: 'full', effective: 'full' }, gates: { machine: true, point: true, external: true, final: true }, transitions: ['machine:1', 'point:1', 'review:1', 'final'], budget: { usedTokens: 3200 + unitNo },
        schema: { lockedFacts: [{ label: '终点', value: '星港', sources: ['航海志', '信标簿'], basis: '正式抵达口径' }] }, bible: '# 圣经\n\n- 终点＝星港\n- 主角＝林澈', precedent: `### 第${unitNo}章判例\n\n- 规则：W68-R4\n- 裁决：证据充分`,
        artifacts: {
          skeleton: `# 骨架与验收点\n\n- [必达] 第${unitNo}章抵达星港`,
          draft: `# 扩写稿\n\n第${unitNo}章，林澈沿信标航路抵达星港。`,
          polish: '# 润色记录\n\n- 已处理重复段首', machine: '# 机检报告\n\n| 项目 | 结论 |\n|---|---|\n| 事实锁 | 通过 |',
          point: '# 对点报告\n\n- evidence: draft:抵达星港', repair: '# 修订单\n\n- 无', consultation: '# 请示单\n\n@human 是否准予沿用判例？',
          review: '# 审理表\n\n- 外部席：通过', objection: '# 质询单\n\n- objection: O1\n- 证据链需复核',
          answer: '# 答辩书\n\n- answer: 见正文与信标簿\n- evidence: draft:星港', verdict: '# 裁决书\n\n- 最终裁决：pass\n- 封存：是',
        },
      });
      await fp.writeW68Artifacts(task, mk(1), { unitNo: 1, unitName: '章', outline: '第一章：启航' });
      await fp.appendWorkshop(task, normalizeFactoryEvent({ id: 'million-body', type: 'body', title: '百万字压力正文', content: '长段落与证据链。'.repeat(125000), unitNo: 1, unitName: '章', stage: 'draft', artifactPath: `${folder}/第001章-百万字压力正文.md`, createdAt: '2026-08-13T11:00:00.000Z' }));
      await window.mazz.invoke('fs:writeFile', { path: `${folder}/第001章-百万字压力正文.md`, content: '# 百万字压力正文\n\n仅供虚拟滚动实证。' });
      await fp.writeW68Artifacts(task, mk(4), { unitNo: 4, unitName: '章', outline: '第四章：裁决' });
      await window.MazzCommands.execute('factory.openDesk', { taskId: task.id, folder, title: '活稿车间实证 · 活稿车间' });
      return { taskId: task.id, folder };
    });
    taskId = seeded.taskId; folder = seeded.folder;
    await human.until(() => {
      const def = window.MazzModulesReal?.get('factorydesk');
      const ctl = def?._forTests?.instances?.values?.().next?.().value;
      return document.querySelector('.factory-desk') && ctl?.events?.length >= 23;
    }, { timeout: 20000, msg: '活稿车间载入工厂群' });
    const state = await human.evaluate(() => ({
      registered: !!window.MazzModulesReal.get('factorydesk'),
      entry: !!window.MazzCommands.get('factory.openDesk'),
      cols: ['.fd-directory', '.fd-stream', '.fd-compare'].every(sel => !!document.querySelector(sel)),
      archiveCards: window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value.events.length,
      pinText: document.querySelector('.fd-pins')?.textContent,
    }));
    await human.assert(state.registered && state.entry && state.cols, '正式模块、命令入口和左中右三栏必须齐全');
    await human.assert(state.archiveCards >= 23, '两单元全工件与百万字正文必须从群档重开');
    await human.assert(/圣经/.test(state.pinText) && /判例/.test(state.pinText) && /6,40/.test(state.pinText.replace(/,/g, ',')), '双置顶卡和成本统计必须可见');
  });

  await scenario('W68b 三视图、旧料折叠记忆、搜索自动展开与辩论线', async () => {
    await human.click('[data-view="body"]');
    let state = await human.evaluate(() => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      return { view: ctl.view, types: [...new Set(ctl.items.map(x => x.event.type))] };
    });
    await human.assert(state.view === 'body' && state.types.join(',') === 'body', '只看正文不得夹审理消息');
    await human.click('[data-view="summary"]');
    state = await human.evaluate(() => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      return { view: ctl.view, allCollapsed: ctl.items.every(x => x.collapsed) };
    });
    await human.assert(state.view === 'summary' && state.allCollapsed, '摘要视图必须全是一行桩');
    await human.click('[data-view="workshop"]');
    await human.type('.fd-search input', '证据链需复核');
    await human.until(() => !!document.querySelector('.fd-card.tone-disagreement:not(.collapsed)'), { timeout: 6000, msg: '搜索展开质询' });
    state = await human.evaluate(() => ({
      red: !!document.querySelector('.fd-card.tone-disagreement'),
      thread: document.querySelector('.fd-card.tone-disagreement .fd-thread')?.textContent,
      mark: document.querySelector('.fd-card.tone-disagreement mark')?.textContent,
    }));
    await human.assert(state.red && /1\/3/.test(state.thread || '') && state.mark === '证据链需复核', '质询红线、三件辩论线程与搜索高亮必须联动');
    await human.click('.fd-card.tone-disagreement .fd-thread');
    await human.until(() => !!document.querySelector('.fd-card.tone-evidence:not(.collapsed)'), { timeout: 5000, msg: '辩论线跳答辩' });
    await human.assert(true, '线程徽标可从质询跳到证据答辩');
    await human.type('.fd-search input', '');
  });

  await scenario('W68b 百万字符只挂视口±两屏，工件对照与双置顶卡可下钻', async () => {
    await human.evaluate(() => {
      const btn = document.querySelector('[data-jump="million-body"]'); btn?.click();
    });
    await human.until(() => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      return ctl.items.length > 40 && ctl.memory['million-body'] === false;
    }, { timeout: 10000, msg: '百万字拆块并记住展开' });
    const perf = await human.evaluate(async () => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      const stream = document.querySelector('.fd-stream'); const t0 = performance.now();
      stream.scrollTop = stream.scrollHeight; stream.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { ms: performance.now() - t0, items: ctl.items.length, dom: document.querySelectorAll('.fd-card').length, remembered: ctl.memory['million-body'], scrollHeight: stream.scrollHeight };
    });
    await human.assert(perf.items > 40 && perf.dom < perf.items / 2, '百万字必须拆块且 DOM 只挂少数虚拟卡');
    await human.assert(perf.ms < 800 && perf.scrollHeight > 100000 && perf.remembered === false, `百万字尾跳应流畅并保留高度账（${Math.round(perf.ms)}ms）`);
    await human.click('[data-pin="bible"]');
    await human.assertText('.fd-preview', '终点＝星港', '圣经置顶卡应在右栏下钻');
    await human.evaluate(() => document.querySelector('.fd-files [data-file*="10-"]')?.click());
    await human.until(() => /最终裁决/.test(document.querySelector('.fd-preview')?.textContent || ''), { timeout: 5000, msg: '右栏工件对照' });
    await win.screenshot({ path: path.join(shotDir, 'w68b-factory-desk-million.png') });
  });

  await scenario('W68b 群档关闭重开、折叠记忆延续并继承宿主分屏', async () => {
    await human.evaluate(() => window.MazzCommands.execute('file.closeTab'));
    await human.until(() => !document.querySelector('.factory-desk'), { timeout: 6000, msg: '关闭 Factory Desk' });
    await human.evaluate(({ taskId, folder }) => window.MazzCommands.execute('factory.openDesk', { taskId, folder, title: '活稿车间实证 · 重开' }), { taskId, folder });
    await human.until(() => {
      const def = window.MazzModulesReal.get('factorydesk'); const ctl = def._forTests.instances.values().next().value;
      return document.querySelector('.factory-desk') && ctl?.events?.some(x => x.id === 'million-body');
    }, { timeout: 15000, msg: '从工厂群.md 重开' });
    const reopened = await human.evaluate(() => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      return { remembered: ctl.memory['million-body'], archive: ctl.events.length };
    });
    await human.assert(reopened.remembered === false && reopened.archive >= 23, '关闭后须从群档恢复全史并延续展开记忆');
    await human.evaluate(() => {
      const shell = window.MazzShell;
      const deskTab = shell.paneTree.leaves().flatMap(leaf => leaf.tabs.tabs).find(tab => tab.moduleId === 'factorydesk');
      shell.openTab('markdown', { title: '分屏参照稿.md', content: '# 分屏参照稿\n\n左窗保留此稿，右窗承载活稿车间。' });
      const pane = shell.paneTree.paneOfTab(deskTab.id);
      shell.paneTree.setActive(pane); pane.tabs.activate(deskTab.id);
      shell.splitRight();
    });
    await human.until(() => document.querySelector('.factory-desk')?.classList.contains('narrow'), { timeout: 5000, msg: '窄窗格容器布局切换' });
    const panes = await human.evaluate(() => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      const verdict = ctl.events.find(event => event.type === 'verdict' && event.unitNo === 4);
      document.querySelector(`[data-jump="${CSS.escape(verdict.id)}"]`)?.click();
      return { leaves: window.MazzShell.paneTree.leaves().length, deskPane: !!window.MazzShell.paneTree.paneOfTab(window.MazzShell.tabs.activeId)?.el.querySelector('.factory-desk'), narrow: ctl.root.classList.contains('narrow') };
    });
    await human.assert(panes.leaves === 2 && panes.deskPane && panes.narrow, 'Factory Desk 必须进入宿主分屏树并按窗格宽度切单列');
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(shotDir, 'w68b-factory-desk-split.png') });
  });

  await scenario('W68b 工厂群物理档案存在且仍是可读 Markdown', async () => {
    const archivePath = path.join(folder.replace(/\//g, path.sep), '工厂群.md');
    await human.assert(fs.existsSync(archivePath), '工厂群.md 必须物理落盘');
    const text = fs.readFileSync(archivePath, 'utf8');
    await human.assert(text.includes('# 活稿车间实证 · 工厂群') && text.includes('<!-- MAZZ_FACTORY_EVENT') && text.includes('## [裁决]'), '群档应同时具备可读正文与可恢复元数据');
  });
}
