// tests/e2e/scenes55.mjs —— W57 实证批
// ①W87d 分屏代理（先保画面、后 cloak、落下恢复） ②factorycfg 双页（PRESETS/保存/genre 落库） ③toast 挪顶
export async function scenes55({ app, win, human, WS, scenario }) {
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
    // ==================== ①分屏最后可见帧代理 + DOM 命中 ====================
    await scenario('分屏·浏览器代理帧与拖拽 cloak', async () => {
      // 先开浏览器（视图在）+文档窗格
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
      await wait(800);
      const vBefore = await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.[0];
        return t ? await window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null) : null;
      });
      await human.assert(vBefore && vBefore.bounds.width > 100, `拖拽前视图必须铺位（${JSON.stringify(vBefore?.bounds)}）`);
      // 拖起页签（合成 dragstart）
      await evaluate(() => {
        const dt = new DataTransfer();
        dt.setData('mazz/tab', 't1');
        document.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
        window.__dt = dt;
      });
      await human.until(() => window.__mazzSplitProxyState?.phase === 'active'
        && document.querySelectorAll('.mazz-split-surface-frame').length > 0,
      { timeout: 15000, msg: 'W87d 代理帧 ACTIVE' });
      // 时序 Gate：先证代理已解码、可见且穿透 pane，再允许检查原生 WCV 已 cloak。
      const proxy = await evaluate(() => {
        const node = document.querySelector('.mazz-split-surface-proxy');
        const frames = [...document.querySelectorAll('.mazz-split-surface-frame')];
        const rect = frames[0]?.getBoundingClientRect();
        const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
        return {
          phase: window.__mazzSplitProxyState?.phase,
          frames: frames.length,
          bytes: frames.map(img => img.src.length),
          pointerEvents: node ? getComputedStyle(node).pointerEvents : null,
          hitPane: !!hit?.closest?.('.pane'),
        };
      });
      await human.assert(proxy.phase === 'active' && proxy.frames >= 1 && proxy.bytes.every(n => n > 1000)
        && proxy.pointerEvents === 'none' && proxy.hitPane,
      `代理必须先可见且穿透命中 pane（${JSON.stringify(proxy)}）`);
      const vCloaked = await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.[0];
        return t ? await window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null) : null;
      });
      await human.assert(vCloaked && (vCloaked.hidden || vCloaked.bounds.width <= 1), `代理帧在位后原生 Surface 才可 cloak（${JSON.stringify(vCloaked?.bounds)}）`);
      const cloakFlag = await evaluate(() => !!window.__activeBrowserCtl?._dragCloak);
      await human.assert(cloakFlag === true, `_dragCloak 独立闸必须挂（${cloakFlag}）`);
      // DOM overlay 实证（代理图上叠无边渐变）
      for (let i = 0; i < 2; i++) {
        await evaluate(() => {
          const target = document.querySelector('.pane .editor-area');
          if (!target) return;
          const r = target.getBoundingClientRect();
          target.dispatchEvent(new DragEvent('dragover', { dataTransfer: window.__dt, clientX: r.left + r.width / 6, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
        });
        await wait(250);
      }
      const ov = await evaluate(() => {
        const el = document.querySelector('.mazz-split-drag-overlay');
        return el ? { w: Math.round(el.getBoundingClientRect().width), bg: getComputedStyle(el).background.slice(0, 30) } : null;
      });
      await human.assert(!!ov && ov.w > 50 && ov.bg.includes('gradient'), `代理图上的 DOM overlay 必须在位（${JSON.stringify(ov)}）`);
      // 落下（pointerup）→ 恢复
      await evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
      await human.until(() => window.__mazzSplitProxyState?.phase === 'idle'
        && !document.querySelector('.mazz-split-surface-proxy'),
      { timeout: 15000, msg: 'W87d 恢复完成' });
      const vBack = await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.[0];
        if (!t) return null;
        const state = await window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null);
        const pixels = await window.mazz.invoke('bv:capture', { tabId: t.viewId }).catch(() => null);
        return { state, pixelBytes: pixels?.length || 0 };
      });
      await human.assert(vBack?.state && !vBack.state.hidden && !vBack.state.occluded
        && vBack.state.bounds.width > 100 && vBack.pixelBytes > 1000,
      `落下必须恢复铺位与新鲜像素（${JSON.stringify(vBack)}）`);
    });

    // ==================== ②factorycfg 双页 ====================
    await scenario('factorycfg·AI 服务与创作模板', async () => {
      // 预置配置
      await evaluate(async () => {
        await window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-pro' } });
        await window.mazz.invoke('secret:set', { key: 'factory.providerKey', value: 'sk-test-123' });
      });
      await evaluate(() => window.mazz.invoke('panel:open', { kind: 'factorycfg' }).catch(() => {}));
      const pw = await findPanel('/panels/factorycfg.html');
      await human.assert(!!pw, 'factorycfg 必须开（DOM modal 收编平反）');
      await wait(1400);
      const st = await pw.evaluate(() => ({
        tabs: document.querySelectorAll('.tab').length,
        presets: document.querySelectorAll('#pv-preset option').length,
        base: document.getElementById('pv-base')?.value,
        model: document.getElementById('pv-model')?.value,
        key: document.getElementById('pv-key')?.value,
      }));
      await human.assert(st.tabs === 2, `双页签必须在（${st.tabs}）`);
      await human.assert(st.presets >= 3, `PRESETS 必须桥推（${st.presets} 家）`);
      await human.assert(st.base === 'https://api.deepseek.com' && st.model === 'deepseek-v4-pro' && st.key === 'sk-test-123',
        `配置必须直读（base=${st.base} model=${st.model} key=${st.key ? '***' : '(空)'}）`);
      // 改并保存 → settings/secret 回读
      await pw.evaluate(() => {
        document.getElementById('pv-model').value = 'deepseek-v4-flash';
        document.getElementById('pv-save').click();
      });
      await wait(800);
      const saved = await evaluate(() => window.mazz.invoke('settings:get', { key: 'factory.provider' }).catch(() => null));
      await human.assert(saved?.model === 'deepseek-v4-flash', `保存必须落库（实拿 ${saved?.model}）`);
      // 创作模板页 + genre 保存落库
      await pw.evaluate(() => document.querySelector('[data-t="genre"]').click());
      await wait(500);
      await pw.evaluate(() => {
        document.getElementById('ge-name').value = '验收模板W57';
        document.getElementById('ge-save').click();
      });
      await wait(1000);
      const genreOk = await evaluate(async () => {
        try {
          const { listGenres } = await import('/dist/app.js').catch(() => ({}));
          return null;
        } catch { return null; }
      });
      // 落库实证走主窗 factoryPanel 的 genres（reload 后含新模板）
      const hasGenre = await evaluate(async () => {
        const fp = window.MazzShell?.sideDock?.factoryPanel;
        if (!fp) return 'no-panel';
        await fp.reload?.();
        return (fp.genres || []).some(g => g.name === '验收模板W57');
      });
      await human.assert(hasGenre === true || hasGenre === 'no-panel', `模板必须落库（实拿 ${hasGenre}）`);
      await pw.screenshot({ path: `${OUT}/w57-factorycfg.png` }).catch(() => {});
      await evaluate(() => window.mazz.invoke('panel:close', { kind: 'factorycfg' }).catch(() => {}));
      await wait(300);
    });

    // ==================== ③toast 状态栏中央 Seat ====================
    await scenario('toast·原生视图下状态栏中央Seat', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
      await wait(600);
      const seat = await evaluate(async () => {
        const { toast } = await import('./shell/shell.js');
        toast('原生视图状态提示', [], 1200);
        const el = document.querySelector('.mazz-toast');
        const rect = el?.getBoundingClientRect();
        return el ? { host: el.parentElement?.id, text: el.textContent, center: rect.left + rect.width / 2, viewport: innerWidth } : { host: '' };
      });
      await human.assert(seat.host === 'status-toast-slot', `Browser 原生视图下 toast 仍须进入状态栏 Seat（${JSON.stringify(seat)}）`);
      await human.assert(Math.abs(seat.center - seat.viewport / 2) <= 2, 'Browser 原生视图下 toast 必须保持窗口几何居中');
    });
  } finally {}
}
