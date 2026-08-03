// tests/e2e/scenes29.mjs —— 波次三十八「mazzslide v2 编排层」实证批
// 双视图切换 / 帧属性四件（transition/nextAfter/disabled/帧动作） / 页库复制入编排删物料 / 演讲者备注
export async function scenes29({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 0：v2 就绪 ====================
  await evaluate(() => window.MazzCommands?.execute('file.newSlide'));
  await human.until(() => window.__activeSlideCtl?.isV2 === true && !!document.querySelector('.sl-v2-side-head'), { timeout: 9000, msg: 'v2 就绪' });
  await wait(400);

  // ==================== 1：双视图切换 ====================
  await scenario('演示编排·物料放映序双视图', async () => {
    const r = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      const out = { def: ctl.sideView || 'sequence' };
      document.querySelector('[data-v="library"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      out.lib = ctl.sideView;
      out.libRows = document.querySelectorAll('.sl-v2-page').length;
      out.slideN = Object.keys(ctl.doc2.slides).length;
      document.querySelector('[data-v="sequence"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      out.seq = ctl.sideView;
      out.seqRows = document.querySelectorAll('.sl-v2-page').length;
      out.frameN = ctl.doc2.layouts.main.frames.length;
      out.headB = document.querySelector('.sl-v2-side-head b')?.textContent;
      return out;
    });
    human.log('双视图:', JSON.stringify(r));
    await human.assert(r.def === 'sequence', `默认必须是放映序（${r.def}——scenes27 兼容实锤）`);
    await human.assert(r.lib === 'library' && r.seq === 'sequence', '切换必须真换态');
    await human.assert(r.libRows === r.slideN, `页库必须列全物料（${r.libRows}/${r.slideN}）`);
    await human.assert(r.seqRows === r.frameN, `放映序必须列全帧（${r.seqRows}/${r.frameN}）`);
    await human.assert(/帧（\d+）/.test(r.headB), `放映序标题必须带帧数（${r.headB}）`);
  });

  // ==================== 2：帧属性四件 ====================
  await scenario('演示编排·帧属性面板四件', async () => {
    const r = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      const fr = ctl.doc2.layouts.main.frames[0];
      const out = { t0: fr.transition };
      // 切换 zoom
      document.querySelector('.sl-v2-props [data-tr="zoom"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      out.t1 = fr.transition;
      // 到时 8 秒
      const na = document.querySelector('.sl-v2-props .na');
      na.value = '8'; na.dispatchEvent(new Event('change', { bubbles: true }));
      out.na = fr.nextAfter;
      // 禁用
      const dis = document.querySelector('.sl-v2-props .dis');
      dis.checked = true; dis.dispatchEvent(new Event('change', { bubbles: true }));
      out.dis = fr.disabled;
      // 帧动作双勾
      const acm = document.querySelector('.sl-v2-props .acm');
      acm.checked = true; acm.dispatchEvent(new Event('change', { bubbles: true }));
      const act = document.querySelector('.sl-v2-props .act');
      act.checked = true; act.dispatchEvent(new Event('change', { bubbles: true }));
      out.act = fr.actions;
      // 行标记
      const row = document.querySelector('.sl-v2-page');
      out.mkTr = !!row.querySelector('.mk.tr');
      out.mkNa = row.querySelector('.mk.na')?.textContent;
      out.mkAc = !!row.querySelector('.mk.ac');
      out.mkDb = !!row.querySelector('.db');
      return out;
    });
    human.log('帧属性:', JSON.stringify(r));
    await human.assert(r.t0 === 'fade' && r.t1 === 'zoom', `切换必须改档（${r.t0}→${r.t1}）`);
    await human.assert(r.na === 8, `到时必须入档（${r.na}）`);
    await human.assert(r.dis === true, '禁用必须入档');
    await human.assert(r.act?.clearMedia === true && r.act?.stopTimer === true, `帧动作必须双入档（${JSON.stringify(r.act)}）`);
    await human.assert(r.mkTr && r.mkNa === '⏱8' && r.mkAc && r.mkDb, `行标记必须全亮（${JSON.stringify({ tr: r.mkTr, na: r.mkNa, ac: r.mkAc, db: r.mkDb })}）`);
    // 动作全撤 → null（不占档）
    const r2 = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      const fr = ctl.doc2.layouts.main.frames[0];
      const acm = document.querySelector('.sl-v2-props .acm');
      acm.checked = false; acm.dispatchEvent(new Event('change', { bubbles: true }));
      const act = document.querySelector('.sl-v2-props .act');
      act.checked = false; act.dispatchEvent(new Event('change', { bubbles: true }));
      const dis = document.querySelector('.sl-v2-props .dis');
      dis.checked = false; dis.dispatchEvent(new Event('change', { bubbles: true }));
      const na = document.querySelector('.sl-v2-props .na');
      na.value = '0'; na.dispatchEvent(new Event('change', { bubbles: true }));
      return { act: fr.actions, dis: fr.disabled, na: fr.nextAfter, mkGone: !document.querySelector('.sl-v2-page .mk.na') && !document.querySelector('.sl-v2-page .mk.ac') };
    });
    await human.assert(r2.act === null && r2.dis === false && r2.na === 0 && r2.mkGone, `撤勾必须归位（${JSON.stringify(r2)}——动作空归 null 不占档）`);
  });

  // ==================== 3：页库复制/入编排/删物料 ====================
  await scenario('演示编排·页库复制入编排删物料', async () => {
    const r = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      const doc = ctl.doc2;
      const out = {};
      document.querySelector('[data-v="library"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      out.s0 = Object.keys(doc.slides).length;
      out.f0 = doc.layouts.main.frames.length;
      // 复制首个物料
      document.querySelector('.sl-v2-page [data-a="dup"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      out.s1 = Object.keys(doc.slides).length;
      out.f1 = doc.layouts.main.frames.length; // 物料复制不得入编排
      const ids = Object.keys(doc.slides);
      const src = doc.slides[ids[0]], cp = doc.slides[ids[ids.length - 1]];
      out.newIds = cp.id !== src.id && cp.items.every((it, i) => it.id !== src.items[i]?.id);
      out.sameText = cp.items[0]?.lines?.[0]?.text === src.items[0]?.lines?.[0]?.text;
      return out;
    });
    human.log('页库复制:', JSON.stringify(r));
    await human.assert(r.s1 === r.s0 + 1, `物料必须+1（${r.s0}→${r.s1}）`);
    await human.assert(r.f1 === r.f0, `物料复制不得动编排（${r.f0}→${r.f1}）`);
    await human.assert(r.newIds, '克隆必须页与 Item 全换新 id');
    await human.assert(r.sameText, '克隆必须保内容');
    // 入编排 ⇥
    const r2 = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      const doc = ctl.doc2;
      const f0 = doc.layouts.main.frames.length;
      const rows = [...document.querySelectorAll('.sl-v2-page')];
      rows[rows.length - 1].querySelector('[data-a="enq"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { f0, f1: doc.layouts.main.frames.length, view: ctl.sideView, cur: ctl.curSlideId === doc.layouts.main.frames[doc.layouts.main.frames.length - 1].slideId };
    });
    await human.assert(r2.f1 === r2.f0 + 1 && r2.view === 'sequence' && r2.cur, `入编排必须追加并跳放映序选中（${JSON.stringify(r2)}）`);
    // 删物料：引用帧一并清
    const r3 = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      const doc = ctl.doc2;
      document.querySelector('[data-v="library"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const s0 = Object.keys(doc.slides).length, f0 = doc.layouts.main.frames.length;
      const rows = [...document.querySelectorAll('.sl-v2-page')];
      rows[rows.length - 1].querySelector('[data-a="del"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { s0, f0, s1: Object.keys(doc.slides).length, f1: doc.layouts.main.frames.length };
    });
    await human.assert(r3.s1 === r3.s0 - 1 && r3.f1 === r3.f0 - 1, `删物料必须连帧清（${JSON.stringify(r3)}）`);
  });

  // ==================== 4：演讲者备注 ====================
  await scenario('演示编排·演讲者备注', async () => {
    const r = await evaluate(async () => {
      const ctl = window.__activeSlideCtl;
      const ta = document.querySelector('.sl-v2-notes textarea');
      const out = { taThere: !!ta, dis0: ta.disabled };
      ta.value = '开场先致谢三分钟';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      out.n1 = ctl.curSlide().notes;
      out.focusKept = document.activeElement === ta;
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      out.mkNotes = !!document.querySelector('.sl-v2-page.on .nt');
      // 序列化往返备注必须在
      const str = JSON.stringify(ctl.doc2);
      out.roundtrip = JSON.parse(str).slides[ctl.curSlideId].notes;
      return out;
    });
    human.log('备注:', JSON.stringify(r));
    await human.assert(r.taThere && r.dis0 === false, '备注区必须在且可写');
    await human.assert(r.n1 === '开场先致谢三分钟', `input 必须即写物料层（${r.n1}）`);
    await human.assert(r.mkNotes, '失焦必须亮 ≡ 标');
    await human.assert(r.roundtrip === '开场先致谢三分钟', '序列化往返备注必须在');
  });
}
