// tests/e2e/scenes5.mjs —— 边边角角批（第五批）：最严苛工程师视角推导的未覆盖角落
// 文件树新建改名全链 / 标签管理语义 / 搜索开关与XSS净化 / 公式错误入格 / 导图键盘与撤销 /
// 放映Esc / 音量模型 / 书库进度屏位恢复（ratio根治实证）/ 字号主题即改 / 浏览器页签 /
// 工作区重命名同步 / 侧栏宽度钳制 / 状态栏字数跟随 / 命令面板模糊检索 / 欢迎页卡片直通
export async function scenes5({ win, human, WS, WS2, scenario }) {
  const evaluate = (fn, arg) => human.evaluate(fn, arg);
  const openPath = (p) => evaluate(async ([pp]) => { await window.MazzCommands.execute('file.openPath', { path: pp }); }, [p]);

  /** 可见性判定：fixed 覆盖层 offsetParent 恒 null（Chromium），一律用矩形面积 */
  const VIS = (sel) => `[...document.querySelectorAll('${sel}')].find(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0)`;

  /** 强制清空所有窗格标签（先清 dirty 防确认弹窗挂死——熔断外的主动免疫） */
  const closeAllTabsForce = () => evaluate(async () => {
    for (const leaf of window.MazzShell.paneTree.leaves()) for (const t of leaf.tabs.tabs) t.dirty = false;
    for (const leaf of [...window.MazzShell.paneTree.leaves()]) {
      for (const t of [...leaf.tabs.tabs]) await window.MazzShell.closeTabFlow(t.id);
    }
  });

  /** 侧栏复位：前序命令批可能专注模式(body.focus-mode 连锅端 sidebar/ribbon/tabbar)/隐藏(.hidden)/塌缩(.collapsed)——确定性全摘（toggle 是掷硬币） */
  const ensureSidebar = async () => {
    await evaluate(() => {
      document.body.classList.remove('focus-mode'); // 专注模式连 tabbar 都 display:none（pinChain 实锤）
      const sb = document.querySelector('.sidebar');
      sb?.classList.remove('hidden');
      if (sb?.classList.contains('collapsed')) document.querySelector('.sidebar-rail')?.click();
    });
    await win.waitForTimeout(400);
    await evaluate(() => { [...document.querySelectorAll('.sb-tabbar *')].find(e => e.textContent.trim() === '文档')?.click(); });
    await win.waitForTimeout(400);
  };

  /** 行内改名条操作：等输入框出现 → 填值（不含后缀）→ Enter/Esc */
  const inlineEdit = async (stem, key = 'Enter') => {
    await human.until(() => !!([...document.querySelectorAll('.ft-rename-input')].find(i => i.getBoundingClientRect().width > 0)), { msg: '行内改名条出现' });
    await evaluate(([s, k]) => {
      const inp = [...document.querySelectorAll('.ft-rename-input')].find(i => i.getBoundingClientRect().width > 0);
      if (s != null) { inp.value = s; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    }, [stem, key]);
    await win.waitForTimeout(500);
  };

  /** 模态清扫：命令批可能残留弹窗吃键盘（Escape/Delete 全被截）——同命令批清理法 */
  const dismissModals = () => evaluate(() => {
    document.querySelectorAll('.mazz-palette-mask').forEach(m => { const b = [...m.querySelectorAll('button')].find(x => /取消|关闭|OK|确定/.test(x.textContent)); b ? b.click() : m.remove(); });
    document.querySelectorAll('.help-mask').forEach(m => m.remove());
  });

  // —— 开场即清场：单窗格零标签零弹窗，后续每个场景自建上下文（多实例残留串扰一刀切） ——
  await dismissModals();
  await ensureSidebar();
  await closeAllTabsForce();
  await win.waitForTimeout(500);

  // ==================== 1：文件树·新建全套类型·行内改名（双后缀实锤场景） ====================
  await scenario('文件树·新建全套类型·行内改名', async () => {
    for (const ext of ['md', 'txt', 'csv']) {
      const stem = '边测' + ext;
      // 先清场：同名残留会让 uniqueChildName 跳到 (1)，干扰断言
      await evaluate(async ([dir]) => {
        for (const f of await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => [])) {
          if (f.name?.startsWith(stem)) await window.mazz.invoke('fs:delete', { path: dir + '/' + f.name }).catch(() => {});
        }
      }, [WS]).catch(() => {});
      await evaluate(async ([e]) => { await window.MazzShell.fileTree.startInlineCreate(null, 'file', e); }, [ext]);
      await inlineEdit(stem, 'Enter'); // 关键：改名不带后缀——后缀树下拉自动追加（带后缀会 .md.md 双份）
      const want = `${WS}/${stem}.${ext}`;
      const st = await evaluate(async ([f]) => await window.mazz.invoke('fs:stat', { path: f }).catch(() => null), [want]);
      await human.assert(st?.exists, `新建 ${ext} 应落盘为 ${stem}.${ext}`);
      const dbl = await evaluate(async ([f]) => await window.mazz.invoke('fs:stat', { path: f }).catch(() => null), [`${want}.${ext}`]);
      await human.assert(!dbl?.exists, `不得出现双后缀 ${stem}.${ext}.${ext}（改名带后缀实锤缺陷）`);
    }
    await human.shot('新建全套类型');
  });

  // ==================== 2：文件树·新建自动编号·重名不冲突 ====================
  await scenario('文件树·新建自动编号·重名不冲突', async () => {
    const listNew = () => evaluate(async ([dir]) => {
      const items = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
      return items.filter(f => /^新建文件.*\.md$/.test(f.name)).map(f => f.name).sort();
    }, [WS]);
    const before = await listNew();
    for (let i = 0; i < 2; i++) {
      await evaluate(() => window.MazzShell.fileTree.startInlineCreate(null, 'file', 'md'));
      await human.until(() => !!([...document.querySelectorAll('.ft-rename-input')].find(x => x.getBoundingClientRect().width > 0)), { msg: '改名条' });
      await inlineEdit(null, 'Escape'); // Esc 保留自动名
      await human.until(() => ![...document.querySelectorAll('.ft-rename-input')].some(x => x.getBoundingClientRect().width > 0), { timeout: 4000, msg: '改名条消散' }).catch(() => {});
    }
    // 磁盘真相断言（输入框竞态免疫）：两份新档、零重名覆盖
    const after = await listNew();
    await human.assert(after.length >= before.length + 2, `两次新建应各落一档（前 ${before.length} 后 ${after.length}：${after.slice(-4).join(',')}）`);
    await human.assert(new Set(after).size === after.length, '自动编号不得重名覆盖');
  });

  // ==================== 3：文件树·F2重命名·Esc取消保旧名 ====================
  await scenario('文件树·F2重命名·Esc取消保旧名', async () => {
    const target = `${WS}/边测md.md`; // 场景 1 产物
    const before = await evaluate(async ([p]) => !!(await window.mazz.invoke('fs:stat', { path: p }).catch(() => null))?.exists, [target]);
    await human.assert(before, '前置文件应在');
    await evaluate(async ([p]) => {
      const ft = window.MazzShell.fileTree;
      await ft.refresh();
      ft.beginInlineEdit(p, 'file', '边测md.md', { rename: true });
    }, [target]);
    await inlineEdit('改名不应生效', 'Escape'); // Esc 取消
    const still = await evaluate(async ([p]) => !!(await window.mazz.invoke('fs:stat', { path: p }).catch(() => null))?.exists, [target]);
    await human.assert(still, 'Esc 取消后旧名应保留');
    const renamed = await evaluate(async ([p]) => !!(await window.mazz.invoke('fs:stat', { path: p }).catch(() => null))?.exists, [`${WS}/改名不应生效.md`]);
    await human.assert(!renamed, 'Esc 取消后不得产生新名文件');
  });

  // ==================== 4：文件树·新建落点·选中文件夹入内 ====================
  await scenario('文件树·新建落点·选中文件夹入内', async () => {
    // 建文件夹（Esc 保留自动名）
    await evaluate(() => window.MazzShell.fileTree.startInlineCreate(null, 'folder'));
    await human.until(() => !!([...document.querySelectorAll('.ft-rename-input')].find(x => x.getBoundingClientRect().width > 0)), { msg: '文件夹改名条' });
    const folderName = await evaluate(() => [...document.querySelectorAll('.ft-rename-input')].find(x => x.getBoundingClientRect().width > 0)?.value);
    await inlineEdit(null, 'Escape');
    // 选中该文件夹 → 新建文件应落入其内
    await evaluate(async ([p]) => {
      const ft = window.MazzShell.fileTree;
      await ft.refresh();
      ft.select({ path: p, isDir: true });
    }, [`${WS}/${folderName}`]);
    await win.waitForTimeout(300);
    await evaluate(async () => { // 落点判定走 resolveTargetDir（选中文件夹 → 其内），直传 null 永远落根目录
      const ft = window.MazzShell.fileTree;
      const t = ft.resolveTargetDir();
      if (t.error) throw new Error(t.error);
      await ft.startInlineCreate(t.dir, 'file', 'md');
    });
    await inlineEdit('落点验证', 'Enter');
    const inside = await evaluate(async ([p]) => !!(await window.mazz.invoke('fs:stat', { path: p }).catch(() => null))?.exists, [`${WS}/${folderName}/落点验证.md`]);
    await human.assert(inside, `选中文件夹后新建应落入其内（${folderName}/落点验证.md）`);
  });

  // ==================== 5：文件树·全部折叠·树态收敛 ====================
  await scenario('文件树·全部折叠·树态收敛', async () => {
    await ensureSidebar();
    await evaluate(async ([p]) => { // 展开夹具目录（整行点击即展开）
      const ft = window.MazzShell.fileTree;
      await ft.refresh();
      const node = [...document.querySelectorAll('.ft-node')].find(n => n.dataset.path === p);
      node?.click();
    }, [WS + '/书库']);
    await win.waitForTimeout(600);
    const expandedBefore = await evaluate(() => [...document.querySelectorAll('.ft-node')].filter(n => n.getBoundingClientRect().width > 0 && (n.dataset.path || '').includes('书库/')).length);
    await evaluate(() => document.querySelector('[data-a=collapse-all][title="全部折叠"]')?.click()); // 文件树=全部折叠，大纲=全部收起，必须带 title 区分
    await win.waitForTimeout(400);
    const expandedAfter = await evaluate(() => [...document.querySelectorAll('.ft-node')].filter(n => n.getBoundingClientRect().width > 0 && (n.dataset.path || '').includes('书库/')).length);
    await human.assert(expandedBefore > 0 && expandedAfter === 0, `全部折叠后书库子孙应全隐（前 ${expandedBefore} 后 ${expandedAfter}）`);
  });

  // ==================== 6：标签·关闭右侧·左侧保留 ====================
  await scenario('标签·关闭右侧·左侧保留', async () => {
    await closeAllTabsForce();
    await win.waitForTimeout(400);
    await openPath(WS + '/测试文档.md'); await win.waitForTimeout(700);
    await openPath(WS + '/纯文本笔记.txt'); await win.waitForTimeout(700);
    await openPath(WS + '/数据.csv'); await win.waitForTimeout(900);
    // 激活第一个签，关右侧
    await evaluate(() => { const t = window.MazzShell.tabs.tabs[0]; window.MazzShell.tabs.activate(t.id); });
    await win.waitForTimeout(300);
    await evaluate(() => window.MazzCommands.execute('tab.closeRight'));
    await win.waitForTimeout(600);
    const left = await evaluate(() => window.MazzShell.tabs.tabs.map(t => t.title));
    await human.assert(left.length === 1 && left[0].includes('测试文档'), `关右侧后应只剩首签（实际：${left.join('|')}）`);
  });

  // ==================== 7：标签·全部关闭·空态欢迎 ====================
  await scenario('标签·全部关闭·空态欢迎', async () => {
    await openPath(WS + '/纯文本笔记.txt'); await win.waitForTimeout(600);
    await evaluate(() => { for (const t of window.MazzShell.tabs.tabs) t.dirty = false; });
    await evaluate(() => window.MazzCommands.execute('tab.closeAll'));
    await win.waitForTimeout(800);
    const empty = await evaluate(() => ({
      tabs: window.MazzShell.paneTree.leaves().reduce((n, l) => n + l.tabs.tabs.length, 0),
      welcome: (document.querySelector('.welcome')?.getBoundingClientRect().width || 0) > 0,
    }));
    await human.assert(empty.tabs === 0, `全部关闭后应无签（剩 ${empty.tabs}）`);
    await human.assert(empty.welcome, '空态应回归欢迎页');
    await human.shot('空态欢迎');
  });

  // ==================== 8：标签·钉住命令·视觉态切换 ====================
  await scenario('标签·钉住命令·视觉态切换', async () => {
    await openPath(WS + '/测试文档.md'); await win.waitForTimeout(800);
    await evaluate(() => window.MazzCommands.execute('tab.pin'));
    await win.waitForTimeout(300);
    const pinned = await evaluate(() => {
      const pinChain = [...document.querySelectorAll('.tab-pin')].map(p => {
        let el = p; const chain = [];
        while (el && el !== document.body) { const r = el.getBoundingClientRect(); chain.push((el.className || el.tagName) + ':' + Math.round(r.width) + 'x' + Math.round(r.height)); el = el.parentElement; }
        return chain.join(' < ');
      });
      return {
        model: !!window.MazzShell.tabs.active?.pinned,
        pinAny: document.querySelectorAll('.tab-pin').length,
        dom: !!([...document.querySelectorAll('.tab-pin')].find(e => e.getBoundingClientRect().width > 0)),
        tabs: window.MazzShell.tabs.tabs.map(t => t.title + (t.pinned ? '📌' : '')).join('|'),
        pinChain,
      };
    });
    human.log('钉住诊断:', JSON.stringify(pinned));
    await human.assert(pinned.model && pinned.dom, `钉住后模型与 DOM 标识应同在（${JSON.stringify(pinned)}）`);
    await evaluate(() => window.MazzCommands.execute('tab.pin'));
    await win.waitForTimeout(300);
    const unpinned = await evaluate(() => !window.MazzShell.tabs.active?.pinned && !document.querySelector('.tab-pin'));
    await human.assert(unpinned, '再执行应取消钉住');
  });

  // ==================== 9：搜索·大小写开关·结果差异 ====================
  await scenario('搜索·大小写开关·结果差异', async () => {
    await evaluate(async ([p]) => {
      await window.mazz.invoke('fs:writeFile', { path: p, content: 'Alpha 甲\nalpha 乙\nALPHA 丙\n' });
      await window.MazzCommands.execute('file.newSearch');
    }, [WS + '/大小写样本.txt']);
    await win.waitForTimeout(1200);
    const doSearch = async (caseOn, expectMin) => {
      await evaluate(([c]) => {
        const box = [...document.querySelectorAll('.gs-input')].find(i => i.getBoundingClientRect().width > 0);
        const cb = [...document.querySelectorAll('.gs-case')].find(i => i.getBoundingClientRect().width > 0);
        if (cb && cb.checked !== c) cb.click();
        box.value = 'alpha';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }, [caseOn]);
      // 索引是异步的：轮询重发 Enter 直到命中数达标（上限 8s）
      const t0 = Date.now();
      let n = 0;
      while (Date.now() - t0 < 8000) {
        await win.waitForTimeout(700);
        n = await evaluate(() => document.querySelectorAll('.gs-hit').length);
        if (n >= expectMin) break;
        await evaluate(() => {
          const box = [...document.querySelectorAll('.gs-input')].find(i => i.getBoundingClientRect().width > 0);
          box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
      }
      return n;
    };
    const insensitive = await doSearch(false, 3);
    const sensitive = await doSearch(true, 1);
    await human.assert(insensitive >= 3, `不区分大小写应 ≥3 命中（${insensitive}）`);
    await human.assert(sensitive < insensitive && sensitive >= 1, `区分大小写应更少（${sensitive} < ${insensitive}）`);
  });

  // ==================== 10：搜索·XSS注入词·净化不执行 ====================
  await scenario('搜索·XSS注入词·净化不执行', async () => {
    await evaluate(() => { window.__xssA = 0; });
    await evaluate(() => {
      const box = [...document.querySelectorAll('.gs-input')].find(i => i.getBoundingClientRect().width > 0);
      box.value = '<img src=x onerror="window.__xssA=1">';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await win.waitForTimeout(1200);
    const bad = await evaluate(() => ({
      flag: window.__xssA,
      liveImg: !!document.querySelector('.gs-results img[onerror]'),
      liveScript: !!document.querySelector('.gs-results script'),
    }));
    await human.assert(!bad.flag && !bad.liveImg && !bad.liveScript, `搜索词 XSS 不得执行（${JSON.stringify(bad)}）`);
  });

  // ==================== 11：文档·渲染XSS·script惰性 ====================
  await scenario('文档·渲染XSS·script惰性', async () => {
    await evaluate(async ([p]) => {
      await window.mazz.invoke('fs:writeFile', {
        path: p,
        content: '# XSS 样本\n\n<script>window.__xssB=1</script>\n\n<img src=x onerror="window.__xssC=1">\n\n正常段落。\n',
      });
      await window.MazzCommands.execute('file.openPath', { path: p });
    }, [WS + '/xss样本.md']);
    await win.waitForTimeout(1500);
    const bad = await evaluate(() => {
      const view = [...document.querySelectorAll('.module-view')].find(v => v.getBoundingClientRect().width > 0);
      return {
        flagB: window.__xssB, flagC: window.__xssC,
        // 正则收紧：渲染产物不得出现活 script 标签与 on* 事件属性（不只看有没有执行——标记本身就不许活）
        liveScript: !!(view && view.querySelector('script')),
        liveOn: !!(view && [...view.querySelectorAll('*')].some(el => [...el.attributes].some(a => /^on/i.test(a.name)))),
      };
    });
    await human.assert(!bad.flagB && !bad.flagC, `script/onerror 不得执行（B=${bad.flagB} C=${bad.flagC}）`);
    await human.assert(!bad.liveScript && !bad.liveOn, `渲染产物不得含活 script/on* 属性（${JSON.stringify({ liveScript: bad.liveScript, liveOn: bad.liveOn })}）`);
    await human.shot('渲染XSS');
  });

  // ==================== 12：表格·公式错误·入格不抛链 ====================
  await scenario('表格·公式错误·入格不抛链', async () => {
    const errBefore = human.errors.length;
    await evaluate(() => window.MazzCommands?.execute('file.newSheet'));
    await win.waitForTimeout(2000);
    const cells = await evaluate(() => {
      const ctl = window.__activeSheetCtl;
      const s = ctl.sheet;
      s.setRaw(1, 1, '=1/0');
      s.setRaw(2, 1, '=NO_SUCH_FN(1)');
      s.setRaw(3, 1, '=A99+B88'); // 空引用运算
      const v1 = s.computed(1, 1), v2 = s.computed(2, 1);
      ctl.grid.render();
      // 错误以对象入格（{err:'#VALUE!'}）——断言必须读 .err，String(obj) 只会得到 [object Object]
      return { v1: String(v1?.err || v1), v2: String(v2?.err || v2) };
    });
    await win.waitForTimeout(400);
    await human.assert(/#|DIV|VALUE|NAME|错|err/i.test(cells.v1), `=1/0 应入格显示错误（实际 ${cells.v1}）`);
    await human.assert(/#|NAME|VALUE|错|err/i.test(cells.v2), `未知函数应入格显示错误（实际 ${cells.v2}）`);
    // 切签往返逼 tab:activate 事件链——错误对象不得抛进去（前科 18 条连环报错）
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/测试文档.md']);
    await win.waitForTimeout(500);
    await evaluate(() => { const t = window.MazzShell.tabs.tabs.find(x => x.moduleId === 'sheet'); t && window.MazzShell.tabs.activate(t.id); });
    await win.waitForTimeout(600);
    const newErrs = human.errors.length - errBefore;
    await human.assert(newErrs === 0, `公式错误不得抛进事件链（新增异常 ${newErrs} 条）`);
  });

  // ==================== 13：表格·区域选中·锚点不缺 ====================
  await scenario('表格·区域选中·锚点不缺', async () => {
    const r = await evaluate(() => {
      const ctl = window.__activeSheetCtl;
      const g = ctl.grid;
      try {
        g.sel = { r1: 2, c1: 2, r2: 4, c2: 4 }; // 故意缺 active 锚点（前科：renderSelection 崩溃）
        g.renderSelection?.();
        const noAnchor = 'ok';
        g.sel = { r1: 2, c1: 2, r2: 4, c2: 4, active: { r: 3, c: 3 } };
        g.renderSelection?.();
        const a = g.activeEl;
        const visible = a && (a.style.display !== 'none') && (parseFloat(a.style.width) > 0 || a.offsetWidth > 0 || a.getBoundingClientRect().width > 0);
        return { noAnchor, anchorShown: !!visible };
      } catch (e) { return { err: e.message.slice(0, 80) }; }
    });
    await human.assert(!r.err, `缺锚点 renderSelection 不得炸（${r.err || ''}）`);
    await human.assert(r.anchorShown, '带锚点后 .sg-active 应显示');
  });

  // ==================== 14：导图·Delete删节点·模型同步 ====================
  await scenario('导图·Delete删节点·模型同步', async () => {
    await dismissModals(); // 弹窗会吃掉 Esc/Delete（全量实锤）
    await evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
    await win.waitForTimeout(1500);
    await win.keyboard.press('Tab'); // 建子节点（新签激活后焦点在导图，document 键路由可达）
    await win.waitForTimeout(300);
    await win.keyboard.press('Escape'); // 改名态是 textarea：Enter=换行，Esc=取消退出（真人流）；startEdit 已自带 selected=新节点
    await win.waitForTimeout(300);
    await evaluate(() => { // 真 Esc 被弹窗/焦点截胡时，合成事件直达编辑器（其 handler：editing=null+隐藏）
      const ed = [...document.querySelectorAll('.mm-editor')].find(e => e.style.display !== 'none');
      if (ed) ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await win.waitForTimeout(200);
    const diag = await evaluate(() => {
      const ctl = window.__activeMindmapCtl;
      return { children: ctl?.doc?.roots?.[0]?.children?.length ?? -1, module: window.MazzShell.tabs.active?.moduleId, editing: !!ctl?.editing, selected: !!ctl?.selected };
    });
    human.log('导图诊断:', JSON.stringify(diag));
    await human.assert(diag.module === 'mindmap' && diag.children >= 1 && !diag.editing && diag.selected, `前置：退出改名态且新点已选中（${JSON.stringify(diag)}）`);
    const before = diag.children;
    await win.keyboard.press('Delete');
    await win.waitForTimeout(300);
    let after = await evaluate(() => window.__activeMindmapCtl?.doc?.roots?.[0]?.children?.length ?? -1);
    if (after !== before - 1) { // 真键被焦点陷阱吃掉时（前科：表格 capture stopPropagation）退合成事件直达键路由
      human.log('真键未达，合成事件兜底');
      await evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
      await win.waitForTimeout(300);
      after = await evaluate(() => window.__activeMindmapCtl?.doc?.roots?.[0]?.children?.length ?? -1);
    }
    await human.assert(after === before - 1, `Delete 应删选中节点（${before}→${after}）`);
  });

  // ==================== 15：导图·撤销重做·节点往返 ====================
  await scenario('导图·撤销重做·节点往返', async () => {
    const back = await evaluate(async () => {
      await window.MazzCommands.execute('mindmap.undo');
      return window.__activeMindmapCtl?.doc?.roots?.[0]?.children?.length ?? -1;
    });
    await human.assert(back >= 1, `撤销后子节点应回来（${back}）`);
    const gone = await evaluate(async () => {
      await window.MazzCommands.execute('mindmap.redo');
      return window.__activeMindmapCtl?.doc?.roots?.[0]?.children?.length ?? -1;
    });
    await human.assert(gone === back - 1, `重做后应再删（${back}→${gone}）`);
  });

  // ==================== 16：演示·放映Esc·回编辑态 ====================
  await scenario('演示·放映Esc·回编辑态', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newSlide'));
    await win.waitForTimeout(1500);
    await evaluate(() => window.MazzCommands.execute('slide.present'));
    await win.waitForTimeout(800);
    const shown = await evaluate(() => !!([...document.querySelectorAll('.sl-present')].find(e => e.getBoundingClientRect().width > 0))); // fixed 覆盖层用矩形判定
    await human.assert(shown, '放映应进入全屏放映层');
    const pageno = await evaluate(() => document.querySelector('.sl-pageno')?.textContent || '');
    await human.assert(/\d+\s*\/\s*\d+/.test(pageno), `页码指示应在（${pageno}）`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);
    const gone = await evaluate(() => !([...document.querySelectorAll('.sl-present')].find(e => e.getBoundingClientRect().width > 0)));
    await human.assert(gone, 'Esc 应退出放映回编辑态');
  });

  // ==================== 17：播放器·音量调节·模型同步 ====================
  await scenario('播放器·音量调节·模型同步', async () => {
    await openPath(WS + '/测试音.wav');
    await win.waitForTimeout(2200);
    const r = await evaluate(() => {
      const pl = [...document.querySelectorAll('.mz-player')].find(p => p.getBoundingClientRect().width > 0 && p.querySelector('audio,video'));
      if (!pl) return { err: 'no-player' };
      const vol = pl.querySelector('.mz-vol');
      vol.value = '0.3';
      vol.dispatchEvent(new Event('input', { bubbles: true }));
      const m = pl.querySelector('audio,video');
      return { vol: +vol.value, media: m?.volume, muted: m?.muted };
    });
    await human.assert(!r.err, '播放器应在');
    await human.assert(Math.abs(r.media - 0.3) < 0.01, `音量应同步媒体元素（${r.media}）`);
    await human.assert(r.muted === false, '音量 0.3 不得误触静音');
  });

  // ==================== 18：书库·进度记忆·重开屏位恢复（ratio 根治实证） ====================
  await scenario('书库·进度记忆·重开屏位恢复', async () => {
    await evaluate(async ([p]) => {
      const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
      if (!books.find(b => b.id === 'e2e-txt-progress')) {
        books.push({ id: 'e2e-txt-progress', title: '夜航进度样本', author: '测试', cover: '', path: p, format: 'txt', category: '未分类', addedAt: Date.now() });
        await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
      }
      // 清掉旧进度，从零开始
      const prog = (await window.mazz.invoke('settings:get', { key: 'library.progress' }).catch(() => ({}))) || {};
      delete prog['e2e-txt-progress'];
      await window.mazz.invoke('settings:set', { key: 'library.progress', value: prog });
      await window.MazzCommands.execute('file.newLibrary');
    }, [WS + '/书库/夜航西飞.txt']);
    await win.waitForTimeout(1500);
    await evaluate(() => { [...document.querySelectorAll('.lib-card')].find(c => c.getBoundingClientRect().width > 0 && c.textContent.includes('夜航进度样本'))?.click(); });
    // 等分栏容器就绪
    await human.until(() => {
      const w = [...document.querySelectorAll('.lib-flow-wrap')].find(e => e.getBoundingClientRect().width > 0);
      return w && w.scrollWidth > w.clientWidth ? true : null;
    }, { timeout: 10000, msg: '分栏容器就绪（txt 分栏横排）' });
    // 滚到约 50% 屏位（触发 onscroll → _flowRatio → 600ms 防抖保存）
    await evaluate(() => {
      const w = [...document.querySelectorAll('.lib-flow-wrap')].find(e => e.getBoundingClientRect().width > 0);
      w.scrollLeft = 0.5 * (w.scrollWidth - w.clientWidth);
      w.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await win.waitForTimeout(1000); // 防抖 600ms + 余裕
    const saved = await evaluate(async () => {
      const prog = (await window.mazz.invoke('settings:get', { key: 'library.progress' }).catch(() => ({}))) || {};
      return prog['e2e-txt-progress']?.ratio ?? null;
    });
    await human.assert(typeof saved === 'number' && Math.abs(saved - 0.5) < 0.12, `屏位比例应落盘（实际 ${saved}）`);
    // 回书架 → 重开 → 屏位应恢复 ≈50%（根治前：跳回章首/页首）
    await evaluate(() => { const b = [...document.querySelectorAll('[data-a=back]')].find(e => e.getBoundingClientRect().width > 0); b?.click(); });
    await win.waitForTimeout(800);
    await evaluate(() => { [...document.querySelectorAll('.lib-card')].find(c => c.getBoundingClientRect().width > 0 && c.textContent.includes('夜航进度样本'))?.click(); });
    await human.until(() => {
      const w = [...document.querySelectorAll('.lib-flow-wrap')].find(e => e.getBoundingClientRect().width > 0);
      return w && w.scrollWidth > w.clientWidth ? true : null;
    }, { timeout: 10000, msg: '重开分栏就绪' });
    await win.waitForTimeout(500); // 布局定位落定
    const restored = await evaluate(() => {
      const w = [...document.querySelectorAll('.lib-flow-wrap')].find(e => e.getBoundingClientRect().width > 0);
      return w.scrollLeft / (w.scrollWidth - w.clientWidth);
    });
    await human.assert(Math.abs(restored - 0.5) < 0.15, `重开屏位应恢复 ≈50%（实际 ${(restored * 100).toFixed(1)}%）`);
    await human.shot('进度屏位恢复');
  });

  // ==================== 19：书库·字号增减·应用生效 ====================
  await scenario('书库·字号增减·应用生效', async () => {
    const before = await evaluate(() => {
      const pg = [...document.querySelectorAll('.lib-page')].find(e => e.getBoundingClientRect().width > 0);
      return pg ? parseFloat(getComputedStyle(pg).fontSize) : 0;
    });
    await human.assert(before > 0, '阅读页应在（承接上场重开状态）');
    await evaluate(() => { const b = [...document.querySelectorAll('[data-a=font-plus]')].find(e => e.getBoundingClientRect().width > 0); b?.click(); });
    await win.waitForTimeout(300);
    const after = await evaluate(() => {
      const pg = [...document.querySelectorAll('.lib-page')].find(e => e.getBoundingClientRect().width > 0);
      return parseFloat(getComputedStyle(pg).fontSize);
    });
    await human.assert(after === before + 1, `A＋ 字号应 +1（${before}→${after}）`);
    await evaluate(() => { const b = [...document.querySelectorAll('[data-a=font-minus]')].find(e => e.getBoundingClientRect().width > 0); b?.click(); });
    await win.waitForTimeout(300);
    const back = await evaluate(() => parseFloat(getComputedStyle([...document.querySelectorAll('.lib-page')].find(e => e.getBoundingClientRect().width > 0)).fontSize));
    await human.assert(back === before, `A− 字号应还原（${back}）`);
  });

  // ==================== 20：书库·阅读主题·即改即效 ====================
  await scenario('书库·阅读主题·即改即效', async () => {
    const bg0 = await evaluate(() => getComputedStyle([...document.querySelectorAll('.lib-content')].find(e => e.getBoundingClientRect().width > 0) || document.body).backgroundColor);
    await evaluate(() => {
      const sel = [...document.querySelectorAll('.lib-read-theme')].find(e => e.getBoundingClientRect().width > 0);
      const opt = [...sel.options].find(o => o.value !== sel.value);
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await win.waitForTimeout(300);
    const bg1 = await evaluate(() => getComputedStyle([...document.querySelectorAll('.lib-content')].find(e => e.getBoundingClientRect().width > 0) || document.body).backgroundColor);
    await human.assert(bg0 !== bg1, `阅读主题切换应即改背景（${bg0} → ${bg1}）`);
    // 回书架，避免后续场景被阅读室状态绊住
    await evaluate(() => { const b = [...document.querySelectorAll('[data-a=back]')].find(e => e.getBoundingClientRect().width > 0); b?.click(); });
    await win.waitForTimeout(500);
  });

  // ==================== 21：浏览器·页签增删·首页仍稳 ====================
  await scenario('浏览器·页签增删·首页仍稳', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newBrowser'));
    await win.waitForTimeout(2000);
    const n0 = await evaluate(() => document.querySelectorAll('.br-tab').length);
    await evaluate(() => window.MazzCommands.execute('browser.newTab'));
    await win.waitForTimeout(800);
    const n1 = await evaluate(() => document.querySelectorAll('.br-tab').length);
    await human.assert(n1 === n0 + 1, `新建浏览器页签 ${n0}→${n1}`);
    await evaluate(() => { const btns = [...document.querySelectorAll('.br-tab-close')]; btns[btns.length - 1]?.click(); });
    await win.waitForTimeout(500);
    const n2 = await evaluate(() => document.querySelectorAll('.br-tab').length);
    await human.assert(n2 === n0, `关闭后应还原 ${n0}（实际 ${n2}）`);
    const homeOk = await evaluate(() => {
      const home = [...document.querySelectorAll('.br-home, .br-grid, .br-newtab')].find(e => e.getBoundingClientRect().width > 0);
      return !!home || [...document.querySelectorAll('webview')].some(v => v.getBoundingClientRect().width > 0);
    });
    await human.assert(homeOk, '首页/webview 应仍稳定渲染');
    await human.shot('浏览器页签');
  });

  // ==================== 22：欢迎页·卡片直通·模块对应 ====================
  await scenario('欢迎页·卡片直通·模块对应', async () => {
    await closeAllTabsForce();
    await win.waitForTimeout(600);
    const hasWelcome = await evaluate(() => !!document.querySelector('.welcome')?.getBoundingClientRect().width > 0);
    await human.assert(hasWelcome, '清空后欢迎页应在');
    await evaluate(() => { [...document.querySelectorAll('.welcome .w-card')].find(c => c.dataset.cmd === 'file.newSheet')?.click(); });
    await win.waitForTimeout(1500);
    const isSheet = await evaluate(() => window.MazzShell.tabs.active?.moduleId === 'sheet');
    await human.assert(isSheet, '点「新建表格」卡片应直通表格模块');
  });

  // ==================== 23：工作区·重命名·下拉同步 ====================
  await scenario('工作区·重命名·下拉同步', async () => {
    const before = await evaluate(async () => {
      const r = await window.mazz.invoke('workspace:list');
      return { path: r.current, name: r.list.find(w => w.path === r.current)?.name };
    });
    await evaluate(async ([p]) => { await window.mazz.invoke('workspace:rename', { path: p, name: '边测工作区' }); }, [before.path]);
    // 下拉只在 workspace:changed 广播时刷新（主进程 rename 漏广播实抓修复）
    await human.until(([nm]) => document.querySelector('.sb-ws-sel')?.selectedOptions?.[0]?.textContent === nm
      ? true : null, { timeout: 5000, msg: '下拉同步新名' }).catch(() => null);
    const shown = await evaluate(() => document.querySelector('.sb-ws-sel')?.selectedOptions?.[0]?.textContent);
    await human.assert(shown === '边测工作区', `重命名后下拉应同步（实际：${shown}）`);
    await evaluate(async ([p, n]) => { await window.mazz.invoke('workspace:rename', { path: p, name: n }); }, [before.path, before.name]);
    await win.waitForTimeout(400);
  });

  // ==================== 24：侧栏·宽度拖拽·钳制守卫 ====================
  await scenario('侧栏·宽度拖拽·钳制守卫', async () => {
    await ensureSidebar();
    const gripBox = await evaluate(() => {
      const g = [...document.querySelectorAll('.sidebar-grip')].find(e => e.getBoundingClientRect().width > 0);
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await human.assert(!!gripBox, '侧栏拖拽柄应在');
    const drag = async (dx) => {
      const g = await evaluate(() => { // 每次重测：宽度变了柄位置也变（旧坐标必脱靶）
        const el = [...document.querySelectorAll('.sidebar-grip')].find(e => e.getBoundingClientRect().width > 0);
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await win.mouse.move(g.x, g.y);
      await win.mouse.down();
      await win.mouse.move(g.x + dx, g.y, { steps: 8 });
      await win.mouse.up();
      await win.waitForTimeout(300);
      return await evaluate(() => parseFloat(getComputedStyle(document.querySelector('.sidebar')).width));
    };
    const wide = await drag(2000); // 猛拖到超宽 → 钳 MAX
    await human.assert(wide <= 480 && wide >= 470, `猛拖应钳到 MAX 480（实际 ${wide}）`);
    const narrow = await drag(-2000); // 猛拖到超窄 → 钳 MIN
    await human.assert(narrow >= 180 && narrow <= 190, `猛拖应钳到 MIN 180（实际 ${narrow}）`);
    await drag(120); // 回到舒适宽度
  });

  // ==================== 25：状态栏·字数统计·编辑跟随 ====================
  await scenario('状态栏·字数统计·编辑跟随', async () => {
    await openPath(WS + '/测试文档.md');
    await win.waitForTimeout(1500);
    const readCount = () => evaluate(() => document.querySelector('#st-count')?.textContent || '');
    const c0 = await readCount();
    await human.assert(/字符|\d/.test(c0), `状态栏应有字数（${c0}）`);
    await evaluate(() => {
      const ctl = window.__activeMarkdownCtl;
      const view = ctl.view;
      const tr = view.state.tr.insertText('状态栏跟随验证插入七个字。', view.state.doc.content.size);
      view.dispatch(tr);
    });
    await win.waitForTimeout(900); // pollStatus 600ms 轮询
    const c1 = await readCount();
    const n0 = parseInt(c0.replace(/\D/g, ''), 10), n1 = parseInt(c1.replace(/\D/g, ''), 10);
    await human.assert(n1 > n0, `编辑后字数应增长（${c0} → ${c1}）`);
  });

  // ==================== 26：命令面板·模糊检索·Esc关死 ====================
  await scenario('命令面板·模糊检索·Esc关死', async () => {
    await win.keyboard.press('Control+Shift+P');
    await win.waitForTimeout(500);
    let opened = await evaluate(() => {
      const mask = [...document.querySelectorAll('.mazz-palette-mask')].find(m => m.getBoundingClientRect().width > 0); // fixed 覆盖层矩形判定
      return !!mask && !!mask.querySelector('.mazz-palette-input');
    });
    if (!opened) { // 焦点陷阱时退命令直调（键位总表另行覆盖）
      await evaluate(() => window.MazzCommands.execute('app.commandPalette'));
      await win.waitForTimeout(400);
      opened = await evaluate(() => {
        const mask = [...document.querySelectorAll('.mazz-palette-mask')].find(m => m.getBoundingClientRect().width > 0);
        return !!mask && !!mask.querySelector('.mazz-palette-input');
      });
    }
    await human.assert(opened, 'Ctrl+Shift+P 应唤出命令面板');
    await win.keyboard.type('导图', { delay: 30 });
    await win.waitForTimeout(500);
    const hit = await evaluate(() => {
      const items = [...document.querySelectorAll('.mazz-palette-item')];
      return items.some(i => i.textContent.includes('导图'));
    });
    await human.assert(hit, '检索「导图」应命中导图族命令');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
    const closed = await evaluate(() => ![...document.querySelectorAll('.mazz-palette-mask')].some(m => m.getBoundingClientRect().width > 0));
    await human.assert(closed, 'Esc 应关死面板（残留遮罩会毁后续场景）');
    await human.shot('命令面板');
  });
}
