// tests/e2e/scenes-library.mjs —— 书库遗留专项：mobi 小说 / GBK 虚标 / cbz 漫画 全实证
export async function scenesLibrary({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => human.evaluate(fn, arg);

  const registerBook = (p, title, format, author = '测试作者') => evaluate(async ([pp, tt, ff, aa]) => {
    const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
    if (!books.find(b => b.path === pp)) {
      books.push({ id: 'e2e-' + ff, title: tt, author: aa, cover: '', path: pp, format: ff, category: '未分类', addedAt: Date.now() });
      await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
    }
  }, [p, title, format, author]);

  const openBookByTitle = async (title) => {
    await evaluate(() => window.MazzCommands?.execute('file.newLibrary'));
    await win.waitForTimeout(1500);
    await human.evaluate(([t]) => {
      const cards = [...document.querySelectorAll('.lib-card')];
      const c = cards.find(x => x.offsetParent && x.textContent.includes(t)) || cards.find(x => x.offsetParent);
      c?.click();
    }, [title]);
    await win.waitForTimeout(1800);
  };

  await scenario('书库·mobi小说·解析无乱码', async () => {
    await registerBook(WS + '/书库/渡口集.mobi', '渡口集', 'mobi');
    await openBookByTitle('渡口集');
    const inReader = await evaluate(() => !!document.querySelector('.lib-reader-bar'));
    await human.assert(inReader, 'mobi 应进阅读室');
    const text = await evaluate(() => { const els = [...document.querySelectorAll('.lib-page')]; return (els.find(e => e.offsetParent) || els[0])?.textContent || ''; });
    await human.assert(text.includes('暮色压着水面'), `mobi 正文应正确解析（实际：${text.slice(0, 40)}）`);
    await human.assert(!text.includes('�'), 'mobi 正文不得有乱码字符');
    await human.shot('mobi阅读');
  });

  await scenario('书库·GBK虚标·嗅探救回', async () => {
    await registerBook(WS + '/书库/虚标集.mobi', '虚标集', 'mobi');
    await openBookByTitle('虚标集');
    const text = await evaluate(() => { const els = [...document.querySelectorAll('.lib-page')]; return (els.find(e => e.offsetParent) || els[0])?.textContent || ''; });
    await human.assert(text.includes('暮色压着水面'), `虚标正文应由语言命中率嗅探救回（实际：${text.slice(0, 40)}）`);
    await human.assert(!text.includes('�'), '虚标正文不得有乱码字符');
    // 标题也不许乱码（标题嗅探修复实证）
    const title = await evaluate(() => { const els = [...document.querySelectorAll('.lib-book-title')]; return (els.find(e => e.offsetParent) || els[0])?.textContent || document.title; });
    await human.assert(!title.includes('�'), `虚标标题不得乱码（${title.slice(0, 30)}）`);
    await human.shot('虚标救回');
  });

  await scenario('书库·cbz漫画·双页按图配对', async () => {
    await registerBook(WS + '/书库/三色漫画.cbz', '三色漫画', 'cbz');
    await openBookByTitle('三色漫画');
    // 切双页
    await human.evaluate(() => { const els = [...document.querySelectorAll('.lib-mode')]; const s = els.find(e => e.offsetParent); if (s) { s.value = 'double'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    await win.waitForTimeout(1200);
    const imgs = await evaluate(() => document.querySelectorAll('.lib-double img, .lib-page img').length);
    await human.assert(imgs >= 2, `cbz 双页应并排出两张图（实际 ${imgs}）`);
    await human.shot('cbz双页');
  });
}
