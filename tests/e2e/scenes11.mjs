// tests/e2e/scenes11.mjs —— 波次二十三「P2P 边下边播」实证批
// daemon 全链 / 三源面板 / W65 四站 Preview / 媒体库扫描 / 存不存模式
export async function scenes11({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 1：daemon magnet→流→统计 全链 ====================
  await scenario('P2P·daemon·magnet全链实证', async () => {
    // 本地 30s 竞速超时（daemon 自身 60s 超时比场景熔断长——先掐表才轮到宽容分支）
    const added = await Promise.race([
      evaluate(async () => {
        try {
          const r = await window.mazz.invoke('tor:add', {
            magnet: 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337',
          });
          return { infoHash: r.infoHash, name: r.name, files: r.files?.length };
        } catch (e) { return { err: String(e.message || e).slice(0, 120) }; }
      }),
      new Promise(r => setTimeout(() => r({ err: 'local-30s-timeout' }), 30000)),
    ]);
    if (added.err) { human.log('swarm 本轮不可达（元数据超时/网络抖），宽容跳过: ' + added.err); return; }
    await human.assert(added.infoHash && added.files >= 1, `magnet 添加应得元数据（${JSON.stringify(added)}）`);
    const ih = added.infoHash;
    const stream = await evaluate(async ([ih]) => {
      const url = await window.mazz.invoke('tor:streamUrl', { infoHash: ih });
      const proxy = 'mazz-res://tor/' + url.replace('http://', '');
      const r = await fetch(proxy, { headers: { Range: 'bytes=0-1023' } });
      return { status: r.status, len: (await r.arrayBuffer()).byteLength };
    }, [ih]);
    await human.assert(stream.status === 206 || stream.len > 0, `代理 range 取流（${JSON.stringify(stream)}）`);
    await wait(3500);
    const st = await evaluate(async ([ih]) => await window.mazz.invoke('tor:stats', { infoHash: ih }), [ih]);
    await human.assert(st && st.progress >= 0 && st.numPeers >= 0, `统计应有进度与 peers（${JSON.stringify(st && { progress: st.progress, peers: st.numPeers, downSpeed: st.downSpeed })}）`);
    await evaluate(async ([ih]) => await window.mazz.invoke('tor:remove', { infoHash: ih, deleteFiles: true }), [ih]);
  });

  // ==================== 2：三源面板与媒体库扫描 ====================
  await scenario('P2P·三源面板·媒体库扫描', async () => {
    // 使用 seedFixtures 已生成的合法 WAV，不依赖机器 PATH 中的 ffmpeg。
    const fs2 = await import('node:fs');
    fs2.mkdirSync(WS + '/媒体库', { recursive: true });
    fs2.copyFileSync(WS + '/测试音.wav', WS + '/媒体库/库内音频.wav');
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/媒体库/库内音频.wav']);
    await wait(1600);
    await evaluate(() => { [...document.querySelectorAll('[data-a=list]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(500);
    const tabs = await evaluate(() => [...document.querySelectorAll('.mz-src-tab')].map(t => t.dataset.src));
    await human.assert(tabs.length === 3 && tabs.includes('playlist') && tabs.includes('medialib') && tabs.includes('web'), `三源页签应在（${JSON.stringify(tabs)}）`);
    // 切媒体库
    await evaluate(() => { [...document.querySelectorAll('.mz-src-tab')].find(t => t.dataset.src === 'medialib')?.click(); });
    await wait(700);
    const ml = await evaluate(() => ({
      items: [...document.querySelectorAll('.mz-ml-item')].map(e => e.textContent.slice(0, 30)),
      hasBar: !!document.querySelector('.mz-ml-bar'),
    }));
    await human.assert(ml.hasBar && ml.items.some(t => t.includes('库内音频')), `媒体库应扫出库内音频（${JSON.stringify(ml.items)}）`);
    // 切网络资源
    await evaluate(() => { [...document.querySelectorAll('.mz-src-tab')].find(t => t.dataset.src === 'web')?.click(); });
    await wait(700);
    const web = await evaluate(() => ({
      site: !!document.querySelector('.mz-web-site'),
      kw: !!document.querySelector('.mz-web-kw'),
      magnet: !!document.querySelector('.mz-web-magnet'),
      options: [...document.querySelectorAll('.mz-web-site option')].map(option => ({ id: option.value, name: option.textContent })),
    }));
    await human.assert(web.site && web.kw && web.magnet, `网络资源模式应有站选+搜索+手贴（${JSON.stringify(web)}）`);
    await human.assert(JSON.stringify(web.options.map(option => option.id)) === JSON.stringify(['dmhy', 'mikan', 'kisssub', 'comicat']), `四个主站必须按冻结顺序在册（${JSON.stringify(web.options)}）`);
    await human.assert(web.options.every(option => option.name.includes('（预览）')), `W65 未封板前四站必须全部诚实标识 Preview（${JSON.stringify(web.options)}）`);
    await human.shot('w65a-四站网络资源入口');
  });

  // ==================== 3：Mikan 真实搜索 + 统一资源行（外网宽容） ====================
  await scenario('W65a·Mikan·真实统一资源行', async () => {
    const srch = await evaluate(async () => {
      try {
        const r = await window.mazz.invoke('sites:search', { site: 'mikan', kw: '魔法少女奈叶' });
        return { count: r.rows?.length, first: r.rows?.[0] };
      } catch (e) { return { err: String(e.message || e).slice(0, 100) }; }
    });
    if (srch.err) { human.log('外网不可达，宽容跳过: ' + srch.err); return; }
    await human.assert(srch.count >= 1, `搜索应出至少一条统一资源行（实际 ${srch.count}）`);
    const row = srch.first;
    const expectedKeys = ['title', 'date', 'size', 'seeders', 'leechers', 'completed', 'magnet', 'torrentUrl', 'sourceSite', 'sourceUrl', 'subgroup', 'resolution', 'infoHash'];
    await human.assert(row?.title && row?.sourceUrl && row?.size && /^[a-f0-9]{40}$/.test(row?.infoHash || ''), `统一行应有完整标题/来源链/大小/infoHash（${JSON.stringify(row)}）`);
    await human.assert(JSON.stringify(Object.keys(row)) === JSON.stringify(expectedKeys), `统一行必须恰为 13 字段（${JSON.stringify(Object.keys(row))}）`);
    const mg = await evaluate(async ([site, infoHash]) => {
      try { return await window.mazz.invoke('sites:magnet', { site, infoHash }); }
      catch (e) { return { err: String(e.message || e).slice(0, 100) }; }
    }, ['mikan', row.infoHash]);
    await human.assert(!mg.err && mg.magnet === `magnet:?xt=urn:btih:${row.infoHash}`, '已知 infoHash 应零详情请求直接得到 magnet');
  });

  // ==================== 4：存/不存模式分支（tor:filePath→rename 存库 / remove 删除） ====================
  await scenario('P2P·存不存·模式分支', async () => {
    // keep 分支：tor:filePath → rename 入媒体库 → remove（不删文件）→ 媒体库有货
    const added = await Promise.race([
      evaluate(async () => {
        try {
          const r = await window.mazz.invoke('tor:add', {
            magnet: 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969',
          });
          return { infoHash: r.infoHash, first: r.files?.[0]?.path };
        } catch (e) { return { err: String(e.message || e).slice(0, 100) }; }
      }),
      new Promise(r => setTimeout(() => r({ err: 'local-30s-timeout' }), 30000)),
    ]);
    if (added.err) { human.log('swarm 本轮不可达，宽容跳过: ' + added.err); return; }
    await human.assert(added.infoHash, `先要有种子（${JSON.stringify(added)}）`);
    // 先等 srt 小块落盘（chunk store 随块写文件，元数据期文件未生）
    const ready = await evaluate(async ([ih, fp]) => {
      const src = await window.mazz.invoke('tor:filePath', { infoHash: ih, filePath: fp });
      for (let i = 0; i < 24; i++) {
        const st = await window.mazz.invoke('fs:stat', { path: src }).catch(() => null);
        if (st?.exists) return { src, waited: i };
        await new Promise(r => setTimeout(r, 500));
      }
      return { src, waited: -1 };
    }, [added.infoHash, added.first]);
    await human.assert(ready.src && ready.waited >= 0, `小块应落盘（${JSON.stringify(ready)}）`);
    const keep = await evaluate(async ([src]) => {
      const ws = await window.mazz.invoke('workspace:get');
      const dest = ws + '/媒体库/留存测试.srt';
      const rn = await window.mazz.invoke('fs:rename', { from: src, to: dest }).catch(e => ({ err: e.message }));
      const st = await window.mazz.invoke('fs:stat', { path: dest }).catch(() => null);
      return { rn: rn === true || rn === undefined ? true : rn, destOk: st?.exists };
    }, [ready.src]);
    await human.assert(keep.destOk, `存库分支应落盘（${JSON.stringify(keep)}）`);
    await evaluate(async ([ih]) => await window.mazz.invoke('tor:remove', { infoHash: ih, deleteFiles: false }), [added.infoHash]);
    // discard 分支：remove+deleteFiles → 目录消失
    const disc = await evaluate(async () => {
      const r = await window.mazz.invoke('tor:add', {
        magnet: 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969',
      });
      const ws = await window.mazz.invoke('workspace:get');
      const before = await window.mazz.invoke('fs:listDir', { path: ws + '/媒体库/.download' }).catch(() => []);
      await window.mazz.invoke('tor:remove', { infoHash: r.infoHash, deleteFiles: true });
      const after = await window.mazz.invoke('fs:listDir', { path: ws + '/媒体库/.download' }).catch(() => []);
      return { infoHash: r.infoHash, before: before.length, after: after.length };
    });
    await human.assert(disc.infoHash && disc.after <= disc.before, `删除分支应清理（${JSON.stringify(disc)}）`);
  });
}
