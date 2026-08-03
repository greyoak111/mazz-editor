// tests/e2e/scenes25.mjs —— 混合画布+快捷键对调实证批
// Enter 确认/Alt+Enter 换行 / 钉坐标脱离布局 / 磁吸吸附 / 等距分布 / 图片便笺
export async function scenes25({ win, human, WS, scenario }) {
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
    ctl.doc.frames = []; ctl.doc.swimlanes = []; ctl.doc.notes = [];
    ctl.render();
    return true;
  });

  // ==================== 1：快捷键对调（Enter 确认 / Alt+Enter 换行） ====================
  await scenario('导图·快捷键·Enter确认Alt换行', async () => {
    await openMap();
    await seed();
    // 开编辑：直接 startEdit 等价路径（双击 A）
    await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const b = ctl.boxes.get('A');
      const g = document.querySelector('.mm-node[data-id="A"]');
      const rect = document.querySelector('.mm-canvas-wrap').getBoundingClientRect();
      g.dispatchEvent(new MouseEvent('dblclick', { clientX: rect.left + 100, clientY: rect.top + 60, bubbles: true }));
    });
    await wait(400);
    const ed = await evaluate(() => {
      const editor = document.querySelector('.mm-editor');
      return { editing: !!window.__activeMindmapCtl.editing, shown: editor && getComputedStyle(editor).display !== 'none' };
    });
    human.log('编辑开:', JSON.stringify(ed));
    await human.assert(ed.editing && ed.shown, '编辑应开');
    // 输入两行（Alt+Enter 组合键语法换行）→ Enter 确认
    await evaluate(() => {
      const editor = document.querySelector('.mm-editor');
      editor.focus();
      editor.value = '第一行';
    });
    await win.keyboard.press('Alt+Enter'); // 组合键语法（modifiers 数组在此环境不带 altKey 实锤）
    await evaluate(() => { const editor = document.querySelector('.mm-editor'); editor.value += '第二行'; });
    await win.keyboard.press('Enter');
    await wait(400);
    const r = await evaluate(() => ({
      text: window.__activeMindmapCtl.doc.roots[0].children[0].text,
      editing: window.__activeMindmapCtl.editing,
    }));
    human.log('对调:', JSON.stringify(r));
    await human.assert(r.text.includes('第一行') && r.text.includes('第二行'), `Alt+Enter 必须换行成两行（${JSON.stringify(r.text)}）`);
    await human.assert(r.text.includes('\n'), `两行之间必须有换行符（${JSON.stringify(r.text)}）`);
    await human.assert(r.editing == null, 'Enter 必须确认退出编辑');
  });

  // ==================== 2：钉坐标脱离布局 ====================
  await scenario('导图·钉坐标·脱离布局流', async () => {
    // 钉 A：记录钉前 box，钉后加子引发重排，A 位置应不动
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const b0 = { x: ctl.boxes.get('A').x, y: ctl.boxes.get('A').y };
      const A = ctl.doc.roots[0].children[0];
      A.pinned = true; A.fx = b0.x; A.fy = b0.y;
      ctl.render();
      // 大位移：B/C 下各加 6 子撑排
      for (const id of ['B', 'C']) {
        const n = ctl.doc.roots[0].children.find(c => c.id === id);
        for (let i = 0; i < 6; i++) n.children.push({ id: id + 'k' + i, text: id + '支' + i, collapsed: false, children: [] });
      }
      ctl.render();
      return { b0, b1: { x: ctl.boxes.get('A').x, y: ctl.boxes.get('A').y }, pin: !!document.querySelector('.mm-pin'), bB: { x: ctl.boxes.get('B').x, y: ctl.boxes.get('B').y } };
    });
    human.log('钉坐标:', JSON.stringify(r));
    await human.assert(r.pin, '图钉角标必须在');
    await human.assert(Math.abs(r.b1.x - r.b0.x) < 1 && Math.abs(r.b1.y - r.b0.y) < 1, `钉住节点必须不动（${JSON.stringify(r.b0)} vs ${JSON.stringify(r.b1)}——脱离布局流实锤）`);
    // 取消钉住回归布局流
    const un = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const A = ctl.doc.roots[0].children[0];
      A.pinned = false; delete A.fx; delete A.fy;
      ctl.render();
      return { fx: A.fx, fy: A.fy, pin: !!document.querySelector('.mm-pin') };
    });
    await human.assert(un.fx == null && !un.pin, '取消钉住必须清坐标回归布局流');
  });

  // ==================== 3：磁吸对齐线 ====================
  await scenario('导图·磁吸·拖动吸附', async () => {
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      // 拖 A 靠近 B 的中线（x 中线附近）
      const bA = ctl.boxes.get('A'), bB = ctl.boxes.get('B');
      const targetX = bB.x + bB.w / 2; // B 中线
      const rect = document.querySelector('.mm-canvas-wrap').getBoundingClientRect();
      const g = document.querySelector('.mm-node[data-id="A"]');
      const fromX = rect.left + (bA.x + bA.w / 2) * ctl.cam.k + ctl.cam.x, fromY = rect.top + (bA.y + bA.h / 2) * ctl.cam.k + ctl.cam.y;
      const toX = rect.left + (targetX - 4) * ctl.cam.k + ctl.cam.x; // 距中线 4px（阈值 8/k≈5.7 内必吸附）
      const toY = fromY;
      g.dispatchEvent(new PointerEvent('pointerdown', { clientX: fromX, clientY: fromY, button: 0, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: toX, clientY: toY, bubbles: true }));
      const snapLine = !!document.querySelector('.mm-snapline');
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return { snapLine, cleared: !document.querySelector('.mm-snapline') };
    });
    human.log('磁吸:', JSON.stringify(r));
    await human.assert(r.snapLine, '拖动吸附必须出对齐参考线');
    await human.assert(r.cleared, '松手必须清线');
  });

  // ==================== 4：等距分布 ====================
  await scenario('导图·等距·多选分布', async () => {
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      // 手动乱位三节点（offX/offY）
      for (const [id, ox, oy] of [['A', 0, 0], ['B', 260, 6], ['C', 60, -4]]) {
        const n = ctl.doc.roots[0].children.find(c => c.id === id);
        n.offX = ox; n.offY = oy;
      }
      ctl.render();
      ctl.multiSel = new Set(['A', 'B', 'C']);
      ctl.toolMode = 'select';
      // 直接调 distributeSel 等效路径（右键项同函数——经右键菜单验证存在性后调函数行为）
      return { has3: ctl.multiSel.size };
    });
    await human.assert(r.has3 === 3, '多选就位');
    // 右键菜单双轴项存在
    const menu = await evaluate(() => {
      const rect = document.querySelector('.mm-canvas-wrap').getBoundingClientRect();
      const wrap = document.querySelector('.mm-canvas-wrap');
      wrap.querySelector('.mm-svg').dispatchEvent(new MouseEvent('contextmenu', { clientX: rect.left + 30, clientY: rect.top + 30, bubbles: true, cancelable: true }));
      const m = document.querySelector('.mazz-menu');
      return { text: m?.textContent || '' };
    });
    await human.assert(menu.text.includes('水平等距分布') && menu.text.includes('垂直等距分布'), `右键必须有双轴等距项（${menu.text.slice(0, 60)}）`);
    // 点水平等距
    await evaluate(() => {
      const item = [...document.querySelectorAll('.mazz-menu-item')].find(e => /水平等距分布/.test(e.textContent));
      item?.click();
    });
    await wait(400);
    const dist = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const pos = (id) => { const b = ctl.boxes.get(id); return b.x + (b.node.offX || 0); }; // boxPos 同款（含 offX 才见手动位与等距结果——box.x 布局层恒定实锤）
      const xs = ['A', 'B', 'C'].map(pos).sort((a, b) => a - b);
      return { xs, gaps: [xs[1] - xs[0], xs[2] - xs[1]] };
    });
    human.log('等距:', JSON.stringify(dist));
    await human.assert(Math.abs(dist.gaps[0] - dist.gaps[1]) < 60, `等距分布必须均分（间距 ${dist.gaps.map(g => g.toFixed(0))}）`);
  });

  // ==================== 5：图片便笺 ====================
  await scenario('导图·图片便笺·共存', async () => {
    const r = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      const n = (function() {
        // createNote 等价（模型 createNote 带 image 位）
        return { id: 'note-img', text: '', x: 60, y: 60, w: 220, color: null, style: null, image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' };
      })();
      ctl.doc.notes.push(n);
      ctl.render();
      const g = document.querySelector('.mm-note[data-id="note-img"]');
      return { img: !!g?.querySelector('image'), imgTag: g?.querySelector('image')?.getAttribute('href')?.slice(0, 30) };
    });
    human.log('图片便笺:', JSON.stringify(r));
    await human.assert(r.img && r.imgTag?.startsWith('data:image/png'), `图片便笺必须渲染 image（${r.imgTag}）`);
  });
}
