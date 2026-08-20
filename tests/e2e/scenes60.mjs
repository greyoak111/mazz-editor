// tests/e2e/scenes60.mjs —— W58f 实证批（军规⑲ scoped：播放器三栏/面板滚动锁/新建文件窗控）
export async function scenes60({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  // ==================== 1：窗口态底栏常驻+右栏自适应 ====================
  await scenario('播放器·窗口态底栏常驻', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newViewer'));
    await wait(2000);
    await evaluate(() => document.querySelector('[data-a=list]')?.click()).catch(() => {});
    await wait(600);
    // 等到超过旧 2.4s 隐藏窗（旧病：窗口态 fade 消失）
    await wait(3200);
    const st = await evaluate(() => {
      const ctr = document.querySelector('.mz-controls');
      const bar = document.querySelector('.mz-bar');
      const side = document.querySelector('.mz-side');
      const stage = document.querySelector('.mz-stage');
      return {
        opacity: ctr ? getComputedStyle(ctr).opacity : null,
        fade: ctr?.classList.contains('fade') ?? null,
        actions: document.querySelectorAll('.mz-player [data-player-min]').length,
        clientWidth: bar?.clientWidth ?? 0, scrollWidth: bar?.scrollWidth ?? 0,
        more: !!bar?.querySelector('[data-a=more-controls]'), density: ctr?.dataset.density,
        sideW: side?.getBoundingClientRect().width ?? 0,
        stageW: stage?.getBoundingClientRect().width ?? 0,
      };
    });
    human.log('底栏常驻:', JSON.stringify(st));
    await human.assert(st.opacity === '1' && st.fade === false, `窗口态底栏必须常驻（实拿 opacity=${st.opacity} fade=${st.fade}）`);
    await human.assert(st.actions >= 17 && st.more && st.density, `全能力必须在 Control Surface 可达（实拿 ${JSON.stringify(st)}）`);
    await human.assert(st.scrollWidth <= st.clientWidth + 1, `底栏不得越过 control seat（实拿 ${st.scrollWidth}/${st.clientWidth}）`);
    // 右栏 24% 封顶实证（1920 视口下 260 ≤ 24%——先确认基线）
    await human.assert(st.sideW <= Math.ceil(st.stageW * 0.24) + 1, `右栏必须 ≤24% 舞台（实拿 ${st.sideW}/${st.stageW}）`);
  });

  // ==================== 2：左栏工作区 32vw 封顶 ====================
  await scenario('左栏·工作区 32vw 封顶', async () => {
    const st = await evaluate(() => {
      const sb = document.querySelector('.sidebar');
      const cs = getComputedStyle(sb);
      return { w: sb.getBoundingClientRect().width, max: cs.maxWidth, vw: window.innerWidth };
    });
    human.log('左栏:', JSON.stringify(st));
    await human.assert(st.max === '32vw' || st.max.endsWith('px'), `max-width 必须落（实拿 ${st.max}）`);
    const capPx = st.max === '32vw' ? st.vw * 0.32 : parseFloat(st.max);
    await human.assert(st.w <= Math.ceil(capPx) + 1, `左栏宽必须 ≤32vw（实拿 ${st.w} vs ${Math.round(capPx)}）`);
    await evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
    await wait(300);
  });

  // ==================== 3：面板外飘轨绝育 ====================
  await scenario('面板·外飘轨绝育内滚唯一', async () => {
    await evaluate(() => window.MazzCommands?.execute('fileTree.newFile'));
    await wait(2400);
    const pw = app.windows().find(w => w.url().includes('/panels/newfile.html'));
    await human.assert(!!pw, '新建文件子窗必须开');
    // 先压窗高逼内容溢出（18 卡全显时内滚不激活=测不出唯一性）
    await pw.setViewportSize({ width: 560, height: 360 }).catch(() => {});
    await wait(600);
    const st = await pw.evaluate(() => {
      const de = document.documentElement;
      const body = document.querySelector('.body');
      return {
        vbar: window.innerWidth - de.clientWidth, // 文档级竖滚动条占位（>0=外飘轨现身）
        bodyScrollable: body ? body.scrollHeight > body.clientHeight + 1 : null,
        bodyFlex: body ? getComputedStyle(body).flexGrow : null,
        htmlOv: getComputedStyle(de).overflow,
      };
    }).catch(() => null);
    human.log('滚动锁:', JSON.stringify(st));
    await human.assert(st && st.vbar === 0, `文档级滚动条必须绝迹=外飘轨绝育（实拿占位 ${st?.vbar}px）`);
    await human.assert(st.htmlOv === 'hidden', '文档级必须锁溢出');
    await human.assert(st.bodyScrollable === true && st.bodyFlex === '1', `内滚必须唯一且 flex:1（实拿 ${JSON.stringify(st)}）`);
    await pw.close().catch(() => {});
    await wait(400);
  });

  // ==================== 4：新建文件窗控三键归位 ====================
  await scenario('新建文件·窗控三键右上悬浮', async () => {
    await evaluate(() => window.MazzCommands?.execute('fileTree.newFile'));
    await wait(2200);
    const pw = app.windows().find(w => w.url().includes('/panels/newfile.html'));
    await human.assert(!!pw, '子窗必须开');
    const st = await pw.evaluate(() => {
      const wb = document.querySelector('.p-winbtns');
      if (!wb) return null;
      const cs = getComputedStyle(wb);
      const r = wb.getBoundingClientRect();
      return { pos: cs.position, top: cs.top, right: cs.right, rx: Math.round(window.innerWidth - r.right), btns: wb.querySelectorAll('button').length };
    }).catch(() => null);
    human.log('窗控:', JSON.stringify(st));
    await human.assert(st && st.pos === 'absolute' && st.top === '2px' && st.right === '8px', `三键必须右上悬浮（实拿 ${JSON.stringify(st)}）`);
    await human.assert(st.btns === 3, '三键必须齐（收起/最大/关闭）');
    await pw.close().catch(() => {});
    await wait(300);
  });
}
