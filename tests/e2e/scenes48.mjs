// tests/e2e/scenes48.mjs —— W53 全原生子窗格实证批（样板：协议面板）
// ①开关与形态（无框圆角/主题跟随/滚动条） ②交互真实有效（复选/双钮/不再弹出持久化） ③启动零闪烁（无应用壳过程）
export async function scenes48({ app, win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const OUT = '/mnt/agents/output';

  const findPanel = async (frag, tries = 30) => {
    for (let i = 0; i < tries; i++) {
      await wait(300);
      const w = app.windows().find(w => w.url().includes(frag));
      if (w) return w;
    }
    return null;
  };

  try {
    await scenario('协议面板·全原生子窗格', async () => {
      // 主题切 ink 再开（主题跟随实证：出生即暗，不许白了再染）
      await evaluate(() => window.MazzShell?.setTheme?.('ink'));
      await wait(600);
      const t0 = Date.now();
      await evaluate(() => window.mazz.invoke('panel:open', { kind: 'agreement' }).catch(() => {}));
      const pw = await findPanel('/panels/agreement.html');
      await human.assert(!!pw, '协议子窗格必须打开');
      const openMs = Date.now() - t0;
      // 全原生面板页直载——无应用壳启动过程（「先出小窗编辑器再开弹窗」闪烁路线已退役）
      await human.assert(openMs < 3000, `面板直载必须快（${openMs}ms——壳启动闪烁根治）`);
      await wait(1200); // agreementQuery → panel:push

      const st = await pw.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        title: document.getElementById('t')?.textContent,
        hasContent: document.querySelectorAll('main h3').length >= 2,
        scrollH: document.querySelector('main').scrollHeight,
        clientH: document.querySelector('main').clientHeight,
        overflowY: getComputedStyle(document.querySelector('main')).overflowY,
        bg: getComputedStyle(document.querySelector('.pwin')).backgroundColor,
        winBg: getComputedStyle(document.body).backgroundColor,
      }));
      await human.assert(st.theme === 'ink', `主题必须出生即跟随（实拿 ${st.theme}——主题变窗格变）`);
      await human.assert(st.title === '用户服务协议及隐私政策', `标题必须是文案单源（实拿 ${st.title}）`);
      await human.assert(st.hasContent, '协议章节必须真渲染（h3≥2）');
      await human.assert(st.overflowY === 'auto' && st.scrollH > st.clientH, `内容必须真溢出真滚动（${st.scrollH}>${st.clientH}，军规④）`);
      await human.assert(st.winBg === 'rgba(0, 0, 0, 0)', '窗体必须透明（无框圆角）');
      await pw.screenshot({ path: `${OUT}/w53-协议面板-ink.png` }).catch(() => {});

      // 交互真实有效（「帮助连按钮和滑动都是完全无效的」平反面）：勾选+知悉 → 关窗+持久化
      await pw.evaluate(() => { document.getElementById('nomore').click(); });
      await pw.evaluate(() => { document.getElementById('accept').click(); });
      await wait(800);
      const nomore = await evaluate(() => window.mazz.invoke('settings:get', { key: 'agreement.noMore' }).catch(() => null));
      await human.assert(nomore === true, `勾选知悉必须持久化（实拿 ${nomore}）`);
      const gone = !app.windows().some(w => w.url().includes('/panels/agreement.html'));
      await human.assert(gone, '知悉后子窗必须自闭');
      // 复位（别害后跑的场景）
      await evaluate(() => window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: false }).catch(() => {}));
      await evaluate(() => window.MazzShell?.setTheme?.('paper'));
      await wait(400);
    });
  } finally {}
}
