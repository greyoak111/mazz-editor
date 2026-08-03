// tests/e2e/scenes47.mjs —— W52e④ 实证批
// 批注条顶部停靠（与 DOM 版同位）+20px 圆形色板（lean 场景已随体系退役归 scenes49）
export async function scenes47({ app, win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const OUT = '/mnt/agents/output';

  const findWin = async (frag, tries = 30) => {
    for (let i = 0; i < tries; i++) {
      await wait(300);
      const w = app.windows().find(w => w.url().includes(frag));
      if (w) return w;
    }
    return null;
  };

  try {
    // ==================== 2：批注条顶部停靠 ====================
    await scenario('批注条·顶部停靠与DOM版同位', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
      await wait(800);
      await evaluate(() => window.MazzCommands?.execute('annotate.toggle'));
      const aw = await findWin('/panels/annotate.html');
      await human.assert(!!aw, '批注墨迹子窗必须打开');
      await wait(600);
      const st = await aw.evaluate(() => {
        const bar = document.querySelector('.bar');
        const r = bar.getBoundingClientRect();
        const c = bar.querySelector('.c');
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, radius: getComputedStyle(c).borderRadius, w: getComputedStyle(c).width };
      });
      await human.assert(st.top >= 96 && st.top <= 200, `批注条必须顶部停靠（top=${st.top}——底端停靠平反，与 DOM 版 ribbon 下方同位）`);
      await human.assert(st.bottom < st.vh * 0.5, `批注条必须在上半区（bottom=${st.bottom} vh=${st.vh}）`);
      await human.assert(st.radius === '50%' && st.w === '20px', `色板必须 20px 圆形（${st.w} radius=${st.radius}）`);
      await aw.screenshot({ path: `${OUT}/w52e-批注条顶部停靠.png` }).catch(() => {});
      await aw.evaluate(() => document.getElementById('p-close')?.click?.() || window.close?.()).catch(() => {});
    });
  } finally {}
}
