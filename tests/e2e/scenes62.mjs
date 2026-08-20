// tests/e2e/scenes62.mjs —— W58h 实证批（scoped：右栏极限拖拽不脱同步）
export async function scenes62({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  await scenario('右栏·极限拖拽不脱同步', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newViewer'));
    await wait(2000);
    await evaluate(() => document.querySelector('[data-a=list]')?.click()).catch(() => {});
    await wait(600);
    // 极限左拖：grip 按住往左甩到窗左缘（远超任何上界）
    const g = await evaluate(() => {
      const grip = document.querySelector('.mz-side-grip');
      if (!grip) return null;
      const r = grip.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await human.assert(!!g, 'grip 必须在');
    await win.mouse.move(g.x, g.y);
    await win.mouse.down();
    for (let i = 1; i <= 10; i++) await win.mouse.move(g.x - i * 140, g.y, { steps: 2 });
    await win.mouse.up();
    await wait(600);
    const st = await evaluate(() => {
      const side = document.querySelector('.mz-side');
      const ctr = document.querySelector('.mz-controls');
      const stage = document.querySelector('.mz-stage');
      const sideR = side.getBoundingClientRect(), ctrR = ctr.getBoundingClientRect();
      const ctl = window.__activeViewerCtl;
      return {
        ctlW: ctl?._player?.sideW ?? ctl?.sideW ?? null,
        renderedW: Math.round(sideR.width),
        panelLeft: Math.round(sideR.left),
        controlsRight: Math.round(ctrR.right),
        stageW: Math.round(stage.getBoundingClientRect().width),
        expected: Math.max(150, Math.min(520, Math.round(stage.getBoundingClientRect().width) - 240, Math.floor(stage.getBoundingClientRect().width * 0.3))),
      };
    });
    human.log('极限拖拽:', JSON.stringify(st));
    await human.assert(st.renderedW === st.expected, `渲染宽必须=同函数上界（实拿 ${st.renderedW} 望 ${st.expected}）`);
    await human.assert(Math.abs(st.controlsRight - st.panelLeft) <= 2, `底栏右缘必须贴面板左缘=零幽灵让位（实拿 ctr=${st.controlsRight} panel=${st.panelLeft}）`);
    // 回拖右侧复位常态（260 默认域内）
    await win.mouse.move(st.panelLeft, 400);
    await win.mouse.down();
    await win.mouse.move(st.panelLeft + 400, 400, { steps: 6 });
    await win.mouse.up();
    await wait(500);
    const back = await evaluate(() => {
      const side = document.querySelector('.mz-side');
      const ctr = document.querySelector('.mz-controls');
      return { renderedW: Math.round(side.getBoundingClientRect().width), controlsRight: Math.round(ctr.getBoundingClientRect().right), panelLeft: Math.round(side.getBoundingClientRect().left) };
    });
    human.log('回拖复位:', JSON.stringify(back));
    await human.assert(Math.abs(back.controlsRight - back.panelLeft) <= 2, `复位也必须贴合（实拿 ${JSON.stringify(back)}）`);
  });
}
