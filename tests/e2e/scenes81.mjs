// W68c：闲聊隔离、模糊澄清、锁定 diff、终审三钮、预算帽与七指标看板。
import fs from 'fs';
import path from 'path';

export async function scenes81({ win, human, scenario, shotDir }) {
  let taskId = '';
  let folder = '';

  await scenario('W68c 状态机实证项目与三张待终审卡入群', async () => {
    await human.until(() => !!window.MazzShell.sideDock?.factoryPanel, { timeout: 10000, msg: '工厂侧坞初始化' });
    const seeded = await human.evaluate(async () => {
      const fp = window.MazzShell.sideDock.factoryPanel;
      const { normalizeFactoryEvent } = await import('./modules/factory/workshop.js');
      const { makeFinalReviewCard } = await import('./modules/factory/command-gate.js');
      const ws = String(await window.mazz.invoke('workspace:get')).replace(/\\/g, '/').replace(/\/$/, '');
      const folder = `${ws}/Output/小说/20260813-W68c指令闸实证`;
      const task = { id: 'w68c-command-gate', label: '事件日·W68c指令闸实证', folder, genreId: 'xiaoshuo', values: { 书名: 'W68c指令闸实证', 事件日: true }, mode: 'single', status: 'done', reviewProtocol: 'W68a', reviewRitual: 'full', reviewBudgetCap: 12000, outputProtocol: 'W60b' };
      fp.tasks = fp.tasks.filter(x => x.id !== task.id).concat(task); fp.persistTasks();
      await window.mazz.invoke('fs:mkdir', { path: folder });
      await window.mazz.invoke('fs:writeFile', { path: `${folder}/圣经.md`, content: '# 圣经\n\n## 锁定事实\n\n- 舰名＝海岳\n' });
      await window.mazz.invoke('fs:writeFile', { path: `${folder}/判例库.md`, content: '# 判例库\n\n- W68-R4：锁定项先确认。\n' });
      await window.mazz.invoke('fs:writeFile', { path: `${folder}/成本台账.json`, content: JSON.stringify({ totalTokens: 4200, units: [{ unitNo: 1, ritual: { requested: 'full' }, budget: { capTokens: 12000, usedTokens: 4200 } }] }, null, 2) });
      const events = [normalizeFactoryEvent({ id: 'w68c-body', type: 'body', title: '事件日正文', content: '# 正文\n\n舰队沿东海航路启航。', unitNo: 1, unitName: '章', stage: 'draft' }), normalizeFactoryEvent({ id: 'w68c-machine', type: 'review', title: '机检打回', content: '未通过：锁定口径待核', unitNo: 1, unitName: '章', stage: 'machine' }), normalizeFactoryEvent({ id: 'w68c-objection', type: 'review', title: '质询', content: '有效质询：编队命名缺来源', unitNo: 1, unitName: '章', stage: 'objection', tone: 'disagreement', threadId: 'w68c-thread' }), normalizeFactoryEvent({ id: 'w68c-answer', type: 'review', title: '答辩', content: '根据证据《东海编制表》撤回 withdraw', unitNo: 1, unitName: '章', stage: 'answer', tone: 'evidence', threadId: 'w68c-thread' }), normalizeFactoryEvent({ id: 'w68c-hearing', type: 'verdict', title: '开庭裁决', content: '维持证据口径', unitNo: 1, unitName: '章', stage: 'hearing', tone: 'verdict', threadId: 'w68c-thread' })];
      for (const [no, action] of [[1, 'seal'], [2, 'return'], [3, 'hold']]) {
        const artifactDir = `${folder}/工件/第00${no}章-终审${no}`;
        await window.mazz.invoke('fs:mkdir', { path: artifactDir });
        const draftPath = `${artifactDir}/02-扩写稿.md`, reviewPath = `${artifactDir}/07-审理表.md`, machinePath = `${artifactDir}/03-机检报告.md`, targetPath = `${folder}/第00${no}章-终审${no}.md`;
        await window.mazz.invoke('fs:writeFile', { path: draftPath, content: `第${no}章终审正文：东海航路。` });
        await window.mazz.invoke('fs:writeFile', { path: reviewPath, content: '# 双审意见\n\n- M4：通过\n- M5：通过' });
        await window.mazz.invoke('fs:writeFile', { path: machinePath, content: '# 机检报告\n\n- 结论：通过' });
        const card = makeFinalReviewCard({ unitNo: no, unitName: '章', targetPath, targetPrefix: `# 第${no}章\n\n`, draftPath, reviewPath, machinePath, artifactDir, eventDay: true });
        events.push(normalizeFactoryEvent({ id: `w68c-final-${action}`, type: 'help', title: `事件日 · 待终审 ${action}`, content: `> **事件日必审**\n\n## 全文\n\n第${no}章终审正文\n\n## 双审意见\n\nM4/M5 通过\n\n## 机检报告\n\n通过`, unitNo: no, unitName: '章', stage: 'final-pending', artifactPath: draftPath, card }));
      }
      await fp.appendWorkshop(task, events);
      await window.MazzCommands.execute('factory.openDesk', { taskId: task.id, folder, title: 'W68c 指令闸实证' });
      return { taskId: task.id, folder };
    });
    taskId = seeded.taskId; folder = seeded.folder;
    await human.until(() => {
      const ctl = window.MazzModulesReal?.get('factorydesk')?._forTests?.instances?.values?.().next?.().value;
      return document.querySelector('.factory-desk') && ctl?.events?.some(x => x.id === 'w68c-final-seal');
    }, { timeout: 15000, msg: 'W68c 卡片载入' });
    const state = await human.evaluate(() => ({ buttons: [...document.querySelectorAll('[data-card-action^="final:"]')].map(x => x.textContent.trim()), healthPin: document.querySelector('[data-a="health"]')?.textContent, cost: document.querySelector('[data-stat="cost"]')?.textContent }));
    await human.assert(['入库', '打回', '先放着'].every(x => state.buttons.includes(x)), '终审三钮必须同卡可见');
    await human.assert(/7 项/.test(state.healthPin || '') && state.cost === '4,200', '健康七指标和成本帽必须钉顶');
  });

  await scenario('W68c 闲聊零误触发、模糊指令二选一且质检不改稿', async () => {
    await human.type('.fd-instruction textarea', '你好，辛苦了');
    await human.click('.fd-instruction button');
    await human.until(() => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      return ctl.events.some(x => x.stage === 'instruction-chat');
    }, { timeout: 6000, msg: '闲聊零动作卡' });
    let state = await human.evaluate(() => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      return { chat: ctl.events.find(x => x.stage === 'instruction-chat')?.content, production: ctl.events.filter(x => x.stage === 'instruction-production').length };
    });
    await human.assert(/未调用模型、未触发生产、未改动文件/.test(state.chat || '') && state.production === 0, '闲聊不得误开生产动作');

    await human.type('.fd-instruction textarea', '第三章');
    await human.click('.fd-instruction button');
    await human.until(() => !!document.querySelector('[data-card-action="clarify:quality"]'), { timeout: 6000, msg: '模糊反问二选一' });
    await human.click('[data-card-action="clarify:quality"]');
    await human.until(() => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      return ctl.events.some(x => x.stage === 'instruction-quality');
    }, { timeout: 6000, msg: '质检选择落档' });
    state = await human.evaluate(() => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      return { quality: ctl.events.filter(x => x.stage === 'instruction-quality').length, production: ctl.events.filter(x => x.stage === 'instruction-production').length };
    });
    await human.assert(state.quality === 1 && state.production === 0, '二选一为质检后仍不得改稿');
  });

  await scenario('W68c 锁定项 diff 点头前零写入、确认后才入圣经', async () => {
    const before = await human.evaluate(folder => window.mazz.invoke('fs:readFile', { path: `${folder}/圣经.md` }), folder);
    await human.type('.fd-instruction textarea', '以后护航编队按东海系命名');
    await human.click('.fd-instruction button');
    await human.until(() => !!document.querySelector('[data-card-action="diff:confirm"]'), { timeout: 6000, msg: '锁定 diff 确认卡' });
    const pending = await human.evaluate(folder => window.mazz.invoke('fs:readFile', { path: `${folder}/圣经.md` }), folder);
    await human.assert(pending === before && !pending.includes('护航编队按东海系命名'), '点头前圣经必须保持原样');
    await human.click('[data-card-action="diff:confirm"]');
    await human.until(() => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      return ctl.events.some(x => x.stage === 'lock-decision' && /确认入典/.test(x.title));
    }, { timeout: 7000, msg: 'diff 决定回写群档' });
    const after = await human.evaluate(folder => window.mazz.invoke('fs:readFile', { path: `${folder}/圣经.md` }), folder);
    await human.assert(after.includes('护航编队按东海系命名'), '确认后锁定变更才可写入圣经');
  });

  await scenario('W68c 终审三钮真落状态、入库正文与预算降级', async () => {
    for (const [id, action] of [['w68c-final-seal', 'final:seal'], ['w68c-final-return', 'final:return'], ['w68c-final-hold', 'final:hold']]) {
      await human.evaluate(id => document.querySelector(`[data-jump="${CSS.escape(id)}"]`)?.click(), id);
      await win.waitForSelector(`[data-event="${id}"] [data-card-action="${action}"]`, { timeout: 5000 });
      await human.click(`[data-event="${id}"] [data-card-action="${action}"]`);
      await win.waitForFunction(id => {
        const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
        return ctl.events.some(x => x.refId === id && x.stage === 'final-human');
      }, id, { timeout: 6000 });
    }
    const persisted = await human.evaluate(async folder => ({
      target: await window.mazz.invoke('fs:readFile', { path: `${folder}/第001章-终审1.md` }),
      ledger: JSON.parse(await window.mazz.invoke('fs:readFile', { path: `${folder}/终审状态.json` })),
      returned: await window.mazz.invoke('fs:readFile', { path: `${folder}/工件/第002章-终审2/11-人工终审.md` }),
    }), folder);
    await human.assert(/第1章终审正文/.test(persisted.target) && persisted.ledger.decisions.length === 3 && /打回/.test(persisted.returned), '入库/打回/先放着均须物理留痕');

    await human.click('[data-a="budget"]');
    await human.until(() => !!document.querySelector('[data-card-action="budget:degrade"]'), { timeout: 6000, msg: '预算降级卡' });
    await human.click('[data-card-action="budget:degrade"]');
    await human.until(() => {
      const tasks = JSON.parse(localStorage.getItem('mazz.factory.tasks') || '[]');
      return tasks.find(x => x.id === 'w68c-command-gate')?.reviewRitual === 'light';
    }, { timeout: 6000, msg: '预算帽降级写入任务' });
    await human.assert(true, '超帽选择降级后保留轻仪式而非绕闸');
  });

  await scenario('W68c 七指标看板、关闭重开恢复与宿主窄分屏', async () => {
    await human.click('[data-a="health"]');
    const health = await human.evaluate(() => ({ count: document.querySelectorAll('.fd-health-metric').length, text: document.querySelector('.fd-health')?.textContent }));
    await human.assert(health.count === 7 && /机检打回率/.test(health.text || '') && /人类介入频次/.test(health.text || ''), '健康看板必须展示七项固定指标');
    await win.screenshot({ path: path.join(shotDir, 'w68c-gates-health.png') });

    await human.evaluate(() => window.MazzCommands.execute('file.closeTab'));
    await human.until(() => !document.querySelector('.factory-desk'), { timeout: 6000, msg: '关闭 W68c Desk' });
    await human.evaluate(({ taskId, folder }) => window.MazzCommands.execute('factory.openDesk', { taskId, folder, title: 'W68c 指令闸重开' }), { taskId, folder });
    await human.until(() => {
      const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
      return ctl?.events?.filter(x => x.stage === 'final-human').length === 3;
    }, { timeout: 12000, msg: '三项终审决定从群档恢复' });
    await human.evaluate(() => {
      const shell = window.MazzShell;
      const deskTab = shell.paneTree.leaves().flatMap(leaf => leaf.tabs.tabs).find(tab => tab.moduleId === 'factorydesk');
      shell.openTab('markdown', { title: 'W68c 分屏参照.md', content: '# 分屏参照\n\n右窗检查终审卡。' });
      const pane = shell.paneTree.paneOfTab(deskTab.id); shell.paneTree.setActive(pane); pane.tabs.activate(deskTab.id); shell.splitRight();
    });
    await human.until(() => document.querySelector('.factory-desk')?.classList.contains('narrow'), { timeout: 5000, msg: 'W68c 容器窄态' });
    await win.screenshot({ path: path.join(shotDir, 'w68c-gates-split.png') });
    const archivePath = path.join(folder.replace(/\//g, path.sep), '工厂群.md');
    const archive = fs.readFileSync(archivePath, 'utf8');
    await human.assert(archive.includes('instruction-chat') && archive.includes('lock-decision') && archive.includes('final-human') && archive.includes('budget-decision'), '四类决定必须全进物理群档');
  });
}
