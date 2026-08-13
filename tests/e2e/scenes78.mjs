// tests/e2e/scenes78.mjs —— W62a 内嵌指令台真人路径
import fs from 'fs';
import path from 'path';

export async function scenes78({ app, win, human, scenario, shotDir, workspace }) {
  const tabCount = () => window.MazzShell.paneTree.leaves().reduce((n, leaf) => n + leaf.tabs.tabs.length, 0);
  const finishCount = () => document.querySelectorAll('.fc-agent-card.finish').length;
  const submit = async (text) => {
    const before = await human.evaluate(() => window.MazzShell.sideDock.factoryPanel.agentRuntime.ledger.entries.length);
    await human.type('.fc-agent-input', text);
    await human.key('Control+Enter');
    await win.waitForFunction(count => {
      const runtime = window.MazzShell.sideDock.factoryPanel.agentRuntime;
      return runtime.ledger.entries.length > count && !runtime.session && !runtime.pending;
    }, before, { timeout: 12000 });
  };

  await scenario('车间流底部内嵌指令台·命令闭集就绪且无独立子窗', async () => {
    await human.evaluate(async () => {
      await window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'mock://agent-w62', model: 'mock-agent', providerId: 'deepseek' } });
      await window.mazz.invoke('secret:set', { key: 'factory.providerKey', value: 'mock-key-w62' });
      window.MazzShell.sideDock.show();
      window.MazzShell.sideDock.showTab('factory');
      await window.MazzShell.sideDock.factoryPanel.reload();
      document.querySelector('.fc-command-dock')?.scrollIntoView({ block: 'center' });
    });
    await human.until(() => !!document.querySelector('.fc-command-dock .fc-agent-input'), { timeout: 8000, msg: '指令台出现' });
    const state = await human.evaluate(() => ({
      tools: parseInt(document.querySelector('.fc-agent-toolcount')?.textContent || '0', 10),
      role: document.querySelector('.fc-agent-role [data-ai-role]')?.dataset.aiRole,
      independent: [...document.querySelectorAll('iframe')].some(x => /agent\.html/.test(x.src)),
    }));
    await human.assert(state.tools > 30, '指令台应直接消费全应用命令闭集');
    await human.assert(state.role === 'agent', '指令台应暴露 agent 岗位就地改派钮');
    await human.assert(!state.independent && !app.windows().some(w => /agent\.html/.test(w.url())), '不得生成独立 agent bar/子窗');
    await win.screenshot({ path: path.join(shotDir, 'w62a-command-dock.png') });
  });

  await scenario('一期路由·真实执行新建并将台账写入索引目录', async () => {
    const before = await human.evaluate(tabCount);
    await submit('W62打开新文档');
    const after = await human.evaluate(tabCount);
    await human.assert(after === before + 1, 'file.new 必须由命令注册表真实执行');
    const ledgerPath = path.join(workspace, 'Output', '_系统', '交办台账.md');
    await human.assert(fs.existsSync(ledgerPath), '台账 Markdown 必须落盘到工作区索引范围');
    const ledger = fs.readFileSync(ledgerPath, 'utf8');
    await human.assert(ledger.includes('W62打开新文档') && ledger.includes('file.new'), '台账应记录原始交办、命令与结果供全文索引');
  });

  await scenario('二期链式交办·每步结果回喂后继续下一命令', async () => {
    const tabsBefore = await human.evaluate(tabCount);
    const resultsBefore = await human.evaluate(() => document.querySelectorAll('.fc-agent-card.result').length);
    await submit('W62连续交办');
    const state = await human.evaluate(([before]) => ({
      tabs: window.MazzShell.paneTree.leaves().reduce((n, leaf) => n + leaf.tabs.tabs.length, 0),
      heads: [...document.querySelectorAll('.fc-agent-card.result .fc-agent-card-head')].slice(before).map(x => x.textContent),
      finish: [...document.querySelectorAll('.fc-agent-card.finish .fc-agent-card-body')].at(-1)?.textContent,
    }), [resultsBefore]);
    await human.assert(state.tabs === tabsBefore + 2, '链式交办应依次执行 file.new 与 file.newText');
    await human.assert(state.heads.join('|').includes('file.new') && state.heads.join('|').includes('file.newText'), '两步真实结果必须各自生成结果卡');
    await human.assert(state.finish.includes('两步完成'), '模型只可在结果回喂后发出 finish');
  });

  await scenario('任务级澄清卡·严格 A/B 后恢复原执行链', async () => {
    const finishBefore = await human.evaluate(finishCount);
    const tabsBefore = await human.evaluate(tabCount);
    await human.type('.fc-agent-input', 'W62澄清任务');
    await human.key('Control+Enter');
    await human.until(() => document.querySelectorAll('.fc-agent-card.clarify .fc-agent-card-actions button').length === 2, { timeout: 8000, msg: 'A/B 澄清卡' });
    const choices = await human.evaluate(() => [...document.querySelectorAll('.fc-agent-card.clarify .fc-agent-card-actions button')].slice(-2).map(x => x.textContent));
    await human.assert(/^A\./.test(choices[0]) && /^B\./.test(choices[1]), '澄清卡只能给出 A/B 两钮');
    await win.screenshot({ path: path.join(shotDir, 'w62a-clarify-card.png') });
    await win.locator('.fc-agent-card.clarify .fc-agent-card-actions button').last().click();
    await win.waitForFunction(count => document.querySelectorAll('.fc-agent-card.finish').length > count, finishBefore, { timeout: 10000 });
    await human.assert((await human.evaluate(tabCount)) === tabsBefore + 1, '选择 B 后应恢复链并执行 file.newText');
  });

  await scenario('危险确认闸·取消前删除命令绝不落地', async () => {
    const finishBefore = await human.evaluate(finishCount);
    await human.type('.fc-agent-input', 'W62危险删除');
    await human.key('Control+Enter');
    await human.until(() => !!document.querySelector('.fc-agent-card.confirm .fc-agent-card-actions .danger'), { timeout: 8000, msg: '危险确认卡' });
    const state = await human.evaluate(() => ({
      status: document.querySelector('.fc-agent-status')?.textContent,
      buttons: [...document.querySelectorAll('.fc-agent-card.confirm .fc-agent-card-actions button')].slice(-2).map(x => x.textContent),
    }));
    await human.assert(state.status.includes('待确认') && state.buttons.join('|') === '确认执行|取消', '危险命令必须由代码层暂停并呈现明确双钮');
    await win.screenshot({ path: path.join(shotDir, 'w62a-danger-confirm.png') });
    await win.locator('.fc-agent-card.confirm .fc-agent-card-actions button').last().click();
    await win.waitForFunction(count => document.querySelectorAll('.fc-agent-card.finish').length > count, finishBefore, { timeout: 8000 });
    await human.assertText('.fc-agent-card.finish:last-child .fc-agent-card-body', '未执行危险操作', '取消卡必须明确未执行');
  });

  await scenario('台账回放、高频 chip 与确定性撤销', async () => {
    const beforeReplay = await human.evaluate(tabCount);
    await submit('W62打开新文档');
    await submit('再来一次');
    await human.assert((await human.evaluate(tabCount)) === beforeReplay + 2, '再来一次应从台账回放最近原始交办');
    const chip = await human.evaluate(() => [...document.querySelectorAll('.fc-agent-chip')].find(x => x.textContent.includes('W62打开新文档'))?.textContent || '');
    await human.assert(chip.includes('×3'), '相同交办累计后应沉淀为高频 chip');
    const beforeUndo = await human.evaluate(tabCount);
    await submit('撤销');
    await human.assert((await human.evaluate(tabCount)) === beforeUndo - 1, '撤销应调用最近工具记录绑定的 file.closeTab');
    await human.assertText('.fc-agent-card.finish:last-child .fc-agent-card-head', '撤销完成');
    await win.screenshot({ path: path.join(shotDir, 'w62a-ledger-undo.png') });
  });
}
