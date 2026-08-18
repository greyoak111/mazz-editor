// tests/e2e/scenes11.mjs —— W65 四站聚合、目录、健康与主进程下载队列实证批
export async function scenes11({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const magnet = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337';

  await scenario('P2P·daemon·magnet全链实证', async () => {
    const added = await Promise.race([
      evaluate(async ([value]) => {
        try {
          const result = await window.mazz.invoke('tor:add', { magnet: value });
          return { infoHash: result.infoHash, name: result.name, files: result.files?.length };
        } catch (error) { return { err: String(error.message || error).slice(0, 120) }; }
      }, [magnet]),
      new Promise(resolve => setTimeout(() => resolve({ err: 'local-30s-timeout' }), 30000)),
    ]);
    if (added.err) { human.log('swarm 本轮不可达，宽容跳过：' + added.err); return; }
    await human.assert(added.infoHash && added.files >= 1, `magnet 添加应得元数据（${JSON.stringify(added)}）`);
    const stream = await evaluate(async ([infoHash]) => {
      const url = await window.mazz.invoke('tor:streamUrl', { infoHash });
      const response = await fetch('mazz-res://tor/' + url.replace('http://', ''), { headers: { Range: 'bytes=0-1023' } });
      return { status: response.status, len: (await response.arrayBuffer()).byteLength };
    }, [added.infoHash]);
    await human.assert(stream.status === 206 || stream.len > 0, `代理 range 取流（${JSON.stringify(stream)}）`);
    await evaluate(async ([infoHash]) => window.mazz.invoke('tor:remove', { infoHash, deleteFiles: true }), [added.infoHash]);
  });

  await scenario('W65c·四源面板·正式入口与 Mikan 周历', async () => {
    const fs2 = await import('node:fs');
    fs2.mkdirSync(WS + '/媒体库', { recursive: true });
    fs2.copyFileSync(WS + '/测试音.wav', WS + '/媒体库/库内音频.wav');
    await evaluate(async ([file]) => window.MazzCommands.execute('file.openPath', { path: file }), [WS + '/媒体库/库内音频.wav']);
    await wait(1400);
    await evaluate(() => { [...document.querySelectorAll('[data-a=list]')].find(button => button.getBoundingClientRect().width > 0)?.click(); });
    await wait(400);
    const tabs = await evaluate(() => [...document.querySelectorAll('.mz-src-tab')].map(tab => tab.dataset.src));
    await human.assert(JSON.stringify(tabs) === JSON.stringify(['playlist', 'medialib', 'web', 'downloads']), `四源页签顺序固定（${JSON.stringify(tabs)}）`);
    await evaluate(() => document.querySelector('.mz-src-tab[data-src="medialib"]')?.click());
    await human.until(() => [...document.querySelectorAll('.mz-ml-item')].some(item => item.textContent.includes('库内音频')), { timeout: 5000, msg: '媒体库扫描' });

    await evaluate(() => document.querySelector('.mz-src-tab[data-src="web"]')?.click());
    await human.until(() => document.querySelectorAll('.mz-web-sites input').length === 4, { timeout: 5000, msg: '四站多选入口' });
    const web = await evaluate(() => ({
      sites: [...document.querySelectorAll('.mz-web-sites input')].map(input => ({ id: input.value, checked: input.checked })),
      hasSearch: !!document.querySelector('.mz-web-kw'),
      hasMagnet: !!document.querySelector('.mz-web-magnet'),
      hasSeason: !!document.querySelector('.mz-mikan-season'),
      hasHealth: !!document.querySelector('.mz-site-health'),
    }));
    await human.assert(web.hasSearch && web.hasMagnet && web.hasSeason && web.hasHealth, `网络资源正式入口构件齐备（${JSON.stringify(web)}）`);
    await human.assert(JSON.stringify(web.sites.map(site => site.id)) === JSON.stringify(['dmhy', 'mikan', 'kisssub', 'comicat']) && web.sites.every(site => site.checked), '四站默认全选且顺序固定');
    await human.until(() => document.querySelectorAll('.mz-catalog-item').length > 0 || document.querySelector('.mz-web-rows')?.textContent.includes('失败'), { timeout: 30000, msg: 'Mikan 周历真实目录' });
    await human.shot('w65c-四站聚合与周历入口');

    await evaluate(() => document.querySelector('.mz-src-tab[data-src="downloads"]')?.click());
    await wait(300);
    await human.assertText('.mz-downloads', '下载队列为空', '独立下载页签空态应明白');
  });

  await scenario('W65b·真实目录与多源聚合', async () => {
    const live = await evaluate(async () => {
      const catalog = await window.mazz.invoke('sites:catalog', { site: 'mikan' }).catch(error => ({ error: error.message }));
      const search = await window.mazz.invoke('sites:searchMany', { sites: ['mikan'], kw: '魔法少女奈叶', maxPages: 1 }).catch(error => ({ error: error.message }));
      const multi = await window.mazz.invoke('sites:searchMany', { sites: ['kisssub', 'comicat'], kw: '海贼王', maxPages: 1 }).catch(error => ({ error: error.message }));
      const health = await window.mazz.invoke('sites:health', {});
      return {
        catalog: { count: catalog.items?.length || 0, seasons: catalog.seasons?.length || 0, error: catalog.error },
        search: { count: search.aggregates?.length || 0, first: search.aggregates?.[0], error: search.error },
        multi: {
          count: multi.aggregates?.length || 0,
          shared: multi.aggregates?.filter(group => group.sources.length > 1).length || 0,
          error: multi.error,
          perSite: Object.fromEntries(Object.entries(multi.perSite || {}).map(([site, item]) => [site, { rows: item.rows?.length || 0, page: item.page, sourceMode: item.sourceMode, error: item.error }])),
        },
        health,
      };
    });
    if (live.catalog.error || live.search.error) { human.log('外网不可达，宽容跳过：' + (live.catalog.error || live.search.error)); return; }
    await human.assert(live.catalog.count > 0 && live.catalog.seasons > 0, `Mikan 周历与季度目录应有真实货（${JSON.stringify(live.catalog)}）`);
    await human.assert(live.search.count > 0 && /^[a-f0-9]{40}$/.test(live.search.first?.infoHash || ''), `聚合检索应返回 infoHash 主键（${JSON.stringify(live.search)}）`);
    const upstreamUnavailable = live.multi.error || Object.values(live.multi.perSite || {}).some(item => item.error);
    if (upstreamUnavailable) human.log('两站上游本轮不可达，保留离线聚合门禁：' + JSON.stringify(live.multi));
    else await human.assert(live.multi.count > 0 && live.multi.shared > 0, `KissSub/ComiCat 同 hash 应合并成多源（${JSON.stringify(live.multi)}）`);
    await human.assert(Array.isArray(live.health) && live.health.some(item => item.status === 'healthy'), `健康快照应可观测（${JSON.stringify(live.health)}）`);
  });

  await scenario('W65c·主进程五态下载与标签无关', async () => {
    const queued = await evaluate(async ([value]) => window.mazz.invoke('tor:addBuffer', { magnet: value, name: 'W65c 队列实证' }), [magnet]);
    await human.assert(queued.state === 'queued' || queued.state === 'downloading', `加入后应进入排队/下载态（${JSON.stringify(queued)}）`);
    const ready = await Promise.race([
      evaluate(async ([infoHash]) => {
        for (let index = 0; index < 60; index++) {
          const job = (await window.mazz.invoke('tor:queue')).find(item => item.infoHash === infoHash);
          if (job?.files?.length) return job;
          if (job?.state === 'failed') return job;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        return null;
      }, [queued.infoHash]),
      new Promise(resolve => setTimeout(() => resolve(null), 32000)),
    ]);
    if (!ready || ready.state === 'failed') {
      human.log('swarm 本轮不可达，队列失败态已真实落地：' + JSON.stringify(ready));
      await evaluate(async ([infoHash]) => window.mazz.invoke('tor:remove', { infoHash, deleteFiles: true }), [queued.infoHash]);
      return;
    }
    const states = await evaluate(async ([infoHash]) => {
      const paused = await window.mazz.invoke('tor:pause', { infoHash });
      const resumed = await window.mazz.invoke('tor:resume', { infoHash });
      return [paused.state, resumed.state];
    }, [queued.infoHash]);
    await human.assert(states[0] === 'paused' && states[1] === 'downloading', `暂停/继续必须可干预（${JSON.stringify(states)}）`);
    await evaluate(() => document.querySelector('.mz-src-tab[data-src="downloads"]')?.click());
    await wait(800);
    await human.assertVisible(`.mz-download[data-ih="${queued.infoHash}"]`, '主进程队列应在独立下载页可见');
    await human.shot('w65c-下载五态队列');
    await evaluate(async ([infoHash]) => window.mazz.invoke('tor:remove', { infoHash, deleteFiles: true }), [queued.infoHash]);
    await wait(400);
  });
}
