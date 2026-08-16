// renderer/modules/viewer/index.js —— 通用查看器：图片 / PDF / 视频 / 音频（只读）
// Chromium 内核原生能放的走 HTML5 播放器；啃不动的格式优雅降级「外部打开」
import { contextKeys } from '../../core/contextkey-service.js';
import { toast } from '../../shell/shell.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { MATURITY, PRODUCT_CAPABILITIES } from '../../core/product-maturity.js';

const MODULE = 'viewer';
const instances = new Map();
let current = null;

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', 'ts', 'mts', 'm2ts', 'mpg', 'mpeg', '3gp']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'oga', 'm4a', 'aac', 'flac', 'opus', 'ogg']);
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon', pdf: 'application/pdf',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', ogg: 'video/ogg',
  mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv', ts: 'video/mp2t', mpg: 'video/mpeg', mpeg: 'video/mpeg', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', wav: 'audio/wav', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
  flac: 'audio/flac', opus: 'audio/opus',
};

function createViewer(container) {
  const root = document.createElement('div');
  root.className = 'viewer-root';
  root.innerHTML = `
    <div class="viewer-bar">
      <button data-a="out" title="缩小">－</button>
      <span class="viewer-pct">100%</span>
      <button data-a="in" title="放大">＋</button>
      <button data-a="fit" title="适应窗口">适应</button>
      <button data-a="actual" title="实际大小">1:1</button>
      <span class="viewer-name"></span>
      <button data-a="external" title="用系统默认程序打开" style="display:none">外部打开</button>
    </div>
    <div class="viewer-body"></div>`;
  container.appendChild(root);

  const ctl = {
    container, root,
    body: root.querySelector('.viewer-body'),
    pctEl: root.querySelector('.viewer-pct'),
    nameEl: root.querySelector('.viewer-name'),
    barEl: root.querySelector('.viewer-bar'),
    zoom: 1, fitMode: true, path: null, kind: null, objUrl: null, natW: 0, natH: 0,
  };
  const extBtn = root.querySelector('[data-a=external]');
  extBtn.addEventListener('click', async () => {
    if (!ctl.path) return;
    const r = await window.mazz.invoke('shell:openPath', { path: ctl.path }).catch(e => e.message || e);
    if (r !== true) toast('外部打开失败：' + r);
  });

  const applyZoom = () => {
    const img = ctl.body.querySelector('img');
    if (!img) return;
    if (ctl.fitMode) {
      img.style.maxWidth = '100%'; img.style.maxHeight = '100%'; img.style.width = ''; img.style.height = '';
      ctl.pctEl.textContent = '适应';
    } else {
      img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
      img.style.width = (ctl.natW * ctl.zoom) + 'px';
      img.style.height = (ctl.natH * ctl.zoom) + 'px';
      ctl.pctEl.textContent = Math.round(ctl.zoom * 100) + '%';
    }
  };
  const setZoom = (z) => {
    ctl.zoom = Math.min(8, Math.max(0.05, z));
    ctl.fitMode = false;
    applyZoom();
  };
  root.querySelector('[data-a=in]').addEventListener('click', () => setZoom(ctl.zoom * 1.25));
  root.querySelector('[data-a=out]').addEventListener('click', () => setZoom(ctl.zoom / 1.25));
  root.querySelector('[data-a=actual]').addEventListener('click', () => setZoom(1));
  root.querySelector('[data-a=fit]').addEventListener('click', () => { ctl.fitMode = true; applyZoom(); });
  ctl.body.addEventListener('wheel', (e) => {
    if (ctl.kind !== 'image') return;
    e.preventDefault(); // 滚轮=缩放不滚屏（查看态滚动条不绑滚轮，拖条专用）；横向手势一并压死（左右滚动不绑滚轮）
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // 59d：触控板横滑只压默认，不缩放
    setZoom(ctl.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  /** W59：进入图片编辑模式（浏览→编辑双态切换——编辑态藏图与缩放族，退出还原） */
async function enterImageEdit(ctl, img, path, ext) {
  if (ctl._imgEditor) return;
  const { ImageEditor } = await import('./imgedit.js');
  // 编辑态：隐藏浏览图与缩放族（退出时还原——浏览/编辑双态不互毁）
  img.style.display = 'none';
  const zoomKids = [...ctl.barEl.children].filter(el => el.dataset.a !== 'imgedit' && el.dataset.a !== 'external');
  zoomKids.forEach(el => { el._ieHide = el.style.display; el.style.display = 'none'; });
  ctl._imgEditor = new ImageEditor(ctl.body, { path, imgSrc: img.src, natW: ctl.natW || img.naturalWidth, natH: ctl.natH || img.naturalHeight, ext });
  ctl._imgEditor.onDestroy = () => {
    img.style.display = '';
    zoomKids.forEach(el => { el.style.display = el._ieHide ?? ''; });
    ctl._imgEditor = null;
  };
}

/** 媒体源：桌面走 mazz-res://media/ 协议（页面同源化：file:// 页面 media loader 零请求实锤根治，
   *  同源 video 画 canvas 不污染——截图/GIF 录制命门；range 206 由主进程流式供）；网页/移动读 base64 建 Blob URL */
  function revokeBlobUrl(url) {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      try { URL.revokeObjectURL(url); } catch {}
    }
  }

  async function mediaUrl(path, gen) {
    if (window.mazz?.isElectron) return 'mazz-res://media/' + encodeURIComponent(path.replace(/\\/g, '/'));
    const b64 = await window.mazz.invoke('fs:readFileBase64', { path });
    // 标签已关或另一趟 load 已接管时，不再把迟到的 base64 物化成 Blob。
    if (ctl._destroyed || (gen != null && gen !== ctl._loadGen)) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = (path.split('.').pop() || '').toLowerCase();
    revokeBlobUrl(ctl.objUrl);
    ctl.objUrl = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] || 'application/octet-stream' }));
    return ctl.objUrl;
  }

  /** 降级卡：格式啃不动 → 转码播放（ffmpeg）/ 外部打开 双选 */
  function showFallback(name, ext, reason) {
    const isMedia = VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext);
    const canTranscode = isMedia && PRODUCT_CAPABILITIES.ffmpegRuntime.maturity !== MATURITY.HIDDEN;
    ctl.body.innerHTML = `
      <div class="viewer-fallback">
        <div class="vf-ico">${iconHtml(isMedia ? '🎬' : '📄')}</div>
        <div class="vf-name"></div>
        <div class="vf-reason">${reason}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
          ${canTranscode ? '<button class="vf-tc rb-btn" style="flex-direction:row;padding:8px 22px;background:var(--accent);color:var(--accent-fg)">⚙ 转码播放</button>' : ''}
          <button class="vf-open rb-btn" style="flex-direction:row;padding:8px 22px">用系统默认程序打开</button>
        </div>
        <div class="vf-progress" style="display:none;width:260px"></div>
      </div>`;
    ctl.body.querySelector('.vf-name').textContent = name + '（.' + ext + '）';
    ctl.body.querySelector('.vf-open').addEventListener('click', () => extBtn.click());
    ctl.body.querySelector('.vf-tc')?.addEventListener('click', () => transcodeAndPlay(name, ext));
    extBtn.style.display = '';
    // HEVC 缺失时附微软官方组件指引（按平台分发：win32 链接/mac 原生/linux VAAPI）
    if (isMedia) {
      import('../../lib/codec-guide.js').then(({ probeCodecs, renderHevcGuide, currentPlatform }) => {
        const hevc = probeCodecs().find(r => r.name.includes('HEVC'));
        if (!hevc || hevc.ok) return;
        const guide = document.createElement('div');
        guide.className = 'vf-hevc-guide';
        guide.style.cssText = 'margin-top:12px;padding:8px 14px;border:1px solid var(--border);border-radius:8px;font-size:11.5px;line-height:1.8;color:var(--fg-dim);max-width:520px;text-align:left';
        ctl.body.querySelector('.viewer-fallback')?.appendChild(guide);
        renderHevcGuide(guide, currentPlatform());
      }).catch(() => {});
    }
  }

  /** ffmpeg 转码后播放（带进度；同会话内缓存结果） */
  async function transcodeAndPlay(name, ext) {
    const gen = ctl._loadGen;
    if (ctl._destroyed) return;
    const cacheKey = ctl.path;
    if (ctl._tcCache?.has(cacheKey)) {
      playUrl(ctl._tcCache.get(cacheKey), VIDEO_EXTS.has(ext) ? 'video' : 'audio').catch(e => toast('播放失败：' + e.message));
      return;
    }
    const prog = ctl.body.querySelector('.vf-progress');
    const btn = ctl.body.querySelector('.vf-tc');
    btn.disabled = true;
    prog.style.display = 'block';
    prog.innerHTML = `<div style="font-size:12px;color:var(--fg-dim);margin-bottom:6px" class="vf-prog-text">正在加载转码引擎（约 31MB wasm，仅首次）…</div>
      <div style="height:6px;background:var(--bg-active);border-radius:3px;overflow:hidden"><div class="vf-prog-bar" style="height:100%;width:0%;background:var(--accent);transition:width .2s"></div></div>`;
    const setProg = (text, ratio) => {
      const t = prog.querySelector('.vf-prog-text');
      if (t && text) t.textContent = text;
      const bar = prog.querySelector('.vf-prog-bar');
      if (bar && ratio != null) bar.style.width = Math.round(ratio * 100) + '%';
    };
    try {
      const { transcode, b64ToU8, u8ToB64 } = await import('../../lib/ffmpeg-transcode.js');
      setProg('读取源文件…', 0.05);
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path: ctl.path });
      setProg('转码中（CPU 满载，大文件需耐心等待）…', 0.1);
      const out = await transcode(b64ToU8(b64), ext, {
        toAudio: AUDIO_EXTS.has(ext),
        onProgress: (r2) => setProg(null, 0.1 + r2 * 0.85),
      });
      setProg('写入缓存…', 0.98);
      let url;
      let tempPath = null;
      if (window.mazz?.isElectron) {
        // 写临时文件，协议 URL 播放（不占内存；同会话缓存命中直接播）
        const ws = await window.mazz.invoke('workspace:get');
        const dir = `${ws}/.mazz/temp`;
        await window.mazz.invoke('fs:mkdir', { path: dir });
        const outExt = AUDIO_EXTS.has(ext) ? 'mp3' : 'mp4';
        tempPath = `${dir}/transcoded_${Date.now()}.${outExt}`;
        await window.mazz.invoke('fs:writeFileBase64', { path: tempPath, base64: u8ToB64(out) });
        url = 'mazz-res://media/' + encodeURIComponent(tempPath.replace(/\\/g, '/'));
      } else {
        url = URL.createObjectURL(new Blob([out], { type: AUDIO_EXTS.has(ext) ? 'audio/mpeg' : 'video/mp4' }));
      }
      if (ctl._destroyed || gen !== ctl._loadGen) {
        revokeBlobUrl(url);
        if (tempPath) window.mazz.invoke('fs:delete', { path: tempPath }).catch(() => {});
        return;
      }
      ctl._tcCache = ctl._tcCache || new Map();
      ctl._tcCache.set(cacheKey, url);
      if (tempPath) {
        ctl._tcTempPaths = ctl._tcTempPaths || new Set();
        ctl._tcTempPaths.add(tempPath);
      }
      window.MazzActivity?.publish?.({
        id: `transcode-${cacheKey}`, source: 'transcode', title: '媒体转码完成',
        detail: name, status: 'done', target: { kind: 'file', path: ctl.path },
      });
      toast('转码完成，开始播放');
      playUrl(url, VIDEO_EXTS.has(ext) ? 'video' : 'audio').catch(e => toast('播放失败：' + e.message));
    } catch (e) {
      btn.disabled = false;
      prog.innerHTML = `<div style="font-size:12px;color:var(--danger,#dc2626)">转码失败：${e.message}</div>`;
      window.MazzActivity?.publish?.({ id: `transcode-${cacheKey}`, source: 'transcode', title: '媒体转码失败', detail: `${name} · ${e.message}`, status: 'failed', target: { kind: 'file', path: ctl.path } });
    }
  }

  /** 统一播放入口（原生或转码产物）：一律走 Mazz Player 组件（快捷键/倍速/播放列表全套，不再用裸 video） */
  async function playUrl(url, kind) {
    const gen = ctl._loadGen;
    if (ctl._destroyed) return;
    const name = ctl.path.split(/[\\/]/).pop();
    const ext = (name.split('.').pop() || '').toLowerCase();
    const { createPlayer } = await import('./player.js');
    if (ctl._destroyed || gen !== ctl._loadGen) return;
    ctl.body.innerHTML = '';
    const playerRoot = document.createElement('div');
    playerRoot.className = 'viewer-player';
    ctl.body.appendChild(playerRoot);
    try { ctl._player?.destroy?.(); } catch {}
    ctl._player = createPlayer(playerRoot, {
      url, name, ext, path: ctl.path, kind,
      onNav: (p2) => ctl.load(p2),
    });
  }

  ctl.load = async (path) => {
    ctl.path = path;
    // 切歌/换片即同步宿主标签的标题与路径（此前 tab.filePath 停在旧文件：已开判定失效、切回复活播错片）
    window.MazzHost?.setTabFilePath?.(container, path);
    window.MazzHost?.setTabTitle?.(container, path.split(/[\\/]/).pop());
    // 切歌前记下全屏态：load 重建 stage 必丢 fullscreen（切歌强制退出全屏总根）
    const wasFs = !!document.fullscreenElement && container.contains(document.fullscreenElement);
    // 代次令牌（load 开头即递增）：后续 await 恢复时必须仍是当代——
    // 连点下一条/自动切歌并发交错时，过期 load 直接作废，不得清空/追加（双播放器总根，图证实锤）
    const gen = ctl._loadGen = (ctl._loadGen || 0) + 1;
    const name = path.split(/[\\/]/).pop();
    const ext = (name.split('.').pop() || '').toLowerCase();
    ctl.kind = IMAGE_EXTS.has(ext) ? 'image' : ext === 'pdf' ? 'pdf' : VIDEO_EXTS.has(ext) ? 'video' : AUDIO_EXTS.has(ext) ? 'audio' : 'other';
    ctl.nameEl.textContent = name;
    ctl.pctEl.parentElement.querySelectorAll('[data-a=in],[data-a=out],[data-a=fit],[data-a=actual],[data-a=imgedit]').forEach(b => b.style.display = ctl.kind === 'image' ? '' : 'none');
    ctl.pctEl.style.display = ctl.kind === 'image' ? '' : 'none';
    extBtn.style.display = 'none';

    try {
      // W59：换片即收编辑器（防键位泄漏+旧画布占尸——load 统一入口收尸）
      if (ctl._imgEditor) { try { ctl._imgEditor.destroy(); } catch {} ctl._imgEditor = null; }
      if (ctl.kind === 'image' || ctl.kind === 'pdf') {
        // W58d：竞态上台的裸播放器收尸（连带根绝——_player 悬挂还会误导 activate 的空片判活）
        try { ctl._player?.destroy?.(); } catch {}
        ctl._player = null; ctl._playerKind = null;
      }
      if (ctl.kind === 'image') {
        const url = await mediaUrl(path, gen);
        if (!url || ctl._destroyed || gen !== ctl._loadGen) return;
        ctl.body.innerHTML = '';
        const img = document.createElement('img');
        img.draggable = false;
        img.alt = name;
        img.onload = () => { ctl.natW = img.naturalWidth; ctl.natH = img.naturalHeight; ctl.fitMode = true; applyZoom(); };
        img.onerror = () => showFallback(name, ext, '图片解码失败');
        img.src = url;
        ctl.body.appendChild(img);
        // W59：图片编辑模式入口（浏览/编辑双态——Canvas 全本地零 Sharp）
        if (!root.querySelector('[data-a=imgedit]')) {
          const eb = document.createElement('button');
          eb.dataset.a = 'imgedit';
          eb.title = '图片编辑模式（裁剪/网格分割/变换/滤镜/绘画/取色/另存副本/撤销重做）';
          eb.textContent = '编辑';
          eb.addEventListener('click', () => {
            const cur = ctl.body.querySelector('img');
            if (!cur || ctl.kind !== 'image') return;
            const curExt = (ctl.path.split('.').pop() || 'png').toLowerCase();
            enterImageEdit(ctl, cur, ctl.path, curExt);
          });
          root.querySelector('.viewer-bar').appendChild(eb);
        }
        return;
      }
      if (ctl.kind === 'pdf') {
        const url = await mediaUrl(path, gen);
        if (!url || ctl._destroyed || gen !== ctl._loadGen) return;
        ctl.body.innerHTML = `<embed class="viewer-pdf" src="${url}" type="application/pdf">`;
        return;
      }
      if (ctl.kind === 'video' || ctl.kind === 'audio') {
        const url = await mediaUrl(path, gen);
        if (!url || ctl._destroyed || gen !== ctl._loadGen) return;
        // Mazz Player（PotPlayer 风皮肤；原生解码失败自动转降级卡）
        const st = await window.mazz.invoke('fs:stat', { path }).catch(() => ({}));
        // 切歌复用：同类媒体只换源不重建（stage 不销毁，全屏物理保持——比 wasFs 恢复 requestFullscreen 可靠）
        if (ctl._player && ctl._playerKind === ctl.kind && ctl._player.setSource) {
          if (gen !== ctl._loadGen) return;
          ctl._player.setSource(url, name, path, st.size || 0);
          if (ctl._pendingProgress) { ctl._player.applyProgress?.(ctl._pendingProgress); ctl._pendingProgress = null; }
          return;
        }
        const { createPlayer } = await import('./player.js');
        if (gen !== ctl._loadGen) return; // 已被更新的 load 取代（await 期间来了新 load）
        try { ctl._player?.destroy(); } catch {} // 旧播放器先销毁（切歌时旧实例不得在后台续播）
        ctl._player = null;
        ctl.body.innerHTML = '';
        const playerRoot = document.createElement('div');
        playerRoot.className = 'mz-player-root';
        ctl.body.appendChild(playerRoot);
        const player = createPlayer(playerRoot, {
          url, name, ext, path, kind: ctl.kind,
          fileSize: st.size || 0,
          onNav: (p2) => ctl.load(p2),
          onClose: () => { // 右上角 ✕ 接线（此前 onClose 未传=点了没反应）
            try {
              const tabId = window.MazzShell?.containerTab?.get?.(container);
              if (tabId) window.MazzShell.closeTabFlow(tabId);
            } catch {}
          },
        });
        // 切歌保持全屏：新 stage 不是 fullscreen 元素，主动恢复（此前切歌强制退出全屏）
        if (wasFs) { try { playerRoot.querySelector('.mz-stage')?.requestFullscreen?.(); } catch {} }
        // 原生解码失败 → 降级卡（错误监听挂主媒体，真实可信）
        playerRoot.querySelector('.mz-media').addEventListener('error', (ev) => {
          // P2P 流专属：流已接通但编码超 Chromium 解码面（番剧 H.264/HEVC 全灭实锤）——
          // 不毁播放器（列表栏/下载管理/网络面板是用户上下文，销毁连坐实锤过），内嵌明白话层
          const mediaEl = ev.target;
          window.__errDiag = { cs: mediaEl.currentSrc, s: mediaEl.src, code: mediaEl.error?.code, t: Date.now() };
          if (/^https?:\/\//.test(mediaEl.currentSrc || mediaEl.src || '')) {
            const ov = document.createElement('div');
            ov.className = 'mz-stream-err';
            ov.innerHTML = `<b>${iconHtml('⚠')} 流已接通，但本机内核无法解码该视频编码</b>
              <span>边下边播链路照常工作（看列表栏下载管理进度），下完可系统播放器打开</span>
              <span class="mz-stream-err-guide"></span>`;
            playerRoot.querySelector('.mz-stage')?.appendChild(ov);
            // HEVC 缺失附官方组件指引（播放设置「解码能力」同款，微软商店组件 CDN 官方包）
            import('../../lib/codec-guide.js').then(({ probeCodecs, renderHevcGuide, currentPlatform }) => {
              const hevc = probeCodecs().find(r => r.name.includes('HEVC'));
              if (!hevc || hevc.ok) return;
              renderHevcGuide(ov.querySelector('.mz-stream-err-guide'), currentPlatform());
            }).catch(() => {});
            return;
          }
          try { player?.destroy(); } catch {}
          // 解码失败给明白话：按容器给最可能编码猜测（mkv 十之八九 HEVC/AV1——用户 BDrip 主流形态）
        const codecGuess = ext === 'mkv' || ext === 'webm'
          ? '（mkv 壳里十之八九是 HEVC(x265)/AV1，本机 Chromium 内核暂不支持）'
          : '';
        showFallback(name, ext, `本机内核无法解码${codecGuess}——可转码为 H.264 播放，或改用外部播放器`);
        }, { once: true });
        ctl._player = player;
        ctl._playerKind = ctl.kind; // 记录类型（切歌复用判定：同类才换源不重建）
        if (ctl._pendingProgress) { player.applyProgress?.(ctl._pendingProgress); ctl._pendingProgress = null; }
        return;
      }
      showFallback(name, ext, '暂不支持预览此格式');
    } catch (e) {
      if (ctl._destroyed || gen !== ctl._loadGen) return;
      ctl.body.innerHTML = `<div class="viewer-err">读取失败：${e.message}</div>`;
    }
  };
  ctl.destroy = () => {
    if (ctl._destroyed) return;
    ctl._destroyed = true;
    ctl._loadGen = (ctl._loadGen || 0) + 1; // 让所有在途 load/transcode 失效。
    try { ctl._imgEditor?.destroy?.(); } catch {}
    ctl._imgEditor = null;
    try { ctl._player?.destroy?.(); } catch {}
    ctl._player = null;
    ctl._playerKind = null;
    revokeBlobUrl(ctl.objUrl);
    ctl.objUrl = null;
    for (const url of new Set(ctl._tcCache?.values?.() || [])) revokeBlobUrl(url);
    ctl._tcCache?.clear?.();
    for (const tempPath of ctl._tcTempPaths || []) {
      window.mazz?.invoke?.('fs:delete', { path: tempPath })?.catch?.(() => {});
    }
    ctl._tcTempPaths?.clear?.();
    ctl.root?.remove?.();
    instances.delete(container);
    if (current === ctl) current = null;
    if (window.__activeViewerCtl === ctl) window.__activeViewerCtl = null;
  };
  return ctl;
}

