// renderer/modules/viewer/player.js —— Mazz Player（名义独立 · 内核与查看器共享）
// PotPlayer 风：深色皮肤 · 控制条自动隐藏 · 进度条悬停缩略图 · 无边框播放 · 播放列表 · 高保真信息 · 音频频谱
import { iconHtml } from '../../lib/svg-icons.js';
import { attachSubtitle, detachSubtitle, probeSubtitles, setSubtitleVisible, subtitleAttached } from './subtitles.js';
import { nextEpisodePath } from '../../lib/episode-detect.js';
import { MATURITY, PRODUCT_CAPABILITIES } from '../../core/product-maturity.js';
import { classifyVideoFrameHealth, ZERO_VIDEO_FRAMES } from '../../lib/video-frame-health.js';

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
  const canExportGif = PRODUCT_CAPABILITIES.ffmpegRuntime.maturity !== MATURITY.HIDDEN;
  root.classList.add('mz-player');
  root.innerHTML = `
    <div class="mz-stage">
      ${isVideo ? `<video class="mz-media" playsinline></video>` : `
        <div class="mz-audio-wrap">
          <canvas class="mz-spectrum"></canvas>
          <div class="mz-audio-disc"><span>${iconHtml('🎵')}</span></div>
          <audio class="mz-media"></audio>
        </div>`}
      <div class="mz-topbar">
        <span class="mz-name" title="${name}"></span>
        <span class="mz-meta"></span>
        <button class="mz-x" data-a="close" title="关闭">${iconHtml('✕')}</button>
      </div>
      <div class="mz-side">
        <div class="mz-side-grip" title="拖拽调整宽度"></div>
        <div class="mz-side-head">
          <div class="mz-src-tabs">
            <button class="mz-src-tab on" data-src="playlist" title="同目录播放列表（原有）">播放列表</button>
            <button class="mz-src-tab" data-src="medialib" title="工作区媒体库（随工作区切换）">媒体库</button>
            <button class="mz-src-tab" data-src="web" title="网络资源（种子站搜索，边下边播）">网络资源</button>
            <button class="mz-src-tab" data-src="downloads" title="下载队列（关掉播放器标签仍继续）">下载</button>
          </div>
          <span class="mz-side-count"></span>
          <button class="mz-side-x" data-a="side-close" title="收起列表栏（视频区铺满）">${iconHtml('›')}</button>
        </div>
        <div class="mz-list"></div>
        <div class="mz-medialib" style="display:none"></div>
        <div class="mz-web" style="display:none"></div>
        <div class="mz-downloads" style="display:none"></div>
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
          <span class="mz-track-wrap" style="display:none"></span>
          <button class="mz-btn" data-a="pip" title="画中画（PiP）">${iconHtml('🗔')}</button>
          <button class="mz-btn" data-a="loop" title="循环（L）：列表循环">${iconHtml('🔁')}</button>
          <button class="mz-btn" data-a="snap" title="截图（S）">${iconHtml('📷')}</button>
          ${canExportGif ? `<button class="mz-btn" data-a="gif" title="录制 GIF（G）：再按停止并转码">${iconHtml('🎞')}</button>` : ''}
          <button class="mz-btn" data-a="progmem" title="进度记忆（可开关）：记住本片播放位置，下次接着看">${iconHtml('🕐')}</button>
          <button class="mz-btn" data-a="sub" title="字幕（ASS/SRT 特效字幕，自动探测同名字幕）">${iconHtml('💬')}</button>
          <button class="mz-btn" data-a="pset" title="播放设置（字幕/连播/片源）">${iconHtml('⚙')}</button>
          <button class="mz-btn" data-a="list" title="播放列表">${iconHtml('☰')}</button>
          <button class="mz-btn" data-a="zoom-reset" title="画面复位（缩放/亮度一键还原）">1:1</button>
          <button class="mz-btn" data-a="lock" title="窗口锁定（沉浸观影防误触，一键开关）">${iconHtml('🔓')}</button>
          <button class="mz-btn" data-a="borderless" title="无边框（B）">${iconHtml('▢')}</button>
          <button class="mz-btn" data-a="fullscreen" title="全屏（F）">${iconHtml('⛶')}</button>
        </div>
      </div>
    </div>`;

  const media = root.querySelector('.mz-media');
  if (url) media.src = url;
  else {
    // 空起手（W44 无视频启动）：舞台占位——侧栏三源全可用，导入/点源即播
    const empty = document.createElement('div');
    empty.className = 'mz-empty';
    empty.innerHTML = `<div class="mz-empty-in">
      <div class="mz-empty-ico">${iconHtml('🎬')}</div>
      <div class="mz-empty-t">没有正在播放的内容</div>
      <div class="mz-empty-d">左侧「媒体库 / 网络资源」选源即播，或直接导入视频</div>
      <button class="rb-btn mz-empty-btn">＋ 导入视频</button>
    </div>`;
    empty.style.cssText = 'position:absolute;left:0;top:0;bottom:0;right:var(--mz-side-w,0px);display:grid;place-items:center;background:#101014;z-index:3'; // 黑画面中央：侧栏推挤同步收窄（列表开不在列表下居中——真机点名校正）
    empty.querySelector('.mz-empty-in').style.cssText = 'text-align:center;color:#94a3b8;font-size:13px;line-height:2';
    empty.querySelector('.mz-empty-btn').style.cssText = 'margin-top:10px;padding:6px 18px';
    empty.querySelector('.mz-empty-btn').addEventListener('click', async () => {
      const r = await window.mazz.invoke('dialog:openFile', { filters: [{ name: '视频/音频', extensions: [...MEDIA_VIDEO, ...MEDIA_AUDIO] }], multi: false }).catch(() => null);
      const p = Array.isArray(r) ? r[0] : r;
      if (p) onNav?.(p);
    });
    root.querySelector('.mz-stage').appendChild(empty);
    root.querySelector('.mz-name').textContent = '查看器';
  }
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
  const captureProgress = () => {
    if (!curPath || !isFinite(media.currentTime)) return null;
    return { seconds: Math.max(0, Math.floor(media.currentTime)), duration: isFinite(media.duration) ? Math.floor(media.duration) : 0 };
  };
  const applyProgress = (value) => {
    const seconds = Math.max(0, Number(value?.seconds) || 0);
    if (!seconds) return;
    const seek = () => {
      if (!isFinite(media.duration) || seconds >= media.duration - 2) return;
      media.currentTime = seconds;
    };
    if (media.readyState >= 1) seek();
    else media.addEventListener('loadedmetadata', seek, { once: true });
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
  // ==================== 字幕（ASS/SRT 特效字幕：同名自动探测 + 外挂手动载入 + JASSUB/libass 渲染） ====================
  const SUB_SW = 'player.subtitleEnabled';
  let subEnabled = true, subVisible = true;
  const subBtn = root.querySelector('[data-a=sub]');
  const syncSubBtn = () => {
    subBtn.classList.toggle('on', subVisible && subtitleAttached());
    subBtn.style.opacity = subVisible ? '1' : '.45';
  };
  let subLoadSeq = 0; // 并发序号闸：settings 回调与 setSource 双触发只许最新一趟生效（并发双挂载竞态实锤）
  let subFor = null;   // 已挂载对应的路径（同片重进不重复挂载——竞态杀 in-flight 的总根，在这里闸死）
  async function loadAutoSubtitle(notify = false) {
    window.__subFlow = { stage: 'enter', isVideo, curPath, subEnabled, subFor };
    if (destroyed || !isVideo || !curPath || !subEnabled) return;
    if (subFor === curPath) return; // 同片已挂/在挂，重进跳过
    const seq = ++subLoadSeq;
    subFor = curPath; // 先占坑（在挂与已挂同坑，后来者见此即弃）
    const subs = await probeSubtitles(curPath);
    window.__subFlow = { stage: 'probed', count: subs.length, seq, subLoadSeq, curPath };
    if (destroyed || seq !== subLoadSeq || !subs.length) {
      subFor = null; // 后到的旧呼叫弃权
      // 手动点击必须有明白话（静默=「字幕按钮点击了没反应」实锤：探测不到就闷死）
      if (notify && !subs.length) import('../../shell/shell.js').then(({ toast }) => toast('未探测到同名字幕（.ass/.srt/.ssa 与视频同目录同名）——可用 播放设置→外挂字幕文件 手动挂载'));
      return;
    }
    try {
      await attachSubtitle(media, { subPath: subs[0] });
      if (destroyed || seq !== subLoadSeq) { detachSubtitle(); return; }
      subVisible = true;
      syncSubBtn();
      import('../../shell/shell.js').then(({ toast }) => toast('已挂载字幕：' + subs[0].split('/').pop()));
    } catch (e) {
      // 挂载失败必须明白报因（资产缺失/字体/解析），不许闷死——闷死的后果是用户以为"没字幕功能"
      import('../../shell/shell.js').then(({ toast }) => toast('字幕挂载失败：' + (e?.message || e)));
    }
  }
  window.mazz?.invoke('settings:get', { key: SUB_SW }).then(v => { subEnabled = v !== false; if (isVideo) loadAutoSubtitle(); syncSubBtn(); }).catch(() => {});
  subBtn.addEventListener('click', () => {
    if (!subtitleAttached()) { if (isVideo) loadAutoSubtitle(true); return; } // 手动点击：无字幕也要明白话
    subVisible = !subVisible;
    setSubtitleVisible(subVisible);
    syncSubBtn();
    import('../../shell/shell.js').then(({ toast }) => toast(subVisible ? '字幕显示' : '字幕隐藏'));
  });

  // ==================== 自动连播（番剧场景：同目录剧集嗅探，播完 3s 倒计时可取消） ====================
  const AUTO_NEXT_SW = 'player.autoNextEnabled';
  let autoNext = true;
  window.mazz?.invoke('settings:get', { key: AUTO_NEXT_SW }).then(v => { autoNext = v !== false; }).catch(() => {});

  // ==================== 播放设置面板（字幕/连播/片源集中地） ====================
  root.querySelector('[data-a=pset]')?.addEventListener('click', async () => {
    const { modal, toast } = await import('../../shell/shell.js');
    const m = modal('播放设置');
    const seedSites = [
      ['Nyaa（番剧种子总库）', 'https://nyaa.si'],
      ['动漫花园 DMHY', 'https://share.dmhy.org'],
      ['MioBT 猫萌', 'https://www.miobt.com'],
      ['acg.rip', 'https://acg.rip'],
      ['bangumi.moe 萌番组', 'https://bangumi.moe'],
    ];
    m.body.innerHTML = `
      <div style="min-width:420px;font-size:12.5px">
        <div class="ps-sec"><b>${iconHtml('💬')} 字幕</b>
          <label style="display:flex;gap:6px;align-items:center;margin:6px 0"><input type="checkbox" class="ps-sub-sw" ${subEnabled ? 'checked' : ''}> 自动探测同名字幕（.ass/.srt/.ssa）</label>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="rb-btn ps-sub-load" style="flex-direction:row">外挂字幕文件…</button>
            <span style="color:var(--fg-dim);font-size:11px">${subtitleAttached() ? '已挂载' : '未挂载'} · 渲染：JASSUB（libass wasm）</span>
          </div>
        </div>
        <div class="ps-sec" style="margin-top:12px"><b>${iconHtml('⏭')} 连播</b>
          <label style="display:flex;gap:6px;align-items:center;margin:6px 0"><input type="checkbox" class="ps-next-sw" ${autoNext ? 'checked' : ''}> 播完自动接下一集（同目录剧集嗅探，3s 倒计时可取消）</label>
        </div>
        <div class="ps-sec" style="margin-top:12px"><b>${iconHtml('🔊')} 音频增益</b>
          <div style="display:flex;gap:6px;align-items:center;margin:6px 0">
            <select class="rb-select ps-gain" title="音量增益（WebAudio 共享链，超出硬件 100%）">
              ${[1, 1.5, 2, 3].map(v => `<option value="${v}">${Math.round(v * 100)}%</option>`).join('')}
            </select>
            <span style="color:var(--fg-dim);font-size:11px">主媒体与外挂音轨同一增益节点（静音片源救星）</span>
          </div>
        </div>
        <div class="ps-sec" style="margin-top:12px"><b>${iconHtml('🎬')} 解码能力（本机实测）</b>
          <div class="ps-codec" style="font-size:11.5px;line-height:1.85;margin-top:6px;color:var(--fg-dim)">探测中…</div>
        </div>
        <div class="ps-sec" style="margin-top:12px"><b>${iconHtml('⬇')} 找片源（浏览器投稿会话打开，登录一次长期有效）</b>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
            ${seedSites.map(([n, u]) => `<button class="rb-btn ps-site" data-u="${u}" style="flex-direction:row">${n}</button>`).join('')}
          </div>
        </div>
      </div>`;
    // 解码自检：矩阵实测读数 + HEVC 缺失按平台给官方组件指引（微软商店组件 CDN 官方包）
    (async () => {
      const box = m.body.querySelector('.ps-codec');
      if (!box) return;
      const { probeCodecs, renderHevcGuide, currentPlatform } = await import('../../lib/codec-guide.js');
      const rows = probeCodecs();
      box.innerHTML = rows.map(r => `<div>${r.ok ? '<span style="color:var(--ok,#16a34a)">✓</span>' : '<span style="color:var(--danger,#dc2626)">✗</span>'} ${r.name}<span style="opacity:.55">（${r.verdict}）</span></div>`).join('');
      const hevc = rows.find(r => r.name.includes('HEVC'));
      if (hevc && !hevc.ok) {
        const guide = document.createElement('div');
        guide.className = 'ps-hevc-guide';
        guide.style.cssText = 'margin-top:6px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:11px;line-height:1.8';
        box.appendChild(guide);
        renderHevcGuide(guide, currentPlatform());
      }
    })().catch(() => {});
    m.body.querySelector('.ps-sub-sw').addEventListener('change', (e) => {
      subEnabled = e.target.checked;
      window.mazz?.invoke('settings:set', { key: SUB_SW, value: subEnabled }).catch(() => {});
      if (subEnabled && isVideo) loadAutoSubtitle();
      else if (!subEnabled) { subFor = null; detachSubtitle(); syncSubBtn(); }
    });
    m.body.querySelector('.ps-sub-load').addEventListener('click', async () => {
      const r = await window.mazz.invoke('dialog:openFile', { filters: [{ name: '字幕文件', extensions: ['ass', 'srt', 'ssa'] }] }).catch(() => null);
      const p = typeof r === 'string' ? r : (r?.path || r?.filePath || (Array.isArray(r) ? r[0] : null));
      if (!p) return;
      try {
        await attachSubtitle(media, { subPath: p });
        subVisible = true; syncSubBtn();
        m.close(); toast('已挂载外挂字幕：' + p.split('/').pop());
      } catch (e) { toast('字幕挂载失败：' + e.message); }
    });
    const gainSel = m.body.querySelector('.ps-gain');
    window.mazz?.invoke('settings:get', { key: 'player.audioGain' }).then(v => { if (gainSel) gainSel.value = String(v || 1); }).catch(() => {});
    gainSel?.addEventListener('change', (e) => setGain(+e.target.value));
    m.body.querySelector('.ps-next-sw').addEventListener('change', (e) => {
      autoNext = e.target.checked;
      window.mazz?.invoke('settings:set', { key: AUTO_NEXT_SW, value: autoNext }).catch(() => {});
    });
    m.body.querySelectorAll('.ps-site').forEach(btn => btn.addEventListener('click', () => {
      const u = btn.dataset.u;
      window.MazzShell?.openTab?.('browser', { title: '找片源', content: '' });
      setTimeout(() => window.__activeBrowserCtl?.openTabRaw?.(u, { partition: 'persist:mazz-author' }), 800);
      m.close();
    }));
  });

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
  // W71：播放器拥有的全局监听/定时器/媒体资源必须可枚举退役；destroy 允许重复调用。
  let destroyed = false;
  let dragCleanup = null;
  let autoNextTimer = null;
  let waveRaf = null;
  let decodeWatchTimer = null;
  let decodeWatchSeq = 0;
  let decodedFrameSignals = 0;
  let decodeFrameRequest = null;

  const clearDecodeWatch = () => {
    decodeWatchSeq += 1;
    clearTimeout(decodeWatchTimer);
    decodeWatchTimer = null;
    if (decodeFrameRequest != null && media.cancelVideoFrameCallback) {
      try { media.cancelVideoFrameCallback(decodeFrameRequest); } catch {}
    }
    decodeFrameRequest = null;
  };

  const removeDecodeFailure = () => root.querySelector('.mz-decode-failure')?.remove();

  const showDecodeFailure = () => {
    if (destroyed || root.querySelector('.mz-decode-failure')) return;
    media.pause();
    const overlay = document.createElement('div');
    overlay.className = 'mz-stream-err mz-decode-failure';
    overlay.innerHTML = `<b>${iconHtml('⚠')} 视频未解出画面，已停止假播放</b>
      <span>时间轴虽然推进，但播放器连续 4 秒没有收到任何视频帧。远程桌面、虚拟显示或当前图形安全模式可能禁用了这段视频所需的解码路径。</span>
      <div class="mz-decode-actions">
        <button class="rb-btn" data-a="decode-retry">重试画面</button>
        <button class="rb-btn" data-a="decode-open">用系统播放器打开</button>
      </div>
      <span class="mz-decode-guide"></span>`;
    overlay.querySelector('[data-a=decode-retry]').addEventListener('click', () => {
      removeDecodeFailure();
      decodedFrameSignals = 0;
      media.play().catch(() => {});
    });
    const openButton = overlay.querySelector('[data-a=decode-open]');
    const localPath = curPath && !/^(?:https?|blob|mazz-res):/i.test(curPath);
    if (localPath) openButton.addEventListener('click', () => window.mazz.invoke('shell:openPath', { path: curPath }).catch(() => {}));
    else openButton.style.display = 'none';
    stage.appendChild(overlay);
    import('../../lib/codec-guide.js').then(({ probeCodecs, renderHevcGuide, currentPlatform }) => {
      const hevc = probeCodecs().find(row => row.name.includes('HEVC'));
      if (hevc && !hevc.ok && overlay.isConnected) renderHevcGuide(overlay.querySelector('.mz-decode-guide'), currentPlatform());
    }).catch(() => {});
  };

  const armDecodeWatch = () => {
    clearDecodeWatch();
    if (!isVideo || destroyed || media.paused || media.ended) return;
    const seq = decodeWatchSeq;
    const startedAt = performance.now();
    const startedTime = media.currentTime;
    const quality = media.getVideoPlaybackQuality?.();
    const startedFrames = quality?.totalVideoFrames ?? 0;
    const startedSignals = decodedFrameSignals;
    if (media.requestVideoFrameCallback) {
      decodeFrameRequest = media.requestVideoFrameCallback(() => {
        decodeFrameRequest = null;
        decodedFrameSignals += 1;
      });
    }
    decodeWatchTimer = setTimeout(() => {
      decodeWatchTimer = null;
      if (destroyed || seq !== decodeWatchSeq) return;
      const currentQuality = media.getVideoPlaybackQuality?.();
      const failure = classifyVideoFrameHealth({
        isVideo,
        paused: media.paused,
        ended: media.ended,
        errorCode: media.error?.code || 0,
        readyState: media.readyState,
        elapsedMs: performance.now() - startedAt,
        currentTimeDelta: media.currentTime - startedTime,
        frameDelta: currentQuality ? currentQuality.totalVideoFrames - startedFrames : 0,
        frameCallbackDelta: decodedFrameSignals - startedSignals,
        videoWidth: media.videoWidth,
        qualityAvailable: !!currentQuality,
      });
      if (failure === ZERO_VIDEO_FRAMES) showDecodeFailure();
      else if (!media.paused && !media.ended) armDecodeWatch();
    }, 4000);
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

  // ==================== 资源四源（播放列表/媒体库/网络资源/下载队列） ====================
  const srcTabs = root.querySelectorAll('.mz-src-tab');
  const sideList = root.querySelector('.mz-list');
  const mlEl = root.querySelector('.mz-medialib');
  const webEl = root.querySelector('.mz-web');
  const downloadsEl = root.querySelector('.mz-downloads');
  ctl.srcMode = 'playlist';
  const setSrcMode = (m) => {
    ctl.srcMode = m;
    srcTabs.forEach(t => t.classList.toggle('on', t.dataset.src === m));
    sideList.style.display = m === 'playlist' ? '' : 'none';
    mlEl.style.display = m === 'medialib' ? 'flex' : 'none'; // flex 链有界滚动（列表没做滚动条实锤：父链无 flex 高度约束，溢出撑爆）
    webEl.style.display = m === 'web' ? 'flex' : 'none';
    downloadsEl.style.display = m === 'downloads' ? 'flex' : 'none';
    if (m === 'medialib') renderMedialib();
    if (m === 'web') renderWeb();
    if (m === 'downloads') { startWatchPoll(); renderDownloads(); }
  };
  srcTabs.forEach(t => t.addEventListener('click', () => setSrcMode(t.dataset.src)));

  // —— 媒体库：工作区媒体库（W44 递归树——下载按番组命名嵌套形成的多层文件夹全量检索，工作区同款树形显示） ——
  async function renderMedialib() {
    const ws = await window.mazz.invoke('workspace:get');
    const dir = ws + '/媒体库';
    await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
    const exts = new Set([...MEDIA_VIDEO, ...MEDIA_AUDIO]);
    const SKIP = new Set(['.audcache']); // 抽轨缓存目录不入库（纯中间产物）
    // 递归扫描（含 download 明面下载目录与旧 .download 未迁完残部——多层嵌套全检）
    async function walk(d, depth) {
      const entries = await window.mazz.invoke('fs:listDir', { path: d, includeDot: true }).catch(() => []);
      const out = [];
      for (const e of entries) {
        if (SKIP.has(e.name)) continue;
        if (e.isDir) out.push({ dir: e, depth, kids: await walk(e.path, depth + 1) });
        else if (exts.has(e.name.split('.').pop().toLowerCase())) out.push({ file: e, depth });
      }
      return out;
    }
    const tree = await walk(dir, 0);
    let total = 0;
    const countF = (nodes) => { for (const n of nodes) { if (n.file) total++; else countF(n.kids); } };
    countF(tree);
    root.querySelector('.mz-side-count').textContent = `（${total}）`;
    const escH = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const renderNodes = (nodes) => nodes.map(n => {
      if (n.dir) {
        const open = (ctl._mlOpen ??= new Set()).has(n.dir.path) || depth_default(n.depth);
        return `<div class="mz-ml-dir" data-d="${escH(n.dir.path)}" data-open="${open ? 1 : 0}">
          <span class="mz-ml-caret">${open ? '▾' : '▸'}</span><span class="mz-ml-dname" style="padding-left:${n.depth * 14}px">${iconHtml('📂')} ${escH(n.dir.name)}</span>
        </div><div class="mz-ml-kids" data-k="${escH(n.dir.path)}" style="display:${open ? '' : 'none'}">${renderNodes(n.kids)}</div>`;
      }
      return `<div class="mz-li mz-ml-item" data-p="${escH(n.file.path)}" title="${escH(n.file.path.replace(dir + '/', ''))}">
        <span class="mz-ml-name" style="padding-left:${n.depth * 14 + 14}px">${escH(n.file.name)}</span><span class="mz-ml-size">${(n.file.size / 1048576).toFixed(1)}MB</span>
      </div>`;
    }).join('');
    // 默认展开第一层（余者记忆折叠态）
    function depth_default(d) { return d < 1; }
    mlEl.innerHTML = `
      <div class="mz-ml-bar">
        <button class="rb-btn" data-ml="import" style="flex-direction:row">${iconHtml('＋')} 导入视频</button>
        <button class="rb-btn" data-ml="open" style="flex-direction:row" title="在文件管理器打开媒体库目录">${iconHtml('🗂')}</button>
      </div>
      <div class="mz-ml-list">` +
      (total ? renderNodes(tree) : '<div class="mz-dim">媒体库是空的——导入视频，或边下边播后选择「存到媒体库」</div>') +
      `</div>`;
    mlEl.querySelector('[data-ml=import]').addEventListener('click', async () => {
      const r = await window.mazz.invoke('dialog:openFile', { filters: [{ name: '视频/音频', extensions: [...MEDIA_VIDEO, ...MEDIA_AUDIO] }], multi: true }).catch(() => null);
      if (!r) return;
      for (const p of (Array.isArray(r) ? r : [r])) {
        const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p }).catch(() => null);
        if (!b64) continue;
        await window.mazz.invoke('fs:writeFileBase64', { path: dir + '/' + p.replace(/\\/g, '/').split('/').pop(), base64: b64 }).catch(() => {});
      }
      renderMedialib();
    });
    mlEl.querySelector('[data-ml=open]').addEventListener('click', () => {
      window.mazz.invoke('shell:showItemInFolder', { path: dir }).catch(() => {});
    });
    mlEl.querySelectorAll('.mz-ml-item').forEach(el => el.addEventListener('click', () => onNav?.(el.dataset.p)));
    // 文件夹折叠/展开（记忆在 ctl._mlOpen；kids 即相邻下一节点）
    mlEl.querySelectorAll('.mz-ml-dir').forEach(el => el.addEventListener('click', () => {
      const d = el.dataset.d;
      const kids = el.nextElementSibling;
      const open = el.dataset.open === '1';
      el.dataset.open = open ? '0' : '1';
      el.querySelector('.mz-ml-caret').textContent = open ? '▸' : '▾';
      if (kids?.classList.contains('mz-ml-kids')) kids.style.display = open ? 'none' : '';
      const set = (ctl._mlOpen ??= new Set());
      if (open) set.delete(d); else set.add(d);
    }));
  }
  // 工作区切换 → 媒体库模式重扫（工作区切换则切换实装）
  window.mazz?.on?.('workspace:changed', () => { if (ctl.srcMode === 'medialib') renderMedialib(); });

  const escapeSiteText = (value) => String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // —— 网络资源：四站多选聚合 + 有界自动翻页 + Mikan 周历/季度目录 ——
  let webInited = false;
  let webAggregates = [];
  let webNextPages = {};
  let webKeyword = '';
  let siteNames = {};
  async function renderWeb() {
    if (webInited) { renderSiteHealth(); return; }
    webInited = true;
    const sites = await window.mazz.invoke('sites:list').catch(() => []);
    siteNames = Object.fromEntries(sites.map(site => [site.id, site.name]));
    webEl.innerHTML = `
      <div class="mz-web-sites" aria-label="检索站点">
        ${sites.map(site => `<label><input type="checkbox" value="${site.id}" checked> ${escapeSiteText(site.name)}</label>`).join('')}
      </div>
      <div class="mz-web-bar mz-web-searchbar">
        <input class="mz-web-kw rb-input" placeholder="搜索番名/关键词，回车搜…" spellcheck="false">
        <button class="rb-btn mz-web-go" style="flex-direction:row">聚合检索</button>
      </div>
      <div class="mz-web-bar">
        <input class="mz-web-magnet rb-input" placeholder="直接粘贴 magnet:? 链接，回车加入下载" spellcheck="false">
        <button class="rb-btn mz-web-add" style="flex-direction:row">加入下载</button>
      </div>
      <div class="mz-site-health"></div>
      <div class="mz-web-catalog-bar"><select class="mz-mikan-season rb-select" title="Mikan 季度目录"></select><span>选择番组可直接带入检索词</span></div>
      <div class="mz-web-rows mz-dim">载入 Mikan 本周番组目录…</div>`;

    const selectedSites = () => [...webEl.querySelectorAll('.mz-web-sites input:checked')].map(input => input.value);
    const mergeAggregates = (incoming, reset = false) => {
      const merged = new Map((reset ? [] : webAggregates).map(group => [group.infoHash, group]));
      for (const group of incoming || []) {
        const previous = merged.get(group.infoHash);
        if (!previous) { merged.set(group.infoHash, group); continue; }
        const sources = [...previous.sources, ...group.sources];
        previous.sources = sources.filter((source, index) => sources.findIndex(candidate => candidate.sourceSite === source.sourceSite && candidate.sourceUrl === source.sourceUrl) === index);
      }
      webAggregates = [...merged.values()];
    };
    const renderAggregates = () => {
      const rowsEl = webEl.querySelector('.mz-web-rows');
      rowsEl.className = 'mz-web-rows';
      root.querySelector('.mz-side-count').textContent = `（${webAggregates.length}）`;
      if (!webAggregates.length) { rowsEl.className = 'mz-web-rows mz-dim'; rowsEl.textContent = '没有匹配资源；可调整关键词或站点范围。'; return; }
      rowsEl.innerHTML = webAggregates.map((group, index) => {
        const row = group.primary;
        const sources = group.sources.map(source => siteNames[source.sourceSite] || source.sourceSite).join(' · ');
        return `<div class="mz-web-row" data-i="${index}">
          <span class="mz-wr-date">${escapeSiteText(row.date)}</span>
          <span class="mz-wr-type" title="${escapeSiteText(sources)}">${group.sources.length} 源</span>
          <span class="mz-wr-title" title="${escapeSiteText(row.title)}">${escapeSiteText(row.title)}</span>
          <span class="mz-wr-size">${escapeSiteText(row.size)}</span>
          <button class="mz-wr-add" type="button">加入</button>
          <span class="mz-wr-up" title="${escapeSiteText(sources)}">${escapeSiteText(row.subgroup || sources)}</span>
        </div>`;
      }).join('') + (Object.keys(webNextPages).length ? '<button class="rb-btn mz-web-more" type="button">继续加载后续页</button>' : '');
      rowsEl.querySelectorAll('.mz-wr-add').forEach(button => button.addEventListener('click', (event) => {
        event.stopPropagation();
        const item = button.closest('.mz-web-row');
        enqueueResource(webAggregates[+item.dataset.i], item);
      }));
      rowsEl.querySelector('.mz-web-more')?.addEventListener('click', () => searchMany(false));
    };

    const renderCatalog = (catalog) => {
      const rowsEl = webEl.querySelector('.mz-web-rows');
      rowsEl.className = 'mz-web-rows mz-catalog-rows';
      root.querySelector('.mz-side-count').textContent = `（${catalog.items?.length || 0}）`;
      rowsEl.innerHTML = (catalog.items || []).map((item, index) => `<button class="mz-catalog-item" data-i="${index}" type="button">
        <span class="mz-catalog-cover" aria-hidden="true">${escapeSiteText(item.title.slice(0, 1))}</span>
        <span><b>${escapeSiteText(item.title)}</b><small>${escapeSiteText(item.dayLabel)} · ${escapeSiteText(item.updatedAt)}</small></span>
      </button>`).join('') || '<div class="mz-dim">本季度目录为空。</div>';
      rowsEl.querySelectorAll('.mz-catalog-item').forEach(item => item.addEventListener('click', () => {
        const selected = catalog.items[+item.dataset.i];
        webEl.querySelector('.mz-web-kw').value = selected.title;
        searchMany(true);
      }));
    };

    const loadCatalog = async (year = '', season = '') => {
      const rowsEl = webEl.querySelector('.mz-web-rows');
      rowsEl.className = 'mz-web-rows mz-dim';
      rowsEl.textContent = '载入 Mikan 周历与季度目录…';
      try {
        const catalog = await window.mazz.invoke('sites:catalog', { site: 'mikan', year, season });
        const select = webEl.querySelector('.mz-mikan-season');
        if (!select.options.length && catalog.seasons?.length) {
          select.innerHTML = catalog.seasons.map(entry => `<option value="${escapeSiteText(entry.year)}\t${escapeSiteText(entry.season)}">${escapeSiteText(entry.label)}</option>`).join('');
          select.addEventListener('change', () => {
            const [nextYear, nextSeason] = select.value.split('\t');
            loadCatalog(nextYear, nextSeason);
          });
        }
        renderCatalog(catalog);
      } catch (error) {
        rowsEl.className = 'mz-web-rows mz-dim';
        rowsEl.textContent = '番组目录载入失败：' + (error.message || error);
      }
    };

    const searchMany = async (reset) => {
      const kw = webEl.querySelector('.mz-web-kw').value.trim();
      if (!kw) return;
      const selected = selectedSites();
      const rowsEl = webEl.querySelector('.mz-web-rows');
      rowsEl.className = 'mz-web-rows mz-dim';
      rowsEl.textContent = reset ? '四站聚合检索中…' : '继续加载后续页…';
      try {
        if (!selected.length) throw new Error('至少选择一个站点');
        if (reset || kw !== webKeyword) { webAggregates = []; webNextPages = {}; }
        const result = await window.mazz.invoke('sites:searchMany', {
          sites: selected, kw, pageMap: reset ? {} : webNextPages, maxPages: 2,
        });
        webKeyword = kw;
        webNextPages = result.nextPages || {};
        mergeAggregates(result.aggregates, reset);
        renderAggregates();
        renderSiteHealth(result.perSite);
      } catch (error) {
        rowsEl.className = 'mz-web-rows mz-dim';
        rowsEl.textContent = '搜索失败：' + (error.message || error);
      }
    };

    const addManual = () => {
      const input = webEl.querySelector('.mz-web-magnet');
      const magnet = input.value.trim();
      if (magnet.startsWith('magnet:')) { enqueueMagnet(magnet, magnet.slice(0, 48)); input.value = ''; }
    };
    webEl.querySelector('.mz-web-go').addEventListener('click', () => searchMany(true));
    webEl.querySelector('.mz-web-kw').addEventListener('keydown', (event) => { if (event.key === 'Enter') searchMany(true); event.stopPropagation(); });
    webEl.querySelector('.mz-web-add').addEventListener('click', addManual);
    webEl.querySelector('.mz-web-magnet').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addManual();
      event.stopPropagation();
    });
    webEl.querySelectorAll('.mz-web-sites input').forEach(input => input.addEventListener('change', renderSiteHealth));
    renderSiteHealth();
    loadCatalog();
  }

  async function renderSiteHealth(perSite = null) {
    const box = webEl.querySelector('.mz-site-health');
    if (!box) return;
    const snapshots = await window.mazz.invoke('sites:health', {}).catch(() => []);
    const bySite = Object.fromEntries((Array.isArray(snapshots) ? snapshots : []).map(item => [item.siteId, item]));
    box.innerHTML = Object.keys(siteNames).map(siteId => {
      const result = perSite?.[siteId];
      const health = bySite[siteId] || {};
      const status = result?.error ? 'failed' : health.status || 'unknown';
      const mode = result?.sourceMode || health.sourceMode || '待检';
      return `<button type="button" data-site="${siteId}" data-status="${status}" title="${escapeSiteText(result?.error || health.lastError || '点击清除缓存并重置站点会话状态')}"><i></i>${escapeSiteText(siteNames[siteId])}<small>${escapeSiteText(mode)}</small></button>`;
    }).join('');
    box.querySelectorAll('button').forEach(button => button.addEventListener('click', async () => {
      await window.mazz.invoke('sites:reset', { site: button.dataset.site }).catch(() => null);
      renderSiteHealth();
    }));
  }

  async function enqueueResource(group, element) {
    if (element?.dataset.busy) return;
    if (element) element.dataset.busy = '1';
    const row = group.primary;
    try {
      const source = group.sources.find(item => item.magnet) || group.sources[0] || row;
      const magnet = source.magnet || (await window.mazz.invoke('sites:magnet', {
        site: source.sourceSite || row.sourceSite,
        sourceUrl: source.sourceUrl || row.sourceUrl,
        torrentUrl: source.torrentUrl || row.torrentUrl,
        infoHash: group.infoHash,
      })).magnet;
      await enqueueMagnet(magnet, row.title);
    } catch (error) {
      const { toast } = await import('../../shell/shell.js');
      toast('加入下载失败：' + (error.message || error));
      if (element) delete element.dataset.busy;
    }
  }

  async function enqueueMagnet(magnet, title) {
    const { toast } = await import('../../shell/shell.js');
    try {
      const job = await window.mazz.invoke('tor:addBuffer', { magnet, name: title });
      toast(`已加入下载：${job.title || title}`);
      startWatchPoll();
      setSrcMode('downloads');
      await renderDownloads();
      return job;
    } catch (error) {
      toast('加入下载失败：' + (error.message || error));
      throw error;
    }
  }

  const downloadJobs = new Map();
  const completedNotified = new Set();
  const DOWNLOAD_STATE_LABELS = Object.freeze({ queued: '排队中', downloading: '下载中', completed: '已完成', failed: '失败', paused: '已暂停' });
  async function renderDownloads(providedJobs = null) {
    const jobs = providedJobs || await window.mazz.invoke('tor:queue').catch(() => []);
    downloadJobs.clear();
    for (const job of jobs) downloadJobs.set(job.infoHash, job);
    root.querySelector('.mz-side-count').textContent = `（${jobs.length}）`;
    downloadsEl.innerHTML = jobs.length ? jobs.map(job => {
      const progress = Math.round((job.progress || 0) * 100);
      const actions = job.state === 'failed'
        ? '<button data-da="retry">重试</button><button data-da="remove">移除</button>'
        : job.state === 'paused'
          ? '<button data-da="resume">继续</button><button data-da="discard">删除</button>'
          : job.state === 'completed'
            ? '<button data-da="play">播放</button><button data-da="keep">存入媒体库</button><button data-da="discard">删除</button>'
            : job.state === 'downloading'
              ? '<button data-da="play">边下边播</button><button data-da="pause">暂停</button><button data-da="discard">取消</button>'
              : '<button data-da="pause">暂停</button><button data-da="discard">取消</button>';
      return `<article class="mz-download" data-ih="${job.infoHash}" data-state="${job.state}">
        <header><b title="${escapeSiteText(job.title)}">${escapeSiteText(job.title)}</b><span>${DOWNLOAD_STATE_LABELS[job.state] || job.state}</span></header>
        <div class="mz-watch-bar"><div class="mz-watch-fill" style="width:${progress}%"></div></div>
        <div class="mz-watch-meta">${progress}% · ${((job.downSpeed || 0) / 1024).toFixed(0)} KB/s · ${job.numPeers || 0} peers${job.error ? ` · ${escapeSiteText(job.error)}` : ''}</div>
        <div class="mz-watch-acts">${actions}</div>
      </article>`;
    }).join('') : '<div class="mz-dim">下载队列为空。网络资源加入后，即使关闭播放器标签也会由主进程继续下载。</div>';
    downloadsEl.querySelectorAll('.mz-download').forEach(card => {
      const infoHash = card.dataset.ih;
      card.querySelectorAll('[data-da]').forEach(button => button.addEventListener('click', async () => {
        const action = button.dataset.da;
        if (action === 'play') await playTorrentJob(downloadJobs.get(infoHash));
        if (action === 'pause') await window.mazz.invoke('tor:pause', { infoHash });
        if (action === 'resume') await window.mazz.invoke('tor:resume', { infoHash });
        if (action === 'retry') await window.mazz.invoke('tor:retry', { infoHash });
        if (action === 'keep') await keepTorrentJob(downloadJobs.get(infoHash));
        if (action === 'discard' || action === 'remove') await window.mazz.invoke('tor:remove', { infoHash, deleteFiles: action === 'discard' });
        await renderDownloads();
      }));
    });
  }

  async function playTorrentJob(job) {
    if (!job?.files?.length) {
      const { toast } = await import('../../shell/shell.js');
      toast('种子元数据尚未就绪，请稍后再播放');
      return;
    }
    const file = job.files.find(item => MEDIA_VIDEO.has(String(item.path || '').split('.').pop().toLowerCase())) || job.files[0];
    const rawUrl = await window.mazz.invoke('tor:streamUrl', { infoHash: job.infoHash, filePath: file.path });
    if (!rawUrl) return;
    const streamUrl = 'mazz-res://tor/' + encodeURI(rawUrl).replace('http://', '');
    setSource(streamUrl, job.title, streamUrl, file.length);
    const subFile = job.files.find(item => /\.(ass|srt|ssa)$/i.test(item.path || ''));
    if (subFile) {
      try {
        const bytes = await window.mazz.invoke('tor:fileBytes', { infoHash: job.infoHash, filePath: subFile.path });
        const u8 = bytes instanceof Uint8Array ? bytes : (bytes?.data ? new Uint8Array(bytes.data) : null);
        if (u8?.length) {
          await attachSubtitle(media, { subContent: new TextDecoder().decode(u8) }); subVisible = true; syncSubBtn();
          const { toast } = await import('../../shell/shell.js');
          toast('已挂载种子内字幕：' + (subFile.name || subFile.path.split('/').pop()));
        }
      } catch {}
    }
  }

  async function keepTorrentJob(job) {
    if (!job?.files?.length) return;
    const file = job.files.find(item => MEDIA_VIDEO.has(String(item.path || '').split('.').pop().toLowerCase())) || job.files[0];
    const src = await window.mazz.invoke('tor:filePath', { infoHash: job.infoHash, filePath: file.path });
    if (!src) return;
    const workspace = await window.mazz.invoke('workspace:get');
    const dest = workspace + '/媒体库/' + src.replace(/\\/g, '/').split('/').pop();
    await window.mazz.invoke('fs:rename', { from: src, to: dest });
    await window.mazz.invoke('tor:remove', { infoHash: job.infoHash, deleteFiles: false });
    const { toast } = await import('../../shell/shell.js');
    toast(`已存到：${dest}`, [{ label: '打开所在文件夹', fn: () => window.mazz.invoke('shell:showItemInFolder', { path: dest }).catch(() => {}) }], 12000);
    if (ctl.srcMode === 'medialib') renderMedialib();
  }

  async function applyCompletionPolicy(job) {
    if (!job || completedNotified.has(job.infoHash)) return;
    completedNotified.add(job.infoHash);
    const mode = (await window.mazz.invoke('settings:get', { key: 'player.torrentKeepMode' }).catch(() => 'ask')) || 'ask';
    if (mode === 'keep') return keepTorrentJob(job);
    if (mode === 'discard') return window.mazz.invoke('tor:remove', { infoHash: job.infoHash, deleteFiles: true });
    const { toast } = await import('../../shell/shell.js');
    toast(`「${job.title || '种子'}」下载完成`, [
      { label: '存到媒体库', fn: () => keepTorrentJob(job) },
      { label: '保留在下载区', fn: () => {}, ghost: true },
    ], 15000);
  }

  let watchPollT = null;
  function startWatchPoll() {
    if (watchPollT) return;
    watchPollT = setInterval(async () => {
      const jobs = await window.mazz.invoke('tor:queue').catch(() => []);
      for (const job of jobs) if (job.state === 'completed') applyCompletionPolicy(job);
      if (ctl.srcMode === 'downloads') renderDownloads(jobs);
    }, 2500);
  }

  // ==================== 多音轨（MKV 自解复用：EBML-lite 枚举轨表 + 全编码抽轨封装双元素同步） ====================
  // 原 A_FLAC 单轨直通泛化：Vorbis/AAC/Opus 全编码（Ogg/ADTS 自封装，主进程 mkv:extractTrack）
  const SUPPORTED_TRACK_CODECS = /^A_(FLAC|VORBIS|AAC|OPUS)/i;
  let audioTracks = [], auxEl = null, curTrackIdx = 0;
  async function probeAudioTracks() {
    if (!isVideo || !curPath || !/\.mkv$/i.test(curPath)) { audioTracks = []; renderTrackMenu(); return; }
    const r = await window.mazz.invoke('mkv:tracks', { path: curPath }).catch(() => null);
    audioTracks = (r?.tracks || []).filter(t => t.type === 2);
    renderTrackMenu();
  }
  function renderTrackMenu() {
    const wrap = root.querySelector('.mz-track-wrap');
    if (!wrap) return;
    if (audioTracks.length <= 1) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    wrap.innerHTML = `<select class="mz-track rb-select" title="音轨（多轨片源切轨换音道；FLAC/Vorbis/AAC/Opus 自封装直通，其他编码探测仅展示）">
      ${audioTracks.map((t, i) => `<option value="${i}" ${i === curTrackIdx ? 'selected' : ''}>${i === 0 ? '主轨' : '轨' + (i + 1)} · ${t.language || 'und'}${SUPPORTED_TRACK_CODECS.test(t.codecId || '') ? '' : '（暂不支持）'}</option>`).join('')}
    </select>`;
    wrap.querySelector('.mz-track').addEventListener('change', (e) => switchTrack(+e.target.value));
  }
  async function switchTrack(idx) {
    const t = audioTracks[idx];
    if (!t || idx === curTrackIdx) return;
    const { toast } = await import('../../shell/shell.js');
    if (!SUPPORTED_TRACK_CODECS.test(t.codecId || '')) { toast('该编码音轨暂不支持切换——支持 FLAC/Vorbis/AAC/Opus'); renderTrackMenu(); return; }
    try {
      toast('抽取音轨中…');
      const r = await window.mazz.invoke('mkv:extractTrack', { path: curPath, trackNumber: t.trackNumber });
      await attachAuxAudio('mazz-res://media/' + encodeURIComponent(r.path.replace(/\\/g, '/')), idx);
      curTrackIdx = idx;
      toast(`已切到音轨 ${idx + 1}（${t.language || 'und'} · ${r.ext || ''}）`);
    } catch (e) { toast('音轨抽取失败：' + (e.message || e)); renderTrackMenu(); }
  }
  async function attachAuxAudio(url, idx) {
    detachAuxAudio(false);
    if (idx === 0) { media.muted = false; return; }
    media.muted = true; // 画面整轨静音（Chromium 无法单独禁容器内某轨，声音全由 aux 轨接管）
    auxEl = new Audio(url);
    auxEl.playbackRate = media.playbackRate;
    auxEl.volume = media.volume;
    auxEl.muted = media.muted;
    if (ctl._chain && (ctl._chain.gain.gain.value > 1)) {
      try {
        const aSrc = ctl._chain.ctx.createMediaElementSource(auxEl);
        aSrc.connect(ctl._chain.gain); // 增益共享一链（与主媒体同源增益节点）
      } catch {}
    }
    const sync = {
      play: () => { auxEl.currentTime = media.currentTime; auxEl.play().catch(() => {}); },
      pause: () => auxEl.pause(),
      seeked: () => { auxEl.currentTime = media.currentTime; },
      timeupdate: () => { if (Math.abs(auxEl.currentTime - media.currentTime) > 0.35) auxEl.currentTime = media.currentTime; },
      ratechange: () => { auxEl.playbackRate = media.playbackRate; },
      volumechange: () => { auxEl.volume = media.volume; auxEl.muted = media.muted; },
    };
    for (const [ev, fn] of Object.entries(sync)) media.addEventListener(ev, fn);
    auxEl._sync = sync;
    if (!media.paused) sync.play();
  }
  function detachAuxAudio(resetMute = true) {
    if (auxEl?._sync) for (const [ev, fn] of Object.entries(auxEl._sync)) media.removeEventListener(ev, fn);
    try { auxEl?.pause(); auxEl?.removeAttribute('src'); } catch {}
    auxEl = null;
    if (resetMute) { media.muted = false; curTrackIdx = 0; }
  }
  probeAudioTracks();

  // ==================== 音频增益（WebAudio 共享链：主媒体与 aux 轨同一增益节点，300% 上限） ====================
  function mediaChain() {
    if (!ctl._chain) {
      const ctx = ctl._actx || (ctl._actx = new AudioContext());
      const src = ctx.createMediaElementSource(media);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain);
      gain.connect(ctx.destination);
      ctl._chain = { ctx, src, gain };
      ctx.resume?.().catch(() => {});
    }
    return ctl._chain;
  }
  function setGain(x) {
    if (x > 1.0001) mediaChain().gain.gain.value = x;
    else if (ctl._chain) ctl._chain.gain.gain.value = 1;
    window.mazz?.invoke('settings:set', { key: 'player.audioGain', value: x }).catch(() => {});
  }
  window.mazz?.invoke('settings:get', { key: 'player.audioGain' }).then(v => { if (!destroyed && v > 1) setGain(v); }).catch(() => {});

  // ==================== 倍速/亮度记忆（上次值恢复 + 变更即存） ====================
  window.mazz?.invoke('settings:get', { key: 'player.lastSpeed' }).then(v => {
    if (v && v !== 1) {
      const sel = root.querySelector('.mz-speed');
      if (sel) { sel.value = String(v); media.playbackRate = v; sel.dispatchEvent(new Event('change', { bubbles: true })); } // B12b：补 change 广播——子窗格按钮文案同步（直赋值事件静默=文案脱节）
    }
  }).catch(() => {});
  window.mazz?.invoke('settings:get', { key: 'player.lastBrightness' }).then(v => {
    if (v && v !== 1) {
      const b = root.querySelector('.mz-bright');
      if (b) { b.value = v; media.style.filter = `brightness(${v})`; }
    }
  }).catch(() => {});

  // ---------- 播放/进度 ----------
  const togglePlay = () => {
    if (!media.paused) { media.pause(); return; }
    // 增益设置会在加载期提前创建 WebAudio 图；Chromium 在没有用户手势时会让 resume 保持 suspended。
    // 播放按钮本身就是合法手势，必须在此再次恢复上下文，否则媒体已接入 WebAudio 后可能时间走而无声。
    const context = ctl._chain?.ctx || ctl._actx;
    context?.resume?.().catch?.(() => {});
    media.play().catch(() => {});
  };
  playBtn.addEventListener('click', togglePlay);
  root.querySelector('[data-a=prev]').addEventListener('click', prev);
  root.querySelector('[data-a=next]').addEventListener('click', next);
  media.addEventListener('play', () => { playBtn.innerHTML = iconHtml('⏸'); root.querySelector('.mz-audio-disc')?.classList.add('spin'); });
  media.addEventListener('playing', armDecodeWatch);
  media.addEventListener('seeking', clearDecodeWatch);
  media.addEventListener('pause', () => { clearDecodeWatch(); playBtn.innerHTML = iconHtml('▶'); root.querySelector('.mz-audio-disc')?.classList.remove('spin'); });
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
  // 循环兜底（非连播路径的原逻辑）
  const fallbackLoop = () => {
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
  };
  media.addEventListener('ended', () => {
    // 自动连播优先（番剧场景：同目录嗅探到下一集；single/off 尊重用户显式选择不拦）
    if (autoNext && isVideo && curPath && ctl.loop !== 'single' && ctl.loop !== 'off') {
      (async () => {
        const dir = curPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
        const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
        const exts = new Set([...MEDIA_VIDEO, ...MEDIA_AUDIO]);
        const np = nextEpisodePath(curPath, entries, exts);
        if (!np) { fallbackLoop(); return; }
        const { toast } = await import('../../shell/shell.js');
        let cancel = false;
        toast(`3s 后自动连播：${np.split('/').pop()}`, [{ label: '取消连播', fn: () => { cancel = true; } }], 3000);
        clearTimeout(autoNextTimer);
        autoNextTimer = setTimeout(() => { if (!destroyed && !cancel) onNav?.(np); }, 3000);
      })();
      return;
    }
    fallbackLoop();
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
    if (isVideo && previewVideo && previewVideo._src !== url) {
      // 切源即失效（本地换网络资源后小窗画还是上一个视频的实锤根因：previewVideo 一建不换 src）
      try { previewVideo.removeAttribute('src'); previewVideo.load(); } catch {}
      previewVideo = null;
    }
    if (!previewVideo && isVideo) {
      previewVideo = document.createElement('video');
      previewVideo.muted = true;
      previewVideo.preload = 'auto';
      previewVideo.src = url;
      previewVideo._src = url;
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
      try { if (rec.state !== 'inactive') rec.stop(); } catch {}
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
  // 亮度调节（filter:brightness + 亮度记忆）
  const bright = root.querySelector('.mz-bright');
  if (bright) bright.addEventListener('input', () => {
    media.style.filter = `brightness(${bright.value})`;
    window.mazz?.invoke('settings:set', { key: 'player.lastBrightness', value: +bright.value }).catch(() => {});
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
  root.querySelector('.mz-speed').addEventListener('change', (e) => {
    media.playbackRate = +e.target.value;
    window.mazz?.invoke('settings:set', { key: 'player.lastSpeed', value: +e.target.value }).catch(() => {}); // 倍速记忆
  });
  // B12b 收编：倍速子窗格化（select 隐藏保留作状态单源，change 联动照旧）
  import('../../lib/select-menu.js').then(({ selectProxy }) => selectProxy(root.querySelector('.mz-speed'), { btnClass: 'mz-btn selmenu-btn' }));
  root.querySelector('[data-a=pip]')?.addEventListener('click', async () => {
    if (!isVideo) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await media.requestPictureInPicture();
    } catch (e) { import('../../shell/shell.js').then(({ toast }) => toast('画中画不可用：' + (e.message || e))); }
  });
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

  // ---------- 播放列表面板（工作区栏同款：展开推挤视频区/收起铺满/左缘 grip 拖拽调宽/折叠符号/状态记忆） ----------
  const SIDE_MIN = 200, SIDE_MAX = 520;
  // 限位（真机点名）：侧栏宽度同时受窗宽钳制——视频区+底栏（含全屏钮）至少 560px，绝不被挤掉；
  // W58h：拖拽上界与 CSS 30% 渲染封顶同函数——拖的是未封顶值、渲染按封顶值=极限脱同步（面板停走、媒体区/底栏给幽灵让位实锤）
  const sideMaxNow = () => Math.max(SIDE_MIN, Math.min(SIDE_MAX, stage.clientWidth - 560, Math.floor(stage.clientWidth * 0.3)));
  ctl.sideW = 260; ctl.sideOpen = false;
  const applySide = () => {
    ctl.sideW = Math.min(ctl.sideW, sideMaxNow());
    stage.style.setProperty('--mz-side-w', ctl.sideW + 'px');
    stage.classList.toggle('side-open', ctl.sideOpen);
  };
  // 窗宽变化即重钳（缩窗时全屏钮区永不被侧栏顶掉）
  window.addEventListener('resize', applySide);
  const persistSide = () => {
    window.mazz?.invoke('settings:set', { key: 'player.listSide', value: { width: ctl.sideW, open: ctl.sideOpen } }).catch(() => {});
  };
  const setSideOpen = (open) => { ctl.sideOpen = !!open; applySide(); persistSide(); };
  window.mazz?.invoke('settings:get', { key: 'player.listSide' }).then(v => {
    if (v && typeof v === 'object') {
      if (v.width >= SIDE_MIN && v.width <= SIDE_MAX) ctl.sideW = Math.min(v.width, sideMaxNow());
      if (typeof v.open === 'boolean') ctl.sideOpen = v.open;
    }
    applySide();
  }).catch(() => {});
  root.querySelector('[data-a=list]').addEventListener('click', () => setSideOpen(!ctl.sideOpen));
  // 侧栏折叠钮（›：收起即铺满——与工作区栏 «/» 展开折叠同款语义，SVG 一致化）
  root.querySelector('[data-a=side-close]').addEventListener('click', () => setSideOpen(false));
  // 左缘 grip 拖拽调宽（往左拖=变宽；工作区栏 SidebarCtl 同款手势）
  const sideGrip = root.querySelector('.mz-side-grip');
  sideGrip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragCleanup?.();
    sideGrip.classList.add('on');
    const startX = e.clientX, startW = ctl.sideW;
    const move = (ev) => {
      ctl.sideW = Math.min(Math.max(startW + (startX - ev.clientX), SIDE_MIN), sideMaxNow());
      stage.style.setProperty('--mz-side-w', ctl.sideW + 'px');
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      sideGrip.classList.remove('on');
      if (dragCleanup === cleanup) dragCleanup = null;
    };
    const up = () => {
      cleanup();
      persistSide();
    };
    dragCleanup = cleanup;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  // ---------- 无边框 / 全屏 ----------
  const chromeEls = [controls, topbar];
  let hideTimer = null;
  function scheduleHide() {
    clearTimeout(hideTimer);
    if (media.paused) return;
    // W58f：自动隐藏只留全屏/无边框——窗口态底栏常驻（窗口态消失=「离谱情况」真机实锤）
    if (!document.fullscreenElement && !ctl.borderless) return;
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
  const onFullscreenChange = () => {
    root.classList.toggle('fs', !!document.fullscreenElement);
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  stage.addEventListener('dblclick', (e) => {
    if (e.target.closest('.mz-controls, .mz-topbar, .mz-side')) return;
    togglePlay();
  });

  // ---------- 音频频谱（共享媒体源链——不得重复 createMediaElementSource 撞车（InvalidStateError 实锤） ----------
  if (!isVideo) {
    try {
      const { src } = mediaChain(); // 用共享链的源（增益节点已在链上，频谱只搭顺风车）
      const analyser = ctl._chain.ctx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
      const canvas = root.querySelector('.mz-spectrum');
      const c2d = canvas.getContext('2d');
      const data = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        waveRaf = null;
        if (destroyed) return;
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
        if (root.isConnected) waveRaf = requestAnimationFrame(draw);
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
    if (destroyed) return;
    clearDecodeWatch();
    removeDecodeFailure();
    decodedFrameSignals = 0;
    saveProgMem(); // 旧片先存进度（用旧 curPath）
    // 同片 setSource（activate 重载/刷新）不得卸载字幕——detach+重挂的竞态杀 in-flight 是总根（三连实锤）
    const pathChanged = newPath !== curPath;
    curUrl = newUrl; curName = newName; curPath = newPath;
    curSize = newSize;
    root.querySelector('.mz-empty')?.remove(); // 空起手占位退场（首次上源）
    media.pause();
    if (pathChanged) { detachSubtitle(); subFor = null; detachAuxAudio(); audioTracks = []; probeAudioTracks(); }
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
    if (isVideo) loadAutoSubtitle(); // 新片字幕自动探测（subEnabled 态已缓存）
  }

  return {
    setSource,
    captureProgress,
    applyProgress,
    /** 外挂字幕直挂（设置面板/E2E 通道——bundle 内模块裸 import 进不来，此口是唯一真源） */
    loadSub: async (p) => { await attachSubtitle(media, { subPath: p }); subVisible = true; syncSubBtn(); return true; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      subLoadSeq++; // 令所有在途字幕探测/挂载失效。
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('resize', applySide);
      dragCleanup?.();
      clearTimeout(hideTimer);
      clearTimeout(hoverTimer);
      clearTimeout(ctl._thumbHideT);
      clearTimeout(autoNextTimer);
      clearDecodeWatch();
      clearInterval(watchPollT); // 种子状态轮询必清（泄漏会后台持续打 tor:stats）
      clearInterval(progMemTimer); // 进度记忆定时器必清（泄漏会持续写 settings）
      if (waveRaf != null) { cancelAnimationFrame(waveRaf); waveRaf = null; }
      saveProgMem(); // 销毁前终存一次（关签/切歌时位置不丢）
      if (gifRec) {
        const { stream, rec, drawTimer } = gifRec;
        gifRec = null;
        clearInterval(drawTimer);
        try { rec.onstop = null; if (rec.state !== 'inactive') rec.stop(); } catch {}
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
      }
      if (previewVideo) {
        previewVideo.pause(); previewVideo.removeAttribute('src');
        try { previewVideo.load(); } catch {}
        previewVideo = null;
      }
      try {
        // close() 在已关闭上下文上返回 rejected promise（同步 try 接不住）——二次销毁时 pageerror 的真凶
        const contexts = new Set([ctl._actx, ctl._chain?.ctx].filter(Boolean));
        for (const ctx of contexts) ctx.close?.()?.catch?.(() => {});
        ctl._actx = null;
        ctl._chain = null;
      } catch {}
      detachSubtitle(); // 字幕渲染器与 canvas 必清（worker 不退役=内存挂账）
      detachAuxAudio(); // aux 音轨元素与同步监听必清（切走不卸=后台双音轨同播实锤）
      if (ctl.borderless) document.body.classList.remove('player-borderless');
      try {
        media.pause();
        media.srcObject = null;
        media.removeAttribute('src');
        media.load(); // 主动释放 Chromium 解码器与文件句柄，不等 DOM GC。
      } catch {}
    },
  };
}
