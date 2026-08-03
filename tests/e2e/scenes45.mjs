// tests/e2e/scenes45.mjs —— W52e 实证批
// ①主页刷新不白屏（bv:js 文档探针硬指标） ②devtools toggle+主题跟随实证（uiTheme 真断言，摆烂平反） ③截图验收
import fs from 'fs';
import http from 'http';

export async function scenes45({ app, win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const OUT = '/mnt/agents/output';

  // 真网页对照组必须走 http——data: URL 不可重载是 Chromium 天性（reload 必丢文档），拿它当对照必冤案
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><head><title>对照页</title></head><body><h1 id="duizhao">对照</h1></body></html>');
  });
  const port = await new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));

  // 主页存活探针（比像素更本质）：主页是 document.write 重写的文档——搜索框 #q 存在=主页在；
  // about:blank 白屏=无此元素。bv:js 直查视图文档，不受 GPU/抓帧限制（xvfb 实证 capturePage 不可用）。
  // 页面内自包含（闭包禁食！）：until 与 evaluate 两用都成立——函数体只许碰 window.*
  const homeAlive = async () => {
    const ctl = window.__activeBrowserCtl;
    const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
    if (!t) return false;
    const r = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "!!document.getElementById('q')" }).catch(() => null);
    return r === true;
  };

  try {
    // ==================== 1：主页刷新不白屏 ====================
    await scenario('主页·刷新不白屏', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
      await human.until(homeAlive, { timeout: 15000, msg: '主页渲染出内容（#q 搜索框存在）' });

      // 三路刷新全轮一遍：命令(Ctrl+R 同体) → 工具栏钮 → F5 转发——每路后主页必须原地复活
      await evaluate(() => window.MazzCommands?.execute('browser.navReload'));
      await human.until(homeAlive, { timeout: 8000, msg: '命令刷新后主页仍在——修复前此处必白屏' });

      await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        ctl?.rootEl?.querySelector?.('[data-a=reload]')?.click?.();
      });
      await human.until(homeAlive, { timeout: 8000, msg: '工具栏钮刷新后主页仍在' });

      // F5 转发链：主进程 before-input-event 拦 F5 → key-reload → reloadTab（E2E 合成键进不了视图，直发事件验消费端）
      await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:emitTest', { tabId: t.viewId, type: 'key-reload', data: {} }).catch(() => {});
      });
      await human.until(homeAlive, { timeout: 8000, msg: 'F5 转发刷新后主页仍在' });

      // 真网页对照：导航真实页面后刷新必须走 wc.reload（页面保持，不转主页）
      await evaluate(async (u) => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
      }, `http://127.0.0.1:${port}/duizhao`);
      await wait(1000);
      await evaluate(() => window.MazzCommands?.execute('browser.navReload'));
      await wait(1200);
      const stillThere = await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (!t) return false;
        return await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "!!document.getElementById('duizhao')" }).catch(() => null);
      });
      await human.assert(stillThere === true, '真网页刷新后页面必须保持（wc.reload 正路）');
      await win.screenshot({ path: `${OUT}/w52e-主页刷新实证.png` }).catch(() => {});
    });

    // ==================== 2：devtools toggle + 主题跟随实证 ====================
    await scenario('devtools·toggle与主题跟随', async () => {
      // 打开（toggle 第一档）
      await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:devtools', { tabId: t.viewId }).catch(() => {});
      });
      let dtWin = null;
      for (let i = 0; i < 30; i++) {
        await wait(300);
        dtWin = app.windows().find(w => w.url().startsWith('devtools://')) || null;
        if (dtWin) break;
      }
      await human.assert(!!dtWin, 'devtools 窗口必须打开（detach）');
      await wait(1600); // 首注延迟拍（syncDevToolsTheme 900ms + reload）

      // 当前主题下的 uiTheme 必须真实落盘（摆烂断言平反：不再 || true）
      const themeNow = await evaluate(() => document.documentElement.dataset.theme || 'paper');
      const darkNow = ['ink', 'indigo', 'moss'].includes(themeNow);
      const uiTheme1 = await dtWin.evaluate(() => localStorage.getItem('uiTheme'));
      await human.assert(uiTheme1 === JSON.stringify(darkNow ? 'dark' : 'light'),
        `devtools uiTheme 必须跟随当前主题 ${themeNow}（实拿 ${uiTheme1}）`);

      // 换主题 ink → theme:broadcast（ReferenceError 修复后 rethemeAllDevTools 真跑）
      await evaluate(() => window.MazzShell?.setTheme?.('ink'));
      await wait(1600); // 广播 + 300ms 注入拍 + reload
      const uiTheme2 = await dtWin.evaluate(() => localStorage.getItem('uiTheme'));
      await human.assert(uiTheme2 === '"dark"', `换 ink 主题后 devtools 必须转 dark（实拿 ${uiTheme2}）`);

      // nativeTheme 路实证（W52e：uiTheme 键 Chromium 已不读——主题真实生效看 body 背景，不看键值）
      // devtools 可能只启动时读 nativeTheme——关重开一次看真实皮色
      await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) await window.mazz.invoke('bv:devtools', { tabId: t.viewId }).catch(() => {});
      });
      await wait(600);
      await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) await window.mazz.invoke('bv:devtools', { tabId: t.viewId }).catch(() => {});
      });
      let dtWin2 = null;
      for (let i = 0; i < 30; i++) {
        await wait(300);
        dtWin2 = app.windows().find(w => w.url().startsWith('devtools://')) || null;
        if (dtWin2) break;
      }
      await human.assert(!!dtWin2, '重开 devtools 必须再现');
      await wait(2000);
      const darkBg = await dtWin2.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const darkRgb = (darkBg.match(/\d+/g) || []).map(Number);
      await human.assert(darkRgb.length >= 3 && darkRgb[0] < 100 && darkRgb[1] < 100,
        `ink 主题下 devtools 皮必须真暗（实拿 ${darkBg}）——键值撒谎时代唯一真凭据`);
      await dtWin2.screenshot({ path: `${OUT}/w52e-devtools-ink主题跟随.png` }).catch(() => {});

      // 换回纸白 → 必须转 light
      await evaluate(() => window.MazzShell?.setTheme?.('paper'));
      await wait(1600);
      const uiTheme3 = await dtWin2.evaluate(() => localStorage.getItem('uiTheme'));
      await human.assert(uiTheme3 === '"light"', `换回纸白后 devtools 必须转 light（实拿 ${uiTheme3}）`);
      await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) await window.mazz.invoke('bv:devtools', { tabId: t.viewId }).catch(() => {});
      });
      await wait(600);
      await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) await window.mazz.invoke('bv:devtools', { tabId: t.viewId }).catch(() => {});
      });
      let dtWin3 = null;
      for (let i = 0; i < 30; i++) {
        await wait(300);
        dtWin3 = app.windows().find(w => w.url().startsWith('devtools://')) || null;
        if (dtWin3) break;
      }
      await wait(2000);
      const lightBg = dtWin3 ? await dtWin3.evaluate(() => getComputedStyle(document.body).backgroundColor) : '(未开)';
      const lightRgb = (lightBg.match(/\d+/g) || []).map(Number);
      await human.assert(lightRgb.length >= 3 && lightRgb[0] > 200, `纸白主题下 devtools 皮必须真亮（实拿 ${lightBg}）`);

      // W52f 色调跟随实证（「只做明暗两档偷懒」平反）：换 indigo → sys-color-base 必须是靛青 #101226
      await evaluate(() => window.MazzShell?.setTheme?.('indigo'));
      await wait(1800);
      const indigoBg = await dtWin3.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await human.assert(indigoBg === 'rgb(16, 18, 38)', `indigo 主题下 devtools 必须靛青色调（实拿 ${indigoBg}——明暗两档时代结束）`);
      await dtWin3.screenshot({ path: `${OUT}/w52f-devtools-indigo色调.png` }).catch(() => {});
      await evaluate(() => window.MazzShell?.setTheme?.('paper'));
      await wait(1200);

      // toggle 第二档：关闭
      await evaluate(async () => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:devtools', { tabId: t.viewId }).catch(() => {});
      });
      await wait(800);
      const stillOpen = app.windows().some(w => w.url().startsWith('devtools://'));
      await human.assert(!stillOpen, 'toggle 第二档必须关闭 devtools');
    });
  } finally { try { srv.close(); } catch {} }
}
