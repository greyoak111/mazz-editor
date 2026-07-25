// renderer/lib/recorder.js —— 内录引擎：画布过程录制 + 全局窗口录制（多选/混音/变速/mp4）
import { toast } from '../shell/shell.js';
import { wsPath } from './ws-path.js';
import fixWebmDuration from 'fix-webm-duration'; // 静态内联进 bundle（动态 import 在渲染进程解析失败=修复从未执行实锤）

function pickMime() {
  // 裸 'video/mp4' 是骗子：Chromium 实际产出 VP9 塞 MP4 容器（系统播放器/电影电视全播不了）
  // 只选 webm 系（VP9/VP8+Opus 编码容器一致）；要 mp4 产物走 ffmpeg.wasm 转码成真 H.264
  for (const m of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (window.MediaRecorder?.isTypeSupported?.(m)) return m;
  }
  return null;
}

async function saveToWorkspace(blob, name, ext) {
  const dir = await wsPath('/录制');
  await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  let buf = new Uint8Array(await blob.arrayBuffer());
  // 要 mp4：webm 录完转真 H.264（ffmpeg.wasm 本地转码，首次需加载内核）
  if (ext === 'mp4') {
    try {
      const { transcode } = await import('./ffmpeg-transcode.js');
      toast('正在转码为 mp4（H.264）…');
      buf = await transcode(buf, 'webm', {});
    } catch (e) {
      toast('mp4 转码失败，已保存为 webm：' + e.message);
      ext = 'webm';
    }
  }
  const path = `${dir}/${(name || '录制').replace(/[\\/:*?"<>|]/g, '-')}-${stamp}.${ext}`;
  let s = '';
  for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  await window.mazz.invoke('fs:writeFileBase64', { path, base64: btoa(s) });
  return path;
}

/** 通用录制器封装 */
class Recorder {
  constructor(stream, { name, fps = 10, outFormat = 'webm' }) {
    this.stream = stream;
    this.name = name;
    this.mime = pickMime();
    this.ext = outFormat === 'mp4' ? 'mp4' : 'webm'; // 录制容器恒为 webm；mp4 由转码产出
    this.chunks = [];
    this.t0 = 0; // 录制起点（duration 修复用）
    this.rec = this.mime ? new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 5_000_000 }) : null;
  }
  start() {
    if (!this.rec) return false;
    this.t0 = Date.now();
    this.rec.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    this.rec.onstop = async () => {
      let blob = new Blob(this.chunks, { type: this.mime });
      try {
        // webm duration 修复：canvas.captureStream+MediaRecorder 产的 webm 缺时长元数据（EBML duration 为 Infinity），
        // Chromium <video> 与 ffmpeg 都嫌不规范——「自己录的 webm 自己放不了+转码失败退出码1」的总根
        const durationMs = Date.now() - this.t0;
        try {
          blob = await new Promise((resolve) => { try { fixWebmDuration(blob, durationMs, (b) => resolve(b || blob)); } catch { resolve(blob); } });
        } catch {}
        const p = await saveToWorkspace(blob, this.name, this.ext);
        toast(`内录已保存：${p.split('/').pop()}`, [{ label: '打开工作区查看', fn: () => {} }], 5000);
      } catch (e) { toast('内录保存失败：' + e.message); }
      this.onstop?.();
    };
    this.rec.start(1000);
    toast('内录中…（再次点击停止）');
    return true;
  }
  stop() {
    try { this.rec?.state !== 'inactive' && this.rec.stop(); } catch {}
    this.stream.getTracks().forEach(t => t.stop());
  }
}

/** 画布过程内录（画板/任意 canvas） */
export async function startCanvasRecorder(canvas, { name } = {}) {
  if (!canvas?.captureStream) return null;
  const stream = canvas.captureStream(12);
  const r = new Recorder(stream, { name: name || '画板过程' });
  return r.start() ? r : null;
}

/** 音频混音：系统音（loopback，可选）+ 麦克风（可选） */
async function mixAudio({ systemStream, micOn, sysOn }) {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  if (sysOn && systemStream?.getAudioTracks().length) {
    ctx.createMediaStreamSource(new MediaStream(systemStream.getAudioTracks())).connect(dest);
  }
  if (micOn) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      ctx.createMediaStreamSource(mic).connect(dest);
    } catch { toast('麦克风不可用，已仅录画面'); }
  }
  return { ctx, stream: dest.stream };
}

