// tests/e2e/scenes57.mjs —— W58c 实证批：①分屏自动刷新 ②播放器栏宽 ③自定义主题子窗 ④B12b 收编 ⑤B13b 窄列
import http from 'http';

export async function scenes57({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  // 本地页面伺服（分屏刷新断言用：重载=页面全局标记消失）
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body><h1 id="mk">W58C-SPLIT</h1></body></html>');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', () => r()));
  const PORT = srv.address().port;
  const PAGE = `http://127.0.0.1:${PORT}/p`;

  try {
    // ==================== 1：分屏后自动刷新（视图穿帮根治） ====================
    await scenario('分屏·移签自动刷新页面', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await wait(1400);
      await evaluate((u) => {
        const bctl = window.__activeBrowserCtl;
        const t = bctl?.tabs?.find(x => x.id === bctl.activeId) || bctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
      }, PAGE);
      await wait(1600);
      const shellTabId = await evaluate(async () => {
        const bctl = window.__activeBrowserCtl;
        const t = bctl?.tabs?.find(x => x.id === bctl.activeId) || bctl?.tabs?.[0];
        if (!t) return null;
        await window.mazz.invoke('bv:js', { tabId: t.viewId, code: 'window.__w58cMark = "alive"; 1' }).catch(() => {});
        return window.MazzShell?.paneTree?.tabs?.active?.id || null;
      });
      await human.assert(!!shellTabId, '浏览器壳页签必须在');
      // 向右分屏（移签跨窗格——触发 pane:tabMoved 唯一闸）
      await evaluate((id) => window.MazzShell?.splitWithTab?.(id, 'right'), shellTabId);
      await wait(1500); // 80ms 延后闸 + 重载耗时
      const after = await evaluate(() => {
        const panes = document.querySelectorAll('.pane').length;
        const bctl = window.__activeBrowserCtl;
        const t = bctl?.tabs?.find(x => x.id === bctl.activeId) || bctl?.tabs?.[0];
        return { panes, viewId: t?.viewId || null };
      });
      await human.assert(after.panes >= 2, `必须分出双窗格（实拿 ${after.panes}）`);
      const chk = await evaluate(async (vid) => {
        if (!vid) return null;
        const mark = await window.mazz.invoke('bv:js', { tabId: vid, code: 'typeof window.__w58cMark' }).catch(e => 'ERR');
        const mk = await window.mazz.invoke('bv:js', { tabId: vid, code: "!!document.getElementById('mk')" }).catch(() => null);
        return { mark, mk };
      }, after.viewId);
      human.log('分屏后视图状态:', JSON.stringify(chk));
      await human.assert(chk && chk.mark === 'undefined', `挪窝后必须自动重载（页面标记应消失=重绘，实拿 ${JSON.stringify(chk)}）`);
      await human.assert(chk.mk === true, '重载后必须仍是原页（mk 在）');
      // 清场：关新窗格页签回单格
      await evaluate(() => {
        const leaves = window.MazzShell?.paneTree?.leaves?.() || [];
        const last = leaves[leaves.length - 1];
        const t = last?.tabs?.tabs?.[0];
        if (t) window.MazzCommands?.execute('file.closeTab', { id: t.id });
      }).catch(() => {});
      await wait(600);
    });

    // ==================== 2：播放器底部栏最低宽度 ====================
    await scenario('播放器·底部栏全组件不被压', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newViewer'));
      await wait(1500);
      const r = await evaluate(() => {
        const bar = document.querySelector('.mz-bar');
        const ctr = document.querySelector('.mz-controls');
        if (!bar || !ctr) return null;
        const cs = getComputedStyle(bar), cc = getComputedStyle(ctr);
        return {
          minWidth: cs.minWidth, zIndex: cc.zIndex,
          btns: bar.querySelectorAll('.mz-btn').length,
          speedBtn: !!bar.querySelector('.selmenu-btn'), // B12b 倍速已子窗格化
          speedSelHidden: getComputedStyle(bar.querySelector('.mz-speed')).display === 'none',
        };
      });
      human.log('播放器栏:', JSON.stringify(r));
      await human.assert(!!r, '播放器栏必须在');
      await human.assert(r.minWidth === 'max-content', `bar min-width 必须 max-content（实拿 ${r.minWidth}）`);
      await human.assert(r.zIndex === '9', `controls z-index 必须 9 压侧栏（实拿 ${r.zIndex}）`);
      await human.assert(r.btns >= 17, `全组件必须在 DOM（实拿 ${r.btns} 钮）`);
      await human.assert(r.speedBtn && r.speedSelHidden, '倍速必须已子窗格化（按钮在+select 隐）');
    });

    // ==================== 3：自定义主题子窗不再透明 ====================
    await scenario('主题·自定义包下子窗变量跟随', async () => {
      await evaluate(async (ws) => {
        await window.mazz.invoke('fs:mkdir', { path: ws + '/themes' }).catch(() => {});
        await window.mazz.invoke('fs:writeFile', {
          path: ws + '/themes/w58c测.json',
          content: JSON.stringify({ name: 'W58C测', base: 'paper', vars: { bg: '#123456', fg: '#eeeeee', 'bg-elev': '#1e4a70', border: '#2a5a80' } }),
        });
      }, WS);
      await wait(400);
      await evaluate(() => window.MazzShell?.setTheme?.('pack:w58c测'));
      await wait(1200);
      const mainVars = await evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
      await human.assert(mainVars === '#123456', `主窗自定义变量必须落（实拿 ${mainVars}）`);
      await evaluate(() => window.mazz.invoke('panel:open', { kind: 'settings' }).catch(() => {}));
      await wait(2500);
      const pw = app.windows().find(w => w.url().includes('/panels/settings.html'));
      await human.assert(!!pw, '设置子窗必须开');
      const pv = await pw.evaluate(() => ({
        bg: getComputedStyle(document.querySelector('.pwin')).backgroundColor,
        v: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
        theme: document.documentElement.dataset.theme,
      })).catch(() => null);
      human.log('子窗主题:', JSON.stringify(pv));
      await human.assert(pv && pv.v === '#123456', `子窗变量必须跟随自定义包（实拿 ${JSON.stringify(pv)}——旧版透明裸钉）`);
      await human.assert(pv.bg === 'rgb(18, 52, 86)', `子窗背景必须真上色不透明（实拿 ${pv.bg}）`);
      await pw.close().catch(() => {});
      await evaluate(() => window.MazzShell?.setTheme?.('paper'));
      await wait(800);
    });

    // ==================== 4：B12b 收编实证 ====================
    await scenario('B12b·工作区切换器子窗格', async () => {
      const st = await evaluate(() => {
        const sel = document.querySelector('.sb-ws-sel');
        const btn = document.querySelector('.sb-ws-btn');
        return { hidden: sel ? getComputedStyle(sel).display === 'none' : null, btn: !!btn, label: btn?.textContent?.trim() };
      });
      human.log('工作区切换器:', JSON.stringify(st));
      await human.assert(st.hidden === true && st.btn === true, `select 必须隐+按钮必须代（实拿 ${JSON.stringify(st)}）`);
      await evaluate(() => document.querySelector('.sb-ws-btn')?.click());
      await wait(1500);
      const ctx = app.windows().find(w => w.url().includes('/panels/ctxmenu.html'));
      await human.assert(!!ctx, '点击必须开 ctxmenu 子窗格');
      const items = await ctx.evaluate(() => [...document.querySelectorAll('.mi .t')].map(x => x.textContent)).catch(() => []);
      human.log('切换器选单:', JSON.stringify(items));
      await human.assert(items.length >= 1, '工作区项必须列出');
      // 点第一项=当前工作区（幂等切换）
      await ctx.evaluate(() => document.querySelector('.mi')?.click());
      await wait(800);
      const after = await evaluate(() => document.querySelector('.sb-ws-sel')?.value);
      await human.assert(!!after, '选后 select 值必须联动');
    });

    await scenario('B12b·导图样式条批收编', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
      await wait(1600);
      // 点根节点出样式条
      const clicked = await evaluate(() => {
        const n = document.querySelector('.mm-node');
        if (!n) return false;
        const r = n.getBoundingClientRect();
        n.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
        n.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
        n.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
        return true;
      });
      await human.assert(clicked, '导图节点必须在');
      await wait(1000);
      const st = await evaluate(() => {
        const sels = [...document.querySelectorAll('select.mm-sb')];
        return { total: sels.length, hidden: sels.filter(s => getComputedStyle(s).display === 'none').length, btns: document.querySelectorAll('.selmenu-btn').length };
      });
      human.log('导图样式条:', JSON.stringify(st));
      await human.assert(st.total >= 3, `样式条 select 必须在（实拿 ${st.total}）`);
      await human.assert(st.hidden === st.total && st.btns >= st.total, `样式条 select 必须全收编（实拿 ${JSON.stringify(st)}）`);
      // 清场关签
      await evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
      await wait(400);
    });

    // ==================== 5：B13b 窄列后缀隐藏 ====================
    await scenario('B13b·窄列隐藏父路径后缀', async () => {
      // 先确认宽列下后缀可见
      const wide = await evaluate(() => {
        const ft = document.querySelector('.filetree');
        const dir = ft?.querySelector('.ft-dir');
        if (!ft || !dir) return null;
        return { w: ft.getBoundingClientRect().width, shown: getComputedStyle(dir).display !== 'none' };
      });
      human.log('宽列基线:', JSON.stringify(wide));
      await human.assert(wide && wide.shown === true, '宽列下后缀必须可见（基线）');
      // 压窄到 150px → RO 挂 ft-narrow → 后缀整族隐
      await evaluate(() => { document.querySelector('.filetree').style.width = '150px'; });
      await wait(700);
      const narrow = await evaluate(() => {
        const ft = document.querySelector('.filetree');
        const dir = ft?.querySelector('.ft-dir');
        return { cls: ft?.classList.contains('ft-narrow'), shown: dir ? getComputedStyle(dir).display !== 'none' : null };
      });
      human.log('窄列:', JSON.stringify(narrow));
      await human.assert(narrow.cls === true, '窄列必须挂 ft-narrow 类');
      await human.assert(narrow.shown === false, '窄列后缀必须隐藏（「..st」视觉垃圾根治）');
      // 还原：类必摘后缀必回
      await evaluate(() => { document.querySelector('.filetree').style.width = ''; });
      await wait(700);
      const back = await evaluate(() => ({
        cls: document.querySelector('.filetree')?.classList.contains('ft-narrow'),
        shown: getComputedStyle(document.querySelector('.ft-dir')).display !== 'none',
      }));
      await human.assert(back.cls === false && back.shown === true, `还原必须回弹（实拿 ${JSON.stringify(back)}）`);
    });
  } finally { srv.close(); }
}
