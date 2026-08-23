// renderer/modules/factory/maz.js —— .maz 文体包导入导出（与原版 MazzFactory 格式互通）
// .maz = zip{definition.json, prompt.txt, meta.json, chapter_guide.txt?, rules/checks.json?}
import JSZip from 'jszip';
import { saveCustomGenre } from './engine.js';

/** 导出文体为 .maz（返回 Blob，供下载/落盘） */
export async function exportMaz(tpl) {
  const zip = new JSZip();
  const definition = {
    name: tpl.name,
    description: tpl.description || '',
    input_fields: tpl.input_fields || [],
  };
  zip.file('definition.json', JSON.stringify(definition, null, 2));
  zip.file('prompt.txt', tpl.system_prompt || '你是一名资深写作专家。');
  zip.file('meta.json', JSON.stringify({
    name: tpl.name, key: tpl.id, version: '1.0', author: 'Mazz Editor',
    description: tpl.description || '', icon: tpl.icon || '📄', mazz_version: '1.0',
  }, null, 2));
  if (tpl.quality_checks?.length) {
    zip.file('rules/checks.json', JSON.stringify(tpl.quality_checks, null, 2));
  }
  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** 导入 .maz → 存为工作区自定义文体，返回文体对象 */
export async function importMaz(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const defFile = zip.file('definition.json');
  if (!defFile) throw new Error('包内缺少 definition.json');
  const definition = JSON.parse(await defFile.async('string'));
  if (!definition?.name || !Array.isArray(definition.input_fields)) throw new Error('definition.json 结构不合法');
  const prompt = zip.file('prompt.txt') ? await zip.file('prompt.txt').async('string') : '';
  let checks = [];
  try {
    const cf = zip.file('rules/checks.json');
    if (cf) {
      let raw = JSON.parse(await cf.async('string'));
      if (!Array.isArray(raw)) raw = raw?.rules || []; // 原版为 {rules:[...]} dict
      checks = raw.map(c => {
        if (c?.label && c?.rule) return c; // 已是本格式
        // 原版 {type, description} → 映射为提示型校验（default 规则恒过，仅入母版清单）
        return { label: c?.description || String(c?.type || '校验项'), rule: 'none' };
      }).filter(c => c.label);
    }
  } catch {}
  // 原版字段类型映射：textarea/select/text 直通，其余（style_ref/template_selector 等）降级 text
  const fields = definition.input_fields.map(f => ({
    id: String(f.id || f.label),
    label: f.label || String(f.id),
    type: ['text', 'textarea', 'select'].includes(f.type) ? f.type : (f.type === 'number' ? 'text' : 'textarea'),
    required: !!f.required,
    options: Array.isArray(f.options) ? f.options : undefined,
    placeholder: f.placeholder || '',
    default: f.default != null ? String(f.default) : undefined,
  }));
  const tpl = {
    id: 'maz_' + String(definition.name).replace(/[^\w一-龥]/g, '_').slice(0, 30),
    name: definition.name,
    description: definition.description || '',
    input_fields: fields,
    system_prompt: prompt.trim() || '你是一名资深写作专家。',
    meta_vars: {},
    output_rules: { format: 'markdown' },
    quality_checks: checks,
    custom: true, fromMaz: true,
  };
  await saveCustomGenre(tpl);
  return tpl;
}
