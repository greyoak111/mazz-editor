// tests/e2e/scenes-icons.mjs —— emoji 歼灭验收：全模块巡检，图标位 emoji 零容忍
// 范围：按钮/标签/工具栏/侧栏/ribbon/文件树/欢迎页/阅读室/播放器/工具坞/画板工具条/命令面板
// 豁免：帮助文档正文、工厂主控台日志文本、toast 文本、文档内容、i18n 语言名
export async function scenesIcons({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => human.evaluate(fn, arg);

  const EMOJI_RE = '[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]';

  // 几何文本符号白名单（排版符号，非 pictograph）
  const GLYPH_OK = new Set(['✕', '✓', '✗', '‹', '›', '▾', '▴', '≡', '☰', '◀', '▶', '⇤', '⌄', '▢', '❐']);

  /** 扫描当前 DOM 图标位 emoji（按钮/工具栏/侧栏/标签/ribbon/文件树/工具条） */
  const scan = () => evaluate(([re, ok]) => {
    const OK = new Set(ok);
    const sel = 'button, .rb-btn, .fc-mini, .sb-tab, .sb-tbtn, .mz-btn, .sd-btn, .sd-tool-card, .ft-ico, .lib-card-cat, .ribbon-tab, .tab, .w-card, .fc-label, .sd-tools-label, .mm-sb-btn, .lv-vis, select';
    const hits = [];
    const re2 = new RegExp(re, 'u');
    document.querySelectorAll(sel).forEach(el => {
      if (!el.offsetParent) return;
      // SVG 图标不算（已消灭），只查文本节点里的 emoji
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (re2.test(n.textContent) && ![...n.textContent.trim()].every(c => OK.has(c))) hits.push((el.className || el.tagName) + '➤' + n.textContent.trim().slice(0, 16));
      }
    });
    return hits.slice(0, 12);
  }, [EMOJI_RE, [...GLYPH_OK]]);

  // 模块巡检清单：[名称, 打开方式]
  const MODULES = [
    ['文档', async () => { await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/长文档.md']); }],
    ['表格', async () => { await evaluate(() => window.MazzCommands?.execute('file.newSheet')); }],
    ['演示', async () => { await evaluate(() => window.MazzCommands?.execute('file.newSlide')); }],
    ['导图', async () => { await evaluate(() => window.MazzCommands?.execute('file.newMindmap')); }],
    ['画板', async () => { await evaluate(() => window.MazzCommands?.execute('file.newDraw')); }],
    ['笔记', async () => { await evaluate(() => window.MazzCommands?.execute('file.newNotes')); }],
    ['搜索', async () => { await evaluate(() => window.MazzCommands?.execute('file.newSearch')); }],
    ['浏览器', async () => { await evaluate(() => window.MazzCommands?.execute('file.newBrowser')); }],
    ['代码', async () => { await evaluate(() => window.MazzCommands?.execute('file.newCode')); }],
  ];

  await scenario('图标歼灭·全模块巡检零容忍', async () => {
    for (const [name, open] of MODULES) {
      await open();
      await win.waitForTimeout(900);
      const hits = await scan();
      await human.assert(!hits.length, `${name}模块图标位不得有 emoji（${hits.join('；') || '无'}）`);
    }
  });

  await scenario('图标歼灭·书库与阅读室（真书核查）', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newLibrary'));
    await win.waitForTimeout(1500);
    let hits = await scan();
    await human.assert(!hits.length, `书库书架图标位不得有 emoji（${hits.join('；') || '无'}）`);
    // 打开真 epub 进阅读室核查
    await evaluate(async ([p]) => {
      const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
      if (!books.find(b => b.format === 'epub')) {
        books.push({ id: 'e2e-epub', title: '潮声集', author: '测试作者', cover: '', path: p, format: 'epub', category: '未分类', addedAt: Date.now() });
        await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
      }
    }, [WS + '/电子书/潮声集.epub']);
    await win.waitForTimeout(1000);
    await evaluate(() => window.MazzCommands?.execute('file.newLibrary'));
    await win.waitForTimeout(1500);
    await human.evaluate(() => { const els = [...document.querySelectorAll('.lib-card')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
    await win.waitForTimeout(2000);
    hits = await scan();
    await human.assert(!hits.length, `阅读室图标位不得有 emoji（${hits.join('；') || '无'}）`);
    await human.shot('阅读室图标核查');
  });

  await scenario('图标歼灭·播放器（真视频核查）', async () => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/样片.mp4']);
    await win.waitForTimeout(3000);
    const hits = await scan();
    await human.assert(!hits.length, `播放器图标位不得有 emoji（${hits.join('；') || '无'}）`);
    await human.shot('播放器图标核查');
  });

  await scenario('图标歼灭·命令面板与欢迎页', async () => {
    await win.keyboard.press('Control+Shift+P');
    await win.waitForTimeout(600);
    let hits = await evaluate((re) => {
      const re2 = new RegExp(re, 'u');
      const hits = [];
      document.querySelectorAll('.mazz-palette-item .pi-icon, .mazz-palette-item').forEach(el => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) if (re2.test(n.textContent)) hits.push(n.textContent.trim().slice(0, 16));
      });
      return hits.slice(0, 10);
    }, EMOJI_RE);
    await human.assert(!hits.length, `命令面板不得有 emoji（${hits.join('；') || '无'}）`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    // 欢迎页
    await human.evaluate(() => window.MazzShell?.showWelcome?.());
    await win.waitForTimeout(400);
    hits = await scan();
    await human.assert(!hits.length, `欢迎页不得有 emoji（${hits.join('；') || '无'}）`);
    await human.shot('欢迎页图标核查');
  });

  await scenario('图标歼灭·等高体系生效', async () => {
    const sizes = await evaluate(() => {
      const out = new Set();
      document.querySelectorAll('.mz-ico').forEach(s => {
        const r = s.getBoundingClientRect();
        if (r.width) out.add(Math.round(r.width) + 'x' + Math.round(r.height));
      });
      return [...out];
    });
    await human.assert(sizes.length <= 3, `图标尺寸应收敛到 ≤3 档（实际 ${sizes.join(',')}）`);
    await human.assert(sizes.every(s => s.split('x')[0] === s.split('x')[1]), '图标必须宽高相等（正方形）');
  });
}
