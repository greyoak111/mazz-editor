// tests/e2e/scenes42.mjs —— W52② 工具坞三件套实证批
// 推挤（margin 让位像素实证+视图收窄） / 拉伸限位钳 / 折叠轨（细轨/展开/记忆） / 滚动条军规
export async function scenes42({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 1：推挤布局 ====================
  await scenario('坞·推挤布局', async () => {
    await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
    await human.until(() => {
      const d = document.querySelector('.side-dock');
      return d && d.getBoundingClientRect().width > 0;
    }, { timeout: 6000, msg: '坞开' });
    await wait(400);
    const r = await evaluate(() => {
      const dock = document.querySelector('.side-dock');
      const host = document.querySelector('.editor-host');
      return {
        parentIsWs: dock.parentElement?.classList?.contains('workspace'),
        position: getComputedStyle(dock).position,
        dockW: Math.round(dock.getBoundingClientRect().width),
        hostRight: Math.round(host.getBoundingClientRect().right),
        dockLeft: Math.round(dock.getBoundingClientRect().left),
      };
    });
    human.log('真推拉:', JSON.stringify(r));
    await human.assert(r.parentIsWs && r.position === 'relative', `停靠必须是 workspace 的 flex 兄弟（parentIsWs=${r.parentIsWs} position=${r.position}——margin hack 已平反）`);
    await human.assert(r.hostRight <= r.dockLeft + 2, `布局必须真让位零重叠（hostRight=${r.hostRight} ≤ dockLeft=${r.dockLeft}——flex 自动推挤实锤）`);
    await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
    await wait(400);
    const r2 = await evaluate(() => ({
      parentIsBody: document.querySelector('.side-dock')?.parentElement === document.body,
      hostRight: Math.round(document.querySelector('.editor-host').getBoundingClientRect().right),
      vw: innerWidth,
    }));
    await human.assert(r2.parentIsBody, `关坞必须搬出 workspace 回 body（${r2.parentIsBody}）`);
    await human.assert(r2.hostRight >= r2.vw - 8, `关坞后工作区必须回弹满宽（hostRight=${r2.hostRight} vw=${r2.vw}）`);
    await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
    await wait(300);
    // W54：浮动=dockfloat 纯原生子窗格（body 浮层时代退役——断言同步新现实）
    await evaluate(() => { document.querySelector('.side-dock [data-a="float"]')?.click(); });
    await wait(1200); // dockfloat 子窗格开+坞撤出
    const r3 = await evaluate(() => ({
      display: document.querySelector('.side-dock')?.style?.display,
      parentIsBody: document.querySelector('.side-dock')?.parentElement === document.body,
      floatState: JSON.stringify(window.MazzShell?.sideDock?.state?.float || null),
    }));
    await human.assert(r3.display === 'none' && r3.parentIsBody && r3.floatState !== 'null', `浮动必须开子窗格+坞撤出（${JSON.stringify(r3)}）`);
    await evaluate(() => { document.querySelector('.side-dock [data-a="float"]')?.click(); });
    await wait(300);
    const r4 = await evaluate(() => document.querySelector('.side-dock')?.parentElement?.classList?.contains('workspace'));
    await human.assert(r4 === true, '回停靠必须搬回 workspace');
    await win.screenshot({ path: '/mnt/agents/output/w52e-坞真推拉-停靠.png' }).catch(() => {});
  });

  // ==================== 1.5：浮动记忆迁移（W52f：margin hack 时代 float 记忆一律回停靠） ====================
  await scenario('坞·浮动记忆迁移', async () => {
    // 预置老记忆（float 非空、无 _v:2 标记）→ 重载壳 → 坞必须回停靠
    await evaluate(() => {
      localStorage.setItem('mazz.sideDock', JSON.stringify({ open: true, tab: 'tools', width: 420, height: 560, zoom: 1, float: { x: 300, y: 200 }, collapsed: false }));
    });
    await win.reload();
    await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳重载' });
    await wait(1200);
    await human.until(() => {
      const d = document.querySelector('.side-dock');
      return d && d.getBoundingClientRect().width > 0;
    }, { timeout: 8000, msg: '坞带记忆开' });
    const r = await evaluate(() => {
      const d = document.querySelector('.side-dock');
      return {
        parentIsWs: d?.parentElement?.classList?.contains('workspace'),
        floating: d?.classList?.contains('floating'),
        memV: JSON.parse(localStorage.getItem('mazz.sideDock') || '{}')._v,
      };
    });
    await human.assert(r.parentIsWs === true && r.floating !== true, `老浮动记忆必须迁移回停靠（parentIsWs=${r.parentIsWs} floating=${r.floating}——真机浮动老坞实锤面）`);
    await win.screenshot({ path: '/mnt/agents/output/w52f-坞浮动记忆迁移.png' }).catch(() => {});
  });

  // ==================== 2：拉伸限位钳 ====================
  await scenario('坞·拉伸限位钳', async () => {
    const r = await evaluate(() => {
      const dock = document.querySelector('.side-dock');
      const grip = dock.querySelector('.sd-grip');
      const r0 = dock.getBoundingClientRect();
      grip.dispatchEvent(new PointerEvent('pointerdown', { clientX: r0.left, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: -4000, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      const w1 = Math.round(dock.getBoundingClientRect().width);
      grip.dispatchEvent(new PointerEvent('pointerdown', { clientX: dock.getBoundingClientRect().left, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100000, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      const w2 = Math.round(dock.getBoundingClientRect().width);
      return { w1, w2, vw: innerWidth };
    });
    human.log('限位:', JSON.stringify(r));
    await human.assert(r.w1 <= Math.round(r.vw * 0.6), `拉爆必须被 60% 钳住（w1=${r.w1} ≤ ${Math.round(r.vw * 0.6)}）`);
    await human.assert(r.w2 >= 300 && r.w2 <= Math.round(r.vw * 0.6), `推爆必须被 300 钳住（w2=${r.w2}）`);
    const hostW = await evaluate(() => Math.round(document.querySelector('.editor-host').getBoundingClientRect().width));
    await human.assert(hostW <= r.vw - r.w2 + 4, `拉伸必须真推挤布局（hostW=${hostW} + dockW=${r.w2} ≤ vw=${r.vw}——flex 联动实锤）`);
  });

  // ==================== 3：折叠轨 ====================
  await scenario('坞·折叠轨', async () => {
    await evaluate(() => document.querySelector('.side-dock [data-a="collapse"]')?.click());
    await wait(400);
    const r = await evaluate(() => {
      const d = document.querySelector('.side-dock');
      return {
        collapsed: d?.classList.contains('collapsed'),
        w: Math.round(d?.getBoundingClientRect().width || 0),
        rail: getComputedStyle(d.querySelector('.sd-rail')).display,
        bodyHidden: getComputedStyle(d.querySelector('.sd-body')).display === 'none',
        railSvg: !!d.querySelector('.sd-rail svg'),
      };
    });
    human.log('折叠:', JSON.stringify(r));
    await human.assert(r.collapsed && r.w <= 40, `折叠必须成细轨（w=${r.w}）`);
    await human.assert(r.rail === 'flex' && r.bodyHidden, '细轨展开钮必须在/坞体必须隐');
    await human.assert(r.collapsed, '折叠类必须挂');
    await human.assert(r.railSvg, '展开钮必须 SVG（三铁律①）');
    await evaluate(() => document.querySelector('.side-dock [data-a="expand"]')?.click());
    await wait(400);
    const r2 = await evaluate(() => ({
      collapsed: document.querySelector('.side-dock')?.classList.contains('collapsed'),
      w: Math.round(document.querySelector('.side-dock')?.getBoundingClientRect().width || 0),
    }));
    await human.assert(!r2.collapsed && r2.w >= 300, `展开必须复宽（w=${r2.w}）`);
    // 展开后布局联动已由场景2拉伸钳覆盖，此处不重复断言
    await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
    await wait(300);
    const mem = await evaluate(() => JSON.parse(localStorage.getItem('mazz.sideDock') || '{}'));
    await human.assert(typeof mem.collapsed === 'boolean' && mem.width >= 300, `态必须入记忆（${JSON.stringify(mem).slice(0, 80)}）`);
  });

  // ==================== 4：滚动条军规 ====================
  await scenario('坞·滚动条军规', async () => {
    const r = await evaluate(() => {
      const body = document.querySelector('.side-dock .sd-body');
      const cs = getComputedStyle(body);
      return { overflowY: cs.overflowY };
    });
    await human.assert(r.overflowY === 'auto' || r.overflowY === 'scroll', `坞体必须溢出滚动（${r.overflowY}——军规④）`);
    await evaluate(() => window.mazz.invoke('panel:open', { kind: 'favmgr' }).catch(() => {}));
    await wait(700);
    await evaluate(() => window.mazz.invoke('panel:close', { kind: 'favmgr' }).catch(() => {}));
    await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
  });
}
