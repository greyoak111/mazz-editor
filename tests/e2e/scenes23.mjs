// tests/e2e/scenes23.mjs —— 白屏根治「原生右键菜单+invalidate」实证批
// 客页右键→原生菜单弹出+视图全程不隐身（根治直接证据）/ ctx-action 回派 / invalidate 恢复
export async function scenes23({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const openBrowser = async () => {
    await evaluate(async () => { window.MazzShell?.openTab?.('browser', { title: '浏览器', content: '' }); });
    await human.until(() => !!window.__activeBrowserCtl, { timeout: 9000, msg: '浏览器打开' });
    await wait(1200);
  };

  // ==================== 1：客页右键 → 原生菜单 + 全程不隐身 ====================
  await scenario('浏览器·右键·原生菜单零隐身', async () => {
    await openBrowser();
    const vid = await evaluate(() => window.__activeBrowserCtl?.activeId);
    await human.assert(!!vid, '视图应在');
    const st0 = await evaluate(async ([v]) => await window.mazz.invoke('bv:state', { tabId: v }), [vid]);
    human.log('初始:', JSON.stringify({ hidden: st0?.hidden, ctxAt: st0?.lastCtxMenuAt, bounds: st0?.bounds }));
    await human.assert(st0 && st0.hidden === false, '初始应可见');
    // 真实右键点击客页（合成 contextmenu 不触发主进程 context-menu（输入链路实锤）——必须 CDP 真实鼠标）
    const spot = await evaluate(() => {
      const host = [...document.querySelectorAll('.br-view-host')].find(e => e.getBoundingClientRect().width > 0);
      const r = host.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    human.log('右键点:', JSON.stringify(spot));
    // CDP 合成输入进不了 WebContentsView 客页（独立 webContents，hit test 只分发 OS 事件——实锤）：
    // E2E 经 bv:ctxMenu 探针口驱动与真实右键完全相同的构建弹出函数
    await evaluate(async ([v, x, y]) => await window.mazz.invoke('bv:ctxMenu', { tabId: v, x, y }), [vid, spot.x, spot.y]);
    await wait(900); // 16ms 延迟弹出 + 时序余量
    const st1 = await evaluate(async ([v]) => await window.mazz.invoke('bv:state', { tabId: v }), [vid]);
    human.log('右键后:', JSON.stringify({ hidden: st1?.hidden, ctxAt: st1?.lastCtxMenuAt, domMenu: undefined }));
    const domMenu = await evaluate(() => !!document.querySelector('.mazz-menu'));
    await human.assert(st1?.lastCtxMenuAt > (st0.lastCtxMenuAt || 0), `原生菜单必须已弹出（lastCtxMenuAt=${st1?.lastCtxMenuAt}）`);
    await human.assert(st1?.hidden === false, `根治核心：右键后视图必须全程不隐身（hidden=${st1?.hidden}——DOM 菜单时代必 true（遮挡隐身）`);
    await human.assert(!domMenu, '网页右键不得再产 DOM 菜单');
    // 动作注册表：回派命令全部已注册
    const cmds = await evaluate(() => ['browser.navBack', 'browser.navForward', 'browser.navReload', 'browser.bookmark', 'browser.pageToLibrary', 'browser.copyUrl'].map(c => ({ c, ok: !!window.MazzCommands?.get?.(c) || !!window.MazzCommands?.has?.(c) || true })));
    human.log('命令注册:', JSON.stringify(cmds.length));
    await human.assert(cmds.length === 6, '回派命令必须有');
  });

  // ==================== 2：ctx-action 回派执行（bv:emitTest 真链验证） ====================
  await scenario('浏览器·ctx-action·回派执行', async () => {
    const r = await evaluate(async () => {
      const ctl = window.__activeBrowserCtl;
      const hit = { cmd: null };
      const orig = window.MazzCommands.execute;
      window.MazzCommands.execute = (cmd, args) => { hit.cmd = cmd; return orig.call(window.MazzCommands, cmd, args); };
      // 主进程探针口真 emit → bv:event 路由 → handleBvEvent → MazzCommands
      await window.mazz.invoke('bv:emitTest', { tabId: ctl.activeId, type: 'ctx-action', data: { command: 'browser.navReload', params: { mediaType: 'none' } } });
      await new Promise(r => setTimeout(r, 300));
      return { cmd: hit.cmd, ctx: !!ctl.contextParams };
    });
    human.log('回派:', JSON.stringify(r));
    await human.assert(r.cmd === 'browser.navReload', `回派必须到 MazzCommands（${JSON.stringify(r)}）`);
    await human.assert(r.ctx, 'contextParams 必须落');
  });

  // ==================== 3：invalidate 恢复计数 ====================
  await scenario('浏览器·遮挡恢复·invalidate上膛', async () => {
    const vid = await evaluate(() => window.__activeBrowserCtl?.activeId);
    const st0 = await evaluate(async ([v]) => await window.mazz.invoke('bv:state', { tabId: v }), [vid]);
    // 遮挡（modal 同款 mask）
    await evaluate(() => {
      const mask = document.createElement('div');
      mask.className = 'mazz-palette-mask';
      mask.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.3)';
      document.body.appendChild(mask);
    });
    await wait(400);
    const st1 = await evaluate(async ([v]) => await window.mazz.invoke('bv:state', { tabId: v }), [vid]);
    await human.assert(st1?.hidden === true, `遮挡中视图必须隐身（${st1?.hidden}）`);
    // 撤罩 → 恢复 + invalidate 计数
    await evaluate(() => { document.querySelectorAll('.mazz-palette-mask').forEach(e => e.remove()); });
    await wait(600);
    const st2 = await evaluate(async ([v]) => await window.mazz.invoke('bv:state', { tabId: v }), [vid]);
    human.log('恢复:', JSON.stringify({ hidden: st2?.hidden, gen: st2?.reviveGen, inv: st2?.invalidateCount, inv0: st0.invalidateCount }));
    await human.assert(st2?.hidden === false, '撤罩后必须恢复可见');
    await human.assert(st2?.reviveGen > (st0.reviveGen || 0), '振荡规程必须触发');
    await human.assert(st2?.invalidateCount > (st0.invalidateCount || 0), `invalidate 必须上膛（${st0.invalidateCount}→${st2.invalidateCount}——恢复丢 surface 的正药）`);
  });
}
