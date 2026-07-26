// tests/e2e/scenes-panes.mjs —— 分屏专项：三竖条及以上（用户钦定门槛）+ 不回归保证
// 判定标准：连续向右 ≥2 次必须成 ≥3 竖条；向左同理且新格在左；混合嵌套不崩；空格可收缩
export async function scenesPanes({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => human.evaluate(fn, arg);

  const openDocs = async (names) => {
    for (const [n, c] of names) {
      await evaluate(async ([p, cc]) => { await window.mazz.invoke('fs:writeFile', { path: p, content: cc }); }, [WS + '/' + n, c]);
      await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/' + n]);
      await win.waitForTimeout(300);
    }
  };

  const dump = () => evaluate(() => {
    const t = window.MazzShell.paneTree;
    const walk = (n) => n.tabs ? { leaf: true, tabs: n.tabs.tabs.map(x => x.id) } : { dir: n.direction, a: walk(n.a), b: walk(n.b) };
    const leaves = t.leaves();
    return {
      count: leaves.length,
      tree: walk(t.root),
      tabsEach: leaves.map(l => l.tabs.tabs.length),
      rects: leaves.map(l => { const r = l.el.getBoundingClientRect(); return Math.round(r.x) + ':' + Math.round(r.width); }),
    };
  });

  /** 真实拖拽序列：把 fromPaneIdx 格的活动签拖到 toPaneIdx 格的 zone 区（默认拖到最末格） */
  const drag = async (zone, { from = 0, to = -1 } = {}) => {
    return await evaluate(([z, f, tIdx]) => {
      const sh = window.MazzShell;
      const panes = sh.paneTree.leaves();
      const fromPane = panes[f] || panes[0];
      const tid = fromPane.tabs.active?.id || fromPane.tabs.tabs[fromPane.tabs.tabs.length - 1]?.id;
      if (!tid) return 'no-tab';
      const target = tIdx < 0 ? panes[panes.length + tIdx] : panes[tIdx];
      const rect = target.el.getBoundingClientRect();
      const x = z === 'right' ? rect.right - 8 : z === 'left' ? rect.left + 8 : rect.left + rect.width / 2;
      const y = z === 'down' ? rect.bottom - 8 : z === 'up' ? rect.top + 8 : rect.top + rect.height / 2;
      const dt = new DataTransfer();
      dt.setData('mazz/tab', tid);
      document.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
      return 'ok';
    }, [zone, from, to]);
  };

  // ============ P1：连续右分三次 → 四竖条全 row 等宽 ============
  await scenario('分屏·右×3·四竖条全row', async () => {
    await openDocs([['p-a.md', '# 甲'], ['p-b.md', '# 乙'], ['p-c.md', '# 丙'], ['p-d.md', '# 丁']]);
    await evaluate(() => { const sh = window.MazzShell; while (sh.paneTree.leaves().length > 1) sh.paneTree.closePane(sh.paneTree.leaves()[1]); });
    await win.waitForTimeout(400);
    await human.assert((await dump()).count === 1, '开局单窗格');
    await drag('right', { from: 0 });
    await human.assert((await dump()).count === 2, '第一次右分应成 2 格');
    await drag('right', { from: 0 });
    await human.assert((await dump()).count === 3, '第二次右分应成 3 格（老大难门槛一）');
    await drag('right', { from: 0 });
    const st = await dump();
    await human.assert(st.count === 4, '第三次右分应成 4 格（老大难门槛二）');
    await human.assert(st.tree.dir === 'row' && st.tree.b.dir === 'row' && st.tree.b.b.dir === 'row',
      '三次都必须是 row（竖条）');
    // 几何：嵌套逐次对半（VS Code 语义）——各格可用宽 + x 严格递增
    const xs = st.rects.map(r => +r.split(':')[0]);
    const ws = st.rects.map(r => +r.split(':')[1]);
    await human.assert(Math.min(...ws) >= 120, `最窄格应可用（${Math.min(...ws)}px）`);
    const sorted = [...xs].sort((a, b) => a - b);
    await human.assert(JSON.stringify(xs) === JSON.stringify(sorted), `四格 x 应递增成排（${xs.join(',')}）`);
    await human.shot('四竖条');
  });

  // ============ P2：竖条间迁签（tabbar 拖入已有格） ============
  await scenario('分屏·竖条间迁签·空格可用', async () => {
    // 先给第 0 格补一签（P1 末态 [1,1,1,1]，直接迁会把 0 格掏空触发自动收缩=迁签误变窗格数的场景脆弱性）
    await evaluate(() => window.MazzShell.paneTree.setActive(window.MazzShell.paneTree.leaves()[0]));
    await openDocs([['p-e.md', '# 戊']]);
    await win.waitForTimeout(300);
    const st0 = await dump();
    // 从第 0 格（有多个签）拖一个签进第 2 格的标签栏
    const moved = await evaluate(() => {
      const sh = window.MazzShell;
      const panes = sh.paneTree.leaves();
      const src = panes[0];
      const tid = src.tabs.active?.id || src.tabs.tabs[src.tabs.tabs.length - 1]?.id;
      const dst = panes[2];
      const tb = dst.el.querySelector('.tabbar');
      const r = tb.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.setData('mazz/tab', tid);
      document.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      // dragover 必须落在 tabbar 本体上——文档级捕获会就近判定成分屏区
      tb.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: r.left + 30, clientY: r.top + 10, dataTransfer: dt }));
      tb.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: r.left + 30, clientY: r.top + 10, dataTransfer: dt }));
      return tid;
    });
    await win.waitForTimeout(400);
    const st = await dump();
    await human.assert(st.tabsEach[2] >= 1, `拖入后第 2 格应有签（${JSON.stringify(st.tabsEach)}）`);
    await human.assert(st.count === st0.count, '迁签不改变窗格数');
  });

  // ============ P3：连续左分两次 → 三竖条且新格在左 ============
  await scenario('分屏·左×2·新格在左侧', async () => {
    await evaluate(() => { const sh = window.MazzShell; while (sh.paneTree.leaves().length > 1) sh.paneTree.closePane(sh.paneTree.leaves()[1]); });
    await win.waitForTimeout(400);
    await human.assert((await dump()).count === 1, '先收归单格');
    await drag('left', { from: 0, to: 0 });
    await drag('left', { from: 0, to: 0 });
    const st = await dump();
    await human.assert(st.count === 3, '左×2 应成 3 竖条');
    await human.assert(st.tree.dir === 'row' && st.tree.a.dir === 'row', '左侧嵌套必须也是 row');
    // 最左格 x 坐标应最小且各格 x 递增
    const xs = st.rects.map(r => +r.split(':')[0]);
    const sorted = [...xs].sort((a, b) => a - b);
    await human.assert(JSON.stringify(xs) === JSON.stringify(sorted), `竖条 x 应递增排布（${xs.join(',')}）`);
    await human.shot('三竖条左分');
  });

  // ============ P4：复杂嵌套——四分屏下左下再左右分（不崩即胜） ============
  await scenario('分屏·复杂嵌套·左下再右分', async () => {
    // 布局：右 → 第2格下 → 第2格（上）左下?——直接构造：右、下、再对下格右
    await evaluate(() => { const sh = window.MazzShell; while (sh.paneTree.leaves().length > 1) sh.paneTree.closePane(sh.paneTree.leaves()[1]); });
    await win.waitForTimeout(300);
    await drag('right', { from: 0 });        // [主 | 右]
    await drag('down', { from: 0, to: 0 });  // 主格下分 → 左上/左下 + 右
    const mid = await dump();
    await human.assert(mid.count === 3, `右+下应成 3 格（实际 ${mid.count}）`);
    // 关键动作：对「左下」格（index 1）再做右分
    await drag('right', { from: 0, to: 1 });
    const st = await dump();
    await human.assert(st.count === 4, `左下再右分应成 4 格（实际 ${st.count}）`);
    // 结构合法性：树上既有 row 又有 column
    const dirs = JSON.stringify(st.tree);
    await human.assert(dirs.includes('"row"') && dirs.includes('"column"'), '嵌套应 row/column 共存');
    await human.shot('复杂嵌套');
  });

  // ============ P6：虚空标签清扫（删除即关签 + 目录级联） ============
  await scenario('窗口·删除文件·打开标签即消失', async () => {
    // 造两个文件都打开
    await evaluate(async ([a, b]) => {
      await window.mazz.invoke('fs:writeFile', { path: a, content: '# 甲档' });
      await window.mazz.invoke('fs:writeFile', { path: b, content: '# 乙档' });
      await window.MazzCommands.execute('file.openPath', { path: a });
      await window.MazzCommands.execute('file.openPath', { path: b });
    }, [WS + '/甲档.md', WS + '/子层/乙档.md']);
    await win.waitForTimeout(800);
    const tabs0 = await evaluate(() => window.MazzShell.paneTree.leaves().flatMap(l => l.tabs.tabs).map(t => t.filePath));
    await human.assert(tabs0.some(p => p?.endsWith('甲档.md')), '甲档标签应在');
    // 删除甲档（走 IPC 等价于文件树删除路径）
    await evaluate(async ([p]) => { await window.mazz.invoke('fs:delete', { path: p }); }, [WS + '/甲档.md']);
    await win.waitForTimeout(2500); // watcher debounce(300ms)+广播延迟
    const tabs1 = await evaluate(() => window.MazzShell.paneTree.leaves().flatMap(l => l.tabs.tabs).map(t => t.filePath));
    await human.assert(!tabs1.some(p => p?.endsWith('甲档.md')), '删除后甲档标签应消失（虚空标签绝育）');
    // 目录级联：删掉子层 → 乙档标签也消失
    await evaluate(async ([p]) => { await window.mazz.invoke('fs:delete', { path: p }); }, [WS + '/子层']);
    await win.waitForTimeout(600);
    const tabs2 = await evaluate(() => window.MazzShell.paneTree.leaves().flatMap(l => l.tabs.tabs).map(t => t.filePath));
    await human.assert(!tabs2.some(p => p?.includes('子层')), '删目录后其子文件标签应级联消失');
    await human.shot('虚空标签清扫');
  });

  // ============ P4.5：分屏预览渐隐渐变（边沿→中心，先急后缓） ============
  await scenario('分屏·预览渐隐·方向与曲线正确', async () => {
    await evaluate(() => { const sh = window.MazzShell; while (sh.paneTree.leaves().length > 1) sh.paneTree.closePane(sh.paneTree.leaves()[1]); });
    await win.waitForTimeout(300);
    // 触发右侧区悬停：合成 dragstart + dragover（不 drop，留悬停态看 overlay）
    await evaluate(() => {
      const sh = window.MazzShell;
      const tid = sh.tabs?.active?.id;
      const dt = new DataTransfer();
      dt.setData('mazz/tab', tid || 'x');
      document.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const pane = document.querySelector('.pane');
      const r = pane.getBoundingClientRect();
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: r.right - 6, clientY: r.top + r.height / 2, dataTransfer: dt }));
    });
    await win.waitForTimeout(300);
    const st = await evaluate(() => {
      const ov = [...document.querySelectorAll('body > div')].find(d => d.style.position === 'fixed' && d.style.zIndex === '60');
      if (!ov) return null;
      const r = ov.getBoundingClientRect();
      const pane = document.querySelector('.pane').getBoundingClientRect();
      return { bg: ov.style.background, w: r.width, paneW: pane.width, border: ov.style.border, borderStyle: ov.style.borderStyle || '' };
    });
    await human.assert(!!st, '分屏预览浮层应出现');
    await human.assert(st.bg.includes('linear-gradient'), '必须是渐变（渐隐再就业）');
    await human.assert(st.bg.includes('to left'), '右区必须从右边沿向左渐隐（边沿→中心）');
    // 中心侧零边界：整圈边框已取缔，只剩锚边单线
    await human.assert(st.borderStyle !== 'dashed' && !st.borderStyle.includes('dashed'), '整圈虚线框必须消灭（中心侧线的元凶）');
    await human.assert(/rgba\([^)]+,\s*0\.4\)/.test(st.bg) && /rgba\([^)]+,\s*0\.1\)/.test(st.bg), `曲线须先强后弱（实际：${st.bg.slice(0, 90)}）`);
    // 覆盖比例不变：仍占窗格 1/3 宽
    const ratio = st.w / st.paneW;
    await human.assert(Math.abs(ratio - 1 / 3) < 0.06, `覆盖比例应保持 1/3（实际 ${ratio.toFixed(2)}）`);
    await human.shot('分屏渐隐预览'); // 悬停态截图（渐隐可见）
    // 结束悬停
    await evaluate(() => { document.dispatchEvent(new DragEvent('dragend', { bubbles: true })); });
  });

  // ============ P5：不回归——空格关闭收缩 + 单右分仍正确 ============
  await scenario('分屏·不回归·空格收缩与单分', async () => {
    await evaluate(() => { const sh = window.MazzShell; while (sh.paneTree.leaves().length > 1) sh.paneTree.closePane(sh.paneTree.leaves()[1]); });
    await win.waitForTimeout(300);
    await drag('right', { from: 0 });
    let st = await dump();
    await human.assert(st.count === 2 && st.tree.dir === 'row', '基础右分仍须正常');
    // 关闭第二格（带签）→ 窗格收缩且标签合并回主格（closePane 迁移语义）
    await evaluate(() => {
      const sh = window.MazzShell;
      const panes = sh.paneTree.leaves();
      if (panes.length > 1) sh.paneTree.closePane(panes[panes.length - 1]);
    });
    await win.waitForTimeout(400);
    st = await dump();
    await human.assert(st.count === 1, '关格后应收缩回单格');
    await human.assert(st.tabsEach[0] >= 1, '标签应合并回主格不丢失');
  });
}
