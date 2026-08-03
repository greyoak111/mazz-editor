// tests/e2e/scenes28.mjs —— 波次三十七「mazzslide v2 画布编辑层」实证批
// 六类型渲染 / 工具加建拖框 / 拖拽移动+磁吸 / resize 手柄 / 选框多选+Delete / 等距分布
export async function scenes28({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 0：v2 画布就绪 ====================
  await evaluate(() => window.MazzCommands?.execute('file.newSlide'));
  await human.until(() => window.__activeSlideCtl?.isV2 === true && !!document.querySelector('.sl-v2-stage2 .sl-v2-svg'), { timeout: 9000, msg: 'v2 画布就绪' });
  await wait(400);

  // ==================== 1：六类型渲染 ====================
  await scenario('演示画布·六类型渲染', async () => {
    const r = await evaluate(async () => {
      const ctl = window.__activeSlideCtl;
      const m = await import('./modules/slide/doc.js');
      const sl = ctl.curSlide();
      const n0 = sl.items.length;
      sl.items.push(
        m.createItem('image', { left: 70, top: 55, width: 22, height: 25 }),
        m.createItem('shape', { left: 5, top: 60, width: 14, height: 18, shape: 'diamond' }),
        m.createItem('table', { left: 25, top: 62, width: 30, height: 22, table: { rows: [{ cells: [{ text: '表头' }, { text: 'B' }] }, { cells: [{ text: '1' }, { text: '2' }] }] } }),
        m.createItem('timer', { left: 60, top: 84, width: 16, height: 10, timer: { kind: 'countdown', target: 300 } }),
        m.createItem('variable', { left: 82, top: 88, width: 14, height: 6, variable: { key: 'page' } }),
      );
      ctl.renderV2All();
      return { n0, n1: sl.items.length, domN: document.querySelectorAll('.sl-v2-viewport .sl-item').length, timerTxt: document.querySelector('.sl-timer-text')?.textContent };
    });
    human.log('渲染:', JSON.stringify(r));
    await human.assert(r.n1 === r.n0 + 5, `模型必须+5（${r.n0}→${r.n1}）`);
    await human.assert(r.domN === r.n1, `DOM 必须全渲染（${r.domN}/${r.n1}）`);
    await human.assert(r.timerTxt === '05:00', `计时器必须格式化（${r.timerTxt}）`);
  });

  // ==================== 2：工具加建（ghost 拖框出对象） ====================
  await scenario('演示画布·工具加建拖框', async () => {
    const r = await evaluate(async () => {
      const ctl = window.__activeSlideCtl;
      const n0 = ctl.curSlide().items.length;
      // 点工具钮（事件走真实 DOM 点击——工具条 pointerdown 拦截不得误生对象）
      const btn = document.querySelector('.sl-v2-tools [data-t="shape"]');
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      const toolAfterClick = ctl._addTool;
      const nAfterClick = ctl.curSlide().items.length;
      // 画布拖框：设计坐标 (400,500)→(700,700)
      const svg = document.querySelector('.sl-v2-stage2 .sl-v2-svg');
      const rc = svg.getBoundingClientRect();
      const c = (x, y) => ({ clientX: rc.left + x / 1920 * rc.width, clientY: rc.top + y / 1080 * rc.height });
      const stage = document.querySelector('.sl-v2-stage2');
      stage.dispatchEvent(new PointerEvent('pointerdown', { ...c(400, 500), button: 0, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { ...c(700, 700), bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { ...c(700, 700), bubbles: true }));
      const items = ctl.curSlide().items;
      const it = items[items.length - 1];
      return { toolAfterClick, nAfterClick, n0, n1: items.length, tool: ctl._addTool, it: it ? { type: it.type, left: it.left, top: it.top, width: it.width, height: it.height } : null, sel: ctl.selItem === it?.id };
    });
    human.log('加建:', JSON.stringify(r));
    await human.assert(r.toolAfterClick === 'shape', `工具必须上膛（${r.toolAfterClick}）`);
    await human.assert(r.nAfterClick === r.n0, `点工具钮不得误生对象（${r.nAfterClick}≠${r.n0}——工具条拦截实锤）`);
    await human.assert(r.n1 === r.n0 + 1, `拖框必须+1（${r.n0}→${r.n1}）`);
    await human.assert(r.tool === null, `完工必须收枪（tool=${r.tool}）`);
    await human.assert(r.it?.type === 'shape', `类型必须对（${r.it?.type}）`);
    await human.assert(Math.abs(r.it.left - 20.83) < 0.8 && Math.abs(r.it.top - 46.3) < 0.8, `落点必须百分比锚定（${r.it?.left},${r.it?.top}）`);
    await human.assert(Math.abs(r.it.width - 15.63) < 0.8 && Math.abs(r.it.height - 18.52) < 0.8, `框体必须百分比锚定（${r.it?.width}×${r.it?.height}）`);
    await human.assert(r.sel, '新对象必须选中');
  });

  // ==================== 3：拖拽移动+磁吸 ====================
  await scenario('演示画布·拖拽移动磁吸', async () => {
    const r = await evaluate(async () => {
      const ctl = window.__activeSlideCtl;
      const items = ctl.curSlide().items;
      const it = items[items.length - 1]; // 场景 2 加建的 shape
      const L0 = it.left, T0 = it.top;
      const px = (v) => v / 100 * 1920, py = (v) => v / 100 * 1080;
      const svg = document.querySelector('.sl-v2-stage2 .sl-v2-svg');
      const rc = svg.getBoundingClientRect();
      const c = (x, y) => ({ clientX: rc.left + x / 1920 * rc.width, clientY: rc.top + y / 1080 * rc.height });
      const stage = document.querySelector('.sl-v2-stage2');
      // 抓 Item 左上角内侧 +2px（offX/offY=2），拖到设计 (5,130) → nx=3 在画布左缘 6px 阈值内必须吸到 0；落点选在无人区（上方横带）防松手避让推挤
      stage.dispatchEvent(new PointerEvent('pointerdown', { ...c(px(L0) + 2, py(T0) + 2), button: 0, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { ...c(5, 130), bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { ...c(5, 130), bubbles: true }));
      return { L0, T0, L1: it.left, T1: it.top };
    });
    human.log('拖拽:', JSON.stringify(r));
    await human.assert(Math.abs(r.L1) < 0.4, `左缘磁吸必须吸到 0（left=${r.L1}——snapItem 画布边缘线实证）`);
    await human.assert(Math.abs(r.T1 - 11.85) < 1.2, `纵移必须跟手（top=${r.T1}）`);
    await human.assert(r.L1 !== r.L0, `必须真动过（${r.L0}→${r.L1}）`);
  });

  // ==================== 4：resize 手柄 ====================
  await scenario('演示画布·resize手柄', async () => {
    const r = await evaluate(async () => {
      const ctl = window.__activeSlideCtl;
      const items = ctl.curSlide().items;
      const it = items[items.length - 1];
      const W0 = it.width, H0 = it.height;
      const px = (v) => v / 100 * 1920, py = (v) => v / 100 * 1080;
      const svg = document.querySelector('.sl-v2-stage2 .sl-v2-svg');
      const rc = svg.getBoundingClientRect();
      const c = (x, y) => ({ clientX: rc.left + x / 1920 * rc.width, clientY: rc.top + y / 1080 * rc.height });
      const stage = document.querySelector('.sl-v2-stage2');
      // 先点中心选中（selItem=it.id 是 resize 命中的前提）
      stage.dispatchEvent(new PointerEvent('pointerdown', { ...c(px(it.left + it.width / 2), py(it.top + it.height / 2)), button: 0, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      const selOk = ctl.selItem === it.id;
      // 压右下角（容差 18px 逻辑面内）拖 (+96,+54)
      const bx = px(it.left + it.width), by = py(it.top + it.height);
      stage.dispatchEvent(new PointerEvent('pointerdown', { ...c(bx - 2, by - 2), button: 0, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { ...c(bx + 96, by + 54), bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { ...c(bx + 96, by + 54), bubbles: true }));
      return { selOk, W0, H0, W1: it.width, H1: it.height };
    });
    human.log('resize:', JSON.stringify(r));
    await human.assert(r.selOk, '选中是 resize 前提');
    await human.assert(Math.abs(r.W1 - r.W0 - 5) < 0.9, `宽必须+5%（${r.W0}→${r.W1}）`);
    await human.assert(Math.abs(r.H1 - r.H0 - 5) < 0.9, `高必须+5%（${r.H0}→${r.H1}）`);
  });

  // ==================== 5：选框多选+Delete ====================
  await scenario('演示画布·选框多选删除', async () => {
    const r = await evaluate(async () => {
      const ctl = window.__activeSlideCtl;
      const n0 = ctl.curSlide().items.length;
      const svg = document.querySelector('.sl-v2-stage2 .sl-v2-svg');
      const rc = svg.getBoundingClientRect();
      const c = (x, y) => ({ clientX: rc.left + x / 1920 * rc.width, clientY: rc.top + y / 1080 * rc.height });
      const stage = document.querySelector('.sl-v2-stage2');
      // 真空白处起框（设计 10,60——顶部横带无任何对象）→ 罩住全画布
      stage.dispatchEvent(new PointerEvent('pointerdown', { ...c(10, 60), button: 0, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { ...c(1900, 1050), bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { ...c(1900, 1050), bubbles: true }));
      const selN = ctl.multiSel?.size || 0;
      // Delete 删除
      const st2 = document.querySelector('.sl-v2-stage2');
      st2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      const n1 = ctl.curSlide().items.length;
      return { n0, selN, n1, cleared: (ctl.multiSel?.size || 0) === 0 };
    });
    human.log('选框:', JSON.stringify(r));
    await human.assert(r.selN >= 2, `选框必须罩住多枚（${r.selN}）`);
    await human.assert(r.n1 === r.n0 - r.selN, `Delete 必须删掉所选（${r.n0}-${r.selN}→${r.n1}）`);
    await human.assert(r.cleared, '删除后选集必须清');
  });

  // ==================== 6：等距分布 ====================
  await scenario('演示画布·等距分布', async () => {
    const r = await evaluate(async () => {
      const ctl = window.__activeSlideCtl;
      const m = await import('./modules/slide/doc.js');
      const cv = await import('./modules/slide/canvas.js');
      const sl = ctl.curSlide();
      const a = m.createItem('shape', { left: 5, top: 20, width: 10, height: 10 });
      const b = m.createItem('shape', { left: 30, top: 20, width: 10, height: 10 });
      const c2 = m.createItem('shape', { left: 90, top: 20, width: 10, height: 10 });
      sl.items.push(a, b, c2);
      const ids = new Set([a.id, b.id, c2.id]);
      const ok = cv.distributeItems(sl, ids, 'x');
      ctl.renderV2All();
      return { ok, al: a.left, bl: b.left, cl: c2.left };
    });
    human.log('等距:', JSON.stringify(r));
    await human.assert(r.ok, '≥3 必须可分布');
    await human.assert(Math.abs(r.al - 5) < 0.01 && Math.abs(r.cl - 90) < 0.01, '首尾必须不动');
    await human.assert(Math.abs(r.bl - 47.5) < 0.01, `中间必须均分（left=${r.bl}，期望 47.5=5+10+gap32.5）`);
    // 收尾：清场防波及后续批
    await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      ctl.curSlide().items = ctl.curSlide().items.slice(0, 1);
      ctl.renderV2All();
    });
  });
}
