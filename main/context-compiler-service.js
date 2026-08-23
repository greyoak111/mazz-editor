'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const compiler = require('./foundation/context-compiler');

function slash(value) { return String(value || '').replace(/\\/g, '/'); }
function inside(root, target) { const rel = path.relative(path.resolve(root), path.resolve(target)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }
function hash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

class ContextCompilerService {
  constructor({ rootProvider, eventService = null, fsImpl = fs, now = () => new Date() } = {}) {
    if (typeof rootProvider !== 'function') throw new Error('ContextCompilerService 需要 rootProvider');
    this.rootProvider = rootProvider; this.eventService = eventService; this.fs = fsImpl; this.now = now;
  }
  root() { return path.resolve(String(this.rootProvider() || '')); }
  folder() { return path.join(this.root(), '.mazz', 'context', 'packages'); }
  sourceFromFile(input = {}, index = 0) {
    const root = this.root(); const target = path.resolve(root, String(input.path || ''));
    if (!inside(root, target)) throw new Error(`fileSources[${index}] 越出当前工作区`);
    const stat = this.fs.statSync(target); if (!stat.isFile()) throw new Error(`fileSources[${index}] 不是文件`);
    const body = this.fs.readFileSync(target); const text = body.toString('utf8');
    return {
      sourceRef: input.sourceRef || `file:${slash(path.relative(root, target))}`, kind: input.kind || 'repository-file',
      title: input.title || path.basename(target), topicRef: input.topicRef || '', status: input.status || 'CURRENT',
      authorityRef: input.authorityRef || 'authority:repository', effectiveAt: input.effectiveAt || '', replacementRef: input.replacementRef || '', supersessionReason: input.supersessionReason || '',
      version: input.version || '', mtime: stat.mtime.toISOString(), hash: `sha256:${hash(body)}`,
      // Context size is provider-owned. Keep a caller-supplied estimate only as
      // optional telemetry; never manufacture one from character counts.
      tokenEstimate: input.tokenEstimate ?? null, relevance: Number(input.relevance ?? 0.8), authorityLevel: Number(input.authorityLevel ?? 80),
      summary: input.summary || `${slash(path.relative(root, target))} · ${stat.size} bytes`, excerpt: input.includeExcerpt === true ? text : '',
      sensitivity: input.sensitivity || ['internal'], provenance: { path: slash(target), size: stat.size, producer: 'w85-repository-prototype' }, mandatory: input.mandatory === true,
    };
  }
  compile(request = {}) {
    const sources = [...(request.sources || [])];
    for (let i = 0; i < (request.fileSources || []).length; i++) sources.push(this.sourceFromFile(request.fileSources[i], i));
    if (request.eventQuery && this.eventService) {
      const hits = this.eventService.search(request.eventQuery);
      for (const hit of hits) sources.push({
        sourceRef: `episode:${hit.episodeId}`, kind: 'workspace-event', title: hit.label, topicRef: `query:${request.eventQuery}`,
        status: 'INFERRED', authorityRef: '', version: '', mtime: hit.endedAt, hash: `sha256:${hash(Buffer.from(JSON.stringify(hit)))}`,
        tokenEstimate: null, relevance: Math.min(1, Number(hit.score || 0) / 2), authorityLevel: 0, summary: hit.reasons.join(' · '), excerpt: '', sensitivity: ['internal'],
        provenance: { source: 'W81', eventRefs: hit.eventRefs, authorityGranted: false }, mandatory: false,
      });
    }
    const contextPackage = compiler.compileContextPackage({
      taskId: request.taskId, seatId: request.seatId, checkpointId: request.checkpointId,
      compilerVersion: 'w85-context-compiler/0.1.0', policyVersion: request.policyVersion || 'w85-default/v0',
      budget: request.budget, sources, obligations: request.obligations || [], constraints: request.constraints || [],
      recentDelta: request.recentDelta || [], unknowns: request.unknowns || [], seatPolicy: request.seatPolicy || {}, compiledAt: this.now().toISOString(),
    });
    this.fs.mkdirSync(this.folder(), { recursive: true });
    const file = path.join(this.folder(), `${contextPackage.contextPackageId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
    if (!this.fs.existsSync(file)) this.fs.writeFileSync(file, JSON.stringify(contextPackage, null, 2), 'utf8');
    return { contextPackage, packagePath: slash(file), inspectable: true, rebuildable: true };
  }
  compileForHarness(payload = {}) {
    const request = payload.contextRequest || {};
    return this.compile({
      ...request, taskId: request.taskId || payload.taskRef || `task:harness:${payload.adapterId || 'agent'}`,
      seatId: request.seatId || payload.context?.seatId || `seat:${payload.adapterId || 'agent'}`,
      checkpointId: request.checkpointId || payload.context?.checkpointId || 'checkpoint:spawn',
      constraints: [...(request.constraints || []), 'Context != Plan', 'Memory != State', 'Reasoning != Coverage'],
    }).contextPackage;
  }
  list() {
    if (!this.fs.existsSync(this.folder())) return [];
    return this.fs.readdirSync(this.folder()).filter(name => name.endsWith('.json')).sort().map(name => slash(path.join(this.folder(), name)));
  }
}

module.exports = { ContextCompilerService, inside };
