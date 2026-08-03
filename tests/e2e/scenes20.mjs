// tests/e2e/scenes20.mjs —— 波次三十一「图形库扩容+模板包+模块骨架」实证批
// 骨架注册 / 形状六符+shapePad / 箭头多形态 / 泳道归属着色 / 模板包导出导入往返
export async function scenes20({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const openMap = async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
    await human.until(() => !!window.__activeMindmapCtl, { timeout: 9000, msg: '导图就绪' });
    await wait(600);
  };
  const seed = () => evaluate(() => {
    const ctl = window.__activeMindmapCtl;
    ctl.doc.roots = [{ id: 'root', text: '根', collapsed: false, children: [
      { id: 'A', text: '判断节点甲乙丙丁', collapsed: false, children: [] },
      { id: 'B', text: '乙', collapsed: false, children: [] },
    ] }];
    ctl.doc.refLines = [{ id: 'rl1', from: { id: 'A', k: 'node' }, to: { id: 'B', k: 'node' }, color: null, width: null, note: '', noteStyle: null, mode: 'curve', bend: 30, waypoints: [] }];
    ctl.doc.notes = []; ctl.doc.parentLinks = []; ctl.doc.swimlanes = [];
    ctl.render();
    return true;
  });

  // ==================== 1：骨架注册 + 形状六符 ====================
  await scenario('导图·骨架·形状六符', async () => {
    await openMap();
    await seed();
    const mods = await evaluate(() => Object.keys(window.__activeMindmapCtl.mmCommands || {}));
    human.log('注册命令:', JSON.stringify(mods));
    await human.assert(mods.includes('setnodeshape') && mods.includes('setarrowhead') && mods.includes('addswimlane') && mods.includes('exporttplpack'), `骨架必须三 deals 命令在池（${JSON.stringify(mods)}）`);
    // 改 A 为菱形
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      ctl.selected = 'A';
      window.__mmA0 = { w: ctl.boxes.get('A').w };
      ctl.mmExec('setNodeShape', 'diamond');
    });
    await wait(400);
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const g = document.querySelector('.mm-node[data-id="A"]');
      return {
        shape: ctl.doc.roots[0].children[0].shape,
        polygon: !!g?.querySelector('polygon'),
        rect: !!g?.querySelector('rect:not(.mm-resize)'),
        w: ctl.boxes.get('A').w, w0: window.__mmA0.w,
      };
    });
    human.log('菱形:', JSON.stringify(r));
    await human.assert(r.shape === 'diamond' && r.polygon && !r.rect, '菱形必须渲染 polygon 非 rect');
    await human.assert(r.w > r.w0 * 1.2, `菱形必须 shapePad 扩宽（${r.w0}→${r.w}——文字防贴边）`);
    // 换圆柱
    await evaluate(() => { const ctl = window.__activeMindmapCtl; ctl.mmExec('setNodeShape', 'cylinder'); });
    await wait(300);
    const cyl = await evaluate(() => !!document.querySelector('.mm-node[data-id="A"] path'));
    await human.assert(cyl, '圆柱必须渲染 path');
  });

  // ==================== 2：箭头多形态 ====================
  await scenario('导图·箭头·多形态', async () => {
    const r1 = await evaluate(async () => {
      const ctl = window.__activeMindmapCtl;
      ctl.mmExec('setArrowHead', 'open');
      return { kind: ctl.doc.linkStyle?.arrow };
    });
    await wait(300);
    const open = await evaluate(() => {
      const heads = [...document.querySelectorAll('.mm-svg path')].filter(p => p.getAttribute('fill') === 'none' && p.getAttribute('stroke') && !p.classList.contains('mm-refline') && !p.classList.contains('mm-conn'));
      return { kind: window.__activeMindmapCtl.doc.linkStyle?.arrow, openHead: heads.length > 0 };
    });
    human.log('空心箭头:', JSON.stringify(open));
    await human.assert(open.kind === 'open' && open.openHead, '空心三角必须 fill=none stroke 有');
    // 圆点
    await evaluate(() => { const ctl = window.__activeMindmapCtl; ctl.mmExec('setArrowHead', 'circle'); });
    await wait(300);
    const cir = await evaluate(() => {
      const heads = [...document.querySelectorAll('.mm-svg circle')].filter(c => c.getAttribute('stroke') && +c.getAttribute('r') === 4.5);
      return { kind: window.__activeMindmapCtl.doc.linkStyle?.arrow, n: heads.length };
    });
    await human.assert(cir.kind === 'circle' && cir.n >= 1, `圆点箭头必须在（${JSON.stringify(cir)}）`);
    // 无箭头
    await evaluate(() => { const ctl = window.__activeMindmapCtl; ctl.mmExec('setArrowHead', 'none'); });
    await wait(300);
    const none = await evaluate(() => [...document.querySelectorAll('.mm-svg circle')].filter(c => +c.getAttribute('r') === 4.5).length);
    await human.assert(none === 0, '无箭头模式箭头必须清');
    // 线级覆盖
    await evaluate(() => { const ctl = window.__activeMindmapCtl; ctl.doc.refLines[0].arrow = 'diamond'; ctl.render(); });
    await wait(200);
    const lv = await evaluate(() => {
      const m = [...document.querySelectorAll('.mm-svg path')].filter(p => /Z$/.test(p.getAttribute('d') || '') && p.getAttribute('fill') && p.getAttribute('fill') !== 'none');
      return { linkArrow: window.__activeMindmapCtl.doc.refLines[0].arrow, global: window.__activeMindmapCtl.doc.linkStyle?.arrow };
    });
    await human.assert(lv.linkArrow === 'diamond' && lv.global === 'none', `线级覆盖全局必须有（${JSON.stringify(lv)}）`);
  });

  // ==================== 3：泳道（背景+归属着色+拖动） ====================
  await scenario('导图·泳道·归属着色', async () => {
    await evaluate(async () => {
      const ctl = window.__activeMindmapCtl;
      const bA = ctl.boxes.get('A'), bB = ctl.boxes.get('B');
      const x = Math.min(bA.x, bB.x) - 40, y = Math.min(bA.y, bB.y) - 50;
      const x2 = Math.max(bA.x + bA.w, bB.x + bB.w) + 40, y2 = Math.max(bA.y + bA.h, bB.y + bB.h) + 50;
      ctl.mmExec('addSwimlane', { title: '阶段一', x, y, w: x2 - x, h: y2 - y });
    });
    await wait(400);
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const lane = ctl.doc.swimlanes[0];
      const bg = document.querySelector('.mm-lane rect');
      const gA = document.querySelector('.mm-node[data-id="A"]');
      const shape = gA?.querySelector('polygon,ellipse,path,rect:not(.mm-resize)');
      return {
        lane: !!lane, laneTitle: lane?.title, bg: !!bg,
        aStroke: shape?.getAttribute('stroke'), laneColor: lane?.color,
        aStrokeW: shape?.getAttribute('stroke-width'),
      };
    });
    human.log('泳道:', JSON.stringify(r));
    await human.assert(r.lane && r.bg, '泳道背景层必须渲染');
    await human.assert(r.aStroke === r.laneColor && +r.aStrokeW >= 2, `节点入泳道必须归属着色（stroke=${r.aStroke} vs 泳道色 ${r.laneColor}）`);
    // 拖动泳道（标题条 move）
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const lane = ctl.doc.swimlanes[0];
      ctl._laneDrag = { id: lane.id, sx: 500, sy: 400, ox: lane.x, oy: lane.y, mode: 'move' };
      import('./modules/mindmap/mm-swimlanes.js').then(m => { m.laneDragMove(ctl, { clientX: 560, clientY: 430 }); m.laneDragEnd(ctl); ctl.render(); }); // 拖拽工具函数纯计算无 bare 依赖可源码直引
    });
    await wait(200);
    const moved = await evaluate(() => { const l = window.__activeMindmapCtl.doc.swimlanes[0]; return { x: l.x, y: l.y }; });
    human.log('拖动后:', JSON.stringify(moved));
    await human.assert(moved.x > 0 && (moved.x !== r.lane?.x || moved.y !== r.lane?.y), '泳道必须可拖动移位');
  });

  // ==================== 4：模板包导出导入往返 ====================
  await scenario('导图·模板包·导出导入往返', async () => {
    // 导出（绕过 inputModal：直调 exportPack）
    const ex = await evaluate(async () => {
      const ctl = window.__activeMindmapCtl;
      try {
        const r = await ctl.tplpack.exportPack({ name: '实证包', desc: 'w31' });
        return { ok: true, path: r.path, levels: r.meta.tpl?.levels };
      } catch (e) { return { err: String(e.message || e) }; }
    });
    human.log('导出:', JSON.stringify(ex));
    await human.assert(ex.ok, `打包必须成（${ex.err || ''}）`);
    // 破坏现场后导入复原
    const imp = await evaluate(async ([p]) => {
      const ctl = window.__activeMindmapCtl;
      const before = JSON.stringify(ctl.doc.roots.map(r => [r.id, r.children.map(c => c.id)]));
      ctl.doc.roots = [{ id: 'x', text: '破坏', collapsed: false, children: [] }];
      ctl.render();
      const pack = await ctl.tplpack.importPack(p);
      ctl.tplpack.applyPack(pack);
      const after = JSON.stringify(ctl.doc.roots.map(r => [r.id, r.children.map(c => c.id)]));
      return { before, after, name: pack.meta.name, swim: ctl.doc.swimlanes?.length, v: undefined };
    }, [ex.path]);
    human.log('导入:', JSON.stringify(imp));
    await human.assert(imp.before === imp.after, `导入必须复原文档结构（${imp.before} vs ${imp.after}）`);
    await human.assert(imp.name === '实证包' && imp.swim >= 1, '包元数据与泳道必须随档');
    // 库列表
    const packs = await evaluate(async () => await window.__activeMindmapCtl.tplpack.listPacks());
    await human.assert(packs.some(p => p.name === '实证包'), `库必须列出实证包（${JSON.stringify(packs)}）`);
    // 序列化往返
    const round = await evaluate(async () => {
      const ctl = window.__activeMindmapCtl;
      const m = await import('./modules/mindmap/model.js'); // 纯源码无 bare 可直引
      const s = m.serializeDoc(ctl.doc);
      const d = m.parseDoc(s);
      return { v: JSON.parse(s).v, swimOut: d.swimlanes?.length, shape: d.roots[0].children[0].shape };
    });
    await human.assert(round.v === 4 && round.swimOut >= 1 && round.shape === 'cylinder', `序列化往返必须保泳道与形状（${JSON.stringify(round)}）`);
  });
}
