import { getProviderConfig, providerReady, chat } from '../factory/provider.js';
import { iconHtml } from '../../lib/svg-icons.js';

export const COMPANION_PERSONAS = Object.freeze([
  Object.freeze({ id: 'veteran', name: '吧龄老哥', expertise: ['callback', 'culture'], color: '#f59e0b' }),
  Object.freeze({ id: 'deadpan', name: '绷不住小姐', expertise: ['comedy', 'turn'], color: '#fb7185' }),
  Object.freeze({ id: 'spectator', name: '乐子人', expertise: ['comedy', 'climax'], color: '#a78bfa' }),
  Object.freeze({ id: 'critic', name: '婆罗门', expertise: ['craft', 'analysis'], color: '#60a5fa' }),
  Object.freeze({ id: 'fan', name: '单推人', expertise: ['character', 'emotion'], color: '#f472b6' }),
  Object.freeze({ id: 'cadre', name: '老干部', expertise: ['context', 'logic'], color: '#34d399' }),
  Object.freeze({ id: 'lurker', name: '阴湿小透明', expertise: ['detail', 'foreshadow'], color: '#94a3b8' }),
  Object.freeze({ id: 'chaos', name: '癫婆', expertise: ['climax', 'surprise'], color: '#f87171' }),
]);

export const FLAVOR_PACKS = Object.freeze(['泛式风', '瓶子风', '极客风', 'VTB 风', '电台风', '整活风', '塔菲风', 'Neuro 风', 'Evil 风', '梓风']);
export const TALK_LEVELS = Object.freeze(['silent', 'discussion', 'recap']);

export function normalizePersona(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('人格必须是对象');
  const allowed = new Set(['schema', 'id', 'name', 'expertise', 'color', 'flavor', 'quadrants', 'voicePrompt']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`人格包含未冻结字段：${key}`);
  if (input.schema !== 'mazz.persona/v0') throw new Error(`不支持的人格 schema：${input.schema}`);
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(id) || !name) throw new Error('人格 id/name 非法');
  const quadrants = input.quadrants && typeof input.quadrants === 'object' ? input.quadrants : {};
  const normalizedQuadrants = {};
  for (const axis of ['warmth', 'energy', 'analysis', 'chaos']) {
    const value = Number(quadrants[axis] ?? 0.5);
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`人格四象限 ${axis} 必须在 0–1`);
    normalizedQuadrants[axis] = value;
  }
  const flavor = String(input.flavor || '泛式风');
  if (!FLAVOR_PACKS.includes(flavor)) throw new Error(`未知风味包：${flavor}`);
  return Object.freeze({
    schema: 'mazz.persona/v0', id, name: name.slice(0, 80),
    expertise: [...new Set((input.expertise || []).map(String))].slice(0, 12),
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#8b86ff',
    flavor, quadrants: Object.freeze(normalizedQuadrants), voicePrompt: String(input.voicePrompt || '').slice(0, 2_000), custom: true,
  });
}

export function evaluatePersonaSample(text) {
  const source = String(text || '').trim();
  const findings = [];
  if (/(?:作为一个AI|很高兴为您|请问还有什么可以帮您|希望以上内容)/i.test(source)) findings.push('客服腔');
  if (/(?:我们应该|你要明白|这告诉我们|总而言之)/.test(source)) findings.push('说教腔');
  if (source.length > 500) findings.push('单次话量过长');
  return Object.freeze({ pass: findings.length === 0, findings });
}

export function estimateCompanionCost({ durationSeconds = 0, intervalSeconds = 25, inputTokens = 700, outputTokens = 180, pricePerMillion = 1 } = {}) {
  const calls = Math.max(0, Math.ceil(Number(durationSeconds) / Math.max(20, Number(intervalSeconds) || 25)));
  const tokens = calls * (Math.max(0, Number(inputTokens)) + Math.max(0, Number(outputTokens)));
  return Object.freeze({ calls, tokens, estimatedCost: Number((tokens / 1_000_000 * Math.max(0, Number(pricePerMillion))).toFixed(4)), currency: 'provider-configured' });
}

