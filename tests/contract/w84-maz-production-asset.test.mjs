import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const maz = require('../../main/foundation/maz-production-asset.js');

async function legacyStyle() {
  const zip = new JSZip();
  zip.file('definition.json', JSON.stringify({ name: '旧文体', description: 'legacy', input_fields: [] }));
  zip.file('prompt.txt', 'write locally');
  zip.file('meta.json', JSON.stringify({ version: '1.0' }));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function legacyPlugin() {
  const zip = new JSZip();
  zip.file('plugin.json', JSON.stringify({ id: 'legacy.plugin', name: 'Legacy', version: '1.0.0', main: 'main.js' }));
  zip.file('main.js', 'throw new Error("must never execute during inspect")');
  return zip.generateAsync({ type: 'nodebuffer' });
}

const manifest = (profile = 'workflow') => ({
  semanticId: `asset:${profile}:sample`, version: '1.0.0', profile, name: `${profile} sample`,
  description: 'local W84 fixture', permissions: profile === 'toolpack' ? ['process:spawn'] : [],
  dependencies: [], provenance: { source: 'contract-test' }, rightsRef: 'rights:local',
});

test('W84a 无执行识别 legacy plugin/style，冲突 discriminator 明确阻断', async () => {
  const plugin = await maz.inspectMazBytes(await legacyPlugin());
  const style = await maz.inspectMazBytes(await legacyStyle());
  assert.equal(plugin.detected.profile, 'plugin');
  assert.equal(plugin.detected.executable, true);
  assert.equal(style.detected.profile, 'template');
  assert.equal(plugin.codeExecuted, false);
  const zip = new JSZip(); zip.file('plugin.json', '{}'); zip.file('definition.json', '{}'); zip.file('prompt.txt', 'x');
  const conflict = await maz.inspectMazBytes(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(conflict.detected.profile, 'ambiguous');
  assert.match(conflict.blockers.join(' '), /CONFLICTING_PROFILE/);
});

test('W84b inspect-only envelope 验证 semantic identity/index/hash 且不授予信任', async () => {
  const bytes = await maz.buildProductionAsset({ manifest: manifest('workflow'), files: { 'workflow/definition.json': '{"steps":[]}', 'authority/matrix.json': '{"humanFinal":true}' } });
  const result = await maz.inspectMazBytes(bytes);
  assert.equal(result.manifest.profile, 'workflow');
  assert.equal(result.blockers.length, 0);
  assert.equal(result.index.blocks.length, 2);
  assert.equal(result.inspectOnly, true);
  assert.equal(result.trusted, false);
  assert.equal(result.manifest.runtimeStateIncluded, false);
});

test('W84b 路径穿越、大小/条目预算与大小写重复条目 fail closed', async () => {
  const traversal = new JSZip(); traversal.file('../evil.txt', 'x');
  const traversalBytes = await traversal.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => maz.inspectMazBytes(traversalBytes), /危险路径/);
  const duplicate = new JSZip(); duplicate.file('assets/A.txt', '1'); duplicate.file('assets/a.txt', '2');
  const duplicateBytes = await duplicate.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => maz.inspectMazBytes(duplicateBytes), /重复条目/);
  assert.throws(() => maz.safeEntryName('C:\\secret.txt'), /危险路径/);
});

test('W84c Definition profiles 默认不可执行，secret 和不支持 profile 被拒绝', async () => {
  for (const profile of maz.DEFINITION_PROFILES) {
    const normalized = maz.validateManifest(manifest(profile));
    assert.equal(normalized.profile, profile);
    assert.equal(normalized.runtimeStateIncluded, false);
    assert.equal(normalized.publicationGranted, false);
  }
  assert.throws(() => maz.validateManifest({ ...manifest('workflow'), apiKey: 'x' }), /secret/);
  await assert.rejects(() => maz.buildProductionAsset({ manifest: manifest('plugin'), files: { 'main.js': 'x' } }), /非执行/);
});

