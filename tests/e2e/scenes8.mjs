// tests/e2e/scenes8.mjs —— 波次十九「书库尾巴」实证批
// cache-zip 快开与失效 / 净化规则 / 简繁转换 / 竖排网格
import fs from 'fs';
import path from 'path';

export async function scenes8({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // selectProxy 隐藏原生 select，但它仍是状态与 change 事件的单源。
  // 使用原生 setter 触发真实语义事件，并核对可见代理按钮的文案同步。
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
    await human.assert(state.ok, `${selector} 应切换为 ${value || '(原文)'} 且代理文案同步（${JSON.stringify(state)}）`);
    return state;
  };

  const openBookByCard = async ({ id, title, path: p, format }) => {
    await evaluate(async ({ id, title, p, format }) => {
      const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
      const rec = books.find(b => b.id === id);
      if (rec) rec.path = p; // 源可能被场景改写路径不变
      else books.push({ id, title, author: 'E2E', cover: '', path: p, format, category: '未分类', addedAt: Date.now() });
      await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
      await window.MazzCommands.execute('file.newLibrary');
    }, { id, title, p, format });
    await wait(1200);
    await evaluate((title) => { [...document.querySelectorAll('.lib-card')].find(c => c.getBoundingClientRect().width > 0 && c.textContent.includes(title))?.click(); }, title);
    await human.until(() => {
      const f = [...document.querySelectorAll('iframe.lib-book-frame')].find(x => x.getBoundingClientRect().width > 0);
      const d = f?.contentDocument;
      return !!(d && (d.body?.textContent || '').trim().length > 20);
    }, { timeout: 10000, msg: `${title} 打开` });
  };
  const backToShelf = async () => {
    await evaluate(() => { [...document.querySelectorAll('[data-a=back]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(500);
  };
  const frameHas = (text) => evaluate((t) => {
    const f = [...document.querySelectorAll('iframe.lib-book-frame')].find(x => x.getBoundingClientRect().width > 0);
    return (f?.contentDocument?.body?.textContent || '').includes(t);
  }, text);

  const EPUB = { id: 'e2e-s8-epub', title: '潮声集', path: WS + '/电子书/潮声集.epub', format: 'epub' };
  const CACHE_ZIP = WS + '/书库/.cache/e2e-s8-epub.zip';

  // ==================== 1：cache-zip 首开写缓存、重开直读 ====================
  await scenario('书库·cache-zip·首开写缓存重开直读', async () => {
    fs.rmSync(CACHE_ZIP, { force: true });
    await openBookByCard(EPUB);
    // 首开后台写缓存（轮询等落盘）
    let cacheReady = false;
    for (let i = 0; i < 20 && !cacheReady; i++) { await wait(500); cacheReady = fs.existsSync(CACHE_ZIP) && fs.statSync(CACHE_ZIP).size > 500; }
    human.log('缓存落盘:', cacheReady, fs.existsSync(CACHE_ZIP) ? fs.statSync(CACHE_ZIP).size : 0);
    await human.assert(cacheReady, '首开后台应写出 cache zip');
    const first = await evaluate(() => ({ fromCache: !!window.__activeLibraryCtl?.book?.epub?._fromCache }));
    await human.assert(!first.fromCache, '首开应为全量解析（非缓存）');
    await backToShelf();
    await openBookByCard(EPUB);
    const second = await evaluate(() => ({ fromCache: !!window.__activeLibraryCtl?.book?.epub?._fromCache }));
    human.log('重开来源:', JSON.stringify(second));
    await human.assert(second.fromCache, '重开应命中预处理缓存（零解析直读）');
    await human.assert(await frameHas('第一章'), '缓存直读内容应完整（第一章在）');
  });

  // ==================== 2：cache 失效（源文件变更回退全解析） ====================
  await scenario('书库·cache-zip·源变更即失效', async () => {
    await backToShelf();
    // 改写源 epub（追加字节→size+mtime 双变）
    const buf = fs.readFileSync(EPUB.path);
    fs.writeFileSync(EPUB.path, Buffer.concat([buf, Buffer.from('TAIL')])); // zip 尾部垃圾容忍（JSZip 按中央目录读）
    await wait(300);
    await openBookByCard(EPUB);
    const r = await evaluate(() => ({ fromCache: !!window.__activeLibraryCtl?.book?.epub?._fromCache }));
    human.log('失效判定:', JSON.stringify(r));
    await human.assert(!r.fromCache, '源文件变更后缓存必须失效回退全量解析');
    await human.assert(await frameHas('第一章'), '回退全解析后内容仍完整');
    // 失效后应后台重写新缓存（待下一轮直读）
    await wait(2500);
    const st = fs.existsSync(CACHE_ZIP) ? fs.statSync(CACHE_ZIP) : null;
    human.log('缓存重写:', st?.size || 0, '源新 mtime:', fs.statSync(EPUB.path).mtimeMs);
    await human.assert(!!st && st.mtimeMs > 0, '失效后应重写缓存');
  });

  // ==================== 3：净化规则（删词不伤标签） ====================
  await scenario('书库·净化规则·删词不伤标签', async () => {
    const before = await frameHas('夜色');
    await human.assert(before, '前置：正文应含「夜色」');
    // 开净化框加规则
    await evaluate(() => { [...document.querySelectorAll('[data-a=clean-rules]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(600);
    await evaluate(() => {
      const m = [...document.querySelectorAll('.mazz-palette-mask, .modal-mask, [class*=modal]')].find(x => x.getBoundingClientRect().width > 0 && x.querySelector('.cr-pattern'));
      const body = m || document;
      body.querySelector('.cr-pattern').value = '夜色';
      body.querySelector('.cr-type').value = 'delete';
      body.querySelector('.cr-match').value = 'plain';
      body.querySelector('.cr-scope').value = 'book';
      body.querySelector('.cr-add').click();
    });
    await wait(900);
    // 关弹窗
    await evaluate(() => { document.querySelectorAll('.mazz-palette-mask, .modal-mask').forEach(x => x.remove()); });
    const afterDel = await evaluate(() => {
      const f = [...document.querySelectorAll('iframe.lib-book-frame')].find(x => x.getBoundingClientRect().width > 0);
      const d = f?.contentDocument;
      return { has: (d?.body?.textContent || '').includes('夜色'), pCount: d?.querySelectorAll('p').length, hCount: d?.querySelectorAll('h1').length };
    });
    human.log('净化后:', JSON.stringify(afterDel));
    await human.assert(!afterDel.has, '删词后正文不得含「夜色」');
    await human.assert(afterDel.pCount >= 20 && afterDel.hCount >= 1, `标签结构不得受伤（p=${afterDel.pCount} h1=${afterDel.hCount}）`);
    // 删规则还原
    await evaluate(() => { [...document.querySelectorAll('[data-a=clean-rules]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(500);
    await evaluate(() => { [...document.querySelectorAll('[data-delrule]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(900);
    await evaluate(() => { document.querySelectorAll('.mazz-palette-mask, .modal-mask').forEach(x => x.remove()); });
    await human.assert(await frameHas('夜色'), '删规则后正文应还原');
  });

  // ==================== 4：简繁转换（随书记忆） ====================
  await scenario('书库·简繁转换·随书记忆', async () => {
    await setLibrarySelect('.lib-zh', 's2t');
    await wait(1200);
    await human.assert(await frameHas('從'), '转繁体后应见「從」');
    await human.assert(await frameHas('來'), '转繁体后应见「來」');
    // 随书记忆：回架重开应自动转繁
    await backToShelf();
    await openBookByCard(EPUB);
    await human.assert(await frameHas('從'), '重开应自动恢复转繁体（随书记忆）');
    // 切回原文
    await setLibrarySelect('.lib-zh', '');
    await wait(1000);
    await human.assert(await frameHas('从'), '切回原文应还原简体');
  });

  // ==================== 5：竖排（行距网格切片） ====================
  await scenario('书库·竖排·行距网格零切行', async () => {
    await setLibrarySelect('.lib-mode', 'vertical');
    await wait(1300);
    const r = await evaluate(() => {
      const f = [...document.querySelectorAll('iframe.lib-book-frame')].find(x => x.getBoundingClientRect().width > 0);
      const d = f?.contentDocument;
      const ctl = window.__activeLibraryCtl;
      const bodyV = d ? getComputedStyle(d.body).writingMode : '';
      const wrap = d?.querySelector('.lib-flow-wrap');
      const flow = d?.querySelector('.lib-flow');
      const rowPitch = Math.max(18, ctl.fontSize * (ctl.lineHeight || 1.8));
      return {
        bodyV,
        vertClass: d?.body?.classList.contains('lib-vertical'),
        wrapW: wrap?.clientWidth || 0,
        rowPitch,
        snapped: wrap ? Math.abs(wrap.clientWidth / rowPitch - Math.round(wrap.clientWidth / rowPitch)) < 0.02 : false,
        firstChap: (d?.body?.textContent || '').includes('第一章'),
        hasCols: !!flow?.style.columnWidth, // 竖排不得用 multicol
      };
    });
    human.log('竖排:', JSON.stringify(r));
    await human.assert(r.vertClass && r.bodyV.includes('vertical'), '竖排书写模式必须生效');
    await human.assert(r.snapped, `容器宽必须 snap 到行距整数倍（${r.wrapW} / ${r.rowPitch}）`);
    await human.assert(!r.hasCols, '竖排不得走 multicol（无 multicol 自研模型）');
    await human.assert(r.firstChap, '竖排首屏应在第一章');
    // 竖排翻页：步进=网格宽
    const nav = await evaluate(async () => {
      const ctl = window.__activeLibraryCtl;
      const step = ctl._stepOf();
      await ctl._flowNav(1); await new Promise(r => setTimeout(r, 400));
      return { step, off: ctl._flowOffset };
    });
    human.log('竖排翻页:', JSON.stringify(nav));
    await human.assert(nav.off === nav.step, `竖排步进必须=网格宽（${nav.off} vs ${nav.step}）`);
    // 回单页
    await setLibrarySelect('.lib-mode', 'single');
    await wait(600);
    await backToShelf();
  });
}