/** 字幕轨：语音识别实时转写（Web Speech，每句带时间戳） */
class SubtitleTrack {
  constructor() {
    this.lines = []; // {start, end, text}
    this.t0 = Date.now();
    this.rec = null;
  }
  start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;
    this.rec = new SR();
    this.rec.lang = 'zh-CN';
    this.rec.continuous = true;
    this.rec.interimResults = true;
    let curStart = null;
    this.rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const now = (Date.now() - this.t0) / 1000;
        if (curStart == null) curStart = now;
        if (r.isFinal) {
          this.lines.push({ start: curStart, end: now, text: r[0].transcript.trim() });
          curStart = null;
        }
      }
    };
    try { this.rec.start(); return true; } catch { return false; }
  }
  stop() {
    try { this.rec?.stop(); } catch {}
    return this.toSrt();
  }

  /** AI 润色：srt 生成前文本态 AI 介入（断句优化 + 错别字修正 + 口语规整） */
  async polishWithAI() {
    if (!this.lines.length) return false;
    try {
      const { getProviderConfig, providerReady, chat } = await import('../modules/factory/provider.js');
      const cfg = await getProviderConfig();
      if (!providerReady(cfg)) return false;
      const raw = this.lines.map((l, i) => `[${i + 1}] ${l.text}`).join('\n');
      const prompt = `你是字幕润色助手。下面是语音识别出的字幕行（带行号），请：
1. 修正错别字与同音误字（语音识别常见错误）
2. 优化断句：过长的句子可拆，残缺的句子可合理补全语气
3. 保持口语自然，不要改写成书面语，不要增减事实
4. 严格按行号逐行输出，格式：[行号] 润色后文本，不要输出任何其他内容

字幕原文：
${raw}`;
      const out = await chat({ cfg, system: '你是专业字幕润色助手，只输出润色后的带行号文本。', user: prompt, temperature: 0.2 });
      const map = new Map();
      for (const line of out.split('\n')) {
        const m = /^\s*\[(\d+)\]\s*(.+)$/.exec(line.trim());
        if (m) map.set(+m[1], m[2].trim());
      }
      if (map.size >= Math.ceil(this.lines.length * 0.7)) {
        this.lines = this.lines.map((l, i) => map.has(i + 1) ? { ...l, text: map.get(i + 1) } : l);
        return true;
      }
      return false;
    } catch { return false; }
  }
  toSrt() {
    const fmt = (t) => {
      const ms = Math.round(t * 1000);
      const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
      const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
      const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
      const mm = String(ms % 1000).padStart(3, '0');
      return `${h}:${m}:${s},${mm}`;
    };
    return this.lines.map((l, i) => `${i + 1}\n${fmt(l.start)} --> ${fmt(l.end)}\n${l.text}\n`).join('\n');
  }
}

/**
 * 全局窗口内录（桌面版）
 * @param {object} o
 * @param {Array<{id,name,thumb}>} o.sources 选中的窗口/屏幕源
 * @param {number} o.speed 变速倍率（1/3/10/自定义）
 * @param {boolean} o.sysAudio 系统内音
 * @param {boolean} o.micAudio 麦克风
 */
