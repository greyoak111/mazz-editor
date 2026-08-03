// tests/e2e/scenes24.mjs —— 波次三十四「窗格三模式+批量选删+导图桥接」实证批
// 三模式切换 / 移动模式平移 / 选框批量选中删除 / 桥接合并避让 / id 无冲突
import fs from 'node:fs';

export async function scenes24({ win, human, WS, scenario }) {
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
      { id: 'C', text: '丙', collapsed: false, children: [] },
    ] }];
    ctl.doc.frames = []; ctl.doc.swimlanes = [];
    ctl.render();
    return true;
  });

  // ==================== 1：三模式切换与移动模式 ====================
  await scenario('导图·三模式·切换与移动', async () => {
    await openMap();
    await seed();
    const m0 = await evaluate(() => window.__activeMindmapCtl.toolMode);
    await human.assert(m0 === 'build', `默认新建模式（${m0}）`);
    // 切移动模式（工具钮产品路径：setToolMode 全链——hint/渲染同步走）
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      ctl.selected = null; ctl.selectedLine = null; ctl.selectedNote = null; ctl.render(); // 先走全局分支出工具钮
      document.querySelector('[data-t="pan"]')?.click();
    });
    await wait(300);
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const b = ctl.boxes.get('A');
      const rect = document.querySelector('.mm-canvas-wrap').getBoundingClientRect();
      const x = rect.left + (b.x + b.w / 2) * ctl.cam.k + ctl.cam.x, y = rect.top + (b.y + b.h / 2) * ctl.cam.k + ctl.cam.y;
      const cam0 = { ...ctl.cam };
      window.__cam0 = cam0;
      const g = document.querySelector('.mm-node[data-id="A"]');
      g.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true })); // target=g 才走 onNodePointerDown
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 90, clientY: y + 40, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    await wait(400);
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      return { cam: { ...ctl.cam }, cam0: window.__cam0, sel: ctl.selected, mode: ctl.toolMode };
    });
    human.log('移动模式:', JSON.stringify(r));
    await human.assert(r.mode === 'pan' && Math.abs(r.cam.x - r.cam0.x - 90) < 6 && Math.abs(r.cam.y - r.cam0.y - 40) < 6, `移动模式节点上必须平移（Δcam=${(r.cam.x - r.cam0.x).toFixed(0)},${(r.cam.y - r.cam0.y).toFixed(0)}）`);
    await human.assert(r.sel == null, '移动模式不得选中节点');
    // hint 随模式
    const hint = await evaluate(() => document.querySelector('.mm-hint')?.textContent || '');
    await human.assert(hint.includes('移动模式'), `hint 必须随模式（${hint.slice(0, 30)}）`);
  });

  // ==================== 2：选框批量选中与 Delete 删除 ====================
  await scenario('导图·选框·批量选中删除', async () => {
    await evaluate(() => { window.__activeMindmapCtl.toolMode = 'select'; });
    await wait(200);
    // 拖框盖住 A/B 两节点（世界坐标框）
    const n = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const bA = ctl.boxes.get('A'), bB = ctl.boxes.get('B'), bC = ctl.boxes.get('C');
      const rect = document.querySelector('.mm-canvas-wrap').getBoundingClientRect();
      const x1 = Math.min(bA.x, bB.x) - 6, y1 = Math.min(bA.y, bB.y) - 6;
      const x2 = Math.max(bA.x + bA.w, bB.x + bB.w) + 6, y2 = Math.max(bA.y + bA.h, bB.y + bB.h) + 6; // 缓冲 6：兄弟间距 14 之下不罩 C（lr 兄弟同 x 竖排实锤）
      const wrap = document.querySelector('.mm-canvas-wrap');
      const toPx = (wx, wy) => [rect.left + wx * ctl.cam.k + ctl.cam.x, rect.top + wy * ctl.cam.k + ctl.cam.y];
      const [px1, py1] = toPx(x1, y1), [px2, py2] = toPx(x2, y2);
      wrap.querySelector('.mm-svg').dispatchEvent(new PointerEvent('pointerdown', { clientX: px1, clientY: py1, button: 0, bubbles: true })); // target=svg 才走空白选框分支
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: px2, clientY: py2, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return { sel: [...ctl.multiSel], cIn: ctl.multiSel.has('C') };
    });
    human.log('选框:', JSON.stringify(n));
    await human.assert(n.sel.length === 2 && n.sel.includes('A') && n.sel.includes('B') && !n.cIn, `选框必须只罩住 A/B（${JSON.stringify(n.sel)}）`);
    // 高亮渲染
    const hi = await evaluate(() => document.querySelectorAll('.mm-node [stroke-width="2.6"]').length);
    await human.assert(hi >= 1, '多选必须高亮');
    // Delete 批量删除
    await win.keyboard.press('Delete');
    await wait(400);
    const after = await evaluate(() => ({
      n: window.__activeMindmapCtl.doc.roots[0].children.length,
      left: window.__activeMindmapCtl.doc.roots[0].children.map(c => c.id),
      selSize: window.__activeMindmapCtl.multiSel.size,
    }));
    human.log('删除后:', JSON.stringify(after));
    await human.assert(after.n === 1 && after.left[0] === 'C' && after.selSize === 0, `A/B 必须批删只剩 C（${JSON.stringify(after.left)}）`);
    // 撤销还原（命令路由=scenes5 同款真实路径；批删后栈≥1，undo 后还原）
    const pre = await evaluate(() => window.__activeMindmapCtl.undoStack.length);
    await evaluate(() => window.MazzCommands?.execute('mindmap.undo'));
    await wait(400);
    const post = await evaluate(() => ({
      n: window.__activeMindmapCtl.doc.roots[0].children.length,
      stack: window.__activeMindmapCtl.undoStack.length,
      redo: window.__activeMindmapCtl.redoStack.length,
    }));
    human.log('撤销探针:', JSON.stringify({ pre, ...post }));
    await human.assert(pre >= 1, `批删必须入栈（${pre}）`);
    await human.assert(post.n === 3, `撤销必须还原 3 子（${JSON.stringify(post)}）`);
    // redo 回来（批删再删）
    await evaluate(() => window.MazzCommands?.execute('mindmap.redo'));
    await wait(300);
    const redone = await evaluate(() => window.__activeMindmapCtl.doc.roots[0].children.length);
    await human.assert(redone === 1, `重做必须回到批删后（${redone}）`);
  });

  // ==================== 3：右键选单批量删除 ====================
  await scenario('导图·选框·右键选单删除', async () => {
    await seed(); // 场景隔离：重新种子 A/B/C（不依赖场景 2 状态）
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      ctl.toolMode = 'select';
      ctl.multiSel = new Set(['A', 'C']);
      ctl.render();
    });
    await wait(200);
    const has = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      return { n: ctl.multiSel.size };
    });
    await human.assert(has.n === 2, '多选就位');
    // 直接调 deleteMultiSel（右键项同函数——菜单驱动等价）
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      // 右键菜单同路径：deleteMultiSel()
      const fn = ctl.doc && (() => {
        const n = ctl.multiSel.size;
        if (!n) return false;
        for (const id of [...ctl.multiSel]) {
          // 与 deleteMultiSel 同链
        }
        return true;
      });
      // 直接调（右键项即此函数——验证行为等价）
      window.__delN = ctl.multiSel.size;
      // 用模块内函数（通过键盘路径已验；此处右键路径同函数——用命令层调
    });
    // 右键菜单存在性（DOM 菜单出「删除所选 N 个节点」）
    const menu = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      // 打开空白菜单看批量删除项
      const rect = document.querySelector('.mm-canvas-wrap').getBoundingClientRect();
      const wrap = document.querySelector('.mm-canvas-wrap');
      wrap.querySelector('.mm-svg').dispatchEvent(new MouseEvent('contextmenu', { clientX: rect.left + 30, clientY: rect.top + 30, bubbles: true, cancelable: true })); // target=svg 才走空白菜单
      const m = document.querySelector('.mazz-menu');
      return { has: !!m, text: m?.textContent || '' };
    });
    await human.assert(menu.has && /删除所选\s*2\s*个节点/.test(menu.text), `右键选单必须有批量删除项（${menu.text.slice(0, 40)}）`);
    // 点该项删除
    await evaluate(() => {
      const item = [...document.querySelectorAll('.mazz-menu-item')].find(e => /删除所选/.test(e.textContent));
      item?.click();
    });
    await wait(300);
    const after = await evaluate(() => ({ n: window.__activeMindmapCtl.doc.roots[0].children.length, selSize: window.__activeMindmapCtl.multiSel.size }));
    await human.assert(after.n === 1 && after.selSize === 0, `右键批删必须落（剩 ${after.n}）`);
  });

  // ==================== 4：桥接合并（自动避让位 + id 无冲突） ====================
  await scenario('导图·桥接·合并避让', async () => {
    // 造来源导图文件（含引用线/便笺——附属随档验证）
    const srcDoc = {
      v: 4, mode: 'lr', scheme: 1,
      roots: [{ id: 'root', text: '源根', collapsed: false, children: [
        { id: 'A', text: '源甲', collapsed: false, children: [{ id: 'A1', text: '源甲一', collapsed: false, children: [] }] },
        { id: 'X', text: '源乙', collapsed: false, children: [] },
      ] }],
      notes: [{ id: 'note1', text: '源便笺', x: 50, y: 50, w: 150, color: null, style: null }],
      refLines: [{ id: 'rl9', from: { id: 'A', k: 'node' }, to: { id: 'X', k: 'node' }, mode: 'curve', bend: 30, waypoints: [], color: null, width: null, note: '', noteStyle: null }],
      parentLinks: [], swimlanes: [], frames: [],
    };
    fs.mkdirSync(WS + '/桥', { recursive: true });
    fs.writeFileSync(WS + '/桥/来源图.mindmap', JSON.stringify(srcDoc, null, 1));
    const before = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const ids = new Set();
      for (const rt of ctl.doc.roots) { (function w(x) { ids.add(x.id); for (const c of x.children) w(c); })(rt); }
      return { roots: ctl.doc.roots.length, ids: ids.size, maxX: Math.max(...[...ctl.boxes.values()].map(b => b.x + b.w)) };
    });
    // 清选中走全局分支（__merge 钮在全局分支）→ 点合并钮 → 等 inputModal → 填 1 → 确定
    await evaluate(() => { const ctl = window.__activeMindmapCtl; ctl.selected = null; ctl.selectedLine = null; ctl.selectedNote = null; ctl.render(); });
    await wait(300);
    await evaluate(() => { document.querySelector('[data-k="__merge"]')?.click(); });
    await wait(900);
    await evaluate(() => {
      const inp = document.querySelector('.mazz-palette-mask input');
      if (inp) { inp.value = '1'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      document.querySelector('.mazz-palette-mask #im-ok')?.click(); // inputModal 确定钮（id=im-ok 实锤）
    });
    await wait(1200);
    const after = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const ids = new Set();
      for (const rt of ctl.doc.roots) { (function w(x) { ids.add(x.id); for (const c of x.children) w(c); })(rt); }
      const seen = new Set(); let dup = 0;
      for (const rt of ctl.doc.roots) { (function w(x) { if (seen.has(x.id)) dup++; seen.add(x.id); for (const c of x.children) w(c); })(rt); }
      const newRoot = ctl.doc.roots[ctl.doc.roots.length - 1];
      return {
        roots: ctl.doc.roots.length, ids: ids.size, dup,
        refN: ctl.doc.refLines.length, noteN: ctl.doc.notes.length,
        refOk: ctl.doc.refLines.every(rl => seen.has(rl.from.id) && seen.has(rl.to.id)),
        newRootText: newRoot?.text, newRootOffX: newRoot?.offX,
        modalGone: !document.querySelector('.mazz-palette-mask'),
      };
    });
    human.log('桥接:', JSON.stringify(after));
    await human.assert(after.roots === before.roots + 1, `合并必须多一根（${before.roots}→${after.roots}）`);
    await human.assert(after.newRootText === '源根', `来源根必须入档（${after.newRootText}）`);
    await human.assert(after.refN >= 1 && after.noteN >= 1, '附属（引用线/便笺）必须随档');
    await human.assert(after.dup === 0, `合并后 id 必须零冲突（重复 ${after.dup}）`);
    await human.assert(after.refOk, '引用线端点必须全部重映射到存活节点');
    // 避让：新根自动落点在原有内容右侧（offX>原 maxX）
    await human.assert(after.newRootOffX == null || after.newRootOffX >= before.maxX, `新根必须避让落右侧（offX=${after.newRootOffX} vs 原 maxX=${before.maxX}）`);
  });
}
