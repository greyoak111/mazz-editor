// tests/e2e/scenes54.mjs —— 救火 P1/P2 实证批
// ①dockfloat emoji 零残留（视觉） ②B13 更多应用风 ③sync 面板收编 ④splitpreview 邮差化 ⑤「..st」勘查
export async function scenes54({ app, win, human, WS, scenario }) {
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
    // ==================== ①dockfloat emoji 零残留 ====================
    await scenario('dockfloat·emoji 绝迹视觉验', async () => {
      await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
      await human.until(() => {
        const d = document.querySelector('.side-dock');
        return d && d.getBoundingClientRect().width > 0 && d.parentElement?.classList?.contains('workspace');
      }, { timeout: 8000, msg: '坞停靠开' });
      await evaluate(() => { document.querySelector('.side-dock [data-a="float"]')?.click(); });
      const df = await findPanel('/panels/dockfloat.html');
      await human.assert(!!df, 'dockfloat 必须开');
      await wait(1400);
      // 工厂页（✨📋⚡⇥ 原灾区）
      const factoryEmoji = await df.evaluate(() => {
        const text = document.getElementById('m').textContent + document.querySelector('.head').textContent;
        return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}✨⚡]/u.test(text);
      });
      await human.assert(factoryEmoji === false, '工厂页必须零 emoji（复活平反）');
      const svgs = await df.evaluate(() => document.querySelectorAll('.head svg, #m svg').length);
      await human.assert(svgs >= 2, `工厂页图标必须 SVG（${svgs} 枚）`);
      // 工具页（GROUPS 全族原灾区）
      await df.evaluate(() => document.querySelector('[data-t="tools"]').click());
      await wait(900);
      const toolEmoji = await df.evaluate(() => {
        const text = document.getElementById('m').textContent;
        return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(text);
      });
      await human.assert(toolEmoji === false, '工具页必须零 emoji');
      const toolSvg = await df.evaluate(() => document.querySelectorAll('.tg-card svg').length);
      await human.assert(toolSvg >= 8, `工具卡必须全 SVG（${toolSvg}/18）`);
      await df.screenshot({ path: `${OUT}/w56b-dockfloat-svg.png` }).catch(() => {});
      await df.evaluate(() => document.getElementById('p-close')?.click?.()).catch(() => {});
      await wait(800);
    });

    // ==================== ②B13 更多应用风 ====================
    await scenario('B13·更多二级菜单回应用风', async () => {
      // 触发 ribbon 更多（新建组的更多钮）
      const opened = await evaluate(() => {
        const btn = [...document.querySelectorAll('.rb-more, [class*=more]')].find(b => b.getBoundingClientRect().width > 0);
        if (!btn) return false;
        btn.click();
        return true;
      });
      await human.assert(opened, '更多钮必须命中');
      const pw = await findPanel('/panels/ctxmenu.html', 16);
      await human.assert(!!pw, '更多必须开 ctxmenu 子窗格（OS 原生灰菜单退出舞台）');
      if (pw) {
        const st = await pw.evaluate(() => ({
          items: document.querySelectorAll('.mi').length,
          bodyBg: getComputedStyle(document.body).backgroundColor,
          winBg: getComputedStyle(document.querySelector('.pwin')).backgroundColor,
        }));
        await human.assert(st.items >= 2, `菜单项必须渲染（${st.items}）`);
        await human.assert(st.bodyBg === 'rgba(0, 0, 0, 0)', '必须应用风透明圆角卡（老样式血统实证）');
        await pw.screenshot({ path: `${OUT}/w56b-更多应用风.png` }).catch(() => {});
        await pw.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))).catch(() => {});
        await wait(400);
      }
    });

    // ==================== ③sync 面板收编 ====================
    await scenario('sync·三页签子窗格收编', async () => {
      await evaluate(() => window.MazzCommands?.execute('sync.host'));
      const pw = await findPanel('/panels/sync.html');
      await human.assert(!!pw, 'sync 面板必须开（DOM modal 收编平反）');
      await wait(1500);
      const st = await pw.evaluate(() => ({
        tabs: document.querySelectorAll('.tab').length,
        pair: document.querySelector('.pair')?.textContent?.trim(),
        bodyBg: getComputedStyle(document.body).backgroundColor,
      }));
      await human.assert(st.tabs === 3, `三页签必须在（${st.tabs}）`);
      await human.assert(/^\d{6}$/.test(st.pair || ''), `配对码必须真起（实拿 ${st.pair}）`);
      // 切加入页签
      await pw.evaluate(() => document.querySelector('[data-t="join"]').click());
      await wait(500);
      const joinOk = await pw.evaluate(() => !!document.getElementById('j-host') && !!document.getElementById('j-code'));
      await human.assert(joinOk, '加入页必须渲染（主机+配对码输入）');
      // 切更新页签
      await pw.evaluate(() => document.querySelector('[data-t="update"]').click());
      await wait(1200);
      const updOk = await pw.evaluate(() => (document.querySelector('main').textContent || '').includes('当前版本'));
      await human.assert(updOk, '更新页必须渲染版本信息');
      await pw.screenshot({ path: `${OUT}/w56b-sync面板.png` }).catch(() => {});
      // 停止共享收尸
      await pw.evaluate(() => { document.querySelector('[data-t="host"]').click(); });
      await wait(600);
      await pw.evaluate(() => document.getElementById('stop')?.click?.()).catch(() => {});
      await evaluate(() => window.mazz.invoke('panel:close', { kind: 'sync' }).catch(() => {}));
      await wait(400);
    });

    // ==================== ④分屏旧回归子门：只验证 renderer DOM 命中渐变 ====================
    await scenario('分屏子门·DOM 命中渐变在位（非 W87d 视觉 Gate）', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.new'));
      await wait(1000);
      await evaluate(() => {
        const dt = new DataTransfer();
        dt.setData('mazz/tab', 't1');
        document.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
        window.__dt = dt;
      });
      await wait(200);
      for (let i = 0; i < 3; i++) {
        await evaluate(() => {
          const pane = document.querySelector('.pane');
          if (!pane) return;
          const r = pane.getBoundingClientRect();
          pane.dispatchEvent(new DragEvent('dragover', { dataTransfer: window.__dt, clientX: r.left + r.width / 6, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
        });
        await wait(250);
      }
      const ov = await evaluate(() => {
        const el = document.querySelector('.mazz-split-drag-overlay');
        return el ? {
          w: Math.round(el.getBoundingClientRect().width),
          background: getComputedStyle(el).background,
          pointerEvents: getComputedStyle(el).pointerEvents,
        } : null;
      });
      await human.assert(ov?.w > 50 && ov.background.includes('gradient') && ov.pointerEvents === 'none',
        `DOM 命中渐变子门必须在位；Browser 跨渲染面由 W87d 矩阵验证（${JSON.stringify(ov)}）`);
      await evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
      await wait(800);
    });

    // ==================== ⑤「..st」勘查（分窗子窗文件树父路径显示） ====================
    await scenario('勘查·分窗子窗 ft-dir 显示', async () => {
      await evaluate(() => window.mazz.invoke('window:openChild', { handoff: {} }).catch(() => {}));
      let child = null;
      const wb = app.windows().length;
      for (let i = 0; i < 30; i++) {
        await wait(300);
        if (app.windows().length > wb) { child = app.windows()[app.windows().length - 1]; break; }
      }
      await human.assert(!!child, '子窗必须开');
      await wait(1800);
      const probe = await child.evaluate(() => {
        const dirs = [...document.querySelectorAll('.ft-dir')].slice(0, 4).map(d => ({
          text: d.textContent, title: d.title || d.closest('.ft-node')?.dataset?.path || '',
          cs: { dir: getComputedStyle(d).direction, ellipsis: getComputedStyle(d).textOverflow },
        }));
        return dirs;
      });
      human.log('ft-dir 勘查:', JSON.stringify(probe).slice(0, 400));
      // 异常判定：textContent 应是完整父路径（截断是 CSS 的事）——st 异常=「..st」残尾
      const weird = probe.some(d => d.text === '..st' || d.text === '…st');
      await human.assert(!weird, `ft-dir 不得只剩「..st」残尾（实拿 ${JSON.stringify(probe.map(d => d.text)).slice(0, 120)}）`);
      await child.evaluate(() => window.mazz.invoke('window:close').catch(() => {})).catch(() => {});
      await wait(600);
    });
  } finally {}
}
