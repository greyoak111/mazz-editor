// tests/e2e/scenes59.mjs —— W58e 实证批（军规⑲ scoped：新建文件子窗/五区 emoji/滚动条统一）
export async function scenes59({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  // ==================== 1：新建文件全原生独立子窗 ====================
  await scenario('新建文件·全原生子窗格', async () => {
    await evaluate(() => window.MazzCommands?.execute('fileTree.newFile'));
    await wait(2200);
    const urls = app.windows().map(w => w.url());
    human.log('windows:', urls.map(u => u.split('/').pop()).join('|'));
    const pw = app.windows().find(w => w.url().includes('/panels/newfile.html'));
    await human.assert(!!pw, '新建文件必须开原生独立子窗（DOM modal 漏网平反）');
    // 17 类型五组真渲染（单源下发）
    const st = await pw.evaluate(() => ({
      cards: document.querySelectorAll('.nft').length,
      groups: [...document.querySelectorAll('.grp')].map(g => g.textContent),
      bg: getComputedStyle(document.querySelector('.pwin')).backgroundColor,
    })).catch(() => null);
    human.log('子窗内容:', JSON.stringify(st));
    await human.assert(st && st.cards === 18, `18 类型必须全列（NEW_FILE_TYPES 实数——旧注释 17 滞后实锤，实拿 ${st?.cards}）`);
    await human.assert(st.groups.length === 5, `五组必须全（实拿 ${st?.groups}）`);
    await human.assert(st.bg && st.bg !== 'rgba(0, 0, 0, 0)' && st.bg !== 'transparent', '子窗必须不透明');
    // 点 .py → 子窗自闭 + 树行内新建起手
    await pw.evaluate(() => { for (const b of document.querySelectorAll('.nft')) if (b.dataset.ext === 'py') { b.click(); return; } });
    await wait(1200);
    const closed = !app.windows().some(w => w.url().includes('/panels/newfile.html'));
    await human.assert(closed, '选后子窗必须自闭');
    const inline = await evaluate(() => {
      const ft = document.querySelector('.filetree');
      const inp = ft?.querySelector('input');
      return {
        input: !!inp,
        val: inp?.value || '',
        py: ft?.textContent?.includes('.py'),
      };
    });
    human.log('行内新建:', JSON.stringify(inline));
    await human.assert(inline.input === true && inline.val.includes('新建文件') && inline.py === true, `选后必须起手行内新建（实拿 ${JSON.stringify(inline)}）`);
    await win.keyboard.press('Escape').catch(() => {});
    await wait(300);
  });

  // ==================== 2：设置面板 emoji 清零 ====================
  await scenario('设置面板·五钮 SVG 化', async () => {
    await evaluate(() => window.mazz.invoke('panel:open', { kind: 'settings' }).catch(() => {}));
    await wait(2200);
    const pw = app.windows().find(w => w.url().includes('/panels/settings.html'));
    await human.assert(!!pw, '设置子窗必须开');
    const st = await pw.evaluate(() => {
      const btns = ['s-theme-blank', 's-theme-import', 's-theme-folder', 's-imgtheme', 's-theme-del'].map(id => {
        const b = document.getElementById(id);
        return b ? { svg: !!b.querySelector('svg'), emoji: /[\u{1F300}-\u{1FAFF}]/u.test(b.textContent) } : null;
      });
      return btns;
    }).catch(() => null);
    human.log('设置五钮:', JSON.stringify(st));
    await human.assert(st && st.every(x => x && x.svg === true && x.emoji === false), `五钮必须全 SVG 零 emoji（实拿 ${JSON.stringify(st)}）`);
    await pw.close().catch(() => {});
    await wait(400);
  });

  // ==================== 3：滚动条统一（主界面一族） ====================
  await scenario('滚动条·子窗主窗一族统一', async () => {
    const cmp = await evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'width:60px;height:60px;overflow:scroll;position:fixed;left:-999px';
      probe.innerHTML = '<div style="width:200px;height:200px"></div>';
      document.body.appendChild(probe);
      const w = probe.offsetWidth - probe.clientWidth;
      probe.remove();
      return w;
    });
    human.log('主窗滚动条宽:', cmp);
    await evaluate(() => window.mazz.invoke('panel:open', { kind: 'help' }).catch(() => {}));
    await wait(2200);
    const pw = app.windows().find(w => w.url().includes('/panels/help.html'));
    await human.assert(!!pw, '帮助子窗必须开');
    const st = await pw.evaluate(async () => {
      const probe = document.createElement('div');
      probe.style.cssText = 'width:60px;height:60px;overflow:scroll;position:fixed;left:-999px';
      probe.innerHTML = '<div style="width:200px;height:200px"></div>';
      document.body.appendChild(probe);
      const w = probe.offsetWidth - probe.clientWidth;
      probe.remove();
      // 加载链核验（军规⑧）：面板真实拉取的 panel-shared.css 文本即消费真相
      const cssText = await fetch('panel-shared.css').then(r => r.text()).catch(() => '');
      return { w, has10: cssText.includes('width: 10px; height: 10px;'), hasThumb: cssText.includes('background: var(--bg-active); border-radius: 5px; border: 2px solid transparent; background-clip: content-box;'), hasHover: cssText.includes('background: var(--accent);') };
    }).catch(() => null);
    human.log('子窗滚动条:', JSON.stringify(st));
    await human.assert(st && st.w === cmp, `子窗轨宽必须=主窗（实拿 ${st?.w} vs ${cmp}）`);
    await human.assert(st.has10 && st.hasThumb && st.hasHover, `面板滚动条必须镜像一族+hover accent（实拿 ${JSON.stringify(st)}）`);
    await pw.close().catch(() => {});
    await wait(400);
  });

  // ==================== 4：浏览器/演示 ribbon SVG 化 ====================
  await scenario('ribbon·三钉五钉 SVG 化', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
    await wait(1600);
    const br = await evaluate(() => {
      const texts = ['摘录到笔记', '收藏管理', '导出收藏'];
      return texts.map(t => {
        const b = [...document.querySelectorAll('.rb-btn')].find(x => x.textContent.includes(t));
        return b ? !!b.querySelector('svg.mz-ico, svg') : null;
      });
    });
    human.log('浏览器三钉:', JSON.stringify(br));
    await human.assert(br.every(x => x === true), `浏览器三钉必须 SVG（实拿 ${JSON.stringify(br)}）`);
    await evaluate(() => window.MazzCommands?.execute('file.newSlide'));
    await wait(1600);
    const sl = await evaluate(() => {
      const texts = ['画布', '矩形', '椭圆', '放映', '遥控'];
      return texts.map(t => {
        const b = [...document.querySelectorAll('.rb-btn')].find(x => x.textContent.trim() === t || x.textContent.includes(t));
        return b ? !!b.querySelector('svg.mz-ico, svg') : null;
      });
    });
    human.log('演示五钉:', JSON.stringify(sl));
    await human.assert(sl.every(x => x === true), `演示五钉必须 SVG（实拿 ${JSON.stringify(sl)}）`);
    await evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
    await wait(300);
  });
}
