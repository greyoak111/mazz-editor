// tests/e2e/scenes63.mjs —— W58i 实证批（scoped：字体/字号 picklist 通用格）
export async function scenes63({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  // ==================== 1：字体 picklist 全原生格 ====================
  await scenario('字体·picklist 通用格收编', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.new'));
    await wait(1800);
    // 点字体输入框（焦点触发开格）
    const opened = await evaluate(() => {
      const inp = document.querySelector('.pk-font-input');
      if (!inp) return false;
      inp.focus();
      inp.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      return true;
    });
    await human.assert(opened, '字体输入框必须在');
    await wait(2200);
    const urls = app.windows().map(w => w.url().split('/').pop());
    human.log('windows:', urls.join('|'));
    const pw = app.windows().find(w => w.url().includes('/panels/picklist.html'));
    await human.assert(!!pw, '字体必须开 picklist 原生格（DOM 下拉漏网平反）');
    const st = await pw.evaluate(() => ({
      cap: document.getElementById('cap')?.textContent,
      items: document.querySelectorAll('.it').length,
      bg: getComputedStyle(document.querySelector('.pwin')).backgroundColor,
      fontPreviews: [...document.querySelectorAll('.it')].filter(el => (el.style.fontFamily || '').length > 0).length,
    })).catch(() => null);
    human.log('字体格:', JSON.stringify(st));
    await human.assert(st && st.cap?.includes('字体'), `标题必须字体（实拿 ${st?.cap}）`);
    await human.assert(st.items >= 10, `本机字体必须列出（实拿 ${st.items}）`);
    await human.assert(st.fontPreviews >= 10, `字体预览必须随行（实拿 ${st.fontPreviews}）`);
    await human.assert(st.bg && st.bg !== 'rgba(0, 0, 0, 0)', '子窗必须不透明');
    // 检索收窄 + 选一项
    await pw.evaluate(() => { const q = document.getElementById('q'); q.value = '宋体'; q.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(600);
    const pickName = await pw.evaluate(() => {
      const it = document.querySelector('.it');
      if (!it) return null;
      it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      return it.textContent;
    });
    await wait(1000);
    human.log('选中:', pickName);
    const applied = await evaluate(() => document.querySelector('.pk-font-input')?.value || document.querySelector('.pk-font-input')?.placeholder);
    await human.assert(!!pickName && applied === pickName, `选后必须回填+应用（实拿 选=${pickName} 填=${applied}）`);
    await human.assert(!app.windows().some(w => w.url().includes('/panels/picklist.html')), '选后必须自闭');
  });

  // ==================== 2：字号 picklist（预设+自由值） ====================
  await scenario('字号·picklist 预设与自由值', async () => {
    await evaluate(() => {
      const inp = document.querySelector('.pk-size-input');
      if (inp) { inp.focus(); inp.dispatchEvent(new FocusEvent('focus', { bubbles: true })); }
    });
    await wait(2200);
    const pw = app.windows().find(w => w.url().includes('/panels/picklist.html'));
    await human.assert(!!pw, '字号必须开 picklist 格');
    const st = await pw.evaluate(() => ({
      cap: document.getElementById('cap')?.textContent,
      items: [...document.querySelectorAll('.it')].map(el => el.textContent),
    })).catch(() => null);
    human.log('字号格:', JSON.stringify(st));
    await human.assert(st?.cap === '字号', `标题必须字号（实拿 ${st?.cap}）`);
    await human.assert(st.items.includes('14') && st.items.includes('72'), `预设必须全（实拿 ${st.items.length} 项）`);
    // 自由值通道：输入 37 → 「使用「37」」→ Enter
    await pw.evaluate(() => { const q = document.getElementById('q'); q.value = '37'; q.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(400);
    await pw.evaluate(() => { const q = document.getElementById('q'); q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await wait(800);
    const applied = await evaluate(() => document.querySelector('.pk-size-input')?.value);
    human.log('字号回填:', applied);
    await human.assert(applied === '37', `自由值必须回填（实拿 ${applied}）`);
  });

  // ==================== 3：失焦=取消（菜单惯例）不留痕 ====================
  await scenario('字号·失焦取消不留痕', async () => {
    await evaluate(() => {
      const inp = document.querySelector('.pk-size-input');
      if (inp) { inp.focus(); inp.dispatchEvent(new FocusEvent('focus', { bubbles: true })); }
    });
    await wait(2000);
    const pw = app.windows().find(w => w.url().includes('/panels/picklist.html'));
    await human.assert(!!pw, '格必须开');
    const before = await evaluate(() => document.querySelector('.pk-size-input')?.value);
    // 主窗抢回焦点=失焦收（菜单惯例取消语义——OS 焦点竞态下 Esc 测不稳实锤）
    await win.bringToFront();
    await wait(900);
    const after = await evaluate(() => document.querySelector('.pk-size-input')?.value);
    await human.assert(before === after, `失焦取消必须零改动（实拿 ${before}→${after}）`);
    await human.assert(!app.windows().some(w => w.url().includes('/panels/picklist.html')), '失焦格必须自闭');
    await evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
    await wait(300);
  });
}
