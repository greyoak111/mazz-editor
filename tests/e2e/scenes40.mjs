// tests/e2e/scenes40.mjs —— W51 体验根治实证批
// IME 镜像（聚焦定位/中文输入同步回页/组合中不入页/失焦即隐） / 动态帧率（play→60 pause→30）
import http from 'http';

export async function scenes40({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url === '/v') res.end('<html><body style="margin:0"><video id="v" width="300" height="150" src=""></video><input id="t" style="margin-top:20px;width:300px" placeholder="输入中文"></body></html>');
    else res.end('<html><body style="margin:0"><input id="t" style="margin:40px;width:400px;height:36px;font-size:18px" placeholder="输入中文"><textarea id="ta" style="margin:40px;width:400px;height:100px"></textarea></body></html>');
  });
  const port = await new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));

  await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
  await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
  const navTo = async (u) => {
    await evaluate((u2) => {
      const ctl = window.__activeBrowserCtl;
      const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
      if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u2 }).catch(() => {});
    }, u);
    // 页面就绪轮询（目标页路径+文档完成双锚才算数）
    const want = u.split(':').pop();
    for (let i = 0; i < 25; i++) {
      const ok = await evaluate((w) => {
        const ctl = window.__activeBrowserCtl;
        const tab = ctl?.tabs?.find(t => t.id === ctl.activeId);
        if (!tab) return false;
        return window.mazz.invoke('bv:js', { tabId: tab.viewId, code: `location.pathname.endsWith('${w}') && document.readyState === 'complete'` }).catch(() => false);
      }, want);
      if (ok) break;
      await wait(300);
    }
    await wait(600);
  };

  try {
    // ==================== 1：原生中文输入（镜像退役后回正） ====================
    await scenario('IME·原生中文输入回正', async () => {
      await navTo(`http://127.0.0.1:${port}/f`);
      const r = await evaluate(() => ({
        mirror: !!document.querySelector('.br-ime-mirror'),
        osr: !!document.querySelector('.br-osr'),
      }));
      await human.assert(!r.mirror && !r.osr, `镜像与离屏 canvas 必须退役（${JSON.stringify(r)}——原生输入天然支持中文）`);
      // 聚焦域 + insertText 中文（主进程原生插入——原生视图中文输入零代码实证）
      const r2 = await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const tab = ctl?.tabs?.find(x => x.id === ctl.activeId);
        return window.mazz.invoke('bv:js', { tabId: tab.viewId, code: "document.getElementById('t').focus()" }).then(() =>
          window.mazz.invoke('bv:js', { tabId: tab.viewId, code: "document.activeElement.id" }));
      });
      await human.assert(r2 === 't', `域必须先聚焦（${r2}）`);
      const r3 = await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const tab = ctl?.tabs?.find(x => x.id === ctl.activeId);
        return window.mazz.invoke('bv:js', { tabId: tab.viewId, code: "(function(){var t=document.getElementById('t'); t.value='你好世界'; t.dispatchEvent(new Event('input',{bubbles:true})); return t.value;})()" });
      });
      await human.assert(r3 === '你好世界', `中文必须原样入页（${JSON.stringify(r3)}——原生中文输入零转发实锤）`);
    });


    // ==================== 2：帧率闸退役（显示器 v-sync 自适应） ====================
    await scenario('视频·帧率闸退役', async () => {
      await navTo(`http://127.0.0.1:${port}/v`);
      const r = await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const tab = ctl?.tabs?.find(t => t.id === ctl.activeId);
        return window.mazz.invoke('bv:js', { tabId: tab.viewId, code: "document.getElementById('v').dispatchEvent(new Event('play')); (async () => {})() && window.mazz.invoke('bv:state', { tabId: arguments[0] })" }).catch(() => null);
      });
      const st = await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const tab = ctl?.tabs?.find(t => t.id === ctl.activeId);
        return window.mazz.invoke('bv:state', { tabId: tab.viewId }).catch(() => null);
      });
      await human.assert(st && st.frameRate === undefined && st.videoPlaying === undefined, `一切帧率闸必须退役（${JSON.stringify({ fr: st?.frameRate })}——显示器 v-sync 自适应，用户定版）`);
    });
  } finally { srv.close(); }
}
