// W59f 终端栏拉伸真界面实证
export async function scenes72({ win, human, scenario, shotDir }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const state = () => win.evaluate(() => {
    const root = document.querySelector('.code-root');
    const bottom = root?.querySelector('.code-bottom');
    const grip = root?.querySelector('.code-term-grip');
    const rr = root?.getBoundingClientRect();
    const br = bottom?.getBoundingClientRect();
    const gr = grip?.getBoundingClientRect();
    return {
      rootH: rr?.height || 0, bottomH: br?.height || 0,
      grip: gr ? { x: gr.left + gr.width / 2, y: gr.top + gr.height / 2 } : null,
      hidden: grip?.hidden ?? true, terms: document.querySelectorAll('.term-view').length,
    };
  });

  await scenario('W59f·终端上缘拉伸与限位', async () => {
    await human.evaluate(() => window.MazzCommands?.execute('file.newCode'));
    await human.until(() => !!window.__activeCodeCtl?.ready, { timeout: 15000, msg: 'Monaco 就绪' });
    await wait(700);
    await human.evaluate(() => document.querySelector('#agree-accept')?.click());
    await wait(250);
    await human.evaluate(() => window.MazzCommands?.execute('code.toggleTerminal'));
    await human.until(() => document.querySelectorAll('.term-view').length > 0, { timeout: 15000, msg: '集成终端就绪' });
    await human.until(() => {
      const h = document.querySelector('.code-bottom')?.getBoundingClientRect().height || 0;
      return h >= 258;
    }, { timeout: 5000, msg: '终端展开动画落稳' });
    await wait(100);
    const before = await state();
    await human.assert(!before.hidden && before.terms === 1, '终端展开后 grip 可见且终端已创建');
    await win.mouse.move(before.grip.x, before.grip.y);
    await win.mouse.down();
    await win.mouse.move(before.grip.x, before.grip.y - 110, { steps: 8 });
    await win.mouse.up();
    await wait(300);
    const grown = await state();
    await human.assert(grown.bottomH > before.bottomH + 80, `向上拖必须增高（${before.bottomH}→${grown.bottomH}）`);
    await human.assert(grown.bottomH <= Math.floor(grown.rootH * 0.6) + 2, '终端不得超过代码区 60%');
    await win.screenshot({ path: shotDir + '/w59f-terminal-resized.png' });

    // 极限向下，验证两行下限。
    await win.mouse.move(grown.grip.x, grown.grip.y);
    await win.mouse.down();
    await win.mouse.move(grown.grip.x, grown.grip.y + 1000, { steps: 6 });
    await win.mouse.up();
    await wait(250);
    const minned = await state();
    await human.assert(Math.round(minned.bottomH) === 72, `终端下限必须为 72px（实得 ${minned.bottomH}）`);

    // 双击恢复默认高并落盘。
    await win.mouse.dblclick(minned.grip.x, minned.grip.y);
    await wait(350);
    const reset = await state();
    await human.assert(Math.abs(reset.bottomH - 260) <= 2, `双击必须恢复 260px（实得 ${reset.bottomH}）`);
  });

  await scenario('W59f·同窗格重开高度恢复', async () => {
    let s = await state();
    await win.mouse.move(s.grip.x, s.grip.y);
    await win.mouse.down();
    await win.mouse.move(s.grip.x, s.grip.y - 55, { steps: 5 });
    await win.mouse.up();
    await wait(300);
    const saved = await state();
    await human.evaluate(() => window.MazzCommands?.execute('file.closeTab'));
    await wait(350);
    await human.evaluate(() => window.MazzCommands?.execute('file.newCode'));
    await human.until(() => !!window.__activeCodeCtl?.ready, { timeout: 15000, msg: '重开 Monaco 就绪' });
    await human.evaluate(() => window.MazzCommands?.execute('code.toggleTerminal'));
    await human.until(() => document.querySelectorAll('.term-view').length > 0, { timeout: 15000, msg: '重开终端就绪' });
    await wait(350);
    const restored = await state();
    await human.assert(Math.abs(restored.bottomH - saved.bottomH) <= 2, `同窗格高度必须恢复（${saved.bottomH}→${restored.bottomH}）`);
  });
}
