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

// ==================== W60b 立项与产出协议 ====================
/** 仅供旧任务/旧调用兼容；新立项不渲染这些档位，也不会自动选择。 */
export const FACTORY_LENGTH_PRESETS = Object.freeze([
  Object.freeze({ id: 'short', label: '短篇', totalWords: 10000, wordsPerUnit: 2000 }),
  Object.freeze({ id: 'medium', label: '中篇', totalWords: 100000, wordsPerUnit: 4000 }),
  Object.freeze({ id: 'long', label: '长篇', totalWords: 500000, wordsPerUnit: 6000 }),
  Object.freeze({ id: 'unlimited', label: '无限', totalWords: 0, wordsPerUnit: 4000 }),
]);
const UNSPECIFIED_LENGTH_PLAN = Object.freeze({ id: 'custom', label: '不指定', totalWords: 0, wordsPerUnit: 0 });

/**
 * 旧篇幅预设只是规划建议，不是交付门禁。
 * 显式的 0/空值表示“不指定”；仅在调用方完全没有传值时采用预设建议。
 */
export function resolveFactoryLengthPlan({ preset = 'custom', totalWords, wordsPerUnit, maxMode = false } = {}) {
  const base = FACTORY_LENGTH_PRESETS.find(x => x.id === preset) || UNSPECIFIED_LENGTH_PLAN;
  const unlimited = base.id === 'unlimited';
  const guidanceNumber = (value, fallback) => {
    if (value === undefined || value === null) return Math.round(Number(fallback) || 0);
    if (value === '') return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
  };
  const safeWords = guidanceNumber(wordsPerUnit, base.wordsPerUnit);
  const safeTotal = unlimited ? 0 : guidanceNumber(totalWords, base.totalWords);
  return {
    preset: base.id,
    totalWords: safeTotal,
    wordsPerUnit: safeWords,
    // 字数只保留为可选参考，不再换算执行终点。连写也必须由用户明确开启；
    // 实际终点来自蓝图内容单元或用户停止，而不是“总字数 ÷ 单元字数”。
    maxMode: Boolean(maxMode),
    maxChapters: 0,
  };
}

/** 旧调用兼容：批量数量不再触发确认或拒绝；逐条格式校验仍由解析器负责。 */
export function factoryBatchGate(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return { allowed: true, warning: false, count: n, message: '' };
}

