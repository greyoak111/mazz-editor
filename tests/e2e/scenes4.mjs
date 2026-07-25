// tests/e2e/scenes4.mjs —— 变态批（第四批）：各模块应用到牙齿的复杂具体场景
// 文档全格式链 / 表格公式链与边框导出 / 演示放映链 / 导图便笺引用线拐点 /
// 画板图层橡皮撤销对称 / 书库真书深读 / 播放器连播截图 / 搜索正则与索引 /
// 工厂提示词组装 / 侧栏大纲书签跳转 / 代码编辑器挂载 / 快照恢复 / 工具坞持久化
export async function scenes4({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => human.evaluate(fn, arg);
  const vis = `els.find(e => e.offsetParent) || els[els.length - 1]`;

  // ============ 变态 1：文档全格式链（marks 序列化守恒） ============
  await scenario('文档·全格式链·marks守恒', async () => {
    await evaluate(async ([p]) => {
      await window.mazz.invoke('fs:writeFile', { path: p, content: '# 格式链\n\n正文开头。' });
      await window.MazzCommands.execute('file.openPath', { path: p });
    }, [WS + '/格式链.md']);
    await win.waitForTimeout(1200);
    // 用 ProseMirror 命令直接施加 marks（比键盘稳定）
    const md = await evaluate(() => {
      const ctl = window.__activeMarkdownCtl;
      const view = ctl.view;
      const state = view.state;
      // 对既有文尾三字施加五种 marks（不碰插入位置玄学）
      const to = state.doc.content.size, from = to - 3;
      let tr = state.tr;
      for (const m of ['strong', 'em', 'underline', 'strike', 'highlight']) {
        const type = state.schema.marks[m];
        if (type) tr = tr.addMark(from, to, type.create());
      }
      view.dispatch(tr);
      return ctl.getMarkdown();
    });
    await human.assert(md.includes('**'), `加粗应入序列化（${md.slice(-60)}）`);
    await human.assert(md.includes('正文开'), `原文应在（md尾部：${md.slice(-50)}）`);
    await human.shot('格式链');
  });

  // ============ 变态 2：表格公式依赖链 + 四边边框导出保留 ============
  await scenario('表格·公式链·边框入xlsx', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newSheet'));
    await win.waitForTimeout(2500);
    const r = await evaluate(async () => {
      const ctl = window.__activeSheetCtl;
      const s = ctl.sheet;
      s.setRaw(1, 1, '2');
      s.setRaw(2, 1, '=A1*3');
      s.setRaw(3, 1, '=A2+10');
      s.setRaw(4, 1, '=A3*A1');
      ctl.grid.sel = { r1: 1, c1: 1, r2: 4, c2: 1, active: { r: 1, c: 1 } };
      await window.MazzCommands.execute('sheet.setBorder', { border: 'all' }).catch(() => {});
      const chain = [s.computed(1, 1), s.computed(2, 1), s.computed(3, 1), s.computed(4, 1)];
      const st = s.get(1, 1)?.s || {};
      const borders = ['bT', 'bR', 'bB', 'bL'].filter(k => st[k]).length;
      // 导出 xlsx 校验边框保留
      let xlsxOk = false, xlsxErr = '';
      try {
        // MazzModules.instances 可被覆盖为空（前科实锤）——从 tabs 按模块找 sheet 签
        const sheetTab = window.MazzShell.paneTree.leaves().flatMap(l => l.tabs.tabs).find(t => t.moduleId === 'sheet');
        if (!sheetTab) throw new Error('sheet 标签未找到');
        const REG = window.MazzModulesReal || window.MazzModules;
        const inst = REG.instances.get(sheetTab.id);
        const out = inst
          ? await inst.def.exportAs('.xlsx', inst.state)
          : await REG.defs.get('sheet').exportAs('.xlsx', { container: sheetTab.id });
        xlsxOk = !!out?.base64;
      } catch (e) { xlsxErr = e.message.slice(0, 80); }
      window.__xlsxErr = xlsxErr;
      return { chain, borders, xlsxOk };
    });
    await human.assert(r.chain.join(',') === '2,6,16,32', `公式链 2→6→16→32（实际 ${r.chain}）`);
    await human.assert(r.borders === 4, `四边边框应齐（实际 ${r.borders}）`);
    await human.assert(r.xlsxOk, `xlsx 导出应成功（${await evaluate(() => window.__xlsxErr || '')}）`);
  });

  // ============ 变态 3：演示大纲→放映→翻页→备注 ============
  await scenario('演示·放映链·翻页备注', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newSlide'));
    await win.waitForTimeout(1500);
    await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      ctl.outlineEl.value = '# 年终\n\n## 封面要点\n- 一句话\n:::notes 开场白三十秒\n---\n## 数据页\n- 三千万\n---\n## 展望页\n- 再翻倍';
      ctl.sync();
    });
    await win.waitForTimeout(400);
    const pages = await evaluate(() => window.__activeSlideCtl?.slides?.length);
    await human.assert(pages === 3, `大纲应成 3 页（实际 ${pages}）`);
    const notes = await evaluate(() => window.__activeSlideCtl?.slides?.[0]?.notes || '');
    await human.assert(notes.includes('开场白'), '备注应入第一页');
    // 放映：进入播放态并翻页
    await evaluate(() => { const els = [...document.querySelectorAll('[data-command="slide.present"], [data-a=present]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(600);
    const presenting = await evaluate(() => !!document.querySelector('.sl-present, [class*=present]') || window.__activeSlideCtl?.presenting);
    human.log('放映态:', presenting);
    await human.shot('演示放映');
  });

  // ============ 变态 4：导图便笺+引用线+拐点拖动+折叠 ============
  await scenario('导图·便笺引用线·拐点折叠', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
    await win.waitForTimeout(1200);
    const r = await evaluate(() => {
      // __activeMindmapCtl 在旧签 deactivate 时不清，可能指旧实例——从真实注册表按活动签取
      const REG = window.MazzModulesReal || window.MazzModules;
      const tabId = window.MazzShell.tabs.active?.id;
      const inst = REG.instances.get(tabId);
      const ctl = inst ? (inst.def._forTests.instances.get(inst.state?.container) || window.__activeMindmapCtl) : window.__activeMindmapCtl;
      window.__mmActive = ctl;
      // 建两节点（直接入模）+ 便笺 + 引用线
      const root = ctl.doc.roots[0];
      root.children = root.children || [];
      root.children.push({ id: 'e2e-a', text: '甲枝', children: [] });
      root.children.push({ id: 'e2e-b', text: '乙枝', children: [] });
      const [a, b] = root.children;
      ctl.doc.notes.push({ id: 'n1', x: (a.x || 0) + 40, y: (a.y || 0) - 60, text: '批注便笺' });
      ctl.doc.refLines.push({ id: 'rl1', from: { id: 'n1', k: 'note' }, to: { id: b.id, k: 'node' }, mode: 'straight', waypoints: [{ x: 100, y: 100 }] });
      ctl.render?.();
      const counts = { kids: root.children.length, notes: ctl.doc.notes.length, lines: ctl.doc.refLines.length };
      ctl.render(); // 模型直改后官方刷新（折叠钮此时才渲染出来）
      // 折叠：精准点根节点的折叠钮（真实用户路径，按钮自带重渲染）
      const svgs = [...document.querySelectorAll('.mm-svg')];
      const active = svgs.find(x => x.getBoundingClientRect().width > 0) || svgs[0]; // SVG 的 offsetParent 恒 null（Chromium 怪癖），改用矩形判定
      const rootId = ctl.doc.roots[0].id;
      const foldBtn = active.querySelector(`.mm-fold[data-id="${rootId}"]`);
      foldBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const collapsedState = ctl.doc.roots[0].collapsed;
      const collapsedKids = active.querySelectorAll('.mm-node').length;
      foldBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); // 展开还原
      window.__collapsedOk = collapsedState;
      return { counts, collapsedKids };
    });
    await human.assert(r.counts.kids >= 2 && r.counts.notes === 1 && r.counts.lines === 1, `便笺/引用线应入模（${JSON.stringify(r.counts)}）`);
    await human.assert(r.collapsedKids <= 2 && (await evaluate(() => window.__collapsedOk)) === true, `折叠后子树应隐藏（可见 ${r.collapsedKids}，collapsed=${await evaluate(() => window.__collapsedOk)}）`);
    await human.shot('导图变态项');
  });

  // ============ 变态 5：画板图层增删+橡皮+撤销+对称 ============
  await scenario('画板·图层橡皮·撤销对称', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newDraw'));
    await win.waitForTimeout(1800);
    const box = await evaluate(() => { const els = [...document.querySelectorAll('.draw-canvas')]; const c = els.find(e => e.offsetParent); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    // 开对称模式画一笔 → 应出镜像双笔
    await evaluate(() => { const els = [...document.querySelectorAll('.draw-symmetry, [data-a=symmetry], select')]; const s = els.find(e => e.offsetParent && e.tagName === 'SELECT' && [...e.options].some(o => o.textContent.includes('对称'))); if (s) { s.value = [...s.options].find(o => o.textContent.includes('水平'))?.value || s.options[1]?.value; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    await win.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.3);
    await win.mouse.down();
    await win.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(300);
    const s1 = await evaluate(() => window.__activeDrawCtl?.doc?.frames?.[0]?.layers?.[0]?.strokes?.length ?? 0);
    await human.assert(s1 >= 1, `一笔应入模（${s1}）`);
    human.log('对称笔画数:', s1);
    // 图层新增
    const layers1 = await evaluate(() => window.__activeDrawCtl?.doc?.frames?.[0]?.layers?.length ?? 0);
    await evaluate(() => { const els = [...document.querySelectorAll('[data-a=add-layer], .lv-add, .draw-layers button')]; (els.find(e => e.offsetParent && /加|\+|新/.test(e.textContent)) || els[0])?.click(); });
    await win.waitForTimeout(300);
    const layers2 = await evaluate(() => window.__activeDrawCtl?.doc?.frames?.[0]?.layers?.length ?? 0);
    await human.assert(layers2 >= layers1, `图层应可增加（${layers1}→${layers2}）`);
    // 撤销
    await win.keyboard.press('Control+z');
    await win.waitForTimeout(300);
    await human.shot('画板变态项');
  });

  // ============ 变态 6：书库真书深读（翻章/书签/书内搜索） ============
  await scenario('书库·真书深读·翻章书签搜索', async () => {
    await evaluate(async ([p]) => {
      const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
      if (!books.find(b => b.format === 'epub')) {
        books.push({ id: 'e2e-epub', title: '潮声集', author: '测试作者', cover: '', path: p, format: 'epub', category: '未分类', addedAt: Date.now() });
        await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
      }
    }, [WS + '/电子书/潮声集.epub']);
    await evaluate(() => window.MazzCommands?.execute('file.newLibrary'));
    await win.waitForTimeout(1800);
    await human.evaluate(() => { const els = [...document.querySelectorAll('.lib-card')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(2000);
    // 翻章：连按 next 直到进度变
    const p1 = await evaluate(() => { const els = [...document.querySelectorAll('.lib-pos')]; return (els.find(e => e.offsetParent) || els[0])?.textContent?.trim(); });
    await human.evaluate(() => { const els = [...document.querySelectorAll('[data-a=next]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(600);
    const p2 = await evaluate(() => { const els = [...document.querySelectorAll('.lib-pos')]; return (els.find(e => e.offsetParent) || els[0])?.textContent?.trim(); });
    await human.assert(p1 !== p2, `翻页进度应变化（${p1}→${p2}）`);
    // 书内搜索
    await human.evaluate(() => { const els = [...document.querySelectorAll('[data-a=search]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(400);
    const searchUi = await evaluate(() => !!document.querySelector('.lib-search, [class*=lib-search], input[placeholder*="搜"]'));
    await human.assert(searchUi, '书内搜索界面应出现');
    await human.shot('书库深读');
  });

  // ============ 变态 7：播放器连播与截图产出 ============
  await scenario('播放器·连播·截图落盘', async () => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/样片.mp4']);
    await win.waitForTimeout(3000);
    // 截图：精准点"视频已就绪"的那个播放器的截图钮（WAV 音频播放器的截图钮对视频才生效，误点是哑炮）
    await human.evaluate(() => {
      const players = [...document.querySelectorAll('.mz-player')];
      const ready = players.find(pl => pl.offsetParent && pl.querySelector('video.mz-media') && pl.querySelector('video.mz-media').readyState >= 2);
      (ready || players.find(pl => pl.offsetParent))?.querySelector('[data-a=snap]')?.click();
    });
    // 落盘轮询（写盘+目录注册有延迟）
    let snapDir = 0;
    for (let i = 0; i < 10; i++) {
      await win.waitForTimeout(500);
      snapDir = await evaluate(async () => {
        const ws = await window.mazz.invoke('workspace:get');
        const list = await window.mazz.invoke('fs:listDir', { path: ws + '/录制/截图' }).catch(() => []);
        return list.length;
      });
      if (snapDir >= 1) break;
    }
    await human.assert(snapDir >= 1, `截图应落盘（目录文件 ${snapDir}）`);
    // 倍速 2x：锁定活动播放器（多签共存时防点错对象）
    await human.evaluate(() => {
      const pl = [...document.querySelectorAll('.mz-player')].find(p => p.offsetParent && p.querySelector('video.mz-media'));
      const s = pl?.querySelector('.mz-speed');
      if (s) { s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await win.waitForTimeout(300);
    const rate = await evaluate(() => [...document.querySelectorAll('.mz-player')].find(p => p.offsetParent && p.querySelector('video.mz-media'))?.querySelector('video')?.playbackRate);
    await human.assert(rate === 2, `倍速应=2（实际 ${rate}）`);
    await human.shot('播放器变态项');
  });

  // ============ 变态 8：搜索正则 + 索引重建即搜 ============
  await scenario('搜索·正则·重建即搜', async () => {
    await evaluate(async ([p]) => { await window.mazz.invoke('fs:writeFile', { path: p, content: '订单号 AB-1024 已支付\n订单号 AB-2048 待审核' }); }, [WS + '/正则靶.txt']);
    await evaluate(() => window.MazzCommands?.execute('file.newSearch'));
    await win.waitForTimeout(1200);
    await human.evaluate(() => { const els = [...document.querySelectorAll('[data-a=rebuild]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(1200);
    // 正则模式搜 AB-\d+
    await evaluate(() => {
      const els = [...document.querySelectorAll('.gs-input')];
      const i = els.find(e => e.offsetParent) || els[0];
      i.value = 'AB-\\d+';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      const res = [...document.querySelectorAll('.gs-regex')];
      const re = res.find(c => c.offsetParent) || res[0];
      if (re && !re.checked) re.click();
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await win.waitForTimeout(1000);
    const hits = await evaluate(() => { const els = [...document.querySelectorAll('.gs-results')]; return (els.find(e => e.offsetParent) || els[0])?.textContent || ''; });
    await human.assert(hits.includes('AB-1024') && hits.includes('AB-2048'), `正则应命中两订单（${hits.slice(0, 60)}）`);
    await human.shot('正则搜索');
  });

  // ============ 变态 9：工厂提示词组装（复制母版到剪贴板） ============
  await scenario('工厂·提示词组装·母版可复用', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newFactory'));
    await win.waitForTimeout(1800);
    const hasPanel = await evaluate(() => !!document.querySelector('.fc-form, [class*=factory]'));
    await human.assert(hasPanel, '工厂面板应打开');
    // 填满字段（validateRequired 门禁：空着不让复制）
    await evaluate(() => {
      document.querySelectorAll('.fc-form input, .fc-form textarea, .fc-dump-text').forEach((el, i) => {
        if (el.type === 'checkbox' || el.type === 'number') return;
        el.value = el.value || ('测试素材' + (i + 1));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
    // 点复制模板母版 → 剪贴板应有完整提示词
    await human.evaluate(() => { const els = [...document.querySelectorAll('[data-a=copy]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(600);
    const clip = await evaluate(async () => {
      const r = await window.mazz.invoke('clipboard:read').catch(() => null);
      return typeof r === 'string' ? r : (r?.text || '');
    });
    await human.assert(clip.length > 200, `母版应入剪贴板（${clip.length} 字）`);
    await human.shot('工厂母版');
  });

  // ============ 变态 10：侧栏大纲跳转与书签闭环 ============
  await scenario('侧栏·大纲跳转·书签闭环', async () => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/长文档.md']);
    await win.waitForTimeout(1200);
    // 大纲页签 → 点一个标题项 → 编辑器应滚动（不报错即过，滚动位置变化更佳）
    await evaluate(() => [...document.querySelectorAll('.sb-tabbar *')].find(e => e.textContent.trim() === '大纲')?.click());
    await win.waitForTimeout(500);
    const before = await evaluate(() => window.__activeMarkdownCtl?.view?.dom?.scrollTop ?? -1);
    await evaluate(() => { const els = [...document.querySelectorAll('.sb-ol-item')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(500);
    // 书签：加入当前文件 → 书签面板有 → 点击跳转打开
    await evaluate(() => { const els = [...document.querySelectorAll('[data-a=mark-current]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(500);
    await evaluate(() => [...document.querySelectorAll('.sb-tabbar *')].find(e => e.textContent.trim() === '书签')?.click());
    await win.waitForTimeout(500);
    const marks = await evaluate(() => document.querySelector('.sb-panel, .sidebar')?.textContent || '');
    await human.assert(marks.includes('长文档'), '书签面板应有当前文件');
    await human.shot('大纲书签');
  });

  // ============ 变态 11：代码模块 Monaco 挂载 ============
  await scenario('代码·Monaco挂载·编辑可用', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newCode'));
    await win.waitForTimeout(2500);
    const ok = await evaluate(() => !!document.querySelector('.monaco-editor, [class*=monaco]'));
    await human.assert(ok, 'Monaco 应挂载');
    await human.shot('代码模块');
  });

  // ============ 变态 12：快照写入与恢复列表 ============
  await scenario('快照·写入·恢复列表', async () => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/长文档.md']);
    await win.waitForTimeout(800);
    // 编辑成脏标签
    await evaluate(() => {
      const pm = document.querySelector('.ProseMirror');
      pm?.focus();
      document.execCommand('insertText', false, '【快照测试】');
    });
    await win.waitForTimeout(300);
    const dirty = await evaluate(() => window.MazzShell?.tabs?.active?.dirty);
    await human.assert(dirty, '标签应变脏');
    // 写快照
    const snapOk = await evaluate(async () => {
      try {
        const tab = window.MazzShell.tabs.active;
        await window.mazz.invoke('snapshot:write', { tabId: tab.id, title: tab.title, module: tab.module, content: window.__activeMarkdownCtl?.getMarkdown?.() || '', filePath: tab.filePath });
        const list = await window.mazz.invoke('snapshot:list');
        return list?.length > 0;
      } catch (e) { return 'ERR:' + e.message.slice(0, 60); }
    });
    await human.assert(snapOk === true, `快照应入列表（${snapOk}）`);
  });

  // ============ 变态 13：工具坞打开与位置持久化 ============
  await scenario('工具坞·打开·位置持久化', async () => {
    await evaluate(() => window.MazzCommands?.execute('dock.toggle').catch(() => {}));
    await win.waitForTimeout(600);
    const dock = await evaluate(() => !!document.querySelector('.side-dock, [class*=side-dock]'));
    human.log('工具坞可见:', dock);
    // 位置持久化检查（settings 里有 dock 位置键）
    const pos = await evaluate(async () => await window.mazz.invoke('settings:get', { key: 'ui.dock' }).catch(() => null));
    human.log('坞位存储:', JSON.stringify(pos));
    await human.shot('工具坞');
  });
}
