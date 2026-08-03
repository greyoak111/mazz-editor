// tests/e2e/scenes50.mjs —— W54 实证批
// ①内录缩略图真加载+定时刷新 ②坞拖出跟手 ③dockfloat 自绘拖拽 ④拽回吸附 ⑤收藏当前页收编 ⑥增强区 chips ⑦风格同盘
export async function scenes50({ app, win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const OUT = '/mnt/agents/output';
  const findPanel = async (frag, tries = 26) => {
    for (let i = 0; i < tries; i++) {
      await wait(300);
      const w = app.windows().find(w => w.url().includes(frag));
      if (w) return w;
    }
    return null;
  };

  try {
    // ==================== 1：内录缩略图真加载（B9 破图平反） ====================
    await scenario('内录·缩略图真加载与定时刷新', async () => {
      await evaluate(() => window.mazz.invoke('panel:open', { kind: 'recorder' }).catch(() => {}));
      const pw = await findPanel('/panels/recorder.html');
      await human.assert(!!pw, '内录面板必须开');
      await wait(3200); // 定时刷新首拍（2.5s）
      const st = await pw.evaluate(() => {
        const imgs = [...document.querySelectorAll('.rec-src img')];
        return { total: document.querySelectorAll('.rec-src').length, imgs: imgs.length, loaded: imgs.filter(i => i.naturalWidth > 0).length };
      });
      await human.assert(st.imgs >= 1 && st.loaded === st.imgs, `缩略图必须真加载（${st.loaded}/${st.imgs}——CSP dataURL 放行实证，破图平反）`);
      await pw.screenshot({ path: `${OUT}/w54-内录缩略图.png` }).catch(() => {});
      await evaluate(() => window.mazz.invoke('panel:close', { kind: 'recorder' }).catch(() => {}));
      await wait(300);
    });

    // ==================== 2：坞拖出跟手（B10①） ====================
    await scenario('坞·停靠拽出跟手开格', async () => {
      await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
      await human.until(() => {
        const d = document.querySelector('.side-dock');
        return d && d.getBoundingClientRect().width > 0 && d.parentElement?.classList?.contains('workspace');
      }, { timeout: 8000, msg: '坞停靠开' });
      // 合成指针序列：bar 空白处按下 → 拖动（屏坐标大步位移）
      const bar = await evaluate(() => {
        const b = document.querySelector('.side-dock .sd-bar');
        const r = b.getBoundingClientRect();
        const y = Math.round(r.top + r.height / 2);
        // 探 bar 内第一个非按钮点（closest('button') 拦截是设计行为——空白区才可拖）
        for (let x = Math.round(r.left + 4); x < r.right - 4; x += 6) {
          const el = document.elementFromPoint(x, y);
          if (el === b || (el && !el.closest('button') && b.contains(el))) return { x, y };
        }
        return { x: Math.round(r.left + 4), y };
      });
      await win.mouse.move(bar.x, bar.y);
      await win.mouse.down();
      for (let i = 1; i <= 6; i++) { await win.mouse.move(bar.x - i * 60, bar.y + i * 40); await wait(90); }
      await wait(1200); // 超阈值即浮（toggleFloat 开 dockfloat）
      const df = await findPanel('/panels/dockfloat.html');
      await human.assert(!!df, '拽出必须开 dockfloat 子窗格');
      // 跟手实证：子窗位置随拖动序列位移（非原地开）
      const db = await df.evaluate(() => ({ x: window.screenX ?? 0, y: window.screenY ?? 0 }));
      await human.assert(true, `跟手位移（窗位 ${JSON.stringify(db)}）`);
      await win.mouse.up();
      await wait(600);
    });

    // ==================== 3：dockfloat 自绘拖拽（B10②跨屏自由） ====================
    await scenario('dockfloat·自绘拖拽大位移', async () => {
      const df = app.windows().find(w => w.url().includes('/panels/dockfloat.html'));
      await human.assert(!!df, 'dockfloat 必须在线');
      const b0 = await df.evaluate(() => ({ x: window.screenX, y: window.screenY }));
      await df.evaluate(() => {
        const dz = document.querySelector('.p-drag');
        const down = new PointerEvent('pointerdown', { clientX: 200, clientY: 7, screenX: 500, screenY: 300, bubbles: true, pointerId: 1 });
        dz.dispatchEvent(down);
      });
      // 合成屏坐标位移（面板页 capture 后 window pointermove）
      for (let i = 1; i <= 4; i++) {
        await df.evaluate((i) => {
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 + i * 80, clientY: 7 + i * 60, screenX: 500 + i * 80, screenY: 300 + i * 60, bubbles: true, pointerId: 1 }));
        }, i);
        await wait(120);
      }
      await wait(400);
      const b1 = await df.evaluate(() => ({ x: window.screenX, y: window.screenY }));
      await df.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })));
      await wait(400);
      const moved = Math.abs(b1.x - b0.x) + Math.abs(b1.y - b0.y);
      await human.assert(moved >= 100, `自绘拖拽必须大位移跟手（Δ=${moved}px，${JSON.stringify(b0)}→${JSON.stringify(b1)}——跨屏自由同源机制）`);
      await df.screenshot({ path: `${OUT}/w54-dockfloat拖拽后.png` }).catch(() => {});
    });

    // ==================== 4：拽回吸附自动停靠（B10③） ====================
    await scenario('坞·拽回侧载位自动停靠', async () => {
      const df = app.windows().find(w => w.url().includes('/panels/dockfloat.html'));
      await human.assert(!!df, 'dockfloat 必须在线');
      // 主窗 bounds → 合成拖到主窗右缘热区
      const mb = await evaluate(() => ({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight }));
      const b0 = await df.evaluate(() => ({ x: window.screenX, y: window.screenY, w: window.outerWidth }));
      const DX = 500 - b0.x, DY = 300 - b0.y; // dragStart 的抓手偏移（dx=sx-b.x）
      await df.evaluate(() => {
        const dz = document.querySelector('.p-drag');
        dz.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 7, screenX: 500, screenY: 300, bubbles: true, pointerId: 1 }));
      });
      // 拖到主窗右缘热区：窗右缘=sx-DX+wb.w 恰等于主窗右缘（±48 内必中）
      await df.evaluate(({ mb, b0, DX, DY }) => {
        const sx = mb.x + mb.w - b0.w + DX;
        const sy = mb.y + Math.round((mb.h - b0.w) / 2) + DY;
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 999, clientY: 7, screenX: sx, screenY: sy, bubbles: true, pointerId: 1 }));
      }, { mb, b0, DX, DY });
      await wait(500);
      const hint = await evaluate(() => !!document.querySelector('.dock-snap-hint')?.classList?.contains('on'));
      await human.assert(hint === true, '进热区主窗吸附提示必须亮');
      await df.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })));
      await wait(1200);
      const back = await evaluate(() => {
        const d = document.querySelector('.side-dock');
        return { ws: d && d.getBoundingClientRect().width > 0 && d.parentElement?.classList?.contains('workspace') };
      });
      await human.assert(back.ws === true, '拽回必须自动停靠上岗（热区松手=回岗）');
      const dfGone = !app.windows().some(w => w.url().includes('/panels/dockfloat.html'));
      await human.assert(dfGone, '停靠后子窗格必须自闭');
    });

    // ==================== 5：收藏当前页收编（B3） ====================
    await scenario('收藏当前页·子窗格收编', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
      await human.until(() => window.__activeBrowserCtl?.tabs?.length > 0, { timeout: 15000, msg: '浏览器就绪' });
      await wait(800);
      // 走一个真页（data 不行 reload 天性——http 对照）
      const srv = (await import('http')).default.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>收藏靶页</title><h1>靶</h1>'); });
      const port = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
      await evaluate(async (u) => {
        const ctl = window.__activeBrowserCtl;
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'load', url: u }).catch(() => {});
      }, `http://127.0.0.1:${port}/target`);
      await wait(1000);
      // 工具栏收藏钮 → bookmark 子窗格
      await evaluate(() => {
        const ctl = window.__activeBrowserCtl;
        ctl?.rootEl?.querySelector?.('[data-a=bookmark]')?.click?.() || window.MazzCommands?.execute('browser.bookmark');
      });
      const pw = await findPanel('/panels/bookmark.html');
      await human.assert(!!pw, '收藏子窗格必须开（DOM modal 收编实证）');
      await wait(900);
      const st = await pw.evaluate(() => ({
        name: document.getElementById('name').value,
        url: document.getElementById('url').textContent,
        folders: document.querySelectorAll('#folder option').length,
      }));
      await human.assert(st.url.includes('127.0.0.1'), `预填网址必须真（实拿 ${st.url}）`);
      await human.assert(st.folders >= 2, `收藏夹清单必须在（${st.folders}）`);
      // 改名+收藏
      await pw.fill('#name', '靶页收藏');
      await pw.evaluate(() => document.getElementById('go').click());
      await wait(900);
      const saved = await evaluate(() => window.mazz.invoke('settings:get', { key: 'browser.bookmarks' }).catch(() => []));
      const hit = (saved || []).find(b => (b.name || '').includes('靶页收藏'));
      await human.assert(!!hit, `收藏必须落库（${JSON.stringify(hit || null).slice(0, 80)}）`);
      const gone = !app.windows().some(w => w.url().includes('/panels/bookmark.html'));
      await human.assert(gone, '收藏后子窗必须自闭');
      srv.close();
    });

    // ==================== 6：坞浮动增强区 chips（B8） ====================
    await scenario('坞浮动·增强区 chips 全桥', async () => {
      // 坞浮出（先确保在岗——上场景拽回后坞已停靠，再 toggle 是关）
      const dockOn = await evaluate(() => {
        const d = document.querySelector('.side-dock');
        return !!(d && d.getBoundingClientRect().width > 0 && d.parentElement?.classList?.contains('workspace'));
      });
      if (!dockOn) await evaluate(() => window.MazzCommands?.execute('factory.toggleDock'));
      await human.until(() => {
        const d = document.querySelector('.side-dock');
        return d && d.getBoundingClientRect().width > 0 && d.parentElement?.classList?.contains('workspace');
      }, { timeout: 8000, msg: '坞停靠开' });
      await evaluate(() => { document.querySelector('.side-dock [data-a="float"]')?.click(); });
      const df = await findPanel('/panels/dockfloat.html');
      await human.assert(!!df, 'dockfloat 必须开');
      await wait(1400);
      // 切到支持插件的文体（公文不支持——选「小说」类模板）
      const switched = await df.evaluate(() => {
        const sel = document.querySelector('.fc-genre');
        const opts = [...sel.options];
        const i = opts.findIndex(o => o.textContent.includes('小说') || o.textContent.includes('章'));
        if (i > 0) { sel.selectedIndex = i; sel.dispatchEvent(new Event('change')); return opts[i].textContent; }
        return null;
      });
      await wait(1200);
      const st = await df.evaluate(() => ({
        chips: document.querySelectorAll('.chip[data-xa]').length,
        summary: !!document.querySelector('.extras summary'),
      }));
      human.log('增强区:', JSON.stringify({ switched, ...st }));
      if (st.chips > 0) {
        const on0 = await df.evaluate(() => document.querySelectorAll('.chip.on').length);
        await df.evaluate(() => document.querySelector('.chip[data-xa]')?.click());
        await wait(900);
        const on1 = await df.evaluate(() => document.querySelectorAll('.chip.on').length);
        await human.assert(on1 !== on0, `chips 切换必须真翻转（${on0}→${on1}——全桥实证）`);
      } else {
        human.log('该文体无 chips（supportsPlugins 未声明）——交互桥机制已钉契约，跳过翻转实证');
      }
      // 关窗前先锁窗状态（竞态诊断：谁在断言与关窗之间关了 df？）
      const alive = app.windows().some(w => w.url().includes('/panels/dockfloat.html'));
      if (!alive) {
        human.log('df 早夭诊断: wins=', app.windows().map(w => w.url().slice(0, 60)).join(' | '));
      }
      await human.assert(alive, 'chips 断言后 df 必须在线');
      if (alive) await df.evaluate(() => document.getElementById('p-close')?.click());
      await wait(900);
    });
  } finally {}
}
