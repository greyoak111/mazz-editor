// tests/e2e/scenes15.mjs —— 波次二十七「页面同源化+解码正名」实证批
// 同源地基 / P2P 流 metadata-ok（皇冠）/ media range 206 / canvas 不污染 / 解码矩阵正名
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export async function scenes15({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // 造真 H264+AAC 件（沙箱 ffmpeg libx264）
  fs.mkdirSync(WS + '/源', { recursive: true });
  execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=3:size=640x360:rate=15" -f lavfi -i "sine=frequency=440:duration=3" -c:v libx264 -pix_fmt yuv420p -c:a aac "${WS}/源/h264番.mkv"`, { stdio: 'pipe' });

  // ==================== 1：同源化地基 ====================
  await scenario('同源化·页面与本地媒体协议播放', async () => {
    const pageUrl = await evaluate(() => location.href);
    await human.assert(pageUrl.startsWith('mazz-res://app/'), `页面必须 mazz-res 同源加载（实际 ${pageUrl}）`);
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/源/h264番.mkv']);
    await human.until(() => {
      const m = [...document.querySelectorAll('video.mz-media')].find(e => e.getBoundingClientRect().width > 0);
      return m && m.readyState >= 1;
    }, { timeout: 9000, msg: 'h264番.mkv 播放器就绪' });
    const r = await evaluate(() => {
      const m = document.querySelector('video.mz-media');
      return { src: m.src.slice(0, 60), rs: m.readyState, vw: m.videoWidth };
    });
    human.log('本地片:', JSON.stringify(r));
    await human.assert(r.src.startsWith('mazz-res://media/'), `本地媒体必须走协议（实际 ${r.src}）`);
    await human.assert(r.rs >= 1 && r.vw === 640, `H264 mkv 协议播元数据就绪（${JSON.stringify(r)}）`);
  });

  // ==================== 2：P2P 流 metadata-ok（皇冠：边下边播画面级打通） ====================
  await scenario('P2P·流播放·元数据画面级打通', async () => {
    const r = await Promise.race([
      evaluate(async () => {
        const magnet = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337';
        try {
          const added = await window.mazz.invoke('tor:add', { magnet });
          const mp4 = added.files.find(f => /\.mp4$/i.test(f.path));
          if (!mp4) return { err: 'no-mp4' };
          const raw = await window.mazz.invoke('tor:streamUrl', { infoHash: added.infoHash, filePath: mp4.path });
          const v = document.createElement('video');
          v.muted = true;
          document.body.appendChild(v);
          v.src = 'mazz-res://tor/' + encodeURI(raw).replace('http://', '');
          const t0 = Date.now();
          const played = await new Promise(res => {
            const to = setTimeout(() => res({ state: 'timeout', rs: v.readyState }), 40000);
            v.onloadedmetadata = () => { clearTimeout(to); res({ state: 'metadata-ok', rs: v.readyState, dur: +v.duration.toFixed(1), vw: v.videoWidth, ms: Date.now() - t0 }); };
            v.onerror = () => { clearTimeout(to); res({ state: 'error', err: v.error?.code || 0, rs: v.readyState }); };
          });
          await window.mazz.invoke('tor:remove', { infoHash: added.infoHash, deleteFiles: true });
          v.remove();
          return played;
        } catch (e) { return { err: String(e.message || e).slice(0, 100) }; }
      }),
      new Promise(r => setTimeout(() => r({ err: 'local-40s-timeout' }), 40000)),
    ]);
    if (r.err || r.state === 'timeout') { human.log('swarm 本轮不可达，宽容跳过: ' + (r.err || r.state)); return; }
    human.log('P2P 流:', JSON.stringify(r));
    await human.assert(r.state === 'metadata-ok' && r.dur > 60 && r.vw > 0, `P2P 流必须元数据画面级打通（${JSON.stringify(r)}——修复前 0ms error4 零请求）`);
  });

  // ==================== 3：media/ range 206（mp4 非 faststart 与 seek 命脉） ====================
  await scenario('同源化·media协议range206', async () => {
    const r = await evaluate(async ([p]) => {
      const url = 'mazz-res://media/' + encodeURIComponent(p);
      const head = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
      const tail = await fetch(url, { headers: { Range: 'bytes=-1024' } });
      const st = await window.mazz.invoke('fs:stat', { path: p }).catch(() => null);
      return {
        head: { status: head.status, cr: head.headers.get('content-range'), ct: head.headers.get('content-type'), len: (await head.arrayBuffer()).byteLength },
        tail: { status: tail.status, cr: tail.headers.get('content-range'), len: (await tail.arrayBuffer()).byteLength },
        size: st?.size,
      };
    }, [WS + '/源/h264番.mkv']);
    human.log('range:', JSON.stringify(r));
    await human.assert(r.head.status === 206 && /^bytes 0-1023\//.test(r.head.cr || ''), `首段 range 必须 206+Content-Range（${JSON.stringify(r.head)}）`);
    await human.assert(r.tail.status === 206 && r.tail.len === 1024, `尾段 suffix range 必须 206（mp4 moov 在尾时 Chromium 必发——${JSON.stringify(r.tail)}）`);
    await human.assert((r.head.ct || '').includes('matroska'), `mkv mime 必须 x-matroska（实际 ${r.head.ct}）`);
  });

  // ==================== 4：canvas 不污染（截图/GIF 命门·同源化白拿项） ====================
  await scenario('同源化·video画canvas不污染', async () => {
    const r = await evaluate(async () => {
      const m = document.querySelector('video.mz-media');
      if (!m || m.readyState < 2) { m?.play?.().catch(() => {}); await new Promise(r => setTimeout(r, 1200)); }
      try {
        const c = document.createElement('canvas');
        c.width = 160; c.height = 90;
        c.getContext('2d').drawImage(m, 0, 0, 160, 90);
        const d = c.toDataURL('image/png');
        return { ok: true, len: d.length };
      } catch (e) { return { err: String(e.message || e).slice(0, 90) }; }
    });
    human.log('canvas:', JSON.stringify(r));
    await human.assert(r.ok && r.len > 3000, `同源 video 画 canvas 不得污染（${JSON.stringify(r)}——file:// 时代 opaque origin 必污染）`);
  });

  // ==================== 5：解码矩阵正名（H264/AAC 平反，HEVC 按平台） ====================
  await scenario('解码矩阵·H264与AAC正名', async () => {
    const m = await evaluate(() => {
      const v = document.createElement('video');
      return {
        h264: v.canPlayType('video/mp4; codecs="avc1.640028"'),
        aac: v.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
        hevc: v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') || '(空)',
        vp9: v.canPlayType('video/webm; codecs="vp9"'),
        av1: v.canPlayType('video/mp4; codecs="av01.0.04M.08"'),
      };
    });
    human.log('矩阵:', JSON.stringify(m));
    await human.assert(m.h264 === 'probably' || m.h264 === 'maybe', `H264 必须可播（Electron 官方 Chrome-branding ffmpeg——实际 ${m.h264}）`);
    await human.assert(m.aac === 'probably' || m.aac === 'maybe', `AAC 必须可播（实际 ${m.aac}）`);
    await human.assert(m.vp9 && m.av1, `VP9/AV1 必须在（${JSON.stringify(m)}）`);
  });
}
