// renderer/modules/viewer/player.js —— Mazz Player（名义独立 · 内核与查看器共享）
// PotPlayer 风：深色皮肤 · 控制条自动隐藏 · 进度条悬停缩略图 · 无边框播放 · 播放列表 · 高保真信息 · 音频频谱
import { iconHtml } from '../../lib/svg-icons.js';

const MEDIA_VIDEO = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', 'ts', 'mts', 'm2ts', 'mpg', 'mpeg', '3gp']);
const MEDIA_AUDIO = new Set(['mp3', 'wav', 'oga', 'm4a', 'aac', 'flac', 'opus', 'ogg']);

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '--:--';
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}

export function createPlayer(root, { url, name, ext, path, kind, fileSize = 0, onClose, onNav }) {
  // 源信息可变承载（切歌复用 stage 不重建：setSource 全量更新这几项）
  let curUrl = url, curName = name, curPath = path, curSize = fileSize;
  const isVideo = kind === 'video';
  root.classList.add('mz-player');
  root.innerHTML = `
    <div class="mz-stage">
      ${isVideo ? `<video class="mz-media" playsinline></video>` : `
        <div class="mz-audio-wrap">
          <canvas class="mz-spectrum"></canvas>
          <div class="mz-audio-disc"><span>🎵</span></div>
          <audio class="mz-media"></audio>
        </div>`}
      <div class="mz-topbar">
        <span class="mz-name" title="${name}"></span>
        <span class="mz-meta"></span>
        <button class="mz-x" data-a="close" title="关闭">${iconHtml('✕')}</button>
      </div>
      <div class="mz-side" style="display:none">
        <div class="mz-side-head">播放列表 <span class="mz-side-count"></span><button class="mz-side-x" data-a="side-close" title="收起播放列表">${iconHtml('✕')}</button></div>
        <div class="mz-list"></div>
      </div>
      <div class="mz-controls">
        <div class="mz-seek">
          <div class="mz-seek-track"><div class="mz-seek-fill"></div><div class="mz-seek-knob"></div></div>
          <div class="mz-thumb" style="display:none"><canvas></canvas><span></span></div>
        </div>
        <div class="mz-bar">
          <button class="mz-btn" data-a="prev" title="上一个">${iconHtml('⏮')}</button>
          <button class="mz-btn mz-play" data-a="play" title="播放/暂停（空格）">${iconHtml('▶')}</button>
          <button class="mz-btn" data-a="next" title="下一个">${iconHtml('⏭')}</button>
          <span class="mz-time"><b>00:00</b> / --:--</span>
          <span style="flex:1"></span>
          <button class="mz-btn" data-a="mute" title="静音（M）">${iconHtml('🔊')}</button>
          <input class="mz-vol" type="range" min="0" max="1" step="0.05" value="1" title="音量（↑↓）">
          <span class="mz-bright-wrap" title="画面亮度">${iconHtml('☀')}<input class="mz-bright" type="range" min="0.4" max="1.6" step="0.05" value="1"></span>
          <select class="mz-speed" title="倍速">${[0.5, 0.8, 1, 1.2, 1.5, 2].map(v => `<option value="${v}" ${v === 1 ? 'selected' : ''}>${v}×</option>`).join('')}</select>
          <button class="mz-btn" data-a="loop" title="循环（L）：列表循环">${iconHtml('🔁')}</button>
          <button class="mz-btn" data-a="snap" title="截图（S）">${iconHtml('📷')}</button>
          <button class="mz-btn" data-a="gif" title="录制 GIF（G）：再按停止并转码">${iconHtml('🎞')}</button>
          <button class="mz-btn" data-a="progmem" title="进度记忆（可开关）：记住本片播放位置，下次接着看">${iconHtml('🕐')}</button>
          <button class="mz-btn" data-a="list" title="播放列表">${iconHtml('☰')}</button>
          <button class="mz-btn" data-a="zoom-reset" title="画面复位（缩放/亮度一键还原）">1:1</button>
          <button class="mz-btn" data-a="lock" title="窗口锁定（沉浸观影防误触，一键开关）">${iconHtml('🔓')}</button>
          <button class="mz-btn" data-a="borderless" title="无边框（B）">${iconHtml('▢')}</button>
          <button class="mz-btn" data-a="fullscreen" title="全屏（F）">${iconHtml('⛶')}</button>
        </div>
      </div>
    </div>`;

  const media = root.querySelector('.mz-media');
  media.src = url;
  const stage = root.querySelector('.mz-stage');

  // ==================== 播放进度记忆（可开关）：按文件路径记住屏位秒数，下次接着看 ====================
  const PROGMEM_KEY = 'player.progress', PROGMEM_SW = 'player.progressEnabled';
  let progEnabled = true;
  const progBtn = root.querySelector('[data-a=progmem]');
  const syncProgBtn = () => {
    progBtn.classList.toggle('on', progEnabled);
    progBtn.style.opacity = progEnabled ? '1' : '.45';
    progBtn.title = progEnabled ? '进度记忆：开（点击关闭）——本片位置正在记录' : '进度记忆：关（点击开启）';
  };
  window.mazz?.invoke('settings:get', { key: PROGMEM_SW }).then(v => { progEnabled = v !== false; syncProgBtn(); }).catch(() => {});
  progBtn.addEventListener('click', () => {
    progEnabled = !progEnabled;
    window.mazz?.invoke('settings:set', { key: PROGMEM_SW, value: progEnabled }).catch(() => {});
    syncProgBtn();
    import('../../shell/shell.js').then(({ toast }) => toast(progEnabled ? '进度记忆已开启' : '进度记忆已关闭'));
  });
  const saveProgMem = () => {
    if (!progEnabled || !curPath || !isFinite(media.duration) || media.duration <= 0) return;
    window.mazz.invoke('settings:get', { key: PROGMEM_KEY }).then(all => {
      all = all || {};
      // 片头 5s 内/片尾 5s 内不记（没什么可接的）
      if (media.currentTime > 5 && media.currentTime < media.duration - 5) all[curPath] = Math.floor(media.currentTime);
      else delete all[curPath];
      window.mazz.invoke('settings:set', { key: PROGMEM_KEY, value: all }).catch(() => {});
    }).catch(() => {});
  };
  const progMemTimer = setInterval(saveProgMem, 4000);
  media.addEventListener('pause', saveProgMem);
  // 打开即恢复：该片有记录且开关开 → 元数据就绪后跳回（用户在别处接着看的体验）
  window.mazz?.invoke('settings:get', { key: PROGMEM_KEY }).then(all => {
    const t = all?.[curPath];
    if (progEnabled && t > 0) {
      media.addEventListener('loadedmetadata', () => {
        if (isFinite(media.duration) && t < media.duration - 2) {
          media.currentTime = t;
          import('../../shell/shell.js').then(({ toast }) => toast('已从上次位置 ' + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') + ' 继续'));
        }
      }, { once: true });
    }
  }).catch(() => {});
  const controls = root.querySelector('.mz-controls');
  const topbar = root.querySelector('.mz-topbar');
  const playBtn = root.querySelector('[data-a=play]');
  const timeEl = root.querySelector('.mz-time');
  const fill = root.querySelector('.mz-seek-fill');
  const knob = root.querySelector('.mz-seek-knob');
  const track = root.querySelector('.mz-seek-track');
  const thumb = root.querySelector('.mz-thumb');
  const thumbCanvas = thumb.querySelector('canvas');
  const thumbLabel = thumb.querySelector('span');

  const ctl = {
    playlist: [], plIndex: -1, loop: 'list', // list | single | sequential | off
    borderless: false, seeking: false, analyser: null,
  };

  root.querySelector('.mz-name').textContent = name;

  // ---------- 高保真信息 ----------
  (async () => {
    const bits = [];
    if (ext) bits.push(ext.toUpperCase());
    if (curSize) bits.push((curSize / 1048576).toFixed(1) + ' MB');
    media.addEventListener('loadedmetadata', async () => {
      if (isVideo && media.videoWidth) bits.push(`${media.videoWidth}×${media.videoHeight}`);
      if (isFinite(media.duration) && media.duration > 0 && curSize) {
        bits.push(Math.round(curSize * 8 / media.duration / 1000) + ' kbps');
      }
      if (!isVideo) {
        // 采样信息（Hi-Res 展示：采样率/声道/位深估计）
        try {
          const ctx = ctl._actx || new AudioContext();
          ctl._actx = ctx;
          const resp = await fetch(url);
          const slice = await resp.arrayBuffer();
          const decoded = await ctx.decodeAudioData(slice.slice(0, Math.min(slice.byteLength, 8 * 1048576)));
          bits.push((decoded.sampleRate / 1000).toFixed(1) + ' kHz');
          bits.push(decoded.numberOfChannels + ' 声道');
          bits.push('≈' + (decoded.sampleRate * decoded.numberOfChannels * 16 / 1000).toFixed(0) + ' kbps/16bit');
        } catch {}
      }
      root.querySelector('.mz-meta').textContent = bits.join(' · ');
    }, { once: true });
  })();

  // ---------- 播放列表（同目录媒体自动入队） ----------
  (async () => {
    if (!path) return;
    const dir = curPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
    const exts = new Set([...MEDIA_VIDEO, ...MEDIA_AUDIO]);
    ctl.playlist = entries.filter(e => !e.isDir && exts.has(e.name.split('.').pop().toLowerCase()))
      .map(e => e.path).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    ctl.plIndex = ctl.playlist.indexOf(curPath);
    root.querySelector('.mz-side-count').textContent = `（${ctl.playlist.length}）`;
    const listEl = root.querySelector('.mz-list');
    listEl.innerHTML = ctl.playlist.map((p, i) =>
      `<div class="mz-li${i === ctl.plIndex ? ' on' : ''}" data-i="${i}">${p.split('/').pop()}</div>`).join('');
    listEl.querySelectorAll('.mz-li').forEach(el => el.addEventListener('click', () => navTo(+el.dataset.i)));
  })();
  function navTo(i) {
    if (i < 0 || i >= ctl.playlist.length) return;
    const p = ctl.playlist[i];
    onNav?.(p);
  }
  const next = () => navTo(ctl.plIndex + 1 < ctl.playlist.length ? ctl.plIndex + 1 : 0);
  const prev = () => navTo(ctl.plIndex - 1 >= 0 ? ctl.plIndex - 1 : ctl.playlist.length - 1);

  // ---------- 播放/进度 ----------
  const togglePlay = () => { media.paused ? media.play().catch(() => {}) : media.pause(); };
  playBtn.addEventListener('click', togglePlay);
  root.querySelector('[data-a=prev]').addEventListener('click', prev);
  root.querySelector('[data-a=next]').addEventListener('click', next);
  media.addEventListener('play', () => { playBtn.innerHTML = iconHtml('⏸'); root.querySelector('.mz-audio-disc')?.classList.add('spin'); });
  media.addEventListener('pause', () => { playBtn.innerHTML = iconHtml('▶'); root.querySelector('.mz-audio-disc')?.classList.remove('spin'); });
  media.addEventListener('loadedmetadata', () => {
    timeEl.innerHTML = `<b>00:00</b> / ${fmtTime(media.duration)}`;
  });
  media.addEventListener('timeupdate', () => {
    if (ctl.seeking || !isFinite(media.duration)) return;
    const pct = (media.currentTime / media.duration) * 100;
    fill.style.width = pct + '%';
    knob.style.left = pct + '%';
    timeEl.innerHTML = `<b>${fmtTime(media.currentTime)}</b> / ${fmtTime(media.duration)}`;
  });
  media.addEventListener('ended', () => {
    if (ctl.loop === 'sequential' && ctl.plIndex + 1 >= ctl.playlist.length) return; // 顺序播：播完即停
    if (ctl.loop === 'single' || ctl.playlist.length <= 1 || next === undefined) {
      media.currentTime = 0;
      media.play().catch(() => {});
      return;
    }
    // 列表循环：下一个就是当前文件（单曲）→ 原地重播不重建；否则切下一首
    const ni = ctl.plIndex + 1 < ctl.playlist.length ? ctl.plIndex + 1 : 0;
    if (ctl.playlist[ni] === curPath) { media.currentTime = 0; media.play().catch(() => {}); }
    else next();
  });

  // 进度条拖拽
  const seekTo = (clientX) => {
    const r = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    if (isFinite(media.duration)) media.currentTime = ratio * media.duration;
    fill.style.width = ratio * 100 + '%';
    knob.style.left = ratio * 100 + '%';
  };
  track.addEventListener('pointerdown', (e) => { ctl.seeking = true; seekTo(e.clientX); track.setPointerCapture?.(e.pointerId); e.stopPropagation(); });
  // 悬停判定挂父区域（整个进度条区，含上下缓冲带），拖拽仍走轨道本身
  const seekZone = track.parentElement;
  seekZone.addEventListener('pointermove', (e) => { if (ctl.seeking) seekTo(e.clientX); hoverThumb(e); });
  track.addEventListener('pointermove', (e) => { if (ctl.seeking) seekTo(e.clientX); });
  track.addEventListener('pointerup', () => { ctl.seeking = false; thumb.style.display = 'none'; });
  // 延迟隐藏：移动经过的瞬时 leave 不误杀，真正离开才隐藏
  track.parentElement.addEventListener('pointerenter', () => clearTimeout(ctl._thumbHideT));
  track.parentElement.addEventListener('pointermove', () => clearTimeout(ctl._thumbHideT));
  track.parentElement.addEventListener('pointerleave', () => {
    if (ctl.seeking) return;
    clearTimeout(ctl._thumbHideT);
    ctl._thumbHideT = setTimeout(() => { thumb.style.display = 'none'; }, 160);
  });

  // ---------- 悬停缩略图 ----------
  let hoverTimer = null, previewVideo = null;
  function ensurePreviewVideo() {
    if (!previewVideo && isVideo) {
      previewVideo = document.createElement('video');
      previewVideo.muted = true;
      previewVideo.preload = 'auto';
      previewVideo.src = url;
    }
    return previewVideo;
  }
  function hoverThumb(e) {
    if (!isVideo) return;
    const r = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (!isFinite(media.duration)) return;
    thumb.style.display = 'block';
    thumbLabel.textContent = fmtTime(ratio * media.duration);
    // 等比宽度不固定：先显示再按实际宽度居中钳位
    const tw = thumb.offsetWidth || 140;
    thumb.style.left = Math.min(Math.max(8, ratio * r.width - tw / 2), Math.max(8, r.width - tw - 8)) + 'px';
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const pv = ensurePreviewVideo();
      if (!pv) return;
      const draw = () => {
        // 按视频实际宽高比等比缩放（宽≤160 高≤120），不再固定 16:9 拉伸变形
        const vw = pv.videoWidth || 16, vh = pv.videoHeight || 9;
        const scale = Math.min(160 / vw, 120 / vh);
        const w = Math.max(60, Math.round(vw * scale)), h = Math.max(34, Math.round(vh * scale));
        thumbCanvas.width = w; thumbCanvas.height = h;
        thumbCanvas.style.width = w + 'px'; thumbCanvas.style.height = h + 'px';
        const c2d = thumbCanvas.getContext('2d');
        try { c2d.drawImage(pv, 0, 0, w, h); } catch {}
      };
      if (pv.readyState >= 2 && Math.abs(pv.currentTime - ratio * media.duration) < 0.8) draw();
      else {
        pv.currentTime = ratio * media.duration;
        pv.addEventListener('seeked', draw, { once: true });
      }
    }, 110);
  }

  // ---------- GIF 录制（截帧 → ffmpeg.wasm 转 GIF） ----------
  let gifRec = null;
  root.querySelector('[data-a=gif]')?.addEventListener('click', async () => {
    const btn = root.querySelector('[data-a=gif]');
    if (!isVideo) { import('../../shell/shell.js').then(({ toast }) => toast('GIF 录制仅视频可用')); return; }
    if (gifRec) {
      // 停止并转码
      const { stream, rec, drawTimer } = gifRec;
      gifRec = null;
      btn.innerHTML = iconHtml('🎞');
      btn.classList.remove('on');
      clearInterval(drawTimer); // 停抽帧
      try { rec.rec?.state !== 'inactive' && rec.rec.stop(); } catch {}
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    try {
      const { toast } = await import('../../shell/shell.js');
      // 离屏缩放截帧：4K 原画 captureStream 与播放共用解码管线，截帧即卡死（实锤）。
      // 改走离屏 canvas 480p 抽帧（GPU 合成 drawImage，播放不抢线）——录制与播放两路并行
      const cw = 480, ch = Math.max(2, Math.round(cw * (media.videoHeight || 270) / (media.videoWidth || 480)));
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      const cx = cv.getContext('2d');
      const drawTimer = setInterval(() => {
        if (!media.paused && !media.ended && media.readyState >= 2) {
          try { cx.drawImage(media, 0, 0, cw, ch); } catch {}
        }
      }, 100); // 10fps 抽帧
      const stream = cv.captureStream(10);
      // 轻量内联录制（webm 容器）
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      rec.onstop = async () => {
        btn.disabled = true; btn.textContent = '转码中…';
        try {
          toast('正在转码 GIF（两阶段调色板）…');
          const blob = new Blob(chunks, { type: 'video/webm' });
          const buf = new Uint8Array(await blob.arrayBuffer());
          const { transcode } = await import('../../lib/ffmpeg-transcode.js');
          const gif = await transcode(buf, 'webm', { toGif: true, gifWidth: 360, gifFps: 10 });
          const { wsPath } = await import('../../lib/ws-path.js');
          const dir = await wsPath('/录制');
          await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
          let bin = '';
          for (let i = 0; i < gif.length; i += 8192) bin += String.fromCharCode(...gif.subarray(i, i + 8192));
          const p = `${dir}/GIF-${stamp}.gif`;
          await window.mazz.invoke('fs:writeFileBase64', { path: p, base64: btoa(bin) });
          toast('GIF 已保存：' + p.split('/').pop());
        } catch (e) { toast('GIF 转码失败：' + e.message); }
        finally { btn.disabled = false; btn.innerHTML = iconHtml('🎞'); }
      };
      rec.start(500);
      gifRec = { stream, rec, drawTimer };
      btn.textContent = '■ 停止';
      btn.classList.add('on');
      toast('GIF 录制中…（再按停止并转码）');
    } catch (e) {
      import('../../shell/shell.js').then(({ toast }) => toast('GIF 录制失败：' + e.message));
    }
  });

  // ---------- 音量/倍速/循环/截图 ----------
  const vol = root.querySelector('.mz-vol');
  // 亮度调节（filter:brightness）
  const bright = root.querySelector('.mz-bright');
  if (bright) bright.addEventListener('input', () => {
    media.style.filter = `brightness(${bright.value})`;
  });
  // 窗口锁定：沉浸观影防误触（锁后键盘/鼠标媒体控制全部失效，再点一次或 Esc 解锁）
  let locked = false;
  const lockBtn = root.querySelector('[data-a=lock]');
  const setLock = (v) => {
    locked = v;
    root.classList.toggle('mz-locked', v);
    lockBtn.innerHTML = iconHtml(v ? '🔒' : '🔓');
    lockBtn.classList.toggle('on', v);
    import('../../shell/shell.js').then(({ toast }) => toast(v ? '已锁定（点锁定键或 Esc 解锁）' : '已解锁'));
  };
  lockBtn?.addEventListener('click', (e) => { e.stopPropagation(); setLock(!locked); });

  // 画面复位：缩放/亮度一键还原
  root.querySelector('[data-a=zoom-reset]')?.addEventListener('click', () => {
    stageZoom = 1;
    media.style.transform = '';
    if (bright) { bright.value = 1; media.style.filter = ''; }
    import('../../shell/shell.js').then(({ toast }) => toast('画面已复位'));
  });

  // 全屏时 Ctrl+滚轮缩放画面（transform scale，0.5–3x）
  let stageZoom = 1;
  root.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (!root.classList.contains('fs') && !document.fullscreenElement) return;
    e.preventDefault();
    e.stopPropagation(); // 阻断冒泡：pane-zoom 挂 window 级，不拦就会把 editor-area/边栏一起缩（全屏缩放错目标实锤）
    stageZoom = Math.min(3, Math.max(0.5, stageZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    media.style.transform = `scale(${stageZoom.toFixed(2)})`;
    media.style.transformOrigin = 'center';
    import('../../shell/shell.js').then(({ toast }) => toast('画面 ' + Math.round(stageZoom * 100) + '%'));
  }, { passive: false });
  const muteBtn = root.querySelector('[data-a=mute]');
  vol.addEventListener('input', () => { media.volume = +vol.value; media.muted = +vol.value === 0; syncVolIcon(); });
  function syncVolIcon() {
    muteBtn.innerHTML = iconHtml(media.muted || media.volume === 0 ? '🔇' : media.volume < 0.5 ? '🔉' : '🔊');
  }
  muteBtn.addEventListener('click', () => { media.muted = !media.muted; syncVolIcon(); });
  root.querySelector('.mz-speed').addEventListener('change', (e) => { media.playbackRate = +e.target.value; });
  const loopBtn = root.querySelector('[data-a=loop]');
  loopBtn.addEventListener('click', () => {
    ctl.loop = { list: 'single', single: 'sequential', sequential: 'off', off: 'list' }[ctl.loop];
    loopBtn.innerHTML = iconHtml({ list: '🔁', single: '🔂', sequential: '⏭', off: '🔁' }[ctl.loop]);
    loopBtn.title = '循环（L）：' + ({ list: '列表循环', single: '单集循环', sequential: '顺序播（播完即停）', off: '关闭循环' })[ctl.loop];
    loopBtn.classList.toggle('off', ctl.loop === 'off');
  });
  root.querySelector('[data-a=snap]').addEventListener('click', async () => {
    if (!isVideo) return;
    try {
      const c = document.createElement('canvas');
      c.width = media.videoWidth; c.height = media.videoHeight;
      c.getContext('2d').drawImage(media, 0, 0);
      const ws = await window.mazz.invoke('workspace:get');
      const dir = `${ws}/录制/截图`;
      await window.mazz.invoke('fs:mkdir', { path: dir });
      const p = `${dir}/snap_${Date.now()}.png`;
      await window.mazz.invoke('fs:writeFileBase64', { path: p, base64: c.toDataURL('image/png').split(',')[1] });
      const { toast } = await import('../../shell/shell.js');
      toast('截图已存到 录制/截图/');
    } catch (e) {}
  });

  // ---------- 播放列表面板 ----------
  root.querySelector('[data-a=list]').addEventListener('click', () => {
    const side = root.querySelector('.mz-side');
    side.style.display = side.style.display === 'none' ? 'flex' : 'none';
  });
  // 侧栏独立收起钮（点了没反应的吐槽根因：原只能靠复点列表钮猜）
  root.querySelector('[data-a=side-close]').addEventListener('click', () => {
    root.querySelector('.mz-side').style.display = 'none';
  });

  // ---------- 无边框 / 全屏 ----------
  const chromeEls = [controls, topbar];
  let hideTimer = null;
  function scheduleHide() {
    clearTimeout(hideTimer);
    if (media.paused) return;
    hideTimer = setTimeout(() => {
      if (!ctl.borderless) controls.classList.add('fade');
      topbar.classList.add('fade');
    }, 2400);
  }
  function showChrome() {
    controls.classList.remove('fade');
    topbar.classList.remove('fade');
    scheduleHide();
  }
  stage.addEventListener('mousemove', showChrome);
  stage.addEventListener('pointerdown', showChrome);
  media.addEventListener('play', scheduleHide);
  media.addEventListener('pause', showChrome);
  root.querySelector('[data-a=borderless]').addEventListener('click', () => {
    ctl.borderless = !ctl.borderless;
    root.classList.toggle('borderless', ctl.borderless);
    // 真无边框：隐藏应用 titlebar/ribbon/statusbar（此前只隐播放器控制条，窗口框原样=没体现作用）
    document.body.classList.toggle('player-borderless', ctl.borderless);
    import('../../shell/shell.js').then(({ toast }) => toast(ctl.borderless ? '无边框已开（再按 B 还原）' : '已还原'));
  });
  root.querySelector('[data-a=fullscreen]').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => {
    root.classList.toggle('fs', !!document.fullscreenElement);
  });
  stage.addEventListener('dblclick', (e) => {
    if (e.target.closest('.mz-controls, .mz-topbar, .mz-side')) return;
    togglePlay();
  });

  // ---------- 音频频谱 ----------
  if (!isVideo) {
    try {
      const ctx = ctl._actx || new AudioContext();
      ctl._actx = ctx;
      const src = ctx.createMediaElementSource(media);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      const canvas = root.querySelector('.mz-spectrum');
      const c2d = canvas.getContext('2d');
      const data = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
        analyser.getByteFrequencyData(data);
        c2d.clearRect(0, 0, canvas.width, canvas.height);
        const n = data.length;
        for (let i = 0; i < n; i++) {
          const h = (data[i] / 255) * canvas.height * 0.9;
          const grad = c2d.createLinearGradient(0, canvas.height - h, 0, canvas.height);
          grad.addColorStop(0, getComputedStyle(root).getPropertyValue('--accent') || '#e3b341');
          grad.addColorStop(1, 'transparent');
          c2d.fillStyle = grad;
          c2d.fillRect((i / n) * canvas.width, canvas.height - h, canvas.width / n * 0.7, h);
        }
        if (root.isConnected) requestAnimationFrame(draw);
      };
      draw();
    } catch {}
  }

  // ---------- 快捷键 ----------
  const onKey = (e) => {
    // 门控三连：播放器已卸载/不可见（非活动标签）/焦点在输入框 → 一律放行
    // 此前只查 isConnected，后台标签的播放器照样吃全局按键（空格/方向键乱入编辑器）——快捷键逻辑爆炸的病根
    // 全屏感知：stage 脱流进 top layer 后 root 内容塌缩（rect 归零），可见性检查必须放行——
    // 否则全屏快捷键全灭、锁定后连 Esc 解锁键都进不来（全屏锁定死，两症同根）
    const inFs = !!document.fullscreenElement && root.contains(document.fullscreenElement);
    if (!inFs && (!root.isConnected || !root.offsetParent || root.getBoundingClientRect().width < 10)) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (locked) {
      if (e.key === 'Escape') { e.stopPropagation(); setLock(false); }
      return; // 锁定中：除解锁外全部按键失效（沉浸防误触）
    }
    const used = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (e.key === ' ') used(() => togglePlay());
    else if (e.key === 'ArrowLeft') used(() => { media.currentTime = Math.max(0, media.currentTime - 5); });
    // duration 未就绪（NaN）时不做上限 clamp——否则 ||0 把快进永远钳到 0（v33 实测）
    else if (e.key === 'ArrowRight') used(() => { media.currentTime = Number.isFinite(media.duration) ? Math.min(media.duration, media.currentTime + 5) : media.currentTime + 5; });
    else if (e.key === 'ArrowUp') used(() => { vol.value = Math.min(1, +vol.value + 0.1); media.volume = +vol.value; media.muted = +vol.value === 0; syncVolIcon(); });
    else if (e.key === 'ArrowDown') used(() => { vol.value = Math.max(0, +vol.value - 0.1); media.volume = +vol.value; media.muted = +vol.value === 0; syncVolIcon(); });
    else if (e.key.toLowerCase() === 'm') used(() => muteBtn.click());
    else if (e.key.toLowerCase() === 'l') used(() => loopBtn.click());
    else if (e.key.toLowerCase() === 'f') used(() => root.querySelector('[data-a=fullscreen]').click());
    else if (e.key.toLowerCase() === 'b') used(() => root.querySelector('[data-a=borderless]').click());
    else if (e.key.toLowerCase() === 's' && isVideo) used(() => root.querySelector('[data-a=snap]').click());
  };
  document.addEventListener('keydown', onKey, true);

  root.querySelector('[data-a=close]').addEventListener('click', () => onClose?.());

  media.play().catch(() => {});
  scheduleHide();

  /** 切歌复用：只换源不重建（stage 不销毁，全屏物理保持——比 wasFs 恢复 requestFullscreen 可靠） */
  function setSource(newUrl, newName, newPath, newSize = 0) {
    saveProgMem(); // 旧片先存进度（用旧 curPath）
    curUrl = newUrl; curName = newName; curPath = newPath;
    curSize = newSize;
    media.pause();
    media.src = curUrl;
    root.querySelector('.mz-name').textContent = curName;
    root.querySelector('.mz-name').title = curName;
    // 进度记忆恢复（新片有记录接着看）
    window.mazz?.invoke('settings:get', { key: PROGMEM_KEY }).then(all => {
      const t = all?.[curPath];
      if (progEnabled && t > 0) {
        media.addEventListener('loadedmetadata', () => {
          if (isFinite(media.duration) && t < media.duration - 2) media.currentTime = t;
        }, { once: true });
      }
    }).catch(() => {});
    // 播放列表重算（目录可能变）+ 高亮当前
    (async () => {
      if (!curPath) return;
      const dir = curPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
      const exts = new Set([...MEDIA_VIDEO, ...MEDIA_AUDIO]);
      ctl.playlist = entries.filter(e => !e.isDir && exts.has(e.name.split('.').pop().toLowerCase()))
        .map(e => e.path).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      ctl.plIndex = ctl.playlist.indexOf(curPath);
      root.querySelector('.mz-side-count').textContent = `（${ctl.playlist.length}）`;
      const listEl = root.querySelector('.mz-list');
      if (listEl) {
        listEl.innerHTML = ctl.playlist.map((p, i) => `<div class="mz-li${i === ctl.plIndex ? ' on' : ''}" data-i="${i}">${p.split('/').pop()}</div>`).join('');
        listEl.querySelectorAll('.mz-li').forEach(el => el.addEventListener('click', () => navTo(+el.dataset.i)));
      }
    })();
    media.play().catch(() => {});
  }

  return {
    setSource,
    destroy() {
      document.removeEventListener('keydown', onKey, true);
      clearTimeout(hideTimer);
      clearInterval(progMemTimer); // 进度记忆定时器必清（泄漏会持续写 settings）
      saveProgMem(); // 销毁前终存一次（关签/切歌时位置不丢）
      if (previewVideo) { previewVideo.pause(); previewVideo.removeAttribute('src'); previewVideo = null; }
      try {
        // close() 在已关闭上下文上返回 rejected promise（同步 try 接不住）——二次销毁时 pageerror 的真凶
        const cp = ctl._actx?.close?.();
        cp?.catch?.(() => {});
        ctl._actx = null;
      } catch {}
      media.pause();
    },
  };
}
