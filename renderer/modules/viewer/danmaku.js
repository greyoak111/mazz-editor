const EVENT_SCHEMA = 'mazz.danmaku-event/v0';
const MODES = Object.freeze(['scroll', 'top', 'bottom']);
const MAX_EVENTS = 10_000;
const MAX_ACTIVE = 220;
const GLYPH_CACHE_LIMIT = 512;

function stableId(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return `dm:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function decodeXml(text) {
  return String(text || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (all, key) => {
    if (key[0] === '#') {
      const hex = key[1]?.toLowerCase() === 'x';
      const value = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return String.fromCodePoint(value); } catch { return all; }
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[key.toLowerCase()] || all;
  });
}

export function normalizeDanmakuEvent(input, { sourceRef = { kind: 'local', id: 'unknown' }, index = 0 } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`弹幕事件 ${index} 必须是对象`);
  const text = String(input.text || '').trim().slice(0, 500);
  const mediaTimeMs = Math.max(0, Math.floor(Number(input.mediaTimeMs) || 0));
  const mode = String(input.mode || 'scroll');
  if (!text) throw new Error(`弹幕事件 ${index} 文本为空`);
  if (!MODES.includes(mode)) throw new Error(`弹幕事件 ${index} mode 非法`);
  const fontSize = Math.max(12, Math.min(52, Math.round(Number(input.style?.fontSize) || 24)));
  const color = /^#[0-9a-f]{6}$/i.test(input.style?.color || '') ? input.style.color : '#ffffff';
  const moderationState = ['active', 'withdrawn', 'blocked'].includes(input.moderationState) ? input.moderationState : 'active';
  const eventId = String(input.eventId || stableId(`${sourceRef.kind}\n${sourceRef.id}\n${mediaTimeMs}\n${mode}\n${text}\n${index}`));
  return Object.freeze({
    schema: EVENT_SCHEMA, eventId, mediaTimeMs, createdAt: String(input.createdAt || ''), mode, text,
    style: Object.freeze({ color, fontSize, outline: input.style?.outline !== false }),
    priority: Math.max(0, Math.min(100, Math.round(Number(input.priority) || 50))),
    sourceRef: Object.freeze({ kind: String(sourceRef.kind || 'local'), id: String(sourceRef.id || 'unknown') }),
    moderationState, replyTo: String(input.replyTo || ''), regionHint: String(input.regionHint || ''),
    provenance: String(input.provenance || 'local-import'),
  });
}

export function parseBilibiliXml(xml, sourceId = 'local-xml') {
  const events = [];
  for (const [index, match] of [...String(xml || '').matchAll(/<d\b[^>]*\bp=["']([^"']+)["'][^>]*>([\s\S]*?)<\/d>/gi)].entries()) {
    const fields = match[1].split(',');
    const modeNumber = Number(fields[1]);
    const mode = modeNumber === 5 ? 'top' : modeNumber === 4 ? 'bottom' : 'scroll';
    const rgb = Math.max(0, Math.min(0xffffff, Number(fields[3]) || 0xffffff)).toString(16).padStart(6, '0');
    events.push(normalizeDanmakuEvent({
      eventId: fields[7] ? `bili:${fields[7]}` : '', mediaTimeMs: Number(fields[0]) * 1000, mode,
      text: decodeXml(match[2].replace(/<[^>]+>/g, '')), style: { fontSize: Number(fields[2]), color: `#${rgb}` },
      createdAt: fields[4] ? new Date(Number(fields[4]) * 1000).toISOString() : '', priority: 50,
    }, { sourceRef: { kind: 'bilibili-xml', id: sourceId }, index }));
    if (events.length >= MAX_EVENTS) break;
  }
  return events;
}

function assTime(value) {
  const match = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.](\d{1,2}))?$/.exec(String(value || '').trim());
  return match ? ((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 + Number(match[4] || 0) * 10) : 0;
}

