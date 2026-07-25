// renderer/modules/factory/engine.js —— 焚诀引擎：用规则生成规则
// 文体模板 + 用户需求 → 完整创作焚诀（提示词）→（可选）直接调 AI 生成 → 质量校验
import gongwen from './genres/gongwen.js';
import caiwu from './genres/caiwu.js';
import xiaoshuo from './genres/xiaoshuo.js';
import jiaoan from './genres/jiaoan.js';
import tongyong from './genres/tongyong.js';

const BUILTIN = [gongwen, caiwu, xiaoshuo, jiaoan, tongyong];

/** 全部文体：预置 + 工作区自定义（factory-genres/*.json） */
export async function listGenres() {
  const customs = [];
  try {
    const ws = await window.mazz.invoke('workspace:get');
    const dir = `${ws}/factory-genres`;
    const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
    for (const e of entries) {
      if (e.isDir || !e.name.endsWith('.json')) continue;
      try {
        const obj = JSON.parse(await window.mazz.invoke('fs:readFile', { path: e.path }));
        if (obj?.name && obj?.input_fields) customs.push({ ...obj, id: obj.id || e.name.replace(/\.json$/i, ''), custom: true });
      } catch {}
    }
  } catch {}
  return [...BUILTIN, ...customs];
}

/** 保存自定义文体（工作区 factory-genres/，同步随行） */
export async function saveCustomGenre(tpl) {
  const ws = await window.mazz.invoke('workspace:get');
  const dir = `${ws}/factory-genres`;
  await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
  const safe = String(tpl.name || '未命名文体').replace(/[\\/:*?"<>|]/g, '-');
  await window.mazz.invoke('fs:writeFile', { path: `${dir}/${safe}.json`, content: JSON.stringify(tpl, null, 2) });
  return `${dir}/${safe}.json`;
}

/** 字段标签→值 的读取辅助 */
export function fieldValue(tpl, values, ...idsOrLabels) {
  for (const k of idsOrLabels) {
    const v = values[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

/**
 * 组装完整创作焚诀（生成提示词阶段的产物，也是直接生成时的 system+user 蓝本）
 * 结构遵循元焚诀：需求痛点 → 核心契约 → 文体规范（元变量）→ 结构蓝图（篇幅预算）→ 维度规则 → 校验 → 启动指令
 */
export function buildMantra(tpl, values, dumpText = '') {
  const fieldLines = tpl.input_fields
    .map(f => `- **${f.label}**：${values[f.id]?.trim() || '（未填）'}`)
    .join('\n');
  const mv = tpl.meta_vars || {};
  const mvLines = Object.entries(mv).map(([k, v]) => `- **${k}**：${v}`).join('\n');
  const checks = (tpl.quality_checks || []).map((c, i) => `${i + 1}. ${c.label}`).join('\n');
  const out = tpl.output_rules || {};
  const lenText = fieldValue(tpl, values, 'length', '篇幅') || `不超过 ${out.max_length || 3000} 字`;
  const contract = buildContract(tpl, values);
  const dimensionBlock = buildDimensions(tpl);

  return {
    // 直接生成时的 system prompt（角色 + 元变量 + 规则）
    system: `${tpl.system_prompt}

【本次创作必须遵守的元变量】
${mvLines}

【输出要求】
- 输出格式：${out.format || 'markdown'}；结构：${out.structure || '清晰分层'}
- 篇幅：${lenText}
- 只输出正文本身，不要解释、不要客套、不要复述要求`,
    // 直接生成时的 user prompt（任务 + 素材 + 契约 + 校验）
    user: `【文体】${tpl.name}（${tpl.description || ''}）

【已确认的要素】
${fieldLines}
${dumpText.trim() ? `\n【补充素材（竹筒倒豆子）】\n${dumpText.trim()}\n` : ''}
【核心契约（不可违反）】
${contract}

【结构蓝图（含篇幅预算）】
${dimensionBlock.blueprint}

【创作启动指令】
现在开始创作《${fieldValue(tpl, values, 'title', 'subject', 'task', 'premise') || tpl.name}》。按结构蓝图分配篇幅，逐段写透，禁止用总结句代替展开，禁止偷工减料。写完后自检以下校验项全部通过再输出：
${checks}`,
    // 给用户复制走的完整创作模板母版（markdown 文档形态）
    doc: `# ${tpl.name} 创作模板母版

## 一、需求与要素
${fieldLines}
${dumpText.trim() ? `\n## 补充素材\n${dumpText.trim()}\n` : ''}
## 二、核心契约（铁律）
${contract}

## 三、文体与风格规范（元变量）
${mvLines}

## 四、结构蓝图与篇幅预算
${dimensionBlock.blueprint}

## 五、核心维度执行规则
${dimensionBlock.rules}

## 六、质量校验清单（输出前逐项自检）
${checks}

## 七、创作启动指令
你是一名按上述规范写作的专家。请基于本焚诀创作《${fieldValue(tpl, values, 'title', 'subject', 'task', 'premise') || tpl.name}》，篇幅 ${lenText}，从结构蓝图的第一部分开始逐段写透，写完逐项通过第六节校验后只输出正文。`,
  };
}

/** 核心契约：模板校验项 + 必填要素转铁律 */
function buildContract(tpl, values) {
  const lines = [];
  for (const f of tpl.input_fields) {
    if (f.required) lines.push(`- 「${f.label}」必须准确呈现，不得遗漏或篡改。`);
  }
  for (const c of (tpl.quality_checks || []).slice(0, 3)) lines.push(`- ${c.label}。`);
  const avoid = values.must_avoid?.trim();
  if (avoid) lines.push(`- 绝对避免：${avoid.replace(/\n/g, '；')}。`);
  return lines.join('\n') || '- 不写空话套话。';
}

/** 维度规则：从模板维度池生成执行规则与结构蓝图 */
function buildDimensions(tpl) {
  const out = tpl.output_rules || {};
  const structure = (out.structure || '开头 → 主体 → 结尾').split('→').map(s => s.trim()).filter(Boolean);
  const parts = structure.map((s, i) => `| ${s} | 约 ${Math.round(100 / structure.length)}% | ${i === 0 ? '开宗明义' : i === structure.length - 1 ? '收束有力' : '充分展开'} |`).join('\n');
  const blueprint = `${out.structure || '清晰分层'}；预算：${out.max_length || 3000} 字以内

| 部分 | 篇幅占比 | 要求 |
| --- | --- | --- |
${parts}`;
  const rules = [
    `### 结构骨架（优先级: 高）\n- 怎么做：严格按结构蓝图推进，每部分篇幅不低于预算 70%。\n- 不要做：跳段、合并压缩、用一句话总结代替展开。\n- 自检：遮住标题能说出每段在结构中的位置。`,
    `### 受众适配（优先级: 高）\n- 怎么做：每写一段自问「目标读者读到这句会怎么想」。\n- 不要做：自嗨、堆术语无解释、忽视读者既有认知。\n- 自检：读者能否不费力地复述核心信息。`,
    `### 语言质地（优先级: 中）\n- 怎么做：动词优先、短句优先、具体优先。\n- 不要做：形容词堆砌、长句嵌套、空话套话。\n- 自检：每句都有不可替代的信息量。`,
  ].join('\n\n');
  return { blueprint, rules };
}

// ==================== 质量校验 ====================
/** 执行校验：返回 [{label, pass, detail}] */
export function runQualityChecks(tpl, text) {
  const t = String(text || '');
  const paragraphs = t.split(/\n\s*\n/).filter(p => p.trim());
  const results = [];
  for (const c of tpl.quality_checks || []) {
    let pass = true, detail = '';
    switch (c.rule) {
      case 'startsWith': {
        const first = t.trim().split('\n')[0] || '';
        pass = first.trimStart().startsWith(c.value);
        detail = pass ? '' : `首行是「${first.slice(0, 20)}…」`;
        break;
      }
      case 'contains':
        pass = t.includes(c.value);
        detail = pass ? '' : `未找到「${c.value}」`;
        break;
      case 'containsNumber':
        pass = /\d/.test(t);
        detail = pass ? '' : '全文没有任何数字';
        break;
      case 'maxLength':
        pass = t.length <= c.value;
        detail = pass ? '' : `当前 ${t.length} 字`;
        break;
      case 'minLength':
        pass = t.length >= c.value;
        detail = pass ? '' : `当前仅 ${t.length} 字`;
        break;
      case 'maxParagraphs':
        pass = paragraphs.length <= c.value;
        detail = pass ? '' : `当前 ${paragraphs.length} 段`;
        break;
      case 'forbiddenWords': {
        const hit = (c.value || []).filter(w => t.includes(w));
        pass = !hit.length;
        detail = pass ? '' : `命中：${hit.join('、')}`;
        break;
      }
      case 'notAllDialog': {
        const dialogLines = t.split('\n').filter(l => /^\s*[「"“]/.test(l)).length;
        const total = t.split('\n').filter(l => l.trim()).length || 1;
        pass = dialogLines / total < 0.6;
        detail = pass ? '' : '对话占比过高';
        break;
      }
      default:
        pass = true;
    }
    results.push({ label: c.label, pass, detail });
  }
  return results;
}

// ==================== 批量任务 CSV 解析 ====================
/** CSV → [{fieldId: value}]（首行表头对应模板字段 label 或 id；支持引号内换行与 "" 转义） */
export function parseCsvTasks(text, tpl) {
  // 整体逐字符解析：引号内换行/逗号都不算分隔
  const rows = [];
  let cur = '', inQ = false, row = [];
  const src = String(text || '');
  const pushCell = () => { row.push(cur.trim()); cur = ''; };
  const pushRow = () => { pushCell(); if (row.some(c => c !== '')) rows.push(row); row = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',' || ch === '\t') pushCell();
    else if (ch === '\n') pushRow();
    else if (ch === '\r') { /* 忽略 */ }
    else cur += ch;
  }
  pushRow();
  if (rows.length < 2) throw new Error('CSV 至少需要表头 + 一行数据');
  const headers = rows[0];
  const colToField = headers.map(h => {
    const f = tpl.input_fields.find(x => x.label === h || x.id === h);
    return f ? f.id : null;
  });
  const tasks = [];
  for (const cols of rows.slice(1)) {
    const values = {};
    cols.forEach((v, i) => { if (colToField[i]) values[colToField[i]] = v; });
    if (Object.keys(values).length) tasks.push(values);
  }
  return tasks;
}

// ==================== 连写模式（小说逐章生成 · 状态快照续写） ====================
/** 第 N 章生成提示词（带叙事状态快照衔接） */
export function buildChapterPrompt(tpl, values, dump, stateSummary, chapterNo, total = 0) {
  const m = buildMantra(tpl, values, dump);
  const premise = fieldValue(tpl, values, 'premise', 'task', 'title', 'subject');
  return {
    system: m.system,
    user: `${m.user}

【连写模式 · 第 ${chapterNo} 章${total ? ' / 共 ' + total + ' 章' : '（写到手动终止）'}】
${chapterNo > 1 ? `以下是截至上一章的叙事状态快照，请严格衔接（人物状态/伏笔/时间线不得矛盾）：\n${stateSummary}\n` : '这是第一章，请建立核心设定与钩子。'}
只输出第 ${chapterNo}章正文（可带「第 ${chapterNo} 章」标题行），不要写大纲、不要解释。篇幅按蓝图的章预算写足。`,
  };
}

/** 叙事状态快照生成提示词（每章写完后滚动摘要） */
export function buildStateSummaryPrompt(prevSummary, chapterText, chapterNo) {
  return {
    system: '你是小说连载的叙事状态记录员。把故事状态压缩成精确摘要，供下一章无缝衔接。只输出结构化摘要，不要评论。',
    user: `【此前状态】\n${prevSummary || '（第一章前）'}\n\n【刚写完的第 ${chapterNo} 章】\n${chapterText.slice(-3000)}\n\n请输出截至第 ${chapterNo} 章的叙事状态快照：\n1. 主要人物当前状态（位置/关系/心理）\n2. 已埋伏笔与未回收线索\n3. 当前冲突与时间线\n4. 下一章必须延续的要点`,
  };
}

/** 读取连写任务进度（文件夹内已有章节与最新快照） */
export async function readMaxTaskProgress(folder) {
  const entries = await window.mazz.invoke('fs:listDir', { path: folder }).catch(() => []);
  let lastChapter = 0, lastSnap = '';
  for (const e of entries) {
    const m = /^第(\d+)章/.exec(e.name);
    if (m) lastChapter = Math.max(lastChapter, parseInt(m[1], 10));
    if (e.name.includes('叙事状态快照')) {
      const m2 = /第(\d+)章后/.exec(e.name);
      if (m2 && parseInt(m2[1], 10) >= lastChapter - 1) {
        const m3 = /第(\d+)章后/.exec(e.name);
        if (m3 && parseInt(m3[1], 10) === lastChapter) {
          lastSnap = await window.mazz.invoke('fs:readFile', { path: e.path }).catch(() => '');
        }
      }
    }
  }
  return { lastChapter, lastSnap };
}

// ==================== 创作插件注入（移植原版 genres/novel/plugins 机制） ====================
/**
 * 渲染插件 prompt：{字段id} 依次用 插件字段值 → 任务字段值 替换，剩余占位符 → [未指定]
 * @returns {string} 可直接拼进蓝图 prompt 的插件段落
 */
export function renderPluginPrompt(plugin, pluginValues = {}, taskValues = {}) {
  let text = plugin.prompt;
  for (const f of plugin.fields || []) {
    const v = pluginValues[f.id] ?? taskValues[f.id] ?? f.options?.[0] ?? '';
    text = text.replaceAll('{' + f.id + '}', String(v).trim() || '[未指定]');
  }
  for (const [k, v] of Object.entries(taskValues)) {
    if (typeof v === 'string') text = text.replaceAll('{' + k + '}', v);
  }
  text = text.replace(/\{[^{}]+\}/g, '[未指定]');
  return text.trim();
}

/** 嵌入资料块（最高优先级，置于蓝图 prompt 最前） */
export function buildEmbedBlocks(embeds = []) {
  if (!embeds.length) return '';
  const parts = embeds.map((f, i) => `### 文件${i + 1}
- 文件名：${f.name}
${f.note ? `- 用户说明：${f.note}\n` : ''}
**文件内容：**

${(f.text || '').slice(0, 8000)}`);
  return `## 插件模块：文件嵌入（最高优先级）

**优先级声明：本模块为最高优先级。当嵌入文件内容与自动推演内容冲突时，以嵌入文件为准；需在一致性校验中标注张力并给出调整建议，而非修改嵌入文件的内容。**

## 已嵌入文件清单

${parts.join('\n\n')}`;
}

// ==================== 全书蓝图（原版 novel 蓝图生成器） ====================
/**
 * 组装蓝图生成 prompt（9 部分全要素 + 章节约束），返回 {user}
 * opts: { stylePackage, pluginBlocks: [], embedBlocks, maxMode, chapters, wordsPerChapter }
 */
export function buildNovelBlueprintPrompt(values, opts = {}) {
  const title = values['书名'] || values.title || '未命名';
  const chapters = opts.maxMode ? 'max' : (opts.chapters || values['计划章节数'] || 10);
  const chapterRule = opts.maxMode
    ? '根据故事发展需要自行决定章节数量，将故事完整叙述至自然结尾。'
    : `章节大纲必须恰好是${chapters}章，不要多也不要少。`;
  const pluginText = (opts.pluginBlocks || []).filter(Boolean).join('\n\n') || '（无额外内容维度插件）';

  return `你是一位资深小说创作顾问。请根据以下信息，生成一份完整的「全要素故事蓝图」。

## 核心创作信息
- 书名：${title}
- 价值取向：${values['价值取向'] || '（未填）'}
- 文风学习对象：${values['文风学习对象'] || '（未指定）'}
- 作品类型：${values['作品类型'] || '（未指定）'}
- 篇幅长短：${values['篇幅长短'] || '（未指定）'}
- 目标总字数：${values['目标总字数'] || '（未指定）'}
- 每章字数：约 ${opts.wordsPerChapter || values['每章字数'] || 2000} 字

## 文风参考素材
${opts.stylePackage || '（未提供）'}

${opts.embedBlocks ? opts.embedBlocks + '\n\n' : ''}## 内容维度
${pluginText}

## 蓝图生成要求
请基于以上全部信息，生成包含以下内容的完整创作蓝图（Markdown格式）：
1. 故事标题与一句话简介
2. 核心价值取向的文学表达
3. 主角详细人设
4. 配角群像（至少3位）
5. 世界观设定
6. 三幕结构大纲
7. 各章节详细纲要（格式：第N章：……，每章一行）
8. 文风执行方案
9. 全文节奏控制表

${chapterRule}
请控制每个部分的篇幅，确保以上9个部分全部完整输出，不要中途截断。最后以「## 创作启动指令」收尾，给出写作时必须遵守的视角、句法、对话、描写规则与绝对禁止事项。`;
}

/** 蓝图结构完整性校验（原版关键词计数法：≥6 命中为完整） */
export function blueprintStructureOk(blueprint) {
  const KEYS = ['故事标题', '简介', '核心价值', '价值取向', '主角', '人设', '配角', '群像',
    '世界观', '设定', '三幕', '结构', '大纲', '章节', '纲要', '文风', '执行方案', '节奏', '控制表'];
  const text = String(blueprint || '').toLowerCase();
  return KEYS.filter(s => text.includes(s.toLowerCase())).length >= 6;
}

/** 从蓝图解析章节大纲（移植原版 _parse_chapters：第N章：… 每章一行） */
export function parseChapterOutlines(blueprint, fallbackCount = 10) {
  let outlines = String(blueprint || '').match(/^[#\s>*-]*第[一二三四五六七八九十\d]+章\s*[：:]\s*[^\n]+/gm) || [];
  if (!outlines.length) {
    // 退化分支：必须是「第+数字/中文数字+章」开头的行——防散文句（"第一人称…"）误匹配
    outlines = String(blueprint || '').split('\n')
      .map(l => l.trim())
      .filter(l => /^第[0-9一二三四五六七八九十百千]+章(?![^\s：:，。]*人称)/.test(l) && l.length < 80);
  }
  if (!outlines.length) return Array.from({ length: fallbackCount }, (_, i) => `第${i + 1}章`);
  return outlines.map(l => l.replace(/^[#\s>*-]+/, '').trim()).slice(0, 999);
}

/** 提取蓝图核心设定（创作启动指令之前的部分） */
export function extractBlueprintCore(blueprint) {
  const text = String(blueprint || '');
  const m = /\n#{1,3}\s*(?:\d+\.?\s*)?创作启动指令/.exec(text);
  const core = (m ? text.slice(0, m.index) : text).trim();
  return `## 蓝图核心设定\n\n${core.length >= 200 ? core : text.trim()}`;
}

/** 提取创作启动指令（没有则退回全文） */
export function extractWritingDirective(blueprint) {
  const text = String(blueprint || '');
  const m = /(#{1,3}\s*(?:\d+\.?\s*)?创作启动指令[\s\S]*?)(?=\n#[^#]|$)/.exec(text);
  return (m ? m[1] : text).trim();
}

/** 清理 AI 输出的 markdown 代码围栏（原版 _call_and_clean） */
export function stripMdFence(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```markdown')) t = t.slice(11);
  else if (t.startsWith('```')) t = t.slice(3);
  if (t.endsWith('```')) t = t.slice(0, -3);
  return t.trim();
}

/** 四层章节引导（原版 chapter_guide 结构：蓝图核心 / 启动指令 / 状态快照 / 本章任务） */
export function buildChapterPromptV2({ blueprintCore, writingDirective, stateSummary, outline, chapterNo, total, wordsPerChapter, title }) {
  const system = `你是小说作家。以下是你必须始终遵守的全部创作规范。

---

## 第一层：蓝图核心设定

这些是世界观、人物、主题和叙事框架的完整设定。你在写作时不得偏离以下任何已确立的设定。

${blueprintCore}

---

## 第二层：创作启动指令

这是从蓝图中提取的完整写作规范——视角、句法、对话规则、描写规则、文风执行方案、绝对禁止事项。每条规则都必须严格遵守。

${writingDirective}

---

## 第三层：当前叙事状态

这是上一章结束后的精确状态快照。你必须从快照所描述的场景断点处开始续写。快照中记录的所有人物状态、伏笔状态、冲突线状态均为当前事实。

${stateSummary || '（故事尚未开始，这是第一章）'}

---

## 第四层：接续写作指令

**本章大纲**: ${outline}

本章字数请根据大纲内容与节奏自行把控，用户参考 ${wordsPerChapter || 2000} 字但不必严格遵循。
请严格遵循以上全部规范，完成《${title}》第 ${chapterNo} 章${total ? '（共 ' + total + ' 章）' : ''}正文。
【重要】直接输出正文内容，不要输出章节标题（如「第X章」），不要输出任何前言或说明文字。`;
  return { system, user: `请写第 ${chapterNo} 章正文。直接输出正文，不要输出章节标题。` };
}

/** 续写去重合并（原版 _dedup_merge：找最长重叠前缀） */
export function dedupMerge(prev, next) {
  if (!prev || !next) return (prev || '') + (next || '');
  const maxOverlap = Math.min(200, prev.length, next.length);
  for (let n = maxOverlap; n > 10; n--) {
    if (next.startsWith(prev.slice(-n))) return prev + next.slice(n);
  }
  return prev + next;
}

// ==================== 任务状态持久化（原版 task_state.json） ====================
/** 写任务状态到产出目录（供启动扫描恢复） */
export async function writeTaskState(folder, state) {
  try {
    await window.mazz.invoke('fs:writeFile', {
      path: `${folder}/task_state.json`,
      content: JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2),
    });
  } catch {}
}

/** 扫描工作区可恢复任务（task_state.json 且 status ∈ running/paused/stopped） */
export async function scanResumableTasks() {
  const results = [];
  try {
    const ws = await window.mazz.invoke('workspace:get');
    const root = `${ws}/创作产出`;
    const dirs = await window.mazz.invoke('fs:listDir', { path: root }).catch(() => []);
    for (const d of dirs) {
      if (!d.isDir) continue;
      try {
        const raw = await window.mazz.invoke('fs:readFile', { path: `${d.path}/task_state.json` });
        const st = JSON.parse(raw);
        if (['running', 'paused', 'stopped'].includes(st.status)) results.push({ ...st, outDir: d.path });
      } catch {}
    }
  } catch {}
  return results.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
