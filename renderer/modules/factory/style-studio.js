// renderer/modules/factory/style-studio.js —— 文风分析器（移植自原版 core/style_analyzer.py）
// 上传文件 → 提取文本 → AI 六维分析入库；在线输入作家/作品 → AI 回忆分析入库；
// 任务引用若干素材 → assembleStylePackage 组装进蓝图/章节 prompt
const STORE_KEY = 'mazz.factory.styles';
const MAX_CHARS_PER_FILE = 8000;
const MAX_ANALYSIS_LENGTH = 600;

async function loadIndex() {
  return (await window.mazz.invoke('settings:get', { key: STORE_KEY }).catch(() => null)) || [];
}
async function saveIndex(list) {
  await window.mazz.invoke('settings:set', { key: STORE_KEY, value: list });
}

export async function listStyles() { return loadIndex(); }

export async function deleteStyle(id) {
  const list = await loadIndex();
  await saveIndex(list.filter(r => r.id !== id));
}

/** 提取文件纯文本：txt/md 直读；docx/odt/rtf/html/epub 走主进程 pandoc */
export async function extractText(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (['txt', 'md', 'markdown', 'csv', 'log'].includes(ext)) {
    return await window.mazz.invoke('fs:readFile', { path });
  }
  if (['docx', 'odt', 'rtf', 'html', 'htm', 'epub'].includes(ext)) {
    return await window.mazz.invoke('factory:extractText', { path });
  }
  throw new Error(`不支持的格式 .${ext}（支持 txt/md/docx/odt/rtf/html/epub）`);
}

/** 六维文风分析（句式/词汇/修辞/节奏/对话/气质，≤600字） */
async function analyzeStyle(chatFn, sample, note = '') {
  const noteHint = note ? `\n用户描述：${note}\n` : '';
  return await chatFn({
    system: '你是文学风格分析专家。请简洁准确地分析。',
    user: `分析以下文本的写作风格。${noteHint}

文本样本：
---
${sample.slice(0, 3000)}
---

从以下维度分析（总共不超过${MAX_ANALYSIS_LENGTH}字）：
1. 句式节奏 2. 用词特点 3. 修辞偏好 4. 叙事距离（旁观/沉浸/跳跃）5. 3-5个关键词概括`,
    temperature: 0.4, maxTokens: 1200,
  });
}

function mkId(seed) {
  let h = 0;
  const s = seed + Date.now();
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return 'st' + Math.abs(h).toString(36);
}

/** 上传本地文件为文风素材（chatFn 可为空：仅存文本不分析） */
export async function uploadStyleFile({ path, note = '', chatFn }) {
  let text = await extractText(path);
  if (!text?.trim()) throw new Error('文件内容为空或无法提取文本');
  if (text.length > MAX_CHARS_PER_FILE) text = text.slice(0, MAX_CHARS_PER_FILE) + '\n\n[文本过长，已截断至前8000字]';
  const name = path.split(/[\\/]/).pop();
  const entry = {
    id: mkId(path), type: 'local', label: `📄 ${name}`,
    text, textPreview: text.slice(0, 200).replace(/\n/g, ' '),
    charCount: text.length, note: note.trim(), analysis: '', createdAt: Date.now(),
  };
  if (chatFn) {
    try { entry.analysis = await analyzeStyle(chatFn, text, note); } catch { /* 分析失败仅存文本 */ }
  }
  const list = await loadIndex();
  list.unshift(entry);
  await saveIndex(list);
  return entry;
}

/** W62f：把网页对话中的选定消息直接登记为文风素材；不额外消耗模型额度。 */
export async function saveStyleText({ label = 'AI 对话', text, note = '', sourceUrl = '' }) {
  let sample = String(text || '').trim();
  if (!sample) throw new Error('没有可加入文风素材的文字');
  if (sample.length > MAX_CHARS_PER_FILE) sample = sample.slice(0, MAX_CHARS_PER_FILE) + '\n\n[文本过长，已截断至前8000字]';
  const entry = {
    id: mkId(sourceUrl || label),
    type: 'harvest',
    label: `💬 ${String(label || 'AI 对话').trim()}`,
    text: sample,
    textPreview: sample.slice(0, 200).replace(/\n/g, ' '),
    charCount: sample.length,
    note: String(note || '').trim(),
    sourceUrl: String(sourceUrl || ''),
    analysis: '',
    createdAt: Date.now(),
  };
  const list = await loadIndex();
  list.unshift(entry);
  await saveIndex(list);
  return entry;
}

/** 在线作家/作品风格查询（AI 回忆分析，无需联网） */
export async function queryOnlineStyle({ authorWork, note = '', chatFn }) {
  if (!authorWork.trim()) throw new Error('请输入作家/作品信息');
  const analysis = await chatFn({
    system: '你是专业的文学风格分析师。',
    user: `你是一位文学风格分析师。请回顾以下作家/作品的风格特征。

目标：${authorWork}

请从以下维度分析（每个维度2-4句话，总共不超过${MAX_ANALYSIS_LENGTH}字）：
1. 句式特征：句长偏好、复合句使用、断句节奏
2. 词汇偏好：高频词类、独特用词、口语/书面语倾向
3. 修辞手法：常用修辞类型、意象系统
4. 叙事节奏：快慢交替方式、留白与密集描写的比例
5. 对话风格：对话占比、对话功能、角色语言区分度
6. 整体气质：3-5个关键词概括`,
    temperature: 0.5, maxTokens: 1200,
  });
  const entry = {
    id: mkId(authorWork), type: 'online', label: `🌐 ${authorWork.trim()}`,
    authorWork: authorWork.trim(), note: note.trim(), analysis: analysis.trim(), createdAt: Date.now(),
  };
  const list = await loadIndex();
  const i = list.findIndex(r => r.type === 'online' && r.authorWork === entry.authorWork);
  if (i >= 0) list[i] = entry; else list.unshift(entry);
  await saveIndex(list);
  return entry;
}

/** 组装文风包（注入蓝图/章节 prompt）；traditional = 用户手填的文风学习对象 */
export function assembleStylePackage({ traditional = '', styleIds = [], styles = [] }) {
  const parts = [];
  if (traditional.trim()) parts.push(`## 用户指定的文风参照\n${traditional.trim()}`);
  for (const id of styleIds) {
    const ref = styles.find(r => r.id === id);
    if (!ref) continue;
    parts.push(`\n### 素材: ${ref.label}`);
    if (ref.note) parts.push(`**用户说明**: ${ref.note}`);
    if (ref.analysis) parts.push(`**风格分析**:\n${ref.analysis}`);
    if (ref.type === 'local' && ref.text) parts.push(`**原文片段**:\n\`\`\`\n${ref.text.slice(0, 1500)}\n\`\`\``);
  }
  return parts.length ? parts.join('\n\n') : '（未提供文风参考素材，请根据核心信息和创作倾向自由发挥文风。）';
}
