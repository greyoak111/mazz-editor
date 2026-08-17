import { createRequire } from 'node:module';
import fs from 'node:fs';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  ASSET_ENVELOPE_SCHEMA,
  createAssetEnvelope,
  isAssetEnvelope,
} = require('../../main/foundation/asset-envelope.js');
const {
  CAPABILITY_PROVIDER_SCHEMA,
  CapabilityRegistry,
  normalizeCapabilityProvider,
} = require('../../main/foundation/capability-registry.js');

function provider(providerId, overrides = {}) {
  return {
    capabilityId: 'image.edit',
    providerId,
    displayName: providerId,
    inputTypes: ['image'],
    outputTypes: ['image'],
    agentUsable: true,
    execution: { mode: 'embedded' },
    cost: { type: 'local' },
    health: { status: 'unknown' },
    provenance: { kind: 'first-party', project: 'Mazz Editor', license: 'MIT' },
    ...overrides,
  };
}

describe('W72 Asset Envelope v0', () => {
  test('薄包络保留既有 sourceRef，不改写领域内容或文件路径', () => {
    const sourceRef = { filePath: 'D:/docs/source.md', title: 'source.md', selection: { from: 2, to: 9 } };
    const input = {
      id: 'asset:mindmap:alpha', path: 'maps/alpha.mm.json', type: 'mindmap', version: '7',
      sourceRef, provenance: { kind: 'derived', tool: 'markdown.distill' }, status: 'active',
      relations: [{ type: 'derivedFrom', targetId: 'asset:markdown:source', sourceRef }],
    };
    const envelope = createAssetEnvelope(input);
    assert.equal(envelope.schema, ASSET_ENVELOPE_SCHEMA);
    assert.deepEqual(envelope.sourceRef, sourceRef);
    assert.deepEqual(envelope.relations[0].sourceRef, sourceRef);
    input.sourceRef.selection.from = 99;
    assert.equal(envelope.sourceRef.selection.from, 2, '包络必须与调用方可变对象隔离');
    assert.equal(Object.isFrozen(envelope), true);
    assert.equal(Object.isFrozen(envelope.sourceRef), true);
  });

  test('semantic id 不从 path 派生，重命名不强迫身份变化', () => {
    const base = { id: 'asset:doc:stable', type: 'text.markdown', version: '1', sourceRef: null, provenance: { kind: 'user' }, status: 'active' };
    const before = createAssetEnvelope({ ...base, path: 'before.md' });
    const after = createAssetEnvelope({ ...base, path: 'renamed/after.md', version: '2' });
    assert.equal(before.id, after.id);
    assert.notEqual(before.path, after.path);
  });

  test('缺少身份/来源或偷塞万能字段会被拒绝', () => {
    assert.throws(() => createAssetEnvelope({}), /id 必填/);
    assert.throws(() => createAssetEnvelope({ id: 'a', path: 'a', type: 'text', version: '1', status: 'active' }), /provenance/);
    assert.throws(() => createAssetEnvelope({
      id: 'a', path: 'a', type: 'text', version: '1', provenance: {}, status: 'active', universalPayload: {},
    }), /未冻结字段/);
    assert.throws(() => createAssetEnvelope({
      id: 'a', path: 'a', type: 'text', version: '1', provenance: {}, status: 'active',
      relations: [{ type: 'relatedTo', targetId: 'b', embeddedAsset: { body: '禁止塞正文' } }],
    }), /未冻结字段/);
    assert.throws(() => createAssetEnvelope({
      id: 'a', path: 'a', type: 'text', version: '1', provenance: { score: Number.NaN }, status: 'active',
    }), /NaN/);
    assert.equal(isAssetEnvelope({ schema: 'wrong' }), false);
  });
});

describe('W72 Capability Registry v0', () => {
  test('同一 capability 可登记多个 provider，身份是 capability/provider 二元组', () => {
    const registry = new CapabilityRegistry();
    registry.register(provider('canvas'));
    registry.register(provider('remote-api', {
      execution: { mode: 'service' }, cost: { type: 'api' }, health: { status: 'available', checkedAt: '2026-08-17T00:00:00Z' },
      provenance: { kind: 'external', project: 'Remote Image API', version: '1', license: 'service-terms' },
    }));
    assert.deepEqual(registry.list('image.edit').map(item => item.providerId), ['canvas', 'remote-api']);
    assert.deepEqual(registry.candidates('image.edit', { executionMode: 'service', health: 'available' }).map(item => item.providerId), ['remote-api']);
    assert.throws(() => registry.register(provider('canvas')), /重复/);
  });

  test('health 是显式快照，Registry 不替 Factory 做自动路由', () => {
    const registry = new CapabilityRegistry();
    registry.register(provider('canvas'));
    const updated = registry.setHealth('image.edit', 'canvas', { status: 'degraded', reason: 'GPU fallback' });
    assert.equal(updated.health.status, 'degraded');
    assert.equal(registry.get('image.edit', 'canvas').health.reason, 'GPU fallback');
    assert.equal(typeof registry.resolve, 'undefined');
    assert.equal(typeof registry.execute, 'undefined');
  });

  test('Descriptor 是纯数据，不吞并 Agent Harness 或 Tool Adapter 生命周期', () => {
    const normalized = normalizeCapabilityProvider(provider('canvas'));
    assert.equal(normalized.schema, CAPABILITY_PROVIDER_SCHEMA);
    assert.equal(Object.isFrozen(normalized), true);
    assert.throws(() => normalizeCapabilityProvider(provider('bad', { detect() {} })), /未冻结字段/);
    assert.throws(() => normalizeCapabilityProvider(provider('bad-bool', { agentUsable: 'yes' })), /布尔值/);
    const registrySource = fs.readFileSync(new URL('../../main/foundation/capability-registry.js', import.meta.url), 'utf8');
    assert.doesNotMatch(registrySource, /agent-harness|createSession|runScript|spawnSync|child_process/);
  });
});
