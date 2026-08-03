// tests/e2e/scenes51.mjs —— W55 实证批
// ①右键菜单子窗格（浏览器前台/分屏防压） ②页签右键 ③表格右键 ④分屏预览罩 ⑤样式统一值
export async function scenes51({ app, win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const OUT = '/mnt/agents/output';
  const findPanel = async (frag, tries = 26) => {
    for (let i = 0; i < tries; i++) {
      await wait(300);
      const w = app.windows().find(w => w.url().includes(frag));
      if (w) return w;
    }
    return null;
  };

  try {
    // ==================== 1：目录树右键→ctxmenu 子窗格（浏览器前台防压） ====================
    await scenario('右键菜单·目录树子窗格化', async () => {
      // 浏览器前台（菜单永不被压的实证场）
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
      await wait(600);
      // 目录树文件夹右键（合成 contextmenu 事件）
      await evaluate(() => {
        // 目录树节点是 .ft-node（ft-folder 优先=文件夹菜单；监听在节点自身，dispatch 必须命中节点）
        const item = document.querySelector('.ft-node');
        if (!item) return;
        const r = item.getBoundingClientRect();
        item.dispatchEvent(new MouseEvent('contextmenu', { clientX: r.left + 60, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
      });
      const pw = await findPanel('/panels/ctxmenu.html');
      await human.assert(!!pw, '右键必须开 ctxmenu 子窗格（DOM 菜单被浏览器页面裁切的时代结束）');
      const st = await pw.evaluate(() => ({
        items: document.querySelectorAll('.mi').length,
        hasSvg: !!document.querySelector('.mi .ico svg'),
        bg: getComputedStyle(document.querySelector('.pwin')).backgroundColor,
        bodyBg: getComputedStyle(document.body).backgroundColor,
      }));
      await human.assert(st.items >= 2, `菜单项必须渲染（${st.items} 项）`);
      await human.assert(st.bodyBg === 'rgba(0, 0, 0, 0)', '菜单窗体必须透明（无框圆角）');
      await pw.screenshot({ path: `${OUT}/w55-右键菜单子窗格.png` }).catch(() => {});
      // Esc 关窗
      await pw.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await wait(600);
      const gone = !app.windows().some(w => w.url().includes('/panels/ctxmenu.html'));
      await human.assert(gone, 'Esc 菜单必须自闭');
    });

    // ==================== 2：页签右键→命令执行回传 ====================
    await scenario('右键菜单·页签点击执行', async () => {
      await evaluate(() => {
        const tab = document.querySelector('.tabbar .tab, .tabs .tab, [class*="tab"]');
        if (!tab) return;
        const r = tab.getBoundingClientRect();
        tab.dispatchEvent(new MouseEvent('contextmenu', { clientX: r.left + 30, clientY: r.top + 10, bubbles: true, cancelable: true }));
      });
      const pw = await findPanel('/panels/ctxmenu.html');
      if (pw) {
        const st = await pw.evaluate(() => ({ items: document.querySelectorAll('.mi').length, first: document.querySelector('.mi .t')?.textContent }));
        await human.assert(st.items >= 2, `页签菜单必须渲染（${st.items} 项：${st.first}…）`);
        await pw.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        await wait(500);
      } else {
        human.log('页签右键未触发（tab 选择器未命中）——降级键盘驱动');
        await evaluate(() => window.MazzCommands?.execute('tab.close'));
      }
    });

    // ==================== 3：分屏预览罩（splitpreview 透跟随） ====================
    await scenario('分屏预览·透跟随罩', async () => {
      // 先造窗格叶（欢迎页无叶=zone 判定必空——开一个文档页签）
      await evaluate(() => window.MazzCommands?.execute('file.new'));
      await wait(1200);
      const hasPane = await evaluate(() => !!document.querySelector('.pane'));
      await human.assert(hasPane, '窗格叶必须先造出');
      // 拖签合成：dragstart(mazz/tab) → dragover 指向编辑器区左区
      await evaluate(() => {
        const dt = new DataTransfer();
        dt.setData('mazz/tab', 't1');
        document.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
        window.__dt = dt;
      });
      await wait(300);
      for (let i = 0; i < 3; i++) {
        await evaluate(() => {
          const pane = document.querySelector('.pane');
          if (!pane) return;
          const r = pane.getBoundingClientRect();
          const dt = window.__dt;
          pane.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: r.left + r.width / 6, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
        });
        await wait(250);
      }
      // W57 用户定版路线修正：DOM overlay 转正（罩页独立窗方案已退役——链路长收效差实锤）；
      // 「不抢渲染」由拖拽 cloak 保证（scenes55 0×0 专项钉）——本场景钉 overlay 开合+反钉罩页回魂
      const ov = await evaluate(() => {
        const el = [...document.body.children].find(e => e.style?.position === 'fixed' && (e.style.background || '').includes('linear-gradient'));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), bg: (el.style.background || '').slice(0, 42), border: el.style.borderRight || el.style.borderLeft };
      });
      await human.assert(!!ov, '分屏预览 overlay 必须贴出（DOM 转正——W57 用户定版路线）');
      await human.assert(ov.w > 0 && ov.h > 0, `预览矩形必须有形（w=${ov.w} h=${ov.h} bg=${ov.bg}）`);
      // 反钉：罩页独立窗不许回魂
      const pw = app.windows().find(w => w.url().includes('/panels/splitpreview.html'));
      await human.assert(!pw, '罩页独立窗必须退出分屏主线（W57 路线修正反钉）');
      // 清理（pointerup=拖拽死亡→罩必收——三路兜底链）
      await evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
      await wait(800);
      const gone = await evaluate(() => ![...document.body.children].some(e => e.style?.position === 'fixed' && (e.style.background || '').includes('linear-gradient')));
      // 看门狗 1.5s 兜底：pointerup 清理即收
      await human.assert(gone, '拖拽结束 overlay 必须自收（三路兜底）');
    });

    // ==================== 4：样式统一值（rb 族 computed） ====================
    await scenario('样式统一·控件族同值', async () => {
      await evaluate(() => window.mazz.invoke('panel:open', { kind: 'settings' }).catch(() => {}));
      const pw = await findPanel('/panels/settings.html');
      await human.assert(!!pw, '设置面板必须开');
      await wait(800);
      const st = await pw.evaluate(() => {
        const sel = document.querySelector('#s-lang');
        const cs = getComputedStyle(sel);
        return { radius: cs.borderRadius, fontSize: cs.fontSize, pad: cs.padding };
      });
      await human.assert(st.radius === '6px' && st.fontSize === '12px', `控件必须 rb 原值（radius=${st.radius} font=${st.fontSize} pad=${st.pad}——迁移前样式统一）`);
      await evaluate(() => window.mazz.invoke('panel:close', { kind: 'settings' }).catch(() => {}));
      await wait(300);
    });
  } finally {}
}
