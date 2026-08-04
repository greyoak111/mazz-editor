// tests/e2e/scenes70.mjs —— 59e 实证批（Ctrl+滚轮缩图片本体/编辑栏不缩/指针锚点/选区同步）
import fs from 'fs';

export async function scenes70({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  fs.writeFileSync(WS + '/高塔.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2500"><rect width="800" height="1250" fill="#4a86e8"/><rect y="1250" width="800" height="1250" fill="#e84a3c"/></svg>`);

  const ctrlWheel = async (x, y, deltaY) => {
    await win.keyboard.down('Control');
    await win.mouse.move(x, y);
    await win.mouse.wheel(0, deltaY);
    await win.keyboard.up('Control');
    await wait(400);
  };

  // ==================== 1：Ctrl+滚轮缩图片，编辑栏纹丝不动 ====================
  await scenario('编辑·Ctrl滚轮缩图片不缩编辑栏', async () => {
    await evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/高塔.svg');
    await wait(2400);
    await evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
    await wait(2200);
    const st0 = await evaluate(() => {
      const area = window.MazzShell?.paneTree?.active?.el?.querySelector('.editor-area');
      return {
        barH: Math.round(document.querySelector('.ie-bar').getBoundingClientRect().height),
        viewW: document.querySelector('.ie-view').offsetWidth,
        areaZoom: area?.style.zoom || '',
        scrollH: document.querySelector('.ie-stage').scrollHeight,
      };
    });
    const geo = await evaluate(() => document.querySelector('.ie-stage').getBoundingClientRect().toJSON());
    const cx = geo.left + geo.width / 2, cy = geo.top + geo.height / 2;
    await ctrlWheel(cx, cy, -120); // 放大
    const st1 = await evaluate(() => {
      const area = window.MazzShell?.paneTree?.active?.el?.querySelector('.editor-area');
      return {
        barH: Math.round(document.querySelector('.ie-bar').getBoundingClientRect().height),
        viewW: document.querySelector('.ie-view').offsetWidth,
        areaZoom: area?.style.zoom || '',
        scrollH: document.querySelector('.ie-stage').scrollHeight,
        uz: window.__activeViewerCtl?._imgEditor?.userZoom,
      };
    });
    human.log('Ctrl放大:', JSON.stringify({ st0, st1 }));
    await human.assert(st1.viewW > st0.viewW + 40, `图片必须放大（实拿 ${st0.viewW}→${st1.viewW}）`);
    await human.assert(st1.barH === st0.barH, `编辑栏必须纹丝不动（实拿 ${st0.barH}→${st1.barH}）`);
    await human.assert(st1.areaZoom === '', `窗格缩放必须没抢（实拿 area.zoom='${st1.areaZoom}'）`);
    await human.assert(st1.scrollH > st0.scrollH, `溢出必须随放大增长（实拿 ${st0.scrollH}→${st1.scrollH}）`);
    await ctrlWheel(cx, cy, 120); await ctrlWheel(cx, cy, 120); // 连缩两级
    const st2 = await evaluate(() => document.querySelector('.ie-view').offsetWidth);
    await human.assert(st2 < st0.viewW, `连缩必须小于原适配（实拿 ${st2} vs ${st0.viewW}）`);
    await evaluate(() => { const ed = window.__activeViewerCtl?._imgEditor; if (ed) { ed.userZoom = 1; ed._repaint(); } });
    await wait(400);
  });

  // ==================== 2：指针锚点不跑 ====================
  await scenario('编辑·缩放指针锚点原地不动', async () => {
    await evaluate(() => { document.querySelector('.ie-stage').scrollTop = 500; });
    await wait(300);
    const geo = await evaluate(() => document.querySelector('.ie-stage').getBoundingClientRect().toJSON());
    const px = geo.left + geo.width * 0.6, py = geo.top + geo.height * 0.55;
    const before = await evaluate(({ px, py }) => {
      const ed = window.__activeViewerCtl?._imgEditor;
      return ed?._toWork({ clientX: px, clientY: py });
    }, { px, py });
    await ctrlWheel(px, py, -120);
    const after = await evaluate(({ px, py }) => {
      const ed = window.__activeViewerCtl?._imgEditor;
      const r = ed.view.getBoundingClientRect();
      const live = ed._liveScale();
      const b = ed._toWork({ clientX: px, clientY: py });
      return { sx: r.left + b.x * live, sy: r.top + b.y * live };
    }, { px, py });
    human.log('锚点:', JSON.stringify({ before, after, px: Math.round(px), py: Math.round(py) }));
    await human.assert(Math.abs(after.sx - px) <= 6 && Math.abs(after.sy - py) <= 6, `指针下图点必须原地不动（实拿偏移 ${Math.round(after.sx - px)},${Math.round(after.sy - py)}）`);
  });

  // ==================== 3：选区随缩放同步重贴 ====================
  await scenario('编辑·缩放选区工作坐标不变贴图随比', async () => {
    await evaluate(() => { document.querySelector('.ie-stage').scrollTop = 0; }); // 场景2余滚归零——view 顶已负，相对坐标拖会按出屏幕实锤
    await evaluate(() => { const ed = window.__activeViewerCtl?._imgEditor; if (ed && ed.mode !== 'cropping') document.querySelector('[data-t=crop]')?.click(); });
    await wait(500);
    const rect = await evaluate(() => document.querySelector('.ie-view').getBoundingClientRect().toJSON());
    await win.mouse.move(rect.left + 100, rect.top + 100);
    await win.mouse.down();
    await win.mouse.move(rect.left + 300, rect.top + 260, { steps: 8 });
    await win.mouse.up();
    await wait(400);
    const c0 = await evaluate(() => {
      const ed = window.__activeViewerCtl?._imgEditor;
      return { crop: { ...ed._crop }, elW: Math.round(document.querySelector('.ie-crop').getBoundingClientRect().width) };
    });
    const geo = await evaluate(() => document.querySelector('.ie-stage').getBoundingClientRect().toJSON());
    await ctrlWheel(geo.left + geo.width / 2, geo.top + geo.height / 2, -120);
    const c1 = await evaluate(() => {
      const ed = window.__activeViewerCtl?._imgEditor;
      return { crop: { ...ed._crop }, elW: Math.round(document.querySelector('.ie-crop').getBoundingClientRect().width), uz: ed.userZoom };
    });
    human.log('选区缩放:', JSON.stringify({ c0, c1 }));
    await human.assert(Math.abs(c1.crop.x0 - c0.crop.x0) <= 2 && Math.abs(c1.crop.x1 - c0.crop.x1) <= 2, `选区工作坐标必须不变（实拿 ${JSON.stringify(c0.crop)}→${JSON.stringify(c1.crop)}）`);
    const ratio = c1.elW / c0.elW;
    await human.assert(Math.abs(ratio - 1.1) <= 0.08, `选框贴图必须随比 1.1×（实拿 ${ratio.toFixed(3)}）`);
    // 收兵
    await evaluate(() => { const ed = window.__activeViewerCtl?._imgEditor; if (ed) { ed._setMode('normal'); ed.userZoom = 1; ed._repaint(); } });
    await wait(300);
  });
}
