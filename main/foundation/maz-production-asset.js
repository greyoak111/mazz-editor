'use strict';

const crypto = require('crypto');
const JSZip = require('jszip');
const { isPlainObject } = require('./plain-value');

const MAZ_MANIFEST_SCHEMA = 'mazz.production-asset-manifest/v0';
const MAZ_INDEX_SCHEMA = 'mazz.production-asset-index/v0';
const MAZ_INSPECTION_SCHEMA = 'mazz.production-asset-inspection/v0';
const MAZ_SIGNATURE_SCHEMA = 'mazz.production-asset-signature/v0';
const MAZ_RIGHTS_SCHEMA = 'mazz.production-asset-rights/v0';
const PROFILES = Object.freeze(['plugin', 'template', 'workflow', 'organization', 'world', 'toolpack', 'bundle']);
const DEFINITION_PROFILES = Object.freeze(['template', 'workflow', 'organization', 'world']);
const LIMITS = Object.freeze({ packageBytes: 64 * 1024 * 1024, entries: 2048, entryBytes: 16 * 1024 * 1024, expandedBytes: 128 * 1024 * 1024, compressionRatio: 300 });
const SECRET_KEYS = /^(api[-_]?key|authorization|cookie|credential|password|private[-_]?key|refresh[-_]?token|secret|session[-_]?token)$/i;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
const stableStringify = value => JSON.stringify(stable(value));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((child, index) => rejectSecrets(child, `${trail}[${index}]`));
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.test(key)) throw new Error(`.maz 禁止 secret: ${trail ? `${trail}.` : ''}${key}`);
    rejectSecrets(child, trail ? `${trail}.${key}` : key);
  }
}

function safeEntryName(name) {
  const value = String(name || '').replace(/\\/g, '/');
  if (!value || value.includes('\0') || value.startsWith('/') || /^\/?[A-Za-z]:/.test(value) || value.startsWith('//')) throw new Error(`.maz 危险路径: ${name}`);
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error(`.maz 危险路径: ${name}`);
  return value;
}

function validateManifest(input) {
  if (!isPlainObject(input)) throw new Error('manifest.json 必须是对象');
  rejectSecrets(input);
  const profile = String(input.profile || '');
  if (!PROFILES.includes(profile)) throw new Error(`未知 .maz profile: ${profile}`);
  const required = ['semanticId', 'version', 'name'];
  for (const key of required) if (!String(input[key] || '').trim()) throw new Error(`manifest.json 缺少 ${key}`);
  if (!/^[-\w.:/]{3,240}$/.test(input.semanticId)) throw new Error('semanticId 非法');
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(input.version)) throw new Error('version 必须是 semver');
  const permissions = Array.isArray(input.permissions) ? [...new Set(input.permissions.map(String))].sort() : [];
  const dependencies = Array.isArray(input.dependencies) ? input.dependencies.map((row, index) => {
    if (!isPlainObject(row) || !row.semanticId || !row.versionRange || !row.profile) throw new Error(`dependencies[${index}] 不完整`);
    return { semanticId: String(row.semanticId), versionRange: String(row.versionRange), profile: String(row.profile), required: row.required !== false, integrity: String(row.integrity || '') };
  }) : [];
  return {
    schema: MAZ_MANIFEST_SCHEMA, containerVersion: '0.1-local', semanticId: String(input.semanticId), version: String(input.version),
    profile, name: String(input.name), description: String(input.description || ''),
    entry: String(input.entry || ''), permissions, dependencies,
    provenance: isPlainObject(input.provenance) ? input.provenance : {},
    rightsRef: String(input.rightsRef || ''), integrityRef: 'package.index.json',
    runtimeStateIncluded: false, publicationGranted: false,
  };
}

function declaredSize(file) {
  const size = file?._data?.uncompressedSize;
  return Number.isFinite(size) ? size : null;
}

function scanCentralDirectoryNames(buffer) {
  const names = [];
  for (let offset = 0; offset + 46 <= buffer.length;) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) { offset += 1; continue; }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length) throw new Error('.maz central directory 损坏');
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset = end;
  }
  const seen = new Set();
  for (const raw of names.filter(name => !name.endsWith('/'))) {
    const name = safeEntryName(raw);
    const canonical = name.toLowerCase();
    if (seen.has(canonical)) throw new Error(`.maz 重复条目: ${name}`);
    seen.add(canonical);
  }
  return names;
}

