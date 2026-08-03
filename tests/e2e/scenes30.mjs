// tests/e2e/scenes30.mjs —— 波次三十九「mazzslide v2 放映引擎」实证批
// 起手与状态机 / 四切换+禁用帧跳过 / reveal 逐点揭示 / 帧动作三件 / 演讲者视图 / Esc rollback / 编辑器 reveal UI
export async function scenes30({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const key = (k) => evaluate((k2) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k2, bubbles: true })), k);

  // ==================== 0：造四帧档（F1 fade/F2 slide+reveal+timer+image/F3 禁用/F4 zoom） ====================
  await evaluate(() => window.MazzCommands?.execute('file.newSlide'));
  await human.until(() => window.__activeSlideCtl?.isV2 === true && !!document.querySelector('.sl-v2-stage2 .sl-v2-svg'), { timeout: 9000, msg: 'v2 就绪' });
  await evaluate(async () => {
    const ctl = window.__activeSlideCtl;
    const m = await import('./modules/slide/doc.js');
    const doc = ctl.doc2;
    const F = doc.layouts.main.frames;
    // F2：reveal 两枚+计时器+图片（clearMedia 靶子）
    const s2 = m.createSlide(null, { notes: '第二帧讲三点', items: [
      m.createItem('text', { text: '揭示一', left: 8, top: 12, width: 30, height: 12, reveal: { mode: 'click', order: 1 } }),
      m.createItem('text', { text: '揭示二', left: 8, top: 30, width: 30, height: 12, reveal: { mode: 'click', order: 2 } }),
      m.createItem('text', { text: '随帧即现', left: 8, top: 48, width: 30, height: 12 }),
      m.createItem('image', { left: 55, top: 12, width: 30, height: 30, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }),
      m.createItem('timer', { left: 55, top: 55, width: 20, height: 12, timer: { kind: 'countdown', target: 300 } }),
    ] });
    doc.slides[s2.id] = s2;
    F.push(m.createFrame(s2.id, { transition: 'slide' }));
    // F3：禁用（跳过靶子）
    const s3 = m.createSlide(null, { items: [m.createItem('text', { text: '禁用帧', left: 10, top: 40, width: 60, height: 14 })] });
    doc.slides[s3.id] = s3;
    F.push(m.createFrame(s3.id, { disabled: true }));
    // F4：zoom
    const s4 = m.createSlide(null, { items: [m.createItem('text', { text: '末帧', left: 10, top: 40, width: 60, height: 14 })] });
    doc.slides[s4.id] = s4;
    F.push(m.createFrame(s4.id, { transition: 'zoom' }));
    ctl.curSlideId = doc.layouts.main.frames[0].slideId;
    ctl.renderV2All();
    window.__t = { s2: s2.id, s3: s3.id, s4: s4.id };
  });
  await wait(300);

  // ==================== 1：起手与状态机 ====================
  await scenario('演示放映·起手状态机', async () => {
    await evaluate(() => window.MazzCommands?.execute('slide.present'));
    await wait(300);
    const r = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      const p = ctl._presenter;
      return {
        status: ctl.slStatus, overlay: !!document.querySelector('.sl-present'),
        pageno: document.querySelector('.sl-pageno')?.textContent,
        layers: document.querySelectorAll('.sl-pv2-layer').length,
        items: document.querySelectorAll('.sl-pv2-layer .sl-item').length,
        fi: p?.fi, hook: !!p,
        again: (() => { window.MazzCommands?.execute('slide.present'); return document.querySelectorAll('.sl-present').length; })(),
      };
    });
    human.log('起手:', JSON.stringify(r));
    await human.assert(r.status === 'present' && r.overlay, 'present 态+遮罩必须起');
    await human.assert(r.pageno === '1 / 3', `禁用帧不计数（${r.pageno}）`);
    await human.assert(r.layers === 1 && r.items >= 2, `首帧必须渲染（层${r.layers}/对象${r.items}）`);
    await human.assert(r.fi === 0 && r.hook, '必须锚当前帧且钩子在上');
    await human.assert(r.again === 1, `重复放映必须幂等（${r.again} 层遮罩）`);
  });

  // ==================== 2：四切换+禁用帧跳过 ====================
  await scenario('演示放映·四切换禁用跳过', async () => {
    // slide 切（F1→F2）：动画中双层，终了单层
    await key('ArrowRight');
    const mid = await evaluate(() => ({ layers: document.querySelectorAll('.sl-pv2-layer').length, fi: window.__activeSlideCtl._presenter.fi, tf: document.querySelector('.sl-pv2-layer:last-child')?.style.transform }));
    await wait(600);
    const end = await evaluate(() => ({ layers: document.querySelectorAll('.sl-pv2-layer').length, pageno: document.querySelector('.sl-pageno')?.textContent, tf: document.querySelector('.sl-pv2-layer:last-child')?.style.transform }));
    human.log('slide 切:', JSON.stringify({ mid, end }));
    await human.assert(mid.layers === 2 && mid.fi === 1, `动画中必须双层（${mid.layers}）`);
    await human.assert(mid.tf?.includes('translateX'), `平移镜头必须动 transform（${mid.tf}）`);
    await human.assert(end.layers === 1 && end.pageno === '2 / 3', `终了必须单层落点干净（${end.layers}）`);
    // F2 有揭示——连按把揭示走完后翻 F4（跳过禁用 F3，zoom 切）
    for (let i = 0; i < 3; i++) await key('ArrowRight');
    const r4 = await evaluate(() => ({ fi: window.__activeSlideCtl._presenter.fi, layers: document.querySelectorAll('.sl-pv2-layer').length }));
    await wait(650);
    const r4b = await evaluate(() => ({ layers: document.querySelectorAll('.sl-pv2-layer').length, pageno: document.querySelector('.sl-pageno')?.textContent }));
    human.log('zoom 切:', JSON.stringify({ r4, r4b }));
    await human.assert(r4.fi === 3, `禁用帧必须跳过（fi=${r4.fi}，直达 F4）`);
    await human.assert(r4.layers === 2 && r4b.layers === 1 && r4b.pageno === '3 / 3', 'zoom 切必须同样双层起单层落');
    // fade 回切（F4→F2 反向，一跳）
    await evaluate(() => { window.__activeSlideCtl.doc2.layouts.main.frames[1].transition = 'fade'; });
    await key('ArrowLeft');
    await wait(600);
    const rb = await evaluate(() => ({ fi: window.__activeSlideCtl._presenter.fi, layers: document.querySelectorAll('.sl-pv2-layer').length }));
    await human.assert(rb.fi === 1 && rb.layers === 1, `fade 回切必须落 F2（${JSON.stringify(rb)}）`);
    // none 直切（F2→F1）
    await evaluate(() => { window.__activeSlideCtl.doc2.layouts.main.frames[0].transition = 'none'; });
    await key('ArrowLeft');
    const rn = await evaluate(() => ({ fi: window.__activeSlideCtl._presenter.fi, layers: document.querySelectorAll('.sl-pv2-layer').length }));
    await human.assert(rn.fi === 0 && rn.layers === 1, `直切必须瞬时单层（${JSON.stringify(rn)}）`);
  });

  // ==================== 3：reveal 逐点揭示 ====================
  await scenario('演示放映·reveal逐点揭示', async () => {
    await key('ArrowRight'); // F1→F2（fade 已改）
    await wait(600);
    const r0 = await evaluate(() => {
      const p = window.__activeSlideCtl._presenter;
      const sl = p.doc.slides[p.frames[p.fi].slideId];
      const ops = [...document.querySelectorAll('.sl-pv2-layer:last-child .sl-item')].map(g => ({ id: g.dataset.id, op: g.style.opacity }));
      const byText = sl.items.map(it => ({ t: it.lines?.[0]?.text || it.type, order: it.reveal?.order | 0, op: ops.find(o => o.id === it.id)?.op }));
      return { fi: p.fi, byText };
    });
    human.log('揭示起手:', JSON.stringify(r0));
    await human.assert(r0.fi === 1, '必须在 F2');
    const get = (t) => r0.byText.find(x => x.t === t);
    await human.assert(get('揭示一')?.op === '0' && get('揭示二')?.op === '0', 'reveal 对象起手必须隐身');
    await human.assert(get('随帧即现')?.op === '1', '无 order 必须随帧即现');
    // step1 → 揭示一显
    await key('ArrowRight');
    const r1 = await evaluate(() => {
      const p = window.__activeSlideCtl._presenter;
      const sl = p.doc.slides[p.frames[p.fi].slideId];
      const it = sl.items.find(x => x.lines?.[0]?.text === '揭示一');
      return { fi: p.fi, op: document.querySelector(`[data-id="${it.id}"]`)?.style.opacity, rn: p.revealN };
    });
    await human.assert(r1.fi === 1 && r1.op === '1' && r1.rn === 1, `第一序必须显形不翻帧（${JSON.stringify(r1)}）`);
    // step2 → 揭示二显；step3 → 翻 F4
    await key('ArrowRight');
    await key('ArrowRight');
    const r3 = await evaluate(() => ({ fi: window.__activeSlideCtl._presenter.fi }));
    await human.assert(r3.fi === 3, `揭完必须翻帧（fi=${r3.fi}——先揭后翻实锤）`);
    await key('ArrowLeft'); await wait(600); // 回 F2 备用（下一场景）
    await key('ArrowLeft'); await wait(600); // 回 F1
  });

  // ==================== 4：帧动作三件 ====================
  await scenario('演示放映·帧动作三件', async () => {
    // nextAfter=1s 自动推进
    await evaluate(() => { window.__activeSlideCtl.doc2.layouts.main.frames[0].nextAfter = 1; });
    await key('Home'); // 回 F1 重置计时
    await wait(1350);
    const ra = await evaluate(() => ({ fi: window.__activeSlideCtl._presenter.fi }));
    await human.assert(ra.fi === 1, `到时必须自动翻帧（fi=${ra.fi}）`);
    await evaluate(() => { window.__activeSlideCtl.doc2.layouts.main.frames[0].nextAfter = 0; });
    // clearMedia：F2 图片必须隐
    await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      ctl.doc2.layouts.main.frames[1].actions = { clearMedia: true, stopTimer: true };
      ctl._presenter.go(1, { fx: 'none' });
    });
    const rc = await evaluate(() => {
      const p = window.__activeSlideCtl._presenter;
      const sl = p.doc.slides[p.frames[p.fi].slideId];
      const img = sl.items.find(x => x.type === 'image');
      const tim = sl.items.find(x => x.type === 'timer');
      return {
        imgDisp: document.querySelector(`[data-id="${img.id}"]`)?.style.display,
        timTxt: document.querySelector(`[data-id="${tim.id}"] .sl-timer-text`)?.textContent,
      };
    });
    await human.assert(rc.imgDisp === 'none', `clearMedia 必须隐媒体图（${rc.imgDisp}）`);
    await human.assert(rc.timTxt === '05:00', `stopTimer 必须冻结计时（${rc.timTxt}）`);
    await wait(1200);
    const rc2 = await evaluate(() => {
      const p = window.__activeSlideCtl._presenter;
      const sl = p.doc.slides[p.frames[p.fi].slideId];
      const tim = sl.items.find(x => x.type === 'timer');
      return document.querySelector(`[data-id="${tim.id}"] .sl-timer-text`)?.textContent;
    });
    await human.assert(rc2 === '05:00', `冻结必须不走字（${rc2}）`);
    // 撤 stopTimer → 走字
    await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      ctl.doc2.layouts.main.frames[1].actions = { clearMedia: true };
      ctl._presenter.go(1, { fx: 'none' });
    });
    await wait(1300);
    const rt = await evaluate(() => {
      const p = window.__activeSlideCtl._presenter;
      const sl = p.doc.slides[p.frames[p.fi].slideId];
      const tim = sl.items.find(x => x.type === 'timer');
      return document.querySelector(`[data-id="${tim.id}"] .sl-timer-text`)?.textContent;
    });
    human.log('计时走字:', rt);
    await human.assert(rt && rt !== '05:00', `撤冻结必须走字（${rt}）`);
  });

  // ==================== 5：演讲者视图 ====================
  await scenario('演示放映·演讲者视图', async () => {
    await key('Escape');
    await wait(200);
    await evaluate(() => window.MazzCommands?.execute('slide.presentPv'));
    await wait(400);
    const r = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      return {
        side: document.querySelector('.sl-pv-side')?.style.display !== 'none',
        next: !!document.querySelector('.sl-pv2-next .sl-pv2-stage.mini svg'),
        notes: document.querySelector('.sl-pv-notes-body')?.textContent,
        clock: document.querySelector('.sl-clock')?.textContent,
        status: ctl.slStatus,
      };
    });
    human.log('演讲者:', JSON.stringify(r));
    await human.assert(r.side, '侧栏必须开');
    await human.assert(r.next, '下一帧预览必须渲染');
    await human.assert(r.clock?.match(/^\d{2}:\d{2}$/), `计时必须走（${r.clock}）`);
    // 翻到 F2（备注+揭示进度）
    await key('ArrowRight');
    await wait(600);
    const r2 = await evaluate(() => ({
      notes: document.querySelector('.sl-pv-notes-body')?.textContent,
      reveal: document.querySelector('.sl-pv2-reveal')?.textContent,
    }));
    await human.assert(r2.notes === '第二帧讲三点', `备注必须随帧（${r2.notes}）`);
    await human.assert(r2.reveal === '揭示 0/2', `揭示进度必须起步（${r2.reveal}）`);
    await key('ArrowRight');
    const r3 = await evaluate(() => document.querySelector('.sl-pv2-reveal')?.textContent);
    await human.assert(r3 === '揭示 1/2', `揭示进度必须跟进（${r3}）`);
  });

  // ==================== 6：Esc rollback ====================
  await scenario('演示放映·Esc还原', async () => {
    await key('Escape');
    await wait(250);
    const r = await evaluate(() => ({
      status: window.__activeSlideCtl.slStatus,
      overlay: !!document.querySelector('.sl-present'),
      hook: !!window.__activeSlideCtl._presenter,
      editor: !!document.querySelector('.sl-v2-stage2 .sl-v2-svg'),
    }));
    human.log('还原:', JSON.stringify(r));
    await human.assert(r.status === 'normal' && !r.overlay && !r.hook, 'rollback 必须三清（态/罩/钩）');
    await human.assert(r.editor, '编辑器必须还原');
  });

  // ==================== 7：编辑器 reveal UI ====================
  await scenario('演示放映·编辑器reveal右键', async () => {
    const r = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      // 切到 F2 页，对「随帧即现」右键
      const s2id = window.__t.s2;
      ctl.curSlideId = s2id; ctl.renderV2All();
      const sl = ctl.curSlide();
      const it = sl.items.find(x => x.lines?.[0]?.text === '随帧即现');
      ctl.selItem = it.id;
      // 直接调右键菜单同函数（showItemMenu 内部件——经 contextmenu 事件派发）
      const svg = document.querySelector('.sl-v2-stage2 .sl-v2-svg');
      const rc = svg.getBoundingClientRect();
      const c = (x, y) => ({ clientX: rc.left + x / 1920 * rc.width, clientY: rc.top + y / 1080 * rc.height });
      const stage = document.querySelector('.sl-v2-stage2');
      stage.dispatchEvent(new MouseEvent('contextmenu', { ...c((it.left + 2) / 100 * 1920, (it.top + 2) / 100 * 1080), bubbles: true }));
      const labels = [...document.querySelectorAll('.mazz-menu .mazz-menu-item')].map(e => e.textContent);
      const join = labels.find(t => t.includes('加入揭示序列'));
      if (join) [...document.querySelectorAll('.mazz-menu .mazz-menu-item')].find(e => e.textContent === join).click();
      const after = it.reveal;
      // 样式栏标
      const bar = document.querySelector('.sl-v2-tools')?.textContent;
      return { labels, after, bar };
    });
    human.log('reveal UI:', JSON.stringify(r));
    await human.assert(r.labels.some(t => t.includes('加入揭示序列')), `右键必须有揭示项（${r.labels.join('|')}）`);
    await human.assert(r.after?.order === 3, `入列必须 max+1（order=${r.after?.order}——已有 1/2 占序）`);
    await human.assert(r.bar?.includes('揭示#3'), `样式栏必须亮揭示标（${r.bar}）`);
    // 移出
    const r2 = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      const sl = ctl.curSlide();
      const it = sl.items.find(x => x.lines?.[0]?.text === '随帧即现');
      const svg = document.querySelector('.sl-v2-stage2 .sl-v2-svg');
      const rc = svg.getBoundingClientRect();
      const stage = document.querySelector('.sl-v2-stage2');
      stage.dispatchEvent(new MouseEvent('contextmenu', { clientX: rc.left + (it.left + 2) / 100 * rc.width, clientY: rc.top + (it.top + 2) / 100 * rc.height, bubbles: true }));
      const mi = [...document.querySelectorAll('.mazz-menu .mazz-menu-item')].find(e => e.textContent.includes('移出揭示序列'));
      const label = mi?.textContent;
      mi?.click();
      return { label, after: it.reveal };
    });
    await human.assert(r2.label?.includes('#3') && r2.after === null, `移出必须归 null（${JSON.stringify(r2)}）`);
    // 收尾：菜单残骸清
    await evaluate(() => document.querySelector('.mazz-menu')?.remove());
  });
}
