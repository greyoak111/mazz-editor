// tests/e2e/scenes27.mjs —— 波次三十六「mazzslide v2 骨架」实证批
// v2 起手式与模型 / v1 大纲迁移进 v2 面 / 页侧栏增删排序 / 百分比换算 / 保存 v2 序列化
export async function scenes27({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 1：v2 起手式与文档模型 ====================
  await scenario('演示·v2起手式·物料编排分离', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newSlide'));
    await human.until(() => window.__activeSlideCtl?.isV2 === true, { timeout: 9000, msg: 'v2 演示就绪' });
    await wait(600);
    const r = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      const doc = ctl?.doc2;
      const frames = doc?.layouts?.main?.frames || [];
      const slides = doc?.slides || {};
      const first = slides[frames[0]?.slideId];
      return {
        v: doc?.v, design: doc?.design, slideN: Object.keys(slides).length, frameN: frames.length,
        firstItemType: first?.items?.[0]?.type, firstPct: first?.items?.[0]?.left,
        source: first?.items?.[0]?.source, theme: doc?.theme,
        sideShown: !!document.querySelector('.sl-v2') && getComputedStyle(document.querySelector('.sl-v2')).display !== 'none',
      };
    });
    human.log('v2 起手:', JSON.stringify(r));
    await human.assert(r.v === 2 && r.design?.w === 1920 && r.design?.h === 1080, `v2 文档与设计锚（${JSON.stringify(r.design)}）`);
    await human.assert(r.slideN >= 1 && r.frameN >= 1, '物料与编排必须分离在列');
    await human.assert(r.firstItemType === 'text' && typeof r.firstPct === 'number', 'Item 必须百分比坐标');
    await human.assert(r.source === null, 'Item.source 桥接预留必须为 null（维持现状）');
    await human.assert(r.sideShown, 'v2 编辑面必须显示');
    // 页侧栏在
    const side = await evaluate(() => ({ head: !!document.querySelector('.sl-v2-side-head'), pages: document.querySelectorAll('.sl-v2-page').length }));
    await human.assert(side.head && side.pages >= 1, `页侧栏必须在（${JSON.stringify(side)}）`);
  });

  // ==================== 2：页侧栏增删排序 ====================
  await scenario('演示·页侧栏·增删排序', async () => {
    const n0 = await evaluate(() => document.querySelectorAll('.sl-v2-page').length);
    // 新建页
    await evaluate(() => { document.querySelector('[data-a="add"]')?.click(); });
    await wait(300);
    const n1 = await evaluate(() => document.querySelectorAll('.sl-v2-page').length);
    await human.assert(n1 === n0 + 1, `新建必须+1（${n0}→${n1}）`);
    // 排序：最后一页上移一位
    const order = await evaluate(() => {
      const pages = [...document.querySelectorAll('.sl-v2-page')];
      const last = pages[pages.length - 1];
      const t0 = last.querySelector('.t')?.textContent;
      last.querySelector('[data-a="up"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { t0, list: [...document.querySelectorAll('.sl-v2-page .t')].map(e => e.textContent) };
    });
    await human.assert(order.list[order.list.length - 2] === order.t0, `上移必须换位（${JSON.stringify(order.list)}）`);
    // 删除页
    await evaluate(() => {
      const pages = [...document.querySelectorAll('.sl-v2-page')];
      pages[pages.length - 1].querySelector('[data-a="del"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await wait(200);
    const n2 = await evaluate(() => document.querySelectorAll('.sl-v2-page').length);
    await human.assert(n2 === n1 - 1, `删除必须-1（${n1}→${n2}）`);
    // 保存 v2 序列化（走模块契约 getContent——经 __activeSlideCtl 代理调 def（真实路径））
    const savedStr1 = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      if (!ctl?.isV2) return null;
      // 与模块契约 getContent 同款序列化（serializeDoc(ctl.doc2)）
      try {
        const m = window.__slideDocMod || null;
        return JSON.stringify(ctl.doc2);
      } catch { return null; }
    });
    const savedStr2 = await evaluate(() => {
      const reg = window.MazzModulesReal || window.MazzModules;
      for (const [, inst] of (reg?.instances || new Map())) {
        if (inst?.name === 'slide' && inst?.def?.getContent) {
          try { return inst.def.getContent(inst.state); } catch { return null; }
        }
      }
      return null;
    });
    const parsed = savedStr2 ? JSON.parse(savedStr2) : null;
    human.log('保存:', JSON.stringify({ v: parsed?.v, slideN: parsed?.slides && Object.keys(parsed.slides).length }));
    await human.assert(parsed?.v === 2 && Object.keys(parsed.slides).length >= 1, `getContent 必须出 v2 序列化（${parsed?.v}）`);
  });

  // ==================== 3：v1 大纲迁移进 v2 面 ====================
  await scenario('演示·v1大纲·lazy迁移', async () => {
    const md = '# 迁移章节页\n## 小节甲\n- 要点一\n- 要点二\n::: notes\n这是讲者备注\n---\n# 第二页\n- 要点丙';
    // 直接 setContent v1 大纲（应 lazy 迁移进 v2 面）
    const r = await evaluate(async ([text]) => {
      const reg = window.MazzModulesReal || window.MazzModules;
      const ctl = window.__activeSlideCtl;
      const reg2 = window.MazzModulesReal || window.MazzModules;
      let inst = null;
      for (const [, x] of (reg2?.instances || new Map())) { if (x?.name === 'slide') { inst = x; break; } }
      inst?.def?.setContent?.(text, inst.state);
      await new Promise(r2 => setTimeout(r2, 500));
      const doc = ctl.doc2;
      const frames = doc?.layouts?.main?.frames || [];
      const s1 = doc?.slides?.[frames[0]?.slideId];
      return {
        isV2: !!ctl.isV2, slideN: Object.keys(doc?.slides || {}).length, frameN: frames.length,
        s1Items: s1?.items?.map(i => i.type + (i.list ? ':' + i.list.items.length : '')),
        s1Notes: s1?.notes, title: s1?.items?.[0]?.lines?.[0]?.text,
      };
    }, [md]);
    human.log('迁移:', JSON.stringify(r));
    await human.assert(r.isV2 && r.slideN === 2 && r.frameN === 2, `v1 大纲必须迁移成 2 页 2 帧（${JSON.stringify(r)}）`);
    await human.assert(r.title === '迁移章节页', `标题必须还原（${r.title}）`);
    await human.assert(r.s1Notes === '这是讲者备注', `备注必须随迁（${r.s1Notes}）`);
    await human.assert(r.s1Items?.some(x => x.startsWith('text:')), '列表 Item 必须还原');
  });

  // ==================== 4：百分比换算锚 ====================
  await scenario('演示·百分比·分辨率无关', async () => {
    const r = await evaluate(async () => {
      const m = await import('./modules/slide/doc.js');
      const it = { left: 25, top: 50, width: 50, height: 25 };
      const at1080 = { x: m.pctToPx(it.left, 'x', 1920, 1080), y: m.pctToPx(it.top, 'y', 1920, 1080), w: m.pctToPx(it.width, 'w', 1920, 1080), h: m.pctToPx(it.height, 'h', 1920, 1080) };
      const at720 = { x: m.pctToPx(it.left, 'x', 1280, 720), y: m.pctToPx(it.top, 'y', 1280, 720) };
      const back = m.pxToPct(960, 'x');
      return { at1080, at720, back, design: m.DESIGN };
    });
    human.log('换算:', JSON.stringify(r));
    await human.assert(r.at1080.x === 480 && r.at1080.w === 960 && r.at1080.h === 270, `1080p 换算必须对（${JSON.stringify(r.at1080)}）`);
    await human.assert(r.at720.x === 320 && r.at720.y === 360, `720p 换算必须同比（${JSON.stringify(r.at720)}——分辨率无关实锤）`);
    await human.assert(r.back === 50, '往返必须还原');
  });
}
