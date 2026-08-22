// tests/e2e/scenes7.mjs —— 波次十八「再造书库」回归批
// 沙箱帧隔离/步进几何/贴网自矫正/内容锚进度/漫画内存纪律/滚动帧化/链接拦截/帧内摘录
import fs from 'fs';
import path from 'path';

/** 场景内造 8 页 cbz（翻 4+ 页才能验证 revoke 窗口纪律） */
async function makeBigCbz(file) {
  const { default: JSZip } = await import('jszip');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const zip = new JSZip();
  for (let i = 1; i <= 8; i++) zip.file(`p${String(i).padStart(2, '0')}.png`, png);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
}

export async function scenes7({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // selectProxy 会把原生 select 隐藏并在其后挂语义按钮；原生 select 仍是唯一状态源。
  // E2E 不再按几何尺寸找 select，而是走浏览器原生 value setter + 可冒泡事件，
  // 同时核对代理按钮文案，避免“状态改了但用户看见的按钮没同步”的假绿。
  const setLibrarySelect = async (selector, value) => {
    const state = await evaluate(({ selector, value }) => {
      const view = document.defaultView;
      const select = window.__activeLibraryCtl?.root?.querySelector(selector)
        || document.querySelector(`.pane.active .lib-reader ${selector}`);
      if (!view || !(select instanceof view.HTMLSelectElement)) {
        return { ok: false, reason: `missing select ${selector}` };
      }
      const option = [...select.options].find(item => item.value === value);
      if (!option) return { ok: false, reason: `missing option ${value}`, values: [...select.options].map(item => item.value) };
      const setter = Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, 'value')?.set;
      if (setter) setter.call(select, value);
      else select.value = value;
      select.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
      select.dispatchEvent(new view.Event('change', { bubbles: true, composed: true }));
      const proxy = select.nextElementSibling?.matches?.('.selmenu-btn') ? select.nextElementSibling : null;
      const label = proxy?.querySelector('.selmenu-label')?.textContent?.trim() || '';
      return {
        ok: select.value === value && (!proxy || label === option.textContent.trim()),
        value: select.value,
        expectedLabel: option.textContent.trim(),
        label,
        proxied: !!proxy,
      };
    }, { selector, value });
    await human.assert(state.ok, `${selector} 应切换为 ${value} 且代理文案同步（${JSON.stringify(state)}）`);
    return state;
  };

  // 注册书并打开（幂等）
  const openBookByCard = async ({ id, title, path: p, format }) => {
    await evaluate(async ({ id, title, p, format }) => {
      const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
      if (!books.find(b => b.id === id)) {
        books.push({ id, title, author: 'E2E', cover: '', path: p, format, category: '未分类', addedAt: Date.now() });
        await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
      }
      await window.MazzCommands.execute('file.newLibrary');
    }, { id, title, p, format });
    await wait(1200);
    await evaluate((title) => { [...document.querySelectorAll('.lib-card')].find(c => c.getBoundingClientRect().width > 0 && c.textContent.includes(title))?.click(); }, title);
    // human.until 的 fn 在页面内执行（不得引用 node 侧 win——场景 1/7/8 连环超时总根）
    await human.until(() => {
      const f = [...document.querySelectorAll('iframe.lib-book-frame, .lib-manga-mode img, .lib-pdf')].find(e => e.tagName === 'IFRAME' || e.getBoundingClientRect?.().width > 0);
      return !!f;
    }, { timeout: 10000, msg: `${title} 打开` });
  };
  const frameDoc = () => evaluate(() => {
    const f = document.querySelector('iframe.lib-book-frame');
    return f?.contentDocument || null;
  });
  const backToShelf = async () => {
    await evaluate(() => { [...document.querySelectorAll('[data-a=back]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(500);
  };

  const EPUB = { id: 'e2e-s7-epub', title: '潮声集', path: WS + '/电子书/潮声集.epub', format: 'epub' };

  // ==================== 1：epub 沙箱帧存在与隔离 ====================
  await scenario('书库·沙箱帧·存在与隔离', async () => {
    await openBookByCard(EPUB);
    const r = await evaluate(() => {
      const f = document.querySelector('iframe.lib-book-frame');
      if (!f) return { err: '无帧' };
      const d = f.contentDocument;
      return {
        sandbox: f.getAttribute('sandbox'),
        hasText: (d?.body?.textContent || '').includes('第一章'),
        styleHasFont: (d?.querySelector('style')?.textContent || '').includes('font-size'),
        shellLeak: !!document.querySelector('.lib-page .lib-flow'), // 壳内不得直接有 flow（正文须在帧里）
      };
    });
    human.log('沙箱帧:', JSON.stringify(r));
    await human.assert(!r.err && r.sandbox === 'allow-same-origin', '帧须沙箱 allow-same-origin');
    await human.assert(r.hasText, '帧内应渲染第一章正文');
    await human.assert(r.styleHasFont, '帧内应注入阅读样式');
    await human.assert(!r.shellLeak, '正文不得在壳文档裸奔');
  });

  // ==================== 2：单页贴网与漂移自矫正 ====================
  await scenario('书库·单页·贴网自矫正', async () => {
    const r = await evaluate(async () => {
      const ctl = window.__activeLibraryCtl;
      if (!ctl?._flowNav || !ctl?._stepOf) return { err: '无翻页口/几何', has: { nav: !!ctl?._flowNav, step: !!ctl?._stepOf } };
      const step = ctl._stepOf();
      const snap = (o) => Math.abs(o / step - Math.round(o / step)) * step;
      await ctl._flowNav(1); await new Promise(r => setTimeout(r, 350));
      const o1 = ctl._flowOffset, d1 = snap(o1);
      // 注入 13px 漂移（模拟外力推挤），下一翻必须重新贴网
      ctl._applyOffset(o1 + 13);
      const drifted = ctl._flowOffset;
      await ctl._flowNav(1); await new Promise(r => setTimeout(r, 350));
      const o2 = ctl._flowOffset, d2 = snap(o2);
      return { step, o1, d1, drifted, o2, d2 };
    });
    human.log('贴网:', JSON.stringify(r));
    await human.assert(!r.err && r.step > 100, `步进应有效（实际 ${JSON.stringify(r)}）`);
    await human.assert(r.d1 <= 1, `翻页后必须贴网（偏差 ${r.d1}px）`);
    await human.assert(r.drifted !== r.o2 && r.d2 <= 1, `注入漂移后下一翻必须自矫正（偏差 ${r.d2}px）`);
  });

  // ==================== 3：双页步进零漂移（48px 累积错位回归） ====================
  await scenario('书库·双页·步进零漂移', async () => {
    await setLibrarySelect('.lib-mode', 'double');
    await wait(700);
    const r = await evaluate(async () => {
      const ctl = window.__activeLibraryCtl;
      const step = ctl._stepOf();
      const offs = [];
      ctl._applyOffset(0);
      for (let i = 0; i < 3; i++) { await ctl._flowNav(1); await new Promise(r => setTimeout(r, 320)); offs.push(ctl._flowOffset); }
      return { step, offs, dev: offs.map(o => Math.abs(o / step - Math.round(o / step)) * step) };
    });
    human.log('双页三连翻:', JSON.stringify(r));
    await human.assert(r.offs[2] > 0, '三连翻应有位移');
    await human.assert(r.dev.every(d => d <= 1), `每次翻页都必须落在步进网格上（老 48px 累积错位；实际偏差 ${JSON.stringify(r.dev)}）`);
    await setLibrarySelect('.lib-mode', 'single');
    await wait(500);
  });

  // ==================== 4：字号重排锚点不丢 ====================
  await scenario('书库·字号重排·锚点不丢', async () => {
    const r = await evaluate(async () => {
      const ctl = window.__activeLibraryCtl;
      ctl._applyOffset(0); await new Promise(r => setTimeout(r, 250));
      const chapBefore = ctl.chapterIdx;
      const plusBtn = document.querySelector('[data-a=font-plus]');
      plusBtn.click(); await new Promise(r => setTimeout(r, 700)); // applyTextStyle+重排+锚回
      return { chapBefore, chapAfter: ctl.chapterIdx, fontSize: ctl.fontSize };
    });
    human.log('字号重排:', JSON.stringify(r));
    await human.assert(r.chapBefore === r.chapAfter, `字号变化后章节不得漂移（${r.chapBefore}→${r.chapAfter}）`);
  });

  // ==================== 5：进度锚与加权百分比写入 ====================
  await scenario('书库·进度锚·加权百分比写入', async () => {
    await evaluate(async () => { const ctl = window.__activeLibraryCtl; await ctl._flowNav(1); });
    await wait(900); // 600ms 防抖 + 余量
    const r = await evaluate(async () => {
      const all = await window.mazz.invoke('settings:get', { key: 'library.progress' }).catch(() => ({}));
      return all?.['e2e-s7-epub'] || null;
    });
    human.log('进度记录:', JSON.stringify(r));
    await human.assert(r && typeof r.chapter === 'number', '进度应写入');
    await human.assert(r.anchor && typeof r.anchor.p === 'string' && typeof r.anchor.m === 'number' && typeof r.anchor.t === 'string', `应含内容锚（实际 ${JSON.stringify(r?.anchor)}）`);
    await human.assert(typeof r.pct === 'number' && r.pct >= 0 && r.pct <= 1, `应含字数加权百分比（实际 ${r?.pct}）`);
  });

  // ==================== 6：锚点恢复（改字号→回架→重开） ====================
  await scenario('书库·锚点恢复·重开不漂', async () => {
    const before = await evaluate(() => ({ ch: window.__activeLibraryCtl.chapterIdx, font: window.__activeLibraryCtl.fontSize }));
    await evaluate(() => { document.querySelector('[data-a=font-plus]').click(); }); // 再改字号（重排后锚恢复才是真考验）
    await wait(600);
    await backToShelf();
    await evaluate((title) => { [...document.querySelectorAll('.lib-card')].find(c => c.getBoundingClientRect().width > 0 && c.textContent.includes(title))?.click(); }, EPUB.title);
    await wait(1800);
    const after = await evaluate(() => ({ ch: window.__activeLibraryCtl.chapterIdx, font: window.__activeLibraryCtl.fontSize }));
    human.log('重开恢复:', JSON.stringify({ before, after }));
    await human.assert(Math.abs(after.ch - before.ch) <= 1, `重开应锚回原章（${before.ch}→${after.ch}，字号 ${before.font}→${after.font}）`);
  });

  // ==================== 7：cbz blob 化与翻页释放 ====================
  await scenario('书库·cbz·blob化与翻页释放', async () => {
    const cbzPath = WS + '/书库/八页漫画.cbz';
    await makeBigCbz(cbzPath);
    await backToShelf();
    await openBookByCard({ id: 'e2e-s7-cbz', title: '八页漫画', path: cbzPath, format: 'cbz' });
    const r = await evaluate(async () => {
      const ctl = window.__activeLibraryCtl;
      const pager = ctl.book?.cbz;
      if (!pager?.cachedCount) return { err: 'pager 无缓存计数' };
      for (let i = 0; i < 4; i++) {
        const next = [...document.querySelectorAll('[data-a=next]')].find(b => b.getBoundingClientRect().width > 0);
        next?.click(); await new Promise(r => setTimeout(r, 450));
      }
      const blobInDom = [...document.querySelectorAll('.lib-manga-page')].map(i => i.src.slice(0, 5));
      return { cached: pager.cachedCount(), blobInDom, pageIdx: ctl.pageIdx };
    });
    human.log('cbz 释放:', JSON.stringify(r));
    await human.assert(!r.err, 'pager 应有缓存计数');
    await human.assert(r.cached <= 4, `缓存窗口不得超 4（实际 ${r.cached}——翻走的页必须 revoke）`);
    await human.assert(r.blobInDom.every(s => s === 'blob:'), `DOM 图必须 blob 化（实际 ${JSON.stringify(r.blobInDom)}）`);
    // 回翻页正常出图（revoke 不得误杀可达性）
    await evaluate(() => { [...document.querySelectorAll('[data-a=prev]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(500);
    const back = await evaluate(() => [...document.querySelectorAll('.lib-manga-page')].some(i => i.src.startsWith('blob:') && i.getBoundingClientRect().width > 0));
    await human.assert(back, '回翻页应正常重载出图');
    await backToShelf();
  });

  // ==================== 8：滚动模式帧内渲染 ====================
  await scenario('书库·滚动模式·帧内渲染', async () => {
    await openBookByCard(EPUB);
    await setLibrarySelect('.lib-mode', 'scroll');
    await wait(1200);
    const r = await evaluate(() => {
      const f = [...document.querySelectorAll('iframe.lib-book-frame')].find(x => x.getBoundingClientRect().width > 0);
      const d = f?.contentDocument;
      const se = d?.scrollingElement || d?.documentElement;
      if (se) se.scrollTop = 400;
      return { pages: d?.querySelectorAll('.lib-scroll-page').length || 0, scrollable: (se?.scrollHeight || 0) > (se?.clientHeight || 0) };
    });
    await wait(600);
    const pos = await evaluate(() => document.querySelector('.lib-pos')?.textContent || '');
    human.log('滚动模式:', JSON.stringify({ ...r, pos }));
    await human.assert(r.pages >= 2, '帧内应有滚动页序列');
    await human.assert(pos.includes('%'), `滚动进度应报百分比（实际 ${pos}）`);
    await backToShelf();
  });

  // ==================== 9：链接拦截防帧导航 ====================
  await scenario('书库·链接拦截·帧不蒸发', async () => {
    await openBookByCard(EPUB);
    const r = await evaluate(async () => {
      const f = [...document.querySelectorAll('iframe.lib-book-frame')].find(x => x.getBoundingClientRect().width > 0);
      const d = f?.contentDocument;
      const a = d.createElement('a');
      a.href = 'https://example.com/x';
      a.textContent = '外链';
      d.body.firstElementChild?.prepend(a);
      a.click();
      await new Promise(r => setTimeout(r, 600));
      return { alive: (d.body.textContent || '').includes('第一章') };
    });
    human.log('链接拦截:', JSON.stringify(r));
    await human.assert(r.alive, '外链点击后帧不得被导航走（正文须在）');
    // 不 closeActive 清签——外链未必真开签，盲关会误杀书库签（场景 10 无帧总根实锤）
  });

  // ==================== 10：帧内选区摘录 ====================
  await scenario('书库·帧内选区·摘录可达', async () => {
    await openBookByCard(EPUB); // 自足开场（不依赖前场残局）
    // 帧元素先于正文注入就绪——段落级就绪轮询（「无文本段」时序坑实锤）
    await human.until(() => {
      const f = [...document.querySelectorAll('iframe.lib-book-frame')].find(x => x.getBoundingClientRect().width > 0);
      const d = f?.contentDocument;
      return !!(d && [...d.querySelectorAll('.lib-flow p, .lib-scroll-page p')].some(x => (x.textContent || '').trim().length > 10));
    }, { timeout: 8000, msg: '正文段落就绪' });
    const r = await evaluate(async () => {
      const f = [...document.querySelectorAll('iframe.lib-book-frame')].find(x => x.getBoundingClientRect().width > 0);
      const d = f?.contentDocument;
      const p = [...d.querySelectorAll('.lib-flow p, .lib-scroll-page p')].find(x => (x.textContent || '').trim().length > 10);
      if (!p) return { err: '无文本段' };
      const range = d.createRange();
      range.selectNodeContents(p);
      const sel = f.contentWindow.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      d.dispatchEvent(new Event('selectionchange'));
      await new Promise(r => setTimeout(r, 200));
      [...document.querySelectorAll('[data-a=clip]')].find(b => b.getBoundingClientRect().width > 0)?.click();
      await new Promise(r => setTimeout(r, 400));
      return { clip: (window.__libClipText || '').slice(0, 30) };
    });
    human.log('帧内摘录:', JSON.stringify(r));
    await human.assert(!r.err && r.clip.length > 5, `帧内选区应可摘录（实际 ${JSON.stringify(r)}）`);
    await backToShelf();
  });
}
