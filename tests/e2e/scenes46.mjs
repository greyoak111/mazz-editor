// tests/e2e/scenes46.mjs —— 子窗滚动条全族 + 批注色板实证批（军规④/军规⑤：溢出必滚，截图亲验）
import fs from 'fs';

export async function scenes46({ app, win, human, WS, scenario }) {
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
    // ==================== 1：palette 滚动条（修复前 main 无 overflow=静默裁切） ====================
    await scenario('命令面板·溢出必滚', async () => {
      await evaluate(() => window.mazz.invoke('panel:open', { kind: 'palette' }).catch(() => {}));
      const pw = await findPanel('/panels/palette.html');
      await human.assert(!!pw, '命令面板子窗必须打开');
      await wait(800);
      // 输入空串触发全量命令渲染（50 条上限——480px 窗必溢出）
      await pw.fill('#q', 'e').catch(() => {});
      await wait(900); // paletteQuery → panel:push 往返
      const st = await pw.evaluate(() => {
        const m = document.querySelector('main');
        const cs = getComputedStyle(m);
        return { overflowY: cs.overflowY, scrollH: m.scrollHeight, clientH: m.clientHeight, rows: m.querySelectorAll('.row').length };
      });
      await human.assert(st.overflowY === 'auto', `palette main overflowY 必须 auto（实拿 ${st.overflowY}）`);
      await human.assert(st.scrollH > st.clientH, `内容必须真溢出（${st.scrollH} > ${st.clientH}，${st.rows} 行）——不溢出的滚动条测试是假把式`);
      await human.assert(st.rows >= 20, `命令行必须真渲染（${st.rows} 行）`);
      // 滚动机制真活实证：scrollTop 赋值必须真位移（外观颜色看不见没关系，机制必须真）
      const scrolled = await pw.evaluate(() => { const m = document.querySelector('main'); m.scrollTop = 300; return m.scrollTop; });
      await human.assert(scrolled === 300, `scrollTop 必须真位移（实拿 ${scrolled}）——滚动机制死活试金石`);
      await pw.screenshot({ path: `${OUT}/w52e-滚动条-palette.png` }).catch(() => {});
    });

    // ==================== 2：shortcuts 滚动条（mazz-scroll 虚挂类名平反） ====================
    await scenario('快捷键速查·溢出必滚', async () => {
      await evaluate(() => window.mazz.invoke('panel:open', { kind: 'shortcuts' }).catch(() => {}));
      const pw = await findPanel('/panels/shortcuts.html');
      await human.assert(!!pw, '快捷键子窗必须打开');
      await wait(1000); // shortcutQuery → panel:push
      const st = await pw.evaluate(() => {
        const m = document.querySelector('main');
        const cs = getComputedStyle(m);
        return { overflowY: cs.overflowY, scrollH: m.scrollHeight, clientH: m.clientHeight };
      });
      await human.assert(st.overflowY === 'auto', `shortcuts main overflowY 必须 auto（实拿 ${st.overflowY}）`);
      await human.assert(st.scrollH > st.clientH, `快捷键清单必须真溢出（${st.scrollH} > ${st.clientH}）`);
      await pw.screenshot({ path: `${OUT}/w52e-滚动条-shortcuts.png` }).catch(() => {});
    });

    // ==================== 3：收藏管理滚动条（60 条假数据撑爆） ====================
    await scenario('收藏管理·溢出必滚', async () => {
      await evaluate(async () => {
        const bms = [];
        for (let i = 0; i < 60; i++) bms.push({ url: `https://example-${i}.com/`, title: `测试收藏 ${i}`, name: `测试收藏 ${i}`, folder: 'default', at: Date.now() - i * 1000 });
        await window.mazz.invoke('settings:set', { key: 'browser.bookmarks', value: bms }).catch(() => {});
        await window.mazz.invoke('settings:set', { key: 'browser.folders', value: [{ id: 'default', name: '默认收藏夹' }] }).catch(() => {});
      });
      await evaluate(() => window.mazz.invoke('panel:open', { kind: 'favmgr' }).catch(() => {}));
      const pw = await findPanel('/panels/favmgr.html');
      await human.assert(!!pw, '收藏管理子窗必须打开');
      await wait(1200); // loadStore
      const st = await pw.evaluate(() => {
        const m = document.querySelector('main');
        const cs = getComputedStyle(m);
        return { overflowY: cs.overflowY, scrollH: m.scrollHeight, clientH: m.clientHeight, items: m.querySelectorAll('.item').length };
      });
      await human.assert(st.overflowY === 'auto', `favmgr main overflowY 必须 auto（实拿 ${st.overflowY}）`);
      await human.assert(st.scrollH > st.clientH, `60 条收藏必须真溢出（${st.scrollH} > ${st.clientH}，${st.items} 条）`);
      await pw.screenshot({ path: `${OUT}/w52e-滚动条-favmgr.png` }).catch(() => {});
    });

    // ==================== 4：批注色板 20px 实证 ====================
    await scenario('批注色板·挤坨平反', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
      await wait(1000);
      await evaluate(() => window.MazzCommands?.execute('annotate.toggle'));
      const aw = await findPanel('/panels/annotate.html');
      await human.assert(!!aw, '批注墨迹子窗必须打开');
      await wait(800);
      const st = await aw.evaluate(() => {
        const c = document.querySelector('.bar .c');
        const cs = getComputedStyle(c);
        const bar = document.querySelector('.bar');
        return { w: cs.width, h: cs.height, gap: getComputedStyle(bar).gap, count: bar.querySelectorAll('.c').length };
      });
      await human.assert(st.w === '20px' && st.h === '20px', `色板必须 20px（实拿 ${st.w}×${st.h}，共 ${st.count} 色）`);
      await human.assert(st.gap === '10px', `色板间距必须 10px（实拿 ${st.gap}）`);
      await aw.screenshot({ path: `${OUT}/w52e-批注色板.png` }).catch(() => {});
      // 退出收尸
      await aw.evaluate(() => document.querySelector('[data-a=exit]')?.click?.() || document.getElementById('p-close')?.click?.()).catch(() => {});
    });
  } finally {}
}
