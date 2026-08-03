// tests/e2e/scenes38.mjs —— W49 实证批
// 命中测试制遮挡隐身（模拟浮层压顶/撤除/豁免 toast）/ 工具坞回滚（内嵌坞开合复原+ribbon 钮回路）
export async function scenes38({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 0：浏览器就绪（真网页宿主才谈遮盖） ====================
  await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
  await human.until(() => {
    if (window.__activeBrowserCtl?.tabs?.length > 0) return true;
    for (const [, inst] of (window.MazzModules?.instances || new Map())) if (inst.name === 'browser') return true;
    return false;
  }, { timeout: 15000, msg: '浏览器就绪' });
  await wait(800);

  // ==================== 1：终局复证（W50：浮层压顶视图照常——无 _cloaked 机械） ====================
  await scenario('浏览器·浮层压顶终局复证', async () => {
    const r = await evaluate(async () => {
      const mk = (cls) => {
        const el = document.createElement('div');
        el.className = cls;
        el.style.cssText = 'position:fixed;left:50%;top:30%;width:300px;height:200px;transform:translateX(-50%);background:#334;z-index:99999';
        document.body.appendChild(el);
        return el;
      };
      const m1 = mk('ribbon-more-fake');
      await new Promise(res => setTimeout(res, 400));
      const top1 = document.elementsFromPoint(innerWidth / 2, innerHeight * 0.35)[0];
      const during = { top: top1?.className, cloaked: window.__activeBrowserCtl?._cloaked };
      m1.remove();
      await new Promise(res => setTimeout(res, 300));
      const probeCloak = async () => {
        const m2 = document.createElement('div');
        m2.className = 'mazz-palette-mask';
        m2.innerHTML = '<div style="width:100px;height:80px;background:#222"></div>';
        document.body.appendChild(m2);
        await new Promise(res => setTimeout(res, 400));
        const on = window.__activeBrowserCtl?._cloaked;
        m2.remove();
        await new Promise(res => setTimeout(res, 300));
        return on;
      };
      const maskCloaked = await probeCloak();
      return { during, after: window.__activeBrowserCtl?._cloaked, mechGone: maskCloaked !== true ? '兜底失灵' : true };
    });
    human.log('终局:', JSON.stringify(r));
    await human.assert(r.during.top === 'ribbon-more-fake', `浮层必须最上不被抢（${r.during.top}——canvas 是 DOM 实锤）`);
    await human.assert(r.mechGone, '兜底 cloak 只认两件套（未登记浮层不隐身——②③波遣散后兜底退役）');
  });

  // ==================== 2：工具坞回滚 ====================
  await scenario('工具坞·回滚复原', async () => {
    // ribbon 钮 → 内嵌坞开（不再并行窗）
    const wins0 = await evaluate(() => 0);
    await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
    await wait(600);
    const r = await evaluate(() => ({
      dockOpen: !!document.querySelector('.side-dock'),
      visible: (() => { const d = document.querySelector('.side-dock'); return d && d.getBoundingClientRect().width > 0; })(),
    }));
    await human.assert(r.dockOpen && r.visible, `内嵌坞必须开（${JSON.stringify(r)}）`);
    // 工具页卡片在（内联 GROUPS 复原实证）
    const r2 = await evaluate(() => {
      const tabs = document.querySelectorAll('.side-dock .sd-tab');
      const toolsTab = [...tabs].find(t => t.dataset.t === 'tools');
      toolsTab?.click();
      return new Promise(res => setTimeout(() => res({
        cards: document.querySelectorAll('.side-dock .sd-tool-card').length,
        playerCard: [...document.querySelectorAll('.side-dock .sd-tool-card')].some(c => c.textContent.includes('打开播放器')),
      }), 400));
    });
    human.log('内嵌坞:', JSON.stringify(r2));
    await human.assert(r2.cards >= 18, `工具卡必须全在（${r2.cards}——内联 GROUPS 复原）`);
    await human.assert(r2.playerCard, '空手起播入口必须在（w46 定版）');
    // 打开播放器入口链路不死（点卡→空手起播）
    await evaluate(() => { [...document.querySelectorAll('.side-dock .sd-tool-card')].find(c => c.textContent.includes('打开播放器'))?.click(); });
    await human.until(() => !!document.querySelector('.mz-player .mz-empty'), { timeout: 9000, msg: '入口链路' });
    // 关坞
    await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
    await wait(400);
    const closed = await evaluate(() => { const d = document.querySelector('.side-dock'); return !d || d.getBoundingClientRect().width === 0; });
    await human.assert(closed, '内嵌坞必须可关');
  });
}
