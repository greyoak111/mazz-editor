'use strict';

// W62e：持续投喂控制面。W74b 仍负责变化检测、聚类、投喂包与人工裁决；
// 本模块只治理来源、调度、监听、健康和“是否允许进入待启动队列”的权限边界。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SearxService = require('./searx');

const SOURCE_SCHEMA = 'mazz.continuous-feed-source/v0';
const STATE_SCHEMA = 'mazz.continuous-feed-state/v0';
const SOURCE_KINDS = Object.freeze(['subscription', 'search', 'local']);
const AUTOMATION_LEVELS = Object.freeze(['approval', 'ingest', 'queue']);
const SOURCE_KEYS = new Set([
  'schema', 'sourceId', 'projectId', 'projectPath', 'kind', 'label', 'location', 'query',
  'dimension', 'automation', 'intervalMinutes', 'enabled', 'factoryQueueAuthorized', 'createdAt', 'updatedAt',
]);
const SECRET_KEY = /(?:password|passwd|secret|token|api[-_]?key|authorization|cookie)/i;
const sha256 = value => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
const slash = value => String(value || '').replace(/\\/g, '/');

function feedControlPaths(projectPath) {
  const root = path.join(path.resolve(projectPath), '.mazz', 'feed-sources');
  return { root, sources: path.join(root, 'sources.json'), state: path.join(root, 'state.json'), queue: path.join(root, 'factory-queue.ndjson') };
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function requireText(value, label, max = 500) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} 必填`);
  if (text.length > max) throw new Error(`${label} 超过 ${max} 字符`);
  return text;
}

function normalizeSource(input, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('持续投喂来源必须是对象');
  for (const key of Object.keys(input)) {
    if (!SOURCE_KEYS.has(key)) throw new Error(`持续投喂来源包含未冻结字段：${key}`);
    if (SECRET_KEY.test(key)) throw new Error(`持续投喂来源禁止 secret 字段：${key}`);
  }
  if (input.schema != null && input.schema !== SOURCE_SCHEMA) throw new Error(`不支持的来源 schema：${input.schema}`);
  const projectPath = path.resolve(requireText(input.projectPath, 'projectPath', 2_000));
  const projectId = requireText(input.projectId, 'projectId', 200);
  const kind = requireText(input.kind, 'kind', 30);
  if (!SOURCE_KINDS.includes(kind)) throw new Error(`非法来源类型：${kind}`);
  const automation = String(input.automation || 'approval').trim();
  if (!AUTOMATION_LEVELS.includes(automation)) throw new Error(`非法自动化等级：${automation}`);
  const intervalMinutes = input.intervalMinutes == null ? 60 : Number(input.intervalMinutes);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 10_080) {
    throw new Error('intervalMinutes 必须是 5–10080 的整数');
  }
  const dimension = requireText(input.dimension, 'dimension', 120);
  let location = String(input.location || '').trim();
  let query = String(input.query || '').trim();
  if (kind === 'local') {
    if (!location) throw new Error('local 来源必须提供 location');
    const resolved = path.resolve(location);
    const relative = path.relative(projectPath, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('local 来源必须位于当前项目内');
    location = resolved;
  } else if (kind === 'subscription') {
    const url = new URL(requireText(location, 'location', 2_000));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('订阅来源必须是 HTTP/HTTPS URL');
    url.username = '';
    url.password = '';
    location = url.toString();
  } else {
    query = requireText(query, 'query', 300);
    location = '';
  }
  if (automation === 'queue' && input.factoryQueueAuthorized !== true) {
    throw new Error('queue 等级必须由用户显式授予 factoryQueueAuthorized');
  }
  const timestamp = now();
  const sourceId = String(input.sourceId || `feed:${sha256(`${projectId}\n${kind}\n${location || query}\n${dimension}`).slice(0, 20)}`).trim();
  if (!/^feed:[a-z0-9._:-]{3,120}$/i.test(sourceId)) throw new Error('sourceId 必须使用 feed: 前缀且只含安全字符');
  return Object.freeze({
    schema: SOURCE_SCHEMA, sourceId, projectId, projectPath, kind,
    label: String(input.label || query || path.basename(location) || sourceId).trim().slice(0, 160),
    location, query, dimension, automation, intervalMinutes,
    enabled: input.enabled !== false,
    factoryQueueAuthorized: automation === 'queue' && input.factoryQueueAuthorized === true,
    createdAt: input.createdAt || timestamp, updatedAt: timestamp,
  });
}

function decodeXml(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, key) => {
    if (key[0] === '#') {
      const hex = key[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : all; } catch { return all; }
    }
    return named[key.toLowerCase()] ?? all;
  });
}

function xmlText(block, names) {
  for (const name of names) {
    const match = new RegExp(`<(?:[a-z]+:)?${name}\\b[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/(?:[a-z]+:)?${name}\\s*>`, 'i').exec(block);
    if (match) return decodeXml(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return '';
}

function parseSyndication(xml, baseUrl, observedAt) {
  const source = String(xml || '').slice(0, 2_000_000);
  const blocks = source.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)\s*>/gi) || [];
  return blocks.slice(0, 200).map((block, index) => {
    const title = xmlText(block, ['title']) || `订阅条目 ${index + 1}`;
    let link = xmlText(block, ['link']);
    if (!link) link = /<link\b[^>]*href=["']([^"']+)["']/i.exec(block)?.[1] || '';
    try { link = new URL(decodeXml(link), baseUrl).toString(); } catch { link = ''; }
    const rawDate = xmlText(block, ['published', 'updated', 'pubDate', 'date']);
    const dateMs = Date.parse(rawDate);
    const guid = xmlText(block, ['guid', 'id']);
    return {
      itemId: guid || link || `entry:${sha256(`${title}\n${index}`).slice(0, 24)}`,
      title: title.slice(0, 500), url: link,
      publishedAt: Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : observedAt,
      summary: xmlText(block, ['summary', 'description', 'content']).slice(0, 2_000),
      canonicalKey: guid || link,
    };
  });
}

function localItems(source, observedAt) {
  const stat = fs.statSync(source.location);
  const paths = stat.isDirectory()
    ? fs.readdirSync(source.location, { withFileTypes: true }).filter(entry => entry.isFile()).slice(0, 200).map(entry => path.join(source.location, entry.name))
    : [source.location];
  return paths.map(filePath => {
    const fileStat = fs.statSync(filePath);
    const relative = slash(path.relative(source.projectPath, filePath));
    return {
      itemId: `local:${relative}`, title: path.basename(filePath), url: '',
      publishedAt: fileStat.mtime.toISOString(),
      summary: `${relative} · ${fileStat.size} bytes`, canonicalKey: `local:${relative}`,
    };
  });
}

class ContinuousFeedService {
  constructor({ feedPipeline, searxService = null, resourceLedger = null, fetchSubscription = null, now = () => new Date().toISOString() } = {}) {
    if (!feedPipeline) throw new Error('ContinuousFeedService 需要 FeedPipeline');
    this.feedPipeline = feedPipeline;
    this.searxService = searxService;
    this.resourceLedger = resourceLedger;
    this.fetchSubscription = fetchSubscription || (async url => {
      // 使用现有带 SSRF 防护、重定向复检、2MB 上限的抓取器；测试可注入确定性适配器。
      const article = await SearxService.fetchSyndication(url);
      return article.body;
    });
    this.now = now;
    this.timers = new Map();
    this.watchers = new Map();
    this.running = new Map();
  }

  _catalog(projectPath) {
    const paths = feedControlPaths(projectPath);
    const value = readJson(paths.sources, { schema: 'mazz.continuous-feed-catalog/v0', sources: [] });
    return { paths, value: { schema: 'mazz.continuous-feed-catalog/v0', sources: Array.isArray(value.sources) ? value.sources : [] } };
  }

  register(input) {
    const source = normalizeSource(input, { now: this.now });
    const { paths, value } = this._catalog(source.projectPath);
    const existing = value.sources.find(item => item.sourceId === source.sourceId);
    const next = { ...source, createdAt: existing?.createdAt || source.createdAt };
    value.sources = [...value.sources.filter(item => item.sourceId !== next.sourceId), next].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    atomicWrite(paths.sources, value);
    this._syncRuntime(next);
    return next;
  }

  remove({ projectPath, sourceId }) {
    const { paths, value } = this._catalog(projectPath);
    const count = value.sources.length;
    value.sources = value.sources.filter(item => item.sourceId !== sourceId);
    atomicWrite(paths.sources, value);
    this.stop(sourceId, 'source-removed');
    return { ok: true, removed: value.sources.length !== count };
  }

  list(projectPath) {
    const { paths, value } = this._catalog(projectPath);
    const state = readJson(paths.state, { schema: STATE_SCHEMA, sources: {} });
    return { ...value, states: state.sources || {}, runtime: this.health() };
  }

  _loadSource(projectPath, sourceId) {
    const source = this._catalog(projectPath).value.sources.find(item => item.sourceId === sourceId);
    if (!source) throw new Error(`持续投喂来源不存在：${sourceId}`);
    return normalizeSource(source, { now: () => source.updatedAt });
  }

  async _items(source, observedAt) {
    if (source.kind === 'local') return localItems(source, observedAt);
    if (source.kind === 'subscription') return parseSyndication(await this.fetchSubscription(source.location), source.location, observedAt);
    if (!this.searxService) throw new Error('SearXNG 搜索服务尚未就绪');
    const result = await this.searxService.search({ query: source.query, pageno: 1 });
    if (!result?.ok) throw new Error(result?.error || '搜索来源失败');
    return (result.results || []).slice(0, 200).map((item, index) => ({
      itemId: item.url || `search:${sha256(`${source.query}\n${item.title}\n${index}`).slice(0, 24)}`,
      title: item.title || '未命名搜索结果', url: item.url || '', publishedAt: observedAt,
      summary: String(item.content || '').slice(0, 2_000), canonicalKey: item.url || '',
    }));
  }

  _writeState(source, patch) {
    const { paths } = this._catalog(source.projectPath);
    const state = readJson(paths.state, { schema: STATE_SCHEMA, sources: {} });
    state.schema = STATE_SCHEMA;
    state.sources = state.sources || {};
    state.sources[source.sourceId] = { ...(state.sources[source.sourceId] || {}), ...patch };
    atomicWrite(paths.state, state);
  }

  async run({ projectPath, sourceId, trigger = 'manual' }) {
    if (this.running.has(sourceId)) return this.running.get(sourceId);
    const source = this._loadSource(projectPath, sourceId);
    const task = (async () => {
      const observedAt = this.now();
      try {
        const items = await this._items(source, observedAt);
        const result = await this.feedPipeline.scan({
          schema: 'mazz.feed-scan-request/v0', projectId: source.projectId, projectPath: source.projectPath,
          query: source.query || source.label, dimension: source.dimension,
          mode: source.automation === 'approval' ? 'approval' : source.automation === 'ingest' ? 'semi' : 'full',
          windowHours: 24, observedAt,
          sourceBatches: [{ sourceId: source.sourceId, sourceType: source.kind, items }],
        });
        let queueReceipt = null;
        if (source.automation === 'queue' && source.factoryQueueAuthorized && result.package) {
          const record = {
            schema: 'mazz.factory-feed-queue-request/v0', requestId: `ffq:${sha256(`${source.sourceId}\n${result.package.packageId}`).slice(0, 24)}`,
            sourceId: source.sourceId, packageId: result.package.packageId, projectId: source.projectId,
            dimension: source.dimension, createdAt: observedAt, status: 'awaiting-factory-dispatch',
            authority: 'human:source-factory-queue-authorization', automaticAiInvocation: false,
          };
          const paths = feedControlPaths(source.projectPath);
          fs.mkdirSync(paths.root, { recursive: true });
          fs.appendFileSync(paths.queue, `${JSON.stringify(record)}\n`, 'utf8');
          queueReceipt = record;
        }
        this._writeState(source, { ok: true, lastRunAt: observedAt, lastTrigger: trigger, itemCount: items.length, lastCode: result.code, lastError: '', consecutiveFailures: 0 });
        return { ...result, source, queueReceipt };
      } catch (error) {
        const previous = this.list(source.projectPath).states[source.sourceId] || {};
        this._writeState(source, { ok: false, lastRunAt: observedAt, lastTrigger: trigger, lastError: String(error.message || error).slice(0, 500), consecutiveFailures: Number(previous.consecutiveFailures || 0) + 1 });
        throw error;
      }
    })().finally(() => this.running.delete(sourceId));
    this.running.set(sourceId, task);
    return task;
  }

  _syncRuntime(source) {
    this.stop(source.sourceId, 'source-reconfigured');
    if (!source.enabled) return;
    const timer = setInterval(() => this.run({ projectPath: source.projectPath, sourceId: source.sourceId, trigger: 'schedule' }).catch(() => {}), source.intervalMinutes * 60_000);
    timer.unref?.();
    const timerKey = this.resourceLedger?.register({ type: 'feed-timer', id: source.sourceId, owner: 'continuous-feed', meta: { intervalMinutes: source.intervalMinutes } });
    this.timers.set(source.sourceId, { timer, ledgerKey: timerKey });
    if (source.kind === 'local') {
      const watcher = fs.watch(source.location, { persistent: false }, () => {
        clearTimeout(this.watchers.get(source.sourceId)?.debounce);
        const debounce = setTimeout(() => this.run({ projectPath: source.projectPath, sourceId: source.sourceId, trigger: 'local-watch' }).catch(() => {}), 750);
        debounce.unref?.();
        const record = this.watchers.get(source.sourceId);
        if (record) record.debounce = debounce;
      });
      const ledgerKey = this.resourceLedger?.register({ type: 'feed-watcher', id: source.sourceId, owner: 'continuous-feed', meta: { location: source.location } });
      this.watchers.set(source.sourceId, { watcher, debounce: null, ledgerKey });
    }
  }

  startAll(projectPath) {
    const sources = this._catalog(projectPath).value.sources;
    for (const source of sources) this._syncRuntime(normalizeSource(source, { now: () => source.updatedAt }));
    return this.health();
  }

  stop(sourceId, reason = 'stopped') {
    const timer = this.timers.get(sourceId);
    if (timer) {
      clearInterval(timer.timer);
      if (timer.ledgerKey) this.resourceLedger?.release(timer.ledgerKey, { reason });
      this.timers.delete(sourceId);
    }
    const watch = this.watchers.get(sourceId);
    if (watch) {
      clearTimeout(watch.debounce);
      watch.watcher.close();
      if (watch.ledgerKey) this.resourceLedger?.release(watch.ledgerKey, { reason });
      this.watchers.delete(sourceId);
    }
  }

  health() {
    return {
      schema: 'mazz.continuous-feed-health/v0', scheduledSources: [...this.timers.keys()].sort(),
      watchedSources: [...this.watchers.keys()].sort(), runningSources: [...this.running.keys()].sort(),
    };
  }

  dispose(reason = 'disposed') {
    for (const sourceId of new Set([...this.timers.keys(), ...this.watchers.keys()])) this.stop(sourceId, reason);
  }
}

module.exports = {
  AUTOMATION_LEVELS, ContinuousFeedService, SOURCE_KINDS, SOURCE_SCHEMA,
  feedControlPaths, localItems, normalizeSource, parseSyndication,
};
