'use strict';

const { createAssetEnvelope } = require('./asset-envelope');
const { normalizeCapabilityProvider } = require('./capability-registry');
const {
  clonePlain,
  isPlainObject,
  optionalString,
  requiredString,
} = require('./plain-value');

const W62D_MINDMAP_ADAPTER = 'mazz.w72b.w62d-mindmap/v0';
const MINDMAP_ASSET_TYPE = 'application/vnd.mazz.mindmap+json';
const MINDMAP_OUTLINE_IMPORT_CAPABILITY = 'mindmap.outline.import';
const MINDMAP_OUTLINE_IMPORT_PROVIDER = 'mazz.mindmap.model.parseOutline';

function validateW62dSourceRef(value) {
  if (!isPlainObject(value)) throw new Error('W62d mindmap document.sourceRef 必须是对象');
  const sourceRef = clonePlain(value, 'document.sourceRef');
  for (const field of ['tabId', 'filePath', 'title']) {
    if (sourceRef[field] != null && typeof sourceRef[field] !== 'string') {
      throw new Error(`document.sourceRef.${field} 必须是字符串`);
    }
  }
  const tabId = optionalString(sourceRef.tabId);
  const filePath = optionalString(sourceRef.filePath);
  requiredString(sourceRef.title, 'document.sourceRef.title');
  if (!tabId && !filePath) throw new Error('document.sourceRef 至少需要 tabId 或 filePath');
  if (!isPlainObject(sourceRef.selection)) throw new Error('document.sourceRef.selection 必须是对象');
  const { from, to } = sourceRef.selection;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    throw new Error('document.sourceRef.selection 必须是有效的正整数区间');
  }
  return sourceRef;
}

function adaptW62dMindmapAsset(input) {
  if (!isPlainObject(input)) throw new Error('W62d Mindmap 适配输入必须是对象');
  if (!isPlainObject(input.document) || !Array.isArray(input.document.roots)) {
    throw new Error('document 必须是已解析的 Mindmap 文档');
  }
  const sourceRef = validateW62dSourceRef(input.document.sourceRef);
  const sourceAssetId = optionalString(input.sourceAssetId);
  const relationProvenance = {
    kind: 'adapter',
    adapter: W62D_MINDMAP_ADAPTER,
  };
  return createAssetEnvelope({
    id: requiredString(input.id, 'id'),
    path: requiredString(input.path, 'path'),
    type: MINDMAP_ASSET_TYPE,
    version: requiredString(input.version, 'version'),
    sourceRef,
    provenance: {
      kind: 'derived',
      producer: 'renderer.modules.markdown.distill-to-mindmap',
      adapter: W62D_MINDMAP_ADAPTER,
    },
    status: optionalString(input.status) || 'active',
    relations: sourceAssetId ? [{
      type: 'derivedFrom',
      targetId: sourceAssetId,
      sourceRef,
      provenance: relationProvenance,
    }] : [],
  });
}

function createMindmapOutlineImportProvider() {
  return normalizeCapabilityProvider({
    capabilityId: MINDMAP_OUTLINE_IMPORT_CAPABILITY,
    providerId: MINDMAP_OUTLINE_IMPORT_PROVIDER,
    displayName: 'Mazz 思维导图大纲导入',
    inputTypes: ['text/markdown', 'text/plain'],
    outputTypes: [MINDMAP_ASSET_TYPE],
    agentUsable: false,
    execution: { mode: 'embedded' },
    cost: { type: 'local', note: '确定性本地解析，不调用外部服务' },
    health: { status: 'unknown', reason: 'W72b 仅登记描述；尚无统一运行时探针' },
    provenance: {
      kind: 'first-party',
      project: 'Mazz Editor',
      source: 'renderer/modules/mindmap/model.js#parseOutline',
      license: 'MIT',
    },
  });
}

function registerW72bSampleCapabilities(registry) {
  if (!registry || typeof registry.register !== 'function') throw new Error('registry.register 必填');
  return registry.register(createMindmapOutlineImportProvider());
}

module.exports = {
  MINDMAP_ASSET_TYPE,
  MINDMAP_OUTLINE_IMPORT_CAPABILITY,
  MINDMAP_OUTLINE_IMPORT_PROVIDER,
  W62D_MINDMAP_ADAPTER,
  adaptW62dMindmapAsset,
  createMindmapOutlineImportProvider,
  registerW72bSampleCapabilities,
  validateW62dSourceRef,
};