test('W84c 名称与描述由资产完整保存，不套本地字符帽', () => {
  const name = `${'长名称'.repeat(130)}名称尾部`;
  const description = `${'完整描述'.repeat(600)}描述尾部`;
  const normalized = maz.validateManifest({ ...manifest('workflow'), name, description });
  assert.equal(normalized.name, name);
  assert.equal(normalized.description, description);
});

test('W84d legacy style 迁移先预览且不覆盖原包；legacy plugin 不借统一格式获信任', async () => {
  const source = await legacyStyle();
  const before = maz.sha256(source);
  const migrated = await maz.migrateLegacyStyle(source, { semanticId: 'asset:template:migrated', version: '1.0.0' });
  assert.equal(migrated.preview.originalOverwritten, false);
  assert.equal(maz.sha256(source), before);
  const inspected = await maz.inspectMazBytes(migrated.output);
  assert.equal(inspected.manifest.profile, 'template');
  assert.equal(inspected.manifest.provenance.migratedFrom, before);
  const plugin = await legacyPlugin();
  await assert.rejects(() => maz.migrateLegacyStyle(plugin, { semanticId: 'asset:no', version: '1.0.0' }), /只允许迁移/);
});

test('W84e export/copy 保持 identity，Fork 新建 identity，Ed25519 篡改验证失败', async () => {
  const normalized = maz.validateManifest(manifest('organization'));
  const fork = maz.forkManifest(normalized, { semanticId: 'asset:organization:fork', version: '1.0.1' });
  assert.notEqual(fork.semanticId, normalized.semanticId);
  assert.equal(fork.provenance.derivedFrom, `${normalized.semanticId}@${normalized.version}`);
  assert.throws(() => maz.forkManifest(normalized, { semanticId: normalized.semanticId, version: '1.0.1' }), /新 semantic identity/);
  const index = { schema: maz.MAZ_INDEX_SCHEMA, semanticId: normalized.semanticId, version: normalized.version, profile: normalized.profile, blocks: [] };
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const signature = maz.createSignature({ manifest: normalized, index, privateKey, signerId: 'human:test-signer' });
  assert.equal(maz.verifySignature({ manifest: normalized, index, signature, publicKey }).valid, true);
  assert.equal(maz.verifySignature({ manifest: { ...normalized, name: 'tampered' }, index, signature, publicKey }).reason, 'SIGNED_CONTENT_TAMPERED');
});

test('W84f Public Envelope / encrypted blocks / Entitlement / Permission 四层严格分权', () => {
  const alice = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const bob = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const payload = maz.encryptPayloadBlocks({ 'payload/workflow.bin': 'sealed workflow', 'payload/review.bin': 'sealed review' }, [{ recipientId: 'user:alice', publicKey: alice.publicKey }]);
  const entitlement = maz.issueEntitlement({ entitlementId: 'ent:alice', subjectId: 'user:alice', blockPaths: ['payload/workflow.bin'], notBefore: '2026-01-01T00:00:00Z', expiresAt: '2030-01-01T00:00:00Z', licenseRef: 'license:commercial' });
  const decrypted = maz.decryptPayloadBlock(payload, { recipientId: 'user:alice', privateKey: alice.privateKey, path: 'payload/workflow.bin', entitlement });
  assert.equal(decrypted.plaintext.toString(), 'sealed workflow');
  assert.equal(decrypted.executionAuthorized, false);
  assert.throws(() => maz.decryptPayloadBlock(payload, { recipientId: 'user:bob', privateKey: bob.privateKey, path: 'payload/workflow.bin', entitlement: { ...entitlement, subjectId: 'user:bob' } }), /KEY_ENVELOPE/);
  assert.throws(() => maz.decryptPayloadBlock(payload, { recipientId: 'user:alice', privateKey: alice.privateKey, path: 'payload/workflow.bin', entitlement: maz.revokeEntitlement(entitlement, 'refund') }), /ENTITLEMENT_DENIED/);
});

