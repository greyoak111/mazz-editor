// tests/e2e/scenes71.mjs —— W60a 本地 mock 全链实证
export async function scenes71({ win, human, WS, scenario, shotDir }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  await scenario('META·完整蓝图直过', async () => {
    await evaluate(async () => {
      await window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'mock://w60a', model: 'w60a-local' } });
      await window.mazz.invoke('secret:set', { key: 'factory.apiKey', value: 'local-test-key' });
      const t = document.querySelector('.sd-tab[data-t=factory]');
      if (t) t.click(); else window.MazzCommands?.execute('factory.toggleDock');
    });
    await wait(800);
    const ready = await evaluate(() => {
      const sel = document.querySelector('.fc-genre');
      const opt = [...(sel?.options || [])].find(o => /财务报告/.test(o.textContent));
      if (!sel || !opt) return false;
      sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    await human.assert(ready, 'META 直过文体必须存在');
    await wait(300);
    await evaluate(() => {
      const put = (id, value) => { const el = document.querySelector(`[data-f="${id}"]`); if (el) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); } };
      put('title', 'META直过报告'); put('period', '2026年8月'); put('data_notes', '模拟台架记录');
      const mm = document.querySelector('.fc-maxmode'); if (mm && !mm.checked) mm.click();
      const mc = document.querySelector('.fc-maxchapters'); if (mc) { mc.value = '1'; mc.dispatchEvent(new Event('input', { bubbles: true })); }
      document.querySelector('[data-a=addtask]')?.click();
    });
    await wait(200);
    await evaluate(() => { const cb = [...document.querySelectorAll('.fc-task input[type=checkbox]')].at(-1); if (cb) cb.checked = true; document.querySelector('[data-a=startsel]')?.click(); });
    await human.until(async () => {
      const ws = await window.mazz.invoke('workspace:get');
      const path = ws + '/创作产出/META直过报告/task_state.json';
      const stat = await window.mazz.invoke('fs:stat', { path }).catch(() => null);
      if (!stat?.exists || stat.isDir) return false;
      const raw = await window.mazz.invoke('fs:readFile', { path }).catch(() => '');
      try { return JSON.parse(raw).status === 'done'; } catch { return false; }
    }, { timeout: 15000, msg: 'META 直过状态落盘' });
    const bp = await evaluate(async ws => window.mazz.invoke('fs:readFile', { path: ws + '/创作产出/META直过报告/创作蓝图.md' }), WS);
    await human.assert(bp.includes('META直过报告结构蓝图') && !bp.includes('兜底'), '完整 META 蓝图必须一次直过，不可误走兜底');
  });

  await scenario('META·三败兜底+11节全链+纠偏闸', async () => {
    await evaluate(async () => {
      await window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'mock://w60a', model: 'w60a-local' } });
      await window.mazz.invoke('secret:set', { key: 'factory.apiKey', value: 'local-test-key' });
      const t = document.querySelector('.sd-tab[data-t=factory]');
      if (t) t.click(); else window.MazzCommands?.execute('factory.toggleDock');
    });
    await wait(1200);
    const ready = await evaluate(() => {
      const sel = document.querySelector('.fc-genre');
      const opt = [...(sel?.options || [])].find(o => /财务报告/.test(o.textContent));
      if (!sel || !opt) return false;
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    await human.assert(ready, '财务报告文体必须存在');
    await wait(500);
    await evaluate(() => {
      const put = (id, value) => {
        const el = document.querySelector(`[data-f="${id}"]`);
        if (!el) return;
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      put('title', 'W60a实验报告');
      put('period', '2026年8月');
      put('data_notes', '模拟台架连续测量11节，统一采用样本口径。');
      const mm = document.querySelector('.fc-maxmode'); if (mm && !mm.checked) mm.click();
      const mc = document.querySelector('.fc-maxchapters'); if (mc) { mc.value = '11'; mc.dispatchEvent(new Event('input', { bubbles: true })); }
      document.querySelector('[data-a=addtask]')?.click();
    });
    await wait(300);
    await evaluate(() => {
      const cb = [...document.querySelectorAll('.fc-task input[type=checkbox]')].at(-1);
      if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      document.querySelector('[data-a=startsel]')?.click();
    });
    await human.until(async () => {
      const ws = await window.mazz.invoke('workspace:get');
      const path = ws + '/创作产出/W60a实验报告/task_state.json';
      const stat = await window.mazz.invoke('fs:stat', { path }).catch(() => null);
      if (!stat?.exists || stat.isDir) return false;
      const raw = await window.mazz.invoke('fs:readFile', { path }).catch(() => '');
      try { const state = JSON.parse(raw); return state.status === 'done' && state.currentChapter === 11; } catch { return false; }
    }, { timeout: 40000, msg: 'W60a mock 11节状态落盘' });

    const evidence = await evaluate(async (ws) => {
      const root = ws + '/创作产出/W60a实验报告';
      const files = await window.mazz.invoke('fs:listDir', { path: root });
      const names = files.map(f => f.name);
      const read = n => window.mazz.invoke('fs:readFile', { path: root + '/' + n });
      const bpName = names.find(n => n === '创作蓝图.md');
      const lastName = names.find(n => /第0*11节\.md$/.test(n));
      const snapName = names.find(n => /结构状态快照_第0*11节后/.test(n));
      return {
        root, names, bp: await read(bpName), last: await read(lastName), snap: await read(snapName),
        log: [...document.querySelectorAll('.fc-log')].map(el => el.textContent || '').join('\n'),
      };
    }, WS);
    await human.assert(evidence.bp.includes('结构蓝图（兜底）') && evidence.bp.includes('任务目标'), '三败后必须落 META 兜底蓝图');
    await human.assert(evidence.names.filter(n => /第0*\d+节\.md$/.test(n)).length === 11, '必须落盘 11 节');
    await human.assert(!evidence.last.includes('本次续写字数'), 'TOKEN 声明是协议元数据，不得污染最终正文');
    for (const key of ['要点台账', '术语与数据一致性', '论据与引用台账', '结构完成度']) {
      await human.assert(evidence.snap.includes(key), '结构快照缺 ' + key);
    }
    await human.assert(evidence.log.includes('第 11 节开写前启动纠偏闸'), '每10节纠偏必须真接入下一节');
    await evaluate((p) => window.MazzShell?.openFile?.(p), evidence.root + '/结构状态快照_第011节后.md');
    await wait(900);
    await evaluate(() => document.querySelector('#agree-close, #agree-accept')?.click());
    await wait(300);
    const visibleText = await evaluate(() => [...document.querySelectorAll('.ProseMirror, .editor-area')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map(el => el.textContent || '').join('\n'));
    await human.assert(visibleText.includes('要点台账') && visibleText.includes('结构完成度'), '截图前必须确认最终结构快照正文可见');
    await win.screenshot({ path: shotDir + '/w60a-expository-snapshot.png' });
  });
}