export async function startScreenRecorder({ sources, speed = 3, sysAudio = true, micAudio = false, name, outFormat = 'webm', subtitle = false }) {
  if (!sources?.length) { toast('先选择录制窗口'); return null; }
  const captures = [];
  for (const src of sources) {
    if (src.id === 'mazz:self') {
      // 自录虚拟源：capturePage 帧轮询（Chromium 枚举排除自家窗口的绕行通道）
      captures.push({ src, self: true, stream: null });
      continue;
    }
    const stream = await navigator.mediaDevices.getDisplayMedia
      ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15, displaySurface: 'window' }, audio: sysAudio })
      : null;
    if (!stream) return null;
    captures.push({ src, stream });
  }
  // 混音
  const { ctx: audioCtx, stream: audioStream } = await mixAudio({
    systemStream: captures[0]?.stream, micOn: micAudio, sysOn: sysAudio,
  });

  // 画布合成（多源平铺）+ 变速抽帧
  const canvas = document.createElement('canvas');
  canvas.width = 1600; canvas.height = 900;
  const c2d = canvas.getContext('2d');
  const videos = captures.map((c, i) => {
    if (c.self) {
      // 自录虚拟源：capturePage 帧轮询喂 Image 元素（接口对齐 video：readyState/drawImage 可用）
      const img = new Image();
      img.readyState = 0; // 对齐 video 接口；首帧到位才置 2（无帧 drawImage 会抛 InvalidStateError）
      let stopped = false;
      const poll = async () => {
        if (stopped) return;
        const b64 = await window.mazz.invoke('rec:selfFrame').catch(() => null);
        if (b64 && !stopped) { img.src = 'data:image/png;base64,' + b64; img.readyState = 2; }
        if (!stopped) img._timer = setTimeout(poll, 200); // 5fps 自录帧率（capturePage 编码开销所限）
      };
      poll();
      img._stop = () => { stopped = true; clearTimeout(img._timer); };
      return img;
    }
    const v = document.createElement('video');
    v.srcObject = c.stream;
    v.muted = true;
    v.play().catch(() => {});
    return v;
  });
  const FPS = 10;
  // 变速：speed 倍快放 = 内容帧率提高 speed 倍（采样 10fps 下抽帧，播放即为 speed× 快进）
  const interval = Math.max(30, 1000 / (FPS * speed));
  const timer = setInterval(() => {
    c2d.fillStyle = '#111';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    const n = videos.length;
    videos.forEach((v, i) => {
      if (v.readyState < 2) return;
      if (n === 1) c2d.drawImage(v, 0, 0, canvas.width, canvas.height);
      else {
        const w = canvas.width / 2, h = canvas.height / 2;
        c2d.drawImage(v, (i % 2) * w, Math.floor(i / 2) * h, w, h);
      }
    });
  }, interval);
  const stream = canvas.captureStream(FPS);
  for (const t of audioStream.getAudioTracks()) stream.addTrack(t);

  // 字幕轨：外部语音识别（可选，停止时单独存 .srt 一轨）
  let subTrack = null;
  if (subtitle) {
    subTrack = new SubtitleTrack();
    if (!subTrack.start()) { subTrack = null; toast('语音识别不可用，仅录画面'); }
  }

  const r = new Recorder(stream, { name: name || '全局内录', outFormat });
  // 采集存活检测：DXGI 全屏复制在部分显卡/驱动上整段失败（错误 0x887A0026 键控互斥已弃用），
  // 1.5s 后全部视频源仍无帧 → 明确报因并给出路，不闷头录一坨黑
  setTimeout(() => {
    const alive = videos.some(v => v.readyState >= 2 && (v.videoWidth > 0 || v.naturalWidth > 0)); // naturalWidth 兼容自录 img 源
    if (!alive) {
      toast('画面采集失败：全屏源被这台机器的显卡/DXGI 拒绝（Windows 已知兼容问题）——请改用「窗口」源录制，或更新显卡驱动后重试', [], 6000);
      r.stop().catch(() => {});
    }
  }, 1500);
  const rawStop = r.stop.bind(r);
  r.stop = async () => {
    clearInterval(timer);
    videos.forEach(v => { v._stop?.(); v.srcObject = null; }); // _stop 停自录帧轮询
    // 字幕轨落盘（与视频同名 .srt，单独一轨便于自行修改）
    if (subTrack) {
      // AI 介入：先润色断句与错别字（srt 生成前文本态；无 AI 配置静默跳过）
      try {
        const polished = await subTrack.polishWithAI();
        if (polished) toast('字幕已 AI 润色（断句+错字修正）');
      } catch {}
      const srt = subTrack.stop();
      if (srt.trim()) {
        try {
          const dir = await wsPath('/录制');
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
          const p = `${dir}/${(name || '全局内录').replace(/[\\/:*?"<>|]/g, '-')}-${stamp}.srt`;
          await window.mazz.invoke('fs:writeFile', { path: p, content: srt });
          toast('字幕轨已保存：' + p.split('/').pop());
        } catch {}
      }
    }
    rawStop();
  };
  return r.start() ? r : null;
}
