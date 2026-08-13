// renderer/lib/ai-translate.js —— AI 翻译引擎（复用智能创作 Provider；独立提示词工程）
// 优先级：AI（配置就绪时）> MyMemory/LibreTranslate（免费引擎兜底）
import { getProviderConfig, providerReady, chat } from '../modules/factory/provider.js';

const CHUNK = 2400; // 单块上限（长文切块，块间术语衔接）

function looksChinese(s) { return /[一-鿿]/.test(s); }

function chunkText(text, size = CHUNK) {
  const parts = [];
  let rest = String(text);
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.3) cut = size;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) parts.push(rest);
  return parts;
}

/** 翻译提示词工程（可按需自定义覆盖 settings 'mazz.translate.sysPrompt'） */
export function buildTranslatePrompts({ source, target, chunk, index, total, glossary, sysOverride }) {
  const langName = (l) => ({ 'zh-CN': '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', ru: '俄语' }[l] || l);
  const system = sysOverride || `你是一名顶级专业翻译家（${langName(source)} → ${langName(target)}）。

【铁律】
1. 只输出译文本身——绝不解释、不评论、不复述要求、不加"以下是译文"之类前言
2. 完整保留原文格式：Markdown 标记、HTML 标签、代码块内容、URL、变量名、{占位符} 一律原样不动
3. 信达雅：先准确再通顺；术语全文统一；人名地名用通行译法
4. 文体适配：技术文档精准干练、文学文本保留文采、对话口语自然
5. 数字、度量单位、专有名词保持原样或采用通行译法
6. 绝不遗漏任何内容，绝不自行发挥增补`;
  const user = `${total > 1 ? `【翻译任务 ${index + 1}/${total}：长文分段，请与前后文保持术语与语气一致】\n` : ''}${glossary ? `【上文结尾参考（不要翻译它）】\n${glossary}\n\n` : ''}【原文】
${chunk}

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
  const source = from === 'auto' ? (looksChinese(text) ? 'zh-CN' : 'en') : from;
  const target = to || (source.startsWith('zh') ? 'en' : 'zh-CN');
  const sysOverride = await getSysOverride();
  const chunks = chunkText(text);
  const out = [];
  let glossary = '';
  for (let i = 0; i < chunks.length; i++) {
    const prompts = buildTranslatePrompts({ source, target, chunk: chunks[i], index: i, total: chunks.length, glossary, sysOverride });
    const r = await chat({ cfg, role: 'translation', system: prompts.system, user: prompts.user, temperature: 0.3 });
    out.push(r.trim());
    // 上文结尾 200 字作下一块的术语/语气衔接
    glossary = r.trim().slice(-200);
  }
  return { text: out.join('\n'), engine: 'ai', from: source, to: target };
}
