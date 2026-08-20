// tests/e2e/scenes36.mjs —— W47 大修实证批
// 主题跟随主界面 / 圆角拖拽窗件 / 工具坞并行（开/命令桥/主题） / 密码捕获询问 / F12 devtools / 空页居中与文件夹SVG
export async function scenes36({ app, win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 1：工具坞回滚（W49 定版：迁移方案放弃，内嵌坞复位） ====================
  await scenario('工具坞·回滚复原', async () => {
    await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
    await wait(500);
    const r = await evaluate(() => ({
      dockOpen: (() => { const d = document.querySelector('.side-dock'); return d && d.getBoundingClientRect().width > 0; })(),
      noParallel: !document.querySelector('iframe,webview'),
    }));
    await human.assert(r.dockOpen, '内嵌坞必须开（回滚复位实锤）');
    await evaluate(() => { document.querySelector('.side-dock .sd-tab[data-t="tools"]')?.click(); });
    await wait(400);
    const r2 = await evaluate(() => ({
      cards: document.querySelectorAll('.side-dock .sd-tool-card').length,
      playerCard: [...document.querySelectorAll('.side-dock .sd-tool-card')].some(c => c.textContent.includes('打开播放器')),
    }));
    await human.assert(r2.cards >= 18 && r2.playerCard, `工具卡全在+空手起播入口在（${JSON.stringify(r2)}）`);
    await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
    await wait(300);
  });

  // ==================== 2：面板主题跟随（收藏管理） ====================
  await scenario('面板·主题跟随主界面', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
    await human.until(() => {
      for (const [, inst] of (window.MazzModules?.instances || new Map())) if (inst.name === 'browser') return true;
      return false;
    }, { timeout: 9000, msg: '浏览器就绪' });
    await evaluate(() => window.MazzCommands?.execute('browser.manageBookmarks'));
    await wait(1000);
    let favWin = null;
    for (const w of app.windows()) if (w.url().includes('/panels/favmgr.html')) { favWin = w; break; }
    await human.assert(!!favWin, '收藏管理子窗必须在');
    const r = await favWin.evaluate(() => ({
      themeAttr: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.querySelector('.pwin')).backgroundColor,
      folderSvg: !!document.querySelector('.fi'),
      folderEmoji: document.body.innerHTML.includes('📁 '),
    }));
    const tMain2 = await evaluate(() => document.documentElement.dataset.theme);
    human.log('fav 主题:', JSON.stringify({ ...r, tMain2 }));
    await human.assert(r.themeAttr === tMain2, `必须跟随主界面主题 id（${r.themeAttr}=${tMain2}——不再读 OS 明暗实锤）`);
    await human.assert(r.folderSvg && !r.folderEmoji, '文件夹 emoji 必须消灭（SVG stroke 族）');
    // 再换一轮主题双窗同步
    await evaluate(() => window.MazzCommands?.execute('view.cycleTheme'));
    await wait(800);
    const t3 = await favWin.evaluate(() => document.documentElement.dataset.theme);
    const tMain3 = await evaluate(() => document.documentElement.dataset.theme);
    await human.assert(t3 === tMain3, `换主题必须双窗同步（${t3}=${tMain3}）`);
    await evaluate(() => window.mazz.invoke('panel:close', { kind: 'favmgr' }));
  });

  // ==================== 3：密码捕获询问 ====================
  await scenario('密码·智能记录询问保存', async () => {
    // 本地 HTTP 表单页（data: URL 客页不加载实锤→真网页路径）→ 客页提交 → console 前缀桥 → 询问 toast（Edge 同款）
    const http = await import('http');
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><form id="f" action="/done"><input name="user" value="mazz@test.com"><input type="password" value="TopS3cret"><button type="submit">登录</button></form></body></html>');
    });
    const port = await new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
    try {
      await evaluate((u) => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
      }, `http://127.0.0.1:${port}/form.html`);
      await wait(1800);
      // 触发表单提交（bv:js 客页内执行）
      await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:js', { tabId: t.viewId, code: "document.querySelector('form').requestSubmit()" }).catch(() => {});
      });
      await wait(1500);
      const r = await evaluate(() => {
        const t = [...document.querySelectorAll('.mazz-toast, [class*=toast]')].map(e => e.textContent).join('|');
        return { toast: t };
      });
      human.log('捕获询问:', JSON.stringify(r));
      await human.assert(r.toast.includes('保存账号') && r.toast.includes('mazz@test.com'), `必须询问保存（${r.toast.slice(0, 60)}——Edge 同款）`);
      // 点保存 → 落库
      await evaluate(() => { [...document.querySelectorAll('.mazz-toast button, [class*=toast] button')].find(b => b.textContent === '保存')?.click(); });
      await wait(600);
      const r2 = await evaluate(() => window.mazz.invoke('pw:list'));
      await human.assert(r2.some(x => x.username === 'mazz@test.com' && x.password === 'TopS3cret'), `保存必须落加密库（${JSON.stringify(r2.map(x => x.username))}）`);
      await evaluate((id) => window.mazz.invoke('pw:delete', { id }), r2.find(x => x.username === 'mazz@test.com')?.id);
    } finally { srv.close(); }
  });

  // ==================== 4：F12 devtools ====================
  await scenario('浏览器·F12开发者工具', async () => {
    const before = app.windows().length;
    await evaluate(() => window.MazzCommands?.execute('browser.devtools'));
    await wait(1200);
    const r = await evaluate(() => {
      for (const [, inst] of (window.MazzModules?.instances || new Map())) {
        if (inst.name !== 'browser') continue;
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) return window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null);
      }
      return null;
    });
    human.log('devtools:', JSON.stringify({ before, after: app.windows().length }));
    await human.assert(app.windows().length > before, 'devtools 必须 detach 出独立窗');
    // 再按=关
    await evaluate(() => window.MazzCommands?.execute('browser.devtools'));
    await wait(800);
  });

  // ==================== 5：空页居中与文件夹SVG（播放器） ====================
  await scenario('播放器·空页居中文件夹SVG', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newViewer'));
    await human.until(() => !!document.querySelector('.mz-player .mz-empty'), { timeout: 9000, msg: '空播放器' });
    const emptyState = () => evaluate(() => {
      const stage = document.querySelector('.mz-stage');
      const empty = stage?.querySelector('.mz-empty');
      const controls = stage?.querySelector('.mz-controls');
      const side = stage?.querySelector('.mz-side');
      const rect = el => el?.getBoundingClientRect()?.toJSON?.() || {};
      return {
        sideOpen: stage?.classList.contains('side-open'),
        sideOverlay: stage?.classList.contains('side-overlay'),
        inlineRight: empty?.style.right || '',
        stage: rect(stage), empty: rect(empty), controls: rect(controls), side: rect(side),
      };
    });
    const fillsStage = state => Math.abs(state.empty.left - state.stage.left) <= 1
      && Math.abs(state.empty.right - state.stage.right) <= 1
      && Math.abs(state.controls.left - state.stage.left) <= 1
      && Math.abs(state.controls.right - state.stage.right) <= 1;
    const closed = await emptyState();
    human.log('空页·收栏:', JSON.stringify(closed));
    await human.assert(!closed.sideOpen && closed.inlineRight === '' && fillsStage(closed), `空页收栏必须与底栏共同铺满（${JSON.stringify(closed)}）`);
    await evaluate(() => document.querySelector('.mz-player [data-a=list]')?.click());
    await wait(250);
    const open = await emptyState();
    human.log('空页·开栏:', JSON.stringify(open));
    if (!open.sideOverlay) {
      await human.assert(open.sideOpen && Math.abs(open.empty.right - open.side.left) <= 2 && Math.abs(open.controls.right - open.side.left) <= 2,
        `空页开栏必须与底栏共同让位（${JSON.stringify(open)}）`);
    }
    await evaluate(() => document.querySelector('.mz-player .mz-side-x')?.click());
    await wait(250);
    const reclosed = await emptyState();
    await human.assert(!reclosed.sideOpen && fillsStage(reclosed), `空页再收栏必须恢复铺满（${JSON.stringify(reclosed)}）`);
    // 媒体库树文件夹 SVG（非 emoji）
    const r2 = await evaluate(() => {
      document.querySelector('[data-src="medialib"]')?.click();
      return new Promise(res => setTimeout(() => res({
        svgIco: !!document.querySelector('.mz-ml-dname svg'),
        emoji: [...document.querySelectorAll('.mz-ml-dname')].some(e => e.textContent.includes('📁')),
      }), 700));
    });
    await human.assert(!r2.emoji, `树文件夹 emoji 必须消灭（svgIco=${r2.svgIco}）`);
  });
}
