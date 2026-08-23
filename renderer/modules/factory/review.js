// W68a 双环引擎：确定性机检、主环对点、外围审理、质询闭环与四闸落盘。
// 本文件只保存可复验规则与流程；文件系统落盘由 factory/index.js 负责。

export const W68_PROTOCOL = 'W68a';
export const REVIEW_RULES = Object.freeze({
  machineBeforePoint: 'W68-R1',
  noSelfCertification: 'W68-R2',
  reviewerDoesNotRewrite: 'W68-R3',
  locksAreGlobal: 'W68-R4',
  noConfidenceEscalation: 'W68-R5',
  quietForcesRedTeam: 'W68-R6',
  maxThreeMainRounds: 'W68-R7',
  citedObjections: 'W68-R8',
  evidenceAnswers: 'W68-R9',
  fourGates: 'W68-R10',
  sealedReadOnly: 'W68-R11',
});

export const REVIEW_ARTIFACT_NAMES = Object.freeze({
  skeleton: '01-骨架与验收点.md',
  draft: '02-扩写稿.md',
  polish: '02b-润色记录.md',
  machine: '03-机检报告.md',
  point: '04-对点报告.md',
  repair: '05-修订单.md',
  consultation: '06-请示单.md',
  review: '07-审理表.md',
  objection: '08-质询单.md',
  answer: '09-答辩书.md',
  verdict: '10-裁决书.md',
  manifest: '工件清单.json',
});

export const TLC_RULES = Object.freeze([
  { id: 'E1', label: '年份先后', layer: 'time', since: '2026-08-13' },
  { id: 'E2', label: '届次有效性', layer: 'term', since: '2026-08-13' },
  { id: 'E3', label: '历法日期', layer: 'calendar', since: '2026-08-13' },
  { id: 'E4', label: '月份与季节', layer: 'season', since: '2026-08-13' },
  { id: 'E5', label: '时区范围', layer: 'timezone', since: '2026-08-13' },
  { id: 'E6', label: '人物在任区间', layer: 'office', since: '2026-08-13' },
  { id: 'E7', label: '技术代际年份', layer: 'technology', since: '2026-08-13' },
  { id: 'E8', label: '制度任期区间', layer: 'institution', since: '2026-08-13' },
  { id: 'E9', label: '地理海拔范围', layer: 'geography', since: '2026-08-13' },
  { id: 'E10', label: '文档结构闭合', layer: 'document', since: '2026-08-13' },
  { id: 'E11', label: '公历干支匹配', layer: 'sexagenary', since: '2026-08-13' },
  { id: 'E12', label: '机构编号格式', layer: 'identifier', since: '2026-08-13' },
]);

const asText = value => String(value ?? '').trim();
const strictText = value => typeof value === 'string' ? value.trim() : '';
const list = value => Array.isArray(value) ? value : [];
const slug = value => asText(value).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'item';
const escRx = value => asText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const line = (label, value) => `- ${label}：${asText(value) || '无'}`;
const rawAuditSummary = value => strictText(value)
  .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
  .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
  .replace(/\s+/g, ' ')
  .slice(0, 512);

function parseMarkerBody(body) {
  const parts = asText(body).split('::').map(x => x.trim()).filter(Boolean);
  const id = parts.length > 1 ? slug(parts.shift()) : '';
  const label = parts.shift() || asText(body);
  const patterns = parts.join('::').split(/[|｜]/).map(x => x.trim()).filter(Boolean);
  return { id, label, patterns: patterns.length ? patterns : [label] };
}

/**
 * 从蓝图读取四类显式验收标记：
 * - [必达] id::事件/观点::证据词|同义词
 * - [必埋] id::伏笔::种子词
 * - [锁定] id::事实名=事实值::来源A|来源B::口径
 * - [禁越] id::边界::禁词A|禁词B
 */
export function buildAcceptanceSchema({ blueprint = '', outline = '', lockedFacts = [], forbidden = [] } = {}) {
  const schema = {
    version: 1,
    protocol: W68_PROTOCOL,
    requiredBeats: [],
    plantedSeeds: [],
    lockedFacts: [],
    forbiddenBoundaries: [],
    source: 'derived',
  };
  const rows = asText(blueprint).split(/\r?\n/);
  for (const row of rows) {
    const hit = row.match(/^\s*[-*]?\s*\[(必达|必埋|锁定|禁越)\]\s*(.+)$/);
    if (!hit) continue;
    schema.source = 'explicit';
    const kind = hit[1];
    const parsed = parseMarkerBody(hit[2]);
    const base = { id: parsed.id || `${kind}-${schema.requiredBeats.length + schema.plantedSeeds.length + schema.lockedFacts.length + schema.forbiddenBoundaries.length + 1}`, label: parsed.label, patterns: parsed.patterns, required: true };
    if (kind === '必达') schema.requiredBeats.push(base);
    if (kind === '必埋') schema.plantedSeeds.push(base);
    if (kind === '禁越') schema.forbiddenBoundaries.push(base);
    if (kind === '锁定') {
      const pair = parsed.label.match(/^(.+?)\s*[=＝]\s*(.+)$/);
      const tail = hit[2].split('::').map(x => x.trim());
      schema.lockedFacts.push({
        ...base,
        label: pair?.[1]?.trim() || parsed.label,
        value: pair?.[2]?.trim() || parsed.patterns[0] || '',
        sources: (tail[2] || '').split(/[|｜、]/).map(x => x.trim()).filter(Boolean),
        basis: tail[3] || '',
      });
    }
  }
  for (const fact of list(lockedFacts)) {
    if (!fact?.label || schema.lockedFacts.some(x => x.label === fact.label)) continue;
    schema.lockedFacts.push({ id: fact.id || `lock-${schema.lockedFacts.length + 1}`, label: fact.label, value: asText(fact.value), sources: list(fact.sources), basis: asText(fact.basis), required: true, patterns: [asText(fact.value)].filter(Boolean) });
  }
  for (const item of list(forbidden)) {
    const text = asText(item);
    if (text) schema.forbiddenBoundaries.push({ id: `ban-${schema.forbiddenBoundaries.length + 1}`, label: text, patterns: [text], required: true });
  }
  // 没有显式标记时只生成“提示性”当前单元锚，不拿整本蓝图误伤每个单元。
  if (!schema.requiredBeats.length && asText(outline)) {
    const label = asText(outline).replace(/^第[^：:]+[：:]\s*/, '');
    const keywords = label.match(/[\p{L}\p{N}]{2,8}/gu) || [];
    schema.requiredBeats.push({ id: 'outline-anchor', label, patterns: keywords.length ? keywords : [label], required: false });
  }
  return schema;
}

export function acceptanceSchemaMarkdown(schema) {
  const section = (title, rows, render) => `## ${title}\n\n${rows.length ? rows.map(render).join('\n') : '- 无'}`;
  return [
    '# 骨架与验收点',
    '',
    line('协议', schema?.protocol || W68_PROTOCOL),
    line('来源', schema?.source || 'derived'),
    '',
    section('必达事件 / 观点', list(schema?.requiredBeats), x => `- [${x.required === false ? '建议' : '必达'}] ${x.id}｜${x.label}｜证据词：${list(x.patterns).join(' / ') || '无'}`),
    '',
    section('必埋种子', list(schema?.plantedSeeds), x => `- [必埋] ${x.id}｜${x.label}｜种子词：${list(x.patterns).join(' / ') || '无'}`),
    '',
    section('锁定事实', list(schema?.lockedFacts), x => `- [锁定] ${x.id}｜${x.label}＝${x.value}｜来源：${list(x.sources).join(' / ') || '未登记'}｜口径：${x.basis || '未登记'}`),
    '',
    section('禁止越界', list(schema?.forbiddenBoundaries), x => `- [禁越] ${x.id}｜${x.label}｜触发词：${list(x.patterns).join(' / ') || '无'}`),
  ].join('\n');
}

function sentenceLengths(text) {
  return asText(text).split(/[。！？!?\n]+/).map(x => x.replace(/\s/g, '').length).filter(Boolean);
}

function deviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length);
}

export function styleFingerprint(text) {
  const raw = asText(text);
  const chars = raw.replace(/\s/g, '').length || 1;
  const paragraphs = raw.split(/\n\s*\n/).map(x => x.replace(/\s/g, '').length).filter(Boolean);
  const lengths = sentenceLengths(raw);
  const psychology = raw.match(/(?:觉得|感到|意识到|心想|内心|不由得|他想|她想)/g) || [];
  return {
    chars,
    sentenceCount: lengths.length,
    meanSentenceLength: +(lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0).toFixed(2),
    sentenceStdDev: +deviation(lengths).toFixed(2),
    meanParagraphLength: +(paragraphs.length ? paragraphs.reduce((a, b) => a + b, 0) / paragraphs.length : 0).toFixed(2),
    semicolonPer10k: +(((raw.match(/[；;]/g) || []).length * 10000) / chars).toFixed(2),
    exclamationPer10k: +(((raw.match(/[！!]/g) || []).length * 10000) / chars).toFixed(2),
    psychologyPer10k: +((psychology.length * 10000) / chars).toFixed(2),
  };
}

const finding = (id, severity, message, artifactRef, ruleRef, extra = {}) => ({ id, severity, message, artifactRef, ruleRef, ...extra });

