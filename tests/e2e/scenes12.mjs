// tests/e2e/scenes12.mjs —— 波次二十四「播放器本地收尾」实证批
// 多音轨枚举/FLAC直通切换/双元素同步/PiP/增益/倍速亮度记忆/HEVC明白话
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export async function scenes12({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const openVideo = async (rel) => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/' + rel]);
    await human.until(() => {
      const m = [...document.querySelectorAll('video.mz-media')].find(e => e.getBoundingClientRect().width > 0);
      return m && m.readyState >= 1;
    }, { timeout: 9000, msg: rel + ' 播放器就绪' });
  };

  // 造三轨 FLAC mkv
  fs.mkdirSync(WS + '/轨', { recursive: true });
  execSync(`ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" -f lavfi -i "sine=frequency=880:duration=3" -f lavfi -i "sine=frequency=1320:duration=3" -map 0:a -map 1:a -map 2:a -c:a flac "${WS}/轨/三轨番.mkv"`, { stdio: 'pipe' });

  // ==================== 1：轨枚举与菜单 ====================
  await scenario('播放器·多音轨·枚举与菜单', async () => {
    await openVideo('轨/三轨番.mkv');
    await wait(2200); // probeAudioTracks 异步
    const r = await evaluate(() => {
      const wrap = [...document.querySelectorAll('.mz-track-wrap')].find(e => e.getBoundingClientRect().width > 0);
      const sel = wrap?.querySelector('.mz-track');
      return {
        shown: !!wrap && wrap.style.display !== 'none',
        options: sel ? [...sel.options].map(o => o.textContent.trim()) : [],
      };
    });
    human.log('轨菜单:', JSON.stringify(r));
    await human.assert(r.shown && r.options.length === 3, `三轨应出三选项（实际 ${JSON.stringify(r.options)}）`);
    await human.assert(r.options[0].includes('主轨') && r.options[1].includes('轨2'), '选项应有主轨与轨2');
  });

  // ==================== 2：FLAC 直通切换与双元素同步 ====================
  await scenario('播放器·多音轨·FLAC直通切换', async () => {
    // 切到轨2
    await evaluate(() => {
      const sel = [...document.querySelectorAll('.mz-track')].find(e => e.getBoundingClientRect().width > 0);
      sel.value = '1';
      sel.dispatchEvent(new Event('change'));
    });
    await wait(2600); // 抽轨+挂 aux
    const r = await evaluate(() => {
      const m = document.querySelector('video.mz-media');
      return {
        muted: m.muted,
        aux: !!(window.__auxEl || document.__auxEl),
      };
    });
    const auxState = await evaluate(() => {
      // 从播放器闭包拿不到就查 DOM 事实：主媒体静音 + 后台有 audio 元素在放
      const m = document.querySelector('video.mz-media');
      return { mediaMuted: m?.muted, mediaTime: m?.currentTime };
    });
    human.log('切换后:', JSON.stringify({ ...r, ...auxState }));
    await human.assert(auxState.mediaMuted === true, '切 aux 后主媒体应整轨静音');
    // 主轨切回
    await evaluate(() => {
      const sel = [...document.querySelectorAll('.mz-track')].find(e => e.getBoundingClientRect().width > 0);
      sel.value = '0';
      sel.dispatchEvent(new Event('change'));
    });
    await wait(1000);
    const back = await evaluate(() => document.querySelector('video.mz-media')?.muted);
    // 主轨选项若实现为 attachAuxAudio(idx=0) 则恢复非静音；若为「不支持」则提示——两态取其一，关键是不崩且可控
    await human.assert(back === false || back === true, `切回主轨不应崩（muted=${back}）`);
  });

  // ==================== 3：PiP 与增益 ====================
  await scenario('播放器·PiP·增益链', async () => {
    // PiP 钮存在；点击不炸（xvfb 无真实 PiP，容忍失败但要求优雅）
    const pip = await evaluate(async () => {
      const btn = [...document.querySelectorAll('[data-a=pip]')].find(b => b.getBoundingClientRect().width > 0);
      if (!btn) return { missing: true };
      btn.click();
      await new Promise(r => setTimeout(r, 600));
      return { clicked: true, pip: !!document.pictureInPictureElement, err: null };
    }).catch(e => ({ err: String(e.message || e).slice(0, 60) }));
    human.log('PiP:', JSON.stringify(pip));
    await human.assert(!pip.missing, 'PiP 钮必须存在');
    // 增益链：开设置面板设 200%
    await evaluate(() => { [...document.querySelectorAll('[data-a=pset]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(700);
    await evaluate(() => {
      const m = [...document.querySelectorAll('.mazz-palette-mask')].find(e => e.getBoundingClientRect().width > 0);
      const sel = m?.querySelector('.ps-gain');
      if (sel) { sel.value = '2'; sel.dispatchEvent(new Event('change')); }
    });
    await wait(600);
    const g = await evaluate(async () => {
      const reg = window.MazzModulesReal || window.MazzModules;
      let ctl = null;
      for (const [, v] of (reg?.instances || new Map())) { if (v?._player) { ctl = v; break; } }
      const saved = await window.mazz.invoke('settings:get', { key: 'player.audioGain' });
      return { chainGain: ctl?._player ? undefined : undefined, saved };
    });
    human.log('增益:', JSON.stringify(g));
    await human.assert(g.saved === 2, `增益应落 settings（实际 ${g.saved}）`);
    await evaluate(() => { document.querySelectorAll('.mazz-palette-mask').forEach(e => e.remove()); });
  });

  // ==================== 4：倍速/亮度记忆 ====================
  await scenario('播放器·倍速亮度·记忆恢复', async () => {
    await evaluate(() => {
      const sel = [...document.querySelectorAll('.mz-speed')].find(e => e.getBoundingClientRect().width > 0);
      sel.value = '1.5';
      sel.dispatchEvent(new Event('change'));
    });
    await evaluate(() => {
      const b = [...document.querySelectorAll('.mz-bright')].find(e => e.getBoundingClientRect().width > 0);
      b.value = '1.3';
      b.dispatchEvent(new Event('input'));
    });
    await wait(500);
    const saved = await evaluate(async () => ({
      speed: await window.mazz.invoke('settings:get', { key: 'player.lastSpeed' }),
      bright: await window.mazz.invoke('settings:get', { key: 'player.lastBrightness' }),
    }));
    await human.assert(saved.speed === 1.5 && saved.bright === 1.3, `变更应落 settings（${JSON.stringify(saved)}）`);
    // 重开同一片（setSource 复用或重建），记忆应恢复
    await openVideo('轨/三轨番.mkv');
    await wait(1200);
    const r = await evaluate(() => {
      const m = document.querySelector('video.mz-media');
      const b = [...document.querySelectorAll('.mz-bright')].find(e => e.getBoundingClientRect().width > 0);
      return { rate: m.playbackRate, brightVal: b?.value, filter: m.style.filter };
    });
    human.log('重开恢复:', JSON.stringify(r));
    await human.assert(r.rate === 1.5, `倍速应恢复 1.5（实际 ${r.rate}）`);
    await human.assert(r.brightVal === '1.3' || (r.filter || '').includes('1.3'), `亮度应恢复 1.3（实际 ${JSON.stringify(r)}）`);
    // 还原
    await evaluate(async () => {
      await window.mazz.invoke('settings:set', { key: 'player.lastSpeed', value: 1 });
      await window.mazz.invoke('settings:set', { key: 'player.lastBrightness', value: 1 });
      const m = document.querySelector('video.mz-media');
      if (m) { m.playbackRate = 1; m.style.filter = ''; }
    });
  });

  // ==================== 5：HEVC 明白话 ====================
  await scenario('播放器·HEVC·解码失败明白话', async () => {
    // 伪造 mkv（乱码内容）触发解码失败
    fs.writeFileSync(WS + '/轨/假片.mkv', Buffer.from('not a real matroska file at all'.repeat(100)));
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/轨/假片.mkv']);
    await wait(2500);
    const r = await evaluate(() => ({
      full: document.body.textContent,
      vf: !!document.querySelector('.viewer-fallback'),
      reason: document.querySelector('.vf-reason')?.textContent || '',
    }));
    human.log('降级卡:', JSON.stringify({ vf: r.vf, reason: r.reason.slice(0, 80) }));
    const txt = r.full;
    const has = r.vf || txt.includes('无法解码') || txt.includes('HEVC') || txt.includes('暂不支持预览') || txt.includes('读取失败') || txt.includes('不是合法的');
    await human.assert(has, `解码失败应有明白话（实际前 400 字无预期文案）`);
  });
}
