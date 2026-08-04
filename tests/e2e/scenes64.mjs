// tests/e2e/scenes64.mjs —— W59 实证批（图片编辑模式全工具链：四色块图）
import fs from 'fs';

export async function scenes64({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  // 四色块测试图（60×40：红/绿/蓝/白 四象限——像素级断言料）
  fs.writeFileSync(WS + '/四色.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="30" height="20" fill="#ff0000"/><rect x="30" width="30" height="20" fill="#00ff00"/><rect y="20" width="30" height="20" fill="#0000ff"/><rect x="30" y="20" width="30" height="20" fill="#ffffff"/></svg>`);

  const ieState = () => evaluate(() => {
    const ed = window.__activeViewerCtl?._imgEditor;
    if (!ed) return null;
    const px = (x, y) => { const d = ed.wctx.getImageData(x, y, 1, 1).data; return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''); };
    return { w: ed.work.width, h: ed.work.height, hist: ed.history.getStats(), p00: px(1, 1), pM: px(ed.work.width - 2, ed.work.height - 2), mode: ed.mode, dirty: ed.dirtySinceSave };
  });

  await scenario('编辑模式·进出双态', async () => {
    await evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/四色.svg');
    await wait(2600);
    const has = await evaluate(() => ({ btn: !!document.querySelector('[data-a=imgedit]'), img: !!document.querySelector('.viewer-body img') }));
    await human.assert(has.btn && has.img, `编辑入口必须在（实拿 ${JSON.stringify(has)}）`);
    await evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
    await wait(2000);
    const st = await evaluate(() => ({
      root: !!document.querySelector('.ie-root'),
      imgHidden: document.querySelector('.viewer-body img')?.style.display === 'none',
      zoomHidden: [...document.querySelectorAll('[data-a=fit]')].every(b => b.style.display === 'none'),
      barBtns: document.querySelectorAll('.ie-bar .rb-btn').length,
    }));
    human.log('编辑态:', JSON.stringify(st));
    await human.assert(st.root && st.imgHidden && st.zoomHidden, `编辑态必须接管（实拿 ${JSON.stringify(st)}）`);
    await human.assert(st.barBtns >= 12, `工具栏必须全员（实拿 ${st.barBtns}）`);
    const s0 = await ieState();
    await human.assert(s0 && s0.w === 60 && s0.h === 40 && s0.p00 === '#ff0000' && s0.pM === '#ffffff', `原图必须上画布（实拿 ${JSON.stringify(s0)}）`);
  });

  await scenario('裁剪选框·框选应用', async () => {
    // 先点裁剪钮进模式（漏点=永远 normal 态不产选框，实锤）
    await evaluate(() => document.querySelector('[data-t=crop]')?.click());
    await wait(400);
    const rect = await evaluate(() => document.querySelector('.ie-view').getBoundingClientRect().toJSON());
    // 工作坐标 (5,5)-(35,25)：scale=1 直映
    await win.mouse.move(rect.left + 5, rect.top + 5);
    await win.mouse.down();
    await win.mouse.move(rect.left + 35, rect.top + 25, { steps: 8 });
    await win.mouse.up();
    await wait(400);
    const shown = await evaluate(() => document.querySelector('.ie-crop')?.style.display === 'block');
    await human.assert(shown, '选框必须显示');
    await evaluate(() => window.__activeViewerCtl?._imgEditor?.applyCrop());
    await wait(600);
    const st = await ieState();
    human.log('裁剪后:', JSON.stringify(st));
    await human.assert(st.w === 30 && st.h === 20, `裁剪尺寸必须 30×20（实拿 ${st.w}×${st.h}）`);
    await human.assert(st.p00 === '#ff0000' && st.hist.size >= 2, `裁后像素与历史必须对（实拿 ${JSON.stringify(st)}）`);
  });

  await scenario('变换·旋转与镜像', async () => {
    await evaluate(() => window.__activeViewerCtl?._imgEditor?.rotate(1));
    await wait(400);
    let st = await ieState();
    await human.assert(st.w === 20 && st.h === 30, `右转后必须 20×30（实拿 ${st.w}×${st.h}）`);
    await evaluate(() => window.__activeViewerCtl?._imgEditor?.rotate(-1));
    await wait(400);
    st = await ieState();
    await human.assert(st.w === 30 && st.h === 20 && st.p00 === '#ff0000', `左转复位必须还原（实拿 ${st.w}×${st.h} ${st.p00}）`);
  });

  await scenario('滤镜·反色像素级', async () => {
    await evaluate(() => window.__activeViewerCtl?._imgEditor?.filter('invert(1)'));
    await wait(500);
    const st = await ieState();
    human.log('反色:', JSON.stringify(st));
    await human.assert(st.p00 === '#00ffff', `红必须反成青（实拿 ${st.p00}）`);
  });

  await scenario('绘画+取色·联动', async () => {
    const rect = await evaluate(() => document.querySelector('.ie-view').getBoundingClientRect().toJSON());
    await evaluate(() => { const ed = window.__activeViewerCtl?._imgEditor; if (ed) ed.color = '#ff0000'; });
    await evaluate(() => { const ed = window.__activeViewerCtl?._imgEditor; ed._setMode('drawing'); });
    await win.mouse.move(rect.left + 10, rect.top + 10);
    await win.mouse.down();
    await win.mouse.move(rect.left + 16, rect.top + 12, { steps: 4 });
    await win.mouse.up();
    await wait(500);
    // 断言点在笔画覆盖域内（(10,10)——旧断 p00(1,1) 在覆盖域外=冤案实锤）
    const sp = await evaluate(() => { const d = window.__activeViewerCtl?._imgEditor?.wctx.getImageData(10, 10, 1, 1).data; return d ? '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('') : null; });
    human.log('笔画点:', sp);
    await human.assert(sp === '#ff0000', `笔画必须落画布（实拿 ${sp}）`);
    await evaluate(() => { const ed = window.__activeViewerCtl?._imgEditor; ed._setMode('colorpicker'); });
    await win.mouse.move(rect.left + 12, rect.top + 11);
    await win.mouse.down(); await win.mouse.up();
    await wait(500);
    const c = await evaluate(() => window.__activeViewerCtl?._imgEditor?.color);
    await human.assert(c === '#ff0000', `取色必须读到笔画色（实拿 ${c}）`);
  });

  await scenario('撤销重做·快照栈', async () => {
    const px10 = () => evaluate(() => { const d = window.__activeViewerCtl?._imgEditor?.wctx.getImageData(10, 10, 1, 1).data; return d ? '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('') : null; });
    await evaluate(() => window.__activeViewerCtl?._imgEditor?.undo()); // 撤绘画
    await wait(500);
    let p = await px10();
    await human.assert(p === '#00ffff', `撤绘画必须回反色态（实拿 ${p}）`);
    await evaluate(() => window.__activeViewerCtl?._imgEditor?.undo()); // 撤反色
    await wait(500);
    p = await px10();
    await human.assert(p === '#ff0000', `撤反色必须回原图（实拿 ${p}）`);
    await evaluate(() => window.__activeViewerCtl?._imgEditor?.redo());
    await wait(400);
    p = await px10();
    await human.assert(p === '#00ffff', `重做必须回反色（实拿 ${p}）`);
  });

  await scenario('网格分割·zip 落盘', async () => {
    await evaluate(() => document.querySelector('[data-t=grid]')?.click());
    await wait(900);
    // inputModal ×2：行 2 列 2
    for (const v of ['2', '2']) {
      const ok = await evaluate((val) => {
        const inp = document.querySelector('#im-input');
        if (!inp) return false;
        inp.value = val;
        document.querySelector('#im-ok')?.click();
        return true;
      }, v);
      await human.assert(ok, 'inputModal 必须在');
      await wait(700);
    }
    await wait(1500);
    const z = await evaluate(async (ws) => await window.mazz.invoke('fs:stat', { path: ws + '/四色-网格2x2.zip' }).then(s => s?.size || 0).catch(() => 0), WS);
    human.log('网格 zip:', z);
    await human.assert(z > 200, `zip 必须落盘且非空（实拿 ${z}B）`);
  });

  await scenario('另存副本·原图不动', async () => {
    await evaluate(() => document.querySelector('[data-t=save]')?.click());
    await wait(1500);
    const st = await evaluate(async (ws) => ({
      copy: await window.mazz.invoke('fs:stat', { path: ws + '/四色-edit.png' }).then(s => s?.size || 0).catch(() => 0),
      orig: await window.mazz.invoke('fs:stat', { path: ws + '/四色.svg' }).then(s => s?.size || 0).catch(() => 0),
    }), WS);
    human.log('另存:', JSON.stringify(st));
    await human.assert(st.copy > 100, `副本必须落盘（实拿 ${st.copy}B）`);
    await human.assert(st.orig > 0, '原图必须在（未覆盖）');
    const dirty = await evaluate(() => window.__activeViewerCtl?._imgEditor?.dirtySinceSave);
    await human.assert(dirty === false, '存后脏标必须清');
  });

  await scenario('退出编辑·浏览态还原', async () => {
    await evaluate(() => document.querySelector('[data-t=exit]')?.click());
    await wait(900);
    const st = await evaluate(() => ({
      root: !!document.querySelector('.ie-root'),
      imgShown: document.querySelector('.viewer-body img')?.style.display !== 'none',
      fitShown: [...document.querySelectorAll('[data-a=fit]')].some(b => b.style.display !== 'none'),
    }));
    human.log('退出态:', JSON.stringify(st));
    await human.assert(st.root === false && st.imgShown === true && st.fitShown === true, `浏览态必须还原（实拿 ${JSON.stringify(st)}）`);
  });
}
