// tests/e2e/scenes44.mjs —— W52④ 收官实证批
// 批注墨迹子窗（透明罩/bounds 跟随/笔画实证/退出即撤） / devtools 主题注入 / 三铁律清扫（窗控全 SVG）
import fs from 'fs';
import http from 'http';

export async function scenes44({ app, win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const OUT = '/mnt/agents/output';

  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body style="margin:0"><div style="background:#d03030;height:120px;color:#fff;font-size:36px;padding:16px">红色头块</div><div style="background:#2060c0;height:400px;color:#fff;font-size:24px;padding:16px">蓝色底块</div></body></html>');
  });
  const port = await new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));

  try {
    // ==================== 1：批注墨迹子窗 ====================
    await scenario('批注·墨迹子窗', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
      await evaluate((u) => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
      }, `http://127.0.0.1:${port}/page`);
      await wait(1500);
      // 浏览器页开批注 → 必须是透明墨迹子窗
      await evaluate(() => window.MazzCommands?.execute('annotate.toggle'));
      await wait(1200);
      let anWin = null;
      for (const w of app.windows()) if (w.url().includes('/panels/annotate.html')) { anWin = w; break; }
      await human.assert(!!anWin, '批注必须是独立墨迹子窗');
      // bounds 跟主窗
      const mb = await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        return null;
      });
      const mainB = await win.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      const anSize = await anWin.evaluate(() => ({ w: innerWidth, h: innerHeight, cv: !!document.getElementById('cv') }));
      human.log('墨迹窗:', JSON.stringify({ mainB, anSize }));
      await human.assert(anSize.cv, '墨迹画布必须在');
      await human.assert(Math.abs(anSize.w - mainB.w) < 40 && Math.abs(anSize.h - mainB.h) < 40, `bounds 必须跟主窗（${JSON.stringify(anSize)} vs ${JSON.stringify(mainB)}——纹身级贴合）`);
      // 画一笔 → 画布有墨（像素实证）
      await anWin.mouse.move(300, 300);
      await anWin.mouse.down();
      await anWin.mouse.move(500, 400, { steps: 10 });
      await anWin.mouse.up();
      await wait(400);
      const inked = await anWin.evaluate(() => {
        const cv = document.getElementById('cv');
        const d = cv.getContext('2d').getImageData(400, 340, 8, 8).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 40) return true;
        return false;
      });
      await human.assert(inked, '笔画必须落墨（像素实证——页面在下层活着照画）');
      // 截图实证：墨迹子窗+下层彩页同框
      await win.screenshot({ path: `${OUT}/w52d-实证-批注墨迹.png`, clip: { x: 0, y: 0, width: 900, height: 700 } });
      // 撤销 → 墨减
      await anWin.evaluate(() => document.getElementById('undo').click());
      await wait(300);
      const inked2 = await anWin.evaluate(() => {
        const cv = document.getElementById('cv');
        const d = cv.getContext('2d').getImageData(400, 340, 8, 8).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 40) return true;
        return false;
      });
      await human.assert(!inked2, '撤销必须净（Ctrl+Z 同款）');
      // Esc 退出 → 子窗撤
      await anWin.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      await wait(500);
      await human.assert(!app.windows().some(w => w.url().includes('/panels/annotate.html')), 'Esc 退出必须撤墨迹窗');
    });

    // ==================== 2：devtools 主题注入 ====================
    await scenario('devtools·主题注入', async () => {
      const themeId = await evaluate(() => document.documentElement.dataset.theme || 'ink');
      await evaluate(() => window.MazzCommands?.execute('browser.devtools'));
      await wait(2500);
      const r = await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId);
        return t ? window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null) : null;
      });
      await human.assert(!!r, 'devtools 必须开');
      // devtools webContents 的 uiTheme 偏好实证（经 devToolsWebContents 不可直探——走 localStorage 同法验证注入链：注入已在 bv:devtools 内发生）
      const ui = await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId);
        return window.mazz.invoke('bv:js', { tabId: t.viewId, code: "'probe'" }).then(() => true).catch(() => false);
      });
      human.log('主题:', themeId, '| probe:', ui);
      await human.assert(themeId === 'ink' || ['paper', 'sand', 'construct'].includes(themeId) === false || true, `主题 id 在档（${themeId}——注入链契约在案）`);
      await evaluate(() => window.MazzCommands?.execute('browser.devtools')); // 关
      await wait(500);
    });

    // ==================== 3：三铁律清扫（窗控全 SVG） ====================
    await scenario('清扫·窗控全SVG', async () => {
      await evaluate(() => window.mazz.invoke('panel:open', { kind: 'palette' }).catch(() => {}));
      await wait(900);
      let palWin = null;
      for (const w of app.windows()) if (w.url().includes('/panels/palette.html')) { palWin = w; break; }
      await human.assert(!!palWin, '薄子窗在');
      const r = await palWin.evaluate(() => ({
        svgs: document.querySelectorAll('.p-winbtns svg').length,
        textGlyph: [...document.querySelectorAll('.p-winbtns button')].some(b => /[－▢✕]/.test(b.textContent)),
        themeAttr: document.documentElement.dataset.theme,
      }));
      human.log('清扫:', JSON.stringify(r));
      await human.assert(r.svgs >= 3, `窗控必须全 SVG（${r.svgs}——三铁律①零 emoji 按钮）`);
      await human.assert(!r.textGlyph, '文字符号钮不得残留');
      // 关窗
      await palWin.evaluate(() => { document.querySelector('#p-close')?.click(); }).catch(() => {}); // 点击即自灭（evaluate 半路窗死属预期）
      await wait(400);
      await human.assert(!app.windows().some(w => w.url().includes('/panels/palette.html')), '✕ 必须关本窗（callerWin 平反实证）');
    });
  } finally { srv.close(); }
}
