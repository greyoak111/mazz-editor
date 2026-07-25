// renderer/lib/ffmpeg-transcode.js —— ffmpeg.wasm 本地懒加载转码
// 只在原生播放失败时才加载（31MB wasm 首次约 3-8s 下载/编译，之后常驻内存）
// 本地 vendor，不依赖 CDN：离线/墙内环境可用；桌面/Android/iOS WebView 全平台兼容
import { toast } from '../shell/shell.js';

let ffmpeg = null;
let loading = null;

/** vendor 运行时 URL（worker/wasm 需要真实文件，不走打包） */
function vendorUrl(rel) {
  return new URL('vendor/ffmpeg/' + rel, new URL('./', document.baseURI)).href;
}

/** 懒加载 ffmpeg 实例（多次调用共享同一实例） */
export async function ensureFFmpeg() {
  if (ffmpeg) return ffmpeg;
  if (loading) return loading;
  loading = (async () => {
    // 运行时 URL 动态导入（esbuild 不打包 vendor，worker 从真实路径 spawn）
    const { FFmpeg } = await import(vendorUrl('esm/classes.js'));
    const f = new FFmpeg();
    await f.load({ coreURL: vendorUrl('ffmpeg-core.js'), wasmURL: vendorUrl('ffmpeg-core.wasm') });
    ffmpeg = f;
    return f;
  })();
  try { return await loading; } finally { /* 失败后允许重试 */ loading = ffmpeg ? loading : null; }
}

/**
 * 转码为 Chromium 可播格式
 * @param {Uint8Array} bytes 源文件内容
 * @param {string} inExt 源扩展名（avi/mkv/wmv…）
 * @param {object} o
 * @param {boolean} o.toAudio 转音频 mp3（默认视频 mp4）
 * @param {(ratio:number)=>void} o.onProgress 进度 0~1
 * @returns {Promise<Uint8Array>}
 */
export async function transcode(bytes, inExt, { toAudio = false, toGif = false, gifWidth = 360, gifFps = 10, onProgress } = {}) {
  const f = await ensureFFmpeg();
  if (onProgress) f.on('progress', (p) => { if (p.progress > 0 && p.progress <= 1) onProgress(p.progress); });
  const safeExt = String(inExt || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
  const inName = 'input.' + safeExt;
  const outName = toGif ? 'out.gif' : (toAudio ? 'out.mp3' : 'out.mp4');
  await f.writeFile(inName, bytes);
  const args = toGif
    // 两阶段 palette：先取全局最优调色板，再抖动合成（GIF 质量关键）
    ? ['-i', inName, '-vf', `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,palettegen`, '-y', 'palette.png']
    : (toAudio
    ? ['-i', inName, '-vn', '-c:a', 'libmp3lame', '-q:a', '4', outName]
    : ['-i', inName, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27',
       '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outName]);
  let ret = await f.exec(args);
  if (toGif) {
    if (ret !== 0 && ret !== true) throw new Error('GIF 调色板生成失败（退出码 ' + ret + '）');
    ret = await f.exec(['-i', inName, '-i', 'palette.png', '-lavfi',
      `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4`, outName]);
  }
  if (ret !== 0 && ret !== true) {
    // 部分源流损坏：试试更宽容的二次封装（直接流拷贝失败再全转）
    throw new Error('ffmpeg 转码失败（退出码 ' + ret + '）');
  }
  const out = await f.readFile(outName);
  // 清理虚拟文件系统（防内存膨胀）
  try { await f.deleteFile(inName); await f.deleteFile(outName); } catch {}
  return out;
}

export function b64ToU8(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function u8ToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
  return btoa(s);
}
