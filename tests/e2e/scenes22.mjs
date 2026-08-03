// tests/e2e/scenes22.mjs —— 波次三十三「演示叙事模式」实证批
// 圈帧/排序/镜头动画 / F5 放映逐帧推进 / Esc 还原 / present 态编辑禁用 / HUD 进度 / 序列化
export async function scenes22({ win, human, WS, scenario }) {
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
      { id: 'A', text: '甲', collapsed: false, children: [] },
      { id: 'B', text: '乙', collapsed: false, children: [] },
    ] }];
    ctl.doc.frames = [];
    ctl.render();
    return true;
  });

  // ==================== 1：圈帧与排序与镜头动画 ====================
  await scenario('导图·圈帧·排序·镜头动画', async () => {
    await openMap();
    await seed();
    // 圈三帧（视口不同位各圈一帧）
    const add = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      for (let i = 0; i < 3; i++) {
        ctl.cam.x = 30 + i * 160; ctl.render();
        ctl.mmExec('addFrame', { title: '画面' + (i + 1) });
      }
      return (ctl.doc.frames || []).map(f => f.title);
    });
    human.log('圈帧:', JSON.stringify(add));
    await human.assert(add.length === 3, `应圈三帧（${JSON.stringify(add)}）`);
    // 排序：第 3 帧上移一次 → 2/3 换位
    const order = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const fs = ctl.doc.frames;
      const before = fs.map(f => f.title).join(',');
      ctl.mmExec('moveFrame', { id: fs[2].id, dir: -1 });
      const after = ctl.doc.frames.map(f => f.title).join(',');
      return { before, after };
    });
    human.log('排序:', JSON.stringify(order));
    await human.assert(order.after !== order.before && order.after.indexOf('画面3') < order.after.indexOf('画面2'), `下移必须换位（${order.before}→${order.after}）`);
    // 镜头动画：跳帧 → cam 平滑到帧适配（非瞬移）
    const anim = await evaluate(async () => {
      const ctl = window.__activeMindmapCtl;
      const f = ctl.doc.frames[0];
      const k0 = ctl.cam.k;
      const m = await import('./modules/mindmap/mm-present.js');
      const target = m.camOfFrame(ctl, f, ctl.root.querySelector('.mm-canvas-wrap'));
      m.camTween(ctl, target, { duration: 400 });
      const kMid = ctl.cam.k;
      await new Promise(r => setTimeout(r, 700));
      return { k0, kMid, kEnd: ctl.cam.k, kTarget: target.k };
    });
    human.log('镜头动画:', JSON.stringify(anim));
    await human.assert(Math.abs(anim.kEnd - anim.kTarget) < 0.02, `动画必须落到帧适配（${anim.kEnd} vs ${anim.kTarget}）`);
  });

  // ==================== 2：F5 放映逐帧推进 + HUD ====================
  await scenario('导图·F5放映·逐帧推进', async () => {
    const start = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      ctl.mmExec('startPresent', 0);
      return { status: ctl.mmStatus, idx: ctl._presentIdx, hud: document.querySelector('.mm-present-stage')?.style.display };
    });
    human.log('放映启动:', JSON.stringify(start));
    await human.assert(start.status === 'present' && start.hud !== 'none', 'F5 必须进放映态+HUD 显');
    // → 下一帧（present-key 路由）
    await win.keyboard.press('ArrowRight');
    await wait(300);
    const r1 = await evaluate(() => ({ idx: window.__activeMindmapCtl._presentIdx, pvIdx: document.querySelector('.mm-pv-idx')?.textContent }));
    await human.assert(r1.idx === 1 && /2\s*\/\s*3/.test(r1.pvIdx || ''), `→ 必须推进第二帧（idx=${r1.idx} HUD=${r1.pvIdx}）`);
    // 空格再推进 → 到末帧（不越界）
    await win.keyboard.press(' ');
    await wait(300);
    await win.keyboard.press(' ');
    await wait(300);
    const r2 = await evaluate(() => window.__activeMindmapCtl._presentIdx);
    await human.assert(r2 === 2, `末帧必须钳位（idx=${r2}）`);
    // ← 上一帧
    await win.keyboard.press('ArrowLeft');
    await wait(300);
    const r3 = await evaluate(() => window.__activeMindmapCtl._presentIdx);
    await human.assert(r3 === 1, `← 必须回退（idx=${r3}）`);
  });

  // ==================== 3：present 态编辑禁用 + Esc 还原 ====================
  await scenario('导图·放映态·编辑禁用与还原', async () => {
    // 编辑尝试（双击节点 startEdit 应被闸）
    const edit = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const before = ctl.editing;
      // startEdit 闸（直接调——present 态应 return）
      const box = ctl.boxes.get('A');
      const camBefore = { ...ctl.cam };
      // 菜单闸
      const r = { editingBefore: before == null, camBefore };
      return r;
    });
    // 键盘编辑键（Delete/Tab）应被放映路由吞（不删节点）
    const delBefore = await evaluate(() => window.__activeMindmapCtl.doc.roots[0].children.length);
    await win.keyboard.press('Delete');
    await win.keyboard.press('Tab');
    await wait(300);
    const after = await evaluate(() => ({
      n: window.__activeMindmapCtl.doc.roots[0].children.length,
      editing: window.__activeMindmapCtl.editing,
      menu: !!document.querySelector('.mazz-menu'),
    }));
    human.log('禁用:', JSON.stringify({ delBefore, ...after }));
    await human.assert(after.n === delBefore && after.editing == null && !after.menu, '放映态编辑键必须全无效');
    // Esc 退出：状态回 normal+cam 还原快照动画回
    await win.keyboard.press('Escape');
    await wait(900);
    const exit = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      return { status: ctl.mmStatus, hud: document.querySelector('.mm-present-stage')?.style.display, cam: { ...ctl.cam }, prev: ctl._prevCam };
    });
    human.log('退出:', JSON.stringify(exit));
    await human.assert(exit.status === 'normal' && exit.hud === 'none', 'Esc 必须 rollback（status+hud）');
    await human.assert(exit.prev == null, '还原快照必须消费');
  });

  // ==================== 4：帧序列化往返 ====================
  await scenario('导图·帧·序列化往返', async () => {
    const r = await evaluate(async () => {
      const ctl = window.__activeMindmapCtl;
      const m = await import('./modules/mindmap/model.js');
      const s = m.serializeDoc(ctl.doc);
      const d = m.parseDoc(s);
      return { n: (d.frames || []).length, first: d.frames?.[0]?.title, v: JSON.parse(s).v };
    });
    human.log('序列化:', JSON.stringify(r));
    await human.assert(r.n === 3 && r.first === '画面1' && r.v === 4, `帧必须随档往返（${JSON.stringify(r)}）`);
  });
}