export function parseAssDanmaku(ass, sourceId = 'local-ass') {
  const events = [];
  for (const [index, line] of String(ass || '').split(/\r?\n/).entries()) {
    if (!/^Dialogue:/i.test(line)) continue;
    const fields = line.slice(line.indexOf(':') + 1).split(',');
    if (fields.length < 10) continue;
    const rawText = fields.slice(9).join(',');
    const alignment = /\\an(\d)/i.exec(rawText)?.[1] || '';
    const mode = ['7', '8', '9'].includes(alignment) ? 'top' : ['1', '2', '3'].includes(alignment) ? 'bottom' : 'scroll';
    const text = rawText.replace(/\{[^}]*\}/g, '').replace(/\\N/gi, ' ').trim();
    if (!text) continue;
    events.push(normalizeDanmakuEvent({ mediaTimeMs: assTime(fields[1]), mode, text, priority: 50 }, {
      sourceRef: { kind: 'ass-local-track', id: sourceId }, index,
    }));
    if (events.length >= MAX_EVENTS) break;
  }
  return events;
}

export function parseJsonTrack(text, sourceId = 'local-json', sourceKind = 'json-local-track') {
  const value = typeof text === 'string' ? JSON.parse(text) : text;
  const rows = Array.isArray(value) ? value : value?.events;
  if (!Array.isArray(rows)) throw new Error('JSON 弹幕轨必须是数组或 {events:[]}');
  return rows.slice(0, MAX_EVENTS).map((row, index) => normalizeDanmakuEvent(row, { sourceRef: { kind: sourceKind, id: sourceId }, index }));
}

