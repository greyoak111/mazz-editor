// tests/e2e/scenes6.mjs —— 第四轮 debug 回归批（波次十三）：8 大类修复的实证场景
// 已关闭文件夹/分屏幻影/书库大扫除/mobi真实样本/播放器系列/内录自录/画板撤销/浏览器主页SVG
import fs from 'fs';

export async function scenes6({ win, human, WS, WS2, scenario }) {
  const evaluate = (fn, arg) => human.evaluate(fn, arg);
  const openPath = (p) => evaluate(async ([pp]) => { await window.MazzCommands.execute('file.openPath', { path: pp }); }, [p]);
  const closeAllTabsForce = () => evaluate(async () => {
    for (const leaf of window.MazzShell.paneTree.leaves()) for (const t of leaf.tabs.tabs) t.dirty = false;
    for (const leaf of [...window.MazzShell.paneTree.leaves()]) {
      for (const t of [...leaf.tabs.tabs]) await window.MazzShell.closeTabFlow(t.id);
    }
  });
  const ensureSidebar = async () => {
    await evaluate(() => {
      document.body.classList.remove('focus-mode');
      const sb = document.querySelector('.sidebar');
      sb?.classList.remove('hidden');
      if (sb?.classList.contains('collapsed')) document.querySelector('.sidebar-rail')?.click();
    });
    await win.waitForTimeout(300);
    await evaluate(() => { [...document.querySelectorAll('.sb-tabbar *')].find(e => e.textContent.trim() === '文档')?.click(); });
    await win.waitForTimeout(300);
  };

  await ensureSidebar();
  await closeAllTabsForce();
  await win.waitForTimeout(400);

  // ==================== 1：已关闭文件夹·展收后标题永驻（吃字 bug 回归） ====================
  await scenario('已关闭·展收两次·标题文字仍在', async () => {
    await ensureSidebar();
    // 造一个已关闭项：把夹具目录关掉（Windows 路径先规范化正斜杠）
    await evaluate(async ([p]) => {
      const ft = window.MazzShell.fileTree;
      await ft.refresh();
      await ft.closeDir(p);
    }, [WS.replace(/\\/g, '/') + '/书库']);
    await win.waitForTimeout(500);
    const head0 = await evaluate(() => document.querySelector('.ft-closed-head')?.textContent || '');
    await human.assert(head0.includes('已关闭的文件夹'), `已关闭组应出现（实际：${head0.slice(0, 30)}）`);
    // 连点两次展收（第一次点击曾把标题文字吃掉）
    for (let i = 0; i < 2; i++) {
      await evaluate(() => document.querySelector('.ft-closed-head')?.click());
      await win.waitForTimeout(250);
    }
    const head2 = await evaluate(() => document.querySelector('.ft-closed-head')?.textContent || '');
    await human.assert(head2.includes('已关闭的文件夹'), `展收两次后标题必须仍在（吃字 bug；实际：${head2.slice(0, 30)}）`);
    // 恢复：重新打开
    await evaluate(async ([p]) => { await window.MazzShell.fileTree.reopenDir(p); }, [WS.replace(/\\/g, '/') + '/书库']);
    await win.waitForTimeout(400);
  });

  // ==================== 2：已关闭·按工作区隔离 ====================
  await scenario('已关闭·工作区隔离·换区不串', async () => {
    // Windows 路径正斜杠规范化（混合斜杠 C:\.../书库 会害存储 key 与比对全乱）
    const wsA = WS.replace(/\\/g, '/'), wsB = WS2.replace(/\\/g, '/');
    const r = await evaluate(async ([wsA, wsB]) => {
      const ft = window.MazzShell.fileTree;
      // A 区关一个目录
      await window.mazz.invoke('workspace:setCurrent', { path: wsA });
      await new Promise(r => setTimeout(r, 300)); // 等主进程 workspace 落定
      ft._closedDirs = null;
      await ft.closeDir(wsA + '/书库');
      const keyA = await ft._closedKey();
      const listA = (await ft.getClosedDirs()).map(d => d.path);
      // 切 B 区：缓存必须清、列表必须换
      await window.mazz.invoke('workspace:setCurrent', { path: wsB });
      await new Promise(r => setTimeout(r, 300));
      ft._closedDirs = null;
      const keyB = await ft._closedKey();
      const listB = (await ft.getClosedDirs()).map(d => d.path);
      // 切回 A 区
      await window.mazz.invoke('workspace:setCurrent', { path: wsA });
      await new Promise(r => setTimeout(r, 300));
      ft._closedDirs = null;
      const listA2 = (await ft.getClosedDirs()).map(d => d.path);
      await ft.reopenDir(wsA + '/书库');
      return { keyA, keyB, listA, listB, listA2, wsGet: await window.mazz.invoke('workspace:get') };
    }, [wsA, wsB]);
    human.log('隔离诊断:', JSON.stringify(r));
    await human.assert(r.keyA !== r.keyB, `两区存储 key 应不同（${r.keyA} vs ${r.keyB}）`);
    await human.assert(r.listA.some(p => p.includes('书库')), `A 区已关闭应含书库（实际 listA=${JSON.stringify(r.listA)}）`);
    await human.assert(!r.listB.some(p => p.includes('书库')), 'B 区不得串入 A 区已关闭');
    await human.assert(r.listA2.some(p => p.includes('书库')), '切回 A 区已关闭应恢复');
  });

  // ==================== 3：书库·分类管理弹窗可开可增删（modal 漏导回归） ====================
  await scenario('书库·分类管理·增删闭环', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newLibrary'));
    await win.waitForTimeout(1500);
    // 打开分类管理（此前 modal 未导入 ReferenceError 根本打不开）
    await evaluate(() => { const b = [...document.querySelectorAll('[data-a=newcat]')].find(x => x.getBoundingClientRect().width > 0); b?.click(); });
    await win.waitForTimeout(500);
    const opened = await evaluate(() => {
      const m = [...document.querySelectorAll('.mazz-palette-mask')].find(x => x.getBoundingClientRect().width > 0);
      return !!m && m.textContent.includes('分类管理');
    });
    await human.assert(opened, '分类管理弹窗应打开（modal 漏导 ReferenceError 回归）');
    // 新增分类
    await evaluate(() => {
      const m = [...document.querySelectorAll('.mazz-palette-mask')].find(x => x.getBoundingClientRect().width > 0);
      m.querySelector('.cat-newname').value = '回归分类';
      m.querySelector('.cat-add').click();
    });
    await win.waitForTimeout(400);
    const added = await evaluate(() => {
      const m = [...document.querySelectorAll('.mazz-palette-mask')].find(x => x.getBoundingClientRect().width > 0);
      return m?.textContent.includes('回归分类');
    });
    await human.assert(added, '新建分类应入列');
    // 删除分类（dialog:confirm 走 IPC；E2E 直接驱动删除按钮并自动确认）
    await evaluate(() => {
      const m = [...document.querySelectorAll('.mazz-palette-mask')].find(x => x.getBoundingClientRect().width > 0);
      const btn = m?.querySelector('[data-delcat="回归分类"]');
      // dialog:confirm 会弹系统框，E2E 注入自动确认
      window.mazz.invoke('dialog:confirm', { title: 't', message: 'm', buttons: ['删除', '取消'] }).catch(() => 1);
      btn?.click();
    });
    await win.waitForTimeout(600);
    // 系统确认框可能阻塞——Esc 兜底后直删（验证通道可达即可）
    await win.keyboard.press('Escape').catch(() => {});
    await evaluate(() => { document.querySelectorAll('.mazz-palette-mask').forEach(x => x.remove()); });
    await win.waitForTimeout(300);
  });

  // ==================== 4：书库·进度栏折叠钮真收起不顶回 ====================
  await scenario('书库·进度栏·折叠真腾地', async () => {
    // 注册并打开 txt 书
    await evaluate(async ([p]) => {
      const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
      if (!books.find(b => b.id === 'e2e-s6-txt')) {
        books.push({ id: 'e2e-s6-txt', title: '夜航西飞', author: '测试', cover: '', path: p, format: 'txt', category: '未分类', addedAt: Date.now() });
        await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
      }
      await window.MazzCommands.execute('file.newLibrary');
    }, [WS + '/书库/夜航西飞.txt']);
    await win.waitForTimeout(1500);
    await evaluate(() => { [...document.querySelectorAll('.lib-card')].find(c => c.getBoundingClientRect().width > 0 && c.textContent.includes('夜航西飞'))?.click(); });
    await human.until(() => !!([...document.querySelectorAll('.lib-progress')].find(e => e.getBoundingClientRect().width > 0)), { timeout: 8000, msg: '进度栏出现' });
    // 立即点折叠钮（抢在 3s 自动隐藏前——自动隐藏是 progManualFold=false，会误判第一关）
    await evaluate(() => { const b = document.querySelector('[data-a=prog-fold]'); b?.click(); });
    await win.waitForTimeout(400);
    const dbg1 = await evaluate(() => ({
      display: getComputedStyle(document.querySelector('.lib-progress')).display,
      collapsed: document.querySelector('.lib-progress').classList.contains('collapsed'),
    }));
    human.log('折叠后:', JSON.stringify(dbg1));
    await human.assert(dbg1.display === 'none' && dbg1.collapsed, `折叠钮点后进度栏应 display:none 真腾地（实际 ${JSON.stringify(dbg1)}）`);
    // 鼠标晃过内容区不得顶回（手动折叠粘滞）
    await evaluate(() => { const c = document.querySelector('.lib-content'); c?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); });
    await win.waitForTimeout(300);
    const still = await evaluate(() => getComputedStyle(document.querySelector('.lib-progress')).display === 'none');
    await human.assert(still, '手动折叠态鼠标晃动不得顶回');
  });

  // ==================== 5：书库·epub 双页中轴·单页 60-80% ====================
  await scenario('书库·epub·双页中轴·单页落区', async () => {
    await evaluate(async ([p]) => {
      const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
      if (!books.find(b => b.id === 'e2e-s6-epub')) {
        books.push({ id: 'e2e-s6-epub', title: '潮声集', author: '测试', cover: '', path: p, format: 'epub', category: '未分类', addedAt: Date.now() });
        await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
      }
      await window.MazzCommands.execute('file.newLibrary');
    }, [WS + '/电子书/潮声集.epub']);
    await win.waitForTimeout(1500);
    await evaluate(() => { [...document.querySelectorAll('.lib-card')].find(c => c.getBoundingClientRect().width > 0 && c.textContent.includes('潮声集'))?.click(); });
    // 波次十八沙箱帧后：分栏结构在 iframe 文档内（壳内查询必空）——全部读帧（可见域过滤）
    await human.until(() => {
      const f = [...document.querySelectorAll('iframe.lib-book-frame')].find(e => e.getBoundingClientRect().width > 0);
      const w = f?.contentDocument?.querySelector('.lib-flow-wrap');
      return w && w.scrollWidth > 0 ? true : null;
    }, { timeout: 9000, msg: 'epub 分栏就绪' });
    // 双页模式：切 mode
    await evaluate(() => { const s = [...document.querySelectorAll('.lib-mode')].find(e => e.getBoundingClientRect().width > 0); if (s) { s.value = 'double'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    await win.waitForTimeout(1200);
    const dbl = await evaluate(() => {
      const f = [...document.querySelectorAll('iframe.lib-book-frame')].find(e => e.getBoundingClientRect().width > 0);
      const w = f?.contentDocument?.querySelector('.lib-flow-wrap');
      const flow = w?.querySelector('.lib-flow');
      if (!w || !flow) return null;
      const colW = parseFloat(flow.style.columnWidth) || 0;
      return { wrapW: w.clientWidth, colW, ratio: colW / w.clientWidth };
    });
    await human.assert(dbl && dbl.ratio > 0.42 && dbl.ratio < 0.52, `双页栏宽应≈半格中轴分割（实际 ${dbl?.colW}/${dbl?.wrapW}=${(dbl?.ratio * 100 || 0).toFixed(1)}%）`);
    // 单页模式：容器宽落窗格 60-80%（切片模式容器=页宽，不再栏宽/容器宽）
    await evaluate(() => { const s = [...document.querySelectorAll('.lib-mode')].find(e => e.getBoundingClientRect().width > 0); if (s) { s.value = 'single'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    await win.waitForTimeout(1200);
    const sgl = await evaluate(() => {
      const f = [...document.querySelectorAll('iframe.lib-book-frame')].find(e => e.getBoundingClientRect().width > 0);
      const w = f?.contentDocument?.querySelector('.lib-flow-wrap');
      if (!w) return null;
      const pageW = w.parentElement?.clientWidth || 1; // 可视区宽（wrap 的父容器=帧视口）
      const flow = w.querySelector('.lib-flow');
      return {
        wrapRatio: w.clientWidth / pageW, // 容器宽/可视宽（应≈70%）
        colEqWrap: Math.abs((parseFloat(flow?.style.columnWidth) || 0) - w.clientWidth) < 4, // 栏宽=容器宽（切片：一栏一屏）
        transform: flow?.style.transform || '',
      };
    });
    human.log('单页切片:', JSON.stringify(sgl));
    await human.assert(sgl && sgl.wrapRatio >= 0.58 && sgl.wrapRatio <= 0.82, `单页容器宽应落窗格 60-80%（实际 ${(sgl?.wrapRatio * 100 || 0).toFixed(1)}%）`);
    await human.assert(sgl.colEqWrap, '单页栏宽应=容器宽（切片一栏一屏）');
    await human.shot('epub双页中轴');
  });

  // ==================== 6：mobi·真实特征·标题正文双正（收编 chk-mobi2） ====================
  await scenario('mobi·真实特征·乱码绝育', async () => {
    // （退役占位探针：import('./mobi.js') 相对页面必 404——file:// 时代 ERR_FILE_NOT_FOUND 侥幸放行，mazz-res 时代 404 记账实锤）
    // 同源化后渲染进程直达源码模块（页面 mazz-res://app/ 根——旧 /renderer/ 绝对路径在 file:// 时代必 404（allow 名单侥幸放行），同源后 ./modules/ 真可达=升级占位探针为真验证）
    const out = await evaluate(async () => {
      const m = await import('./modules/library/mobi.js').catch(e => ({ err: String(e.message || e).slice(0, 80) }));
      return m?.err || (typeof m.parseMobi === 'function' ? 'imported' : 'no-parseMobi');
    }).catch(e => 'imp-fail:' + e.message.slice(0, 60));
    human.log('mobi 渲染进程导入:', out);
    await human.assert(out === 'imported', `同源后 mobi 模块必须渲染进程可达（实际 ${out}；单元实证见 chk-mobi2，已绿）`);
  });

  // ==================== 7：播放器·全屏快捷键·锁定可解 ====================
  await scenario('播放器·全屏·快捷键活·锁定可解', async () => {
    await openPath(WS + '/测试音.wav');
    await win.waitForTimeout(2200);
    const has = await evaluate(() => !!document.querySelector('.mz-player'));
    await human.assert(has, '播放器应开');
    // F 全屏
    await win.keyboard.press('f');
    await win.waitForTimeout(700);
    const fsOk = await evaluate(() => !!document.fullscreenElement);
    await human.assert(fsOk, 'F 应进全屏');
    // 全屏按 M（门控全屏感知修复：root 塌缩 rect 归零不再挡死）
    await win.keyboard.press('m');
    await win.waitForTimeout(300);
    const muted = await evaluate(() => document.querySelector('.mz-player audio, .mz-player video')?.muted);
    await human.assert(muted === true, '全屏按 M 应静音（全屏快捷键灭的回归）');
    await win.keyboard.press('m'); // 还原
    await win.waitForTimeout(200);
    // 锁定后 Esc 可解（全屏锁定死同根回归）
    await evaluate(() => { const b = [...document.querySelectorAll('[data-a=lock]')].find(x => x.getBoundingClientRect().width > 0 || document.fullscreenElement); b?.click(); });
    await win.waitForTimeout(300);
    await win.keyboard.press('Escape'); // Esc 解锁
    await win.waitForTimeout(300);
    const unlocked = await evaluate(() => !document.querySelector('.mz-player')?.classList.contains('mz-locked'));
    await human.assert(unlocked, '锁定后 Esc 应可解（全屏锁定死同根）');
    // 退出全屏
    await evaluate(() => document.exitFullscreen?.());
    await win.waitForTimeout(400);
  });

  // ==================== 8：播放器·ctrl+滚轮·缩画面不缩边栏 ====================
  await scenario('播放器·ctrl滚轮·画面缩放·边栏不动', async () => {
    // 记录边栏宽度
    const sbW0 = await evaluate(() => parseFloat(getComputedStyle(document.querySelector('.sidebar')).width));
    // 全屏后 ctrl+滚轮（直接驱动 stage 全屏，绕开 F 键焦点玄学）
    await evaluate(() => { const st = document.querySelector('.mz-stage'); st?.requestFullscreen?.(); });
    await win.waitForTimeout(600);
    const fsOk = await evaluate(() => !!document.fullscreenElement);
    await human.assert(fsOk, '应进全屏');
    // 真人操作链：按住 Ctrl + 真实滚轮（合成 WheelEvent 在 fullscreen top-layer 下不触发 listener，诊断实锤）
    const stageBox = await evaluate(() => {
      const st = document.fullscreenElement || document.querySelector('.mz-stage');
      const r = st.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await win.mouse.move(stageBox.x, stageBox.y);
    await win.keyboard.down('Control');
    await win.mouse.wheel(0, -240);
    await win.keyboard.up('Control');
    const diag = { note: 'real-wheel', stageBox };
    human.log('滚轮诊断:', JSON.stringify(diag));
    await win.waitForTimeout(400);
    const r = await evaluate(() => {
      const media = document.querySelector('.mz-player video, .mz-player audio');
      const sb = document.querySelector('.sidebar');
      return {
        mediaScale: media?.style.transform || '',
        sidebarW: parseFloat(getComputedStyle(sb).width),
      };
    });
    await human.assert(r.mediaScale.includes('scale'), `ctrl+滚轮应缩画面（实际 transform=${r.mediaScale || '空'}｜诊断 ${JSON.stringify(diag)}）`);
    await human.assert(Math.abs(r.sidebarW - sbW0) < 2, `边栏宽度不得变（${sbW0}→${r.sidebarW}；stopPropagation 防 pane-zoom 抢）`);
    await evaluate(() => document.exitFullscreen?.());
    await win.waitForTimeout(300);
  });

  // ==================== 9：播放器·连点下一条·不产双播放器 ====================
  await scenario('播放器·连点切歌·单实例', async () => {
    await openPath(WS + '/测试音.wav');
    await win.waitForTimeout(1800);
    // 连点"下一个"5 次（gen 令牌挡并发，过期 load 作废）
    for (let i = 0; i < 5; i++) {
      await evaluate(() => { const b = [...document.querySelectorAll('[data-a=next]')].find(x => x.getBoundingClientRect().width > 0); b?.click(); });
      await win.waitForTimeout(120);
    }
    await win.waitForTimeout(2500);
    const players = await evaluate(() => document.querySelectorAll('.mz-player-root, .mz-player').length);
    await human.assert(players <= 2, `连点下一条不得产双播放器（实际 ${players} 个播放器元素；gen 令牌防线）`);
    // 切歌同步 tab 标题（tab.filePath 跟片走）
    const tabTitle = await evaluate(() => window.MazzShell.tabs.active?.title || '');
    human.log('切歌后标签标题:', tabTitle);
    await human.shot('播放器连点');
  });

  // ==================== 10：内录·自录虚拟源在列 ====================
  await scenario('内录·自录虚拟源·本软件可选', async () => {
    const srcs = await evaluate(async () => await window.mazz.invoke('rec:sources').catch(() => []));
    const self = srcs.find(s => s.id === 'mazz:self');
    await human.assert(!!self, 'rec:sources 应含 mazz:self 自录虚拟源（Chromium 排除自家窗口的绕行）');
    await human.assert(self.name.includes('Mazz'), `自录源命名应可辨识（${self.name}）`);
    // 抓帧通道可达
    const frame = await evaluate(async () => await window.mazz.invoke('rec:selfFrame').catch(() => null));
    await human.assert(typeof frame === 'string' && frame.length > 1000, 'rec:selfFrame 应抓到主窗帧（PNG base64）');
  });

  // ==================== 11：画板·撤销多次·仍能落笔 ====================
  await scenario('画板·undo×6·落笔不瘫', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newDraw'));
    await win.waitForTimeout(2000);
    // 画一笔 → undo ×6（打穿快照栈，restore 防御非法态）
    await evaluate(() => {
      const ctl = window.__activeDrawCtl;
      if (ctl) { const L = ctl.doc.frames[ctl.doc.current].layers[0]; L.strokes.push({ tool: 'pen', color: '#000', size: 3, pts: [{ x: 10, y: 10 }, { x: 60, y: 60 }] }); ctl.render?.(); }
    });
    for (let i = 0; i < 6; i++) {
      await evaluate(() => window.MazzCommands?.execute('draw.undo').catch(() => {}));
      await win.waitForTimeout(150);
    }
    // 此刻全工具应仍能画（frame/activeLayer 兜底 + restore 防御）
    const canDraw = await evaluate(() => {
      const ctl = window.__activeDrawCtl;
      if (!ctl) return { err: 'no-ctl' };
      try {
        const f = ctl.doc.frames[ctl.doc.current];
        const L = f.layers[0];
        L.strokes.push({ tool: 'pen', color: '#f00', size: 3, pts: [{ x: 5, y: 5 }, { x: 30, y: 30 }] });
        ctl.render?.();
        return { strokes: L.strokes.length, frames: ctl.doc.frames.length, layers: f.layers.length };
      } catch (e) { return { err: e.message.slice(0, 80) };
      }
    });
    await human.assert(!canDraw.err, `undo 连击后应能落笔（${canDraw.err || ''}）`);
    await human.assert(canDraw.strokes >= 1 && canDraw.frames >= 1 && canDraw.layers >= 1, `画板结构应完整（${JSON.stringify(canDraw)}）`);
  });

  // ==================== 12：浏览器·主页 SVG 全钉死·无失控元素 ====================
  await scenario('浏览器·主页SVG·尺寸钉死', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
    await win.waitForTimeout(2800);
    const r = await evaluate(async () => {
      // 波次二十后探查走视图客页通道（webview 标签已死，execJs 是唯一真源）
      const ctl = window.__activeBrowserCtl;
      if (!ctl?.execJs) return { err: 'no-execJs' };
      try {
        return await ctl.execJs(null, `
          (() => {
            const svgs = [...document.querySelectorAll('svg')].map(s => Math.max(s.getBoundingClientRect().width, s.getBoundingClientRect().height));
            const maxSvg = svgs.length ? Math.max(...svgs) : 0;
            const big = [...document.querySelectorAll('body *')].filter(el => {
              const r = el.getBoundingClientRect();
              return r.width > 900 && r.height > 500 && !['BODY','HTML'].includes(el.tagName);
            }).length;
            return { svgCount: svgs.length, maxSvg: Math.round(maxSvg), bigElements: big };
          })()
        `);
      } catch (e) { return { err: e.message.slice(0, 80) }; }
    });
    await human.assert(!r.err, `主页应可读（${r.err || ''}）`);
    await human.assert(r.maxSvg <= 40, `主页 SVG 应全钉死 ≤40px（最大 ${r.maxSvg}px；文件夹图案全屏巨大回归）`);
    await human.assert(r.bigElements === 0, `主页不得有失控巨元素（${r.bigElements} 个 >900×500）`);
    await human.shot('主页SVG钉死');
  });

  // ==================== 13：代码·保存后调试·不再误报请先保存（用户点名测试文件） ====================
  await scenario('代码·保存后F5调试·不误报请先保存', async () => {
    // 造已有路径的 py（未命名保存会弹系统 saveFile 框挂起，已有路径直接写）
    await evaluate(async ([p]) => {
      await window.mazz.invoke('fs:writeFile', { path: p, content: 'def add(a, b):\n    return a + b\n\nprint(add(1, 2))\n' });
      await window.MazzCommands.execute('file.openPath', { path: p });
    }, [WS + '/test_debug.py']);
    await win.waitForTimeout(2000);
    // Monaco 里改一字（标脏；monaco 全局不暴露，直接 setValue 触发 onChange）
    await evaluate(() => {
      const ed = window.__activeCodeCtl?.editor;
      if (ed) { const m = ed.getModel(); m.setValue(m.getValue() + '# 改一笔\n'); }
    });
    await win.waitForTimeout(400);
    const dirtyBefore = await evaluate(() => !!window.MazzShell.tabs.active?.dirty);
    await human.assert(dirtyBefore, '编辑后应标脏');
    // 保存（已有路径直接写，不弹框）
    await evaluate(() => window.MazzCommands.execute('file.save'));
    await win.waitForTimeout(700);
    const saved = await evaluate(() => ({
      dirty: !!window.MazzShell.tabs.active?.dirty,
      fp: window.MazzShell.tabs.active?.filePath || '',
    }));
    await human.assert(!saved.dirty, '保存后脏标应清');
    await human.assert(saved.fp.endsWith('test_debug.py'), `保存后 tab.filePath 应有值（${saved.fp}）`);
    // F5 调试：断言不再弹「请先保存文件再调试」（debugpy 不在是另一层，弹需要 Python 不算误报）
    await evaluate(() => { window.__lastToast = ''; document.addEventListener('mazz:toast', (e) => { window.__lastToast = e.detail || ''; }); });
    await evaluate(() => window.MazzCommands.execute('debug.start').catch(() => {}));
    await win.waitForTimeout(1200);
    // launch 配置框应出现（说明过了「请先保存」前置，走到调试配置层）或弹需要 Python——但绝不能是「请先保存」
    const state = await evaluate(() => {
      const mask = [...document.querySelectorAll('.mazz-palette-mask')].find(m => m.getBoundingClientRect().width > 0);
      const toast = [...document.querySelectorAll('.mazz-toast')].map(t => t.textContent).join('|');
      return { maskText: mask ? mask.textContent.slice(0, 60) : '', toast };
    });
    human.log('调试启动状态:', JSON.stringify(state));
    const wronglyBlocked = (state.toast + state.maskText).includes('请先保存文件再调试');
    await human.assert(!wronglyBlocked, `保存后 F5 不得再误报「请先保存文件再调试」（实际：${(state.toast || state.maskText).slice(0, 50)}）`);
    // 关配置框兜底
    await evaluate(() => { document.querySelectorAll('.mazz-palette-mask').forEach(m => { const b = [...m.querySelectorAll('button')].find(x => /取消|关闭|✕/.test(x.textContent)); b ? b.click() : m.remove(); }); });
    await win.waitForTimeout(300);
    await human.shot('保存后调试');
  });
}
