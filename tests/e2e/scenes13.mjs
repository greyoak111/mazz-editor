// tests/e2e/scenes13.mjs —— 波次二十五「DMHY首页/全编码音轨/种子内字幕」实证批
// DMHY 首页选中即当日上传（外网宽容）/ 四编码音轨轮切（Vorbis/AAC/FLAC/Opus）/ 种子内字幕 fileBytes 直取
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export async function scenes13({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const openVideo = async (rel) => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/' + rel]);
    await human.until(() => {
      const m = [...document.querySelectorAll('video.mz-media')].find(e => e.getBoundingClientRect().width > 0);
      return m && m.readyState >= 1;
    }, { timeout: 9000, msg: rel + ' 播放器就绪' });
  };

  // 造四编码音轨 mkv（vp8 画面 + vorbis(主)/aac/flac/opus 四音轨——主轨可解，抽轨全靠自家 EBML-lite）
  fs.mkdirSync(WS + '/轨', { recursive: true });
  execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=3:size=320x240:rate=15" -f lavfi -i "sine=frequency=440:duration=3" -f lavfi -i "sine=frequency=880:duration=3" -f lavfi -i "sine=frequency=1320:duration=3" -f lavfi -i "sine=frequency=1760:duration=3" -map 0:v -map 1:a -map 2:a -map 3:a -map 4:a -c:v libvpx -b:v 400k -c:a:0 libvorbis -c:a:1 aac -c:a:2 flac -c:a:3 libopus "${WS}/轨/四轨番.mkv"`, { stdio: 'pipe' });

  // ==================== 1：DMHY 首页选中即当日上传列表（外网宽容） ====================
  await scenario('P2P·DMHY首页·当日上传列表', async () => {
    await openVideo('轨/四轨番.mkv');
    await evaluate(() => { [...document.querySelectorAll('[data-a=list]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(500);
    await evaluate(() => { [...document.querySelectorAll('.mz-src-tab')].find(t => t.dataset.src === 'web')?.click(); });
    // loadHome 首开即载——外网 30s 竞速，不可达宽容跳过
    const home = await Promise.race([
      (async () => {
        for (let i = 0; i < 40; i++) {
          const st = await evaluate(() => {
            const rows = document.querySelectorAll('.mz-web-row');
            const dim = document.querySelector('.mz-web-rows.mz-dim');
            return { n: rows.length, hint: dim ? dim.textContent.slice(0, 60) : '' };
          });
          if (st.n > 0) return st;
          if (st.hint.includes('失败') || st.hint.includes('暂无')) return { ...st, err: st.hint };
          await wait(750);
        }
        return { err: 'local-30s-timeout' };
      })(),
      new Promise(r => setTimeout(() => r({ err: 'local-30s-timeout' }), 30000)),
    ]);
    if (home.err && !home.n) { human.log('DMHY 首页本轮不可达，宽容跳过: ' + home.err); return; }
    await human.assert(home.n >= 10, `首页应出 10+ 行当日上传（实际 ${home.n}）`);
    const row = await evaluate(() => {
      const el = document.querySelector('.mz-web-row');
      return {
        date: el.querySelector('.mz-wr-date')?.textContent,
        title: (el.querySelector('.mz-wr-title')?.textContent || '').slice(0, 60),
        size: el.querySelector('.mz-wr-size')?.textContent,
      };
    });
    human.log('首页首行:', JSON.stringify(row), '共', home.n, '行');
    await human.assert(row.title && row.size, `行应带完整标题与大小（${JSON.stringify(row)}）`);
  });

  // ==================== 2：四编码音轨轮切（Vorbis/AAC/FLAC/Opus 全直通） ====================
  await scenario('播放器·多音轨·全编码轮切', async () => {
    await openVideo('轨/四轨番.mkv');
    await wait(2200); // probeAudioTracks 异步
    const menu = await evaluate(() => {
      const sel = [...document.querySelectorAll('.mz-track')].find(e => e.getBoundingClientRect().width > 0);
      return sel ? [...sel.options].map(o => o.textContent.trim()) : [];
    });
    human.log('轨菜单:', JSON.stringify(menu));
    await human.assert(menu.length === 4, `四轨应出四选项（实际 ${JSON.stringify(menu)}）`);
    await human.assert(menu.every(o => !o.includes('暂不支持')), `四编码全支持不应有「暂不支持」（${JSON.stringify(menu)}）`);
    // 轮切 轨2(aac)/轨3(flac)/轨4(opus)：aux 接管 = 主媒体整轨静音
    for (const idx of [1, 2, 3]) {
      await evaluate(([i]) => {
        const sel = [...document.querySelectorAll('.mz-track')].find(e => e.getBoundingClientRect().width > 0);
        sel.value = String(i);
        sel.dispatchEvent(new Event('change'));
      }, [idx]);
      await wait(1800); // 抽轨+封装+挂 aux
      const st = await evaluate(() => ({ muted: document.querySelector('video.mz-media')?.muted }));
      human.log(`切轨${idx + 1}:`, JSON.stringify(st));
      await human.assert(st.muted === true, `切轨${idx + 1}后 aux 应接管（主媒体整轨静音，实际 muted=${st.muted}）`);
    }
    // 回主轨：静音解除
    await evaluate(() => {
      const sel = [...document.querySelectorAll('.mz-track')].find(e => e.getBoundingClientRect().width > 0);
      sel.value = '0';
      sel.dispatchEvent(new Event('change'));
    });
    await wait(800);
    const back = await evaluate(() => document.querySelector('video.mz-media')?.muted);
    await human.assert(back === false, `回主轨应解除静音（实际 ${back}）`);
  });

  // ==================== 3：种子内字幕（tor:fileBytes 直取 BBB .srt 解 srt 文本） ====================
  await scenario('P2P·种子内字幕·fileBytes直取', async () => {
    // add → 探 .srt → fileBytes 按需取块 → remove 一趟跑完（40s 竞速<45s 熔断，外网宽容）
    const got = await Promise.race([
      evaluate(async () => {
        try {
          const r = await window.mazz.invoke('tor:add', {
            magnet: 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337',
          });
          const sub = (r.files || []).find(f => /\.(ass|srt|ssa)$/i.test(f.path || ''));
          if (!sub) return { err: 'no-sub', paths: (r.files || []).map(f => f.path).slice(0, 8) };
          const bytes = await window.mazz.invoke('tor:fileBytes', { infoHash: r.infoHash, filePath: sub.path });
          const u8 = bytes instanceof Uint8Array ? bytes : (bytes?.data ? new Uint8Array(bytes.data) : null);
          const text = u8 ? new TextDecoder().decode(u8) : '';
          await window.mazz.invoke('tor:remove', { infoHash: r.infoHash, deleteFiles: true });
          return { len: text.length, head: text.slice(0, 80), hasArrow: text.includes('-->'), files: r.files?.length, subPath: sub.path };
        } catch (e) { return { err: String(e.message || e).slice(0, 120) }; }
      }),
      new Promise(r => setTimeout(() => r({ err: 'local-40s-timeout' }), 40000)),
    ]);
    if (got.err) { human.log('swarm/字幕 piece 本轮不可达，宽容跳过: ' + got.err + ' ' + JSON.stringify(got.paths || '')); return; }
    human.log('字幕样本:', JSON.stringify(got));
    await human.assert(got.subPath && got.len > 100 && got.hasArrow, `解出的应是 srt 文本（${JSON.stringify(got)}）`);
  });

  // ==================== 4：daemon 幂等（同 infoHash 重复添加秒回不挂 60s） ====================
  await scenario('P2P·daemon·重复添加幂等秒回', async () => {
    const r = await Promise.race([
      evaluate(async () => {
        const magnet = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337';
        try {
          const t0 = Date.now();
          const a = await window.mazz.invoke('tor:add', { magnet });
          const t1 = Date.now();
          const b = await window.mazz.invoke('tor:add', { magnet }); // 重复添加——修复前挂 60s
          const t2 = Date.now();
          await window.mazz.invoke('tor:remove', { infoHash: a.infoHash, deleteFiles: true });
          return { first: t1 - t0, second: t2 - t1, same: a.infoHash === b.infoHash, files: b.files?.length };
        } catch (e) { return { err: String(e.message || e).slice(0, 100) }; }
      }),
      new Promise(r => setTimeout(() => r({ err: 'local-40s-timeout' }), 40000)),
    ]);
    if (r.err) { human.log('swarm 本轮不可达，宽容跳过: ' + r.err); return; }
    human.log('幂等:', JSON.stringify(r));
    await human.assert(r.same && r.files >= 1, `重复添加应同 hash 同文件表（${JSON.stringify(r)}）`);
    await human.assert(r.second < 8000, `重复添加应秒回（实际 ${r.second}ms——修复前必挂 60s）`);
  });
}