function safeFactorySegment(value, fallback) {
  const cleaned = String(value || '').trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

/** {ws}/Output/{文体}/{作品类型|未分类}/{书名}_{ts尾5}/ */
export function buildFactoryOutputFolder(ws, { genreName, workType, title, timestamp = Date.now() } = {}) {
  const root = String(ws || '').replace(/[\\/]+$/g, '');
  const genre = safeFactorySegment(genreName, '通用');
  const type = safeFactorySegment(workType, '未分类');
  const book = safeFactorySegment(title, '未命名');
  const tail = String(Math.max(0, Math.floor(Number(timestamp) || Date.now()))).slice(-5).padStart(5, '0');
  return `${root}/Output/${genre}/${type}/${book}_${tail}`;
}

/** 第NNN章-{章题剥#}：同一大纲输入始终得到同一文件名，便于断点恢复。 */
export function buildFactoryUnitStem(chapterNo, unitName = '章', outline = '') {
  const no = Math.max(1, Math.floor(Number(chapterNo) || 1));
  const prefix = `第${String(no).padStart(3, '0')}${safeFactorySegment(unitName, '章')}`;
  const title = String(outline || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*第\s*[零〇一二三四五六七八九十百千万两\d]+\s*[章节篇回幕节卷部集单元]*\s*[：:、.．\-—]?\s*/i, '')
    .replace(/#+/g, '')
    .trim();
  return `${prefix}-${safeFactorySegment(title, '未命名')}`;
}

const FACTORY_EXPORT_SPECS = Object.freeze({
  md: Object.freeze({ ext: 'md', pandoc: 'markdown', text: true }),
  txt: Object.freeze({ ext: 'txt', pandoc: 'plain', text: true }),
  html: Object.freeze({ ext: 'html', pandoc: 'html', text: false }),
  docx: Object.freeze({ ext: 'docx', pandoc: 'docx', text: false }),
  epub: Object.freeze({ ext: 'epub', pandoc: 'epub', text: false }),
  odt: Object.freeze({ ext: 'odt', pandoc: 'odt', text: false }),
  rtf: Object.freeze({ ext: 'rtf', pandoc: 'rtf', text: false }),
  rst: Object.freeze({ ext: 'rst', pandoc: 'rst', text: true }),
  adoc: Object.freeze({ ext: 'adoc', pandoc: 'asciidoc', text: true }),
  textile: Object.freeze({ ext: 'textile', pandoc: 'textile', text: true }),
  opml: Object.freeze({ ext: 'opml', pandoc: 'opml', text: true }),
  org: Object.freeze({ ext: 'org', pandoc: 'org', text: true }),
  mw: Object.freeze({ ext: 'mw', pandoc: 'mediawiki', text: true }),
});

export function factoryExportSpec(format) {
  return FACTORY_EXPORT_SPECS[format] || FACTORY_EXPORT_SPECS.md;
}

function stripInlineMarkdown(line) {
  return String(line || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(`{1,3}|\*\*|__|~~)/g, '');
}

function xmlEsc(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** 六种长尾文本格式的无依赖保底序列化；Pandoc 不在场也保证可读真落盘。 */
export function serializeFactoryText(markdown, format, title = '未命名') {
  const src = String(markdown || '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  if (format === 'opml') {
    const outlines = lines.filter(x => x.trim()).map(line => {
      const text = stripInlineMarkdown(line.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, ''));
      return `      <outline text="${xmlEsc(text)}"/>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${xmlEsc(title)}</title></head>\n  <body>\n${outlines}\n  </body>\n</opml>\n`;
  }
  if (format === 'rst') {
    const marks = ['=', '-', '~', '^', '"', "'"];
    const out = [];
    for (const line of lines) {
      const h = /^(#{1,6})\s+(.+)$/.exec(line);
      if (!h) { out.push(stripInlineMarkdown(line)); continue; }
      const text = stripInlineMarkdown(h[2]);
      out.push(text, marks[h[1].length - 1].repeat(Math.max(1, [...text].length)));
    }
    return out.join('\n');
  }
  const heading = {
    adoc: n => '='.repeat(n),
    textile: n => `h${n}.`,
    org: n => '*'.repeat(n),
    mw: n => '='.repeat(Math.min(6, n + 1)),
  }[format];
  if (!heading) return lines.map(stripInlineMarkdown).join('\n');
  return lines.map(line => {
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!h) return stripInlineMarkdown(line);
    const mark = heading(h[1].length);
    const text = stripInlineMarkdown(h[2]);
    return format === 'mw' ? `${mark} ${text} ${mark}` : `${mark} ${text}`;
  }).join('\n');
}

/**
 * 组装完整创作焚诀（生成提示词阶段的产物，也是直接生成时的 system+user 蓝本）
 * 结构遵循元焚诀：需求痛点 → 核心契约 → 文体规范（元变量）→ 结构蓝图 → 维度规则 → 校验 → 启动指令
 */
const OPTIONAL_QUANTITY_RULES = new Set(['minLength', 'maxLength', 'maxParagraphs', 'notAllDialog']);
const LEGACY_LENGTH_FIELD_IDS = new Set([
  'length', '篇幅', '篇幅长短', '每章字数', '目标总字数', 'totalWords', 'wordsPerUnit',
]);

function isOptionalQuantityRule(check = {}) {
  return OPTIONAL_QUANTITY_RULES.has(String(check.rule || ''));
}

function isLengthPlanField(field = {}) {
  return field.uiOwner === 'lengthPlan' || LEGACY_LENGTH_FIELD_IDS.has(String(field.id || ''));
}

function explicitLengthGuidance(tpl, values) {
  const field = (tpl.input_fields || []).find(item => item.uiOwner !== 'lengthPlan'
    && ['length', '篇幅'].includes(String(item.id || '')));
  if (!field) return '';
  const value = values?.[field.id];
  return value != null ? String(value).trim() : '';
}

export function buildMantra(tpl, values, dumpText = '') {
  const fields = (tpl.input_fields || []).filter(field => !isLengthPlanField(field));
  const fieldLines = fields
    .map(f => `- **${f.label}**：${values[f.id]?.trim() || '（未填）'}`)
    .join('\n');
  const mv = tpl.meta_vars || {};
  const mvLines = Object.entries(mv).map(([k, v]) => `- **${k}**：${v}`).join('\n');
  const effectiveChecks = (tpl.quality_checks || []).filter(check => !isOptionalQuantityRule(check));
  const checks = effectiveChecks.map((c, i) => `${i + 1}. ${c.label}`).join('\n')
    || '（不设字数、字符数、段数或对话比例门禁；以内容完整和结构契约为准。）';
  const out = tpl.output_rules || {};
  const lenText = explicitLengthGuidance(tpl, values);
  const lengthLine = lenText
    ? `- 篇幅参考（可选指导，不作为验收门禁）：${lenText}`
    : '- 篇幅由内容完整性决定，不设字数、字符数、段数或对话比例门禁';
  const contract = buildContract(tpl, values);
  const dimensionBlock = buildDimensions(tpl);

  return {
    // 直接生成时的 system prompt（角色 + 元变量 + 规则）
    system: `${tpl.system_prompt}

【本次创作必须遵守的元变量】
${mvLines}

【输出要求】
- 输出格式：${out.format || 'markdown'}；结构：${out.structure || '清晰分层'}
${lengthLine}
- 只输出正文本身，不要解释、不要客套、不要复述要求`,
    // 直接生成时的 user prompt（任务 + 素材 + 契约 + 校验）
    user: `【文体】${tpl.name}（${tpl.description || ''}）

【已确认的要素】
${fieldLines}
${dumpText.trim() ? `\n【补充素材（竹筒倒豆子）】\n${dumpText.trim()}\n` : ''}
【核心契约（不可违反）】
${contract}

【结构蓝图】
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

## 四、结构蓝图
${dimensionBlock.blueprint}

## 五、核心维度执行规则
${dimensionBlock.rules}

## 六、质量校验清单（输出前逐项自检）
${checks}

## 七、创作启动指令
你是一名按上述规范写作的专家。请基于本焚诀创作《${fieldValue(tpl, values, 'title', 'subject', 'task', 'premise') || tpl.name}》，${lenText ? `可参考用户给出的篇幅倾向“${lenText}”，但不得把它当作截断或验收门禁，` : ''}从结构蓝图的第一部分开始逐段写透，完成内容与结构契约后只输出正文。`,
  };
}

/** 核心契约：模板校验项 + 必填要素转铁律 */
function buildContract(tpl, values) {
  const lines = [];
  for (const f of (tpl.input_fields || []).filter(field => !isLengthPlanField(field))) {
    if (f.required) lines.push(`- 「${f.label}」必须准确呈现，不得遗漏或篡改。`);
  }
  for (const c of (tpl.quality_checks || []).filter(check => !isOptionalQuantityRule(check))) lines.push(`- ${c.label}。`);
  const avoid = values.must_avoid?.trim();
  if (avoid) lines.push(`- 绝对避免：${avoid.replace(/\n/g, '；')}。`);
  return lines.join('\n') || '- 不写空话套话。';
}

/** 维度规则：从模板维度池生成执行规则与结构蓝图 */
function buildDimensions(tpl) {
  const out = tpl.output_rules || {};
  const structure = (out.structure || '开头 → 主体 → 结尾').split('→').map(s => s.trim()).filter(Boolean);
  const parts = structure.map((s, i) => `| ${s} | ${i === 0 ? '开宗明义' : i === structure.length - 1 ? '收束有力' : '充分展开'} |`).join('\n');
  const blueprint = `${out.structure || '清晰分层'}；各部分按内容需要展开，不设数量配额

| 部分 | 要求 |
| --- | --- |
${parts}`;
  const rules = [
    `### 结构骨架（优先级: 高）\n- 怎么做：按结构蓝图推进，每部分写到信息与叙事功能完整。\n- 不要做：跳过必要环节、用一句话总结代替展开。\n- 自检：遮住标题能说出每段在结构中的位置。`,
    `### 受众适配（优先级: 高）\n- 怎么做：每写一段自问「目标读者读到这句会怎么想」。\n- 不要做：自嗨、堆术语无解释、忽视读者既有认知。\n- 自检：读者能否不费力地复述核心信息。`,
    `### 语言质地（优先级: 中）\n- 怎么做：动词优先、短句优先、具体优先。\n- 不要做：形容词堆砌、长句嵌套、空话套话。\n- 自检：每句都有不可替代的信息量。`,
  ].join('\n\n');
  return { blueprint, rules };
}

// ==================== 质量校验 ====================
/** 执行校验：返回 [{label, pass, detail}] */
export function runQualityChecks(tpl, text) {
  const t = String(text || '');
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
      case 'minLength':
      case 'maxParagraphs':
      case 'notAllDialog':
        // 旧模板/旧任务仍可带这些字段，但数量值只是写作参考，不得再关闭 W68 机检闸。
        pass = true;
        detail = '数量建议已从验收门禁移除';
        break;
      case 'forbiddenWords': {
        const hit = (c.value || []).filter(w => t.includes(w));
        pass = !hit.length;
        detail = pass ? '' : `命中：${hit.join('、')}`;
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
  只输出第 ${chapterNo}章正文（可带「第 ${chapterNo} 章」标题行），不要写大纲、不要解释。以本章任务完整和叙事节奏为准，不按字数配额截断或补齐。`,
  };
}

/** 叙事状态快照生成提示词（每章写完后滚动摘要） */
export function buildStateSummaryPrompt(prevSummary, chapterText, chapterNo, schema = {}) {
  const snapshot = getSnapshotSchema(schema);
  return {
    system: `你是长篇写作的状态记录员。把当前${snapshot.unitName}状态压缩成精确摘要，供下一${snapshot.unitName}无缝衔接。只输出结构化摘要，不要评论。`,
    user: `【此前状态】\n${prevSummary || `（第一${snapshot.unitName}前）`}\n\n【刚写完的第 ${chapterNo} ${snapshot.unitName}】\n${String(chapterText || '')}\n\n请输出截至第 ${chapterNo} ${snapshot.unitName}的状态快照，严格保留以下分区：\n${snapshot.sections.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n累计台账纪律：既有条目只增不减；已解决的伏笔保留原条目并加回收标注，已完成的论据或事项保留原条目并加完成标注，禁止静默删除。`,
  };
}

/** 读取连写任务进度（文件夹内已有章节与最新快照） */
export async function readMaxTaskProgress(folder, schema = {}) {
  const entries = await window.mazz.invoke('fs:listDir', { path: folder }).catch(() => []);
  const { unitName } = getSnapshotSchema(schema);
  const unitRe = new RegExp(`^第(\\d+)${escapeRegExp(unitName)}`);
  const snapshotRe = new RegExp(`状态快照_第(\\d+)${escapeRegExp(unitName)}后`);
  let lastChapter = 0, lastSnap = '', lastSnapNo = 0;
  for (const e of entries) {
    const m = unitRe.exec(e.name);
    if (m) lastChapter = Math.max(lastChapter, parseInt(m[1], 10));
    const sm = snapshotRe.exec(e.name);
    if (sm && parseInt(sm[1], 10) >= lastSnapNo) {
      lastSnapNo = parseInt(sm[1], 10);
      lastSnap = await window.mazz.invoke('fs:readFile', { path: e.path }).catch(() => '');
    }
  }
  return { lastChapter, lastSnap };
}

// ==================== 创作插件注入（移植原版 genres/novel/plugins 机制） ====================
/**
 * 渲染插件 prompt：{字段id} 依次用 插件字段值 → 任务字段值 替换，剩余占位符 → [未指定]
 * @returns {string} 可直接拼进蓝图 prompt 的插件段落
 */
export function normalizePluginQuantityGuidance(prompt = '') {
  return String(prompt)
    // 只处理插件自带的配额句；此时用户占位值尚未回填，不会改用户事实数字。
    .replace(/列出当前最热门的\s*\d+\s*[-–—~～至到]\s*\d+\s*个题材类型/g, '列出当前热门题材类型，按材料完整展开')
    .replace(/每个维度控制在\s*\d+\s*[-–—~～至到]\s*\d+\s*行以内/g, '每个维度按内容需要完整展开')
    .replace(/每\s*\d+\s*字\s*至少\s*出现\s*[零一二两三四五六七八九十百\d]+\s*处/g, '在适合的段落加入')
    .replace(/禁止在\s*\d+\s*字内连续出现超过\s*[零一二两三四五六七八九十百\d]+\s*处/g, '避免连续堆叠过于整齐的')
    .replace(/每章对话必须至少跑题\s*[零一二两三四五六七八九十百\d]+\s*次/g, '每章对话允许自然跑题')
    .replace(/允许\s*[零一二两三四五六七八九十百\d]+\s*次/g, '允许偶尔')
    .replace(/每章至少有\s*[零一二两三四五六七八九十百\d]+\s*处/g, '每章可按内容需要安排')
    .replace(/每章至少\s*[零一二两三四五六七八九十百\d]+\s*处/g, '每章可按内容需要安排')
    .replace(/至少出现\s*[零一二两三四五六七八九十百\d]+\s*次/g, '可以反复出现')
    .replace(/必须至少做出\s*[零一二两三四五六七八九十百\d]+\s*次/g, '可以做出')
    .replace(/至少做出\s*[零一二两三四五六七八九十百\d]+\s*次/g, '可以做出')
    .replace(/必须存在至少\s*[零一二两三四五六七八九十百\d]+\s*个/g, '可以保留')
    .replace(/至少有\s*[零一二两三四五六七八九十百\d]+\s*个/g, '可以有')
    .replace(/必须留下至少\s*[零一二两三四五六七八九十百\d]+\s*个/g, '可以留下若干');
}

export function renderPluginPrompt(plugin, pluginValues = {}, taskValues = {}) {
  let text = normalizePluginQuantityGuidance(plugin.prompt);
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

${f.text || ''}`);
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
  const requestedChapters = Number(opts.chapters ?? values['计划章节数']);
  const chapterRule = Number.isFinite(requestedChapters) && requestedChapters > 0
    ? `用户给出的 ${Math.round(requestedChapters)} 章仅作结构规划参考；请按故事内容自然拆分，不得为凑数合并、拆散或提前结束。`
    : '根据故事发展需要自行决定章节数量，将故事完整叙述至自然结尾。';
  const pluginText = (opts.pluginBlocks || []).filter(Boolean).join('\n\n') || '（无额外内容维度插件）';

  return `你是一位资深小说创作顾问。请根据以下信息，生成一份完整的「全要素故事蓝图」。

## 核心创作信息
- 书名：${title}
- 价值取向：${values['价值取向'] || '（未填）'}
- 文风学习对象：${values['文风学习对象'] || '（未指定）'}
- 作品类型：${values['作品类型'] || '（未指定）'}
- 篇幅指导：${Number(opts.wordsPerChapter) > 0 ? `可参考每章约 ${opts.wordsPerChapter} 字，但该数值不是截断、补齐或验收门禁` : '不指定字数，以每章任务完整为准'}

## 文风参考素材
${opts.stylePackage || '（未提供）'}

${opts.embedBlocks ? opts.embedBlocks + '\n\n' : ''}## 内容维度
${pluginText}

## 蓝图生成要求
请基于以上全部信息，生成包含以下内容的完整创作蓝图（Markdown格式）：
1. 故事标题与一句话简介
2. 核心价值取向的文学表达
3. 主角详细人设
4. 配角群像（按故事需要自然展开）
5. 世界观设定
6. 三幕结构大纲
7. 各章节详细纲要（格式：第N章：……，每章一行）
8. 文风执行方案
9. 全文节奏控制表

${chapterRule}
请确保以上9个部分全部完整输出，不要因数量指导而中途截断。最后以「## 创作启动指令」收尾，给出写作时必须遵守的视角、句法、对话、描写规则与绝对禁止事项。`;
}

export const NOVEL_BLUEPRINT_KEYS = ['故事标题', '简介', '核心价值', '价值取向', '主角', '人设', '配角', '群像',
  '世界观', '设定', '三幕', '结构', '大纲', '章节', '纲要', '文风', '执行方案', '节奏', '控制表'];
export const META_BLUEPRINT_KEYS = ['任务目标', '目标读者', '核心材料', '结构大纲', '核心要点', '论据数据', '术语口径', '质量校验'];
export const DEFAULT_SNAPSHOT_SCHEMA = Object.freeze({
  unitName: '章', type: 'narrative', sections: Object.freeze(['人物状态', '伏笔台账', '时间线', '冲突线']),
});
export const EXPOSITORY_SNAPSHOT_SECTIONS = Object.freeze(['要点台账', '术语与数据一致性', '论据与引用台账', '结构完成度']);

/** 文体的蓝图家族；第三方旧文体未声明时双表任选其一通过。 */
export function blueprintFamily(tpl = {}) {
  if (['novel', 'meta', 'auto'].includes(tpl.blueprintFamily)) return tpl.blueprintFamily;
  const snapshotType = tpl.snapshotType || tpl.type;
  if (snapshotType === 'expository') return 'meta';
  if (snapshotType === 'narrative') return 'novel';
  return 'auto';
}

/** 结构单元快照约定；旧文体不声明时保持「章/narrative」行为。 */
export function getSnapshotSchema(tpl = {}) {
  const type = (tpl.snapshotType || tpl.type) === 'expository' ? 'expository' : 'narrative';
  return {
    unitName: String(tpl.unitName || (type === 'expository' ? '节' : DEFAULT_SNAPSHOT_SCHEMA.unitName)),
    type,
    sections: type === 'expository' ? [...EXPOSITORY_SNAPSHOT_SECTIONS] : [...DEFAULT_SNAPSHOT_SCHEMA.sections],
  };
}

export function canUseUnlimited(tpl = {}) {
  return getSnapshotSchema(tpl).type === 'narrative';
}

/** 非叙事文体的 META 蓝图。 */
export function buildMetaBlueprintPrompt(tpl, values, opts = {}) {
  const schema = getSnapshotSchema(tpl);
  const title = fieldValue(tpl, values, 'title', 'subject', 'task', 'premise') || tpl.name || '未命名任务';
  const fieldLines = (tpl.input_fields || [])
    .filter(field => !isLengthPlanField(field))
    .map(f => `- ${f.label}：${values[f.id] || '（未填）'}`).join('\n');
  const requestedUnits = Number(opts.chapters ?? values['计划章节数']);
  const unitGuidance = Number.isFinite(requestedUnits) && requestedUnits > 0
    ? `用户给出的 ${Math.round(requestedUnits)} 个${schema.unitName}仅作结构规划参考；按材料和论证需要自然拆分，不得凑数。`
    : `按材料和论证需要自然拆分${schema.unitName}，不预设数量。`;
  return `你是一位资深${tpl.name || '说明文'}编撰顾问。请生成可执行的结构蓝图（Markdown）。

## 已确认材料
${fieldLines || '（未提供）'}
${opts.embedBlocks ? `\n${opts.embedBlocks}` : ''}

## META 蓝图生成要求
1. 任务目标：说明《${title}》要解决的问题与交付边界
2. 目标读者：读者已有知识、决策需求与阅读顺序
3. 核心材料：事实、约束和缺口清单
4. 结构大纲：格式为「第N${schema.unitName}：……」。${unitGuidance}
5. 核心要点：每${schema.unitName}必须完成的论述任务
6. 论据数据：每项结论对应的事实、数字或引用
7. 术语口径：关键术语、单位、时间与统计口径
8. 质量校验：完整性、一致性、可追溯性检查

最后以「## 创作启动指令」收尾；正文只能使用已确认材料，缺证处明确标记待核。`;
}

export function buildBlueprintPrompt(tpl, values, opts = {}) {
  return blueprintFamily(tpl) === 'meta'
    ? buildMetaBlueprintPrompt(tpl, values, opts)
    : buildNovelBlueprintPrompt(values, opts);
}

/** 蓝图只校验可执行协议形态，不再用“命中多少关键词”充当本地数量闸。 */
export function blueprintStructureOk(blueprint, _family = 'auto') {
  const text = String(blueprint || '');
  const hasDirective = /(?:^|\n)#{1,3}\s*创作启动指令\s*$/m.test(text);
  const hasUnit = /(?:^|\n)[#\s>*-]*第[一二三四五六七八九十百千\d]+(?:章|节|单元|幕|篇|部分|项)\s*[：:]\s*\S+/m.test(text);
  return hasDirective && hasUnit;
}

/** 从蓝图解析章节大纲（移植原版 _parse_chapters：第N章：… 每章一行） */
export function parseChapterOutlines(blueprint, _legacyFallbackCount = 0, schema = {}) {
  const { unitName } = getSnapshotSchema(schema);
  const unit = escapeRegExp(unitName);
  const strictRe = new RegExp(`^[#\\s>*-]*第[一二三四五六七八九十百千\\d]+${unit}\\s*[：:]\\s*[^\\n]+`, 'gm');
  let outlines = String(blueprint || '').match(strictRe) || [];
  if (!outlines.length) {
    const looseRe = new RegExp(`^第[0-9一二三四五六七八九十百千]+${unit}(?![^\\s：:，。]*人称)`);
    outlines = String(blueprint || '').split('\n')
      .map(l => l.trim())
      .filter(l => looseRe.test(l));
  }
  if (!outlines.length) return [];
  return outlines.map(l => l.replace(/^[#\s>*-]+/, '').trim());
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 三次蓝图调用全败后的确定性兜底，保证仍能产出并通过对应家族校验。 */
export function buildFallbackBlueprint(task, total = 0, tpl = {}) {
  const schema = getSnapshotSchema(tpl);
  const requestedUnits = Number(total);
  const units = Number.isFinite(requestedUnits) && requestedUnits > 0
    ? Array.from({ length: Math.round(requestedUnits) }, (_, i) => `第${i + 1}${schema.unitName}：根据已确认材料自然推进`).join('\n')
    : `（按已确认材料自然拆分${schema.unitName}，不预设数量。）`;
  const values = task.values || {};
  const hiddenLengthIds = new Set((tpl.input_fields || [])
    .filter(field => isLengthPlanField(field))
    .map(field => field.id));
  const contentValues = Object.entries(values)
    .filter(([id]) => !hiddenLengthIds.has(id) && !LEGACY_LENGTH_FIELD_IDS.has(id))
    .map(([, value]) => value)
    .filter(Boolean);
  if (schema.type === 'expository') {
    return `# 《${task.label}》结构蓝图（兜底）

## 任务目标
完成《${task.label}》并保持结论可追溯。

## 目标读者
以任务表单中指定的受众为准。

## 核心材料
${contentValues.join('；') || '以用户已确认材料为准；缺证处标记待核。'}

## 结构大纲
${units}

## 核心要点
每${schema.unitName}只承担一个明确论述任务。

## 论据数据
结论必须对应事实、数字或引用；不得补造。

## 术语口径
术语、单位、时间范围与统计口径前后一致。

## 质量校验
逐项检查完整性、一致性、可追溯性与结构完成度。

## 创作启动指令
按大纲逐${schema.unitName}写透；缺证处明确标记待核。`;
  }
  return `# 《${task.label}》创作蓝图（兜底）

## 故事标题与简介
《${task.label}》；围绕用户给定核心设定展开。

## 核心价值取向
以用户填写的价值取向和核心追问为准。

## 主角人设与配角群像
主角：${values.protagonist || '以表单设定为准'}。配角按冲突需要设置，不篡改用户锚点。

## 世界观设定与三幕结构大纲
- 作品类型：${values['作品类型'] || '小说'}
- 计划章节数：${total || '不限'}

## 章节详细纲要
${units}

## 文风执行方案与节奏控制表
文风参考：${values['文风学习对象'] || '未指定'}；每${schema.unitName}以任务完整和节奏需要为准，不设字数验收门。

## 创作启动指令
保持一致的叙事视角和语气基调，写场景不写梗概。`;
}

/** 提取蓝图核心设定（创作启动指令之前的部分） */
export function extractBlueprintCore(blueprint) {
  const text = String(blueprint || '');
  const m = /\n#{1,3}\s*(?:\d+\.?\s*)?创作启动指令/.exec(text);
  const core = (m ? text.slice(0, m.index) : text).trim();
  return `## 蓝图核心设定\n\n${core || text.trim()}`;
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

/** 恒定锚：保留完整核心契约与启动指令，生成一次后随任务缓存。 */
export function buildConstantAnchor(blueprintCore, writingDirective = '') {
  const core = String(blueprintCore || '').trim();
  const directive = String(writingDirective || '').trim();
  if (!directive) return core;
  return `${core}\n\n【执行规约】\n${directive}`.trim();
}

/** 窗口锚：当前结构单元 N±3。 */
export function buildOutlineWindow(outlines = [], chapterNo = 1, radius = 3) {
  const at = Math.max(0, Number(chapterNo || 1) - 1);
  return outlines.slice(Math.max(0, at - radius), at + radius + 1).join('\n');
}

/** 从滚动快照提取累计台账，避免把整份快照在第三/四层重复注入。 */
export function extractLedgerFromSnapshot(summary, schema = {}) {
  const snapshot = getSnapshotSchema(schema);
  const heading = snapshot.type === 'narrative' ? '伏笔台账' : '论据与引用台账';
  const text = String(summary || '');
  const re = new RegExp(`(?:^|\\n)#{0,3}\\s*${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n#{1,3}\\s*[^\\n]+|$)`, 'i');
  const hit = re.exec(text)?.[1]?.trim();
  return hit ? `## ${heading}\n${hit}` : '';
}

export const TOKEN_DECLARATION_RE = /\n?\[本次续写字数[：:]\s*(\d+)\]\s*$/;

export function tokenDeclarationOf(text) {
  const m = TOKEN_DECLARATION_RE.exec(String(text || '').trim());
  return m ? Number(m[1]) : null;
}

export function stripTokenDeclaration(text) {
  return String(text || '').trim().replace(TOKEN_DECLARATION_RE, '').trimEnd();
}

/** Legacy migration helper only: clean an old suffix without synthesizing a new declaration. */
export function ensureTokenDeclaration(text) {
  return stripTokenDeclaration(text);
}

/**
 * Backward-compatible completion normalizer. Provider/transport completion and
 * a non-empty body remain safety requirements; the old character declaration is
 * diagnostic metadata only and never controls commit eligibility.
 */
export function validateNativeContinuationDeclaration(text, completion = {}) {
  const rawText = String(text || '').trim();
  const declared = tokenDeclarationOf(rawText);
  const body = stripTokenDeclaration(rawText);
  const actualCharacters = body.length;
  const declarationPresent = declared != null;
  const declarationMatches = declarationPresent && declared === actualCharacters;
  const completionSafe = completion?.safeToCommit === true;
  let reason = 'ok';
  if (!completionSafe) reason = 'provider-unsafe';
  else if (!body.trim()) reason = 'empty-body';
  return {
    text: body,
    rawText,
    declared,
    actualCharacters,
    declarationPresent,
    declarationMatches,
    completionSafe,
    safeToCommit: reason === 'ok',
    reason,
  };
}

/** 兼容清理旧声明；声明不再是续写终止或提交信号。 */
export function mergeDeclaredContinuation(prev, next = '') {
  const nextCount = tokenDeclarationOf(next);
  const merged = dedupMerge(stripTokenDeclaration(prev), stripTokenDeclaration(next));
  return { text: merged, declared: nextCount ?? tokenDeclarationOf(prev), complete: false };
}

/** 六层章节引导：恒定锚 / N±3 窗口 / 滚动快照 / 累计台账 / 本章任务 / 纠偏。 */
export function buildChapterPromptV2({
  blueprintCore, constantAnchor, writingDirective, outlines = [], stateSummary, foreshadowLedger,
  outline, chapterNo, total, wordsPerChapter, title, correctionDirective, snapshotSchema,
}) {
  const schema = getSnapshotSchema(snapshotSchema || {});
  const anchor = constantAnchor || buildConstantAnchor(blueprintCore, writingDirective);
  const windowAnchor = buildOutlineWindow(outlines.length ? outlines : [outline].filter(Boolean), chapterNo);
  const ledger = foreshadowLedger || (schema.type === 'narrative'
    ? '（尚无独立伏笔条目；从滚动快照继承，累计只增不减，回收项保留并标注已回收）'
    : '（尚无独立论据条目；从滚动快照继承，累计只增不减，完成项保留并标注已完成）');
  const system = `你是${schema.type === 'narrative' ? '小说作家' : '严谨的结构化写作者'}。以下六层锚按顺序生效，后层不得篡改前层。

---

## 第一层：恒定锚

这是从蓝图核心契约压缩并缓存的恒定锚。不得偏离。

${anchor}

---

## 第二层：窗口锚

只看当前第 ${chapterNo}${schema.unitName}前后 N±3 的结构窗口，保证局部推进与全局衔接：

${windowAnchor || outline || `第${chapterNo}${schema.unitName}`}

---

## 第三层：滚动快照

这是上一${schema.unitName}结束后的精确状态。必须从此处衔接。

${stateSummary || `（作品尚未开始，这是第一${schema.unitName}）`}

---

## 第四层：伏笔台账

跨${schema.unitName}累计只增不减；回收/完成只加标注，不删除旧项。

${ledger}

---

## 第五层：本章任务

**本${schema.unitName}大纲**：${outline}

本${schema.unitName}按任务与节奏自行展开。${Number(wordsPerChapter) > 0 ? `用户给出的 ${wordsPerChapter} 字仅作参考，不得用于截断、补齐或验收。` : '用户未指定字数，以内容完整为准。'}
完成《${title}》第 ${chapterNo}${schema.unitName}${total ? `（共 ${total}${schema.unitName}）` : ''}正文。
【重要】直接输出正文，不要输出「第X${schema.unitName}」标题、前言或说明。

---

## 第六层：纠偏指令

${correctionDirective || '（本轮未触发纠偏；每 10 个结构单元只做一致性自检，不重写既有正文。）'}`;
  return { system, user: `请写第 ${chapterNo} ${schema.unitName}正文。直接输出正文，不要附加字数或字符数声明。` };
}

/** 续写去重合并：线性查找不限长的“前文后缀 / 续文前缀”。 */
export function dedupMerge(prev, next) {
  if (!prev || !next) return (prev || '') + (next || '');
  const prefix = new Array(next.length).fill(0);
  for (let i = 1, matched = 0; i < next.length; i++) {
    while (matched && next[i] !== next[matched]) matched = prefix[matched - 1];
    if (next[i] === next[matched]) matched += 1;
    prefix[i] = matched;
  }
  let overlap = 0;
  for (let i = 0; i < prev.length; i++) {
    while (overlap && prev[i] !== next[overlap]) overlap = prefix[overlap - 1];
    if (prev[i] === next[overlap]) overlap += 1;
    if (overlap === next.length && i < prev.length - 1) overlap = prefix[overlap - 1];
  }
  return prev + next.slice(overlap);
}

// ==================== 任务状态持久化（W60b 新协议 + 旧名兼容） ====================
/** 写任务状态到产出目录（供启动扫描恢复） */
export async function writeTaskState(folder, state) {
  const filename = /(^|[\\/])Output([\\/]|$)/i.test(String(folder || '')) ? '任务状态.json' : 'task_state.json';
  try {
    const result = await window.mazz.invoke('fs:writeFile', {
      path: `${folder}/${filename}`,
      content: JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2),
    });
    return result ?? { ok: true, filename };
  } catch (error) {
    const failure = new Error(`任务状态写入失败（${filename}）：${error?.message || error || '未知错误'}`);
    failure.name = 'FactoryTaskStateWriteError';
    failure.code = 'FACTORY_TASK_STATE_WRITE_FAILED';
    failure.cause = error;
    throw failure;
  }
}

/** 扫描工作区可恢复任务（新任务状态.json / 旧 task_state.json）。 */
export async function scanResumableTasks() {
  const results = [];
  try {
    const ws = await window.mazz.invoke('workspace:get');
    const seen = new Set();
    const walk = async (root, depth) => {
      const dirs = await window.mazz.invoke('fs:listDir', { path: root }).catch(() => []);
      for (const d of dirs) {
        if (!d.isDir) continue;
        let found = false;
        for (const filename of ['任务状态.json', 'task_state.json']) {
          try {
            const statePath = `${d.path}/${filename}`;
            const stat = await window.mazz.invoke('fs:stat', { path: statePath }).catch(() => ({ exists: false }));
            if ((stat?.exists && !stat.isDir) || stat == null) { // null 仅兼容老测试桥；真桥始终返回 exists
              const raw = await window.mazz.invoke('fs:readFile', { path: statePath });
              const st = JSON.parse(raw);
              if (['running', 'paused', 'stopped'].includes(st.status) && !seen.has(d.path)) {
                seen.add(d.path);
                results.push({ ...st, outDir: d.path });
              }
              found = true;
              break;
            }
          } catch { /* 缺少候选名时继续尝试另一状态文件 */ }
        }
        if (!found && depth > 1) await walk(d.path, depth - 1);
      }
    };
    await walk(`${ws}/Output`, 3);
    await walk(`${ws}/创作产出`, 1); // 旧任务只读兼容，不迁移、不截断
  } catch {}
  return results.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
