// W62d：无损 AI 层级提炼 → 预览复验 → 新建/嫁接 → 来源回跳。
import path from 'node:path';

export async function scenes84({ win, human, scenario, shotDir, sourcePath }) {
  await scenario('选区/全文右键贡献与 AI 岗位接入', async () => {
    await human.evaluate(async (p) => {
      await window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'mock://w62d', model: 'mock-distill', providerId: 'deepseek' } });
      await window.mazz.invoke('secret:set', { key: 'factory.providerKey', value: 'mock-key-w62d' });
      await window.MazzCommands.execute('file.openPath', { path: p });
    }, sourcePath);
    await human.until(() => !!window.__activeMarkdownCtl, { timeout: 8000, msg: '源 Markdown 打开' });
    const state = await human.evaluate(() => ({
      selection: !!window.MazzCommands.get('markdown.distillSelectionToMindmap'),
      full: !!window.MazzCommands.get('markdown.distillDocumentToMindmap'),
    }));
    await human.assert(state.selection && state.full, '文档模块应注册选区/全文两条提炼命令');
  });

  await scenario('首轮坏 JSON 自动重试一次并停在无损预览', async () => {
    await human.evaluate(() => window.MazzCommands.execute('markdown.distillDocumentToMindmap'));
    await human.until(() => !!document.querySelector('.distill-outline'), { timeout: 12000, msg: '无损预览出现' });
    const state = await human.evaluate(() => ({
      meta: document.querySelector('.distill-meta')?.textContent || '',
      lines: document.querySelector('.distill-outline')?.value.split('\n').filter(Boolean).length || 0,
      note: document.querySelector('.distill-contract-note')?.textContent || '',
    }));
    await human.assert(state.meta.includes('第 2 次输出通过契约'), `应由第二次输出通过（${state.meta}）`);
    await human.assert(state.lines === 5 && state.note.includes('正文已锁定'), '五个原文块应逐块进入预览且正文锁定');
    await win.screenshot({ path: path.join(shotDir, 'w62d-distill-preview.png') });
  });

  await scenario('预览正文篡改被拦，恢复后新建导图并显出来源钩', async () => {
    const original = await human.evaluate(() => {
      const area = document.querySelector('.distill-outline');
      const value = area.value;
      area.value = value.replace('海上行动', '篡改行动');
      document.querySelector('[data-act="new"]').click();
      return value;
    });
    await human.until(() => document.querySelector('.distill-error')?.textContent.includes('改写'), { timeout: 3000, msg: '篡改被无损契约拦截' });
    await human.evaluate(value => { document.querySelector('.distill-outline').value = value; document.querySelector('[data-act="new"]').click(); }, original);
    await human.until(() => !!window.__activeMindmapCtl && !document.querySelector('.distill-outline'), { timeout: 8000, msg: '导图新建完成' });
    const state = await human.evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      let count = 0; const texts = [];
      const walk = node => { count++; texts.push(node.text); node.children.forEach(walk); };
      ctl.doc.roots.forEach(walk);
      const hook = ctl.root.querySelector('.mm-source-hook');
      return { count, texts, hook: !hook.hidden, label: hook.textContent, source: ctl.doc.sourceRef?.filePath };
    });
    await human.assert(state.count === 5 && new Set(state.texts).size === 5, `正文块应 5/5 守恒（${state.count}）`);
    await human.assert(state.hook && state.label.includes('W62d-源文档') && state.source === sourcePath, '导图应显示并持久记录来源回跳钩');
    await win.screenshot({ path: path.join(shotDir, 'w62d-mindmap-source-hook.png') });
  });

  await scenario('来源钩回到原文，全文再次提炼可嫁接到旧图已选节点', async () => {
    await human.click('.mm-source-hook');
    await human.until(() => window.MazzShell.tabs.active?.moduleId === 'markdown', { timeout: 5000, msg: '来源钩回到 Markdown' });
    await human.evaluate(() => window.MazzCommands.execute('markdown.distillDocumentToMindmap'));
    await human.until(() => !!document.querySelector('.distill-outline'), { timeout: 12000, msg: '第二轮预览出现' });
    const target = await human.evaluate(() => ({ options: document.querySelectorAll('.distill-target option').length, disabled: document.querySelector('[data-act="graft"]').disabled }));
    await human.assert(target.options >= 1 && !target.disabled, '旧导图最后选中节点应成为嫁接目标');
    await human.click('[data-act="graft"]');
    await human.until(() => !document.querySelector('.distill-outline'), { timeout: 5000, msg: '嫁接完成' });
    const state = await human.evaluate(() => {
      const tab = window.MazzShell.tabs.tabs.find(t => t.moduleId === 'mindmap');
      window.MazzShell.tabs.activate(tab.id);
      const ctl = window.MazzModules.instances.get(tab.id).state;
      let count = 0; const walk = n => { count++; n.children.forEach(walk); }; ctl.doc.roots.forEach(walk);
      return { count, selected: ctl.selectedNode()?.text, dirty: tab.dirty };
    });
    await human.assert(state.count === 10 && state.dirty, `嫁接后应 5+5 且标脏（实际 ${state.count}）`);
    await human.assert(state.selected === '海上行动', '嫁接完成后应选中新子树根');
  });
}
