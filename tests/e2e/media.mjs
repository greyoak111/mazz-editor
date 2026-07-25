// tests/e2e/media.mjs —— 真实视频资源猎手：本地产不了的微型样片（<5s 低码率）按序猎取
// 纪律：国内镜像/可达源优先，全部失败则明确降级（跳过视频场景，绝不让全套件挂掉）
import fs from 'fs';
import path from 'path';

const MEDIA_DIR = path.resolve('tests/e2e/media');

const CANDIDATES = {
  // mp4 原生解码验证
  mp4: [
    'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_1s_0.1MB.mp4',
    'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_1s_0.2MB.mp4',
    'https://www.w3schools.com/html/mov_bbb.mp4',
  ],
  // mkv 转码通道验证（Chromium 不解 → 走 ffmpeg.wasm 转码播放）
  mkv: [
    'https://dl.matroska.org/downloads/test_series/test1.mkv',
    'https://test-videos.co.uk/vids/bigbuckbunny/mkv/h264/360/Big_Buck_Bunny_360_1s_0.1MB.mkv',
  ],
  // webm 原生验证（备用）
  webm: [
    'https://test-videos.co.uk/vids/bigbuckbunny/webm/vp8/360/Big_Buck_Bunny_360_1s_0.1MB.webm',
  ],
};

async function fetchOne(url, dest, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 10000) throw new Error('文件过小可疑（' + buf.length + 'B）');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return buf.length;
  } finally { clearTimeout(t); }
}

import { execFileSync } from 'child_process';

/** 本地转制：mp4 母带 → 4 秒低码率三格式（用户规矩：<5s、极小、mkv 必须有）
 *  网络只管 mp4 母带，mkv/webm 一律本地 ffmpeg 产出——彻底摆脱 mkv 源不可达问题 */
export function transcodeTrio(mp4Path) {
  const out = {
    mp4: path.join(MEDIA_DIR, 'sample_4s.mp4'),
    mkv: path.join(MEDIA_DIR, 'sample.mkv'),
    webm: path.join(MEDIA_DIR, 'sample.webm'),
  };
  const done = Object.values(out).every(p => fs.existsSync(p) && fs.statSync(p).size > 10000);
  if (done) return out;
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4Path, '-t', '4', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '64k', out.mp4]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out.mp4, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '64k', out.mkv]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out.mp4, '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libvorbis', out.webm]);
    console.log('  [媒体] 本地转制三样片完成（4s 低码率）');
    return out;
  } catch (e) {
    console.log('  [媒体] 本地转制失败：' + e.message.slice(0, 60));
    return { mp4: mp4Path, mkv: null, webm: null };
  }
}

/** 确保某类样片在手（命中缓存直接用；失败换下一家；全灭返回 null） */
export async function ensureMedia(kind) {
  const dest = path.join(MEDIA_DIR, 'sample.' + kind);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) return dest;
  for (const url of CANDIDATES[kind] || []) {
    try {
      const n = await fetchOne(url, dest);
      console.log(`  [媒体] ${kind} 到手（${(n / 1024).toFixed(0)}KB，${url.split('/').slice(0, 3).join('/')}）`);
      return dest;
    } catch (e) {
      console.log(`  [媒体] ${kind} 源失败：${url.split('/').slice(2, 3)[0]}（${e.message.slice(0, 50)}）`);
    }
  }
  return null;
}
