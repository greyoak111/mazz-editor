// renderer/ai/context.js —— 标准化上下文协议：getContext(scope) → 选区/文档/项目
// AI 引擎与模块之间的唯一数据通道（预留）
import { contextKeys } from '../core/contextkey-service.js';
import { modules } from '../core/module-registry.js';

/**
 * @param {'selection'|'document'|'project'} scope
 * @returns {Promise<{scope, module, text, filePath?, meta}>}
 */
export async function getContext(scope = 'selection') {
  const moduleName = contextKeys.get('module');
  const result = { scope, module: moduleName, text: '', meta: {} };
  // 通过活动标签实例取数（由 shell 维护 instances）
  for (const inst of modules.instances.values()) {
    if (inst.name !== moduleName) continue;
    if (scope === 'selection' && typeof inst.def.getSelection === 'function') {
      result.text = inst.def.getSelection(inst.state) || '';
    }
    if (!result.text && (scope === 'document' || scope === 'selection')) {
      result.text = inst.def.getContent(inst.state) || '';
    }
    break;
  }
  if (scope === 'project') {
    result.text = ''; // 项目级上下文（工作区索引）随全局搜索阶段落地
    result.meta.note = 'project scope reserved';
  }
  return result;
}
