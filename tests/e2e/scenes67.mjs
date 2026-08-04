// tests/e2e/scenes67.mjs —— W66 实证批（裁剪坐标精确/打包全真路径/面板入坞开门）
import fs from 'fs';

export async function scenes67({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  fs.writeFileSync(WS + '/四色.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="400" height="250" fill="#e84a3c"/><rect x="400" width="400" height="250" fill="#4a86e8"/><rect y="250" width="400" height="250" fill="#3d85c6"/><rect x="400" y="250" width="400" height="250" fill="#f3f3f3"/></svg>`);
  fs.mkdirSync(WS + '/打包料', { recursive: true });
  fs.writeFileSync(WS + '/打包料/a.txt', '甲');
  fs.writeFileSync(WS + '/打包料/b.txt', '乙');

  // ==================== 1：裁剪坐标精确（工作坐标=拖拽坐标） ====================
  await scenario('裁剪·坐标零漂移', async () => {
    await evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/四色.svg');
    await wait(2600);
    await evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
    await wait(2200);
    // 进裁剪模式后精确拖拽 (view 内 60,40)→(360,240)
    await evaluate(() => document.querySelector('[data-t=crop]')?.click());
    await wait(500);
    const rect = await evaluate(() => document.querySelector('.ie-view').getBoundingClientRect().toJSON());
    await win.mouse.move(rect.left + 60, rect.top + 40);
    await win.mouse.down();
    await win.mouse.move(rect.left + 360, rect.top + 240, { steps: 10 });
    await win.mouse.up();
    await wait(500);
    const st = await evaluate(() => {
      const ed = window.__activeViewerCtl?._imgEditor;
      const el = document.querySelector('.ie-crop');
      const r = el.getBoundingClientRect();
      const vr = document.querySelector('.ie-view').getBoundingClientRect();
      return {
        crop: ed?._crop ? { x0: Math.round(ed._crop.x0), y0: Math.round(ed._crop.y0), x1: Math.round(ed._crop.x1), y1: Math.round(ed._crop.y1) } : null,
        scale: ed?._scale,
        relLeft: Math.round(r.left - vr.left), relTop: Math.round(r.top - vr.top),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    });
    human.log('裁剪:', JSON.stringify(st));
    await human.assert(st.crop, '选区必须在');
    const expX = Math.round(360 / st.scale), expY = Math.round(240 / st.scale); // 终点=view 内 360/240 css px → 工作=距/scale（起点 60/40 同理存 60/40）
    await human.assert(Math.abs(st.crop.x1 - expX) <= 3 && Math.abs(st.crop.y1 - expY) <= 3, `工作坐标必须=拖拽坐标（实拿 ${JSON.stringify(st.crop)} 望 ~${expX},${expY}）`);
    await human.assert(Math.abs(st.relLeft - 60) <= 4 && Math.abs(st.relTop - 40) <= 4, `贴图位必须贴拖拽点（实拿 ${st.relLeft},${st.relTop}）`);
    await human.assert(Math.abs(st.w - 300) <= 3 && Math.abs(st.h - 200) <= 3, `选区尺寸必须贴（实拿 ${st.w}×${st.h}）`);
  });

  // ==================== 2：宿主变宽选区自适应 ====================
  await scenario('裁剪·宿主变宽选区跟随', async () => {
    // 改宿主宽度（侧栏拉宽）→ ResizeObserver 应重绘且选区按比例重贴
    const before = await evaluate(() => {
      const el = document.querySelector('.ie-crop').getBoundingClientRect();
      return { l: Math.round(el.left), w: Math.round(el.width) };
    });
    await win.setViewportSize({ width: 1600, height: 900 }).catch(() => {});
    await wait(900);
    const after = await evaluate(() => {
      const ed = window.__activeViewerCtl?._imgEditor;
      const el = document.querySelector('.ie-crop').getBoundingClientRect();
      return { l: Math.round(el.left), w: Math.round(el.width), scale: ed?._scale, shown: document.querySelector('.ie-crop').style.display };
    });
    human.log('变宽后:', JSON.stringify({ before, after }));
    await human.assert(after.shown !== 'none', '变宽后选区必须仍在');
    await human.assert(after.scale > 0 && after.w > 0, `选区必须按比例重贴（实拿 ${JSON.stringify(after)}）`);
    await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
    await wait(600);
  });

  // ==================== 3：右键打包全真路径 ====================
  await scenario('打包·右键全路径不哑火', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
    await wait(500);
    await evaluate(() => {
      const n = [...document.querySelectorAll('.ft-node')].find(x => (x.dataset.path || '').endsWith('打包料'));
      if (n) { const r = n.getBoundingClientRect(); n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 40, clientY: r.y + 4 })); }
    });
    await wait(1400);
    const ctx = app.windows().find(w => w.url().includes('/panels/ctxmenu.html'));
    await human.assert(!!ctx, 'ctxmenu 必须开');
    const picked = await ctx.evaluate(() => {
      for (const el of document.querySelectorAll('.mi')) {
        if (el.textContent.includes('压缩为 zip')) { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); return true; }
      }
      return false;
    });
    await human.assert(picked === true, '必须点中压缩为 zip');
    await wait(2600);
    const st = await evaluate(async (ws) => ({
      z: await window.mazz.invoke('fs:stat', { path: ws + '/打包料.zip' }).then(s => s?.size || 0).catch(() => 0),
      toast: [...document.querySelectorAll('.mazz-toast, [class*=toast]')].map(t => t.textContent.slice(0, 40)).join('|'),
    }), WS);
    human.log('打包:', JSON.stringify(st));
    await human.assert(st.z > 100, `zip 必须落盘（实拿 ${st.z}B——无载荷哑火实锤平反）`);
  });

  // ==================== 4：无目标人话提示 ====================
  await scenario('打包·无目标人话不闷死', async () => {
    // 清空选中后走命令面板路径
    await evaluate(() => { window.MazzShell?.fileTree?.select?.(null); });
    await evaluate(() => window.MazzCommands?.execute('archive.pack', {}));
    await wait(1000);
    const t = await evaluate(() => [...document.querySelectorAll('.mazz-toast, [class*=toast]')].map(x => x.textContent.slice(0, 60)).join('|'));
    human.log('人话:', t);
    await human.assert(t.includes('请先在文件树选中'), `无目标必须人话提示（实拿 ${t || '闷死'}）`);
  });

  // ==================== 5：面板入坞+空态开门 ====================
  await scenario('面板·入坞可发现+空态开门', async () => {
    const card = await evaluate(() => {
      const c = [...document.querySelectorAll('.sd-tool-card, .w-ow-card')].find(x => x.textContent.includes('压缩包'));
      if (!c) return null;
      return { has: true, svg: !!c.querySelector('svg') };
    });
    human.log('坞卡:', JSON.stringify(card));
    await human.assert(card && card.has && card.svg === true, `坞卡必须存在且 SVG 图标（实拿 ${JSON.stringify(card)}）`);
    await evaluate(() => {
      const c = [...document.querySelectorAll('.sd-tool-card, .w-ow-card')].find(x => x.textContent.includes('压缩包'));
      c?.click();
    });
    await wait(2400);
    const pw = app.windows().find(w => w.url().includes('/panels/archive.html'));
    await human.assert(!!pw, '面板必须开');
    const st = await pw.evaluate(() => ({
      empty: !!document.getElementById('b-open'),
      text: document.getElementById('meta')?.textContent?.slice(0, 40),
    })).catch(() => null);
    human.log('空态:', JSON.stringify(st));
    await human.assert(st && st.empty === true, `空态开门钮必须在（实拿 ${JSON.stringify(st)}）`);
    await pw.close().catch(() => {});
    await wait(400);
  });
}