async function readZipEntries(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length > LIMITS.packageBytes) throw new Error('.maz 包超过 64 MiB');
  scanCentralDirectoryNames(buffer);
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false });
  const entries = Object.values(zip.files).filter(file => !file.dir);
  if (entries.length > LIMITS.entries) throw new Error('.maz 条目数超过上限');
  let expanded = 0;
  const names = new Set();
  for (const file of entries) {
    const name = safeEntryName(file.name);
    const canonical = name.toLowerCase();
    if (names.has(canonical)) throw new Error(`.maz 重复条目: ${name}`);
    names.add(canonical);
    const unixMode = typeof file.unixPermissions === 'number' ? file.unixPermissions : parseInt(String(file.unixPermissions || '0'), 8);
    if ((unixMode & 0o170000) === 0o120000) throw new Error(`.maz 禁止 symlink: ${name}`);
    const size = declaredSize(file);
    if (size == null) throw new Error(`.maz 条目缺少声明大小: ${name}`);
    if (size > LIMITS.entryBytes) throw new Error(`.maz 条目超过 16 MiB: ${name}`);
    expanded += size;
    if (expanded > LIMITS.expandedBytes) throw new Error('.maz 展开总量超过 128 MiB');
    const compressedSize = Number(file?._data?.compressedSize || 0);
    if (size > 1024 * 1024 && compressedSize > 0 && size / compressedSize > LIMITS.compressionRatio) throw new Error(`.maz 可疑压缩比: ${name}`);
  }
  return { zip, entries, packageBytes: buffer.length, packageDigest: sha256(buffer), expandedBytes: expanded };
}

async function textEntry(zip, name, max = 1024 * 1024) {
  const file = zip.file(name);
  if (!file) return '';
  if ((declaredSize(file) || 0) > max) throw new Error(`${name} 过大`);
  const value = await file.async('string');
  if (Buffer.byteLength(value) > max) throw new Error(`${name} 过大`);
  return value;
}

async function detectLegacyProfile(zip) {
  const hasPlugin = !!zip.file('plugin.json');
  const hasStyle = !!zip.file('definition.json') && (!!zip.file('prompt.txt') || !!zip.file('meta.json'));
  const hasManifest = !!zip.file('manifest.json');
  const count = [hasPlugin, hasStyle, hasManifest].filter(Boolean).length;
  if (count > 1) return { profile: 'ambiguous', reason: 'CONFLICTING_PROFILE_DISCRIMINATORS' };
  if (hasPlugin) return { profile: 'plugin', legacy: true, executable: true };
  if (hasStyle) return { profile: 'template', legacy: true, executable: false };
  if (hasManifest) return { profile: 'production-asset', legacy: false, executable: false };
  return { profile: 'unknown', legacy: false, executable: false };
}

async function inspectMazBytes(bytes) {
  const { zip, entries, packageBytes, packageDigest, expandedBytes } = await readZipEntries(bytes);
  const detected = await detectLegacyProfile(zip);
  let manifest = null; let index = null; const blockers = [];
  if (detected.profile === 'production-asset') {
    try { manifest = validateManifest(JSON.parse(await textEntry(zip, 'manifest.json', 256 * 1024))); }
    catch (error) { blockers.push(`MANIFEST_INVALID:${error.message}`); }
    try {
      index = JSON.parse(await textEntry(zip, 'package.index.json', 1024 * 1024));
      if (index.schema !== MAZ_INDEX_SCHEMA || !Array.isArray(index.blocks)) throw new Error('index schema/blocks invalid');
      const indexed = new Map(index.blocks.map(row => [safeEntryName(row.path), row]));
      for (const file of entries.filter(row => !['manifest.json', 'package.index.json', 'integrity/signature.json'].includes(row.name))) {
        const row = indexed.get(file.name);
        if (!row) blockers.push(`INDEX_MISSING:${file.name}`);
        else {
          const content = await file.async('nodebuffer');
          if (sha256(content) !== row.sha256) blockers.push(`HASH_MISMATCH:${file.name}`);
        }
      }
    } catch (error) { blockers.push(`INDEX_INVALID:${error.message}`); }
  } else if (detected.profile === 'ambiguous') blockers.push(detected.reason);
  return {
    schema: MAZ_INSPECTION_SCHEMA, packageDigest, packageBytes, expandedBytes,
    detected, manifest, index, entries: entries.map(row => ({ path: row.name, bytes: declaredSize(row) })), blockers,
    inspectOnly: true, codeExecuted: false, trusted: false,
  };
}

