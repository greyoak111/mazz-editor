// renderer/modules/viewer/subtitles.js —— 字幕管理（subtitles-octopus=libass-wasm，MIT；ASS/SRT/SSA 特效字幕正宗渲染）
// 资产通道：主进程 player:subAssets 取字体；worker/wasm 走 mazz-res:// 特权协议（classic worker 与取件全通——
// ES module worker 走不通的迷宫（jassub 系）实录：blob/file 源被掐→自建协议→路径丢段→worker 内 CSP，条条实锤）
import SubtitlesOctopus from 'libass-wasm';

let _fontBytes = null;   // OS CJK 回退字体字节
let _renderer = null;    // 当前 SubtitlesOctopus 实例（一个播放器一个）
let _canvas = null;
let _host = null;        // 画布自建宿主（生死我方管）

const b64ToU8 = (b64) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};

async function ensureFont() {
  if (_fontBytes !== null) return _fontBytes;
  const a = await window.mazz.invoke('player:subAssets').catch(() => null);
  _fontBytes = a?.fallbackFont?.base64 ? b64ToU8(a.fallbackFont.base64) : false;
  return _fontBytes;
}

const SUB_EXTS = new Set(['ass', 'srt', 'ssa']);

/** 同名/同族字幕探测：video.mkv → video.ass / video.chs.ass / video_tc.ass 等 */
export async function probeSubtitles(videoPath) {
  if (!videoPath) return [];
  const norm = videoPath.replace(/\\/g, '/');
  const dir = norm.split('/').slice(0, -1).join('/');
  const stem = norm.split('/').pop().replace(/\.[a-zA-Z0-9]{2,5}$/, '').toLowerCase();
  const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
  return (entries || [])
    .filter(e => !e.isDir && SUB_EXTS.has(e.name.split('.').pop().toLowerCase()))
    .filter(e => e.name.toLowerCase().startsWith(stem))
    .map(e => e.path)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 挂载字幕到视频元素（ass/srt/ssa 全走 libass；srt 也吃 ASS 排版引擎，行为一致） */
export async function attachSubtitle(video, { subPath, subContent, onState }) {
  const mark = (s) => { window.__subStage = s; };
  mark('ensureFont');
  const fontBytes = await ensureFont();
  mark('detach');
  detachSubtitle(); // 旧渲染先毁（一切换即换轨）
  let content = subContent;
  if (content == null && subPath) {
    content = await window.mazz.invoke('fs:readFile', { path: subPath }).catch(() => null);
  }
  if (!content) throw new Error('字幕内容为空或读取失败');
  mark('construct');
  video.parentElement.style.position = 'relative';
  // 不传自造 canvas（API 契约：canvas 由 octopus 自建并管 canvasParent——用户传入的 canvas 会让
  // canvasParent 恒 null，resize() 读它顶坐标必炸 TypeError（五连实锤））
  let renderer;
  try {
    renderer = await new Promise((resolve, reject) => {
      try {
        const r = new SubtitlesOctopus({
        video,
        subContent: content,
        // subUrl 不传：file:// 从页面/worker fetch 全被 Chromium 拦（init 静默挂死实锤）——内容已直接给，标识符无用
        workerUrl: /* 同源化：worker 与页面同 host（mazz-res://lib 与 mazz-res://app 在 standard scheme 下不同 origin=跨源 worker 被拦实锤） */ 'mazz-res://app/dist/lib/octopus/subtitles-octopus-worker.js',
        legacyWorkerUrl: 'mazz-res://app/dist/lib/octopus/subtitles-octopus-worker-legacy.js',
        wasmUrl: 'mazz-res://app/dist/lib/octopus/subtitles-octopus-worker.wasm',
        // 字体经 mazz-res 供 worker 取（blob:file:// 在 worker 内 XHR 被 CORS 掐=装载失败实锤；mazz-res 已实证全通）
        availableFonts: fontBytes ? { 'sans-serif': 'mazz-res://fonts/fallback' } : {},
        // fallbackFont 是字体文件 URL 不是字体名（当字体名传=按 URL 拉取必 404：「Loading data file sans-serif failed」四连实锤）
        fallbackFont: fontBytes ? 'mazz-res://fonts/fallback' : 'default.woff2',
        debug: true, // 竞态终止 in-flight worker 时抑制 dispose+throw 的 pageerror 噪音（debug:false 即抛实锤）
        onReady: () => resolve(r),
        onError: (e) => reject(new Error(String(e?.message || e))),
      });
      } catch (e) { reject(e); }
    });
  } catch (e) {
    window.__subErr = String(e?.stack || e?.message || e).slice(0, 500);
    throw e;
  }
  mark('ready-ok');
  _renderer = renderer;
  window.__subRef = renderer; // 排障/E2E 实例锚点
  _canvas = renderer.canvas; // octopus 自建画布
  _canvas.classList.add('mz-sub-canvas'); // E2E/样式锚点
  // 画布 DOM 收养：octopus 的 canvasParent 会被自家 workerError 的 dispose() 摘除（连=false 六连实锤）——
  // 渲染上下文绑画布元素不绑父容器，收养进自建宿主后生死由我方生命周期管
  const host = document.createElement('div');
  host.className = 'mz-sub-host';
  host.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5';
  host.appendChild(_canvas);
  if (video.nextSibling) video.parentNode.insertBefore(host, video.nextSibling);
  else video.parentNode.appendChild(host);
  _host = host;
  onState?.({ attached: true, path: subPath || null });
  return _renderer;
}

/** 显隐切换（不毁渲染器——藏自建宿主即可，重开秒回；与 octopus 自身 display 逻辑不打架） */
export function setSubtitleVisible(on) {
  if (_host) _host.style.display = on ? '' : 'none';
  return !!_host;
}
export function subtitleAttached() { return !!_renderer; }

export function detachSubtitle() {
  try { _renderer?.destroy?.(); } catch {}
  try { _renderer?.canvasParent?.remove?.(); } catch {}
  try { _host?.remove?.(); } catch {}
  _renderer = null;
  _canvas = null;
  _host = null;
}
