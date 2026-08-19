'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cognition = require('./foundation/cognition-protocol');

function slash(value) { return String(value || '').replace(/\\/g, '/'); }
function inside(root, target) { const rel = path.relative(path.resolve(root), path.resolve(target)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }
function safeName(value) { return String(value || '认知资产').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 80) || '认知资产'; }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

class CognitionService {
  constructor({ rootProvider, evidenceService, eventService = null, fsImpl = fs, now = () => new Date(), idFactory = () => crypto.randomUUID() } = {}) {
    if (typeof rootProvider !== 'function' || !evidenceService) throw new Error('CognitionService 依赖 rootProvider/evidenceService');
    this.rootProvider = rootProvider; this.evidenceService = evidenceService; this.eventService = eventService; this.fs = fsImpl; this.now = now; this.idFactory = idFactory;
  }
  root() { return path.resolve(String(this.rootProvider() || '')); }
  folder() { return path.join(this.root(), '认知资产'); }
  target(filePath) { const target = path.resolve(this.root(), String(filePath || '')); if (!inside(this.root(), target) || path.extname(target).toLowerCase() !== '.md') throw new Error('Cognition 文件必须是当前 Workspace 内 Markdown'); return target; }
  writeAtomic(file, content) {
    this.fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.mazztmp`;
    this.fs.writeFileSync(temp, content, 'utf8'); this.fs.renameSync(temp, file);
  }
  sourceRefs(inputs = []) {
    const scan = this.evidenceService.scan({ force: true }); const assets = new Map(scan.documents.map(item => [item.assetId, item]));
    return inputs.map((input, index) => {
      const ref = String(input?.ref || '').trim(); let health = String(input?.health || 'UNKNOWN').toUpperCase(); let digestValue = String(input?.hash || '');
      if (ref.startsWith('asset:')) { const asset = assets.get(ref); health = asset ? 'HEALTHY' : 'MISSING'; digestValue = asset ? `sha256:${asset.fingerprint}` : digestValue; }
      return cognition.normalizeSourceRef({ ...input, ref, health, hash: digestValue, observedAt: input?.observedAt || this.now().toISOString(), provenance: { ...(input?.provenance || {}), resolver: 'w70-source-health' } }, index);
    });
  }
  create({ title, type, body = '', sourceRefs = [], actorType = 'human', maturity = 'SEED', validity = 'UNKNOWN', implementation = 'NOT_APPLICABLE' } = {}) {
    const identityKey = this.idFactory(); const at = this.now().toISOString();
    const approved = actorType === 'human';
    const item = cognition.normalizeCognitionItem({
      identityKey, type, title, sourceRefs: this.sourceRefs(sourceRefs), maturity, validity, implementation,
      lifecycle: 'ACTIVE', authorityState: approved ? 'HUMAN_APPROVED' : 'CANDIDATE', authorityRef: approved ? 'human:local-user' : '',
      supersedes: [], supersededBy: '', createdAt: at, updatedAt: at,
      provenance: { producer: actorType, fileFirst: true, aiMayWriteCandidate: true, automaticApproval: false },
    });
    const relative = slash(path.join('认知资产', `${safeName(title)}-${item.cognitionId.slice(-8)}.md`)); const target = this.target(relative);
    this.writeAtomic(target, cognition.serializeCognitionMarkdown(item, body));
    this.eventService?.capture({ idempotencyKey: `cognition:create:${item.cognitionId}`, occurredAt: at, actorType: approved ? 'human' : 'agent', sourceModule: 'cognition', action: 'create', subjectRefs: [item.cognitionId], objectRefs: [`file:${slash(target)}`], contextRefs: ['module:cognition'], outcome: 'success', provenance: { producer: 'w70' }, privacyClass: 'operational', retentionClass: '1y', summary: `创建认知资产 · ${item.type} · ${item.title}` });
    return { item, path: slash(target) };
  }
  read(filePath) { const target = this.target(filePath); const parsed = cognition.parseCognitionMarkdown(this.fs.readFileSync(target, 'utf8')); return { ...parsed, path: slash(target), contentHash: `sha256:${hash(Buffer.from(this.fs.readFileSync(target)))}` }; }
  list() {
    if (!this.fs.existsSync(this.folder())) return [];
    const rows = [];
    const walk = dir => {
      for (const entry of this.fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const target = path.join(dir, entry.name); if (entry.isDirectory()) walk(target); else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          try { rows.push(this.read(target)); } catch (error) { rows.push({ path: slash(target), invalid: true, error: error.message }); }
        }
        if (rows.length >= 5000) return;
      }
    };
    walk(this.folder()); return rows.sort((a, b) => String(b.item?.updatedAt || '').localeCompare(String(a.item?.updatedAt || '')) || a.path.localeCompare(b.path));
  }
  approve({ path: filePath, authorityRef, reason } = {}) {
    if (!String(authorityRef || '').startsWith('human:') || !String(reason || '').trim()) throw new Error('Cognition 批准需要 human:* Authority 与理由');
    const current = this.read(filePath); if (current.item.authorityState === 'HUMAN_APPROVED') return current;
    const item = cognition.normalizeCognitionItem({ ...current.item, sourceRefs: this.sourceRefs(current.item.sourceRefs), authorityState: 'HUMAN_APPROVED', authorityRef, updatedAt: this.now().toISOString(), provenance: { ...current.item.provenance, approvedReason: String(reason).trim() } });
    this.writeAtomic(this.target(filePath), cognition.serializeCognitionMarkdown(item, current.body)); return this.read(filePath);
  }
  supersede({ priorPath, replacementPath, authorityRef, reason } = {}) {
    if (!String(authorityRef || '').startsWith('human:') || !String(reason || '').trim()) throw new Error('Cognition 替代需要 human:* Authority 与理由');
    const prior = this.read(priorPath), replacement = this.read(replacementPath);
    if (prior.item.cognitionId === replacement.item.cognitionId) throw new Error('Cognition 不能替代自身');
    const at = this.now().toISOString();
    const next = cognition.normalizeCognitionItem({ ...replacement.item, authorityState: 'HUMAN_APPROVED', authorityRef, supersedes: [...new Set([...replacement.item.supersedes, prior.item.cognitionId])], updatedAt: at, provenance: { ...replacement.item.provenance, supersessionReason: String(reason).trim() } });
    const old = cognition.normalizeCognitionItem({ ...prior.item, lifecycle: 'SUPERSEDED', supersededBy: next.cognitionId, updatedAt: at, provenance: { ...prior.item.provenance, supersededReason: String(reason).trim(), supersededAuthorityRef: authorityRef } });
    const priorTarget = this.target(priorPath), nextTarget = this.target(replacementPath); const priorRaw = this.fs.readFileSync(priorTarget, 'utf8'), nextRaw = this.fs.readFileSync(nextTarget, 'utf8');
    try { this.writeAtomic(nextTarget, cognition.serializeCognitionMarkdown(next, replacement.body)); this.writeAtomic(priorTarget, cognition.serializeCognitionMarkdown(old, prior.body)); }
    catch (error) { this.writeAtomic(nextTarget, nextRaw); this.writeAtomic(priorTarget, priorRaw); throw error; }
    return { prior: this.read(priorPath), replacement: this.read(replacementPath) };
  }
  summary({ stageRef = 'workspace:current' } = {}) { return cognition.buildStageSummary(this.list().filter(row => row.item).map(row => row.item), { stageRef, generatedAt: this.now().toISOString() }); }
}

module.exports = { CognitionService, inside, safeName };
