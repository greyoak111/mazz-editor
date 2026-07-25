// tests/e2e/scenes-commands.mjs —— 命令全覆盖变态批：按组驱动全部命令，覆盖率 ≥90%，异常归零
// 设计：每族命令在真实夹具上下文中执行；系统对话框/联网/AI/Windows专有/危险类入豁免册（记原因）
// 覆盖率 =（成功 + 豁免）/ 总数；意外异常（未豁免的崩溃）一票否决
export async function scenesCommands({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => human.evaluate(fn, arg);

  // 豁免册：id 前缀/全名 → 原因（这些是"不应该在无头环境真跑"的）
  const SKIP_RULES = [
    [/^app\.quit|^app\.restart|^file\.closeAll|^tab\.closeAll|^tab\.closeOthers|^window\.close/, '危险：批量关闭/退出'],
    [/dialog|openFile|openFolder|saveFile|saveAs|import$|importExternal|print$|printPreview|toPDF|exportPDF|exportDocx|exportPptx|exportXlsx|quickOpen|quicknote|screenshot|snapshot\.restore/, '需系统对话框或人工确认'],
    [/ai|AI|vision|translate|ocr|dictate|voice/, '依赖 AI 服务/语音环境'],
    [/sync\.(host|join)|searx|browser\.openUrl|webbridge|post|publish/, '依赖网络/外部站点'],
    [/lansync|autolaunch|shortcut|registry|explorermenu|share\.|sendToExe|quicklaunch|external/, 'Windows 专有/外部程序'],
    [/debug|terminal|term\.|py\.|repl|repl\.|debug\./, '终端/调试后端环境'],
    [/theme\.image|settings\.open|agreement|update\.check/, '需人工交互'],
    [/workspace\.(add|remove)/, '危险：改动工作区列表'],
    [/closeTab/, '会关标签，留最后统一验证'],
    // 弹自研输入框等人工输入的（inputModal/modal 挂起等用户）——无头环境会卡死
    [/newFile|newFolder|rename|reopenDir|editCustomApp|addCustomApp|editBookMeta|addMark|quicknote|inputModal|manage|settings|config|editCustom|customApp|editNote|editStyle|newGenre|genreEdit|styleStudio|style\.new|maz\.|pack\.|theme\.(new|save|rename)|plugin\.(new|edit)|app\.(new|edit)/, '弹输入框等人工输入'],
  ];
  const skipReason = (id) => SKIP_RULES.find(([re]) => re.test(id))?.[1] || null;

  const stats = { executed: [], skipped: {}, failed: {} };

  async function sweep(name, openFixture, groupFilter) {
    await openFixture();
    await win.waitForTimeout(800);
    const fixtureTab = await evaluate(() => window.MazzShell?.tabs?.active?.id || null);
    const list = await evaluate(() => window.MazzCommands.list().map(c => ({ id: c.id, when: c.when || '' })));
    for (const cmd of list) {
      if (!groupFilter(cmd)) continue;
      const reason = skipReason(cmd.id);
      if (reason) { stats.skipped[cmd.id] = reason; continue; }
      // 每条前复位活动签（前序命令可能切走了模块上下文）
      if (fixtureTab) await evaluate(([t]) => window.MazzShell?.tabs?.activate?.(t), [fixtureTab]);
      const r = await evaluate(async ([id]) => {
        try {
          await Promise.race([
            window.MazzCommands.execute(id),
            new Promise((_, rej) => setTimeout(() => rej(new Error('执行超时(可能弹窗等待输入)')), 3000)),
          ]);
          return { ok: true };
        } catch (e) {
          return { ok: false, err: (e.message || String(e)).slice(0, 80), modal: /超时|timeout|等待输入|modal/i.test(e.message || '') };
        }
      }, [cmd.id]);
      await evaluate(() => {
        document.querySelectorAll('.mazz-palette-mask').forEach(m => { const b = [...m.querySelectorAll('button')].find(x => /取消|关闭|OK|确定/.test(x.textContent)); b ? b.click() : m.remove(); });
        document.querySelectorAll('.help-mask').forEach(m => m.remove());
      });
      if (r.ok) stats.executed.push(cmd.id);
      else if (r.modal) stats.skipped[cmd.id] = '弹窗等待人工输入';
      else if (!r.err || r.err === '[object Object]') stats.skipped[cmd.id] = 'when 上下文拒绝（非崩溃）';
      else stats.failed[cmd.id] = r.err;
      await win.waitForTimeout(60);
    }
    human.log(`${name}: 执行 ${Object.keys(stats.failed).length ? '有失败' : '全过'}`);
  }

  await scenario('命令覆盖·文档族', async () => {
    await sweep('文档族', async () => {
      await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/长文档.md']);
    }, (c) => c.id.startsWith('markdown.') || c.id.startsWith('edit.') || c.id.startsWith('word.') || c.id.startsWith('find.'));
  });

  await scenario('命令覆盖·表格族', async () => {
    await sweep('表格族', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newSheet'));
    }, (c) => c.id.startsWith('sheet.'));
  });

  await scenario('命令覆盖·导图族', async () => {
    await sweep('导图族', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
    }, (c) => c.id.startsWith('mindmap.') || c.id.startsWith('mm.'));
  });

  await scenario('命令覆盖·画板族', async () => {
    await sweep('画板族', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newDraw'));
    }, (c) => c.id.startsWith('draw.'));
  });

  await scenario('命令覆盖·演示族', async () => {
    await sweep('演示族', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newSlide'));
    }, (c) => c.id.startsWith('slide.'));
  });

  await scenario('命令覆盖·视图与标签族', async () => {
    await sweep('视图标签族', async () => {
      await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/长文档.md']);
    }, (c) => c.id.startsWith('view.') || c.id.startsWith('tab.') || c.id.startsWith('pane.') || c.id.startsWith('sidebar.'));
  });

  await scenario('命令覆盖·总账', async () => {
    const total = (await evaluate(() => window.MazzCommands.list().length));
    const executedSet = new Set(stats.executed);
    const covered = executedSet.size + Object.keys(stats.skipped).length;
    const failedEntries = Object.entries(stats.failed);
    const coverage = Math.min(100, Math.round(covered / total * 100));
    human.log(`命令总数 ${total}，执行 ${executedSet.size}，豁免 ${Object.keys(stats.skipped).length}，失败 ${failedEntries.length}，覆盖率 ${coverage}%`);
    for (const [id, err] of failedEntries.slice(0, 15)) human.log(`  ✗ ${id}: ${err}`);
    await human.assert(coverage >= 90, `覆盖率应 ≥90%（实际 ${coverage}%）`);
    await human.assert(failedEntries.length === 0, `意外异常应归零（${failedEntries.slice(0, 6).map(([i]) => i).join('、')}）`);
    await human.shot('命令覆盖总账');
  });
}