function timestamp(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function classifyBeat({ paused = false, ended = false, playbackRate = 1, rms = 0, cutScore = 0, previousBeat = '', sincePreviousMs = Infinity } = {}) {
  if (ended) return { type: 'credits', gate: 'open', delayMs: 0, talkLevel: 'recap' };
  if (paused) return { type: 'paused', gate: 'open', delayMs: 0, talkLevel: 'discussion' };
  if (rms >= 0.82 || cutScore >= 0.35) return { type: 'climax', gate: 'silence', delayMs: 8_000, talkLevel: 'silent' };
  if (previousBeat === 'climax' && sincePreviousMs < 10_000) return { type: 'afterglow', gate: 'wait', delayMs: 10_000 - sincePreviousMs, talkLevel: 'silent' };
  if (playbackRate > 1.25) return { type: 'accelerated', gate: 'sparse', delayMs: 0, talkLevel: 'silent' };
  return { type: 'calm', gate: 'open', delayMs: 0, talkLevel: 'discussion' };
}

export function chooseSpeakers(personas, beatType, { userPriority = false } = {}) {
  if (userPriority) return [];
  const score = persona => persona.expertise.includes(beatType) ? 2 : persona.expertise.includes('analysis') ? 1 : 0;
  return [...personas].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)).slice(0, 2);
}

export function spoilerViolation(text, currentTimeMs) {
  const source = String(text || '');
  if (/(?:下一集|最终结局|后来才知道|大结局|未来剧情)/.test(source)) return true;
  for (const match of source.matchAll(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/g)) {
    const seconds = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    if (seconds * 1000 > Number(currentTimeMs) + 2_000) return true;
  }
  return false;
}

export function enforceSpoilerLock(text, currentTimeMs) {
  return spoilerViolation(text, currentTimeMs)
    ? { ok: false, text: '（这句可能越过当前播放进度，已被防剧透锁拦下。）' }
    : { ok: true, text: String(text || '').trim() };
}

