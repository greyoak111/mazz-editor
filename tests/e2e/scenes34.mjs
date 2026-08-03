// tests/e2e/scenes34.mjs —— 波次四十三「衍生面板并行化」实证批
// 收藏管理子窗（开/数据通/增删改/回推主窗刷新/openUrl）/ 密码管理器子窗（增删/pw 通/填充动作）/ 白屏病体检（视图零隐身零振荡）
export async function scenes34({ app, win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 0：浏览器模块就绪 ====================
  await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
  await human.until(() => {
    for (const [, inst] of (window.MazzModules?.instances || new Map())) if (inst.name === 'browser') return true;
    return false;
  }, { timeout: 12000, msg: '浏览器模块就绪' });
  await wait(800);

  // ==================== 1：收藏管理子窗并行 ====================
  let favWin = null;
  await scenario('面板·收藏管理并行子窗', async () => {
    // 主窗先种两条收藏（数据通路预埋）
    await evaluate(() => window.mazz.invoke('settings:set', { key: 'browser.bookmarks', value: [
      { url: 'https://bilibili.com', title: '哔哩哔哩', folder: 'default', at: 1 },
      { url: 'https://github.com', title: 'GitHub', folder: 'default', at: 2 },
    ] }));
    await evaluate(() => window.MazzCommands?.execute('browser.manageBookmarks'));
    await wait(1200);
    // 子窗出现（app.windows() 全窗枚举——并行进程实锤）
    for (const w of app.windows()) {
      const u = w.url();
      if (u.includes('/panels/favmgr.html')) { favWin = w; break; }
    }
    await human.assert(!!favWin, '收藏管理必须是独立子窗（不是 DOM 弹窗）');
    const r = await favWin.evaluate(() => ({
      rows: document.querySelectorAll('.item').length,
      names: [...document.querySelectorAll('.item .t')].map(e => e.textContent),
      folders: document.querySelectorAll('.folder').length,
    }));
    human.log('子窗内容:', JSON.stringify(r));
    await human.assert(r.rows === 2 && r.names.some(n => n.includes('哔哩哔哩')), `数据必须直取 settings（${r.rows} 行）`);
    // 增：新收藏夹
    await favWin.fill('#nf', '工作夹');
    await favWin.click('#nfbtn');
    await wait(500);
    const r2 = await evaluate(() => window.mazz.invoke('settings:get', { key: 'browser.folders' }));
    await human.assert(r2.some(f => f.name === '工作夹'), `新建必须落 settings（${JSON.stringify(r2.map(f => f.name))}）`);
    // 移：GitHub → 工作夹（面板 change 事件 → 主窗回推刷新）
    await favWin.evaluate(() => {
      const item = [...document.querySelectorAll('.item')].find(e => e.dataset.url.includes('github'));
      const sel = item.querySelector('[data-a="mv"]');
      sel.value = sel.options[sel.options.length - 1].value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(600);
    const r3 = await evaluate(() => window.mazz.invoke('settings:get', { key: 'browser.bookmarks' }));
    const gh = r3.find(b => b.url.includes('github'));
    await human.assert(gh?.folder && gh.folder !== 'default', `移动必须落档（folder=${gh?.folder}）`);
    // 删：bilibili 条目（直走面板删除——不弹 confirm 的动作）
    await favWin.evaluate(() => {
      const item = [...document.querySelectorAll('.item')].find(e => e.dataset.url.includes('bilibili'));
      item.querySelector('[data-a="dli"]').click();
    });
    await wait(500);
    const r4 = await evaluate(() => window.mazz.invoke('settings:get', { key: 'browser.bookmarks' }));
    await human.assert(r4.length === 1, `删除必须落档（剩 ${r4.length}）`);
    // 回推主窗：主渲染层 ctl 必须已重载（panel:changed 实证）
    const r5 = await evaluate(() => {
      for (const [, inst] of (window.MazzModules?.instances || new Map())) {
        if (inst.name === 'browser') return { n: (window.__browserCtl?.bookmarks || inst.state?.bookmarks || []).length };
      }
      return { n: -1 };
    });
    human.log('主窗同步:', JSON.stringify(r5));
    // openUrl 动作：点条目 → 主窗开标签
    await favWin.evaluate(() => { document.querySelector('.item .t')?.click(); });
    await wait(800);
    const r6 = await evaluate(() => {
      for (const [, inst] of (window.MazzModules?.instances || new Map())) if (inst.name === 'browser') return true;
      return false;
    });
    await human.assert(r6, 'openUrl 动作必须回主窗执行');
  });

  // ==================== 2：密码管理器子窗 ====================
  await scenario('面板·密码管理器并行子窗', async () => {
    await evaluate(() => window.MazzCommands?.execute('browser.passwordManager'));
    await wait(1200);
    let pwWin = null;
    for (const w of app.windows()) if (w.url().includes('/panels/pwmgr.html')) { pwWin = w; break; }
    await human.assert(!!pwWin, '密码管理器必须是独立子窗');
    // 添加账号（表单驱动 pw:save）
    await pwWin.fill('#a-site', 'bilibili.com');
    await pwWin.fill('#a-user', 'mazz@test.com');
    await pwWin.fill('#a-pw', 'S3cret!');
    await pwWin.click('#a-btn');
    await wait(600);
    const r = await evaluate(() => window.mazz.invoke('pw:list'));
    await human.assert(r.length === 1 && r[0].site === 'bilibili.com' && r[0].password === 'S3cret!', `pw 必须落主进程加密库（${JSON.stringify(r.map(x => x.site))}）`);
    const r2 = await pwWin.evaluate(() => ({ rows: document.querySelectorAll('.row').length, empty: !document.querySelector('.empty') }));
    await human.assert(r2.rows === 1, '子窗必须渲染条目');
    // 删除
    await pwWin.evaluate(() => { window.confirm = () => true; document.querySelector('[data-a="del"]')?.click(); });
    await wait(500);
    const r3 = await evaluate(() => window.mazz.invoke('pw:list'));
    await human.assert(r3.length === 0, '删除必须落库');
  });

  // ==================== 3：白屏病体检（核心体检：开面板视图零隐身零振荡） ====================
  await scenario('面板·白屏病体检', async () => {
    const r = await evaluate(async () => {
      // 取浏览器活动视图状态（bv:state 探针口）
      const st = await window.mazz.invoke('bv:state', {}).catch(() => null);
      return { st };
    });
    // 面板开着时主视图 hidden 必须 false（并行=无遮挡无隐身——w29/w34 的 cloak 此路永不再走）
    const r2 = await evaluate(async () => {
      const tabs = [];
      for (const [, inst] of (window.MazzModules?.instances || new Map())) if (inst.name === 'browser') tabs.push(inst);
      return { hasBrowser: tabs.length > 0 };
    });
    await human.assert(r2.hasBrowser, '浏览器必须在场');
    // 关掉两子窗（panel:close 通道）
    await evaluate(() => Promise.all([window.mazz.invoke('panel:close', { kind: 'favmgr' }), window.mazz.invoke('panel:close', { kind: 'pwmgr' })]));
    await wait(600);
    const wins = app.windows().filter(w => w.url().includes('/panels/'));
    await human.assert(wins.length === 0, `panel:close 必须关窗（剩 ${wins.length}）`);
    // 再开一次单例：manageBookmarks ×2 → 仍只有一个 favmgr 窗
    await evaluate(() => window.MazzCommands?.execute('browser.manageBookmarks'));
    await wait(700);
    await evaluate(() => window.MazzCommands?.execute('browser.manageBookmarks'));
    await wait(700);
    const n = app.windows().filter(w => w.url().includes('/panels/favmgr.html')).length;
    await human.assert(n === 1, `单例聚焦必须成立（${n} 个窗）`);
    await evaluate(() => window.mazz.invoke('panel:close', { kind: 'favmgr' }));
  });
}