async function buildProductionAsset({ manifest, files, signature = null }) {
  const normalized = validateManifest(manifest);
  if (!DEFINITION_PROFILES.includes(normalized.profile) && normalized.profile !== 'toolpack') throw new Error('本地 W84 builder 仅允许非执行 Definition/toolpack profile');
  const rows = Object.entries(files || {}).map(([name, content]) => ({ path: safeEntryName(name), content: Buffer.from(content) }));
  if (!rows.length) throw new Error('Definition package 至少包含一个文件');
  for (const row of rows) if (row.content.length > LIMITS.entryBytes) throw new Error(`条目过大: ${row.path}`);
  const index = {
    schema: MAZ_INDEX_SCHEMA, semanticId: normalized.semanticId, version: normalized.version, profile: normalized.profile,
    blocks: rows.map(row => ({ path: row.path, bytes: row.content.length, sha256: sha256(row.content), encrypted: row.path.startsWith('payload/'), executable: row.path.startsWith('scripts/') })).sort((a, b) => a.path.localeCompare(b.path)),
  };
  const zip = new JSZip();
  zip.file('manifest.json', `${JSON.stringify(normalized, null, 2)}\n`);
  zip.file('package.index.json', `${JSON.stringify(index, null, 2)}\n`);
  for (const row of rows) zip.file(row.path, row.content);
  if (signature) zip.file('integrity/signature.json', `${JSON.stringify(signature, null, 2)}\n`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function migrateLegacyStyle(bytes, { semanticId, version = '1.0.0' }) {
  const { zip, packageDigest } = await readZipEntries(bytes);
  const detected = await detectLegacyProfile(zip);
  if (detected.profile !== 'template' || !detected.legacy) throw new Error('只允许迁移 legacy style .maz');
  const definitionText = await textEntry(zip, 'definition.json');
  const prompt = await textEntry(zip, 'prompt.txt');
  const definition = JSON.parse(definitionText);
  const files = { 'definition/template.json': `${JSON.stringify(definition, null, 2)}\n`, 'instructions/prompt.txt': prompt };
  const output = await buildProductionAsset({ manifest: { semanticId, version, profile: 'template', name: definition.name || semanticId, description: definition.description || '', permissions: [], dependencies: [], provenance: { migratedFrom: packageDigest, legacyProfile: 'factory-style' } }, files });
  return { preview: { sourceDigest: packageDigest, sourceProfile: 'template', targetProfile: 'template', originalOverwritten: false, files: Object.keys(files) }, output };
}

function forkManifest(manifest, { semanticId, version, name = '' }) {
  const original = validateManifest(manifest);
  if (!semanticId || semanticId === original.semanticId) throw new Error('Fork 必须创建新 semantic identity');
  return validateManifest({ ...original, semanticId, version, name: name || `${original.name} (Fork)`, provenance: { ...original.provenance, derivedFrom: `${original.semanticId}@${original.version}` } });
}

function createSignature({ manifest, index, privateKey, signerId }) {
  const payloadDigest = sha256(Buffer.from(stableStringify({ manifest: validateManifest(manifest), index })));
  const signature = crypto.sign(null, Buffer.from(payloadDigest, 'utf8'), privateKey).toString('base64');
  return { schema: MAZ_SIGNATURE_SCHEMA, algorithm: 'Ed25519', signerId: String(signerId), payloadDigest, signature, scope: ['manifest.json', 'package.index.json'], safetyClaim: false, authorityClaim: false };
}

function verifySignature({ manifest, index, signature, publicKey }) {
  if (signature?.schema !== MAZ_SIGNATURE_SCHEMA || signature.algorithm !== 'Ed25519') return { valid: false, reason: 'UNSUPPORTED_SIGNATURE' };
  const payloadDigest = sha256(Buffer.from(stableStringify({ manifest: validateManifest(manifest), index })));
  if (payloadDigest !== signature.payloadDigest) return { valid: false, reason: 'SIGNED_CONTENT_TAMPERED' };
  const valid = crypto.verify(null, Buffer.from(payloadDigest, 'utf8'), publicKey, Buffer.from(signature.signature, 'base64'));
  return { valid, reason: valid ? 'VALID' : 'SIGNATURE_INVALID', signerId: signature.signerId, safetyProved: false, authorityGranted: false };
}

function encryptPayloadBlocks(blocks, recipients) {
  const contentKey = crypto.randomBytes(32);
  const encryptedBlocks = Object.entries(blocks).map(([pathValue, content]) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(content)), cipher.final()]);
    return { path: safeEntryName(pathValue), algorithm: 'AES-256-GCM', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'), sha256: sha256(ciphertext) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const keyEnvelopes = recipients.map(row => ({ recipientId: String(row.recipientId), algorithm: 'RSA-OAEP-SHA256', wrappedKey: crypto.publicEncrypt({ key: row.publicKey, oaepHash: 'sha256' }, contentKey).toString('base64'), status: 'active' }));
  return { schema: 'mazz.encrypted-payload-set/v0', blocks: encryptedBlocks, keyEnvelopes, ciphertextSetDigest: sha256(Buffer.from(stableStringify(encryptedBlocks))) };
}

function decryptPayloadBlock(payload, { recipientId, privateKey, path: blockPath, entitlement, runtimePermission = null }) {
  if (entitlement?.schema !== MAZ_RIGHTS_SCHEMA || entitlement.subjectId !== recipientId || entitlement.status !== 'active') throw new Error('ENTITLEMENT_DENIED');
  if (Date.parse(entitlement.notBefore) > Date.now() || Date.parse(entitlement.expiresAt) < Date.now()) throw new Error('ENTITLEMENT_EXPIRED_OR_NOT_YET_VALID');
  const envelope = payload.keyEnvelopes.find(row => row.recipientId === recipientId && row.status === 'active');
  if (!envelope) throw new Error('KEY_ENVELOPE_MISSING_OR_REVOKED');
  const block = payload.blocks.find(row => row.path === blockPath);
  if (!block || !entitlement.blockPaths.includes(blockPath)) throw new Error('BLOCK_NOT_ENTITLED');
  const contentKey = crypto.privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, Buffer.from(envelope.wrappedKey, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey, Buffer.from(block.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(block.tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(block.ciphertext, 'base64')), decipher.final()]);
  return { plaintext, decrypted: true, executionAuthorized: runtimePermission?.allowed === true, runtimePermissionIndependent: true };
}

function issueEntitlement({ entitlementId, subjectId, blockPaths, notBefore, expiresAt, licenseRef }) {
  const value = { schema: MAZ_RIGHTS_SCHEMA, entitlementId: String(entitlementId), subjectId: String(subjectId), blockPaths: [...new Set(blockPaths.map(safeEntryName))].sort(), notBefore: new Date(notBefore).toISOString(), expiresAt: new Date(expiresAt).toISOString(), licenseRef: String(licenseRef), status: 'active', distributionRight: false, executionPermission: false };
  if (Date.parse(value.expiresAt) <= Date.parse(value.notBefore)) throw new Error('Entitlement 时间范围无效');
  return value;
}

function revokeEntitlement(entitlement, reason) {
  if (!String(reason || '').trim()) throw new Error('撤销 Entitlement 需要理由');
  return { ...entitlement, status: 'revoked', revokedAt: new Date().toISOString(), revocationReason: String(reason) };
}

function rotateKeyEnvelopes(payload, { sourceRecipientId, sourcePrivateKey, recipients }) {
  const source = payload.keyEnvelopes.find(row => row.recipientId === sourceRecipientId && row.status === 'active');
  if (!source) throw new Error('轮换缺少可解封的 source Key Envelope');
  const contentKey = crypto.privateDecrypt({ key: sourcePrivateKey, oaepHash: 'sha256' }, Buffer.from(source.wrappedKey, 'base64'));
  if (contentKey.length !== 32) throw new Error('Content Key 长度无效');
  const keyEnvelopes = recipients.map(row => ({ recipientId: String(row.recipientId), algorithm: 'RSA-OAEP-SHA256', wrappedKey: crypto.publicEncrypt({ key: row.publicKey, oaepHash: 'sha256' }, contentKey).toString('base64'), status: 'active' }));
  return { ...payload, keyEnvelopes, ciphertextSetDigest: payload.ciphertextSetDigest };
}

function runtimePermissionGate({ profile, requestedPermissions, grantedPermissions, trustedDigest, currentDigest }) {
  const missing = [...new Set(requestedPermissions)].filter(row => !grantedPermissions.includes(row)).sort();
  const allowed = trustedDigest === currentDigest && !missing.length && !['organization', 'template', 'world', 'workflow'].includes(profile);
  return { allowed, state: trustedDigest !== currentDigest ? 'CONTENT_CHANGED' : missing.length ? 'PERMISSION_DENIED' : allowed ? 'ALLOWED' : 'NON_EXECUTABLE_PROFILE', missing, decryptRightImpliesExecution: false };
}

function invokeSealedCapability({ contract, permissionGate, inputDigest, executor }) {
  if (!isPlainObject(contract) || !contract.capabilityId || !contract.location || !Array.isArray(contract.inputTypes) || !Array.isArray(contract.outputTypes)) throw new Error('SEALED_CONTRACT_INVALID');
  if (!permissionGate?.allowed) throw new Error(`SEALED_RUNTIME_DENIED:${permissionGate?.state || 'NO_GATE'}`);
  if (typeof executor !== 'function') throw new Error('SEALED_EXECUTOR_UNAVAILABLE');
  const result = executor({ inputDigest });
  const evidence = { schema: 'mazz.sealed-capability-evidence/v0', capabilityId: contract.capabilityId, location: contract.location, inputDigest: String(inputDigest), outputDigest: sha256(Buffer.from(stableStringify(result))), contractVisible: true, implementationVisible: false, signedEvidenceRequiredForPromotion: true };
  return { result, evidence };
}

function aggregateQuality(records) {
  const rows = records.map(row => ({ accepted: !!row.accepted, revisions: Number(row.revisions) || 0, humanAttentionMinutes: Number(row.humanAttentionMinutes) || 0, landedCost: Number(row.landedCost) || 0, failureClass: String(row.failureClass || 'none') }));
  const count = rows.length;
  return { schema: 'mazz.aggregated-quality-record/v0', metricDefinitionVersion: '1.0.0', sampleSize: count, acceptanceRate: count ? rows.filter(row => row.accepted).length / count : 0, revisionAverage: count ? rows.reduce((n, row) => n + row.revisions, 0) / count : 0, humanAttentionAverageMinutes: count ? rows.reduce((n, row) => n + row.humanAttentionMinutes, 0) / count : 0, landedCostAverage: count ? rows.reduce((n, row) => n + row.landedCost, 0) / count : 0, failureDistribution: Object.fromEntries([...new Set(rows.map(row => row.failureClass))].sort().map(key => [key, rows.filter(row => row.failureClass === key).length])), rawProductionLedgerIncluded: false };
}

module.exports = {
  MAZ_MANIFEST_SCHEMA, MAZ_INDEX_SCHEMA, MAZ_INSPECTION_SCHEMA, MAZ_SIGNATURE_SCHEMA, MAZ_RIGHTS_SCHEMA,
  PROFILES, DEFINITION_PROFILES, LIMITS, validateManifest, safeEntryName, inspectMazBytes,
  buildProductionAsset, migrateLegacyStyle, forkManifest, createSignature, verifySignature,
  encryptPayloadBlocks, decryptPayloadBlock, issueEntitlement, revokeEntitlement, rotateKeyEnvelopes,
  runtimePermissionGate, invokeSealedCapability, aggregateQuality, sha256, stableStringify,
  scanCentralDirectoryNames,
};
