// tests/e2e/scenes39.mjs —— W50 渲染根治实证批（截图硬指标——用户军令）
// 离屏帧到达（彩色页像素实证）/ 浮层压顶不遮盖（截图 A/B 对比）/ 撤除复明（截图 C）/ 输入转发点击跳转
import fs from 'fs';
import http from 'http';

export async function scenes39({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const OUT = '/mnt/agents/output';

  // ==================== 0：彩色测试页（像素可判） ====================
  const PAGE = `<!DOCTYPE html><html><body style="margin:0">
    <div id="hd" style="background:#d03030;height:120px;color:#fff;font-size:40px;padding:20px">红色头块 MazzOSR</div>
    <div style="display:flex;height:600px">
      <div style="background:#2060c0;width:45%;color:#fff;font-size:24px;padding:16px">蓝色左块</div>
      <div style="background:#2a9d3f;width:55%;color:#fff;font-size:24px;padding:16px">
        绿色右块<br><a id="go" href="/target" style="color:#ff0;font-size:30px">跳转链接点这里</a>
      </div>
    </div></body></html>`;
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.url === '/target' ? '<html><body style="background:#8030c0;color:#fff;font-size:40px">目标页到达</body></html>' : PAGE);
  });
  const port = await new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
  const pageUrl = `http://127.0.0.1:${port}/page`;

  const px = async (fx, fy) => evaluate(({ fx: fx2, fy: fy2 }) => {
    const ctl = window.__activeBrowserCtl;
    const tab = ctl?.tabs?.find(t => t.id === ctl.activeId);
    if (!tab?.canvas) return null;
    const r = tab.canvas.getBoundingClientRect();
    const d = tab.canvas.getContext('2d').getImageData(Math.round(fx2 * tab.canvas.width), Math.round(fy2 * tab.canvas.height), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { fx, fy });
  const near = (c, t, tol = 60) => c && Math.abs(c[0] - t[0]) < tol && Math.abs(c[1] - t[1]) < tol && Math.abs(c[2] - t[2]) < tol;

  try {
    // ==================== 1：离屏帧到达 ====================
    await scenario('离屏·帧到达彩页像素', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
      await evaluate((u) => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
      }, pageUrl);
      // 帧到达闸：红头块像素出现（不再赌固定等待；until 回调页面内执行——闭包禁食，探针挂窗）
      await human.until(() => {
        const ctl = window.__activeBrowserCtl;
        const tab = ctl?.tabs?.find(t => t.id === ctl.activeId);
        if (!tab?.canvas || tab.canvas.width < 2) return false;
        const d = tab.canvas.getContext('2d').getImageData(Math.round(0.5 * tab.canvas.width), Math.round(0.05 * tab.canvas.height), 1, 1).data;
        window.__c = [d[0], d[1], d[2]];
        return Math.abs(d[0] - 208) < 70 && Math.abs(d[1] - 48) < 70 && Math.abs(d[2] - 48) < 70;
      }, { timeout: 12000, msg: '离屏帧到达（红头块像素）' });
      const c = await evaluate(() => window.__c);
      await human.assert(near(c, [208, 48, 48], 70), `红头块必须到 canvas（${c}——离屏帧管线实锤）`);
      const c2 = await px(0.1, 0.5), c3 = await px(0.8, 0.5);
      await human.assert(near(c2, [32, 96, 192], 70), `蓝左块必须到（${c2}）`);
      await human.assert(near(c3, [42, 157, 63], 70), `绿右块必须到（${c3}）`);
      // 截图 A：页面渲染基线（硬指标存档）
      const host = await evaluate(() => {
        const t = window.__activeBrowserCtl?.tabs?.find(x => x.id === window.__activeBrowserCtl.activeId);
        const r = t?.host?.getBoundingClientRect();
        return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
      });
      await win.screenshot({ path: `${OUT}/w50-实证A-页面渲染.png`, clip: host });
    });

    // ==================== 2：浮层压顶不遮盖（截图 B） ====================
    await scenario('离屏·浮层压顶不遮盖', async () => {
      await evaluate(() => {
        const el = document.createElement('div');
        el.id = 'w50-overlay';
        el.style.cssText = 'position:fixed;left:50%;top:45%;width:420px;height:260px;transform:translate(-50%,-50%);background:#8030c0;border:4px solid #ff0;z-index:99999;display:grid;place-items:center;color:#fff;font-size:26px;border-radius:12px';
        el.textContent = 'DOM 浮层压顶——页面必须照样可见';
        document.body.appendChild(el);
      });
      await wait(700);
      // 硬指标①：浮层区中心像素=紫（不被视图抢）
      const r = await evaluate(() => {
        const o = document.getElementById('w50-overlay').getBoundingClientRect();
        const shot = { x: o.left, y: o.top, width: o.width, height: o.height };
        return shot;
      });
      await win.screenshot({ path: `${OUT}/w50-实证B-浮层压顶不遮盖.png`, clip: r });
      const ov = await evaluate(() => {
        const o = document.getElementById('w50-overlay').getBoundingClientRect();
        const el = document.elementFromPoint(o.left + o.width / 2, o.top + o.height / 2);
        return { top: el?.id || el?.className, style: el ? getComputedStyle(el).backgroundColor : '' };
      });
      await human.assert(ov.top === 'w50-overlay', `浮层必须最上（${JSON.stringify(ov)}——canvas 是 DOM 压不住它）`);
      // 硬指标②：浮层之外页面像素依旧（不白不丢帧）
      const c = await px(0.5, 0.05);
      await human.assert(near(c, [208, 48, 48], 70), `浮层之下页面帧必须继续（${c}——不再隐身闪白实锤）`);
      const c2 = await px(0.8, 0.5);
      await human.assert(near(c2, [42, 157, 63], 70), `绿块继续（${c2}）`);
    });

    // ==================== 3：撤除复明（截图 C） ====================
    await scenario('离屏·撤除复明', async () => {
      await evaluate(() => document.getElementById('w50-overlay')?.remove());
      await wait(500);
      const host = await evaluate(() => {
        const t = window.__activeBrowserCtl?.tabs?.find(x => x.id === window.__activeBrowserCtl.activeId);
        const r = t?.host?.getBoundingClientRect();
        return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
      });
      await win.screenshot({ path: `${OUT}/w50-实证C-撤除复明.png`, clip: host });
      const c = await px(0.5, 0.05);
      await human.assert(near(c, [208, 48, 48], 70), `撤除复明（${c}——帧管线不中断）`);
    });

    // ==================== 4：输入转发点击跳转 ====================
    await scenario('离屏·输入转发点击跳转', async () => {
      const url0 = await evaluate(() => window.__activeBrowserCtl?.tabs?.find(x => x.id === window.__activeBrowserCtl.activeId)?.url);
      // 精准打击：bv:js 取链接矩形中心（客页真值）→ canvas 同点派发（输入转发实锤链）
      const linkPt = await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        const tab = ctl?.tabs?.find(t => t.id === ctl.activeId);
        return window.mazz.invoke('bv:js', { tabId: tab.viewId, code: "(()=>{const a=document.getElementById('go');const r=a.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()" }).catch(() => null);
      });
      human.log('链接坐标:', JSON.stringify(linkPt));
      await human.assert(linkPt && linkPt.x > 0, '链接坐标必须取到');
      await evaluate((pt) => {
        const ctl = window.__activeBrowserCtl;
        const tab = ctl?.tabs?.find(t => t.id === ctl.activeId);
        const r = tab.canvas.getBoundingClientRect();
        const cx = r.left + pt.x, cy = r.top + pt.y;
        tab.canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy, bubbles: true }));
        tab.canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, button: 0, detail: 1, bubbles: true }));
        tab.canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: cx, clientY: cy, button: 0, detail: 1, bubbles: true }));
      }, linkPt);
      await human.until(() => {
        const u = window.__activeBrowserCtl?.tabs?.find(x => x.id === window.__activeBrowserCtl.activeId)?.url;
        return u && !u.endsWith('/page');
      }, { timeout: 6000, msg: '点击跳转（输入转发）' });
      const urlN = await evaluate(() => window.__activeBrowserCtl?.tabs?.find(x => x.id === window.__activeBrowserCtl.activeId)?.url);
      human.log('跳转:', url0, '→', urlN);
      await human.assert(urlN.includes('/target') || urlN.includes('/page') === false, `点击必须跳转（${urlN}——sendInputEvent 实锤）`);
    });
  } finally { srv.close(); }
}
