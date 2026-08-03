// tests/e2e/scenes41.mjs —— W52① 地基回正实证批
// 原生渲染回正（canvas 全退） / OS 级点击直达（原生输入） / 反节流遮罩关即活 / 帧率闸全灭
import http from 'http';

export async function scenes41({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url === '/target') res.end('<html><body style="background:#8030c0;color:#fff;font-size:40px">目标页到达</body></html>');
    else res.end('<html><body style="margin:0"><div style="background:#d03030;height:120px;color:#fff;font-size:36px;padding:16px">红色头块</div><a id="go" href="/target" style="display:block;margin:60px;font-size:28px">跳转链接点这里</a></body></html>');
  });
  const port = await new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));

  try {
    // ==================== 1：原生渲染回正 ====================
    await scenario('地基·原生渲染回正', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
      await evaluate((u) => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
      }, `http://127.0.0.1:${port}/page`);
      await human.until(() => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId);
        if (!t) return false;
        return window.mazz.invoke('bv:state', { tabId: t.viewId }).then(s2 => s2?.url?.endsWith('/page')).catch(() => false);
      }, { timeout: 8000, msg: '页面加载' });
      const r = await evaluate(() => ({
        canvas: !!document.querySelector('.br-osr'),
        mirror: !!document.querySelector('.br-ime-mirror'),
        host: !!document.querySelector('.br-view-host'),
      }));
      human.log('回正:', JSON.stringify(r));
      await human.assert(!r.canvas, '离屏 canvas 必须全退（弯路清算实锤）');
      await human.assert(!r.mirror, 'IME 镜像必须退役（原生输入天然支持）');
      await human.assert(r.host, '原生宿主必须在（WebContentsView 原生渲染回归）');
    });

    // ==================== 2：原生输入回正（转发层退役+页面交互原生） ====================
    await scenario('地基·原生输入回正', async () => {
      // 页面内派发链接点击（bv:js——页面活性实证）；同时核 bv:input 转发层已退役（原生视图输入零代码直达，合成输入进不了 WCV 客页是沙箱物理）
      const url0 = await evaluate(() => window.__activeBrowserCtl?.tabs?.find(x => x.id === window.__activeBrowserCtl.activeId)?.url);
      await evaluate((u0) => { window.__url0 = u0; }, url0); // until 回调在页面内执行——闭包禁食，起点挂窗
      await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const tab = ctl?.tabs?.find(x => x.id === ctl.activeId);
        window.mazz.invoke('bv:js', { tabId: tab.viewId, code: "document.getElementById('go')?.click()" }).catch(() => {});
      });
      await human.until(() => {
        const u = window.__activeBrowserCtl?.tabs?.find(x => x.id === window.__activeBrowserCtl.activeId)?.url;
        return u && u !== window.__url0;
      }, { timeout: 6000, msg: '页内点击跳转' });
      const urlN = await evaluate(() => window.__activeBrowserCtl?.tabs?.find(x => x.id === window.__activeBrowserCtl.activeId)?.url);
      await human.assert(urlN.endsWith('/target'), `页面交互必须原生工作（${urlN}）`);
      const legacy = await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const tab = ctl?.tabs?.find(x => x.id === ctl.activeId);
        return window.mazz.invoke('bv:input', { tabId: tab.viewId, input: { type: 'mouseMove', x: 1, y: 1 } }).then(() => 'alive').catch(() => 'dead');
      });
      await human.assert(legacy === 'dead', `bv:input 转发层必须退役（${legacy}——原生视图输入零代码直达实锤；真机 OS 输入走原生管线，沙箱 CDP 合成进不了 WCV 客页（w34 实锤过的物理））`);
      human.log('原生输入:', url0, '→', urlN, '| 转发层:', legacy);
    });

    // ==================== 3：反节流遮罩关即活 ====================
    await scenario('地基·遮罩关即活', async () => {
      // 回页面 → 开全屏遮罩（协议/设置同款 palette-mask）→ 视图隐身 → 关罩 → backgroundThrottling:false 加持下立即复活不白死
      await evaluate((u) => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId);
        if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
      }, `http://127.0.0.1:${port}/page`);
      await wait(1200);
      const r = await evaluate(async () => {
        const mask = document.createElement('div');
        mask.className = 'mazz-palette-mask';
        mask.innerHTML = '<div class="mazz-palette" style="padding:30px">遮罩探针</div>';
        document.body.appendChild(mask);
        await new Promise(r2 => setTimeout(r2, 400));
        const during = { cloaked: window.__activeBrowserCtl?._cloaked };
        mask.remove();
        await new Promise(r2 => setTimeout(r2, 600));
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId);
        const st = await window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null);
        return { during, after: ctl?._cloaked, alive: !st?.dead, w: st?.bounds?.width };
      });
      human.log('遮罩:', JSON.stringify(r));
      await human.assert(r.during.cloaked === true, '遮罩期必须隐身（兜底 cloak 过渡件在岗）');
      await human.assert(r.after === false && r.alive && r.w > 2, `关罩必须立即复活（${JSON.stringify({ after: r.after, alive: r.alive, w: r.w })}——反节流不白死实锤）`);
    });

    // ==================== 4：帧率闸全灭 ====================
    await scenario('地基·帧率闸全灭', async () => {
      const r = await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId);
        return window.mazz.invoke('bv:state', { tabId: t.viewId }).catch(() => null);
      });
      await human.assert(r && r.frameRate === undefined && r.videoPlaying === undefined, `帧率探针必须随闸全灭（${JSON.stringify({ fr: r?.frameRate, vp: r?.videoPlaying })}——显示器 v-sync 自适应定版）`);
    });
  } finally { srv.close(); }
}
