'use strict';

const DEFAULT_BUDGETS = Object.freeze({
  totalWorkingSetBytes: 1536 * 1024 * 1024,
  mainRssBytes: 512 * 1024 * 1024,
  processWorkingSetBytes: 768 * 1024 * 1024,
  resourceCaps: Object.freeze({
    'web-contents-view': 24, 'panel-window': 24, pty: 16, 'torrent-client': 1,
    'torrent-server': 1,
    'debug-process': 8, 'python-process': 4, 'agent-session': 8,
    'agent-cli-process': 8, 'external-tool-process': 4, 'archive-job': 2,
    'feed-watcher': 64, 'feed-timer': 64,
  }),
});

function finite(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; }
function processType(metric) { return String(metric?.type || metric?.name || 'unknown').toLowerCase(); }
function workingSetBytes(metric) { return finite(metric?.memory?.workingSetSize) * 1024; }

class MemoryGovernor {
  constructor({
    resourceLedger,
    processMemory = () => process.memoryUsage(),
    appMetrics = () => [],
    now = () => Date.now(),
    setTimer = setInterval,
    clearTimer = clearInterval,
    sampleIntervalMs = 5000,
    historyLimit = 120,
    budgets = DEFAULT_BUDGETS,
    onPressure = () => {},
  } = {}) {
    this.resourceLedger = resourceLedger;
    this.processMemory = processMemory;
    this.appMetrics = appMetrics;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.sampleIntervalMs = Math.max(1000, finite(sampleIntervalMs) || 5000);
    this.historyLimit = Math.max(12, finite(historyLimit) || 120);
    this.budgets = budgets;
    this.onPressure = onPressure;
    this.history = [];
    this.timer = null;
    this.lastState = 'NORMAL';
    this.expectedTickAt = 0;
  }

  start() {
    if (this.timer) return false;
    this.sample();
    this.expectedTickAt = this.now() + this.sampleIntervalMs;
    this.timer = this.setTimer(() => {
      const at = this.now();
      const lagMs = Math.max(0, at - this.expectedTickAt);
      this.expectedTickAt = at + this.sampleIntervalMs;
      this.sample({ lagMs });
    }, this.sampleIntervalMs);
    this.timer?.unref?.();
    return true;
  }

  stop() {
    if (!this.timer) return false;
    this.clearTimer(this.timer);
    this.timer = null;
    return true;
  }

  sample({ lagMs = 0 } = {}) {
    const memory = this.processMemory() || {};
    const metrics = (this.appMetrics() || []).map(metric => ({
      pid: finite(metric?.pid), type: processType(metric), workingSetBytes: workingSetBytes(metric),
    }));
    const resource = this.resourceLedger?.snapshot?.() || { activeCount: 0, byType: {} };
    const totalWorkingSetBytes = metrics.reduce((sum, metric) => sum + metric.workingSetBytes, 0) || finite(memory.rss);
    const violations = [];
    if (totalWorkingSetBytes > this.budgets.totalWorkingSetBytes) violations.push({ kind: 'total-working-set', value: totalWorkingSetBytes, limit: this.budgets.totalWorkingSetBytes });
    if (finite(memory.rss) > this.budgets.mainRssBytes) violations.push({ kind: 'main-rss', value: finite(memory.rss), limit: this.budgets.mainRssBytes });
    for (const metric of metrics) if (metric.workingSetBytes > this.budgets.processWorkingSetBytes) violations.push({ kind: 'process-working-set', processType: metric.type, pid: metric.pid, value: metric.workingSetBytes, limit: this.budgets.processWorkingSetBytes });
    for (const [type, count] of Object.entries(resource.byType || {})) {
      const cap = this.budgets.resourceCaps?.[type];
      if (cap != null && count > cap) violations.push({ kind: 'resource-cap', resourceType: type, value: count, limit: cap });
    }
    const state = violations.length ? (violations.some(v => v.value > v.limit * 1.25) ? 'CRITICAL' : 'WARN') : 'NORMAL';
    const row = Object.freeze({
      capturedAt: this.now(), state, main: {
        rssBytes: finite(memory.rss), heapTotalBytes: finite(memory.heapTotal), heapUsedBytes: finite(memory.heapUsed), externalBytes: finite(memory.external), arrayBuffersBytes: finite(memory.arrayBuffers),
      },
      totalWorkingSetBytes, processes: metrics, eventLoopLagMs: finite(lagMs),
      resources: { activeCount: resource.activeCount || 0, byType: { ...(resource.byType || {}) } }, violations,
    });
    this.history.push(row);
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    if (state !== this.lastState) {
      this.lastState = state;
      try { this.onPressure(row); } catch {}
    }
    return row;
  }

  summary({ includeHistory = false } = {}) {
    const current = this.history.at(-1) || this.sample();
    const base = this.history.length > 1 ? this.history[0] : current;
    const delta = {
      rssBytes: current.main.rssBytes - base.main.rssBytes,
      totalWorkingSetBytes: current.totalWorkingSetBytes - base.totalWorkingSetBytes,
      activeResources: current.resources.activeCount - base.resources.activeCount,
      elapsedMs: current.capturedAt - base.capturedAt,
    };
    const samples = this.history.slice(-12);
    const slopeBytesPerMinute = samples.length > 1
      ? (samples.at(-1).totalWorkingSetBytes - samples[0].totalWorkingSetBytes) / Math.max(1, samples.at(-1).capturedAt - samples[0].capturedAt) * 60000
      : 0;
    return {
      schema: 'mazz.memory-governor/v0', current, delta,
      trend: { sampleCount: samples.length, workingSetBytesPerMinute: Math.round(slopeBytesPerMinute) },
      budgets: this.budgets,
      ...(includeHistory ? { history: [...this.history] } : {}),
    };
  }

  resetBaseline() { this.history = []; return this.sample(); }
}

module.exports = { MemoryGovernor, DEFAULT_BUDGETS, workingSetBytes };