test('W84f Key Envelope 轮换不重写大密文，旧 recipient 失权、新 recipient 可解', () => {
  const alice = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const bob = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const payload = maz.encryptPayloadBlocks({ 'payload/capability.bin': 'expert rules' }, [{ recipientId: 'user:alice', publicKey: alice.publicKey }]);
  const ciphertextBefore = JSON.stringify(payload.blocks);
  const rotated = maz.rotateKeyEnvelopes(payload, { sourceRecipientId: 'user:alice', sourcePrivateKey: alice.privateKey, recipients: [{ recipientId: 'org:bob', publicKey: bob.publicKey }] });
  assert.equal(JSON.stringify(rotated.blocks), ciphertextBefore);
  assert.equal(rotated.ciphertextSetDigest, payload.ciphertextSetDigest);
  const entitlement = maz.issueEntitlement({ entitlementId: 'ent:bob', subjectId: 'org:bob', blockPaths: ['payload/capability.bin'], notBefore: '2026-01-01', expiresAt: '2030-01-01', licenseRef: 'license:org' });
  assert.equal(maz.decryptPayloadBlock(rotated, { recipientId: 'org:bob', privateKey: bob.privateKey, path: 'payload/capability.bin', entitlement }).plaintext.toString(), 'expert rules');
});

test('W84f Runtime Permission 独立于解密；sealed capability 保留可见契约与证据', () => {
  const denied = maz.runtimePermissionGate({ profile: 'toolpack', requestedPermissions: ['process:spawn'], grantedPermissions: [], trustedDigest: 'a', currentDigest: 'a' });
  assert.equal(denied.state, 'PERMISSION_DENIED');
  assert.equal(denied.decryptRightImpliesExecution, false);
  const allowed = maz.runtimePermissionGate({ profile: 'toolpack', requestedPermissions: ['process:spawn'], grantedPermissions: ['process:spawn'], trustedDigest: 'same', currentDigest: 'same' });
  const invoked = maz.invokeSealedCapability({ contract: { capabilityId: 'capability:sealed-review', location: 'local-isolate:fixture', inputTypes: ['draft'], outputTypes: ['review'] }, permissionGate: allowed, inputDigest: 'input-sha', executor: () => ({ status: 'reviewed' }) });
  assert.equal(invoked.evidence.contractVisible, true);
  assert.equal(invoked.evidence.implementationVisible, false);
  assert.throws(() => maz.invokeSealedCapability({ contract: { capabilityId: 'x', location: 'x', inputTypes: ['x'], outputTypes: ['y'] }, permissionGate: denied, inputDigest: 'x', executor: () => ({}) }), /DENIED/);
});

test('W84f 质量投影只携版本化聚合，不泄露原始 Production Ledger', () => {
  const aggregate = maz.aggregateQuality([
    { accepted: true, revisions: 1, humanAttentionMinutes: 10, landedCost: 8, failureClass: 'none', rawPrompt: 'secret' },
    { accepted: false, revisions: 3, humanAttentionMinutes: 30, landedCost: 14, failureClass: 'continuity', privateRun: { body: 'secret' } },
  ]);
  assert.equal(aggregate.sampleSize, 2);
  assert.equal(aggregate.acceptanceRate, 0.5);
  assert.equal(aggregate.rawProductionLedgerIncluded, false);
  assert.doesNotMatch(JSON.stringify(aggregate), /rawPrompt|privateRun|secret/);
});

test('W84 产品只读检查入口与 IPC 已装配，不替换 legacy loader', () => {
  const main = fs.readFileSync('main/main.js', 'utf8');
  const preload = fs.readFileSync('preload/bridge.js', 'utf8');
  const ui = fs.readFileSync('renderer/modules/organization/index.js', 'utf8');
  assert.match(main, /new MazAssetService\(\{ bus \}\)/);
  assert.ok(preload.includes("'mazAsset:inspect'") && preload.includes("'mazAsset:migrateStyle'"));
  assert.match(ui, /检查 \.maz/);
  assert.match(fs.readFileSync('renderer/plugins/loader.js', 'utf8'), /trustAndLoad/);
});
