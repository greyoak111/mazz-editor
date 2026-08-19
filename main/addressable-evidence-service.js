'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildReferenceIndex,
  createContentAnchor,
  createLiveReference,
  parseLiveReferences,
  resolveContentAnchor,
} = require('./foundation/addressable-evidence');

const TEXT_EXT = /\.(?:md|markdown|mazz|txt)$/i;
const EVIDENCE_EXT = /\.(?:md|markdown|mazz|txt|pdf|epub|cbz|cbr|png|jpe?g|gif|webp|bmp|avif|mp4|webm|ogv|mov|m4v|mkv|avi|wmv|flv|ts|mts|m2ts|mpg|mpeg|3gp|mp3|wav|oga|m4a|aac|flac|opus|ogg)$/i;
const IGNORED_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules', 'renderer/dist']);
const MAX_FILES = 10000;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

function slash(value) { return String(value || '').replace(/\\/g, '/'); }
function digest(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function inside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function relativeRef(root, target) { return slash(path.relative(root, target)); }
function fileTitle(file) { return path.basename(file).replace(TEXT_EXT, ''); }
function identityKey(root) { return `w63.asset-identities.${digest(path.resolve(root).toLocaleLowerCase('en-US'))}`; }

function targetSelector(targetAnchorRef) {
  const value = String(targetAnchorRef || '').trim();
  if (value.startsWith('^')) return { kind: 'markdown-block', blockId: value.slice(1) };
  if (value.startsWith('#')) return { kind: 'markdown-heading', headingPath: [value.replace(/^#+\s*/, '')] };
  if (value.startsWith('quote:')) return { kind: 'markdown-quote', textQuote: value.slice(6).trim() };
  return { kind: 'markdown-block', blockId: value };
}

class AddressableEvidenceService {
  constructor({ rootProvider, identityStore, fsImpl = fs } = {}) {
    if (typeof rootProvider !== 'function') throw new Error('AddressableEvidenceService 需要 rootProvider');
    this.rootProvider = rootProvider;
    this.identityStore = identityStore || { get: () => ({}), set: () => {} };
    this.fs = fsImpl;
    this.cache = new Map();
  }

  root() {
    const root = path.resolve(String(this.rootProvider() || ''));
    if (!root) throw new Error('工作区不可用');
    return root;
  }

  invalidate(changedPath = '') {
    if (!changedPath) { this.cache.clear(); return true; }
    const resolved = path.resolve(changedPath);
    for (const root of this.cache.keys()) if (inside(root, resolved)) this.cache.delete(root);
    return true;
  }

  listFiles(root) {
    const files = [];
    const walk = (dir, depth) => {
      if (depth > 12 || files.length >= MAX_FILES) return;
      let entries = [];
      try { entries = this.fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (files.length >= MAX_FILES) break;
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && !IGNORED_DIRS.has(entry.name)) walk(target, depth + 1);
        } else if (entry.isFile() && EVIDENCE_EXT.test(entry.name)) {
          try {
            const stat = this.fs.statSync(target);
            if (!TEXT_EXT.test(entry.name) || stat.size <= MAX_TEXT_BYTES) files.push({ path: target, size: stat.size, mtimeMs: stat.mtimeMs, text: TEXT_EXT.test(entry.name) });
          } catch {}
        }
      }
    };
    walk(root, 0);
    return files;
  }

  identities(root, documents) {
    const key = identityKey(root);
    const previous = this.identityStore.get(key) || {};
    const byFingerprint = new Map();
    for (const row of Object.values(previous)) {
      if (row?.fingerprint && row?.assetId) {
        const list = byFingerprint.get(row.fingerprint) || [];
        list.push(row.assetId);
        byFingerprint.set(row.fingerprint, list);
      }
    }
    const used = new Set();
    const next = {};
    for (const doc of documents) {
      const rel = relativeRef(root, doc.path);
      const fingerprint = doc.fingerprint;
      let assetId = previous[rel]?.assetId || '';
      if (!assetId) assetId = (byFingerprint.get(fingerprint) || []).find(id => !used.has(id)) || '';
      if (!assetId) assetId = `asset:workspace-file:${crypto.randomUUID()}`;
      used.add(assetId);
      next[rel] = { assetId, fingerprint };
      doc.assetId = assetId;
      doc.relativePath = rel;
      doc.title = fileTitle(doc.path);
    }
    this.identityStore.set(key, next);
  }

  scan({ force = false } = {}) {
    const root = this.root();
    if (!force && this.cache.has(root)) return this.cache.get(root);
    const documents = this.listFiles(root).map(file => {
      if (file.text) {
        const content = this.fs.readFileSync(file.path, 'utf8');
        return { ...file, content, fingerprint: digest(content) };
      }
      let head = Buffer.alloc(0), tail = Buffer.alloc(0);
      try {
        const fd = this.fs.openSync(file.path, 'r');
        try {
          const headSize = Math.min(file.size, 64 * 1024);
          head = Buffer.alloc(headSize); this.fs.readSync(fd, head, 0, headSize, 0);
          const tailSize = Math.min(file.size, 64 * 1024);
          tail = Buffer.alloc(tailSize); this.fs.readSync(fd, tail, 0, tailSize, Math.max(0, file.size - tailSize));
        } finally { this.fs.closeSync(fd); }
      } catch {}
      return { ...file, content: '', fingerprint: digest(Buffer.concat([Buffer.from(String(file.size)), head, tail]).toString('base64')) };
    });
    this.identities(root, documents);
    const exact = new Map();
    const loose = new Map();
    const addLoose = (key, doc) => {
      const normalized = key.toLocaleLowerCase('en-US');
      const rows = loose.get(normalized) || [];
      if (!rows.includes(doc)) rows.push(doc);
      loose.set(normalized, rows);
    };
    for (const doc of documents) {
      exact.set(doc.relativePath.toLocaleLowerCase('en-US'), doc);
      addLoose(path.basename(doc.relativePath), doc);
      addLoose(doc.title, doc);
      addLoose(doc.assetId, doc);
    }

    const anchors = [];
    const references = [];
    const details = [];
    for (const doc of documents) {
      const parsed = doc.text ? parseLiveReferences(doc.content, doc.assetId) : [];
      for (const raw of parsed) {
        const key = raw.targetAssetRef.replace(/^\.\//, '').replace(/\\/g, '/').toLocaleLowerCase('en-US');
        const candidates = exact.has(key) ? [exact.get(key)] : (loose.get(key) || []);
        let targetPath = '';
        let targetAssetId = '';
        let resolution = { status: candidates.length > 1 ? 'AMBIGUOUS' : 'MISSING', method: candidates.length > 1 ? 'asset-ref-ambiguous' : 'asset-ref-missing', evidence: [`asset-candidates:${candidates.length}`] };
        if (candidates.length === 1) {
          const target = candidates[0];
          targetPath = slash(target.path);
          targetAssetId = target.assetId;
          try {
            const targetAnchor = createContentAnchor({
              assetId: target.assetId,
              mediaType: 'markdown',
              logicalLocation: targetSelector(raw.targetAnchorRef),
              physicalLocation: null,
              quote: '', context: null,
              provenance: { source: 'w63-workspace-index', targetAssetRef: raw.targetAssetRef },
              resolver: { strategy: 'block-id-heading-or-quote' }, status: 'active',
            });
            anchors.push(targetAnchor);
            resolution = resolveContentAnchor(targetAnchor, { assetId: target.assetId, text: target.content });
          } catch (error) {
            resolution = { status: 'MISSING', method: 'invalid-target-selector', evidence: [String(error.message || error)] };
          }
        }
        const reference = createLiveReference({
          sourceAssetId: raw.sourceAssetId,
          sourceAnchorId: raw.sourceAnchorId,
          targetAssetRef: targetAssetId || raw.targetAssetRef,
          targetAnchorRef: raw.targetAnchorRef,
          provenance: { ...raw.provenance, sourcePath: slash(doc.path), declaredTargetAssetRef: raw.targetAssetRef },
          status: resolution.status === 'RESOLVED' ? 'active' : resolution.status === 'AMBIGUOUS' ? 'stale' : 'missing',
        });
        references.push(reference);
        details.push({
          referenceId: reference.referenceId,
          sourceAssetId: doc.assetId,
          sourcePath: slash(doc.path),
          sourceTitle: doc.title,
          targetAssetId,
          targetPath,
          declaredTargetAssetRef: raw.targetAssetRef,
          targetAnchorRef: raw.targetAnchorRef,
          status: resolution.status,
          method: resolution.method,
          evidence: resolution.evidence || [],
        });
      }
    }
    const dedupeAnchors = [...new Map(anchors.map(item => [item.anchorId, item])).values()];
    const dedupeReferences = [...new Map(references.map(item => [item.referenceId, item])).values()];
    const dedupeDetails = [...new Map(details.map(item => [item.referenceId, item])).values()];
    const index = buildReferenceIndex({ anchors: dedupeAnchors, references: dedupeReferences, builtAt: new Date().toISOString() });
    const result = Object.freeze({
      root: slash(root),
      scannedAt: Date.now(),
      truncated: documents.length >= MAX_FILES,
      documents: documents.map(({ content, ...doc }) => ({ ...doc, path: slash(doc.path) })),
      index,
      details: dedupeDetails.sort((a, b) => a.referenceId.localeCompare(b.referenceId)),
    });
    this.cache.set(root, result);
    return result;
  }

  fileRelations({ path: filePath, force = false } = {}) {
    const root = this.root();
    const resolved = path.resolve(String(filePath || ''));
    if (!inside(root, resolved)) throw new Error('文件必须位于当前工作区');
    const scan = this.scan({ force });
    const document = scan.documents.find(item => path.resolve(item.path) === resolved);
    if (!document) return { filePath: slash(resolved), assetId: '', outgoing: [], incoming: [], scannedAt: scan.scannedAt };
    return {
      filePath: slash(resolved),
      assetId: document.assetId,
      outgoing: scan.details.filter(item => item.sourceAssetId === document.assetId),
      incoming: scan.details.filter(item => item.targetAssetId === document.assetId),
      scannedAt: scan.scannedAt,
      truncated: scan.truncated,
    };
  }

  createAnchorForPath({ path: filePath, mediaType, logicalLocation, quote = '', context = null } = {}) {
    const root = this.root();
    const resolved = path.resolve(String(filePath || ''));
    if (!inside(root, resolved)) throw new Error('文件必须位于当前工作区');
    const scan = this.scan();
    const document = scan.documents.find(item => path.resolve(item.path) === resolved);
    if (!document) throw new Error('文件不在当前工作区可寻址清单中');
    return createContentAnchor({
      assetId: document.assetId,
      mediaType,
      logicalLocation,
      physicalLocation: { path: slash(resolved) },
      quote,
      context,
      provenance: { source: 'w78-product-entry', filePath: slash(resolved), fingerprint: document.fingerprint },
      resolver: { strategy: 'logical-selector-then-evidence-fallback' },
      status: 'active',
    });
  }
}

module.exports = { AddressableEvidenceService, targetSelector, inside };
