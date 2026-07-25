// renderer/modules/viewer/index.js —— 通用查看器：图片 / PDF / 视频 / 音频（只读）
// Chromium 内核原生能放的走 HTML5 播放器；啃不动的格式优雅降级「外部打开」
import { contextKeys } from '../../core/contextkey-service.js';
import { toast } from '../../shell/shell.js';
import { iconHtml } from '../../lib/svg-icons.js';

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
    e.preventDefault();
    setZoom(ctl.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  /** 媒体源：桌面用 file://（不占内存）；网页/移动读 base64 建 Blob URL */
  async function mediaUrl(path) {
    if (window.mazz?.isElectron) return 'file://' + path.replace(/\\/g, '/').replace(/#/g, '%23').replace(/\?/g, '%3F');
    const b64 = await window.mazz.invoke('fs:readFileBase64', { path });
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = (path.split('.').pop() || '').toLowerCase();
    if (ctl.objUrl) URL.revokeObjectURL(ctl.objUrl);
    ctl.objUrl = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] || 'application/octet-stream' }));
    return ctl.objUrl;
  }

  /** 降级卡：格式啃不动 → 转码播放（ffmpeg）/ 外部打开 双选 */
  function showFallback(name, ext, reason) {
    const isMedia = VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext);
    ctl.body.innerHTML = `
      <div class="viewer-fallback">
        <div class="vf-ico">${iconHtml(isMedia ? '🎬' : '📄')}</div>
        <div class="vf-name"></div>
        <div class="vf-reason">${reason}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
          ${isMedia ? '<button class="vf-tc rb-btn" style="flex-direction:row;padding:8px 22px;background:var(--accent);color:var(--accent-fg)">⚙ 转码播放</button>' : ''}
          <button class="vf-open rb-btn" style="flex-direction:row;padding:8px 22px">用系统默认程序打开</button>
        </div>
        <div class="vf-progress" style="display:none;width:260px"></div>
      </div>`;
    ctl.body.querySelector('.vf-name').textContent = name + '（.' + ext + '）';
    ctl.body.querySelector('.vf-open').addEventListener('click', () => extBtn.click());
    ctl.body.querySelector('.vf-tc')?.addEventListener('click', () => transcodeAndPlay(name, ext));
    extBtn.style.display = '';
  }

  /** ffmpeg 转码后播放（带进度；同会话内缓存结果） */
  async function transcodeAndPlay(name, ext) {
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
      if (window.mazz?.isElectron) {
        // 写临时文件，file:// 播放（不占内存；同会话缓存命中直接播）
        const ws = await window.mazz.invoke('workspace:get');
        const dir = `${ws}/.mazz/temp`;
        await window.mazz.invoke('fs:mkdir', { path: dir });
        const outExt = AUDIO_EXTS.has(ext) ? 'mp3' : 'mp4';
        const outPath = `${dir}/transcoded_${Date.now()}.${outExt}`;
        await window.mazz.invoke('fs:writeFileBase64', { path: outPath, base64: u8ToB64(out) });
        url = 'file://' + outPath;
      } else {
        url = URL.createObjectURL(new Blob([out], { type: AUDIO_EXTS.has(ext) ? 'audio/mpeg' : 'video/mp4' }));
      }
      ctl._tcCache = ctl._tcCache || new Map();
      ctl._tcCache.set(cacheKey, url);
      toast('转码完成，开始播放');
      playUrl(url, VIDEO_EXTS.has(ext) ? 'video' : 'audio').catch(e => toast('播放失败：' + e.message));
    } catch (e) {
      btn.disabled = false;
      prog.innerHTML = `<div style="font-size:12px;color:var(--danger,#dc2626)">转码失败：${e.message}</div>`;
    }
  }

  /** 统一播放入口（原生或转码产物）：一律走 Mazz Player 组件（快捷键/倍速/播放列表全套，不再用裸 video） */
  async function playUrl(url, kind) {
    const name = ctl.path.split(/[\\/]/).pop();
    const ext = (name.split('.').pop() || '').toLowerCase();
    const { createPlayer } = await import('./player.js');
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
    ctl.pctEl.parentElement.querySelectorAll('[data-a=in],[data-a=out],[data-a=fit],[data-a=actual]').forEach(b => b.style.display = ctl.kind === 'image' ? '' : 'none');
    ctl.pctEl.style.display = ctl.kind === 'image' ? '' : 'none';
    extBtn.style.display = 'none';

    try {
      if (ctl.kind === 'image') {
        const url = await mediaUrl(path);
        ctl.body.innerHTML = '';
        const img = document.createElement('img');
        img.draggable = false;
        img.alt = name;
        img.onload = () => { ctl.natW = img.naturalWidth; ctl.natH = img.naturalHeight; ctl.fitMode = true; applyZoom(); };
        img.onerror = () => showFallback(name, ext, '图片解码失败');
        img.src = url;
        ctl.body.appendChild(img);
        return;
      }
      if (ctl.kind === 'pdf') {
        const url = await mediaUrl(path);
        ctl.body.innerHTML = `<embed class="viewer-pdf" src="${url}" type="application/pdf">`;
        return;
      }
      if (ctl.kind === 'video' || ctl.kind === 'audio') {
        const url = await mediaUrl(path);
        // Mazz Player（PotPlayer 风皮肤；原生解码失败自动转降级卡）
        const st = await window.mazz.invoke('fs:stat', { path }).catch(() => ({}));
        // 切歌复用：同类媒体只换源不重建（stage 不销毁，全屏物理保持——比 wasFs 恢复 requestFullscreen 可靠）
        if (ctl._player && ctl._playerKind === ctl.kind && ctl._player.setSource) {
          if (gen !== ctl._loadGen) return;
          ctl._player.setSource(url, name, path, st.size || 0);
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
        playerRoot.querySelector('.mz-media').addEventListener('error', () => {
          try { player?.destroy(); } catch {}
          showFallback(name, ext, '此格式 Chromium 内核无法解码（可改用外部播放器）');
        }, { once: true });
        ctl._player = player;
        ctl._playerKind = ctl.kind; // 记录类型（切歌复用判定：同类才换源不重建）
        return;
      }
      showFallback(name, ext, '暂不支持预览此格式');
    } catch (e) {
      ctl.body.innerHTML = `<div class="viewer-err">读取失败：${e.message}</div>`;
    }
  };
  ctl.destroy = () => { if (ctl.objUrl) { URL.revokeObjectURL(ctl.objUrl); ctl.objUrl = null; } };
  return ctl;
}

export default {
  displayName: '查看器',
  icon: '🖼',
  readOnly: true, // 只读模块：禁止保存/另存（防止空内容写回媒体文件）
  create(container) {
    const ctl = createViewer(container);
    instances.set(container, ctl);
    return { container };
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    // 切回复活：root 被 deactivate 摘除时重新挂上并重载（此前切回后播放器半残：DOM 在、事件全灭）
    if (ctl.root && !ctl.root.isConnected) {
      container.appendChild(ctl.root);
      if (ctl.path) ctl.load(ctl.path);
    }
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
  contributes: { commands: [], keybindings: [], menus: {}, bridges: [], aiActions: [] },
};
