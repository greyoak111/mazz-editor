// tests/e2e/scenes10.mjs —— 波次二十二「播放器字幕/连播/设置」实证批
// 字幕探测挂载与显隐 / 外挂直挂 / 自动连播与取消 / 设置面板与片源 / 番剧识别实战
export async function scenes10({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // 造 2s 有声 webm（系统 ffmpeg：正规容器带时长元数据——裸 MediaRecorder 产物 EBML 时长 Infinity，
  // 播放末端触发 error 事件引爆播放器销毁（字幕宿主被连坐拆除实锤——CC 宿主消失真根）
  const makeWebm = async (rel, hue) => {
    const { execSync } = await import('node:child_process');
    const fs2 = await import('node:fs');
    const dir = rel.split('/').slice(0, -1).join('/');
    fs2.mkdirSync(WS + '/' + dir, { recursive: true });
    execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x180:rate=15 -f lavfi -i "sine=frequency=${300 + hue * 100}:duration=2" -c:v libvpx -c:a libvorbis -shortest "${WS}/${rel}"`, { stdio: 'pipe' });
  };

  const openVideo = async (rel) => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/' + rel]);
    await human.until(() => {
      const m = [...document.querySelectorAll('video.mz-media')].find(e => e.getBoundingClientRect().width > 0);
      return m && m.readyState >= 1;
    }, { timeout: 9000, msg: rel + ' 播放器就绪' });
  };
  const playerState = () => evaluate(() => {
    const reg = window.MazzModulesReal || window.MazzModules;
    let ctl = null;
    for (const [, v] of (reg?.instances || new Map())) { if (v?._player) { ctl = v; break; } }
    const m = document.querySelector('video.mz-media');
    const sub = document.querySelector('canvas.mz-sub-canvas');
    const subHost = document.querySelector('.mz-sub-host');
    return {
      hasCtl: !!ctl, dur: m?.duration, cur: m?.currentTime,
      subCanvas: !!sub, subVisible: subHost ? subHost.style.display !== 'none' : (sub ? sub.style.display !== 'none' : false),
      subW: sub?.width || 0, subH: sub?.height || 0,
      title: document.title,
    };
  });

  // ==================== 1：字幕探测+挂载+显隐 ====================
  await scenario('播放器·字幕·探测挂载显隐', async () => {
    await makeWebm('剧集/试炼番 S01E01.webm', 200);
    await evaluate(async ([p]) => {
      const ass = `[Script Info]\nTitle: E2E\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 180\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default, sans-serif, 14, &H0000FFFF, &H0000FFFF, &H00000000, &H80000000, -1, 0, 0, 0, 100, 100, 0, 0, 1, 1, 0, 8, 4, 4, 4, 1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0, 0:00:00.00, 0:00:59.00, Default, , 0, 0, 0, , {\\an8\\bord2}试炼字幕第一行\n`;
      await window.mazz.invoke('fs:writeFile', { path: p, content: ass });
    }, [WS + '/剧集/试炼番 S01E01.ass']);
    await openVideo('剧集/试炼番 S01E01.webm');
    await wait(2600); // 探测+资产加载+worker 起+首渲染
    const st = await playerState();
    human.log('字幕挂载:', JSON.stringify({ subCanvas: st.subCanvas, subVisible: st.subVisible, subW: st.subW, subH: st.subH, dur: st.dur }));
    await human.assert(st.subCanvas && st.subW > 100 && st.subH > 80, `字幕 canvas 应已挂载进播放区（${JSON.stringify(st)}）`);
    // CC 显隐往返
    await evaluate(() => { [...document.querySelectorAll('[data-a=sub]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(400);
    const ccDump = await evaluate(() => ({
      hostDisplay: document.querySelector('.mz-sub-host')?.style.display ?? '(无宿主)',
      btnCls: document.querySelector('[data-a=sub]')?.className,
      btnOp: document.querySelector('[data-a=sub]')?.style.opacity,
      flow: window.__subFlow, stage: window.__subStage, ref: !!window.__subRef,
    }));
    human.log('CC1 现场:', JSON.stringify(ccDump));
    let vis = (await playerState()).subVisible;
    await human.assert(vis === false, 'CC 点按应隐藏字幕');
    await evaluate(() => { [...document.querySelectorAll('[data-a=sub]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(400);
    vis = (await playerState()).subVisible;
    await human.assert(vis === true, 'CC 再按应恢复显示');
  });

  // ==================== 2：外挂字幕直挂（模块级，免系统框） ====================
  await scenario('播放器·字幕·外挂直挂可切换', async () => {
    await evaluate(async ([p]) => {
      await window.mazz.invoke('fs:writeFile', { path: p, content: `[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, Bold, Alignment, MarginV, Encoding\nStyle: Default, sans-serif, 16, &H00FFFFFF, -1, 8, 6, 1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0, 0:00:00.00, 0:00:59.00, Default, , 0, 0, 0, , 外挂第二轨\n` });
    }, [WS + '/剧集/试炼番 S01E01.chs.ass']);
    const ok = await evaluate(async ([p]) => {
      const inst = window.__activeViewerCtl;
      if (!inst?._player?.loadSub) return 'no-player-instance:' + JSON.stringify({ hasCtl: !!inst, hasPlayer: !!inst?._player });
      try { await inst._player.loadSub(p); return 'attached'; } catch (e) { return 'err:' + e.message.slice(0, 60); }
    }, [WS + '/剧集/试炼番 S01E01.chs.ass']);
    human.log('外挂直挂:', ok);
    await human.assert(ok === 'attached', `外挂字幕应可直挂切换（实际 ${ok}）`);
  });

  // ==================== 3：自动连播（E01 播完→倒计时→E02） ====================
  await scenario('播放器·自动连播·倒计时接播与取消', async () => {
    await makeWebm('剧集/试炼番 S01E02.webm', 120);
    await openVideo('剧集/试炼番 S01E01.webm');
    await wait(1500);
    // 拖到片尾触发 ended
    await evaluate(() => {
      const m = document.querySelector('video.mz-media');
      if (m && isFinite(m.duration)) { m.currentTime = Math.max(0, m.duration - 0.3); m.play().catch(() => {}); }
    });
    // 倒计时提示应出现
    await human.until(() => {
      const t = [...document.querySelectorAll('.mazz-toast, [class*=toast]')].some(e => (e.textContent || '').includes('自动连播'));
      return t || null;
    }, { timeout: 8000, msg: '连播倒计时出现' });
    // 等接播完成
    await human.until(() => {
      const n = [...document.querySelectorAll('.mz-name')].map(e => e.textContent || '').join('|');
      return n.includes('S01E02') || null;
    }, { timeout: 9000, msg: '接到 S01E02' });
    // 取消路径：重开 E01 再触发，点取消
    await openVideo('剧集/试炼番 S01E01.webm');
    await wait(1200);
    await evaluate(() => {
      const m = document.querySelector('video.mz-media');
      if (m && isFinite(m.duration)) { m.currentTime = Math.max(0, m.duration - 0.3); m.play().catch(() => {}); }
    });
    await human.until(() => [...document.querySelectorAll('.mazz-toast, [class*=toast]')].some(e => (e.textContent || '').includes('自动连播')) || null, { timeout: 8000, msg: '倒计时再现' });
    const cancelHit = await evaluate(() => {
      const btn = [...document.querySelectorAll('.mazz-toast button, [class*=toast] button')].find(b => (b.textContent || '').includes('取消连播'));
      if (btn) { btn.click(); return { hit: true }; }
      return { hit: false, toastHtml: document.querySelector('.mazz-toast')?.innerHTML?.slice(0, 120) || '(no-toast)' };
    });
    human.log('取消按钮:', JSON.stringify(cancelHit));
    await wait(3600);
    const still = await evaluate(() => [...document.querySelectorAll('.mz-name')].map(e => e.textContent || '').join('|'));
    await human.assert(still.includes('S01E01') && !still.includes('S01E02'), '取消后应停在 E01');
  });

  // ==================== 4：设置面板与片源 ====================
  await scenario('播放器·设置面板·开关联动与片源', async () => {
    await evaluate(() => { [...document.querySelectorAll('[data-a=pset]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(700);
    const sec = await evaluate(() => {
      const m = [...document.querySelectorAll('.mazz-palette-mask')].find(e => e.getBoundingClientRect().width > 0);
      return m ? { sub: !!m.querySelector('.ps-sub-sw'), next: !!m.querySelector('.ps-next-sw'), load: !!m.querySelector('.ps-sub-load'), sites: m.querySelectorAll('.ps-site').length, credit: m.textContent.includes('JASSUB') } : null;
    });
    human.log('设置面板:', JSON.stringify(sec));
    await human.assert(sec && sec.sub && sec.next && sec.load && sec.sites >= 5 && sec.credit, '面板分区与片源与归属标注应齐');
    // 连播开关落 settings
    await evaluate(() => {
      const m = [...document.querySelectorAll('.mazz-palette-mask')].find(e => e.getBoundingClientRect().width > 0);
      const sw = m.querySelector('.ps-next-sw');
      if (sw.checked) sw.click();
    });
    await wait(400);
    const saved = await evaluate(async () => await window.mazz.invoke('settings:get', { key: 'player.autoNextEnabled' }));
    await human.assert(saved === false, `连播开关应落 settings（实际 ${saved}）`);
    // 还原 + 关面板
    await evaluate(async () => {
      const m = [...document.querySelectorAll('.mazz-palette-mask')].find(e => e.getBoundingClientRect().width > 0);
      m?.querySelector('.ps-next-sw')?.click();
      m?.remove();
      await window.mazz.invoke('settings:set', { key: 'player.autoNextEnabled', value: true });
    });
  });

  // ==================== 5：番剧识别实战（fansub 命名） ====================
  await scenario('播放器·番剧识别·fansub命名实战', async () => {
    const r = await evaluate(async () => {
      const { nextEpisodePath } = await import('./lib/episode-detect.js');
      const entries = [
        { name: '[VCB-Studio] Puella Magi Madoka Magica [01][BDRIP][1920x1080][x264_FLAC].mkv', path: '/v/[VCB-Studio] Puella Magi Madoka Magica [01][BDRIP][1920x1080][x264_FLAC].mkv', isDir: false },
        { name: '[VCB-Studio] Puella Magi Madoka Magica [02][BDRIP][1920x1080][x264_FLAC].mkv', path: '/v/[VCB-Studio] Puella Magi Madoka Magica [02][BDRIP][1920x1080][x264_FLAC].mkv', isDir: false },
        { name: '[VCB-Studio] Puella Magi Madoka Magica [01][BDRIP][1920x1080][x264_FLAC].sc.ass', path: '/v/x.sc.ass', isDir: false },
      ];
      return nextEpisodePath(entries[0].path, entries, new Set(['mkv']));
    });
    human.log('fansub 续集识别:', JSON.stringify(r));
    await human.assert(r && r.includes('[02]'), `fansub 命名应识别下一集（实际 ${r}）`);
  });
}
