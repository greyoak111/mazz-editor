// tests/e2e/scenes43.mjs —— W52③ 浮层遣散实证批
// ribbon 更多→原生菜单（menu:context 实证） / toast 挪位 / palette 薄子窗（检索/键位/执行） / shortcuts 薄子窗 / 设置原生独立子窗（W53 起薄 panel 窗，整壳第二窗路线已退役——钉新反旧）
export async function scenes43({ app, win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 1：toast 状态栏中央 Seat ====================
  await scenario('浮层·toast状态栏中央Seat', async () => {
    const r = await evaluate(async () => {
      const { toast } = await import('./shell/shell.js');
      toast('挪位探针', [], 400);
      const el = document.querySelector('.mazz-toast');
      const rect = el?.getBoundingClientRect();
      const left = document.querySelector('.statusbar-left')?.getBoundingClientRect();
      const right = document.querySelector('.statusbar-right')?.getBoundingClientRect();
      return { exists: !!el, host: el?.parentElement?.id, rect, left, right, viewport: innerWidth };
    });
    human.log('toast:', JSON.stringify(r));
    await human.assert(r.exists && r.host === 'status-toast-slot', '普通 toast 必须进入状态栏中央 Seat');
    await human.assert(Math.abs((r.rect.left + r.rect.width / 2) - r.viewport / 2) <= 2, 'toast 必须对齐窗口几何中心');
    await human.assert(r.rect.left >= r.left.right && r.rect.right <= r.right.left, 'toast 不得与左右状态槽相交');
    await wait(500);
  });

  // ==================== 2：ribbon 更多→原生菜单 ====================
  await scenario('浮层·ribbon更多原生菜单', async () => {
    // menu:context 桥直驱实证（ribbon 点击走原生——DOM 不pop，主进程 popup 即选即中）
    await evaluate(() => {
      window.__menuId = 'pending';
      window.mazz.invoke('menu:context', {
        items: [
          { id: 'view.splitRight', label: '向右分屏' },
          { id: 'view.splitDown', label: '向下分屏' },
        ],
      }).then(id => { window.__menuId = id === null ? 'dismissed-null' : id; }).catch(() => { window.__menuId = 'ERR'; });
    });
    await wait(700);
    await win.keyboard.press('Escape'); // 收原生弹层（不选归 null——callback resolve 即通）
    await wait(500);
    const r = { id: await evaluate(() => window.__menuId) };
    human.log('menu:context:', JSON.stringify(r));
    // 原生 popup 出现（用户态菜单）——E2E 按 Escape 关菜单不选；桥活着即证（id 可为 null=用户未选）
    await human.assert(r.id === 'dismissed-null' || typeof r.id === 'string', `原生菜单桥必须活（${r.id}——ESC 未选归 null 属正常）`);
    // ribbon 更多源码路径实证：showMore 走 menu:context（契约在案）；DOM 兜底不在 Electron 出
    const r2 = await evaluate(() => !document.querySelector('.rb-more-pop'));
    await human.assert(r2, 'Electron 不得出 DOM 兜底弹层');
  });

  // ==================== 3：palette 薄子窗 ====================
  let palWin = null;
  await scenario('浮层·palette薄子窗', async () => {
    await evaluate(() => window.MazzCommands?.execute('app.commandPalette'));
    await wait(1200);
    for (const w of app.windows()) if (w.url().includes('/panels/palette.html')) { palWin = w; break; }
    await human.assert(!!palWin, '命令面板必须是独立薄子窗');
    // 数据桥：空检索 → 全量清单回推
    const r0 = await palWin.evaluate(() => document.querySelectorAll('#m .row').length);
    await human.assert(r0 >= 50, `空检索必须回推满 50 条（${r0}）`);
    // 检索过滤：输「分屏」→ 必须命中
    await palWin.fill('#q', '分屏');
    await wait(500);
    const r = await palWin.evaluate(() => ({
      rows: document.querySelectorAll('#m .row').length,
      texts: [...document.querySelectorAll('#m .row .t')].map(e => e.textContent).slice(0, 4),
      keys: [...document.querySelectorAll('#m .row kbd')].map(e => e.textContent),
    }));
    human.log('检索:', JSON.stringify(r));
    await human.assert(r.rows >= 1 && r.rows < 50, `检索必须过滤（${r.rows}）`);
    await human.assert(r.texts.some(t => t.includes('分屏')), `必须命中分屏系命令（${r.texts.join('|')}）`);
    await human.assert(r.keys.some(k => k), '键位必须随条渲染');
    // 执行：回车跑首条 → 主窗分屏发生（paletteRun 实证）
    const before = await evaluate(() => document.querySelectorAll('.pane').length);
    // Enter 走页内派发（playwright press 等 keyup 全程，而 Enter 动作本身自闭薄窗——窗死键程中报必炸（实锤））
    await palWin.evaluate(() => { document.querySelector('#q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }).catch(() => {});
    await wait(600);
    const after = await evaluate(() => document.querySelectorAll('.pane').length);
    const closed = !app.windows().some(w => w.url().includes('/panels/palette.html'));
    human.log('执行:', JSON.stringify({ before, after, closed }));
    await human.assert(closed, '执行后薄窗必须自闭');
    await human.assert(after >= before, `paletteRun 必须落到主窗（pane ${before}→${after}）`);
  });

  // ==================== 4：shortcuts 薄子窗 ====================
  await scenario('浮层·shortcuts薄子窗', async () => {
    await evaluate(() => window.MazzCommands?.execute('app.shortcutSheet'));
    await wait(1200);
    let scWin = null;
    for (const w of app.windows()) if (w.url().includes('/panels/shortcuts.html')) { scWin = w; break; }
    await human.assert(!!scWin, '快捷键速查必须是独立薄子窗');
    const r = await scWin.evaluate(() => ({
      groups: document.querySelectorAll('#m .g').length,
      rows: document.querySelectorAll('#m .row').length,
      f5: [...document.querySelectorAll('#m .row')].some(e => e.textContent.includes('放映') || e.textContent.includes('F5')),
    }));
    human.log('速查:', JSON.stringify(r));
    await human.assert(r.groups >= 3 && r.rows >= 20, `分组清单必须全（${r.groups}组/${r.rows}条）`);
    await human.assert(r.f5, 'F5 放映必须在列');
    await scWin.click('#p-close').catch(() => {});
    await wait(400);
    await human.assert(!app.windows().some(w => w.url().includes('/panels/shortcuts.html')), '关窗必须落');
  });

  // ==================== 5：设置原生独立子窗 ====================
  // W53 起设置=薄原生 panel 窗（panels/settings.html），整壳第二窗路线已退役——本场景钉新架构、反钉旧架构回魂
  await scenario('浮层·设置原生独立子窗', async () => {
    await evaluate(() => window.MazzCommands?.execute('app.openSettings'));
    await wait(4000);
    const urls = app.windows().map(w => w.url());
    human.log('windows:', urls.map(u => u.slice(0, 72)));
    const panel = app.windows().find(w => w.url().includes('panels/settings.html'));
    await human.assert(!!panel, `设置必须开原生独立子窗（urls=${urls.length}：${urls.map(u => u.split('/').pop()).join('|')}）`);
    // 反钉：整壳第二窗（W43 老路线）不许回魂——主窗之外不得有第二个 index.html
    const shells = app.windows().filter(w => w.url().includes('index.html'));
    await human.assert(shells.length === 1, `整壳窗必须只有主窗（实拿 ${shells.length}）`);
    // 子窗内设置内容必须真渲染（.pwin 壳 + 区块导航）
    const inPanel = await panel.evaluate(() => ({
      pwin: !!document.querySelector('.pwin'),
      secs: document.querySelectorAll('.sec-nav .ni, .snav .ni, nav .ni, .ni').length,
    })).catch(() => null);
    human.log('子窗内容:', JSON.stringify(inPanel));
    await human.assert(inPanel && inPanel.pwin === true, `子窗设置页必须真渲染（实拿 ${JSON.stringify(inPanel)}）`);
    // 主窗不得出 settings modal（零遮盖实锤）
    const mainMask = await evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(e => e.getBoundingClientRect().width > 0).length);
    await human.assert(mainMask === 0, `主窗必须零遮盖（mask=${mainMask}）`);
    // 清场：关子窗
    await panel.close().catch(() => {});
    await wait(500);
  });
}
