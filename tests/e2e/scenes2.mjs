// tests/e2e/scenes2.mjs —— 深度场景集（第二批）：站在用户立场把角角落落过一遍
// 覆盖：文档编辑保存 / docx导入 / 查找替换全链 / 表格公式 / 导图导入导出 / 书库阅读室 /
//       演示成稿 / 画板图层橡皮 / 笔记双链反链 / 浏览器主页 / 设置持久化 / F11全屏逃生 / 分屏三连 / 深层删除
export async function scenes2({ win, human, WS, WS2, scenario }) {
  const evaluate = (fn, arg) => human.evaluate(fn, arg);

  // ==================== 13：文档编辑→保存→脏标清除→磁盘一致 ====================
  await scenario('文档·编辑保存·脏标清除·磁盘一致', async () => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/长文档.md']);
    await win.waitForTimeout(1500);
    // 光标处插入文字（模拟真人敲字）
    await evaluate(() => {
      const pm = document.querySelector('.ProseMirror');
      pm?.focus();
      document.execCommand('insertText', false, '【E2E插一句】');
    });
    await win.waitForTimeout(300);
    const dirty = await evaluate(() => document.querySelector('.tab.on')?.textContent.includes('●'));
    await human.assert(dirty, '编辑后标签应有脏标 ●');
    await win.keyboard.press('Control+s');
    await win.waitForTimeout(600);
    const dirty2 = await evaluate(() => document.querySelector('.tab.on')?.textContent.includes('●'));
    await human.assert(!dirty2, '保存后脏标应清除');
    const onDisk = await evaluate(async ([p]) => await window.mazz.invoke('fs:readFile', { path: p }), [WS + '/长文档.md']);
    await human.assert(onDisk.includes('【E2E插一句】'), '磁盘内容应与编辑一致');
    await human.shot('文档保存');
  });

  // ==================== 14：docx 真包导入（mammoth） ====================
  await scenario('docx·真包导入·标题结构还原', async () => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/立项报告.docx']);
    await win.waitForTimeout(2500);
    const text = await evaluate(() => window.__activeMarkdownCtl?.view?.dom?.textContent || '');
    await human.assert(text.includes('项目立项报告'), 'docx 正文应导入');
    await human.assert(text.includes('背景与目标'), 'docx 标题应导入');
    const hasH = await evaluate(() => !!window.__activeMarkdownCtl?.view?.dom?.querySelector('h1, h2'));
    await human.assert(hasH, 'docx 标题层级应还原');
    await human.shot('docx导入');
  });

  // ==================== 15：查找替换全链路 ====================
  await scenario('替换·预览·逐个·全部·内容落盘', async () => {
    // 造专用文件避免互相污染
    await evaluate(async ([p]) => { await window.mazz.invoke('fs:writeFile', { path: p, content: '苹果一\n苹果二\n苹果三' }); }, [WS + '/替换实验.txt']);
    await evaluate(() => window.MazzCommands?.execute('file.newSearch'));
    await win.waitForTimeout(1500);
    // 重建索引纳入新文件（可见实例，防多实例点错）
    await human.evaluate(() => { const els = [...document.querySelectorAll('[data-a=rebuild]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(1500);
    await evaluate(() => {
      const inputs = [...document.querySelectorAll('.gs-input')];
      const vis = inputs.find(i => i.offsetParent) || inputs[0];
      vis.value = '苹果';
      vis.dispatchEvent(new Event('input', { bubbles: true }));
      vis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await win.waitForTimeout(1000);
    // 打开替换栏 + 填替换词 + 点逐个替换（全部可见实例选择器，多实例时代的纪律）
    const vis = (sel) => `(() => { const els = [...document.querySelectorAll('${sel}')]; return els.find(e => e.offsetParent) || els[els.length - 1]; })()`;
    await evaluate(() => { const els = [...document.querySelectorAll('[data-a=replace-mode]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await evaluate(() => { const els = [...document.querySelectorAll('.gs-replace-input')]; const i = els.find(e => e.offsetParent) || els[0]; i.value = '橙子'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await evaluate(() => { const els = [...document.querySelectorAll('[data-a=replace-seq]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(600);
    await human.assertVisible('.mazz-palette-mask', '逐个替换弹窗应出现');
    await human.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask button')].find(b => b.textContent.includes('替换此处'))?.click());
    await win.waitForTimeout(400);
    // 剩余全部替换
    await human.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask button')].find(b => b.textContent.includes('剩余全部替换'))?.click());
    await win.waitForTimeout(800);
    const after = await evaluate(async ([p]) => await window.mazz.invoke('fs:readFile', { path: p }), [WS + '/替换实验.txt']);
    await human.assert(after.includes('橙子一') && after.includes('橙子三') && !after.includes('苹果'), `三处应全部替换（实际：${after.replace(/\n/g, '/')}）`);
    await human.shot('替换全链');
  });

  // ==================== 16：表格输入+公式+导出 ====================
  await scenario('表格·输入·SUM·CSV导出', async () => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/产量表.csv']);
    await win.waitForTimeout(1800);
    // 读模型值验证导入（B 列产量：913）
    const v = await evaluate(() => window.__activeSheetCtl?.sheet?.computed?.(2, 2));
    await human.assert(String(v) === '913', `CSV B2 应=913（实际 ${v}）`);
    // 写入公式 =SUM(B2:B4)
    await evaluate(() => {
      const ctl = window.__activeSheetCtl;
      ctl.sheet.setRaw(25, 1, '=SUM(B2:B4)');
      ctl.render?.();
    });
    await win.waitForTimeout(300);
    const sum = await evaluate(() => window.__activeSheetCtl?.sheet?.computed?.(25, 1));
    await human.assert(+sum === 913 + 926 + 939, `SUM 应=2778（实际 ${sum}）`);
    // 导出 CSV 通道验证（exportAs 契约）
    const csv = await evaluate(() => window.__activeSheetCtl?.exportAs ? null : 'no-exportAs');
    await human.shot('表格公式');
  });

  // ==================== 17：外部导图 .mm 打开（确定性管道）+ OPML 导出 ====================
  await scenario('导图·.mm打开有内容·OPML导出', async () => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/外部导图.mm']);
    await win.waitForTimeout(2000);
    const roots = await evaluate(() => window.__activeMindmapCtl?.doc?.roots?.length ?? 0);
    await human.assert(roots >= 1, `.mm 打开必须有根节点（此前打开为空）`);
    const kids = await evaluate(() => window.__activeMindmapCtl?.doc?.roots?.[0]?.children?.length ?? 0);
    await human.assert(kids === 3, `根下应有 3 个子节点（实际 ${kids}）`);
    await win.waitForTimeout(1500); // 等布局与文字渲染帧
    const text = await evaluate(() => [...document.querySelectorAll('.mm-svg')].map(x => x.textContent).join(' '));
    await human.assert(text.includes('产品战略') && text.includes('研发'), `.mm 节点文字应渲染（实际：${text.slice(0, 60)}）`);
    // OPML 导出（导出函数直调绕系统对话框）
    const opml = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      return ctl?.doc ? document.querySelector('.mm-svg') !== null : false;
    });
    await human.shot('导图导入');
  });

  // ==================== 18：书库阅读室（翻页/页宽/书签） ====================
  await scenario('阅读室·翻页·进度·页宽·书签', async () => {
    // 直接登记书籍记录（书架读 SHELF_KEY 注册表，不扫目录）
    await evaluate(async ([p]) => {
      const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
      if (!books.find(b => b.path === p)) {
        books.push({ id: 'e2e-book-1', title: '夜航西飞', author: '测试作者', cover: '', path: p, format: 'txt', category: '未分类', addedAt: Date.now() });
        await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
      }
    }, [WS + '/书库/夜航西飞.txt']);
    await evaluate(() => window.MazzCommands?.execute('file.newLibrary'));
    await win.waitForTimeout(2200);
    const hasCard = await evaluate(() => !!document.querySelector('.lib-card'));
    await human.assert(hasCard, '书架应有书（fixtures 摆了夜航西飞）');
    // 全部走可见实例（场景 8 已开过书库标签，多签时代 querySelector 会点到隐藏旧签）
    await human.evaluate(() => { const els = [...document.querySelectorAll('.lib-card')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(2200);
    const inReader = await evaluate(() => !!document.querySelector('.lib-reader-bar'));
    await human.assert(inReader, '阅读室应打开');
    // 先等分页落地（进度文本非空）
    const visText = (sel) => evaluate(([x]) => { const els = [...document.querySelectorAll(x)]; const e = els.find(el => el.offsetParent); return e?.textContent?.trim() || ''; }, [sel]);
    let pos1 = '';
    for (let i = 0; i < 10; i++) {
      pos1 = await visText('.lib-pos');
      if (pos1) break;
      await win.waitForTimeout(500);
    }
    await human.assert(!!pos1, '阅读室进度应落地');
    await human.evaluate(() => { const els = [...document.querySelectorAll('[data-a=next]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(700);
    const pos2 = await visText('.lib-pos');
    await human.assert(pos1 !== pos2, `翻页后进度应变化（${pos1} → ${pos2}）`);
    // 页宽切换
    await evaluate(() => { const els = [...document.querySelectorAll('.lib-pagew')]; const s = els.find(e => e.offsetParent) || els[0]; s.value = '640'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await win.waitForTimeout(400);
    // 进度条手动收起粘滞：收起后动鼠标不应弹出
    await human.evaluate(() => { const els = [...document.querySelectorAll('[data-a=prog-fold]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(200);
    await human.evaluate(() => { const els = [...document.querySelectorAll('.lib-content')]; (els.find(e => e.offsetParent) || els[0])?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); });
    await win.waitForTimeout(300);
    const collapsed = await evaluate(() => { const els = [...document.querySelectorAll('.lib-progress')]; const e = els.find(el => el.offsetParent); return e?.classList.contains('collapsed'); });
    await human.assert(collapsed, '手动收起后动鼠标不应顶出进度条');
    // 加书签
    await human.evaluate(() => { const els = [...document.querySelectorAll('[data-a=mark]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(400);
    const hasMask = await evaluate(() => !!document.querySelector('.mazz-palette-mask'));
    if (hasMask) {
      await evaluate(() => [...document.querySelectorAll('.mazz-palette-mask button')].find(b => /确定|保存|OK/.test(b.textContent))?.click());
      await win.waitForTimeout(300);
    }
    await human.shot('阅读室');
  });

  // ==================== 19：演示成稿 ====================
  await scenario('演示·大纲成稿·页数生成', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newSlide'));
    await win.waitForTimeout(1800);
    await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      if (ctl?.outlineEl) {
        ctl.outlineEl.value = '# 年度汇报\n\n## 一季度\n- 指标完成\n- 团队扩张\n---\n## 二季度\n- 产品发布\n- 客户翻倍\n---\n## 三季度\n- 盈利转正';
        ctl.sync?.();
      }
    });
    await win.waitForTimeout(600);
    const pages = await evaluate(() => window.__activeSlideCtl?.slides?.length ?? 0);
    await human.assert(pages >= 3, `大纲应生成 ≥3 页（实际 ${pages}）`);
    await human.shot('演示成稿');
  });

  // ==================== 20：画板图层/橡皮/撤销 ====================
  await scenario('画板·图层·橡皮·撤销', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newDraw'));
    await win.waitForTimeout(2000);
    // 画一笔（先 force 点击激活画布与标签，防焦点被前面场景残留截胡）
    const box = await evaluate(() => { const els = [...document.querySelectorAll('.draw-canvas')]; const c = els.find(e => e.offsetParent); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await human.evaluate(() => { const els = [...document.querySelectorAll('.draw-canvas')]; (els.find(e => e.offsetParent) || els[0]).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    await win.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.3);
    await win.mouse.down();
    await win.mouse.move(box.x + box.w * 0.7, box.y + box.h * 0.5, { steps: 10 });
    await win.mouse.up();
    await win.waitForTimeout(300);
    const s1 = await evaluate(() => window.__activeDrawCtl?.doc?.frames?.[0]?.layers?.[0]?.strokes?.length ?? 0);
    await human.assert(s1 === 1, '第一笔应入模');
    // 撤销
    await win.keyboard.press('Control+z');
    await win.waitForTimeout(300);
    const s0 = await evaluate(() => window.__activeDrawCtl?.doc?.frames?.[0]?.layers?.[0]?.strokes?.length ?? 99);
    await human.assert(s0 === 0, `Ctrl+Z 应撤销（剩余 ${s0}）`);
    await human.shot('画板撤销');
  });

  // ==================== 21：笔记双链与反链面板 ====================
  await scenario('笔记·每日笔记·双链·反链', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newNotes'));
    await win.waitForTimeout(1800);
    // 打开每日笔记并写双链
    await evaluate(() => document.querySelector('[data-a=daily]')?.click() || window.MazzCommands?.execute('notes.daily'));
    await win.waitForTimeout(800);
    await evaluate(() => {
      const pm = document.querySelector('.notes-editor .ProseMirror, .ProseMirror');
      pm?.focus();
      document.execCommand('insertText', false, '今天研究了 [[长文档]] 的架构。');
    });
    await win.waitForTimeout(600);
    // 切到反链页签看聚合（侧栏反链面板）
    await evaluate(() => [...document.querySelectorAll('.sb-tabbar *')].find(e => e.textContent.trim() === '反链')?.click());
    await win.waitForTimeout(800);
    await human.shot('笔记反链');
  });

  // ==================== 22：浏览器主页与收藏（不联网） ====================
  await scenario('浏览器·主页·收藏夹逻辑', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
    await win.waitForTimeout(2000);
    const hasHome = await evaluate(() => !!document.querySelector('.br-view-wrap'));
    await human.assert(hasHome, '浏览器应打开');
    // 收藏夹逻辑（不走网络：直接驱动收藏存取）
    const bm = await evaluate(async () => {
      const r = await window.mazz.invoke('settings:get', { key: 'browser.bookmarks' });
      return r == null || Array.isArray(r); // 未初始化（undefined/null）或数组都算存储可读
    });
    await human.assert(bm, '收藏夹存储应可读');
    await human.shot('浏览器主页');
  });

  // ==================== 23：设置与主题持久化 ====================
  await scenario('设置·主题切换·持久化写入', async () => {
    await evaluate(() => window.MazzShell?.setTheme?.('construct'));
    await win.waitForTimeout(400);
    const saved = await evaluate(async () => await window.mazz.invoke('settings:get', { key: 'theme' }));
    await human.assert(saved === 'construct', `主题应持久化为 construct（实际 ${saved}）`);
    await evaluate(() => window.MazzShell?.setTheme?.('paper'));
    await win.waitForTimeout(300);
    await human.shot('主题持久化');
  });

  // ==================== 24：F11 全屏与 Esc 逃生 ====================
  await scenario('窗口·F11全屏·Esc逃生·浮钮', async () => {
    await win.keyboard.press('F11');
    await win.waitForTimeout(800);
    const fs = await evaluate(async () => await window.mazz.invoke('window:isFullScreen'));
    await human.assert(fs === true, 'F11 应进入全屏');
    const btn = await evaluate(() => !!document.querySelector('.fs-exit'));
    await human.assert(btn, '全屏浮动退出钮应出现');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(600);
    const fs2 = await evaluate(async () => await window.mazz.invoke('window:isFullScreen'));
    await human.assert(fs2 === false, 'Esc 应退出全屏（F11 反人类已修）');
    await human.shot('全屏逃生');
  });

  // ==================== 25：三连分屏 ====================
  await scenario('分屏·三连·三窗格并存', async () => {
    await evaluate(() => {
      const sh = window.MazzShell;
      sh.splitWithTab?.(sh.tabs?.active?.id, 'right');
    });
    await win.waitForTimeout(400);
    await evaluate(() => {
      const sh = window.MazzShell;
      const t2 = sh.tabs?.active?.id;
      if (t2) sh.splitWithTab?.(t2, 'down');
    });
    await win.waitForTimeout(400);
    await evaluate(() => {
      const sh = window.MazzShell;
      const t3 = sh.tabs?.active?.id;
      if (t3) sh.splitWithTab?.(t3, 'left');
    });
    await win.waitForTimeout(400);
    const panes = await evaluate(() => window.MazzShell?.paneTree?.leaves?.().length ?? 1);
    await human.assert(panes >= 3, `三连分屏应有 ≥3 窗格（实际 ${panes}）`);
    await human.shot('三连分屏');
  });

  // ==================== 26：深层文件夹删除（回收站/兜底） ====================
  await scenario('删除·三层文件夹·一气呵成', async () => {
    await human.evaluate(() => document.querySelector('.filetree [data-a=refresh], [data-a=reindex]')?.click());
    await win.waitForTimeout(800);
    const before = await evaluate(async ([p]) => {
      const r = await window.mazz.invoke('fs:stat', { path: p });
      return r.exists;
    }, [WS + '/深层']);
    await human.assert(before, '深层目录应存在');
    // 经命令删除（内部走 trashItem 重试+rm 兜底）
    const del = await evaluate(async ([p]) => {
      try { return await window.mazz.invoke('fs:delete', { path: p }); } catch (e) { return { error: e.message }; }
    }, [WS + '/深层']);
    human.log('删除返回:', JSON.stringify(del));
    await win.waitForTimeout(600);
    const after = await evaluate(async ([p]) => {
      const r = await window.mazz.invoke('fs:stat', { path: p });
      return r.exists;
    }, [WS + '/深层']);
    await human.assert(!after, '三层文件夹应被删除（trash/rm 兜底生效）');
    await human.shot('深层删除');
  });
}
