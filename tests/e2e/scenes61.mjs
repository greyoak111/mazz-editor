// tests/e2e/scenes61.mjs —— W58g 实证批（scoped：子窗滚动条真统一——thin 压钉拔除+主题丸同款）
export async function scenes61({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  await scenario('滚动条·thin 压钉拔除+主窗同款实证', async () => {
    // 主窗基线：全局滚动条即 webkit 一族（加载链文本实证——base.css 无标准属性压钉）
    const mainBase = await evaluate(async () => {
      const t = await fetch('styles/base.css').then(r => r.text()).catch(() => '');
      return { thumb: t.includes('background: var(--bg-active); border-radius: 5px; border: 2px solid transparent; background-clip: content-box;'), noStd: !t.includes('scrollbar-width') && !t.includes('scrollbar-color') };
    });
    human.log('主窗一族:', JSON.stringify(mainBase));
    await human.assert(mainBase.thumb && mainBase.noStd, `主窗必须 webkit 一族且无压钉（实拿 ${JSON.stringify(mainBase)}）`);
    // 面板：help 长内容——computed scrollbarWidth 不得为 thin + 加载链文本三钉
    await evaluate(() => window.mazz.invoke('panel:open', { kind: 'help' }).catch(() => {}));
    await wait(2400);
    const pw = app.windows().find(w => w.url().includes('/panels/help.html'));
    await human.assert(!!pw, '帮助子窗必须开');
    const st = await pw.evaluate(async () => {
      const el = document.querySelector('.ps-scroll') || document.querySelector('[class*=scroll]') || document.body;
      const sw = getComputedStyle(el).scrollbarWidth;
      const cssText = await fetch('panel-shared.css').then(r => r.text()).catch(() => '');
      return {
        sw,
        noThinDecl: !cssText.includes('scrollbar-width: thin;'),
        webkit10: cssText.includes('*::-webkit-scrollbar { width: 10px; height: 10px; }'),
        themed: cssText.includes('background: var(--bg-active); border-radius: 5px; border: 2px solid transparent; background-clip: content-box;'),
        hover: cssText.includes('scrollbar-thumb:hover { background: var(--accent);'),
      };
    }).catch(() => null);
    human.log('子窗实证:', JSON.stringify(st));
    await human.assert(st && st.sw !== 'thin', `标准属性压钉必须拔除（实拿 scrollbarWidth=${st?.sw}）`);
    await human.assert(st.noThinDecl && st.webkit10 && st.themed && st.hover, `webkit 一族必须完整在位（实拿 ${JSON.stringify(st)}）`);
    await pw.close().catch(() => {});
    await wait(400);
  });
}
