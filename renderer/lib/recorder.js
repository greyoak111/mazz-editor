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
    this.bytes = 0; // 已收数据量（看门狗与 E2E 断言用）
    this.rec.ondataavailable = (e) => { if (e.data?.size) { this.chunks.push(e.data); this.bytes += e.data.size; } };
    this.rec.onstop = async () => {
      let blob = new Blob(this.chunks, { type: this.mime });
      try {
        // 零数据绝不落盘：写出一个 0KB 的「视频文件」只会误导用户以为录到了（录半分钟 0KB 事故的产物）
        if (!blob.size) {
          toast('录制无数据：全程未捕获到画面/声音（窗口被最小化/遮挡或采集被拒），未生成文件', [], 6000);
          this.onstop?.();
          return;
        }
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
    // 字节看门狗：2.5s 仍零数据=采集链路断流（后台节流掐帧/采集被拒），立即报因并停录——
    // 绝不再闷头空转半小时最后赏用户一个 0KB 文件
    this._watchdog = setTimeout(() => {
      if (this.rec?.state === 'recording' && !this.bytes) {
        toast('录制无数据：画面采集断流（窗口被最小化/遮挡或被系统拒绝）——已停止，请调整窗口状态后重试', [], 6000);
        this.stop();
      }
    }, 2500);
    toast('内录中…（再次点击停止）');
    return true;
  }
  stop() {
    clearTimeout(this._watchdog);
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
  let sources = 0;
  if (sysOn && systemStream?.getAudioTracks().length) {
    ctx.createMediaStreamSource(new MediaStream(systemStream.getAudioTracks())).connect(dest);
    sources++;
  }
  if (micOn) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      ctx.createMediaStreamSource(mic).connect(dest);
      sources++;
    } catch { toast('麦克风不可用，已仅录画面'); }
  }
  // 零音源绝不挂空目标轨：裸 MediaStreamAudioDestinationNode（无输入）不产任何样本，
  // MediaRecorder(vp9,opus) 死等每轨首样本才开混流——整条录制被它噎成零字节（自录零数据真凶，
  // 变量隔离实验实锤：同画布同编码，挂空轨 bytes=0，不挂 6KB+）
  if (!sources) { ctx.close().catch(() => {}); return { ctx: null, stream: new MediaStream() };
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
/** 单源画面捕获：三级降级通路（开源录屏界经典 fallback） */
async function captureSource(src, wantAudio) {
  // 一级：getDisplayMedia（主进程 setDisplayMediaRequestHandler 按 rec:useSource 授权出列）
  // 授权推送与消费同处一函数，杜绝陈旧授权串源错录（旧实现由对话框预推全部源，自录源不入队即残留）
  try {
    await window.mazz.invoke('rec:useSource', { id: src.id, audio: wantAudio });
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: wantAudio });
    if (wantAudio && !s.getAudioTracks().length) toast('系统内音不可用，已仅录画面');
    return s;
  } catch {}
  // 二级：系统内音（loopback）被个别声卡/系统策略拖累整路拒绝时，降级无声再试
  if (wantAudio) {
    try {
      await window.mazz.invoke('rec:useSource', { id: src.id, audio: false });
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      toast('系统内音捕获失败，已降级为仅录画面');
      return s;
    } catch {}
  }
  // 三级：Electron 官方 desktopCapturer 经典通路（getUserMedia + chromeMediaSource，全版本兼容）
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, maxFrameRate: 15 } },
    });
  } catch {}
  toast(`「${src.name}」画面捕获失败（检查系统录屏权限设置后重试）`, [], 5000);
  return null;
}

export async function startScreenRecorder({ sources, speed = 3, sysAudio = true, micAudio = false, name, outFormat = 'webm', subtitle = false }) {
  if (!sources?.length) { toast('先选择录制窗口'); return null; }
  const captures = [];
  const cleanup = () => captures.forEach(c => { c._stop?.(); c.stream?.getTracks?.().forEach(t => { try { t.stop(); } catch {} }); });
  for (const src of sources) {
    if (src.id === 'mazz:self') {
      // 自录虚拟源：capturePage 帧轮询（Chromium 枚举排除自家窗口的绕行通道）
      captures.push({ src, self: true, stream: null });
      continue;
    }
    const stream = await captureSource(src, sysAudio);
    if (!stream) { cleanup(); return null; } // 失败必须放掉已到手的采集轨（录制指示灯泄露防线）
    captures.push({ src, stream });
  }
  // 混音（系统内音取第一路真实采集流；自录虚拟源无流）
  const { ctx: audioCtx, stream: audioStream } = await mixAudio({
    systemStream: captures.find(c => c.stream)?.stream, micOn: micAudio, sysOn: sysAudio,
  });

  // 字幕轨：外部语音识别（可选，停止时单独存 .srt 一轨）
  let subTrack = null;
  if (subtitle) {
    subTrack = new SubtitleTrack();
    if (!subTrack.start()) { subTrack = null; toast('语音识别不可用，仅录画面'); }
  }

  // 两条录制路径共用的停止收尾：字幕轨落盘 + 采集轨全放 + 音频上下文回收
  const finalizeStop = async () => {
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
    cleanup(); // 放掉全部采集轨（loopback 系统音/麦克风指示灯的泄露防线——旧实现停录后轨不灭）
    setTimeout(() => audioCtx?.close?.().catch(() => {}), 600); // 等末段音频冲刷完再回收（零音源时 audioCtx 为 null）
  };

  // —— 直录路径（单源原速）：WebRTC 桌面采集轨由浏览器进程推帧，不经渲染器合成器/画布——
  // 窗口最小化/被遮挡照录不误（开源录屏清一色此模式；画布路径是后台节流断帧的重灾区）
  const solo = captures.length === 1 && !captures[0].self && speed === 1;
  if (solo) {
    const stream = new MediaStream(captures[0].stream.getVideoTracks());
    for (const t of audioStream.getAudioTracks()) stream.addTrack(t);
    const r = new Recorder(stream, { name: name || '全局内录', outFormat });
    const rawStop = r.stop.bind(r);
    r.stop = async () => { await finalizeStop(); rawStop(); };
    if (!r.start()) { try { subTrack?.stop(); } catch {} cleanup(); return null; }
    return r;
  }

  // —— 画布合成路径（多源平铺/变速/自录虚拟源）：反节流三开关+backgroundThrottling:false 护体 ——
  const canvas = document.createElement('canvas');
  canvas.width = 1600; canvas.height = 900;
  const c2d = canvas.getContext('2d');
  const videos = captures.map((c) => {
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
    await finalizeStop();
    rawStop();
  };
  if (!r.start()) { try { subTrack?.stop(); } catch {} clearInterval(timer); videos.forEach(v => { v._stop?.(); v.srcObject = null; }); cleanup(); return null; }
  return r;
}
