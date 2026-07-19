// renderer/core/events.js —— 极简事件发射器
export class Emitter {
  constructor() { this.map = new Map(); }
  on(evt, cb) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(cb);
    return () => this.map.get(evt)?.delete(cb);
  }
  emit(evt, ...args) {
    for (const cb of [...(this.map.get(evt) || [])]) {
      try { cb(...args); } catch (e) { console.error(`[events] ${evt}:`, e); }
    }
  }
}
export const bus = new Emitter();
