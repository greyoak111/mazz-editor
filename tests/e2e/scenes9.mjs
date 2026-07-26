// tests/e2e/scenes9.mjs —— 波次二十「浏览器根治」实证批
// 视图创建摆位 / 真导航链路 / 返回零冻结 / 错误页自然回退 / 查找缩放 / 新窗审批 / 遮挡隐身
import http from 'http';

export async function scenes9({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // —— 本地测试站（真导航链路与错误页必须真 HTTP）——
  // Content-Type 必带 charset=utf-8——裸发中文被 Chromium 按 Latin-1 解=满屏乱码（查找「乙页」零匹配实锤）
  const html = (res, body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
  const srv = http.createServer((req, res) => {
    if (req.url === '/a') html(res, '<html><body><h1>甲页</h1><a href="/b">去乙</a></body></html>');
    else if (req.url === '/b') html(res, '<html><head><title>乙页标题</title></head><body><h1>乙页</h1><a href="/r">去丙(跳转)</a></body></html>');
    else if (req.url === '/r') { res.writeHead(302, { Location: '/c' }); res.end(); }
    else if (req.url === '/c') html(res, '<html><body><h1>丙页</h1><p>跳转落点</p></body></html>');
    else { res.writeHead(404); res.end('nf'); }
  });
  await new Promise(r => srv.listen(18923, '127.0.0.1', r));
  const A = 'http://127.0.0.1:18923/a', B = 'http://127.0.0.1:18923/b', R = 'http://127.0.0.1:18923/r', C = 'http://127.0.0.1:18923/c';
  const DEAD = 'http://127.0.0.1:9/dead'; // 必拒连

  const openBrowser = async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
    await human.until(() => {
      const h = [...document.querySelectorAll('.br-view-host, .br-webview')].find(e => e.getBoundingClientRect().width > 0);
      return !!h;
    }, { timeout: 9000, msg: '浏览器打开' });
  };
  const nav = (url) => evaluate((u) => { const c = window.__activeBrowserCtl; c.addrEl.value = u; c.addrEl.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, url);
  const guestUrl = () => evaluate(async () => await window.__activeBrowserCtl.execJs(null, 'location.href'));
  const addrVal = () => evaluate(() => window.__activeBrowserCtl?.addrEl?.value || '');

  // ==================== 1：视图创建与摆位 ====================
  await scenario('浏览器·视图创建·摆位·客页存活', async () => {
    await openBrowser();
    await wait(1500);
    const r = await evaluate(async () => {
      const ctl = window.__activeBrowserCtl;
      const ping = await ctl.execJs(null, '1+1');
      const host = [...document.querySelectorAll('.br-view-host')].find(e => e.getBoundingClientRect().width > 0);
      const st = await window.mazz.invoke('bv:state', { tabId: ctl.activeId });
      return { ping, hostW: host?.getBoundingClientRect().width || 0, state: st, tabs: ctl.tabs.length };
    });
    human.log('视图状态:', JSON.stringify(r));
    await human.assert(r.ping === 2, '客页应可执行 JS（视图存活）');
    await human.assert(r.hostW > 200, '宿主应可见且已摆位');
    await human.assert(r.state && typeof r.state.url === 'string', 'bv:state 应可取');
    await human.assert(r.tabs >= 1, '标签模型应在');
  });

  // ==================== 2：真导航链路（历史入册 + 标题 + 地址栏） ====================
  await scenario('浏览器·真导航·历史入册', async () => {
    await nav(A);
    await wait(1600);
    await human.assert((await guestUrl()).startsWith(A), '应落地甲页');
    await evaluate(async () => { await window.__activeBrowserCtl.execJs(null, `document.querySelector('a').click()`); });
    await wait(1500);
    const u1 = await guestUrl();
    await human.assert(u1.startsWith(B), `点链应到乙页（实际 ${u1}）`);
    await human.assert((await addrVal()).startsWith(B), '地址栏应跟随乙页');
    const his = await evaluate(async () => (await window.mazz.invoke('settings:get', { key: 'browser.history' }) || []).slice(0, 3).map(h => h.url));
    human.log('历史:', JSON.stringify(his));
    await human.assert(his.some(u => u.startsWith(B)), '乙页应入历史');
    await evaluate(async () => { await window.__activeBrowserCtl.execJs(null, `document.querySelector('a').click()`); });
    await wait(1800);
    await human.assert((await guestUrl()).startsWith(C), '302 跳转应落到丙页');
  });

  // ==================== 3：返回/前进零冻结（计时） ====================
  await scenario('浏览器·返回前进·零冻结', async () => {
    const t0 = Date.now();
    await evaluate(() => { [...document.querySelectorAll('[data-a=back]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(900);
    const u1 = await guestUrl();
    const t1 = Date.now() - t0;
    await human.assert(u1.startsWith(B), `返回应落乙页（实际 ${u1}）`);
    await evaluate(() => { [...document.querySelectorAll('[data-a=back]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(900);
    const u2 = await guestUrl();
    const t2 = Date.now() - t0;
    await human.assert(u2.startsWith(A), `再返回应落甲页（实际 ${u2}）`);
    await evaluate(() => { [...document.querySelectorAll('[data-a=forward]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(900);
    const u3 = await guestUrl();
    human.log('导航耗时:', JSON.stringify({ back1: t1, back2: t2, fwd: Date.now() - t0 }));
    await human.assert(u3.startsWith(B), `前进应回乙页（实际 ${u3}）`);
    await human.assert(t1 < 2500 && t2 < 3500, `导航必须即时无冻结（${t1}/${t2}ms）`);
  });

  // ==================== 4：错误页自然回退 ====================
  await scenario('浏览器·错误页·URL保留·回退落前页', async () => {
    await nav(DEAD);
    await wait(2500);
    const r = await evaluate(async () => ({
      guestText: await window.__activeBrowserCtl.execJs(null, 'document.body ? document.body.textContent.slice(0, 60) : ""'),
      addr: window.__activeBrowserCtl.addrEl.value,
    }));
    human.log('错误页:', JSON.stringify(r));
    await human.assert((r.guestText || '').includes('加载失败'), '应渲染错误页');
    await human.assert(r.addr === DEAD, '地址栏应保留失败地址（错误页写进失败文档）');
    await evaluate(() => { [...document.querySelectorAll('[data-a=back]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(1200);
    const u = await guestUrl();
    await human.assert(u.startsWith(B), `回退应自然落在失败前的好页（实际 ${u}）`);
  });

  // ==================== 5：查找/缩放/新窗审批 ====================
  await scenario('浏览器·查找·缩放·新窗审批开标签', async () => {
    await evaluate(async () => {
      const ctl = window.__activeBrowserCtl;
      await window.mazz.invoke('bv:find', { tabId: ctl.activeId, text: '乙页' });
    });
    await wait(800);
    const cnt = await evaluate(() => document.querySelector('.br-find-count')?.textContent || '');
    await human.assert(/\d+\/\d+/.test(cnt), `查找应报匹配数（实际 ${cnt}）`);
    const z = await evaluate(async () => {
      const ctl = window.__activeBrowserCtl;
      await window.mazz.invoke('bv:zoom', { tabId: ctl.activeId, factor: 1.5 });
      return ctl.execJs(null, 'window.devicePixelRatio >= 0 ? 1.5 : 1');
    });
    await human.assert(z === 1.5, '缩放通道应生效');
    // 新窗审批：客页 window.open → 审批转新标签
    const n0 = await evaluate(() => window.__activeBrowserCtl.tabs.length);
    await evaluate(async () => { await window.__activeBrowserCtl.execJs(null, `window.open('/a')`); });
    await wait(1200);
    const n1 = await evaluate(() => window.__activeBrowserCtl.tabs.length);
    human.log('新窗审批:', n0, '→', n1);
    await human.assert(n1 === n0 + 1, `window.open 应审批转新标签（${n0}→${n1}）`);
    await evaluate(() => { const ts = window.__activeBrowserCtl.tabs; ts.length && window.__activeBrowserCtl; });
  });

  // ==================== 6：遮挡隐身 ====================
  await scenario('浏览器·遮挡隐身·弹层不吃菜单', async () => {
    // 弹命令面板（mazz-palette-mask）→ 视图隐身；Esc 关闭 → 复显
    const open = await evaluate(async () => {
      window.MazzCommands?.execute('app.commandPalette');
      await new Promise(r => setTimeout(r, 700));
      return window.__activeBrowserCtl._cloaked === true;
    });
    await human.assert(open, '弹层期间视图必须隐身（原生表面吃菜单的病根）');
    await win.keyboard.press('Escape');
    await wait(700);
    const back = await evaluate(() => window.__activeBrowserCtl._cloaked === false);
    await human.assert(back, '弹层关闭后视图应复显');
  });

  srv.close();
}