/** 空档起手（W44 无视频启动）：裸播放器上台——侧栏三源（播放列表/媒体库/网络资源）全可用，选源即播；幂等（有片/有播放器/有内容不碰） */
async function bootEmptyPlayer(ctl) {
  // 竞态闸：await import 期间 activate 同钩会再入（双播放器实锤）——同步占位先于一切 await
  if (ctl._destroyed) return;
  if (ctl.path || ctl._player || ctl._bootingEmpty || ctl.body.children.length) return;
  ctl._bootingEmpty = true;
  const { createPlayer } = await import('./player.js');
  // W58d：await 落锤前重验闸——竞态期间 setContent 已装片（看图/PDF 连带裸播放器上台，真机三证实锤）
  if (ctl._destroyed) { ctl._bootingEmpty = false; return; }
  if (ctl.path || ctl._player || ctl.body.children.length) { ctl._bootingEmpty = false; return; }
  const playerRoot = document.createElement('div');
  playerRoot.className = 'mz-player-root';
  ctl.body.appendChild(playerRoot);
  ctl._player = createPlayer(playerRoot, {
    url: null, name: '播放器', ext: '', path: null, kind: 'video',
    onNav: (p2) => ctl.load(p2),
  });
  ctl._bootingEmpty = false;
}

export default {
  displayName: '播放器',
  icon: '🖼',
  _forTests: { instances },
  progressKind: 'player',
  progressPath(state) { return state?.path || ''; },
  readOnly: true, // 只读模块：禁止保存/另存（防止空内容写回媒体文件）
  create(container) {
    const ctl = createViewer(container);
    instances.set(container, ctl);
    bootEmptyPlayer(ctl); // 无视频启动：立即上裸播放器（挂 DOM 不等 attach——detached DOM 照样建，真机慢 attach 不再被 350ms 竞态吃单）
    // W58d 根治：create 必须返回 ctl 本体（军规⑰第三起——code/browser 同族病，{ container } 畸形态绝育）
    return ctl;
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    window.__activeViewerCtl = ctl; // 浏览器/书库同款活动实例锚点（命令与 E2E 取件口）
    // 切回复活：root 被 deactivate 摘除时重新挂上并重载（此前切回后播放器半残：DOM 在、事件全灭）
    if (ctl.root && !ctl.root.isConnected) {
      container.appendChild(ctl.root);
      if (ctl.path) ctl.load(ctl.path);
    }
    // 空片切回：deactivate 毁了播放器但 DOM 残壳还在——清壳重起裸播放器（否则切回=死 UI 实锤）
    if (!ctl.path && !ctl._player && !ctl._bootingEmpty) { ctl.body.innerHTML = ''; bootEmptyPlayer(ctl); }
    contextKeys.set('module', MODULE);
  },
  deactivate(container) {
    // 切走暂停播放并销毁播放器
    const ctl = instances.get(container);
    ctl?.body.querySelectorAll('video, audio').forEach(m => { try { m.pause(); } catch {} });
    try { ctl?._player?.destroy(); ctl._player = null; } catch {}
    // 移除 DOM root：attach 复用 container 时旧 root 必须清走（双播放器第二道防线）
    try { ctl?.root?.remove(); } catch {}
    if (current === ctl) current = null;
  },
  dispose(state) {
    // detach 与纯 deactivate 语义分离：切签可复活，关签必须连实例表、播放器和临时资源一起退役。
    const ctl = instances.get(state?.container) || state;
    ctl?.destroy?.();
  },
  getContent() { return ''; }, // 只读：不产生可保存文本
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    const path = typeof data === 'string' ? data : data?.path;
    if (path) ctl.load(path);
  },
  newDocument() {},
  getCharCount() { return null; },
  getCursorPos() { return '查看'; },
  captureProgress(state) { return state?._player?.captureProgress?.() || null; },
  applyProgress(value, state) {
    if (!state || !value) return;
    if (state._player?.applyProgress) state._player.applyProgress(value);
    else state._pendingProgress = value;
  },
  contributes: { commands: [], keybindings: [], menus: {}, bridges: [], aiActions: [] },
};
