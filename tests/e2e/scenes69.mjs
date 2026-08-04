// tests/e2e/scenes69.mjs —— 59d 实证批（查看态纵/横滚动条不绑滚轮/编辑态双轴条滚轮纵不横）
import fs from 'fs';

export async function scenes69({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  fs.writeFileSync(WS + '/高塔.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2500"><rect width="800" height="1250" fill="#4a86e8"/><rect y="1250" width="800" height="1250" fill="#e84a3c"/></svg>`);
  fs.writeFileSync(WS + '/宽幕.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="800"><rect width="1250" height="800" fill="#3d85c6"/><rect x="1250" width="1250" height="800" fill="#e8a33c"/></svg>`);

  // ==================== 1：查看态·高图纵条在场，滚轮缩放不滚屏 ====================
  await scenario('查看·纵向滚动条在场不绑滚轮', async () => {
    await evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/高塔.svg');
    await wait(2400);
    await evaluate(() => document.querySelector('[data-a=actual]')?.click());
    await wait(700);
    const st0 = await evaluate(() => {
      const b = document.querySelector('.viewer-body');
      return { scrollH: b.scrollHeight, clientH: b.clientHeight, top: b.scrollTop, pct: document.querySelector('.viewer-pct')?.textContent };
    });
    human.log('查看纵条:', JSON.stringify(st0));
    await human.assert(st0.pct === '100%', '原尺寸必须实落');
    await human.assert(st0.scrollH > st0.clientH + 50, `高图必须溢出（实拿 ${st0.scrollH}/${st0.clientH}）`);
    // 滚轮上滚 → 必须缩放且 scrollTop 不动（滚动条不绑滚轮实锤）
    const geo = await evaluate(() => document.querySelector('.viewer-body').getBoundingClientRect().toJSON());
    await win.mouse.move(geo.left + geo.width / 2, geo.top + geo.height / 2);
    await win.mouse.wheel(0, -240);
    await wait(500);
    const st1 = await evaluate(() => ({ top: document.querySelector('.viewer-body').scrollTop, pct: document.querySelector('.viewer-pct')?.textContent }));
    await human.assert(st1.top === 0, `滚轮不许滚屏（实拿 scrollTop ${st1.top}）`);
    await human.assert(st1.pct !== '100%', `滚轮必须缩放（实拿 ${st1.pct}）`);
    // 条可拖：程序置位即生效（拖条通道在场）
    await evaluate(() => { document.querySelector('.viewer-body').scrollTop = 400; });
    const st2 = await evaluate(() => document.querySelector('.viewer-body').scrollTop);
    await human.assert(st2 === 400, `拖条通道必须在（实拿 ${st2}）`);
  });

  // ==================== 2：查看态·宽幕横条在场，横滚轮不横滚不缩放 ====================
  await scenario('查看·横向滚动条在场不绑滚轮', async () => {
    await evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/宽幕.svg');
    await wait(2400);
    await evaluate(() => document.querySelector('[data-a=actual]')?.click());
    await wait(700);
    const st0 = await evaluate(() => {
      const b = document.querySelector('.viewer-body');
      return { scrollW: b.scrollWidth, clientW: b.clientWidth, left: b.scrollLeft, pct: document.querySelector('.viewer-pct')?.textContent };
    });
    human.log('查看横条:', JSON.stringify(st0));
    await human.assert(st0.scrollW > st0.clientW + 50, `宽幕必须横向溢出（实拿 ${st0.scrollW}/${st0.clientW}）`);
    // 触控板横滑 → scrollLeft 不许动，缩放也不许动
    const geo = await evaluate(() => document.querySelector('.viewer-body').getBoundingClientRect().toJSON());
    await win.mouse.move(geo.left + geo.width / 2, geo.top + geo.height / 2);
    await win.mouse.wheel(500, 0);
    await wait(500);
    const st1 = await evaluate(() => ({ left: document.querySelector('.viewer-body').scrollLeft, pct: document.querySelector('.viewer-pct')?.textContent }));
    await human.assert(st1.left === 0, `横滚轮不许横滚（实拿 scrollLeft ${st1.left}）`);
    await human.assert(st1.pct === '100%', `横滚轮不许缩放（实拿 ${st1.pct}）`);
    await evaluate(() => { document.querySelector('.viewer-body').scrollLeft = 400; });
    const st2 = await evaluate(() => document.querySelector('.viewer-body').scrollLeft);
    await human.assert(st2 === 400, `横向拖条通道必须在（实拿 ${st2}）`);
    // 安全居中平反：左缘必须可达（居中压钉负空间裁剪实锤——scrollLeft=0 即图左）
    await evaluate(() => { document.querySelector('.viewer-body').scrollLeft = 0; });
    const st3 = await evaluate(() => {
      const b = document.querySelector('.viewer-body').getBoundingClientRect();
      const i = document.querySelector('.viewer-body img').getBoundingClientRect();
      return Math.round(i.left - b.left);
    });
    await human.assert(st3 <= 14 && st3 >= -1, `左缘必须贴容器起点（实拿 ${st3}）`);
  });

  // ==================== 3：编辑态·双轴条，滚轮纵不横 ====================
  await scenario('编辑·双轴条滚轮纵不横', async () => {
    await evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/高塔.svg');
    await wait(2400);
    // 编辑态适配恒收宽，横向溢出唯窄分屏可致（主窗 minWidth 960 实锤）——原生 split 不搬签防误收缩，
    // 查看器叶两连分裂挤进 ~302px 窄格（splitAndMove 对单签叶即分即塌实锤，不许用）
    await evaluate(() => {
      const pt = window.MazzShell?.paneTree;
      const leaf = pt?.active;
      if (!leaf) return;
      pt.split(leaf, 'row');
      pt.setActive(leaf);
      pt.split(leaf, 'row');
      pt.setActive(leaf);
    });
    await wait(900);
    await evaluate(() => document.querySelector('[data-a=imgedit]')?.click());
    await wait(2200);
    const st0 = await evaluate(() => {
      const s = document.querySelector('.ie-stage');
      return { scrollW: s.scrollWidth, clientW: s.clientWidth, scrollH: s.scrollHeight, clientH: s.clientHeight, top: s.scrollTop, left: s.scrollLeft };
    });
    human.log('编辑窄窗:', JSON.stringify(st0));
    await human.assert(st0.scrollW > st0.clientW, `窄窗必须横向溢出（实拿 ${st0.scrollW}/${st0.clientW}）`);
    await human.assert(st0.scrollH > st0.clientH + 50, `高图必须纵向溢出（实拿 ${st0.scrollH}/${st0.clientH}）`);
    // 纵滚轮 → 纵向走；横滚轮 → 横向不许动
    const geo = await evaluate(() => document.querySelector('.ie-stage').getBoundingClientRect().toJSON());
    await win.mouse.move(geo.left + geo.width / 2, geo.top + geo.height / 2);
    await win.mouse.wheel(0, 300);
    await wait(400);
    const st1 = await evaluate(() => ({ top: document.querySelector('.ie-stage').scrollTop, left: document.querySelector('.ie-stage').scrollLeft }));
    await human.assert(st1.top >= 250, `纵滚轮必须纵滚（实拿 ${st1.top}）`);
    await win.mouse.wheel(500, 0);
    await wait(400);
    const st2 = await evaluate(() => ({ top: document.querySelector('.ie-stage').scrollTop, left: document.querySelector('.ie-stage').scrollLeft }));
    await human.assert(st2.left === 0, `横滚轮不许横滚（实拿 scrollLeft ${st2.left}）`);
    await evaluate(() => { document.querySelector('.ie-stage').scrollLeft = 40; });
    const st3 = await evaluate(() => document.querySelector('.ie-stage').scrollLeft);
    await human.assert(st3 === 40, `横向拖条通道必须在（实拿 ${st3}）`);
    // 收兵：退出编辑
    await evaluate(() => document.querySelector('[data-t=exit]')?.click());
    await wait(600);
  });
}
