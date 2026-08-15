// tests/e2e/scenes66.mjs —— W60v 验货批（对照表「九成复刻」真 API 彻验——货不对板清查）
export async function scenes66({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const KEY = String(process.env.MAZZ_E2E_DEEPSEEK_API_KEY || '').trim();
  if (!KEY) throw new Error('scenes66 需要通过 MAZZ_E2E_DEEPSEEK_API_KEY 注入测试密钥');

  // ==================== 1：provider 配置+API 探活 ====================
  await scenario('配置·DeepSeek 真 key 探活', async () => {
    await evaluate(async (k) => {
      await window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-flash' } });
      await window.mazz.invoke('secret:set', { key: 'factory.apiKey', value: k });
    }, KEY);
    let ping = '', tries = 0;
    for (const model of ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-v4-flash']) {
      tries++;
      ping = await evaluate(async (m) => {
        const k = (await window.mazz.invoke('secret:get', { key: 'factory.apiKey' }).catch(() => '')) || '';
        return await window.mazz.invoke('factory:aiChat', {
          baseURL: 'https://api.deepseek.com', apiKey: k, model: m,
          system: '', user: '只回一个字：好', temperature: 0, maxTokens: 8,
        }).catch(e => 'ERR:' + e.message);
      }, model);
      if (typeof ping === 'string' && ping.length > 0 && !ping.startsWith('ERR:')) break;
      await wait(10000);
    }
    human.log('API 探活:', JSON.stringify(ping).slice(0, 120), '尝试', tries);
    await human.assert(typeof ping === 'string' && ping.length > 0 && !ping.startsWith('ERR:'), `API 必须通（实拿 ${JSON.stringify(ping)?.slice(0, 90)}，尝试 ${tries} 次）`);
  });

  // ==================== 2：网文短篇全链执行+磁盘验货 ====================
  await scenario('任务·网文短篇全链执行', async () => {
    await evaluate(() => {
      const t = document.querySelector('.sd-tab[data-t=factory]');
      if (t) t.click();
      else window.MazzCommands?.execute('factory.toggleDock');
    });
    await wait(2200);
    const form = await evaluate(() => {
      const sel = document.querySelector('.fc-genre');
      if (!sel) return { noSel: true };
      const opts = [...sel.options].map(o => ({ v: o.value, t: o.textContent }));
      const pick = opts.find(o => /小说|网文|novel/i.test(o.t)) || opts[0];
      sel.value = pick.v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { picked: pick.t, opts: opts.length };
    });
    human.log('文体选择:', JSON.stringify(form));
    await human.assert(!form.noSel, '工厂文体选单必须在');
    await wait(1400);
    const filled = await evaluate(() => {
      let n = 0;
      const put = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); n++; };
      document.querySelectorAll('.fc-form input[type=text], .fc-form textarea, .fc-form input:not([type])').forEach(el => {
        const key = (el.dataset.f || el.placeholder || '').toString();
        put(el, /书名|标题|title|主题|名称/i.test(key) ? '雾都灯塔' : '都市怪谈·市井微光');
      });
      document.querySelectorAll('.fc-form input[type=number]').forEach(el => {
        const f = (el.dataset.f || el.placeholder || '').toString();
        put(el, /章|chapter/i.test(f) ? '2' : '700');
      });
      document.querySelectorAll('.fc-form select').forEach(el => { if (el.options.length > 1 && !el.value) { el.value = el.options[1].value; el.dispatchEvent(new Event('change', { bubbles: true })); n++; } });
      const mm = document.querySelector('.fc-maxmode'); if (mm && !mm.checked) mm.click(); // 连写必须开（章节链才是验货对象）
      const mc = document.querySelector('.fc-maxchapters'); if (mc) { mc.value = '2'; mc.dispatchEvent(new Event('input', { bubbles: true })); n++; }
      const ef = document.querySelector('.fc-exportfmt'); if (ef) ef.value = 'md';
      return { n };
    });
    human.log('填表:', JSON.stringify(filled));
    await evaluate(() => document.querySelector('[data-a=addtask]')?.click());
    await wait(1000);
    const queued = await evaluate(() => {
      const cbs = [...document.querySelectorAll('.fc-task input[type=checkbox]')];
      if (cbs[0]) { cbs[0].checked = true; cbs[0].dispatchEvent(new Event('change', { bubbles: true })); }
      return { tasks: cbs.length };
    });
    human.log('入队:', JSON.stringify(queued));
    await human.assert(queued.tasks >= 1, '任务必须入队');
    await evaluate(() => document.querySelector('[data-a=startsel]')?.click());
    let log = '', t0 = Date.now(), retries = 0;
    for (let i = 0; i < 110; i++) {
      await wait(5000);
      log = await evaluate(() => {
        const el = document.querySelector('.fc-log');
        return el?.value || el?.textContent || '';
      });
      const tail = log.slice(-160).replace(/\n/g, '⏎');
      if (i % 6 === 0) human.log(`T+${Math.round((Date.now() - t0) / 1000)}s:`, tail);
      if (/全部完成|队列执行完毕|✅ 全部|已完工/.test(log) && /第\s*0*2\s*章|2\/2/.test(log)) break;
      if (/HTTP 503|Service is too busy/.test(log) && retries < 3) {
        retries++;
        human.log(`⚠ 503 判败——第${retries}次操作员重试（产品零自动重试在案）`);
        await wait(12000);
        await evaluate(() => document.querySelector('[data-a=startsel]')?.click());
        log = ''; // 清日志缓存防重复判
        continue;
      }
      if (/API 错误|未配置 AI|执行失败/.test(log) && !/重试|503/.test(log)) break;
    }
    human.log('收尾日志:', log.slice(-260).replace(/\n/g, '⏎'));
    const disk = await evaluate(async (ws) => {
      const root = ws + '/创作产出';
      const listDir = async (p) => await window.mazz.invoke('fs:listDir', { path: p }).catch(() => []);
      const dirs = (await listDir(root)) || [];
      const d0 = dirs.find(x => (x.name || x).includes('雾都灯塔')) || dirs[0];
      if (!d0) return { root: dirs.map(x => x.name || x) };
      const folder = root + '/' + (d0.name || d0);
      const files = (await listDir(folder)) || [];
      const names = files.map(x => x.name || x);
      const read = async (n) => n ? await window.mazz.invoke('fs:readFile', { path: folder + '/' + n }).catch(() => null) : null;
      return {
        folder, names,
        bp: await read(names.find(n => n.includes('创作蓝图'))),
        outline: await read(names.find(n => n.includes('章节大纲'))),
        ch1: await read(names.find(n => /第0*1章/.test(n))),
        ch2: await read(names.find(n => /第0*2章/.test(n))),
        snap0: await read(names.find(n => n.includes('初始'))),
        snap1: await read(names.find(n => /第0*1章后/.test(n))),
        state: await read(names.find(n => n.includes('任务状态'))),
      };
    }, WS);
    human.log('磁盘产物:', JSON.stringify({ names: disk.names, bpLen: disk.bp?.length || 0, ch1: disk.ch1?.length || 0, ch2: disk.ch2?.length || 0, s0: disk.snap0?.length || 0, s1: disk.snap1?.length || 0 }));
    const KEYS = ['故事标题', '简介', '核心价值', '价值取向', '主角', '人设', '配角', '群像', '世界观', '设定', '三幕', '结构', '大纲', '章节', '纲要', '文风', '执行方案', '节奏', '控制表'];
    const hits = KEYS.filter(k => (disk.bp || '').includes(k)).length;
    await human.assert((disk.bp?.length || 0) > 500 && hits >= 6, `蓝图必须存在且结构达标（长 ${disk.bp?.length}，命中 ${hits}/19）`);
    await human.assert((disk.outline?.length || 0) > 0, '章节大纲.md 必须落盘');
    await human.assert((disk.ch1?.length || 0) > 300 && (disk.ch2?.length || 0) > 300, `两章必须落盘（${disk.ch1?.length}/${disk.ch2?.length}）`);
    await human.assert((disk.snap0?.length || 0) > 0 && (disk.snap1?.length || 0) > 100, `快照必须滚动产出（${disk.snap0?.length}/${disk.snap1?.length}）`);
    await human.assert(/人物|伏笔|时间线|冲突/.test(disk.snap1 || ''), '快照必须结构化四问');
    await human.assert(/done/.test(disk.state || '') || (disk.names || []).some(n => /第0*2章/.test(n)), '任务必须完工');
    // 实物证据存档（验货报告用）
    await evaluate(async (ws) => {
      const root = ws + '/创作产出';
      const dirs = (await window.mazz.invoke('fs:listDir', { path: root }).catch(() => [])) || [];
      const d0 = dirs.find(x => (x.name || x).includes('雾都灯塔')) || dirs[0];
      if (!d0) return;
      const folder = root + '/' + (d0.name || d0);
      const files = (await window.mazz.invoke('fs:listDir', { path: folder }).catch(() => [])) || [];
      for (const f of files) {
        const n = f.name || f;
        const c = await window.mazz.invoke('fs:readFile', { path: folder + '/' + n }).catch(() => null);
        if (c != null) await window.mazz.invoke('fs:writeFile', { path: ws + '/验货存档-' + n.replace(/[\\/:*?"<>|]/g, '_'), content: c }).catch(() => {});
      }
    }, WS);
  });

  // ==================== 3：断点续写实证 ====================
  await scenario('断点·停停走走续得上', async () => {
    await evaluate(() => {
      document.querySelectorAll('.fc-form input[type=text], .fc-form textarea').forEach(el => { el.value = '断点验证书'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      document.querySelector('[data-a=addtask]')?.click();
    });
    await wait(900);
    await evaluate(() => {
      const cbs = [...document.querySelectorAll('.fc-task input[type=checkbox]')];
      const last = cbs[cbs.length - 1];
      if (last) { last.checked = true; last.dispatchEvent(new Event('change', { bubbles: true })); }
      document.querySelector('[data-a=startsel]')?.click();
    });
    let stopped = false;
    for (let i = 0; i < 60; i++) {
      await wait(3000);
      const log = await evaluate(() => (document.querySelector('.fc-log')?.value || document.querySelector('.fc-log')?.textContent || '').slice(-300));
      if (/正在生成\s*第0*1|第\s*1\s*章/.test(log)) {
        await evaluate(() => document.querySelector('[data-a=stopsel]')?.click());
        stopped = true;
        break;
      }
    }
    await human.assert(stopped, '必须抓到在写时机并按下停止');
    await wait(6000);
    const resume = await evaluate(() => ({
      box: !!document.querySelector('.fc-mini[data-res]'),
      text: document.querySelector('.fc-mini[data-res]')?.textContent || '',
    }));
    human.log('恢复列表:', JSON.stringify(resume));
    await human.assert(resume.box, `中断任务必须进恢复列表（实拿 ${JSON.stringify(resume)}）`);
    await evaluate(() => document.querySelector('.fc-mini[data-res]')?.click());
    await wait(9000);
    const log2 = await evaluate(() => (document.querySelector('.fc-log')?.value || document.querySelector('.fc-log')?.textContent || '').slice(-400));
    human.log('续跑日志:', log2.slice(-180).replace(/\n/g, '⏎'));
    await human.assert(/续|第\s*\d+\s*章|生成|蓝图/.test(log2), '续跑必须有下文（日志实证）');
    await evaluate(() => document.querySelector('[data-a=stopsel]')?.click());
    await wait(1500);
  });
}
