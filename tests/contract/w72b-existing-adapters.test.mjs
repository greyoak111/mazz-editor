import { createRequire } from 'node:module';
import fs from 'node:fs';
import { describe, test, assert } from '../harness.mjs';
import { createNode, parseDoc, parseOutline, serializeDoc } from '../../renderer/modules/mindmap/model.js';

const require = createRequire(import.meta.url);
const { CapabilityRegistry } = require('../../main/foundation/capability-registry.js');
const {
  MINDMAP_ASSET_TYPE,
  MINDMAP_OUTLINE_IMPORT_CAPABILITY,
  MINDMAP_OUTLINE_IMPORT_PROVIDER,
  W62D_MINDMAP_ADAPTER,
  adaptW62dMindmapAsset,
  createMindmapOutlineImportProvider,
  registerW72bSampleCapabilities,
} = require('../../main/foundation/existing-adapters.js');

function reopenedW62dDocument() {
  const sourceRef = {
    tabId: 'tab-source',
    filePath: 'D:/workspace/source.md',
    title: 'source.md',
    selection: { from: 2, to: 19 },
  };
  const root = createNode('来源根', 'root');
  root.sourceRef = sourceRef;
  return parseDoc(serializeDoc({ mode: 'lr', scheme: 0, roots: [root], sourceRef }));
}

describe('W72b W62d Mindmap Asset Adapter', () => {
  test('真实 Mindmap 保存/重开结构投影成薄包络，正文不进入 Envelope', () => {
    const document = reopenedW62dDocument();
    const envelope = adaptW62dMindmapAsset({
      id: 'asset:mindmap:distilled-001',
      path: 'maps/distilled-001.mindmap',
      version: '4:sha256-example',
      document,
    });
    assert.equal(envelope.type, MINDMAP_ASSET_TYPE);
    assert.deepEqual(envelope.sourceRef, document.sourceRef);
    assert.equal(envelope.provenance.adapter, W62D_MINDMAP_ADAPTER);
    assert.equal('roots' in envelope, false, 'Asset Envelope 不得复制 Mindmap 正文');
    document.sourceRef.selection.from = 99;
    assert.equal(envelope.sourceRef.selection.from, 2, '投影必须与领域文档可变态隔离');
    assert.deepEqual(envelope.relations, [], '没有稳定来源 ID 时不得从 filePath 伪造关系');
  });

  test('调用方提供稳定来源 ID 时才生成 derivedFrom 关系', () => {
    const document = reopenedW62dDocument();
    const envelope = adaptW62dMindmapAsset({
      id: 'asset:mindmap:distilled-002',
      path: 'maps/distilled-002.mindmap',
      version: '4:2',
      document,
      sourceAssetId: 'asset:markdown:source-001',
    });
    assert.equal(envelope.relations.length, 1);
    assert.equal(envelope.relations[0].type, 'derivedFrom');
    assert.equal(envelope.relations[0].targetId, 'asset:markdown:source-001');
    assert.deepEqual(envelope.relations[0].sourceRef, document.sourceRef);
  });

  test('只接受可回跳的 W62d 来源，不猜测缺失身份或选区', () => {
    const document = reopenedW62dDocument();
    assert.throws(() => adaptW62dMindmapAsset({ id: 'a', path: 'a.mindmap', version: '1', document: { roots: [] } }), /sourceRef/);
    assert.throws(() => adaptW62dMindmapAsset({
      id: 'a', path: 'a.mindmap', version: '1',
      document: { roots: [], sourceRef: { title: 'source.md', selection: { from: 1, to: 2 } } },
    }), /tabId 或 filePath/);
    assert.throws(() => adaptW62dMindmapAsset({
      id: 'a', path: 'a.mindmap', version: '1',
      document: { roots: [], sourceRef: { filePath: {}, title: 'source.md', selection: { from: 1, to: 2 } } },
    }), /filePath 必须是字符串/);
    document.sourceRef.selection.to = 0;
    assert.throws(() => adaptW62dMindmapAsset({ id: 'a', path: 'a.mindmap', version: '1', document }), /正整数区间/);
  });
});

describe('W72b First-party Capability Sample', () => {
  test('登记本地大纲导入描述，但不冒充 Agent 可调用能力', () => {
    const provider = createMindmapOutlineImportProvider();
    assert.equal(provider.capabilityId, MINDMAP_OUTLINE_IMPORT_CAPABILITY);
    assert.equal(provider.providerId, MINDMAP_OUTLINE_IMPORT_PROVIDER);
    assert.equal(provider.execution.mode, 'embedded');
    assert.equal(provider.cost.type, 'local');
    assert.equal(provider.agentUsable, false);
    assert.equal(provider.health.status, 'unknown');
    assert.match(provider.provenance.source, /mindmap\/model\.js#parseOutline/);
  });

  test('描述对应现有确定性实现，Registry 只登记且可撤销', () => {
    const roots = parseOutline('# 主题\n- 分支甲\n  - 子项\n- 分支乙');
    assert.equal(roots[0].text, '主题');
    assert.deepEqual(roots[0].children.map(node => node.text), ['分支甲', '分支乙']);
    const registry = new CapabilityRegistry();
    const unregister = registerW72bSampleCapabilities(registry);
    assert.deepEqual(registry.list(MINDMAP_OUTLINE_IMPORT_CAPABILITY).map(item => item.providerId), [MINDMAP_OUTLINE_IMPORT_PROVIDER]);
    assert.equal(unregister(), true);
    assert.deepEqual(registry.list(MINDMAP_OUTLINE_IMPORT_CAPABILITY), []);
  });

  test('适配层不接 UI、Factory、Agent Harness 或外部进程', () => {
    const source = fs.readFileSync(new URL('../../main/foundation/existing-adapters.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /electron|ipc|factory|agent-harness|child_process|spawn|execFile|fetch\s*\(/i);
    assert.doesNotMatch(source, /readFile|writeFile|sqlite|indexedDB/i);
  });
});
