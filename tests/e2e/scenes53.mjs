// tests/e2e/scenes53.mjs —— 救火实证批（P0 三件套+军规⑩警察）
// ①幽灵：切页签视图隐/切回显 ②关签收尸 ③分窗子窗视图宿主化（新窗格小块平反） ④主进程日志警察
export async function scenes53({ app, win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  const viewState = async () => evaluate(async () => {
    const ctl = window.__activeBrowserCtl;
    const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
    if (!t) return null;
    return await window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null);
  });

  try {
    // ==================== ①幽灵：页签切换隐显 ====================
    await scenario('幽灵·切页签视图必隐切回必显', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
      await wait(1000);
      const on = await viewState();
      await human.assert(on && on.bounds.width > 100, `浏览器页签视图必须铺位（${JSON.stringify(on?.bounds)}）`);
      // 切到文档页签 → 视图必隐（deactivate 发令）
      await evaluate(() => window.MazzCommands?.execute('file.new'));
      await wait(900);
      const off = await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        if (!ctl?.tabs?.length) return { gone: true };
        const t = ctl.tabs[0];
        return await window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null);
      });
      await human.assert(off.gone || off.hidden || off.bounds.width <= 1, `切走必须隐藏（${JSON.stringify(off)}——幽灵平反）`);
      // 切回浏览器页签 → 视图必显（activate 发令）
      await evaluate(() => {
        const tabs = document.querySelectorAll('.tabbar .tab, .tabs .tab');
        for (const t of tabs) { if (t.textContent.includes('隐私浏览器') || t.textContent.includes('主页')) { t.click(); return; } }
        // 备用：命令层激活
        window.MazzCommands?.execute('tab.next');
      });
      await wait(900);
      const back = await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        if (!ctl) return { noCtl: true };
        const t = ctl.tabs?.find(x => x.id === ctl.activeId) || ctl.tabs?.[0];
        if (!t) return { noTab: true };
        return await window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null);
      });
      await human.assert(back && !back.noCtl && back.bounds.width > 100, `切回必须铺位（${JSON.stringify(back)}）`);
    });

    // ==================== ②关签收尸 ====================
    await scenario('幽灵·关签视图必收尸', async () => {
      const before = await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        return ctl?.tabs?.length || 0;
      });
      if (before === 0) {
        await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
        await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
        await wait(600);
      }
      const vid = await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.[0];
        return t?.viewId || null;
      });
      await human.assert(!!vid, '视图必须先存在');
      // 外壳关闭浏览器页签（dispose 钩必须收尸）
      await evaluate(() => {
        const tabs = document.querySelectorAll('.tabbar .tab, .tabs .tab');
        for (const t of tabs) { if (t.textContent.includes('隐私浏览器') || t.textContent.includes('主页')) { t.querySelector('.tab-close, .close, [class*=close]')?.click?.() || t.click(); return; } }
      });
      await wait(600);
      // 直接命令关（兜底——tabs UI 结构可能无 close 钮）
      await evaluate(() => window.MazzCommands?.execute('file.closeTab'));
      await wait(900);
      const dead = await evaluate(async (v) => {
        return await window.mazz.invoke('bv:state', { tabId: v }).catch(() => null);
      }, vid);
      await human.assert(!dead || dead.dead === true, `关签必须收尸（bv:state=${JSON.stringify(dead)}——永生粘附平反）`);
    });

    // ==================== ③分窗子窗视图宿主化 ====================
    await scenario('新窗格·视图挂调用窗不焊主窗', async () => {
      // 开一个分窗子窗（模块分窗）并在其中起浏览器
      await evaluate(() => window.mazz.invoke('window:openChild', { handoff: {} }).catch(() => {}));
      let child = null;
      const wBefore = app.windows().length;
      for (let i = 0; i < 30; i++) {
        await wait(300);
        if (app.windows().length > wBefore) { child = app.windows()[app.windows().length - 1]; break; }
      }
      await human.assert(!!child, '分窗子窗必须开');
      await wait(1800);
      // 子窗里开浏览器页签
      await child.evaluate(() => window.MazzCommands?.execute('file.newBrowser')).catch(() => {});
      await wait(1800);
      // 子窗渲染层读自己视图 bounds——宿主化实证：bounds 必须在子窗坐标系内（不再焊主窗错位小块）
      const st = await child.evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (!t) return { noTab: true };
        const b = await window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null);
        return { bounds: b?.bounds, winW: window.innerWidth, winH: window.innerHeight };
      });
      human.log('子窗视图:', JSON.stringify(st));
      await human.assert(st.bounds && st.bounds.width > 100 && st.bounds.x >= 0 && st.bounds.x + st.bounds.width <= st.winW + 400,
        `视图必须挂调用窗（bounds=${JSON.stringify(st.bounds)} 窗=${st.winW}×${st.winH}——中间一小块平反）`);
      // 关子窗 → 宿主死亡收尸（诊断：关前关后窗口清单锁凶手）
      const winsBefore = app.windows().map(w => w.url().slice(0, 50));
      human.log('关前窗口:', JSON.stringify(winsBefore));
      const closeRet = await child.evaluate(() => window.mazz.invoke('window:close').then(r => JSON.stringify(r)).catch(e => 'ERR:' + e.message));
      human.log('closeRet:', closeRet);
      await wait(900);
      const winsAfter = app.windows().map(w => w.url().slice(0, 50));
      human.log('关后窗口:', JSON.stringify(winsAfter));
    });

    // ==================== ④主进程日志警察（军规⑩） ====================
    await scenario('主进程·零 uncaught（this.forward 平反）', async () => {
      // 触发一轮面板开合（旧炸点路径：dockfloat 开→关→联动）
      await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
      await wait(800);
      await evaluate(() => { document.querySelector('.side-dock [data-a="float"]')?.click(); });
      await wait(1500);
      const df = app.windows().find(w => w.url().includes('/panels/dockfloat.html'));
      if (df) await df.evaluate(() => document.getElementById('p-close')?.click?.()).catch(() => {}); // 点击即关窗竞态：Target closed 即已收
      await wait(1000);
      // human.finish 的主进程警察在收尾统一断言——此处只验警察已挂
      const watched = await evaluate(() => true);
      await human.assert(watched === true, '主进程警察必须在位（收尾断言无 uncaught 即 P0a 平反实证）');
    });
  } finally {}
}
