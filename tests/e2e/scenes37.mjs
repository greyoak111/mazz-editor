// tests/e2e/scenes37.mjs —— 真机三小改实证批（W48）
// 侧栏限位（窗宽钳制+resize 重钳） / 全屏字幕反馈（toast 挂 fullscreenElement） / 密码自动填充+修改识别询问更新
import http from 'http';

export async function scenes37({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 1：侧栏限位 ====================
  await scenario('播放器·侧栏限位', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newViewer'));
    await human.until(() => !!document.querySelector('.mz-player .mz-empty'), { timeout: 9000, msg: '空播放器' });
    const r = await evaluate(() => {
      const stage = document.querySelector('.mz-stage');
      const ctl = window.__activeViewerCtl;
      return { stageW: stage?.clientWidth, hasClamp: typeof window !== 'undefined' };
    });
    // 拖宽到 999 → 必须被 sideMaxNow 钳住
    const r2 = await evaluate(() => {
      const stage = document.querySelector('.mz-stage');
      const grip = document.querySelector('.mz-side-grip');
      const rect = grip.getBoundingClientRect();
      grip.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + 2, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left - 4000, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return { sideW: getComputedStyle(stage).getPropertyValue('--mz-side-w').trim(), stageW: stage.clientWidth };
    });
    human.log('限位:', JSON.stringify(r2));
    const w = parseInt(r2.sideW);
    await human.assert(w <= Math.max(200, Math.min(520, r2.stageW - 560)), `拖爆必须被窗宽钳住（sideW=${w} stageW=${r2.stageW}——全屏钮区不被挤掉实锤）`);
    // 缩窗模拟：stage 变窄 → resize 重钳
    const r3 = await evaluate(() => {
      const stage = document.querySelector('.mz-stage');
      const before = getComputedStyle(stage).getPropertyValue('--mz-side-w').trim();
      window.dispatchEvent(new Event('resize'));
      return { before, after: getComputedStyle(stage).getPropertyValue('--mz-side-w').trim() };
    });
    human.log('resize 重钳:', JSON.stringify(r3));
  });

  // ==================== 2：全屏字幕反馈 ====================
  await scenario('播放器·全屏字幕反馈', async () => {
    const r = await evaluate(async () => {
      const { toast } = await import('./shell/shell.js');
      const stage = document.querySelector('.mz-stage');
      let fsOk = false;
      try { await stage.requestFullscreen(); fsOk = document.fullscreenElement === stage; } catch (e) { fsOk = 'fs-fail:' + e.message; }
      const el = toast('字幕反馈探针', [], 200);
      const hostOk = document.fullscreenElement ? el.parentElement === document.fullscreenElement : false;
      const visible = el.getBoundingClientRect().width > 0;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      return { fsOk, hostOk, visible };
    });
    human.log('全屏反馈:', JSON.stringify(r));
    await human.assert(r.hostOk, `toast 必须挂 fullscreenElement（${JSON.stringify(r)}——全屏按字幕有反馈实锤）`);
    await human.assert(r.visible, '全屏下必须可见');
  });

  // ==================== 3：密码自动填充 ====================
  await scenario('密码·自动填充与修改识别', async () => {
    // 预存站点账号（旧密码）
    await evaluate(() => window.mazz.invoke('pw:save', { entry: { site: '127.0.0.1', username: 'mazz@test.com', password: 'OldPass123' } }));
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><form id="f" action="/done"><input name="user" value=""><input type="password" value=""><button type="submit">登录</button></form></body></html>');
    });
    const port = await new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
    try {
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => {
        if (window.__activeBrowserCtl?.tabs?.length > 0) return true;
        for (const [, inst] of (window.MazzModules?.instances || new Map())) if (inst.name === 'browser') return true;
        return false;
      }, { timeout: 15000, msg: '浏览器就绪' });
      // 自动填充：开表单页 → 字段必须自动填上旧密码
      await evaluate((u) => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
      }, `http://127.0.0.1:${port}/login`);
      await wait(2200);
      const r = await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        return t ? window.mazz.invoke('bv:js', { tabId: t.viewId, code: "({u: document.querySelector('[name=user]')?.value, p: document.querySelector('[type=password]')?.value})" }).catch(() => null) : null;
      });
      human.log('自动填充:', JSON.stringify(r));
      await human.assert(r?.u === 'mazz@test.com' && r?.p === 'OldPass123', `有库存必须静默自动填充（${JSON.stringify(r)}——Edge 同款）`);
      // 修改识别：改成新密码提交 → 必须询问「更新保存的密码？」
      await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:js', { tabId: t.viewId, code: "document.querySelector('[type=password]').value='NewPass456'; document.querySelector('form').requestSubmit()" }).catch(() => {});
      });
      await wait(1800);
      const r2 = await evaluate(() => [...document.querySelectorAll('.mazz-toast, [class*=toast]')].map(e => e.textContent).join('|'));
      human.log('修改询问:', JSON.stringify(r2));
      await human.assert(r2.includes('密码已更改') && r2.includes('更新保存的密码'), `修改必须智能识别并询问（${r2.slice(0, 60)}）`);
      // 点更新 → 同 id 换为新密码
      const id0 = (await evaluate(() => window.mazz.invoke('pw:list'))).find(x => x.site === '127.0.0.1')?.id;
      await evaluate(() => { [...document.querySelectorAll('.mazz-toast button, [class*=toast] button')].find(b => b.textContent === '更新')?.click(); });
      await wait(600);
      const r3 = await evaluate(() => window.mazz.invoke('pw:list'));
      const en = r3.find(x => x.id === id0);
      await human.assert(en?.password === 'NewPass456', `更新必须同 id 换新密码（${en?.password}）`);
      // 一致静默：重开表单页（自动填充会填上新密码）→ 原样提交 → 不得再问
      await evaluate((u) => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
      }, `http://127.0.0.1:${port}/login`);
      await wait(2000);
      await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:js', { tabId: t.viewId, code: "document.querySelector('form')?.requestSubmit?.()" }).catch(() => {});
      });
      await wait(1200);
      const r4 = await evaluate(() => [...document.querySelectorAll('.mazz-toast')].map(e => e.textContent).join('|'));
      await human.assert(!r4.includes('保存账号') && !r4.includes('密码已更改'), `一致必须静默不再问（${r4.slice(0, 40)}）`);
      await evaluate((id) => window.mazz.invoke('pw:delete', { id }), id0);
    } finally { srv.close(); }
  });
}
