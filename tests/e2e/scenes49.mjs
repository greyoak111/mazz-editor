// tests/e2e/scenes49.mjs —— W53 全原生子窗格冒烟实证批
// 七面板开关/主题跟随/滚动条/核心交互 + 坞浮动联动（浮出开子窗/关窗回停靠）
export async function scenes49({ app, win, human, WS, scenario }) {
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
  const openPanel = async (kind, frag) => {
    await evaluate((k) => window.mazz.invoke('panel:open', { kind: k }).catch(() => {}), kind);
    const pw = await findPanel(frag || `/panels/${kind}.html`);
    await human.assert(!!pw, `${kind} 子窗格必须打开`);
    await wait(1000);
    return pw;
  };
  const baseProbe = (pw, name) => pw.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    linked: !!document.querySelector('link[href="panel-shared.css"]'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  })).then(st => {
    human.assertSync?.(true);
    return st;
  });

  try {
    // ==================== 1：设置面板（表单填充+主题双跟随） ====================
    await scenario('设置面板·表单与主题双跟随', async () => {
      const pw = await openPanel('settings');
      const st = await pw.evaluate(() => ({
        langs: document.querySelectorAll('#s-lang option').length,
        themes: document.querySelectorAll('#s-theme option').length,
        closeV: document.querySelector('#s-close').value,
        scrollY: getComputedStyle(document.querySelector('main')).overflowY,
      }));
      await human.assert(st.langs >= 2, `语言清单必须填充（${st.langs} 种）`);
      await human.assert(st.themes >= 6, `主题清单必须填充（${st.themes} 项）`);
      await human.assert(st.scrollY === 'auto', '设置主区必须可滚（军规④）');
      // 面板里改主题 ink → 主窗+面板双跟随
      await pw.evaluate(() => {
        const sel = document.querySelector('#s-theme');
        sel.value = 'ink';
        sel.dispatchEvent(new Event('change'));
      });
      await wait(1200);
      const dual = await Promise.all([
        evaluate(() => document.documentElement.dataset.theme),
        pw.evaluate(() => document.documentElement.dataset.theme),
      ]);
      await human.assert(dual[0] === 'ink' && dual[1] === 'ink', `主题必须双跟随（主窗=${dual[0]} 面板=${dual[1]}——主题变窗格变）`);
      await pw.screenshot({ path: `${OUT}/w53-设置面板-ink.png` }).catch(() => {});
      await pw.evaluate(() => { const sel = document.querySelector('#s-theme'); sel.value = 'paper'; sel.dispatchEvent(new Event('change')); });
      await wait(900);
      await evaluate(() => window.mazz.invoke('panel:close', { kind: 'settings' }).catch(() => {}));
      await wait(400);
    });

    // ==================== 2：帮助面板（目录/渲染/搜索/版本） ====================
    await scenario('帮助面板·目录渲染搜索', async () => {
      const pw = await openPanel('help');
      const st = await pw.evaluate(() => ({
        toc: document.querySelectorAll('.toc-item').length,
        h: document.querySelectorAll('#content h2, #content h3').length,
      }));
      await human.assert(st.toc >= 5, `目录必须 ≥5 章（${st.toc}）`);
      await human.assert(st.h >= 1, '内容必须真渲染（有标题）');
      await pw.fill('#q', '演示');
      await wait(400);
      const filtered = await pw.evaluate(() => document.querySelectorAll('.toc-item').length);
      await human.assert(filtered >= 1 && filtered < st.toc, `搜索必须真过滤（${st.toc}→${filtered}）`);
      await pw.evaluate(() => { const v = document.querySelector('#ver'); v.value = 'senior'; v.dispatchEvent(new Event('change')); });
      await wait(900);
      const senior = await pw.evaluate(() => document.querySelectorAll('.toc-item').length);
      await human.assert(senior >= 1, `喂奶级版本必须切换出内容（${senior} 章）`);
      await pw.evaluate(() => { const v = document.querySelector('#ver'); v.value = 'std'; v.dispatchEvent(new Event('change')); });
      await wait(600);
      await evaluate(() => window.mazz.invoke('panel:close', { kind: 'help' }).catch(() => {}));
      await wait(300);
    });

    // ==================== 3：翻译+插件+协议 烟冒 ====================
    await scenario('翻译/插件/协议·开合应答', async () => {
      const tr = await openPanel('translate');
      const trSt = await tr.evaluate(() => ({
        targets: document.querySelectorAll('#target option').length,
        gear: !!document.getElementById('cfg-toggle'),
      }));
      await human.assert(trSt.targets >= 8 && trSt.gear, '翻译面板语言清单+引擎抽屉必须在');
      await tr.evaluate(() => document.getElementById('cfg-toggle').click());
      await wait(700);
      const cfgOpen = await tr.evaluate(() => document.getElementById('cfg').classList.contains('open'));
      await human.assert(cfgOpen, '引擎设置抽屉必须开合（getConfig 应答）');
      await evaluate(() => window.mazz.invoke('panel:close', { kind: 'translate' }).catch(() => {}));

      const pg = await openPanel('plugins');
      const pgSt = await pg.evaluate(() => ({
        empty: document.querySelector('.empty')?.textContent || '',
        install: !!document.getElementById('install'),
      }));
      await human.assert(pgSt.install, '插件管理安装钮必须在');
      await evaluate(() => window.mazz.invoke('panel:close', { kind: 'plugins' }).catch(() => {}));

      const ag = await openPanel('agreement');
      const agSt = await ag.evaluate(() => ({ h3: document.querySelectorAll('main h3').length }));
      await human.assert(agSt.h3 >= 2, '协议章节必须渲染');
      await evaluate(() => window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {}));
      await wait(400);
    });

    // ==================== 4：内录面板（源枚举+启停桥） ====================
    await scenario('内录面板·源枚举与控制台', async () => {
      const rc = await openPanel('recorder');
      const st = await rc.evaluate(() => ({
        srcs: document.querySelectorAll('.rec-src').length,
        go: !!document.getElementById('rec-go'),
      }));
      await human.assert(st.srcs >= 1, `录制源必须枚举出（${st.srcs} 个——xvfb 至少有屏）`);
      await human.assert(st.go, '开始录制钮必须在');
      await rc.screenshot({ path: `${OUT}/w53-内录面板.png` }).catch(() => {});
      await evaluate(() => window.mazz.invoke('panel:close', { kind: 'recorder' }).catch(() => {}));
      await wait(300);
    });

    // ==================== 5：快速跳转（palette 文件页签） ====================
    await scenario('快速跳转·文件页签', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.quickOpen'));
      const pw = await findPanel('/panels/palette.html');
      await human.assert(!!pw, '命令面板必须开');
      await wait(1200);
      const st = await pw.evaluate(() => ({
        filesTabOn: document.querySelector('[data-t="files"]')?.classList.contains('on'),
        ph: document.getElementById('q').placeholder,
      }));
      await human.assert(st.filesTabOn === true, `文件页签必须激活（initTab 桥）`);
      await human.assert(st.ph.includes('文件名'), `占位必须文件语义（实拿 ${st.ph}）`);
      await wait(600);
      const rows = await pw.evaluate(() => document.querySelectorAll('.row').length);
      await human.assert(rows >= 1, `最近文件必须列出（${rows} 条）`);
      await pw.screenshot({ path: `${OUT}/w53-快速跳转.png` }).catch(() => {});
      await pw.evaluate(() => { document.getElementById('p-close')?.click(); });
      await wait(400);
    });

    // ==================== 6：坞浮动联动（浮出开子窗/工厂镜像/关窗回停靠） ====================
    await scenario('坞浮动·纯原生子窗格联动', async () => {
      // 先开坞（停靠）
      await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
      await human.until(() => {
        const d = document.querySelector('.side-dock');
        return d && d.getBoundingClientRect().width > 0 && d.parentElement?.classList?.contains('workspace');
      }, { timeout: 8000, msg: '坞停靠开' });
      // 切浮动 → dockfloat 子窗格开，坞撤出 workspace
      await evaluate(() => { document.querySelector('.side-dock [data-a="float"]')?.click(); });
      const df = await findPanel('/panels/dockfloat.html');
      await human.assert(!!df, 'dockfloat 子窗格必须开（纯原生浮动）');
      await wait(1500); // dockFloatInit → factorySnapshot
      const dockGone = await evaluate(() => {
        const d = document.querySelector('.side-dock');
        return !d || d.getBoundingClientRect().width === 0 || d.parentElement !== document.querySelector('.workspace');
      });
      await human.assert(dockGone, '坞必须撤出 workspace（浮出即收）');
      const st = await df.evaluate(() => ({
        tabs: document.querySelectorAll('.head .tab').length,
        genres: document.querySelectorAll('.fc-genre option').length,
        provider: document.querySelector('.fc-provider-hint')?.textContent?.length > 0,
      }));
      await human.assert(st.tabs === 3, `三页签必须在（${st.tabs}）`);
      await human.assert(st.genres >= 1, `工厂快照必须同步（${st.genres} 个模板——状态镜像）`);
      await df.evaluate(() => document.querySelector('[data-t="tools"]').click());
      await wait(900);
      const tools = await df.evaluate(() => document.querySelectorAll('.tg-card').length);
      await human.assert(tools >= 8, `工具页必须全清单（${tools} 卡——GROUPS 单源）`);
      await df.screenshot({ path: `${OUT}/w53-坞浮动子窗格.png` }).catch(() => {});
      // ✕ 关闭 → 坞回停靠（分段诊断：窗关→联动→回岗 三断点各验）
      await df.evaluate(() => document.getElementById('p-close')?.click());
      let winGone = false;
      for (let i = 0; i < 20; i++) {
        await wait(300);
        if (!app.windows().some(w => w.url().includes('/panels/dockfloat.html'))) { winGone = true; break; }
      }
      await human.assert(winGone, 'dockfloat 子窗格必须先真关');
      await wait(800);
      const diag = await evaluate(() => {
        const d = document.querySelector('.side-dock');
        return {
          has: !!d, display: d?.style?.display, open: window.MazzShell?.sideDock?.state?.open,
          float: JSON.stringify(window.MazzShell?.sideDock?.state?.float),
          parent: d?.parentElement?.className || '(无父)',
          w: Math.round(d?.getBoundingClientRect?.().width || 0),
        };
      });
      human.log('回岗诊断:', JSON.stringify(diag));
      await human.assert(diag.open === true && diag.w > 0 && diag.parent.includes('workspace'), `关子窗格坞必须回停靠上岗（${JSON.stringify(diag)}）`);
    });
  } finally {}
}