export class CompanionSession {
  constructor({ mediaName, mediaPath, now = () => new Date().toISOString(), personas = COMPANION_PERSONAS.slice(0, 2), archiveEnabled = true } = {}) {
    this.mediaName = mediaName || '未命名媒体';
    this.mediaPath = mediaPath || '';
    this.now = now;
    this.personas = personas.slice(0, 8);
    this.archiveEnabled = archiveEnabled;
    this.startedAt = now();
    this.sessionId = `accompany:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    this.messages = [];
    this.beats = [];
    this.lastBeat = null;
    this.debateTurns = 0;
  }

  observe(input) {
    const mediaTimeMs = Math.max(0, Math.floor(Number(input.mediaTimeMs) || 0));
    const sincePreviousMs = this.lastBeat ? Math.max(0, mediaTimeMs - this.lastBeat.mediaTimeMs) : Infinity;
    const beat = { ...classifyBeat({ ...input, previousBeat: this.lastBeat?.type || '', sincePreviousMs }), mediaTimeMs };
    if (!this.lastBeat || beat.type !== this.lastBeat.type) this.beats.push({ type: beat.type, mediaTimeMs });
    this.lastBeat = beat;
    return beat;
  }

  addMessage({ role, speaker = '', text, mediaTimeMs }) {
    const entry = { role, speaker, text: String(text || '').slice(0, 20_000), mediaTimeMs: Math.max(0, Math.floor(Number(mediaTimeMs) || 0)), createdAt: this.now() };
    this.messages.push(entry);
    if (this.messages.length > 2_000) this.messages.splice(0, this.messages.length - 2_000);
    return entry;
  }

  contextAt(mediaTimeMs) {
    return this.messages.filter(message => message.mediaTimeMs <= mediaTimeMs).slice(-24);
  }

  prompt({ mediaTimeMs, beat, userText = '', speaker }) {
    const history = this.contextAt(mediaTimeMs).map(message => `[${timestamp(message.mediaTimeMs)} ${message.speaker || message.role}] ${message.text}`).join('\n');
    return {
      system: `你是本地播放器里的陪看人格“${speaker.name}”。只讨论播放进度 ${timestamp(mediaTimeMs)} 及以前已提供的信息，严禁下一集、结局和未来剧情。当前拍点=${beat.type}，话量=${beat.talkLevel}。保持人格感，引用所回应的当前话题；不要声称看到了未提供的画面。`,
      user: `截至当前的放映室记录：\n${history || '（暂无）'}\n\n用户当前发言：${userText || '请只对当前拍点作一句短评。'}`,
    };
  }

  archivePayload(mode = 'beat') {
    return {
      schema: 'mazz.accompany-session/v0', mediaPath: this.mediaPath, mediaName: this.mediaName,
      sessionId: this.sessionId, startedAt: this.startedAt, endedAt: this.now(), mode,
      personas: this.personas.map(persona => persona.id), beats: this.beats, messages: this.messages,
      stats: { beatCount: this.beats.length, messageCount: this.messages.length },
    };
  }
}

export function mountCompanion({ root, media, mediaName, mediaPath, sampleRms = () => 0 }) {
  let session = new CompanionSession({ mediaName, mediaPath });
  const panel = document.createElement('section');
  panel.className = 'mz-companion';
  panel.hidden = true;
  panel.innerHTML = `
    <header><b>陪看</b><span class="mz-companion-gate">静候拍点</span><button data-c="close" title="收起" aria-label="收起陪看">${iconHtml('✕')}</button></header>
    <div class="mz-companion-log" aria-live="polite"></div>
    <div class="mz-companion-status">防剧透锁：开 · 观剧档：开 · 当前不自动调用 AI</div>
    <div class="mz-companion-compose"><input aria-label="陪看消息" placeholder="暂停或播放时都可以聊…"><button class="mz-companion-send" type="button" data-c="send" aria-label="发送消息（Enter）" aria-keyshortcuts="Enter" title="发送（Enter）">${iconHtml('↵')}</button></div>`;
  root.querySelector('.mz-stage')?.appendChild(panel);
  const log = panel.querySelector('.mz-companion-log');
  const input = panel.querySelector('input');
  const gateLabel = panel.querySelector('.mz-companion-gate');
  const statusLabel = panel.querySelector('.mz-companion-status');
  let busy = false;
  let destroyed = false;
  let lastObservationAt = -1;
  let abortController = null;
  let active = false;
  let priorFrame = null;
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 32;
  sampleCanvas.height = 18;

  const sampleCut = () => {
    if (!media.videoWidth || !media.videoHeight) return 0;
    try {
      const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(media, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const pixels = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
      const next = new Uint8Array(sampleCanvas.width * sampleCanvas.height);
      for (let index = 0, target = 0; index < pixels.length; index += 4, target += 1) next[target] = Math.round(pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114);
      if (!priorFrame) { priorFrame = next; return 0; }
      let delta = 0;
      for (let index = 0; index < next.length; index += 1) delta += Math.abs(next[index] - priorFrame[index]);
      priorFrame = next;
      return delta / next.length / 255;
    } catch { return 0; }
  };

  const renderMessage = message => {
    const row = document.createElement('div');
    row.className = `mz-companion-msg is-${message.role}`;
    const head = document.createElement('b');
    head.textContent = `${timestamp(message.mediaTimeMs)} · ${message.speaker || (message.role === 'user' ? '你' : '陪看')}`;
    const body = document.createElement('span');
    body.textContent = message.text;
    row.append(head, body);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  };

  const observe = () => {
    if (destroyed || !active || !Number.isFinite(media.currentTime)) return null;
    const time = Math.floor(media.currentTime * 1000);
    if (time === lastObservationAt) return session.lastBeat;
    lastObservationAt = time;
    const beat = session.observe({
      mediaTimeMs: time, paused: media.paused, ended: media.ended, playbackRate: media.playbackRate || 1,
      rms: Math.max(0, Math.min(1, Number(sampleRms()) || 0)), cutScore: sampleCut(),
    });
    gateLabel.textContent = beat.gate === 'silence' ? '高潮屏息' : beat.gate === 'wait' ? '余韵缓口' : beat.talkLevel === 'recap' ? '片尾复盘' : beat.gate === 'sparse' ? '倍速少话' : '可以聊';
    panel.dataset.gate = beat.gate;
    return beat;
  };

  const send = async () => {
    const userText = input.value.trim();
    if (!userText || busy || destroyed) return;
    const beat = observe();
    const mediaTimeMs = Math.floor((media.currentTime || 0) * 1000);
    const userMessage = session.addMessage({ role: 'user', speaker: '你', text: userText, mediaTimeMs });
    renderMessage(userMessage);
    input.value = '';
    if (beat?.gate === 'silence' || beat?.gate === 'wait') {
      renderMessage(session.addMessage({ role: 'system', speaker: '时机闸', text: beat.gate === 'silence' ? '高潮段先不抢话。' : '让余韵再停一会儿。', mediaTimeMs }));
      return;
    }
    busy = true;
    try {
      const speakers = chooseSpeakers(session.personas, beat?.type || 'calm');
      abortController = new AbortController();
      const replies = await Promise.allSettled(speakers.map(async (speaker, index) => {
        const role = `companion_${index + 1}`;
        const cfg = await getProviderConfig(role);
        if (!providerReady(cfg)) throw new Error(`${speaker.name}尚未分配 AI 模型`);
        const prompt = session.prompt({ mediaTimeMs, beat, userText, speaker });
        const answer = await chat({ cfg, role, ...prompt, maxTokens: 360, temperature: 0.75, signal: abortController.signal });
        return { speaker, locked: enforceSpoilerLock(answer, mediaTimeMs) };
      }));
      for (const reply of replies) {
        if (reply.status === 'fulfilled') {
          const cited = `↳ 你：“${userText.slice(0, 60)}”\n${reply.value.locked.text}`;
          renderMessage(session.addMessage({ role: 'assistant', speaker: reply.value.speaker.name, text: cited, mediaTimeMs }));
        } else if (reply.reason?.name !== 'AbortError') {
          renderMessage(session.addMessage({ role: 'system', speaker: '陪看', text: `暂时没接上：${reply.reason?.message || reply.reason}`, mediaTimeMs }));
        }
      }
    } catch (error) {
      if (error?.name !== 'AbortError') renderMessage(session.addMessage({ role: 'system', speaker: '陪看', text: `暂时没接上：${error.message || error}`, mediaTimeMs }));
    } finally { busy = false; abortController = null; }
  };

  const timer = setInterval(observe, 1_000);
  panel.querySelector('[data-c=close]').addEventListener('click', () => { panel.hidden = true; });
  panel.querySelector('[data-c=send]').addEventListener('click', send);
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    send();
  });
  observe();
  return {
    get session() { return session; },
    toggle() {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        active = true;
        const estimate = estimateCompanionCost({ durationSeconds: Number.isFinite(media.duration) ? media.duration : 0 });
        statusLabel.textContent = `防剧透锁：开 · 观剧档：开 · 拍点档预计 ${estimate.calls} 次 / ${estimate.tokens} tokens（价格按所选 Provider）`;
        observe();
        input.focus();
      }
    },
    setSource(name, filePath) {
      if (filePath === session.mediaPath) return;
      const previous = session;
      if (active && previous.archiveEnabled && (previous.messages.length || previous.beats.length)) {
        window.mazz?.invoke('companion:archive', previous.archivePayload('beat')).catch(() => null);
      }
      session = new CompanionSession({ mediaName: name, mediaPath: filePath });
      active = false;
      panel.hidden = true;
      priorFrame = null;
      log.replaceChildren();
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      clearInterval(timer);
      abortController?.abort();
      if (active && session.archiveEnabled && (session.messages.length || session.beats.length)) {
        await window.mazz?.invoke('companion:archive', session.archivePayload('beat')).catch(() => null);
      }
      panel.remove();
    },
  };
}