export function lowerBound(events, mediaTimeMs) {
  let low = 0, high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (events[middle].mediaTimeMs < mediaTimeMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class DanmakuTimeline {
  constructor(events = []) { this.replace(events); }
  replace(events) {
    const byId = new Map();
    for (const event of events.slice(0, MAX_EVENTS)) byId.set(event.eventId, event);
    this.events = [...byId.values()].sort((a, b) => a.mediaTimeMs - b.mediaTimeMs || a.eventId.localeCompare(b.eventId));
  }
  insert(events) { this.replace([...this.events, ...events]); }
  at(mediaTimeMs) { return lowerBound(this.events, mediaTimeMs); }
  withdraw(eventId) {
    this.events = this.events.map(event => event.eventId === eventId ? Object.freeze({ ...event, moderationState: 'withdrawn' }) : event);
  }
}

function overlaps(left, right, gap = 18) {
  return left.x < right.x + right.width + gap && left.x + left.width + gap > right.x;
}

export class LaneAllocator {
  constructor({ laneHeight = 34 } = {}) { this.laneHeight = laneHeight; }
  allocate(candidate, active, viewport) {
    const laneCount = Math.max(1, Math.floor(viewport.height / this.laneHeight));
    const start = candidate.event.mode === 'bottom' ? laneCount - 1 : 0;
    const direction = candidate.event.mode === 'bottom' ? -1 : 1;
    for (let offset = 0; offset < laneCount; offset += 1) {
      const lane = start + offset * direction;
      const box = { ...candidate, lane, x: candidate.event.mode === 'scroll' ? viewport.width : (viewport.width - candidate.width) / 2 };
      const collision = active.some(item => item.event.mode === candidate.event.mode && item.lane === lane && overlaps(box, item));
      if (!collision) return box;
    }
    return null;
  }
}

export class DanmakuScheduler {
  constructor({ events = [], durationMs = 8_000, maxActive = MAX_ACTIVE, allocator = new LaneAllocator() } = {}) {
    this.timeline = new DanmakuTimeline(events);
    this.durationMs = durationMs;
    this.maxActive = maxActive;
    this.allocator = allocator;
    this.active = [];
    this.cursor = 0;
    this.lastMediaTimeMs = -1;
    this.filters = { words: [], sources: [], minPriority: 0 };
    this.dropped = 0;
  }
  seek(mediaTimeMs) { this.active = []; this.cursor = this.timeline.at(Math.max(0, mediaTimeMs - 100)); this.lastMediaTimeMs = mediaTimeMs; }
  setFilters(filters = {}) { this.filters = { words: filters.words || [], sources: filters.sources || [], minPriority: Number(filters.minPriority) || 0 }; }
  withdraw(eventId) { this.timeline.withdraw(eventId); this.active = this.active.filter(item => item.event.eventId !== eventId); }
  allowed(event) {
    if (event.moderationState !== 'active' || event.priority < this.filters.minPriority) return false;
    if (this.filters.sources.length && !this.filters.sources.includes(event.sourceRef.kind)) return false;
    return !this.filters.words.some(word => event.text.toLowerCase().includes(String(word).toLowerCase()));
  }
  tick(mediaTimeMs, viewport = { width: 1280, height: 720 }, measure = text => text.length * 24) {
    const time = Math.max(0, Number(mediaTimeMs) || 0);
    if (this.lastMediaTimeMs < 0 || time < this.lastMediaTimeMs || time - this.lastMediaTimeMs > 2_000) this.seek(time);
    this.active = this.active.filter(item => time - item.startMediaTimeMs <= item.durationMs && this.allowed(item.event));
    for (const item of this.active) {
      const progress = Math.max(0, Math.min(1, (time - item.startMediaTimeMs) / item.durationMs));
      item.x = item.event.mode === 'scroll' ? viewport.width - progress * (viewport.width + item.width) : (viewport.width - item.width) / 2;
    }
    while (this.cursor < this.timeline.events.length && this.timeline.events[this.cursor].mediaTimeMs <= time + 50) {
      const event = this.timeline.events[this.cursor++];
      if (event.mediaTimeMs < time - 250 || !this.allowed(event)) continue;
      if (this.active.length >= this.maxActive) { this.dropped += 1; continue; }
      const width = Math.max(20, measure(event.text, event.style));
      const allocated = this.allocator.allocate({ event, width, startMediaTimeMs: event.mediaTimeMs, durationMs: this.durationMs }, this.active, viewport);
      if (allocated) this.active.push(allocated); else this.dropped += 1;
    }
    this.lastMediaTimeMs = time;
    return this.active;
  }
  snapshot() { return { eventCount: this.timeline.events.length, activeCount: this.active.length, cursor: this.cursor, dropped: this.dropped }; }
  clear() { this.active = []; this.timeline.replace([]); this.cursor = 0; this.lastMediaTimeMs = -1; this.dropped = 0; }
}

export function mountDanmaku({ root, media }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'mz-danmaku-canvas';
  canvas.hidden = true;
  const accessibility = document.createElement('div');
  accessibility.className = 'mz-danmaku-a11y';
  accessibility.setAttribute('aria-live', 'polite');
  root.querySelector('.mz-stage')?.append(canvas, accessibility);
  const context = canvas.getContext('2d');
  const scheduler = new DanmakuScheduler();
  const glyphCache = new Map();
  let enabled = false;
  let destroyed = false;
  let raf = null;
  let maskRegions = [];

  const resize = () => {
    const rect = root.getBoundingClientRect();
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    scheduler.seek((media.currentTime || 0) * 1000);
  };

  const measure = (text, style) => {
    const key = `${style.fontSize}:${text}`;
    if (glyphCache.has(key)) return glyphCache.get(key);
    context.font = `600 ${style.fontSize}px system-ui,sans-serif`;
    const width = context.measureText(text).width;
    glyphCache.set(key, width);
    if (glyphCache.size > GLYPH_CACHE_LIMIT) glyphCache.delete(glyphCache.keys().next().value);
    return width;
  };

  const frame = () => {
    raf = null;
    if (destroyed || !enabled) return;
    const width = parseFloat(canvas.style.width) || root.clientWidth || 1;
    const height = parseFloat(canvas.style.height) || root.clientHeight || 1;
    context.clearRect(0, 0, width, height);
    const active = scheduler.tick((media.currentTime || 0) * 1000, { width, height }, measure);
    let masked = false;
    let maskContextSaved = false;
    if (maskRegions.length) {
      try {
        context.save();
        maskContextSaved = true;
        context.beginPath();
        context.rect(0, 0, width, height);
        for (const region of maskRegions) context.rect(region.x * width, region.y * height, region.width * width, region.height * height);
        context.clip('evenodd');
        masked = true;
      } catch { if (maskContextSaved) context.restore(); masked = false; maskContextSaved = false; }
    }
    for (const item of active) {
      const y = (item.lane + 1) * scheduler.allocator.laneHeight;
      context.font = `600 ${item.event.style.fontSize}px system-ui,sans-serif`;
      context.textBaseline = 'middle';
      if (item.event.style.outline) { context.lineWidth = 3; context.strokeStyle = '#000c'; context.strokeText(item.event.text, item.x, y); }
      context.fillStyle = item.event.style.color;
      context.fillText(item.event.text, item.x, y);
    }
    if (masked) context.restore();
    accessibility.textContent = active.slice(-20).map(item => item.event.text).join('；');
    raf = requestAnimationFrame(frame);
  };

  const start = () => { if (enabled && raf == null) raf = requestAnimationFrame(frame); };
  const onSeek = () => scheduler.seek((media.currentTime || 0) * 1000);
  const onVisibility = () => { if (document.hidden && raf != null) { cancelAnimationFrame(raf); raf = null; } else start(); };
  const onContextLost = event => { event.preventDefault(); if (raf != null) cancelAnimationFrame(raf); raf = null; };
  const onContextRestored = () => { resize(); start(); };
  media.addEventListener('seeking', onSeek);
  media.addEventListener('ratechange', onSeek);
  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', resize);
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('contextlost', onContextLost);
  canvas.addEventListener('contextrestored', onContextRestored);
  resize();

  return {
    scheduler,
    load(events) { scheduler.timeline.replace(events); scheduler.seek((media.currentTime || 0) * 1000); },
    addAiTrack(events, trackId = 'local-ai-track') {
      scheduler.timeline.insert(events.map((event, index) => normalizeDanmakuEvent(event, { sourceRef: { kind: 'ai-comment-local', id: trackId }, index })));
    },
    setMaskRegions(regions = []) {
      maskRegions = regions.slice(0, 16).map(region => ({
        x: Math.max(0, Math.min(1, Number(region.x) || 0)), y: Math.max(0, Math.min(1, Number(region.y) || 0)),
        width: Math.max(0, Math.min(1, Number(region.width) || 0)), height: Math.max(0, Math.min(1, Number(region.height) || 0)),
      })).filter(region => region.width > 0 && region.height > 0);
      return maskRegions.length;
    },
    withdraw(eventId) { scheduler.withdraw(eventId); },
    toggle(force) { enabled = force == null ? !enabled : !!force; canvas.hidden = !enabled; if (enabled) start(); else if (raf != null) { cancelAnimationFrame(raf); raf = null; } return enabled; },
    snapshot() { return { ...scheduler.snapshot(), enabled, glyphCacheSize: glyphCache.size, maskRegionCount: maskRegions.length, surfaceCount: canvas.isConnected ? 1 : 0 }; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf != null) cancelAnimationFrame(raf);
      raf = null;
      media.removeEventListener('seeking', onSeek);
      media.removeEventListener('ratechange', onSeek);
      window.removeEventListener('resize', resize);
      document.removeEventListener('fullscreenchange', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('contextlost', onContextLost);
      canvas.removeEventListener('contextrestored', onContextRestored);
      scheduler.clear();
      glyphCache.clear();
      maskRegions = [];
      accessibility.remove();
      canvas.remove();
    },
  };
}

export { EVENT_SCHEMA, GLYPH_CACHE_LIMIT, MAX_ACTIVE, MAX_EVENTS, MODES };
