// renderer/lib/ai-translate.js —— AI 翻译引擎（复用智能创作 Provider；独立提示词工程）
// 优先级：AI（配置就绪时）> MyMemory/LibreTranslate（免费引擎兜底）
import { getProviderConfig, providerReady, chat } from '../modules/factory/provider.js';

function looksChinese(s) { return /[一-鿿]/.test(s); }

/** 翻译提示词工程（可按需自定义覆盖 settings 'mazz.translate.sysPrompt'） */
export function buildTranslatePrompts({ source, target, text, chunk, sysOverride }) {
  const langName = (l) => ({ 'zh-CN': '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', ru: '俄语' }[l] || l);
  const original = String(text ?? chunk ?? '');
  const system = sysOverride || `你是一名顶级专业翻译家（${langName(source)} → ${langName(target)}）。

【铁律】
1. 只输出译文本身——绝不解释、不评论、不复述要求、不加"以下是译文"之类前言
2. 完整保留原文格式：Markdown 标记、HTML 标签、代码块内容、URL、变量名、{占位符} 一律原样不动
3. 信达雅：先准确再通顺；术语全文统一；人名地名用通行译法
4. 文体适配：技术文档精准干练、文学文本保留文采、对话口语自然
5. 数字、度量单位、专有名词保持原样或采用通行译法
6. 绝不遗漏任何内容，绝不自行发挥增补`;
  const user = `【原文】
${original}

【译文】（只输出译文）`;
  return { system, user };
}

/** 读取自定义提示词（settings），无则用内置 */
async function getSysOverride() {
  try {
    const v = await window.mazz.invoke('settings:get', { key: 'mazz.translate.sysPrompt' });
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch { return null; }
}

/**
 * AI 翻译主入口
 * @returns {{text, engine: 'ai'} | null} AI 不可用（未配置 Provider）时返回 null，调用方回落免费引擎
 */
export async function aiTranslate({ text, from = 'auto', to = '' }) {
  const cfg = await getProviderConfig('translation');
  if (!providerReady(cfg)) return null;
  const original = String(text ?? '');
  const source = from === 'auto' ? (looksChinese(original) ? 'zh-CN' : 'en') : from;
  const target = to || (source.startsWith('zh') ? 'en' : 'zh-CN');
  if (!original.trim()) return { text: original, engine: 'ai', from: source, to: target };
  const sysOverride = await getSysOverride();
  const prompts = buildTranslatePrompts({ source, target, text: original, sysOverride });
  const translated = await chat({ cfg, role: 'translation', system: prompts.system, user: prompts.user, temperature: 0.3 });
  return { text: String(translated ?? ''), engine: 'ai', from: source, to: target };
}
