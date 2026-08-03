// tests/e2e/scenes19.mjs —— 波次三十「导图渲染病根治」实证批
// B2 复现链（曲线远端拐点随端点重算不贴错）/ 直线直角拐点跟随 / 旧 v3 档懒迁移 / S2 诊断
export async function scenes19({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  const openMap = async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
    await human.until(() => !!window.__activeMindmapCtl, { timeout: 9000, msg: '导图就绪' });
    await wait(600);
  };
  const seedTree = () => evaluate(() => {
    const ctl = window.__activeMindmapCtl;
    ctl.doc.roots = [{ id: 'root', text: '根', collapsed: false, children: [
      { id: 'A', text: '甲', collapsed: false, children: [] },
      { id: 'B', text: '乙', collapsed: false, children: [] },
    ] }];
    ctl.doc.refLines = [{ id: 'rl1', from: { id: 'A', k: 'node' }, to: { id: 'B', k: 'node' }, color: null, width: null, note: '', noteStyle: null, mode: 'curve', bend: 30, waypoints: [] }];
    ctl.doc.notes = []; ctl.doc.parentLinks = [];
    ctl.render();
    return true;
  });
  const boxOf = (id) => evaluate(([id]) => {
    const ctl = window.__activeMindmapCtl;
    const b = ctl.boxes?.get(id);
    return b ? { cx: b.x + b.w / 2, cy: b.y + b.h / 2 } : null;
  }, [id]);

  // ==================== 1：B2 复现链（远端拐点随端点重算，不贴新根节点） ====================
  await scenario('导图·渲染病B2·远端拐点不贴错', async () => {
    await openMap();
    await seedTree();
    await wait(400);
    const before = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const bA = ctl.boxes.get('A'), bB = ctl.boxes.get('B');
      return { A: { cx: bA.x + bA.w / 2, cy: bA.y + bA.h / 2 }, B: { cx: bB.x + bB.w / 2, cy: bB.y + bB.h / 2 } };
    });
    human.log('初态:', JSON.stringify(before));
    // 曲线加「远端」拐点（偏离连线很远的参数 k=0.9——旧补丁失真重灾区）
    await evaluate(([a, c]) => {
      const ctl = window.__activeMindmapCtl;
      ctl.doc.refLines[0].waypoints = [{ t: 0.5, k: 0.9 }];
      ctl.render();
    }, [before.A, before.B]);
    // 新增一棵大根树引发全图大位移（B2 原触发条件）
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const kids = [];
      for (let i = 0; i < 8; i++) kids.push({ id: 'R2k' + i, text: '新支' + i, collapsed: false, children: [] });
      ctl.doc.roots.push({ id: 'R2', text: '新增根节点', collapsed: false, children: kids });
      ctl.render();
    });
    await wait(400);
    const after = await evaluate(() => {
      const WP = { toPt(a, c, wp) { if (wp.t == null) return { x: wp.x, y: wp.y }; const dx = c.cx - a.cx, dy = c.cy - a.cy, L = Math.hypot(dx, dy) || 1; const nx = -dy / L, ny = dx / L; return { x: a.cx + dx * wp.t + nx * wp.k * L, y: a.cy + dy * wp.t + ny * wp.k * L }; } };
      const ctl = window.__activeMindmapCtl;
      const bA = ctl.boxes.get('A'), bB = ctl.boxes.get('B'), bR2 = ctl.boxes.get('R2');
      const a = { cx: bA.x + bA.w / 2, cy: bA.y + bA.h / 2 }, c = { cx: bB.x + bB.w / 2, cy: bB.y + bB.h / 2 };
      const wp = ctl.doc.refLines[0].waypoints[0];
      const expect = WP.toPt(a, c, wp);
      // 选中该线逼出手柄，读手柄真实屏幕位
      ctl.selectedLine = 'rl1'; ctl.render();
      const dot = document.querySelector('.mm-wp');
      const actual = dot ? { x: +dot.getAttribute('cx'), y: +dot.getAttribute('cy') } : null;
      const r2c = { cx: bR2.x + bR2.w / 2, cy: bR2.y + bR2.h / 2 };
      const path = document.querySelector('.mm-refline');
      const d = path?.getAttribute('d') || '';
      return { a, c, expect, actual, r2c, d,
        distA: Math.hypot((actual?.x || 0) - a.cx, (actual?.y || 0) - a.cy),
        distR2: Math.hypot((actual?.x || 0) - r2c.cx, (actual?.y || 0) - r2c.cy) };
    });
    human.log('重排后:', JSON.stringify(after));
    await human.assert(after.actual, '手柄应在');
    const err = Math.hypot(after.actual.x - after.expect.x, after.actual.y - after.expect.y);
    await human.assert(err < 2, `拐点屏幕位必须==参数化重算值（误差 ${err.toFixed(2)}px——参数化随端点重算）`);
    // B2 原病：线贴到新增根节点——端点绑定仍须指 A/B（不贴 R2）
    await human.assert(after.distA < after.distR2, `拐点必须离 A 近离新根远（A:${after.distA.toFixed(0)} vs R2:${after.distR2.toFixed(0)}——贴错实锤若反）`);
    await human.assert(after.d.startsWith('M'), '线渲染在');
  });

  // ==================== 2：直线直角拐点跟随 ====================
  await scenario('导图·直线拐点·随端点跟随', async () => {
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const b = ctl.doc.roots[0].children[0]; // A（父子连线 root→A）
      b.linkMode = 'straight';
      b.linkWps = [{ t: 0.5, k: 0.35 }];
      ctl.render();
    });
    await wait(300);
    const r1 = await evaluate(() => {
      const WP = { toPt(a, c, wp) { if (wp.t == null) return { x: wp.x, y: wp.y }; const dx = c.cx - a.cx, dy = c.cy - a.cy, L = Math.hypot(dx, dy) || 1; const nx = -dy / L, ny = dx / L; return { x: a.cx + dx * wp.t + nx * wp.k * L, y: a.cy + dy * wp.t + ny * wp.k * L }; } };
      const ctl = window.__activeMindmapCtl;
      const pr = ctl.boxes.get('root'), cb = ctl.boxes.get('A');
      const pa = { cx: pr.x + pr.w, cy: pr.y + pr.h / 2 }, pc = { cx: cb.x, cy: cb.y + cb.h / 2 };
      return { expect: WP.toPt(pa, pc, { t: 0.5, k: 0.35 }) };
    });
    // 大位移：A 下加十个子节点撑排
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const A = ctl.doc.roots[0].children[0];
      for (let i = 0; i < 10; i++) A.children.push({ id: 'Ak' + i, text: '甲支' + i, collapsed: false, children: [] });
      ctl.render();
    });
    await wait(300);
    const r2 = await evaluate(() => {
      const WP = { toPt(a, c, wp) { if (wp.t == null) return { x: wp.x, y: wp.y }; const dx = c.cx - a.cx, dy = c.cy - a.cy, L = Math.hypot(dx, dy) || 1; const nx = -dy / L, ny = dx / L; return { x: a.cx + dx * wp.t + nx * wp.k * L, y: a.cy + dy * wp.t + ny * wp.k * L }; } };
      const ctl = window.__activeMindmapCtl;
      const pr = ctl.boxes.get('root'), cb = ctl.boxes.get('A');
      const pa = { cx: pr.x + pr.w, cy: pr.y + pr.h / 2 }, pc = { cx: cb.x, cy: cb.y + cb.h / 2 };
      const conn = document.querySelector('.mm-conn[data-id="A"]');
      const d = conn?.getAttribute('d') || '';
      // 取路径中段拐点坐标（M.. L.. L.. 三点折线中间点）
      const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
      const mid = nums.length >= 6 ? { x: nums[2], y: nums[3] } : null;
      return { expect: WP.toPt(pa, pc, { t: 0.5, k: 0.35 }), mid, d: d.slice(0, 80) };
    });
    human.log('直线跟随:', JSON.stringify(r2));
    await human.assert(r2.mid, '直线拐点应在');
    const err = Math.hypot(r2.mid.x - r2.expect.x, r2.mid.y - r2.expect.y);
    await human.assert(err < 2, `直线拐点必须随端点重算（误差 ${err.toFixed(2)}px）`);
  });

  // ==================== 3：旧 v3 绝对拐点档懒迁移 ====================
  await scenario('导图·旧档v3·懒迁移一致', async () => {
    // 直接写入 v3 形态绝对坐标拐点，渲染后应迁移为 {t,k} 且视觉一致
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const bA = ctl.boxes.get('A'), bB = ctl.boxes.get('B');
      const ax = bA.x + bA.w / 2, ay = bA.y + bA.h / 2, bx = bB.x + bB.w / 2, by = bB.y + bB.h / 2;
      const absPt = { x: (ax + bx) / 2, y: Math.min(ay, by) - 60 }; // 旧档绝对拐点
      ctl.doc.refLines[0].waypoints = [absPt];
      ctl.render();
      window.__absPt = absPt;
      window.__abCenters = { a: { cx: ax, cy: ay }, c: { cx: bx, cy: by } };
    });
    await wait(300);
    const r = await evaluate(() => {
      const WP = { toPt(a, c, wp) { if (wp.t == null) return { x: wp.x, y: wp.y }; const dx = c.cx - a.cx, dy = c.cy - a.cy, L = Math.hypot(dx, dy) || 1; const nx = -dy / L, ny = dx / L; return { x: a.cx + dx * wp.t + nx * wp.k * L, y: a.cy + dy * wp.t + ny * wp.k * L }; } };
      const ctl = window.__activeMindmapCtl;
      const wp = ctl.doc.refLines[0].waypoints[0];
      const migrated = wp && wp.t != null;
      const now = migrated ? WP.toPt(window.__abCenters.a, window.__abCenters.c, wp) : null;
      return { migrated, wp, now, was: window.__absPt };
    });
    human.log('迁移:', JSON.stringify(r));
    await human.assert(r.migrated, `旧 {x,y} 必须懒迁移为 {t,k}（实际 ${JSON.stringify(r.wp)}）`);
    const err = Math.hypot(r.now.x - r.was.x, r.now.y - r.was.y);
    await human.assert(err < 1, `迁移必须视觉一致（误差 ${err.toFixed(2)}px）`);
  });

  // ==================== 4：S2 步骤化诊断（空大纲明白话） ====================
  await scenario('演示·S2·空大纲明白话', async () => {
    // 走打包产物测试口（页面内裸 import 源码必炸在 shell→registry→slide/pptx 依赖图的 bare pptxgenjs 上——与 S2 无关）
    const r = await evaluate(async () => {
      window.__activeSlideCtl = { outlineEl: { value: '' }, theme: null, sync: () => {} };
      try {
        await window.__externConvert.prepareForExternalOpen({ filePath: '/tmp/x.mazzslide', title: '空演示' }, null, { name: 'PowerPoint' });
        return { ok: true };
      } catch (e) { return { err: String(e.message || e) }; }
    });
    human.log('S2 诊断:', JSON.stringify(r));
    await human.assert(r.err && r.err.includes('大纲内容为空'), `空大纲必须明白话（实际 ${r.err || r.ok}）`);
    await human.assert(!r.err?.includes('格式转换失败'), '不得再裸报格式转换失败');
    await evaluate(() => { delete window.__activeSlideCtl; });
  });
}
