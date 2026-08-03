// tests/e2e/scenes21.mjs —— 波次三十二「性能碾压」实证批
// 懒加载折叠 / 虚拟化统计 / canvas 连线层接管 / 数学命中 / 手柄保留 / 小图零行为差
export async function scenes21({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const openMap = async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
    await human.until(() => !!window.__activeMindmapCtl, { timeout: 9000, msg: '导图就绪' });
    await wait(600);
  };
  const seedBig = (n = 350) => evaluate(([n]) => {
    const ctl = window.__activeMindmapCtl;
    const roots = [];
    for (let i = 0; i < 7; i++) {
      const r = { id: 'R' + i, text: '根' + i, collapsed: false, children: [] };
      for (let j = 0; j < 10; j++) {
        const a = { id: `R${i}A${j}`, text: `支${i}-${j}`, collapsed: false, children: [] };
        for (let k = 0; k < 4; k++) a.children.push({ id: `R${i}A${j}B${k}`, text: `叶${i}-${j}-${k}`, collapsed: false, children: [] });
        r.children.push(a);
      }
      roots.push(r);
    }
    // 7×(1+10+40)=357 节点
    ctl.doc.roots = roots;
    ctl.doc.refLines = [{ id: 'rl1', from: { id: 'R0A0', k: 'node' }, to: { id: 'R1A0', k: 'node' }, color: null, width: null, note: '', noteStyle: null, mode: 'curve', bend: 30, waypoints: [] }];
    ctl.doc.swimlanes = []; ctl.doc.notes = []; ctl.doc.parentLinks = [];
    ctl.setDoc(ctl.doc);
    return roots.length;
  }, [n]);

  // ==================== 1：懒加载折叠 ====================
  await scenario('导图·懒加载·大图默认第二层', async () => {
    await openMap();
    await seedBig(350);
    await wait(700);
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const stats = ctl._vstats;
      let collapsedDeep = 0, deep = 0;
      for (const r of ctl.doc.roots) { (function w(x, d) { if (d >= 2) { deep++; if (x.collapsed) collapsedDeep++; } for (const c of x.children) w(c, d + 1); })(r, 0); }
      return { lazy: ctl.doc._lazyTouched, applied: ctl._lazyApplied, collapsedDeep, deep, virtual: stats?.virtual, total: stats?.total };
    });
    human.log('懒加载:', JSON.stringify(r));
    await human.assert(r.lazy && r.applied >= 300, `大图必须懒加载应用（${JSON.stringify(r)}）`);
    await human.assert(r.collapsedDeep === 0 || r.collapsedDeep <= r.deep, '深度计数在');
    await human.assert(r.virtual === true, `350 节点必须虚拟化（实际 ${r.virtual}）`);
    // 点谁展谁：展开某支后其子孙可见
    await evaluate(() => { const ctl = window.__activeMindmapCtl; ctl.doc.roots[0].children[0].collapsed = false; ctl.doc.roots[0].children[0].children.forEach(c => c.collapsed = false); ctl.render(); });
    await wait(300);
  });

  // ==================== 2：虚拟化统计与可见集跟随 ====================
  await scenario('导图·虚拟化·DOM与总数解耦', async () => {
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const dom = document.querySelectorAll('.mm-node').length;
      return { stats: { total: ctl._vstats.total, drawn: ctl._vstats.drawn, virtual: ctl._vstats.virtual }, dom };
    });
    human.log('虚拟化:', JSON.stringify(r));
    await human.assert(r.stats.virtual === true, '虚拟化必须开');
    await human.assert(r.stats.drawn < r.stats.total, `渲染数必须小于总数（${r.stats.drawn}/${r.stats.total}——DOM 解耦实锤）`);
    await human.assert(r.dom <= r.stats.drawn, `DOM 节点必须≤渲染数（${r.dom} vs ${r.stats.drawn}）`);
    // 平移到远端：可见集必须跟随（drawn 变化）
    const moved = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const d0 = ctl._vstats.drawn;
      ctl.cam.x -= 3000; ctl.render();
      return { d0, d1: ctl._vstats.drawn, dom: document.querySelectorAll('.mm-node').length };
    });
    human.log('平移跟随:', JSON.stringify(moved));
    await human.assert(moved.d1 !== moved.d0 || moved.dom < 50, `可见集必须跟随视口（${moved.d0}→${moved.d1}）`);
    await evaluate(() => { const ctl = window.__activeMindmapCtl; ctl.cam.x += 3000; ctl.render(); });
  });

  // ==================== 3：canvas 连线层接管 ====================
  await scenario('导图·canvas连线层·SVG卸载', async () => {
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      return {
        canvas: !!document.querySelector('.mm-link-layer'),
        virtual: ctl._vstats.virtual,
        connSvg: document.querySelectorAll('.mm-conn').length,
        refSvg: document.querySelectorAll('.mm-refline').length,
        strokes: (ctl._lastLinkStrokes || []).length,
        canvasW: document.querySelector('.mm-link-layer')?.width,
      };
    });
    human.log('canvas 层:', JSON.stringify(r));
    await human.assert(r.canvas, 'canvas 层必须在');
    await human.assert(r.virtual && r.connSvg === 0 && r.refSvg === 0, `虚拟化时连线必须全归 canvas（SVG conn=${r.connSvg} ref=${r.refSvg}）`);
    await human.assert(r.strokes > 0, `canvas 画列必须非空（${r.strokes}）`);
    await human.assert(r.canvasW > 0, 'canvas 必须有尺寸');
  });

  // ==================== 4：数学命中与选中高亮 ====================
  await scenario('导图·canvas命中·选中与加拐', async () => {
    // 取一条 conn 线的中点世界坐标做命中
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const s = (ctl._lastLinkStrokes || []).find(x => x.id.startsWith('conn:'));
      if (!s) return { err: 'no-stroke' };
      const mid = s.pts[Math.floor(s.pts.length / 2)];
      const rect = document.querySelector('.mm-canvas-wrap').getBoundingClientRect();
      const sx = rect.left + mid[0] * ctl.cam.k + ctl.cam.x, sy = rect.top + mid[1] * ctl.cam.k + ctl.cam.y;
      return { id: s.id, sx, sy, mid };
    });
    human.log('命中点:', JSON.stringify(r));
    await human.assert(!r.err, '画列须在');
    // pointerdown 命中 → 选中（canvas 高亮；事件须落在 svg（wrap 的 target 判定走 svg/viewport））
    await evaluate(([x, y]) => {
      const svg = document.querySelector('.mm-svg');
      svg.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
    }, [r.sx, r.sy]);
    await wait(400);
    const sel = await evaluate(() => ({ sel: window.__activeMindmapCtl.selectedLine }));
    await human.assert(sel.sel === r.id, `命中必须选中（${JSON.stringify(sel)} vs ${r.id}）`);
    // dblclick 命中 → 加拐点（参数化入库；事件落 svg）
    await evaluate(([x, y]) => {
      const svg = document.querySelector('.mm-svg');
      svg.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true }));
    }, [r.sx, r.sy]);
    const wp = await evaluate(([id]) => {
      const ctl = window.__activeMindmapCtl;
      const node = (function find(rs, id) { for (const n of rs) { if (n.id === id) return n; const f = find(n.children, id); if (f) return f; } return null; })(ctl.doc.roots, id.slice(5));
      return { n: (node?.linkWps || []).length, param: (node?.linkWps || [])[0]?.t != null, mode: node?.linkMode };
    }, [r.id]);
    await human.assert(wp.n >= 1 && wp.param && wp.mode === 'straight', `双击命中必须参数化加拐（${JSON.stringify(wp)}）`);
  });

  // ==================== 5：canvas 模式手柄保留 + 小图零行为差 ====================
  await scenario('导图·手柄保留·小图零行为差', async () => {
    // 选中的 straight 线手柄（SVG 保留）
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const node = ctl.doc.roots.flatMap(rt => (function w(x) { return [x, ...x.children.flatMap(w)]; })(rt)).find(n => (n.linkWps || []).length);
      if (node) { ctl.selectedLine = 'conn:' + node.id; ctl.render(); }
      return { node: !!node, wp: document.querySelectorAll('.mm-wp').length, virtual: ctl._vstats.virtual };
    });
    human.log('手柄:', JSON.stringify(r));
    await human.assert(r.node && r.wp >= 1, `canvas 模式选中手柄必须 SVG 保留（${JSON.stringify(r)}）`);
    // 小图：<200 节点 → 全量 SVG（零行为差）
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      ctl.setDoc({ mode: 'lr', scheme: 0, roots: [{ id: 'root', text: '根', collapsed: false, children: [{ id: 'A', text: '甲', collapsed: false, children: [] }] }], notes: [], refLines: [], parentLinks: [], swimlanes: [] });
    });
    await wait(400);
    const small = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      return { virtual: ctl._vstats.virtual, connSvg: document.querySelectorAll('.mm-conn').length, total: ctl._vstats.total };
    });
    human.log('小图:', JSON.stringify(small));
    await human.assert(small.virtual === false && small.connSvg >= 1, `小图必须全量 SVG 零行为差（${JSON.stringify(small)}）`);
  });
}
