'use strict';

// W74a：已有本地材料进入项目的文件优先薄竖切。
// 领域文件/提取文本继续是真相；这里只保存项目快照、W72 Envelope、可重建切片与目录。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createAssetEnvelope } = require('./foundation/asset-envelope');
const { assertKnownKeys, clonePlain, deepFreeze, isPlainObject, requiredString } = require('./foundation/plain-value');

const INGESTION_REQUEST_SCHEMA = 'mazz.ingestion-request/v0';
const INGESTION_MANIFEST_SCHEMA = 'mazz.ingestion-manifest/v0';
const INGESTION_CATALOG_SCHEMA = 'mazz.ingestion-catalog/v0';
const INGESTION_CONFLICT_SCHEMA = 'mazz.ingestion-conflict/v0';
const INGESTION_LAYERS = Object.freeze(['source-fact', 'derived', 'estimate', 'hypothesis', 'missing']);
const CHUNK_CHARS = 1_600;
const REQUEST_FIELDS = Object.freeze([
  'schema', 'assetId', 'projectId', 'projectPath', 'title', 'mediaType', 'layer',
  'text', 'sourceRef', 'provenance', 'importedAt',
]);
const SECRET_KEYS = new Set([
  'apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken', 'credential', 'cookie',
]);

const slash = value => String(value || '').replace(/\\/g, '/');
const sha256 = value => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${trail}[${index}]`));
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const canonical = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SECRET_KEYS.has(canonical)) throw new Error(`W74a 禁止 secret 字段：${trail ? `${trail}.` : ''}${key}`);
    rejectSecrets(item, trail ? `${trail}.${key}` : key);
  }
}

function normalizeImportedAt(value) {
  const raw = requiredString(value, 'importedAt');
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error('importedAt 必须是 ISO 时间');
  return new Date(ms).toISOString();
}

function normalizeIngestionRequest(input) {
  if (!isPlainObject(input)) throw new Error('W74a Ingestion Request 必须是对象');
  assertKnownKeys(input, REQUEST_FIELDS, 'W74a Ingestion Request');
  rejectSecrets(input);
  if (input.schema != null && input.schema !== INGESTION_REQUEST_SCHEMA) {
    throw new Error(`不支持的 Ingestion Request schema：${input.schema}`);
  }
  const assetId = requiredString(input.assetId, 'assetId');
  const projectId = requiredString(input.projectId, 'projectId');
  const projectPath = path.resolve(requiredString(input.projectPath, 'projectPath'));
  const title = requiredString(input.title, 'title');
  const mediaType = requiredString(input.mediaType, 'mediaType');
  const layer = requiredString(input.layer, 'layer');
  if (!INGESTION_LAYERS.includes(layer)) throw new Error(`非法材料层级：${layer}`);
  const text = String(input.text ?? '').replace(/\r\n?/g, '\n');
  if (layer !== 'missing' && !text.trim()) throw new Error('非 missing 材料必须有正文');
  if (layer === 'missing' && text.trim()) throw new Error('missing 材料不得伪装成已有正文');
  if (!isPlainObject(input.sourceRef)) throw new Error('sourceRef 必须是对象');
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  const sourceRef = clonePlain(input.sourceRef, 'sourceRef');
  const provenance = clonePlain(input.provenance, 'provenance');
  const importedAt = normalizeImportedAt(input.importedAt);
  const contentHash = sha256(text);
  const registration = {
    schema: INGESTION_REQUEST_SCHEMA, assetId, projectId, title, mediaType, layer,
    contentHash, sourceRef, provenance,
  };
  const registrationHash = sha256(stableJson(registration));
  return deepFreeze({
    ...registration, projectPath, text, importedAt, registrationHash,
    version: `sha256-${contentHash.slice(0, 16)}`,
  });
}

function chunkMaterialText(text, contentHash, maxChars = CHUNK_CHARS) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!source.length) return Object.freeze([]);
  const chunks = [];
  let start = 0;
  let line = 1;
  while (start < source.length) {
    let end = Math.min(source.length, start + Math.max(200, maxChars));
    if (end < source.length) {
      const floor = start + Math.floor((end - start) * 0.55);
      const newline = source.lastIndexOf('\n', end);
      const space = source.lastIndexOf(' ', end);
      const boundary = Math.max(newline >= floor ? newline + 1 : -1, space >= floor ? space + 1 : -1);
      if (boundary > start) end = boundary;
    }
    const body = source.slice(start, end);
    const endLine = line + (body.match(/\n/g) || []).length;
    chunks.push(Object.freeze({
      schema: 'mazz.ingestion-chunk/v0',
      chunkId: `chunk:${contentHash.slice(0, 16)}:${String(chunks.length + 1).padStart(5, '0')}`,
      index: chunks.length, startOffset: start, endOffset: end, startLine: line, endLine,
      text: body,
    }));
    start = end;
    line = endLine;
  }
  return Object.freeze(chunks);
}

function materialPaths(projectPath, assetId) {
  const root = path.resolve(projectPath, '.mazz', 'materials');
  const assetKey = sha256(assetId).slice(0, 24);
  const assetRoot = path.join(root, 'assets', assetKey);
  const relativeRoot = slash(path.relative(projectPath, assetRoot));
  return Object.freeze({
    root, assetKey, assetRoot, relativeRoot,
    content: path.join(assetRoot, 'content.txt'),
    chunks: path.join(assetRoot, 'chunks.ndjson'),
    envelope: path.join(assetRoot, 'asset-envelope.json'),
    manifest: path.join(assetRoot, 'manifest.json'),
    catalog: path.join(root, 'catalog.json'),
    conflicts: path.join(root, 'conflicts', assetKey),
  });
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temp, content, 'utf8');
  try { fs.renameSync(temp, filePath); }
  catch (error) {
    try { fs.copyFileSync(temp, filePath); fs.unlinkSync(temp); }
    catch { try { fs.unlinkSync(temp); } catch {} throw error; }
  }
}

function readJson(filePath, label) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { throw new Error(`${label} 损坏或不可读：${error.message}`); }
}

function cleanStaging(root) {
  if (!fs.existsSync(root)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('.staging-')) continue;
    const target = path.resolve(root, entry.name);
    if (path.dirname(target) !== path.resolve(root)) throw new Error('W74a staging 路径越界');
    fs.rmSync(target, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function catalogEntry(manifest) {
  return {
    assetId: manifest.assetId, projectId: manifest.projectId, title: manifest.title,
    layer: manifest.layer, mediaType: manifest.mediaType, version: manifest.version,
    status: manifest.status, contentHash: manifest.contentHash, registrationHash: manifest.registrationHash,
    charCount: manifest.charCount, chunkCount: manifest.chunkCount, importedAt: manifest.importedAt,
    sourceRef: clonePlain(manifest.sourceRef, 'catalog.sourceRef'),
    envelopePath: manifest.paths.envelope, manifestPath: manifest.paths.manifest,
  };
}

function rebuildCatalog(root, projectId) {
  const assetsRoot = path.join(root, 'assets');
  const entries = [];
  if (fs.existsSync(assetsRoot)) {
    for (const entry of fs.readdirSync(assetsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = readJson(path.join(assetsRoot, entry.name, 'manifest.json'), `材料 ${entry.name} manifest`);
      if (manifest.schema !== INGESTION_MANIFEST_SCHEMA) throw new Error(`材料 ${entry.name} manifest schema 不匹配`);
      if (manifest.projectId !== projectId) throw new Error(`材料 ${entry.name} projectId 与目录不一致`);
      entries.push(catalogEntry(manifest));
    }
  }
  entries.sort((a, b) => a.assetId.localeCompare(b.assetId, 'en'));
  const catalog = {
    schema: INGESTION_CATALOG_SCHEMA, projectId, generatedFrom: 'asset-manifests',
    entryCount: entries.length, entries,
  };
  catalog.catalogHash = sha256(stableJson(catalog));
  atomicWrite(path.join(root, 'catalog.json'), JSON.stringify(catalog, null, 2));
  return deepFreeze(catalog);
}

function createManifest(request, paths, chunks, envelope) {
  return {
    schema: INGESTION_MANIFEST_SCHEMA,
    assetId: request.assetId, projectId: request.projectId, title: request.title,
    layer: request.layer, mediaType: request.mediaType, version: request.version, status: 'active',
    contentHash: request.contentHash, registrationHash: request.registrationHash,
    charCount: request.text.length, chunkCount: chunks.length, importedAt: request.importedAt,
    sourceRef: clonePlain(request.sourceRef, 'manifest.sourceRef'),
    provenance: clonePlain(request.provenance, 'manifest.provenance'),
    paths: {
      content: `${paths.relativeRoot}/content.txt`, chunks: `${paths.relativeRoot}/chunks.ndjson`,
      envelope: `${paths.relativeRoot}/asset-envelope.json`, manifest: `${paths.relativeRoot}/manifest.json`,
    },
    envelopeId: envelope.id,
  };
}

function writeConflict(request, paths, existing) {
  const conflictId = `conflict:${paths.assetKey}:${request.registrationHash.slice(0, 16)}`;
  const conflict = {
    schema: INGESTION_CONFLICT_SCHEMA, conflictId, status: 'open', assetId: request.assetId,
    projectId: request.projectId, detectedAt: request.importedAt, reasonCode: 'SAME_ID_DIFFERENT_REGISTRATION',
    current: { version: existing.version, contentHash: existing.contentHash, registrationHash: existing.registrationHash, manifestPath: existing.paths?.manifest || '' },
    candidate: { version: request.version, contentHash: request.contentHash, registrationHash: request.registrationHash, sourceRef: clonePlain(request.sourceRef, 'conflict.sourceRef') },
    decisionRequired: true, automaticOverwrite: false,
  };
  fs.mkdirSync(paths.conflicts, { recursive: true });
  const conflictPath = path.join(paths.conflicts, `${request.registrationHash.slice(0, 24)}.json`);
  atomicWrite(conflictPath, JSON.stringify(conflict, null, 2));
  return { conflict: deepFreeze(conflict), conflictPath: slash(conflictPath) };
}

function registerMaterialSync(input) {
  const request = normalizeIngestionRequest(input);
  const paths = materialPaths(request.projectPath, request.assetId);
  fs.mkdirSync(paths.root, { recursive: true });
  const recoveredStaging = cleanStaging(paths.root);
  if (fs.existsSync(paths.assetRoot)) {
    const existing = readJson(paths.manifest, `材料 ${request.assetId} manifest`);
    if (existing.schema !== INGESTION_MANIFEST_SCHEMA || existing.assetId !== request.assetId || existing.projectId !== request.projectId) {
      throw new Error('W74a 现有材料目录身份不一致，必须人工恢复');
    }
    if (existing.registrationHash === request.registrationHash) {
      const catalog = rebuildCatalog(paths.root, request.projectId);
      return deepFreeze({ ok: true, code: 'ALREADY_REGISTERED', manifest: existing, catalog, recoveredStaging, paths: { root: slash(paths.root), manifest: slash(paths.manifest), envelope: slash(paths.envelope), catalog: slash(paths.catalog) } });
    }
    const recorded = writeConflict(request, paths, existing);
    return deepFreeze({ ok: false, code: 'INGESTION_CONFLICT', message: '同一资产身份出现不同内容或来源；现有材料未覆盖', ...recorded, recoveredStaging });
  }

  const chunks = chunkMaterialText(request.text, request.contentHash);
  const envelope = createAssetEnvelope({
    id: request.assetId,
    path: `${paths.relativeRoot}/content.txt`,
    type: request.mediaType,
    version: request.version,
    sourceRef: request.sourceRef,
    provenance: { ...request.provenance, protocol: 'W74a', contentHash: request.contentHash, importedAt: request.importedAt },
    status: 'active', relations: [],
  });
  const manifest = createManifest(request, paths, chunks, envelope);
  const staging = path.join(paths.root, `.staging-${paths.assetKey}-${crypto.randomBytes(5).toString('hex')}`);
  try {
    fs.mkdirSync(staging, { recursive: false });
    fs.writeFileSync(path.join(staging, 'content.txt'), request.text, 'utf8');
    fs.writeFileSync(path.join(staging, 'chunks.ndjson'), chunks.map(row => JSON.stringify(row)).join('\n') + (chunks.length ? '\n' : ''), 'utf8');
    fs.writeFileSync(path.join(staging, 'asset-envelope.json'), JSON.stringify(envelope, null, 2), 'utf8');
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    fs.mkdirSync(path.dirname(paths.assetRoot), { recursive: true });
    fs.renameSync(staging, paths.assetRoot);
  } catch (error) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
    throw error;
  }
  const catalog = rebuildCatalog(paths.root, request.projectId);
  return deepFreeze({
    ok: true, code: 'REGISTERED', manifest, envelope, catalog, recoveredStaging,
    paths: { root: slash(paths.root), content: slash(paths.content), chunks: slash(paths.chunks), manifest: slash(paths.manifest), envelope: slash(paths.envelope), catalog: slash(paths.catalog) },
  });
}

class IngestionPipeline {
  constructor() { this.queues = new Map(); }

  register(input) {
    const projectPath = path.resolve(requiredString(input?.projectPath, 'projectPath'));
    const queueKey = process.platform === 'win32' ? projectPath.toLocaleLowerCase('en-US') : projectPath;
    const previous = this.queues.get(queueKey) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => registerMaterialSync(input));
    this.queues.set(queueKey, current);
    return current.finally(() => { if (this.queues.get(queueKey) === current) this.queues.delete(queueKey); });
  }

  healthSnapshot() { return Object.freeze({ activeProjects: this.queues.size }); }
}

module.exports = {
  CHUNK_CHARS,
  INGESTION_CATALOG_SCHEMA,
  INGESTION_CONFLICT_SCHEMA,
  INGESTION_LAYERS,
  INGESTION_MANIFEST_SCHEMA,
  INGESTION_REQUEST_SCHEMA,
  IngestionPipeline,
  chunkMaterialText,
  materialPaths,
  normalizeIngestionRequest,
  registerMaterialSync,
};
