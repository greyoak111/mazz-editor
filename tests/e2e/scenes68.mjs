// tests/e2e/scenes68.mjs —— 59c 实证批（高图滚动条复活/边缘自动滚/全局缩放50%裁剪零漂移）
import fs from 'fs';

export async function scenes68({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  // 高图：800×2500（编辑态必出纵向滚动条）；宽图对照
  fs.writeFileSync(WS + '/高塔.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2500"><rect width="800" height="1250" fill="#4a86e8"/><rect y="1250" width="800" height="1250" fill="#e84a3c"/><circle cx="400" cy="2300" r="120" fill="#f3f3f3"/></svg>`);

  // ==================== 1：编辑态滚动条复活 ====================
  await scenario('高图·编辑态纵向滚动条复活', async () => {
    await evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/高塔.svg');
    await wait(2600);
    await evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
    await wait(2200);
    const st = await evaluate(() => {
      const stage = document.querySelector('.ie-stage');
      const vw = document.querySelector('.ie-viewwrap');
      const cs = getComputedStyle(stage);
      return {
        scrollH: stage.scrollHeight, clientH: stage.clientHeight,
        vwH: Math.round(vw.getBoundingClientRect().height),
        viewH: Math.round(document.querySelector('.ie-view').getBoundingClientRect().height),
        overflowY: cs.overflowY,
      };
    });
    human.log('滚动:', JSON.stringify(st));
    await human.assert(st.vwH > 0 && Math.abs(st.vwH - st.viewH) <= 4, `包裹必须撑起画布全高（塌高实锤根治；实拿包裹 ${st.vwH} vs 画布 ${st.viewH}）`);
    await human.assert(st.scrollH > st.clientH + 50, `高图必须溢出（实拿 ${st.scrollH}/${st.clientH}）`);
    await human.assert(st.overflowY === 'auto' || st.overflowY === 'scroll', '纵向溢出必须可滚');
  });

  // ==================== 2：拖拽裁剪贴底沿自动滚 ====================
  await scenario('裁剪·贴底沿拖拽自动滚', async () => {
    await evaluate(() => document.querySelector('[data-t=crop]')?.click());
    await wait(500);
    const geo = await evaluate(() => {
      const stage = document.querySelector('.ie-stage');
      const vr = document.querySelector('.ie-view').getBoundingClientRect().toJSON();
      const sr = stage.getBoundingClientRect().toJSON();
      return { vr, sr, st0: stage.scrollTop };
    });
    // 从画布可视区中点起拖，一路压到台面板底沿内 12px 并来回蹭（人样多步）
    const startX = geo.vr.left + geo.vr.width / 2, startY = Math.min(geo.vr.top + 200, geo.sr.bottom - 260);
    await win.mouse.move(startX, startY);
    await win.mouse.down();
    const edgeY = geo.sr.bottom - 12;
    await win.mouse.move(startX + 120, edgeY, { steps: 14 });
    await wait(260);
    await win.mouse.move(startX + 130, edgeY - 6, { steps: 3 });
    await wait(260);
    const st1 = await evaluate(() => document.querySelector('.ie-stage').scrollTop);
    await win.mouse.up();
    human.log(`scrollTop: ${geo.st0} → ${st1}`);
    await human.assert(st1 > geo.st0, `贴底沿必须自动下滚（实拿 ${geo.st0}→${st1}）`);
    // 收兵：复位模式机（crop 钮再点是「应用裁剪」非开关，不许盲点）
    await evaluate(() => { const ed = window.__activeViewerCtl?._imgEditor; if (ed && ed.mode !== 'normal') ed._setMode('normal'); });
    await wait(300);
  });

  // ==================== 3：全局缩放 50% 裁剪零漂移（选框贴手+工作坐标双断言） ====================
  await scenario('全局50%·裁剪选框贴手坐标零漂移', async () => {
    await evaluate(() => window.MazzShell?.setZoom?.(0.5));
    await wait(700);
    // 归零台面板滚动（场景2余滚会带进边缘侦测区，必须收干净）；模式机保险：不在裁剪态才点
    await evaluate(() => { document.querySelector('.ie-stage').scrollTop = 0; });
    await evaluate(() => { const ed = window.__activeViewerCtl?._imgEditor; if (ed && ed.mode !== 'cropping') document.querySelector('[data-t=crop]')?.click(); });
    await wait(500);
    // 拖点全程远离台面板上/下沿 48px 侦测区（页像素系：view 顶距台面板顶仅 padding 折叠量，起拖点必须纵深）
    const rect = await evaluate(() => document.querySelector('.ie-view').getBoundingClientRect().toJSON());
    const sx = rect.left + 60, sy = rect.top + 200, ex = rect.left + 200, ey = rect.top + 360;
    await win.mouse.move(sx, sy);
    await win.mouse.down();
    await win.mouse.move(ex, ey, { steps: 10 });
    await win.mouse.up();
    await wait(500);
    const st = await evaluate(() => {
      const ed = window.__activeViewerCtl?._imgEditor;
      const live = ed?._liveScale?.();
      const el = document.querySelector('.ie-crop');
      const r = el.getBoundingClientRect();
      const vr = document.querySelector('.ie-view').getBoundingClientRect();
      return {
        crop: ed?._crop ? { x0: Math.round(ed._crop.x0), y0: Math.round(ed._crop.y0), x1: Math.round(ed._crop.x1), y1: Math.round(ed._crop.y1) } : null,
        live,
        relLeft: Math.round(r.left - vr.left), relTop: Math.round(r.top - vr.top),
        w: Math.round(r.width), h: Math.round(r.height),
        zoom: window.MazzShell?.zoom,
      };
    });
    human.log('50%裁剪:', JSON.stringify(st));
    await human.assert(st.zoom === 0.5, '全局缩放必须实落 50%');
    await human.assert(st.crop && st.live > 0, '选区与现测倍率必须在');
    // ① 选框视觉必须贴手：页像素偏移=拖拽页偏移（折叠比贴图会再折一次 zoom 脱离指针实锤）
    await human.assert(Math.abs(st.relLeft - 60) <= 4 && Math.abs(st.relTop - 200) <= 4, `选框必须贴住起拖点（实拿 ${st.relLeft},${st.relTop} 望 ~60,200）`);
    await human.assert(Math.abs(st.w - 140) <= 4 && Math.abs(st.h - 160) <= 4, `选框尺寸必须贴拖程（实拿 ${st.w}×${st.h} 望 ~140×160）`);
    // ② 工作坐标必须=拖拽页距/折叠比
    const expX = Math.round(200 / st.live), expY = Math.round(360 / st.live);
    await human.assert(Math.abs(st.crop.x1 - expX) <= 3 && Math.abs(st.crop.y1 - expY) <= 3, `工作坐标必须=拖拽坐标/现测（实拿 ${JSON.stringify(st.crop)} 望 ~${expX},${expY}）`);
    await evaluate(() => window.MazzShell?.setZoom?.(1)); // 收兵复位
    await wait(400);
  });
}