export function runTlcInspection(text) {
  const raw = asText(text);
  const findings = [];
  for (const hit of raw.matchAll(/(\d{3,4})\s*年?\s*(?:至|到|—|-|~|～)\s*(\d{3,4})\s*年/g)) {
    if (+hit[1] > +hit[2]) findings.push(finding(`tlc-e1-${hit.index}`, 'critical', `年份区间倒置：${hit[0]}`, 'draft', 'TLC-E1'));
  }
  for (const hit of raw.matchAll(/第\s*(-?\d+)\s*届/g)) {
    if (+hit[1] < 1) findings.push(finding(`tlc-e2-${hit.index}`, 'critical', `届次必须为正整数：${hit[0]}`, 'draft', 'TLC-E2'));
  }
  for (const hit of raw.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) {
    const y = +hit[1], m = +hit[2], d = +hit[3];
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) findings.push(finding(`tlc-e3-${hit.index}`, 'critical', `无效公历日期：${hit[0]}`, 'draft', 'TLC-E3'));
  }
  const seasons = { 春: [3, 4, 5], 夏: [6, 7, 8], 秋: [9, 10, 11], 冬: [12, 1, 2] };
  for (const hit of raw.matchAll(/(\d{1,2})月[^。；;\n]{0,12}([春夏秋冬])季/g)) {
    if (!seasons[hit[2]].includes(+hit[1])) findings.push(finding(`tlc-e4-${hit.index}`, 'critical', `月份与季节冲突：${hit[0]}`, 'draft', 'TLC-E4'));
  }
  for (const hit of raw.matchAll(/(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/gi)) {
    const hour = +hit[2], minute = +(hit[3] || 0);
    if (hour > 14 || minute > 59 || (hour === 14 && minute > 0)) findings.push(finding(`tlc-e5-${hit.index}`, 'critical', `无效时区偏移：${hit[0]}`, 'draft', 'TLC-E5'));
  }
  for (const hit of raw.matchAll(/(?:任期|在任|服役期|代际|制度期)[：:]?\s*(\d{3,4})\s*(?:至|到|—|-|~|～)\s*(\d{3,4})/g)) {
    if (+hit[1] > +hit[2]) findings.push(finding(`tlc-range-${hit.index}`, 'critical', `有效期区间倒置：${hit[0]}`, 'draft', /代际/.test(hit[0]) ? 'TLC-E7' : /制度/.test(hit[0]) ? 'TLC-E8' : 'TLC-E6'));
  }
  for (const hit of raw.matchAll(/海拔\s*([+-]?\d+(?:\.\d+)?)\s*(?:米|m)/gi)) {
    if (+hit[1] < -500 || +hit[1] > 9000) findings.push(finding(`tlc-e9-${hit.index}`, 'warning', `海拔超出地球常见现实锚：${hit[0]}`, 'draft', 'TLC-E9'));
  }
  if ((raw.match(/```/g) || []).length % 2) findings.push(finding('tlc-e10-fence', 'critical', 'Markdown 代码围栏未闭合', 'draft', 'TLC-E10'));
  const stems = '甲乙丙丁戊己庚辛壬癸', branches = '子丑寅卯辰巳午未申酉戌亥';
  for (const hit of raw.matchAll(/(\d{4})年[^。；;\n]{0,10}([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])年?/g)) {
    const offset = ((+hit[1] - 1984) % 60 + 60) % 60;
    const expected = stems[offset % 10] + branches[offset % 12];
    if (hit[2] !== expected) findings.push(finding(`tlc-e11-${hit.index}`, 'critical', `公历 ${hit[1]} 年干支应为 ${expected}，正文写作 ${hit[2]}`, 'draft', 'TLC-E11'));
  }
  for (const hit of raw.matchAll(/机构编号[：:]\s*([^，。；;\s]+)/g)) {
    if (!/^[A-Z]{2,8}-\d{2,12}$/i.test(hit[1])) findings.push(finding(`tlc-e12-${hit.index}`, 'critical', `机构编号格式非法：${hit[1]}`, 'draft', 'TLC-E12'));
  }
  return { pass: !findings.some(x => x.severity === 'critical'), findings, rules: TLC_RULES };
}

function runArithmeticInspection(text) {
  const raw = asText(text);
  const findings = [];
  for (const hit of raw.matchAll(/([\d,.]+)\s*(?:÷|\/)\s*([\d,.]+)\s*=\s*([\d,.]+)/g)) {
    const a = +hit[1].replace(/,/g, ''), b = +hit[2].replace(/,/g, ''), stated = +hit[3].replace(/,/g, '');
    if (!b || !Number.isFinite(a / b) || !Number.isFinite(stated)) continue;
    const actual = a / b;
    const factor = Math.max(Math.abs(actual / stated), Math.abs(stated / actual));
    if (factor >= 9.5) findings.push(finding(`math-10x-${hit.index}`, 'critical', `10× 嗅探命中：${hit[0]}，机器复算=${+actual.toFixed(6)}`, 'draft', 'W68-Q3', { vertical: `${a}\n÷ ${b}\n= ${+actual.toFixed(6)}` }));
    else if (Math.abs(actual - stated) > Math.max(0.01, Math.abs(actual) * 0.01)) findings.push(finding(`math-${hit.index}`, 'critical', `算式不相等：${hit[0]}，机器复算=${+actual.toFixed(6)}`, 'draft', 'W68-Q4', { vertical: `${a}\n÷ ${b}\n= ${+actual.toFixed(6)}` }));
  }
  return findings;
}

export function runDeterministicInspection(text, schema = {}, { previousText = '', repairOrder = null } = {}) {
  const raw = asText(text);
  const findings = [];
  for (const beat of list(schema.requiredBeats)) {
    const present = list(beat.patterns).some(pattern => pattern && raw.includes(pattern));
    if (!present) findings.push(finding(`beat-${beat.id}`, beat.required === false ? 'warning' : 'critical', `未覆盖验收点：${beat.label}`, `skeleton:${beat.id}`, REVIEW_RULES.machineBeforePoint));
  }
  for (const seed of list(schema.plantedSeeds)) {
    const present = list(seed.patterns).some(pattern => pattern && raw.includes(pattern));
    if (!present) findings.push(finding(`seed-${seed.id}`, 'critical', `未埋入种子：${seed.label}`, `skeleton:${seed.id}`, REVIEW_RULES.machineBeforePoint));
  }
  for (const lock of list(schema.lockedFacts)) {
    const labelRx = new RegExp(`${escRx(lock.label)}\\s*[：:=＝]\\s*([^，。；;\\n]{1,40})`, 'g');
    for (const hit of raw.matchAll(labelRx)) {
      if (lock.value && !hit[1].includes(lock.value)) findings.push(finding(`lock-${lock.id}`, 'critical', `锁定事实冲突：${lock.label} 应为「${lock.value}」，正文写作「${hit[1].trim()}」`, `skeleton:${lock.id}`, REVIEW_RULES.locksAreGlobal, { frozen: true }));
    }
    const hasQuantity = /\d/.test(lock.value || '');
    if (hasQuantity && list(lock.sources).length < 2) findings.push(finding(`source-${lock.id}`, 'critical', `定量锁定项「${lock.label}」不足两条独立记录`, `skeleton:${lock.id}`, REVIEW_RULES.locksAreGlobal, { frozen: true }));
    if (hasQuantity && !lock.basis) findings.push(finding(`basis-${lock.id}`, 'critical', `定量锁定项「${lock.label}」未命名分母/统计口径`, `skeleton:${lock.id}`, REVIEW_RULES.locksAreGlobal, { frozen: true }));
  }
  for (const boundary of list(schema.forbiddenBoundaries)) {
    const bad = list(boundary.patterns).find(pattern => pattern && raw.includes(pattern));
    if (bad) findings.push(finding(`ban-${boundary.id}`, 'critical', `触碰禁止边界：${boundary.label}（${bad}）`, `skeleton:${boundary.id}`, REVIEW_RULES.locksAreGlobal, { frozen: true }));
  }
  const freezePhrases = raw.match(/(?:作者授权|已入典|官方确认|经核实|经权威认定)/g) || [];
  for (const phrase of [...new Set(freezePhrases)]) {
    const supported = new RegExp(`${escRx(phrase)}[^\n]{0,80}(?:\[源[:：]|来源[:：]|证据[:：])`).test(raw);
    if (!supported) findings.push(finding(`freeze-${slug(phrase)}`, 'critical', `无证据授权性断言已冻结：${phrase}`, 'draft', REVIEW_RULES.locksAreGlobal, { frozen: true }));
  }
  if (/(?:已|全部)?(?:通过|满足)(?:所有|全部)?(?:校验|验收)|无任何问题/.test(raw)) {
    findings.push(finding('self-certification', 'critical', '正文含自我认证式通过声明', 'draft', REVIEW_RULES.noSelfCertification));
  }
  for (const hit of raw.matchAll(/\{\{[^}]+\}\}|\[(?:待填|待核实|TODO)\]|\b(?:TBD|TODO)\b|以系统核验为准/gi)) findings.push(finding(`placeholder-${hit.index}`, 'critical', `占位符未被真实结果替换：${hit[0]}`, 'draft', 'W68-D1'));
  for (const hit of raw.matchAll(/(?:本项|此处|该条)?(?:可不改|予以豁免|无需校验)/g)) findings.push(finding(`exemption-${hit.index}`, 'critical', `自我豁免归零：${hit[0]}`, 'draft', 'W68-D5'));
  const tlc = runTlcInspection(raw);
  findings.push(...tlc.findings);
  findings.push(...runArithmeticInspection(raw));
  const metrics = styleFingerprint(raw);
  if (/(?:镜头|视角)(?:拉近|推进|切到|转向)/.test(raw)) findings.push(finding('style-camera', 'warning', '命中特写运镜化表述，需回到事实层', 'draft', 'W68-S4'));
  if (previousText && repairOrder) {
    const stability = validateRepairRevision(previousText, raw, repairOrder);
    findings.push(...stability.findings);
  }
  const blocking = findings.filter(x => x.severity === 'critical');
  const pressureStages = [
    { id: 'density', label: '信息密度', pass: true, observationOnly: true },
    { id: 'numeric-purity', label: '数字纯度', pass: !findings.some(x => /^(?:math|source|basis|tlc-)/.test(x.id)) },
    { id: 'consistency', label: '自洽与稳定', pass: !findings.some(x => /^(?:lock|protected|ban)-/.test(x.id)) },
    { id: 'final', label: '终审态', pass: blocking.length === 0 },
  ];
  return { pass: blocking.length === 0, findings, blocking, metrics, tlc, pressureStages, blindSpots: ['语义方向由 M2 对点席判断', '正典引用存在性由外围审理席开卷核对', '未登记现实锚不由机器臆测'], checkedAt: new Date().toISOString() };
}

export function buildRepairOrder(machineReport, { protectionList = [], source = 'machine' } = {}) {
  const items = list(machineReport?.findings).filter(x => x.severity === 'critical').map((x, index) => ({
    id: `R${index + 1}`,
    position: x.artifactRef || 'draft',
    error: x.message,
    change: x.frozen ? '删除或改成可由登记证据支持的表述；不得自行补造授权、来源或数值' : '只修复本项并重新对齐验收点',
    reason: x.ruleRef || REVIEW_RULES.machineBeforePoint,
  }));
  return { kind: 'repair-order', source, items, protectionList: list(protectionList).map(asText).filter(Boolean), createdAt: new Date().toISOString() };
}

export function repairOrderMarkdown(order) {
  const items = list(order?.items);
  return [
    '# 修订单', '',
    line('来源', order?.source),
    line('性质', '本单只授权列明的改动；不等同审理报告'),
    '',
    '| 编号 | 位置 | 错误 | 应改 | 理由/规则 |',
    '|---|---|---|---|---|',
    ...(items.length ? items.map(x => `| ${x.id} | ${x.position} | ${x.error} | ${x.change} | ${x.reason} |`) : ['| — | — | 无关键修订项 | — | — |']),
    '',
    '## 保护清单', '',
    ...(list(order?.protectionList).length ? list(order.protectionList).map(x => `- ${x}`) : ['- 未登记；仍禁止无关改写']),
  ].join('\n');
}

export function validateRepairRevision(previous, revised, order = {}) {
  const findings = [];
  for (const protectedText of list(order.protectionList)) {
    if (asText(protectedText) && asText(previous).includes(protectedText) && !asText(revised).includes(protectedText)) {
      findings.push(finding(`protected-${slug(protectedText)}`, 'critical', `修订误伤保护项：${protectedText}`, 'repair-order', REVIEW_RULES.reviewerDoesNotRewrite));
    }
  }
  return { pass: findings.length === 0, findings };
}

export function machineReportMarkdown(report) {
  const findings = list(report?.findings);
  return [
    '# 确定性机检报告', '',
    line('结论', report?.pass ? '通过' : '退回'),
    line('关键问题', findings.filter(x => x.severity === 'critical').length),
    line('警告', findings.filter(x => x.severity !== 'critical').length),
    '',
    '## 发现', '',
    ...(findings.length ? findings.map(x => `- [${x.severity}] ${x.id}｜${x.message}｜工件 ${x.artifactRef}｜规则 ${x.ruleRef}`) : ['- 未发现规则命中']),
    '',
    '## 文风指纹', '',
    '```json', JSON.stringify(report?.metrics || {}, null, 2), '```',
    '', '## 四轮加压', '',
    ...list(report?.pressureStages).map(x => `- [${x.pass ? '通过' : '待审'}] ${x.label}`),
    '', '## 盲区声明', '',
    ...list(report?.blindSpots).map(x => `- ${x}`),
  ].join('\n');
}

function stripFence(raw) {
  const text = asText(raw);
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export function parseReviewPacket(raw, fallback = {}) {
  if (raw && typeof raw === 'object') return { ...fallback, ...raw };
  try { return { ...fallback, ...JSON.parse(stripFence(raw)) }; }
  catch { return { ...fallback, raw: asText(raw), parseWarning: true }; }
}

function parseStrictReviewPacket(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    const parsed = JSON.parse(stripFence(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  return { raw: asText(raw), parseWarning: true };
}

export function normalizeExternalReviewPacket(packet) {
  const source = packet && typeof packet === 'object' && !Array.isArray(packet) ? packet : {};
  const objections = Array.isArray(source.objections) ? source.objections : [];
  const invalidRow = objections.findIndex(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return true;
    return !strictText(row.id)
      || !['critical', 'major', 'minor'].includes(strictText(row.severity))
      || !strictText(row.claim || row.message)
      || !isArtifactEvidenceRef(row.artifactRef)
      || !strictText(row.ruleRef);
  });
  const invalidReason = source.parseWarning
    ? 'review-packet-unparseable'
    : !Object.prototype.hasOwnProperty.call(source, 'objections')
      ? 'review-objections-missing'
      : !Array.isArray(source.objections)
        ? 'review-objections-not-array'
        : invalidRow >= 0
          ? `review-objection-${invalidRow + 1}-invalid`
        : '';
  return {
    ...source,
    objections: invalidReason ? [] : objections,
    objectionCount: objections.length,
    invalidObjectionIndex: invalidRow,
    valid: !invalidReason,
    invalidReason,
  };
}

export function normalizeHearingPacket(packet) {
  const source = packet && typeof packet === 'object' && !Array.isArray(packet) ? packet : {};
  const requestedDecision = strictText(source.decision).toLowerCase();
  const reason = strictText(source.reason);
  const ruleRef = strictText(source.ruleRef);
  const invalidReason = source.parseWarning
    ? 'hearing-packet-unparseable'
    : !['overrule', 'sustain'].includes(requestedDecision)
      ? 'hearing-decision-invalid'
      : !reason || !ruleRef
        ? 'hearing-citation-missing'
        : '';
  return {
    ...source,
    requestedDecision,
    reason,
    ruleRef,
    decision: invalidReason ? 'sustain' : requestedDecision,
    valid: !invalidReason,
    invalidReason,
    normalization: invalidReason ? 'fail-closed' : 'none',
    parseWarning: source.parseWarning === true,
    rawSummary: source.parseWarning ? rawAuditSummary(source.raw) : '',
  };
}

function isArtifactEvidenceRef(value) {
  return /^(?:draft|skeleton|artifact|review|machine|point|objection|answer|bible):\S[\s\S]*$/.test(strictText(value));
}

export function normalizeAnswerPacket(packet, { evidenceRefs = [] } = {}) {
  const source = packet && typeof packet === 'object' && !Array.isArray(packet) ? packet : {};
  const answer = strictText(source.answer);
  const evidenceRef = strictText(source.evidenceRef);
  const requestedOutcome = strictText(source.outcome).toLowerCase();
  const catalog = new Set(list(evidenceRefs).map(strictText).filter(Boolean));
  const invalidReason = source.parseWarning
    ? 'answer-packet-unparseable'
    : !answer
      ? 'answer-text-missing'
      : !isArtifactEvidenceRef(evidenceRef)
        ? 'answer-evidence-ref-invalid'
        : !catalog.has(evidenceRef)
          ? 'answer-evidence-ref-unresolved'
        : '';
  return {
    ...source,
    answer,
    evidenceRef,
    requestedOutcome,
    resolvedEvidenceRef: invalidReason ? '' : evidenceRef,
    evidenceSource: invalidReason ? '' : evidenceRef.split(':', 1)[0],
    valid: !invalidReason,
    invalidReason,
    normalization: invalidReason ? 'fail-closed' : requestedOutcome ? 'answer-outcome-ignored' : 'none',
    parseWarning: source.parseWarning === true,
    rawSummary: source.parseWarning ? rawAuditSummary(source.raw) : '',
  };
}

export function normalizeReconsiderPacket(packet) {
  const source = packet && typeof packet === 'object' && !Array.isArray(packet) ? packet : {};
  const requestedOutcome = strictText(source.outcome).toLowerCase();
  const reason = strictText(source.reason);
  const invalidReason = source.parseWarning
    ? 'reconsider-packet-unparseable'
    : !['withdraw', 'hold'].includes(requestedOutcome)
      ? 'reconsider-outcome-invalid'
      : !reason
        ? 'reconsider-reason-missing'
        : '';
  return {
    ...source,
    requestedOutcome,
    reason,
    outcome: invalidReason ? 'hold' : requestedOutcome,
    valid: !invalidReason,
    invalidReason,
    normalization: invalidReason ? 'fail-closed' : 'none',
    parseWarning: source.parseWarning === true,
    rawSummary: source.parseWarning ? rawAuditSummary(source.raw) : '',
  };
}

export function buildAnswerEvidenceCatalog({ schema = {}, machine = {}, point = {}, reviews = [], objections = [] } = {}) {
  const refs = new Set();
  const add = value => {
    const ref = strictText(value);
    if (isArtifactEvidenceRef(ref)) refs.add(ref);
  };
  for (const group of ['requiredBeats', 'plantedSeeds', 'lockedFacts', 'forbiddenBoundaries']) {
    for (const row of list(schema?.[group])) {
      const id = strictText(row?.id);
      if (id) refs.add(`skeleton:${id}`);
    }
  }
  for (const row of [...list(machine?.findings), ...list(machine?.blocking), ...list(point?.findings), ...list(point?.advisoryFindings)]) add(row?.artifactRef);
  for (const review of list(reviews)) for (const row of list(review?.packet?.objections)) add(row?.artifactRef);
  for (const objection of list(objections)) {
    add(objection?.artifactRef);
    const id = strictText(objection?.id);
    if (id) refs.add(`objection:${id}`);
  }
  return [...refs].sort();
}

function pointSchemaEntry(schema, artifactRef) {
  const match = /^skeleton:([^\s#]+)$/.exec(asText(artifactRef));
  if (!match) return null;
  const id = match[1];
  const groups = ['requiredBeats', 'plantedSeeds', 'lockedFacts', 'forbiddenBoundaries'];
  for (const group of groups) {
    const entry = list(schema?.[group]).find(item => asText(item?.id) === id);
    if (entry) return { group, entry };
  }
  return null;
}

function pointItemArtifactRef(value) {
  const row = value && typeof value === 'object' ? value : {};
  return asText(row.artifactRef || row.position);
}

function isOptionalOutlineAnchorItem(value, schema) {
  const row = value && typeof value === 'object' ? value : {};
  const resolved = pointSchemaEntry(schema, pointItemArtifactRef(row));
  if (resolved?.group !== 'requiredBeats') return false;
  return resolved.entry.required === false && asText(resolved.entry.id) === 'outline-anchor';
}

function isCitedPointFinding(value) {
  const row = value && typeof value === 'object' ? value : {};
  return !!(asText(row.message || row.claim || row.error) && asText(row.artifactRef) && asText(row.ruleRef));
}

function isExecutablePointRepair(value) {
  const row = value && typeof value === 'object' ? value : {};
  return !!(
    asText(row.error || row.message)
    && asText(row.change)
    && asText(row.position || row.artifactRef)
    && asText(row.reason || row.ruleRef)
  );
}

function isRequiredContractFailure(value, schema) {
  const row = value && typeof value === 'object' ? value : {};
  const reasonCode = asText(row.reasonCode).toUpperCase();
  if (!['REQUIRED_CONTRACT_CONFLICT', 'REQUIRED_CONTRACT_UNSATISFIABLE'].includes(reasonCode)) return false;
  const resolved = pointSchemaEntry(schema, row.artifactRef);
  return resolved?.entry?.required === true && isCitedPointFinding(row);
}

/**
 * Normalize M2's semantic decision against typed acceptance-schema ownership.
 * This deliberately uses schema ids/reason codes/citations instead of guessing
 * from prose.  Invalid adjustment packets block the unit; they never create an
 * empty repair order or consume all three main-loop rounds.
 */
export function normalizePointReviewPacket(packet, schema = {}) {
  const source = packet && typeof packet === 'object' ? packet : {};
  const requestedDecision = asText(source.decision).toLowerCase();
  const findings = list(source.findings);
  const repairItems = list(source.repairItems);
  const base = { ...source, requestedDecision, findings, repairItems };
  // Resolve schema ownership before interpreting prose or severity.  In
  // particular, the synthetic outline anchor is advisory even if M2 repeats it
  // or mistakenly emits an executable-looking repair for it.
  const findingKinds = findings.map(row => ({
    row,
    optionalOutlineAnchor: isOptionalOutlineAnchorItem(row, schema),
    cited: isCitedPointFinding(row),
    severity: asText(row?.severity).toLowerCase(),
  }));
  const repairKinds = repairItems.map(row => ({
    row,
    optionalOutlineAnchor: isOptionalOutlineAnchorItem(row, schema),
    executable: isExecutablePointRepair(row),
  }));
  const itemCount = findingKinds.length + repairKinds.length;
  const optionalOnly = itemCount > 0
    && findingKinds.every(item => item.optionalOutlineAnchor)
    && repairKinds.every(item => item.optionalOutlineAnchor);
  const independentFindings = findingKinds.filter(item => !item.optionalOutlineAnchor && item.cited);
  const independentRepairs = repairKinds.filter(item => !item.optionalOutlineAnchor && item.executable);
  const invalid = invalidReason => ({
    ...base,
    decision: 'invalid',
    valid: false,
    invalidReason,
    normalization: 'fail-closed',
  });

  if (source.parseWarning) return invalid('point-packet-unparseable');
  if (requestedDecision === 'pass') {
    const empty = itemCount === 0;
    if (empty || optionalOnly) {
      return {
        ...base,
        decision: 'pass',
        valid: true,
        invalidReason: '',
        normalization: empty ? 'none' : 'optional-outline-anchor-advisory',
      };
    }
    if (independentFindings.some(item => ['critical', 'major'].includes(item.severity))) {
      return invalid('pass-with-blocking-finding');
    }
    if (independentRepairs.length) return invalid('pass-with-actionable-repair');
    return invalid('pass-with-non-advisory-items');
  }

  if (requestedDecision === 'adjust') {
    if (optionalOnly) {
      return {
        ...base,
        decision: 'pass',
        valid: true,
        invalidReason: '',
        normalization: 'optional-outline-anchor-advisory',
      };
    }
    const approvedConsultation = source.consultation?.approved === true
      && !!asText(source.consultation?.proposal)
      && !!asText(source.consultation?.skeletonPatch || source.consultation?.biblePatch);
    // An approved consultation is a separate schema-change transaction, not an
    // empty draft adjustment. M1 must first materialize a required schema ref;
    // only then may the runtime synthesize a cited M3 repair authorization.
    if (!independentFindings.length && !independentRepairs.length && approvedConsultation) {
      return { ...base, decision: 'consult_schema', valid: true, invalidReason: '', normalization: 'approved-consultation' };
    }
    if (!independentFindings.length && !independentRepairs.length) return invalid('adjust-without-actionable-cited-item');
    return {
      ...base,
      // Advisory anchor rows remain auditable but never enter M3's repair
      // order.  This also prevents an optional repair from shadowing a real
      // independent finding in the order-building fallback below.
      findings: independentFindings.map(item => item.row),
      repairItems: independentRepairs.map(item => item.row),
      advisoryFindings: findingKinds.filter(item => item.optionalOutlineAnchor).map(item => item.row),
      advisoryRepairItems: repairKinds.filter(item => item.optionalOutlineAnchor).map(item => item.row),
      decision: 'adjust',
      valid: true,
      invalidReason: '',
      normalization: findingKinds.some(item => item.optionalOutlineAnchor)
        || repairKinds.some(item => item.optionalOutlineAnchor)
        ? 'optional-outline-anchor-filtered'
        : 'none',
    };
  }

  if (requestedDecision === 'return_skeleton') {
    if (!findings.some(row => isRequiredContractFailure(row, schema))) {
      return invalid('return-skeleton-without-required-contract-failure');
    }
    return { ...base, decision: 'return_skeleton', valid: true, invalidReason: '', normalization: 'none' };
  }
  return invalid('unknown-point-decision');
}

/**
 * Build the compact, cited evidence packet owned by the final arbitration
 * seat.  It deliberately contains conclusions and references, never the
 * creative body, so the arbiter cannot invent a fifth review gate or mistake
 * an initial unit's absent bible for missing review evidence.
 */
export function buildFinalArbitrationEvidence({
  gates = {}, machine = {}, point = {}, reviews = [], objections = [],
  openCritical = [], evidenceConflicts = [], bible = '', initialUnit = false, budget = {},
} = {}) {
  const gateRows = Object.entries(gates).map(([id, open]) => ({ ref: `gate:${id}`, open: open === true }));
  const closedGateRefs = gateRows.filter(row => !row.open).map(row => row.ref);
  const unresolvedObjections = list(openCritical).map((row, index) => ({
    ref: `objection:${asText(row?.id) || index + 1}`,
    severity: asText(row?.severity) || 'critical',
    status: asText(row?.status) || 'open',
    artifactRef: asText(row?.artifactRef),
    ruleRef: asText(row?.ruleRef),
  }));
  const reviewRows = list(reviews).map(row => ({
    seat: asText(row?.seat),
    sampled: row?.sampled === true,
    objectionCount: list(row?.packet?.objections).length,
    parseWarning: row?.packet?.parseWarning === true,
  }));
  const conflictRows = list(evidenceConflicts).map((row, index) => ({
    ref: asText(row?.ref || row?.artifactRef) || `conflict:${index + 1}`,
    artifactRef: asText(row?.artifactRef),
    ruleRef: asText(row?.ruleRef),
  }));
  const bibleAudit = asText(bible)
    ? { state: 'available', blocking: false, ref: 'artifact:bible', coverage: 'supplied-project-bible' }
    : initialUnit
      ? { state: 'not-applicable-initial-unit', blocking: false, ref: 'artifact:bible', coverage: 'current-schema-machine-point-reviewed' }
      : { state: 'missing-required-project-bible', blocking: true, ref: 'artifact:bible', coverage: 'none' };
  const integrityBlockers = bibleAudit.blocking ? [bibleAudit.ref] : [];
  return {
    protocol: W68_PROTOCOL,
    authority: 'procedural-arbitration-only',
    gates: gateRows,
    closedGateRefs,
    machine: {
      pass: machine?.pass === true,
      blockingCount: list(machine?.blocking).length,
      blockingRefs: list(machine?.blocking).map(row => asText(row?.artifactRef || row?.id)).filter(Boolean),
    },
    point: {
      valid: point?.valid !== false,
      decision: asText(point?.decision),
      requestedDecision: asText(point?.requestedDecision || point?.decision),
      normalization: asText(point?.normalization) || 'none',
      findingRefs: list(point?.findings).map(row => asText(row?.artifactRef)).filter(Boolean),
    },
    reviews: reviewRows,
    objections: list(objections).map(row => ({
      ref: `objection:${asText(row?.id)}`,
      severity: asText(row?.severity),
      status: asText(row?.status),
      artifactRef: asText(row?.artifactRef),
      ruleRef: asText(row?.ruleRef),
    })),
    unresolvedObjections,
    evidenceConflicts: conflictRows,
    evidenceConflictCount: conflictRows.length,
    integrityBlockers,
    unresolvedBlockers: [
      ...closedGateRefs,
      ...unresolvedObjections.map(row => row.ref),
      ...conflictRows.map(row => row.ref),
      ...integrityBlockers,
    ],
    bibleAudit,
    budget,
  };
}

/**
 * Enforce M6's frozen authority: it may confirm a clean four-gate handoff or
 * block on an actually closed gate / unresolved cited objection.  An
 * unsupported generic block is retained for audit.  With no arbitration
 * subject the four gates remain authoritative and the packet is normalized to
 * a procedural pass; with real blockers an uncited or contradictory packet is
 * invalid and cannot open the gate.
 */
export function normalizeFinalArbitrationPacket(packet, evidence = {}) {
  const source = packet && typeof packet === 'object' && !Array.isArray(packet) ? packet : {};
  const requestedDecision = strictText(source.decision).toLowerCase();
  const closedGateRefs = new Set(list(evidence.closedGateRefs).map(asText).filter(Boolean));
  const unresolvedRefs = new Set(list(evidence.unresolvedObjections).map(row => asText(row?.ref)).filter(Boolean));
  const conflictRefs = new Set(list(evidence.evidenceConflicts).map(row => asText(row?.ref)).filter(Boolean));
  const integrityRefs = new Set(list(evidence.integrityBlockers).map(asText).filter(Boolean));
  const blockers = list(evidence.unresolvedBlockers).map(asText).filter(Boolean);
  const base = {
    ...source,
    requestedDecision,
    rawReason: strictText(source.reason),
    reason: strictText(source.reason),
    reasonCode: strictText(source.reasonCode).toUpperCase(),
    gateRef: strictText(source.gateRef),
    artifactRef: strictText(source.artifactRef),
    ruleRef: strictText(source.ruleRef),
  };
  const invalid = invalidReason => ({
    ...base,
    decision: 'invalid',
    valid: false,
    invalidReason,
    normalization: 'fail-closed',
    authorizedBlockers: blockers,
  });
  // A clean handoff contains no arbitration subject. Its outcome belongs to
  // the four deterministic gates; a free-form M6 opinion cannot become a
  // hidden fifth gate. The raw decision remains in requestedDecision.
  if (!blockers.length) {
    return {
      ...base,
      decision: 'pass',
      valid: true,
      reason: '四闸全开，且无未决质询、证据冲突或工件完整性阻断',
      invalidReason: '',
      normalization: requestedDecision === 'pass' && !source.parseWarning
        ? 'none'
        : 'quiet-path-deterministic',
      authorizedBlockers: [],
    };
  }
  if (source.parseWarning) return invalid('final-packet-unparseable');
  if (requestedDecision === 'pass') {
    return invalid('pass-with-unresolved-gate-or-conflict');
  }
  if (requestedDecision === 'block') {
    if (!base.reason || !base.ruleRef) return invalid('block-citation-details-missing');
    const citesClosedGate = base.reasonCode === 'CLOSED_GATE' && closedGateRefs.has(base.gateRef);
    const citesUnresolved = base.reasonCode === 'UNRESOLVED_OBJECTION' && unresolvedRefs.has(base.artifactRef);
    const citesConflict = base.reasonCode === 'EVIDENCE_CONFLICT' && conflictRefs.has(base.artifactRef);
    const citesIntegrity = base.reasonCode === 'ARTIFACT_INTEGRITY' && integrityRefs.has(base.artifactRef);
    if (!citesClosedGate && !citesUnresolved && !citesConflict && !citesIntegrity) return invalid('block-without-authorized-reference');
    return {
      ...base,
      decision: 'block',
      valid: true,
      invalidReason: '',
      normalization: 'none',
      authorizedBlockers: blockers,
    };
  }
  return invalid('unknown-final-decision');
}

export function normalizeObjection(value, index = 0) {
  const obj = value && typeof value === 'object' ? value : {};
  return {
    id: asText(obj.id) || `O${index + 1}`,
    severity: ['critical', 'major', 'minor'].includes(obj.severity) ? obj.severity : 'major',
    claim: asText(obj.claim || obj.message) || '审理输出未给出明确主张',
    artifactRef: asText(obj.artifactRef),
    ruleRef: asText(obj.ruleRef),
    status: 'open',
    reviewer: asText(obj.reviewer),
  };
}

function assignCanonicalObjectionId(objection, usedIds) {
  const sourceId = strictText(objection?.id) || 'O';
  const seat = strictText(objection?.reviewer) || 'review';
  const base = `${slug(seat)}-${slug(sourceId)}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) id = `${base}-${suffix++}`;
  usedIds.add(id);
  objection.sourceId = sourceId;
  objection.id = id;
  return objection;
}

export function validateObjection(objection) {
  const missing = [];
  if (!objection?.artifactRef) missing.push('artifactRef');
  if (!objection?.ruleRef) missing.push('ruleRef');
  return { valid: !missing.length, missing };
}

export class ReviewBudgetLedger {
  constructor() {
    // Compatibility envelope only: workflow execution is no longer governed by
    // a product-estimated token cap.  We retain provider-reported usage for
    // observability when the provider supplies it.
    this.capTokens = null;
    this.usedTokens = 0;
    this.entries = [];
  }
  canSpend() { return true; }
  charge({ seat, phase, usage = null }) {
    const inputTokens = Math.max(0, Number(usage?.inputTokens) || 0);
    const outputTokens = Math.max(0, Number(usage?.outputTokens) || 0);
    const tokens = Math.max(0, Number(usage?.totalTokens) || inputTokens + outputTokens);
    if (!tokens) return 0;
    this.usedTokens += tokens;
    this.entries.push({ seat, phase, tokens, inputTokens, outputTokens, source: 'provider-reported', at: new Date().toISOString() });
    return tokens;
  }
  summary(units = 1) {
    const bySeat = {};
    for (const entry of this.entries) bySeat[entry.seat] = (bySeat[entry.seat] || 0) + entry.tokens;
    return {
      capTokens: null,
      usedTokens: this.usedTokens,
      remainingTokens: null,
      bySeat,
      perUnit: Math.round(this.usedTokens / Math.max(1, units)),
      per10k: 0,
      entries: this.entries,
      source: 'provider-reported',
      enforced: false,
    };
  }
}

export function planReviewRitual(requested = 'light') {
  const ritual = requested === 'full' ? 'full' : 'light';
  return { requested: ritual, effective: ritual, downgraded: false, stopped: false, reason: '' };
}

function pointFindingMarkdown(row, index, prefix = 'P') {
  const item = row && typeof row === 'object' ? row : { message: row };
  return `- ${prefix}${index + 1}｜级别=${asText(item.severity) || '未标注'}｜代码=${asText(item.reasonCode) || '未标注'}｜说明=${asText(item.message || item.claim || item) || '未说明'}｜工件=${asText(item.artifactRef) || '未引用'}｜规则=${asText(item.ruleRef) || '未引用'}`;
}

function pointRepairMarkdown(row, index, prefix = 'R') {
  const item = row && typeof row === 'object' ? row : { error: row };
  return `- ${prefix}${index + 1}｜问题=${asText(item.error || item.message || item) || '未说明'}｜修改=${asText(item.change) || '未说明'}｜位置=${asText(item.position || item.artifactRef) || '未引用'}｜理由=${asText(item.reason || item.ruleRef) || '未引用'}`;
}

function pointReportMarkdown(packet, round) {
  const normalizedAdvisory = packet.normalization === 'optional-outline-anchor-advisory';
  const findings = normalizedAdvisory ? [] : list(packet.findings);
  const repairs = normalizedAdvisory ? [] : list(packet.repairItems);
  const advisoryFindings = [
    ...(normalizedAdvisory ? list(packet.findings) : []),
    ...list(packet.advisoryFindings),
  ];
  const advisoryRepairs = [
    ...(normalizedAdvisory ? list(packet.repairItems) : []),
    ...list(packet.advisoryRepairItems),
  ];
  return [
    '# 对点报告', '',
    line('主环轮次', round),
    line('节点验收席原始决定', packet.requestedDecision || packet.decision),
    line('系统归一决定', packet.decision),
    line('归一规则', packet.normalization || 'none'),
    line('包有效性', packet.valid === false ? '无效' : '有效'),
    line('无效原因', packet.invalidReason || '无'),
    line('解析降级', packet.parseWarning ? '是' : '否'),
    '', '## 正式判断', '',
    ...(findings.length ? findings.map((x, i) => pointFindingMarkdown(x, i)) : ['- 无']),
    '', '## 正式修订项', '',
    ...(repairs.length ? repairs.map((x, i) => pointRepairMarkdown(x, i)) : ['- 无']),
    '', '## 非阻断建议', '',
    ...(advisoryFindings.length ? advisoryFindings.map((x, i) => pointFindingMarkdown(x, i, 'A')) : ['- 无']),
    '', '## 已过滤的建议修订', '',
    ...(advisoryRepairs.length ? advisoryRepairs.map((x, i) => pointRepairMarkdown(x, i, 'AR')) : ['- 无']),
  ].join('\n');
}

function polishRecordMarkdown(record) {
  if (!record) return '# 润色记录\n\n- 轻仪式或本轮未启用独立润色站。';
  return ['# 润色记录', '', line('结论', record.accepted ? '采用' : '回退原稿'), line('理由', record.reason), '', '## 润色前指纹', '', '```json', JSON.stringify(record.before || {}, null, 2), '```', '', '## 润色后指纹', '', '```json', JSON.stringify(record.after || {}, null, 2), '```'].join('\n');
}

function consultationMarkdown(packet) {
  return ['# 请示单', '', line('提案', packet?.proposal), line('理由', packet?.reason), line('M2 决定', packet?.approved ? '批准；先改骨架/圣经再动正文' : '不批准'), line('骨架变更', packet?.skeletonPatch), line('圣经变更', packet?.biblePatch)].join('\n');
}

function reviewMarkdown(reviews) {
  return ['# 背靠背审理表', '', line('规则', '审理席只提问题，不直接改稿'), '', ...reviews.flatMap(row => [`## ${row.seat}`, '', line('抽样/全审', row.sampled ? '抽样' : '全审'), line('包有效性', row.packet.valid === false ? '无效' : '有效'), line('无效原因', row.packet.invalidReason || '无'), line('解析降级', row.packet.parseWarning ? '是' : '否'), line('原始质询数', row.packet.objectionCount ?? list(row.packet.objections).length), ...(list(row.packet.objections).length ? list(row.packet.objections).map((x, i) => `- ${strictText(x?.id) || `O${i + 1}`}｜${strictText(x?.claim || x?.message)}｜${strictText(x?.artifactRef)}｜${strictText(x?.ruleRef)}`) : ['- 无可执行质询'])])].join('\n');
}

function objectionMarkdown(objections) {
  return ['# 质询单', '', ...objections.flatMap(x => {
    const hearing = x.hearing && typeof x.hearing === 'object' ? x.hearing : null;
    return [
      `## ${x.id}`, '',
      line('审理席', x.reviewer),
      line('模型原始 ID', x.sourceId || x.id),
      line('原始级别', x.originalSeverity || x.severity),
      line('系统级别', x.severity),
      line('主张', x.claim),
      line('工件引用', x.artifactRef),
      line('规则引用', x.ruleRef),
      line('状态', x.status),
      line('庭审原始决定', hearing ? (hearing.requestedDecision || '未形成') : '未执行'),
      line('庭审系统决定', hearing ? hearing.decision : '未执行'),
      line('庭审包有效性', !hearing ? '未执行' : hearing.valid === false ? '无效' : '有效'),
      line('庭审归一规则', hearing ? (hearing.normalization || 'none') : '未执行'),
      line('庭审无效原因', hearing ? (hearing.invalidReason || '无') : '未执行'),
      line('庭审理由', hearing ? (hearing.reason || '未提供') : '未执行'),
      line('庭审规则引用', hearing ? (hearing.ruleRef || '未引用') : '未执行'),
    ];
  })].join('\n');
}

function answerMarkdown(answers) {
  return ['# 答辩书', '', ...answers.flatMap(x => {
    const packet = x.answerPacket && typeof x.answerPacket === 'object' ? x.answerPacket : x;
    const reconsider = x.reconsider && typeof x.reconsider === 'object' ? x.reconsider : null;
    return [
      `## ${x.objectionId}`, '',
      line('答辩', packet.answer || '未形成'),
      line('模型原始撤回请求', packet.requestedOutcome || '未声明'),
      line('答辩系统权限结果', packet.valid === true ? '可进入原席复议；答辩席无撤回权' : '保持质询，不进入原席复议'),
      line('证据原始引用', packet.evidenceRef || '未引用'),
      line('证据解析引用', packet.resolvedEvidenceRef || '未解析'),
      line('证据来源', packet.evidenceSource || '未解析'),
      line('答辩包有效性', packet.valid === false ? '无效' : '有效'),
      line('答辩无效原因', packet.invalidReason || '无'),
      line('答辩归一规则', packet.normalization || 'none'),
      line('答辩解析降级', packet.parseWarning ? '是' : '否'),
      line('答辩原始摘要', packet.rawSummary || '结构化字段已分项留痕'),
      line('原席原始决定', reconsider ? (reconsider.requestedOutcome || '未形成') : '未执行'),
      line('原席系统决定', reconsider ? reconsider.outcome : '未执行'),
      line('复议包有效性', !reconsider ? '未执行' : reconsider.valid === false ? '无效' : '有效'),
      line('复议无效原因', reconsider ? (reconsider.invalidReason || '无') : '未执行'),
      line('复议归一规则', reconsider ? (reconsider.normalization || 'none') : '未执行'),
      line('复议解析降级', reconsider ? (reconsider.parseWarning ? '是' : '否') : '未执行'),
      line('复议原始摘要', reconsider ? (reconsider.rawSummary || '结构化字段已分项留痕') : '未执行'),
      line('复议理由', reconsider ? (reconsider.reason || '未提供') : '未执行'),
      line('审理结果', x.outcome),
      line('轮次', x.round),
    ];
  })].join('\n');
}

function verdictMarkdown(result) {
  const finalPresent = !!(result.finalArbitration && typeof result.finalArbitration === 'object');
  const final = finalPresent ? result.finalArbitration : {};
  return [
    '# 裁决书', '',
    line('最终裁决', result.verdict),
    line('封存', result.sealed ? '是；原件只读，后续更正另立补遗' : '否'),
    line('仲裁席原始决定', finalPresent ? (final.requestedDecision || '未形成') : '未执行'),
    line('仲裁席原始理由', finalPresent ? (final.rawReason || '无') : '未执行'),
    line('系统归一决定', finalPresent ? (final.decision || result.verdict) : '未执行'),
    line('裁决包有效性', !finalPresent ? '未执行' : final.valid === false ? '无效' : '有效'),
    line('归一规则', finalPresent ? (final.normalization || 'none') : '未执行'),
    line('无效原因', finalPresent ? (final.invalidReason || '无') : '未执行'),
    line('阻断引用', list(final.authorizedBlockers).join(' / ') || '无'),
    line('机检闸', result.gates.machine ? '开' : '关'),
    line('对点闸', result.gates.point ? '开' : '关'),
    line('审理闸', result.gates.review ? '开' : '关'),
    line('质询闸', result.gates.objection ? '开' : '关'),
    line('理由', result.reason),
    line('协议', W68_PROTOCOL),
  ].join('\n');
}

function precedentMarkdown({ unitRef, objections, verdict }) {
  const reusable = objections.filter(x => x.status === 'closed' || x.status === 'overruled');
  return ['## 判例 ' + asText(unitRef), '', line('裁决', verdict), ...reusable.map(x => `- ${x.ruleRef}｜${x.claim}｜处置：${x.status}`)].join('\n');
}

/**
 * 执行 W68a。生产调用的 ask 应返回
 * { text, finishReason, completionKind, usage, safeToCommit }；字符串返回只为旧合同兼容。
 * 返回 sealed=false 时调用方不得写入正典正文，只可保存工件与任务状态。
 */
export async function runW68Review({
  draft = '', blueprint = '', outline = '', bible = '', unitRef = '第001单元',
  unitIndex = null,
  ritual = 'light', ask, previousText = '', protectionList = [],
  additionalMachineChecks = null, precedents = '', requireCompletionMetadata = false,
} = {}) {
  if (typeof ask !== 'function') throw new Error('W68a 缺少审理调用器');
  const ritualPlan = planReviewRitual(ritual);
  const ledger = new ReviewBudgetLedger();
  const explicitUnitIndex = Number(unitIndex);
  const inferredUnitIndex = Number(/^第0*(\d+)/.exec(asText(unitRef))?.[1] || 0);
  const resolvedUnitIndex = Number.isInteger(explicitUnitIndex) && explicitUnitIndex > 0
    ? explicitUnitIndex
    : inferredUnitIndex;
  const initialUnit = resolvedUnitIndex === 1;
  const transitions = ['skeleton'];
  if (asText(precedents)) transitions.push('precedent:loaded');
  let schema = buildAcceptanceSchema({ blueprint, outline });
  let text = asText(draft);
  let machine = null;
  const machineHistory = [];
  let point = null;
  let consultation = null;
  let polishRecord = null;
  let polishAttempted = false;
  const repairs = [];
  const reworkHistory = [];
  const pointReports = [];
  const reviews = [];
  const objections = [];
  const answers = [];
  const usedObjectionIds = new Set();
  const inspectText = current => {
    const base = runDeterministicInspection(current, schema, { previousText, repairOrder: repairs.at(-1) });
    if (typeof additionalMachineChecks !== 'function') return base;
    const extras = list(additionalMachineChecks(current)).filter(x => x && x.pass === false).map((x, index) => finding(
      `template-${index + 1}`, 'critical', asText(x.label || x.detail || '模板质量规则未通过'), 'draft', 'W68-M-TEMPLATE',
    ));
    if (!extras.length) return base;
    base.findings.push(...extras);
    base.blocking.push(...extras);
    base.pass = false;
    return base;
  };
  const invoke = async ({ seat, role, phase, system, user, temperature = 0.2 }) => {
    const response = await ask({ role, system, user, temperature });
    const detailed = response && typeof response === 'object' && !Array.isArray(response);
    const output = detailed ? asText(response.text) : asText(response);
    const finishReason = detailed && response.finishReason != null ? asText(response.finishReason).toLowerCase() : '';
    const trustedCompletion = detailed && response.safeToCommit === true && finishReason === 'stop' && !!output;
    ledger.charge({ seat, phase, usage: detailed ? response.usage : null });
    if ((requireCompletionMetadata && !detailed) || (detailed && !trustedCompletion)) {
      const error = new Error(`W68a Provider 完成门关闭：${asText(response?.finishReason || response?.completionKind) || (output ? '缺少可信终态' : '空响应')}`);
      error.code = 'W68_COMPLETION_UNSAFE';
      error.completion = detailed ? {
        finishReason: response.finishReason ?? null,
        completionKind: asText(response.completionKind),
        safeToCommit: response.safeToCommit === true,
      } : { finishReason: null, completionKind: 'legacy-string', safeToCommit: false };
      throw error;
    }
    return output;
  };
  try {
    // 主环：确定性机检 → M2 对点 → 修订；最多三轮，仍不收敛则推定骨架问题。
    for (let round = 1; round <= 3; round++) {
      transitions.push(`machine:${round}`);
      machine = inspectText(text);
      machineHistory.push({ round, report: machine });
      if (!machine.pass) {
        const order = buildRepairOrder(machine, { protectionList, source: `machine:${round}` });
        repairs.push(order);
        transitions.push(`repair:${round}`);
        const before = text;
        const revised = await invoke({
          seat: 'M3', role: 'factory_writer', phase: `main-repair-${round}`,
          system: 'MAZZ_W68_REPAIR\n你是 M3 执笔席。修订单是唯一改稿授权；只修列明项目，保护其余内容。不得解释，不得宣称自己通过验收，只输出完整修订正文。',
          user: `【骨架与验收点】\n${acceptanceSchemaMarkdown(schema)}\n\n【初稿】\n${text}\n\n【修订单】\n${repairOrderMarkdown(order)}`,
          temperature: 0.35,
        });
        previousText = before;
        text = revised || text;
        reworkHistory.push({
          source: order.source, stage: 'draft', reasonCode: 'MACHINE_FINDING', order,
          beforeText: before, afterText: text, residueReport: inspectText(text),
          assignedSeatRef: 'seat:M3', attempt: reworkHistory.length + 1,
        });
        continue;
      }
      if (ritualPlan.effective === 'full' && !polishAttempted) {
        polishAttempted = true;
        transitions.push(`polish:${round}`);
        const before = text;
        const polished = await invoke({
          seat: '润色席', role: 'factory_polish', phase: `polish-${round}`,
          system: 'MAZZ_W68_POLISH\n你是独立润色席，不得改变事实、数值、事件顺序或验收点。依次处理：删直接心理报告、打散重复段首、替换粗俗比喻、补一个不抢戏的具体死物、让结尾留有余波；对话只改语气不改信息。只输出完整正文。',
          user: `【锁定验收点】\n${acceptanceSchemaMarkdown(schema)}\n\n【正文】\n${before}`,
          temperature: 0.3,
        });
        const polishedMachine = inspectText(polished);
        const accepted = polishedMachine.pass;
        polishRecord = { accepted, before: styleFingerprint(before), after: styleFingerprint(polished), reason: accepted ? '润色后确定性机检仍通过' : '润色引入关键机检错误，自动回退', text: accepted ? polished : before };
        if (accepted) {
          text = polished;
          machine = polishedMachine;
          machineHistory.push({ round: `polish-${round}`, report: machine });
        } else transitions.push(`polish-reverted:${round}`);
      }
      transitions.push(`point:${round}`);
      const pointRaw = await invoke({
        seat: 'M2', role: 'factory_point', phase: `point-${round}`,
        system: 'MAZZ_W68_POINT\n你是 M2 对点席，与 M3 分离。不得直接改稿。只返回 JSON：{"decision":"pass|adjust|return_skeleton","findings":[{"severity":"critical|major|warning","reasonCode":"SEMANTIC_MISMATCH|OPTIONAL_ANCHOR_MISSING|REQUIRED_CONTRACT_CONFLICT|REQUIRED_CONTRACT_UNSATISFIABLE","message":"...","artifactRef":"draft:位置或skeleton:id","ruleRef":"规则编号"}],"repairItems":[{"error":"...","change":"可执行改法","position":"draft:位置","reason":"规则编号"}],"consultation":{"proposal":"","reason":"","approved":false,"skeletonPatch":"","biblePatch":""}}。规则：[建议]（required:false）缺失本身不得成为 adjust 或 return_skeleton 的唯一理由；adjust 必须至少带一项可执行且可引用的独立 finding/repairItem；return_skeleton 只用于显式 [必达]/锁定契约互相矛盾或不可满足，并以 REQUIRED_CONTRACT_CONFLICT/REQUIRED_CONTRACT_UNSATISFIABLE 和 skeleton:id 引用声明。',
        user: `【验收点】\n${acceptanceSchemaMarkdown(schema)}\n\n【正文】\n${text}\n\n【机检】\n${machineReportMarkdown(machine)}\n\n【既有判例（同规则优先复用）】\n${precedents || '无'}`,
      });
      point = normalizePointReviewPacket(
        parseStrictReviewPacket(pointRaw),
        schema,
      );
      pointReports.push({ round, ...point });
      if (!point.valid) {
        transitions.push(`point-invalid:${round}`);
        break;
      }
      let consultationChangedSchema = false;
      if (point.consultation?.proposal) {
        consultation = { ...point.consultation };
        if (consultation.approved) {
          transitions.push(`consultation-approved:${round}`);
          const priorRequiredIds = new Set([
            ...list(schema.requiredBeats), ...list(schema.plantedSeeds),
            ...list(schema.lockedFacts), ...list(schema.forbiddenBoundaries),
          ].filter(item => item?.required === true).map(item => asText(item.id)));
          const skeletonRaw = await invoke({
            seat: 'M1', role: 'factory_skeleton', phase: `consultation-${round}`,
            system: 'MAZZ_W68_CONSULTATION\n你是骨架席。请把已批准请示先合并进骨架；只输出追加的显式 [必达]/[必埋]/[锁定]/[禁越] 行，不写正文。',
            user: `【原蓝图】\n${blueprint}\n\n【请示】\n${consultationMarkdown(consultation)}\n\n【圣经】\n${bible}`,
          });
          blueprint = `${blueprint}\n\n## W68a 已批准变更\n${skeletonRaw}`;
          bible = `${bible}\n\n## ${unitRef} 已批准请示\n${consultation.biblePatch || consultation.proposal}`;
          schema = buildAcceptanceSchema({ blueprint, outline });
          consultationChangedSchema = true;
          const addedRequired = [
            ...list(schema.requiredBeats), ...list(schema.plantedSeeds),
            ...list(schema.lockedFacts), ...list(schema.forbiddenBoundaries),
          ].find(item => item?.required === true && !priorRequiredIds.has(asText(item.id)));
          if (!addedRequired) {
            point = {
              ...point, decision: 'invalid', valid: false,
              invalidReason: 'approved-consultation-without-required-schema-change',
              normalization: 'fail-closed',
            };
            pointReports[pointReports.length - 1] = { round, ...point };
            transitions.push(`point-invalid:${round}`);
            break;
          }
          point = {
            ...point,
            decision: 'adjust',
            repairItems: [...list(point.repairItems), {
              id: `C${round}`,
              error: `正文尚未对齐已批准的新增必达契约：${asText(addedRequired.label)}`,
              change: `仅补齐已批准契约「${asText(addedRequired.label)}」，不得扩写其他内容`,
              position: `skeleton:${asText(addedRequired.id)}`,
              reason: REVIEW_RULES.locksAreGlobal,
            }],
          };
          pointReports[pointReports.length - 1] = { round, ...point };
        }
      }
      if (!point.valid) break;
      if (point.decision === 'pass') break;
      if (point.decision === 'return_skeleton') {
        transitions.push('nonconvergence:skeleton');
        break;
      }
      // 咨询分支只能凭刚落入 schema 的 required:true 引用授权修订；
      // 它绝不把原来的空 adjust 包直接交给 M3。
      if (consultationChangedSchema && !list(point.repairItems).some(isExecutablePointRepair)) {
        point = { ...point, decision: 'invalid', valid: false, invalidReason: 'consultation-repair-not-actionable', normalization: 'fail-closed' };
        pointReports[pointReports.length - 1] = { round, ...point };
        transitions.push(`point-invalid:${round}`);
        break;
      }
      const order = {
        kind: 'repair-order', source: `point:${round}`, protectionList: list(protectionList), createdAt: new Date().toISOString(),
        items: list(point.repairItems).map((x, i) => ({ id: x.id || `P${i + 1}`, position: x.position || x.artifactRef || 'draft', error: x.error || x.message || '对点偏差', change: x.change || '按对点意见作最小修订', reason: x.reason || x.ruleRef || REVIEW_RULES.machineBeforePoint })),
      };
      if (!order.items.length) order.items = list(point.findings).map((x, i) => ({ id: `P${i + 1}`, position: x.artifactRef || 'draft', error: x.message || asText(x), change: '作最小修订', reason: x.ruleRef || REVIEW_RULES.machineBeforePoint }));
      repairs.push(order);
      transitions.push(`repair:${round}`);
      const before = text;
      previousText = before;
      text = await invoke({
        seat: 'M3', role: 'factory_writer', phase: `point-repair-${round}`,
        system: 'MAZZ_W68_REPAIR\n你是 M3 执笔席。严格依修订单最小修订；不得扩写未授权内容，只输出完整正文。',
        user: `【正文】\n${text}\n\n【修订单】\n${repairOrderMarkdown(order)}\n\n【保护项】\n${list(protectionList).join('\n')}`,
        temperature: 0.35,
      }) || text;
      reworkHistory.push({
        source: order.source, stage: 'point', reasonCode: 'POINT_FINDING', order,
        beforeText: before, afterText: text, residueReport: inspectText(text),
        assignedSeatRef: 'seat:M3', attempt: reworkHistory.length + 1,
      });
    }
    machine = inspectText(text);
    machineHistory.push({ round: 'final', report: machine });
    if (point?.valid === false) {
      transitions.push('point-invalid');
      const result = {
        protocol: W68_PROTOCOL, sealed: false, verdict: 'point-invalid',
        reason: `M2 对点包无效：${point.invalidReason || '缺少可执行且可引用的判断'}`,
        ritual: ritualPlan, gates: { machine: machine.pass, point: false, review: false, objection: false },
        text, schema, machine, machineHistory, polishRecord, point, repairs, reworkHistory, pointReports,
        reviews, objections, answers, transitions, budget: ledger.summary(), bible,
      };
      result.artifacts = {
        skeleton: acceptanceSchemaMarkdown(schema), draft: text,
        polish: polishRecordMarkdown(polishRecord),
        machine: machineHistory.map(x => `## 机检轮次 ${x.round}\n\n${machineReportMarkdown(x.report)}`).join('\n\n---\n\n'),
        point: pointReports.map(x => pointReportMarkdown(x, x.round)).join('\n\n---\n\n'),
        repair: repairs.length ? repairs.map(repairOrderMarkdown).join('\n\n---\n\n') : '# 修订单\n\n- 无',
        consultation: consultation ? consultationMarkdown(consultation) : '# 请示单\n\n- 无',
        verdict: verdictMarkdown(result),
      };
      return result;
    }
    const mainConverged = machine.pass && point?.decision === 'pass';
    if (!mainConverged) {
      transitions.push('nonconvergence:skeleton');
      const result = { protocol: W68_PROTOCOL, sealed: false, verdict: 'return-skeleton', reason: '主环三轮未收敛；依规则推定骨架/验收点需重开', ritual: ritualPlan, gates: { machine: machine.pass, point: false, review: false, objection: false }, text, schema, machine, machineHistory, polishRecord, point, repairs, reworkHistory, pointReports, reviews, objections, answers, transitions, budget: ledger.summary(), bible };
      result.artifacts = { skeleton: acceptanceSchemaMarkdown(schema), draft: text, polish: polishRecordMarkdown(polishRecord), machine: machineHistory.map(x => `## 机检轮次 ${x.round}\n\n${machineReportMarkdown(x.report)}`).join('\n\n---\n\n'), point: pointReports.map(x => pointReportMarkdown(x, x.round)).join('\n\n---\n\n'), repair: repairs.map(repairOrderMarkdown).join('\n\n---\n\n'), consultation: consultation ? consultationMarkdown(consultation) : '# 请示单\n\n- 无', verdict: verdictMarkdown(result) };
      return result;
    }

    // 外围环：全仪式 M4/M5 背靠背；轻仪式 M4 抽样。若安静，强制再开 M5 红队。
    transitions.push('peripheral-review');
    const reviewerSeats = ritualPlan.effective === 'full'
      ? [{ seat: 'M4', role: 'factory_review_a', sampled: false }, { seat: 'M5', role: 'factory_review_b', sampled: false }]
      : [{ seat: 'M4', role: 'factory_review_a', sampled: true }];
    const doReview = async reviewer => {
      const raw = await invoke({
        seat: reviewer.seat, role: reviewer.role, phase: `review-${reviewer.seat}`,
        system: `MAZZ_W68_REVIEW\n你是 ${reviewer.seat} 外部审理席，与执笔席分离。不得改稿。只返回 JSON：{"objections":[{"id":"O1","severity":"critical|major|minor","claim":"...","artifactRef":"draft:段落/句子或skeleton:id","ruleRef":"规则编号"}]}。每项必须同时引用工件与规则。`,
        user: `【验收点】\n${acceptanceSchemaMarkdown(schema)}\n\n【正文】\n${text}\n\n【M2 对点】\n${pointReportMarkdown(point, pointReports.length)}\n\n【既有判例】\n${precedents || '无'}`,
      });
      const packet = normalizeExternalReviewPacket(parseStrictReviewPacket(raw));
      reviews.push({ ...reviewer, packet });
      if (!packet.valid) {
        const error = new Error(`${reviewer.seat} 审理包无效：${packet.invalidReason}`);
        error.code = 'W68_REVIEW_PACKET_INVALID';
        error.reviewPacket = packet;
        error.reviewer = reviewer;
        throw error;
      }
      for (const [index, rawObj] of list(packet.objections).entries()) {
        const obj = assignCanonicalObjectionId(
          normalizeObjection({ ...rawObj, reviewer: reviewer.seat }, objections.length + index),
          usedObjectionIds,
        );
        const citation = validateObjection(obj);
        if (!citation.valid) {
          obj.severity = 'critical';
          obj.claim = `质询缺少 ${citation.missing.join('、')}，无法进入答辩闭环`;
          obj.artifactRef ||= `review:${reviewer.seat}`;
          obj.ruleRef ||= REVIEW_RULES.citedObjections;
        }
        objections.push(obj);
      }
    };
    for (const reviewer of reviewerSeats) await doReview(reviewer);
    if (!objections.length && !reviewerSeats.some(x => x.seat === 'M5')) {
      transitions.push('quiet:red-team');
      await doReview({ seat: 'M5', role: 'factory_review_b', sampled: false });
    }

    // 质询由 M2 据证答辩；未撤回的关键质询最多两轮，随后强制 M6 开庭。
    const answerEvidenceRefs = buildAnswerEvidenceCatalog({ schema, machine, point, reviews, objections });
    transitions.push('objection-loop');
    for (const objection of objections) {
      for (let round = 1; round <= 2 && objection.status === 'open'; round++) {
        const raw = await invoke({
          seat: 'M2', role: 'factory_point', phase: `answer-${objection.id}-${round}`,
          system: 'MAZZ_W68_ANSWER\n你是 M2 答辩席。只返回 JSON：{"answer":"...","evidenceRef":"工件:位置"}。没有证据不得把置信语气当证据；答辩席无权请求撤回或维持质询。',
          user: `【质询】\n${JSON.stringify(objection)}\n\n【正文】\n${text}\n\n【验收点】\n${acceptanceSchemaMarkdown(schema)}`,
        });
        const answer = normalizeAnswerPacket(parseStrictReviewPacket(raw), { evidenceRefs: answerEvidenceRefs });
        let outcome = 'hold';
        let reconsider = null;
        if (answer.valid) {
          const reviewerRole = objection.reviewer === 'M5' ? 'factory_review_b' : 'factory_review_a';
          const reconsiderEvidence = {
            answer: answer.answer,
            evidenceRef: answer.resolvedEvidenceRef,
            valid: true,
          };
          const reconsiderRaw = await invoke({
            seat: objection.reviewer || 'M4', role: reviewerRole, phase: `reconsider-${objection.id}-${round}`,
            system: 'MAZZ_W68_RECONSIDER\n你是原质询审理席。根据答辩证据只返回 JSON：{"outcome":"withdraw|hold","reason":"..."}。撤回权属于质询席，不属于答辩席。',
            user: `【原质询】\n${JSON.stringify(objection)}\n\n【已解析答辩证据】\n${JSON.stringify(reconsiderEvidence)}`,
          });
          reconsider = normalizeReconsiderPacket(parseStrictReviewPacket(reconsiderRaw));
          outcome = reconsider.valid && reconsider.outcome === 'withdraw' ? 'withdraw' : 'hold';
        }
        answers.push({
          objectionId: objection.id,
          answer: answer.answer,
          evidenceRef: answer.evidenceRef,
          answerValid: answer.valid,
          answerInvalidReason: answer.invalidReason,
          answerPacket: answer,
          reconsider,
          outcome,
          round,
        });
        if (outcome === 'withdraw') objection.status = 'closed';
      }
      if (objection.status === 'open') {
        transitions.push(`hearing:${objection.id}`);
        const hearingAnswers = answers.filter(x => x.objectionId === objection.id).map(x => ({
          objectionId: x.objectionId,
          round: x.round,
          answer: strictText(x.answer),
          evidenceRef: strictText(x.answerPacket?.resolvedEvidenceRef || x.evidenceRef),
          answerValid: x.answerValid === true,
          answerInvalidReason: strictText(x.answerInvalidReason),
          reconsiderRequestedOutcome: strictText(x.reconsider?.requestedOutcome),
          reconsiderOutcome: strictText(x.reconsider?.outcome),
          reconsiderReason: strictText(x.reconsider?.reason),
          reconsiderValid: x.reconsider?.valid === true,
          reconsiderInvalidReason: strictText(x.reconsider?.invalidReason),
          systemOutcome: strictText(x.outcome),
        }));
        const raw = await invoke({
          seat: 'M6', role: 'factory_arbiter', phase: `hearing-${objection.id}`,
          system: 'MAZZ_W68_HEARING\n你是 M6 庭审席。只返回 JSON：{"decision":"overrule|sustain","reason":"...","ruleRef":"..."}。证据优先，不得直接改稿。',
          user: `【质询】\n${JSON.stringify(objection)}\n\n【两轮答辩】\n${JSON.stringify(hearingAnswers)}`,
        });
        const hearing = normalizeHearingPacket(parseStrictReviewPacket(raw));
        objection.originalSeverity ||= objection.severity;
        if (!hearing.valid) objection.severity = 'critical';
        objection.status = hearing.decision === 'overrule' ? 'overruled' : 'sustained';
        objection.hearing = hearing;
      }
    }
    const unresolvedObjections = objections.filter(x => !['closed', 'overruled'].includes(x.status));
    const gates = {
      machine: machine.pass,
      point: point.decision === 'pass',
      review: reviews.length >= 1 && reviews.every(x => x.packet?.valid === true) && reviews.some(x => x.seat !== 'M3'),
      objection: unresolvedObjections.length === 0,
    };
    const finalEvidence = buildFinalArbitrationEvidence({
      gates, machine, point, reviews, objections, openCritical: unresolvedObjections, bible,
      initialUnit,
      budget: ledger.summary(),
    });
    let finalParsed;
    if (!finalEvidence.unresolvedBlockers.length) {
      transitions.push('final:not-required');
      finalParsed = {
        decision: 'not-invoked',
        reasonCode: 'PASS_ALL_GATES',
        reason: '无仲裁事项；由四闸形成程序性通过',
        ruleRef: 'W68-GATE',
      };
    } else {
      transitions.push('final:arbitration');
      const finalRaw = await invoke({
        seat: 'M6', role: 'factory_arbiter', phase: 'final',
        system: 'MAZZ_W68_FINAL\n你是流程仲裁席，不是第二个内容审查席，不得重做自动校验、节点验收或交叉审校。只返回 JSON：{"decision":"block","reasonCode":"CLOSED_GATE|UNRESOLVED_OBJECTION|EVIDENCE_CONFLICT|ARTIFACT_INTEGRITY","reason":"...","gateRef":"gate:machine|gate:point|gate:review|gate:objection 或空","artifactRef":"objection:<id>|conflict:<id>|artifact:bible 或空","ruleRef":"W68-GATE|W68-OBJECTION|W68-EVIDENCE|W68-INTEGRITY"}。你只能对证据包中明确列出的 unresolvedBlockers 作程序性裁决，必须逐字引用对应 gateRef 或 artifactRef；不得另造第五闸，不得以泛化的“依据不足”阻断，不得改稿。',
        user: `【程序性仲裁证据包】\n${JSON.stringify(finalEvidence)}`,
      });
      finalParsed = parseStrictReviewPacket(finalRaw);
    }
    const final = normalizeFinalArbitrationPacket(finalParsed, finalEvidence);
    const sealed = Object.values(gates).every(Boolean) && final.valid === true && final.decision === 'pass';
    transitions.push(sealed ? 'sealed' : 'blocked');
    const verdict = sealed ? 'pass' : final.valid && final.decision === 'block' ? 'block' : 'arbiter-invalid';
    const finalReason = final.valid
      ? (final.reason || (sealed ? '四闸全开且无未决关键质询' : '四闸或质询闸未关闭'))
      : `最终裁决包无效：${final.invalidReason || '无授权依据'}`;
    const result = {
      protocol: W68_PROTOCOL, sealed, verdict, reason: finalReason,
      ritual: ritualPlan, gates, text, schema, machine, machineHistory, polishRecord, point, consultation, repairs, reworkHistory, pointReports, reviews, objections, answers,
      transitions, budget: ledger.summary(), bible, finalEvidence, finalArbitration: final,
      precedent: precedentMarkdown({ unitRef, objections, verdict }),
    };
    result.artifacts = {
      skeleton: acceptanceSchemaMarkdown(schema), draft: text, polish: polishRecordMarkdown(polishRecord), machine: machineHistory.map(x => `## 机检轮次 ${x.round}\n\n${machineReportMarkdown(x.report)}`).join('\n\n---\n\n'),
      point: pointReports.map(x => pointReportMarkdown(x, x.round)).join('\n\n---\n\n'),
      repair: repairs.length ? repairs.map(repairOrderMarkdown).join('\n\n---\n\n') : '# 修订单\n\n- 无',
      consultation: consultation ? consultationMarkdown(consultation) : '# 请示单\n\n- 无',
      review: reviewMarkdown(reviews), objection: objectionMarkdown(objections), answer: answerMarkdown(answers), verdict: verdictMarkdown(result),
    };
    return result;
  } catch (error) {
    if (!['W68_COMPLETION_UNSAFE', 'W68_REVIEW_PACKET_INVALID'].includes(error?.code)) throw error;
    const unsafe = error.code === 'W68_COMPLETION_UNSAFE';
    const terminal = unsafe ? 'provider-unsafe' : 'review-invalid';
    const result = { protocol: W68_PROTOCOL, sealed: false, verdict: terminal, reason: error.message, ritual: ritualPlan, gates: { machine: !!machine?.pass, point: point?.decision === 'pass', review: false, objection: false }, text, schema, machine, machineHistory, polishRecord, point, repairs, reworkHistory, pointReports, reviews, objections, answers, transitions: [...transitions, terminal], budget: ledger.summary(), bible, unsafeCompletion: unsafe ? error.completion : null };
    result.artifacts = { skeleton: acceptanceSchemaMarkdown(schema), draft: text, polish: polishRecordMarkdown(polishRecord), machine: machineHistory.length ? machineHistory.map(x => `## 机检轮次 ${x.round}\n\n${machineReportMarkdown(x.report)}`).join('\n\n---\n\n') : '# 机检报告\n\n- 未执行', point: pointReports.map(x => pointReportMarkdown(x, x.round)).join('\n\n') || '# 对点报告\n\n- 未执行', repair: repairs.map(repairOrderMarkdown).join('\n\n') || '# 修订单\n\n- 无', consultation: consultation ? consultationMarkdown(consultation) : '# 请示单\n\n- 无', review: reviewMarkdown(reviews), objection: objectionMarkdown(objections), answer: answerMarkdown(answers), verdict: verdictMarkdown(result) };
    return result;
  }
}

export function reviewArtifactManifest(result, { unitRef = '第001单元' } = {}) {
  return {
    protocol: W68_PROTOCOL,
    unitRef,
    sealed: !!result?.sealed,
    verdict: result?.verdict,
    ritual: result?.ritual,
    gates: result?.gates,
    transitions: list(result?.transitions),
    budget: result?.budget,
    files: REVIEW_ARTIFACT_NAMES,
    immutableAfterSeal: !!result?.sealed,
    addendumRequiredForChanges: !!result?.sealed,
    generatedAt: new Date().toISOString(),
  };
}
